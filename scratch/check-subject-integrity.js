import { spawn } from "node:child_process";
import path from "node:path";

const brainDir = "C:/Users/Asus/.gemini/antigravity/brain/cb42678a-eaaa-460a-aec4-afd2f8deda8c";

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

async function checkIntegrity(similarity) {
  const imgPath = path.join(brainDir, `test_edge_sim_${similarity}.png`);
  let pixels;
  try {
    pixels = await getPixelData(imgPath);
  } catch (err) {
    console.log(`Failed to read similarity ${similarity}: ${err.message}`);
    return;
  }

  const size = 700;
  // Bounding box of the capybara on the 700x700 canvas.
  // In the crop=850:1080:550:0 case, crop width is 850, scale height is 420.
  // w = 331.
  // The overlay starts at x = 700 - 331 - 20 = 349.
  // So overlay occupies X = [349..680], Y = [260..680].
  // The capybara in avatar hijau 2.mp4 at ss=3s was in X_original = [678..1241], Y_original = [110..1049].
  // Cropped X: X_cropped = [678 - 550 .. 1241 - 550] = [128..691].
  // Scaled X: X_scaled = [128 * 0.3888 .. 691 * 0.3888] = [50..269].
  // Final X on canvas: X_final = 349 + [50..269] = [399..618].
  // Final Y on canvas: Y_final = 260 + [110 * 0.3888 .. 1049 * 0.3888] = [302..668].

  const startX = 399;
  const endX = 618;
  const startY = 302;
  const endY = 668;

  let nonWhiteCount = 0;
  for (let y = startY; y <= endY; y++) {
    for (let x = startX; x <= endX; x++) {
      const idx = (y * size + x) * 3;
      const r = pixels[idx];
      const g = pixels[idx+1];
      const b = pixels[idx+2];
      if (r !== 255 || g !== 255 || b !== 255) {
        nonWhiteCount++;
      }
    }
  }

  console.log(`Similarity ${similarity}: Total non-white pixels inside capybara bounding box = ${nonWhiteCount}`);
}

async function main() {
  await checkIntegrity("0.15");
  await checkIntegrity("0.18");
  await checkIntegrity("0.20");
  await checkIntegrity("0.22");
  await checkIntegrity("0.25");
}

main().catch(console.error);
