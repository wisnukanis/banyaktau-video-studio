import { spawn } from "node:child_process";
import path from "node:path";

function getBbox(videoPath, ss) {
  return new Promise((resolve) => {
    const args = [
      "-ss", String(ss),
      "-i", videoPath,
      "-frames:v", "1",
      "-f", "rawvideo",
      "-pix_fmt", "rgb24",
      "pipe:1"
    ];
    const child = spawn("ffmpeg", args);
    let buf = Buffer.alloc(0);
    child.stdout.on("data", (data) => { buf = Buffer.concat([buf, data]); });
    child.on("close", (code) => {
      if (code === 0 && buf.length === 1920 * 1080 * 3) {
        let minX = 1920, maxX = 0, minY = 1080, maxY = 0;
        for (let y = 0; y < 1080; y++) {
          for (let x = 0; x < 1920; x++) {
            const idx = (y * 1920 + x) * 3;
            const r = buf[idx];
            const g = buf[idx + 1];
            const b = buf[idx + 2];
            // If pixel is NOT green (g is not significantly larger than r and b)
            const isGreen = g > r + 20 && g > b + 20;
            if (!isGreen) {
              if (x < minX) minX = x;
              if (x > maxX) maxX = x;
              if (y < minY) minY = y;
              if (y > maxY) maxY = y;
            }
          }
        }
        resolve({ ss, minX, maxX, minY, maxY, width: maxX - minX, height: maxY - minY });
      } else {
        resolve(null);
      }
    });
  });
}

async function main() {
  const avatars = [
    "avatar hijau 1.mp4",
    "avatar hijau 2.mp4",
    "avatar hijau 3.mp4"
  ];

  for (const name of avatars) {
    const videoPath = path.join("C:/xampp/htdocs/videoasal/assets/avatar", name);
    console.log(`\n=== Bounding Box for ${name} ===`);
    let overallMinX = 1920, overallMaxX = 0;
    for (const ss of [1, 2, 3, 4, 5, 6, 7]) {
      const bbox = await getBbox(videoPath, ss);
      if (bbox && bbox.width > 0) {
        console.log(`  Time=${ss}s: X=[${bbox.minX}..${bbox.maxX}] (Width=${bbox.width}) | Y=[${bbox.minY}..${bbox.maxY}]`);
        if (bbox.minX < overallMinX) overallMinX = bbox.minX;
        if (bbox.maxX > overallMaxX) overallMaxX = bbox.maxX;
      } else {
        console.log(`  Time=${ss}s: No subect detected or failed`);
      }
    }
    console.log(`  Overall bounds for ${name}: X=[${overallMinX}..${overallMaxX}] (Width=${overallMaxX - overallMinX})`);
  }
}

main().catch(console.error);
