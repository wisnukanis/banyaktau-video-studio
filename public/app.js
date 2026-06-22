const state = {
  items: [],
  current: null,
  ideas: [],
  selectedIdea: null,
  config: null,
  busy: false,
  pollTimer: 0,
  processStartedAt: 0,
  processLabel: "",
  historyExpanded: false,
  galleryExpanded: false,
  logs: [],
  projectFilter: "capybara_banyak_tau_id"
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
  translateUsBtn: document.querySelector("#translateUsBtn"),
  publishFacebookBtn: document.querySelector("#publishFacebookBtn"),
  publishInstagramBtn: document.querySelector("#publishInstagramBtn"),
  menuBtn: document.querySelector("#menuBtn"),
  closeSettingsBtn: document.querySelector("#closeSettingsBtn"),
  settingsDrawer: document.querySelector("#settingsDrawer"),
  statusText: document.querySelector("#statusText"),
  itemTitle: document.querySelector("#itemTitle"),
  itemCount: document.querySelector("#itemCount"),
  itemList: document.querySelector("#itemList"),
  historyMoreBtn: document.querySelector("#historyMoreBtn"),
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
  summaryText: document.querySelector("#summaryText"),
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
  galleryMoreBtn: document.querySelector("#galleryMoreBtn"),
  processDurationMetric: document.querySelector("#processDurationMetric"),
  avgProcessMetric: document.querySelector("#avgProcessMetric"),
  uploadedTodayMetric: document.querySelector("#uploadedTodayMetric"),
  uploadStatusMetric: document.querySelector("#uploadStatusMetric"),
  processLog: document.querySelector("#processLog"),
  dailyUploadList: document.querySelector("#dailyUploadList"),
  workspaceTabs: document.querySelectorAll("[data-workspace-tab]"),
  workspaceViews: document.querySelectorAll("[data-workspace-view]"),
  settingsTabs: document.querySelectorAll("[data-settings-tab]"),
  settingsPanels: document.querySelectorAll("[data-settings-panel]"),
  flowSteps: document.querySelectorAll("[data-step]")
};

init();

async function init() {
  bindEvents();
  state.config = (await api("/api/health")).config;
  fillSettingsForm();
  await loadAvatars();
  await refreshItems();
  pushLog("Dashboard siap.");
  window.setInterval(() => {
    if (state.processStartedAt) renderAnalytics();
  }, 1000);
  render();
}

async function loadAvatars() {
  try {
    const data = await api("/api/avatars");
    const select = document.querySelector("#avatarModeSelect");
    if (!select || !data.avatars) return;
    
    // Clear existing dynamic options (keep static flapping capybara)
    select.innerHTML = '<option value="image" selected>Capybara Static (Flapping)</option>';
    
    data.avatars.forEach(file => {
      // Use clean names for labels (e.g. "avatar video 1.mp4" -> "Avatar Video 1")
      let cleanName = file.replace(/\.[^/.]+$/, ""); // remove extension
      cleanName = cleanName
        .split(/[_\-\s]+/)
        .map(word => word.charAt(0).toUpperCase() + word.slice(1))
        .join(" ");
      
      const option = document.createElement("option");
      option.value = file;
      option.textContent = cleanName;
      select.appendChild(option);
    });
  } catch (error) {
    console.error("Gagal memuat avatar:", error);
  }
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
  els.workspaceTabs.forEach((tab) => {
    tab.addEventListener("click", () => showWorkspaceTab(tab.dataset.workspaceTab));
  });
  els.menuBtn?.addEventListener("click", () => toggleSettingsDrawer(true));
  els.closeSettingsBtn?.addEventListener("click", () => toggleSettingsDrawer(false));
  els.historyMoreBtn?.addEventListener("click", () => {
    state.historyExpanded = !state.historyExpanded;
    renderList();
  });
  els.galleryMoreBtn?.addEventListener("click", () => {
    state.galleryExpanded = !state.galleryExpanded;
    renderGallery();
  });
  els.ideaBtn?.addEventListener("click", generateIdeas);
  els.draftBtn?.addEventListener("click", generateDraft);
  els.preflightBtn?.addEventListener("click", runPreflight);
  els.imageBtn?.addEventListener("click", generateImages);
  els.ttsBtn?.addEventListener("click", generateTts);
  els.clipBtn?.addEventListener("click", () => generateClip());
  els.renderBtn?.addEventListener("click", renderVideo);
  els.publishFacebookBtn?.addEventListener("click", () => publishToSocialsUI("facebook"));
  els.publishInstagramBtn?.addEventListener("click", () => publishToSocialsUI("instagram"));
  els.copyYoutubeBtn?.addEventListener("click", copyCurrentYoutube);
  els.downloadVideoBtn?.addEventListener("click", () => downloadVideo(state.current));
  els.shareYoutubeBtn?.addEventListener("click", () => shareToYoutube(state.current));
  els.copyVideoLinkBtn?.addEventListener("click", () => copyVideoLink(state.current));

  // Project filter selection handler
  const projFilter = document.querySelector("#projectFilter");
  if (projFilter) {
    projFilter.addEventListener("change", (e) => {
      state.projectFilter = e.target.value;
      renderList();
      renderGallery();
    });
  }

  // Create English Version click handler
  els.translateUsBtn?.addEventListener("click", () => {
    if (!state.current) return;
    const modal = document.querySelector("#usTranslateModal");
    if (modal) {
      modal.classList.remove("d-none");
    }
  });

  // Modal close click handler
  document.querySelector("#closeTranslateModalBtn")?.addEventListener("click", () => {
    const modal = document.querySelector("#usTranslateModal");
    if (modal) {
      modal.classList.add("d-none");
    }
  });

  // Copy US publish pack button click handler
  document.querySelector("#copyPublishPackUsBtn")?.addEventListener("click", async () => {
    if (!state.current) return;
    const pack = state.current.publish_pack_us || {};
    const text = [
      `Title: ${pack.youtube_title || state.current.title}`,
      `Description: ${pack.youtube_description || ""}`,
      `TikTok/Reels Caption: ${pack.tiktok_caption || pack.instagram_caption || ""}`,
      `Pinned Comment: ${pack.pinned_comment || ""}`,
      `Thumbnail Text: ${pack.thumbnail_text || ""}`,
      `Best Posting Time: ${pack.recommended_posting_time || ""}`
    ].join("\n\n");
    await copyText(text);
    setStatus("Publish Pack US disalin.");
  });

  // Submit English translation form
  document.querySelector("#usTranslateForm")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const modal = document.querySelector("#usTranslateModal");
    if (modal) modal.classList.add("d-none");
    
    if (!state.current) return;
    
    const formEl = event.target;
    const mode = formEl.usMode.value;
    const voiceId = formEl.usVoice.value;
    const reuseVisuals = formEl.reuseVisuals.checked;
    const autoRenderUs = formEl.autoRenderUs.checked;
    
    startProcess("Generate English Version");
    setBusy(true, "Menerjemahkan storyboard ke Bahasa Inggris...");
    
    try {
      startProgressPolling();
      const translateRes = await api(`/api/items/${state.current.id}/translate`, {
        method: "POST",
        body: JSON.stringify({ mode, voiceId, reuseVisuals })
      });
      
      const usItem = translateRes.item;
      setStatus(`Naskah Inggris berhasil dibuat: ${usItem.title}`);
      
      await refreshItems();
      state.current = state.items.find(item => item.id === usItem.id) || usItem;
      state.projectFilter = "curious_capybara_us";
      const projFilterEl = document.querySelector("#projectFilter");
      if (projFilterEl) projFilterEl.value = "curious_capybara_us";
      render();
      
      if (autoRenderUs) {
         setStatus("Memulai render suara dan video versi Inggris...");
         const renderRes = await api(`/api/items/${usItem.id}/render-us`, {
           method: "POST"
         });
         state.current = renderRes.item;
         await refreshItems();
         setStatus("Render video Inggris selesai!");
         showToast("Video Inggris berhasil dibuat dan dirender!", "success");
      } else {
         setStatus("Draft naskah Inggris siap. Silakan klik Render Ulang di workspace tab Studio untuk merender video.");
         showToast("Draft Inggris berhasil dibuat!", "success");
      }
    } catch (error) {
      setStatus(`Pembuatan versi Inggris gagal: ${error.message}`);
      showToast("Gagal membuat versi Inggris: " + error.message, "error");
    } finally {
      stopProgressPolling();
      setBusy(false);
      render();
    }
  });

  // Voice preset selection handler
  const presetSelect = document.querySelector("#elevenlabsVoicePreset");
  if (presetSelect) {
    presetSelect.addEventListener("change", () => {
      if (presetSelect.value !== "custom") {
        els.settingsForm.elevenlabsVoiceId.value = presetSelect.value;
      }
    });
  }

  // Category selection default mapping handler
  const categorySelect = els.form.querySelector("[name='category']");
  if (categorySelect) {
    categorySelect.addEventListener("change", () => {
      applyCategoryDefaults(categorySelect.value);
    });
  }
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
        elevenlabsModel: form.get("elevenlabsModel"),
        geminiApiKey: form.get("geminiApiKey"),
        geminiBaseUrl: form.get("geminiBaseUrl"),
        speechTempo: Number(form.get("speechTempo")),
        ffmpegEncoder: form.get("ffmpegEncoder"),
        pexelsApiKey: form.get("pexelsApiKey"),
        pixabayApiKey: form.get("pixabayApiKey"),
        uploadDriver: form.get("uploadDriver"),
        publicBaseUrl: form.get("publicBaseUrl"),
        sftpHost: form.get("sftpHost"),
        sftpPort: Number(form.get("sftpPort")),
        sftpUser: form.get("sftpUser"),
        sftpPassword: form.get("sftpPassword"),
        sftpRemoteDir: form.get("sftpRemoteDir"),
        ftpHost: form.get("ftpHost"),
        ftpPort: Number(form.get("ftpPort")),
        ftpUser: form.get("ftpUser"),
        ftpPassword: form.get("ftpPassword"),
        ftpRemoteDir: form.get("ftpRemoteDir")
      })
    });
    state.config = data.config;
    els.settingsForm.openaiApiKey.value = "";
    els.settingsForm.elevenlabsApiKey.value = "";
    els.settingsForm.videoApiKey.value = "";
    els.settingsForm.geminiApiKey.value = "";
    els.settingsForm.pexelsApiKey.value = "";
    els.settingsForm.pixabayApiKey.value = "";
    els.settingsForm.sftpPassword.value = "";
    els.settingsForm.ftpPassword.value = "";
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
  if (!state.current && state.items.length) {
    state.current = state.items.find(item => {
      const projId = item.project_id || item.input?.projectId || "capybara_banyak_tau_id";
      return projId === state.projectFilter;
    }) || state.items[0];
  }
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
  const previousLatestId = state.items[0]?.id || "";
  startProcess("Generate video otomatis");
  setBusy(true, "Preflight dashboard sebelum generate...");
  try {
    await runPreflight({ quiet: true });
    setStatus("Membuat video otomatis dari ide sampai final...");
    startProgressPolling();
    const data = await api("/api/items/full", {
      method: "POST",
      body: JSON.stringify(formPayload())
    });
    if (data.item) state.current = data.item;
    await refreshItems();
    if (data.queued) {
      setStatus(statusWithWarnings("Workflow GitHub Actions dimulai. Video akan muncul otomatis di Galeri setelah selesai.", data.warnings));
      startResultPolling(previousLatestId);
    } else {
      const hasClip = data.item.assets?.clips?.length;
      setStatus(statusWithWarnings(
        hasClip ? "Video final selesai dibuat dengan clip Veo." : "Video final selesai dibuat tanpa clip Veo.",
        data.warnings
      ));
      finishProcess("Video final selesai.");
      showToast("Video final selesai dibuat!", "success");
    }
  } catch (error) {
    setStatus(error.message);
    finishProcess("Generate gagal.");
    showToast("Pembuatan video gagal: " + error.message, "error");
  } finally {
    stopProgressPolling();
    setBusy(false);
    render();
  }
}

function startResultPolling(previousLatestId) {
  window.clearInterval(state.pollTimer);
  let attempts = 0;
  state.pollTimer = window.setInterval(async () => {
    attempts += 1;
    try {
      await refreshItems();
      const latest = state.items[0];
      const hasNewVideo = latest?.id && latest.id !== previousLatestId && latest.assets?.video?.url;
      if (hasNewVideo) {
        state.current = latest;
        window.clearInterval(state.pollTimer);
        state.pollTimer = 0;
        setStatus("Video baru sudah muncul di dashboard.");
        finishProcess("Video selesai dan state upload terbaca.");
      } else if (attempts >= 60) {
        window.clearInterval(state.pollTimer);
        state.pollTimer = 0;
        setStatus("Generate masih diproses atau upload belum masuk. Klik Preflight lalu refresh galeri sebentar lagi.");
        finishProcess("Polling selesai, hasil belum terbaca.");
      } else {
        updateCurrentStatus(`Generate masih berjalan. Cek otomatis ${attempts}/60...`);
      }
      render();
    } catch (error) {
      setStatus(`Cek hasil generate gagal: ${error.message}`);
    }
  }, 15000);
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
  const isUs = state.current.project_id === "curious_capybara_us";
  const form = new FormData(els.form);
  const provider = form.get("ttsProvider");
  const avatarMode = form.get("avatarMode") || "image";
  const videoFormat = form.get("videoFormat") || "vertical";
  const visualSource = form.get("visualSource") || "stock";
  const formatLabel = videoFormat === "horizontal" ? "horizontal" : "vertikal";
  setBusy(true, `Merender video ${formatLabel}...`);
  try {
    startProgressPolling();
    const endpoint = isUs ? `/api/items/${state.current.id}/render-us` : `/api/items/${state.current.id}/render`;
    const payload = isUs ? {} : { provider, ensureAssets: true, avatarMode, videoFormat, visualSource };
    const data = await api(endpoint, {
      method: "POST",
      body: JSON.stringify(payload)
    });
    state.current = data.item;
    await refreshItems();
    setStatus(statusWithWarnings("Render selesai.", data.warnings));
    showToast("Video berhasil dirender ulang!", "success");
  } catch (error) {
    setStatus(error.message);
    showToast("Gagal merender video: " + error.message, "error");
  } finally {
    stopProgressPolling();
    setBusy(false);
    render();
  }
}

function formPayload() {
  const form = new FormData(els.form);
  const settingsForm = new FormData(els.settingsForm);
  return {
    topic: form.get("topic"),
    category: form.get("category"),
    selectedIdea: null,
    tone: form.get("tone"),
    ttsProvider: form.get("ttsProvider"),
    durationSec: Number(form.get("durationSec")),
    sceneCount: Number(form.get("sceneCount")),
    imageQuality: form.get("imageQuality"),
    imageSize: state.config?.providers?.imageSize || "1024x1792",
    avatarMode: form.get("avatarMode") || "image",
    videoFormat: form.get("videoFormat") || "vertical",
    visualSource: form.get("visualSource") || "stock",
    openaiTtsVoice: settingsForm.get("openaiTtsVoice"),
    elevenlabsVoiceId: settingsForm.get("elevenlabsVoiceId"),
    elevenlabsModel: settingsForm.get("elevenlabsModel")
  };
}

function render() {
  renderList();
  renderIdeas();
  renderGallery();
  renderAnalytics();
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
  els.settingsForm.storyModel.value = state.config.providers?.storyModel || "gpt-4o-mini";
  els.settingsForm.imageModel.value = state.config.providers?.imageModel || "dall-e-3";
  els.settingsForm.openaiTtsVoice.value = state.config.providers?.openaiTtsVoice || "shimmer";
  els.settingsForm.elevenlabsVoiceId.value = state.config.providers?.elevenlabsVoiceId || "";
  els.settingsForm.elevenlabsModel.value = state.config.providers?.elevenlabsModel || "eleven_turbo_v2_5";
  els.settingsForm.videoBaseUrl.value = state.config.providers?.videoBaseUrl || "https://ai.dinoiki.com";
  els.settingsForm.videoEndpointMode.value = state.config.providers?.videoEndpointMode || "gemini";
  els.settingsForm.videoModel.value = state.config.providers?.videoModel || "veo-3.1-lite-generate-preview";
  els.settingsForm.videoSeconds.value = state.config.providers?.videoSeconds || 4;
  els.settingsForm.videoUsdPerSecond.value = state.config.pricing?.videoUsdPerSecond ?? 0.03;
  els.settingsForm.geminiBaseUrl.value = state.config.providers?.geminiBaseUrl || "https://generativelanguage.googleapis.com";
  els.settingsForm.speechTempo.value = state.config.render?.speechTempo || 1.15;
  els.settingsForm.ffmpegEncoder.value = state.config.render?.ffmpegEncoder || "libx264";
  els.settingsForm.uploadDriver.value = state.config.remote?.uploadDriver || "none";
  els.settingsForm.publicBaseUrl.value = state.config.remote?.publicBaseUrl || "";
  els.settingsForm.sftpHost.value = state.config.remote?.sftpHost || "";
  els.settingsForm.sftpPort.value = state.config.remote?.sftpPort || "22";
  els.settingsForm.sftpUser.value = state.config.remote?.sftpUser || "";
  els.settingsForm.sftpRemoteDir.value = state.config.remote?.sftpRemoteDir || "";
  els.settingsForm.ftpHost.value = state.config.remote?.ftpHost || "";
  els.settingsForm.ftpPort.value = state.config.remote?.ftpPort || "21";
  els.settingsForm.ftpUser.value = state.config.remote?.ftpUser || "";
  els.settingsForm.ftpRemoteDir.value = state.config.remote?.ftpRemoteDir || "";

  // Set the voice preset select value
  const presetSelect = document.querySelector("#elevenlabsVoicePreset");
  if (presetSelect) {
    const currentVoiceId = state.config.providers?.elevenlabsVoiceId || "";
    const isPreset = [...presetSelect.options].some(opt => opt.value === currentVoiceId && opt.value !== "custom");
    if (isPreset) {
      presetSelect.value = currentVoiceId;
    } else {
      presetSelect.value = "custom";
    }
  }
}

function showSettingsTab(name) {
  els.settingsTabs.forEach((tab) => tab.classList.toggle("active", tab.dataset.settingsTab === name));
  els.settingsPanels.forEach((panel) => panel.classList.toggle("active", panel.dataset.settingsPanel === name));
}

function showWorkspaceTab(name) {
  els.workspaceTabs.forEach((tab) => tab.classList.toggle("active", tab.dataset.workspaceTab === name));
  els.workspaceViews.forEach((view) => view.classList.toggle("active", view.dataset.workspaceView === name));
}

function toggleSettingsDrawer(open) {
  if (!els.settingsDrawer) return;
  els.settingsDrawer.classList.toggle("open", open);
  els.settingsDrawer.setAttribute("aria-hidden", open ? "false" : "true");
}

function renderProviderStatus() {
  if (state.config?.dashboard?.vercel) {
    els.providerStatus.textContent = "GitHub Actions aktif";
    return;
  }
  const openai = state.config?.providers?.openai ? "OpenAI aktif" : "OpenAI kosong";
  const elevenlabs = state.config?.providers?.elevenlabs ? "Eleven aktif" : "Eleven kosong";
  const video = state.config?.providers?.videoApiKeySet ? "Video aktif" : "Video kosong";
  const facebook = state.config?.providers?.facebookUploadEnabled ? "FB auto" : "FB mati";
  const instagram = state.config?.providers?.instagramUploadEnabled ? "IG auto" : "IG mati";
  els.providerStatus.textContent = `${openai} / ${elevenlabs} / ${video} / ${facebook} / ${instagram}`;
}

function renderList() {
  let filtered = state.items;
  if (state.projectFilter && state.projectFilter !== "all") {
    filtered = state.items.filter(item => {
      const projId = item.project_id || item.input?.projectId || "capybara_banyak_tau_id";
      return projId === state.projectFilter;
    });
  }
  els.itemCount.textContent = String(filtered.length);
  const visibleItems = state.historyExpanded ? filtered : filtered.slice(0, 3);
  els.itemList.innerHTML = visibleItems.map((item) => {
    let langLabel = "";
    if (state.projectFilter === "all") {
      const projId = item.project_id || item.input?.projectId || "capybara_banyak_tau_id";
      langLabel = projId === "curious_capybara_us" ? '<span style="font-size:0.8em; color:#3b82f6;">[US]</span> ' : '<span style="font-size:0.8em; color:#8fb8a8;">[ID]</span> ';
    }
    return `
      <button type="button" data-id="${item.id}">
        <strong>${langLabel}${escapeHtml(item.title)}</strong>
        <span>${escapeHtml(item.assets?.audio?.provider || item.input?.ttsProvider || "-")} - ${new Date(item.updatedAt || item.createdAt).toLocaleString("id-ID")}</span>
      </button>
    `;
  }).join("");
  els.itemList.querySelectorAll("button").forEach((button) => {
    button.addEventListener("click", () => {
      state.current = state.items.find((item) => item.id === button.dataset.id);
      render();
    });
  });
  if (els.historyMoreBtn) {
    els.historyMoreBtn.hidden = filtered.length <= 3;
    els.historyMoreBtn.textContent = state.historyExpanded ? "Show Less" : `Show More (${filtered.length - 3})`;
  }
}

function renderGallery() {
  const videos = state.items.filter((item) => item.assets?.video?.url);
  let filteredVideos = videos;
  if (state.projectFilter && state.projectFilter !== "all") {
    filteredVideos = videos.filter(item => {
      const projId = item.project_id || item.input?.projectId || "capybara_banyak_tau_id";
      return projId === state.projectFilter;
    });
  }
  if (!els.galleryGrid) return;
  if (!filteredVideos.length) {
    els.galleryGrid.innerHTML = `<div class="empty-gallery">Belum ada video final untuk proyek ini.</div>`;
    if (els.galleryMoreBtn) els.galleryMoreBtn.hidden = true;
    return;
  }
  const visibleVideos = state.galleryExpanded ? filteredVideos : filteredVideos.slice(0, 6);
  els.galleryGrid.innerHTML = visibleVideos.map((item) => `
    <article class="gallery-card">
      <video controls playsinline preload="metadata" src="${item.assets.video.url}"></video>
      <div class="gallery-body">
        <strong>${escapeHtml(item.title)}</strong>
        <span>${formatDuration(item.assets.video.durationSec)} - ${new Date(item.updatedAt || item.createdAt).toLocaleString("id-ID")}</span>
        <div class="gallery-actions">
          <button type="button" class="mini-action" data-download-video="${item.id}">Download</button>
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
  els.galleryGrid.querySelectorAll("[data-copy-youtube]").forEach((button) => {
    button.addEventListener("click", async () => {
      const item = state.items.find((entry) => entry.id === button.dataset.copyYoutube);
      await copyText(youtubeCopy(item));
      setStatus("Caption YouTube disalin.");
    });
  });
  if (els.galleryMoreBtn) {
    els.galleryMoreBtn.hidden = filteredVideos.length <= 6;
    els.galleryMoreBtn.textContent = state.galleryExpanded ? "Show Less" : `Show More (${filteredVideos.length - 6})`;
  }
}

function renderAnalytics() {
  if (!els.processDurationMetric) return;
  const videos = state.items.filter((item) => item.assets?.video?.url);
  const uploaded = videos.filter((item) => publishSuccess(item));
  const failed = videos.filter((item) => item.publish?.errors && Object.keys(item.publish.errors).length);
  const todayKey = dayKey(new Date());
  const uploadedToday = uploaded.filter((item) => dayKey(publishedDate(item) || item.updatedAt || item.createdAt) === todayKey);
  const durations = videos
    .map(processDurationMs)
    .filter((value) => value > 0);
  const avgMs = durations.length ? durations.reduce((sum, value) => sum + value, 0) / durations.length : 0;
  els.processDurationMetric.textContent = state.processStartedAt ? formatElapsed(Date.now() - state.processStartedAt) : "00:00";
  els.avgProcessMetric.textContent = avgMs ? formatElapsed(avgMs) : "-";
  els.uploadedTodayMetric.textContent = String(uploadedToday.length);
  els.uploadStatusMetric.textContent = `${uploaded.length} OK / ${failed.length} gagal`;

  if (els.dailyUploadList) {
    els.dailyUploadList.innerHTML = dailyUploadRows(uploaded)
      .map((row) => `<div><span>${row.label}</span><strong>${row.count}</strong></div>`)
      .join("");
  }
  if (els.processLog) {
    const rows = state.logs.length ? state.logs : [{ time: new Date().toISOString(), message: "Belum ada proses berjalan." }];
    els.processLog.innerHTML = rows
      .slice(-8)
      .reverse()
      .map((entry) => `<div><span>${new Date(entry.time).toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" })}</span><p>${escapeHtml(entry.message)}</p></div>`)
      .join("");
  }
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
    applyCategoryDefaults(idea.category);
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
  
  // Manage the Translate US button visibility and state when no item
  if (els.translateUsBtn) {
    els.translateUsBtn.classList.add("d-none");
  }

  const normalYoutubeBox = document.querySelector(".youtube-box:not(#publishPackUsBox)");
  const publishPackUsBox = document.querySelector("#publishPackUsBox");
  if (normalYoutubeBox) normalYoutubeBox.classList.remove("d-none");
  if (publishPackUsBox) publishPackUsBox.classList.add("d-none");

  if (!item) {
    els.itemTitle.textContent = "Belum ada video";
    els.hookText.textContent = "-";
    if (els.summaryText) els.summaryText.textContent = "-";
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

  const hasUsVersion = state.items.some(x => x.source_video_id === item.id);
  const isUsVersion = item.project_id === "curious_capybara_us";

  if (isUsVersion) {
    els.itemTitle.innerHTML = `${escapeHtml(item.title)} <span class="badge us-badge" style="font-size: 0.6em; background: #3b82f6; color: white; padding: 3px 8px; border-radius: 4px; vertical-align: middle; margin-left: 8px; font-weight: bold; display: inline-block;">US Version</span>`;
  } else if (hasUsVersion) {
    els.itemTitle.innerHTML = `${escapeHtml(item.title)} <span class="badge us-badge" style="font-size: 0.6em; background: #10b981; color: white; padding: 3px 8px; border-radius: 4px; vertical-align: middle; margin-left: 8px; font-weight: bold; display: inline-block;">US Version Created</span>`;
  } else {
    els.itemTitle.textContent = item.title;
  }

  // Toggle Translate US button
  if (els.translateUsBtn) {
    const isIdVideo = item.project_id === "capybara_banyak_tau_id" || !item.project_id || item.project_id === "";
    const isReady = item.status === "ready" || item.assets?.video?.url;
    if (isIdVideo && isReady) {
      els.translateUsBtn.classList.remove("d-none");
      els.translateUsBtn.disabled = state.busy;
    } else {
      els.translateUsBtn.classList.add("d-none");
    }
  }

  // Toggle Publish Pack US
  if (isUsVersion) {
    if (normalYoutubeBox) normalYoutubeBox.classList.add("d-none");
    if (publishPackUsBox) {
      publishPackUsBox.classList.remove("d-none");
      const pack = item.publish_pack_us || {};
      document.querySelector("#usYoutubeTitle").value = pack.youtube_title || item.title || "";
      document.querySelector("#usYoutubeDescription").value = pack.youtube_description || "";
      const tiktokCap = pack.tiktok_caption || pack.instagram_caption || pack.facebook_caption || "";
      document.querySelector("#usTiktokCaption").value = tiktokCap;
      document.querySelector("#usPostingTime").value = pack.recommended_posting_time || "-";
      document.querySelector("#usThumbnailText").value = pack.thumbnail_text || "-";
      document.querySelector("#usPinnedComment").value = pack.pinned_comment || "";
    }
  }

  els.hookText.textContent = item.plan.hook;
  if (els.summaryText) els.summaryText.textContent = item.plan.summary || "-";
  
  // Set the avatar select dropdown value
  const select = document.querySelector("#avatarModeSelect");
  if (select && item.input?.avatarMode) {
    select.value = item.input.avatarMode;
  }
  
  // Set the format and visual source select dropdown values
  const formatSelect = els.form.querySelector("[name='videoFormat']");
  if (formatSelect && item.input?.videoFormat) {
    formatSelect.value = item.input.videoFormat;
  }
  
  const sourceSelect = els.form.querySelector("[name='visualSource']");
  if (sourceSelect && item.input?.visualSource) {
    sourceSelect.value = item.input.visualSource;
  }
  
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
  els.assetStatus.textContent = `Img ${imageCount}/${item.plan.scenes.length} - Clip ${clipCount || 0} - ${audio} - ${final}`;

  const thumb = thumbnailUrl(item);
  if (els.thumbnailSlot) {
    els.thumbnailSlot.innerHTML = thumb
      ? `<img src="${thumb}" alt="Thumbnail ${escapeHtml(item.title)}">`
      : "Thumbnail belum tersedia";
  }

  if (item.assets.video?.url) {
    if (item.input?.videoFormat === "horizontal") {
      els.videoSlot.classList.add("horizontal");
    } else {
      els.videoSlot.classList.remove("horizontal");
    }
    els.videoSlot.innerHTML = `<video controls playsinline poster="${thumb}" src="${item.assets.video.url}"></video>`;
  } else {
    els.videoSlot.classList.remove("horizontal");
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
          <button type="button" class="mini-action d-none" data-clip-scene="${scene.index}">
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
  setStatus("Caption YouTube siap ditempel.");
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
    setStatus("iPhone: file video akan dibuka sebagai unduhan. Jika muncul preview, tekan Share lalu Save Video atau Save to Files. Caption juga disalin.");
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
  setStatus("Caption YouTube disalin. Halaman YouTube Upload dibuka, lalu pilih video hasil download.");
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
  if (els.publishFacebookBtn) {
    els.publishFacebookBtn.disabled = state.busy || !hasVideo;
    const fbUrl = state.current?.publish?.facebook?.url;
    if (fbUrl) {
      els.publishFacebookBtn.textContent = "Buka FB Reel ↗";
      els.publishFacebookBtn.classList.remove("accent");
    } else {
      els.publishFacebookBtn.textContent = "Publish FB";
      els.publishFacebookBtn.classList.add("accent");
    }
  }
  if (els.publishInstagramBtn) {
    els.publishInstagramBtn.disabled = state.busy || !hasVideo;
    const igUrl = state.current?.publish?.instagram?.url;
    if (igUrl) {
      els.publishInstagramBtn.textContent = "Buka IG Reel ↗";
      els.publishInstagramBtn.classList.remove("accent");
    } else {
      els.publishInstagramBtn.textContent = "Publish IG";
      els.publishInstagramBtn.classList.add("accent");
    }
  }
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
  pushLog(message);
  updateCurrentStatus(message);
}

function updateCurrentStatus(message) {
  if (els.statusText) els.statusText.textContent = message;
}

let progressPollInterval = null;

function showToast(message, type = "info") {
  const container = document.querySelector("#toastContainer");
  if (!container) return;
  
  const toast = document.createElement("div");
  toast.className = `toast ${type}`;
  
  let symbol = "ℹ️";
  if (type === "success") symbol = "✅";
  if (type === "error") symbol = "❌";
  if (type === "warning") symbol = "⚠️";
  
  toast.innerHTML = `<span>${symbol}</span><p>${escapeHtml(message)}</p>`;
  container.appendChild(toast);
  
  setTimeout(() => {
    toast.style.animation = "toastFadeOut 0.3s ease forwards";
    toast.addEventListener("animationend", () => {
      toast.remove();
    });
  }, 5000);
}

function startProgressPolling() {
  if (progressPollInterval) clearInterval(progressPollInterval);
  
  const wrapper = document.querySelector("#progressBarWrapper");
  const bar = document.querySelector("#progressBar");
  if (wrapper && bar) {
    wrapper.classList.remove("d-none");
    bar.style.width = "0%";
  }
  
  progressPollInterval = setInterval(async () => {
    try {
      const pin = localStorage.getItem("banyaktau_pin") || "";
      const response = await fetch("/api/progress", {
        headers: {
          ...(pin ? { "x-dashboard-pin": pin } : {})
        }
      });
      if (!response.ok) return;
      const progress = await response.json();
      if (progress && progress.active) {
        const percent = Math.min(100, Math.max(0, Number(progress.percent || 0)));
        if (bar) bar.style.width = `${percent}%`;
        if (progress.message) {
          updateCurrentStatus(`${progress.message} (${percent}%)`);
        }
      }
    } catch (err) {
      // ignore
    }
  }, 1000);
}

function stopProgressPolling() {
  if (progressPollInterval) {
    clearInterval(progressPollInterval);
    progressPollInterval = null;
  }
  const wrapper = document.querySelector("#progressBarWrapper");
  if (wrapper) {
    setTimeout(() => {
      wrapper.classList.add("d-none");
    }, 1500);
  }
}

function pushLog(message) {
  const text = String(message || "").trim();
  if (!text) return;
  const latest = state.logs.at(-1);
  if (latest?.message === text) return;
  state.logs.push({ time: new Date().toISOString(), message: text });
  state.logs = state.logs.slice(-40);
  renderAnalytics();
}

function startProcess(label) {
  state.processStartedAt = Date.now();
  state.processLabel = label;
  pushLog(`${label} dimulai.`);
}

function finishProcess(message) {
  if (state.processStartedAt) {
    pushLog(`${message} Durasi ${formatElapsed(Date.now() - state.processStartedAt)}.`);
  } else {
    pushLog(message);
  }
  state.processStartedAt = 0;
  state.processLabel = "";
  renderAnalytics();
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
  let data = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    const detail = text.replace(/\s+/g, " ").trim().slice(0, 160);
    throw new Error(`Server mengembalikan respons non-JSON (${response.status}). ${detail || response.statusText}`);
  }
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

function formatElapsed(ms) {
  const totalSeconds = Math.max(0, Math.round(Number(ms || 0) / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function publishSuccess(item) {
  return Boolean(item?.publish?.facebook?.url || item?.publish?.instagram?.url);
}

function publishedDate(item) {
  const dates = [
    item?.publish?.facebook?.publishedAt,
    item?.publish?.instagram?.publishedAt
  ].filter(Boolean).map((value) => new Date(value)).filter((date) => Number.isFinite(date.getTime()));
  if (!dates.length) return null;
  return new Date(Math.max(...dates.map((date) => date.getTime())));
}

function processDurationMs(item) {
  const start = new Date(item?.createdAt || "").getTime();
  const published = publishedDate(item)?.getTime();
  const updated = new Date(item?.updatedAt || "").getTime();
  const end = Number.isFinite(published) ? published : updated;
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return 0;
  return end - start;
}

function dayKey(value) {
  const date = value instanceof Date ? value : new Date(value || "");
  if (!Number.isFinite(date.getTime())) return "";
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function dailyUploadRows(items) {
  const counts = new Map();
  for (let offset = 0; offset < 7; offset += 1) {
    const date = new Date();
    date.setDate(date.getDate() - offset);
    counts.set(dayKey(date), 0);
  }
  for (const item of items) {
    const key = dayKey(publishedDate(item) || item.updatedAt || item.createdAt);
    if (counts.has(key)) counts.set(key, counts.get(key) + 1);
  }
  return [...counts.entries()].map(([key, count]) => ({
    label: new Date(`${key}T00:00:00`).toLocaleDateString("id-ID", { weekday: "short", day: "2-digit", month: "short" }),
    count
  }));
}

function youtubeCopy(item) {
  return youtubeCaption(item);
}

function thumbnailUrl(item) {
  return item?.assets?.thumbnail?.url || item?.assets?.images?.[0]?.url || "";
}

function youtubeTitle(item) {
  return String(item?.title || item?.plan?.title || "Fakta Menarik yang Jarang Dibahas")
    .replace(/\s+/g, " ")
    .trim();
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

async function publishToSocialsUI(platform) {
  if (!state.current) return;

  const enabled = platform === "facebook"
    ? state.config?.providers?.facebookUploadEnabled
    : state.config?.providers?.instagramUploadEnabled;

  if (!enabled) {
    const label = platform === "facebook" ? "Facebook" : "Instagram";
    const envVar = platform === "facebook" ? "FACEBOOK_UPLOAD_ENABLED=true" : "INSTAGRAM_UPLOAD_ENABLED=true";
    const msg = `Integrasi ${label} belum aktif atau belum dikonfigurasi di file .env.\n\nHarap atur:\n1. ${envVar} di file .env\n2. Isi API Key / Access Token dan Page ID\n3. Konfigurasi FTP/SFTP Remote Upload (karena API sosial media membutuhkan URL video publik agar bisa didownload).`;
    alert(msg);
    setStatus(`Gagal: Integrasi ${label} belum diaktifkan di file .env.`);
    return;
  }

  const existingUrl = platform === "facebook"
    ? state.current?.publish?.facebook?.url
    : state.current?.publish?.instagram?.url;

  if (existingUrl) {
    window.open(existingUrl, "_blank", "noopener");
    setStatus(`Membuka link ${platform} Reels.`);
    return;
  }

  const label = platform === "facebook" ? "Facebook" : "Instagram";
  startProcess(`Publish ke ${label}`);
  setBusy(true, `Mengunggah video ke server dan mengirim ke ${label}...`);
  try {
    startProgressPolling();
    const data = await api(`/api/items/${state.current.id}/publish`, {
      method: "POST",
      body: JSON.stringify({ platform })
    });
    state.current = data.item;
    await refreshItems();
    if (data.success) {
      setStatus(statusWithWarnings(`Publish ke ${label} berhasil!`, data.warnings));
      finishProcess(`Publish ke ${label} berhasil.`);
      showToast(`Publish ke ${label} berhasil!`, "success");
      const postUrl = platform === "facebook"
        ? data.item.publish?.facebook?.url
        : data.item.publish?.instagram?.url;
      if (postUrl) {
        window.open(postUrl, "_blank", "noopener");
      }
    } else {
      setStatus(statusWithWarnings(`Publish ke ${label} selesai dengan beberapa error.`, data.warnings));
      finishProcess(`Publish ke ${label} gagal.`);
      showToast(`Publish ke ${label} selesai dengan error.`, "warning");
    }
  } catch (error) {
    setStatus(`Publish ke ${label} gagal: ${error.message}`);
    finishProcess(`Publish ke ${label} gagal.`);
    showToast(`Gagal publish ke ${label}: ${error.message}`, "error");
  } finally {
    stopProgressPolling();
    setBusy(false);
    render();
  }
}

function applyCategoryDefaults(cat) {
  const mapping = {
    sains: {
      voice: "pNInz6obpgfrhhF21cjL", // Adam (Deep Male - Rekomendasi)
      tone: "science_documentary"
    },
    sejarah: {
      voice: "pNInz6obpgfrhhF21cjL", // Adam (Deep Male - Rekomendasi)
      tone: "historical_storytelling"
    },
    penemuan: {
      voice: "pNInz6obpgfrhhF21cjL", // Adam (Deep Male - Rekomendasi)
      tone: "discovery_suspense"
    },
    "tubuh manusia": {
      voice: "pNInz6obpgfrhhF21cjL", // Adam (Deep Male - Rekomendasi)
      tone: "medical_soft"
    },
    "alam semesta": {
      voice: "pNInz6obpgfrhhF21cjL", // Adam (Deep Male - Rekomendasi)
      tone: "cosmic_deep"
    },
    teknologi: {
      voice: "pNInz6obpgfrhhF21cjL", // Adam (Deep Male - Rekomendasi)
      tone: "tech_explainer"
    },
    "benda sehari-hari": {
      voice: "pNInz6obpgfrhhF21cjL", // Adam (Deep Male - Rekomendasi)
      tone: "relatable_doc"
    },
    random: {
      voice: "pNInz6obpgfrhhF21cjL", // Adam (Deep Male - Rekomendasi)
      tone: "adaptive"
    }
  };

  const defaults = mapping[String(cat).toLowerCase()];
  if (defaults) {
    if (els.form.tone) {
      els.form.tone.value = defaults.tone;
    }
    const presetSelect = document.querySelector("#elevenlabsVoicePreset");
    if (presetSelect) {
      presetSelect.value = defaults.voice;
    }
    if (els.settingsForm && els.settingsForm.elevenlabsVoiceId) {
      els.settingsForm.elevenlabsVoiceId.value = defaults.voice;
    }
    pushLog(`Kategori diubah ke '${cat}': default gaya suara & preset diatur otomatis.`);
  }
}
