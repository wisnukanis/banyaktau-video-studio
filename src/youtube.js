import fs from "node:fs";
import { config } from "./config.js";

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const UPLOAD_URL = "https://www.googleapis.com/upload/youtube/v3/videos";
const API_URL = "https://www.googleapis.com/youtube/v3";

function clean(value) {
  return String(value || "").trim();
}

function assertYoutubeConfig() {
  const missing = [];
  if (!config.youtube.enabled) missing.push("YOUTUBE_UPLOAD_ENABLED=true");
  if (!config.youtube.clientId) missing.push("YOUTUBE_CLIENT_ID");
  if (!config.youtube.clientSecret) missing.push("YOUTUBE_CLIENT_SECRET");
  if (!config.youtube.refreshToken) missing.push("YOUTUBE_REFRESH_TOKEN");
  if (missing.length) throw new Error(`Config YouTube belum lengkap: ${missing.join(", ")}`);
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, options);
  const text = await response.text();
  let data = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text };
  }
  if (!response.ok) {
    const apiError = data?.error || {};
    const detail = apiError.message || data.raw || text || response.statusText;
    const error = new Error(`${detail} [YouTube ${apiError.code || response.status}]`);
    error.apiCode = apiError.code;
    throw error;
  }
  return data;
}

// Refresh-token OAuth2 flow. One-time setup: create OAuth client (Desktop app)
// in Google Cloud Console, enable YouTube Data API v3, then run the standard
// Google OAuth playground / installed-app flow once to obtain a refresh token
// with scope https://www.googleapis.com/auth/youtube.upload
async function getAccessToken() {
  assertYoutubeConfig();
  const body = new URLSearchParams({
    client_id: config.youtube.clientId,
    client_secret: config.youtube.clientSecret,
    refresh_token: config.youtube.refreshToken,
    grant_type: "refresh_token"
  });
  const data = await fetchJson(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body
  });
  if (!data.access_token) throw new Error("Gagal mendapatkan YouTube access token dari refresh token.");
  return data.access_token;
}

function buildTitle(value) {
  const prefix = config.youtube.titlePrefix;
  return [prefix, value].filter(Boolean).join(" ").replace(/\s+/g, " ").trim().slice(0, 100) || "BanyakTau";
}

function buildDescription(value, tags) {
  const hashtags = (tags || []).map((tag) => `#${tag.replace(/^#/, "")}`).join(" ");
  return [clean(value), hashtags].filter(Boolean).join("\n\n").slice(0, 4900);
}

function buildTags(tags) {
  return (Array.isArray(tags) ? tags : [])
    .map((tag) => clean(tag).replace(/^#/, ""))
    .filter(Boolean)
    .slice(0, 15);
}

async function initResumableSession({ token, title, description, tags }) {
  const metadata = {
    snippet: {
      title: buildTitle(title),
      description: buildDescription(description, tags),
      tags: buildTags(tags),
      categoryId: config.youtube.categoryId
    },
    status: {
      privacyStatus: config.youtube.privacyStatus,
      selfDeclaredMadeForKids: config.youtube.madeForKids
    }
  };

  const response = await fetch(`${UPLOAD_URL}?uploadType=resumable&part=snippet,status`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${token}`,
      "Content-Type": "application/json",
      "X-Upload-Content-Type": "video/mp4"
    },
    body: JSON.stringify(metadata)
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Gagal membuka sesi resumable upload YouTube: ${text}`);
  }

  const uploadUrl = response.headers.get("location");
  if (!uploadUrl) throw new Error("YouTube tidak mengembalikan upload URL (Location header kosong).");
  return uploadUrl;
}

async function uploadVideoBinary({ uploadUrl, videoPath }) {
  const buffer = fs.readFileSync(videoPath);
  const response = await fetch(uploadUrl, {
    method: "PUT",
    headers: {
      "Content-Type": "video/mp4",
      "Content-Length": String(buffer.length)
    },
    body: buffer
  });
  const text = await response.text();
  let data = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text };
  }
  if (!response.ok) {
    throw new Error(`Gagal mengunggah berkas video ke YouTube: ${data.raw || text}`);
  }
  return data;
}

async function setThumbnail({ token, videoId, thumbnailPath }) {
  if (!thumbnailPath || !fs.existsSync(thumbnailPath)) return;
  try {
    const buffer = fs.readFileSync(thumbnailPath);
    await fetchJson(`${API_URL}/thumbnails/set?videoId=${videoId}`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${token}`,
        "Content-Type": "image/jpeg",
        "Content-Length": String(buffer.length)
      },
      body: buffer
    });
  } catch (error) {
    console.warn(`[YouTube] Gagal set thumbnail kustom: ${error.message}`);
  }
}

export async function publishToYoutube({ videoPath, title, description, tags, thumbnailPath }) {
  assertYoutubeConfig();
  if (!videoPath || !fs.existsSync(videoPath)) {
    throw new Error("YouTube membutuhkan videoPath lokal yang valid (resumable upload dari file).");
  }

  const token = await getAccessToken();
  const uploadUrl = await initResumableSession({ token, title, description, tags });
  const result = await uploadVideoBinary({ uploadUrl, videoPath });

  const videoId = result?.id;
  if (!videoId) throw new Error(`YouTube tidak mengembalikan video ID. Respons: ${JSON.stringify(result)}`);

  await setThumbnail({ token, videoId, thumbnailPath });

  return {
    ok: true,
    type: "youtube_short",
    videoId,
    url: `https://www.youtube.com/shorts/${videoId}`,
    privacyStatus: config.youtube.privacyStatus
  };
}

// Pull basic public statistics for a published video (used by analytics sync).
export async function fetchYoutubeVideoStats(videoId) {
  if (!videoId) return null;
  const token = await getAccessToken();
  const data = await fetchJson(
    `${API_URL}/videos?part=statistics,contentDetails&id=${encodeURIComponent(videoId)}`,
    { headers: { "Authorization": `Bearer ${token}` } }
  );
  const item = data.items?.[0];
  if (!item) return null;
  return {
    videoId,
    viewCount: Number(item.statistics?.viewCount || 0),
    likeCount: Number(item.statistics?.likeCount || 0),
    commentCount: Number(item.statistics?.commentCount || 0),
    fetchedAt: new Date().toISOString()
  };
}
