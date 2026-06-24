import { spawn } from "node:child_process";
import path from "node:path";

const brainDir = "C:/Users/Asus/.gemini/antigravity/brain/cb42678a-eaaa-460a-aec4-afd2f8deda8c";

function scanImage(imagePath) {
  return new Promise((resolve) => {
    // 700x700 image
    const args = [
      "-i", imagePath,
      "-f", "rawvideo",
      "-pix_fmt", "rgb24",
      "pipe:1"
    ];
    const child = spawn("ffmpeg", args);
    let buf = Buffer.alloc(0);
    child.stdout.on("data", (data) => { buf = Buffer.concat([buf, data]); });
    child.on("close", (code) => {
      if (code === 0 && buf.length === 700 * 700 * 3) {
        let nonWhiteCount = 0;
        for (let i = 0; i < 700 * 700; i++) {
          const r = buf[i * 3];
          const g = buf[i * 3 + 1];
          const b = buf[i * 3 + 2];
          if (r !== 255 || g !== 255 || b !== 255) {
            nonWhiteCount++;
          }
        }
        resolve(nonWhiteCount);
      } else {
        resolve(-1);
      }
    });
  });
}

async function main() {
  const images = [
    "colorkey_0.15_0.08",
    "colorkey_0.20_0.08",
    "colorkey_0.25_0.08",
    "colorkey_0.30_0.08",
    "chromakey_0.15_0.10",
    "chromakey_0.20_0.10",
    "chromakey_0.25_0.10",
    "chromakey_0.30_0.10"
  ];

  console.log("Total non-white pixels in 700x700 image:");
  for (const name of images) {
    const imgPath = path.join(brainDir, `test_key_${name}.png`);
    const count = await scanImage(imgPath);
    console.log(`- ${name}: ${count} non-white pixels`);
  }
}

main().catch(console.error);
