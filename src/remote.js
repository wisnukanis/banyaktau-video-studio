import fs from "node:fs/promises";
import path from "node:path";
import { Readable, Writable } from "node:stream";
import { execSync, exec } from "node:child_process";
import { promisify } from "node:util";

const execPromise = promisify(exec);
import { Client as FtpClient } from "basic-ftp";
import SftpClient from "ssh2-sftp-client";
import { paths } from "./config.js";

export function publicBaseUrl() {
  return String(process.env.PUBLIC_BASE_URL || "").replace(/\/+$/g, "");
}

export function remoteEnabled() {
  return ["ftp", "sftp", "github"].includes(remoteConfig().driver);
}

export function remoteConfig() {
  const requested = String(process.env.UPLOAD_DRIVER || "auto").toLowerCase();
  const driver = requested === "auto"
    ? process.env.SFTP_HOST ? "sftp" : process.env.FTP_HOST ? "ftp" : "none"
    : requested;
  const prefix = driver === "ftp" ? "FTP" : "SFTP";
  const first = (name, fallback = "") => process.env[`${prefix}_${name}`] || fallback;
  return {
    driver,
    prefix,
    host: first("HOST"),
    port: Number(first("PORT", driver === "ftp" ? "21" : "22")),
    user: first("USER"),
    password: first("PASSWORD"),
    remoteDir: first("REMOTE_DIR"),
    timeoutMs: Number(first("UPLOAD_TIMEOUT_SECONDS", "180")) * 1000
  };
}

export function assertRemoteConfig() {
  const cfg = remoteConfig();
  if (cfg.driver === "github") return cfg;

  const missing = [];
  if (!cfg.host) missing.push(`${cfg.prefix}_HOST`);
  if (!cfg.user) missing.push(`${cfg.prefix}_USER`);
  if (!cfg.password) missing.push(`${cfg.prefix}_PASSWORD`);
  if (!cfg.remoteDir) missing.push(`${cfg.prefix}_REMOTE_DIR`);
  if (missing.length) throw new Error(`Remote upload config belum lengkap: ${missing.join(", ")}`);
  return cfg;
}

export async function uploadGeneratedStateAndAssets(options = {}) {
  const cfg = remoteConfig();
  if (cfg.driver === "github") {
    try {
      console.log("Staging generated assets to Git...");
      
      let filesToAdd = ["data/items.json"];
      if (options.item) {
        const item = options.item;
        const assets = [
          item.assets?.video,
          item.assets?.thumbnail,
          item.assets?.audio,
          ...(item.assets?.images || []),
          ...(item.assets?.clips || [])
        ].filter((asset) => asset?.path);
        
        for (const asset of assets) {
          filesToAdd.push(asset.path);
        }
      } else {
        filesToAdd.push("generated/");
      }
      
      // Map to relative paths and filter duplicates
      const relPaths = Array.from(new Set(
        filesToAdd.map(p => {
          if (p.startsWith("data/") || p.startsWith("generated/")) return p;
          return path.relative(paths.rootDir, p).replace(/\\/g, "/");
        })
      ));
      
      console.log("Staging specific files to Git:", relPaths);
      await execPromise(`git add -f ${relPaths.map(p => `"${p}"`).join(" ")}`, { cwd: paths.rootDir });
      
      const { stdout: status } = await execPromise("git status --porcelain", { cwd: paths.rootDir });
      if (status.trim()) {
        await execPromise('git commit -m "auto: upload generated video and state"', { cwd: paths.rootDir });
        console.log("Pushing changes to GitHub...");
        await execPromise("git push origin main", { cwd: paths.rootDir });
        console.log("GitHub auto-push successful!");
      } else {
        console.log("No changes to push to GitHub.");
      }
    } catch (err) {
      console.error("GitHub auto-push failed:", err.message);
      throw new Error(`Auto push ke GitHub gagal: ${err.message}`);
    }
    return;
  }

  const srvCfg = assertRemoteConfig();
  await withRemoteClient(srvCfg, async (client) => {
    if (options.item) {
      await uploadItemAssets(client, options.item);
    } else {
      await uploadDir(client, paths.videoDir, "videos");
      await uploadDir(client, paths.thumbnailDir, "thumbnails");
      await uploadDir(client, paths.imageDir, "images");
      await uploadDir(client, paths.audioDir, "audio");
    }
    await uploadJsonFile(client, path.join(paths.dataDir, "items.json"), "state/items.json");
    const memoryPath = path.join(paths.dataDir, "memory.json");
    if (await fileExists(memoryPath)) {
      await uploadJsonFile(client, memoryPath, "state/memory.json");
    }
  });
}

export function absolutizeGeneratedUrls(item) {
  const base = publicBaseUrl();
  if (!base || !item) return item;
  const withUrl = (asset) => {
    if (!asset?.url) return asset;
    return { ...asset, url: `${base}${String(asset.url).replace(/^\/generated\//, "/")}` };
  };
  return {
    ...item,
    assets: {
      ...item.assets,
      video: withUrl(item.assets?.video),
      audio: withUrl(item.assets?.audio),
      thumbnail: withUrl(item.assets?.thumbnail),
      images: (item.assets?.images || []).map(withUrl),
      clips: (item.assets?.clips || []).map(withUrl)
    }
  };
}

export async function withRemoteClient(cfg, callback) {
  if (cfg.driver === "ftp") {
    const client = new FtpClient(cfg.timeoutMs);
    try {
      await retryRemote(() => client.access({ host: cfg.host, port: cfg.port, user: cfg.user, password: cfg.password, secure: false }));
      await client.ensureDir(cfg.remoteDir);
      await callback(new FtpAdapter(client, cfg.remoteDir));
    } finally {
      client.close();
    }
    return;
  }

  const client = new SftpClient();
  try {
    await retryRemote(() => client.connect({
      host: cfg.host,
      port: cfg.port,
      username: cfg.user,
      password: cfg.password,
      readyTimeout: cfg.timeoutMs
    }));
    await client.mkdir(cfg.remoteDir, true);
    await callback(new SftpAdapter(client, cfg.remoteDir));
  } finally {
    await client.end().catch(() => {});
  }
}

async function uploadItemAssets(client, item) {
  const assets = [
    item.assets?.video,
    item.assets?.thumbnail,
    item.assets?.audio,
    ...(item.assets?.images || []),
    ...(item.assets?.clips || [])
  ].filter((asset) => asset?.path && asset?.url);

  for (const asset of assets) {
    const remotePath = remotePathFromAssetUrl(asset.url);
    if (!remotePath || remotePath.startsWith("http")) continue;
    await client.ensureDir(path.posix.dirname(remotePath));
    await client.upload(asset.path, remotePath);
  }
}

function remotePathFromAssetUrl(value) {
  const raw = String(value || "");
  if (!raw) return "";
  if (raw.startsWith("/generated/")) return raw.replace(/^\/generated\//, "");
  if (raw.startsWith("/")) return raw.replace(/^\/+/, "");
  try {
    const url = new URL(raw);
    const pathname = decodeURIComponent(url.pathname).replace(/^\/+/, "");
    const generatedIndex = pathname.indexOf("generated/");
    if (generatedIndex >= 0) return pathname.slice(generatedIndex + "generated/".length);
    const known = pathname.match(/(?:^|\/)(videos|thumbnails|images|audio|clips)\/[^/]+$/);
    return known ? known[0].replace(/^\/+/, "") : "";
  } catch {
    return "";
  }
}

async function retryRemote(fn, attempts = 3) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (attempt === attempts) break;
      await new Promise((resolve) => setTimeout(resolve, attempt * 3000));
    }
  }
  throw lastError;
}

async function uploadDir(client, localDir, remoteSubdir) {
  let entries = [];
  try {
    entries = await fs.readdir(localDir, { withFileTypes: true });
  } catch {
    return;
  }
  await client.ensureDir(remoteSubdir);
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    await client.upload(path.join(localDir, entry.name), path.posix.join(remoteSubdir, entry.name));
  }
}

async function uploadJsonFile(client, localPath, remotePath) {
  const raw = await fs.readFile(localPath, "utf8");
  await client.ensureDir(path.posix.dirname(remotePath));
  await client.uploadStream(Readable.from([Buffer.from(raw, "utf8")]), remotePath);
}

async function fileExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

class FtpAdapter {
  constructor(client, root) {
    this.client = client;
    this.root = root;
  }

  async ensureDir(dir) {
    await this.client.ensureDir(path.posix.join(this.root, dir));
  }

  async upload(localPath, remotePath) {
    await this.client.uploadFrom(localPath, path.posix.join(this.root, remotePath));
  }

  async uploadStream(stream, remotePath) {
    await this.client.uploadFrom(stream, path.posix.join(this.root, remotePath));
  }

  async list(remotePath) {
    const items = await this.client.list(path.posix.join(this.root, remotePath));
    return items.map((item) => ({
      name: item.name,
      isFile: item.isFile,
      size: item.size || 0,
      modifiedAt: item.modifiedAt || null
    }));
  }

  async remove(remotePath) {
    await this.client.remove(path.posix.join(this.root, remotePath));
  }

  async readFile(remotePath) {
    const chunks = [];
    const sink = new Writable({
      write(chunk, _encoding, callback) {
        chunks.push(Buffer.from(chunk));
        callback();
      }
    });
    await this.client.downloadTo(sink, path.posix.join(this.root, remotePath));
    return Buffer.concat(chunks).toString("utf8");
  }
}

class SftpAdapter {
  constructor(client, root) {
    this.client = client;
    this.root = root;
  }

  resolve(remotePath) {
    return path.posix.join(this.root, remotePath);
  }

  async ensureDir(dir) {
    await this.client.mkdir(this.resolve(dir), true);
  }

  async upload(localPath, remotePath) {
    await this.client.put(localPath, this.resolve(remotePath));
  }

  async uploadStream(stream, remotePath) {
    await this.client.put(stream, this.resolve(remotePath));
  }

  async list(remotePath) {
    const items = await this.client.list(this.resolve(remotePath));
    return items.map((item) => ({
      name: item.name,
      isFile: item.type === "-",
      size: item.size || 0,
      modifiedAt: item.modifyTime ? new Date(item.modifyTime) : null
    }));
  }

  async remove(remotePath) {
    await this.client.delete(this.resolve(remotePath));
  }

  async readFile(remotePath) {
    const data = await this.client.get(this.resolve(remotePath));
    if (Buffer.isBuffer(data)) return data.toString("utf8");
    if (typeof data === "string") return data;
    const chunks = [];
    for await (const chunk of data) chunks.push(Buffer.from(chunk));
    return Buffer.concat(chunks).toString("utf8");
  }
}
