import { methodAllowed, publicConfig, requireAuth, sendJson } from "./_utils.js";

export default async function handler(req, res) {
  if (!methodAllowed(req, res, ["POST"])) return;
  if (!requireAuth(req, res)) return;
  sendJson(res, 200, {
    config: publicConfig(),
    warning: "Di Vercel, setting API disimpan lewat Environment Variables, bukan dari form agar secret tidak bocor."
  });
}
