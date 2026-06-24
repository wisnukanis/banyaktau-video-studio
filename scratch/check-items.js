import fs from "node:fs/promises";
import path from "node:path";
import { config, ensureProjectDirs, paths } from "../src/config.js";

// We will dynamically import the makeImageSegment function by reading render.js or just importing it
// Wait, is makeImageSegment exported?
// Let's check render.js: it does not export makeImageSegment.
// Ah! It's not exported. But wait! We can export it temporarily, or we can just run a full test-render-item.js or renderAndPersist!
// Let's check if there is an item we can test-render using the existing scratch/test-render-item.js!
// Let's search the data directory to see what item IDs we have.
async function main() {
  ensureProjectDirs();
  const files = await fs.readdir(paths.dataDir);
  console.log("Files in dataDir:", files);
  
  // Read items.json or individual item files if any
  const itemsFile = path.join(paths.dataDir, "items.json");
  try {
    const data = await fs.readFile(itemsFile, "utf8");
    const items = JSON.parse(data);
    if (items && items.length > 0) {
      console.log("Found items. First item ID:", items[0].id);
      console.log("Visual source:", items[0].input?.visualSource);
      console.log("Avatar mode:", items[0].input?.avatarMode);
    } else {
      console.log("items.json is empty.");
    }
  } catch (err) {
    console.log("No items.json found or failed to read:", err.message);
  }
}

main().catch(console.error);
