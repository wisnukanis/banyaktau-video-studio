import fs from "node:fs/promises";
import path from "node:path";
import { config, paths } from "./config.js";
import { safeWriteJson } from "./util.js";

const trendsFile = path.join(paths.dataDir, "trends.json");
const API_URL = "https://www.googleapis.com/youtube/v3";

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

function extractXmlTag(xml, tag) {
  const match = xml.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i"));
  return match ? match[1].trim() : "";
}

function cleanXmlEntities(str) {
  return String(str || "")
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .trim();
}

async function readTrends() {
  try {
    return JSON.parse(await fs.readFile(trendsFile, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return { version: 2, regions: {}, googleTrends: {}, globalScience: [] };
    throw error;
  }
}

async function writeTrends(value) {
  await safeWriteJson(trendsFile, value);
}

export async function fetchGoogleTrends(regionCode = "ID") {
  const url = `https://trends.google.com/trending/rss?geo=${encodeURIComponent(regionCode)}`;
  const response = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0 (compatible; BanyakTauStudio/1.0)" },
    signal: AbortSignal.timeout(8000)
  });
  if (!response.ok) {
    throw new Error(`Google Trends fetch failed (${regionCode}): ${response.status} ${response.statusText}`);
  }
  const xml = await response.text();
  const items = xml.match(/<item>[\s\S]*?<\/item>/g) || [];

  return items.slice(0, 15).map((item) => {
    const title = cleanXmlEntities(extractXmlTag(item, "title"));
    const traffic = cleanXmlEntities(extractXmlTag(item, "ht:approx_traffic"));
    const newsMatches = item.match(/<ht:news_item>[\s\S]*?<\/ht:news_item>/g) || [];
    const news = newsMatches.slice(0, 2).map((n) => ({
      title: cleanXmlEntities(extractXmlTag(n, "ht:news_item_title")),
      source: cleanXmlEntities(extractXmlTag(n, "ht:news_item_source"))
    }));
    return { title, traffic, news };
  }).filter((i) => i.title);
}

export async function fetchGlobalScienceTrends() {
  const url = "https://www.sciencedaily.com/rss/all.xml";
  const response = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0 (compatible; BanyakTauStudio/1.0)" },
    signal: AbortSignal.timeout(8000)
  });
  if (!response.ok) {
    throw new Error(`ScienceDaily fetch failed: ${response.status} ${response.statusText}`);
  }
  const xml = await response.text();
  const items = xml.match(/<item>[\s\S]*?<\/item>/g) || [];

  return items.slice(0, 15).map((item) => ({
    title: cleanXmlEntities(extractXmlTag(item, "title")),
    description: cleanXmlEntities(extractXmlTag(item, "description")),
    link: cleanXmlEntities(extractXmlTag(item, "link")),
    pubDate: cleanXmlEntities(extractXmlTag(item, "pubDate"))
  })).filter((i) => i.title && i.description);
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

async function fetchCategorySnapshot(regionCode, ytCategoryId) {
  if (!config.youtube.dataApiKey) {
    return null;
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

export async function refreshTrendSnapshot(regionCode = "ID") {
  const store = await readTrends();
  store.version = 2;
  store.regions = store.regions || {};
  store.googleTrends = store.googleTrends || {};
  store.globalScience = store.globalScience || [];

  const errors = [];

  // 1. Fetch Google Trends for region
  try {
    const gt = await fetchGoogleTrends(regionCode);
    store.googleTrends[regionCode] = {
      fetchedAt: new Date().toISOString(),
      items: gt
    };
  } catch (err) {
    errors.push(`Google Trends (${regionCode}): ${err.message}`);
  }

  // 2. Fetch ScienceDaily discoveries (global)
  try {
    const sci = await fetchGlobalScienceTrends();
    store.globalScience = sci;
    store.globalScienceFetchedAt = new Date().toISOString();
  } catch (err) {
    errors.push(`Global Science: ${err.message}`);
  }

  // 3. YouTube Data API (if key available)
  if (config.youtube.dataApiKey) {
    const categories = [...new Set(Object.values(CATEGORY_TO_YT_ID))];
    const byCategory = {};
    for (const ytCategoryId of categories) {
      try {
        const snap = await fetchCategorySnapshot(regionCode, ytCategoryId);
        if (snap) byCategory[ytCategoryId] = snap;
      } catch (error) {
        errors.push(`YouTube (${ytCategoryId}): ${error.message}`);
      }
    }
    store.regions[regionCode] = {
      fetchedAt: new Date().toISOString(),
      byYtCategoryId: byCategory,
      errors
    };
  }

  store.lastUpdated = new Date().toISOString();
  await writeTrends(store);
  return store;
}

export async function getLatestSnapshot(regionCode = "ID") {
  const store = await readTrends();
  return store.regions?.[regionCode] || null;
}

export async function getLiveViralData(regionCode = "ID", maxAgeHours = 4) {
  let store = await readTrends();
  const now = Date.now();
  const lastUpdate = store.lastUpdated ? new Date(store.lastUpdated).getTime() : 0;
  const ageHours = (now - lastUpdate) / 3_600_000;

  const hasGt = store.googleTrends?.[regionCode]?.items?.length;
  const hasSci = store.globalScience?.length;

  if (!hasGt || !hasSci || ageHours > maxAgeHours) {
    try {
      store = await refreshTrendSnapshot(regionCode);
    } catch {
      // Return existing cache if network error
    }
  }

  return {
    googleTrends: store.googleTrends?.[regionCode]?.items || [],
    globalScience: store.globalScience || [],
    lastUpdated: store.lastUpdated || null
  };
}

export async function getTrendNotesText(regionCode = "ID", category = "random") {
  const live = await getLiveViralData(regionCode);
  const sections = [];

  // 1. ScienceDaily global breaking discoveries
  if (live.globalScience?.length) {
    const topSci = live.globalScience.slice(0, 4).map((s, idx) => {
      return `  ${idx + 1}. [GLOBAL DISCOVERY] ${s.title}: "${s.description.slice(0, 160)}..."`;
    }).join("\n");

    sections.push(
      `PENEMUAN & FAKTA SAINS TERBARU DI DUNIA (ScienceDaily Global):\n${topSci}`
    );
  }

  // 2. Google Trends real-time
  if (live.googleTrends?.length) {
    const topGt = live.googleTrends.slice(0, 5).map((t, idx) => {
      const headline = t.news?.[0]?.title ? ` - Headline: "${t.news[0].title}"` : "";
      return `  ${idx + 1}. [TRENDING ${regionCode}] "${t.title}" (${t.traffic} pencarian)${headline}`;
    }).join("\n");

    sections.push(
      `TREN PENCARIAN VIRAL REAL-TIME GOOGLE (${regionCode === "US" ? "AMERIKA / GLOBAL" : "INDONESIA"}):\n${topGt}`
    );
  }

  // 3. YouTube aggregate signal (if available)
  const snapshot = await getLatestSnapshot(regionCode);
  if (snapshot) {
    const ytCategoryId = CATEGORY_TO_YT_ID[String(category).toLowerCase()] || CATEGORY_TO_YT_ID.random;
    const data = snapshot.byYtCategoryId?.[ytCategoryId];
    if (data?.topKeywords?.length) {
      const keywords = data.topKeywords.slice(0, 8).map((k) => k.word).join(", ");
      sections.push(`KATA KUNCI POPULER YOUTUBE: ${keywords}`);
    }
  }

  if (sections.length === 0) return "";

  return [
    "=== SINYAL TREN VIRAL & PENEMUAN DUNIA HARI INI ===",
    sections.join("\n\n"),
    "INSTRUKSI ADAPTASI TREN:",
    "- Utamakan memilih atau mengaitkan ide video dengan penemuan atau topik yang sedang viral di atas jika relevan dengan edukasi/fakta menarik BanyakTau.",
    "- Ubah topik tersebut menjadi hook yang mengejutkan, faktual, dan membuat orang penasaran sejak detik pertama.",
    "- JANGAN membuat konten clickbait palsu atau gosip/politik kotor; bawa sudut pandang sains, sejarah, logika, atau dampak uniknya bagi kehidupan manusia.",
    "==================================================="
  ].join("\n");
}

