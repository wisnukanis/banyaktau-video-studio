import { ensureProjectDirs } from "./config.js";
import { config } from "./config.js";
import { publishToSocials, socialDescription } from "./facebook.js";
import { generateFullItem } from "./pipeline.js";
import { verifyRenderedItem } from "./quality-check.js";
import { absolutizeGeneratedUrls, publicBaseUrl, remoteEnabled, uploadGeneratedStateAndAssets } from "./remote.js";
import { mergeMemoryItems, saveItem } from "./storage.js";
import { syncAllAnalytics } from "./analytics.js";

function argValue(name, fallback = "") {
  const index = process.argv.indexOf(name);
  if (index < 0) return fallback;
  const value = process.argv[index + 1];
  if (!value || value.startsWith("--")) return fallback;
  return value;
}

function boolValue(value, fallback = false) {
  if (value === undefined || value === "") return fallback;
  return ["1", "true", "yes", "on"].includes(String(value).toLowerCase());
}

ensureProjectDirs();

const input = {
  topic: argValue("--topic", process.env.BANYAKTAU_TOPIC || ""),
  category: argValue("--category", process.env.BANYAKTAU_CATEGORY || "random"),
  tone: argValue("--tone", process.env.BANYAKTAU_TONE || "narator dokumenter TV Indonesia pria dewasa, tenang, berwibawa, tempo sedang, cerdas, tepercaya, jeda alami, transisi halus, tanpa emosi berlebih"),
  ttsProvider: argValue("--tts-provider", process.env.BANYAKTAU_TTS_PROVIDER || "openai"),
  longForm: boolValue(argValue("--long-form", process.env.BANYAKTAU_LONG_FORM || "false"), false),
  durationSec: Number(argValue("--duration", process.env.BANYAKTAU_DURATION || "90")),
  sceneCount: Number(argValue("--scenes", process.env.BANYAKTAU_SCENES || "7")),
  imageQuality: argValue("--image-quality", process.env.IMAGE_QUALITY || "low"),
  imageSize: argValue("--image-size", process.env.IMAGE_SIZE || "1024x1792"),
  visualSource: argValue("--visual-source", process.env.DEFAULT_VISUAL_SOURCE || "stock"),
  videoFormat: argValue("--video-format", process.env.DEFAULT_VIDEO_FORMAT || "vertical"),
  avatarMode: argValue("--avatar-mode", process.env.BANYAKTAU_AVATAR_MODE || "random-green")
};

const withClip = boolValue(argValue("--with-clip", process.env.BANYAKTAU_WITH_CLIP || "true"), true);
const requireClip = boolValue(argValue("--require-clip", process.env.BANYAKTAU_REQUIRE_CLIP || "false"), false);
const strictAi = boolValue(argValue("--strict-ai", process.env.BANYAKTAU_STRICT_AI || "false"), false);

console.log("BanyakTau run started.");
console.log(`Category=${input.category}, longForm=${input.longForm}, duration=${input.durationSec}, scenes=${input.sceneCount}, visualSource=${input.visualSource}, avatarMode=${input.avatarMode}, withClip=${withClip}, requireClip=${requireClip}, strictAi=${strictAi}`);

if (remoteEnabled()) {
  await importRemoteState();
}

const result = await generateFullItem(input, { withClip, requireClip, strictAi });
const quality = await verifyRenderedItem(result.item);
if (!quality.fileExists) {
  throw new Error(`Quality gate gagal: ${quality.warnings.join(" | ") || "hasil render tidak valid (file video tidak ditemukan)"}`);
}
if (!quality.ok) {
  console.warn(`Quality gate warning (non-fatal): ${quality.warnings.join(" | ")}`);
} else {
  console.log(`Quality gate OK: durasi=${quality.actualDurationSec?.toFixed(1)}s target=${quality.targetDurationSec}s`);
}

// Facebook Reels can upload the local binary directly. Keep publishing
// independent from FTP/SFTP/GitHub storage so a storage outage never skips FB.
await publishSocialsIfEnabled(result);

if (remoteEnabled()) {
  result.item = absolutizeGeneratedUrls(result.item);
  await mergeMemoryItems([result.item]);
  await saveItem(result.item);

  // Sync analytics for all published items — run after publish so the
  // newly uploaded video also gets its first stats snapshot. This builds
  // analytics.json which the next run reads to prioritise high-performing topics.
  try {
    console.log("Syncing analytics from Facebook/Instagram...");
    const analyticsResult = await syncAllAnalytics({ minHoursSincePublish: 0 });
    console.log(`Analytics synced: ${analyticsResult.count} item(s) updated.`);
  } catch (analyticsError) {
    result.warnings.push(`Analytics sync dilewati: ${analyticsError.message}`);
    console.warn(`Analytics sync gagal (non-fatal): ${analyticsError.message}`);
  }

  try {
    await uploadGeneratedStateAndAssets({ item: result.item });
    console.log("Remote upload complete.");
  } catch (error) {
    const message = `Remote upload gagal: ${error.message}`;
    result.warnings.push(message);
    console.warn(message);
    if (boolValue(process.env.BANYAKTAU_STRICT_REMOTE, false)) throw error;
  }
}

console.log(JSON.stringify({
  status: "done",
  id: result.item.id,
  title: result.item.title,
  videoUrl: result.item.assets?.video?.url || "",
  quality,
  warnings: result.warnings
}, null, 2));

async function importRemoteState() {
  const base = publicBaseUrl();
  if (!base) return;
  try {
    const remoteItems = await fetchRemoteJson(`${base}/state/items.json?v=${Date.now()}`, []);
    const remoteMemory = await fetchRemoteJson(`${base}/state/memory.json?v=${Date.now()}`, { items: [] });
    const remoteAnalytics = await fetchRemoteJson(`${base}/state/analytics.json?v=${Date.now()}`, null);
    for (const item of remoteItems) {
      if (item?.id) await saveItem(item);
    }
    await mergeMemoryItems([
      ...remoteItems,
      ...normalizeMemoryPayload(remoteMemory)
    ]);
    // Persist remote analytics so getPerformanceNotesText() has data this run
    if (remoteAnalytics && typeof remoteAnalytics === "object") {
      const fs = await import("node:fs/promises");
      const path = await import("node:path");
      const { paths } = await import("./config.js");
      const analyticsPath = path.join(paths.dataDir, "analytics.json");
      await fs.mkdir(path.dirname(analyticsPath), { recursive: true });
      await fs.writeFile(analyticsPath, JSON.stringify(remoteAnalytics, null, 2) + "\n");
      console.log("Remote analytics.json berhasil di-import.");
    }
  } catch (error) {
    console.warn(`Remote memory lama tidak bisa digabung: ${error.message}`);
  }
}

async function fetchRemoteJson(url, fallback) {
  try {
    const response = await fetch(url, { cache: "no-store" });
    if (!response.ok) return fallback;
    const text = await response.text();
    return text ? JSON.parse(text) : fallback;
  } catch {
    return fallback;
  }
}


function normalizeMemoryPayload(value) {
  if (Array.isArray(value)) return value;
  if (Array.isArray(value?.items)) return value.items;
  return [];
}

async function publishSocialsIfEnabled(result) {
  if (!config.facebook.enabled && !config.instagram.enabled && !config.youtube.enabled) return;
  try {
    const item = result.item;
    const published = await publishToSocials({
      videoUrl: item.assets?.video?.url || "",
      videoPath: item.assets?.video?.path || "",
      title: item.title,
      description: socialDescription(item),
      coverUrl: item.assets?.thumbnail?.url || "",
      thumbnailPath: item.assets?.thumbnail?.path || "",
      tags: ["BanyakTau", "FaktaMenarik", item.input?.category || ""].filter(Boolean),
      durationSec: item.assets?.video?.durationSec || 0
    });
    const publishedAt = new Date().toISOString();
    item.publish = {
      ...(item.publish || {})
    };
    if (published.facebook) item.publish.facebook = { ...published.facebook, publishedAt };
    if (published.instagram) item.publish.instagram = { ...published.instagram, publishedAt };
    if (published.youtube) item.publish.youtube = { ...published.youtube, publishedAt };
    if (Object.keys(published.errors || {}).length) {
      item.publish.errors = {
        ...(item.publish.errors || {}),
        ...published.errors
      };
      for (const [platform, message] of Object.entries(published.errors)) {
        result.warnings.push(`${platform} publish gagal: ${message}`);
      }
    }
    await saveItem(item);
    await mergeMemoryItems([item]);
    console.log(`Social publish complete: ${publishSummary(published)}`);
    if (config.facebook.enabled && !published.facebook?.ok && boolValue(process.env.FACEBOOK_STRICT_PUBLISH, false)) {
      throw new Error(`Facebook wajib publish tetapi gagal: ${published.errors?.facebook || "hasil publish tidak valid"}`);
    }
  } catch (error) {
    const message = `Social publish gagal: ${error.message}`;
    result.warnings.push(message);
    console.warn(message);
    if (boolValue(process.env.FACEBOOK_STRICT_PUBLISH, false)) throw error;
  }
}

function publishSummary(published) {
  const rows = [];
  if (published.facebook) rows.push(`facebook=${published.facebook.url || published.facebook.videoId || "ok"}`);
  if (published.instagram) rows.push(`instagram=${published.instagram.url || published.instagram.mediaId || "ok"}`);
  if (published.youtube) rows.push(`youtube=${published.youtube.url || published.youtube.videoId || "ok"}`);
  if (Object.keys(published.errors || {}).length) rows.push(`errors=${Object.keys(published.errors).join(",")}`);
  return rows.join(" ") || "skipped";
}
