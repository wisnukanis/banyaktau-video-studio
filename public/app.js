const state = {
  items: [],
  current: null,
  config: null,
  busy: false
};

const els = {
  form: document.querySelector("#generateForm"),
  fullBtn: document.querySelector("#fullBtn"),
  draftBtn: document.querySelector("#draftBtn"),
  imageBtn: document.querySelector("#imageBtn"),
  ttsBtn: document.querySelector("#ttsBtn"),
  renderBtn: document.querySelector("#renderBtn"),
  statusText: document.querySelector("#statusText"),
  itemTitle: document.querySelector("#itemTitle"),
  itemCount: document.querySelector("#itemCount"),
  itemList: document.querySelector("#itemList"),
  tokenMetric: document.querySelector("#tokenMetric"),
  imageMetric: document.querySelector("#imageMetric"),
  ttsMetric: document.querySelector("#ttsMetric"),
  totalMetric: document.querySelector("#totalMetric"),
  videoSlot: document.querySelector("#videoSlot"),
  hookText: document.querySelector("#hookText"),
  pointList: document.querySelector("#pointList"),
  factNote: document.querySelector("#factNote"),
  sceneGrid: document.querySelector("#sceneGrid"),
  assetStatus: document.querySelector("#assetStatus")
};

init();

async function init() {
  bindEvents();
  state.config = (await api("/api/health")).config;
  await refreshItems();
  render();
}

function bindEvents() {
  els.form.addEventListener("submit", async (event) => {
    event.preventDefault();
    await generateFull();
  });
  els.draftBtn.addEventListener("click", generateDraft);
  els.imageBtn.addEventListener("click", generateImages);
  els.ttsBtn.addEventListener("click", generateTts);
  els.renderBtn.addEventListener("click", renderVideo);
}

async function refreshItems() {
  const data = await api("/api/items");
  state.items = data.items || [];
  if (!state.current && state.items.length) state.current = state.items[0];
}

async function generateDraft() {
  setBusy(true, "Membuat draft naskah dan storyboard...");
  try {
    const data = await api("/api/items", {
      method: "POST",
      body: JSON.stringify(formPayload())
    });
    state.current = data.item;
    await refreshItems();
    setStatus("Draft siap. Pilih TTS lalu render saat sudah cocok.");
  } catch (error) {
    setStatus(error.message);
  } finally {
    setBusy(false);
    render();
  }
}

async function generateFull() {
  setBusy(true, "Generate lengkap: naskah, gambar, TTS, dan video...");
  try {
    const data = await api("/api/items/full", {
      method: "POST",
      body: JSON.stringify(formPayload())
    });
    state.current = data.item;
    await refreshItems();
    setStatus("Video selesai dibuat.");
  } catch (error) {
    setStatus(error.message);
  } finally {
    setBusy(false);
    render();
  }
}

async function generateImages() {
  if (!state.current) return;
  setBusy(true, "Membuat gambar AI untuk setiap scene...");
  try {
    const data = await api(`/api/items/${state.current.id}/images`, { method: "POST" });
    state.current = data.item;
    await refreshItems();
    setStatus("Gambar selesai.");
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
    setStatus(`TTS ${provider} selesai.`);
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
    setStatus("Render selesai.");
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
    hookStyle: form.get("hookStyle"),
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
  renderCurrent();
  renderButtons();
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

function renderCurrent() {
  const item = state.current;
  if (!item) {
    els.itemTitle.textContent = "Belum ada video";
    els.hookText.textContent = "-";
    els.pointList.innerHTML = "";
    els.factNote.textContent = "-";
    els.sceneGrid.innerHTML = "";
    els.videoSlot.textContent = "Video belum dirender";
    els.assetStatus.textContent = "Belum ada aset";
    return;
  }

  els.itemTitle.textContent = item.title;
  els.hookText.textContent = item.plan.hook;
  els.pointList.innerHTML = (item.plan.importantPoints || []).map((point) => `<li>${escapeHtml(point)}</li>`).join("");
  els.factNote.textContent = item.plan.factCheckNote || "-";
  els.tokenMetric.textContent = formatNumber(item.cost.totalTokens);
  els.imageMetric.textContent = formatUsd(item.cost.imageUsd);
  els.ttsMetric.textContent = formatUsd(item.cost.ttsUsd);
  els.totalMetric.textContent = formatUsd(item.cost.totalUsd);

  const imageCount = item.assets.images?.length || 0;
  const audio = item.assets.audio?.provider ? `Audio: ${item.assets.audio.provider}` : "Audio: belum";
  els.assetStatus.textContent = `Gambar: ${imageCount}/${item.plan.scenes.length} - ${audio}`;

  if (item.assets.video?.url) {
    els.videoSlot.innerHTML = `<video controls playsinline src="${item.assets.video.url}"></video>`;
  } else {
    els.videoSlot.textContent = "Video belum dirender";
  }

  els.sceneGrid.innerHTML = item.plan.scenes.map((scene) => {
    const image = item.assets.images?.find((entry) => Number(entry.sceneIndex) === Number(scene.index));
    return `
      <article class="scene-card">
        ${image?.url ? `<img src="${image.url}" alt="">` : ""}
        <div class="scene-body">
          <small>Scene ${scene.index}</small>
          <strong>${escapeHtml(scene.screenText)}</strong>
          <p>${escapeHtml(scene.narration)}</p>
        </div>
      </article>
    `;
  }).join("");
}

function renderButtons() {
  const hasItem = Boolean(state.current);
  const provider = new FormData(els.form).get("ttsProvider");
  els.fullBtn.disabled = state.busy;
  els.draftBtn.disabled = state.busy;
  els.imageBtn.disabled = state.busy || !hasItem;
  els.ttsBtn.disabled = state.busy || !hasItem || !providerReady(provider);
  els.renderBtn.disabled = state.busy || !hasItem;
}

function providerReady(provider) {
  if (provider === "elevenlabs") return Boolean(state.config?.providers?.elevenlabs);
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

async function api(url, options = {}) {
  const response = await fetch(url, {
    headers: { "Content-Type": "application/json" },
    ...options
  });
  const text = await response.text();
  const data = text ? JSON.parse(text) : {};
  if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
  return data;
}

function formatUsd(value) {
  return `$${Number(value || 0).toFixed(3)}`;
}

function formatNumber(value) {
  return new Intl.NumberFormat("id-ID").format(Number(value || 0));
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
