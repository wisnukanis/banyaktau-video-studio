import fs from "node:fs/promises";
import path from "node:path";
import { paths } from "../src/config.js";

// Replicate the lookup logic from src/render.js
async function findBackgroundMusic(category = "") {
  const normCategory = String(category || "").toLowerCase().trim().replace(/\s+/g, "_");
  const candidates = [];
  
  if (normCategory) {
    candidates.push(path.join(paths.rootDir, "assets", "music", `${normCategory}.m4a`));
    candidates.push(path.join(paths.rootDir, "assets", "music", `${normCategory}.mp3`));
  }
  
  candidates.push(
    process.env.BANYAKTAU_MUSIC_PATH,
    path.join(paths.rootDir, "assets", "music", "eksplorasi-literasi.m4a"),
    path.join(paths.rootDir, "assets", "music", "eksplorasi-literasi.mp3")
  );

  const cleanCandidates = candidates.filter(Boolean);
  for (const candidate of cleanCandidates) {
    try {
      await fs.access(candidate);
      return candidate;
    } catch {
      // Try next candidate.
    }
  }
  return "";
}

const categories = [
  "sains",
  "penemuan",
  "sejarah",
  "tubuh manusia",
  "alam semesta",
  "teknologi",
  "benda sehari-hari",
  "tokoh dunia"
];

async function main() {
  console.log("=== VERIFYING BACKGROUND MUSIC AUTO-SELECTION ===");
  
  for (const cat of categories) {
    const musicPath = await findBackgroundMusic(cat);
    const relativePath = path.relative(paths.rootDir, musicPath);
    console.log(`Category: "${cat}" -> Resolved Music: ${relativePath}`);
    
    if (relativePath.includes("eksplorasi-literasi")) {
      console.error(`  ERROR: Failed to resolve custom music for "${cat}", fell back to default.`);
    } else {
      console.log(`  SUCCESS: Resolved custom track!`);
    }
  }

  console.log("=== VERIFICATION COMPLETE ===");
}

main().catch(console.error);
