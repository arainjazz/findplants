/**
 * `placeFromAmapRegeo()` 的离线断言。不打网、不需要 key：
 *   node --experimental-strip-types scratch/check_place_from_amap.mjs
 *
 * 每条对应高德的一个已知坑（空值是 `[]`、直辖市 city 为空、POI 距离缺失、
 * 名字自带上级前缀），最后一条是写这个文件时**当场逮到的真 bug**：
 * `Number("")` 是 0，距离缺失的 POI 会被当成「就在脚下」写进地名。
 */
import { placeFromAmapRegeo as f } from "../src/lib/place-from-amap.ts";

const ADMIN = {
  province: "内蒙古自治区",
  city: "鄂尔多斯市",
  district: "康巴什区",
  township: "哈巴格希街道",
};
const ADMIN_STR = "内蒙古自治区鄂尔多斯市康巴什区哈巴格希街道";

const CASES = [
  [
    "AOI 命中 —— 这才是换高德的理由",
    { addressComponent: ADMIN, aois: [{ name: "乌兰木伦湖景区", distance: "0" }], pois: [{ name: "某便利店", distance: "220" }] },
    `${ADMIN_STR}·乌兰木伦湖景区`,
  ],
  [
    "无 AOI，近 POI 顶上",
    { addressComponent: ADMIN, aois: [], pois: [{ name: "康巴什区第一小学", distance: "80" }, { name: "远处加油站", distance: "900" }] },
    `${ADMIN_STR}·康巴什区第一小学`,
  ],
  ["POI 超过 150 m 就不写", { addressComponent: ADMIN, aois: [], pois: [{ name: "远处加油站", distance: "900" }] }, ADMIN_STR],
  [
    "回归·POI 距离缺失不能当成 0",
    { addressComponent: ADMIN, aois: [], pois: [{ name: "没写距离的点" }] },
    ADMIN_STR,
  ],
  [
    "直辖市：city 是空数组而不是空串",
    { addressComponent: { province: "北京市", city: [], district: "海淀区", township: "中关村街道" }, aois: [], pois: [] },
    "北京市海淀区中关村街道",
  ],
  [
    "building / neighborhood 的空数组不能炸",
    { addressComponent: { province: "湖南省", city: "衡阳市", district: "衡阳县", township: [], building: { name: [] }, neighborhood: { name: [] } }, aois: [], pois: [] },
    "湖南省衡阳市衡阳县",
  ],
  [
    "名字自带上级前缀，去结巴",
    { addressComponent: { ...ADMIN, district: "鄂尔多斯市康巴什区" }, aois: [], pois: [] },
    ADMIN_STR,
  ],
  ["整个空", null, ""],
  ["只有省", { addressComponent: { province: "内蒙古自治区" } }, "内蒙古自治区"],
];

let bad = 0;
for (const [name, input, want] of CASES) {
  const got = f(input);
  const ok = got === want;
  if (!ok) bad++;
  console.log(`${ok ? "✅" : "❌"} ${name} → ${JSON.stringify(got)}${ok ? "" : `\n   期望 ${JSON.stringify(want)}`}`);
}
console.log(bad ? `\n❌ ${bad} 条不符` : `\n✅ ${CASES.length} 条全部通过`);
process.exit(bad ? 1 : 0);
