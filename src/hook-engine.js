import { cleanText, clamp } from "./util.js";

// Pola hook biar variasinya nggak monoton & otomatis nyambung ke tiap topik/kategori
const HOOK_PATTERNS = [
  {
    id: "curiosity_gap",
    instruction: "Buka loop penasaran tanpa jawab langsung — ubah fakta kaku jadi 1 kalimat menohok (<15 kata) yang bikin penonton kaget atau penasaran."
  },
  {
    id: "shock_contrast",
    instruction: "Pasangkan dua hal kontradiktif (misal: 'Kamu nggak malas, otakmu cuma lagi jalan di 10% kemampuannya'). Langsung di kata pertama."
  },
  {
    id: "relatable_provocation",
    instruction: "Mulai dari sanggahan kebiasaan sehari-hari penonton yang kontroversial tapi relatable (<15 kata, tajam, no fluff)."
  }
];

// Frasa generik/lebay yang harus dihindari — termasuk pola fallback lama yang terlalu sering kepakai
const BANNED_PATTERNS = [
  /punya cerita yang jarang dibahas/i,
  /^(pernahkah|tahukah)\s+(kamu|anda)?/i,
  /\b(pernahkah|tahukah)\s+(kamu|anda)\b/i,
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
    "Buat 3 opsi hook (kalimat pembuka video pendek) untuk channel pengetahuan BanyakTau. Gunakan gaya The Punchy Hook Rewriter.",
    "ATURAN KETAT HOOK:",
    "1. Maksimal 15 kata per opsi. No fluff, no hashtag, no intro bertele-tele.",
    "2. Bahasa Indonesia natural & tajam ala kreator sosial media profesional.",
    "3. JANGAN PERNAH buka dengan 'Pernahkah kamu...' atau 'Tahukah kamu...'. Langsung masuk ke konflik, sanggahan, atau fakta mengejutkan.",
    "4. Hindari kata lebay (ajaib, tergila-gila, tidak akan percaya, luar biasa).",
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
    { pattern: "curiosity_gap", text: `Ada alasan unik di balik ${topic.toLowerCase()} yang jarang disadari.` },
    { pattern: "shock_contrast", text: `${capitalize(topic)} kelihatan biasa, tapi prosesnya jauh lebih rumit dari yang dikira.` },
    { pattern: "relatable_question", text: `Benda atau proses ${topic.toLowerCase()} ini bekerja dengan cara yang tidak kita bayangkan.` }
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
