import { spawn } from "node:child_process";
import path from "node:path";

const videoPath = "C:/xampp/htdocs/videoasal/generated/videos/tau_0b4c72563491-dinoiki-kenapa-nikola-tesla-tidur-cuma-sedikit.mp4";
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

async function main() {
  const outputPath = path.join(brainDir, "final_avatar_clean_frame.png");
  console.log("Extracting frame at ss=2.0s from final video...");
  
  const args = [
    "-y",
    "-ss", "2.0",
    "-i", videoPath,
    "-vframes", "1",
    outputPath
  ];

  await runFfmpeg(args);
  console.log("Frame extracted successfully to final_avatar_clean_frame.png");
}

main().catch(console.error);
