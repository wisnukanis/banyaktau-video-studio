import { Readable } from "node:stream";
import { methodAllowed, readRemoteItems, requireAuth, sendJson } from "./_utils.js";

export default async function handler(req, res) {
  if (!methodAllowed(req, res, ["GET"])) return;
  if (!requireAuth(req, res)) return;

  const id = queryValue(req, "id");
  if (!id) {
    sendJson(res, 400, { error: "ID video wajib diisi." });
    return;
  }

  const item = (await readRemoteItems()).find((entry) => String(entry.id) === id);
  const videoUrl = absoluteAssetUrl(item?.assets?.video?.url);
  if (!videoUrl) {
    sendJson(res, 404, { error: "Video belum tersedia untuk item ini." });
    return;
  }

  const response = await fetch(videoUrl);
  if (!response.ok || !response.body) {
    sendJson(res, 502, { error: `Gagal mengambil video (${response.status}).` });
    return;
  }

  const filename = `${slugify(item.title || item.id || "banyaktau-video")}.mp4`;
  res.statusCode = 200;
  res.setHeader("Content-Type", response.headers.get("content-type") || "video/mp4");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.setHeader("Cache-Control", "private, no-store");
  const size = response.headers.get("content-length");
  if (size) res.setHeader("Content-Length", size);
  Readable.fromWeb(response.body).pipe(res);
}

function queryValue(req, name) {
  try {
    return new URL(req.url, "https://banyaktau.local").searchParams.get(name) || "";
  } catch {
    return "";
  }
}

function slugify(value) {
  return String(value || "banyaktau-video")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "banyaktau-video";
}

function absoluteAssetUrl(url) {
  const value = String(url || "");
  if (/^https?:\/\//i.test(value)) return value;
  const base = String(process.env.PUBLIC_BASE_URL || "").replace(/\/+$/g, "");
  return base && value ? `${base}/${value.replace(/^\/+/g, "")}` : "";
}
