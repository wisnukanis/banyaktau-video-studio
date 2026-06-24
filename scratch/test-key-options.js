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

async function testKey(name, cropFilter, keyFilter) {
  const outputPath = path.join(brainDir, `test_opt_${name}.png`);
  // Overlay on a bright white background
  const filterComplex = [
    `[1:v]${cropFilter},${keyFilter},scale=-1:420,format=rgba[av]`,
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

  await runFfmpeg(args);
}

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
      if (code === 0 && buf.length === width * 3) {
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
  const cropOld = "crop=1240:1080:20:0";
  const cropNew = "crop=850:1080:540:0";

  console.log("Running keying option tests...");
  // Test 1: Old crop, current key (0.15)
  await testKey("1_current", cropOld, "colorkey=0x1f7328:0.15:0.08,despill=type=green");
  // Test 2: New crop, current key (0.15)
  await testKey("2_newcrop_0.15", cropNew, "colorkey=0x1f7328:0.15:0.08,despill=type=green");
  // Test 3: New crop, key (0.18)
  await testKey("3_newcrop_0.18", cropNew, "colorkey=0x1f7328:0.18:0.08,despill=type=green");

  // Let's scan a horizontal row at Y=280 to see if there are any non-white pixels near the left edge of the overlay
  // The overlay is at W-w-20.
  // For Test 1 (old crop, w=482): overlay starts at X=198. We scan X=190 to X=230.
  // For Test 2 & 3 (new crop, w=330): overlay starts at X=350. We scan X=340 to X=370.

  console.log("\nScanning Test 1 (Old Crop, 0.15 similarity):");
  const row1 = await scanRow(path.join(brainDir, "test_opt_1_current.png"), 280, 190, 230);
  const nw1 = row1.filter(p => p.r !== 255 || p.g !== 255 || p.b !== 255);
  console.log(`- Non-white pixels near left edge (X=[190..230]): ${nw1.length}`);
  if (nw1.length > 0) {
    console.log(`  First non-white: X=${nw1[0].x} Color=(${nw1[0].r}, ${nw1[0].g}, ${nw1[0].b})`);
  }

  console.log("\nScanning Test 2 (New Crop, 0.15 similarity):");
  const row2 = await scanRow(path.join(brainDir, "test_opt_2_newcrop_0.15.png"), 280, 340, 370);
  const nw2 = row2.filter(p => p.r !== 255 || p.g !== 255 || p.b !== 255);
  console.log(`- Non-white pixels near left edge (X=[340..370]): ${nw2.length}`);
  if (nw2.length > 0) {
    console.log(`  First non-white: X=${nw2[0].x} Color=(${nw2[0].r}, ${nw2[0].g}, ${nw2[0].b})`);
  }

  console.log("\nScanning Test 3 (New Crop, 0.18 similarity):");
  const row3 = await scanRow(path.join(brainDir, "test_opt_3_newcrop_0.18.png"), 280, 340, 370);
  const nw3 = row3.filter(p => p.r !== 255 || p.g !== 255 || p.b !== 255);
  console.log(`- Non-white pixels near left edge (X=[340..370]): ${nw3.length}`);
  if (nw3.length > 0) {
    console.log(`  First non-white: X=${nw3[0].x} Color=(${nw3[0].r}, ${nw3[0].g}, ${nw3[0].b})`);
  }
}

main().catch(console.error);
