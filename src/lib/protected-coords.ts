/**
 * 重点保护物种的**坐标脱敏**（坐标模糊化）。
 *
 * 目的只有一个：**防止不法盗挖**。本站的分布点全部来自真实 GPS，精度到米级 —— 对一株
 * 四合木、绵刺或半日花，这等于把它的位置公开挂在网上。凡是命中「国家和各省重点保护
 * 野生植物名录」的记录，对外一律只给模糊坐标。
 *
 * ## 算法：定格 + 定点抖动（同 iNaturalist 的 obscured coordinates 思路）
 * 把真实坐标落进一个 {@link FUZZ_CELL_DEG} 见方的格子，然后在**同一个格子内**按记录 id
 * 哈希出一个固定的点作为对外坐标。两条性质缺一不可：
 *
 *  1. **对外点与真实点同格** —— 攻击者能推出的上限就是「在这个格子里」，格子多大、
 *     信息损失就有多大，可量化、可解释。
 *  2. **同一条记录永远得到同一个模糊点** —— 绝不能每次请求随机抖动，否则多刷几次取
 *     平均就把真实位置还原出来了（这是坐标脱敏最经典的翻车方式）。
 *
 * 0.05° 在鄂尔多斯（北纬 ~39.6°）约合南北 5.6 km × 东西 4.3 km ≈ 24 km²。在这个面积
 * 里找一株特定的草本，实际上不可行；而地图上「这个种出现在鄂尔多斯哪一片」仍然读得出来。
 * 要更严就调大这一个常数（0.2° 是 iNaturalist 的取值，约 500 km²），全站四处显示会同步跟着变。
 *
 * ## 只脱敏坐标是不够的：地点文字同样要粗化
 * `capture_place` 是逆地理编码来的自由文本，粒度从「鄂尔多斯市」一直到**整条街道地址**
 * 都有（见 CLAUDE.md）。把坐标模糊到 5 km、旁边却写着「XX街道XX号」，等于没做。所以
 * {@link coarsenPlace} 会把地点砍到区/县/旗一级，砍不出来就整个隐去。
 */

import { parsePlace } from "@/lib/editor-stats";

/**
 * 模糊格子的边长（度）。改这一个数就改变全站的脱敏强度。
 * 0.05° ≈ 24 km²（北纬 40° 附近）；0.2° ≈ 500 km²（iNaturalist 的取值）。
 */
export const FUZZ_CELL_DEG = 0.05;

/** 地图上给所有人看的提示语 —— 全站只此一份，改文案改这里。 */
export const FUZZ_NOTICE = "保护物种坐标已进行模糊化处理";

/** 坐标数字后面的括号提示（分享卡 / 草稿页 / 地图气泡通用）。 */
export const FUZZ_SUFFIX = "（已模糊）";

/** 脱敏坐标的橙色。分享卡（canvas）与网页（内联 style）用同一个色值，两处必须一致。 */
export const FUZZ_ORANGE = "#ea7317";

/** 鼠标悬停 / 无障碍读出的长解释。 */
export const FUZZ_EXPLAIN =
  `该物种命中国家或省级重点保护野生植物名录，为防止盗挖，对外显示的坐标已做模糊化处理` +
  `（随机落在约 ${FUZZ_CELL_DEG}° 见方的范围内），不是采集点的真实位置。`;

/**
 * djb2 + 一轮 xorshift-multiply 雪崩。纯函数、跨端结果一致。
 *
 * ⚠️ 那轮雪崩不是装饰，是**实测踩出来的**：光用 djb2（conservation.ts 的 manualTagTone
 * 那份）时，只改结尾几个字符**只有低位会变**，而 {@link frac} 取的是高位主导的 h/2³²。
 * 于是 `id:lat` 与 `id:lng` 算出来的小数只差 ~1.2e-7，换算成偏移差 ~6e-9 度，被 r6 一舍
 * 就完全相等 —— 模糊点因此**永远落在格子对角线上**（线上四条记录全中）。
 * 这不泄露真实位置（偏移只由 id 决定），但一眼就能看出是算出来的假点，也白扔了一维随机性。
 */
function hash32(s: string): number {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0;
  h ^= h >>> 16;
  h = Math.imul(h, 0x7feb352d) >>> 0;
  h ^= h >>> 15;
  h = Math.imul(h, 0x846ca68b) >>> 0;
  h ^= h >>> 16;
  return h >>> 0;
}

/** 哈希 → [0,1) 的定值小数。 */
const frac = (s: string): number => hash32(s) / 4294967296;

/**
 * 把一个真实坐标换成同格子内的固定模糊点。
 *
 * @param seed 记录的稳定标识（用草稿 id）。**必须逐条稳定**：同一条记录每次都要得到
 *   同一个模糊点，否则可以靠重复采样求平均还原真实坐标。
 */
export function fuzzCoord(lat: number, lng: number, seed: string): { lat: number; lng: number } {
  const cell = FUZZ_CELL_DEG;
  const latCell = Math.floor(lat / cell);
  const lngCell = Math.floor(lng / cell);
  const r6 = (n: number) => Math.round(n * 1e6) / 1e6;
  // 判别词放**前缀**：djb2 是流式的，写在前面后续每个字符都会把它继续搅开，
  // 比挂在结尾（只影响低位）稳当得多。与 hash32 的雪崩两道保险。
  return {
    lat: r6((latCell + frac(`lat:${seed}`)) * cell),
    lng: r6((lngCell + frac(`lng:${seed}`)) * cell),
  };
}

/**
 * 坐标文字。模糊坐标只留 2 位小数（≈1 km）—— 一个被模糊到 5 km 的数字写成 4 位小数
 * （≈11 m）本身就是在撒谎，虚假的精度比不给数字更误导。
 */
export function formatCoordPair(lat: number, lng: number, fuzzed: boolean): string {
  const d = fuzzed ? 2 : 4;
  return `${lat.toFixed(d)}, ${lng.toFixed(d)}`;
}

/**
 * 把识别地点粗化到区/县/旗一级；解析不出行政区划（纯街道地址、地标名等）就返回空串，
 * 由调用方决定显示成「地点已隐去」还是干脆不显示。
 *
 * 注意与 `displayPlace()` 的区别：那个在解析失败时**原样返回**（宁可保留信息），
 * 这里必须反过来 —— 解析失败正是「这串文字很可能是精确到街道的地址」的信号。
 */
export function coarsenPlace(place: string | null | undefined): string {
  if (!place) return "";
  const { province, city, district } = parsePlace(place);
  const head = city || province;
  if (head && district && district !== head) return head + district;
  return head || district || "";
}
