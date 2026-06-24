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
      else reject(new Error(`FFmpeg error:\n${stderr}`));
    });
  });
}

async function getPixelData(imagePath) {
  return new Promise((resolve, reject) => {
    const args = ["-i", imagePath, "-f", "rawvideo", "-pix_fmt", "rgb24", "pipe:1"];
    const child = spawn("ffmpeg", args);
    let buf = Buffer.alloc(0);
    child.stdout.on("data", (data) => { buf = Buffer.concat([buf, data]); });
    child.on("close", (code) => {
      if (code === 0) resolve(buf);
      else reject(new Error("Failed to read image pixels"));
    });
  });
}

async function runTest(videoPath, name, cropFilter, keyColor, similarity) {
  const size = 700;
  const avatarSize = 420;
  
  const keyFilter = `colorkey=${keyColor}:${similarity}:0.08,despill=type=green`;
  const filterComplex = [
    `[1:v]${cropFilter},${keyFilter},scale=-1:${avatarSize},format=rgba[av]`,
    `[0:v][av]overlay=x=W-w-20:y=H-h-20[out]`
  ].join(";");

  const testImg = path.join(brainDir, `test_edge_${name}.png`);
  const args = [
    "-y",
    "-f", "lavfi", "-i", `color=white:s=${size}x${size}:d=1`,
    "-ss", "3.0", "-t", "1.0", "-i", videoPath,
    "-filter_complex", filterComplex,
    "-map", "[out]",
    "-vframes", "1",
    testImg
  ];

  await runFfmpeg(args);
  const pixels = await getPixelData(testImg);

  const w = Math.round(820 * 420 / 1080);
  const startX = size - w - 20;
  const endX = size - 20;
  const startY = size - avatarSize - 20;
  const endY = size - 20;

  const getPixel = (x, y) => {
    const idx = (y * size + x) * 3;
    return { r: pixels[idx], g: pixels[idx+1], b: pixels[idx+2] };
  };

  const isWhite = (p) => p.r === 255 && p.g === 255 && p.b === 255;

  let leftNonWhite = 0;
  for (let y = startY; y <= endY; y++) {
    const p = getPixel(startX, y);
    if (!isWhite(p)) {
      leftNonWhite++;
      if (leftNonWhite <= 20) {
        console.log(`    LeftEdge Noise at Y=${y}: RGB=(${p.r}, ${p.g}, ${p.b})`);
      }
    }
  }

  let topNonWhite = 0;
  for (let x = startX; x <= endX; x++) {
    if (!isWhite(getPixel(x, startY))) topNonWhite++;
  }

  let rightNonWhite = 0;
  for (let y = startY; y <= endY; y++) {
    if (!isWhite(getPixel(endX, y))) rightNonWhite++;
  }

  // Count pixels inside the capybara's expected bounding box
  const capyStartX = 399;
  const capyEndX = 618;
  const capyStartY = 302;
  const capyEndY = 668;
  let capyNonWhite = 0;
  for (let y = capyStartY; y <= capyEndY; y++) {
    for (let x = capyStartX; x <= capyEndX; x++) {
      if (!isWhite(getPixel(x, y))) capyNonWhite++;
    }
  }

  console.log(`\n=== Video: ${name} | Key: ${keyColor} | Similarity: ${similarity} ===`);
  console.log(`Overlay box: X=[${startX}..${endX}] | Y=[${startY}..${endY}]`);
  console.log(`- Left edge non-white pixels: ${leftNonWhite}`);
  console.log(`- Top edge non-white pixels: ${topNonWhite}`);
  console.log(`- Right edge non-white pixels: ${rightNonWhite}`);
  console.log(`- Capybara body non-white pixels: ${capyNonWhite}`);
}

async function main() {
  const avatars = [
    "avatar hijau 1.mp4",
    "avatar hijau 2.mp4",
    "avatar hijau 3.mp4"
  ];
  for (const name of avatars) {
    const videoPath = `C:/xampp/htdocs/videoasal/assets/avatar/${name}`;
    for (const sim of ["0.15", "0.16", "0.17", "0.18"]) {
      console.log(`\n=== Testing ${name} with similarity ${sim} ===`);
      await runTest(videoPath, name.replace(".mp4", "") + "_" + sim, "crop=820:1080:580:0", "0x3b9b4a", sim);
    }
  }
}

main().catch(console.error);
