import fs from "node:fs/promises";
import { probeDuration } from "./render.js";
import { saveItem } from "./storage.js";

// Checks a rendered item's video file for basic sanity: does it exist, is it
// non-empty, and is its actual duration reasonably close to what was
// planned? Mismatches usually mean a TTS/render step silently truncated or
// a scene failed to render — worth flagging rather than publishing blind.
export async function verifyRenderedItem(item, { toleranceRatio = 0.25, persist = true } = {}) {
  const result = {
    itemId: item.id,
    ok: false,
    fileExists: false,
    targetDurationSec: Number(item.input?.durationSec || 0),
    actualDurationSec: null,
    deviationRatio: null,
    warnings: []
  };

  const videoPath = item.assets?.video?.path;
  if (!videoPath) {
    result.warnings.push("Tidak ada assets.video.path pada item — render mungkin belum selesai atau gagal.");
    return finalize(item, result, persist);
  }

  try {
    const stat = await fs.stat(videoPath);
    result.fileExists = stat.size > 0;
    if (!result.fileExists) result.warnings.push("File video ada tapi ukurannya 0 byte.");
  } catch {
    result.warnings.push(`File video tidak ditemukan di path: ${videoPath}`);
    return finalize(item, result, persist);
  }

  try {
    result.actualDurationSec = await probeDuration(videoPath);
  } catch (error) {
    result.warnings.push(`Gagal membaca durasi video (ffprobe): ${error.message}`);
    return finalize(item, result, persist);
  }

  if (result.targetDurationSec > 0) {
    result.deviationRatio = Math.abs(result.actualDurationSec - result.targetDurationSec) / result.targetDurationSec;
    if (result.deviationRatio > toleranceRatio) {
      result.warnings.push(
        `Durasi hasil render (${result.actualDurationSec.toFixed(1)}s) meleset ${Math.round(result.deviationRatio * 100)}% dari target (${result.targetDurationSec}s).`
      );
    }
  }

  result.ok = result.fileExists && (result.deviationRatio === null || result.deviationRatio <= toleranceRatio);
  return finalize(item, result, persist);
}

async function finalize(item, result, persist) {
  if (persist) {
    item.quality_notes = item.quality_notes || { fact_safety_score: 0, hook_score: 0, caption_readability_score: 0, visual_reuse_score: 0, warnings: [] };
    item.quality_notes.warnings = [...new Set([...(item.quality_notes.warnings || []), ...result.warnings])];
    item.quality_notes.lastRenderCheck = {
      at: new Date().toISOString(),
      ok: result.ok,
      actualDurationSec: result.actualDurationSec,
      targetDurationSec: result.targetDurationSec
    };
    try {
      await saveItem(item);
    } catch {
      // Non-fatal: quality check result is still returned to the caller
      // even if persisting the annotation fails.
    }
  }
  return result;
}
