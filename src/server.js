import express from "express";
import { spawnSync } from "node:child_process";
import { config, ensureProjectDirs, paths, publicConfig, updateRuntimeSettings } from "./config.js";
import { estimateTtsUsd, estimateVideoUsd } from "./cost.js";
import { generateElevenLabsSpeech } from "./elevenlabs.js";
import { generateOpenAiSpeech, generateSceneImage } from "./openai.js";
import { renderKnowledgeVideo } from "./render.js";
import { getItem, listItems, saveItem } from "./storage.js";
import { createIdeaRecommendations, createKnowledgeDraft } from "./story-engine.js";
import { nowIso } from "./util.js";
import { generateVideoClip } from "./video-provider.js";

ensureProjectDirs();

const app = express();
app.use(express.json({ limit: "2mb" }));
app.use(express.static(paths.publicDir));
app.use("/generated", express.static(paths.generatedDir));

app.get("/api/health", (_req, res) => {
  const ffmpeg = spawnSync("ffmpeg", ["-version"], { encoding: "utf8", windowsHide: true });
  res.json({
    ok: true,
    config: publicConfig(),
    tools: {
      ffmpeg: ffmpeg.status === 0
    }
  });
});

app.get("/api/items", async (_req, res, next) => {
  try {
    res.json({ items: await listItems() });
  } catch (error) {
    next(error);
  }
});

app.post("/api/ideas", async (req, res, next) => {
  try {
    const ideas = await createIdeaRecommendations(req.body || {}, { existingItems: await listItems() });
    res.json(ideas);
  } catch (error) {
    next(error);
  }
});

app.post("/api/settings", async (req, res, next) => {
  try {
    const nextConfig = await updateRuntimeSettings(req.body || {});
    res.json({ config: nextConfig });
  } catch (error) {
    next(error);
  }
});

app.get("/api/items/:id", async (req, res, next) => {
  try {
    const item = await getItem(req.params.id);
    if (!item) return res.status(404).json({ error: "Item tidak ditemukan." });
    res.json({ item });
  } catch (error) {
    next(error);
  }
});

app.post("/api/items", async (req, res, next) => {
  try {
    const item = await createKnowledgeDraft(req.body || {}, { existingItems: await listItems() });
    await saveItem(item);
    res.json({ item });
  } catch (error) {
    next(error);
  }
});

app.post("/api/items/full", async (req, res, next) => {
  try {
    const warnings = [];
    const item = await createKnowledgeDraft(req.body || {}, { existingItems: await listItems() });
    await saveItem(item);
    await ensureImages(item, { warnings, strict: true });
    await ensureAudio(item, { provider: item.input.ttsProvider, warnings, force: true });
    await renderAndPersist(item);
    res.json({ item, warnings });
  } catch (error) {
    next(error);
  }
});

app.post("/api/items/:id/images", async (req, res, next) => {
  try {
    const item = await requireItem(req.params.id);
    await ensureImages(item, { strict: true });
    item.updatedAt = nowIso();
    await saveItem(item);
    res.json({ item });
  } catch (error) {
    next(error);
  }
});

app.post("/api/items/:id/tts", async (req, res, next) => {
  try {
    const item = await requireItem(req.params.id);
    await ensureAudio(item, { provider: req.body?.provider || item.input.ttsProvider, force: true });
    item.updatedAt = nowIso();
    await saveItem(item);
    res.json({ item });
  } catch (error) {
    next(error);
  }
});

app.post("/api/items/:id/clip", async (req, res, next) => {
  try {
    const item = await requireItem(req.params.id);
    await ensureProviderClip(item, { sceneIndex: req.body?.sceneIndex });
    item.updatedAt = nowIso();
    await saveItem(item);
    res.json({ item });
  } catch (error) {
    next(error);
  }
});

app.post("/api/items/:id/render", async (req, res, next) => {
  try {
    const item = await requireItem(req.params.id);
    const warnings = [];
    if (req.body?.ensureAssets !== false) {
      await ensureImages(item, { warnings, strict: true });
      await ensureAudio(item, { provider: req.body?.provider || item.input.ttsProvider, warnings });
    }
    assertReadyToRender(item);
    await renderAndPersist(item);
    res.json({ item, warnings });
  } catch (error) {
    next(error);
  }
});

app.use((error, _req, res, _next) => {
  res.status(error.status || 500).json({ error: error.message || "Server error" });
});

app.listen(config.port, () => {
  console.log(`BanyakTau Video Studio running at http://localhost:${config.port}`);
});

async function requireItem(id) {
  const item = await getItem(id);
  if (!item) {
    const error = new Error("Item tidak ditemukan.");
    error.status = 404;
    throw error;
  }
  return item;
}

async function ensureProviderClip(item, options = {}) {
  if (!config.video.apiKey) throw new Error("VIDEO_API_KEY / DINOIKI_API_KEY wajib diisi untuk generate cuplikan video.");
  const scenes = item.plan?.scenes || [];
  if (!scenes.length) throw new Error("Storyboard belum tersedia.");
  const requestedIndex = Number(options.sceneIndex);
  const scene = scenes.find((entry) => Number(entry.index) === requestedIndex) || scenes[Math.min(1, scenes.length - 1)];
  const prompt = buildClipPrompt(item, scene);
  const clip = await generateVideoClip({
    itemId: item.id,
    scene,
    prompt
  });
  clip.costUsd = estimateVideoUsd(clip.seconds, config.pricing);

  const clips = (item.assets.clips || []).filter((entry) => Number(entry.sceneIndex) !== Number(scene.index));
  clips.push(clip);
  item.assets.clips = sortClips(clips);
  item.cost.videoUsd = item.assets.clips.reduce((sum, entry) => sum + Number(entry.costUsd || 0), 0);
  item.cost.totalUsd = Number((
    Number(item.cost.storyUsd || 0)
    + Number(item.cost.imageUsd || 0)
    + Number(item.cost.ttsUsd || 0)
    + Number(item.cost.videoUsd || 0)
  ).toFixed(5));
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

async function ensureImages(item, options = {}) {
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
      item.assets.images = sortImages(images);
      item.updatedAt = nowIso();
      await saveItem(item);
    } catch (error) {
      const message = `Gambar scene ${scene.index} gagal: ${error.message}`;
      if (options.strict) throw new Error(message);
      warnings.push(message);
    }
  }

  item.assets.images = sortImages(images);
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

async function ensureAudio(item, options = {}) {
  const hasWarningSink = Array.isArray(options.warnings);
  const warnings = options.warnings || [];
  const provider = String(options.provider || item.input.ttsProvider || "openai").toLowerCase() === "elevenlabs" ? "elevenlabs" : "openai";
  if (item.assets.audio?.path && !options.force && item.assets.audio.provider === provider) return;

  try {
    const text = narrationText(item);
    item.assets.audio = provider === "elevenlabs"
      ? await generateElevenLabsSpeech({ itemId: item.id, text, filenameSuffix: "elevenlabs-natural" })
      : await generateOpenAiSpeech({ itemId: item.id, text, filenameSuffix: "openai-natural" });
    item.assets.audio.characters = text.length;
    item.input.ttsProvider = provider;
    item.cost.ttsUsd = estimateTtsUsd(text.length, provider, config.pricing);
    item.cost.totalUsd = Number((
      Number(item.cost.storyUsd || 0)
      + Number(item.cost.imageUsd || 0)
      + Number(item.cost.ttsUsd || 0)
      + Number(item.cost.videoUsd || 0)
    ).toFixed(5));
    item.updatedAt = nowIso();
    await saveItem(item);
  } catch (error) {
    if (options.strict) throw error;
    warnings.push(`TTS gagal: ${error.message}`);
    if (!hasWarningSink) throw error;
  }
}

async function renderAndPersist(item) {
  assertReadyToRender(item);
  item.assets.video = await renderKnowledgeVideo(item);
  item.status = "rendered";
  item.updatedAt = nowIso();
  await saveItem(item);
  return item;
}

function assertReadyToRender(item) {
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

function narrationText(item) {
  return item.plan.scenes
    .map((scene) => String(scene.narration || "").trim())
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

function sortImages(images) {
  return [...images].sort((a, b) => Number(a.sceneIndex || 0) - Number(b.sceneIndex || 0));
}

function sortClips(clips) {
  return [...clips].sort((a, b) => Number(a.sceneIndex || 0) - Number(b.sceneIndex || 0));
}
