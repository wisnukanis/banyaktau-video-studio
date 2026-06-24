import { spawn } from "node:child_process";
import path from "node:path";

const brainDir = "C:/Users/Asus/.gemini/antigravity/brain/cb42678a-eaaa-460a-aec4-afd2f8deda8c";

function getPixel(imagePath, x, y) {
  return new Promise((resolve) => {
    const args = [
      "-i", imagePath,
      "-vf", `crop=1:1:${x}:${y}`,
      "-f", "rawvideo",
      "-pix_fmt", "rgb24",
      "pipe:1"
    ];
    const child = spawn("ffmpeg", args);
    let buf = Buffer.alloc(0);
    child.stdout.on("data", (data) => { buf = Buffer.concat([buf, data]); });
    child.on("close", (code) => {
      if (code === 0 && buf.length >= 3) {
        resolve({ r: buf[0], g: buf[1], b: buf[2] });
      } else {
        resolve(null);
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

  console.log("Sampling pixel at X=210, Y=270 (inside avatar frame boundary, should be 255,255,255):");
  for (const name of images) {
    const imgPath = path.join(brainDir, `test_key_${name}.png`);
    const pixel = await getPixel(imgPath, 210, 270);
    if (pixel) {
      const isWhite = pixel.r === 255 && pixel.g === 255 && pixel.b === 255;
      console.log(`- ${name}: R=${pixel.r} G=${pixel.g} B=${pixel.b} -> ${isWhite ? "SUCCESS (Transparent)" : "FAILED (Faint Box)"}`);
    } else {
      console.log(`- ${name}: Failed to read`);
    }
  }
}

main().catch(console.error);
