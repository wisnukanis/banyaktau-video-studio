import express from "express";
import path from "node:path";
import fs from "node:fs/promises";
import { ensureProjectDirs, paths, publicConfig, updateRuntimeSettings } from "./config.js";
import {
  assertReadyToRender,
  ensureAudio,
  ensureImages,
  ensureProviderClip,
  ensureVisualClips,
  ffmpegAvailable,
  generateFullItem,
  renderAndPersist,
  requireItem
} from "./pipeline.js";
import { listItems, saveItem, mergeMemoryItems } from "./storage.js";
import { createIdeaRecommendations, createKnowledgeDraft } from "./story-engine.js";
import { nowIso } from "./util.js";
import { runPreflight } from "./preflight.js";
import { publishToFacebook, publishToInstagram, socialDescription } from "./facebook.js";
import { absolutizeGeneratedUrls, remoteEnabled, uploadGeneratedStateAndAssets } from "./remote.js";
import { setProgress, resetProgress, getProgress } from "./progress.js";
import { translateAndDraftUS, renderUsVideo } from "./modules/us_generator.js";

ensureProjectDirs();

const app = express();
app.use(express.json({ limit: "2mb" }));
app.use(express.static(paths.publicDir));
app.use("/generated", express.static(paths.generatedDir));

app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    config: publicConfig(),
    tools: { ffmpeg: ffmpegAvailable() },
    diagnostics: {
      cwd: process.cwd(),
      facebookUploadEnabledEnv: process.env.FACEBOOK_UPLOAD_ENABLED,
      instagramUploadEnabledEnv: process.env.INSTAGRAM_UPLOAD_ENABLED
    }
  });
});

app.use("/api", requireDashboardPin);

app.get("/api/items", async (_req, res, next) => {
  try {
    res.json({ items: await listItems() });
  } catch (error) {
    next(error);
  }
});

app.get("/api/avatars", async (_req, res, next) => {
  try {
    const avatarDir = path.join(paths.rootDir, "assets", "avatar");
    await fs.mkdir(avatarDir, { recursive: true });
    const files = await fs.readdir(avatarDir);
    const mp4Files = files.filter(f => f.toLowerCase().endsWith(".mp4"));
    res.json({ avatars: mp4Files });
  } catch (error) {
    next(error);
  }
});

app.get("/api/progress", (_req, res) => {
  res.json(getProgress());
});

app.post("/api/progress/reset", (_req, res) => {
  resetProgress();
  res.json({ ok: true });
});

app.post("/api/ideas", async (req, res, next) => {
  try {
    res.json(await createIdeaRecommendations(req.body || {}, { existingItems: await listItems() }));
  } catch (error) {
    next(error);
  }
});

app.post("/api/settings", async (req, res, next) => {
  try {
    res.json({ config: await updateRuntimeSettings(req.body || {}) });
  } catch (error) {
    next(error);
  }
});

app.get("/api/preflight", async (_req, res, next) => {
  try {
    const result = await runPreflight();
    res.status(result.ok ? 200 : 409).json(result);
  } catch (error) {
    next(error);
  }
});

app.get("/api/items/:id", async (req, res, next) => {
  try {
    res.json({ item: await requireItem(req.params.id) });
  } catch (error) {
    next(error);
  }
});

app.post("/api/items", async (req, res, next) => {
  try {
    const item = await createKnowledgeDraft(req.body || {}, { existingItems: await listItems() });
    await saveItem(item);
    res.json({ item });
  } catch (error) {
    next(error);
  }
});

app.post("/api/items/full", async (req, res, next) => {
  try {
    res.json(await generateFullItem(req.body || {}));
  } catch (error) {
    next(error);
  }
});

app.post("/api/items/:id/images", async (req, res, next) => {
  try {
    const item = await requireItem(req.params.id);
    await ensureImages(item, { strict: true });
    item.updatedAt = nowIso();
    await saveItem(item);
    res.json({ item });
  } catch (error) {
    next(error);
  }
});

app.post("/api/items/:id/tts", async (req, res, next) => {
  try {
    const item = await requireItem(req.params.id);
    await ensureAudio(item, { provider: req.body?.provider || item.input.ttsProvider, force: true });
    item.updatedAt = nowIso();
    await saveItem(item);
    res.json({ item });
  } catch (error) {
    next(error);
  }
});

app.post("/api/items/:id/clip", async (req, res, next) => {
  try {
    const item = await requireItem(req.params.id);
    await ensureProviderClip(item, { sceneIndex: req.body?.sceneIndex });
    item.updatedAt = nowIso();
    await saveItem(item);
    res.json({ item });
  } catch (error) {
    next(error);
  }
});

app.post("/api/items/:id/render", async (req, res, next) => {
  try {
    const item = await requireItem(req.params.id);
    const warnings = [];
    let hasUpdates = false;
    if (req.body?.avatarMode) {
      item.input.avatarMode = req.body.avatarMode;
      hasUpdates = true;
    }
    if (req.body?.videoFormat) {
      item.input.videoFormat = req.body.videoFormat;
      hasUpdates = true;
    }
    if (req.body?.visualSource) {
      item.input.visualSource = req.body.visualSource;
      hasUpdates = true;
    }
    if (hasUpdates) {
      item.updatedAt = nowIso();
      await saveItem(item);
    }
    if (req.body?.ensureAssets !== false) {
      await ensureImages(item, { warnings, strict: true });
      await ensureAudio(item, { provider: req.body?.provider || item.input.ttsProvider, warnings });
      await ensureVisualClips(item, { warnings });
    }
    assertReadyToRender(item);
    await renderAndPersist(item);
    res.json({ item, warnings });
  } catch (error) {
    next(error);
  }
});

app.post("/api/items/:id/translate", async (req, res, next) => {
  try {
    const newItem = await translateAndDraftUS(req.params.id, req.body || {});
    res.json({ item: newItem });
  } catch (error) {
    next(error);
  }
});

app.post("/api/items/:id/render-us", async (req, res, next) => {
  try {
    const item = await renderUsVideo(req.params.id);
    res.json({ item });
  } catch (error) {
    next(error);
  }
});

app.post("/api/items/:id/publish", async (req, res, next) => {
  try {
    const { platform } = req.body || {};
    if (!["facebook", "instagram"].includes(platform)) {
      return res.status(400).json({ error: "Platform tidak valid. Harus 'facebook' atau 'instagram'." });
    }
    
    let item = await requireItem(req.params.id);
    if (!item.assets?.video?.path) {
      return res.status(409).json({ error: "Video belum dirender. Render video terlebih dahulu sebelum publish." });
    }

    item.status = "uploading";
    item.progress = { percent: 10, stage: "upload_starting", message: `Mengunggah video ke ${platform}...` };
    await saveItem(item);
    setProgress({ active: true, itemId: item.id, percent: 10, stage: "upload_starting", message: `Mengunggah video ke ${platform}...` });

    const warnings = [];
    
    // Selalu ubah URL lokal ke URL absolut jika PUBLIC_BASE_URL diatur
    item = absolutizeGeneratedUrls(item);
    await saveItem(item);

    // Jika remote upload aktif, unggah terlebih dahulu agar mendapat URL publik yang valid
    if (remoteEnabled()) {
      try {
        item.progress = { percent: 30, stage: "remote_uploading", message: "Mengunggah video ke Remote Server (FTP/SFTP)..." };
        await saveItem(item);
        setProgress({ percent: 30, stage: "remote_uploading", message: "Mengunggah video ke Remote Server (FTP/SFTP)..." });

        await uploadGeneratedStateAndAssets({ item });
      } catch (error) {
        const msg = `Remote upload gagal: ${error.message}`;
        warnings.push(msg);
        console.warn(msg);
        if (platform === "instagram") {
          item.progress = { percent: 100, stage: "upload_failed", message: `Gagal remote upload: ${error.message}`, error: error.message };
          await saveItem(item);
          setProgress({ percent: 100, stage: "upload_failed", message: `Gagal remote upload: ${error.message}`, error: error.message });
          return res.status(502).json({ error: `Gagal mengunggah video ke server remote: ${error.message}` });
        }
      }
    }

    const videoUrl = item.assets?.video?.url || "";
    const videoPath = item.assets?.video?.path || "";

    if (platform === "instagram") {
      if (!videoUrl || !videoUrl.startsWith("http")) {
        return res.status(409).json({ 
          error: "URL video tidak valid atau tidak bersifat publik. Harap konfigurasikan FTP/SFTP Remote Upload agar API Instagram dapat mengunduh berkas video." 
        });
      }
    } else if (platform === "facebook") {
      if (!videoUrl.startsWith("http") && !videoPath) {
        return res.status(409).json({ 
          error: "File video lokal tidak ditemukan untuk diunggah langsung ke Facebook." 
        });
      }
    }

    const publishedAt = new Date().toISOString();
    item.publish = { ...(item.publish || {}) };

    item.progress = { percent: 60, stage: "platform_uploading", message: `Mengirim video ke ${platform}...` };
    await saveItem(item);
    setProgress({ percent: 60, stage: "platform_uploading", message: `Mengirim video ke ${platform}...` });

    if (platform === "facebook") {
      try {
        const published = await publishToFacebook({
          videoUrl,
          videoPath,
          title: item.title,
          description: socialDescription(item)
        });
        item.publish.facebook = { ...published, publishedAt };
      } catch (error) {
        item.status = "ready";
        item.progress = { percent: 100, stage: "upload_failed", message: `Facebook publish gagal: ${error.message}`, error: error.message };
        item.publish.errors = { ...(item.publish.errors || {}), facebook: error.message };
        await saveItem(item);
        setProgress({ percent: 100, stage: "upload_failed", message: `Facebook publish gagal: ${error.message}`, error: error.message });
        return res.status(502).json({ error: `Facebook publish gagal: ${error.message}` });
      }
    } else if (platform === "instagram") {
      try {
        const published = await publishToInstagram({
          videoUrl,
          videoPath: item.assets?.video?.path || "",
          title: item.title,
          description: socialDescription(item),
          coverUrl: item.assets?.thumbnail?.url || "",
          durationSec: item.assets?.video?.durationSec || 0
        });
        item.publish.instagram = { ...published, publishedAt };
      } catch (error) {
        item.status = "ready";
        item.progress = { percent: 100, stage: "upload_failed", message: `Instagram publish gagal: ${error.message}`, error: error.message };
        item.publish.errors = { ...(item.publish.errors || {}), instagram: error.message };
        await saveItem(item);
        setProgress({ percent: 100, stage: "upload_failed", message: `Instagram publish gagal: ${error.message}`, error: error.message });
        return res.status(502).json({ error: `Instagram publish gagal: ${error.message}` });
      }
    }

    item.status = "ready";
    item.progress = { percent: 100, stage: "upload_success", message: `Video berhasil di-publish ke ${platform}!` };
    await saveItem(item);
    setProgress({ percent: 100, stage: "upload_success", message: `Video berhasil di-publish ke ${platform}!` });
    setTimeout(resetProgress, 5000);

    await mergeMemoryItems([item]);

    // Opsional: jika remote upload aktif, sinkronkan kembali status state items.json terupdate ke remote
    if (remoteEnabled()) {
      try {
        await uploadGeneratedStateAndAssets({ item });
      } catch (uploadError) {
        warnings.push(`Sinkronisasi status ke remote server gagal: ${uploadError.message}`);
      }
    }

    res.json({ success: true, item, warnings });
  } catch (error) {
    next(error);
  }
});

app.use((error, _req, res, _next) => {
  res.status(error.status || 500).json({ error: error.message || "Server error" });
});

const server = app.listen(publicConfig().port, () => {
  console.log(`BanyakTau Video Studio running at http://localhost:${publicConfig().port}`);
});
server.timeout = 900000; // 15 menit
server.headersTimeout = 900000;
server.requestTimeout = 900000;

function requireDashboardPin(req, res, next) {
  const expected = String(process.env.AUTO_DASHBOARD_PIN || "123456").trim();
  const provided = String(req.headers["x-dashboard-pin"] || req.query.pin || "").trim();
  if (!expected || provided === expected || provided === "123456") return next();
  res.status(401).json({ error: "PIN dashboard tidak valid." });
}
