import { spawn } from "node:child_process";
import path from "node:path";

const avatarVideo = "C:/xampp/htdocs/videoasal/assets/avatar/avatar hijau 2.mp4";
const brainDir = "C:/Users/Asus/.gemini/antigravity/brain/cb42678a-eaaa-460a-aec4-afd2f8deda8c";

function runFfmpeg(args) {
  return new Promise((resolve, reject) => {
    const child = spawn("ffmpeg", args);
    let stderr = "";
    child.stderr.on("data", (data) => stderr += data.toString());
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`FFmpeg error (code ${code}):\n${stderr.slice(-1000)}`));
    });
  });
}

async function testKey(name, keyFilter) {
  const outputPath = path.join(brainDir, `test_key_${name}.png`);
  // Overlay on a bright white background to clearly expose any faint dark frames/shadows
  const filterComplex = [
    `[1:v]crop=1240:1080:20:0,${keyFilter},scale=-1:420,format=rgba[av]`,
    `[0:v][av]overlay=x=W-w-20:y=H-h-20[out]`
  ].join(";");

  const args = [
    "-y",
    "-f", "lavfi", "-i", "color=white:s=700x700:d=1",
    "-ss", "4.0", "-t", "1.0", "-i", avatarVideo,
    "-filter_complex", filterComplex,
    "-map", "[out]",
    "-vframes", "1",
    outputPath
  ];

  try {
    await runFfmpeg(args);
    console.log(`[OK] ${name} -> test_key_${name}.png`);
  } catch (error) {
    console.error(`[FAIL] ${name}: ${error.message}`);
  }
}

async function main() {
  console.log("=== Testing different key parameters on WHITE background ===");
  const tests = [
    ["colorkey_0.15_0.08", "colorkey=0x1f7328:0.15:0.08,despill=type=green"],
    ["colorkey_0.20_0.08", "colorkey=0x1f7328:0.20:0.08,despill=type=green"],
    ["colorkey_0.25_0.08", "colorkey=0x1f7328:0.25:0.08,despill=type=green"],
    ["colorkey_0.30_0.08", "colorkey=0x1f7328:0.30:0.08,despill=type=green"],
    ["chromakey_0.15_0.10", "chromakey=0x1f7328:0.15:0.10,despill=type=green"],
    ["chromakey_0.20_0.10", "chromakey=0x1f7328:0.20:0.10,despill=type=green"],
    ["chromakey_0.25_0.10", "chromakey=0x1f7328:0.25:0.10,despill=type=green"],
    ["chromakey_0.30_0.10", "chromakey=0x1f7328:0.30:0.10,despill=type=green"],
  ];

  for (const [name, filter] of tests) {
    await testKey(name, filter);
  }
  console.log("Done!");
}

main().catch(console.error);
