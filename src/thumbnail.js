import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { paths } from "./config.js";
import { safeFilename, splitLines } from "./util.js";

export async function generateThumbnail(item) {
  await fs.mkdir(paths.thumbnailDir, { recursive: true });
  const images = (item.assets?.images || []).filter((image) => image.path).slice(0, 4);
  if (!images.length) throw new Error("Gambar belum tersedia untuk thumbnail.");
  while (images.length < 4) images.push(images[images.length % Math.max(1, images.length)]);

  const filename = `${item.id}-thumbnail-${safeFilename(item.title)}.jpg`;
  const outputPath = path.join(paths.thumbnailDir, filename);
  const title = splitLines(item.title || item.plan?.hook || "BanyakTau", 18, 4).join("\n");
  const hook = splitLines(item.plan?.hook || "", 28, 2).join("\n");
  const filter = [
    "[0:v]scale=540:960:force_original_aspect_ratio=increase,crop=540:960[a]",
    "[1:v]scale=540:960:force_original_aspect_ratio=increase,crop=540:960[b]",
    "[2:v]scale=540:960:force_original_aspect_ratio=increase,crop=540:960[c]",
    "[3:v]scale=540:960:force_original_aspect_ratio=increase,crop=540:960[d]",
    "[a][b][c][d]xstack=inputs=4:layout=0_0|540_0|0_960|540_960[grid]",
    "[grid]eq=contrast=1.08:saturation=1.08:brightness=-0.02[base]",
    "[base]drawbox=x=0:y=0:w=1080:h=1920:color=black@0.20:t=fill[shade]",
    `[shade]drawbox=x=54:y=1120:w=972:h=520:color=black@0.70:t=fill,drawtext=${fontExpr()}:text='${drawtextEscape(title)}':fontcolor=white:fontsize=82:line_spacing=10:bordercolor=black:borderw=5:x=74:y=1170,drawtext=${fontExpr()}:text='${drawtextEscape(hook)}':fontcolor=0xF4C15D:fontsize=38:line_spacing=8:bordercolor=black:borderw=3:x=78:y=1515,drawtext=${fontExpr()}:text='BANYAKTAU':fontcolor=white:fontsize=34:bordercolor=black:borderw=3:x=74:y=92`
  ].join(";");

  await runFfmpeg([
    "-y",
    "-i", images[0].path,
    "-i", images[1].path,
    "-i", images[2].path,
    "-i", images[3].path,
    "-filter_complex", filter,
    "-frames:v", "1",
    "-q:v", "2",
    outputPath
  ]);

  return {
    path: outputPath,
    url: `/generated/thumbnails/${filename}`,
    provider: "ffmpeg-collage"
  };
}

function fontExpr() {
  const fontPath = process.platform === "win32"
    ? "C\\:/Windows/Fonts/arialbd.ttf"
    : "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf";
  return `fontfile='${fontPath}'`;
}

function drawtextEscape(value) {
  return String(value || "")
    .replace(/\\/g, "\\\\")
    .replace(/:/g, "\\:")
    .replace(/'/g, "\\'")
    .replace(/\r?\n/g, "\\n");
}

function runFfmpeg(args) {
  return new Promise((resolve, reject) => {
    const child = spawn("ffmpeg", args, { windowsHide: true, cwd: paths.rootDir });
    let stderr = "";
    child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(stderr || `ffmpeg thumbnail gagal (${code})`));
    });
  });
}
