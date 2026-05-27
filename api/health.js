import { methodAllowed, publicConfig, sendJson } from "./_utils.js";

export default async function handler(req, res) {
  if (!methodAllowed(req, res, ["GET"])) return;
  sendJson(res, 200, {
    ok: true,
    config: publicConfig(),
    tools: { ffmpeg: false, githubActions: true }
  });
}
