import fs from "node:fs/promises";
import path from "node:path";
import { paths } from "../src/config.js";

async function main() {
  const itemsFile = path.join(paths.dataDir, "items.json");
  const data = await fs.readFile(itemsFile, "utf8");
  const items = JSON.parse(data);
  const item = items.find(i => i.id === "tau_0b4c72563491");
  console.log("Item Details:");
  console.log("- Title:", item.title);
  console.log("- Status:", item.status);
  console.log("- Video Path:", item.assets?.video?.path);
  console.log("- Video Url:", item.assets?.video?.url);
  console.log("- Subtitle Count:", item.assets?.captions?.length);
  console.log("- Avatar Mode:", item.input?.avatarMode);
}

main().catch(console.error);
