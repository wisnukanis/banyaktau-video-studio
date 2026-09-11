import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { paths } from "./config.js";
import { safeFilename } from "./util.js";

export async function generateThumbnail(item) {
  await fs.mkdir(paths.thumbnailDir, { recursive: true });
  const media = [
    ...(item.assets?.images || []).filter((image) => image.path),
    ...(item.assets?.clips || []).filter((clip) => clip.path)
  ].slice(0, 1);
  if (!media.length) throw new Error("Visual belum tersedia untuk thumbnail.");

  const isHorizontal = item.input?.videoFormat === "horizontal" || Boolean(item.input?.longForm);
  const filename = `${item.id}-thumbnail-${safeFilename(item.title)}.jpg`;
  const outputPath = path.join(paths.thumbnailDir, filename);

  const isVideo = media[0].path.toLowerCase().endsWith(".mp4");
  const inputArgs = isVideo ? ["-ss", "00:00:01.0", "-i", media[0].path] : ["-i", media[0].path];

  let filter = "";

  if (isHorizontal) {
    // Format 16:9 YouTube Widescreen (1920x1080)
    const titleLines = fitLines(shortTitle(item.title || item.plan?.hook || "BanyakTau").toUpperCase(), {
      maxChars: 18,
      maxLines: 3
    });
    const titleSize = titleFontSizeHorizontal(titleLines);
    const titleY = 320;
    const titleStep = titleSize + 22;
    const badgeCategory = cleanDisplayText(item.input?.category || "BANYAKTAU").toUpperCase();

    const textFilters = [
      `drawtext=${thumbnailFontExpr()}:text='${drawtextEscape(badgeCategory)}':fontcolor=0xF5C84C:fontsize=36:bordercolor=black:borderw=5:x=74:y=180`,
      ...drawLineFilters(titleLines, {
        x: 74,
        y: titleY,
        step: titleStep,
        fontsize: titleSize,
        colors: ["0xFFD700", "0xFFFFFF", "0xFFD700"],
        borderw: 8
      })
    ];

    filter = [
      "[0:v]scale=1920:1080:force_original_aspect_ratio=increase,crop=1920:1080,eq=contrast=1.15:saturation=1.15:brightness=-0.02[hero]",
      "[hero]drawbox=x=0:y=0:w=1120:h=1080:color=black@0.65:t=fill[panel]",
      "[panel]drawbox=x=0:y=0:w=16:h=1080:color=0xF5C84C@1:t=fill[border_l]",
      "[border_l]drawbox=x=74:y=245:w=180:h=10:color=0xF5C84C@1:t=fill[accent]",
      `[accent]${textFilters.join(",")}`
    ].filter(Boolean).join(";");
  } else {
    // Format 9:16 Shorts/Reels Vertikal (1080x1920)
    const titleLines = fitLines(shortTitle(item.title || item.plan?.hook || "BanyakTau"), {
      maxChars: 14,
      maxLines: 4
    });
    const titleSize = titleFontSize(titleLines);
    const titleY = titleLines.length > 3 ? 1140 : 1220;
    const titleStep = titleSize + 14;
    const textFilters = [
      ...drawLineFilters(titleLines, {
        x: 74,
        y: titleY,
        step: titleStep,
        fontsize: titleSize,
        color: "0xFFF6D7",
        borderw: 6
      })
    ];

    filter = [
      "[0:v]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,eq=contrast=1.12:saturation=1.10:brightness=-0.01[hero]",
      "[hero]drawbox=x=0:y=980:w=1080:h=940:color=black@0.64:t=fill[panel]",
      "[panel]drawbox=x=0:y=980:w=1080:h=10:color=0xF5C84C@1:t=fill[accent]",
      "[accent]drawbox=x=74:y=1052:w=156:h=12:color=0xF5C84C@1:t=fill[base]",
      `[base]${textFilters.join(",")}`
    ].filter(Boolean).join(";");
  }

  const args = [
    "-y",
    ...inputArgs,
    "-filter_complex", filter,
    "-frames:v", "1",
    "-q:v", "2",
    outputPath
  ];

  await runFfmpeg(args);

  return {
    path: outputPath,
    url: `/generated/thumbnails/${filename}`,
    provider: "ffmpeg-collage",
    aspectRatio: isHorizontal ? "16:9" : "9:16"
  };
}

function drawLineFilters(lines, options) {
  return lines.map((line, index) => {
    const color = Array.isArray(options.colors)
      ? (options.colors[index % options.colors.length] || "0xFFF6D7")
      : (options.color || "0xFFF6D7");
    return `drawtext=${thumbnailFontExpr()}:text='${drawtextEscape(line)}':fontcolor=${color}:fontsize=${options.fontsize}:bordercolor=black:borderw=${options.borderw || 6}:x=${options.x}:y=${options.y + index * options.step}`;
  });
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

function titleFontSizeHorizontal(lines) {
  const longest = Math.max(...lines.map((line) => line.length), 1);
  if (lines.length >= 3 || longest > 18) return 98;
  if (lines.length === 2 || longest > 14) return 110;
  return 122;
}

function thumbnailFontExpr() {
  const candidates = process.platform === "win32"
    ? [
        "C:/Windows/Fonts/impact.ttf",
        "C:/Windows/Fonts/arialbd.ttf",
        "C:/Windows/Fonts/seguiemb.ttf"
      ]
    : [
        "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
        "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf"
      ];
  const found = candidates.find((c) => fsSync.existsSync(c))?.replace(/:/g, "\\:");
  if (found) return `fontfile='${found}'`;
  return fontExpr();
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
        path.join(paths.publicDir, "assets", "fonts", "scholar-regular.otf").replace(/\\/g, "/"),
        path.join(paths.publicDir, "assets", "fonts", "scholar-italic.otf").replace(/\\/g, "/"),
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
