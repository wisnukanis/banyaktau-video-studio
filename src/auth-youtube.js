import http from "node:http";
import url from "node:url";
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { exec } from "node:child_process";
import dotenv from "dotenv";
import { paths } from "./config.js";

dotenv.config();

const PORT = 8910;
const REDIRECT_URI = `http://localhost:${PORT}/oauth2callback`;
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const CHANNELS_URL = "https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true";

const SCOPES = [
  "https://www.googleapis.com/auth/youtube.upload",
  "https://www.googleapis.com/auth/youtube.readonly"
];

function prompt(question) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

function openBrowser(targetUrl) {
  const platform = process.platform;
  let cmd = "";
  if (platform === "win32") {
    cmd = `start "" "${targetUrl}"`;
  } else if (platform === "darwin") {
    cmd = `open "${targetUrl}"`;
  } else {
    cmd = `xdg-open "${targetUrl}"`;
  }
  exec(cmd, () => {});
}

function updateEnvFile(entries) {
  const envPath = path.join(paths.rootDir, ".env");
  let content = "";
  if (fs.existsSync(envPath)) {
    content = fs.readFileSync(envPath, "utf8");
  }

  for (const [key, value] of Object.entries(entries)) {
    const regex = new RegExp(`^${key}=.*$`, "m");
    if (regex.test(content)) {
      content = content.replace(regex, `${key}=${value}`);
    } else {
      if (content && !content.endsWith("\n")) content += "\n";
      content += `${key}=${value}\n`;
    }
  }

  fs.writeFileSync(envPath, content, "utf8");
}

async function getChannelName(accessToken) {
  try {
    const res = await fetch(CHANNELS_URL, {
      headers: { Authorization: `Bearer ${accessToken}` }
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data.items?.[0]?.snippet?.title || null;
  } catch {
    return null;
  }
}

async function main() {
  console.log("\n=======================================================");
  console.log("   BANYAKTAU STUDIO - YOUTUBE OAUTH 2.0 SETUP HELPER   ");
  console.log("=======================================================\n");

  let clientId = process.env.YOUTUBE_CLIENT_ID;
  let clientSecret = process.env.YOUTUBE_CLIENT_SECRET;

  if (!clientId) {
    console.log("YOUTUBE_CLIENT_ID belum ditemukan di file .env.");
    clientId = await prompt("Masukkan OAuth Client ID (dari Google Cloud Console): ");
  }

  if (!clientSecret) {
    console.log("YOUTUBE_CLIENT_SECRET belum ditemukan di file .env.");
    clientSecret = await prompt("Masukkan OAuth Client Secret (dari Google Cloud Console): ");
  }

  if (!clientId || !clientSecret) {
    console.error("\n❌ Client ID dan Client Secret wajib diisi! Proses dibatalkan.\n");
    process.exit(1);
  }

  const authUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  authUrl.searchParams.set("client_id", clientId);
  authUrl.searchParams.set("redirect_uri", REDIRECT_URI);
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("scope", SCOPES.join(" "));
  authUrl.searchParams.set("access_type", "offline");
  authUrl.searchParams.set("prompt", "consent");

  console.log("\nMenunggu otorisasi via browser di port " + PORT + "...\n");
  console.log("Bila browser tidak terbuka otomatis, salin dan buka link berikut di browser:");
  console.log("--------------------------------------------------------------------------------");
  console.log(authUrl.toString());
  console.log("--------------------------------------------------------------------------------\n");

  const server = http.createServer(async (req, res) => {
    const reqUrl = url.parse(req.url, true);

    if (reqUrl.pathname !== "/oauth2callback") {
      res.writeHead(404, { "Content-Type": "text/plain" });
      res.end("Not Found");
      return;
    }

    const authCode = reqUrl.query.code;
    const authError = reqUrl.query.error;

    if (authError) {
      res.writeHead(400, { "Content-Type": "text/html; charset=utf-8" });
      res.end(`
        <div style="font-family:sans-serif;max-width:500px;margin:50px auto;padding:20px;border-radius:8px;background:#fee;color:#c00;">
          <h2>Otorisasi Ditolak atau Gagal</h2>
          <p>Error: ${authError}</p>
        </div>
      `);
      console.error("\n❌ Otorisasi ditolak oleh pengguna:", authError);
      server.close();
      process.exit(1);
      return;
    }

    if (!authCode) {
      res.writeHead(400, { "Content-Type": "text/plain" });
      res.end("Authorization code tidak ditemukan.");
      return;
    }

    try {
      console.log("Menukarkan authorization code dengan refresh token...");

      const tokenRes = await fetch(TOKEN_URL, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          code: authCode,
          client_id: clientId,
          client_secret: clientSecret,
          redirect_uri: REDIRECT_URI,
          grant_type: "authorization_code"
        })
      });

      const tokenData = await tokenRes.json();

      if (!tokenRes.ok || !tokenData.refresh_token) {
        throw new Error(
          tokenData.error_description ||
          tokenData.error ||
          "Google tidak mengembalikan refresh token. Pastikan prompt=consent diizinkan."
        );
      }

      const refreshToken = tokenData.refresh_token;
      const channelName = await getChannelName(tokenData.access_token);

      // Simpan ke .env
      updateEnvFile({
        YOUTUBE_UPLOAD_ENABLED: "true",
        YOUTUBE_CLIENT_ID: clientId,
        YOUTUBE_CLIENT_SECRET: clientSecret,
        YOUTUBE_REFRESH_TOKEN: refreshToken
      });

      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(`
        <div style="font-family:system-ui,-apple-system,sans-serif;max-width:560px;margin:60px auto;padding:32px;border-radius:12px;background:#f0fdf4;border:1px solid #bbf7d0;color:#166534;text-align:center;">
          <h1 style="margin:0 0 12px;font-size:24px;">🎉 Otorisasi YouTube Berhasil!</h1>
          ${channelName ? `<p style="font-size:16px;margin:0 0 16px;">Terhubung ke Channel: <strong>${channelName}</strong></p>` : ""}
          <p style="color:#15803d;margin:0 0 20px;">Kredensial <code>YOUTUBE_REFRESH_TOKEN</code> dan konfigurasi telah otomatis disimpan ke file <code>.env</code> Anda.</p>
          <p style="font-size:14px;color:#166534;">Anda sekarang bisa menutup tab browser ini dan kembali ke terminal.</p>
        </div>
      `);

      console.log("\n=======================================================");
      console.log("✅ OTORISASI BERHASIL!");
      if (channelName) console.log(`📺 Channel terhubung : ${channelName}`);
      console.log(`🔑 Refresh Token     : ${refreshToken.slice(0, 10)}...${refreshToken.slice(-6)}`);
      console.log("💾 Konfigurasi telah otomatis disimpan ke file .env:");
      console.log("   - YOUTUBE_UPLOAD_ENABLED=true");
      console.log("   - YOUTUBE_CLIENT_ID=" + clientId);
      console.log("   - YOUTUBE_CLIENT_SECRET=***");
      console.log("   - YOUTUBE_REFRESH_TOKEN=***");
      console.log("=======================================================\n");

      setTimeout(() => {
        server.close();
        process.exit(0);
      }, 1500);

    } catch (err) {
      res.writeHead(500, { "Content-Type": "text/html; charset=utf-8" });
      res.end(`
        <div style="font-family:sans-serif;max-width:500px;margin:50px auto;padding:20px;border-radius:8px;background:#fee;color:#c00;">
          <h2>Gagal Menukarkan Token</h2>
          <p>${err.message}</p>
        </div>
      `);
      console.error("\n❌ Error menukar token:", err.message);
      server.close();
      process.exit(1);
    }
  });

  server.listen(PORT, () => {
    openBrowser(authUrl.toString());
  });
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
