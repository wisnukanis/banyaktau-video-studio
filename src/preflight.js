import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config, paths } from "./config.js";
import { remoteConfig, remoteEnabled } from "./remote.js";

export async function runPreflight() {
  const checks = [];
  checks.push(checkCommand("ffmpeg"));
  checks.push(checkCommand("ffprobe"));
  checks.push(checkValue("OPENAI_API_KEY", Boolean(config.openai.apiKey), "Story, image, TTS, dan transkripsi butuh key ini."));

  const remote = remoteConfig();
  const hasSocialPublish = config.facebook.enabled || config.instagram.enabled;
  const needsPublicBaseUrl = remoteEnabled() || hasSocialPublish;
  checks.push(checkValue(
    "PUBLIC_BASE_URL",
    Boolean(config.publicBaseUrl || process.env.PUBLIC_BASE_URL),
    needsPublicBaseUrl
      ? "Wajib untuk URL asset publik saat upload remote atau publish sosial aktif."
      : "Belum diisi. Aman jika hanya generate lokal tanpa upload/publish.",
    needsPublicBaseUrl
  ));

  checks.push(checkValue(
    "UPLOAD_DRIVER",
    remoteEnabled(),
    remoteEnabled()
      ? `Driver aktif: ${remote.driver}`
      : "Tidak ada FTP/SFTP. Video tetap bisa dibuat, tapi tidak diupload sebagai asset publik.",
    false
  ));
  if (remoteEnabled() && remote.driver !== "github") {
    checks.push(checkValue(`${remote.prefix}_HOST`, Boolean(remote.host), "Host upload remote wajib ada."));
    checks.push(checkValue(`${remote.prefix}_USER`, Boolean(remote.user), "User upload remote wajib ada."));
    checks.push(checkValue(`${remote.prefix}_PASSWORD`, Boolean(remote.password), "Password upload remote wajib ada."));
    checks.push(checkValue(`${remote.prefix}_REMOTE_DIR`, Boolean(remote.remoteDir), "Folder remote wajib ada."));
  }

  if (config.facebook.enabled) {
    checks.push(checkValue("FACEBOOK_PAGE_ID", Boolean(config.facebook.pageId), "Page Facebook Dunialuas wajib diisi untuk auto upload."));
    checks.push(checkValue("FACEBOOK_TOKEN", Boolean(config.facebook.accessToken || config.facebook.userAccessToken), "Page token atau user token Facebook wajib diisi."));
  }

  if (config.instagram.enabled) {
    checks.push(checkValue(
      "INSTAGRAM_TARGET",
      Boolean(config.instagram.igUserId || config.facebook.pageId),
      "Isi INSTAGRAM_IG_USER_ID, atau hubungkan Instagram Business ke Facebook Page target."
    ));
    checks.push(checkValue(
      "INSTAGRAM_TOKEN",
      Boolean(config.instagram.accessToken || config.facebook.userAccessToken || config.facebook.accessToken),
      "Access token Instagram atau token Meta/Facebook yang punya izin instagram_content_publish."
    ));
  }

  checks.push(await checkFile("background_music", path.join(paths.rootDir, "assets", "music", "eksplorasi-literasi.m4a")));

  const failed = checks.filter((check) => !check.ok && check.required !== false);
  const warnings = checks.filter((check) => !check.ok && check.required === false);
  return {
    ok: failed.length === 0,
    generatedAt: new Date().toISOString(),
    checks,
    summary: failed.length
      ? `${failed.length} preflight check gagal.`
      : warnings.length ? `Preflight aman, ${warnings.length} warning.` : "Preflight aman."
  };
}

function checkCommand(name) {
  const result = spawnSync(name, ["-version"], { encoding: "utf8", windowsHide: true });
  return {
    name,
    ok: result.status === 0,
    detail: result.status === 0 ? firstLine(result.stdout || result.stderr) : `${name} tidak tersedia.`
  };
}

function checkValue(name, ok, detail, required = true) {
  return { name, ok: Boolean(ok), detail, required };
}

async function checkFile(name, filePath) {
  try {
    const stat = await fs.stat(filePath);
    return { name, ok: stat.isFile(), detail: `${Math.round(stat.size / 1024)} KB` };
  } catch {
    return { name, ok: false, detail: `${filePath} tidak ditemukan.` };
  }
}

function firstLine(value) {
  return String(value || "").split(/\r?\n/).find(Boolean) || "OK";
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const result = await runPreflight();
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exitCode = 1;
}
