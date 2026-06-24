import fs from "node:fs/promises";
import path from "node:path";

async function main() {
  const itemsFile = "C:/xampp/htdocs/videoasal/data/items.json";
  const items = JSON.parse(await fs.readFile(itemsFile, "utf8"));
  const item = items.find(i => i.id === "tau_0b4c72563491");
  if (!item) {
    console.error("Item not found!");
    return;
  }
  
  console.log(`=== Item ${item.id} ===`);
  console.log(`Title: ${item.title}`);
  console.log(`Audio path: ${item.assets?.audio?.path}`);
  console.log(`Audio duration: ${item.assets?.audio?.durationSec}s`);
  console.log(`Narration character count: ${item.assets?.audio?.characters}`);
  console.log(`Tempo: ${item.plan?.narrationTempo || "Not in plan"}`);
  console.log(`TTS Provider: ${item.input?.ttsProvider}`);
  console.log(`OpenAI voice: ${item.input?.openaiTtsVoice}`);
  console.log(`Captions count: ${item.assets?.captions?.length}`);
  
  if (item.assets?.captions && item.assets.captions.length > 0) {
    console.log("\nFirst 3 caption segments:");
    console.log(JSON.stringify(item.assets.captions.slice(0, 3), null, 2));
  } else {
    console.log("\nCaptions array is empty!");
  }
}

main().catch(console.error);
