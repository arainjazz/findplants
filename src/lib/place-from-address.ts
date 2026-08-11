/**
 * Nominatim 的 `address` 对象 → 一条中文地名。
 *
 * 单独拆出来，是因为**两条路必须给出同一个答案**：识别时的 `reverseGeocode()`
 * （identify-plant.functions.ts）和存量回填脚本（scratch/backfill_capture_place.mjs）。
 * 脚本自己再抄一遍拼装规则，就是让存量数据和新数据长得不一样的最快方式。
 *
 * ## 为什么原来的拼法会丢东西（2026-08-11 实测两个真实坐标）
 * ```
 * 39.6441,109.8102  → {town:"哈巴格希街道", city:"康巴什区", region:"鄂尔多斯市", state:"内蒙古自治区"}
 * 39.42632,109.8058 → {town:"伊金霍洛镇", county:"伊金霍洛旗", region:"鄂尔多斯市", state:"内蒙古自治区"}
 * ```
 * 旧代码取的是 `province+city+county+road`，于是：
 *  - **`region` 从没被读过** —— 地级市（鄂尔多斯市）整个丢掉；
 *  - `city` 写成 `city || town || city_district`，第二个点的 `town`（伊金霍洛镇）被当成市，
 *    拼出「内蒙古自治区伊金霍洛镇伊金霍洛旗」这种**镇在旗前面**的倒序（库里一大片长这样）；
 *  - 街道落在 `town`/`suburb`，而 `county` 那一格写的是 `county||district||suburb`，
 *    前两个一命中，`suburb` 永远轮不到 —— 第一个点因此只剩「内蒙古自治区康巴什区」。
 *
 * ## 现在的阶梯
 * 省 → 地级市 → 区/县/旗 → 街道/镇 → 村/社区 → 路。中国的行政层级在 Nominatim 里
 * **不是按字段名对齐的**（区可能回在 `city` 里，市回在 `region` 里），所以每一级都列一串候选。
 */

/** Nominatim `address` 对象里我们会读的字段（其余忽略）。 */
export type NominatimAddress = Record<string, unknown>;

const LEVELS: string[][] = [
  // 省 / 自治区 / 直辖市
  ["state", "province"],
  // 地级市 / 盟 / 自治州 —— 旧代码整个漏掉的一级。
  // `city` 垫在最后：鄂尔多斯回在 `region`，但**全国多数地方地级市就写在 `city` 里**
  // （湖南衡阳：`city:衡阳市` + `county:衡阳县`）。不垫这一手，`city` 会被下面那级
  // 当区县吃掉，`county` 无处安放 → 「衡阳县」整级消失（dry-run 逮到 8 份）。
  ["region", "prefecture", "city"],
  // 区 / 县 / 旗 / 县级市（中国的「区」常常回在 city 里，别指望 district）
  ["county", "city_district", "district", "city", "municipality"],
  // 街道办事处 / 镇 / 乡 —— 用户 2026-08-11 要的就是这一级
  ["town", "township", "quarter"],
  // 园区 / 片区。**必须和上面那级分开列**：这两者是平级的两个名字，不是备选 ——
  // 39.6663,109.8402 同时有 `town:哈巴格希街道` 和 `suburb:鄂尔多斯市高新技术产业园区`，
  // 挤在同一级里就只能活一个，回填时 34 份因此把园区名弄丢了（dry-run 逮到的）。
  ["suburb", "industrial", "commercial"],
  // 村 / 社区
  ["village", "neighbourhood", "hamlet", "residential"],
  // 路
  ["road", "pedestrian", "footway"],
];

/** 拼出来的地名最长多少字。再长就不是地点、是导航指令了。 */
const MAX_LEN = 60;

/**
 * 一条地名里**只可能有一个**的行政单位后缀 —— 一个点不会同时落在两个街道里。
 * OSM 的 `suburb` 常常装的是与 `town` 边界重叠的另一个街道（哈巴格希街道 / 青春山街道
 * 就是这么撞上的，dry-run 里 21 份），拼在一起是自相矛盾，不是更细。
 *
 * **只禁这三个**：市/区/县 不能禁 —— 县级市套在地级市下（通辽市霍林郭勒市）完全合法，
 * 一刀切会把真实层级砍掉一半。
 */
const SOLE_SUFFIXES = ["街道", "镇", "乡"];
/** 「高新技术产业园区」要认成「园区」而不是「区」，所以长的排前面、取最长匹配。 */
const UNIT_SUFFIXES = [...SOLE_SUFFIXES, "开发区", "园区", "新区", "社区", "村"];
const unitSuffix = (v: string) => UNIT_SUFFIXES.find((s) => v.endsWith(s)) ?? "";

const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");

/**
 * 把 Nominatim 的 address 拼成「内蒙古自治区鄂尔多斯市康巴什区哈巴格希街道」。
 * 拿不到任何一级就返回空串，由调用方决定是退到 AI 还是干脆不写。
 */
export function placeFromNominatimAddress(addr: NominatimAddress | null | undefined): string {
  if (!addr) return "";
  const out: string[] = [];
  // 同名或已被上一级整个包含 = 这一格没带来新信息。直辖市的 state 与 city 都是「北京市」，
  // 直接拼会出现「北京市北京市」。反向（新的一级更长）不能算重复 —— 那是真多出来的信息。
  const covered = (v: string) => out.some((x) => x === v || x.includes(v));
  // OSM 里不少名字自带上级前缀（`suburb:"鄂尔多斯市高新技术产业园区"`），照拼会结巴成
  // 「…鄂尔多斯市康巴什区鄂尔多斯市高新技术产业园区」。前缀已经在串里了就摘掉。
  const dedupePrefix = (v: string) => {
    for (const x of out) if (v.startsWith(x) && v.length > x.length) return v.slice(x.length);
    return v;
  };
  // 已经有街道了就不再收第二个街道（见 SOLE_SUFFIXES）。
  const clashes = (v: string) => {
    const s = unitSuffix(v);
    return SOLE_SUFFIXES.includes(s) && out.some((x) => unitSuffix(x) === s);
  };
  for (const keys of LEVELS) {
    // **一格一格往下试，不能拿到第一个非空就收手**：北京的 `city` 就是「北京市」，
    // 与省级重复被丢掉之后，真正的区（`city_district`=海淀区）必须还有机会补上，
    // 否则整整一级凭空消失（离线断言里就是这一条先红的）。
    const v = keys
      .map((k) => dedupePrefix(str(addr[k])))
      .find((x) => x && !covered(x) && !clashes(x));
    if (!v) continue;
    if (out.join("").length + v.length > MAX_LEN) break;
    out.push(v);
  }
  return out.join("");
}
