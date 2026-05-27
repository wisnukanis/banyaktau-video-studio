import { config } from "./config.js";

function clean(value) {
  return String(value || "").trim();
}

function graphUrl(apiPath) {
  return `https://graph.facebook.com/${config.facebook.graphApiVersion}/${apiPath}`;
}

function graphVideoUrl(apiPath) {
  return `https://graph-video.facebook.com/${config.facebook.graphApiVersion}/${apiPath}`;
}

function normalizeTitle(value) {
  return [config.facebook.titlePrefix, value]
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 100) || "BanyakTau";
}

function normalizeDescription(value) {
  return String(value || "").slice(0, 4900);
}

function assertFacebookConfig() {
  const missing = [];
  if (!config.facebook.enabled) missing.push("FACEBOOK_UPLOAD_ENABLED=true");
  if (!config.facebook.pageId) missing.push("BANYAKTAU_FACEBOOK_PAGE_ID atau FACEBOOK_PAGE_ID");
  if (!config.facebook.accessToken && !config.facebook.userAccessToken) {
    missing.push("BANYAKTAU_FACEBOOK_PAGE_ACCESS_TOKEN / FACEBOOK_PAGE_ACCESS_TOKEN atau USER token");
  }
  if (missing.length) throw new Error(`Config Facebook belum lengkap: ${missing.join(", ")}`);
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
    const error = new Error(`${detail} [code ${apiError.code || response.status}]`);
    error.apiCode = apiError.code;
    error.apiSubcode = apiError.error_subcode;
    throw error;
  }
  return data;
}

async function resolvePageAccessToken() {
  if (config.facebook.accessToken) return config.facebook.accessToken;

  const url = new URL(graphUrl("me/accounts"));
  url.searchParams.set("fields", "id,name,access_token");
  url.searchParams.set("access_token", config.facebook.userAccessToken);
  const data = await fetchJson(url);
  const page = (data.data || []).find((entry) => String(entry.id) === String(config.facebook.pageId));
  if (!page?.access_token) throw new Error("User token Facebook tidak punya akses ke Page target.");
  return page.access_token;
}

async function publishFacebookPageVideo({ token, videoUrl, title, description }) {
  const body = new URLSearchParams({
    access_token: token,
    file_url: videoUrl,
    title: normalizeTitle(title),
    description: normalizeDescription(description),
    published: String(config.facebook.videoState).toUpperCase() === "PUBLISHED" ? "true" : "false"
  });

  const data = await fetchJson(graphVideoUrl(`${config.facebook.pageId}/videos`), {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body
  });
  const videoId = clean(data.id);
  return {
    ok: Boolean(videoId),
    type: "facebook_video",
    videoId,
    url: videoId ? `https://www.facebook.com/${videoId}` : ""
  };
}

async function startFacebookReel(token) {
  const url = new URL(graphUrl(`${config.facebook.pageId}/video_reels`));
  url.searchParams.set("access_token", token);
  url.searchParams.set("upload_phase", "start");
  const data = await fetchJson(url, { method: "POST" });
  const videoId = clean(data.video_id);
  const uploadUrl = clean(data.upload_url);
  if (!videoId || !uploadUrl) {
    throw new Error(`Facebook tidak mengembalikan video_id/upload_url: ${JSON.stringify(data).slice(0, 500)}`);
  }
  return { videoId, uploadUrl };
}

async function uploadFacebookReelFromUrl({ token, uploadUrl, videoUrl }) {
  await fetchJson(uploadUrl, {
    method: "POST",
    headers: {
      Authorization: `OAuth ${token}`,
      file_url: videoUrl
    }
  });
}

async function finishFacebookReel({ token, videoId, title, description }) {
  const url = new URL(graphUrl(`${config.facebook.pageId}/video_reels`));
  url.searchParams.set("access_token", token);
  url.searchParams.set("upload_phase", "finish");
  url.searchParams.set("video_id", videoId);
  url.searchParams.set("video_state", config.facebook.videoState || "PUBLISHED");
  url.searchParams.set("title", normalizeTitle(title));
  url.searchParams.set("description", normalizeDescription(description));
  const data = await fetchJson(url, { method: "POST" });
  return {
    ok: true,
    type: "facebook_reel",
    videoId,
    postId: clean(data.post_id),
    url: `https://www.facebook.com/reel/${videoId}`
  };
}

async function publishFacebookReel({ token, videoUrl, title, description }) {
  const started = await startFacebookReel(token);
  await uploadFacebookReelFromUrl({ token, uploadUrl: started.uploadUrl, videoUrl });
  return finishFacebookReel({
    token,
    videoId: started.videoId,
    title,
    description
  });
}

export async function publishToFacebook({ videoUrl, title, description }) {
  assertFacebookConfig();
  if (!videoUrl) throw new Error("Facebook butuh public video URL.");

  const token = await resolvePageAccessToken();
  if (config.facebook.mediaType === "video") {
    return publishFacebookPageVideo({ token, videoUrl, title, description });
  }

  try {
    return await publishFacebookReel({ token, videoUrl, title, description });
  } catch (error) {
    console.warn(`Facebook Reel gagal, coba fallback Page video: ${error.message}`);
    const fallback = await publishFacebookPageVideo({ token, videoUrl, title, description });
    return { ...fallback, fallbackFrom: "facebook_reel" };
  }
}

