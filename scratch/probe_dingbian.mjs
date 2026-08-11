/**
 * 定边那两份，OSM 和高德给的镇不一样，得判谁对 —— 别拿记忆里的地理知识猜。
 * 做法：正向地理编码问出这几个镇的中心点，再算它们离实际拍摄点多远。
 *
 *   NODE_USE_ENV_PROXY=1 node --experimental-strip-types scratch/probe_dingbian.mjs
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

const hav = (a, b, c, d) => {
  const R = 6371, r = Math.PI / 180;
  const dLat = (c - a) * r, dLng = (d - b) * r;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a * r) * Math.cos(c * r) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
};

/** 两个争议点（WGS-84，来自库里） */
const PTS = [
  ["155. 裂叶滨藜", 37.8811, 107.8147, "OSM: 内蒙古…定边县白泥井镇", "高德: 内蒙古…鄂托克前旗城川镇"],
  ["205. 羊柴", 37.5627, 107.8219, "OSM: 陕西…定边县白泥井镇", "高德: 陕西…定边县砖井镇"],
];
/** 候选乡镇 —— 问高德要它们的中心点 */
const TOWNS = ["陕西省榆林市定边县白泥井镇", "陕西省榆林市定边县砖井镇", "内蒙古自治区鄂尔多斯市鄂托克前旗城川镇"];

const centers = {};
for (const t of TOWNS) {
  const u = `https://restapi.amap.com/v3/geocode/geo?key=${encodeURIComponent(KEY)}&address=${encodeURIComponent(t)}`;
  const d = await (await fetch(u)).json();
  const loc = d.status === "1" && d.geocodes?.[0]?.location;
  if (!loc) { console.log(`${t} → 查不到 (${d.info})`); continue; }
  const [lng, lat] = loc.split(",").map(Number);
  centers[t] = { lat, lng };
  console.log(`${t} 中心 ≈ ${lat.toFixed(4)},${lng.toFixed(4)}`);
  await new Promise((r) => setTimeout(r, 400));
}

for (const [label, lat, lng, osmSaid, amapSaid] of PTS) {
  const g = wgs84ToGcj02(lat, lng); // 镇中心是 GCJ-02，拍摄点要转过去再比
  console.log(`\n=== ${label}  (${lat},${lng}) ===`);
  console.log(`   ${osmSaid}\n   ${amapSaid}`);
  for (const [t, c] of Object.entries(centers)) {
    console.log(`   距 ${t.replace(/^.*?(县|旗)/, "")} 中心 ${hav(g.lat, g.lng, c.lat, c.lng).toFixed(1)} km`);
  }
}
