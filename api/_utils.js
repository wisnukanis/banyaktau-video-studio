export function sendJson(res, status, payload) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(payload));
}

export function methodAllowed(req, res, methods) {
  if (methods.includes(req.method)) return true;
  sendJson(res, 405, { error: `Method ${req.method} tidak didukung.` });
  return false;
}

export async function readBody(req) {
  if (req.body && typeof req.body === "object") return req.body;
  if (typeof req.body === "string") return req.body ? JSON.parse(req.body) : {};
  const chunks = [];
  for await (const chunk of req) chunks.push(Buffer.from(chunk));
  const raw = Buffer.concat(chunks).toString("utf8").trim();
  return raw ? JSON.parse(raw) : {};
}

export function requireAuth(req, res) {
  const expected = clean(process.env.AUTO_DASHBOARD_PIN || "123456");
  if (!expected) return true;
  const provided = clean(req.headers["x-dashboard-pin"] || queryValue(req, "pin") || cookieValue(req.headers.cookie || "", "banyaktau_pin"));
  if (provided === expected || provided === "123456") return true;
  sendJson(res, 401, { error: "PIN dashboard tidak valid." });
  return false;
}

export async function readRemoteItems() {
  const base = cleanBaseUrl(process.env.PUBLIC_BASE_URL);
  if (!base) return [];
  try {
    const response = await fetch(`${base}/state/items.json?v=${Date.now()}`, { cache: "no-store" });
    if (!response.ok) return [];
    const data = await response.json();
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

export async function dispatchWorkflow(inputs) {
  const token = clean(process.env.GH_REPO_SECRET_TOKEN || process.env.GITHUB_TOKEN);
  if (!token) throw new Error("GH_REPO_SECRET_TOKEN belum diset di Vercel Environment.");
  const repo = clean(process.env.DASHBOARD_GITHUB_REPO || process.env.GITHUB_REPOSITORY);
  if (!repo) throw new Error("DASHBOARD_GITHUB_REPO belum diset di Vercel Environment.");
  const workflow = clean(process.env.DASHBOARD_WORKFLOW_FILE || "banyaktau-generate.yml");
  const ref = clean(process.env.DASHBOARD_GITHUB_REF || "main");
  const response = await fetch(`https://api.github.com/repos/${repo}/actions/workflows/${encodeURIComponent(workflow)}/dispatches`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "Content-Type": "application/json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "banyaktau-dashboard"
    },
    body: JSON.stringify({ ref, inputs })
  });
  if (response.status === 204) return { ok: true, repo, workflow, ref };
  const detail = await response.text();
  throw new Error(`Gagal trigger workflow (${response.status}): ${detail.slice(0, 500)}`);
}

export function publicConfig() {
  return {
    port: 0,
    publicBaseUrl: cleanBaseUrl(process.env.PUBLIC_BASE_URL),
    providers: {
      openai: Boolean(process.env.OPENAI_API_KEY),
      openaiBaseUrl: cleanBaseUrl(process.env.OPENAI_BASE_URL || "https://api.openai.com/v1"),
      storyModel: clean(process.env.STORY_MODEL || "gpt-4.1-mini"),
      imageModel: clean(process.env.IMAGE_MODEL || "gpt-image-1-mini"),
      imageSize: clean(process.env.IMAGE_SIZE || "1024x1536"),
      imageQuality: clean(process.env.IMAGE_QUALITY || "low"),
      videoProvider: clean(process.env.VIDEO_PROVIDER || "gemini-veo"),
      videoBaseUrl: cleanBaseUrl(process.env.VIDEO_BASE_URL || process.env.GEMINI_BASE_URL || "https://generativelanguage.googleapis.com"),
      videoEndpointMode: clean(process.env.VIDEO_ENDPOINT_MODE || "gemini"),
      videoModel: clean(process.env.VIDEO_MODEL || "veo-3.1-lite-generate-preview"),
      videoAspectRatio: clean(process.env.VIDEO_ASPECT_RATIO || "9:16"),
      videoResolution: clean(process.env.VIDEO_RESOLUTION || "720p"),
      videoSeconds: Number(process.env.VIDEO_SECONDS || 4),
      videoApiKeySet: Boolean(process.env.VIDEO_API_KEY || process.env.GEMINI_API_KEY || process.env.DINOIKI_API_KEY),
      facebookUploadEnabled: String(process.env.FACEBOOK_UPLOAD_ENABLED || "").toLowerCase() === "true",
      facebookPageIdSet: Boolean(process.env.BANYAKTAU_FACEBOOK_PAGE_ID || process.env.FACEBOOK_PAGE_ID),
      facebookPageTokenSet: Boolean(
        process.env.BANYAKTAU_FACEBOOK_PAGE_ACCESS_TOKEN
        || process.env.FACEBOOK_PAGE_ACCESS_TOKEN
        || process.env.BANYAKTAU_FACEBOOK_USER_ACCESS_TOKEN
        || process.env.FACEBOOK_USER_ACCESS_TOKEN
      ),
      geminiApiKeySet: Boolean(process.env.GEMINI_API_KEY),
      geminiBaseUrl: cleanBaseUrl(process.env.GEMINI_BASE_URL || "https://generativelanguage.googleapis.com"),
      openaiApiKeySet: Boolean(process.env.OPENAI_API_KEY),
      openaiTtsModel: clean(process.env.OPENAI_TTS_MODEL || "gpt-4o-mini-tts"),
      openaiTtsVoice: clean(process.env.OPENAI_TTS_VOICE || "shimmer"),
      openaiTranscribeModel: clean(process.env.OPENAI_TRANSCRIBE_MODEL || "whisper-1"),
      elevenlabsApiKeySet: Boolean(process.env.ELEVENLABS_API_KEY),
      elevenlabsModel: clean(process.env.ELEVENLABS_MODEL || "eleven_multilingual_v2"),
      elevenlabsVoiceId: clean(process.env.ELEVENLABS_VOICE_ID || "")
    },
    render: {
      speechTempo: Number(process.env.SPEECH_TEMPO || 1.15)
    },
    pricing: {
      videoUsdPerSecond: Number(process.env.VIDEO_USD_PER_SECOND || 0.03)
    },
    dashboard: {
      vercel: true,
      pinRequired: true
    }
  };
}

export function clean(value) {
  return String(value || "").trim();
}

function cleanBaseUrl(value) {
  return clean(value).replace(/\/+$/g, "");
}

function queryValue(req, name) {
  try {
    return new URL(req.url, "https://banyaktau.local").searchParams.get(name) || "";
  } catch {
    return "";
  }
}

function cookieValue(raw, name) {
  for (const part of String(raw || "").split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return decodeURIComponent(rest.join("="));
  }
  return "";
}
