import fs from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { Client as FtpClient } from "basic-ftp";
import SftpClient from "ssh2-sftp-client";
import { paths } from "./config.js";

export function publicBaseUrl() {
  return String(process.env.PUBLIC_BASE_URL || "").replace(/\/+$/g, "");
}

export function remoteEnabled() {
  return ["ftp", "sftp"].includes(remoteConfig().driver);
}

export function remoteConfig() {
  const driver = String(process.env.UPLOAD_DRIVER || "sftp").toLowerCase();
  const prefix = driver === "ftp" ? "FTP" : "SFTP";
  const fallbackPrefix = prefix === "SFTP" ? "FTP" : "SFTP";
  const first = (name, fallback = "") => process.env[`${prefix}_${name}`] || process.env[`${fallbackPrefix}_${name}`] || fallback;
  return {
    driver,
    prefix,
    host: first("HOST"),
    port: Number(first("PORT", driver === "ftp" ? "21" : "22")),
    user: first("USER"),
    password: first("PASSWORD"),
    remoteDir: first("REMOTE_DIR"),
    timeoutMs: Number(first("UPLOAD_TIMEOUT_SECONDS", "1200")) * 1000
  };
}

export function assertRemoteConfig() {
  const cfg = remoteConfig();
  const missing = [];
  if (!cfg.host) missing.push(`${cfg.prefix}_HOST`);
  if (!cfg.user) missing.push(`${cfg.prefix}_USER`);
  if (!cfg.password) missing.push(`${cfg.prefix}_PASSWORD`);
  if (!cfg.remoteDir) missing.push(`${cfg.prefix}_REMOTE_DIR`);
  if (missing.length) throw new Error(`Remote upload config belum lengkap: ${missing.join(", ")}`);
  return cfg;
}

export async function uploadGeneratedStateAndAssets() {
  const cfg = assertRemoteConfig();
  await withRemoteClient(cfg, async (client) => {
    await uploadDir(client, paths.videoDir, "videos");
    await uploadDir(client, paths.imageDir, "images");
    await uploadDir(client, paths.audioDir, "audio");
    await uploadJsonFile(client, path.join(paths.dataDir, "items.json"), "state/items.json");
  });
}

export function absolutizeGeneratedUrls(item) {
  const base = publicBaseUrl();
  if (!base || !item) return item;
  const withUrl = (asset) => {
    if (!asset?.url) return asset;
    return { ...asset, url: `${base}${asset.url}` };
  };
  return {
    ...item,
    assets: {
      ...item.assets,
      video: withUrl(item.assets?.video),
      audio: withUrl(item.assets?.audio),
      images: (item.assets?.images || []).map(withUrl),
      clips: (item.assets?.clips || []).map(withUrl)
    }
  };
}

async function withRemoteClient(cfg, callback) {
  if (cfg.driver === "ftp") {
    const client = new FtpClient(cfg.timeoutMs);
    try {
      await client.access({ host: cfg.host, port: cfg.port, user: cfg.user, password: cfg.password, secure: false });
      await client.ensureDir(cfg.remoteDir);
      await callback(new FtpAdapter(client, cfg.remoteDir));
    } finally {
      client.close();
    }
    return;
  }

  const client = new SftpClient();
  try {
    await client.connect({
      host: cfg.host,
      port: cfg.port,
      username: cfg.user,
      password: cfg.password,
      readyTimeout: cfg.timeoutMs
    });
    await client.mkdir(cfg.remoteDir, true);
    await callback(new SftpAdapter(client, cfg.remoteDir));
  } finally {
    await client.end().catch(() => {});
  }
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
}
