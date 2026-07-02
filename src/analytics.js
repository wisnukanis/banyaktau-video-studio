import fs from "node:fs/promises";
import path from "node:path";
import { paths } from "./config.js";
import { listItems } from "./storage.js";
import { fetchFacebookVideoInsights, fetchInstagramMediaInsights } from "./facebook.js";
import { fetchYoutubeVideoStats } from "./youtube.js";

const analyticsFile = path.join(paths.dataDir, "analytics.json");

async function readAnalytics() {
  try {
    return JSON.parse(await fs.readFile(analyticsFile, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return { version: 1, items: {} };
    throw error;
  }
}

async function writeAnalytics(value) {
  await fs.mkdir(path.dirname(analyticsFile), { recursive: true });
  const tmp = `${analyticsFile}.tmp`;
  await fs.writeFile(tmp, `${JSON.stringify(value, null, 2)}\n`);
  await fs.rename(tmp, analyticsFile);
}

// A simple, transparent engagement score so different platforms can be
// compared on the same scale. Weights favor signals that indicate real
// interest (shares/saves) over passive views.
function engagementScore(snapshot = {}) {
  const views = Number(snapshot.viewCount || snapshot.playCount || 0);
  const likes = Number(snapshot.likeCount || 0);
  const comments = Number(snapshot.commentCount || 0);
  const shares = Number(snapshot.shareCount || 0);
  const saves = Number(snapshot.savedCount || 0);
  return views * 1 + likes * 3 + comments * 5 + shares * 8 + saves * 8;
}

// Fetches fresh metrics for one item across whichever platforms it was
// published to, and appends a timestamped snapshot to its history.
export async function recordItemAnalyticsSnapshot(item) {
  if (!item?.publish) return null;
  const platforms = {};

  const fbVideoId = item.publish.facebook?.videoId;
  if (fbVideoId) {
    const insight = await fetchFacebookVideoInsights(fbVideoId);
    if (insight) platforms.facebook = insight;
  }

  const igMediaId = item.publish.instagram?.mediaId;
  if (igMediaId) {
    const insight = await fetchInstagramMediaInsights(igMediaId);
    if (insight) platforms.instagram = insight;
  }

  const ytVideoId = item.publish.youtube?.videoId;
  if (ytVideoId) {
    try {
      const insight = await fetchYoutubeVideoStats(ytVideoId);
      if (insight) platforms.youtube = insight;
    } catch (error) {
      console.warn(`[Analytics] Gagal ambil statistik YouTube untuk ${ytVideoId}: ${error.message}`);
    }
  }

  if (!Object.keys(platforms).length) return null;

  const totalScore = Object.values(platforms).reduce((sum, snap) => sum + engagementScore(snap), 0);

  const store = await readAnalytics();
  const existing = store.items[item.id] || {
    itemId: item.id,
    title: item.title,
    topic: item.input?.topic || "",
    category: item.input?.category || "",
    hook: item.plan?.hook || "",
    snapshots: []
  };
  existing.title = item.title;
  existing.topic = item.input?.topic || existing.topic;
  existing.category = item.input?.category || existing.category;
  existing.hook = item.plan?.hook || existing.hook;
  existing.snapshots.push({
    at: new Date().toISOString(),
    platforms,
    totalScore
  });
  existing.snapshots = existing.snapshots.slice(-30);
  existing.latestScore = totalScore;
  store.items[item.id] = existing;
  await writeAnalytics(store);
  return existing;
}

// Syncs analytics for every item that has been published somewhere and is
// at least `minHoursSincePublish` old (fresh uploads have no meaningful
// stats yet). Intended to be called on a schedule (see scheduler.js).
export async function syncAllAnalytics({ minHoursSincePublish = 6 } = {}) {
  const items = await listItems();
  const results = [];
  const now = Date.now();

  for (const item of items) {
    const publishTimes = [
      item.publish?.facebook?.publishedAt,
      item.publish?.instagram?.publishedAt,
      item.publish?.youtube?.publishedAt
    ].filter(Boolean);
    if (!publishTimes.length) continue;

    const earliestPublish = Math.min(...publishTimes.map((t) => new Date(t).getTime()));
    const hoursSince = (now - earliestPublish) / 3_600_000;
    if (hoursSince < minHoursSincePublish) continue;

    try {
      const snapshot = await recordItemAnalyticsSnapshot(item);
      if (snapshot) results.push({ itemId: item.id, ok: true, totalScore: snapshot.latestScore });
    } catch (error) {
      results.push({ itemId: item.id, ok: false, error: error.message });
    }
  }

  return { syncedAt: new Date().toISOString(), count: results.length, results };
}

// Ranks categories and hooks by average engagement score so the idea
// generator can lean toward what has actually worked, instead of guessing.
export async function getPerformanceSummary({ topN = 5 } = {}) {
  const store = await readAnalytics();
  const rows = Object.values(store.items || {}).filter((row) => row.snapshots?.length);
  if (!rows.length) return null;

  const byCategory = new Map();
  for (const row of rows) {
    const category = row.category || "random";
    const score = row.latestScore || 0;
    const entry = byCategory.get(category) || { category, totalScore: 0, count: 0, bestTitle: "", bestScore: -1 };
    entry.totalScore += score;
    entry.count += 1;
    if (score > entry.bestScore) {
      entry.bestScore = score;
      entry.bestTitle = row.title;
    }
    byCategory.set(category, entry);
  }

  const categoryRanking = [...byCategory.values()]
    .map((entry) => ({ ...entry, avgScore: entry.totalScore / entry.count }))
    .sort((a, b) => b.avgScore - a.avgScore);

  const topItems = [...rows]
    .sort((a, b) => (b.latestScore || 0) - (a.latestScore || 0))
    .slice(0, topN);

  const bottomCutoff = Math.max(1, Math.floor(rows.length * 0.3));
  const lowPerformers = [...rows]
    .sort((a, b) => (a.latestScore || 0) - (b.latestScore || 0))
    .slice(0, bottomCutoff);

  return {
    generatedAt: new Date().toISOString(),
    sampleSize: rows.length,
    categoryRanking,
    topItems,
    lowPerformers
  };
}

// Turns the ranking above into a short, plain-language block that gets
// appended to the idea-generation prompt in story-engine.js.
export async function getPerformanceNotesText() {
  const summary = await getPerformanceSummary({ topN: 5 });
  if (!summary || summary.sampleSize < 3) {
    // Not enough data yet to draw useful conclusions; say nothing rather
    // than mislead the model with noise from 1-2 data points.
    return "";
  }

  const lines = [
    `Data performa ${summary.sampleSize} video terakhir (skor = views + like*3 + komentar*5 + share/save*8):`
  ];

  const topCategories = summary.categoryRanking.slice(0, 3);
  if (topCategories.length) {
    lines.push(
      "Kategori dengan performa rata-rata terbaik: " +
      topCategories.map((c) => `${c.category} (avg ${Math.round(c.avgScore)}, contoh terbaik: "${c.bestTitle}")`).join("; ")
    );
  }

  const weakCategories = summary.categoryRanking.slice(-2).reverse();
  if (weakCategories.length && weakCategories[0].category !== topCategories[0]?.category) {
    lines.push(
      "Kategori dengan performa rata-rata lebih lemah (bukan dilarang, tapi jangan didominasi): " +
      weakCategories.map((c) => `${c.category} (avg ${Math.round(c.avgScore)})`).join("; ")
    );
  }

  if (summary.topItems.length) {
    lines.push(
      "Video dengan engagement tertinggi baru-baru ini: " +
      summary.topItems.slice(0, 3).map((item) => `"${item.title}" (hook: ${item.hook || "-"})`).join(" | ")
    );
  }

  lines.push("Gunakan ini sebagai sinyal arah, bukan aturan kaku — tetap prioritaskan ide yang faktual dan orisinal.");

  return lines.join("\n");
}
