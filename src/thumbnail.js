import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { paths } from "./config.js";
import { safeFilename } from "./util.js";

export async function generateThumbnail(item) {
  await fs.mkdir(paths.thumbnailDir, { recursive: true });
  const images = (item.assets?.images || []).filter((image) => image.path).slice(0, 1);
  if (!images.length) throw new Error("Gambar belum tersedia untuk thumbnail.");

  const filename = `${item.id}-thumbnail-${safeFilename(item.title)}.jpg`;
  const outputPath = path.join(paths.thumbnailDir, filename);
  const titleLines = fitLines(shortTitle(item.title || item.plan?.hook || "BanyakTau"), {
    maxChars: 15,
    maxLines: 4
  });
  const titleSize = titleFontSize(titleLines);
  const titleY = titleLines.length > 3 ? 1060 : 1130;
  const titleStep = titleSize + 12;
  const textFilters = [
    ...drawLineFilters(titleLines, {
      x: 72,
      y: titleY,
      step: titleStep,
      fontsize: titleSize,
      color: "white",
      borderw: 5
    })
  ];
  const logoPath = path.join(paths.publicDir, "assets", "banyaktau-logo-watermark.png");
  const hasLogo = fsSync.existsSync(logoPath);
  const filter = [
    "[0:v]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,eq=contrast=1.10:saturation=1.08:brightness=-0.012[hero]",
    "[hero]drawbox=x=0:y=0:w=1080:h=1920:color=black@0.08:t=fill[shade]",
    "[shade]drawbox=x=0:y=940:w=1080:h=980:color=black@0.54:t=fill[base]",
    hasLogo ? "[1:v]scale=245:-1,format=rgba,colorchannelmixer=aa=0.78[wm]" : "",
    hasLogo ? "[base][wm]overlay=x=W-w-42:y=36[marked]" : "",
    [
      `${hasLogo ? "[marked]" : "[base]"}drawbox=x=72:y=${titleY - 36}:w=124:h=12:color=0xF5C84C@1:t=fill`,
      ...textFilters
    ].join(",")
  ].filter(Boolean).join(";");

  const args = [
    "-y",
    "-i", images[0].path,
    ...(hasLogo ? ["-i", logoPath] : []),
    "-filter_complex", filter,
    "-frames:v", "1",
    "-q:v", "2",
    outputPath
  ];

  await runFfmpeg(args);

  return {
    path: outputPath,
    url: `/generated/thumbnails/${filename}`,
    provider: "ffmpeg-collage"
  };
}

function drawLineFilters(lines, options) {
  return lines.map((line, index) => (
    `drawtext=${fontExpr()}:text='${drawtextEscape(line)}':fontcolor=${options.color}:fontsize=${options.fontsize}:bordercolor=black:borderw=${options.borderw}:x=${options.x}:y=${options.y + index * options.step}`
  ));
}

function fitLines(value, options) {
  const words = cleanDisplayText(value).split(" ").filter(Boolean);
  const lines = [];
  let line = "";
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (next.length > options.maxChars && line) {
      lines.push(line);
      line = word;
    } else {
      line = next;
    }
  }
  if (line) lines.push(line);

  const limited = lines.slice(0, options.maxLines);
  if (lines.length > options.maxLines) {
    limited[limited.length - 1] = limited[limited.length - 1].replace(/[.,!?]+$/g, "");
  }
  return limited;
}

function titleFontSize(lines) {
  const longest = Math.max(...lines.map((line) => line.length), 1);
  if (lines.length >= 4 || longest > 16) return 88;
  if (lines.length === 3 || longest > 13) return 102;
  return 118;
}

function fontExpr() {
  const fontPath = findScholarFont() || (process.platform === "win32"
    ? "C\\:/Windows/Fonts/arialbd.ttf"
    : "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf");
  return `fontfile='${fontPath}'`;
}

function findScholarFont() {
  const candidates = process.platform === "win32"
    ? [
        "C:/Users/Lenovo/AppData/Local/Microsoft/Windows/Fonts/scholar-regular.otf",
        "C:/Users/Lenovo/AppData/Local/Microsoft/Windows/Fonts/scholar-italic.otf",
        path.join(paths.publicDir, "assets", "fonts", "scholar-regular.otf").replace(/\\/g, "/"),
        "C:/Windows/Fonts/Scholar.ttf",
        "C:/Windows/Fonts/Scholar-Regular.ttf",
        "C:/Windows/Fonts/Scholar-Bold.ttf",
        "C:/Windows/Fonts/scholar.ttf",
        "C:/Windows/Fonts/scholarb.ttf"
      ]
    : [
        "/usr/share/fonts/truetype/scholar/Scholar.ttf",
        "/usr/share/fonts/truetype/scholar/Scholar-Bold.ttf"
      ];
  return candidates.find((candidate) => fsSync.existsSync(candidate))?.replace(/:/g, "\\:");
}

function shortTitle(value) {
  return cleanDisplayText(value)
    .replace(/\b(gimana|sih|kok|dong)\b/gi, "")
    .trim()
    .replace(/[?.!]+$/g, "");
}

function cleanDisplayText(value) {
  return String(value || "")
    .replace(/[^\p{L}\p{N}\s.,?!-]/gu, "")
    .replace(/\s+/g, " ")
    .trim();
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
