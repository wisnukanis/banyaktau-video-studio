import { spawn } from "node:child_process";
import path from "node:path";

const brainDir = "C:/Users/Asus/.gemini/antigravity/brain/cb42678a-eaaa-460a-aec4-afd2f8deda8c";

function scanRow(imagePath, y, startX, endX) {
  return new Promise((resolve) => {
    const width = endX - startX + 1;
    const args = [
      "-i", imagePath,
      "-vf", `crop=${width}:1:${startX}:${y}`,
      "-f", "rawvideo",
      "-pix_fmt", "rgb24",
      "pipe:1"
    ];
    const child = spawn("ffmpeg", args);
    let buf = Buffer.alloc(0);
    child.stdout.on("data", (data) => { buf = Buffer.concat([buf, data]); });
    child.on("close", (code) => {
      if (code === 0 && buf.length >= width * 3) {
        const row = [];
        for (let i = 0; i < width; i++) {
          row.push({
            x: startX + i,
            r: buf[i * 3],
            g: buf[i * 3 + 1],
            b: buf[i * 3 + 2]
          });
        }
        resolve(row);
      } else {
        resolve([]);
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

  console.log("Scanning row Y=300 for non-white pixels (detecting border boundaries):");
  for (const name of images) {
    const imgPath = path.join(brainDir, `test_key_${name}.png`);
    const row = await scanRow(imgPath, 300, 150, 680);
    const nonWhite = row.filter(p => p.r !== 255 || p.g !== 255 || p.b !== 255);
    if (nonWhite.length > 0) {
      const first = nonWhite[0];
      const last = nonWhite[nonWhite.length - 1];
      console.log(`- ${name}: Non-white starts at X=${first.x} (R=${first.r} G=${first.g} B=${first.b}) and ends at X=${last.x} (total non-white pixels: ${nonWhite.length})`);
    } else {
      console.log(`- ${name}: All pixels are pure white (empty canvas)`);
    }
  }
}

main().catch(console.error);
