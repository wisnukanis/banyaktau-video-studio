import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import puppeteer from "puppeteer";
import { config, paths } from "../config.js";
import { safeFilename, createId } from "../util.js";

// Baca GSAP lokal bila ada agar 100% cepat & bebas ketergantungan jaringan
let localGsapCode = null;
try {
  const localGsapPath = path.resolve(process.cwd(), "node_modules", "gsap", "dist", "gsap.min.js");
  localGsapCode = await fs.readFile(localGsapPath, "utf-8");
} catch {
  localGsapCode = null;
}

/**
 * Mendapatkan argumen encoding FFmpeg berdasarkan config / ketersediaan NVENC.
 */
function getEncoderArgs(crf = "20") {
  const encoder = process.env.FFMPEG_ENCODER || config.render?.ffmpegEncoder || "libx264";
  if (encoder === "h264_nvenc") {
    return ["-c:v", "h264_nvenc", "-preset", "p4", "-cq", String(crf), "-pix_fmt", "yuv420p"];
  }
  return ["-c:v", "libx264", "-preset", "veryfast", "-crf", String(crf), "-pix_fmt", "yuv420p"];
}

/**
 * Membersihkan dan memformat teks untuk template HTML
 */
function escapeHtml(str) {
  if (!str) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

/**
 * Menghasilkan kode HTML Bang Motion secara dinamis berdasarkan naskah/scenes.
 */
export function generateMotionHtml(payload = {}, options = {}) {
  const format = String(payload.format || options.format || "vertical").toLowerCase();
  const isVertical = format.includes("vert") || format === "9:16" || format === "short" || format === "reels";
  
  const width = isVertical ? 1080 : 1920;
  const height = isVertical ? 1920 : 1080;
  
  const title = payload.title || "Fakta Menarik Hari Ini";
  const rawScenes = Array.isArray(payload.scenes) && payload.scenes.length > 0 
    ? payload.scenes 
    : [
        {
          text: payload.topic || title,
          kicker: "FAKTA UTAMA",
          highlight: "penting untuk diketahui",
          note: "analisis visual",
          durationSec: 6
        }
      ];

  // Hitung durasi per adegan
  const totalDuration = payload.totalDurationSec 
    ? Number(payload.totalDurationSec) 
    : rawScenes.reduce((sum, s) => sum + Number(s.durationSec || 6), 0);

  // Normalisasi scenes
  const scenes = rawScenes.map((s, idx) => {
    const text = s.text || s.narration || "";
    const words = text.split(/\s+/).filter(Boolean);
    
    // Temukan kata yang cocok untuk highlighter
    let highlight = s.highlight || "";
    if (!highlight && words.length > 3) {
      const mid = Math.floor(words.length / 2);
      highlight = words.slice(mid, Math.min(mid + 3, words.length)).join(" ");
    }

    const meta = inferDiagramMeta(s, payload.title);
    const dur = Number(s.durationSec || (totalDuration / rawScenes.length).toFixed(1));
    return {
      id: `scene_${idx}`,
      idx,
      kicker: s.kicker || s.screenText || s.category || `POIN #${idx + 1}`,
      screenText: s.screenText || s.kicker || text,
      text,
      highlight,
      note: s.note || s.screenText || (idx === 0 ? "Fakta Awal" : "Temuan Kunci"),
      sourceTag: s.sourceTag || "BANYAKTAU STUDIO",
      ghost: s.ghost || (s.year ? String(s.year) : String(idx + 1).padStart(2, "0")),
      imagePath: s.imagePath || null,
      dur,
      // Metadata diagram dinamis
      illustration: s.illustration || meta.illustration,
      diagramTitle: s.diagramTitle || meta.diagramTitle,
      diagramBadge: s.diagramBadge || meta.diagramBadge,
      statValue: s.statValue || meta.statValue,
      statLabel: s.statLabel || meta.statLabel,
      track1Label: s.track1Label || meta.track1Label,
      track2Label: s.track2Label || meta.track2Label,
      box1Title: s.box1Title || meta.box1Title,
      box1Value: s.box1Value || meta.box1Value,
      box2Title: s.box2Title || meta.box2Title,
      box2Value: s.box2Value || meta.box2Value,
      step1: s.step1 || meta.step1,
      step2: s.step2 || meta.step2,
      step3: s.step3 || meta.step3
    };
  });

  // Jarak geser antar adegan di canvas #world
  const stepX = isVertical ? 0 : 2200;
  const stepY = isVertical ? 2200 : 0;

  // Deteksi Tema Otomatis / Manual (kartun, vintage, jurnalisme)
  const theme = String(payload.theme || options.theme || inferMotionTheme(rawScenes[0], payload)).toLowerCase();

  function renderCardInner(scene) {
    // 1. KASUS ASET GAMBAR NYATA (Hasil generate AI / Stock / Cutout)
    // Terapkan penanganan visual spesifik sesuai skill Bang Motion!
    if (scene.imagePath) {
      if (theme === "kartun" || theme === "collage") {
        return `
          <div style="position:absolute;inset:0;background:transparent;overflow:hidden;padding:20px;display:flex;flex-direction:column;justify-content:space-between;align-items:center;">
            <!-- Kartu Polaroid / Cutout Kertas dengan Shadow Mewah -->
            <div id="polaroid_${scene.idx}" style="position:relative;width:86%;height:84%;background:#FAF5EB;padding:14px 14px 38px;border-radius:6px;box-shadow:0 24px 45px rgba(34,30,27,0.30);transform:rotate(${scene.idx % 2 === 0 ? '-2deg' : '2deg'});display:flex;flex-direction:column;filter:drop-shadow(0 16px 25px rgba(34,30,27,0.25));">
              <!-- Selotip Transparan di Pojok Atas -->
              <div style="position:absolute;-top:12px;left:35%;width:90px;height:24px;background:rgba(255,255,255,0.7);transform:rotate(${scene.idx % 2 === 0 ? '-5deg' : '6deg'});box-shadow:0 1px 3px rgba(0,0,0,0.15);backdrop-filter:blur(2px);z-index:10;"></div>
              
              <!-- Gambar Cutout Utama -->
              <div style="flex:1;overflow:hidden;border-radius:4px;background:#E9DCC1;position:relative;">
                <img src="${escapeHtml(scene.imagePath)}" alt="${escapeHtml(scene.screenText || scene.note)}" style="width:100%;height:100%;object-fit:cover;display:block;">
              </div>
              <div style="margin-top:10px;display:flex;justify-content:space-between;align-items:center;font-family:'Caveat',cursive;font-size:30px;color:#221E1B;font-weight:700;">
                <span>${escapeHtml(scene.note || scene.screenText || 'Fakta Kunci')}</span>
                <span style="color:#D63B2F;font-size:24px;">✦ ${escapeHtml(scene.statValue || '')}</span>
              </div>
            </div>

            <!-- SVG Panah Lengkung Merah Sketsa Tangan -->
            <svg style="position:absolute;inset:0;width:100%;height:100%;pointer-events:none;overflow:visible;">
              <path id="photo_arrow_${scene.idx}" d="M 680 120 Q 520 60 440 180" fill="none" stroke="#D63B2F" stroke-width="6" stroke-linecap="round"/>
            </svg>

            <!-- Bottom Sticker Badges -->
            <div style="width:100%;display:flex;justify-content:space-between;align-items:center;padding:0 8px;">
              <span style="font-family:'Bricolage Grotesque',sans-serif;font-size:17px;background:#1F9E95;color:#fff;padding:4px 16px;border-radius:20px;font-weight:700;">● ${escapeHtml(scene.diagramBadge || 'EKSPLORASI')}</span>
              <span style="font-family:'Caveat',cursive;font-size:26px;color:#D63B2F;font-weight:700;">${escapeHtml(scene.highlight || scene.kicker)}</span>
            </div>
          </div>
        `;
      } else if (theme === "vintage" || theme === "sketsa") {
        return `
          <div style="position:absolute;inset:0;background:transparent;overflow:hidden;padding:22px;display:flex;flex-direction:column;justify-content:space-between;">
            <div style="display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid rgba(91,70,52,0.35);padding-bottom:8px;">
              <span style="font-family:'Cinzel',serif;font-size:16px;letter-spacing:0.2em;color:#9A3B22;font-weight:700;">ARSIP ILMIAH &bull; ${escapeHtml(scene.diagramTitle || 'DOKUMEN HISTORIS')}</span>
              <span style="font-family:'Cinzel',serif;font-size:14px;color:#5B4634;">FIG. ${scene.idx + 1}</span>
            </div>
            
            <div style="flex:1;margin:10px 0;display:flex;align-items:center;justify-content:center;position:relative;">
              <div style="width:86%;height:92%;border:5px double #5B4634;border-radius:8px;padding:8px;position:relative;overflow:hidden;">
                <img src="${escapeHtml(scene.imagePath)}" alt="${escapeHtml(scene.screenText || scene.note)}" style="width:100%;height:100%;object-fit:cover;display:block;mix-blend-mode:multiply;filter:sepia(0.65) contrast(1.15) brightness(0.92);">
                <div style="position:absolute;inset:0;pointer-events:none;border:1px solid rgba(91,70,52,0.4);margin:4px;"></div>
              </div>
              <svg viewBox="0 0 800 360" style="position:absolute;inset:0;width:100%;height:100%;pointer-events:none;overflow:visible;">
                <path id="vintage_anno_${scene.idx}" d="M 120 180 C 120 90 240 60 380 80 C 500 100 520 260 400 300 C 280 340 120 280 120 180" stroke="#9A3B22" stroke-width="4" stroke-linecap="round" fill="none"/>
              </svg>
            </div>

            <div style="display:flex;justify-content:space-between;align-items:center;">
              <span style="font-family:'Cinzel',serif;font-size:13px;color:#5B4634;letter-spacing:0.12em;">${escapeHtml(scene.box1Title || 'KLASIFIKASI TERVERIFIKASI')}</span>
              <span style="font-family:'EB Garamond',serif;font-style:italic;font-size:22px;color:#9A3B22;">~ ${escapeHtml(scene.statLabel || scene.note)}</span>
            </div>
          </div>
        `;
      } else if (theme === "poster") {
        return `
          <div style="position:absolute;inset:0;background:#09090b;overflow:hidden;padding:20px;display:flex;flex-direction:column;justify-content:space-between;">
            <div style="position:absolute;top:0;right:0;width:55%;height:100%;background:#FF0055;transform:skewX(-6deg);transform-origin:top right;opacity:0.9;"></div>
            <div style="position:relative;z-index:10;background:#FFEB3B;color:#000;display:inline-block;padding:6px 18px;font-family:'Barlow Condensed',sans-serif;font-size:26px;font-weight:900;letter-spacing:0.08em;text-transform:uppercase;transform:rotate(-2deg);box-shadow:0 8px 16px rgba(0,0,0,0.4);align-self:flex-start;">
              ${escapeHtml(scene.kicker || scene.diagramTitle || 'FAKTA MENGEJUTKAN')}
            </div>
            <div id="poster_card_${scene.idx}" style="position:relative;z-index:5;flex:1;margin:10px 0;display:flex;align-items:center;justify-content:center;">
              <div style="width:84%;height:92%;border:5px solid #000;box-shadow:14px 14px 0px #FFEB3B;overflow:hidden;background:#fff;position:relative;">
                <img src="${escapeHtml(scene.imagePath)}" alt="${escapeHtml(scene.screenText || scene.note)}" style="width:100%;height:100%;object-fit:cover;display:block;">
              </div>
            </div>
            <div style="position:relative;z-index:10;background:#000;border:3px solid #FFEB3B;padding:10px 18px;display:flex;justify-content:space-between;align-items:center;">
              <span style="font-family:'Barlow Condensed',sans-serif;font-size:36px;font-weight:900;color:#FFEB3B;line-height:1;">
                ${escapeHtml(scene.statValue || scene.screenText)}
              </span>
              <span style="font-family:'IBM Plex Mono',monospace;font-size:14px;color:#fff;background:#FF0055;padding:4px 10px;font-weight:700;">
                ${escapeHtml(scene.statLabel || 'VERIFIED')}
              </span>
            </div>
          </div>
        `;
      } else if (theme === "gradient") {
        return `
          <div style="position:absolute;inset:0;background:radial-gradient(circle at center, #1e1b4b 0%, #09090b 80%);overflow:hidden;padding:24px;display:flex;flex-direction:column;justify-content:space-between;">
            <div style="position:absolute;top:20%;left:25%;width:50%;height:50%;border-radius:50%;background:radial-gradient(circle, rgba(56,189,248,0.35) 0%, rgba(139,92,246,0.15) 50%, transparent 70%);filter:blur(30px);"></div>
            <div style="position:relative;z-index:10;display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid rgba(255,255,255,0.15);padding-bottom:8px;">
              <span style="font-family:'Barlow Condensed',sans-serif;font-size:22px;letter-spacing:0.12em;color:#38BDF8;font-weight:700;">🌌 ${escapeHtml(scene.diagramTitle || 'KOSMOLOGI & SAINS')}</span>
              <span style="font-family:'IBM Plex Mono',monospace;font-size:14px;color:#A78BFA;border:1px solid rgba(167,139,250,0.3);padding:2px 10px;border-radius:20px;">${escapeHtml(scene.diagramBadge || 'TEORI TERBUKTI')}</span>
            </div>
            <div id="gradient_portal_${scene.idx}" style="position:relative;z-index:5;flex:1;margin:12px 0;display:flex;align-items:center;justify-content:center;">
              <div style="width:84%;height:90%;border-radius:18px;padding:3px;background:linear-gradient(135deg, #38BDF8, #818CF8, #C084FC);box-shadow:0 0 40px rgba(56,189,248,0.35);">
                <div style="width:100%;height:100%;border-radius:16px;overflow:hidden;background:#000;">
                  <img src="${escapeHtml(scene.imagePath)}" alt="${escapeHtml(scene.screenText || scene.note)}" style="width:100%;height:100%;object-fit:cover;display:block;">
                </div>
              </div>
            </div>
            <div style="position:relative;z-index:10;display:flex;justify-content:space-between;align-items:flex-end;">
              <div style="font-family:'Barlow Condensed',sans-serif;font-size:32px;font-weight:800;color:#F3F4F6;line-height:1.1;">
                ${escapeHtml(scene.screenText || scene.note)}
              </div>
              <div style="font-family:'IBM Plex Mono',monospace;font-size:18px;color:#38BDF8;font-weight:700;">
                ${escapeHtml(scene.statValue || '')}
              </div>
            </div>
          </div>
        `;
      } else if (theme === "catalog") {
        return `
          <div style="position:absolute;inset:0;background:#F8F9FA;overflow:hidden;padding:24px;display:flex;flex-direction:column;justify-content:space-between;">
            <div style="position:absolute;inset:0;opacity:0.06;background-size:40px 40px;background-image:linear-gradient(to right,#000 1px,transparent 1px),linear-gradient(to bottom,#000 1px,transparent 1px);"></div>
            <div style="position:relative;z-index:10;display:flex;justify-content:space-between;align-items:center;border-bottom:2px solid #111827;padding-bottom:8px;">
              <span style="font-family:'IBM Plex Mono',monospace;font-size:16px;letter-spacing:0.1em;color:#111827;font-weight:800;">CATALOG SPEC &bull; ${escapeHtml(scene.diagramTitle || 'ANATOMI OBJEK')}</span>
              <span style="font-family:'IBM Plex Mono',monospace;font-size:14px;color:#2563EB;font-weight:700;">REF #${scene.idx + 1}</span>
            </div>
            <div id="catalog_card_${scene.idx}" style="position:relative;z-index:5;flex:1;margin:10px 0;display:flex;align-items:center;justify-content:center;">
              <div style="position:relative;width:84%;height:90%;background:#fff;border:1px solid #E5E7EB;border-radius:8px;box-shadow:0 12px 30px rgba(0,0,0,0.06);padding:10px;display:flex;flex-direction:column;">
                <div style="flex:1;overflow:hidden;border-radius:6px;background:#F3F4F6;">
                  <img src="${escapeHtml(scene.imagePath)}" alt="${escapeHtml(scene.screenText || scene.note)}" style="width:100%;height:100%;object-fit:contain;display:block;">
                </div>
                <div style="margin-top:8px;display:flex;justify-content:space-between;font-family:'IBM Plex Mono',monospace;font-size:13px;color:#6B7280;">
                  <span>SPESIFIKASI FISIK</span>
                  <span style="color:#2563EB;font-weight:700;">${escapeHtml(scene.statValue || '100%')}</span>
                </div>
              </div>
            </div>
            <div style="position:relative;z-index:10;display:flex;justify-content:space-between;align-items:center;border-top:1px solid #E5E7EB;padding-top:8px;">
              <span style="font-family:'Barlow Condensed',sans-serif;font-size:24px;color:#111827;font-weight:800;">${escapeHtml(scene.screenText || scene.note)}</span>
              <span style="font-family:'IBM Plex Mono',monospace;font-size:14px;background:#2563EB;color:#fff;padding:3px 10px;border-radius:4px;font-weight:700;">TERUJI</span>
            </div>
          </div>
        `;
      } else if (theme === "action") {
        return `
          <div style="position:absolute;inset:0;background:#0C0E14;overflow:hidden;padding:24px;display:flex;flex-direction:column;justify-content:space-between;">
            <div style="position:relative;z-index:10;display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid rgba(255,255,255,0.1);padding-bottom:8px;">
              <span style="font-family:'IBM Plex Mono',monospace;font-size:18px;color:#FACC15;font-weight:700;letter-spacing:0.12em;">⚡ KONTINUASI &bull; ${escapeHtml(scene.diagramTitle || 'TRAJEKTORI')}</span>
              <span style="font-family:'Barlow Condensed',sans-serif;font-size:28px;color:#38BDF8;font-weight:900;">${escapeHtml(scene.statValue || 'MAX')}</span>
            </div>
            <div id="action_track_${scene.idx}" style="position:relative;z-index:5;flex:1;margin:10px 0;display:flex;align-items:center;justify-content:center;">
              <div style="width:84%;height:88%;border-radius:12px;overflow:hidden;border:2px solid rgba(56,189,248,0.4);box-shadow:0 18px 40px rgba(0,0,0,0.8);position:relative;">
                <img src="${escapeHtml(scene.imagePath)}" alt="${escapeHtml(scene.screenText || scene.note)}" style="width:100%;height:100%;object-fit:cover;display:block;">
                <div style="position:absolute;inset:0;background:linear-gradient(90deg, transparent 60%, rgba(12,14,20,0.85) 100%);"></div>
              </div>
            </div>
            <div style="position:relative;z-index:10;display:flex;justify-content:space-between;align-items:center;">
              <span style="font-family:'Barlow Condensed',sans-serif;font-size:28px;font-weight:800;color:#F3F4F6;">${escapeHtml(scene.screenText || scene.note)}</span>
              <span style="font-family:'IBM Plex Mono',monospace;font-size:15px;color:#FACC15;background:rgba(250,204,21,0.1);padding:4px 12px;border-radius:4px;border:1px solid rgba(250,204,21,0.3);">${escapeHtml(scene.statLabel || 'AKSELERASI')}</span>
            </div>
          </div>
        `;
      } else {
        return `
          <div style="position:absolute;inset:0;overflow:hidden;">
            <img src="${escapeHtml(scene.imagePath)}" alt="${escapeHtml(scene.screenText || scene.note)}" style="width:100%;height:100%;object-fit:cover;display:block;">
            <div style="position:absolute;inset:0;background:linear-gradient(180deg, rgba(11,11,12,0.4) 0%, transparent 40%, rgba(11,11,12,0.92) 100%);"></div>
            
            <svg viewBox="0 0 800 360" style="position:absolute;inset:0;width:100%;height:100%;pointer-events:none;">
              <g transform="translate(180, 140)">
                <circle cx="0" cy="0" r="38" fill="none" stroke="#FFD400" stroke-width="2" stroke-dasharray="6 4"/>
                <line x1="-50" y1="0" x2="-25" y2="0" stroke="#FFD400" stroke-width="2.5"/>
                <line x1="25" y1="0" x2="50" y2="0" stroke="#FFD400" stroke-width="2.5"/>
                <line x1="0" y1="-50" x2="0" y2="-25" stroke="#FFD400" stroke-width="2.5"/>
                <line x1="0" y1="25" x2="0" y2="50" stroke="#FFD400" stroke-width="2.5"/>
                <circle cx="0" cy="0" r="5" fill="#E8402F"/>
              </g>
              <path d="M 218 140 L 320 140 L 350 90 L 460 90" fill="none" stroke="#38bdf8" stroke-width="2.5"/>
              <circle cx="460" cy="90" r="4" fill="#38bdf8"/>
            </svg>

            <div style="position:absolute;left:30px;bottom:30px;right:30px;display:flex;justify-content:space-between;align-items:flex-end;">
              <div>
                <div style="display:inline-block;background:#E8402F;color:#fff;font-family:'IBM Plex Mono',monospace;font-size:13px;padding:3px 10px;border-radius:3px;font-weight:700;letter-spacing:0.1em;margin-bottom:6px;">
                  INSPEKSI FAKTA
                </div>
                <div style="font-family:'Barlow Condensed',sans-serif;font-size:36px;font-weight:800;color:#F5F2EA;text-transform:uppercase;line-height:1.1;">
                  ${escapeHtml(scene.note || scene.screenText)}
                </div>
              </div>
              <div style="text-align:right;background:rgba(0,0,0,0.65);padding:6px 14px;border-radius:4px;border:1px solid rgba(255,255,255,0.15);font-family:'IBM Plex Mono',monospace;font-size:13px;color:#FFD400;">
                ${escapeHtml(scene.statValue || 'DATA TERVERIFIKASI')}
              </div>
            </div>
          </div>
        `;
      }
    }

    const ill = String(scene.illustration || "").toLowerCase();

    // 1. Waveform / Perbandingan Frekuensi & Gelombang
    if (ill === "waveform" || ill === "acoustic" || ill === "sound" || ill === "wave") {
      return `
        <div style="position:absolute;inset:0;background:#0d0f12;overflow:hidden;padding:28px;display:flex;flex-direction:column;justify-content:space-between;">
          <div style="position:absolute;inset:0;opacity:0.12;background-size:36px 36px;background-image:linear-gradient(to right,#fff 1px,transparent 1px),linear-gradient(to bottom,#fff 1px,transparent 1px);"></div>
          <div style="position:relative;z-index:2;display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid rgba(255,255,255,0.1);padding-bottom:12px;">
            <span style="font-family:'IBM Plex Mono',monospace;font-size:22px;letter-spacing:0.12em;color:var(--yel);font-weight:600;">${escapeHtml(scene.diagramTitle)}</span>
            <span style="font-family:'IBM Plex Mono',monospace;font-size:18px;color:var(--mute);background:rgba(255,255,255,0.06);padding:4px 12px;border-radius:4px;">${escapeHtml(scene.diagramBadge)}</span>
          </div>
          <svg viewBox="0 0 800 360" style="position:relative;z-index:2;width:100%;height:360px;overflow:visible;">
            <text x="0" y="24" fill="#E8402F" font-family="'IBM Plex Mono',monospace" font-size="20" font-weight="600">${escapeHtml(scene.track1Label)}</text>
            <path id="wave_red_${scene.idx}" d="M 0 70 Q 25 10 50 70 T 100 70 T 150 70 T 200 70 T 250 70 T 300 70 T 350 70 T 400 70 T 450 70 T 500 70 T 550 70 T 600 70 T 650 70 T 700 70 T 750 70 T 800 70" fill="none" stroke="#E8402F" stroke-width="4" stroke-linecap="round"/>

            <line x1="0" y1="130" x2="800" y2="130" stroke="rgba(255,255,255,0.1)" stroke-dasharray="6 6"/>

            <text x="0" y="170" fill="#FFD400" font-family="'IBM Plex Mono',monospace" font-size="20" font-weight="600">${escapeHtml(scene.track2Label)}</text>
            <path id="wave_yel_${scene.idx}" d="M 0 215 Q 100 205 200 215 T 400 215 T 600 215 T 800 215" fill="none" stroke="#FFD400" stroke-width="5" stroke-linecap="round"/>

            <rect x="0" y="265" width="370" height="75" rx="8" fill="rgba(255,255,255,0.04)" stroke="rgba(255,255,255,0.12)"/>
            <text x="20" y="295" fill="#9CA3AF" font-family="'IBM Plex Mono',monospace" font-size="15">${escapeHtml(scene.box1Title)}</text>
            <text x="20" y="328" fill="#F5F2EA" font-family="'Barlow Condensed',sans-serif" font-size="32" font-weight="800">${escapeHtml(scene.box1Value)}</text>

            <rect x="400" y="265" width="400" height="75" rx="8" fill="rgba(255,212,0,0.06)" stroke="rgba(255,212,0,0.25)"/>
            <text x="420" y="295" fill="#FFD400" font-family="'IBM Plex Mono',monospace" font-size="15">${escapeHtml(scene.box2Title)}</text>
            <text x="420" y="328" fill="#FFD400" font-family="'Barlow Condensed',sans-serif" font-size="32" font-weight="800">${escapeHtml(scene.box2Value)}</text>
          </svg>
        </div>
      `;
    }

    // 2. Statistik & Counter Gauge
    if (ill === "stats" || ill === "counter" || ill === "data") {
      return `
        <div style="position:absolute;inset:0;background:#0d0f14;overflow:hidden;padding:32px;display:flex;flex-direction:column;justify-content:space-between;align-items:center;text-align:center;">
          <div style="position:absolute;inset:0;opacity:0.1;background-size:32px 32px;background-image:linear-gradient(to right,#fff 1px,transparent 1px),linear-gradient(to bottom,#fff 1px,transparent 1px);"></div>
          <div style="position:relative;z-index:2;width:100%;display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid rgba(255,255,255,0.1);padding-bottom:12px;">
            <span style="font-family:'IBM Plex Mono',monospace;font-size:22px;letter-spacing:0.12em;color:var(--yel);font-weight:600;">${escapeHtml(scene.diagramTitle)}</span>
            <span style="font-family:'IBM Plex Mono',monospace;font-size:18px;color:var(--mute);background:rgba(255,255,255,0.06);padding:4px 12px;border-radius:4px;">${escapeHtml(scene.diagramBadge)}</span>
          </div>
          <div style="position:relative;z-index:2;margin:15px 0;">
            <div style="font-family:'Barlow Condensed',sans-serif;font-size:120px;font-weight:900;line-height:0.9;color:#FFD400;text-shadow:0 0 50px rgba(255,212,0,0.4);">${escapeHtml(scene.statValue)}</div>
            <div style="font-family:'IBM Plex Mono',monospace;font-size:24px;color:#F5F2EA;margin-top:14px;font-weight:600;">${escapeHtml(scene.statLabel)}</div>
          </div>
          <div style="position:relative;z-index:2;width:100%;display:flex;gap:15px;">
            <div style="flex:1;background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.1);border-radius:8px;padding:12px;text-align:left;">
              <div style="font-family:'IBM Plex Mono',monospace;font-size:14px;color:#9CA3AF;">${escapeHtml(scene.box1Title)}</div>
              <div style="font-family:'Barlow Condensed',sans-serif;font-size:28px;font-weight:800;color:#F5F2EA;">${escapeHtml(scene.box1Value)}</div>
            </div>
            <div style="flex:1;background:rgba(255,212,0,0.06);border:1px solid rgba(255,212,0,0.2);border-radius:8px;padding:12px;text-align:left;">
              <div style="font-family:'IBM Plex Mono',monospace;font-size:14px;color:#FFD400;">${escapeHtml(scene.box2Title)}</div>
              <div style="font-family:'Barlow Condensed',sans-serif;font-size:28px;font-weight:800;color:#FFD400;">${escapeHtml(scene.box2Value)}</div>
            </div>
          </div>
        </div>
      `;
    }

    // 3. Perisai / Medan Magnet / Defleksi Kosmik / Radar
    if (ill === "shield" || ill === "radar" || ill === "magnetic") {
      return `
        <div style="position:absolute;inset:0;background:#090b10;overflow:hidden;padding:28px;display:flex;flex-direction:column;justify-content:space-between;">
          <div style="position:absolute;inset:0;opacity:0.15;background-size:40px 40px;background-image:linear-gradient(to right,#38bdf8 1px,transparent 1px),linear-gradient(to bottom,#38bdf8 1px,transparent 1px);"></div>
          <div style="position:relative;z-index:2;display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid rgba(255,255,255,0.1);padding-bottom:12px;">
            <span style="font-family:'IBM Plex Mono',monospace;font-size:22px;letter-spacing:0.12em;color:#38bdf8;font-weight:600;">${escapeHtml(scene.diagramTitle)}</span>
            <span style="font-family:'IBM Plex Mono',monospace;font-size:18px;color:var(--mute);background:rgba(255,255,255,0.06);padding:4px 12px;border-radius:4px;">${escapeHtml(scene.diagramBadge)}</span>
          </div>
          <svg viewBox="0 0 800 360" style="position:relative;z-index:2;width:100%;height:360px;overflow:visible;">
            <circle cx="280" cy="180" r="70" fill="rgba(56,189,248,0.1)" stroke="#38bdf8" stroke-width="3"/>
            <circle cx="280" cy="180" r="130" fill="none" stroke="rgba(56,189,248,0.3)" stroke-width="2" stroke-dasharray="8 6"/>
            <circle cx="280" cy="180" r="190" fill="none" stroke="rgba(255,212,0,0.4)" stroke-width="2.5" stroke-dasharray="12 8"/>
            <circle cx="280" cy="180" r="35" fill="#38bdf8" opacity="0.8"/>
            <text x="280" y="186" fill="#090b10" font-family="'IBM Plex Mono',monospace" font-size="14" font-weight="800" text-anchor="middle">INTI</text>

            <path id="shield_vec1_${scene.idx}" d="M 680 80 L 440 100 Q 380 130 400 50" fill="none" stroke="#E8402F" stroke-width="3.5" stroke-linecap="round"/>
            <path id="shield_vec2_${scene.idx}" d="M 720 180 L 470 180 Q 400 180 430 270" fill="none" stroke="#FFD400" stroke-width="4" stroke-linecap="round"/>
            <path id="shield_vec3_${scene.idx}" d="M 680 280 L 440 260 Q 380 230 400 310" fill="none" stroke="#E8402F" stroke-width="3.5" stroke-linecap="round"/>

            <text x="560" y="45" fill="#E8402F" font-family="'IBM Plex Mono',monospace" font-size="17" font-weight="600">${escapeHtml(scene.track1Label)}</text>
            <text x="470" y="225" fill="#FFD400" font-family="'IBM Plex Mono',monospace" font-size="17" font-weight="600">${escapeHtml(scene.track2Label)}</text>

            <rect x="520" y="265" width="280" height="75" rx="8" fill="rgba(56,189,248,0.08)" stroke="rgba(56,189,248,0.3)"/>
            <text x="540" y="295" fill="#9CA3AF" font-family="'IBM Plex Mono',monospace" font-size="14">${escapeHtml(scene.box1Title)}</text>
            <text x="540" y="328" fill="#38bdf8" font-family="'Barlow Condensed',sans-serif" font-size="30" font-weight="800">${escapeHtml(scene.box1Value)}</text>
          </svg>
        </div>
      `;
    }

    // 4. Flowchart / Tahapan & Mekanisme
    if (ill === "flowchart" || ill === "process" || ill === "steps") {
      return `
        <div style="position:absolute;inset:0;background:#0d0f14;overflow:hidden;padding:28px;display:flex;flex-direction:column;justify-content:space-between;">
          <div style="position:absolute;inset:0;opacity:0.1;background-size:32px 32px;background-image:linear-gradient(to right,#fff 1px,transparent 1px),linear-gradient(to bottom,#fff 1px,transparent 1px);"></div>
          <div style="position:relative;z-index:2;display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid rgba(255,255,255,0.1);padding-bottom:12px;">
            <span style="font-family:'IBM Plex Mono',monospace;font-size:22px;letter-spacing:0.12em;color:var(--yel);font-weight:600;">${escapeHtml(scene.diagramTitle)}</span>
            <span style="font-family:'IBM Plex Mono',monospace;font-size:18px;color:var(--mute);background:rgba(255,255,255,0.06);padding:4px 12px;border-radius:4px;">${escapeHtml(scene.diagramBadge)}</span>
          </div>
          <div style="position:relative;z-index:2;display:flex;flex-direction:column;gap:14px;margin:10px 0;">
            <div id="flow_step1_${scene.idx}" style="display:flex;align-items:center;background:rgba(255,255,255,0.04);border-left:4px solid #E8402F;padding:14px 20px;border-radius:4px;">
              <span style="font-family:'IBM Plex Mono',monospace;font-size:20px;font-weight:700;color:#E8402F;margin-right:20px;">01</span>
              <span style="font-family:'Barlow Condensed',sans-serif;font-size:28px;font-weight:700;color:#F5F2EA;">${escapeHtml(scene.step1)}</span>
            </div>
            <div id="flow_step2_${scene.idx}" style="display:flex;align-items:center;background:rgba(255,212,0,0.06);border-left:4px solid #FFD400;padding:14px 20px;border-radius:4px;">
              <span style="font-family:'IBM Plex Mono',monospace;font-size:20px;font-weight:700;color:#FFD400;margin-right:20px;">02</span>
              <span style="font-family:'Barlow Condensed',sans-serif;font-size:28px;font-weight:700;color:#FFD400;">${escapeHtml(scene.step2)}</span>
            </div>
            <div id="flow_step3_${scene.idx}" style="display:flex;align-items:center;background:rgba(56,189,248,0.06);border-left:4px solid #38bdf8;padding:14px 20px;border-radius:4px;">
              <span style="font-family:'IBM Plex Mono',monospace;font-size:20px;font-weight:700;color:#38bdf8;margin-right:20px;">03</span>
              <span style="font-family:'Barlow Condensed',sans-serif;font-size:28px;font-weight:700;color:#F5F2EA;">${escapeHtml(scene.step3)}</span>
            </div>
          </div>
          <div style="position:relative;z-index:2;font-family:'IBM Plex Mono',monospace;font-size:16px;color:#9CA3AF;text-align:right;">
            MEKANISME TERHUBUNG SECARA BERTAHAP ●
          </div>
        </div>
      `;
    }

    // 5. Vox-Style Corkboard / Collage / Bukti Investigasi
    if (ill === "pinboard" || ill === "collage" || ill === "evidence") {
      return `
        <div style="position:absolute;inset:0;background:#14151a;overflow:hidden;padding:26px;display:flex;flex-direction:column;justify-content:space-between;">
          <!-- Tekstur Corkboard & Grid Pinboard -->
          <div style="position:absolute;inset:0;opacity:0.12;background-size:24px 24px;background-image:radial-gradient(#fff 1px,transparent 1px);"></div>
          
          <!-- Top Bar -->
          <div style="position:relative;z-index:10;display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid rgba(255,255,255,0.12);padding-bottom:10px;">
            <span style="font-family:'IBM Plex Mono',monospace;font-size:20px;letter-spacing:0.12em;color:#FFD400;font-weight:600;">📌 ${escapeHtml(scene.diagramTitle)}</span>
            <span style="font-family:'IBM Plex Mono',monospace;font-size:16px;color:#9CA3AF;background:rgba(255,255,255,0.06);padding:3px 10px;border-radius:4px;">${escapeHtml(scene.diagramBadge)}</span>
          </div>

          <!-- Papan Kartu Bukti dengan Selotip & Pin Merah -->
          <div style="position:relative;z-index:5;flex:1;margin:14px 0;display:flex;align-items:center;justify-content:center;">
            <!-- SVG Benang Merah Antar Pin -->
            <svg viewBox="0 0 800 360" style="position:absolute;inset:0;width:100%;height:100%;z-index:2;pointer-events:none;">
              <path id="pin_thread_${scene.idx}" d="M 220 90 Q 400 190 580 130" fill="none" stroke="#E8402F" stroke-width="3.5" stroke-dasharray="6 4"/>
            </svg>

            <div style="position:relative;z-index:3;width:100%;display:flex;gap:24px;align-items:flex-start;justify-content:center;">
              <!-- Kartu Foto / Bukti 1 (Tilt Kiri -3deg) -->
              <div id="pin_card1_${scene.idx}" style="position:relative;width:48%;background:#F5F2EA;color:#111;padding:16px;border-radius:4px;box-shadow:0 12px 30px rgba(0,0,0,0.6);transform:rotate(-3deg);">
                <!-- Selotip Transparan di Pojok Atas -->
                <div style="position:absolute;-top:10px;left:20px;width:70px;height:22px;background:rgba(255,255,255,0.5);transform:rotate(-8deg);box-shadow:0 1px 3px rgba(0,0,0,0.2);backdrop-filter:blur(2px);"></div>
                <!-- Jarum Pin Merah -->
                <div style="position:absolute;-top:8px;right:24px;width:14px;height:14px;background:#E8402F;border-radius:50%;border:2px solid #fff;box-shadow:0 3px 6px rgba(0,0,0,0.5);"></div>
                
                <div style="background:#0F1115;color:#F5F2EA;padding:18px 12px;border-radius:2px;text-align:center;">
                  <div style="font-family:'IBM Plex Mono',monospace;font-size:13px;letter-spacing:0.1em;color:#9CA3AF;">ARSIP BUKTI #01</div>
                  <div style="font-family:'Barlow Condensed',sans-serif;font-size:32px;font-weight:800;color:#FFD400;margin-top:6px;line-height:1.1;">${escapeHtml(scene.box1Value)}</div>
                </div>
                <div style="font-family:'IBM Plex Mono',monospace;font-size:13px;font-weight:600;color:#222;margin-top:10px;text-transform:uppercase;">${escapeHtml(scene.box1Title)}</div>
              </div>

              <!-- Kartu Memo Sticky Bukti 2 (Tilt Kanan +3deg) -->
              <div id="pin_card2_${scene.idx}" style="position:relative;width:48%;background:#FFFCDB;color:#111;padding:16px;border-radius:4px;box-shadow:0 12px 30px rgba(0,0,0,0.6);transform:rotate(3deg);">
                <!-- Selotip Transparan di Pojok Atas -->
                <div style="position:absolute;-top:10px;right:20px;width:70px;height:22px;background:rgba(255,255,255,0.5);transform:rotate(6deg);box-shadow:0 1px 3px rgba(0,0,0,0.2);backdrop-filter:blur(2px);"></div>
                <!-- Jarum Pin Merah -->
                <div style="position:absolute;-top:8px;left:24px;width:14px;height:14px;background:#E8402F;border-radius:50%;border:2px solid #fff;box-shadow:0 3px 6px rgba(0,0,0,0.5);"></div>

                <div style="font-family:'IBM Plex Mono',monospace;font-size:13px;letter-spacing:0.1em;color:#666;border-bottom:1px dashed #bbb;padding-bottom:6px;">CATATAN KUNCI</div>
                <div style="font-family:'Barlow Condensed',sans-serif;font-size:26px;font-weight:700;color:#111;margin-top:8px;line-height:1.2;">${escapeHtml(scene.statLabel || scene.note)}</div>
                <div style="font-family:'IBM Plex Mono',monospace;font-size:12px;color:#888;margin-top:12px;">STATUS: TERHUBUNG KE TEMUAN</div>
              </div>
            </div>
          </div>

          <!-- Stempel Merah Declassified / Terverifikasi di Pojok Bawah -->
          <div style="position:relative;z-index:10;display:flex;justify-content:space-between;align-items:center;">
            <div id="pin_stamp_${scene.idx}" style="border:3px solid #E8402F;color:#E8402F;padding:4px 16px;border-radius:4px;font-family:'IBM Plex Mono',monospace;font-size:18px;font-weight:800;letter-spacing:0.15em;transform:rotate(-6deg);display:inline-block;box-shadow:inset 0 0 10px rgba(232,64,47,0.2);">
              DEKLASIFIKASI ● RESMI
            </div>
            <span style="font-family:'IBM Plex Mono',monospace;font-size:14px;color:#9CA3AF;">ARSIP INVESTIGASI</span>
          </div>
        </div>
      `;
    }

    // 6. Vox-Style Tactical Map / Flight Route Tracking
    if (ill === "map" || ill === "route" || ill === "flight" || ill === "tracking") {
      return `
        <div style="position:absolute;inset:0;background:#080d14;overflow:hidden;padding:26px;display:flex;flex-direction:column;justify-content:space-between;">
          <!-- Tactical Cartography Grid Lines -->
          <div style="position:absolute;inset:0;opacity:0.15;background-size:40px 40px;background-image:linear-gradient(to right,#38bdf8 1px,transparent 1px),linear-gradient(to bottom,#38bdf8 1px,transparent 1px);"></div>

          <!-- Top Bar Telemetry -->
          <div style="position:relative;z-index:10;display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid rgba(56,189,248,0.2);padding-bottom:10px;">
            <span style="font-family:'IBM Plex Mono',monospace;font-size:20px;letter-spacing:0.12em;color:#38bdf8;font-weight:600;">✈ ${escapeHtml(scene.diagramTitle)}</span>
            <span style="font-family:'IBM Plex Mono',monospace;font-size:15px;color:#FFD400;background:rgba(255,212,0,0.08);border:1px solid rgba(255,212,0,0.2);padding:3px 10px;border-radius:4px;">NAV: AKTIF</span>
          </div>

          <!-- Tactical Radar Map Display -->
          <svg viewBox="0 0 800 360" style="position:relative;z-index:5;width:100%;height:360px;overflow:visible;">
            <!-- Radar Range Rings -->
            <circle cx="200" cy="180" r="60" fill="none" stroke="rgba(56,189,248,0.2)" stroke-width="1.5"/>
            <circle cx="200" cy="180" r="110" fill="none" stroke="rgba(56,189,248,0.15)" stroke-width="1" stroke-dasharray="4 4"/>
            <circle cx="620" cy="140" r="60" fill="none" stroke="rgba(232,64,47,0.2)" stroke-width="1.5"/>

            <!-- Titik Asal / Origin -->
            <circle id="map_origin_ping_${scene.idx}" cx="200" cy="180" r="12" fill="#38bdf8" opacity="0.8"/>
            <circle cx="200" cy="180" r="5" fill="#fff"/>
            <text x="200" y="225" fill="#38bdf8" font-family="'IBM Plex Mono',monospace" font-size="16" font-weight="700" text-anchor="middle">${escapeHtml(scene.track1Label)}</text>

            <!-- Jalur Penerbangan Kurva Dinamis -->
            <path id="map_path_${scene.idx}" d="M 200 180 Q 410 70 620 140" fill="none" stroke="#FFD400" stroke-width="4.5" stroke-linecap="round" stroke-dasharray="10 6"/>

            <!-- Titik Tujuan / Target Node -->
            <g transform="translate(620,140)">
              <line x1="-15" y1="0" x2="15" y2="0" stroke="#E8402F" stroke-width="3"/>
              <line x1="0" y1="-15" x2="0" y2="15" stroke="#E8402F" stroke-width="3"/>
              <circle cx="0" cy="0" r="10" fill="none" stroke="#E8402F" stroke-width="2.5"/>
            </g>
            <text x="620" y="185" fill="#E8402F" font-family="'IBM Plex Mono',monospace" font-size="16" font-weight="700" text-anchor="middle">${escapeHtml(scene.track2Label)}</text>
          </svg>

          <!-- Telemetry Footer Card -->
          <div style="position:relative;z-index:10;display:flex;justify-content:space-between;background:rgba(0,0,0,0.5);border:1px solid rgba(56,189,248,0.25);border-radius:6px;padding:10px 18px;font-family:'IBM Plex Mono',monospace;">
            <div>
              <div style="font-size:13px;color:#9CA3AF;">${escapeHtml(scene.box1Title)}</div>
              <div style="font-size:22px;color:#38bdf8;font-weight:700;font-family:'Barlow Condensed',sans-serif;">${escapeHtml(scene.box1Value)}</div>
            </div>
            <div style="text-align:right;">
              <div style="font-size:13px;color:#9CA3AF;">${escapeHtml(scene.box2Title)}</div>
              <div style="font-size:22px;color:#FFD400;font-weight:700;font-family:'Barlow Condensed',sans-serif;">${escapeHtml(scene.box2Value)}</div>
            </div>
          </div>
        </div>
      `;
    }

    // 7. Vox-Style Newspaper Headline / Official Document
    if (ill === "newspaper" || ill === "document" || ill === "headline" || ill === "archive") {
      return `
        <div style="position:absolute;inset:0;background:#161513;overflow:hidden;padding:26px;display:flex;flex-direction:column;justify-content:space-between;">
          <!-- Paper Grain & Vintage Tone -->
          <div style="position:absolute;inset:0;opacity:0.08;background-size:16px 16px;background-image:linear-gradient(to right,#fff 1px,transparent 1px),linear-gradient(to bottom,#fff 1px,transparent 1px);"></div>

          <!-- Masthead Koran / Breaking News Card -->
          <div style="position:relative;z-index:10;border-bottom:2px solid rgba(245,242,234,0.3);padding-bottom:10px;text-align:center;">
            <div style="display:inline-flex;align-items:center;gap:6px;background:rgba(232,64,47,0.18);border:1px solid #E8402F;padding:3px 12px;border-radius:4px;margin-bottom:6px;">
              <span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:#E8402F;"></span>
              <span style="font-family:'IBM Plex Mono',monospace;font-size:12px;color:#FF6B5B;font-weight:700;letter-spacing:0.16em;">BREAKING NEWS &bull; ISU VIRAL</span>
            </div>
            <div style="font-family:'Barlow Condensed',sans-serif;font-size:26px;letter-spacing:0.2em;color:#F5F2EA;font-weight:900;">ARSIP INVESTIGASI BERITA</div>
            <div style="display:flex;justify-content:space-between;font-family:'IBM Plex Mono',monospace;font-size:13px;color:#9CA3AF;border-top:1px solid rgba(255,255,255,0.1);padding-top:4px;margin-top:4px;">
              <span>EDISI FAKTA AKTUAL</span>
              <span>DOKUMEN DIVERIFIKASI</span>
            </div>
          </div>

          <!-- Headline Utama dengan Animasi Highlighter -->
          <div style="position:relative;z-index:10;margin:18px 0;text-align:center;">
            <div style="position:relative;display:inline-block;padding:4px 12px;">
              <!-- Highlighter Kuning di Belakang Teks Headline -->
              <span id="news_hl_${scene.idx}" style="position:absolute;inset:0;background:rgba(255,212,0,0.88);border-radius:3px;transform-origin:0 50%;transform:scaleX(0);z-index:1;"></span>
              <span style="position:relative;z-index:2;font-family:'Barlow Condensed',sans-serif;font-size:46px;font-weight:900;color:#0e1014;line-height:1.1;text-transform:uppercase;">
                ${escapeHtml(scene.note || scene.statLabel)}
              </span>
            </div>

            <!-- Paragraf Kolom Tipografi Koran -->
            <div style="margin-top:18px;display:flex;gap:18px;text-align:left;font-family:'IBM Plex Mono',monospace;font-size:13px;color:#C5BFB5;line-height:1.5;">
              <div style="flex:1;border-right:1px solid rgba(255,255,255,0.1);padding-right:12px;">
                <strong style="color:#FFD400;">KRONOLOGI:</strong> ${escapeHtml(scene.track1Label || 'Peristiwa hangat yang ramai diperbincangkan publik.')}
              </div>
              <div style="flex:1;">
                <strong style="color:#FFD400;">FAKTA SAINS:</strong> ${escapeHtml(scene.track2Label || 'Penjelasan logis dan bukti ilmiah yang diungkap BanyakTau.')}
              </div>
            </div>
          </div>

          <!-- Stempel Ink Cap Resmi -->
          <div style="position:relative;z-index:10;display:flex;justify-content:space-between;align-items:center;">
            <div id="news_stamp_${scene.idx}" style="border:3px dashed #E8402F;color:#E8402F;padding:4px 18px;border-radius:4px;font-family:'IBM Plex Mono',monospace;font-size:18px;font-weight:800;letter-spacing:0.12em;transform:rotate(-5deg);display:inline-block;background:rgba(232,64,47,0.06);">
              FAKTA TERKONFIRMASI
            </div>
            <span style="font-family:'IBM Plex Mono',monospace;font-size:14px;color:#9CA3AF;">ARSIP BANYAKTAU</span>
          </div>
        </div>
      `;
    }

    // 8. Dynamic Speedometer / Metric Gauge (Inspirasi Bang Motion "320 km/h")
    if (ill === "gauge" || ill === "speedometer" || ill === "meter" || ill === "speed") {
      return `
        <div style="position:absolute;inset:0;background:#0b0d13;overflow:hidden;padding:26px;display:flex;flex-direction:column;justify-content:space-between;">
          <div style="position:absolute;inset:0;opacity:0.1;background-size:32px 32px;background-image:linear-gradient(to right,#fff 1px,transparent 1px),linear-gradient(to bottom,#fff 1px,transparent 1px);"></div>
          
          <!-- Top Bar -->
          <div style="position:relative;z-index:10;display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid rgba(255,255,255,0.1);padding-bottom:10px;">
            <span style="font-family:'IBM Plex Mono',monospace;font-size:20px;letter-spacing:0.12em;color:#FFD400;font-weight:600;">⚡ ${escapeHtml(scene.diagramTitle)}</span>
            <span style="font-family:'IBM Plex Mono',monospace;font-size:15px;color:#38bdf8;background:rgba(56,189,248,0.08);border:1px solid rgba(56,189,248,0.25);padding:3px 12px;border-radius:4px;">${escapeHtml(scene.diagramBadge)}</span>
          </div>

          <!-- Gauge Dial & Digital Speedometer -->
          <div style="position:relative;z-index:5;display:flex;align-items:center;justify-content:center;margin:10px 0;">
            <svg viewBox="0 0 800 340" style="width:100%;height:340px;overflow:visible;">
              <!-- Outer Track Background Arc -->
              <path d="M 220 270 A 180 180 0 1 1 580 270" fill="none" stroke="rgba(255,255,255,0.08)" stroke-width="26" stroke-linecap="round"/>
              <!-- Active Gradient Arc -->
              <path id="gauge_arc_${scene.idx}" d="M 220 270 A 180 180 0 1 1 580 270" fill="none" stroke="#FFD400" stroke-width="26" stroke-linecap="round" stroke-dasharray="750" stroke-dashoffset="750"/>

              <!-- Tick Marks Around Gauge -->
              <circle cx="400" cy="270" r="140" fill="none" stroke="rgba(255,255,255,0.15)" stroke-width="2" stroke-dasharray="4 16"/>

              <!-- Central Pivot & Needle Jarum Speedometer -->
              <g id="gauge_needle_${scene.idx}" style="transform-origin: 400px 270px; transform: rotate(-85deg);">
                <line x1="400" y1="270" x2="250" y2="270" stroke="#E8402F" stroke-width="5" stroke-linecap="round"/>
                <circle cx="245" cy="270" r="7" fill="#E8402F"/>
              </g>
              <circle cx="400" cy="270" r="22" fill="#181c24" stroke="#FFD400" stroke-width="4"/>
              <circle cx="400" cy="270" r="8" fill="#FFD400"/>

              <!-- Digital Big Readout -->
              <g id="gauge_val_${scene.idx}">
                <text x="400" y="210" fill="#FFD400" font-family="'Barlow Condensed',sans-serif" font-size="92" font-weight="900" text-anchor="middle" letter-spacing="1px">${escapeHtml(scene.statValue || '320 km/h')}</text>
                <text x="400" y="245" fill="#F5F2EA" font-family="'IBM Plex Mono',monospace" font-size="20" font-weight="600" text-anchor="middle">${escapeHtml(scene.statLabel || 'PUNCAK MAKSIMAL')}</text>
              </g>
            </svg>
          </div>

          <!-- Bottom Telemetry Comparison Cards -->
          <div style="position:relative;z-index:10;display:flex;gap:16px;">
            <div style="flex:1;background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.1);border-radius:8px;padding:10px 16px;">
              <div style="font-family:'IBM Plex Mono',monospace;font-size:13px;color:#9CA3AF;">${escapeHtml(scene.box1Title || 'REKOR / INDIKATOR')}</div>
              <div style="font-family:'Barlow Condensed',sans-serif;font-size:26px;font-weight:800;color:#F5F2EA;">${escapeHtml(scene.box1Value || 'TERVERIFIKASI')}</div>
            </div>
            <div style="flex:1;background:rgba(255,212,0,0.06);border:1px solid rgba(255,212,0,0.25);border-radius:8px;padding:10px 16px;">
              <div style="font-family:'IBM Plex Mono',monospace;font-size:13px;color:#FFD400;">${escapeHtml(scene.box2Title || 'KOMPARASI')}</div>
              <div style="font-family:'Barlow Condensed',sans-serif;font-size:26px;font-weight:800;color:#FFD400;">${escapeHtml(scene.box2Value || 'SKALA EKSTREM')}</div>
            </div>
          </div>
        </div>
      `;
    }

    // 9. Vox-Style Investigative Callout / Target Reticle (Inspirasi Bang Motion "Where 4 in 10 Boxes Pass")
    if (ill === "callout" || ill === "reticle" || ill === "inspect" || ill === "target") {
      return `
        <div style="position:absolute;inset:0;background:#0e1014;overflow:hidden;padding:26px;display:flex;flex-direction:column;justify-content:space-between;">
          <!-- Tactical Grid Blueprint -->
          <div style="position:absolute;inset:0;opacity:0.12;background-size:36px 36px;background-image:radial-gradient(#38bdf8 1px,transparent 1px);"></div>

          <!-- Top Metadata Header -->
          <div style="position:relative;z-index:10;display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid rgba(255,255,255,0.12);padding-bottom:10px;">
            <div style="display:flex;align-items:center;gap:8px;">
              <span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:#FFD400;box-shadow:0 0 8px #FFD400;"></span>
              <span style="font-family:'IBM Plex Mono',monospace;font-size:18px;letter-spacing:0.12em;color:#F5F2EA;font-weight:700;">INSPEKSI FOKUS &bull; ${escapeHtml(scene.diagramTitle)}</span>
            </div>
            <span style="font-family:'IBM Plex Mono',monospace;font-size:14px;color:#9CA3AF;border:1px solid rgba(255,255,255,0.15);padding:3px 10px;border-radius:4px;">LAT: -06.12 // LON: 106.48</span>
          </div>

          <!-- Area Inspeksi dengan Target Reticle & Leader Line -->
          <div style="position:relative;z-index:5;flex:1;margin:12px 0;">
            <svg viewBox="0 0 800 340" style="position:absolute;inset:0;width:100%;height:100%;overflow:visible;">
              <!-- Target Crosshair Reticle -->
              <g id="callout_reticle_${scene.idx}" transform="translate(260, 160)">
                <!-- Shockwave Wave Pulse -->
                <circle id="callout_ring_${scene.idx}" cx="0" cy="0" r="55" fill="none" stroke="#FFD400" stroke-width="2" stroke-dasharray="6 6"/>
                <circle cx="0" cy="0" r="45" fill="rgba(255,212,0,0.08)" stroke="#FFD400" stroke-width="3"/>
                <!-- Reticle Crosshair Ticks -->
                <line x1="-55" y1="0" x2="-35" y2="0" stroke="#FFD400" stroke-width="3"/>
                <line x1="35" y1="0" x2="55" y2="0" stroke="#FFD400" stroke-width="3"/>
                <line x1="0" y1="-55" x2="0" y2="-35" stroke="#FFD400" stroke-width="3"/>
                <line x1="0" y1="35" x2="0" y2="55" stroke="#FFD400" stroke-width="3"/>
                <circle cx="0" cy="0" r="6" fill="#E8402F"/>
                <text x="0" y="75" fill="#FFD400" font-family="'IBM Plex Mono',monospace" font-size="14" font-weight="700" text-anchor="middle">ZONA TARGET</text>
              </g>

              <!-- Connecting Leader Line dari Reticle ke Info Card -->
              <path id="callout_line_${scene.idx}" d="M 305 160 L 410 160 L 450 110 L 490 110" fill="none" stroke="#38bdf8" stroke-width="3.5" stroke-linecap="round"/>
              <circle cx="490" cy="110" r="5" fill="#38bdf8"/>
            </svg>

            <!-- Floating Vox-Style Highlight Card -->
            <div id="callout_card_${scene.idx}" style="position:absolute;right:10px;top:40px;width:340px;background:rgba(18,22,28,0.92);border-left:5px solid #FFD400;border-top:1px solid rgba(255,255,255,0.1);border-right:1px solid rgba(255,255,255,0.1);border-bottom:1px solid rgba(255,255,255,0.1);border-radius:6px;padding:18px;box-shadow:0 15px 35px rgba(0,0,0,0.7);backdrop-filter:blur(6px);">
              <div style="font-family:'IBM Plex Mono',monospace;font-size:13px;letter-spacing:0.1em;color:#38bdf8;font-weight:600;">TEMUAN INVESTIGASI</div>
              <div style="font-family:'Barlow Condensed',sans-serif;font-size:46px;font-weight:900;color:#FFD400;line-height:1.0;margin:6px 0;">${escapeHtml(scene.statValue || '4 DARI 10')}</div>
              <div style="font-family:'Barlow Condensed',sans-serif;font-size:22px;font-weight:700;color:#F5F2EA;line-height:1.2;text-transform:uppercase;">${escapeHtml(scene.statLabel || scene.note)}</div>
              <div style="margin-top:10px;padding-top:10px;border-top:1px solid rgba(255,255,255,0.1);font-family:'IBM Plex Mono',monospace;font-size:12px;color:#9CA3AF;">
                TITIK KRUSIAL: ${escapeHtml(scene.box1Value || 'AREA UTAMA')}
              </div>
            </div>
          </div>

          <!-- Bottom Footer -->
          <div style="position:relative;z-index:10;display:flex;justify-content:space-between;align-items:center;">
            <div style="background:#E8402F;color:#fff;padding:3px 14px;border-radius:3px;font-family:'IBM Plex Mono',monospace;font-size:14px;font-weight:800;letter-spacing:0.1em;">
              FOKUS INVESTIGATIF
            </div>
            <span style="font-family:'IBM Plex Mono',monospace;font-size:13px;color:#9CA3AF;">SUMBER: DATA TERVERIFIKASI</span>
          </div>
        </div>
      `;
    }

    // 10. Kartun Kolase: Dynamic Paper Craft Cutout & Sketched Infographic (Sesuai Desain Skill Bang Motion)
    if (ill === "dino" || ill === "dinosaurus" || ill === "cartoon" || ill === "kartun" || theme === "kartun" || theme === "collage") {
      return `
        <div style="position:absolute;inset:0;background:transparent;overflow:hidden;padding:22px;display:flex;flex-direction:column;justify-content:space-between;">
          <!-- Header: Sticker Pills -->
          <div style="position:relative;z-index:10;display:flex;justify-content:space-between;align-items:center;">
            <span style="font-family:'Bricolage Grotesque',sans-serif;font-size:20px;letter-spacing:0.06em;background:#1F9E95;color:#fff;padding:5px 20px;border-radius:24px;font-weight:700;box-shadow:0 8px 16px rgba(31,158,149,0.3);">● ${escapeHtml(scene.diagramTitle || 'EKSPLORASI')}</span>
            <span style="font-family:'Caveat',cursive;font-size:28px;color:#D63B2F;font-weight:700;">${escapeHtml(scene.diagramBadge || 'FAKTA KUNCI')}</span>
          </div>

          <!-- Main Procedural Collage Card -->
          <div style="position:relative;z-index:5;flex:1;display:flex;align-items:center;justify-content:space-around;margin:8px 0;">
            <!-- Paper Cutout Subject Badge -->
            <div id="kartun_subject_${scene.idx}" style="position:relative;width:58%;height:92%;background:#FAF5EB;border-radius:12px;padding:16px;box-shadow:0 20px 36px rgba(34,30,27,0.28);border:2px solid #221E1B;display:flex;flex-direction:column;justify-content:space-between;transform:rotate(-2deg);">
              <!-- Selotip Transparan di Atas Kartu -->
              <div style="position:absolute;-top:12px;left:30%;width:80px;height:22px;background:rgba(255,255,255,0.7);transform:rotate(-4deg);box-shadow:0 1px 3px rgba(0,0,0,0.15);backdrop-filter:blur(2px);"></div>
              
              <!-- Topic Badge Ribbon -->
              <div style="display:flex;justify-content:space-between;align-items:center;">
                <span style="font-family:'IBM Plex Mono',monospace;font-size:13px;font-weight:700;color:#88B04B;letter-spacing:0.08em;background:rgba(136,176,75,0.15);padding:3px 10px;border-radius:4px;">DIAGRAM SUBJEK</span>
                <span style="font-family:'Caveat',cursive;font-size:22px;color:#221E1B;">✦ ${escapeHtml(scene.highlight || 'Analisis')}</span>
              </div>

              <!-- Animated Procedural SVG Blueprint/Silhouette -->
              <div style="flex:1;display:flex;align-items:center;justify-content:center;margin:6px 0;">
                <svg viewBox="0 0 400 240" style="width:100%;height:100%;overflow:visible;">
                  <!-- Concentric Organic Shape with Thick Cartoon Stroke -->
                  <circle cx="200" cy="120" r="85" fill="#FFF9E6" stroke="#221E1B" stroke-width="6"/>
                  <circle cx="200" cy="120" r="62" fill="#E8F4F2" stroke="#1F9E95" stroke-width="4" stroke-dasharray="8 6"/>
                  
                  <!-- Dynamic Center Graphic Metric & Text -->
                  <text x="200" y="112" fill="#221E1B" font-family="'Barlow Condensed',sans-serif" font-size="48" font-weight="900" text-anchor="middle">${escapeHtml(scene.statValue || '100%')}</text>
                  <text x="200" y="142" fill="#1F9E95" font-family="'IBM Plex Mono',monospace" font-size="14" font-weight="700" text-anchor="middle">${escapeHtml(scene.box1Value || 'TERIDENTIFIKASI')}</text>
                  
                  <!-- Caliper Marker Lines -->
                  <line x1="80" y1="120" x2="105" y2="120" stroke="#D63B2F" stroke-width="4" stroke-linecap="round"/>
                  <line x1="295" y1="120" x2="320" y2="120" stroke="#D63B2F" stroke-width="4" stroke-linecap="round"/>
                </svg>
              </div>

              <!-- Label Bawah Kartu -->
              <div style="font-family:'Bricolage Grotesque',sans-serif;font-size:20px;font-weight:800;color:#221E1B;line-height:1.2;text-align:center;">
                ${escapeHtml(scene.screenText || scene.note || 'Eksplorasi Fakta')}
              </div>
            </div>

            <!-- Sticky Note Catatan Samping -->
            <div id="kartun_badge_${scene.idx}" style="position:relative;width:36%;background:#FFF0C2;border:2px solid #221E1B;border-radius:8px;padding:12px;box-shadow:0 12px 24px rgba(34,30,27,0.2);transform:rotate(3deg);">
              <!-- Selotip Kecil Merah/Transparan -->
              <div style="position:absolute;-top:8px;right:20px;width:45px;height:16px;background:rgba(214,59,47,0.4);transform:rotate(8deg);"></div>
              <div style="font-family:'IBM Plex Mono',monospace;font-size:12px;color:#9CA3AF;font-weight:700;">CATATAN:</div>
              <div style="font-family:'Caveat',cursive;font-size:24px;color:#221E1B;font-weight:700;line-height:1.25;margin-top:4px;">
                ${escapeHtml(scene.note || scene.statLabel || 'Poin penting yang wajib diketahui')}
              </div>
            </div>

            <!-- Sketsa Panah Merah Melengkung -->
            <svg style="position:absolute;inset:0;width:100%;height:100%;pointer-events:none;overflow:visible;">
              <path id="kartun_arrow_${scene.idx}" d="M 640 100 Q 520 40 460 140" fill="none" stroke="#D63B2F" stroke-width="6" stroke-linecap="round"/>
            </svg>
          </div>

          <!-- Footer: Dynamic Badges & Handwriting -->
          <div style="position:relative;z-index:10;display:flex;justify-content:space-between;align-items:center;">
            <span style="font-family:'Caveat',cursive;font-size:26px;color:#221E1B;font-weight:700;">✦ ${escapeHtml(scene.box1Title || 'bukti terkonfirmasi')}</span>
            <span id="kartun_hand_${scene.idx}" style="font-family:'Caveat',cursive;font-size:28px;color:#D63B2F;font-weight:700;">${escapeHtml(scene.statLabel || 'simak penjelasannya! ✨')}</span>
          </div>
        </div>
      `;
    }

    // 11. Sketsa Vintage: Ukiran Tembaga Arsip Sejarah & Skema Paten Kuno (Sesuai Desain Skill Bang Motion)
    if (ill === "engine" || ill === "vintage" || ill === "sketsa" || ill === "mesin" || ill === "sejarah" || theme === "vintage" || theme === "sketsa") {
      return `
        <div style="position:absolute;inset:0;background:transparent;overflow:hidden;padding:24px;display:flex;flex-direction:column;justify-content:space-between;">
          <!-- Top Header: Classic Double Ruled Border -->
          <div style="position:relative;z-index:10;display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid rgba(91,70,52,0.35);padding-bottom:8px;">
            <span style="font-family:'Cinzel',serif;font-size:18px;letter-spacing:0.18em;color:#9A3B22;font-weight:700;">ARSIP PATEN &bull; ${escapeHtml(scene.diagramTitle || 'DOKUMEN HISTORIS')}</span>
            <span style="font-family:'Playfair Display',serif;font-style:italic;font-size:18px;color:#5B4634;">${escapeHtml(scene.diagramBadge || 'FIG. I')}</span>
          </div>

          <!-- Main Procedural Antique Engraving Plate -->
          <div style="position:relative;z-index:5;flex:1;display:flex;align-items:center;justify-content:center;margin:6px 0;">
            <div id="vintage_plate_${scene.idx}" style="position:relative;width:92%;height:94%;border:4px double #5B4634;border-radius:6px;padding:12px;display:flex;flex-direction:column;justify-content:space-between;background:rgba(91,70,52,0.03);">
              
              <!-- Antique Engraved Technical Astrolabe / Caliper Diagram SVG -->
              <svg viewBox="0 0 760 380" style="width:100%;height:100%;overflow:visible;mix-blend-mode:multiply;">
                <!-- Border Arsir Etching Tepi -->
                <rect x="10" y="10" width="740" height="360" fill="none" stroke="#5B4634" stroke-width="1.5" stroke-dasharray="4 4"/>
                
                <!-- Rotating Astrolabe / Caliper Mechanism Rings -->
                <g id="vintage_dial_${scene.idx}" style="transform-origin: 220px 190px;">
                  <circle cx="220" cy="190" r="130" fill="none" stroke="#2E2115" stroke-width="3"/>
                  <circle cx="220" cy="190" r="110" fill="none" stroke="#2E2115" stroke-width="1.5" stroke-dasharray="2 6"/>
                  <circle cx="220" cy="190" r="85" fill="none" stroke="#2E2115" stroke-width="2"/>
                  <!-- Crosshair Rays -->
                  <line x1="90" y1="190" x2="350" y2="190" stroke="#2E2115" stroke-width="1.5"/>
                  <line x1="220" y1="60" x2="220" y2="320" stroke="#2E2115" stroke-width="1.5"/>
                  <!-- Diagonal Ticks -->
                  <line x1="128" y1="98" x2="312" y2="282" stroke="#2E2115" stroke-width="1" stroke-dasharray="4 4"/>
                  <line x1="128" y1="282" x2="312" y2="98" stroke="#2E2115" stroke-width="1" stroke-dasharray="4 4"/>
                  <!-- Center Core -->
                  <circle cx="220" cy="190" r="14" fill="#2E2115"/>
                  <circle cx="220" cy="190" r="6" fill="#FAF5EB"/>
                </g>

                <!-- Right Side: Antique Typography & Classical Telemetry -->
                <g transform="translate(410, 80)">
                  <text x="0" y="24" fill="#9A3B22" font-family="'Cinzel',serif" font-size="20" font-weight="700" letter-spacing="2px">SYSTEMA NATURAE</text>
                  <line x1="0" y1="36" x2="300" y2="36" stroke="#5B4634" stroke-width="1.5"/>
                  <text x="0" y="80" fill="#2E2115" font-family="'Playfair Display',serif" font-size="44" font-weight="900" font-style="italic">${escapeHtml(scene.statValue || '1769')}</text>
                  <text x="0" y="110" fill="#5B4634" font-family="'Cinzel',serif" font-size="14" letter-spacing="1px">${escapeHtml(scene.box1Title || 'PARAMETER UTAMA')}</text>
                  <text x="0" y="145" fill="#2E2115" font-family="'EB Garamond',serif" font-size="22" font-style="italic">${escapeHtml(scene.screenText || scene.note)}</text>
                </g>

                <!-- Rust-Red Sketched Circle Annotation -->
                <path id="vintage_anno_${scene.idx}" d="M 400 130 C 400 70 510 50 630 65 C 720 80 730 180 640 210 C 530 240 400 200 400 130" stroke="#9A3B22" stroke-width="4" stroke-linecap="round" fill="none"/>
              </svg>
            </div>
          </div>

          <!-- Footer: Classical Archival Notes -->
          <div style="position:relative;z-index:10;display:flex;justify-content:space-between;align-items:center;">
            <span style="font-family:'Cinzel',serif;font-size:14px;color:#5B4634;letter-spacing:0.12em;">${escapeHtml(scene.box1Value || 'KLASIFIKASI HISTORIS')}</span>
            <span id="vintage_hand_${scene.idx}" style="font-family:'EB Garamond',serif;font-style:italic;font-size:24px;color:#9A3B22;">~ ${escapeHtml(scene.statLabel || 'tercatat dalam sejarah ilmu')}</span>
          </div>
        </div>
      `;
    }

    // 12. Default Sleek Concept Card
    return `
      <div style="position:absolute;inset:0;background:#0e1014;overflow:hidden;padding:32px;display:flex;flex-direction:column;justify-content:space-between;">
        <div style="position:absolute;inset:0;opacity:0.1;background-size:32px 32px;background-image:linear-gradient(to right,#fff 1px,transparent 1px),linear-gradient(to bottom,#fff 1px,transparent 1px);"></div>
        <div style="position:relative;z-index:2;display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid rgba(255,255,255,0.1);padding-bottom:12px;">
          <span style="font-family:'IBM Plex Mono',monospace;font-size:22px;letter-spacing:0.12em;color:var(--yel);font-weight:600;">● ${escapeHtml(scene.kicker)}</span>
          <span style="font-family:'IBM Plex Mono',monospace;font-size:18px;color:var(--mute);background:rgba(255,255,255,0.06);padding:4px 12px;border-radius:4px;">${escapeHtml(scene.diagramBadge)}</span>
        </div>
        <div style="position:relative;z-index:2;margin:auto 0;text-align:center;">
          <div style="font-family:'Barlow Condensed',sans-serif;font-size:48px;font-weight:800;color:#F5F2EA;line-height:1.2;text-transform:uppercase;">${escapeHtml(scene.note)}</div>
          <div style="margin-top:20px;display:inline-block;padding:8px 24px;border-radius:20px;background:rgba(255,212,0,0.1);border:1px solid rgba(255,212,0,0.3);color:#FFD400;font-family:'IBM Plex Mono',monospace;font-size:18px;font-weight:600;">EKSPLORASI SAINS & DATA</div>
        </div>
        <div style="position:relative;z-index:2;display:flex;justify-content:space-between;font-family:'IBM Plex Mono',monospace;font-size:16px;color:#9CA3AF;">
          <span>STATUS: TERVERIFIKASI</span>
          <span>BANYAKTAU STUDIO</span>
        </div>
      </div>
    `;
  }

  // Bangun Scene HTML Blocks
  const sceneHtmlBlocks = scenes.map((s) => {
    const posX = s.idx * stepX;
    const posY = s.idx * stepY;

    // Masukkan highlighter ke dalam teks
    let formattedLine = escapeHtml(s.text);
    if (s.highlight) {
      const safeHl = escapeHtml(String(s.highlight).trim());
      const isAlert = s.idx % 2 === 1;
      const hlClass = isAlert ? "hl r" : "hl";

      const escapedQuery = safeHl.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const fullRegex = new RegExp(`(${escapedQuery})`, "i");

      if (fullRegex.test(formattedLine)) {
        formattedLine = formattedLine.replace(fullRegex, `<span class="${hlClass}"><i></i>$1</span>`);
      } else {
        const words = safeHl.split(/\s+/).filter((w) => w.length >= 3);
        let replaced = false;
        for (const w of words) {
          const wRegex = new RegExp(`\\b(${w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})\\b`, "i");
          if (wRegex.test(formattedLine)) {
            formattedLine = formattedLine.replace(wRegex, `<span class="${hlClass}"><i></i>$1</span>`);
            replaced = true;
            break;
          }
        }
        if (!replaced && words.length > 0) {
          const wRegex = new RegExp(`(${words[0].replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`, "i");
          if (wRegex.test(formattedLine)) {
            formattedLine = formattedLine.replace(wRegex, `<span class="${hlClass}"><i></i>$1</span>`);
          }
        }
      }
    }

    const isInterleaved = Boolean(payload.isInterleavedClip || payload.hideNarrationText);
    if (isVertical) {
      if (isInterleaved) {
        return `
          <!-- Adegan #${s.idx + 1} (Vertikal 9:16 Interleaved Clean) -->
          <div class="ghost" id="ghost_${s.idx}" style="left:${posX + 80}px;top:${posY + 160}px">${escapeHtml(s.ghost)}</div>
          <div class="cut" id="cut_${s.idx}" style="left:${posX + 80}px;top:${posY + 320}px;width:920px;height:960px">
            ${renderCardInner(s)}
          </div>
        `;
      }
      // 9:16 Layout Standar Penuh
      return `
        <!-- Adegan #${s.idx + 1} (Vertikal 9:16) -->
        <div class="ghost" id="ghost_${s.idx}" style="left:${posX + 80}px;top:${posY + 160}px">${escapeHtml(s.ghost)}</div>
        
        <div class="cut" id="cut_${s.idx}" style="left:${posX + 90}px;top:${posY + 260}px;width:900px;height:720px">
          ${renderCardInner(s)}
        </div>

        <div class="name" id="name_${s.idx}" style="left:${posX + 90}px;top:${posY + 1020}px">${escapeHtml(s.sourceTag)}</div>
        <div class="line t" id="line_${s.idx}" style="left:${posX + 90}px;right:${posX + 90}px;top:${posY + 1100}px">${formattedLine}</div>
        <div class="hand" id="hand_${s.idx}" style="left:${posX + 90}px;top:${posY + 1580}px">✦ ${escapeHtml(s.note)}</div>
      `;
    } else {
      // 16:9 Layout
      if (isInterleaved) {
        return `
          <!-- Adegan #${s.idx + 1} (Horizontal 16:9 Clean) -->
          <div class="ghost" id="ghost_${s.idx}" style="left:${posX + 480}px;top:${posY + 80}px">${escapeHtml(s.ghost)}</div>
          <div class="cut" id="cut_${s.idx}" style="left:${posX + 260}px;top:${posY + 140}px;width:1400px;height:800px">
            ${renderCardInner(s)}
          </div>
        `;
      }
      return `
        <!-- Adegan #${s.idx + 1} (Horizontal 16:9) -->
        <div class="ghost" id="ghost_${s.idx}" style="left:${posX + 480}px;top:${posY + 100}px">${escapeHtml(s.ghost)}</div>
        
        <div class="cut" id="cut_${s.idx}" style="left:${posX + 140}px;top:${posY + 160}px;width:860px;height:620px">
          ${renderCardInner(s)}
        </div>

        <div class="name" id="name_${s.idx}" style="left:${posX + 1060}px;top:${posY + 200}px">${escapeHtml(s.sourceTag)}</div>
        <div class="line t" id="line_${s.idx}" style="left:${posX + 1060}px;width:740px;top:${posY + 280}px">${formattedLine}</div>
        <div class="hand" id="hand_${s.idx}" style="left:${posX + 1060}px;top:${posY + 720}px">✦ ${escapeHtml(s.note)}</div>
      `;
    }
  }).join("\n");

  // Bangun JS Timeline Koreografi Kamera
  let timelineJs = "";
  let currentTime = 0;

  scenes.forEach((s) => {
    const sceneCenter = isVertical 
      ? { x: 540, y: 960 + s.idx * stepY }
      : { x: 960 + s.idx * stepX, y: 540 };

    const tStart = currentTime;
    const dur = s.dur;
    const tEnd = tStart + dur;

    let extraAnim = "";
    if (s.illustration === "waveform" || s.illustration === "acoustic" || s.illustration === "sound" || s.illustration === "wave") {
      extraAnim = `
        tl.fromTo('#wave_red_${s.idx}', { strokeDasharray: 800, strokeDashoffset: 800 }, { strokeDashoffset: 0, duration: 1.2, ease: 'power2.out' }, ${tStart + 0.4});
        tl.fromTo('#wave_yel_${s.idx}', { strokeDasharray: 800, strokeDashoffset: 800 }, { strokeDashoffset: 0, duration: 1.4, ease: 'power2.out' }, ${tStart + 0.7});
      `;
    } else if (s.illustration === "shield" || s.illustration === "radar" || s.illustration === "magnetic") {
      extraAnim = `
        tl.fromTo('#shield_vec1_${s.idx}', { strokeDasharray: 400, strokeDashoffset: 400 }, { strokeDashoffset: 0, duration: 0.9, ease: 'power1.out' }, ${tStart + 0.4});
        tl.fromTo('#shield_vec2_${s.idx}', { strokeDasharray: 400, strokeDashoffset: 400 }, { strokeDashoffset: 0, duration: 1.1, ease: 'power1.out' }, ${tStart + 0.6});
        tl.fromTo('#shield_vec3_${s.idx}', { strokeDasharray: 400, strokeDashoffset: 400 }, { strokeDashoffset: 0, duration: 1.3, ease: 'power1.out' }, ${tStart + 0.8});
      `;
    } else if (s.illustration === "flowchart" || s.illustration === "process" || s.illustration === "steps") {
      extraAnim = `
        tl.fromTo('#flow_step1_${s.idx}', { opacity: 0, x: -30 }, { opacity: 1, x: 0, duration: 0.6, ease: 'power2.out' }, ${tStart + 0.4});
        tl.fromTo('#flow_step2_${s.idx}', { opacity: 0, x: -30 }, { opacity: 1, x: 0, duration: 0.6, ease: 'power2.out' }, ${tStart + 0.9});
        tl.fromTo('#flow_step3_${s.idx}', { opacity: 0, x: -30 }, { opacity: 1, x: 0, duration: 0.6, ease: 'power2.out' }, ${tStart + 1.4});
      `;
    } else if (s.illustration === "pinboard" || s.illustration === "collage" || s.illustration === "evidence") {
      extraAnim = `
        tl.fromTo('#pin_card1_${s.idx}', { opacity: 0, scale: 0.8, y: -20 }, { opacity: 1, scale: 1, y: 0, duration: 0.7, ease: 'back.out(1.4)' }, ${tStart + 0.3});
        tl.fromTo('#pin_card2_${s.idx}', { opacity: 0, scale: 0.8, y: -20 }, { opacity: 1, scale: 1, y: 0, duration: 0.7, ease: 'back.out(1.4)' }, ${tStart + 0.6});
        tl.fromTo('#pin_thread_${s.idx}', { strokeDasharray: 600, strokeDashoffset: 600 }, { strokeDashoffset: 0, duration: 1.0, ease: 'power2.out' }, ${tStart + 0.8});
        tl.fromTo('#pin_stamp_${s.idx}', { opacity: 0, scale: 2.0, rotate: -15 }, { opacity: 1, scale: 1, rotate: -6, duration: 0.5, ease: 'power4.out' }, ${tStart + 1.2});
      `;
    } else if (s.illustration === "map" || s.illustration === "route" || s.illustration === "flight" || s.illustration === "tracking") {
      extraAnim = `
        tl.fromTo('#map_origin_ping_${s.idx}', { scale: 0.5, opacity: 0.3 }, { scale: 1.8, opacity: 1, duration: 0.8, repeat: 2, yoyo: true, ease: 'sine.inOut' }, ${tStart + 0.3});
        tl.fromTo('#map_path_${s.idx}', { strokeDasharray: 700, strokeDashoffset: 700 }, { strokeDashoffset: 0, duration: 1.5, ease: 'power2.inOut' }, ${tStart + 0.5});
      `;
    } else if (s.illustration === "newspaper" || s.illustration === "document" || s.illustration === "headline" || s.illustration === "archive") {
      extraAnim = `
        tl.fromTo('#news_hl_${s.idx}', { scaleX: 0 }, { scaleX: 1, duration: 0.8, ease: 'power2.out' }, ${tStart + 0.5});
        tl.fromTo('#news_stamp_${s.idx}', { opacity: 0, scale: 2.2, rotate: -12 }, { opacity: 1, scale: 1, rotate: -4, duration: 0.5, ease: 'power4.out' }, ${tStart + 1.0});
      `;
    } else if (s.illustration === "gauge" || s.illustration === "speedometer" || s.illustration === "meter" || s.illustration === "speed") {
      extraAnim = `
        tl.fromTo('#gauge_arc_${s.idx}', { strokeDashoffset: 750 }, { strokeDashoffset: 220, duration: 1.4, ease: 'power3.out' }, ${tStart + 0.4});
        tl.fromTo('#gauge_needle_${s.idx}', { rotate: -85 }, { rotate: 55, duration: 1.5, ease: 'elastic.out(1, 0.5)' }, ${tStart + 0.5});
        tl.fromTo('#gauge_val_${s.idx}', { scale: 0.7, opacity: 0 }, { scale: 1, opacity: 1, duration: 0.7, ease: 'back.out(2)' }, ${tStart + 0.7});
      `;
    } else if (s.illustration === "callout" || s.illustration === "reticle" || s.illustration === "inspect" || s.illustration === "target") {
      extraAnim = `
        tl.fromTo('#callout_reticle_${s.idx}', { scale: 0.2, opacity: 0 }, { scale: 1, opacity: 1, duration: 0.6, ease: 'back.out(1.6)' }, ${tStart + 0.3});
        tl.fromTo('#callout_ring_${s.idx}', { scale: 0.8, opacity: 1 }, { scale: 1.8, opacity: 0, duration: 1.2, repeat: 2, ease: 'sine.out' }, ${tStart + 0.5});
        tl.fromTo('#callout_line_${s.idx}', { strokeDasharray: 400, strokeDashoffset: 400 }, { strokeDashoffset: 0, duration: 0.8, ease: 'power2.out' }, ${tStart + 0.7});
        tl.fromTo('#callout_card_${s.idx}', { opacity: 0, x: 25 }, { opacity: 1, x: 0, duration: 0.6, ease: 'power2.out' }, ${tStart + 0.9});
      `;
    } else if (s.imagePath) {
      if (theme === "kartun" || theme === "collage") {
        extraAnim = `
          tl.fromTo('#polaroid_${s.idx}', { opacity: 0, scale: 0.8, rotate: ${s.idx % 2 === 0 ? -8 : 8}, y: 35 }, { opacity: 1, scale: 1, rotate: ${s.idx % 2 === 0 ? -2 : 2}, y: 0, duration: 0.85, ease: 'back.out(1.5)' }, ${tStart + 0.3});
          tl.fromTo('#photo_arrow_${s.idx}', { strokeDasharray: 400, strokeDashoffset: 400 }, { strokeDashoffset: 0, duration: 0.8, ease: 'power2.out' }, ${tStart + 0.8});
        `;
      } else if (theme === "vintage" || theme === "sketsa") {
        extraAnim = `
          tl.fromTo('#vintage_anno_${s.idx}', { strokeDasharray: 600, strokeDashoffset: 600 }, { strokeDashoffset: 0, duration: 1.2, ease: 'power2.out' }, ${tStart + 0.5});
        `;
      } else if (theme === "poster") {
        extraAnim = `
          tl.fromTo('#poster_card_${s.idx}', { opacity: 0, scale: 0.5, rotate: -12 }, { opacity: 1, scale: 1, rotate: 0, duration: 0.6, ease: 'back.out(1.8)' }, ${tStart + 0.2});
        `;
      } else if (theme === "gradient") {
        extraAnim = `
          tl.fromTo('#gradient_portal_${s.idx}', { opacity: 0, scale: 0.75, filter: 'blur(10px)' }, { opacity: 1, scale: 1, filter: 'blur(0px)', duration: 1.1, ease: 'power2.out' }, ${tStart + 0.3});
        `;
      } else if (theme === "catalog") {
        extraAnim = `
          tl.fromTo('#catalog_card_${s.idx}', { opacity: 0, y: 30 }, { opacity: 1, y: 0, duration: 0.7, ease: 'power2.out' }, ${tStart + 0.3});
        `;
      } else if (theme === "action") {
        extraAnim = `
          tl.fromTo('#action_track_${s.idx}', { opacity: 0, x: -80 }, { opacity: 1, x: 0, duration: 0.8, ease: 'power3.out' }, ${tStart + 0.3});
        `;
      } else {
        extraAnim = `
          tl.fromTo('#callout_reticle_${s.idx}', { scale: 0.2, opacity: 0 }, { scale: 1, opacity: 1, duration: 0.6, ease: 'back.out(1.6)' }, ${tStart + 0.3});
        `;
      }
    } else if (s.illustration === "dino" || s.illustration === "dinosaurus" || s.illustration === "cartoon" || s.illustration === "kartun" || theme === "kartun" || theme === "collage") {
      extraAnim = `
        tl.fromTo('#kartun_subject_${s.idx}, #dino_obj_${s.idx}', { opacity: 0, scale: 0.8, rotate: -5 }, { opacity: 1, scale: 1, rotate: -2, duration: 0.85, ease: 'back.out(1.4)' }, ${tStart + 0.3});
        tl.fromTo('#kartun_badge_${s.idx}, #dino_volcano_${s.idx}', { opacity: 0, scale: 0.8, rotate: 6 }, { opacity: 1, scale: 1, rotate: 3, duration: 0.7, ease: 'back.out(1.6)' }, ${tStart + 0.5});
        tl.fromTo('#kartun_arrow_${s.idx}, #dino_arrow_${s.idx}', { strokeDasharray: 400, strokeDashoffset: 400 }, { strokeDashoffset: 0, duration: 0.8, ease: 'power2.out' }, ${tStart + 0.7});
        tl.fromTo('#kartun_hand_${s.idx}, #dino_hand_${s.idx}', { opacity: 0, scale: 0.8 }, { opacity: 1, scale: 1, duration: 0.5, ease: 'back.out(2)' }, ${tStart + 1.0});
        tl.to('#kartun_subject_${s.idx}', { rotate: 1.5, duration: 1.8, repeat: -1, yoyo: true, ease: 'sine.inOut' }, ${tStart + 1.1});
      `;
    } else if (s.illustration === "engine" || s.illustration === "vintage" || s.illustration === "sketsa" || s.illustration === "mesin" || s.illustration === "sejarah" || theme === "vintage" || theme === "sketsa") {
      extraAnim = `
        tl.fromTo('#vintage_plate_${s.idx}, #engine_svg_${s.idx}', { opacity: 0, y: 25 }, { opacity: 1, y: 0, duration: 0.9, ease: 'power2.out' }, ${tStart + 0.3});
        tl.fromTo('#vintage_anno_${s.idx}, #engine_anno_${s.idx}', { strokeDasharray: 600, strokeDashoffset: 600 }, { strokeDashoffset: 0, duration: 1.2, ease: 'power2.out' }, ${tStart + 0.6});
        tl.to('#vintage_dial_${s.idx}, #engine_flywheel_${s.idx}', { rotate: 360, transformOrigin: '220px 190px', duration: 16.0, repeat: -1, ease: 'none' }, ${tStart + 0.4});
        tl.fromTo('#vintage_hand_${s.idx}, #engine_hand_${s.idx}', { opacity: 0, y: 10 }, { opacity: 1, y: 0, duration: 0.6, ease: 'power2.out' }, ${tStart + 1.0});
      `;
    }

    const isInterleaved = Boolean(payload.isInterleavedClip);
    if (s.idx === 0) {
      timelineJs += `
        // Awal mula adegan 1
        tl.set(C, { x: ${sceneCenter.x}, y: ${sceneCenter.y}, z: 1.15, onUpdate: applyCam }, 0);
        tl.fromTo('#ghost_${s.idx}', { opacity: 0, y: 30 }, { opacity: 1, y: 0, duration: 1.0, ease: 'power2.out' }, ${tStart + 0.1});
        fly('#cut_${s.idx}', ${tStart + 0.2});
        ${extraAnim}
        home(${tStart + 1.2}, ${sceneCenter.x}, ${sceneCenter.y}, 1.0);
        ${isInterleaved ? "" : `say('#line_${s.idx}', ${tStart + 1.5}); label('#name_${s.idx}', ${tStart + 1.8}); label('#hand_${s.idx}', ${tStart + 2.2});`}
        breath(${tStart + 1.5}, ${tEnd - 0.6}, 1.03);
      `;
    } else {
      const prevCenter = isVertical
        ? { x: 540, y: 960 + (s.idx - 1) * stepY }
        : { x: 960 + (s.idx - 1) * stepX, y: 540 };

      timelineJs += `
        // Transisi push-through ke adegan ${s.idx + 1}
        ${isInterleaved ? "" : `unsay('#line_${s.idx - 1}', ${tStart - 0.5}); unlabel('#name_${s.idx - 1}', ${tStart - 0.4}); unlabel('#hand_${s.idx - 1}', ${tStart - 0.4});`}
        into(${tStart}, ${sceneCenter.x}, ${sceneCenter.y}, 1.4);
        settle(${tStart}, ${sceneCenter.x}, ${sceneCenter.y}, 1.2);
        tl.fromTo('#ghost_${s.idx}', { opacity: 0, y: 30 }, { opacity: 1, y: 0, duration: 1.0, ease: 'power2.out' }, ${tStart + 0.1});
        fly('#cut_${s.idx}', ${tStart + 0.2});
        ${extraAnim}
        home(${tStart + 1.1}, ${sceneCenter.x}, ${sceneCenter.y}, 0.9);
        ${isInterleaved ? "" : `say('#line_${s.idx}', ${tStart + 1.3}); label('#name_${s.idx}', ${tStart + 1.5}); label('#hand_${s.idx}', ${tStart + 1.8});`}
        breath(${tStart + 1.3}, ${tEnd - 0.6}, 1.03);
      `;
    }

    currentTime = tEnd;
  });

  timelineJs += `
    tl.to({}, { duration: 0.05 }, ${totalDuration});
  `;

  // Deteksi Tema sudah diinisialisasi di atas (theme)

  let fontLinks = `<link href="https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@600;700;800&family=IBM+Plex+Mono:wght@400;500;600&display=swap" rel="stylesheet">`;
  let cssVars = `
    --bg: #0B0B0C;
    --ink: #F5F2EA;
    --yel: #FFD400;
    --red: #E8402F;
    --mute: #9CA3AF;
    --accent: #FFD400;
  `;
  let stageFont = `"Barlow Condensed", system-ui, sans-serif`;
  let lineFont = `"Barlow Condensed", system-ui, sans-serif`;
  let nameFont = `"IBM Plex Mono", monospace`;
  let handFont = `"IBM Plex Mono", monospace`;
  let paperBg = `var(--bg)`;
  let grainCss = `opacity: 0.12; mix-blend-mode: overlay; background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='260' height='260'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.85' numOctaves='2' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='260' height='260' filter='url(%23n)'/%3E%3C/svg%3E");`;
  let cutBoxCss = `background: #18191C; border: 1px solid rgba(255,255,255,0.08); box-shadow: 0 30px 60px rgba(0,0,0,0.6);`;
  let cutOverlayCss = `content: ""; position: absolute; inset: 0; background: linear-gradient(180deg, transparent 40%, rgba(11,11,12,0.85));`;

  if (theme === "kartun" || theme === "collage") {
    fontLinks = `<link href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,700;12..96,800&family=Caveat:wght@600;700&display=swap" rel="stylesheet">`;
    cssVars = `
      --bg: #F4E9D3;
      --ink: #221E1B;
      --yel: #F26B1D;
      --red: #D63B2F;
      --mute: #6b5f52;
      --accent: #F26B1D;
      --teal: #1F9E95;
      --mustard: #F2B807;
    `;
    stageFont = `"Bricolage Grotesque", system-ui, sans-serif`;
    lineFont = `"Bricolage Grotesque", system-ui, sans-serif`;
    nameFont = `"Bricolage Grotesque", sans-serif`;
    handFont = `"Caveat", cursive`;
    paperBg = `var(--bg)`;
    grainCss = `opacity: 0.25; mix-blend-mode: multiply; background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='300' height='300'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.9' numOctaves='3' stitchTiles='stitch'/%3E%3CfeColorMatrix values='0 0 0 0 .35 0 0 0 0 .28 0 0 0 0 .2 0 0 0 .5 0'/%3E%3C/filter%3E%3Crect width='300' height='300' filter='url(%23n)'/%3E%3C/svg%3E");`;
    cutBoxCss = `background: #F4E9D3; border: 3px solid #221E1B; border-radius: 24px; box-shadow: 0 25px 45px rgba(34,30,27,0.25);`;
    cutOverlayCss = `display: none;`;
  } else if (theme === "vintage" || theme === "sketsa") {
    fontLinks = `<link href="https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,700;0,900;1,700&family=EB+Garamond:ital,wght@0,400;0,500;1,400;1,500&family=Cinzel:wght@600;700&display=swap" rel="stylesheet">`;
    cssVars = `
      --bg: #EFE4CC;
      --ink: #2E2115;
      --yel: #B8862B;
      --red: #9A3B22;
      --mute: #5B4634;
      --accent: #9A3B22;
      --rust: #9A3B22;
      --gold: #B8862B;
    `;
    stageFont = `"EB Garamond", Georgia, serif`;
    lineFont = `"Playfair Display", serif`;
    nameFont = `"Cinzel", serif`;
    handFont = `"EB Garamond", italic, serif`;
    paperBg = `var(--bg); background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='400' height='400'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.012' numOctaves='4' seed='7'/%3E%3CfeColorMatrix values='0 0 0 0 .55 0 0 0 0 .42 0 0 0 0 .25 0 0 0 .35 0'/%3E%3C/filter%3E%3Crect width='400' height='400' filter='url(%23n)'/%3E%3C/svg%3E"); background-size: 800px 800px;`;
    grainCss = `opacity: 0.35; mix-blend-mode: multiply; background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='300' height='300'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.9' numOctaves='3' stitchTiles='stitch'/%3E%3CfeColorMatrix values='0 0 0 0 .35 0 0 0 0 .28 0 0 0 0 .2 0 0 0 .5 0'/%3E%3C/filter%3E%3Crect width='300' height='300' filter='url(%23n)'/%3E%3C/svg%3E");`;
    cutBoxCss = `background: #EFE4CC; border: 2px solid #5B4634; border-radius: 12px; mix-blend-mode: multiply; box-shadow: 0 15px 30px rgba(46,33,21,0.2);`;
    cutOverlayCss = `display: none;`;
  } else if (theme === "poster") {
    fontLinks = `<link href="https://fonts.googleapis.com/css2?family=Anton&family=Barlow+Condensed:wght@700;800;900&family=IBM+Plex+Mono:wght@500;700&display=swap" rel="stylesheet">`;
    cssVars = `
      --bg: #09090b;
      --ink: #ffffff;
      --yel: #FFEB3B;
      --red: #FF0055;
      --mute: #9CA3AF;
      --accent: #FFEB3B;
    `;
    stageFont = `"Barlow Condensed", system-ui, sans-serif`;
    lineFont = `"Anton", sans-serif`;
    nameFont = `"IBM Plex Mono", monospace`;
    handFont = `"Barlow Condensed", sans-serif`;
    paperBg = `var(--bg)`;
    cutBoxCss = `background: #000; border: 4px solid #FFEB3B; box-shadow: 12px 12px 0px #FF0055; border-radius: 8px;`;
    cutOverlayCss = `display: none;`;
  } else if (theme === "gradient") {
    fontLinks = `<link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@600;700;800&family=Barlow+Condensed:wght@700;800&family=IBM+Plex+Mono:wght@500;600&display=swap" rel="stylesheet">`;
    cssVars = `
      --bg: #09090b;
      --ink: #F3F4F6;
      --yel: #38BDF8;
      --red: #818CF8;
      --mute: #9CA3AF;
      --accent: #38BDF8;
    `;
    stageFont = `"Plus Jakarta Sans", system-ui, sans-serif`;
    lineFont = `"Barlow Condensed", sans-serif`;
    nameFont = `"IBM Plex Mono", monospace`;
    handFont = `"IBM Plex Mono", monospace`;
    paperBg = `radial-gradient(circle at center, #1e1b4b 0%, #09090b 100%)`;
    cutBoxCss = `background: rgba(30,27,75,0.4); border: 2px solid rgba(56,189,248,0.4); border-radius: 18px; box-shadow: 0 0 35px rgba(56,189,248,0.25);`;
    cutOverlayCss = `display: none;`;
  } else if (theme === "catalog") {
    fontLinks = `<link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@600;700&family=Barlow+Condensed:wght@700;800&family=IBM+Plex+Mono:wght@500;700&display=swap" rel="stylesheet">`;
    cssVars = `
      --bg: #F8F9FA;
      --ink: #111827;
      --yel: #2563EB;
      --red: #DC2626;
      --mute: #6B7280;
      --accent: #2563EB;
    `;
    stageFont = `"Space Grotesk", system-ui, sans-serif`;
    lineFont = `"Barlow Condensed", sans-serif`;
    nameFont = `"IBM Plex Mono", monospace`;
    handFont = `"IBM Plex Mono", monospace`;
    paperBg = `var(--bg); background-image: linear-gradient(to right, rgba(0,0,0,0.05) 1px, transparent 1px), linear-gradient(to bottom, rgba(0,0,0,0.05) 1px, transparent 1px); background-size: 40px 40px;`;
    cutBoxCss = `background: #ffffff; border: 1px solid #E5E7EB; border-radius: 8px; box-shadow: 0 10px 25px rgba(0,0,0,0.05);`;
    cutOverlayCss = `display: none;`;
  } else if (theme === "action") {
    fontLinks = `<link href="https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@700;800;900&family=IBM+Plex+Mono:wght@500;700&display=swap" rel="stylesheet">`;
    cssVars = `
      --bg: #0C0E14;
      --ink: #F3F4F6;
      --yel: #FACC15;
      --red: #38BDF8;
      --mute: #9CA3AF;
      --accent: #38BDF8;
    `;
    stageFont = `"Barlow Condensed", system-ui, sans-serif`;
    lineFont = `"Barlow Condensed", sans-serif`;
    nameFont = `"IBM Plex Mono", monospace`;
    handFont = `"IBM Plex Mono", monospace`;
    paperBg = `var(--bg)`;
    cutBoxCss = `background: #11141E; border: 2px solid rgba(56,189,248,0.3); border-radius: 12px; box-shadow: 0 15px 35px rgba(0,0,0,0.7);`;
    cutOverlayCss = `display: none;`;
  }

  // HTML Lengkap
  const html = `<!doctype html>
<html lang="id">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escapeHtml(title)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
${fontLinks}
<style>
:root {
  ${cssVars}
}
* { box-sizing: border-box; }
html, body {
  margin: 0;
  padding: 0;
  height: 100%;
  background: #000;
  overflow: hidden;
  user-select: none;
}
#stage {
  position: absolute;
  left: 50%;
  top: 50%;
  width: ${width}px;
  height: ${height}px;
  overflow: hidden;
  background: var(--bg);
  font-family: ${stageFont};
  color: var(--ink);
  transform-origin: center center;
}
#world {
  position: absolute;
  inset: 0;
  transform-origin: 0 0;
  will-change: transform;
}
#filters {
  position: fixed;
  width: 0;
  height: 0;
  opacity: 0;
  pointer-events: none;
}
.paper {
  position: absolute;
  inset: -4000px;
  background: ${paperBg};
}
.grain {
  position: absolute;
  inset: -4000px;
  pointer-events: none;
  ${grainCss}
}
.cut {
  position: absolute;
  opacity: 0;
  overflow: hidden;
  ${cutBoxCss}
  will-change: transform, filter;
}
.cut img {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.cut::after {
  ${cutOverlayCss}
}
.ph {
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
  width: 100%;
  height: 100%;
  background: radial-gradient(circle at center, #23252b 0%, #121316 100%);
  color: var(--mute);
  font-family: "IBM Plex Mono", monospace;
  font-size: ${isVertical ? "38px" : "32px"};
  text-align: center;
  padding: 40px;
  line-height: 1.4;
}
.line {
  position: absolute;
  font-family: ${lineFont};
  font-weight: 700;
  font-size: ${isVertical ? "68px" : "56px"};
  line-height: 1.05;
  letter-spacing: -0.01em;
  color: var(--ink);
  opacity: 0;
  text-wrap: balance;
}
.w {
  display: inline-block;
  white-space: nowrap;
  margin: 0 0.08em;
  opacity: 0;
  will-change: transform, opacity;
}
.hl {
  position: relative;
  display: inline-block;
  color: #111;
  padding: 0 0.14em;
  margin-left: -0.06em;
  font-weight: 800;
}
.hl i {
  position: absolute;
  left: 0;
  right: 0;
  top: 0.06em;
  bottom: 0.04em;
  background: var(--yel);
  transform: scaleX(0);
  transform-origin: 0 50%;
  z-index: -1;
  border-radius: 4px;
}
.hl.r { color: var(--ink); }
.hl.r i { background: var(--red); }
.name {
  position: absolute;
  font-family: ${nameFont};
  font-size: ${isVertical ? "26px" : "24px"};
  letter-spacing: 0.14em;
  color: var(--ink);
  padding: 8px 16px;
  background: rgba(11,11,12,0.85);
  border-left: 5px solid var(--yel);
  border-radius: 4px;
  opacity: 0;
  white-space: nowrap;
}
.hand {
  position: absolute;
  font-family: ${handFont};
  font-weight: 700;
  font-size: ${isVertical ? "38px" : "34px"};
  letter-spacing: 0.04em;
  color: var(--yel);
  opacity: 0;
  white-space: nowrap;
}
.ghost {
  position: absolute;
  font-weight: 800;
  font-size: ${isVertical ? "320px" : "360px"};
  line-height: 0.85;
  letter-spacing: -0.02em;
  color: transparent;
  -webkit-text-stroke: 3px rgba(245,242,234,0.12);
  white-space: nowrap;
  opacity: 0;
  pointer-events: none;
}
.vig {
  position: absolute;
  inset: 0;
  pointer-events: none;
  background: radial-gradient(80% 70% at 50% 50%, transparent 45%, rgba(0,0,0,0.65) 100%);
}
#dbg {
  position: fixed;
  left: 50%;
  bottom: 24px;
  transform: translateX(-50%);
  display: none;
  gap: 12px;
  align-items: center;
  padding: 10px 18px;
  border-radius: 12px;
  background: rgba(14,16,22,0.92);
  color: #cfd5e3;
  font: 13px system-ui;
  z-index: 99;
}
#dbg input { width: 320px; }
#dbg span { font-variant-numeric: tabular-nums; min-width: 6ch; }
</style>
</head>
<body>
<svg id="filters"><defs></defs></svg>
<div id="stage">
  <div id="world">
    <div class="paper"></div>
    <div class="grain"></div>
    ${sceneHtmlBlocks}
  </div>
  <div class="vig"></div>
  <div id="dbg">
    <button id="dPlay">Pause</button>
    <input id="dScrub" type="range" min="0" max="1000" value="0">
    <span id="dClock">0.00s</span>
  </div>
</div>
<audio id="vo" src="${escapeHtml(payload.voiceoverPath || "")}" preload="auto"></audio>

${localGsapCode ? `<script>${localGsapCode}</script>` : `<script src="https://cdnjs.cloudflare.com/ajax/libs/gsap/3.12.5/gsap.min.js"></script>`}
<script>
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const W = ${width}, H = ${height}, DUR = ${totalDuration};

function fit() {
  const s = Math.min(innerWidth / W, innerHeight / H);
  $('#stage').style.transform = \`translate(-50%, -50%) scale(\${s})\`;
}
addEventListener('resize', fit);
fit();

/* Directional motion blur via SVG feGaussianBlur */
const defs = $('#filters defs');
let fc = 0;
function makeBlur() {
  const id = 'mb' + (fc++);
  const NS = 'http://www.w3.org/2000/svg';
  const f = document.createElementNS(NS, 'filter');
  f.id = id;
  f.setAttribute('x', '-70%');
  f.setAttribute('y', '-70%');
  f.setAttribute('width', '240%');
  f.setAttribute('height', '240%');
  const g = document.createElementNS(NS, 'feGaussianBlur');
  g.setAttribute('stdDeviation', '0 0');
  f.appendChild(g);
  defs.appendChild(f);
  return { url: \`url(#\${id})\`, node: g };
}
function blurTween(tl, targets, at, from, to, dur, { ease = 'power3.out', ax = 1, ay = 0.08 } = {}) {
  const b = makeBlur(), o = { v: from };
  tl.set(targets, { filter: b.url }, at);
  tl.to(o, {
    v: to,
    duration: dur,
    ease,
    onUpdate() {
      b.node.setAttribute('stdDeviation', \`\${(o.v * ax).toFixed(2)} \${(o.v * ay).toFixed(2)}\`);
    }
  }, at);
  tl.set(targets, { filter: 'none' }, at + dur);
}
const VERT = { ax: 0.1, ay: 1 }, HORZ = { ax: 1, ay: 0.1 };

/* Split lines into individual word spans */
$$('.line').forEach(el => {
  const out = [];
  el.childNodes.forEach(n => {
    if (n.nodeType === 3) {
      n.textContent.split(/\\s+/).filter(Boolean).forEach(w => {
        const s = document.createElement('span');
        s.className = 'w';
        s.textContent = w;
        out.push(s);
      });
    } else {
      const s = document.createElement('span');
      s.className = 'w';
      s.appendChild(n.cloneNode(true));
      out.push(s);
    }
  });
  el.textContent = '';
  out.forEach(s => el.appendChild(s));
});

const tl = gsap.timeline({ paused: true });
const rig = $('#world');
const words = el => $$('.w', el);

const say = (sel, at, { dur = 0.5, st = 0.06 } = {}) => {
  const el = $(sel);
  if (!el) return;
  const ws = words(el);
  tl.set(el, { opacity: 1 }, at);
  tl.fromTo(ws, { opacity: 0, yPercent: 60, scaleY: 1.2 }, { opacity: 1, yPercent: 0, scaleY: 1, duration: dur, ease: 'power4.out', stagger: st, immediateRender: false }, at);
  blurTween(tl, el, at, 18, 0, dur + st * ws.length, VERT);
  $$('.hl i', el).forEach((h, i) => tl.fromTo(h, { scaleX: 0 }, { scaleX: 1, duration: 0.4, ease: 'power3.out', immediateRender: false }, at + st * ws.length + 0.15 + i * 0.15));
};

const unsay = (sel, at, { dur = 0.25 } = {}) => {
  const el = $(sel);
  if (!el) return;
  const ws = words(el);
  tl.to(ws, { opacity: 0, yPercent: -40, duration: dur, ease: 'power2.in', stagger: 0.02 }, at);
  blurTween(tl, el, at, 0, 24, dur + 0.1, { ease: 'power2.in', ...VERT });
  tl.set(el, { opacity: 0 }, at + dur + 0.1);
};

const fly = (sel, at, { from = { x: 0, y: 50, rotate: 0, scale: 1.04 }, dur = 0.8, float = true } = {}) => {
  const el = $(sel);
  if (!el) return;
  tl.fromTo(el, { opacity: 0, ...from }, { opacity: 1, x: 0, y: 0, rotate: 0, scale: 1, duration: dur, ease: 'power4.out', immediateRender: false }, at);
  blurTween(tl, el, at, 28, 0, dur * 0.7, Math.abs(from.x || 0) > Math.abs(from.y || 0) ? HORZ : VERT);
  if (float) tl.to(el, { y: -16, rotate: 1.2, scale: 1.02, duration: 1.6, ease: 'sine.inOut', yoyo: true, repeat: -1 }, at + dur);
};

const label = (sel, at) => {
  const el = $(sel);
  if (el) tl.fromTo(el, { opacity: 0, y: 14 }, { opacity: 1, y: 0, duration: 0.35, ease: 'power3.out', immediateRender: false }, at);
};

const unlabel = (sel, at) => {
  const el = $(sel);
  if (el) tl.to(el, { opacity: 0, duration: 0.2 }, at);
};

/* Kamera: Rig #world */
const C = { x: ${width / 2}, y: ${height / 2}, z: 1 };
function applyCam() {
  rig.style.transform = \`translate(\${${width / 2} - C.x * C.z}px, \${${height / 2} - C.y * C.z}px) scale(\${C.z})\`;
}
const look = (at, x, y, z, dur = 1.4) => tl.to(C, { x, y, z, duration: dur, ease: 'sine.inOut', onUpdate: applyCam }, at);
const home = (at, x = ${width / 2}, y = ${height / 2}, dur = 1.0) => look(at, x, y, 1, dur);
const into = (cutAt, x, y, z) => tl.to(C, { x, y, z, duration: 0.8, ease: 'power2.in', onUpdate: applyCam }, cutAt - 0.8);
const settle = (cutAt, x, y, z) => tl.to(C, { x, y, z: z * 0.95, duration: 1.0, ease: 'power3.out', onUpdate: applyCam }, cutAt);
const breath = (a, b, z) => tl.to(C, { z, duration: Math.max(0.2, b - a), ease: 'sine.inOut', onUpdate: applyCam }, a);

/* Eksekusi Koreografi */
${timelineJs}

/* Kontrol Review & Puppeteer Export */
const q = new URLSearchParams(location.search);
const vo = $('#vo');
const hasVO = !!vo.getAttribute('src');
let audioOn = false;

function start() {
  tl.play(0);
  if (hasVO) {
    vo.currentTime = 0;
    vo.play().then(() => audioOn = true).catch(() => {});
  }
}
tl.eventCallback('onComplete', () => start());

window.OPENER = {
  W, H,
  DURATION: DUR,
  tl,
  ready: false,
  seek(t) {
    tl.pause(t, false);
    applyCam();
    if (gsap.ticker && gsap.ticker.tick) gsap.ticker.tick();
  },
  play: start
};

addEventListener('keydown', e => {
  if (/^[rR]$/.test(e.key)) start();
  if (e.code === 'Space') {
    e.preventDefault();
    tl.paused() ? tl.play() : tl.pause();
  }
});

if (q.has('debug')) {
  const dbg = $('#dbg');
  dbg.style.display = 'flex';
  const sc = $('#dScrub'), ck = $('#dClock');
  let drag = false;
  gsap.ticker.add(() => {
    if (!drag) sc.value = String(tl.time() / DUR * 1000);
    ck.textContent = tl.time().toFixed(2) + 's';
    $('#dPlay').textContent = tl.paused() ? 'Play' : 'Pause';
  });
  sc.addEventListener('pointerdown', () => { drag = true; tl.pause(); });
  addEventListener('pointerup', () => drag = false);
  sc.addEventListener('input', () => { tl.pause(); tl.time(sc.value / 1000 * DUR); });
  $('#dPlay').onclick = () => tl.paused() ? tl.play() : tl.pause();
}

document.fonts.ready.then(() => {
  applyCam();
  window.OPENER.ready = true;
  if (q.has('clean')) return;
  start();
});
</script>
</body>
</html>`;

  return { html, width, height, durationSec: totalDuration };
}

/**
 * Merender berkas HTML Bang Motion ke video MP4 menggunakan Puppeteer headless + FFmpeg.
 */
export async function renderMotionVideo({
  htmlContent,
  htmlPath = null,
  audioPath = null,
  outputPath,
  width = 1080,
  height = 1920,
  fps = 30,
  crf = "20",
  onProgress = null
}) {
  const workId = createId("motion_render");
  const workDir = path.resolve(paths.workDir || path.resolve("generated/work"), workId);
  const framesDir = path.join(workDir, "frames");
  
  await fs.mkdir(framesDir, { recursive: true });

  // Tulis HTML ke berkas kerja jika belum berupa path
  let targetHtmlPath = htmlPath;
  if (!targetHtmlPath) {
    targetHtmlPath = path.join(workDir, "index.html");
    await fs.writeFile(targetHtmlPath, htmlContent, "utf-8");
  }

  // Siapkan file URL
  const fileUrl = new URL(`file:///${targetHtmlPath.replace(/\\/g, "/")}?clean=1`).href;

  const browser = await puppeteer.launch({
    headless: "new",
    args: [
      "--enable-gpu",
      "--use-gl=angle",
      "--enable-webgl",
      "--ignore-gpu-blocklist",
      "--allow-file-access-from-files",
      "--disable-web-security",
      "--no-sandbox",
      "--disable-setuid-sandbox"
    ]
  });

  try {
    const page = await browser.newPage();
    await page.setViewport({ width, height, deviceScaleFactor: 1 });
    await page.goto(fileUrl, { waitUntil: "networkidle0", timeout: 60000 });

    // Tunggu timeline siap dan font terload
    await page.waitForFunction("window.OPENER && window.OPENER.ready", { timeout: 60000 });
    await page.evaluate(() => document.fonts.ready);
    await page.evaluate(() => { window.OPENER.tl.pause(0); });

    const duration = await page.evaluate(() => window.OPENER.DURATION);
    const totalFrames = Math.max(1, Math.ceil(duration * fps));

    // Render frame demi frame
    for (let i = 0; i < totalFrames; i++) {
      const t = i / fps;

      await page.evaluate(async (time) => {
        (window.OPENER.seek || window.OPENER.tl.time.bind(window.OPENER.tl))(time);
        await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      }, t);

      const frameFile = path.join(framesDir, `f${String(i).padStart(5, "0")}.png`);
      await page.screenshot({
        path: frameFile,
        clip: { x: 0, y: 0, width, height },
        type: "png"
      });

      if (typeof onProgress === "function" && i % 15 === 0) {
        onProgress(i + 1, totalFrames);
      }
    }

    await browser.close();

    // Pastikan output directory ada
    await fs.mkdir(path.dirname(outputPath), { recursive: true });

    // Gabungkan urutan frame PNG + audio ke MP4 via FFmpeg
    const encodingArgs = getEncoderArgs(crf);
    const ffmpegArgs = [
      "-y",
      "-framerate", String(fps),
      "-i", path.join(framesDir, "f%05d.png")
    ];

    if (audioPath) {
      ffmpegArgs.push("-i", audioPath);
      ffmpegArgs.push(...encodingArgs);
      ffmpegArgs.push("-c:a", "aac", "-b:a", "192k", "-shortest");
    } else {
      ffmpegArgs.push("-f", "lavfi", "-i", "anullsrc=channel_layout=stereo:sample_rate=44100");
      ffmpegArgs.push(...encodingArgs);
      ffmpegArgs.push("-c:a", "aac", "-t", String(duration));
    }

    ffmpegArgs.push(outputPath);

    await new Promise((resolve, reject) => {
      const proc = spawn("ffmpeg", ffmpegArgs, { stdio: ["ignore", "pipe", "pipe"] });
      let stderr = "";
      proc.stderr.on("data", (d) => { stderr += d.toString(); });
      proc.on("close", (code) => {
        if (code === 0) resolve();
        else reject(new Error(`FFmpeg motion render gagal (code ${code}): ${stderr.slice(-300)}`));
      });
      proc.on("error", reject);
    });

    // Bersihkan frame sementara
    await fs.rm(workDir, { recursive: true, force: true }).catch(() => {});

    return {
      outputPath,
      width,
      height,
      durationSec: duration,
      fps
    };
  } catch (err) {
    await browser.close().catch(() => {});
    await fs.rm(workDir, { recursive: true, force: true }).catch(() => {});
    throw err;
  }
}

/**
 * Otomatis mendeteksi metadata diagram dari teks narasi / scene
 */
export function inferDiagramMeta(s = {}, topic = "") {
  const text = `${s.kicker || ""} ${s.text || ""} ${s.narration || ""} ${s.screenText || ""} ${s.note || ""}`;
  const lower = text.toLowerCase();

  // 1. Deteksi angka / statistik
  const numMatch = text.match(/(\d+([.,]\d+)?\s*(%|persen|km|kg|tahun|miliar|juta|derajat|db|m|kali|x)?)/i);
  const statVal = s.statValue || (numMatch ? numMatch[1].toUpperCase() : "100%");

  // 2. Deteksi jenis ilustrasi
  let illustration = s.illustration || "";
  if (!illustration) {
    if (/(gelombang|frekuensi|suara|akustik|getaran|sinyal|bunyi|spektrum|decibel|db|aliran|turbulensi)/i.test(lower)) {
      illustration = "waveform";
    } else if (/(peta|rute|jalur|pesawat|terbang|penerbangan|navigasi|koordinat|radar|lokasi|lintasan|samudera|benua|ekspedisi)/i.test(lower)) {
      illustration = "map";
    } else if (/(koran|surat kabar|berita|headline|dokumen|arsip|artikel|publikasi|catatan|laporan)/i.test(lower)) {
      illustration = "newspaper";
    } else if (/(bukti|investigasi|kasus|tragedi|misteri|hilang|jejak|tersangka|saksi|koleksi|fakta|pinboard|kolase)/i.test(lower)) {
      illustration = "pinboard";
    } else if (/(perisai|magnet|medan|radiasi|sabuk|lapisan|atmosfer|inti|ruang|angkasa|defleksi|orbit|gravitasi)/i.test(lower)) {
      illustration = "shield";
    } else if (/(proses|tahap|langkah|alur|siklus|fase|cara kerja|tahapan|mekanisme)/i.test(lower)) {
      illustration = "flowchart";
    } else if (/(kecepatan|speed|km\/h|km\/jam|rpm|gauge|akselerasi|laju|jarum|meteran|derajat|suhu|panas|dingin|skala)/i.test(lower)) {
      illustration = "gauge";
    } else if (/(target|fokus|callout|inspeksi|koordinat|zona|titik|lokasi kunci|area krusial|pusat perhatian|reticle)/i.test(lower)) {
      illustration = "callout";
    } else if (/(dino|dinosaurus|purba|fosil|t-rex|stegosaurus|cretaceous|jurassic|triassic|kepunahan|hewan purba|komet|meteorit|reptil raksasa)/i.test(lower)) {
      illustration = "dino";
    } else if (/(watt|uap|mesin uap|revolusi industri|sejarah|abad ke|tahun 1[5-9]\d\d|penemuan kuno|manuskrip|arsip kuno|sketsa vintage|sketsa)/i.test(lower)) {
      illustration = "engine";
    } else if (/(persen|statistik|data|angka|jumlah|persentase|efisiensi|populasi|\d+%)/i.test(lower)) {
      illustration = "stats";
    } else {
      illustration = "concept";
    }
  }

  const cleanKicker = String(s.kicker || s.screenText || "").replace(/^[●✦#\d\s.-]+/g, "").trim();
  const title = s.diagramTitle || (cleanKicker ? `● ${cleanKicker.toUpperCase()}` : "● ANALISIS FAKTA");
  const badge = s.diagramBadge || (topic ? String(topic).slice(0, 24).toUpperCase() : "BANYAKTAU");

  const hlUpper = s.highlight ? String(s.highlight).toUpperCase() : "";

  return {
    illustration,
    diagramTitle: title,
    diagramBadge: badge,
    statValue: statVal,
    statLabel: s.statLabel || s.note || cleanKicker || "Indikator Utama",
    track1Label: s.track1Label || (hlUpper ? `FAKTA: ${hlUpper}` : illustration === "map" ? "TITIK ASAL / RADAR" : illustration === "waveform" ? "KONDISI FLUKTUASI" : illustration === "pinboard" ? "TEMUAN UTAMA" : "PARAMETER UTAMA"),
    track2Label: s.track2Label || (cleanKicker ? `${cleanKicker.toUpperCase()}` : illustration === "map" ? "LOKASI TUJUAN" : illustration === "waveform" ? "KONDISI STABIL" : "HASIL ANALISIS"),
    box1Title: s.box1Title || (s.highlight ? `✦ ${s.highlight}` : "STATUS FAKTA"),
    box1Value: s.box1Value || statVal || "TERKONFIRMASI",
    box2Title: s.box2Title || "KOMPARASI BUKTI",
    box2Value: s.box2Value || "TERVERIFIKASI",
    step1: s.step1 || "1. FENOMENA AWAL",
    step2: s.step2 || "2. PROSES REAKSI",
    step3: s.step3 || "3. DAMPAK TERIKAT"
  };
}

/**
 * Otomatis mendeteksi tema visual Bang Motion dari analisis skrip, topik, dan kategori video
 * Mendukung: 'auto', 'kartun', 'vintage', 'jurnalisme', 'gradient', 'action', 'catalog', 'poster'
 */
export function inferMotionTheme(s = {}, item = {}) {
  // 1. Jika ada pilihan tema eksplisit dari user selain "auto", utamakan pilihan user
  const explicit = String(item.input?.motionTheme || item.motionTheme || s?.motionTheme || "").toLowerCase().trim();
  if (explicit && explicit !== "auto") {
    return explicit;
  }

  // 2. Pemetaan Berdasarkan Kategori Spesifik (Prioritas Tinggi jika cocok persis)
  const cat = String(item.input?.category || item.category || "").toLowerCase().trim();
  if (cat === "hewan") return "kartun";
  if (cat === "alam semesta") return "gradient";
  if (cat === "benda sehari-hari") return "catalog";
  if (cat === "sejarah") return "vintage";

  // 3. Analisis Skrip Lengkap & Metadata Video secara Cerdas (AI Script-Aware Classifier)
  const allScenes = item.plan?.scenes || [];
  const sceneTexts = allScenes.map(sc => `${sc.narration || ""} ${sc.screenText || ""} ${sc.highlight || ""}`).join(" ");
  const text = `${item.title || ""} ${item.topic || ""} ${item.input?.topic || ""} ${cat} ${item.input?.tone || ""} ${s?.kicker || ""} ${s?.text || ""} ${s?.narration || ""} ${s?.screenText || ""} ${s?.note || ""} ${s?.illustration || ""} ${sceneTexts}`.toLowerCase();

  // A. Hewan, Biologi, Serangga, Lucu, Anak-anak, Flora & Fauna -> Kartun Kolase
  if (/(dino|dinosaurus|kartun|anak|cartoon|hewan|binatang|serangga|organisme|biologi|flora|fauna|ikan|burung|semut|lebah|kucing|anjing|mamalia|reptil|tumbuhan|sel tubuh|\bdna\b|bakteri|virus)/i.test(text)) {
    return "kartun";
  }

  // B. Benda Sehari-hari, Manufaktur, Anatomi Objek, Material, Spesifikasi -> White Catalog
  if (/(benda sehari-hari|material|pabrik|manufaktur|anatomi benda|spesifikasi|helm|kacamata|sendok|koper|sepatu|produk|katalog|bahan baku|logam|plastik|kaca|baja|peralatan)/i.test(text)) {
    return "catalog";
  }

  // C. Kosmik, Fisika Kuat, Deep Tech, AI, Alam Semesta -> Grainy Gradient
  if (/(alam semesta|luar angkasa|bintang|galaksi|black hole|lubang hitam|kosmik|quantum|kuantum|partikel|\batom\b|kecerdasan buatan|futuristik|deep tech|astro|planet|tata surya|gravitasi|relativitas)/i.test(text)) {
    return "gradient";
  }

  // D. Sejarah, Arkeologi, Abad Kuno, Penemuan Sejarah, Manuskrip -> Sketsa Vintage
  if (/(vintage|sketsa|sejarah|abad ke|tahun 1[5-9]\d\d|tahun [1-9]\d\d sm|revolusi industri|arsip kuno|manuskrip|penemu kuno|kuno|arkeologi|arsitektur kuno|piramida|paten|filsafat|mitologi|romawi|yunani|candi|prasasti|kerajaan)/i.test(text)) {
    return "vintage";
  }

  // E. Kecepatan, Transportasi, Rute, Pelayaran, Kereta Cepat, Balapan -> Continuous Action
  if (/(kecepatan|speed|km\/h|km\/jam|kereta cepat|pesawat|jalur|rute|pelayaran|migrasi|sirkuit|balap|akselerasi|transportasi|perjalanan|ekspedisi|lintasan|menembus kecepatan)/i.test(text)) {
    return "action";
  }

  // F. Provokatif, Hook Menghentak, Angka Gila, Rekor Ekstrem -> Poster Color-Block
  if (/(rekor|angka gila|fakta mengejutkan|jangan pernah|kamu salah|rahasia besar|viral|kontroversial|provokatif|terlarang|terbesar di dunia|mustahil)/i.test(text)) {
    return "poster";
  }

  // G. Default: Visual Journalism / Vox (Investigasi, Fakta Aktual, Berita & Data)
  return "jurnalisme";
}

/**
 * Render 1 klip scene motion graphic berdurasi pas untuk pipeline selang-seling (interleaved)
 */
export async function renderMotionSceneClip({ item, scene, durationSec, format = "vertical" }) {
  const isVertical = format === "vertical";
  const width = isVertical ? 1080 : 1920;
  const height = isVertical ? 1920 : 1080;
  const dur = Number(durationSec || scene.durationSec || 6.0);

  const meta = inferDiagramMeta(scene, item.title || item.input?.topic);
  const theme = item.input?.motionTheme || inferMotionTheme(scene, item);

  // Ambil gambar AI yang baru dibuat khusus untuk topik & scene ini
  const imageAsset = item.assets?.images?.find(i => Number(i.sceneIndex) === Number(scene.index));
  const imagePath = scene.imagePath || imageAsset?.path || null;

  const motionScene = {
    index: scene.index,
    idx: 0,
    imagePath,
    text: scene.narration || scene.screenText || "",
    kicker: scene.screenText || `POIN #${scene.index}`,
    highlight: scene.highlight || "",
    sourceTag: item.title?.slice(0, 30) || "BANYAKTAU",
    note: scene.screenText || "Fakta Penting",
    ghost: String(scene.index).padStart(2, "0"),
    durationSec: dur,
    illustration: meta.illustration,
    diagramTitle: meta.diagramTitle,
    diagramBadge: meta.diagramBadge,
    statValue: meta.statValue,
    statLabel: meta.statLabel,
    track1Label: meta.track1Label,
    track2Label: meta.track2Label,
    box1Title: meta.box1Title,
    box1Value: meta.box1Value,
    box2Title: meta.box2Title,
    box2Value: meta.box2Value,
    step1: meta.step1,
    step2: meta.step2,
    step3: meta.step3
  };

  const { html } = generateMotionHtml({
    title: scene.screenText || item.title,
    format,
    theme,
    totalDurationSec: dur,
    scenes: [motionScene],
    isInterleavedClip: true
  });

  const clipsDir = paths.clipDir || paths.clipsDir || path.join(paths.rootDir, "generated", "clips");
  await fs.mkdir(clipsDir, { recursive: true });
  const outputPath = path.join(clipsDir, `${item.id}-scene-${scene.index}-motion.mp4`);

  await renderMotionVideo({
    htmlContent: html,
    outputPath,
    width,
    height,
    fps: 30
  });

  return {
    sceneIndex: scene.index,
    path: outputPath,
    filename: path.basename(outputPath),
    provider: "bang-motion",
    seconds: dur,
    costUsd: 0,
    illustration: meta.illustration
  };
}

