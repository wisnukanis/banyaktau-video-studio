import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { config, paths } from "./config.js";
import { safeFilename } from "./util.js";
import { requestGeminiKnowledgeJson, requestGeminiIdeaJson } from "./gemini.js";
import { generateEdgeTts } from "./modules/edge_tts.js";

export async function requestKnowledgeJson(promptText) {
  const shouldUseGemini = process.env.STORY_PROVIDER === "gemini" || !config.openai.apiKey || Boolean((process.env.GEMINI_API_KEY || process.env.VIDEO_API_KEY) && !config.openai.apiKey);
  if (shouldUseGemini && (process.env.GEMINI_API_KEY || process.env.VIDEO_API_KEY)) {
    return requestGeminiKnowledgeJson(promptText);
  }

  try {
    assertOpenAi();
    const response = await fetch(`${config.openai.baseUrl}/chat/completions`, {
      method: "POST",
      headers: headersJson(),
      body: JSON.stringify({
        model: config.openai.storyModel,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content: "You are an Indonesian educational short-video writer for channel BanyakTau. Write factual, highly engaging Indonesian narration using simple, everyday language that is easy for the general public to understand. Avoid complex academic jargon without clear analogies. Keep sentences short, punchy, and comfortably paced for viewers to read on-screen subtitles. Return valid JSON only."
          },
          { role: "user", content: promptText }
        ],
        temperature: 0.78
      })
    });
    const data = await parseOpenAiResponse(response);
    const content = data.choices?.[0]?.message?.content || "";
    return JSON.parse(content);
  } catch (err) {
    if ((process.env.GEMINI_API_KEY || process.env.VIDEO_API_KEY) && (/credits|billing|429|insufficient_quota|unauthorized/i.test(err.message) || !config.openai.apiKey)) {
      console.warn(`[OpenAI -> Gemini Fallback] ${err.message}. Menggunakan Google Gemini gratis...`);
      return requestGeminiKnowledgeJson(promptText);
    }
    throw err;
  }
}

export async function requestIdeaJson(promptText) {
  const shouldUseGemini = process.env.STORY_PROVIDER === "gemini" || !config.openai.apiKey || Boolean((process.env.GEMINI_API_KEY || process.env.VIDEO_API_KEY) && !config.openai.apiKey);
  if (shouldUseGemini && (process.env.GEMINI_API_KEY || process.env.VIDEO_API_KEY)) {
    return requestGeminiIdeaJson(promptText);
  }

  try {
    assertOpenAi();
    const response = await fetch(`${config.openai.baseUrl}/chat/completions`, {
      method: "POST",
      headers: headersJson(),
      body: JSON.stringify({
        model: config.openai.storyModel,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content: "You are an Indonesian short-video ideation producer for BanyakTau. Recommend scroll-stopping, factual, low-cost visual ideas using 3 proven Reels hook formulas (contradictory myth, extreme visual fact, relatable daily problems) in simple, accessible Indonesian. Return valid JSON only."
          },
          { role: "user", content: promptText }
        ],
        temperature: 0.92
      })
    });
    const data = await parseOpenAiResponse(response);
    const content = data.choices?.[0]?.message?.content || "";
    return JSON.parse(content);
  } catch (err) {
    if ((process.env.GEMINI_API_KEY || process.env.VIDEO_API_KEY) && (/credits|billing|429|insufficient_quota|unauthorized/i.test(err.message) || !config.openai.apiKey)) {
      console.warn(`[OpenAI -> Gemini Fallback] ${err.message}. Menggunakan Google Gemini gratis...`);
      return requestGeminiIdeaJson(promptText);
    }
    throw err;
  }
}

async function fetchAvailableModels() {
  try {
    const response = await fetch(`${config.openai.baseUrl}/models`, {
      headers: {
        Authorization: `Bearer ${config.openai.apiKey}`
      }
    });
    if (!response.ok) return [];
    const data = await response.json();
    return (data.data || []).map((m) => m.id);
  } catch {
    return [];
  }
}

export async function generateSceneImage({ itemId, scene, size, quality, theme, format }) {
  assertOpenAi();
  await fs.mkdir(paths.imageDir, { recursive: true });

  const chosenTheme = theme || scene.theme || scene.visualStyle || scene.illustration || "";
  const prompt = sanitizeImagePrompt(scene.imagePrompt, { theme: chosenTheme, format: format || scene.format });
  let modelToUse = config.openai.imageModel;
  let qualityToUse = quality;
  let sizeToUse = size;
  let item = null;

  for (let attempt = 1; attempt <= 3; attempt++) {
    const payload = {
      model: modelToUse,
      prompt,
      n: 1
    };
    if (sizeToUse) payload.size = sizeToUse;
    if (qualityToUse) payload.quality = qualityToUse;

    const response = await fetch(`${config.openai.baseUrl}/images/generations`, {
      method: "POST",
      headers: headersJson(),
      body: JSON.stringify(payload)
    });

    const text = await response.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      data = { raw: text };
    }

    if (!response.ok) {
      const errMsg = data?.error?.message || text || `HTTP ${response.status}`;
      console.warn(`[generateSceneImage] Attempt ${attempt} failed: ${errMsg}`);

      if (attempt === 3) {
        throw new Error(errMsg);
      }

      // 1. Check for model not found
      if (/model.*not.*exist|not.*found.*model|unknown.*model|model.*unsupported/i.test(errMsg) || (data?.error?.code === "model_not_found")) {
        console.log("[generateSceneImage] Model not found. Fetching available models...");
        const available = await fetchAvailableModels();
        const fallbackModel = available.find(id => /image|dall/i.test(id));
        if (fallbackModel && fallbackModel !== modelToUse) {
          console.log(`[generateSceneImage] Switching image model: ${modelToUse} -> ${fallbackModel}`);
          modelToUse = fallbackModel;
          config.openai.imageModel = fallbackModel;
          continue;
        }
      }

      // 2. Check for invalid quality parameter
      if (data?.error?.param === "quality" || /quality/i.test(errMsg) || /invalid_value.*quality/i.test(data?.error?.code)) {
        console.log("[generateSceneImage] Quality parameter rejected. Disabling quality parameter...");
        qualityToUse = undefined;
        config.openai.imageQuality = undefined;
        continue;
      }

      // 3. Check for invalid size parameter
      if (data?.error?.param === "size" || /size/i.test(errMsg) || /invalid_value.*size/i.test(data?.error?.code)) {
        console.log("[generateSceneImage] Size parameter rejected. Disabling size parameter...");
        sizeToUse = undefined;
        config.openai.imageSize = undefined;
        continue;
      }

      throw new Error(errMsg);
    }

    item = data.data?.[0];
    break;
  }

  if (!item) throw new Error("OpenAI tidak mengembalikan gambar.");

  const rawFilename = `${itemId}-scene-${scene.index}-${safeFilename(scene.screenText)}-raw.png`;
  const rawPath = path.join(paths.workDir, rawFilename);
  let filename = `${itemId}-scene-${scene.index}-${safeFilename(scene.screenText)}.jpg`;
  let outputPath = path.join(paths.imageDir, filename);
  await fs.mkdir(paths.workDir, { recursive: true });

  if (item.b64_json) {
    await fs.writeFile(rawPath, Buffer.from(item.b64_json, "base64"));
  } else if (item.url) {
    const image = await fetch(item.url);
    if (!image.ok) throw new Error(`Gagal download image: HTTP ${image.status}`);
    await fs.writeFile(rawPath, Buffer.from(await image.arrayBuffer()));
  } else {
    throw new Error("Format response image tidak dikenali.");
  }

  try {
    await optimizeImage(rawPath, outputPath);
    await fs.rm(rawPath, { force: true });
  } catch {
    filename = `${itemId}-scene-${scene.index}-${safeFilename(scene.screenText)}.png`;
    outputPath = path.join(paths.imageDir, filename);
    await fs.rename(rawPath, outputPath);
  }

  return {
    sceneIndex: scene.index,
    provider: providerName(),
    path: outputPath,
    url: `/generated/images/${filename}`,
    prompt
  };
}

function optimizeImage(inputPath, outputPath) {
  return new Promise((resolve, reject) => {
    const child = spawn("ffmpeg", [
      "-y",
      "-i", inputPath,
      "-vf", "scale=720:1280:force_original_aspect_ratio=increase,crop=720:1280",
      "-frames:v", "1",
      "-q:v", "7",
      outputPath
    ], { windowsHide: true, cwd: paths.rootDir });
    let stderr = "";
    child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(stderr || `Optimasi gambar gagal (${code})`));
    });
  });
}

export async function generateOpenAiSpeech({ itemId, text, voice, filenameSuffix = "openai", instructions }) {
  const preferEdge = process.env.TTS_PROVIDER === "edge_tts" || !config.openai.apiKey;
  const edgeVoice = config.openai.edgeTtsVoice || "id-ID-ArdiNeural";
  const filename = `${itemId}-${safeFilename(filenameSuffix)}-narration.mp3`;
  const outputPath = path.join(paths.audioDir, filename);

  if (preferEdge) {
    await fs.mkdir(paths.audioDir, { recursive: true });
    await generateEdgeTts({ text, voiceId: edgeVoice, outputPath });
    return {
      provider: "edge_tts",
      model: "edge-tts-cli",
      voice: edgeVoice,
      path: outputPath,
      url: `/generated/audio/${filename}`
    };
  }

  try {
    assertOpenAi();
    await fs.mkdir(paths.audioDir, { recursive: true });

    const selectedVoice = voice || config.openai.ttsVoice;
    const payload = {
      model: config.openai.ttsModel,
      voice: selectedVoice,
      input: text,
      response_format: "mp3"
    };
    if (/dinoiki/i.test(config.openai.baseUrl)) {
      payload.instructions = instructions || "Bacakan sebagai narator dokumenter Indonesia dengan suara pria dewasa yang tenang, berwibawa, cerdas, dan tepercaya. Gunakan tempo sedang dan aksen Indonesia netral (tidak robotik, tidak dramatis, tidak seperti iklan). Berikan jeda alami antar-kalimat dan jeda sedikit lebih lama sebelum fakta penting atau mengejutkan. Tekankan kata kunci secara halus demi membangun rasa penasaran dan takjub tanpa berlebihan. Gaya narasi tenang, percaya diri, hangat, informatif, dengan sedikit ketegangan saat mengungkap fakta dan transisi mulus. Jangan terburu-buru, jangan berteriak, jangan terdengar heboh seperti influencer YouTube, hindari emosi berlebih.";
    }
    const response = await fetch(`${config.openai.baseUrl}/audio/speech`, {
      method: "POST",
      headers: headersJson(),
      body: JSON.stringify(payload)
    });
    if (!response.ok) {
      const detail = await response.text();
      throw new Error(`OpenAI TTS gagal HTTP ${response.status}: ${detail.slice(0, 500)}`);
    }

    await fs.writeFile(outputPath, Buffer.from(await response.arrayBuffer()));
    return {
      provider: providerName(),
      model: config.openai.ttsModel,
      voice: selectedVoice,
      path: outputPath,
      url: `/generated/audio/${filename}`
    };
  } catch (err) {
    console.warn(`[OpenAI TTS -> Edge TTS Fallback] ${err.message}. Menggunakan Edge TTS gratis...`);
    await generateEdgeTts({ text, voiceId: edgeVoice, outputPath });
    return {
      provider: "edge_tts",
      model: "edge-tts-cli",
      voice: edgeVoice,
      path: outputPath,
      url: `/generated/audio/${filename}`
    };
  }
}

export async function transcribeSpeechSegments(audioPath, language = "id") {
  if (!config.openai.apiKey || process.env.TTS_PROVIDER === "edge_tts") {
    return [];
  }
  try {
    assertOpenAi();
    const model = config.openai.transcribeModel;
    return await transcribeSpeechSegmentsWithModel(audioPath, model, "verbose_json", language);
  } catch (error) {
    console.warn(`[Whisper Transcribe Fallback] ${error.message}. Menggunakan karaoke subtitle otomatis.`);
    return [];
  }
}

async function transcribeSpeechSegmentsWithModel(audioPath, model, responseFormat = "verbose_json", language = "id") {
  const buffer = await fs.readFile(audioPath);
  const form = new FormData();
  form.append("file", new Blob([buffer]), path.basename(audioPath));
  form.append("model", model);
  form.append("language", language);
  form.append("response_format", responseFormat);
  if (responseFormat === "verbose_json") {
    form.append("timestamp_granularities[]", "word");
    form.append("timestamp_granularities[]", "segment");
  }

  const response = await fetch(`${config.openai.baseUrl}/audio/transcriptions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${config.openai.apiKey}` },
    body: form
  });
  const data = await parseOpenAiResponse(response);

  const rawSegments = Array.isArray(data.segments) ? data.segments : [];
  const rawWords = Array.isArray(data.words) ? data.words : [];

  const cleanWords = rawWords
    .map((w) => ({
      word: String(w.word || "").trim(),
      start: Number(w.start || 0),
      end: Number(w.end || 0)
    }))
    .filter((w) => w.word && w.end >= w.start);

  if (rawSegments.length) {
    let wordIdx = 0;
    return rawSegments
      .map((segment) => {
        const segStart = Number(segment.start || 0);
        const segEnd = Number(segment.end || 0);
        const segText = String(segment.text || "").replace(/\s+/g, " ").trim();

        let segWords = Array.isArray(segment.words)
          ? segment.words.map((w) => ({
              word: String(w.word || "").trim(),
              start: Number(w.start || 0),
              end: Number(w.end || 0)
            })).filter((w) => w.word)
          : [];

        if (!segWords.length && cleanWords.length) {
          while (wordIdx < cleanWords.length && cleanWords[wordIdx].start < segEnd - 0.01) {
            segWords.push(cleanWords[wordIdx]);
            wordIdx++;
          }
        }

        return {
          start: segStart,
          end: segEnd,
          text: segText,
          words: segWords
        };
      })
      .filter((segment) => segment.text && segment.end > segment.start);
  }

  // Jika segments kosong tetapi ada cleanWords (word timestamps), buat segments dari kata-kata tersebut
  if (cleanWords.length) {
    const segmentsFromWords = [];
    let currentWords = [];
    for (let i = 0; i < cleanWords.length; i++) {
      currentWords.push(cleanWords[i]);
      const isLast = i === cleanWords.length - 1;
      const endsWithPunct = /[.!?]$/.test(cleanWords[i].word);
      const nextGap = !isLast ? (cleanWords[i + 1].start - cleanWords[i].end) : 0;

      if (isLast || endsWithPunct || nextGap > 0.4 || currentWords.length >= 8) {
        segmentsFromWords.push({
          start: currentWords[0].start,
          end: currentWords[currentWords.length - 1].end,
          text: currentWords.map((w) => w.word).join(" "),
          words: [...currentWords]
        });
        currentWords = [];
      }
    }
    return segmentsFromWords;
  }

  const text = String(data.text || "").replace(/\s+/g, " ").trim();
  return text ? [{ start: 0, end: 0, text, words: [] }] : [];
}

export async function requestTextCompletion(systemPrompt, userPrompt) {
  assertOpenAi();
  const response = await fetch(`${config.openai.baseUrl}/chat/completions`, {
    method: "POST",
    headers: headersJson(),
    body: JSON.stringify({
      model: config.openai.storyModel,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt }
      ],
      temperature: 0.3
    })
  });
  const data = await parseOpenAiResponse(response);
  return data.choices?.[0]?.message?.content?.trim() || "";
}

function providerName() {
  return /dinoiki/i.test(config.openai.baseUrl) ? "dinoiki" : "openai";
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

function sanitizeImagePrompt(value, options = {}) {
  const theme = String(options.theme || "").toLowerCase();
  const format = String(options.format || "vertical").toLowerCase();
  const isHorizontal = format.includes("horiz") || format === "16:9";
  const aspectInstruction = isHorizontal ? "horizontal 16:9 widescreen, cinematic composition" : "vertical 9:16";

  if (theme === "kartun" || theme === "collage" || theme === "cartoon" || theme === "dino") {
    return [
      `clean flat 2D vector cutout illustration of ${value || "educational subject"}`,
      `sticker style cutout with solid clear edges, vibrant saturated colors, bold clean outlines, isolated on pure solid white background, flat paper collage aesthetic, playful educational design, no realistic 3D volume, no shadows, no written text inside image, no logo, no watermark, ${aspectInstruction}`
    ].join(", ");
  }

  if (theme === "vintage" || theme === "sketsa" || theme === "engine" || theme === "sketch") {
    return [
      `antique 18th century copperplate engraving illustration of ${value || "historical scientific subject"}`,
      `sepia and black ink etching on clean background, vintage scientific encyclopedia patent plate, fine cross-hatching linework, authentic historical archival drawing, no modern digital render, no written text inside image, no logo, no watermark, ${aspectInstruction}`
    ].join(", ");
  }

  if (theme === "gradient" || theme === "space" || theme === "kosmik") {
    return [
      `cinematic deep space cosmic visual of ${value || "scientific phenomenon"}`,
      `ethereal glowing volumetric lighting, soft ambient particle grain, vibrant cyan and violet celestial highlights, elegant abstract scientific render, no written text inside image, no logo, no watermark, ${aspectInstruction}`
    ].join(", ");
  }

  if (theme === "catalog" || theme === "product") {
    return [
      `clean studio product photography of ${value || "object"}`,
      `pure white seamless background, architectural precision lighting, sharp macro object details, crisp subtle contact shadow, modern scientific museum catalog aesthetic, no written text inside image, no logo, no watermark, ${aspectInstruction}`
    ].join(", ");
  }

  if (theme === "poster" || theme === "bold") {
    return [
      `bold high-contrast graphic pop-art visual of ${value || "subject"}`,
      `vibrant saturated color blocking, sharp dramatic silhouette, dynamic punchy lighting, modern editorial magazine aesthetic, no written text inside image, no logo, no watermark, ${aspectInstruction}`
    ].join(", ");
  }

  if (theme === "action" || theme === "speed" || theme === "motion") {
    return [
      `dynamic high-speed action trajectory visual of ${value || "subject"}`,
      `kinetic motion blur streaks, low-angle dramatic perspective, high energy lighting, no written text inside image, no logo, no watermark, ${aspectInstruction}`
    ].join(", ");
  }

  if (theme === "jurnalisme" || theme === "journalism" || theme === "vox") {
    return [
      `Vox visual journalism documentary visual of ${value || "subject"}`,
      `dark mode moody aesthetic, cinematic rim lighting, high contrast, clean forensic detail, premium editorial magazine still, no written text inside image, no logo, no watermark, ${aspectInstruction}`
    ].join(", ");
  }

  return [
    String(value || ""),
    `${aspectInstruction} editorial knowledge video illustration, Indonesian friendly educational visual style, cinematic but bright, high detail, clear subject, varied composition, no written text inside the image, no logo, no watermark, no celebrity likeness, no gore, no injury`
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
