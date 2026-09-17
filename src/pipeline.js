import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { config, paths } from "./config.js";
import { estimateTtsUsd, estimateVideoUsd } from "./cost.js";
import { generateElevenLabsSpeech } from "./elevenlabs.js";
import { generateOpenAiSpeech, generateSceneImage, transcribeSpeechSegments } from "./openai.js";
import { generateEdgeTts } from "./modules/edge_tts.js";
import { renderKnowledgeVideo } from "./render.js";
import { generateThumbnail } from "./thumbnail.js";
import { getItem, listContextItems, saveItem } from "./storage.js";
import { createIdeaRecommendations, createKnowledgeDraft, getToneStyleGuidelines } from "./story-engine.js";
import { getPerformanceNotesText } from "./analytics.js";
import { getTrendNotesText } from "./trend-research.js";
import { getTopicDeepResearch } from "./research-scraper.js";
import { nowIso, extractKeywordHighlight } from "./util.js";
import { generateVideoClip } from "./video-provider.js";
import { fetchStockClip, extractSearchQuery, stockProvidersAvailable } from "./stock.js";
import { generateMotionHtml, renderMotionVideo, renderMotionSceneClip, inferMotionTheme } from "./modules/motion-engine.js";


export async function generateFullItem(input = {}, options = {}) {
  const warnings = [];
  let payload = { ...input };
  const existingItems = await listContextItems();

  let trendNotes = "";
  try {
    trendNotes = await getTrendNotesText("ID", payload.category || "random");
  } catch (error) {
    warnings.push(`Trend research dilewati: ${error.message}`);
  }

  if (!payload.selectedIdea) {
    let performanceNotes = "";
    try {
      performanceNotes = await getPerformanceNotesText();
    } catch (error) {
      warnings.push(`Analytics performance notes dilewati: ${error.message}`);
    }
    const ideas = await createIdeaRecommendations({
      seed: payload.topic || "",
      category: payload.category || "random",
      durationSec: payload.durationSec || (payload.longForm ? 480 : 90),
      longForm: Boolean(payload.longForm)
    }, { existingItems, performanceNotes, trendNotes, strictAi: Boolean(options.strictAi) });
    payload = {
      ...payload,
      selectedIdea: ideas.ideas?.[0] || null,
      topic: ideas.ideas?.[0]?.topic || payload.topic || ""
    };
  }

  let researchFacts = "";
  const topicToResearch = payload.topic || payload.selectedIdea?.topic || "";
  if (topicToResearch) {
    try {
      researchFacts = await getTopicDeepResearch(topicToResearch);
    } catch (err) {
      warnings.push(`Riset scraper dilewati: ${err.message}`);
    }
  }

  const item = await createKnowledgeDraft(payload, {
    existingItems,
    researchFacts,
    trendNotes,
    strictAi: Boolean(options.strictAi)
  });
  await saveItem(item);

  const visualSource = item.input.visualSource || "stock";
  const wantsClips = options.withClip !== false;

  if (visualSource === "motion") {
    await ensureAudio(item, { provider: item.input.ttsProvider, warnings, force: true, strict: true });
    await ensureImages(item, { warnings, strict: false });
    await ensureMotionVideo(item, { warnings });
    await ensureThumbnail(item, { warnings });
    return { item, warnings };
  }

  if (visualSource === "interleaved") {
    // Alur Selang-Seling: Audio TTS dibuat dulu agar timing durasi presisi
    await ensureAudio(item, { provider: item.input.ttsProvider, warnings, force: true, strict: true });
    await ensureVisualClips(item, { warnings, strict: false });
    await ensureThumbnail(item, { warnings });
    await renderAndPersist(item);
    return { item, warnings };
  }

  if (wantsClips && visualSource !== "ai") {
    // Cost optimization: try stock footage (Pexels/Pixabay, free/licensed)
    // first. Only pay for AI-generated images on scenes where stock
    // genuinely has no match, instead of generating an AI image for every
    // scene "just in case" and then throwing most of them away.
    await ensureVisualClips(item, { warnings, strict: Boolean(options.requireClip) });
    await ensureImages(item, { warnings, strict: true, onlyMissingClips: true });
  } else {
    await ensureImages(item, { warnings, strict: true });
    if (wantsClips) {
      await ensureVisualClips(item, { warnings, strict: options.requireClip });
    }
  }

  await ensureAudio(item, { provider: item.input.ttsProvider, warnings, force: true, strict: true });
  await ensureThumbnail(item, { warnings });
  await renderAndPersist(item);
  return { item, warnings };
}

export async function requireItem(id) {
  const item = await getItem(id);
  if (!item) {
    const error = new Error("Item tidak ditemukan.");
    error.status = 404;
    throw error;
  }
  return item;
}

export async function ensureProviderClip(item, options = {}) {
  if (!config.video.apiKey) throw new Error("VIDEO_API_KEY / DINOIKI_API_KEY wajib diisi untuk generate cuplikan video.");
  const scenes = item.plan?.scenes || [];
  if (!scenes.length) throw new Error("Storyboard belum tersedia.");
  const requestedIndex = Number(options.sceneIndex);
  const scene = scenes.find((entry) => Number(entry.index) === requestedIndex) || scenes[0];
  const prompt = buildClipPrompt(item, scene);
  const clip = await generateVideoClip({ itemId: item.id, scene, prompt });
  clip.costUsd = estimateVideoUsd(clip.seconds, config.pricing);

  const clips = (item.assets.clips || []).filter((entry) => Number(entry.sceneIndex) !== Number(scene.index));
  clips.push(clip);
  item.assets.clips = sortByScene(clips);
  item.cost.videoUsd = item.assets.clips.reduce((sum, entry) => sum + Number(entry.costUsd || 0), 0);
  updateTotalCost(item);
}

export async function ensureOptionalClip(item, options = {}) {
  if (item.assets?.clips?.length) return;
  const warnings = options.warnings || [];
  try {
    await ensureProviderClip(item, { sceneIndex: item.plan?.scenes?.[0]?.index });
    item.updatedAt = nowIso();
    await saveItem(item);
  } catch (error) {
    warnings.push(`Clip Veo Lite dilewati: ${error.message}`);
  }
}

export async function ensureVisualClips(item, options = {}) {
  const warnings = options.warnings || [];
  const visualSource = item.input.visualSource || "stock";
  const isHorizontal = item.input.videoFormat === "horizontal" || Boolean(item.input.longForm);
  const format = isHorizontal ? "horizontal" : (item.input.videoFormat || "vertical");
  const isInterleaved = visualSource === "interleaved" || visualSource === "hybrid_motion";

  if (!isInterleaved && visualSource !== "ai" && !stockProvidersAvailable()) {
    const message = "Stock video dilewati karena PEXELS_API_KEY dan PIXABAY_API_KEY belum dikonfigurasi.";
    warnings.push(message);
    if (options.strict) throw new Error(message);
    return;
  }

  const clips = [...(item.assets.clips || [])];
  const usedUrls = new Set(clips.map(c => c.downloadUrl || c.url).filter(Boolean));
  
  if (visualSource === "ai") {
    for (const scene of item.plan.scenes) {
      const existing = item.assets.clips?.find(c => Number(c.sceneIndex) === Number(scene.index));
      if (existing?.path) continue;
      
      try {
        console.log(`Generating AI Video clip for scene ${scene.index}...`);
        await ensureProviderClip(item, { sceneIndex: scene.index });
        item.updatedAt = nowIso();
        await saveItem(item);
      } catch (error) {
        const msg = `AI Video gagal untuk scene ${scene.index}: ${error.message}. Mencoba fallback ke stock video...`;
        console.warn(msg);
        try {
          const query = await extractSearchQuery(scene, item.input.topic);
          const clip = await fetchStockClip({ scene, query, format, itemId: item.id, topic: item.input?.topic || item.title, usedUrls });
          if (clip.downloadUrl) usedUrls.add(clip.downloadUrl);
          if (clip.url) usedUrls.add(clip.url);
          const currentClips = [...(item.assets.clips || [])];
          const idx = currentClips.findIndex(c => Number(c.sceneIndex) === Number(scene.index));
          if (idx >= 0) currentClips.splice(idx, 1, clip);
          else currentClips.push(clip);
          item.assets.clips = sortByScene(currentClips);
          item.updatedAt = nowIso();
          await saveItem(item);
        } catch (stockError) {
          const finalMsg = `AI Video gagal dan fallback stock video juga gagal untuk scene ${scene.index}: ${stockError.message}`;
          warnings.push(finalMsg);
          if (options.strict) throw new Error(finalMsg);
        }
      }
    }
    return;
  }
  
  const totalAudioSec = Number(item.assets.audio?.seconds || 0);
  const rawScenes = item.plan?.scenes || [];
  const totalWords = rawScenes.reduce((sum, s) => sum + Math.max(1, String(s.narration || "").split(/\s+/).length), 0);

  for (const scene of rawScenes) {
    const existing = clips.find(c => Number(c.sceneIndex) === Number(scene.index));
    if (existing?.path) continue;

    // Hitung durasi presisi per scene
    const sceneWords = Math.max(1, String(scene.narration || "").split(/\s+/).length);
    const sceneDur = totalAudioSec > 0
      ? Number(((sceneWords / Math.max(1, totalWords)) * totalAudioSec).toFixed(1))
      : Number(scene.durationSec || 6.0);

    // Pada mode interleaved (selang-seling):
    // Scene bernomor genap (2, 4, 6...) atau scene dengan visualType === "motion" dijadikan Bang Motion diagram
    // Scene bernomor ganjil (1, 3, 5...) dijadikan Stock Video
    const wantsMotion = isInterleaved
      ? (Number(scene.index) % 2 === 0 || scene.visualType === "motion")
      : (scene.visualType === "motion");

    if (wantsMotion) {
      try {
        // Jika ada OpenAI API Key dan belum ada gambar untuk scene ini, otomatis generate gambar barunya
        // agar Bang Motion bisa langsung memakai gambar tersebut sebagai ilustrasi utama!
        if (config.openai.apiKey && !item.assets?.images?.some(i => Number(i.sceneIndex) === Number(scene.index))) {
          try {
            await ensureImages(item, { warnings, strict: false, onlySceneIndex: Number(scene.index) });
          } catch (imgErr) {
            console.warn(`Auto-generate image untuk motion scene ${scene.index} dilewati:`, imgErr.message);
          }
        }

        console.log(`[Interleaved] Merender Bang Motion diagram scene ${scene.index} (${sceneDur}s)...`);
        const clip = await renderMotionSceneClip({ item, scene, durationSec: sceneDur, format });
        const idx = clips.findIndex(c => Number(c.sceneIndex) === Number(scene.index));
        if (idx >= 0) clips.splice(idx, 1, clip);
        else clips.push(clip);
        item.assets.clips = sortByScene(clips);
        item.updatedAt = nowIso();
        await saveItem(item);
        continue;
      } catch (motionErr) {
        console.warn(`Bang Motion scene ${scene.index} gagal:`, motionErr.message);
        warnings.push(`Bang Motion scene ${scene.index} gagal: ${motionErr.message}`);
      }
    }

    // Ambil stok video asli
    try {
      const query = await extractSearchQuery(scene, item.input.topic);
      const clip = await fetchStockClip({ scene, query, format, itemId: item.id, topic: item.input?.topic || item.title, usedUrls });
      if (clip.downloadUrl) usedUrls.add(clip.downloadUrl);
      if (clip.url) usedUrls.add(clip.url);
      
      const idx = clips.findIndex(c => Number(c.sceneIndex) === Number(scene.index));
      if (idx >= 0) clips.splice(idx, 1, clip);
      else clips.push(clip);
      
      item.assets.clips = sortByScene(clips);
      item.updatedAt = nowIso();
      await saveItem(item);
    } catch (error) {
      console.error(`Stock clip scene ${scene.index} failed:`, error.message);
      
      if (visualSource === "hybrid") {
        try {
          console.log(`Falling back to AI Video for scene ${scene.index}...`);
          await ensureProviderClip(item, { sceneIndex: scene.index });
          clips.length = 0;
          clips.push(...(item.assets.clips || []));
        } catch (aiError) {
          const msg = `AI Video fallback gagal untuk scene ${scene.index}: ${aiError.message}`;
          warnings.push(msg);
          if (options.strict) throw new Error(msg);
        }
      } else if (isInterleaved || visualSource === "stock") {
        // Fallback cerdas Rp 0: Jika pencarian stock video gagal/habis, buatkan Bang Motion diagram secara otomatis!
        try {
          console.log(`[Fallback Rp 0] Membuat Bang Motion diagram untuk scene ${scene.index} (${sceneDur}s)...`);
          const clip = await renderMotionSceneClip({ item, scene, durationSec: sceneDur, format });
          const idx = clips.findIndex(c => Number(c.sceneIndex) === Number(scene.index));
          if (idx >= 0) clips.splice(idx, 1, clip);
          else clips.push(clip);
          item.assets.clips = sortByScene(clips);
          item.updatedAt = nowIso();
          await saveItem(item);
        } catch (fallbackErr) {
          const msg = `Stock clip gagal dan fallback Bang Motion juga gagal untuk scene ${scene.index}: ${fallbackErr.message}`;
          warnings.push(msg);
          if (options.strict) throw new Error(msg);
        }
      } else {
        const msg = `Stock clip gagal untuk scene ${scene.index}: ${error.message}`;
        warnings.push(msg);
        if (options.strict) throw new Error(msg);
      }
    }
  }
  
  item.assets.clips = sortByScene(clips);
  item.updatedAt = nowIso();
  await saveItem(item);
  item.cost.videoUsd = item.assets.clips.reduce((sum, entry) => sum + Number(entry.costUsd || 0), 0);
}

export async function ensureImages(item, options = {}) {
  if (!config.openai.apiKey) throw new Error("OPENAI_API_KEY wajib diisi untuk generate gambar.");
  const warnings = options.warnings || [];
  const images = [...(item.assets.images || [])];
  const size = item.input.imageSize || config.openai.imageSize;
  const quality = item.input.imageQuality || config.openai.imageQuality;

  const clipSceneIndexes = new Set((item.assets.clips || []).map((clip) => Number(clip.sceneIndex)));
  let scenesToProcess = options.onlyMissingClips
    ? item.plan.scenes.filter((scene) => !clipSceneIndexes.has(Number(scene.index)))
    : item.plan.scenes;
  if (options.onlySceneIndex !== undefined) {
    scenesToProcess = scenesToProcess.filter((scene) => Number(scene.index) === Number(options.onlySceneIndex));
  }

  for (const scene of scenesToProcess) {
    const existing = images.find((image) => Number(image.sceneIndex) === Number(scene.index));
    if (existing?.path) continue;
    try {
      const image = await generateImageWithRetry({ item, scene, size, quality });
      const index = images.findIndex((entry) => Number(entry.sceneIndex) === Number(scene.index));
      if (index >= 0) images.splice(index, 1, image);
      else images.push(image);
      item.assets.images = sortByScene(images);
      item.updatedAt = nowIso();
      await saveItem(item);
    } catch (error) {
      const message = `Gambar scene ${scene.index} gagal: ${error.message}`;
      if (options.strict) throw new Error(message);
      warnings.push(message);
    }
  }

  item.assets.images = sortByScene(images);
}

export async function ensureAudio(item, options = {}) {
  const hasWarningSink = Array.isArray(options.warnings);
  const warnings = options.warnings || [];
  let provider = String(options.provider || item.input.ttsProvider || "openai").toLowerCase();
  if (!["elevenlabs", "openai", "edge_tts"].includes(provider)) {
    provider = "openai";
  }
  if (item.assets.audio?.path && !options.force && item.assets.audio.provider === provider) return;

  try {
    const text = narrationText(item);

    // Auto-align voice with the Capybara avatar vibe if not customized
    let voice = item.input.openaiTtsVoice;
    let elevenlabsVoiceId = item.input.elevenlabsVoiceId;
    let edgeTtsVoice = item.input.edgeTtsVoice || config.openai.edgeTtsVoice || "id-ID-ArdiNeural";
    const avatarMode = String(item.input.avatarMode || "").toLowerCase();
    const isCapybara = avatarMode.includes("hijau") || avatarMode.includes("green") || 
                       avatarMode.includes("video") || avatarMode.includes("hitam");
    if (isCapybara) {
      if (!voice || voice === "shimmer") {
        voice = "onyx"; // Deep, professional, warm male voice fits the capybara perfectly
      }
      if (!elevenlabsVoiceId) {
        elevenlabsVoiceId = "pNInz6obpgfrhhF21cjL"; // Adam (Deep Male)
      }
    }

    const catStyle = getToneStyleGuidelines(item.input.tone, item.input.category);
    const instructions = `Bacakan sebagai narator dokumenter Indonesia dengan suara pria dewasa yang tenang, berwibawa, cerdas, dan tepercaya. Gunakan tempo sedang dan aksen Indonesia netral (tidak robotik, tidak dramatis, tidak seperti iklan). Gaya: ${catStyle.style}. Tone: ${catStyle.tone}. Aturan tambahan: ${catStyle.rules}. Jangan terburu-buru, jangan berteriak, jangan terdengar heboh seperti influencer YouTube, hindari emosi berlebih.`;

    if (provider === "elevenlabs") {
      item.assets.audio = await generateElevenLabsSpeech({
        itemId: item.id,
        text,
        voiceId: elevenlabsVoiceId,
        modelId: item.input.elevenlabsModel,
        filenameSuffix: "elevenlabs-natural"
      });
    } else if (provider === "edge_tts") {
      const audioFilename = `${item.id}-edge-tts-natural.mp3`;
      const audioPath = path.join(paths.audioDir, audioFilename);
      const audioUrl = `/generated/audio/${audioFilename}`;
      await fs.mkdir(paths.audioDir, { recursive: true });
      await generateEdgeTts({ text, voiceId: edgeTtsVoice, outputPath: audioPath });
      item.assets.audio = {
        provider: "edge_tts",
        model: "edge-tts-cli",
        voice: edgeTtsVoice,
        path: audioPath,
        url: audioUrl
      };
    } else {
      item.assets.audio = await generateOpenAiSpeech({
        itemId: item.id,
        text,
        voice,
        filenameSuffix: "openai-natural",
        instructions
      });
    }

    item.assets.audio.characters = text.length;
    try {
      item.assets.captions = await transcribeSpeechSegments(item.assets.audio.path);
    } catch (error) {
      warnings.push(`Transkripsi subtitle gagal: ${error.message}`);
      item.assets.captions = [];
    }
    item.input.ttsProvider = provider;
    item.cost.ttsUsd = estimateTtsUsd(text.length, provider, config.pricing);
    updateTotalCost(item);
    item.updatedAt = nowIso();
    await saveItem(item);
  } catch (error) {
    if (options.strict) throw error;
    warnings.push(`TTS gagal: ${error.message}`);
    if (!hasWarningSink) throw error;
  }
}

export async function ensureThumbnail(item, options = {}) {
  if (item.assets.thumbnail?.path) return;
  const warnings = options.warnings || [];
  try {
    item.assets.thumbnail = await generateThumbnail(item);
    item.updatedAt = nowIso();
    await saveItem(item);
  } catch (error) {
    warnings.push(`Thumbnail gagal: ${error.message}`);
  }
}

export async function ensureMotionVideo(item, options = {}) {
  const warnings = options.warnings || [];
  const durationSec = Number(item.assets.audio?.seconds || item.input.durationSec || 60);
  const isVertical = String(item.input.videoFormat || "").toLowerCase() !== "horizontal";
  const width = isVertical ? 1080 : 1920;
  const height = isVertical ? 1920 : 1080;

  const rawScenes = item.plan?.scenes || [];
  const perSceneDur = Number((durationSec / Math.max(1, rawScenes.length)).toFixed(1));

  const scenes = rawScenes.map((s, idx) => {
    const sceneImg = item.assets?.images?.find((img) => Number(img.sceneIndex) === Number(s.index || idx + 1));
    return {
      text: s.narration || s.screenText || "",
      kicker: s.screenText || `POIN #${idx + 1}`,
      highlight: s.highlight || extractKeywordHighlight(s.narration || s.text, s.screenText) || "",
      sourceTag: item.title?.slice(0, 30) || "BANYAKTAU",
      note: s.imagePrompt ? s.imagePrompt.split(",")[0].trim() : "Fakta Kunci",
      ghost: s.year ? String(s.year) : String(idx + 1).padStart(2, "0"),
      durationSec: perSceneDur,
      imagePath: sceneImg?.path || s.imagePath || null,
      illustration: s.illustration
    };
  });

  const theme = item.input?.motionTheme || inferMotionTheme(rawScenes[0], item);

  const { html } = generateMotionHtml({
    title: item.title,
    format: isVertical ? "vertical" : "horizontal",
    theme,
    totalDurationSec: durationSec,
    voiceoverPath: item.assets.audio?.path || null,
    scenes
  });

  const outputPath = path.join(paths.videoDir, `${item.id}-motion.mp4`);
  const result = await renderMotionVideo({
    htmlContent: html,
    audioPath: item.assets.audio?.path || null,
    outputPath,
    width,
    height,
    fps: 30
  });

  item.assets.video = {
    path: outputPath,
    filename: path.basename(outputPath),
    seconds: result.durationSec,
    width,
    height,
    provider: "bang-motion",
    format: isVertical ? "vertical" : "horizontal"
  };
  item.status = "rendered";
  item.updatedAt = nowIso();
  await saveItem(item);
  return item;
}

export async function renderAndPersist(item) {
  assertReadyToRender(item);
  item.assets.video = await renderKnowledgeVideo(item);
  item.status = "rendered";
  item.updatedAt = nowIso();
  await saveItem(item);
  return item;
}

export function assertReadyToRender(item) {
  const images = item.assets.images || [];
  const clips = item.assets.clips || [];
  const missingVisualScenes = (item.plan.scenes || []).filter((scene) => {
    const sceneIndex = Number(scene.index);
    return !clips.some((clip) => Number(clip.sceneIndex) === sceneIndex && clip.path)
      && !images.some((image) => Number(image.sceneIndex) === sceneIndex && image.path);
  });
  if (missingVisualScenes.length) {
    const error = new Error("Visual belum lengkap. Generate stock clip atau gambar dulu sampai semua scene siap.");
    error.status = 409;
    throw error;
  }
  if (!item.assets.audio?.path) {
    const error = new Error("Audio TTS belum tersedia. Pilih provider TTS lalu generate suara.");
    error.status = 409;
    throw error;
  }
}

export function ffmpegAvailable() {
  const ffmpeg = spawnSync("ffmpeg", ["-version"], { encoding: "utf8", windowsHide: true });
  return ffmpeg.status === 0;
}

function buildClipPrompt(item, scene) {
  const visualConcept = scene.imagePrompt
    ? scene.imagePrompt.split(",").slice(0, 3).join(",").trim()
    : "";
  return [
    `Topic: ${item.input?.topic || item.title}.`,
    `Scene: ${scene.screenText}.`,
    `Narration: ${scene.narration}.`,
    visualConcept ? `Visual concept for this scene: ${visualConcept}.` : "",
    "Create a short vertical educational B-roll clip that directly supports this scene.",
    "Use realistic, clean, bright documentary style with one clear subject and smooth motion.",
    "Do not include written text, subtitles, logos, watermarks, gore, injuries, or a recognizable public figure."
  ].filter(Boolean).join(" ");
}

async function generateImageWithRetry({ item, scene, size, quality }) {
  const theme = item.input?.motionTheme || scene.visualStyle || inferMotionTheme(scene, item);
  try {
    return await generateSceneImage({ itemId: item.id, scene, size, quality, theme });
  } catch (error) {
    const safeScene = {
      ...scene,
      imagePrompt: [
        `safe educational illustration about ${item.input.topic}`,
        `scene focus: ${scene.screenText}`,
        "objects, hands, classroom table, museum display, science concept, no people in danger, no medical procedure, no text"
      ].join(", ")
    };
    const image = await generateSceneImage({ itemId: item.id, scene: safeScene, size, quality, theme });
    image.recoveredFrom = error.message;
    return image;
  }
}

function narrationText(item) {
  const text = item.plan.scenes
    .map((scene) => String(scene.narration || "").trim())
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
  if (text && !/[.!?]$/.test(text)) {
    return text + ".";
  }
  return text;
}

function updateTotalCost(item) {
  item.cost.totalUsd = Number((
    Number(item.cost.storyUsd || 0)
    + Number(item.cost.imageUsd || 0)
    + Number(item.cost.ttsUsd || 0)
    + Number(item.cost.videoUsd || 0)
  ).toFixed(5));
}

function sortByScene(items) {
  return [...items].sort((a, b) => Number(a.sceneIndex || 0) - Number(b.sceneIndex || 0));
}
