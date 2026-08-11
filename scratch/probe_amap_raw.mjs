/**
 * 看高德 regeo 的原始 `aois`/`pois` 长什么样 —— 尤其是 **type 字段**，
 * 用来判断能不能按类型把「住宅小区」摘掉（小区名 = 拍摄者住哪，不该公开）。
 *
 *   NODE_USE_ENV_PROXY=1 node --experimental-strip-types scratch/probe_amap_raw.mjs
 *
 * 只打印类型/名称/距离，不打印 key。
 */
import { readFileSync } from "node:fs";
import { wgs84ToGcj02 } from "../src/lib/gcj02.ts";

const env = Object.fromEntries(
  readFileSync(new URL("../.env", import.meta.url), "utf8")
    .split("\n")
    .map((l) => l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/))
    .filter(Boolean)
    .map((m) => [m[1], m[2].replace(/^["']|["']$/g, "").trim()]),
);
const KEY = (env.AMAP_KEY || "").trim();
if (!KEY) process.exit((console.error("`.env` 里没有 AMAP_KEY"), 1));

const PTS = [
  ["猪毛蒿·和悦云锦", 39.6441, 109.8102],
  ["猪毛蒿·和悦云锦(另一份)", 39.6448, 109.8106],
  ["矢车菊·悦和城", 39.66631, 109.84021],
  ["成吉思汗陵旅游区", 39.4263, 109.8058],
  ["东莞·熙园山院", 22.7473, 114.1287],
];

for (const [label, lat, lng] of PTS) {
  const g = wgs84ToGcj02(lat, lng);
  const url =
    `https://restapi.amap.com/v3/geocode/regeo?key=${encodeURIComponent(KEY)}` +
    `&location=${g.lng.toFixed(6)},${g.lat.toFixed(6)}&extensions=all&radius=200`;
  const data = await (await fetch(url)).json();
  if (data.status !== "1") {
    console.log(`\n=== ${label} === 失败：${data.info}`);
    continue;
  }
  const r = data.regeocode;
  console.log(`\n=== ${label} (${lat},${lng}) ===`);
  console.log("formatted:", r.formatted_address);
  const aois = Array.isArray(r.aois) ? r.aois : [];
  const pois = Array.isArray(r.pois) ? r.pois : [];
  console.log(
    "AOIs:",
    aois.length
      ? aois.map((a) => `${a.name} [type=${a.type}] d=${a.distance}`).join(" | ")
      : "(无)",
  );
  console.log(
    "POIs(前5):",
    pois
      .slice(0, 5)
      .map((p) => `${p.name} [${p.type}] d=${p.distance}`)
      .join(" | ") || "(无)",
  );
  await new Promise((r) => setTimeout(r, 400));
}
