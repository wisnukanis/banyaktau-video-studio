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

  const fontPath = thumbnailFontPath();
  const badgeCategory = cleanDisplayText(item.input?.category || "BANYAKTAU").toUpperCase();
  const hookText = extractThumbnailHook(item);
  const { line1, line2 } = splitHookLines(hookText);
  const subtitleContext = shortSubtitle(item.title || item.plan?.hook || "FAKTA MENGEJUTKAN");

  // Otomatis memilih layout terbaik secara dinamis & variatif per video
  const hash = Math.abs(hashString(item.id || item.title || "default"));
  const chosenLayout = isHorizontal
    ? (hash % 2 === 0 ? "cinematic-gradient" : "boxcard-viral")
    : "vertical-cinematic";

  let filter = "";
  let lavfiGrad = "";

  if (isHorizontal) {
    // Format 16:9 YouTube Widescreen: Gaya Viral Colossal 3D (Bersih, Teks Raksasa 3D Melayang & Gradasi Halus)
    lavfiGrad = "gradients=s=1920x1080:c0=black@0.86:c1=black@0.0:x0=0:y0=0:x1=1180:y1=0";
    const size1 = colossalFontSize(line1, 210);
    const size2 = colossalFontSize(line2, 160);
    const y1 = 200;
    const y2 = y1 + size1 + 25;
    const y3 = y2 + size2 + 40;

    filter = [
      "[0:v]scale=1920:1080:force_original_aspect_ratio=increase,crop=1920:1080,eq=contrast=1.18:saturation=1.22:brightness=-0.02[hero]",
      "[1:v]format=rgba[grad]",
      "[hero][grad]overlay=0:0[bg]",
      // Word 1: Raksasa Kuning Neon (3D shadow + 12px border)
      `[bg]drawtext=fontfile='${fontPath}':text='${drawtextEscape(line1)}':fontcolor=0xFFE600:fontsize=${size1}:bordercolor=black:borderw=12:shadowcolor=black@0.92:shadowx=10:shadowy=10:x=90:y=${y1}[w1]`,
      // Word 2: Raksasa Putih Bersih (3D shadow + 11px border)
      `[w1]drawtext=fontfile='${fontPath}':text='${drawtextEscape(line2)}':fontcolor=0xFFFFFF:fontsize=${size2}:bordercolor=black:borderw=11:shadowcolor=black@0.92:shadowx=9:shadowy=9:x=90:y=${y2}[w2]`,
      // Word 3: Subtitle Konteks Kuning Rapi
      `[w2]drawtext=fontfile='${fontPath}':text='${drawtextEscape(subtitleContext)}!':fontcolor=0xFFE600:fontsize=48:bordercolor=black:borderw=5:shadowcolor=black@0.85:shadowx=5:shadowy=5:x=95:y=${y3}`
    ].join(";");
  } else {
    // Format 9:16 Shorts/Reels Vertikal (1080x1920) dengan Smooth Bottom Gradient (hanya separuh bawah y:960..1920)
    lavfiGrad = "gradients=s=1080x960:c0=black@0.0:c1=black@0.85:x0=0:y0=0:x1=0:y1=960";
    filter = [
      "[0:v]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,eq=contrast=1.15:saturation=1.15:brightness=-0.02[hero]",
      "[1:v]format=rgba[grad]",
      "[hero][grad]overlay=0:960[bg]",
      "[bg]drawbox=x=74:y=1080:w=220:h=48:color=0xFFE600@1:t=fill[tagbox]",
      `[tagbox]drawtext=fontfile='${fontPath}':text='${drawtextEscape(badgeCategory)}':fontcolor=black:fontsize=26:borderw=0:x=94:y=1091[tagtext]`,
      `[tagtext]drawtext=fontfile='${fontPath}':text='${drawtextEscape(line1)}':fontcolor=0xFFFFFF:fontsize=110:bordercolor=black:borderw=7:shadowcolor=black@0.9:shadowx=5:shadowy=5:x=74:y=1170[l1]`,
      `[l1]drawtext=fontfile='${fontPath}':text='${drawtextEscape(line2)}':fontcolor=0xFFE600:fontsize=120:bordercolor=black:borderw=8:shadowcolor=black@0.9:shadowx=6:shadowy=6:x=74:y=1300[l2]`,
      `[l2]drawbox=x=74:y=1460:w=440:h=50:color=0xDD1122@0.95:t=fill[subpill]`,
      `[subpill]drawtext=fontfile='${fontPath}':text='${drawtextEscape(subtitleContext)}':fontcolor=white:fontsize=26:bordercolor=black:borderw=2:x=94:y=1472`
    ].join(";");
  }

  const args = [
    "-y",
    ...inputArgs,
    "-f", "lavfi",
    "-i", lavfiGrad,
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
    layout: chosenLayout,
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

function colossalFontSize(text, defaultSize = 210) {
  const len = String(text || "").length;
  if (len <= 5) return defaultSize;
  if (len <= 8) return Math.round(defaultSize * 0.86);
  if (len <= 11) return Math.round(defaultSize * 0.74);
  return Math.round(defaultSize * 0.64);
}

function thumbnailFontPath() {
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
  if (found) return found;
  return fontPathFallback();
}

function fontPathFallback() {
  const scholar = findScholarFont();
  if (scholar) return scholar;
  return process.platform === "win32"
    ? "C\\:/Windows/Fonts/arialbd.ttf"
    : "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf";
}

export function extractThumbnailHook(item) {
  if (item.plan?.thumbnailHook && item.plan.thumbnailHook.trim().length > 3) {
    return cleanDisplayText(item.plan.thumbnailHook).toUpperCase();
  }

  const raw = cleanDisplayText(item.plan?.hook || item.title || "BanyakTau");
  const stopWords = new Set([
    "gimana", "sih", "kok", "dong", "nih", "lah", "deh", "kan",
    "yang", "di", "ke", "dari", "untuk", "pada", "dalam", "dan", "atau", "dengan",
    "ini", "itu", "bisa", "adalah", "karena", "saat", "jika", "akan", "tapi", "secara",
    "menurut", "seperti", "sudah", "belum", "hanya", "oleh", "tentang"
  ]);

  const words = raw
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2 && !stopWords.has(w.toLowerCase()));

  if (words.length >= 4) {
    return `${words[0]} ${words[1]} ${words[2]} ${words[3]}`.toUpperCase();
  }
  if (words.length >= 2) {
    return words.slice(0, 3).join(" ").toUpperCase();
  }
  return (words[0] || "FAKTA MENGEJUTKAN").toUpperCase();
}

function splitHookLines(hookText) {
  const words = hookText.trim().split(/\s+/).filter(Boolean);
  if (words.length <= 2) {
    return {
      line1: words[0] || "FAKTA",
      line2: words[1] ? (words[1] + (/[?!]$/.test(words[1]) ? "" : "!")) : "MENGEJUTKAN!"
    };
  }
  const mid = Math.ceil(words.length / 2);
  const l1 = words.slice(0, mid).join(" ");
  let l2 = words.slice(mid).join(" ");
  if (!/[?!]$/.test(l2)) {
    l2 += "!";
  }
  return { line1: l1, line2: l2 };
}

function shortSubtitle(title) {
  return cleanDisplayText(title)
    .replace(/[^\p{L}\p{N}\s-]/gu, " ")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 5)
    .join(" ")
    .toUpperCase();
}

function hashString(str) {
  let hash = 0;
  const s = String(str || "");
  for (let i = 0; i < s.length; i++) {
    hash = (hash << 5) - hash + s.charCodeAt(i);
    hash |= 0;
  }
  return hash;
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
