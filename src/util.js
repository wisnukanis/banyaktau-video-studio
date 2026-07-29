import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

export async function safeWriteJson(file, value) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`;
  await fs.writeFile(tmp, `${JSON.stringify(value, null, 2)}\n`);

  for (let attempt = 1; attempt <= 10; attempt++) {
    try {
      await fs.rename(tmp, file);
      return;
    } catch (error) {
      if (["EPERM", "EBUSY", "EACCES"].includes(error.code) && attempt < 10) {
        await new Promise((r) => setTimeout(r, 100 * attempt));
      } else {
        try {
          await fs.copyFile(tmp, file);
          await fs.unlink(tmp).catch(() => {});
          return;
        } catch (copyErr) {
          if (attempt === 10) {
            await fs.unlink(tmp).catch(() => {});
            throw error;
          }
          await new Promise((r) => setTimeout(r, 100 * attempt));
        }
      }
    }
  }
}

export function createId(prefix = "tau") {
  return `${prefix}_${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`;
}

export function nowIso() {
  return new Date().toISOString();
}

export function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

export function cleanText(value, max = 2000) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (text.length <= max) return text;
  const sliced = text.slice(0, max).trim();
  const wordSafe = sliced.replace(/\s+\S*$/, "").trim();
  return wordSafe || sliced;
}

export function slugify(value) {
  return cleanText(value, 90)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "banyaktau";
}

export function safeFilename(value) {
  return slugify(value).slice(0, 70);
}

export function splitLines(value, maxChars = 34, maxLines = 4) {
  const words = cleanText(value, 500).split(" ").filter(Boolean);
  const lines = [];
  let line = "";
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (next.length > maxChars && line) {
      lines.push(line);
      line = word;
    } else {
      line = next;
    }
  }
  if (line) lines.push(line);
  return lines.slice(0, maxLines);
}
