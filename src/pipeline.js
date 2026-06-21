import { spawnSync } from "node:child_process";
import { config } from "./config.js";
import { estimateTtsUsd, estimateVideoUsd } from "./cost.js";
import { generateElevenLabsSpeech } from "./elevenlabs.js";
import { generateOpenAiSpeech, generateSceneImage, transcribeSpeechSegments } from "./openai.js";
import { renderKnowledgeVideo } from "./render.js";
import { generateThumbnail } from "./thumbnail.js";
import { getItem, listContextItems, saveItem } from "./storage.js";
import { createIdeaRecommendations, createKnowledgeDraft } from "./story-engine.js";
import { nowIso } from "./util.js";
import { generateVideoClip } from "./video-provider.js";
import { fetchStockClip, extractSearchQuery } from "./stock.js";


export async function generateFullItem(input = {}, options = {}) {
  const warnings = [];
  let payload = { ...input };
  const existingItems = await listContextItems();
  if (!payload.selectedIdea) {
    const ideas = await createIdeaRecommendations({
      seed: payload.topic || "",
      category: payload.category || "random",
      durationSec: payload.durationSec || 90
    }, { existingItems });
    payload = {
      ...payload,
      selectedIdea: ideas.ideas?.[0] || null,
      topic: ideas.ideas?.[0]?.topic || payload.topic || ""
    };
  }

  const item = await createKnowledgeDraft(payload, { existingItems });
  await saveItem(item);
  await ensureImages(item, { warnings, strict: true });
  await ensureAudio(item, { provider: item.input.ttsProvider, warnings, force: true, strict: true });
  await ensureThumbnail(item, { warnings });
  if (options.withClip !== false) {
    await ensureVisualClips(item, { warnings, strict: options.requireClip });
  }
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
  const format = item.input.videoFormat || "vertical";
  
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
          const query = await extractSearchQuery(scene);
          const clip = await fetchStockClip({ scene, query, format, itemId: item.id });
          const clips = [...(item.assets.clips || [])];
          const idx = clips.findIndex(c => Number(c.sceneIndex) === Number(scene.index));
          if (idx >= 0) clips.splice(idx, 1, clip);
          else clips.push(clip);
          item.assets.clips = sortByScene(clips);
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
  
  const clips = [...(item.assets.clips || [])];
  
  for (const scene of item.plan.scenes) {
    const existing = clips.find(c => Number(c.sceneIndex) === Number(scene.index));
    if (existing?.path) continue;
    
    try {
      const query = await extractSearchQuery(scene);
      const clip = await fetchStockClip({ scene, query, format, itemId: item.id });
      
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

  for (const scene of item.plan.scenes) {
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
  const provider = String(options.provider || item.input.ttsProvider || "openai").toLowerCase() === "elevenlabs" ? "elevenlabs" : "openai";
  if (item.assets.audio?.path && !options.force && item.assets.audio.provider === provider) return;

  try {
    const text = narrationText(item);

    // Auto-align voice with the Capybara avatar vibe if not customized
    let voice = item.input.openaiTtsVoice;
    let elevenlabsVoiceId = item.input.elevenlabsVoiceId;
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

    item.assets.audio = provider === "elevenlabs"
      ? await generateElevenLabsSpeech({
          itemId: item.id,
          text,
          voiceId: elevenlabsVoiceId,
          modelId: item.input.elevenlabsModel,
          filenameSuffix: "elevenlabs-natural"
        })
      : await generateOpenAiSpeech({
          itemId: item.id,
          text,
          voice,
          filenameSuffix: "openai-natural"
        });
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

export async function renderAndPersist(item) {
  assertReadyToRender(item);
  item.assets.video = await renderKnowledgeVideo(item);
  item.status = "rendered";
  item.updatedAt = nowIso();
  await saveItem(item);
  return item;
}

export function assertReadyToRender(item) {
  const imageCount = item.assets.images?.length || 0;
  if (imageCount < item.plan.scenes.length) {
    const error = new Error("Gambar belum lengkap. Generate gambar dulu sampai semua scene siap.");
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
  return [
    `Topic: ${item.input?.topic || item.title}.`,
    `Scene: ${scene.screenText}.`,
    `Narration meaning: ${scene.narration}.`,
    "Create a short vertical educational B-roll clip that directly supports this scene.",
    "Use realistic, clean, bright documentary style with one clear subject and smooth motion.",
    "Do not include written text, subtitles, logos, watermarks, gore, injuries, or a recognizable public figure."
  ].join(" ");
}

async function generateImageWithRetry({ item, scene, size, quality }) {
  try {
    return await generateSceneImage({ itemId: item.id, scene, size, quality });
  } catch (error) {
    const safeScene = {
      ...scene,
      imagePrompt: [
        `safe educational illustration about ${item.input.topic}`,
        `scene focus: ${scene.screenText}`,
        "objects, hands, classroom table, museum display, science concept, no people in danger, no medical procedure, no text"
      ].join(", ")
    };
    const image = await generateSceneImage({ itemId: item.id, scene: safeScene, size, quality });
    image.recoveredFrom = error.message;
    return image;
  }
}

function narrationText(item) {
  return item.plan.scenes
    .map((scene) => String(scene.narration || "").trim())
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
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
