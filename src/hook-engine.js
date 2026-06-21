import { cleanText, clamp } from "./util.js";

// Pola hook biar variasinya nggak monoton & otomatis nyambung ke tiap topik/kategori
const HOOK_PATTERNS = [
  {
    id: "curiosity_gap",
    instruction: "Buka loop penasaran tanpa jawab langsung — bikin orang harus nonton biar tahu jawabannya."
  },
  {
    id: "shock_contrast",
    instruction: "Pasangkan dua hal yang kelihatan kontradiktif dari topik ini (contoh: kecil tapi berdampak besar, biasa tapi rumit di baliknya)."
  },
  {
    id: "relatable_question",
    instruction: "Mulai dari pengalaman/benda sehari-hari yang familiar, baru disambungkan ke topik."
  }
];

// Frasa generik/lebay yang harus dihindari — termasuk pola fallback lama yang terlalu sering kepakai
const BANNED_PATTERNS = [
  /punya cerita yang jarang dibahas/i,
  /\bajaib\b/i,
  /\btergila-gila\b/i,
  /tidak akan (percaya|menyangka)/i,
  /\bgimana sih\b/i,
  /\bsungguh luar biasa\b/i,
  /\bsangat menarik\b/i,
  /^ternyata .* (menarik|unik)\.?$/i
];

export function buildHookPrompt(input) {
  return [
    "Buat 3 opsi hook (kalimat pembuka) untuk video pendek channel pengetahuan BanyakTau, Bahasa Indonesia natural seperti kreator, bukan judul artikel.",
    "Setiap opsi maksimal 140 karakter, satu kalimat, tanpa tanda kutip, tanpa emoji.",
    "Hindari kata lebay seperti ajaib, tergila-gila, tidak akan percaya, sungguh luar biasa.",
    "Jangan pakai pola template umum seperti 'X punya cerita yang jarang dibahas'.",
    ...HOOK_PATTERNS.map((p, i) => `Opsi ${i + 1} (pola: ${p.id}) — ${p.instruction}`),
    "Kembalikan JSON valid saja dengan shape:",
    '{ hooks:[{ pattern, text }] }',
    `Topik: ${input.topic}`,
    `Kategori: ${input.category}`,
    input.angle ? `Angle/konteks tambahan: ${input.angle}` : ""
  ].filter(Boolean).join("\n");
}

export function scoreHook(text, input = {}) {
  const value = cleanText(text, 200);
  if (!value) return -100;

  let score = 0;
  const len = value.length;

  if (len < 25 || len > 140) score -= 15;
  if (BANNED_PATTERNS.some((re) => re.test(value))) score -= 30;
  if (/\b(padahal|ternyata|tapi|justru)\b/i.test(value)) score += 12;
  if (value.includes("?")) score += 8;

  const topicWords = String(input.topic || "").toLowerCase().split(/\s+/).filter((w) => w.length > 3);
  const hits = topicWords.filter((w) => value.toLowerCase().includes(w)).length;
  score += clamp(hits * 4, 0, 12);

  return score;
}

function capitalize(value) {
  const text = String(value || "");
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function fallbackHookOptions(input) {
  const topic = input.topic || "topik ini";
  return [
    { pattern: "curiosity_gap", text: `Ada satu hal soal ${topic.toLowerCase()} yang jarang orang sadari sampai sekarang.` },
    { pattern: "shock_contrast", text: `${capitalize(topic)} kelihatan biasa, tapi prosesnya jauh lebih rumit dari yang dikira.` },
    { pattern: "relatable_question", text: `Pernah kepikiran kenapa ${topic.toLowerCase()} bisa begitu? Ini jawabannya.` }
  ];
}

export function normalizeHookOptions(raw, input) {
  const rows = Array.isArray(raw?.hooks) && raw.hooks.length ? raw.hooks : fallbackHookOptions(input);
  const seen = new Set();
  const options = [];

  for (const row of rows) {
    const text = cleanText(row?.text, 160);
    if (!text || seen.has(text.toLowerCase())) continue;
    seen.add(text.toLowerCase());
    options.push({
      pattern: cleanText(row?.pattern || "general", 40),
      text,
      score: scoreHook(text, input)
    });
  }

  let i = 0;
  const fallbacks = fallbackHookOptions(input);
  while (options.length < 3 && i < fallbacks.length) {
    const fb = fallbacks[i];
    i += 1;
    if (seen.has(fb.text.toLowerCase())) continue;
    seen.add(fb.text.toLowerCase());
    options.push({ ...fb, score: scoreHook(fb.text, input) });
  }

  options.sort((a, b) => b.score - a.score);
  return options;
}

/**
 * requestJsonFn: fungsi yang sudah ada di openai.js (boleh pakai ulang requestIdeaJson,
 * karena itu cuma kirim prompt + parse JSON balikannya — schema-agnostic).
 */
export async function generateHookOptions(input, requestJsonFn) {
  const promptText = buildHookPrompt(input);
  let raw;
  let source = "offline";

  try {
    raw = await requestJsonFn(promptText);
    source = "openai";
  } catch (error) {
    raw = { hooks: fallbackHookOptions(input) };
  }

  const options = normalizeHookOptions(raw, input);
  return { source, best: options[0], options };
}

/**
 * Cuma generate ulang kalau hook yang ada sekarang nilainya lemah —
 * biar nggak nambah API call/cost di setiap render kalau hook awal udah cukup kuat.
 */
export async function ensureStrongHook(input, requestJsonFn, minScore = 10) {
  const currentScore = input.hookStyle ? scoreHook(input.hookStyle, input) : -100;
  if (currentScore >= minScore) {
    return {
      source: "existing",
      best: { text: input.hookStyle, score: currentScore, pattern: "existing" },
      options: []
    };
  }
  return generateHookOptions(input, requestJsonFn);
}
