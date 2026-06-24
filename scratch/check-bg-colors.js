import { spawn } from "node:child_process";

const avatarVideo = "C:/xampp/htdocs/videoasal/assets/avatar/avatar hijau 2.mp4";

async function getFramePixels(videoPath, ss = 3.0) {
  return new Promise((resolve, reject) => {
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
      if (code === 0 && buf.length === 1920 * 1080 * 3) resolve(buf);
      else reject(new Error("Failed to read frame pixels"));
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
    const videoPath = `C:/xampp/htdocs/videoasal/assets/avatar/${name}`;
    console.log(`\n=== Background colors for ${name} at Y=540 ===`);
    const pixels = await getFramePixels(videoPath);
    
    const sample = (x) => {
      const idx = (540 * 1920 + x) * 3;
      return {
        r: pixels[idx],
        g: pixels[idx + 1],
        b: pixels[idx + 2],
        hex: "#" + [pixels[idx], pixels[idx+1], pixels[idx+2]].map(v => v.toString(16).padStart(2, "0")).join("")
      };
    };

    for (const x of [550, 1300]) {
      const p = sample(x);
      console.log(`  X=${x}: RGB=(${p.r}, ${p.g}, ${p.b}) Hex=${p.hex}`);
    }
  }
}

main().catch(console.error);
