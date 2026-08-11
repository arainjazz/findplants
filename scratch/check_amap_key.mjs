/**
 * 高德 key 自检 —— 拿 `.env` 里的 `AMAP_KEY` 打一次真实的逆地理编码，
 * 告诉你这把 key 能不能用、以及用上之后地名会变成什么样。
 *
 *   NODE_USE_ENV_PROXY=1 node --experimental-strip-types scratch/check_amap_key.mjs
 *
 * 为什么需要它：高德的 key 在**创建时**就绑死了「服务平台」类型，而控制台的应用列表
 * 页面**不显示**这个类型。逆地理编码走 REST（restapi.amap.com），只认「Web服务」类型；
 * 如果手里那把是「Web端(JS API)」，调用会被拒 —— 但错误藏在 HTTP 200 的响应体里，
 * 肉眼看 curl 输出很容易以为是通的。这个脚本把常见错误码翻译成人话。
 *
 * 用的是库里真实的 5 份猪毛蒿坐标 —— 它们相距约 80 m，正是「换高德」要解决的那组。
 * 跑完直接就能看出高德到底分不分得开，不用先回填。
 */
import { readFileSync } from "node:fs";
import { placeFromAmapRegeo } from "../src/lib/place-from-amap.ts";
import { wgs84ToGcj02 } from "../src/lib/gcj02.ts";

const env = Object.fromEntries(
  readFileSync(new URL("../.env", import.meta.url), "utf8")
    .split("\n")
    .map((l) => l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/))
    .filter(Boolean)
    .map((m) => [m[1], m[2].replace(/^["']|["']$/g, "").trim()]),
);
const KEY = (env.AMAP_KEY || "").trim();
if (!KEY) {
  console.error("`.env` 里没有 AMAP_KEY。先加一行：AMAP_KEY=你的key");
  process.exit(1);
}
// 只回显长度和末 4 位，别把 key 打进日志/截图。
console.log(`读到 AMAP_KEY（${KEY.length} 位，末尾 ****${KEY.slice(-4)}）\n`);

/** 高德的错误码 → 人话 + 该怎么办。 */
const DIAGNOSIS = {
  INVALID_USER_KEY: "key 不对（打错了，或者已经被删/停用）。回控制台核对一遍。",
  USERKEY_PLAT_NOMATCH:
    "⚠️ 就是这个 —— key 的「服务平台」类型不对。这把是给 JS API / Android / iOS 用的，" +
    "逆地理编码要的是**Web服务**类型。回控制台给同一个应用「添加Key」，服务平台选「Web服务」。",
  INVALID_USER_SCODE: "安全密钥(scode)校验没过 —— 这是 JS API 那套东西，说明 key 类型选错了。",
  SERVICE_NOT_AVAILABLE: "这个 key 没开通逆地理编码服务。",
  DAILY_QUERY_OVER_LIMIT: "今天的免费额度用完了，明天再试（或去控制台看配额）。",
  ACCESS_TOO_FREQUENT: "调太快被限流了。脚本已经按 3 QPS 节流，若仍报请把间隔调大。",
  INVALID_PARAMS: "参数不对 —— 大概率是经纬度顺序反了（高德要 经度,纬度）。",
  USER_KEY_RECYCLED: "key 已被回收。重新建一把。",
};

// 库里真实的 5 份猪毛蒿（WGS-84），彼此约 80 m —— 就是要靠地名分开的那组。
const PTS = [
  [39.6441, 109.8102],
  [39.6442, 109.8102],
  [39.6441, 109.8103],
  [39.6445, 109.8105],
  [39.6448, 109.8106],
];
const OLD = "内蒙古自治区鄂尔多斯市康巴什区哈巴格希街道"; // 回填后库里现在的值，5 份一模一样

const results = [];
for (let i = 0; i < PTS.length; i++) {
  const [lat, lng] = PTS[i];
  const g = wgs84ToGcj02(lat, lng);
  const url =
    `https://restapi.amap.com/v3/geocode/regeo?key=${encodeURIComponent(KEY)}` +
    `&location=${g.lng.toFixed(6)},${g.lat.toFixed(6)}&extensions=all&radius=200`;
  try {
    const resp = await fetch(url);
    const data = await resp.json();
    // 高德失败也是 HTTP 200，必须看 status 字段。
    if (data.status !== "1") {
      const code = data.infocode ? `${data.info}(${data.infocode})` : data.info;
      console.error(`\n❌ 高德拒绝了这次调用：${code}`);
      const hint = DIAGNOSIS[data.info];
      console.error(hint ? `\n👉 ${hint}` : "\n👉 没见过这个错误码，把它贴给我。");
      process.exit(1);
    }
    results.push(placeFromAmapRegeo(data.regeocode));
  } catch (e) {
    console.error(`❌ 请求失败：${e.message}（本机代理抖动的话重跑一次）`);
    process.exit(1);
  }
  if (i < PTS.length - 1) await new Promise((r) => setTimeout(r, 400));
}

console.log("✅ key 可用。这 5 份猪毛蒿（彼此约 80 m）会变成：\n");
results.forEach((r, i) => console.log(`  ${i + 1}. ${r}`));
const distinct = new Set(results);
console.log(`\n现在（OSM）：5 份全是「${OLD}」，1 种写法`);
console.log(`换高德后：${distinct.size} 种写法`);
console.log(
  distinct.size > 1
    ? "\n🎉 分得开了 —— 值得回填。下一步：\n   NODE_USE_ENV_PROXY=1 node --experimental-strip-types scratch/backfill_capture_place.mjs"
    : "\n😐 高德在这几个点上也只给到同一个名字 —— 这一带确实没有更细的地物。\n   回填仍会让全站地名更准，但这 5 份还是分不开，得另想办法（相对方位+距离）。",
);
