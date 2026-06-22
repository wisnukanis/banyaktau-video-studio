import fs from "node:fs/promises";
import path from "node:path";
import { config, paths } from "./config.js";
import { safeFilename } from "./util.js";

export async function generateVideoClip({ itemId, scene, prompt }) {
  assertVideoProvider();
  await fs.mkdir(paths.clipDir, { recursive: true });

  const mode = String(config.video.endpointMode || "gemini").toLowerCase();
  if (mode === "openai-videos") return generateOpenAiCompatibleClip({ itemId, scene, prompt });
  return generateGeminiClip({ itemId, scene, prompt });
}

async function generateGeminiClip({ itemId, scene, prompt }) {
  const clipPrompt = sanitizeVideoPrompt(prompt || scene?.videoPrompt || scene?.imagePrompt || scene?.narration);
  const model = config.video.model.replace(/^models\//, "");
  const cleanVideoBase = (config.video.baseUrl || "").replace(/\/+$/g, "");
  const baseUrl = cleanVideoBase.endsWith("/v1beta") ? cleanVideoBase : joinUrl(cleanVideoBase, "v1beta");
  const createUrl = `${baseUrl}/models/${encodeURIComponent(model)}:predictLongRunning`;
  const payload = {
    instances: [{ prompt: clipPrompt }],
    parameters: {
      aspectRatio: config.video.aspectRatio,
      durationSeconds: Math.round(config.video.seconds)
    }
  };

  const created = await fetchJson(createUrl, {
    method: "POST",
    headers: videoHeaders(),
    body: JSON.stringify(payload)
  });
  if (!created.name) throw new Error("Provider video tidak mengembalikan operation name.");

  const operation = await pollGeminiOperation(baseUrl, created.name);
  const video = extractGeminiVideo(operation);
  const filename = `${itemId}-scene-${scene.index}-clip-${safeFilename(scene.screenText || "clip")}.mp4`;
  const outputPath = path.join(paths.clipDir, filename);

  if (video.base64) {
    await fs.writeFile(outputPath, Buffer.from(video.base64, "base64"));
  } else if (video.uri) {
    await downloadBinary(resolveProviderUrl(video.uri), outputPath, videoHeaders(false));
  } else {
    throw new Error("Provider video selesai, tetapi file video tidak ditemukan di response.");
  }

  return {
    sceneIndex: scene.index,
    provider: config.video.provider,
    model,
    operationName: created.name,
    path: outputPath,
    url: `/generated/clips/${filename}`,
    prompt: clipPrompt,
    seconds: config.video.seconds,
    aspectRatio: config.video.aspectRatio,
    resolution: config.video.resolution
  };
}

async function generateOpenAiCompatibleClip({ itemId, scene, prompt }) {
  const clipPrompt = sanitizeVideoPrompt(prompt || scene?.videoPrompt || scene?.imagePrompt || scene?.narration);
  const form = new FormData();
  form.append("model", config.video.model);
  form.append("prompt", clipPrompt);
  form.append("size", config.video.aspectRatio === "9:16" ? "720x1280" : "1280x720");
  form.append("seconds", String(Math.round(config.video.seconds)));

  const create = await fetchJson(joinUrl(config.video.baseUrl, "v1/videos"), {
    method: "POST",
    headers: { Authorization: `Bearer ${config.video.apiKey}` },
    body: form
  });
  const videoId = create.id;
  if (!videoId) {
    throw new Error("Endpoint /v1/videos merespons, tetapi tidak mengembalikan video id. Pastikan Dinoiki mendukung video generation untuk API key ini.");
  }

  await pollOpenAiVideo(videoId);
  const filename = `${itemId}-scene-${scene.index}-clip-${safeFilename(scene.screenText || "clip")}.mp4`;
  const outputPath = path.join(paths.clipDir, filename);
  await downloadBinary(joinUrl(config.video.baseUrl, `v1/videos/${videoId}/content?variant=video`), outputPath, {
    Authorization: `Bearer ${config.video.apiKey}`
  });

  return {
    sceneIndex: scene.index,
    provider: config.video.provider,
    model: config.video.model,
    videoId,
    path: outputPath,
    url: `/generated/clips/${filename}`,
    prompt: clipPrompt,
    seconds: config.video.seconds,
    aspectRatio: config.video.aspectRatio,
    resolution: config.video.resolution
  };
}

function assertVideoProvider() {
  if (!config.video.apiKey) throw new Error("VIDEO_API_KEY / DINOIKI_API_KEY belum diisi.");
  if (!config.video.baseUrl) throw new Error("VIDEO_BASE_URL belum diisi.");
}

async function pollGeminiOperation(baseUrl, operationName) {
  const operationPath = operationName.replace(/^\/+/g, "");
  for (let attempt = 0; attempt < 72; attempt += 1) {
    const operation = await fetchJson(`${baseUrl}/${operationPath}`, {
      headers: videoHeaders(false)
    });
    if (operation.done) {
      if (operation.error) throw new Error(`Provider video gagal: ${operation.error.message || JSON.stringify(operation.error)}`);
      return operation;
    }
    await wait(Math.min(20_000, 6_000 + attempt * 750));
  }
  throw new Error("Timeout menunggu video provider selesai.");
}

async function pollOpenAiVideo(videoId) {
  for (let attempt = 0; attempt < 72; attempt += 1) {
    const data = await fetchJson(joinUrl(config.video.baseUrl, `v1/videos/${videoId}`), {
      headers: { Authorization: `Bearer ${config.video.apiKey}` }
    });
    if (data.status === "completed") return data;
    if (data.status === "failed") throw new Error(`Provider video gagal: ${data.error?.message || data.error || "failed"}`);
    await wait(Math.min(20_000, 6_000 + attempt * 750));
  }
  throw new Error("Timeout menunggu video provider selesai.");
}

function extractGeminiVideo(operation) {
  const samples = operation.response?.generateVideoResponse?.generatedSamples
    || operation.response?.generatedVideos
    || operation.response?.generateVideoResponse?.generatedVideos
    || [];
  const video = samples[0]?.video || samples[0];
  return {
    uri: video?.uri || video?.videoUri || video?.fileUri,
    base64: video?.bytesBase64Encoded || video?.videoBytes || video?.inlineData?.data
  };
}

function sanitizeVideoPrompt(value) {
  return [
    String(value || ""),
    "short vertical 9:16 factual educational B-roll for an Indonesian knowledge short",
    "one clear subject, smooth camera motion, realistic documentary lighting, no text, no logo, no watermark, no gore, no injury, no celebrity likeness"
  ].join(", ");
}

function videoHeaders(json = true) {
  const headers = isGoogleGeminiVideo()
    ? { "x-goog-api-key": config.video.apiKey }
    : {
        Authorization: `Bearer ${config.video.apiKey}`,
        "x-goog-api-key": config.video.apiKey
      };
  if (json) headers["Content-Type"] = "application/json";
  return headers;
}

function isGoogleGeminiVideo() {
  return /generativelanguage\.googleapis\.com/i.test(config.video.baseUrl);
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, options);
  const text = await response.text();
  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text };
  }
  if (!response.ok) {
    const detail = data?.error?.message || data?.message || text || `HTTP ${response.status}`;
    throw new Error(providerErrorMessage(url, response.status, detail));
  }
  return data;
}

function providerErrorMessage(url, status, detail) {
  const cleanDetail = String(detail || "").slice(0, 700);
  if (/\/v1\/videos/i.test(url) && status === 404) {
    return "Dinoiki belum membuka endpoint /v1/videos untuk key/base URL ini. Dari Quick Start yang tersedia, Dinoiki mendukung chat, image, TTS, dan transcribe, tetapi belum terlihat endpoint video.";
  }
  if (/predictLongRunning/i.test(url) && status >= 400) {
    if (/specify\s+"prompt"\s+or\s+"messages"/i.test(cleanDetail)) {
      return "Dinoiki menolak payload Veo/Gemini. Quick Start Dinoiki yang tersedia hanya mendokumentasikan chat, image, TTS, dan transcribe; endpoint video/Veo belum terlihat aktif untuk API key/base URL ini.";
    }
    return `Endpoint Veo/Gemini menolak request (${status}). Kemungkinan model video belum tersedia untuk key ini atau format endpoint-nya berubah. Detail: ${cleanDetail}`;
  }
  return cleanDetail;
}

async function downloadBinary(url, outputPath, headers = {}) {
  const response = await fetch(url, { headers });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Download video gagal HTTP ${response.status}: ${detail.slice(0, 500)}`);
  }
  await fs.writeFile(outputPath, Buffer.from(await response.arrayBuffer()));
}

function joinUrl(baseUrl, suffix) {
  return `${String(baseUrl || "").replace(/\/+$/g, "")}/${String(suffix || "").replace(/^\/+/g, "")}`;
}

function resolveProviderUrl(uri) {
  const value = String(uri || "");
  if (/^https?:\/\//i.test(value)) return value;
  return joinUrl(config.video.baseUrl, value);
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
