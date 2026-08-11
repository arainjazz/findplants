/**
 * 存量草稿的**拍摄地点重算** —— 拿库里的坐标重新反查一遍地名。
 *
 * 起因（2026-08-11 用户）：同物种「共 N 份」列表改成显示「坐标背后代表的地点」之后，
 * 猪毛蒿那 4 行全写「内蒙古自治区康巴什区」，彼此分不开。根子不在展示，在 `capture_place`
 * 本身 —— 它是识别当时 `reverseGeocode()` 写下的，而那版拼装规则丢了两级：
 *   · `region`（地级市，鄂尔多斯市）从没被读过；
 *   · 街道落在 `town`/`suburb`，被 `county||district||suburb` 的前两个永远挡住；
 *   · `city` 写成 `city||town||…`，把「伊金霍洛镇」当成市，拼出**镇在旗前面**的倒序。
 * 代码已修（src/lib/place-from-address.ts），但**已经写下的地名不会自己回头改**，靠这个脚本补。
 *
 * 拼装用的是与线上**同一个纯函数** `placeFromNominatimAddress` —— 脚本自己再抄一遍规则，
 * 正是让存量和新数据长成两个样子的最快方式（同 backfill_name_authority.mjs 的规矩）。
 *
 * 跑法（**默认只看不改**，`NODE_USE_ENV_PROXY=1` 不能省，理由见下面的闸门）：
 *   NODE_USE_ENV_PROXY=1 node --experimental-strip-types scratch/backfill_capture_place.mjs
 *   NODE_USE_ENV_PROXY=1 node --experimental-strip-types scratch/backfill_capture_place.mjs --limit 20
 *   NODE_USE_ENV_PROXY=1 node --experimental-strip-types scratch/backfill_capture_place.mjs --apply
 *
 *   --limit N   只处理最近的 N 份（先拿一小撮看看效果，别一上来就打 250 次外部接口）
 *   --apply     真正写库。不带就只打印对照表。
 *
 * ⚠️ Nominatim 是**免费公共服务**，用量政策要求最多 1 次/秒且带真实 User-Agent。
 * 这里固定 1.2 秒一发、串行跑；250 份约 5 分钟。别为了快改小它 —— 被封的是全站识别。
 *
 * ⚠️ 只动 `capture_place` 一列。坐标、照片、正文一个字不碰。
 */
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { placeFromNominatimAddress } from "../src/lib/place-from-address.ts";

const APPLY = process.argv.includes("--apply");
const LIMIT = process.argv.includes("--limit")
  ? Number(process.argv[process.argv.indexOf("--limit") + 1])
  : 0;

// .env 只读不打印（项目铁规矩：service-role key 不许出现在任何输出里）。
const env = Object.fromEntries(
  readFileSync(new URL("../.env", import.meta.url), "utf8")
    .split("\n")
    .map((l) => l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/))
    .filter(Boolean)
    .map((m) => [m[1], m[2].replace(/^["']|["']$/g, "").trim()]),
);
const SUPABASE_URL = env.SUPABASE_URL || env.VITE_SUPABASE_URL;
const SERVICE_KEY = env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SERVICE_KEY;
if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error("缺少 SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY（在 .env 里）");
  process.exit(1);
}
const db = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

const UA = "Plantspedia/1.0 (arainjazz@163.com)";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ⚠️ Node 的 fetch（undici）**默认不读 HTTP(S)_PROXY**，而 nominatim 是境外站，本机要走梯子
// 才通 —— 不带这个开关会 241 份齐刷刷 `fetch failed`，看着像被封了，其实一个包都没发出去。
// （curl 读环境变量，所以手动 curl 明明是通的，最容易在这里误判。）
// Supabase 那半不受影响：`NO_PROXY` 里已经配了直连，EnvHttpProxyAgent 认这个变量。
if (!process.env.NODE_USE_ENV_PROXY && (process.env.HTTPS_PROXY || process.env.https_proxy)) {
  console.error(
    "检测到本机配了 HTTPS_PROXY，但没开 NODE_USE_ENV_PROXY —— Node 的 fetch 会绕开代理、全军覆没。\n" +
      "请这样跑：\n  NODE_USE_ENV_PROXY=1 node --experimental-strip-types " +
      "scratch/backfill_capture_place.mjs" +
      process.argv.slice(2).map((a) => ` ${a}`).join(""),
  );
  process.exit(1);
}

/** 一次反查。失败返回 null（这一份跳过，绝不写空地名覆盖已有的）。 */
async function reverse(lat, lng) {
  const url = `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json&accept-language=zh-CN`;
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const resp = await fetch(url, { headers: { "User-Agent": UA } });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      return placeFromNominatimAddress((await resp.json()).address);
    } catch (e) {
      if (attempt === 2) {
        console.warn(`  ⚠️ 反查失败 ${lat},${lng}：${e.message}`);
        return null;
      }
      await sleep(3000);
    }
  }
  return null;
}

const { data, error } = await db
  .from("plant_drafts")
  .select("id, title, capture_lat, capture_lng, capture_place")
  .not("capture_lat", "is", null)
  .not("capture_lng", "is", null)
  .order("created_at", { ascending: false });
if (error) {
  console.error("查库失败：", error.message);
  process.exit(1);
}

const rows = LIMIT > 0 ? data.slice(0, LIMIT) : data;
console.log(`有坐标的草稿 ${data.length} 份，本次处理 ${rows.length} 份${APPLY ? "（--apply 会写库）" : "（dry-run，只看不改）"}\n`);

const changes = [];
const unchanged = [];
const failed = [];

for (let i = 0; i < rows.length; i++) {
  const d = rows[i];
  const next = await reverse(d.capture_lat, d.capture_lng);
  if (i < rows.length - 1) await sleep(1200);
  if (next === null) {
    failed.push(d);
    continue;
  }
  // 空结果绝不覆盖 —— 宁可留着旧地名，也不能把「在哪」抹成空白。
  if (!next) {
    failed.push(d);
    continue;
  }
  const old = (d.capture_place || "").trim();
  if (next === old) {
    unchanged.push(d);
    continue;
  }
  changes.push({ ...d, next, old });
  process.stdout.write(
    `${String(changes.length).padStart(3)}. ${(d.title || "(无题)").slice(0, 12).padEnd(12)} ` +
      `${d.capture_lat.toFixed(4)},${d.capture_lng.toFixed(4)}\n` +
      `     旧：${old || "(空)"}\n     新：${next}\n`,
  );
}

console.log(
  `\n── 汇总 ──\n改写 ${changes.length} 份 · 原样 ${unchanged.length} 份 · 反查失败 ${failed.length} 份`,
);

// ⚠️ 新地名比旧的短 = 这一份**丢了信息**（实测有这种：旧「…康巴什区鄂尔多斯市高新技术
// 产业园区」→ 新「…鄂尔多斯市康巴什区哈巴格希街道」，层级理顺了，但园区名没了）。
// 单独列出来给人过目 —— 这是 dry-run 存在的意义。
const shorter = changes.filter((c) => c.next.length < c.old.length);
if (shorter.length) {
  console.log(`\n⚠️ 其中 ${shorter.length} 份新地名比旧的短（可能丢了地标/园区名），逐条过目：`);
  for (const c of shorter) console.log(`   ${c.old}\n → ${c.next}`);
}

// 这一栏要靠地名把同一处的几份分开 —— 报一下改完之后到底分不分得开。
const byPlace = new Map();
for (const c of changes) byPlace.set(c.next, (byPlace.get(c.next) ?? 0) + 1);
const dup = [...byPlace.entries()].filter(([, n]) => n > 1).sort((a, b) => b[1] - a[1]);
if (dup.length) {
  console.log(`\nℹ️ 改完后仍有 ${dup.length} 个地名被多份共用（同一个镇/街道里拍的分不开）：`);
  for (const [p, n] of dup.slice(0, 8)) console.log(`   ${n} 份 · ${p}`);
}

if (!APPLY) {
  console.log("\n这是 dry-run。确认无误后加 --apply 真正写库。");
  process.exit(0);
}

let ok = 0;
for (const c of changes) {
  const { error: upErr } = await db
    .from("plant_drafts")
    .update({ capture_place: c.next })
    .eq("id", c.id);
  if (upErr) console.warn(`  ⚠️ 写失败 ${c.id}：${upErr.message}`);
  else ok++;
}
console.log(`\n✅ 已写库 ${ok}/${changes.length} 份。`);
