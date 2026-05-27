import fs from "node:fs/promises";
import path from "node:path";
import { paths } from "./config.js";

const itemsFile = path.join(paths.dataDir, "items.json");

async function readJson(file, fallback) {
  try {
    return JSON.parse(await fs.readFile(file, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return fallback;
    throw error;
  }
}

async function writeJson(file, value) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  await fs.writeFile(tmp, `${JSON.stringify(value, null, 2)}\n`);
  await fs.rename(tmp, file);
}

export async function listItems() {
  const items = await readJson(itemsFile, []);
  return items.sort((a, b) => String(b.updatedAt || b.createdAt).localeCompare(String(a.updatedAt || a.createdAt)));
}

export async function getItem(id) {
  const items = await readJson(itemsFile, []);
  return items.find((item) => item.id === id) || null;
}

export async function saveItem(item) {
  const items = await readJson(itemsFile, []);
  const index = items.findIndex((row) => row.id === item.id);
  if (index >= 0) items[index] = item;
  else items.push(item);
  await writeJson(itemsFile, items);
  return item;
}
