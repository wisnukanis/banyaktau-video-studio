import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { config, paths } from "./config.js";
import { requestTextCompletion } from "./openai.js";

const FALLBACK_QUERY = "education";
const QUERY_STOPWORDS = new Set([
  "yang", "dan", "atau", "ini", "itu", "untuk", "dari", "dalam", "dengan", "karena",
  "jadi", "bisa", "akan", "adalah", "sebuah", "sebagai", "pada", "ke", "di", "ter",
  "para", "saat", "ketika", "mengapa", "kenapa", "bagaimana", "fakta", "jarang",
  "dibahas", "ternyata", "membuat", "punya", "lebih", "bukan", "hanya", "kamu",
  "kita", "mereka", "ada", "tak", "tidak", "sangat", "hal", "bagian", "kisah"
]);
const QUERY_TRANSLATIONS = new Map([
  ["sejarah", "history"],
  ["sains", "science"],
  ["ilmu", "science"],
  ["pengetahuan", "knowledge"],
  ["teknologi", "technology"],
  ["alam", "nature"],
  ["semesta", "space"],
  ["luar", "space"],
  ["angkasa", "space"],
  ["bumi", "earth"],
  ["laut", "ocean"],
  ["samudra", "ocean"],
  ["hutan", "forest"],
  ["gunung", "mountain"],
  ["manusia", "human"],
  ["tubuh", "body"],
  ["otak", "brain"],
  ["jantung", "heart"],
  ["darah", "blood"],
  ["makanan", "food"],
  ["kesehatan", "health"],
  ["penyakit", "health"],
  ["obat", "medicine"],
  ["laboratorium", "laboratory"],
  ["penemuan", "discovery"],
  ["eksperimen", "experiment"],
  ["benda", "object"],
  ["mesin", "machine"],
  ["listrik", "electricity"],
  ["energi", "energy"],
  ["cahaya", "light"],
  ["air", "water"],
  ["api", "fire"],
  ["kota", "city"],
  ["desa", "village"],
  ["kerajaan", "kingdom"],
  ["perang", "war"],
  ["peta", "map"],
  ["sekolah", "school"],
  ["belajar", "education"],
  ["pendidikan", "education"],
  ["buku", "book"],
  ["museum", "museum"],
  ["arsip", "archive"],
  ["dokumen", "document"]
]);

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
async function resizeStockVideo(inputPath, outputPath, format, durationSec) {
  const isHorizontal = format === "horizontal";
  const scaleFilter = isHorizontal
    ? "scale=1920:1080:force_original_aspect_ratio=increase,crop=1920:1080,format=yuv420p"
    : "scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,format=yuv420p";
    
  await runFfmpeg([
    "-y",
    "-stream_loop", "-1",
    "-i", inputPath,
    "-t", Number(durationSec || 4).toFixed(2),
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

async function searchPexels(query, { perPage = 18 } = {}) {
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

async function searchPixabay(query, { perPage = 18 } = {}) {
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

function selectPexelsFile(video, format) {
  const files = video.video_files || [];
  // Prefer a source that matches the target orientation and resolution. This
  // avoids heavily cropping a low-resolution landscape file for a Reel.
  const filtered = files.filter((file) => file.width && file.height && file.link && Math.max(file.width, file.height) <= 2160);
  const best = pickBestFileVariant(filtered, format);
  if (best) return best.link;
  const anyFile = files.find(f => f.link);
  return anyFile ? anyFile.link : null;
}

export function stockProvidersAvailable() {
  return Boolean(config.stock?.pexelsApiKey || config.stock?.pixabayApiKey);
}

function selectPixabayFile(hit, format) {
  const variants = Object.values(hit.videos || {})
    .filter((file) => file?.url)
    .map((file) => ({ ...file, link: file.url }));
  return pickBestFileVariant(variants, format)?.link || null;
}

function pickBestFileVariant(files, format) {
  if (!files.length) return null;
  const horizontal = format === "horizontal";
  const targetWidth = horizontal ? 1920 : 1080;
  const targetHeight = horizontal ? 1080 : 1920;
  return [...files].sort((a, b) => fileVariantScore(b, targetWidth, targetHeight) - fileVariantScore(a, targetWidth, targetHeight))[0];
}

function fileVariantScore(file, targetWidth, targetHeight) {
  const width = Number(file.width || 0);
  const height = Number(file.height || 0);
  if (!width || !height) return 0;
  const orientationMatches = (width >= height) === (targetWidth >= targetHeight);
  const coverage = Math.min(width / targetWidth, height / targetHeight);
  const enoughResolution = coverage >= 1;
  // Orientation and enough native pixels dominate; area only breaks ties.
  return (orientationMatches ? 1_000_000 : 0)
    + (enoughResolution ? 100_000 : 0)
    + Math.min(coverage, 2) * 10_000
    + Math.min(width * height, targetWidth * targetHeight * 2) / 1000;
}

export async function extractSearchQuery(scene) {
  const plannedQuery = cleanQuery(scene?.stockQuery);
  if (plannedQuery) return plannedQuery;

  const systemPrompt = "You are a professional video editor. Generate exactly ONE search query in English (maximum 3 words) to search for relevant B-roll stock footage. Output ONLY the search query, no quotes, no explanations.";
  const userPrompt = `Narasi: ${scene.narration}\nTeks Layar: ${scene.screenText}`;
  try {
    const query = await requestTextCompletion(systemPrompt, userPrompt);
    const cleaned = cleanQuery(query);
    if (cleaned) return cleaned;
  } catch (error) {
    console.error("Gagal mengekstrak kata kunci:", error);
  }
  const fallback = fallbackSearchQuery(scene);
  console.warn(`[Stock] Menggunakan fallback query tanpa OpenAI untuk scene ${scene.index}: "${fallback}"`);
  return fallback;
}

function cleanQuery(value) {
  return String(value || "")
    .replace(/["']/g, "")
    .replace(/[^\p{L}\p{N}\s-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 3)
    .join(" ");
}

function fallbackSearchQuery(scene) {
  const text = [scene.screenText, scene.narration, scene.imagePrompt]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  const translated = [];
  const keywords = [];

  for (const raw of text.match(/[\p{L}\p{N}]+/gu) || []) {
    if (raw.length < 3 || QUERY_STOPWORDS.has(raw)) continue;
    const mapped = QUERY_TRANSLATIONS.get(raw);
    if (mapped && !translated.includes(mapped)) translated.push(mapped);
    else if (!mapped && /^[a-z0-9]+$/.test(raw) && !keywords.includes(raw)) keywords.push(raw);
    if (translated.length >= 3) break;
  }

  const selected = translated.length ? translated : keywords.slice(0, 2);
  return cleanQuery(selected.join(" ")) || FALLBACK_QUERY;
}

export async function fetchStockClip({ scene, query, format, itemId }) {
  if (!stockProvidersAvailable()) {
    throw new Error("PEXELS_API_KEY atau PIXABAY_API_KEY belum dikonfigurasi.");
  }

  await fs.mkdir(paths.clipDir, { recursive: true });
  await fs.mkdir(paths.workDir, { recursive: true });

  const targetDurationSec = Number(scene?.durationSec || 0) || 4;

  let downloadUrl = null;
  let provider = "pexels";
  let usedQuery = query;
  let nativeDurationSec = 0;

  const queries = buildStockQueries(query, scene);

  for (const q of queries) {
    usedQuery = q;
    // 1. Try Pexels first — pick the result whose native duration best
    // covers the scene, so long scenes don't visibly loop a short clip.
    console.log(`Searching Pexels for query: "${q}" (target ${targetDurationSec}s)`);
    const pexelsVideos = await searchPexels(q);
    if (pexelsVideos && pexelsVideos.length) {
      const best = pickBestByDuration(pexelsVideos, targetDurationSec, (v) => v.duration);
      downloadUrl = best ? selectPexelsFile(best, format) : null;
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
      downloadUrl = best ? selectPixabayFile(best, format) : null;
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
  await resizeStockVideo(tempPath, finalPath, format, targetDurationSec);

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

function buildStockQueries(query, scene) {
  const queries = [];
  const add = (value) => {
    const cleaned = cleanQuery(value);
    if (cleaned && !queries.includes(cleaned)) queries.push(cleaned);
  };

  add(query);
  add(fallbackSearchQuery(scene));

  for (const word of cleanQuery(query).split(/\s+/).filter((entry) => entry.length > 2)) {
    add(word);
  }

  // Broad, high-hit B-roll searches keep the pipeline moving when a specific
  // factual topic has no matching stock footage.
  for (const fallback of [
    "documentary",
    "education",
    "science",
    "technology",
    "nature",
    "history",
    "abstract background",
    "learning"
  ]) {
    add(fallback);
  }

  return queries;
}
