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

export function splitLines(value, maxChars = 34, maxLines = 0) {
  const words = cleanText(value, 1000).split(" ").filter(Boolean);
  if (!words.length) return [];
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

  if (maxLines > 0 && lines.length > maxLines) {
    const head = lines.slice(0, maxLines - 1);
    const tail = lines.slice(maxLines - 1).join(" ");
    return [...head, tail];
  }
  return lines;
}

export function extractKeywordHighlight(narration, screenText = "") {
  const text = String(narration || "").trim();
  if (!text) return "";

  // 1. Prioritaskan angka, statistik, tahun, atau satuan numerik
  const numMatch = text.match(/\b\d+[\d.,]*\s*(?:tahun|meter|km|derajat|kg|ton|persen|%|ribu|juta|miliar|sm|masehi)?\b/i);
  if (numMatch && numMatch[0].length >= 2) {
    return numMatch[0].trim();
  }

  // 2. Cocokkan kata penting dari screenText jika muncul dalam narasi
  if (screenText) {
    const cleanSc = String(screenText).replace(/[^\w\s]/g, " ").trim();
    const scWords = cleanSc.split(/\s+/).filter((w) => w.length >= 4);
    for (const w of scWords) {
      const idx = text.toLowerCase().indexOf(w.toLowerCase());
      if (idx !== -1) {
        const words = text.split(/\s+/);
        const wIdx = words.findIndex((item) => item.toLowerCase().includes(w.toLowerCase()));
        if (wIdx !== -1) {
          const start = Math.max(0, wIdx);
          const end = Math.min(words.length, wIdx + 2);
          return words.slice(start, end).join(" ").replace(/[.,!?;:]+$/g, "");
        }
      }
    }
  }

  // 3. Cari kata benda / istilah spesifik (bukan stopword)
  const stopWords = new Set([
    "yang", "untuk", "pada", "dengan", "adalah", "seperti", "karena", "tetapi", "namun",
    "mereka", "kita", "kamu", "bisa", "akan", "telah", "sudah", "dalam", "bahwa", "tidak",
    "bukan", "hanya", "sangat", "lebih", "selalu", "sering", "secara", "tentang", "ketika", "saat",
    "yaitu", "yakni", "selain", "hingga", "sampai", "kemudian", "bahkan"
  ]);

  const words = text.split(/\s+/).filter(Boolean);
  const candidates = words.filter((w) => {
    const clean = w.replace(/[^\w]/g, "").toLowerCase();
    return clean.length >= 4 && !stopWords.has(clean);
  });

  if (candidates.length > 0) {
    const chosen = candidates[0].replace(/[.,!?;:]+$/g, "");
    const chosenIdx = words.findIndex((w) => w.includes(chosen));
    if (chosenIdx !== -1) {
      const nextWord = words[chosenIdx + 1] ? words[chosenIdx + 1].replace(/[.,!?;:]+$/g, "") : "";
      if (nextWord && !stopWords.has(nextWord.toLowerCase()) && nextWord.length >= 3) {
        return `${chosen} ${nextWord}`;
      }
    }
    return chosen;
  }

  return "";
}
