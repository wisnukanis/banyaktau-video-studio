import { config } from "./config.js";
import { estimateTotalCost } from "./cost.js";
import { requestIdeaJson, requestKnowledgeJson } from "./openai.js";
import { clamp, cleanText, createId, nowIso } from "./util.js";
import { ensureStrongHook } from "./hook-engine.js";

// Short-form (default): YouTube Shorts / Reels pacing, 45s-2min.
// Long-form: flexible documentary-length video, 3-20min, driven by
// stock footage instead of per-scene AI images/video (cost reasons).
const SHORT_FORM_BOUNDS = [12, 120];
const LONG_FORM_BOUNDS = [180, 1200];
const SHORT_FORM_SCENE_BOUNDS = [4, 10];
const LONG_FORM_SCENE_BOUNDS = [15, 60];
// Keep long-form scenes in the same 8-16s ballpark as short-form so a
// looped stock clip rarely has to repeat more than once or twice.
const LONG_FORM_SCENE_TARGET_SEC = 12;

function durationBounds(input) {
  return input?.longForm ? LONG_FORM_BOUNDS : SHORT_FORM_BOUNDS;
}

function sceneCountBounds(input) {
  return input?.longForm ? LONG_FORM_SCENE_BOUNDS : SHORT_FORM_SCENE_BOUNDS;
}

const categories = [
  "hewan",
  "tubuh manusia",
  "fenomena alam",
  "alam semesta",
  "psikologi",
  "benda sehari-hari",
  "sains",
  "penemuan",
  "sejarah",
  "teknologi",
  "tokoh dunia"
];

function selectRandomCategory() {
  const rand = Math.random();
  if (rand < 0.50) {
    return Math.random() < 0.6 ? "hewan" : "tubuh manusia";
  } else if (rand < 0.75) {
    return Math.random() < 0.5 ? "fenomena alam" : "alam semesta";
  } else if (rand < 0.90) {
    return Math.random() < 0.5 ? "psikologi" : "benda sehari-hari";
  } else {
    const list = ["sains", "teknologi", "sejarah", "penemuan"];
    return list[Math.floor(Math.random() * list.length)];
  }
}

export const categoryStyles = {
  "hewan": {
    styleName: "animal_facts",
    tone: "engaging, surprising, fast-paced",
    style: "nature documentary",
    rules: "Focus on surprising animal behaviors, sharp contrasts, and eye-opening facts."
  },
  "tubuh manusia": {
    styleName: "medical_soft",
    tone: "educational, soft, precise",
    style: "medical documentary but simple",
    rules: "Avoid drama. Focus on clarity. Use gentle explanation style."
  },
  "fenomena alam": {
    styleName: "nature_mysteries",
    tone: "intriguing, dramatic, visual",
    style: "nature mystery",
    rules: "Highlight extreme weather, weird locations, and rare natural phenomena."
  },
  "alam semesta": {
    styleName: "cosmic_deep",
    tone: "deep, awe, slow pacing",
    style: "cosmic documentary",
    rules: "Longer pauses. Slightly more mysterious tone."
  },
  "psikologi": {
    styleName: "mind_facts",
    tone: "relatable, thought-provoking",
    style: "psychology explainer",
    rules: "Connect directly to everyday human habits, brain tricks, and social behavior."
  },
  "benda sehari-hari": {
    styleName: "relatable_doc",
    tone: "simple, friendly documentary",
    style: "relatable explanation",
    rules: "More casual but still documentary."
  },
  "sains": {
    styleName: "science_documentary",
    tone: "analytical, clear, slightly curious",
    style: "science documentary",
    rules: "Add slight emphasis on logic, cause-effect, and terms. Use calm curiosity, not excitement."
  },
  "penemuan": {
    styleName: "discovery_suspense",
    tone: "discovery, slightly suspenseful",
    style: "“breaking knowledge”",
    rules: "Build curiosity before reveal. Pause before key discoveries."
  },
  "sejarah": {
    styleName: "historical_storytelling",
    tone: "storytelling, cinematic documentary",
    style: "chronological narration",
    rules: "Use slightly slower pacing. Emphasize dates, events, transitions."
  },
  "tokoh dunia": {
    styleName: "historical_storytelling",
    tone: "storytelling, cinematic documentary",
    style: "chronological narration",
    rules: "Use slightly slower pacing. Emphasize dates, events, transitions."
  },
  "teknologi": {
    styleName: "tech_explainer",
    tone: "modern, confident, explanatory",
    style: "tech documentary",
    rules: "Slightly faster than history/science. Focus on function and impact."
  },
  "random": {
    styleName: "adaptive",
    tone: "flexible, curiosity-driven",
    style: "hybrid documentary",
    rules: "Adjust dynamically based on content: mystery -> slow + suspense, fact -> neutral, surprising -> slight emphasis."
  }
};

export function getToneStyleGuidelines(tone, category) {
  const cleanTone = String(tone || "").trim().toLowerCase();
  for (const key of Object.keys(categoryStyles)) {
    if (categoryStyles[key].styleName.toLowerCase() === cleanTone) {
      return categoryStyles[key];
    }
  }
  const normalizedCat = String(category || "").toLowerCase().trim();
  return categoryStyles[normalizedCat] || categoryStyles["random"];
}


function normalizeIdeaInput(input) {
  const category = cleanText(input.category || "random", 80);
  const randomCategory = selectRandomCategory();
  const longForm = Boolean(input.longForm);
  const [minDur, maxDur] = longForm ? LONG_FORM_BOUNDS : SHORT_FORM_BOUNDS;
  return {
    seed: cleanText(input.seed || input.topic || "", 260),
    category: category === "random" ? randomCategory : category,
    durationSec: clamp(Number(input.durationSec || (longForm ? 480 : 90)), minDur, maxDur),
    longForm
  };
}

function buildIdeaPrompt(input, context) {
  const recent = Array.isArray(context.existingItems)
    ? context.existingItems.slice(0, 40).map((item) => `- ${item.title}: ${item.plan?.hook || item.hook || item.input?.topic || item.topic || ""}`)
    : [];

  return [
    input.longForm
      ? "Buat 8 rekomendasi ide video dokumenter panjang untuk channel BanyakTau."
      : "Buat 8 rekomendasi ide video pendek untuk channel BanyakTau.",
    "Channel ini berisi pengetahuan ringan: hewan, tubuh manusia, fenomena alam, alam semesta, psikologi, benda sehari-hari, sains, sejarah, penemuan, dan teknologi.",
    "Kamu yang menentukan hook dan judul; jangan beri template kosong dan jangan meminta user mengisi hook sendiri.",
    "DILARANG KERAS membuat judul atau hook yang diawali kata 'Pernahkah kamu...' atau 'Tahukah kamu...'. Gunakan hook spesifik yang langsung membawa konflik atau fakta mencolok sejak kata pertama (contoh: 'Kucing ternyata melihat dunia dengan cara yang sangat berbeda', 'Benda ini ada di rumah semua orang tapi jarang dibersihkan').",
    input.longForm
      ? "Judul harus siap pakai untuk YouTube long-form: jelas, kuat untuk thumbnail, maksimal 90 karakter, dan punya rasa penasaran yang bisa ditahan 5-10 menit."
      : "Judul harus siap pakai untuk YouTube Shorts/Reels: singkat, jelas, maksimal 70 karakter, tanpa slang pembuka seperti 'gimana sih', dan kuat dibaca di thumbnail.",
    input.longForm
      ? "Setiap ide harus punya hook viral, konflik rasa penasaran, beberapa babak/subtopik, dan mudah divisualkan dengan B-roll stock dari Pexels/Pixabay."
      : "Setiap ide harus punya rasa penasaran kuat, mudah divisualkan dengan gambar AI/stock video, dan bisa dijelaskan faktual secara cepat.",
    input.longForm
      ? "Pilih ide yang hemat produksi untuk long-form: utamakan visual dunia nyata, eksperimen, alam, arsip, objek, kota, teknologi, atau ilustrasi konseptual yang mudah dicari sebagai stock footage."
      : "Pilih ide yang hemat produksi: cukup gambar AI / stock footage gratis + TTS.",
    "Jangan pilih klaim medis/keuangan/hukum yang berisiko, teori konspirasi, atau topik yang butuh wajah figur publik modern.",
    "Bahasa hook harus natural seperti kreator Indonesia, bukan judul artikel kaku. Hindari kata yang terlalu lebay seperti ajaib, tergila-gila, dan klaim bombastis tanpa dasar.",
    "Kembalikan JSON valid saja dengan shape:",
    "{ ideas:[{ title, topic, hook, category, angle, whyGood, visualPotential:[string], riskLevel, estimatedDurationSec }] }",
    input.seed ? `Arah topik dari user: ${input.seed}` : "Arah topik dari user: bebas, cari ide paling menarik.",
    `Kategori prioritas: ${input.category}`,
    `Durasi target: ${input.durationSec} detik`,
    input.longForm ? "Gunakan sinyal tren/performa hanya untuk memilih angle dan kata kunci yang diminati audiens; jangan meniru struktur atau naskah video tertentu." : "",
    recent.length ? `Hindari duplikasi dari riwayat ini:\n${recent.join("\n")}` : "",
    context.trendNotes ? `\n${context.trendNotes}` : "",
    context.performanceNotes ? `\n${context.performanceNotes}` : ""
  ].filter(Boolean).join("\n");
}

function normalizeIdeas(ideas, input) {
  const rows = Array.isArray(ideas) && ideas.length ? ideas : fallbackIdeas(input);
  const seen = new Set();
  const normalized = [];

  for (const idea of rows) {
    const title = cleanPublicTitle(idea?.title || idea?.topic || input.seed || "Fakta yang Jarang Dibahas");
    const hook = cleanText(idea?.hook || `Ternyata ${title.toLowerCase()} punya cerita yang jarang dibahas.`, 180);
    const key = `${title}|${hook}`.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    normalized.push({
      id: createId("idea"),
      title,
      topic: cleanText(idea?.topic || title, 220),
      hook,
      category: cleanText(idea?.category || input.category, 80),
      angle: cleanText(idea?.angle || "Dibuka dari rasa penasaran, lalu dijelaskan dengan analogi sederhana.", 220),
      whyGood: cleanText(idea?.whyGood || "Topik dekat dengan penonton dan mudah divisualkan.", 220),
      visualPotential: normalizeStringList(idea?.visualPotential, 4),
      riskLevel: cleanText(idea?.riskLevel || "rendah", 40),
      estimatedDurationSec: clamp(Number(idea?.estimatedDurationSec || input.durationSec), 45, 120)
    });
    if (normalized.length >= 8) break;
  }

  while (normalized.length < 8) {
    const fallback = fallbackIdeas(input)[normalized.length % 8];
    normalized.push({
      ...fallback,
      id: createId("idea")
    });
  }

  return normalized;
}

function normalizeStringList(value, limit) {
  return (Array.isArray(value) ? value : [])
    .map((item) => cleanText(item, 100))
    .filter(Boolean)
    .slice(0, limit);
}

function fallbackIdeas(input, reason = "") {
  const seed = input.seed || input.category;
  const rows = [
    {
      title: "Kenapa Kapal Besi Tidak Tenggelam",
      topic: "kapal besar bisa mengambang meski terbuat dari besi",
      hook: "Kapal sebesar gedung bisa mengapung, padahal bahannya besi. Kok bisa?",
      category: "sains",
      angle: "Mulai dari benda berat yang terlihat mustahil mengambang, lalu masuk ke prinsip daya apung.",
      visualPotential: ["kapal di laut", "air terdorong oleh lambung", "eksperimen gelas air"],
      whyGood: "Dekat dengan pengalaman sehari-hari dan visualnya jelas.",
      riskLevel: "rendah"
    },
    {
      title: "Rahasia Air Putih yang Sering Diremehkan",
      topic: "kenapa air putih penting untuk tubuh",
      hook: "Air putih kelihatannya biasa, tapi tubuh kita bekerja kacau kalau kekurangan ini.",
      category: "tubuh manusia",
      angle: "Jelaskan peran air tanpa klaim kesehatan berlebihan.",
      visualPotential: ["gelas air", "sel tubuh ilustratif", "aktivitas harian"],
      whyGood: "Topik universal dan mudah dipahami.",
      riskLevel: "rendah"
    },
    {
      title: "Emas Ternyata Lahir dari Ledakan Kosmik",
      topic: "asal-usul emas di alam semesta",
      hook: "Cincin emas yang kecil itu, asalnya bisa dari peristiwa raksasa di luar angkasa.",
      category: "alam semesta",
      angle: "Hubungkan benda sehari-hari dengan asal kosmik yang mengejutkan.",
      visualPotential: ["perhiasan emas", "bintang bertabrakan", "partikel kosmik"],
      whyGood: "Ada kontras besar antara benda kecil dan skala semesta.",
      riskLevel: "rendah"
    },
    {
      title: "Kenapa Anak Kecil Akhirnya Bisa Berjalan",
      topic: "proses tubuh dan otak belajar berjalan",
      hook: "Langkah pertama anak kecil itu bukan sekadar kaki kuat. Otaknya juga sedang belajar besar-besaran.",
      category: "tubuh manusia",
      angle: "Buka dari momen familiar, lalu jelaskan koordinasi otak, otot, dan keseimbangan.",
      visualPotential: ["bayi belajar berdiri", "ilustrasi otak", "keseimbangan tubuh"],
      whyGood: "Emosional, dekat, dan edukatif.",
      riskLevel: "rendah"
    },
    {
      title: "Lampu Tidak Sesederhana Nama Satu Penemu",
      topic: "sejarah pengembangan lampu listrik",
      hook: "Kita sering dengar satu nama soal lampu, padahal ceritanya jauh lebih ramai.",
      category: "penemuan",
      angle: "Rapikan sejarah penemuan tanpa menjatuhkan satu tokoh.",
      visualPotential: ["lampu menyala", "laboratorium lama", "kota malam"],
      whyGood: "Meluruskan miskonsepsi populer.",
      riskLevel: "rendah"
    },
    {
      title: "Kenapa Es Mengapung di Air",
      topic: "alasan es mengapung dan dampaknya untuk kehidupan",
      hook: "Kalau es tidak mengapung, kehidupan di Bumi bisa beda jauh.",
      category: "sains",
      angle: "Jelaskan kepadatan air dengan dampak besar pada alam.",
      visualPotential: ["es dalam gelas", "danau membeku", "molekul air"],
      whyGood: "Fenomena sederhana dengan konsekuensi besar.",
      riskLevel: "rendah"
    },
    {
      title: "Kenapa Langit Bisa Berwarna Biru",
      topic: "hamburan cahaya yang membuat langit tampak biru",
      hook: "Langit biru bukan karena ada warna biru di atas sana.",
      category: "sains",
      angle: "Pakai analogi cahaya dan partikel udara.",
      visualPotential: ["langit cerah", "sinar matahari", "partikel udara"],
      whyGood: "Pertanyaan klasik yang tetap kuat untuk short.",
      riskLevel: "rendah"
    },
    {
      title: "Kenapa Roda Koper Baru Terasa Normal Belakangan",
      topic: "sejarah sederhana roda pada koper",
      hook: "Aneh tapi nyata, koper beroda baru terasa umum setelah manusia lama sekali menyeret barang berat.",
      category: "benda sehari-hari",
      angle: "Bahas inovasi kecil yang terlambat jadi kebiasaan.",
      visualPotential: ["koper klasik", "bandara", "roda kecil close-up"],
      whyGood: "Unik, ringan, dan mudah dibuat visualnya.",
      riskLevel: "rendah"
    }
  ];

  return rows.map((row) => ({
    id: createId("idea"),
    ...row,
    topic: seed && seed !== input.category ? `${row.topic} (${seed})` : row.topic,
    estimatedDurationSec: input.durationSec,
    whyGood: reason ? `${row.whyGood} Catatan: ${reason}` : row.whyGood
  }));
}

function normalizeSelectedIdea(value) {
  if (!value || typeof value !== "object") return null;
  const title = cleanText(value.title, 90);
  const topic = cleanText(value.topic || title, 220);
  const hook = cleanText(value.hook, 180);
  if (!title && !topic && !hook) return null;
  return {
    id: cleanText(value.id, 80),
    title,
    topic,
    hook,
    category: cleanText(value.category, 80),
    angle: cleanText(value.angle, 220),
    whyGood: cleanText(value.whyGood, 220)
  };
}

export async function createIdeaRecommendations(rawInput = {}, context = {}) {
  const input = normalizeIdeaInput(rawInput);
  const promptText = buildIdeaPrompt(input, context);
  let result;
  let source = "offline";

  if (config.openai.apiKey) {
    try {
      result = await requestIdeaJson(promptText);
      source = "openai";
    } catch (error) {
      if (context.strictAi) throw error;
      result = { ideas: fallbackIdeas(input, error.message) };
    }
  } else {
    if (context.strictAi) throw new Error("OPENAI_API_KEY belum aktif untuk membuat ide terjadwal.");
    result = { ideas: fallbackIdeas(input, "OPENAI_API_KEY belum aktif.") };
  }

  return {
    source,
    generatedAt: nowIso(),
    input,
    ideas: normalizeIdeas(result?.ideas, input)
  };
}

export async function createKnowledgeDraft(rawInput, context = {}) {
  const input = normalizeInput(rawInput);

  // The unattended pipeline already arrives with the selected idea's hook.
  // Reusing it avoids another paid request without changing the final brief.
  if (config.openai.apiKey && !input.hookStyle) {
    try {
      const hookResult = await ensureStrongHook(input, requestIdeaJson);
      if (hookResult?.best?.text) {
        input.hookStyle = hookResult.best.text;
      }
    } catch (err) {
      console.warn("Optimasi Hook gagal, menggunakan hook bawaan:", err.message);
    }
  }

  const promptText = buildPrompt(input, context);
  let plan;
  let source = "offline";

  if (config.openai.apiKey) {
    try {
      plan = await requestKnowledgeJson(promptText);
      source = "openai";
    } catch (error) {
      if (context.strictAi) throw error;
      plan = fallbackPlan(input, error.message);
    }
  } else {
    if (context.strictAi) throw new Error("OPENAI_API_KEY belum aktif untuk membuat naskah terjadwal.");
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
    project_id: "capybara_banyak_tau_id",
    language: "id-ID",
    market: "ID",
    version_type: "original",
    createdAt: nowIso(),
    updatedAt: nowIso(),
    input,
    title: normalized.title,
    plan: normalized,
    assets: {
      images: [],
      clips: [],
      audio: null,
      video: null
    },
    cost
  };
}

function normalizeInput(input) {
  const selectedIdea = normalizeSelectedIdea(input.selectedIdea || input.idea);
  const category = cleanText(input.category || "random", 80);
  const randomCategory = categories[Math.floor(Math.random() * categories.length)];
  const chosenCategory = selectedIdea?.category || (category === "random" ? randomCategory : category);
  const longForm = Boolean(input.longForm);
  const [minDur, maxDur] = durationBounds({ longForm });
  const durationSec = clamp(Number(input.durationSec || (longForm ? 480 : 90)), minDur, maxDur);
  const [minScenes, maxScenes] = sceneCountBounds({ longForm });
  const defaultSceneCount = longForm
    ? Math.round(durationSec / LONG_FORM_SCENE_TARGET_SEC)
    : Math.round(durationSec / 12);
  const sceneCount = clamp(Number(input.sceneCount || defaultSceneCount), minScenes, maxScenes);
  const catStyle = getToneStyleGuidelines(input.tone, chosenCategory);

  return {
    topic: cleanText(selectedIdea?.topic || input.topic || "Kapal bisa mengambang karena prinsip Archimedes", 260),
    category: chosenCategory,
    hookStyle: cleanText(selectedIdea?.hook || input.hookStyle || "", 180),
    selectedIdea,
    tone: cleanText(input.tone || catStyle.styleName, 180),
    longForm,
    durationSec,
    sceneCount,
    ttsProvider: String(input.ttsProvider || "openai").toLowerCase() === "elevenlabs" ? "elevenlabs" : "openai",
    imageSize: cleanText(input.imageSize || config.openai.imageSize, 40),
    imageQuality: cleanText(input.imageQuality || config.openai.imageQuality, 20),
    elevenlabsVoiceId: cleanText(input.elevenlabsVoiceId || "", 80),
    elevenlabsModel: cleanText(input.elevenlabsModel || "", 80),
    openaiTtsVoice: cleanText(input.openaiTtsVoice || "", 80),
    avatarMode: (() => {
      const greenAvatars = ["avatar hijau 1.mp4", "avatar hijau 2.mp4", "avatar hijau 3.mp4"];
      const rawMode = cleanText(input.avatarMode || "", 40);
      if (greenAvatars.includes(rawMode)) {
        return rawMode;
      }
      // Long-form = one consistent "host" for the whole episode, so use a
      // fixed default instead of the short-form per-topic rotation.
      if (longForm) return greenAvatars[0];
      const seed = selectedIdea?.topic || input.topic || "default";
      let hash = 0;
      for (let i = 0; i < seed.length; i++) {
        hash = (hash << 5) - hash + seed.charCodeAt(i);
        hash |= 0;
      }
      return greenAvatars[Math.abs(hash) % greenAvatars.length];
    })(),
    videoFormat: cleanText(input.videoFormat || config.stock?.defaultVideoFormat || "vertical", 40),
    visualSource: cleanText(input.visualSource || config.stock?.defaultVisualSource || "stock", 40)
  };
}

function buildPrompt(input, context) {
  const recent = Array.isArray(context.existingItems)
    ? context.existingItems.slice(0, 40).map((item) => `- ${item.title}: ${item.plan?.hook || item.hook || item.input?.topic || item.topic || ""}`)
    : [];
  const idea = input.selectedIdea;
  const catStyle = getToneStyleGuidelines(input.tone, input.category);
  const longForm = Boolean(input.longForm);

  const formatLines = longForm
    ? [
      `Buat naskah video dokumenter Bahasa Indonesia berdurasi panjang (~${Math.round(input.durationSec / 60)} menit) untuk channel pengetahuan BanyakTau.`,
      "Ini BUKAN format Shorts — ini video panjang yang ditonton duduk santai di YouTube. Boleh menjelaskan lebih dalam, memberi konteks, dan membangun beberapa sub-topik/babak berurutan, bukan cuma satu fakta cepat.",
      "Struktur: buka dengan hook kuat (tetap penting di 15-30 detik pertama agar penonton tidak pergi), lalu bagi isi jadi beberapa segmen/babak yang mengalir (misalnya: asal-usul -> cara kerja -> dampak/fakta mengejutkan -> relevansi sekarang), lalu penutup yang memberi rangkuman rasa 'oh ternyata begitu' tanpa terasa seperti kelas.",
      "Judul tetap harus menarik dan jelas dibaca di thumbnail, maksimal 90 karakter, tanpa clickbait kosong."
    ]
    : [
      "Buat naskah video vertikal channel pengetahuan Bahasa Indonesia bernama BanyakTau.",
      "Judul harus siap pakai untuk Reels/Shorts: singkat, jelas, maksimal 70 karakter, tanpa slang pembuka seperti 'gimana sih', dan kuat dibaca di thumbnail.",
      "DILARANG KERAS membuka dengan kata 'Pernahkah kamu...' atau 'Tahukah kamu...'. Buka langsung sejak kata pertama dengan fakta kontras, kejutan visual, atau konflik spesifik di frame pertama (contoh: 'Kucing ternyata melihat dunia dengan cara yang sangat berbeda', 'Benda ini ada di rumah semua orang tapi jarang dibersihkan').",
      "Struktur Reels cepat (12-30 detik): Detik 0-1 hook visual & kalimat paling mencolok, detik 1-6 penjelasan inti & alasan, detik 6-12 fakta kejutan atau jawaban (jangan menahan jawaban terlalu lama).",
      "Kalimat di scene terakhir (penutup) HARUS dibuat menyambung kembali secara mulus (seamless loop) ke kalimat hook pembuka, agar video terasa berulang tanpa terputus saat diputar ulang terus-menerus di Reels.",
      "Di scene penutup atau narasi akhir, berikan pertanyaan biner/pilihan mudah untuk memancing komentar (misal: 'Kamu pernah mengalami ini juga?', 'Tim A atau tim B?', 'Menurutmu ini nyata atau kebetulan?', 'Kirim ke temanmu yang selalu begini')."
    ];

  return [
    ...formatLines,
    "Kontennya bergaya ensiklopedia ringan: hewan, tubuh manusia, fenomena alam, alam semesta, psikologi, benda sehari-hari, sains, sejarah, penemuan, atau teknologi.",
    "Tujuan: penonton merasa 'oh ternyata begitu', bukan seperti kelas formal.",
    "Wajib faktual dan hati-hati. Jangan membuat klaim palsu, jangan menyebut angka spesifik jika tidak yakin, dan jangan memakai figur publik modern secara kontroversial.",
    "Gaya narasi harus mengikuti gaya narator dokumenter Indonesia: suara pria dewasa yang tenang, berwibawa, cerdas, tepercaya, dan memikat. Pengucapan harus sangat jelas, artikulatif, tertata rapi, dan menarik tanpa terdengar terburu-buru atau cepat seperti kumur-kumur. Bahasa harus natural dan enak dibacakan TTS dengan aksen Indonesia netral.",
    `Gaya narasi kategori (${input.category}): ${catStyle.style}. Tone: ${catStyle.tone}. Aturan tambahan: ${catStyle.rules}`,
    "Gunakan tempo dan jeda alami sesuai dengan gaya kategori di atas. Tekankan kata kunci secara halus tanpa berlebihan atau berteriak. Hindari gaya heboh ala influencer YouTube atau emosi berlebih.",
    "Kamu yang membuat hook, judul, dan alur narasi. Jangan terasa seperti template.",
    idea ? "Pakai ide terpilih user sebagai sumber utama. Jangan mengganti topik atau angle utamanya." : "Jika user belum memilih ide, buat sendiri hook paling kuat dari topik yang tersedia.",
    idea ? `Ide terpilih:\n- Judul: ${idea.title}\n- Topik: ${idea.topic}\n- Hook: ${idea.hook}\n- Angle: ${idea.angle}\n- Alasan kuat: ${idea.whyGood}` : "",
    "Field summary wajib meringkas inti video, bukan CTA. Tulis 1-2 kalimat lengkap, 110-170 karakter, menyebut penyebab/proses utama dan alasan kenapa fakta ini penting diingat. Jangan membuat kalimat menggantung.",
    "Field importantPoints wajib berisi 3-5 fakta inti dari video. Jangan isi dengan instruksi produksi seperti mulai dari contoh, gunakan analogi, atau akhiri dengan fakta.",
    "Jangan membuat scene atau screenText berjudul Kesimpulan, Kesimpulan Singkat, atau Summary. Pakai penutup natural tanpa label kesimpulan.",
    "Tulis narasi scene sebagai satu cerita utuh yang dibagi untuk visual, bukan potongan-potongan yang terasa terpisah.",
    "Field imagePrompt harus menggambarkan visual yang LANGSUNG dan SPESIFIK merepresentasikan poin utama narasi scene tersebut — bukan visual generik atau simbolik. Contoh: jika narasi membahas 'sel darah merah membawa oksigen', imagePrompt harus tentang sel darah merah di pembuluh darah, bukan gambar manusia berlari atau tubuh manusia secara umum.",
    longForm
      ? "Setiap scene mewakili sekitar 10-15 detik narasi. Karena jumlah scene banyak, variasikan visualPrompt seluas mungkin (jangan ulang tema visual yang sama berturut-turut) supaya B-roll stock footage yang dicari nanti juga bervariasi dan tidak terasa diulang-ulang. Jangan gunakan stockQuery yang sama atau hampir sama di dua scene berturut-turut."
      : "Setiap scene harus punya imagePrompt & stockQuery yang berbeda dan unik: variasikan objek close-up, diagram konseptual tanpa teks, aksi/gerakan menonjol, sudut pandang ekstrem, atau visual makro. Jangan gunakan stockQuery yang sama atau hampir sama di dua scene berturut-turut.",
    "Jangan minta gambar berisi teks, logo, watermark, atau wajah tokoh nyata yang masih hidup.",
    "Untuk setiap scene, isi stockQuery dengan kata kunci pencarian B-roll dalam Bahasa Inggris (WAJIB bahasa Inggris), maksimal 3 kata, SANGAT SPESIFIK ke subjek visual utama yang dinarasikan di scene itu — bukan tema besar video secara umum. Contoh BAIK: 'red blood cells', 'iron ship hull', 'light refraction', 'ancient cave painting', 'honey crystallization'. Contoh BURUK: 'education', 'science', 'documentary', 'knowledge', 'interesting facts'. Pastikan stockQuery mencerminkan APA yang terlihat di video untuk scene itu, bukan TENTANG APA video itu.",
    "Untuk setiap scene, tentukan emosi/pose avatar di field 'avatarPose'. Pilihan yang valid hanya: 'thinking' (jika bertanya/misteri), 'surprised' (jika ada fakta unik/kejutan), 'pointing' (jika menekankan fakta penting), 'clipboard' (jika penjelas biasa), atau 'thumbs_up' (khusus scene penutup).",
    "Kembalikan JSON valid saja dengan shape:",
    "{ title, hook, summary, importantPoints:[string], factCheckNote, scenes:[{ index, durationSec, narration, screenText, imagePrompt, stockQuery, visualStyle, avatarPose }] }",
    `Topik: ${input.topic}`,
    `Kategori: ${input.category}`,
    input.hookStyle ? `Hook yang harus dipakai atau dijadikan dasar: ${input.hookStyle}` : "",
    `Tone suara: ${input.tone}`,
    `Durasi ${longForm ? "target" : "maksimal"}: ${input.durationSec} detik`,
    `Jumlah scene: ${input.sceneCount}`,
    `Target total narasi: sekitar ${wordTarget(input.durationSec, longForm)} kata, pas dengan target durasi.`,
    recent.length ? `Hindari duplikasi dari draft terbaru:\n${recent.join("\n")}` : ""
  ].filter(Boolean).join("\n");
}

function wordTarget(durationSec, longForm = false) {
  const [minDur, maxDur] = longForm ? LONG_FORM_BOUNDS : SHORT_FORM_BOUNDS;
  const rate = longForm ? 2.2 : 2.35;
  return Math.round(clamp(durationSec, minDur, maxDur) * rate);
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
    title: cleanPublicTitle(plan?.title || input.selectedIdea?.title || fallback.title),
    hook: cleanText(plan?.hook || input.selectedIdea?.hook || fallback.hook, 180),
    summary: normalizeSummary(plan?.summary, input, scenes, fallback.summary),
    importantPoints: normalizePoints(plan?.importantPoints || fallback.importantPoints),
    factCheckNote: cleanText(plan?.factCheckNote || "Disusun sebagai penjelasan populer; detail teknis dapat diperdalam lagi dari sumber ilmiah.", 220),
    scenes
  };
}

function cleanPublicTitle(value) {
  return titleCase(cleanText(value, 90)
    .replace(/\b(gimana|sih|kok|dong)\b/gi, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[?.!]+$/g, ""));
}

function normalizeScene(scene, index, input, durationSec) {
  const screenText = cleanSceneText(scene?.screenText || sceneTitle(index, input));
  const narration = cleanText(scene?.narration || fallbackNarration(index, input), 520);
  const rawPose = cleanText(scene?.avatarPose || "clipboard", 20).toLowerCase();
  const avatarPose = ["thinking", "surprised", "pointing", "clipboard", "thumbs_up"].includes(rawPose) ? rawPose : "clipboard";
  return {
    index: index + 1,
    durationSec,
    narration,
    screenText,
    imagePrompt: enhanceImagePrompt(scene?.imagePrompt || `${screenText}. ${narration}`, input, index),
    stockQuery: cleanStockQuery(scene?.stockQuery),
    visualStyle: cleanText(scene?.visualStyle || visualStyle(index), 120),
    avatarPose
  };
}

function cleanStockQuery(value) {
  return String(value || "")
    .replace(/["']/g, "")
    .replace(/[^a-zA-Z0-9\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 3)
    .join(" ");
}

function cleanSceneText(value) {
  const text = cleanText(value, 68)
    .replace(/\bKesimpulan\s+Singkat\b/gi, "Fakta Utama")
    .replace(/\bKesimpulan\b/gi, "Fakta Utama")
    .replace(/\bSummary\b/gi, "Fakta Utama")
    .trim();
  return text || "Fakta Utama";
}

function normalizePoints(points) {
  const normalized = (Array.isArray(points) ? points : [])
    .map((point) => cleanText(point, 140))
    .filter((point) => !isProductionInstruction(point))
    .filter(Boolean)
    .slice(0, 5);
  if (normalized.length) return normalized;
  return [
    "Hal yang terlihat sederhana sering punya mekanisme tersembunyi.",
    "Faktor kecil bisa saling bekerja sampai hasilnya terlihat alami.",
    "Memahami prosesnya membuat fakta sehari-hari terasa lebih masuk akal."
  ];
}

function normalizeSummary(value, input, scenes, fallback) {
  const text = cleanText(value, 480);
  if (text && !isProductionInstruction(text) && !/^draft fallback dibuat karena/i.test(text)) {
    return text;
  }

  const closingNarration = cleanText(scenes.at(-1)?.narration || "", 220);
  if (closingNarration && !isProductionInstruction(closingNarration)) {
    return cleanText(closingNarration, 320);
  }

  return cleanText(fallback || coreFallbackSummary(input), 320);
}

function isProductionInstruction(value) {
  return /\b(mulai dari|jelaskan|akhiri|gunakan analogi|contoh yang dekat|target total|storyboard|draft fallback)\b/i.test(String(value || ""));
}

function distributeDurations(total, count) {
  const safeCount = Math.max(1, count);
  // Duration bounds are already validated by normalizeInput() before this
  // is called — just guard against garbage input, don't re-clamp to the
  // short-form range (that used to silently truncate long-form videos).
  const safeTotal = Number.isFinite(Number(total)) && Number(total) > 0 ? Number(total) : 90;
  const base = safeTotal / safeCount;
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
  const title = titleCase((input.selectedIdea?.title || input.topic).replace(/[?.!]+$/g, ""));
  const hookBase = input.selectedIdea?.hook || input.hookStyle || `Ternyata ${input.topic.toLowerCase()} punya sisi yang jarang dibahas`;
  const hook = hookBase.toLowerCase().includes(input.topic.toLowerCase())
    ? hookBase
    : `${hookBase.replace(/[. ]+$/g, "")}: ${input.topic}`;
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
    summary: coreFallbackSummary(input),
    importantPoints: [
      "Mulai dari contoh yang dekat dengan penonton.",
      "Ubah konsep rumit menjadi analogi sederhana.",
      "Akhiri dengan fakta yang mudah diingat."
    ],
    factCheckNote: reason
      ? `Fallback offline karena: ${reason}. Verifikasi sumber tambahan sebelum dipublikasikan.`
      : "Fallback offline; verifikasi sumber tambahan sebelum dipublikasikan.",
    scenes: Array.from({ length: input.sceneCount }, (_, index) => {
      const isLast = index === input.sceneCount - 1;
      const avatarPose = isLast ? "thumbs_up" : index === 0 ? "thinking" : ["clipboard", "pointing", "thinking", "surprised"][index % 4];
      return {
        index: index + 1,
        durationSec: input.durationSec / input.sceneCount,
        narration: beats[index % beats.length],
        screenText: sceneTitle(index, input),
        imagePrompt: `${sceneTitle(index, input)}, educational visual about ${input.topic}, bright editorial illustration`,
        visualStyle: visualStyle(index),
        avatarPose
      };
    })
  };
}

function coreFallbackSummary(input) {
  return cleanText(
    `Intinya, ${input.topic.toLowerCase()} menarik karena hal yang tampak sederhana biasanya terjadi dari beberapa faktor yang bekerja bersama. Saat bentuk, gaya, energi, dan waktu saling memengaruhi, hasil akhirnya bisa berbeda dari dugaan kita.`,
    320
  );
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
    "Fakta Utama"
  ][index % 7] || input.category;
}

function titleCase(value) {
  return cleanText(value, 120)
    .split(" ")
    .map((word) => word.length > 3 ? `${word[0]?.toUpperCase() || ""}${word.slice(1)}` : word)
    .join(" ");
}
