import { methodAllowed, requireAuth, sendJson } from "./_utils.js";

export default async function handler(req, res) {
  if (!methodAllowed(req, res, ["POST"])) return;
  if (!requireAuth(req, res)) return;
  sendJson(res, 400, {
    error: "Di mode Vercel, klik Generate Video Final langsung. Ide/storyboard dibuat otomatis di GitHub Actions."
  });
}
