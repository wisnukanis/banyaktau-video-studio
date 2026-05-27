import { config } from "./config.js";
import { estimateTotalCost } from "./cost.js";
import { requestKnowledgeJson } from "./openai.js";
import { clamp, cleanText, createId, nowIso } from "./util.js";

const hookExamples = [
  "Ternyata ini yang disebut...",
  "Penemu ini ternyata tidak bekerja sendirian.",
  "Kita bisa lahir di dunia karena proses kecil yang luar biasa.",
  "Kapal bisa mengambang karena satu prinsip sederhana.",
  "Anak kecil akan berjalan setelah otaknya belajar keseimbangan.",
  "Penemu lampu ternyata bukan cerita sesederhana yang sering kita dengar.",
  "Ternyata emas bisa terbentuk dari peristiwa kosmik.",
  "Rahasia kandungan di dalam air putih ternyata lebih menarik dari kelihatannya."
];

const categories = [
  "sains",
  "penemuan",
  "sejarah",
  "tubuh manusia",
  "alam semesta",
  "teknologi",
  "benda sehari-hari",
  "tokoh dunia"
];

export async function createKnowledgeDraft(rawInput, context = {}) {
  const input = normalizeInput(rawInput);
  const promptText = buildPrompt(input, context);
  let plan;
  let source = "offline";

  if (config.openai.apiKey) {
    try {
      plan = await requestKnowledgeJson(promptText);
      source = "openai";
    } catch (error) {
      plan = fallbackPlan(input, error.message);
    }
  } else {
    plan = fallbackPlan(input, "OPENAI_API_KEY belum aktif.");
  }

  const normalized = normalizePlan(plan, input);
  const narrationText = normalized.scenes.map((scene) => scene.narration).join(" ");
  const outputText = JSON.stringify(normalized);
  const cost = estimateTotalCost({
    promptText,
    outputText,
    sceneCount: normalized.scenes.length,
    imageSize: input.imageSize,
    imageQuality: input.imageQuality,
    narrationChars: narrationText.length,
    ttsProvider: input.ttsProvider,
    pricing: config.pricing
  });

  return {
    id: createId("tau"),
    source,
    status: "draft",
    createdAt: nowIso(),
    updatedAt: nowIso(),
    input,
    title: normalized.title,
    plan: normalized,
    assets: {
      images: [],
      audio: null,
      video: null
    },
    cost
  };
}

function normalizeInput(input) {
  const category = cleanText(input.category || "random", 80);
  const randomCategory = categories[Math.floor(Math.random() * categories.length)];
  const chosenCategory = category === "random" ? randomCategory : category;
  const durationSec = clamp(Number(input.durationSec || 90), 45, 120);
  const sceneCount = clamp(Number(input.sceneCount || Math.round(durationSec / 12)), 5, 10);

  return {
    topic: cleanText(input.topic || "Kapal bisa mengambang karena prinsip Archimedes", 260),
    category: chosenCategory,
    hookStyle: cleanText(input.hookStyle || "Ternyata ini yang disebut...", 120),
    tone: cleanText(input.tone || "natural, penasaran, hangat, seperti konten pengetahuan yang enak didengar", 180),
    durationSec,
    sceneCount,
    ttsProvider: String(input.ttsProvider || "openai").toLowerCase() === "elevenlabs" ? "elevenlabs" : "openai",
    imageSize: cleanText(input.imageSize || config.openai.imageSize, 40),
    imageQuality: cleanText(input.imageQuality || config.openai.imageQuality, 20)
  };
}

function buildPrompt(input, context) {
  const recent = Array.isArray(context.existingItems)
    ? context.existingItems.slice(0, 20).map((item) => `- ${item.title}: ${item.plan?.hook || item.input?.topic || ""}`)
    : [];

  return [
    "Buat naskah video vertikal channel pengetahuan Bahasa Indonesia bernama BanyakTau.",
    "Kontennya bergaya ensiklopedia ringan: ilmu, penemuan, sejarah, alam, tubuh manusia, teknologi, atau benda sehari-hari.",
    "Tujuan: penonton merasa 'oh ternyata begitu', bukan seperti kelas formal.",
    "Wajib faktual dan hati-hati. Jangan membuat klaim palsu, jangan menyebut angka spesifik jika tidak yakin, dan jangan memakai figur publik modern secara kontroversial.",
    "Bahasa harus natural, menyambung, dan enak dibacakan TTS. Jangan kaku seperti artikel Wikipedia. Jangan bertele-tele.",
    "Awali dengan hook kuat seperti contoh berikut, tetapi sesuaikan dengan topik:",
    ...hookExamples.map((hook) => `- ${hook}`),
    "Setelah hook, jelaskan isi video dengan alur: kejutan awal, penjelasan inti, analogi sederhana, bagian penting, lalu penutup yang membuat orang ingin tahu lebih banyak.",
    "Tulis narasi scene sebagai satu cerita utuh yang dibagi untuk visual, bukan potongan-potongan yang terasa terpisah.",
    "Setiap scene harus punya visualPrompt berbeda: variasikan objek close-up, diagram konseptual tanpa teks, manusia belajar/mengamati, timeline, eksperimen sederhana, alam, arsip sejarah, atau visual makro.",
    "Jangan minta gambar berisi teks, logo, watermark, atau wajah tokoh nyata yang masih hidup.",
    "Kembalikan JSON valid saja dengan shape:",
    "{ title, hook, summary, importantPoints:[string], factCheckNote, scenes:[{ index, durationSec, narration, screenText, imagePrompt, visualStyle }] }",
    `Topik: ${input.topic}`,
    `Kategori: ${input.category}`,
    `Hook style pilihan user: ${input.hookStyle}`,
    `Tone suara: ${input.tone}`,
    `Durasi maksimal: ${input.durationSec} detik`,
    `Jumlah scene: ${input.sceneCount}`,
    `Target total narasi: sekitar ${wordTarget(input.durationSec)} kata, jangan lebih dari itu.`,
    recent.length ? `Hindari duplikasi dari draft terbaru:\n${recent.join("\n")}` : ""
  ].filter(Boolean).join("\n");
}

function wordTarget(durationSec) {
  return Math.round(clamp(durationSec, 45, 120) * 1.95);
}

function normalizePlan(plan, input) {
  const fallback = fallbackPlan(input);
  const rawScenes = Array.isArray(plan?.scenes) && plan.scenes.length ? plan.scenes : fallback.scenes;
  const durations = distributeDurations(input.durationSec, input.sceneCount);
  const scenes = rawScenes.slice(0, input.sceneCount).map((scene, index) => normalizeScene(scene, index, input, durations[index]));

  while (scenes.length < input.sceneCount) {
    const index = scenes.length;
    scenes.push(normalizeScene(fallback.scenes[index % fallback.scenes.length], index, input, durations[index]));
  }

  return {
    title: titleCase(cleanText(plan?.title || fallback.title, 90)),
    hook: cleanText(plan?.hook || fallback.hook, 180),
    summary: cleanText(plan?.summary || fallback.summary, 320),
    importantPoints: normalizePoints(plan?.importantPoints || fallback.importantPoints),
    factCheckNote: cleanText(plan?.factCheckNote || "Disusun sebagai penjelasan populer; detail teknis dapat diperdalam lagi dari sumber ilmiah.", 220),
    scenes
  };
}

function normalizeScene(scene, index, input, durationSec) {
  const screenText = cleanText(scene?.screenText || sceneTitle(index, input), 68);
  const narration = cleanText(scene?.narration || fallbackNarration(index, input), 520);
  return {
    index: index + 1,
    durationSec,
    narration,
    screenText,
    imagePrompt: enhanceImagePrompt(scene?.imagePrompt || `${screenText}. ${narration}`, input, index),
    visualStyle: cleanText(scene?.visualStyle || visualStyle(index), 120)
  };
}

function normalizePoints(points) {
  const normalized = (Array.isArray(points) ? points : [])
    .map((point) => cleanText(point, 140))
    .filter(Boolean)
    .slice(0, 5);
  if (normalized.length) return normalized;
  return [
    "Mulai dari rasa penasaran yang sederhana.",
    "Jelaskan inti konsep dengan analogi mudah.",
    "Tutup dengan fakta penting yang layak diingat."
  ];
}

function distributeDurations(total, count) {
  const safeCount = Math.max(1, count);
  const base = clamp(Number(total || 90), 45, 120) / safeCount;
  return Array.from({ length: safeCount }, (_, index) => {
    const emphasis = index === 0 ? 1.06 : index === safeCount - 1 ? 1.02 : 1;
    return Number((base * emphasis).toFixed(2));
  });
}

function enhanceImagePrompt(prompt, input, index) {
  const styles = [
    "clean macro detail shot",
    "cinematic everyday object demonstration",
    "museum archive inspired scene",
    "bright science explainer composition",
    "soft 3D cutaway style illustration",
    "natural documentary moment",
    "timeline-like scene without text",
    "conceptual diagram style without labels"
  ];
  return [
    cleanText(prompt, 700),
    `topic: ${input.topic}`,
    `visual approach: ${styles[index % styles.length]}`,
    "vertical 9:16, editorial science magazine look, bright readable lighting, rich but realistic colors, clear single subject, no written text, no logo, no watermark"
  ].join(", ");
}

function visualStyle(index) {
  return [
    "slow push-in, clean editorial title layer",
    "gentle pan, object callout feeling",
    "soft zoom-out, documentary mood",
    "light parallax, modern knowledge-card layout"
  ][index % 4];
}

function fallbackPlan(input, reason = "") {
  const title = titleCase(input.topic.replace(/[?.!]+$/g, ""));
  const hook = `${input.hookStyle.replace(/[. ]+$/g, "")} ${input.topic}`;
  const beats = [
    `${hook}. Kelihatannya sederhana, tapi di balik hal ini ada prinsip yang membuat dunia bekerja dengan cara yang rapi.`,
    `Intinya, ${input.topic.toLowerCase()} bisa dipahami kalau kita melihat hubungan antara bentuk, gaya, energi, dan waktu.`,
    "Bayangkan sebuah benda sehari-hari. Saat satu bagian berubah sedikit saja, hasil akhirnya bisa berbeda jauh dari yang kita kira.",
    "Bagian pentingnya adalah proses ini tidak berdiri sendiri. Ada banyak faktor kecil yang saling membantu sampai hasilnya terlihat alami.",
    "Jadi, hal yang sering kita anggap biasa sebenarnya menyimpan penjelasan yang cukup dalam, dan itu yang membuatnya menarik untuk dipelajari."
  ];
  return {
    title,
    hook,
    summary: reason ? `Draft fallback dibuat karena: ${reason}` : `Penjelasan ringan tentang ${input.topic}.`,
    importantPoints: [
      "Mulai dari contoh yang dekat dengan penonton.",
      "Ubah konsep rumit menjadi analogi sederhana.",
      "Akhiri dengan fakta yang mudah diingat."
    ],
    factCheckNote: "Fallback offline; verifikasi sumber tambahan sebelum dipublikasikan.",
    scenes: Array.from({ length: input.sceneCount }, (_, index) => ({
      index: index + 1,
      durationSec: input.durationSec / input.sceneCount,
      narration: beats[index % beats.length],
      screenText: sceneTitle(index, input),
      imagePrompt: `${sceneTitle(index, input)}, educational visual about ${input.topic}, bright editorial illustration`,
      visualStyle: visualStyle(index)
    }))
  };
}

function fallbackNarration(index, input) {
  return fallbackPlan(input).scenes[index % 5].narration;
}

function sceneTitle(index, input) {
  return [
    "Fakta yang Jarang Dibahas",
    "Cara Kerjanya",
    "Contoh Sederhana",
    "Bagian Paling Penting",
    "Kenapa Ini Menarik",
    "Yang Sering Salah Dipahami",
    "Kesimpulan Singkat"
  ][index % 7] || input.category;
}

function titleCase(value) {
  return cleanText(value, 120)
    .split(" ")
    .map((word) => word.length > 3 ? `${word[0]?.toUpperCase() || ""}${word.slice(1)}` : word)
    .join(" ");
}
