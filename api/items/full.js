import { clean, dispatchWorkflow, methodAllowed, readBody, requireAuth, sendJson } from "../_utils.js";

export default async function handler(req, res) {
  if (!methodAllowed(req, res, ["POST"])) return;
  if (!requireAuth(req, res)) return;

  try {
    const body = await readBody(req);
    const dispatch = await dispatchWorkflow({
      topic: clean(body.topic || body.selectedIdea?.topic || ""),
      category: clean(body.category || body.selectedIdea?.category || "random"),
      long_form: "false",
      duration: String(Math.min(Math.max(Number(body.durationSec || 90), 12), 120)),
      scenes: String(Math.min(Number(body.sceneCount || 7), 7)),
      avatar_mode: clean(body.avatarMode || "random-green"),
      tts_provider: clean(body.ttsProvider || "openai"),
      image_quality: clean(body.imageQuality || "low"),
      with_clip: "true"
    });
    sendJson(res, 200, {
      queued: true,
      item: null,
      warnings: ["Workflow GitHub Actions sudah dipicu. Refresh galeri beberapa menit lagi untuk melihat video final."],
      dispatch
    });
  } catch (error) {
    sendJson(res, 400, { error: error.message });
  }
}
