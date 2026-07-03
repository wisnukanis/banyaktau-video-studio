import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { config, paths } from "./config.js";
import { requestTextCompletion } from "./openai.js";

function runFfmpeg(args) {
  return new Promise((resolve, reject) => {
    const child = spawn("ffmpeg", args);
    let stderr = "";
    child.stderr.on("data", (data) => stderr += data.toString());
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(stderr));
    });
  });
}

// Resizes and crops a downloaded stock video to 9:16 or 16:9 and strips audio
async function resizeStockVideo(inputPath, outputPath, format) {
  const isHorizontal = format === "horizontal";
  const scaleFilter = isHorizontal
    ? "scale=1920:1080:force_original_aspect_ratio=increase,crop=1920:1080,format=yuv420p"
    : "scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,format=yuv420p";
    
  await runFfmpeg([
    "-y",
    "-i", inputPath,
    "-vf", scaleFilter,
    "-c:v", "libx264",
    "-preset", "veryfast",
    "-crf", "23",
    "-an", // Strip audio to prevent channel/codec issues during segment concatenation
    outputPath
  ]);
}

async function downloadFile(url, destPath) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Gagal download: HTTP ${response.status}`);
  const arrayBuffer = await response.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);
  await fs.writeFile(destPath, buffer);
}

async function searchPexels(query, { perPage = 8 } = {}) {
  const apiKey = config.stock?.pexelsApiKey;
  if (!apiKey) return null;
  const url = `https://api.pexels.com/videos/search?query=${encodeURIComponent(query)}&per_page=${perPage}`;
  try {
    const res = await fetch(url, {
      headers: { Authorization: apiKey }
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data.videos || [];
  } catch (error) {
    console.error("Pexels API error:", error);
    return null;
  }
}

async function searchPixabay(query, { perPage = 8 } = {}) {
  const apiKey = config.stock?.pixabayApiKey;
  if (!apiKey) return null;
  const url = `https://pixabay.com/api/videos/?key=${apiKey}&q=${encodeURIComponent(query)}&per_page=${perPage}`;
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = await res.json();
    return data.hits || [];
  } catch (error) {
    console.error("Pixabay API error:", error);
    return null;
  }
}

// Picks the clip whose native duration best covers the target scene length,
// instead of always taking the first search result. A clip at or above the
// target plays once with little/no visible loop; only when nothing is long
// enough do we fall back to the longest available (which still loops
// seamlessly via -stream_loop, just more times).
function pickBestByDuration(candidates, targetDurationSec, getDuration) {
  if (!candidates.length) return null;
  const withDuration = candidates.map((item) => ({ item, duration: Number(getDuration(item) || 0) }));
  const longEnough = withDuration.filter((entry) => entry.duration >= targetDurationSec);
  if (longEnough.length) {
    longEnough.sort((a, b) => a.duration - b.duration); // smallest that still covers it
    return longEnough[0].item;
  }
  withDuration.sort((a, b) => b.duration - a.duration); // otherwise take the longest we have
  return withDuration[0]?.item || candidates[0];
}

function selectPexelsFile(video) {
  const files = video.video_files || [];
  // Prefer HD files (under 4K to save bandwidth)
  const filtered = files.filter(f => f.width && f.width <= 1920 && f.link);
  if (filtered.length) return filtered[0].link;
  const anyFile = files.find(f => f.link);
  return anyFile ? anyFile.link : null;
}

function selectPixabayFile(hit) {
  const videoObj = hit.videos || {};
  if (videoObj.medium?.url) return videoObj.medium.url;
  if (videoObj.large?.url) return videoObj.large.url;
  if (videoObj.small?.url) return videoObj.small.url;
  return null;
}

export async function extractSearchQuery(scene) {
  const systemPrompt = "You are a professional video editor. Generate exactly ONE search query in English (maximum 3 words) to search for relevant B-roll stock footage. Output ONLY the search query, no quotes, no explanations.";
  const userPrompt = `Narasi: ${scene.narration}\nTeks Layar: ${scene.screenText}`;
  try {
    const query = await requestTextCompletion(systemPrompt, userPrompt);
    return query.replace(/["']/g, "").trim();
  } catch (error) {
    console.error("Gagal mengekstrak kata kunci:", error);
    return scene.screenText || "knowledge";
  }
}

export async function fetchStockClip({ scene, query, format, itemId }) {
  await fs.mkdir(paths.clipDir, { recursive: true });
  await fs.mkdir(paths.workDir, { recursive: true });

  const targetDurationSec = Number(scene?.durationSec || 0) || 4;

  let downloadUrl = null;
  let provider = "pexels";
  let usedQuery = query;
  let nativeDurationSec = 0;

  const queries = [query];
  const words = query.split(/\s+/).filter(w => w && w.length > 2);
  if (words.length > 1) {
    // Fall back to individual words
    for (const word of words) {
      if (!queries.includes(word)) queries.push(word);
    }
  }
  // Generic safe fallbacks
  const genericFallbacks = ["history", "science", "knowledge", "education", "abstract"];
  for (const fallback of genericFallbacks) {
    if (!queries.includes(fallback)) queries.push(fallback);
  }

  for (const q of queries) {
    usedQuery = q;
    // 1. Try Pexels first — pick the result whose native duration best
    // covers the scene, so long scenes don't visibly loop a short clip.
    console.log(`Searching Pexels for query: "${q}" (target ${targetDurationSec}s)`);
    const pexelsVideos = await searchPexels(q);
    if (pexelsVideos && pexelsVideos.length) {
      const best = pickBestByDuration(pexelsVideos, targetDurationSec, (v) => v.duration);
      downloadUrl = best ? selectPexelsFile(best) : null;
      if (downloadUrl) {
        provider = "pexels";
        nativeDurationSec = Number(best.duration || 0);
        break;
      }
    }

    // 2. Try Pixabay
    console.log(`Searching Pixabay for query: "${q}" (target ${targetDurationSec}s)`);
    const pixabayHits = await searchPixabay(q);
    if (pixabayHits && pixabayHits.length) {
      const best = pickBestByDuration(pixabayHits, targetDurationSec, (v) => v.duration);
      downloadUrl = best ? selectPixabayFile(best) : null;
      if (downloadUrl) {
        provider = "pixabay";
        nativeDurationSec = Number(best.duration || 0);
        break;
      }
    }
  }

  if (!downloadUrl) {
    throw new Error(`Tidak menemukan stock video untuk kata kunci pencarian utama maupun cadangan di Pexels dan Pixabay.`);
  }

  const tempFilename = `temp-raw-stock-${itemId}-${scene.index}.mp4`;
  const tempPath = path.join(paths.workDir, tempFilename);
  const finalFilename = `${itemId}-scene-${scene.index}-stock.mp4`;
  const finalPath = path.join(paths.clipDir, finalFilename);

  console.log(`Downloading stock video from: ${downloadUrl} (native ~${nativeDurationSec}s, need ${targetDurationSec}s)`);
  await downloadFile(downloadUrl, tempPath);

  console.log(`Resizing and cropping stock video into ${format} format...`);
  await resizeStockVideo(tempPath, finalPath, format);

  // Clean up raw temp file
  try {
    await fs.unlink(tempPath);
  } catch (err) {
    console.error("Could not delete temp raw clip:", err);
  }

  if (nativeDurationSec > 0 && nativeDurationSec < targetDurationSec) {
    console.warn(`[Stock] Clip scene ${scene.index}: native duration ${nativeDurationSec}s < target ${targetDurationSec}s — akan di-loop mulus oleh renderer (bukan dipotong), tapi kalau ini kejadian di banyak scene, cari kata kunci yang lebih umum atau perpendek durasi scene.`);
  }

  return {
    sceneIndex: scene.index,
    provider,
    model: "stock-footage",
    path: finalPath,
    url: `/generated/clips/${finalFilename}`,
    prompt: usedQuery,
    seconds: nativeDurationSec || targetDurationSec,
    targetDurationSec,
    aspectRatio: format === "horizontal" ? "16:9" : "9:16",
    resolution: "720p"
  };
}
