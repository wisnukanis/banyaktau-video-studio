import { ensureProjectDirs } from "./config.js";
import { config } from "./config.js";
import { publishToFacebook } from "./facebook.js";
import { generateFullItem } from "./pipeline.js";
import { absolutizeGeneratedUrls, publicBaseUrl, remoteEnabled, uploadGeneratedStateAndAssets } from "./remote.js";
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

const result = await generateFullItem(input, { withClip, requireClip: withClip });
if (remoteEnabled()) {
  result.item = absolutizeGeneratedUrls(result.item);
  await mergeRemoteState(result.item);
  await saveItem(result.item);
  try {
    await uploadGeneratedStateAndAssets({ item: result.item });
    console.log("Remote upload complete.");
    await publishFacebookIfEnabled(result);
  } catch (error) {
    const message = `Remote upload gagal: ${error.message}`;
    result.warnings.push(message);
    console.warn(message);
    if (boolValue(process.env.BANYAKTAU_STRICT_REMOTE, false)) throw error;
  }
}

console.log(JSON.stringify({
  status: "done",
  id: result.item.id,
  title: result.item.title,
  videoUrl: result.item.assets?.video?.url || "",
  warnings: result.warnings
}, null, 2));

async function mergeRemoteState(currentItem) {
  const base = publicBaseUrl();
  if (!base) return;
  try {
    const response = await fetch(`${base}/state/items.json?v=${Date.now()}`, { cache: "no-store" });
    if (!response.ok) return;
    const remoteItems = await response.json();
    if (!Array.isArray(remoteItems)) return;
    for (const item of remoteItems) {
      if (item?.id && item.id !== currentItem.id) await saveItem(item);
    }
  } catch (error) {
    result.warnings.push(`Remote state lama tidak bisa digabung: ${error.message}`);
  }
}

async function publishFacebookIfEnabled(result) {
  if (!config.facebook.enabled) return;
  try {
    const item = result.item;
    const published = await publishToFacebook({
      videoUrl: item.assets?.video?.url || "",
      title: item.title,
      description: facebookDescription(item)
    });
    item.publish = {
      ...(item.publish || {}),
      facebook: {
        ...published,
        publishedAt: new Date().toISOString()
      }
    };
    await saveItem(item);
    await uploadGeneratedStateAndAssets({ item });
    console.log(`Facebook publish complete: ${published.url || published.videoId || published.postId || "ok"}`);
  } catch (error) {
    const message = `Facebook publish gagal: ${error.message}`;
    result.warnings.push(message);
    console.warn(message);
    if (boolValue(process.env.FACEBOOK_STRICT_PUBLISH, false)) throw error;
  }
}

function facebookDescription(item) {
  const points = (item.plan?.importantPoints || [])
    .slice(0, 2)
    .map((point) => `- ${point}`)
    .join("\n");
  return [
    item.plan?.hook || item.title,
    points,
    "#BanyakTau #FaktaMenarik #Pengetahuan #Reels"
  ].filter(Boolean).join("\n\n");
}
