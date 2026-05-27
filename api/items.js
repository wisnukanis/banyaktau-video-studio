import { methodAllowed, readRemoteItems, requireAuth, sendJson } from "./_utils.js";

export default async function handler(req, res) {
  if (!methodAllowed(req, res, ["GET"])) return;
  if (!requireAuth(req, res)) return;
  const items = normalizeAssetUrls(await readRemoteItems());
  sendJson(res, 200, {
    items: items.sort((a, b) => String(b.updatedAt || b.createdAt).localeCompare(String(a.updatedAt || a.createdAt)))
  });
}

function normalizeAssetUrls(items) {
  const publicBase = String(process.env.PUBLIC_BASE_URL || "").replace(/\/+$/g, "");
  const fix = (asset) => {
    if (!asset?.url) return asset;
    let url = String(asset.url);
    url = url.replace("https://banyaktau.emsa.pro/generated/", `${publicBase}/`);
    url = url.replace(`${publicBase}/generated/`, `${publicBase}/`);
    return { ...asset, url };
  };
  return (items || []).map((item) => ({
    ...item,
    assets: {
      ...item.assets,
      video: fix(item.assets?.video),
      audio: fix(item.assets?.audio),
      thumbnail: fix(item.assets?.thumbnail),
      images: (item.assets?.images || []).map(fix),
      clips: (item.assets?.clips || []).map(fix)
    }
  }));
}
