import { ensureProjectDirs } from "./config.js";
import { generateFullItem } from "./pipeline.js";
import { absolutizeGeneratedUrls, remoteEnabled, uploadGeneratedStateAndAssets } from "./remote.js";
import { saveItem } from "./storage.js";

function argValue(name, fallback = "") {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] || fallback : fallback;
}

function boolValue(value, fallback = false) {
  if (value === undefined || value === "") return fallback;
  return ["1", "true", "yes", "on"].includes(String(value).toLowerCase());
}

ensureProjectDirs();

const input = {
  topic: argValue("--topic", process.env.BANYAKTAU_TOPIC || ""),
  category: argValue("--category", process.env.BANYAKTAU_CATEGORY || "random"),
  tone: argValue("--tone", process.env.BANYAKTAU_TONE || "natural, penasaran, hangat, seperti kreator pengetahuan yang enak didengar"),
  ttsProvider: argValue("--tts-provider", process.env.BANYAKTAU_TTS_PROVIDER || "openai"),
  durationSec: Number(argValue("--duration", process.env.BANYAKTAU_DURATION || "90")),
  sceneCount: Number(argValue("--scenes", process.env.BANYAKTAU_SCENES || "7")),
  imageQuality: argValue("--image-quality", process.env.IMAGE_QUALITY || "low"),
  imageSize: argValue("--image-size", process.env.IMAGE_SIZE || "1024x1536")
};

const withClip = boolValue(argValue("--with-clip", process.env.BANYAKTAU_WITH_CLIP || "false"), false);

console.log("BanyakTau run started.");
console.log(`Category=${input.category}, duration=${input.durationSec}, scenes=${input.sceneCount}, withClip=${withClip}`);

const result = await generateFullItem(input, { withClip });
if (remoteEnabled()) {
  result.item = absolutizeGeneratedUrls(result.item);
  await saveItem(result.item);
  await uploadGeneratedStateAndAssets();
  console.log("Remote upload complete.");
}

console.log(JSON.stringify({
  status: "done",
  id: result.item.id,
  title: result.item.title,
  videoUrl: result.item.assets?.video?.url || "",
  warnings: result.warnings
}, null, 2));
