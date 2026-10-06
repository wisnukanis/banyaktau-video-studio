import { config } from "./config.js";

function getApiKey() {
  return process.env.GEMINI_API_KEY || process.env.VIDEO_API_KEY || "";
}

function cleanJsonText(raw) {
  let cleaned = String(raw || "").trim();
  // Strip markdown code fences if model wrapped the JSON in ```json ... ```
  if (cleaned.startsWith("```")) {
    cleaned = cleaned.replace(/^```[a-zA-Z]*\n?/, "").replace(/\n?```$/, "").trim();
  }
  return cleaned;
}

export async function requestGeminiChat({ prompt, systemInstruction = "", modelName = null }) {
  const apiKey = getApiKey();
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY belum diisi di environment variables.");
  }

  const candidateModels = [
    modelName,
    process.env.GEMINI_MODEL,
    "gemini-3.5-flash-lite",
    "gemini-2.5-flash",
    "gemini-flash-latest"
  ].filter(Boolean);

  let lastError = null;

  for (const model of candidateModels) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
    const payload = {
      contents: [{
        parts: [{ text: prompt }]
      }],
      generationConfig: {
        response_mime_type: "application/json",
        temperature: 0.8
      }
    };

    if (systemInstruction) {
      payload.system_instruction = {
        parts: [{ text: systemInstruction }]
      };
    }

    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });

      const data = await response.json();
      if (!response.ok) {
        const errorMsg = data?.error?.message || response.statusText;
        throw new Error(`Gemini API HTTP ${response.status} (${model}): ${errorMsg}`);
      }

      const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!text) {
        throw new Error(`Gemini tidak mengembalikan output konten untuk model ${model}`);
      }

      return JSON.parse(cleanJsonText(text));
    } catch (err) {
      lastError = err;
      // If error is 404 (model deprecated) or temporary overload, try next candidate model
      if (err.message.includes("not found") || err.message.includes("no longer available") || err.message.includes("503")) {
        continue;
      }
      throw err;
    }
  }

  throw lastError || new Error("Gagal memanggil semua model Gemini yang tersedia.");
}

export async function requestGeminiKnowledgeJson(promptText) {
  const systemInstruction = "You are an Indonesian educational short-video writer for channel BanyakTau. Write factual, highly engaging Indonesian narration using simple, everyday language that is easy for the general public to understand. Avoid complex academic jargon without clear analogies. Keep sentences short, punchy, and comfortably paced for viewers to read on-screen subtitles. Return valid JSON only.";
  return requestGeminiChat({
    prompt: promptText,
    systemInstruction,
    modelName: process.env.GEMINI_MODEL || "gemini-3.5-flash-lite"
  });
}

export async function requestGeminiIdeaJson(promptText) {
  const systemInstruction = "You are an Indonesian short-video ideation producer for BanyakTau. Recommend scroll-stopping, factual, low-cost visual ideas using 3 proven Reels hook formulas (contradictory myth, extreme visual fact, relatable daily problems) in simple, accessible Indonesian. Return valid JSON only.";
  return requestGeminiChat({
    prompt: promptText,
    systemInstruction,
    modelName: process.env.GEMINI_MODEL || "gemini-3.5-flash-lite"
  });
}
