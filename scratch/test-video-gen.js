import { config } from "../src/config.js";
import { generateVideoClip } from "../src/video-provider.js";

async function main() {
  // Set the environment variables manually for testing
  process.env.VIDEO_API_KEY = "AIzaSyBizYXZkouSad1ZzumnMrtmbevFpES8yOo";
  process.env.VIDEO_PROVIDER = "gemini-veo";
  process.env.VIDEO_BASE_URL = "https://ai.dinoiki.com";
  process.env.VIDEO_ENDPOINT_MODE = "gemini";
  process.env.VIDEO_MODEL = "veo-3.1-lite-generate-preview";
  process.env.VIDEO_SECONDS = "4";

  // Re-apply to config
  config.video.apiKey = process.env.VIDEO_API_KEY;
  config.video.provider = process.env.VIDEO_PROVIDER;
  config.video.baseUrl = process.env.VIDEO_BASE_URL;
  config.video.endpointMode = process.env.VIDEO_ENDPOINT_MODE;
  config.video.model = process.env.VIDEO_MODEL;
  config.video.seconds = 4;

  console.log("Config keys:", {
    provider: config.video.provider,
    apiKey: config.video.apiKey ? "SET" : "NOT SET",
    baseUrl: config.video.baseUrl,
    model: config.video.model
  });

  console.log("Testing generateVideoClip...");
  const result = await generateVideoClip({
    itemId: "test-item",
    scene: { index: 1, screenText: "Gigi berlubang", narration: "Gigi kita bisa berlubang karena bakteri asam." },
    prompt: "A close-up shot of a white tooth showing a small dark cavity on its crown, clean clinical lighting"
  });

  console.log("Result:", result);
}

main().catch(console.error);
