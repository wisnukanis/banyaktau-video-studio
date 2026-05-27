import dotenv from "dotenv";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");

function clean(value) {
  return String(value || "").trim();
}

function numberEnv(name, fallback) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) ? value : fallback;
}

export const paths = {
  rootDir,
  dataDir: path.join(rootDir, "data"),
  generatedDir: path.join(rootDir, "generated"),
  imageDir: path.join(rootDir, "generated", "images"),
  audioDir: path.join(rootDir, "generated", "audio"),
  videoDir: path.join(rootDir, "generated", "videos"),
  workDir: path.join(rootDir, "generated", "work"),
  publicDir: path.join(rootDir, "public")
};

export function ensureProjectDirs() {
  for (const dir of Object.values(paths)) {
    if (String(dir).startsWith(rootDir)) fs.mkdirSync(dir, { recursive: true });
  }
}

export const config = {
  port: Math.max(1, Math.floor(numberEnv("PORT", 3040))),
  publicBaseUrl: clean(process.env.PUBLIC_BASE_URL),
  openai: {
    apiKey: process.env.OPENAI_API_KEY || "",
    storyModel: clean(process.env.STORY_MODEL || "gpt-4.1-mini"),
    imageModel: clean(process.env.IMAGE_MODEL || "gpt-image-1-mini"),
    imageSize: clean(process.env.IMAGE_SIZE || "1024x1536"),
    imageQuality: clean(process.env.IMAGE_QUALITY || "low"),
    ttsModel: clean(process.env.OPENAI_TTS_MODEL || process.env.TTS_MODEL || "gpt-4o-mini-tts"),
    ttsVoice: clean(process.env.OPENAI_TTS_VOICE || process.env.TTS_VOICE || "shimmer")
  },
  elevenlabs: {
    apiKey: process.env.ELEVENLABS_API_KEY || "",
    model: clean(process.env.ELEVENLABS_MODEL || "eleven_multilingual_v2"),
    voiceId: clean(process.env.ELEVENLABS_VOICE_ID || "pFZP5JQG7iQjIQuC4Bku")
  },
  pricing: {
    storyInputUsdPer1MTokens: numberEnv("STORY_INPUT_USD_PER_1M_TOKENS", 0.4),
    storyOutputUsdPer1MTokens: numberEnv("STORY_OUTPUT_USD_PER_1M_TOKENS", 1.6),
    openaiTtsUsdPer1MChars: numberEnv("OPENAI_TTS_USD_PER_1M_CHARS", numberEnv("TTS_USD_PER_1M_CHARS", 15)),
    elevenlabsTtsUsdPer1KChars: numberEnv("ELEVENLABS_TTS_USD_PER_1K_CHARS", 0.1)
  },
  render: {
    fontTitle: clean(process.env.RENDER_TITLE_FONT || "Georgia"),
    fontBody: clean(process.env.RENDER_BODY_FONT || "Segoe UI Semibold"),
    fontMono: clean(process.env.RENDER_MONO_FONT || "Cascadia Code")
  }
};

export function publicConfig() {
  return {
    port: config.port,
    publicBaseUrl: config.publicBaseUrl,
    providers: {
      openai: Boolean(config.openai.apiKey),
      elevenlabs: Boolean(config.elevenlabs.apiKey),
      storyModel: config.openai.storyModel,
      imageModel: config.openai.imageModel,
      imageSize: config.openai.imageSize,
      imageQuality: config.openai.imageQuality,
      openaiTtsModel: config.openai.ttsModel,
      openaiTtsVoice: config.openai.ttsVoice,
      elevenlabsModel: config.elevenlabs.model
    },
    render: config.render
  };
}
