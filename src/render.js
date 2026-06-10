import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { config, paths } from "./config.js";
import { clamp, safeFilename, splitLines } from "./util.js";
import { saveItem } from "./storage.js";
import { setProgress, resetProgress } from "./progress.js";

const fps = 30;
const introDuration = 3.0;
const outroDuration = 1.5;
const outroSummaryMaxChars = 36;
const outroSummaryMaxLines = 5;

function getVideoEncodingArgs(customCrf = "22") {
  const encoder = config.render?.ffmpegEncoder || "libx264";
  if (encoder === "h264_nvenc") {
    const cq = customCrf || "22";
    return [
      "-c:v", "h264_nvenc",
      "-preset", "p4",
      "-cq", cq,
      "-pix_fmt", "yuv420p"
    ];
  }
  return [
    "-c:v", "libx264",
    "-preset", "veryfast",
    "-crf", customCrf || "22",
    "-pix_fmt", "yuv420p"
  ];
}

function getAvatarParams(avatarMode) {
  let chromaColor = "0x07f506";
  let chromaSim = "0.12";
  let chromaBlend = "0.2";
  let avatarCrop = "";

  const modeLower = String(avatarMode || "").toLowerCase();
  const isCircleCrop = modeLower.includes("circle") || 
                       modeLower.includes("lingkaran") || 
                       modeLower.includes("frame") || 
                       modeLower.includes("black") || 
                       modeLower.includes("hitam");

  if (avatarMode === "video1") {
    chromaColor = "0x556a73";
    chromaSim = "0.18";
    chromaBlend = "0.1";
    avatarCrop = "crop=1080:1080,";
  } else if (avatarMode === "video2") {
    chromaColor = "0x426684";
    chromaSim = "0.18";
    chromaBlend = "0.1";
    avatarCrop = "crop=1080:1080,";
  } else if (modeLower.includes("hijau") || modeLower.includes("green")) {
    chromaColor = "0x1d6e25";
    chromaSim = "0.15";
    chromaBlend = "0.15";
    avatarCrop = "crop=1260:1080:0:0,";
  } else if (isCircleCrop) {
    avatarCrop = "crop=min(iw\\,ih):min(iw\\,ih),";
  } else {
    avatarCrop = "crop=min(iw\\,ih):min(iw\\,ih),";
  }

  return { chromaColor, chromaSim, chromaBlend, avatarCrop, isCircleCrop };
}

function getAvatarFilterComplex({ inputLabel, size, duration, chromaColor, chromaSim, chromaBlend, avatarCrop, rotateAngle = 5, isCircleCrop = false }) {
  const durStr = Number(duration || 4).toFixed(2);
  const rot = rotateAngle;
  if (isCircleCrop) {
    return [
      `${inputLabel}${avatarCrop}scale=${size}:${size},format=rgba,geq=r='if(gt((X-${size/2})*(X-${size/2})+(Y-${size/2})*(Y-${size/2}),${(size/2 - 5)*(size/2 - 5)}),255,r(X,Y))':g='if(gt((X-${size/2})*(X-${size/2})+(Y-${size/2})*(Y-${size/2}),${(size/2 - 5)*(size/2 - 5)}),255,g(X,Y))':b='if(gt((X-${size/2})*(X-${size/2})+(Y-${size/2})*(Y-${size/2}),${(size/2 - 5)*(size/2 - 5)}),255,b(X,Y))':a='if(gt((X-${size/2})*(X-${size/2})+(Y-${size/2})*(Y-${size/2}),${(size/2)*(size/2)}),0,255)',rotate='${rot}*sin(4.5*t)*PI/180:c=none:ow=rotw(${rot}*PI/180):oh=roth(${rot}*PI/180)'[av]`
    ].join(";");
  }

  const dilationCount = size >= 360 ? 5 : 3;
  const borderDilations = Array.from({ length: dilationCount }, () => "dilation").join(",");
  const glowDilations = Array.from({ length: Math.round(dilationCount * 0.6) }, () => "dilation").join(",");
  const shadowBlur = size >= 360 ? 15 : 9;
  const glowBlur = size >= 360 ? 8 : 5;
  const shadowOffset = size >= 360 ? 6 : 3;

  return [
    `${inputLabel}${avatarCrop}chromakey=${chromaColor}:${chromaSim}:${chromaBlend},scale=-1:${size},format=rgba[av_raw]`,
    `[av_raw]split=7[av_main][av_border_1][av_border_2][av_glow_1][av_glow_2][av_shadow_1][av_shadow_2]`,
    `[av_border_1]alphaextract,${borderDilations}[border_alpha]`,
    `[av_border_2]geq=r=255:g=255:b=255:a=255[white_solid]`,
    `[white_solid][border_alpha]alphamerge[white_outline]`,
    `[av_shadow_1]alphaextract,boxblur=${shadowBlur}[shadow_alpha_blurred]`,
    `[av_shadow_2]geq=r=0:g=0:b=0:a=255[black_solid]`,
    `[black_solid][shadow_alpha_blurred]alphamerge,colorchannelmixer=aa=0.30[black_shadow]`,
    `[av_glow_1]alphaextract,${glowDilations},boxblur=${glowBlur}[glow_alpha_blurred]`,
    `[av_glow_2]geq=r=255:g=215:b=0:a=255[gold_solid]`,
    `[gold_solid][glow_alpha_blurred]alphamerge,colorchannelmixer=aa=0.20[glow_final]`,
    `[glow_final][black_shadow]overlay=x=0:y=${shadowOffset}[shadow_glow]`,
    `[shadow_glow][white_outline]overlay=x=0:y=0[bg_with_outline]`,
    `[bg_with_outline][av_main]overlay=x=0:y=0[av_pre_rot]`,
    `[av_pre_rot]rotate='${rot}*sin(4.5*t)*PI/180:c=none:ow=rotw(${rot}*PI/180):oh=roth(${rot}*PI/180)'[av]`
  ].join(";");
}


export async function renderKnowledgeVideo(item) {
  const workDir = path.join(paths.workDir, item.id);
  await fs.mkdir(workDir, { recursive: true });
  await fs.mkdir(paths.videoDir, { recursive: true });

  item.status = "rendering";
  item.progress = { percent: 5, stage: "starting", message: "Memulai rendering video..." };
  await saveItem(item);
  setProgress({ active: true, itemId: item.id, percent: 5, stage: "starting", message: "Memulai rendering video..." });

  await ensureSfxAssets();

  const narrationDuration = item.assets?.audio?.path ? await probeDuration(item.assets.audio.path) : 0;
  const timing = buildTiming(item, narrationDuration);
  const renderScenes = buildRenderScenes(item, timing.contentDuration);
  const allScenes = [buildIntroScene(item, renderScenes[0]), ...renderScenes, buildOutroScene(item, renderScenes.at(-1))];

  const format = item.input?.videoFormat || "vertical";
  const concurrencyLimit = config.render.concurrencyLimit || 3;
  const segmentPaths = new Array(allScenes.length);

  const avatarMode = item.input?.avatarMode || "image";
  let avatarVideo = "";
  if (avatarMode !== "image") {
    let avatarFilename = avatarMode;
    if (avatarMode === "video1") {
      avatarFilename = "avatar video 1.mp4";
    } else if (avatarMode === "video2") {
      avatarFilename = "avatar video 2.mp4";
    }
    avatarVideo = path.join(paths.rootDir, "assets", "avatar", avatarFilename);
  }

  let completedSegments = 0;

  const renderSegment = async (index) => {
    const scene = allScenes[index];
    const media = resolveSceneMedia(item, scene);
    const segmentPath = path.join(workDir, `segment-${String(index).padStart(2, "0")}.mp4`);
    const poses = getSceneAvatarPoses(scene, index, allScenes.length);

    // Tampilkan hanya di opening (intro), momen fakta penting (index 1 & tengah), dan closing (outro).
    const isIntro = scene.kind === "intro";
    const isOutro = scene.kind === "outro";
    const isMiddle = index === Math.floor(allScenes.length / 2);
    const isFirstContent = index === 1;
    const hasPose = !!scene.avatarPose;
    
    const showAvatar = isIntro || isOutro || isFirstContent || isMiddle || hasPose;
    const currentAvatarVideo = showAvatar ? avatarVideo : "";
    const currentAvatarMode = showAvatar ? avatarMode : "none";

    if (scene.kind === "outro") {
      await makeOutroSegment({
        outputPath: segmentPath,
        duration: scene.durationSec,
        avatarVideo: currentAvatarVideo,
        avatarImage: currentAvatarMode === "image" ? poses.closed : "",
        avatarMode: currentAvatarMode,
        format,
        category: item.input?.category || item.category || ""
      });
    } else if (media.type === "clip") {
      await makeClipSegment({ 
        clipPath: media.path, 
        outputPath: segmentPath, 
        duration: scene.durationSec,
        avatarClosed: poses.closed,
        avatarOpen: poses.open,
        avatarVideo: currentAvatarVideo,
        avatarMode: currentAvatarMode,
        format
      });
    } else {
      await makeImageSegment({ 
        imagePath: media.path, 
        outputPath: segmentPath, 
        duration: scene.durationSec, 
        zoomDirection: index % 2 ? "out" : "in", 
        index,
        avatarClosed: poses.closed,
        avatarOpen: poses.open,
        avatarVideo: currentAvatarVideo,
        avatarMode: currentAvatarMode,
        format
      });
    }
    segmentPaths[index] = segmentPath;

    completedSegments++;
    const segmentPercent = Math.round(5 + (completedSegments / allScenes.length) * 60);
    const progressMsg = `Merender segmen ${completedSegments} dari ${allScenes.length}...`;
    item.progress = { percent: segmentPercent, stage: "rendering_segments", message: progressMsg };
    await saveItem(item);
    setProgress({ itemId: item.id, percent: segmentPercent, stage: "rendering_segments", message: progressMsg });
  };

  const queue = [...allScenes.keys()];
  const workers = Array.from({ length: concurrencyLimit }, async () => {
    while (queue.length > 0) {
      const index = queue.shift();
      await renderSegment(index);
    }
  });
  await Promise.all(workers);

  const visualPath = path.join(workDir, "visual.mp4");
  item.progress = { percent: 65, stage: "combining", message: "Menggabungkan segmen video..." };
  await saveItem(item);
  setProgress({ itemId: item.id, percent: 65, stage: "combining", message: "Menggabungkan segmen video..." });
  await concatSegments(segmentPaths, visualPath);

  const assPath = path.join(workDir, "captions.ass");
  await writeCaptionAss({
    outputPath: assPath,
    item,
    scenes: renderScenes,
    narrationDuration,
    narrationTempo: timing.narrationTempo,
    totalDuration: timing.totalDuration
  });

  const subtitledPath = path.join(workDir, "visual-subtitled.mp4");
  item.progress = { percent: 75, stage: "subtitling", message: "Membakar subtitle karaoke..." };
  await saveItem(item);
  setProgress({ itemId: item.id, percent: 75, stage: "subtitling", message: "Membakar subtitle karaoke..." });
  await burnSubtitles({ inputPath: visualPath, assPath, outputPath: subtitledPath });

  const brandedPath = path.join(workDir, "visual-branded.mp4");
  item.progress = { percent: 80, stage: "branding", message: "Menambahkan watermark logo..." };
  await saveItem(item);
  setProgress({ itemId: item.id, percent: 80, stage: "branding", message: "Menambahkan watermark logo..." });
  await addLogoWatermark({ inputPath: subtitledPath, outputPath: brandedPath, format });

  const bedPath = path.join(workDir, "knowledge-bed.m4a");
  await makeKnowledgeBed({ outputPath: bedPath, duration: timing.totalDuration, item });

  const audioPath = item.assets?.audio?.path
    ? path.join(workDir, "final-audio.m4a")
    : bedPath;
  if (item.assets?.audio?.path) {
    item.progress = { percent: 85, stage: "audio_mixing", message: "Mencampur audio dan efek suara..." };
    await saveItem(item);
    setProgress({ itemId: item.id, percent: 85, stage: "audio_mixing", message: "Mencampur audio dan efek suara..." });
    await mixNarrationWithBed({
      narrationPath: item.assets.audio.path,
      bedPath,
      outputPath: audioPath,
      delaySec: introDuration,
      tempo: timing.narrationTempo,
      scenes: renderScenes,
      totalDuration: timing.totalDuration
    });
  }

  const provider = item.assets?.audio?.provider || "local";
  const filename = `${item.id}-${provider}-${safeFilename(item.title)}.mp4`;
  const outputPath = path.join(paths.videoDir, filename);

  item.progress = { percent: 95, stage: "muxing", message: "Menyatukan video dan audio..." };
  await saveItem(item);
  setProgress({ itemId: item.id, percent: 95, stage: "muxing", message: "Menyatukan video dan audio..." });
  await muxVideoAudio({ videoPath: brandedPath, audioPath, outputPath });

  item.status = "ready";
  item.progress = { percent: 100, stage: "completed", message: "Video final selesai dibuat!" };
  await saveItem(item);
  setProgress({ itemId: item.id, percent: 100, stage: "completed", message: "Video final selesai dibuat!" });
  setTimeout(resetProgress, 5000);

  return {
    path: outputPath,
    url: `/generated/videos/${filename}`,
    provider,
    durationSec: Number((await probeDuration(outputPath)).toFixed(2)),
    scenes: renderScenes.length
  };
}

function buildTiming(item, narrationDuration) {
  const requestedTotal = clamp(Number(item.input?.durationSec || 90), 45, 120);
  const maxTotal = 120;
  const maxContent = maxTotal - introDuration - outroDuration;
  const requestedContent = requestedTotal - introDuration - outroDuration;
  const relaxedFastTempo = clamp(Number(config.render.speechTempo || 1.15), 0.9, 1.3);
  const forcedTempo = narrationDuration > maxContent ? narrationDuration / maxContent : 1;
  const narrationTempo = clamp(Math.max(relaxedFastTempo, forcedTempo), 0.9, 1.3);
  const adjustedNarration = narrationDuration ? narrationDuration / narrationTempo : 0;
  const contentDuration = narrationDuration
    ? clamp(Math.max(adjustedNarration + 0.35, 34), 34, maxContent)
    : clamp(Math.max(requestedContent, 34), 34, maxContent);
  return {
    contentDuration,
    totalDuration: Number((contentDuration + introDuration + outroDuration).toFixed(2)),
    narrationTempo
  };
}

function buildRenderScenes(item, contentDuration) {
  const scenes = item.plan.scenes || [];
  const weights = scenes.map((scene) => Math.max(1, String(scene.narration || "").split(/\s+/).length));
  const totalWeight = weights.reduce((sum, value) => sum + value, 0) || scenes.length || 1;
  return scenes.map((scene, index) => ({
    ...scene,
    durationSec: Number(((weights[index] / totalWeight) * contentDuration).toFixed(2))
  }));
}

function buildIntroScene(item, firstScene) {
  return {
    kind: "intro",
    index: 0,
    durationSec: introDuration,
    screenText: item.plan.hook || item.title,
    narration: "",
    imageSourceSceneIndex: firstScene?.index || 1
  };
}

function buildOutroScene(item, lastScene) {
  return {
    kind: "outro",
    index: 999,
    durationSec: outroDuration,
    screenText: endOverlayText(item),
    narration: "",
    imageSourceSceneIndex: lastScene?.index || 1
  };
}

function resolveSceneMedia(item, scene) {
  if (scene.kind === "intro" && item.assets?.thumbnail?.path) {
    return { type: "image", path: item.assets.thumbnail.path };
  }
  const sourceIndex = scene.imageSourceSceneIndex || scene.index;
  if (!scene.kind) {
    const clip = item.assets?.clips?.find((entry) => Number(entry.sceneIndex) === Number(sourceIndex));
    if (clip?.path) return { type: "clip", path: clip.path };
  }
  const image = item.assets?.images?.find((entry) => Number(entry.sceneIndex) === Number(sourceIndex));
  if (!image?.path) throw new Error(`Gambar untuk scene ${sourceIndex} belum tersedia.`);
  return { type: "image", path: image.path };
}

async function makeImageSegment({ imagePath, outputPath, duration, zoomDirection, index = 0, avatarClosed, avatarOpen, avatarVideo, avatarMode, format = "vertical" }) {
  const frames = Math.max(1, Math.round(duration * fps));
  const isHorizontal = format === "horizontal";
  const width = isHorizontal ? 1920 : 1080;
  const height = isHorizontal ? 1080 : 1920;
  const bottomMargin = isHorizontal ? 60 : 120;
  
  const { chromaColor, chromaSim, chromaBlend, avatarCrop, isCircleCrop } = getAvatarParams(avatarMode);

  const avatarSize = isHorizontal ? 240 : 420;
  let avatarFilter = "";
  if (avatarMode !== "none") {
    avatarFilter = getAvatarFilterComplex({
      inputLabel: avatarVideo ? "[1:v]" : "[raw_av]",
      size: avatarSize,
      duration,
      chromaColor,
      chromaSim,
      chromaBlend,
      avatarCrop,
      isCircleCrop
    });
  }

  // Dynamic camera motions to avoid AI looking flat zoom
  const motions = ["zoom_in", "zoom_out", "pan_right", "pan_left", "pan_down", "pan_up"];
  const motion = motions[index % motions.length];
  
  let zoomExpr = "1.12";
  let xExpr = "iw/2-(iw/zoom/2)";
  let yExpr = "ih/2-(ih/zoom/2)";
  
  if (motion === "zoom_in") {
    zoomExpr = `min(1.0+on*0.00035,1.055)`;
  } else if (motion === "zoom_out") {
    zoomExpr = `if(eq(on,0),1.055,max(1.0,zoom-0.00035))`;
  } else if (motion === "pan_right") {
    xExpr = `(iw-iw/zoom)*(on/${frames})`;
  } else if (motion === "pan_left") {
    xExpr = `(iw-iw/zoom)*(1.0-on/${frames})`;
  } else if (motion === "pan_down") {
    yExpr = `(ih-ih/zoom)*(on/${frames})`;
  } else if (motion === "pan_up") {
    yExpr = `(ih-ih/zoom)*(1.0-on/${frames})`;
  }

  // Papan tulis & asap dinonaktifkan atas permintaan user
  let hasFx = false;

  if (avatarVideo && avatarMode !== "none") {
    let filterComplex = "";
    let ffmpegInputs = [
      "-loop", "1", "-t", duration.toFixed(2), "-i", imagePath,
      "-stream_loop", "-1", "-t", duration.toFixed(2), "-i", avatarVideo
    ];

    filterComplex = [
      `[0:v]scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height},zoompan=z='${zoomExpr}':x='${xExpr}':y='${yExpr}':d=${frames}:s=${width}x${height}:fps=${fps},eq=contrast=1.04:saturation=1.06:brightness=0.01[bg]`,
      avatarFilter,
      `[bg][av]overlay=x=W-w-20:y='if(lt(t,0.5), H-(h+${bottomMargin})*(t/0.5), H-h-${bottomMargin}+18*sin(2.5*(t-0.5)))'[out]`
    ].join(";");

    await runFfmpeg([
      "-y",
      ...ffmpegInputs,
      "-filter_complex", filterComplex,
      "-map", "[out]",
      "-frames:v", String(frames),
      "-r", String(fps),
      ...getVideoEncodingArgs("22"),
      outputPath
    ]);
  } else if (avatarClosed && avatarOpen && avatarMode !== "none") {
    let filterComplex = "";
    let ffmpegInputs = [
      "-loop", "1", "-t", duration.toFixed(2), "-i", imagePath,
      "-loop", "1", "-t", duration.toFixed(2), "-i", avatarClosed,
      "-loop", "1", "-t", duration.toFixed(2), "-i", avatarOpen
    ];

    filterComplex = [
      `[0:v]scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height},zoompan=z='${zoomExpr}':x='${xExpr}':y='${yExpr}':d=${frames}:s=${width}x${height}:fps=${fps},eq=contrast=1.04:saturation=1.06:brightness=0.01[bg]`,
      `color=c=0x00000000:s=1024x1024:d=${duration.toFixed(2)}[canvas]`,
      `[canvas][1:v]overlay=enable='lt(mod(t,0.24),0.14)'[tmp_av]`,
      `[tmp_av][2:v]overlay=enable='gte(mod(t,0.24),0.14)'[raw_av]`,
      avatarFilter,
      `[bg][av]overlay=x=W-w-40:y='if(lt(t,0.5), H-(h+${bottomMargin})*(t/0.5), H-h-${bottomMargin}+18*sin(2.5*(t-0.5)))'[out]`
    ].join(";");

    await runFfmpeg([
      "-y",
      ...ffmpegInputs,
      "-filter_complex", filterComplex,
      "-map", "[out]",
      "-frames:v", String(frames),
      "-r", String(fps),
      ...getVideoEncodingArgs("22"),
      outputPath
    ]);
  } else {
    const vf = [
      `scale=${width}:${height}:force_original_aspect_ratio=increase`,
      `crop=${width}:${height}`,
      `zoompan=z='${zoomExpr}':x='${xExpr}':y='${yExpr}':d=${frames}:s=${width}x${height}:fps=${fps}`,
      "eq=contrast=1.04:saturation=1.06:brightness=0.01",
      "format=yuv420p"
    ].join(",");

    await runFfmpeg([
      "-y",
      "-loop", "1",
      "-i", imagePath,
      "-vf", vf,
      "-frames:v", String(frames),
      "-r", String(fps),
      ...getVideoEncodingArgs("22"),
      outputPath
    ]);
  }
}

async function makeClipSegment({ clipPath, outputPath, duration, avatarClosed, avatarOpen, avatarVideo, avatarMode, format = "vertical" }) {
  const isHorizontal = format === "horizontal";
  const width = isHorizontal ? 1920 : 1080;
  const height = isHorizontal ? 1080 : 1920;
  const bottomMargin = isHorizontal ? 60 : 120;

  const { chromaColor, chromaSim, chromaBlend, avatarCrop, isCircleCrop } = getAvatarParams(avatarMode);

  const avatarSize = isHorizontal ? 240 : 420;
  let avatarFilter = "";
  if (avatarMode !== "none") {
    avatarFilter = getAvatarFilterComplex({
      inputLabel: avatarVideo ? "[1:v]" : "[raw_av]",
      size: avatarSize,
      duration,
      chromaColor,
      chromaSim,
      chromaBlend,
      avatarCrop,
      isCircleCrop
    });
  }

  // Papan tulis & asap dinonaktifkan atas permintaan user
  let hasFx = false;

  if (avatarVideo && avatarMode !== "none") {
    let filterComplex = "";
    let ffmpegInputs = [
      "-stream_loop", "-1", "-i", clipPath,
      "-stream_loop", "-1", "-t", Number(duration || 4).toFixed(2), "-i", avatarVideo
    ];

    filterComplex = [
      `[0:v]scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height},fps=${fps},eq=contrast=1.035:saturation=1.04:brightness=0.01[bg]`,
      avatarFilter,
      `[bg][av]overlay=x=W-w-20:y='if(lt(t,0.5), H-(h+${bottomMargin})*(t/0.5), H-h-${bottomMargin}+18*sin(2.5*(t-0.5)))'[out]`
    ].join(";");

    await runFfmpeg([
      "-y",
      ...ffmpegInputs,
      "-filter_complex", filterComplex,
      "-map", "[out]",
      "-t", Number(duration || 4).toFixed(2),
      "-an",
      "-r", String(fps),
      ...getVideoEncodingArgs("22"),
      outputPath
    ]);
  } else if (avatarClosed && avatarOpen && avatarMode !== "none") {
    let filterComplex = "";
    let ffmpegInputs = [
      "-stream_loop", "-1", "-i", clipPath,
      "-loop", "1", "-t", Number(duration || 4).toFixed(2), "-i", avatarClosed,
      "-loop", "1", "-t", Number(duration || 4).toFixed(2), "-i", avatarOpen
    ];

    filterComplex = [
      `[0:v]scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height},fps=${fps},eq=contrast=1.035:saturation=1.04:brightness=0.01[bg]`,
      `color=c=0x00000000:s=1024x1024:d=${Number(duration || 4).toFixed(2)}[canvas]`,
      `[canvas][1:v]overlay=enable='lt(mod(t,0.24),0.14)'[tmp_av]`,
      `[tmp_av][2:v]overlay=enable='gte(mod(t,0.24),0.14)'[raw_av]`,
      avatarFilter,
      `[bg][av]overlay=x=W-w-40:y='if(lt(t,0.5), H-(h+${bottomMargin})*(t/0.5), H-h-${bottomMargin}+18*sin(2.5*(t-0.5)))'[out]`
    ].join(";");

    await runFfmpeg([
      "-y",
      ...ffmpegInputs,
      "-filter_complex", filterComplex,
      "-map", "[out]",
      "-t", Number(duration || 4).toFixed(2),
      "-an",
      "-r", String(fps),
      ...getVideoEncodingArgs("22"),
      outputPath
    ]);
  } else {
    const vf = [
      `scale=${width}:${height}:force_original_aspect_ratio=increase`,
      `crop=${width}:${height}`,
      `fps=${fps}`,
      "eq=contrast=1.035:saturation=1.04:brightness=0.01",
      "format=yuv420p"
    ].join(",");

    await runFfmpeg([
      "-y",
      "-stream_loop", "-1",
      "-i", clipPath,
      "-t", Number(duration || 4).toFixed(2),
      "-an",
      "-vf", vf,
      "-r", String(fps),
      ...getVideoEncodingArgs("22"),
      outputPath
    ]);
  }
}

async function concatSegments(segmentPaths, outputPath) {
  const listPath = `${outputPath}.txt`;
  const list = segmentPaths.map((file) => `file '${file.replace(/\\/g, "/").replace(/'/g, "'\\''")}'`).join("\n");
  await fs.writeFile(listPath, `${list}\n`, "utf8");
  await runFfmpeg([
    "-y",
    "-f", "concat",
    "-safe", "0",
    "-i", listPath,
    "-c", "copy",
    outputPath
  ]);
}

async function burnSubtitles({ inputPath, assPath, outputPath }) {
  const subtitlePath = filterPath(path.relative(paths.rootDir, assPath));
  await runFfmpeg([
    "-y",
    "-i", inputPath,
    "-vf", `ass=filename='${subtitlePath}'`,
    ...getVideoEncodingArgs("21"),
    outputPath
  ]);
}

async function addLogoWatermark({ inputPath, outputPath, format = "vertical" }) {
  const logoPath = path.join(paths.publicDir, "assets", "banyaktau-logo-watermark.png");
  try {
    await fs.access(logoPath);
  } catch {
    await fs.copyFile(inputPath, outputPath);
    return;
  }

  const isHorizontal = format === "horizontal";
  const logoWidth = isHorizontal ? 170 : 96;
  const overlayPos = "W-w-40:40";

  await runFfmpeg([
    "-y",
    "-i", inputPath,
    "-i", logoPath,
    "-filter_complex",
    [
      `[1:v]scale=${logoWidth}:-1,format=rgba,colorchannelmixer=aa=0.78[wm]`,
      `[0:v][wm]overlay=${overlayPos}:format=auto[v]`
    ].join(";"),
    "-map", "[v]",
    ...getVideoEncodingArgs("21"),
    outputPath
  ]);
}

async function makeKnowledgeBed({ outputPath, duration, item }) {
  const category = item?.input?.category || item?.category || "";
  const customMusic = await findBackgroundMusic(category);
  if (customMusic) {
    await makeCustomMusicBed({ inputPath: customMusic, outputPath, duration });
    return;
  }

  const fadeOutAt = Math.max(0.1, duration - 1.2).toFixed(2);
  await runFfmpeg([
    "-y",
    "-f", "lavfi", "-t", duration.toFixed(2), "-i", "anoisesrc=color=pink:amplitude=0.018",
    "-f", "lavfi", "-t", duration.toFixed(2), "-i", "sine=frequency=174:sample_rate=44100",
    "-filter_complex",
    [
      "[0:a]lowpass=f=850,highpass=f=40,volume=0.028[a0]",
      `[1:a]volume=0.012,afade=t=in:st=0:d=2.2,afade=t=out:st=${fadeOutAt}:d=1.2[a1]`,
      "[a0][a1]amix=inputs=2:duration=longest:normalize=0,alimiter=limit=0.62[a]"
    ].join(";"),
    "-map", "[a]",
    "-c:a", "aac",
    "-b:a", "128k",
    outputPath
  ]);
}

async function findBackgroundMusic(category = "") {
  const normCategory = String(category || "").toLowerCase().trim().replace(/\s+/g, "_");
  const candidates = [];
  
  if (normCategory) {
    candidates.push(path.join(paths.rootDir, "assets", "music", `${normCategory}.m4a`));
    candidates.push(path.join(paths.rootDir, "assets", "music", `${normCategory}.mp3`));
  }
  
  candidates.push(
    process.env.BANYAKTAU_MUSIC_PATH,
    path.join(paths.rootDir, "assets", "music", "eksplorasi-literasi.m4a"),
    path.join(paths.rootDir, "assets", "music", "eksplorasi-literasi.mp3")
  );

  const cleanCandidates = candidates.filter(Boolean);
  for (const candidate of cleanCandidates) {
    try {
      await fs.access(candidate);
      return candidate;
    } catch {
      // Try next candidate.
    }
  }
  return "";
}

async function makeCustomMusicBed({ inputPath, outputPath, duration }) {
  const fadeOutAt = Math.max(0.1, duration - 1.4).toFixed(2);
  await runFfmpeg([
    "-y",
    "-stream_loop", "-1",
    "-i", inputPath,
    "-t", duration.toFixed(2),
    "-filter_complex",
    `aformat=sample_rates=44100:channel_layouts=stereo,volume=0.18,afade=t=in:st=0:d=1.4,afade=t=out:st=${fadeOutAt}:d=1.4,alimiter=limit=0.72[a]`,
    "-map", "[a]",
    "-c:a", "aac",
    "-b:a", "128k",
    outputPath
  ]);
}

async function mixNarrationWithBed({ narrationPath, bedPath, outputPath, delaySec, tempo, scenes = [], totalDuration = 0 }) {
  const delayMs = Math.max(0, Math.round(delaySec * 1000));
  const swooshPath = path.join(paths.rootDir, "assets", "sfx", "swoosh.mp3");
  const popPath = path.join(paths.rootDir, "assets", "sfx", "pop.mp3");

  const swooshOffsetsMs = [delayMs];
  const popOffsetsMs = [];

  let currentOffsetSec = delaySec;
  for (let i = 0; i < scenes.length; i++) {
    const scene = scenes[i];
    popOffsetsMs.push(Math.round((currentOffsetSec + 0.2) * 1000));
    currentOffsetSec += scene.durationSec;
    if (i < scenes.length - 1) {
      swooshOffsetsMs.push(Math.round(currentOffsetSec * 1000));
    }
  }
  swooshOffsetsMs.push(Math.round(currentOffsetSec * 1000));

  const swooshCount = swooshOffsetsMs.length;
  const popCount = popOffsetsMs.length;

  const filterParts = [];
  
  const narrationFilters = [
    "aformat=sample_rates=44100:channel_layouts=mono",
    ...atempoFilters(tempo),
    "loudnorm=I=-16:TP=-1.5:LRA=9",
    "volume=1.08",
    `adelay=${delayMs}:all=1`
  ].join(",");
  filterParts.push(`[0:a]${narrationFilters}[n]`);

  filterParts.push("[1:a]volume=0.62[bed]");

  filterParts.push(`[2:a]asplit=${swooshCount}${Array.from({ length: swooshCount }, (_, i) => `[sw_${i}]`).join("")}`);
  for (let i = 0; i < swooshCount; i++) {
    filterParts.push(`[sw_${i}]adelay=${swooshOffsetsMs[i]}:all=1[delayed_sw_${i}]`);
  }

  filterParts.push(`[3:a]asplit=${popCount}${Array.from({ length: popCount }, (_, i) => `[pop_${i}]`).join("")}`);
  for (let i = 0; i < popCount; i++) {
    filterParts.push(`[pop_${i}]adelay=${popOffsetsMs[i]}:all=1[delayed_pop_${i}]`);
  }

  const amixInputs = [
    "[n]",
    "[bed]",
    ...Array.from({ length: swooshCount }, (_, i) => `[delayed_sw_${i}]`),
    ...Array.from({ length: popCount }, (_, i) => `[delayed_pop_${i}]`)
  ];
  const totalInputs = amixInputs.length;
  filterParts.push(`${amixInputs.join("")}amix=inputs=${totalInputs}:duration=longest:normalize=0,alimiter=limit=0.96[a]`);

  await runFfmpeg([
    "-y",
    "-i", narrationPath,
    "-i", bedPath,
    "-i", swooshPath,
    "-i", popPath,
    "-filter_complex", filterParts.join(";"),
    "-map", "[a]",
    "-c:a", "aac",
    "-b:a", "192k",
    outputPath
  ]);
}

async function muxVideoAudio({ videoPath, audioPath, outputPath }) {
  await runFfmpeg([
    "-y",
    "-i", videoPath,
    "-i", audioPath,
    "-map", "0:v:0",
    "-map", "1:a:0",
    "-c:v", "copy",
    "-c:a", "aac",
    "-b:a", "192k",
    "-shortest",
    outputPath
  ]);
}

async function writeCaptionAss({ outputPath, item, scenes, narrationDuration, narrationTempo, totalDuration }) {
  const events = [];
  const isHorizontal = item.input?.videoFormat === "horizontal";
  const hookText = splitLines(item.plan?.hook || item.title || "BanyakTau", isHorizontal ? 28 : 18, 2).join("\\N");
  events.push(dialogue(0.05, introDuration - 0.05, "Hook", `{\\fad(150,150)}${assEscape(hookText)}`));

  const titleText = splitLines(item.title || item.plan?.title || "BanyakTau", isHorizontal ? 32 : 18, 2).join("\\N");
  events.push(dialogue(introDuration + 0.05, Math.max(introDuration + 0.1, totalDuration - outroDuration), "SceneTitle", `{\\fad(140,160)}${assEscape(titleText)}`));

  let cursor = introDuration;
  for (const scene of scenes) {
    const end = cursor + scene.durationSec;
    // Papan tulis & teks papan tulis dinonaktifkan atas permintaan user
    cursor = end;
  }

  const subtitleEnd = Math.max(introDuration + 0.2, totalDuration - outroDuration - 0.08);
  const timing = {
    start: introDuration + 0.05,
    duration: narrationDuration ? narrationDuration / Math.max(0.1, Number(narrationTempo || 1)) : totalDuration - introDuration - outroDuration,
    tempo: narrationTempo
  };
  
  // Call the new karaoke active-word caption generator
  events.push(...generateKaraokeCaptionEvents(item, timing, subtitleEnd));

  events.push(...outroOverlayEvents(item, Math.max(0, totalDuration - outroDuration), totalDuration));

  const playResX = isHorizontal ? 1920 : 1080;
  const playResY = isHorizontal ? 1080 : 1920;

  const hookFontsize = isHorizontal ? 72 : 96;
  const hookMarginV = isHorizontal ? 120 : 180;
  
  const titleFontsize = isHorizontal ? 48 : 58;
  const titleMarginL = isHorizontal ? 80 : 54;
  const titleMarginR = isHorizontal ? 600 : 340;
  const titleMarginV = isHorizontal ? 60 : 78;

  const subFontsize = isHorizontal ? 56 : 76;
  const subMarginR = isHorizontal ? 360 : 80;
  const subMarginV = isHorizontal ? 120 : 850;

  const kickerFontsize = isHorizontal ? 28 : 34;
  const summaryFontsize = isHorizontal ? 36 : 44;
  const brandFontsize = isHorizontal ? 24 : 30;

  const ass = [
    "[Script Info]",
    "ScriptType: v4.00+",
    `PlayResX: ${playResX}`,
    `PlayResY: ${playResY}`,
    "ScaledBorderAndShadow: yes",
    "",
    "[V4+ Styles]",
    "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
    `Style: Hook,${config.render.fontTitle},${hookFontsize},&H00FFFFFF,&H000000FF,&H00000000,&H00000000,-1,0,0,0,100,100,0,0,1,5.5,4.0,5,80,80,${hookMarginV},1`,
    `Style: SceneTitle,${config.render.fontTitle},${titleFontsize},&H00F7F2DC,&H000000FF,&H00000000,&H00000000,-1,0,0,0,100,100,0,0,1,4.5,3.5,7,${titleMarginL},${titleMarginR},${titleMarginV},1`,
    `Style: BoardText,${config.render.fontTitle},${isHorizontal ? 24 : 32},&H00F7F2DC,&H000000FF,&H00000000,&H00000000,-1,0,0,0,100,100,0,0,1,0,0,5,0,0,0,1`,
    `Style: Subtitle,${config.render.fontBody},${subFontsize},&H00FFFFFF,&H000000FF,&H9A11171B,&HBF11171B,-1,0,0,0,100,100,0,0,1,5,0,2,80,${subMarginR},${subMarginV},1`,
    `Style: Point,${config.render.fontBody},72,&H00FFFFFF,&H000000FF,&H8F11171B,&HCC11171B,-1,0,0,0,100,100,0,0,3,18,0,5,96,96,0,1`,
    `Style: OutroDim,${config.render.fontBody},20,&H82000000,&H000000FF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,0,0,7,0,0,0,1`,
    `Style: OutroCard,${config.render.fontBody},20,&H1811171B,&H000000FF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,0,0,7,0,0,0,1`,
    `Style: OutroAccent,${config.render.fontBody},20,&H004CC8F5,&H000000FF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,0,0,7,0,0,0,1`,
    `Style: OutroKicker,${config.render.fontMono},${kickerFontsize},&H004CC8F5,&H000000FF,&H9011171B,&H0011171B,-1,0,0,0,100,100,0,0,1,2,0,5,104,104,0,1`,
    `Style: OutroTitle,${config.render.fontTitle},52,&H00FFFFFF,&H000000FF,&H9011171B,&H0011171B,-1,0,0,0,100,100,0,0,1,2.5,0,7,104,104,870,1`,
    `Style: OutroSummary,${config.render.fontMono},${summaryFontsize},&H00FFFFFF,&H000000FF,&H9211171B,&H0011171B,-1,0,0,0,100,100,0,0,1,2.8,0,5,104,104,0,1`,
    `Style: OutroPoint,${config.render.fontBody},38,&H00F7F2DC,&H000000FF,&H9511171B,&H0011171B,-1,0,0,0,100,100,0,0,1,2.2,0,7,104,104,1380,1`,
    `Style: OutroBrand,${config.render.fontMono},${brandFontsize},&H004CC8F5,&H000000FF,&H9011171B,&H0011171B,-1,0,0,0,100,100,0,0,1,2,0,5,90,90,0,1`,
    "",
    "[Events]",
    "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
    ...events
  ].join("\n");

  await fs.writeFile(outputPath, ass, "utf8");
}

function generateKaraokeCaptionEvents(item, timing, subtitleEnd) {
  const events = [];
  const transcript = Array.isArray(item.assets?.captions) ? item.assets.captions : [];
  
  let allWords = [];
  for (const segment of transcript) {
    const words = Array.isArray(segment.words) && segment.words.length
      ? segment.words
      : estimateWordTimings(segment);
    allWords.push(...words);
  }
  
  // If no transcript, estimate words from scene narration
  if (!allWords.length) {
    const scenes = item.plan?.scenes || [];
    let segmentStart = 0;
    for (const scene of scenes) {
      const duration = scene.durationSec || 6;
      const segmentEnd = segmentStart + duration;
      const text = String(scene.narration || "").trim();
      if (text) {
        const estSegment = { start: segmentStart, end: segmentEnd, text };
        allWords.push(...estimateWordTimings(estSegment));
      }
      segmentStart = segmentEnd;
    }
  }
  
  if (!allWords.length) return [];
  
  const toTimelineTime = (t) => {
    return timing.start + Number(t) / timing.tempo;
  };
  
  const chunks = [];
  let currentChunk = [];
  
  for (let i = 0; i < allWords.length; i++) {
    const word = allWords[i];
    const prevWord = allWords[i - 1];
    
    let startNew = false;
    if (currentChunk.length >= 3) {
      startNew = true;
    } else if (prevWord) {
      const gap = word.start - prevWord.end;
      if (gap > 0.4) {
        startNew = true;
      }
    }
    
    if (startNew && currentChunk.length > 0) {
      chunks.push(currentChunk);
      currentChunk = [];
    }
    currentChunk.push(word);
  }
  if (currentChunk.length > 0) {
    chunks.push(currentChunk);
  }
  
  for (const chunk of chunks) {
    const chunkStart = toTimelineTime(chunk[0].start);
    const chunkEnd = toTimelineTime(chunk[chunk.length - 1].end);
    const wordsText = chunk.map(w => normalizeSubtitleText(w.word).toUpperCase());
    
    for (let i = 0; i < chunk.length; i++) {
      const activeWord = chunk[i];
      const eventStart = toTimelineTime(activeWord.start);
      let eventEnd = (i === chunk.length - 1)
        ? chunkEnd
        : toTimelineTime(chunk[i + 1].start);
        
      if (eventEnd - eventStart < 0.05) {
        eventEnd = eventStart + 0.1;
      }
      
      const startTimeline = Math.min(eventStart, subtitleEnd);
      const endTimeline = Math.min(eventEnd, subtitleEnd);
      
      if (endTimeline - startTimeline >= 0.05) {
        const textParts = wordsText.map((word, idx) => {
          if (idx === i) {
            return `{\\c&H003AF4FF&}${word}{\\c&HFFFFFF&}`;
          }
          return word;
        });
        const captionText = textParts.join(" ");
        events.push(dialogue(startTimeline, endTimeline, "Subtitle", captionText));
      }
    }
  }
  
  return events;
}

function estimateWordTimings(segment) {
  const words = String(segment.text || "").replace(/\s+/g, " ").trim().split(" ").filter(Boolean);
  if (!words.length) return [];
  const duration = segment.end - segment.start;
  const wordDuration = duration / words.length;
  return words.map((word, index) => ({
    word,
    start: segment.start + index * wordDuration,
    end: segment.start + (index + 1) * wordDuration
  }));
}

function endOverlayText(item) {
  const points = (item.plan?.importantPoints || [])
    .filter(Boolean)
    .slice(0, 2)
    .map((point) => shortenOverlayLine(point))
    .filter(Boolean);
  if (points.length) return points.join("\\N");

  return splitLines(shortenOverlayLine(item.plan?.summary || "Simpan rasa penasaranmu."), 22, 2).join("\\N");
}

function outroOverlayEvents(item, start, end) {
  const isHorizontal = item.input?.videoFormat === "horizontal";
  const centerX = isHorizontal ? 960 : 540;
  const kickerY = isHorizontal ? 320 : 630;
  const summaryY = isHorizontal ? 510 : 840;
  const brandY = isHorizontal ? 780 : 1160;

  const fade = "{\\fad(200,300)}";
  const kicker = assEscape("KESIMPULAN FAKTA");
  const summary = assEscape(outroSummaryText(item));
  const prompt = assEscape("Ikuti BanyakTau untuk fakta unik lainnya!");
  return [
    dialogue(start + 0.1, end, "OutroKicker", `${fade}{\\an5\\pos(${centerX},${kickerY})}${kicker}`),
    dialogue(start + 0.35, end, "OutroSummary", `${fade}{\\an5\\pos(${centerX},${summaryY})}${summary}`),
    dialogue(start + 0.6, end, "OutroBrand", `${fade}{\\an5\\pos(${centerX},${brandY})}${prompt}`)
  ];
}

function outroSummaryText(item) {
  const summary = normalizeOutroText(item.plan?.summary);
  const points = (item.plan?.importantPoints || []).map(normalizeOutroText).filter(Boolean);
  const fallback = points.length
    ? points.join(". ")
    : normalizeOutroText(item.plan?.scenes?.at(-1)?.narration || item.plan?.hook || "Simpan inti faktanya dan lanjut cari tahu lebih banyak.");
  const text = compactOutroSummary(summary.length >= 60 ? summary : fallback, points);
  return wrapOutroLines(text, outroSummaryMaxChars, outroSummaryMaxLines, { truncate: false }).join("\\N");
}

function outroPointText(item) {
  const points = (item.plan?.importantPoints || [])
    .map(normalizeOutroText)
    .filter(Boolean)
    .filter((point) => point.length >= 18)
    .slice(0, 2);
  return points.map((point) => splitLines(`- ${point.replace(/[.]+$/g, "")}`, 38, 2).join("\\N  ")).join("\\N");
}

function normalizeOutroText(value) {
  return normalizeSubtitleText(value)
    .replace(/^intinya,\s*/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

function compactOutroSummary(value, points = []) {
  const text = normalizeOutroText(value);
  const completeSentences = sentenceList(text);
  const pointSentences = points
    .map((point) => ensureSentence(point.replace(/[.]+$/g, "")))
    .filter(Boolean);
  const candidates = [
    completeSentences.length >= 2 ? `${completeSentences[0]} ${completeSentences[1]}` : "",
    completeSentences[0] || "",
    ...pointSentences,
    text ? ensureSentence(text.replace(/[.]+$/g, "")) : ""
  ].filter(Boolean);

  for (const candidate of uniqueStrings(candidates)) {
    if (fitsOutroSummary(candidate)) return candidate;
  }

  return shortenOutroSentence(candidates[0] || "Simpan inti faktanya dan lanjut cari tahu lebih banyak.");
}

function sentenceList(value) {
  return (normalizeOutroText(value).match(/[^.!?]+[.!?]+/g) || [])
    .map((sentence) => sentence.replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

function ensureSentence(value) {
  const text = normalizeOutroText(value).replace(/[,:;]+$/g, "").trim();
  if (!text) return "";
  return /[.!?]$/.test(text) ? text : `${text}.`;
}

function uniqueStrings(values) {
  const seen = new Set();
  return values.filter((value) => {
    const key = normalizeOutroText(value).toLowerCase();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function fitsOutroSummary(value) {
  return wrapOutroLines(value, outroSummaryMaxChars, Number.POSITIVE_INFINITY, { truncate: false }).length <= outroSummaryMaxLines;
}

function shortenOutroSentence(value) {
  const words = normalizeOutroText(value).replace(/[.]+$/g, "").split(" ").filter(Boolean);
  const lines = [];
  let line = "";
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (next.length > outroSummaryMaxChars && line) {
      lines.push(line);
      if (lines.length >= outroSummaryMaxLines) break;
      line = word;
    } else {
      line = next;
    }
  }
  if (lines.length < outroSummaryMaxLines && line) lines.push(line);
  return ensureSentence(lines.join(" "));
}

function wrapOutroLines(value, maxChars, maxLines, options = {}) {
  const words = normalizeOutroText(value).split(" ").filter(Boolean);
  const lines = [];
  let line = "";
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (next.length > maxChars && line) {
      lines.push(line);
      line = word;
    } else {
      line = next;
    }
  }
  if (line) lines.push(line);

  if (options.truncate === false) return lines;
  const limited = lines.slice(0, maxLines);
  if (lines.length > maxLines) {
    const last = limited.at(-1) || "";
    if (last.length < 12) limited.pop();
    else limited[limited.length - 1] = last.replace(/[,:;]+$/g, "").trim();
  }
  return limited;
}

function shortenOverlayLine(value) {
  const text = polishOverlayLine(normalizeSubtitleText(value));
  if (text.length <= 34) return text;
  const clipped = text.slice(0, 34);
  const atSpace = clipped.lastIndexOf(" ");
  return clipped.slice(0, atSpace > 20 ? atSpace : clipped.length).trim();
}

function polishOverlayLine(value) {
  const text = String(value || "")
    .replace(/\.$/, "")
    .replace(/^Piramida dibangun dari\s+/i, "")
    .replace(/\byang kuat dan tahan lama$/i, "kuat")
    .replace(/^Blok batu disusun dengan presisi tinggi.*$/i, "Susunan batu sangat presisi")
    .replace(/^Desain bentuk segitiga.*$/i, "Bentuk segitiga menahan tekanan")
    .replace(/^Lingkungan gurun yang kering.*$/i, "Cuaca kering ikut mengawetkan")
    .trim();
  return text ? `${text[0].toUpperCase()}${text.slice(1)}` : "";
}

function timedCaptionSegments(item, timing) {
  const transcript = Array.isArray(item.assets?.captions) ? item.assets.captions : [];
  const transcriptEvents = transcript
    .filter((entry) => entry.text && Number(entry.end) > Number(entry.start))
    .flatMap((entry) => captionSegments(entry.text, timing.start + Number(entry.start) / timing.tempo, timing.start + Number(entry.end) / timing.tempo));
  if (transcriptEvents.length) return transcriptEvents;

  const text = (item.plan?.scenes || [])
    .map((scene) => String(scene.narration || "").trim())
    .filter(Boolean)
    .join(" ");
  return captionSegments(text, timing.start, timing.start + timing.duration);
}

function captionSegments(text, start, end) {
  const normalizedText = normalizeSubtitleText(text);
  const words = normalizedText.split(/\s+/).filter(Boolean);
  const duration = Math.max(0.1, end - start);
  if (!words.length || duration <= 0.2) return [];

  const chunkSize = 4;
  const chunks = [];
  for (let index = 0; index < words.length; index += chunkSize) {
    chunks.push(words.slice(index, index + chunkSize).join(" "));
  }
  if (chunks.length > 1 && chunks.at(-1).split(/\s+/).filter(Boolean).length < 3) {
    const tail = chunks.pop();
    chunks[chunks.length - 1] = `${chunks.at(-1)} ${tail}`;
  }

  const totalWords = chunks.reduce((sum, chunk) => sum + chunk.split(/\s+/).filter(Boolean).length, 0) || 1;
  let cursor = start;
  return chunks.map((chunk, index) => {
    const weight = chunk.split(/\s+/).filter(Boolean).length / totalWords;
    const isLast = index === chunks.length - 1;
    const next = isLast ? end : Math.min(end, cursor + duration * weight);
    const segment = {
      start: cursor,
      end: Math.max(cursor + 0.35, next - 0.04),
      text: splitLines(normalizeSubtitleText(chunk), 28, 2).join("\\N")
    };
    cursor = next;
    return segment;
  });
}

function normalizeSubtitleText(value) {
  return String(value || "")
    .replace(/\bKesimpulan\s+Singkat\b/gi, "Fakta Utama")
    .replace(/\bkesimpulan\b/gi, "intinya")
    .replace(/\bekstrim\b/gi, "ekstrem")
    .replace(/\brapih\b/gi, "rapi")
    .replace(/\blembab\b/gi, "lembap")
    .replace(/\bnggak\b/gi, "tidak")
    .replace(/\bkayak\b/gi, "seperti")
    .replace(/\s+/g, " ")
    .trim();
}

function dialogue(start, end, style, text) {
  return `Dialogue: 0,${assTime(start)},${assTime(end)},${style},,0,0,0,,${text}`;
}

function assTime(seconds) {
  const value = Math.max(0, Number(seconds || 0));
  const h = Math.floor(value / 3600);
  const m = Math.floor((value % 3600) / 60);
  const s = Math.floor(value % 60);
  const cs = Math.floor((value - Math.floor(value)) * 100);
  return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${String(cs).padStart(2, "0")}`;
}

function assEscape(value) {
  return String(value || "")
    .replace(/\{/g, "\\{")
    .replace(/\}/g, "\\}")
    .replace(/\r?\n/g, "\\N");
}

function filterPath(filePath) {
  return filePath
    .replace(/\\/g, "/")
    .replace(/'/g, "\\'")
    .replace(/^([A-Za-z]):/, "$1\\\\:");
}

function atempoFilters(tempo) {
  const value = clamp(Number(tempo || 1), 0.5, 2);
  if (Math.abs(value - 1) < 0.01) return [];
  return [`atempo=${value.toFixed(3)}`];
}

export async function probeDuration(filePath) {
  const output = await runCommand("ffprobe", [
    "-v", "error",
    "-show_entries", "format=duration",
    "-of", "default=noprint_wrappers=1:nokey=1",
    filePath
  ]);
  return Number.parseFloat(output.trim()) || 0;
}

async function runFfmpeg(args) {
  await runCommand("ffmpeg", args);
}

function runCommand(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { windowsHide: true, cwd: paths.rootDir });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk.toString(); });
    child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve(stdout || stderr);
      else reject(new Error(stderr || `${command} gagal (${code})`));
    });
  });
}

function getSceneAvatarPoses(scene, index, totalScenes) {
  const avatarDir = path.join(paths.rootDir, "assets", "avatar");
  const thumbsUp = path.join(avatarDir, "thumbs_up.jpg");
  const pointing = path.join(avatarDir, "pointing.jpg");
  const clipboard = path.join(avatarDir, "clipboard.jpg");
  const surprised = path.join(avatarDir, "surprised.jpg");
  const thinking = path.join(avatarDir, "thinking.jpg");

  const poseMap = {
    thumbs_up: thumbsUp,
    pointing: pointing,
    clipboard: clipboard,
    surprised: surprised,
    thinking: thinking
  };

  if (scene.avatarPose && poseMap[scene.avatarPose]) {
    if (scene.avatarPose === "surprised") {
      return { closed: clipboard, open: surprised };
    }
    return { closed: poseMap[scene.avatarPose], open: surprised };
  }

  // Jika adegan pertama (intro) atau terakhir (outro), gunakan pose jempol
  if (scene.kind === "intro" || scene.kind === "outro") {
    return { closed: thumbsUp, open: surprised };
  }

  const narration = String(scene.narration || "").toLowerCase();
  const screenText = String(scene.screenText || "").toLowerCase();

  // Jika ada tanda tanya, gunakan pose berpikir
  if (narration.includes("?") || screenText.includes("?")) {
    return { closed: thinking, open: surprised };
  }

  // Jika ada kata kunci menunjuk/fakta
  const pointingKeywords = ["pertama", "kedua", "ketiga", "ini dia", "berikut", "tahukah", "yaitu", "misalnya", "point"];
  const hasPointingCue = pointingKeywords.some(kw => narration.includes(kw) || screenText.includes(kw));
  
  if (hasPointingCue || index % 3 === 2) {
    return { closed: pointing, open: surprised };
  }

  // Pose default: memegang clipboard
  return { closed: clipboard, open: surprised };
}

async function ensureSfxAssets() {
  const sfxDir = path.join(paths.rootDir, "assets", "sfx");
  await fs.mkdir(sfxDir, { recursive: true });

  const swooshPath = path.join(sfxDir, "swoosh.mp3");
  const popPath = path.join(sfxDir, "pop.mp3");

  try {
    await fs.access(swooshPath);
  } catch {
    console.log("Mempersiapkan efek suara transition swoosh...");
    await runFfmpeg([
      "-y",
      "-f", "lavfi",
      "-i", "anoisesrc=d=0.3:c=white:amplitude=0.25",
      "-af", "afade=t=in:ss=0:d=0.12,afade=t=out:st=0.12:d=0.18",
      swooshPath
    ]);
  }

  try {
    await fs.access(popPath);
  } catch {
    console.log("Mempersiapkan efek suara pop...");
    await runFfmpeg([
      "-y",
      "-f", "lavfi",
      "-i", "sine=frequency=850:duration=0.1",
      "-af", "afade=t=out:st=0:d=0.1,volume=1.8",
      popPath
    ]);
  }
}

async function makeOutroSegment({ outputPath, duration, avatarVideo, avatarImage, avatarMode, format = "vertical", category = "" }) {
  const frames = Math.max(1, Math.round(duration * fps));
  const logoPath = path.join(paths.publicDir, "assets", "banyaktau-logo-watermark.png");
  const isHorizontal = format === "horizontal";
  const width = isHorizontal ? 1920 : 1080;
  const height = isHorizontal ? 1080 : 1920;
  const bottomMargin = isHorizontal ? 60 : 120;
  const avatarSize = isHorizontal ? 240 : 420;

  const { chromaColor, chromaSim, chromaBlend, avatarCrop: cropFilter, isCircleCrop } = getAvatarParams(avatarMode);

  let avatarFilterNoFx = "";
  if (avatarMode !== "none") {
    avatarFilterNoFx = getAvatarFilterComplex({
      inputLabel: avatarVideo ? `[${avatarVideo ? 2 : 1}:v]` : `[${avatarImage ? 2 : 1}:v]`,
      size: avatarSize,
      duration,
      chromaColor,
      chromaSim,
      chromaBlend,
      avatarCrop: cropFilter,
      rotateAngle: 5,
      isCircleCrop
    });
  }

  let inputs = [
    "-f", "lavfi", "-i", `color=c=0x0d0f12:s=${width}x${height}:d=${duration.toFixed(2)}`
  ];

  let inputCount = 1;
  let logoIndex = -1;
  try {
    await fs.access(logoPath);
    inputs.push("-i", logoPath);
    logoIndex = inputCount++;
  } catch (error) {
    // logo not found
  }

  let avatarIndex = -1;
  if (avatarVideo && avatarMode !== "none") {
    inputs.push("-stream_loop", "-1", "-t", duration.toFixed(2), "-i", avatarVideo);
    avatarIndex = inputCount++;
  } else if (avatarImage && avatarMode !== "none") {
    inputs.push("-loop", "1", "-t", duration.toFixed(2), "-i", avatarImage);
    avatarIndex = inputCount++;
  }

  // Animasi pintu & portal dinonaktifkan atas permintaan user
  let fxIndex = -1;

  const filters = [];
  let currentOutput = "[0:v]";

  if (logoIndex !== -1) {
    filters.push(`[${logoIndex}:v]scale=${isHorizontal ? 320 : 420}:-1,format=rgba,fade=t=in:st=0:d=0.5[logo]`);
    const logoY = isHorizontal ? (avatarIndex !== -1 ? 120 : 200) : (avatarIndex !== -1 ? "(H-h)/2-350" : "(H-h)/2-120");
    filters.push(`${currentOutput}[logo]overlay=(W-w)/2:${logoY}:format=auto[tmp_logo]`);
    currentOutput = "[tmp_logo]";
  }

  if (avatarIndex !== -1) {
    // Standard wobbly overlay in the bottom right corner (no portal)
    filters.push(`${avatarFilterNoFx}`);
    filters.push(`${currentOutput}[av]overlay=x=W-w-40:y='if(lt(t,0.5), H-(h+${bottomMargin})*(t/0.5), H-h-${bottomMargin}+18*sin(2.5*(t-0.5)))'[tmp_av]`);
    currentOutput = "[tmp_av]";
  }

  filters.push(`${currentOutput}fade=t=out:st=${(duration - 0.4).toFixed(2)}:d=0.4[out]`);
  const filterComplex = filters.join(";");

  await runFfmpeg([
    "-y",
    ...inputs,
    "-filter_complex", filterComplex,
    "-map", "[out]",
    "-frames:v", String(frames),
    "-r", String(fps),
    ...getVideoEncodingArgs("22"),
    outputPath
  ]);
}
