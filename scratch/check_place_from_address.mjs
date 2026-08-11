/**
 * `placeFromNominatimAddress()` 的离线断言。不打网，随时可跑：
 *   node --experimental-strip-types scratch/check_place_from_address.mjs
 *
 * 每一条都是**真实回包**或真实回归，不是想出来的边界：前 5 条直接抄自 2026-08-11/12
 * 打 Nominatim 拿到的 `address` 对象，第 4、5 条是全量 dry-run 逮到的两处倒退
 * （双街道叠字、衡阳县整级消失），第 6 条是修那两处时差点误伤的县级市。
 */
import { placeFromNominatimAddress as f } from "../src/lib/place-from-address.ts";

const CASES = [
  [
    "真实·康巴什（地级市回在 region）",
    { town: "哈巴格希街道", city: "康巴什区", region: "鄂尔多斯市", state: "内蒙古自治区" },
    "内蒙古自治区鄂尔多斯市康巴什区哈巴格希街道",
  ],
  [
    "真实·伊金霍洛（旧数据这里是镇在旗前面的倒序）",
    { town: "伊金霍洛镇", county: "伊金霍洛旗", region: "鄂尔多斯市", state: "内蒙古自治区" },
    "内蒙古自治区鄂尔多斯市伊金霍洛旗伊金霍洛镇",
  ],
  [
    "真实·园区与街道并存，两个都要留",
    {
      suburb: "鄂尔多斯市高新技术产业园区",
      town: "哈巴格希街道",
      city: "康巴什区",
      region: "鄂尔多斯市",
      state: "内蒙古自治区",
    },
    "内蒙古自治区鄂尔多斯市康巴什区哈巴格希街道高新技术产业园区",
  ],
  [
    "回归·suburb 装的是另一个街道，只能留一个",
    {
      suburb: "青春山街道",
      town: "哈巴格希街道",
      city: "康巴什区",
      region: "鄂尔多斯市",
      state: "内蒙古自治区",
      road: "呼和塔拉路",
    },
    "内蒙古自治区鄂尔多斯市康巴什区哈巴格希街道呼和塔拉路",
  ],
  [
    "回归·衡阳：地级市写在 city 里，county 不能没位置",
    { state: "湖南省", city: "衡阳市", county: "衡阳县", road: "许广高速" },
    "湖南省衡阳市衡阳县许广高速",
  ],
  [
    "县级市套地级市是合法的，别被去重误杀",
    { state: "内蒙古自治区", city: "通辽市", county: "霍林郭勒市", town: "珠斯花街道" },
    "内蒙古自治区通辽市霍林郭勒市珠斯花街道",
  ],
  [
    "直辖市：state 与 city 同名，区必须还能补位",
    { state: "北京市", city: "北京市", city_district: "海淀区", road: "中关村大街" },
    "北京市海淀区中关村大街",
  ],
  [
    "名字自带上级前缀，去掉结巴",
    { state: "内蒙古自治区", region: "鄂尔多斯市", suburb: "鄂尔多斯市高新技术产业园区" },
    "内蒙古自治区鄂尔多斯市高新技术产业园区",
  ],
  [
    "乡 + 村并存",
    {
      state: "河南省",
      city: "南阳市",
      city_district: "卧龙区",
      town: "七里园乡",
      village: "柳树店",
      road: "S231",
    },
    "河南省南阳市卧龙区七里园乡柳树店S231",
  ],
  ["旧 province 字段也认", { province: "陕西省", region: "榆林市", county: "定边县" }, "陕西省榆林市定边县"],
  ["空对象", {}, ""],
  ["null", null, ""],
  ["只有省", { state: "内蒙古自治区" }, "内蒙古自治区"],
];

let bad = 0;
for (const [name, addr, want] of CASES) {
  const got = f(addr);
  const ok = got === want;
  if (!ok) bad++;
  console.log(`${ok ? "✅" : "❌"} ${name} → ${JSON.stringify(got)}${ok ? "" : `\n   期望 ${JSON.stringify(want)}`}`);
}
console.log(bad ? `\n❌ ${bad} 条不符` : `\n✅ ${CASES.length} 条全部通过`);
process.exit(bad ? 1 : 0);
