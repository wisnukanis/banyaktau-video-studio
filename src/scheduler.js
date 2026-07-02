import cron from "node-cron";
import { config, ensureProjectDirs } from "./config.js";
import { runPreflight } from "./preflight.js";
import { generateFullItem } from "./pipeline.js";
import { publishToSocials, socialDescription } from "./facebook.js";
import { publishToYoutube } from "./youtube.js";
import { syncAllAnalytics } from "./analytics.js";
import { refreshTrendSnapshot } from "./trend-research.js";
import { verifyRenderedItem } from "./quality-check.js";
import { translateAndDraftUS, renderUsVideo } from "./modules/us_generator.js";
import { absolutizeGeneratedUrls, remoteEnabled, uploadGeneratedStateAndAssets } from "./remote.js";
import { mergeMemoryItems, saveItem } from "./storage.js";
import { nowIso } from "./util.js";

ensureProjectDirs();

// ---- Config (env-driven, all optional with sane defaults) ----------------
// SCHEDULE_TIMES="08:00,13:00,19:00"  (24h, local to SCHEDULE_TIMEZONE)
// SCHEDULE_TIMEZONE="Asia/Jakarta"
// SCHEDULE_CATEGORIES="random"  or "sains,sejarah,teknologi" to rotate through
// SCHEDULE_WITH_CLIP="false"
// SCHEDULE_ANALYTICS_SYNC_TIME="03:30"  (once daily)
// SCHEDULE_TREND_SYNC_TIME="03:00"  (once daily, before analytics sync)
// SCHEDULE_MAX_RUNS_PER_DAY="3"  (safety cap, independent of how many times are listed)
// SCHEDULE_US_REMAKE_ENABLED="false"  (auto-remake every ID item into a US version)
// SCHEDULE_US_REMAKE_MODE="Controlled Remake"  (Fast Translate | Controlled Remake | Full Creative Remake)

const times = parseTimes(process.env.SCHEDULE_TIMES || "08:00,13:00,19:00");
const timezone = process.env.SCHEDULE_TIMEZONE || "Asia/Jakarta";
const categories = parseList(process.env.SCHEDULE_CATEGORIES || "random");
const withClip = boolEnv(process.env.SCHEDULE_WITH_CLIP, false);
const analyticsSyncTime = process.env.SCHEDULE_ANALYTICS_SYNC_TIME || "03:30";
const trendSyncTime = process.env.SCHEDULE_TREND_SYNC_TIME || "03:00";
const maxRunsPerDay = Math.max(1, Number(process.env.SCHEDULE_MAX_RUNS_PER_DAY || times.length || 3));
const usRemakeEnabled = boolEnv(process.env.SCHEDULE_US_REMAKE_ENABLED, false);
const usRemakeMode = process.env.SCHEDULE_US_REMAKE_MODE || "Controlled Remake";

let runsToday = 0;
let currentDay = new Date().toDateString();
let categoryIndex = 0;

function parseTimes(value) {
  return String(value || "")
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => /^\d{1,2}:\d{2}$/.test(entry));
}

function parseList(value) {
  return String(value || "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function boolEnv(value, fallback) {
  if (value === undefined || value === "") return fallback;
  return ["1", "true", "yes", "on"].includes(String(value).toLowerCase());
}

function resetDailyCounterIfNeeded() {
  const today = new Date().toDateString();
  if (today !== currentDay) {
    currentDay = today;
    runsToday = 0;
  }
}

function nextCategory() {
  if (!categories.length) return "random";
  const value = categories[categoryIndex % categories.length];
  categoryIndex += 1;
  return value;
}

function log(message) {
  console.log(`[scheduler ${nowIso()}] ${message}`);
}

async function runOnce() {
  resetDailyCounterIfNeeded();
  if (runsToday >= maxRunsPerDay) {
    log(`Lewati run — sudah mencapai batas SCHEDULE_MAX_RUNS_PER_DAY=${maxRunsPerDay} hari ini.`);
    return;
  }

  const preflight = await runPreflight();
  if (!preflight.ok) {
    log(`Preflight gagal, run dibatalkan: ${JSON.stringify(preflight.checks?.filter((c) => c.required && !c.ok))}`);
    return;
  }

  const category = nextCategory();
  log(`Mulai generate item baru. category=${category} withClip=${withClip}`);

  try {
    const result = await generateFullItem({ category }, { withClip, requireClip: withClip });
    let item = result.item;
    log(`Item selesai dirender: ${item.id} — "${item.title}"`);

    const check = await verifyRenderedItem(item);
    if (!check.ok) {
      log(`Peringatan kualitas render (ID): ${check.warnings.join(" | ")}`);
    } else {
      log(`Cek render OK. Durasi aktual ${check.actualDurationSec?.toFixed(1)}s (target ${check.targetDurationSec}s).`);
    }

    if (remoteEnabled()) {
      item = absolutizeGeneratedUrls(item);
      await saveItem(item);
      await mergeMemoryItems([item]);
      await uploadGeneratedStateAndAssets({ item });
      log("Upload remote selesai.");
    }

    if (config.facebook.enabled || config.instagram.enabled) {
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
      item.publish = { ...(item.publish || {}) };
      if (published.facebook) item.publish.facebook = { ...published.facebook, publishedAt };
      if (published.instagram) item.publish.instagram = { ...published.instagram, publishedAt };
      if (Object.keys(published.errors || {}).length) {
        item.publish.errors = { ...(item.publish.errors || {}), ...published.errors };
        for (const [platform, message] of Object.entries(published.errors)) {
          log(`Publish gagal di ${platform}: ${message}`);
        }
      }
      await saveItem(item);
      await mergeMemoryItems([item]);
      if (remoteEnabled()) await uploadGeneratedStateAndAssets({ item });
      log(`Publish ID selesai. facebook=${Boolean(published.facebook?.ok)} instagram=${Boolean(published.instagram?.ok)}`);
    } else {
      log("Tidak ada platform ID (Facebook/Instagram) yang aktif. Item ID hanya dirender lokal.");
    }

    if (usRemakeEnabled) {
      await runUsRemake(item);
    }

    runsToday += 1;
  } catch (error) {
    log(`Run gagal: ${error.message}`);
  }
}

// Takes a finished Indonesian item and produces + publishes its US market
// counterpart via the existing us_generator.js localization pipeline
// (translate/remake -> render -> publish to the US YouTube channel).
// This never touches or depends on any other creator's video — it only
// remixes the ID-market item this same pipeline just generated.
async function runUsRemake(sourceItem) {
  log(`Mulai auto-remake US dari item ${sourceItem.id} (mode=${usRemakeMode})...`);
  try {
    const draft = await translateAndDraftUS(sourceItem.id, { mode: usRemakeMode });
    log(`Draft US dibuat: ${draft.id} — "${draft.title}"`);

    const rendered = await renderUsVideo(draft.id);
    log(`Render US selesai: ${rendered.id}`);

    const check = await verifyRenderedItem(rendered);
    if (!check.ok) {
      log(`Peringatan kualitas render (US): ${check.warnings.join(" | ")}`);
    } else {
      log(`Cek render US OK. Durasi aktual ${check.actualDurationSec?.toFixed(1)}s (target ${check.targetDurationSec}s).`);
    }

    if (config.youtube.enabled) {
      try {
        const published = await publishToYoutube({
          videoPath: rendered.assets?.video?.path || "",
          title: rendered.title,
          description: rendered.publish_pack_us?.youtube_description || rendered.plan?.summary || "",
          tags: rendered.publish_pack_us?.hashtags || ["BanyakTau", "US"],
          thumbnailPath: rendered.assets?.thumbnail?.path || ""
        });
        rendered.publish = { ...(rendered.publish || {}), youtube: { ...published, publishedAt: new Date().toISOString() } };
        await saveItem(rendered);
        log(`Publish US ke YouTube selesai: ${published.url}`);
      } catch (error) {
        log(`Publish US ke YouTube gagal: ${error.message}`);
        rendered.publish = { ...(rendered.publish || {}), errors: { ...(rendered.publish?.errors || {}), youtube: error.message } };
        await saveItem(rendered);
      }
    } else {
      log("YOUTUBE_UPLOAD_ENABLED=false — versi US dirender tapi tidak dipublish (channel belum siap).");
    }
  } catch (error) {
    log(`Auto-remake US gagal: ${error.message}`);
  }
}

async function runTrendSync() {
  log("Mulai refresh trend research (ID + US)...");
  try {
    const idSnapshot = await refreshTrendSnapshot("ID");
    log(`Trend ID diperbarui. errors=${idSnapshot.errors?.length || 0}`);
  } catch (error) {
    log(`Trend research ID gagal: ${error.message}`);
  }
  try {
    const usSnapshot = await refreshTrendSnapshot("US");
    log(`Trend US diperbarui. errors=${usSnapshot.errors?.length || 0}`);
  } catch (error) {
    log(`Trend research US gagal: ${error.message}`);
  }
}

async function runAnalyticsSync() {
  log("Mulai sinkronisasi analytics...");
  try {
    const result = await syncAllAnalytics();
    log(`Analytics sync selesai. ${result.count} item diperbarui.`);
  } catch (error) {
    log(`Analytics sync gagal: ${error.message}`);
  }
}

function scheduleDaily(time, handler, label) {
  const [hour, minute] = time.split(":").map(Number);
  const expression = `${minute} ${hour} * * *`;
  cron.schedule(expression, handler, { timezone });
  log(`Terjadwal: ${label} tiap hari jam ${time} (${timezone}).`);
}

if (!times.length) {
  log("SCHEDULE_TIMES kosong atau tidak valid. Tidak ada jadwal generate yang aktif.");
} else {
  for (const time of times) {
    scheduleDaily(time, runOnce, "generate + publish");
  }
}

scheduleDaily(analyticsSyncTime, runAnalyticsSync, "analytics sync");
scheduleDaily(trendSyncTime, runTrendSync, "trend research sync (ID + US)");

log(`Scheduler aktif. runsPerDayCap=${maxRunsPerDay} categories=${categories.join(",") || "random"} usRemake=${usRemakeEnabled}`);
log("Menjalankan trend research awal (agar data tersedia sebelum run pertama)...");
runTrendSync();
log("Proses ini harus tetap berjalan (pakai pm2 / systemd / screen agar tidak mati saat terminal ditutup).");

// Keep the process alive; cron.schedule already does this via its internal
// timer, but an explicit heartbeat makes it obvious the process is healthy
// when watching logs (e.g. via `pm2 logs`).
setInterval(() => {}, 1 << 30);
