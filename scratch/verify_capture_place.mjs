/**
 * 回填之后**直接查库**核对 —— dry-run 日志好看不算数，要看库里真正存的是什么。
 *   NODE_USE_ENV_PROXY=1 node --experimental-strip-types scratch/verify_capture_place.mjs
 */
import { readFileSync } from "node:fs";

const env = Object.fromEntries(
  readFileSync(new URL("../.env", import.meta.url), "utf8")
    .split("\n")
    .map((l) => l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/))
    .filter(Boolean)
    .map((m) => [m[1], m[2].replace(/^["']|["']$/g, "").trim()]),
);
const URL_ = env.SUPABASE_URL || env.VITE_SUPABASE_URL;
const KEY = env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SERVICE_KEY;
if (!URL_ || !KEY) process.exit((console.error("`.env` 缺 SUPABASE_URL / SERVICE_ROLE_KEY"), 1));

const rows = await (
  await fetch(
    `${URL_}/rest/v1/plant_drafts?select=id,title,capture_place,capture_lat,capture_lng&capture_lat=not.is.null&limit=2000`,
    { headers: { apikey: KEY, Authorization: `Bearer ${KEY}` } },
  )
).json();

console.log(`有坐标的草稿：${rows.length} 份\n`);

// 1) 住宅泄露体检 —— 这是这一版最该守住的东西
const HOME_WORDS = ["和悦云锦", "悦和城", "万和城", "熙园山院", "公租房", "忠和楼", "嘉奥楼", "栋", "小区", "别墅", "家园", "府邸"];
const leaks = rows.filter((r) => HOME_WORDS.some((w) => (r.capture_place || "").includes(w)));
console.log(`① 住宅类词命中：${leaks.length} 份 ${leaks.length ? "❌" : "✅"}`);
for (const l of leaks.slice(0, 10)) console.log(`     ${l.title} · ${l.capture_place}`);

// 2) 商户体检
const BIZ = ["拉面", "口腔", "酒店", "宾馆", "饭店", "超市", "诊所", "办公室"];
const biz = rows.filter((r) => BIZ.some((w) => (r.capture_place || "").includes(w)));
console.log(`\n② 商户类词命中：${biz.length} 份 ${biz.length ? "⚠️" : "✅"}`);
for (const b of biz.slice(0, 10)) console.log(`     ${b.title} · ${b.capture_place}`);

// 3) 那 5 份猪毛蒿现在长什么样
console.log(`\n③ 康巴什那几份猪毛蒿：`);
for (const r of rows.filter((r) => r.title === "猪毛蒿" && Number(r.capture_lat) > 39.6)) {
  console.log(`     ${Number(r.capture_lat).toFixed(4)},${Number(r.capture_lng).toFixed(4)} → ${r.capture_place}`);
}

// 4) 粒度总览
const withPoi = rows.filter((r) => (r.capture_place || "").includes("·")).length;
const distinct = new Set(rows.map((r) => r.capture_place)).size;
console.log(`\n④ 共 ${distinct} 种写法；带「·地物」后缀的 ${withPoi} 份`);
const empty = rows.filter((r) => !r.capture_place).length;
console.log(`   空地名 ${empty} 份 ${empty ? "⚠️" : "✅"}`);
