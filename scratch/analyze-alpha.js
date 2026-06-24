import { spawn } from "node:child_process";

const avatarVideo = "C:/xampp/htdocs/videoasal/assets/avatar/avatar hijau 2.mp4";

function analyzeAlpha(keyFilter) {
  return new Promise((resolve) => {
    // Crop, scale, key, and output raw alpha values (1 byte per pixel)
    const args = [
      "-ss", "4.0", "-t", "0.1",
      "-i", avatarVideo,
      "-vf", `crop=1240:1080:20:0,${keyFilter},scale=-1:420,format=rgba,alphaextract`,
      "-frames:v", "1",
      "-f", "rawvideo",
      "-pix_fmt", "gray",
      "pipe:1"
    ];
    const child = spawn("ffmpeg", args);
    let buf = Buffer.alloc(0);
    child.stdout.on("data", (data) => { buf = Buffer.concat([buf, data]); });
    child.on("close", (code) => {
      if (code === 0 && buf.length > 0) {
        let zero = 0, semi = 0, full = 0;
        for (let i = 0; i < buf.length; i++) {
          const a = buf[i];
          if (a === 0) zero++;
          else if (a === 255) full++;
          else semi++;
        }
        resolve({ total: buf.length, zero, semi, full });
      } else {
        resolve(null);
      }
    });
  });
}

async function main() {
  const tests = [
    ["colorkey_0.15_0.08", "colorkey=0x1f7328:0.15:0.08,despill=type=green"],
    ["colorkey_0.20_0.08", "colorkey=0x1f7328:0.20:0.08,despill=type=green"],
    ["colorkey_0.25_0.08", "colorkey=0x1f7328:0.25:0.08,despill=type=green"],
    ["colorkey_0.30_0.08", "colorkey=0x1f7328:0.30:0.08,despill=type=green"],
    ["colorkey_0.35_0.08", "colorkey=0x1f7328:0.35:0.08,despill=type=green"]
  ];

  console.log("Analyzing alpha channels for different colorkey similarities:");
  for (const [name, filter] of tests) {
    const res = await analyzeAlpha(filter);
    if (res) {
      const opaquePct = ((res.full / res.total) * 100).toFixed(1);
      const transPct = ((res.zero / res.total) * 100).toFixed(1);
      const semiPct = ((res.semi / res.total) * 100).toFixed(1);
      console.log(`- ${name}: Total Pixels=${res.total} | Transparent(Alpha=0)=${res.zero} (${transPct}%) | Semi(1-254)=${res.semi} (${semiPct}%) | Opaque(Alpha=255)=${res.full} (${opaquePct}%)`);
    } else {
      console.log(`- ${name}: Failed`);
    }
  }
}

main().catch(console.error);
