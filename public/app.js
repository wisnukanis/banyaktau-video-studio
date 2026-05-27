const state = {
  items: [],
  current: null,
  ideas: [],
  selectedIdea: null,
  config: null,
  busy: false
};

const YOUTUBE_UPLOAD_URL = "https://www.youtube.com/upload";

const els = {
  form: document.querySelector("#generateForm"),
  settingsForm: document.querySelector("#settingsForm"),
  ideaBtn: document.querySelector("#ideaBtn"),
  fullBtn: document.querySelector("#fullBtn"),
  draftBtn: document.querySelector("#draftBtn"),
  settingsBtn: document.querySelector("#settingsBtn"),
  preflightBtn: document.querySelector("#preflightBtn"),
  imageBtn: document.querySelector("#imageBtn"),
  ttsBtn: document.querySelector("#ttsBtn"),
  clipBtn: document.querySelector("#clipBtn"),
  renderBtn: document.querySelector("#renderBtn"),
  statusText: document.querySelector("#statusText"),
  itemTitle: document.querySelector("#itemTitle"),
  itemCount: document.querySelector("#itemCount"),
  itemList: document.querySelector("#itemList"),
  tokenMetric: document.querySelector("#tokenMetric"),
  imageMetric: document.querySelector("#imageMetric"),
  ttsMetric: document.querySelector("#ttsMetric"),
  videoMetric: document.querySelector("#videoMetric"),
  totalMetric: document.querySelector("#totalMetric"),
  thumbnailSlot: document.querySelector("#thumbnailSlot"),
  videoSlot: document.querySelector("#videoSlot"),
  downloadVideoBtn: document.querySelector("#downloadVideoBtn"),
  shareYoutubeBtn: document.querySelector("#shareYoutubeBtn"),
  copyVideoLinkBtn: document.querySelector("#copyVideoLinkBtn"),
  hookText: document.querySelector("#hookText"),
  pointList: document.querySelector("#pointList"),
  factNote: document.querySelector("#factNote"),
  youtubeTitle: document.querySelector("#youtubeTitle"),
  youtubeCaption: document.querySelector("#youtubeCaption"),
  copyYoutubeBtn: document.querySelector("#copyYoutubeBtn"),
  sceneGrid: document.querySelector("#sceneGrid"),
  assetStatus: document.querySelector("#assetStatus"),
  providerStatus: document.querySelector("#providerStatus"),
  selectedIdea: document.querySelector("#selectedIdea"),
  ideaMeta: document.querySelector("#ideaMeta"),
  ideaList: document.querySelector("#ideaList"),
  galleryGrid: document.querySelector("#galleryGrid"),
  settingsTabs: document.querySelectorAll("[data-settings-tab]"),
  settingsPanels: document.querySelectorAll("[data-settings-panel]"),
  flowSteps: document.querySelectorAll("[data-step]")
};

init();

async function init() {
  bindEvents();
  state.config = (await api("/api/health")).config;
  fillSettingsForm();
  await refreshItems();
  render();
}

function bindEvents() {
  els.form.addEventListener("submit", async (event) => {
    event.preventDefault();
    await generateFull();
  });
  els.settingsForm.addEventListener("submit", saveSettings);
  els.settingsTabs.forEach((tab) => {
    tab.addEventListener("click", () => showSettingsTab(tab.dataset.settingsTab));
  });
  els.ideaBtn?.addEventListener("click", generateIdeas);
  els.draftBtn?.addEventListener("click", generateDraft);
  els.preflightBtn?.addEventListener("click", runPreflight);
  els.imageBtn?.addEventListener("click", generateImages);
  els.ttsBtn?.addEventListener("click", generateTts);
  els.clipBtn?.addEventListener("click", () => generateClip());
  els.renderBtn?.addEventListener("click", renderVideo);
  els.copyYoutubeBtn?.addEventListener("click", copyCurrentYoutube);
  els.downloadVideoBtn?.addEventListener("click", () => downloadVideo(state.current));
  els.shareYoutubeBtn?.addEventListener("click", () => shareToYoutube(state.current));
  els.copyVideoLinkBtn?.addEventListener("click", () => copyVideoLink(state.current));
}

async function saveSettings(event) {
  event.preventDefault();
  setBusy(true, "Menyimpan setting API dan suara...");
  try {
    const form = new FormData(els.settingsForm);
    const data = await api("/api/settings", {
      method: "POST",
      body: JSON.stringify({
        openaiApiKey: form.get("openaiApiKey"),
        openaiBaseUrl: form.get("openaiBaseUrl"),
        storyModel: form.get("storyModel"),
        imageModel: form.get("imageModel"),
        elevenlabsApiKey: form.get("elevenlabsApiKey"),
        videoApiKey: form.get("videoApiKey"),
        videoBaseUrl: form.get("videoBaseUrl"),
        videoEndpointMode: form.get("videoEndpointMode"),
        videoModel: form.get("videoModel"),
        videoSeconds: Number(form.get("videoSeconds")),
        videoUsdPerSecond: Number(form.get("videoUsdPerSecond")),
        openaiTtsVoice: form.get("openaiTtsVoice"),
        elevenlabsVoiceId: form.get("elevenlabsVoiceId"),
        geminiApiKey: form.get("geminiApiKey"),
        geminiBaseUrl: form.get("geminiBaseUrl"),
        speechTempo: Number(form.get("speechTempo"))
      })
    });
    state.config = data.config;
    els.settingsForm.openaiApiKey.value = "";
    els.settingsForm.elevenlabsApiKey.value = "";
    els.settingsForm.videoApiKey.value = "";
    els.settingsForm.geminiApiKey.value = "";
    fillSettingsForm();
    setStatus("Setting tersimpan. Generate berikutnya memakai setting baru.");
  } catch (error) {
    setStatus(error.message);
  } finally {
    setBusy(false);
    render();
  }
}

async function refreshItems() {
  const data = await api("/api/items");
  state.items = data.items || [];
  if (!state.current && state.items.length) state.current = state.items[0];
}

async function generateIdeas() {
  const form = new FormData(els.form);
  setBusy(true, "Mencari ide dan hook terbaik...");
  try {
    const data = await api("/api/ideas", {
      method: "POST",
      body: JSON.stringify({
        seed: form.get("topic"),
        category: form.get("category"),
        durationSec: Number(form.get("durationSec"))
      })
    });
    state.ideas = data.ideas || [];
    state.selectedIdea = null;
    setStatus(`Dapat ${state.ideas.length} ide. Pilih satu, lalu klik Buat Storyboard.`);
    return state.ideas.length > 0;
  } catch (error) {
    setStatus(error.message);
    return false;
  } finally {
    setBusy(false);
    render();
  }
}

async function ensureSelectedIdea() {
  if (state.selectedIdea) return true;
  if (!state.ideas.length) {
    const hasIdeas = await generateIdeas();
    if (!hasIdeas) return false;
  }
  const first = state.ideas[0];
  if (!first) return false;
  selectIdea(first.id, { quiet: true });
  return true;
}

async function generateDraft() {
  if (!(await ensureSelectedIdea())) return;
  setBusy(true, "Membuat draft naskah dan storyboard...");
  try {
    const data = await api("/api/items", {
      method: "POST",
      body: JSON.stringify(formPayload())
    });
    state.current = data.item;
    await refreshItems();
    setStatus("Storyboard siap. Kalau naskah sudah cocok, klik Generate Video Final.");
  } catch (error) {
    setStatus(error.message);
  } finally {
    setBusy(false);
    render();
  }
}

async function generateFull() {
  setBusy(true, "Preflight dashboard sebelum generate...");
  try {
    await runPreflight({ quiet: true });
    setStatus("Membuat video otomatis dari ide sampai final...");
    const data = await api("/api/items/full", {
      method: "POST",
      body: JSON.stringify(formPayload())
    });
    if (data.item) state.current = data.item;
    await refreshItems();
    if (data.queued) {
      setStatus(statusWithWarnings("Workflow GitHub Actions dimulai. Video akan muncul otomatis di Galeri setelah selesai.", data.warnings));
    } else {
      const hasClip = data.item.assets?.clips?.length;
      setStatus(statusWithWarnings(
        hasClip ? "Video final selesai dibuat dengan clip Veo." : "Video final selesai dibuat tanpa clip Veo.",
        data.warnings
      ));
    }
  } catch (error) {
    setStatus(error.message);
  } finally {
    setBusy(false);
    render();
  }
}

async function runPreflight(options = {}) {
  if (!options.quiet) setBusy(true, "Menjalankan preflight...");
  try {
    const data = await api("/api/preflight");
    const failed = (data.checks || []).filter((check) => !check.ok);
    setStatus(failed.length ? `${data.summary} ${failed[0].name}: ${failed[0].detail}` : data.summary);
    return data;
  } catch (error) {
    setStatus(`Preflight gagal: ${error.message}`);
    throw error;
  } finally {
    if (!options.quiet) {
      setBusy(false);
      render();
    }
  }
}

async function generateImages() {
  if (!state.current) return;
  setBusy(true, "Membuat gambar AI untuk setiap scene...");
  try {
    const data = await api(`/api/items/${state.current.id}/images`, { method: "POST" });
    state.current = data.item;
    await refreshItems();
    setStatus("Gambar selesai. Klik Render Ulang kalau ingin memperbarui video final.");
  } catch (error) {
    setStatus(error.message);
  } finally {
    setBusy(false);
    render();
  }
}

async function generateTts() {
  if (!state.current) return;
  const provider = new FormData(els.form).get("ttsProvider");
  setBusy(true, `Membuat TTS ${provider}...`);
  try {
    const data = await api(`/api/items/${state.current.id}/tts`, {
      method: "POST",
      body: JSON.stringify({ provider })
    });
    state.current = data.item;
    await refreshItems();
    setStatus(`TTS ${provider} selesai. Klik Render Ulang supaya audio baru masuk ke video.`);
  } catch (error) {
    setStatus(error.message);
  } finally {
    setBusy(false);
    render();
  }
}

async function generateClip(sceneIndex) {
  if (!state.current) return;
  const cost = estimateClipCost();
  const sceneText = sceneIndex ? `scene ${sceneIndex}` : "scene paling cocok";
  setBusy(true, `Membuat clip Veo Lite ${sceneText} sekitar ${formatUsd(cost)}...`);
  try {
    const data = await api(`/api/items/${state.current.id}/clip`, {
      method: "POST",
      body: JSON.stringify({ sceneIndex })
    });
    state.current = data.item;
    await refreshItems();
    setStatus("Clip Veo siap. Klik Render Ulang supaya clip masuk ke video final.");
  } catch (error) {
    setStatus(error.message);
  } finally {
    setBusy(false);
    render();
  }
}

async function renderVideo() {
  if (!state.current) return;
  const provider = new FormData(els.form).get("ttsProvider");
  setBusy(true, "Merender video vertikal...");
  try {
    const data = await api(`/api/items/${state.current.id}/render`, {
      method: "POST",
      body: JSON.stringify({ provider, ensureAssets: true })
    });
    state.current = data.item;
    await refreshItems();
    setStatus(statusWithWarnings("Render selesai.", data.warnings));
  } catch (error) {
    setStatus(error.message);
  } finally {
    setBusy(false);
    render();
  }
}

function formPayload() {
  const form = new FormData(els.form);
  return {
    topic: form.get("topic"),
    category: form.get("category"),
    selectedIdea: null,
    tone: form.get("tone"),
    ttsProvider: form.get("ttsProvider"),
    durationSec: Number(form.get("durationSec")),
    sceneCount: Number(form.get("sceneCount")),
    imageQuality: form.get("imageQuality"),
    imageSize: "1024x1536"
  };
}

function render() {
  renderList();
  renderIdeas();
  renderGallery();
  renderSelectedIdea();
  renderCurrent();
  renderProviderStatus();
  renderFlow();
  renderButtons();
}

function renderFlow() {
  let active = "ideas";
  if (state.current?.assets?.video?.url) active = "video";
  else if (state.current) active = "storyboard";
  else if (state.selectedIdea || state.ideas.length) active = "ideas";

  els.flowSteps.forEach((step) => {
    step.classList.toggle("active", step.dataset.step === active);
    step.classList.toggle("done",
      step.dataset.step === "ideas" && Boolean(state.selectedIdea || state.current)
      || step.dataset.step === "storyboard" && Boolean(state.current)
      || step.dataset.step === "video" && Boolean(state.current?.assets?.video?.url)
    );
  });
}

function fillSettingsForm() {
  if (!state.config) return;
  els.settingsForm.openaiBaseUrl.value = state.config.providers?.openaiBaseUrl || "https://api.openai.com/v1";
  els.settingsForm.storyModel.value = state.config.providers?.storyModel || "gpt-4.1-mini";
  els.settingsForm.imageModel.value = state.config.providers?.imageModel || "gpt-image-1-mini";
  els.settingsForm.openaiTtsVoice.value = state.config.providers?.openaiTtsVoice || "shimmer";
  els.settingsForm.elevenlabsVoiceId.value = state.config.providers?.elevenlabsVoiceId || "";
  els.settingsForm.videoBaseUrl.value = state.config.providers?.videoBaseUrl || "https://ai.dinoiki.com";
  els.settingsForm.videoEndpointMode.value = state.config.providers?.videoEndpointMode || "gemini";
  els.settingsForm.videoModel.value = state.config.providers?.videoModel || "veo-3.1-lite-generate-preview";
  els.settingsForm.videoSeconds.value = state.config.providers?.videoSeconds || 4;
  els.settingsForm.videoUsdPerSecond.value = state.config.pricing?.videoUsdPerSecond ?? 0.03;
  els.settingsForm.geminiBaseUrl.value = state.config.providers?.geminiBaseUrl || "https://generativelanguage.googleapis.com";
  els.settingsForm.speechTempo.value = state.config.render?.speechTempo || 1.15;
}

function showSettingsTab(name) {
  els.settingsTabs.forEach((tab) => tab.classList.toggle("active", tab.dataset.settingsTab === name));
  els.settingsPanels.forEach((panel) => panel.classList.toggle("active", panel.dataset.settingsPanel === name));
}

function renderProviderStatus() {
  if (state.config?.dashboard?.vercel) {
    els.providerStatus.textContent = "GitHub Actions aktif";
    return;
  }
  const openai = state.config?.providers?.openai ? "OpenAI aktif" : "OpenAI kosong";
  const elevenlabs = state.config?.providers?.elevenlabs ? "Eleven aktif" : "Eleven kosong";
  const video = state.config?.providers?.videoApiKeySet ? "Video aktif" : "Video kosong";
  els.providerStatus.textContent = `${openai} / ${elevenlabs} / ${video}`;
}

function renderList() {
  els.itemCount.textContent = String(state.items.length);
  els.itemList.innerHTML = state.items.map((item) => `
    <button type="button" data-id="${item.id}">
      <strong>${escapeHtml(item.title)}</strong>
      <span>${escapeHtml(item.assets?.audio?.provider || item.input?.ttsProvider || "-")} - ${new Date(item.updatedAt || item.createdAt).toLocaleString("id-ID")}</span>
    </button>
  `).join("");
  els.itemList.querySelectorAll("button").forEach((button) => {
    button.addEventListener("click", () => {
      state.current = state.items.find((item) => item.id === button.dataset.id);
      render();
    });
  });
}

function renderGallery() {
  const videos = state.items.filter((item) => item.assets?.video?.url);
  if (!els.galleryGrid) return;
  if (!videos.length) {
    els.galleryGrid.innerHTML = `<div class="empty-gallery">Belum ada video final. Generate video dulu, nanti muncul di sini.</div>`;
    return;
  }
  els.galleryGrid.innerHTML = videos.map((item) => `
    <article class="gallery-card">
      ${thumbnailUrl(item) ? `<img class="gallery-thumbnail" src="${thumbnailUrl(item)}" alt="Thumbnail ${escapeHtml(item.title)}" loading="lazy">` : ""}
      <video controls playsinline preload="metadata" poster="${thumbnailUrl(item)}" src="${item.assets.video.url}"></video>
      <div class="gallery-body">
        <strong>${escapeHtml(item.title)}</strong>
        <span>${formatDuration(item.assets.video.durationSec)} - ${new Date(item.updatedAt || item.createdAt).toLocaleString("id-ID")}</span>
        <div class="gallery-actions">
          <button type="button" class="mini-action" data-download-video="${item.id}">Download</button>
          ${item.assets.thumbnail?.url ? `<a class="mini-action" href="${item.assets.thumbnail.url}" download>Thumbnail</a>` : ""}
          <a class="mini-action" href="${item.assets.video.url}" target="_blank" rel="noreferrer">Buka</a>
          <button type="button" class="mini-action" data-copy-url="${item.assets.video.url}">Copy Link</button>
          <button type="button" class="mini-action accent" data-share-youtube="${item.id}">Share YouTube</button>
          <button type="button" class="mini-action" data-copy-youtube="${item.id}">Copy Caption</button>
        </div>
      </div>
    </article>
  `).join("");
  els.galleryGrid.querySelectorAll("[data-download-video]").forEach((button) => {
    button.addEventListener("click", () => {
      const item = state.items.find((entry) => entry.id === button.dataset.downloadVideo);
      downloadVideo(item);
    });
  });
  els.galleryGrid.querySelectorAll("[data-share-youtube]").forEach((button) => {
    button.addEventListener("click", () => {
      const item = state.items.find((entry) => entry.id === button.dataset.shareYoutube);
      shareToYoutube(item);
    });
  });
  els.galleryGrid.querySelectorAll("[data-copy-url]").forEach((button) => {
    button.addEventListener("click", async () => {
      const url = new URL(button.dataset.copyUrl, window.location.origin).href;
      await copyText(url);
      setStatus("Link video disalin.");
    });
  });
  els.galleryGrid.querySelectorAll("[data-copy-youtube]").forEach((button) => {
    button.addEventListener("click", async () => {
      const item = state.items.find((entry) => entry.id === button.dataset.copyYoutube);
      await copyText(youtubeCopy(item));
      setStatus("Judul dan caption YouTube disalin.");
    });
  });
}

function renderIdeas() {
  if (!state.ideas.length) {
    els.ideaList.innerHTML = "";
    els.ideaMeta.textContent = `Clip Veo Lite opsional: ${state.config?.providers?.videoSeconds || 4} detik kira-kira ${formatUsd(estimateClipCost())}`;
    return;
  }
  els.ideaMeta.textContent = "Pilih satu ide untuk storyboard";
  els.ideaList.innerHTML = state.ideas.map((idea) => `
    <article class="idea-card ${state.selectedIdea?.id === idea.id ? "selected" : ""}">
      <button type="button" data-idea-id="${idea.id}">
        <span>${escapeHtml(idea.category || "ide")}</span>
        <strong>${escapeHtml(idea.title)}</strong>
        <em>${escapeHtml(idea.hook)}</em>
        <small>${escapeHtml(idea.whyGood || idea.angle || "")}</small>
      </button>
    </article>
  `).join("");
  els.ideaList.querySelectorAll("[data-idea-id]").forEach((button) => {
    button.addEventListener("click", () => selectIdea(button.dataset.ideaId));
  });
}

function selectIdea(id, options = {}) {
  const idea = state.ideas.find((entry) => entry.id === id);
  if (!idea) return;
  state.selectedIdea = idea;
  els.form.topic.value = idea.topic;
  if (idea.category && [...els.form.category.options].some((option) => option.value === idea.category)) {
    els.form.category.value = idea.category;
  }
  if (!options.quiet) setStatus("Ide dipilih. Sekarang bisa Buat Storyboard atau Generate Video.");
  render();
}

function renderSelectedIdea() {
  if (!state.selectedIdea) {
    if (!els.selectedIdea) return;
    els.selectedIdea.textContent = "Belum ada ide terpilih.";
    return;
  }
  if (!els.selectedIdea) return;
  els.selectedIdea.innerHTML = `
    <strong>${escapeHtml(state.selectedIdea.title)}</strong>
    <span>${escapeHtml(state.selectedIdea.hook)}</span>
  `;
}

function renderCurrent() {
  const item = state.current;
  if (!item) {
    els.itemTitle.textContent = "Belum ada video";
    els.hookText.textContent = "-";
    els.pointList.innerHTML = "";
    els.factNote.textContent = "-";
    els.sceneGrid.innerHTML = "";
    els.videoSlot.textContent = "Video belum dirender";
    if (els.thumbnailSlot) els.thumbnailSlot.textContent = "Thumbnail belum tersedia";
    els.assetStatus.textContent = "Alur: Generate Ide -> Buat Storyboard -> Generate Video Final";
    els.videoMetric.textContent = "$0.000";
    renderYoutubeCopy(null);
    return;
  }

  els.itemTitle.textContent = item.title;
  els.hookText.textContent = item.plan.hook;
  els.pointList.innerHTML = (item.plan.importantPoints || []).map((point) => `<li>${escapeHtml(point)}</li>`).join("");
  els.factNote.textContent = item.plan.factCheckNote || "-";
  renderYoutubeCopy(item);
  els.tokenMetric.textContent = formatNumber(item.cost.totalTokens);
  els.imageMetric.textContent = formatUsd(item.cost.imageUsd);
  els.ttsMetric.textContent = formatUsd(item.cost.ttsUsd);
  els.videoMetric.textContent = formatUsd(item.cost.videoUsd);
  els.totalMetric.textContent = formatUsd(item.cost.totalUsd);

  const imageCount = item.assets.images?.length || 0;
  const clipCount = item.assets.clips?.length || 0;
  const audio = item.assets.audio?.provider ? `Audio: ${item.assets.audio.provider}` : "Audio: belum";
  const final = item.assets.video?.url ? "Final: siap" : "Final: belum";
  els.assetStatus.textContent = `Gambar: ${imageCount}/${item.plan.scenes.length} - Clip Veo: ${clipCount || "opsional"} - ${audio} - ${final}`;

  const thumb = thumbnailUrl(item);
  if (els.thumbnailSlot) {
    els.thumbnailSlot.innerHTML = thumb
      ? `<img src="${thumb}" alt="Thumbnail ${escapeHtml(item.title)}">`
      : "Thumbnail belum tersedia";
  }

  if (item.assets.video?.url) {
    els.videoSlot.innerHTML = `<video controls playsinline poster="${thumb}" src="${item.assets.video.url}"></video>`;
  } else {
    els.videoSlot.textContent = "Video belum dirender";
  }

  els.sceneGrid.innerHTML = item.plan.scenes.map((scene) => {
    const image = item.assets.images?.find((entry) => Number(entry.sceneIndex) === Number(scene.index));
    const clip = item.assets.clips?.find((entry) => Number(entry.sceneIndex) === Number(scene.index));
    return `
      <article class="scene-card">
        ${clip?.url ? `<video muted loop playsinline controls src="${clip.url}"></video>` : image?.url ? `<img src="${image.url}" alt="">` : ""}
        <div class="scene-body">
          <small>Scene ${scene.index}</small>
          <strong>${escapeHtml(scene.screenText)}</strong>
          <p>${escapeHtml(scene.narration)}</p>
          <button type="button" class="mini-action" data-clip-scene="${scene.index}">
            ${clip?.url ? "Buat ulang clip" : `Tambah clip ${formatUsd(estimateClipCost())}`}
          </button>
        </div>
      </article>
    `;
  }).join("");
  els.sceneGrid.querySelectorAll("[data-clip-scene]").forEach((button) => {
    button.addEventListener("click", () => generateClip(Number(button.dataset.clipScene)));
  });
}

function renderYoutubeCopy(item) {
  if (!els.youtubeTitle || !els.youtubeCaption) return;
  els.youtubeTitle.value = item ? youtubeTitle(item) : "";
  els.youtubeCaption.value = item ? youtubeCaption(item) : "";
  if (els.copyYoutubeBtn) els.copyYoutubeBtn.disabled = !item;
}

async function copyCurrentYoutube() {
  if (!state.current) return;
  await copyText(youtubeCopy(state.current));
  setStatus("Judul dan caption YouTube siap ditempel.");
}

async function copyVideoLink(item) {
  const url = item?.assets?.video?.url;
  if (!url) return;
  await copyText(absoluteUrl(url));
  setStatus("Link video disalin.");
}

async function downloadVideo(item) {
  if (!item?.assets?.video?.url) return;
  const resolvedUrl = downloadUrl(item);
  if (isIOS()) {
    setStatus("iPhone: file video akan dibuka sebagai unduhan. Jika muncul preview, tekan Share lalu Save Video atau Save to Files. Judul dan caption juga disalin.");
    const opened = openDownload(resolvedUrl, item);
    await copyText(youtubeCopy(item));
    if (!opened) window.location.href = resolvedUrl;
    return;
  }

  openDownload(resolvedUrl, item);
  setStatus("Download video dimulai.");
}

async function shareToYoutube(item) {
  if (!item?.assets?.video?.url) return;
  setStatus("Judul dan caption YouTube disalin. Halaman YouTube Upload dibuka, lalu pilih video hasil download.");
  const opened = window.open(YOUTUBE_UPLOAD_URL, "_blank", "noopener");
  await copyText(youtubeCopy(item));
  if (!opened) window.location.href = YOUTUBE_UPLOAD_URL;
}

function renderButtons() {
  const hasItem = Boolean(state.current);
  const provider = new FormData(els.form).get("ttsProvider");
  if (els.ideaBtn) els.ideaBtn.disabled = state.busy;
  if (els.preflightBtn) els.preflightBtn.disabled = state.busy;
  els.fullBtn.disabled = state.busy;
  if (els.draftBtn) els.draftBtn.disabled = state.busy;
  els.settingsBtn.disabled = state.busy;
  if (els.imageBtn) els.imageBtn.disabled = state.busy || !hasItem;
  if (els.ttsBtn) els.ttsBtn.disabled = state.busy || !hasItem || !providerReady(provider);
  if (els.clipBtn) els.clipBtn.disabled = state.busy || !hasItem || !providerReady("video");
  if (els.renderBtn) els.renderBtn.disabled = state.busy || !hasItem;
  const hasVideo = Boolean(state.current?.assets?.video?.url);
  if (els.downloadVideoBtn) els.downloadVideoBtn.disabled = state.busy || !hasVideo;
  if (els.shareYoutubeBtn) els.shareYoutubeBtn.disabled = state.busy || !hasVideo;
  if (els.copyVideoLinkBtn) els.copyVideoLinkBtn.disabled = state.busy || !hasVideo;
}

function providerReady(provider) {
  if (provider === "elevenlabs") return Boolean(state.config?.providers?.elevenlabs);
  if (provider === "video") return Boolean(state.config?.providers?.videoApiKeySet);
  return Boolean(state.config?.providers?.openai);
}

function setBusy(value, message = "") {
  state.busy = value;
  if (message) setStatus(message);
  renderButtons();
}

function setStatus(message) {
  els.statusText.textContent = message;
}

function statusWithWarnings(message, warnings = []) {
  const firstWarning = (warnings || []).find(Boolean);
  return firstWarning ? `${message} Catatan: ${firstWarning}` : message;
}

async function api(url, options = {}) {
  const pin = localStorage.getItem("banyaktau_pin") || "";
  const response = await fetch(url, {
    headers: {
      "Content-Type": "application/json",
      ...(pin ? { "x-dashboard-pin": pin } : {})
    },
    ...options
  });
  const text = await response.text();
  const data = text ? JSON.parse(text) : {};
  if (response.status === 401) {
    const nextPin = window.prompt("Masukkan PIN dashboard BanyakTau");
    if (nextPin) {
      localStorage.setItem("banyaktau_pin", nextPin);
      return api(url, options);
    }
  }
  if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
  return data;
}

async function copyText(value) {
  const text = String(value || "");
  if (navigator.clipboard && window.isSecureContext) {
    await navigator.clipboard.writeText(text);
    return true;
  }

  const temp = document.createElement("textarea");
  temp.value = text;
  temp.setAttribute("readonly", "");
  temp.style.position = "fixed";
  temp.style.left = "-9999px";
  document.body.appendChild(temp);
  temp.select();
  const ok = document.execCommand("copy");
  temp.remove();
  return ok;
}

function absoluteUrl(url) {
  return new URL(url, window.location.origin).href;
}

function downloadUrl(item) {
  const params = new URLSearchParams({ id: item.id });
  const pin = localStorage.getItem("banyaktau_pin") || "123456";
  if (pin) params.set("pin", pin);
  return `/api/download?${params.toString()}`;
}

function openDownload(url, item) {
  const link = document.createElement("a");
  link.href = url;
  link.download = `${slugify(item?.title || item?.id || "banyaktau-video")}.mp4`;
  link.target = "_blank";
  link.rel = "noreferrer";
  document.body.appendChild(link);
  link.click();
  link.remove();
  return true;
}

function isIOS() {
  const platform = navigator.platform || "";
  return /iPad|iPhone|iPod/.test(platform) || (platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

function slugify(value) {
  return String(value || "banyaktau-video")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "banyaktau-video";
}

function formatUsd(value) {
  return `$${Number(value || 0).toFixed(3)}`;
}

function estimateClipCost() {
  const seconds = Number(state.config?.providers?.videoSeconds || 4);
  const perSecond = Number(state.config?.pricing?.videoUsdPerSecond || 0.03);
  return seconds * perSecond;
}

function formatNumber(value) {
  return new Intl.NumberFormat("id-ID").format(Number(value || 0));
}

function formatDuration(seconds) {
  const value = Math.round(Number(seconds || 0));
  const minute = Math.floor(value / 60);
  const second = value % 60;
  return `${minute}:${String(second).padStart(2, "0")}`;
}

function youtubeCopy(item) {
  return `JUDUL:\n${youtubeTitle(item)}\n\nCAPTION:\n${youtubeCaption(item)}`;
}

function thumbnailUrl(item) {
  return item?.assets?.thumbnail?.url || item?.assets?.images?.[0]?.url || "";
}

function youtubeTitle(item) {
  const raw = String(item?.title || item?.plan?.title || "Fakta Menarik yang Jarang Dibahas");
  const cleaned = raw
    .replace(/\b(gimana|sih|kok|dong)\b/gi, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[?.!]+$/g, "");
  if (/kenapa|rahasia|ternyata|cara|fakta/i.test(cleaned)) return `${cleaned}?`;
  return `Kenapa ${cleaned.charAt(0).toLowerCase()}${cleaned.slice(1)}?`;
}

function youtubeCaption(item) {
  const title = youtubeTitle(item);
  const hook = item?.plan?.hook || "";
  const points = (item?.plan?.importantPoints || []).slice(0, 3);
  const body = [
    hook,
    "",
    "Di video ini kita bahas singkat dengan gaya BanyakTau:",
    ...points.map((point) => `- ${point}`),
    "",
    "Kalau kamu suka fakta sains, sejarah, teknologi, dan hal sehari-hari yang sering luput, follow BanyakTau.",
    "",
    "#BanyakTau #FaktaMenarik #Shorts #YouTubeShorts #Pengetahuan"
  ].filter((line, index, arr) => line || arr[index - 1]);
  return `${title}\n\n${body.join("\n")}`;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
