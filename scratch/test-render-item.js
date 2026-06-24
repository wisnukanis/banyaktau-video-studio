import { requireItem, renderAndPersist } from "../src/pipeline.js";
import { saveItem } from "../src/storage.js";

async function main() {
  const itemId = "tau_0b4c72563491";
  console.log(`Loading item ${itemId}...`);
  const item = await requireItem(itemId);

  console.log("Updating avatar mode to avatar hijau 2.mp4...");
  item.input.avatarMode = "avatar hijau 2.mp4";
  item.input.videoFormat = "vertical";
  await saveItem(item);

  console.log("Starting render pipeline...");
  await renderAndPersist(item);
  console.log("Render completed successfully!");
}

main().catch(console.error);
