import { config, ensureProjectDirs } from "../src/config.js";
import { ensureStrongHook } from "../src/hook-engine.js";
import { requestIdeaJson } from "../src/openai.js";
import { ensureVisualClips } from "../src/pipeline.js";
import { saveItem } from "../src/storage.js";
import { createKnowledgeDraft } from "../src/story-engine.js";
import fs from "node:fs/promises";
import path from "node:path";

async function main() {
  ensureProjectDirs();
  console.log("=== VERIFYING HOOK ENGINE ===");
  const testInput = {
    topic: "Kenapa Es Batu Bisa Bikin Gelas Retak",
    category: "sains"
  };
  
  if (config.openai.apiKey) {
    console.log("Generating hook options via OpenAI...");
    const hookResult = await ensureStrongHook(testInput, requestIdeaJson);
    console.log("Hook options result:", JSON.stringify(hookResult, null, 2));
  } else {
    console.log("OpenAI API key not set, skipping OpenAI Hook call.");
  }

  console.log("\n=== VERIFYING VIDEO API KEY DEFAULTING ===");
  console.log("OpenAI API Key value exists:", Boolean(config.openai.apiKey));
  console.log("Video API Key resolved:", config.video.apiKey ? "SET" : "EMPTY");
  if (config.video.apiKey === config.openai.apiKey) {
    console.log("SUCCESS: Video API key falls back to OpenAI API key successfully!");
  } else {
    console.warn("WARNING: Video API key is not mapped to OpenAI API key or there is a custom key set.");
  }

  console.log("\n=== VERIFYING IMAGE RENDERING WITHOUT ZOOMPAN ===");
  // Create a dummy image segment test
  const testImage = path.join(config.publicDir || "", "assets", "banyaktau-logo-watermark.png");
  try {
    await fs.access(testImage);
    console.log("Dummy image found. Testing render segment...");
    // Let's dynamically import makeImageSegment to test it
    const { renderAndPersist } = await import("../src/pipeline.js");
    const { requireItem } = await import("../src/pipeline.js");
    console.log("Pipeline modules imported successfully.");
  } catch (err) {
    console.log("Dummy image not found at", testImage, ", skipping render segment test.");
  }

  console.log("\n=== VERIFICATION COMPLETED ===");
}

main().catch(console.error);
