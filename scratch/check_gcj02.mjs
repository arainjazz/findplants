/**
 * WGS-84 ↔ GCJ-02 转换的离线断言。不打网：
 *   node --experimental-strip-types scratch/check_gcj02.mjs
 *
 * 这里**不校验某个坐标转出来等于某个记住的常数** —— 那种「参考值」多半是从记忆里
 * 抄的，抄错了断言反而给错误盖章。改为校验能自证的性质：往返闭合、境内偏移量级、
 * 境外不动。最要紧的是第 2 组：偏移量必须远大于我们要分辨的距离，
 * 否则「换高德」这件事从根上就是错的。
 */
import { wgs84ToGcj02, gcj02ToWgs84 } from "../src/lib/gcj02.ts";

const R = 6371000;
const rad = (d) => (d * Math.PI) / 180;
const dist = (a, b, c, d) => {
  const dLat = rad(c - a);
  const dLng = rad(d - b);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a)) * Math.cos(rad(c)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
};

let bad = 0;
const ck = (ok, msg) => {
  if (!ok) bad++;
  console.log(`${ok ? "✅" : "❌"} ${msg}`);
};

// 真实用到的点：库里这几份就是要靠地名分开的
const PTS = [
  [39.6441, 109.8102, "猪毛蒿·康巴什"],
  [39.4263, 109.8058, "伊金霍洛"],
  [39.9085, 116.3913, "北京"],
  [31.2304, 121.4737, "上海"],
];

for (const [la, ln, name] of PTS) {
  const g = wgs84ToGcj02(la, ln);
  const d = dist(la, ln, g.lat, g.lng);
  console.log(`   ${name}：偏移 ${d.toFixed(0)} m`);
  ck(d > 100 && d < 800, `${name} 偏移落在中国境内常见的 100–800 m 区间`);
}

// 换高德的**全部意义**就是分辨相距约 80 m 的几份观测。偏移比它大一个量级，
// 不转换 = 报出几百米外那个地方的名字，比现在只到街道更糟。
const g = wgs84ToGcj02(39.6441, 109.8102);
ck(
  dist(39.6441, 109.8102, g.lat, g.lng) > 80 * 3,
  "偏移量 > 待分辨距离(80m)的 3 倍 —— 不转换必然张冠李戴",
);

for (const [la, ln, name] of PTS) {
  const gg = wgs84ToGcj02(la, ln);
  const w = gcj02ToWgs84(gg.lat, gg.lng);
  ck(dist(la, ln, w.lat, w.lng) < 1.0, `${name} 往返闭合 < 1 m`);
}

for (const [la, ln, name] of [
  [48.8566, 2.3522, "巴黎"],
  [40.7128, -74.006, "纽约"],
  [-33.8688, 151.2093, "悉尼"],
]) {
  const o = wgs84ToGcj02(la, ln);
  ck(o.lat === la && o.lng === ln, `${name} 境外不做偏移`);
}

console.log(bad ? `\n❌ ${bad} 条不符` : "\n✅ 全部通过");
process.exit(bad ? 1 : 0);
