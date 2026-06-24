import { createKnowledgeDraft } from "../src/story-engine.js";

async function main() {
  console.log("=== VERIFYING AVATAR NORMALIZATION IN STORY ENGINE ===");
  
  const testInputs = [
    { topic: "Kenapa Langit Biru", avatarMode: "image" },
    { topic: "Cara Kerja Kapal Terbang", avatarMode: "" },
    { topic: "Sejarah Komputer Pertama", avatarMode: "video1" },
    { topic: "Rahasia Tubuh Manusia", avatarMode: "avatar hijau 2.mp4" }
  ];

  const allowedGreen = ["avatar hijau 1.mp4", "avatar hijau 2.mp4", "avatar hijau 3.mp4"];

  for (const input of testInputs) {
    const draft = await createKnowledgeDraft(input);
    const resolvedMode = draft.input.avatarMode;
    console.log(`Input mode: "${input.avatarMode || '(empty)'}" (Topic: "${input.topic}") -> Resolved mode: "${resolvedMode}"`);
    
    if (allowedGreen.includes(resolvedMode)) {
      console.log(`  SUCCESS: Correctly resolved to allowed green avatar!`);
    } else {
      console.error(`  ERROR: Resolved to non-green avatar: "${resolvedMode}"`);
    }
  }

  console.log("=== VERIFICATION COMPLETE ===");
}

main().catch(console.error);
