import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { config, paths } from "./config.js";
import { requestTextCompletion } from "./openai.js";
import { searchWikimediaCommons } from "./research-scraper.js";

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
  ["dokumen", "document"],
  ["sendok", "spoon"],
  ["garpu", "fork"],
  ["pisau", "knife"],
  ["piring", "plate"],
  ["makan", "eating"],
  ["dapur", "kitchen"],
  ["alat", "cutlery"],
  ["baja", "steel spoon"],
  ["besi", "iron"],
  ["emas", "gold"],
  ["perak", "silver"],
  ["kaca", "glass"],
  ["kertas", "paper"],
  ["baterai", "battery"],
  ["ban", "tire"],
  ["roda", "wheel"],
  ["kapal", "ship"],
  ["pesawat", "airplane"],
  ["mobil", "car"],
  ["es", "ice"],
  ["madu", "honey"],
  ["roti", "bread"],
  ["gula", "sugar"],
  ["kopi", "coffee"],
  ["gigi", "teeth"],
  ["hewan", "animal"],
  ["kucing", "cat"],
  ["anjing", "dog"],
  ["ular", "snake"],
  ["burung", "bird"],
  ["ikan", "fish"],
  ["paus", "whale"],
  ["gurita", "octopus"],
  ["meletus", "volcano eruption"],
  ["letusan", "volcano eruption"],
  ["erupsi", "volcano eruption"],
  ["gempa", "earthquake"],
  ["banjir", "flood"],
  ["tsunami", "tsunami"],
  ["longsor", "landslide"],
  ["badai", "storm"],
  ["petir", "lightning"],
  ["lava", "lava volcano"],
  ["lahar", "volcano mudflow"],
  ["sesar", "fault line"],
  ["lempeng", "tectonic plates"]
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

async function imageToVideoClip(inputPath, outputPath, format, durationSec) {
  const isHorizontal = format === "horizontal";
  const scaleFilter = isHorizontal
    ? "scale=1920:1080:force_original_aspect_ratio=increase,crop=1920:1080,format=yuv420p"
    : "scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,format=yuv420p";

  await runFfmpeg([
    "-y",
    "-loop", "1",
    "-i", inputPath,
    "-t", Number(durationSec || 4).toFixed(2),
    "-vf", scaleFilter,
    "-c:v", "libx264",
    "-preset", "veryfast",
    "-crf", "23",
    "-pix_fmt", "yuv420p",
    "-an",
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

async function searchPexels(query, { perPage = 18, orientation = "" } = {}) {
  const apiKey = config.stock?.pexelsApiKey;
  if (!apiKey) return null;
  const orientParam = orientation ? `&orientation=${orientation}` : "";
  const url = `https://api.pexels.com/videos/search?query=${encodeURIComponent(query)}&per_page=${perPage}${orientParam}`;
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

const BARE_MATERIALS = new Set([
  "stainless steel", "stainless", "steel", "metal", "iron", "gold", "silver",
  "plastic", "glass", "rubber", "leather", "wooden", "wood", "aluminum",
  "copper", "ceramic", "bronze", "liquid", "chemical", "durability", "material"
]);

function extractSubjectNoun(scene, topic = "") {
  const combined = `${topic} ${scene?.screenText || ""} ${scene?.narration || ""}`.toLowerCase();
  if (/sendok|spoon/i.test(combined)) return "spoon";
  if (/garpu|fork/i.test(combined)) return "fork";
  if (/pisau|knife/i.test(combined)) return "knife";
  if (/piring|plate/i.test(combined)) return "plate";
  if (/makan|eating|dining/i.test(combined)) return "eating";
  if (/dapur|kitchen/i.test(combined)) return "kitchen";
  if (/baterai|battery/i.test(combined)) return "battery";
  if (/ban\b|tire/i.test(combined)) return "tire";
  if (/kapal|ship/i.test(combined)) return "ship";
  if (/pesawat|airplane|plane/i.test(combined)) return "airplane";
  if (/madu|honey/i.test(combined)) return "honey";
  if (/roti|bread/i.test(combined)) return "bread";
  if (/gula|sugar/i.test(combined)) return "sugar";
  if (/kopi|coffee/i.test(combined)) return "coffee";
  if (/kertas|paper/i.test(combined)) return "paper";
  if (/kucing|cat\b/i.test(combined)) return "cat";
  if (/ular|snake/i.test(combined)) return "snake";
  if (/paus|whale/i.test(combined)) return "whale";
  if (/burung|bird/i.test(combined)) return "bird";
  if (/ikan|fish/i.test(combined)) return "fish";
  if (/es\b|ice\b/i.test(combined)) return "ice";
  if (/gigi|tooth|teeth/i.test(combined)) return "teeth";
  if (/darah|blood/i.test(combined)) return "blood";
  if (/otak|brain/i.test(combined)) return "brain";
  if (/jantung|heart/i.test(combined)) return "heart";
  if (/tulang|bone/i.test(combined)) return "bone";
  if (/mata\b|eye\b/i.test(combined)) return "eye";
  if (/mobil|car\b/i.test(combined)) return "car";
  if (/kereta|train/i.test(combined)) return "train";
  if (/pabrik|factory|manufaktur|manufacturing|forge/i.test(combined)) return "factory";
  if (/api\b|fire\b/i.test(combined)) return "fire";
  if (/air\b|water\b/i.test(combined)) return "water";
  if (/gunung meletus|volcano|erupsi|eruption|lahar|lava|magma/i.test(combined)) return "volcano";
  if (/gempa|earthquake|seismic|sesar|lempeng/i.test(combined)) return "earthquake";
  if (/banjir|flood/i.test(combined)) return "flood";
  if (/tsunami/i.test(combined)) return "tsunami";
  if (/longsor|landslide/i.test(combined)) return "landslide";
  if (/badai|storm|topan|tornado|hurricane/i.test(combined)) return "storm";
  if (/petir|lightning|kilat/i.test(combined)) return "lightning";
  return "";
}

function ensureConcreteSubject(query, scene, topic = "") {
  const q = cleanQuery(query).toLowerCase();
  if (BARE_MATERIALS.has(q) || q.split(/\s+/).every((w) => BARE_MATERIALS.has(w))) {
    const noun = extractSubjectNoun(scene, topic);
    if (noun && !q.includes(noun)) {
      return `${q} ${noun}`;
    }
  }
  return query;
}

function isMisleadingCandidate(candidate, scene, topic = "") {
  const urlSlug = String(candidate.url || "").toLowerCase();
  const tags = Array.isArray(candidate.tags)
    ? candidate.tags.map((t) => String(t.name || t).toLowerCase()).join(" ")
    : "";
  const combined = `${urlSlug} ${tags}`;
  const tokenSet = new Set(combined.split(/[^a-z0-9]+/));

  const textContext = `${topic} ${scene?.narration || ""} ${scene?.screenText || ""}`;

  // 1. Cutlery / Food / Kitchen
  const isCutlery = /spoon|sendok|garpu|fork|pisau|knife|cutlery|kitchen|makan|food|dining|dapur/i.test(textContext);
  if (isCutlery) {
    const forbidden = ["watch", "wristwatch", "clock", "jewelry", "necklace", "bracelet", "ring", "earring", "smartwatch", "timepiece", "tumbler", "perfume", "motorcycle", "highway", "car", "automobile"];
    if (forbidden.some((w) => tokenSet.has(w))) {
      console.warn(`[Stock Filter] Video ditolak (mismatch objek): "${urlSlug}" mengandung jam/perhiasan/kendaraan untuk topik alat makan/sendok!`);
      return true;
    }
  }

  // 2. Animals / Nature
  const isAnimal = /hewan|animal|kucing|cat|ular|snake|paus|whale|burung|bird|ikan|fish|gurita|octopus|satwa/i.test(textContext);
  if (isAnimal) {
    const forbidden = ["office", "laptop", "computer", "smartphone", "skyscraper", "cryptocurrency", "coding", "business", "meeting", "desk", "watch", "jewelry"];
    if (forbidden.some((w) => tokenSet.has(w))) {
      console.warn(`[Stock Filter] Video ditolak (mismatch objek): "${urlSlug}" mengandung gadget/kantor untuk topik hewan.`);
      return true;
    }
  }

  // 3. Astronomy / Space
  const isSpace = /space|angkasa|planet|bintang|star|lubang hitam|black hole|galaxy|galaksi|bulan|moon|astronomy|nebula/i.test(textContext);
  if (isSpace) {
    const forbidden = ["underwater", "submarine", "coral", "aquarium", "swimming", "traffic"];
    if (forbidden.some((w) => tokenSet.has(w))) {
      return true;
    }
  }

  // 4. Human Anatomy / Biology / Health
  const isBiology = /darah|blood|otak|brain|jantung|heart|tulang|bone|organ|sel\b|cell\b|medis|biology/i.test(textContext);
  if (isBiology) {
    const forbidden = ["automobile", "car", "traffic", "jewelry", "fashion", "party", "nightclub", "motorcycle", "watch"];
    if (forbidden.some((w) => tokenSet.has(w))) {
      console.warn(`[Stock Filter] Video ditolak (mismatch objek): "${urlSlug}" tidak relevan untuk biologi/anatomi.`);
      return true;
    }
  }

  // 5. Natural Disaster / Extreme Weather / Geology
  const isDisaster = /gunung meletus|volcano|erupsi|gempa|earthquake|banjir|flood|tsunami|longsor|landslide|badai|storm|topan|bencana/i.test(textContext);
  if (isDisaster) {
    const forbidden = ["office", "laptop", "cryptocurrency", "coding", "fashion", "model", "shopping", "makeup", "party", "nightclub", "perfume", "lipstick", "jewelry", "cocktail", "restaurant", "spoon", "fork"];
    if (forbidden.some((w) => tokenSet.has(w))) {
      console.warn(`[Stock Filter] Video ditolak (mismatch objek): "${urlSlug}" tidak relevan untuk fenomena/bencana alam.`);
      return true;
    }
  }

  return false;
}

function pickBestCandidate(candidates, targetDurationSec, getDuration, scene, topic = "", usedUrls = new Set()) {
  if (!candidates.length) return null;
  const valid = candidates.filter((c) => !isMisleadingCandidate(c, scene, topic));
  if (!valid.length) {
    console.warn(`[Stock] Semua ${candidates.length} kandidat video ditolak karena tidak relevan secara semantik dengan script.`);
    return null;
  }

  const subjectNoun = extractSubjectNoun(scene, topic);
  const scored = valid.map((item) => {
    const urlSlug = String(item.url || "").toLowerCase();
    const tags = Array.isArray(item.tags)
      ? item.tags.map((t) => String(t.name || t).toLowerCase()).join(" ")
      : "";
    const combined = `${urlSlug} ${tags}`;
    const tokenSet = new Set(combined.split(/[^a-z0-9]+/));
    let score = 0;

    if (subjectNoun && tokenSet.has(subjectNoun.toLowerCase())) {
      score += 1000; // Strong match with exact subject noun
    }

    // Deprioritize already used clips across scenes (crucial for long-form video with 15-40 scenes)
    const itemUrl = String(item.url || "");
    if (itemUrl && (usedUrls.has(itemUrl) || Array.from(usedUrls).some(u => itemUrl.includes(u) || u.includes(itemUrl)))) {
      score -= 5000;
    }

    const duration = Number(getDuration(item) || 0);
    if (duration >= targetDurationSec) {
      score += 200 - Math.min(100, (duration - targetDurationSec) * 2);
    } else {
      score += duration * 5;
    }

    return { item, score };
  });

  scored.sort((a, b) => b.score - a.score);
  return scored[0]?.item || valid[0];
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

export async function extractSearchQuery(scene, topic) {
  const plannedQuery = cleanQuery(scene?.stockQuery);
  if (plannedQuery) return plannedQuery;

  const systemPrompt = "You are a professional video editor. Generate exactly ONE search query in English (maximum 3 words) to search for relevant B-roll stock footage. The query must directly represent the specific VISUAL CONTENT of the scene narration, NOT the general video topic. Output ONLY the search query, no quotes, no explanations.";
  const userPrompt = `Video topic: ${topic || ""}\nScene narration: ${scene.narration}\nScreen text: ${scene.screenText}\nGenerate a specific visual search query for THIS scene (not the general topic):`;
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

export async function fetchStockClip({ scene, query, format, itemId, topic = "", usedUrls = new Set() }) {
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
  let isArchiveImage = false;

  const queries = buildStockQueries(query, scene, topic);
  const desiredOrientation = format === "horizontal" ? "landscape" : "portrait";

  for (const q of queries) {
    usedQuery = q;
    // 1. Try Pexels first — strictly filter candidate videos and match target orientation
    console.log(`Searching Pexels for query: "${q}" (target ${targetDurationSec}s, orientation: ${desiredOrientation})`);
    let pexelsVideos = await searchPexels(q, { orientation: desiredOrientation });
    if (!pexelsVideos || !pexelsVideos.length) {
      pexelsVideos = await searchPexels(q); // fallback unconstrained
    }

    if (pexelsVideos && pexelsVideos.length) {
      const best = pickBestCandidate(pexelsVideos, targetDurationSec, (v) => v.duration, scene, topic, usedUrls);
      downloadUrl = best ? selectPexelsFile(best, format) : null;
      if (downloadUrl) {
        provider = "pexels";
        nativeDurationSec = Number(best.duration || 0);
        break;
      }
    }

    // 2. Try Pixabay with strict candidate relevance check
    console.log(`Searching Pixabay for query: "${q}" (target ${targetDurationSec}s)`);
    const pixabayHits = await searchPixabay(q);
    if (pixabayHits && pixabayHits.length) {
      const best = pickBestCandidate(pixabayHits, targetDurationSec, (v) => v.duration, scene, topic, usedUrls);
      downloadUrl = best ? selectPixabayFile(best, format) : null;
      if (downloadUrl) {
        provider = "pixabay";
        nativeDurationSec = Number(best.duration || 0);
        break;
      }
    }

    // 3. Try Wikimedia Commons if no stock video passed strict checks
    console.log(`Searching Wikimedia Commons archive image for query: "${q}"`);
    try {
      const commonsHits = await searchWikimediaCommons(q, 5);
      if (commonsHits && commonsHits.length) {
        const validCommons = commonsHits.filter((c) => !isMisleadingCandidate(c, scene, topic));
        if (validCommons.length) {
          downloadUrl = validCommons[0].url;
          provider = "wikimedia";
          isArchiveImage = true;
          nativeDurationSec = targetDurationSec;
          break;
        }
      }
    } catch {
      // Ignore commons search failure and try next query
    }
  }

  if (!downloadUrl) {
    throw new Error(`Tidak menemukan stock video maupun foto arsip yang relevan secara ketat untuk "${query}" di Pexels, Pixabay, dan Wikimedia Commons.`);
  }

  const tempFilename = `temp-raw-stock-${itemId}-${scene.index}${isArchiveImage ? ".jpg" : ".mp4"}`;
  const tempPath = path.join(paths.workDir, tempFilename);
  const finalFilename = `${itemId}-scene-${scene.index}-stock.mp4`;
  const finalPath = path.join(paths.clipDir, finalFilename);

  if (isArchiveImage) {
    console.log(`Downloading archive image from Wikimedia Commons: ${downloadUrl}`);
    await downloadFile(downloadUrl, tempPath);
    console.log(`Converting archive image to ${format} video clip...`);
    await imageToVideoClip(tempPath, finalPath, format, targetDurationSec);
  } else {
    console.log(`Downloading stock video from: ${downloadUrl} (native ~${nativeDurationSec}s, need ${targetDurationSec}s)`);
    await downloadFile(downloadUrl, tempPath);
    console.log(`Resizing and cropping stock video into ${format} format...`);
    await resizeStockVideo(tempPath, finalPath, format, targetDurationSec);
  }

  // Clean up raw temp file
  try {
    await fs.unlink(tempPath);
  } catch (err) {
    console.error("Could not delete temp raw clip:", err);
  }

  if (nativeDurationSec > 0 && nativeDurationSec < targetDurationSec) {
    console.warn(`[Stock] Clip scene ${scene.index}: native duration ${nativeDurationSec}s < target ${targetDurationSec}s — akan di-loop mulus oleh renderer.`);
  }

  return {
    sceneIndex: scene.index,
    provider,
    model: "stock-footage",
    path: finalPath,
    url: `/generated/clips/${finalFilename}`,
    downloadUrl: downloadUrl || "",
    prompt: usedQuery,
    seconds: nativeDurationSec || targetDurationSec,
    targetDurationSec,
    aspectRatio: format === "horizontal" ? "16:9" : "9:16",
    resolution: "720p"
  };
}

function buildStockQueries(query, scene, topic = "") {
  const queries = [];
  const add = (value) => {
    const cleaned = cleanQuery(value);
    if (cleaned && !queries.includes(cleaned)) queries.push(cleaned);
  };

  // 1. Primary: concrete query with physical object noun
  const concreteQuery = ensureConcreteSubject(query, scene, topic);
  add(concreteQuery);
  add(query);

  // 2. Derived from imagePrompt — usually contains specific visual nouns
  if (scene?.imagePrompt) {
    const promptWords = scene.imagePrompt
      .split(",")
      .slice(0, 2)
      .map((part) => cleanQuery(part.trim()))
      .filter(Boolean);
    for (const w of promptWords) {
      add(ensureConcreteSubject(w, scene, topic));
    }
  }

  // 3. Offline fallback from narration/screenText (translated to English)
  add(fallbackSearchQuery(scene));

  // 4. Topic-anchored concrete queries (NEVER raw single-word materials like "stainless" or "steel"!)
  const subjectNoun = extractSubjectNoun(scene, topic);
  if (subjectNoun) {
    add(subjectNoun);
    add(`${subjectNoun} close up`);
  }

  return queries;
}
