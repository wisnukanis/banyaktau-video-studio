import fs from "node:fs/promises";
import path from "node:path";
import { config, paths } from "./config.js";
import { safeFilename } from "./util.js";

const apiBase = "https://api.openai.com/v1";

export async function requestKnowledgeJson(promptText) {
  assertOpenAi();
  const response = await fetch(`${apiBase}/chat/completions`, {
    method: "POST",
    headers: headersJson(),
    body: JSON.stringify({
      model: config.openai.storyModel,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: "You are an Indonesian educational short-video writer. Write factual, engaging, natural Indonesian narration for encyclopedia-style videos. Return valid JSON only."
        },
        { role: "user", content: promptText }
      ],
      temperature: 0.78
    })
  });
  const data = await parseOpenAiResponse(response);
  const content = data.choices?.[0]?.message?.content || "";
  return JSON.parse(content);
}

export async function generateSceneImage({ itemId, scene, size, quality }) {
  assertOpenAi();
  await fs.mkdir(paths.imageDir, { recursive: true });

  const prompt = sanitizeImagePrompt(scene.imagePrompt);
  const response = await fetch(`${apiBase}/images/generations`, {
    method: "POST",
    headers: headersJson(),
    body: JSON.stringify({
      model: config.openai.imageModel,
      prompt,
      size,
      quality,
      n: 1
    })
  });
  const data = await parseOpenAiResponse(response);
  const item = data.data?.[0];
  if (!item) throw new Error("OpenAI tidak mengembalikan gambar.");

  const filename = `${itemId}-scene-${scene.index}-${safeFilename(scene.screenText)}.png`;
  const outputPath = path.join(paths.imageDir, filename);

  if (item.b64_json) {
    await fs.writeFile(outputPath, Buffer.from(item.b64_json, "base64"));
  } else if (item.url) {
    const image = await fetch(item.url);
    if (!image.ok) throw new Error(`Gagal download image: HTTP ${image.status}`);
    await fs.writeFile(outputPath, Buffer.from(await image.arrayBuffer()));
  } else {
    throw new Error("Format response image tidak dikenali.");
  }

  return {
    sceneIndex: scene.index,
    provider: "openai",
    path: outputPath,
    url: `/generated/images/${filename}`,
    prompt
  };
}

export async function generateOpenAiSpeech({ itemId, text, voice, filenameSuffix = "openai" }) {
  assertOpenAi();
  await fs.mkdir(paths.audioDir, { recursive: true });

  const selectedVoice = voice || config.openai.ttsVoice;
  const filename = `${itemId}-${safeFilename(filenameSuffix)}-narration.mp3`;
  const outputPath = path.join(paths.audioDir, filename);
  const response = await fetch(`${apiBase}/audio/speech`, {
    method: "POST",
    headers: headersJson(),
    body: JSON.stringify({
      model: config.openai.ttsModel,
      voice: selectedVoice,
      input: text,
      instructions: "Bacakan sepenuhnya dalam Bahasa Indonesia natural. Gaya suara hangat, penasaran, jelas, seperti kreator pengetahuan sedang menjelaskan fakta menarik kepada teman. Jangan terdengar seperti robot, jangan terlalu cepat, beri jeda ringan setelah kalimat penting, dan tekankan bagian hook dengan rasa ingin tahu.",
      response_format: "mp3"
    })
  });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`OpenAI TTS gagal HTTP ${response.status}: ${detail.slice(0, 500)}`);
  }

  await fs.writeFile(outputPath, Buffer.from(await response.arrayBuffer()));
  return {
    provider: "openai",
    model: config.openai.ttsModel,
    voice: selectedVoice,
    path: outputPath,
    url: `/generated/audio/${filename}`
  };
}

function assertOpenAi() {
  if (!config.openai.apiKey) throw new Error("OPENAI_API_KEY belum diisi.");
}

function headersJson() {
  return {
    Authorization: `Bearer ${config.openai.apiKey}`,
    "Content-Type": "application/json"
  };
}

function sanitizeImagePrompt(value) {
  return [
    String(value || ""),
    "vertical 9:16 editorial knowledge video illustration, Indonesian friendly educational visual style, cinematic but bright, high detail, clear subject, varied composition, no written text inside the image, no logo, no watermark, no celebrity likeness, no gore, no injury"
  ].join(", ");
}

async function parseOpenAiResponse(response) {
  const text = await response.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = { raw: text };
  }
  if (!response.ok) {
    const message = data?.error?.message || text || `HTTP ${response.status}`;
    throw new Error(message);
  }
  return data;
}
