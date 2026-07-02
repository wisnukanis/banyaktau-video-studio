import fs from "node:fs/promises";
import path from "node:path";
import { config, paths } from "./config.js";

const trendsFile = path.join(paths.dataDir, "trends.json");
const API_URL = "https://www.googleapis.com/youtube/v3";

// Maps this project's content categories to YouTube's official category
// taxonomy, so we can pull "what's trending right now" per topic area
// instead of one undifferentiated firehose.
const CATEGORY_TO_YT_ID = {
  "sains": "28",
  "penemuan": "28",
  "sejarah": "27",
  "tokoh dunia": "27",
  "tubuh manusia": "26",
  "alam semesta": "28",
  "teknologi": "28",
  "benda sehari-hari": "26",
  "random": "27"
};

const STOPWORDS = new Set([
  // Indonesian
  "yang", "dan", "di", "ke", "dari", "ini", "itu", "untuk", "dengan", "adalah",
  "kenapa", "kok", "bisa", "apa", "gak", "tidak", "saja", "juga", "pada", "ada",
  "the", "a", "an", "of", "to", "in", "on", "for", "and", "is", "are", "you",
  "this", "that", "with", "how", "why", "what", "vs", "official", "video"
]);

function clean(value) {
  return String(value || "").trim();
}

async function readTrends() {
  try {
    return JSON.parse(await fs.readFile(trendsFile, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return { version: 1, regions: {} };
    throw error;
  }
}

async function writeTrends(value) {
  await fs.mkdir(path.dirname(trendsFile), { recursive: true });
  const tmp = `${trendsFile}.tmp`;
  await fs.writeFile(tmp, `${JSON.stringify(value, null, 2)}\n`);
  await fs.rename(tmp, trendsFile);
}

function tokenizeTitles(titles) {
  const freq = new Map();
  for (const title of titles) {
    const words = clean(title)
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s]/gu, " ")
      .split(/\s+/)
      .filter((word) => word.length > 3 && !STOPWORDS.has(word));
    for (const word of words) {
      freq.set(word, (freq.get(word) || 0) + 1);
    }
  }
  return [...freq.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 15)
    .map(([word, count]) => ({ word, count }));
}

// Pulls the official "most popular" chart for a single YouTube category in a
// region. This is public aggregate data (title, tags, view count) — we only
// ever extract keyword-level signal from it, never a specific video's script
// or structure, and we never attribute ideas to a specific source video.
async function fetchCategorySnapshot(regionCode, ytCategoryId) {
  if (!config.youtube.dataApiKey) {
    throw new Error("YOUTUBE_DATA_API_KEY belum diisi di .env — trend research butuh API key read-only dari Google Cloud Console (aktifkan YouTube Data API v3, buat API key biasa, tidak perlu OAuth).");
  }
  const url = `${API_URL}/videos?part=snippet,statistics&chart=mostPopular&regionCode=${regionCode}&videoCategoryId=${ytCategoryId}&maxResults=25&key=${config.youtube.dataApiKey}`;
  const response = await fetch(url);
  const data = await response.json();
  if (!response.ok) {
    throw new Error(`YouTube trending fetch gagal (${regionCode}/${ytCategoryId}): ${data?.error?.message || response.statusText}`);
  }
  const items = data.items || [];
  const titles = items.map((item) => item.snippet?.title || "");
  const tagFreq = new Map();
  for (const item of items) {
    for (const tag of item.snippet?.tags || []) {
      const key = clean(tag).toLowerCase();
      if (!key || key.length < 3) continue;
      tagFreq.set(key, (tagFreq.get(key) || 0) + 1);
    }
  }
  const topTags = [...tagFreq.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([tag]) => tag);
  const avgViews = items.length
    ? Math.round(items.reduce((sum, item) => sum + Number(item.statistics?.viewCount || 0), 0) / items.length)
    : 0;

  return {
    ytCategoryId,
    sampleSize: items.length,
    avgViews,
    topKeywords: tokenizeTitles(titles),
    topTags
  };
}

// Refreshes the trend snapshot for a market (ID or US) across all mapped
// categories. Intended to run at most once or twice a day (see scheduler.js)
// — trending charts don't move fast enough to justify more, and it keeps
// API quota usage low.
export async function refreshTrendSnapshot(regionCode) {
  const categories = [...new Set(Object.values(CATEGORY_TO_YT_ID))];
  const byCategory = {};
  const errors = [];

  for (const ytCategoryId of categories) {
    try {
      byCategory[ytCategoryId] = await fetchCategorySnapshot(regionCode, ytCategoryId);
    } catch (error) {
      errors.push(error.message);
    }
  }

  const store = await readTrends();
  store.regions = store.regions || {};
  store.regions[regionCode] = {
    fetchedAt: new Date().toISOString(),
    byYtCategoryId: byCategory,
    errors
  };
  await writeTrends(store);
  return store.regions[regionCode];
}

// Returns the most recent snapshot for a region without hitting the API,
// or null if none has been fetched yet.
export async function getLatestSnapshot(regionCode) {
  const store = await readTrends();
  return store.regions?.[regionCode] || null;
}

// Turns a snapshot into a short, plain-language block appended to the idea
// generation prompt. Explicitly framed as directional keyword signal, not
// as a video to imitate — the model is told to use it for topic selection,
// not structural cloning.
export async function getTrendNotesText(regionCode, category = "random") {
  const snapshot = await getLatestSnapshot(regionCode);
  if (!snapshot) return "";

  const ytCategoryId = CATEGORY_TO_YT_ID[String(category).toLowerCase()] || CATEGORY_TO_YT_ID.random;
  const data = snapshot.byYtCategoryId?.[ytCategoryId];
  if (!data || !data.topKeywords?.length) return "";

  const ageHours = (Date.now() - new Date(snapshot.fetchedAt).getTime()) / 3_600_000;
  if (ageHours > 48) return ""; // stale, don't mislead the model

  const marketLabel = regionCode === "US" ? "US" : "Indonesia";
  const keywords = data.topKeywords.slice(0, 10).map((k) => k.word).join(", ");
  const tags = data.topTags.slice(0, 8).join(", ");

  const lines = [
    `Sinyal trending di YouTube ${marketLabel} untuk kategori ini (data agregat, per ${new Date(snapshot.fetchedAt).toLocaleDateString("id-ID")}):`,
    `Kata kunci yang sering muncul di video populer: ${keywords || "-"}`,
    tags ? `Tag terkait yang sering dipakai: ${tags}` : "",
    "Gunakan ini hanya sebagai sinyal arah topik/kata kunci yang sedang diminati audiens — JANGAN meniru video tertentu, buat ide dan sudut pandang orisinal sendiri."
  ].filter(Boolean);

  return lines.join("\n");
}
