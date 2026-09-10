import fs from "node:fs/promises";
import path from "node:path";
import { cleanText } from "./util.js";

function cleanXmlEntities(str) {
  return String(str || "")
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Searches Google News RSS for real-time news headlines and articles around a query.
 */
export async function searchGoogleNews(query, lang = "id") {
  const cleanQ = cleanText(query, 120);
  if (!cleanQ) return [];

  const hl = lang === "en" ? "en-US" : "id";
  const gl = lang === "en" ? "US" : "ID";
  const ceid = lang === "en" ? "US:en" : "ID:id";
  const url = `https://news.google.com/rss/search?q=${encodeURIComponent(cleanQ)}&hl=${hl}&gl=${gl}&ceid=${ceid}`;

  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; BanyakTauStudio/1.0)" },
      signal: AbortSignal.timeout(6000)
    });
    if (!res.ok) return [];

    const xml = await res.text();
    const items = xml.match(/<item>[\s\S]*?<\/item>/g) || [];

    return items.slice(0, 5).map((item) => {
      const titleMatch = item.match(/<title>([\s\S]*?)<\/title>/i);
      const linkMatch = item.match(/<link>([\s\S]*?)<\/link>/i);
      const sourceMatch = item.match(/<source[^>]*>([\s\S]*?)<\/source>/i);
      const pubDateMatch = item.match(/<pubDate>([\s\S]*?)<\/pubDate>/i);

      return {
        title: cleanXmlEntities(titleMatch ? titleMatch[1] : ""),
        link: linkMatch ? linkMatch[1].trim() : "",
        source: cleanXmlEntities(sourceMatch ? sourceMatch[1] : ""),
        pubDate: pubDateMatch ? pubDateMatch[1].trim() : ""
      };
    }).filter((i) => i.title);
  } catch (err) {
    console.warn(`[research-scraper] Google News fetch gagal untuk "${cleanQ}": ${err.message}`);
    return [];
  }
}

/**
 * Searches Wikipedia and extracts factual encyclopedia summary.
 */
export async function searchWikipediaFact(query, lang = "id") {
  const cleanQ = cleanText(query, 120);
  if (!cleanQ) return null;

  const domain = lang === "en" ? "en.wikipedia.org" : "id.wikipedia.org";
  const searchUrl = `https://${domain}/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(cleanQ)}&format=json&utf8=1`;

  try {
    const searchRes = await fetch(searchUrl, {
      headers: { "User-Agent": "BanyakTauBot/1.0 (knowledge-research)" },
      signal: AbortSignal.timeout(6000)
    });
    if (!searchRes.ok) return null;

    const searchData = await searchRes.json();
    const hit = searchData?.query?.search?.[0];
    if (!hit?.title) return null;

    // Fetch rich summary of the top page
    const summaryUrl = `https://${domain}/api/rest_v1/page/summary/${encodeURIComponent(hit.title)}`;
    const summaryRes = await fetch(summaryUrl, {
      headers: { "User-Agent": "BanyakTauBot/1.0 (knowledge-research)" },
      signal: AbortSignal.timeout(6000)
    });
    if (!summaryRes.ok) {
      return {
        title: hit.title,
        extract: cleanXmlEntities(hit.snippet),
        url: `https://${domain}/wiki/${encodeURIComponent(hit.title)}`
      };
    }

    const summary = await summaryRes.json();
    return {
      title: summary.title || hit.title,
      description: summary.description || "",
      extract: summary.extract || cleanXmlEntities(hit.snippet),
      thumbnail: summary.thumbnail?.source || summary.originalimage?.source || null,
      url: summary.content_urls?.desktop?.page || `https://${domain}/wiki/${encodeURIComponent(hit.title)}`
    };
  } catch (err) {
    console.warn(`[research-scraper] Wikipedia fetch gagal untuk "${cleanQ}": ${err.message}`);
    return null;
  }
}

/**
 * Combines Google News and Wikipedia facts into a single prompt-ready research block.
 */
export async function getTopicDeepResearch(topic, lang = "id") {
  if (!topic || topic.trim().length < 2) return "";

  const [wiki, news] = await Promise.all([
    searchWikipediaFact(topic, lang).catch(() => null),
    searchGoogleNews(topic, lang).catch(() => [])
  ]);

  const sections = [];

  if (wiki?.extract) {
    sections.push(
      `[FAKTA ENSIKLOPEDIA RESMI - WIKIPEDIA: ${wiki.title}]`,
      wiki.description ? `Deskripsi singkat: ${wiki.description}` : "",
      `Rangkuman fakta: ${wiki.extract}`
    );
  }

  if (news.length > 0) {
    const newsList = news.slice(0, 3).map((n, i) => `  ${i + 1}. "${n.title}" (${n.source || "Media"})`).join("\n");
    sections.push(
      `[BERITA & PERISTIWA HANGAT TERKAIT]`,
      newsList
    );
  }

  if (sections.filter(Boolean).length === 0) return "";

  return [
    "=== HASIL RISET FAKTA & DATA NYATA (WEB RESEARCH) ===",
    sections.filter(Boolean).join("\n"),
    "INSTRUKSI INTEGRASI RISET:",
    "- Masukkan data, angka, tahun, lokasi, atau fakta unik hasil riset di atas ke dalam naskah cerita agar akurat dan berbobot.",
    "- Jangan membaca fakta seperti ensiklopedia membosankan; ceritakan dengan alur rasa penasaran khas BanyakTau.",
    "======================================================"
  ].join("\n");
}

/**
 * Searches Wikimedia Commons for public domain or Creative Commons archive photos/illustrations.
 */
export async function searchWikimediaCommons(query, limit = 5) {
  const cleanQ = cleanText(query, 100);
  if (!cleanQ) return [];

  const url = `https://commons.wikimedia.org/w/api.php?action=query&generator=search&gsrsearch=${encodeURIComponent(cleanQ)}&gsrnamespace=6&prop=imageinfo&iiprop=url|size|mime&format=json&gsrlimit=${limit}`;

  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "BanyakTauBot/1.0 (archive-asset-search)" },
      signal: AbortSignal.timeout(6000)
    });
    if (!res.ok) return [];

    const data = await res.json();
    const pages = Object.values(data?.query?.pages || {});

    return pages
      .map((p) => {
        const info = p.imageinfo?.[0];
        if (!info?.url) return null;
        // Filter out non-images (e.g. audio/pdf/svg if not easily rasterizable)
        const mime = String(info.mime || "").toLowerCase();
        if (!mime.includes("image/jpeg") && !mime.includes("image/png") && !mime.includes("image/webp")) {
          return null;
        }
        return {
          title: p.title,
          url: info.url,
          width: info.width || 0,
          height: info.height || 0,
          mime: info.mime
        };
      })
      .filter(Boolean);
  } catch (err) {
    console.warn(`[research-scraper] Wikimedia Commons search gagal untuk "${cleanQ}": ${err.message}`);
    return [];
  }
}
