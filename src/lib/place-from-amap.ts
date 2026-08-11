/**
 * 高德逆地理编码（regeo）的 `regeocode` 对象 → 一条中文地名。
 *
 * ## 为什么不复用 place-from-address.ts 那套阶梯
 * OSM 那套「每级列一串候选逐格试」的复杂度，全是为了对付 Nominatim **字段名与行政层级
 * 对不上**（区回在 `city` 里、地级市回在 `region` 里）。高德没有这个毛病：
 * `province/city/district/township` 就是字面意思。硬套阶梯只会把简单事做复杂。
 *
 * ## 高德自己的坑（都实打实踩过或有明确文档）
 * 1. **空值是 `[]` 不是 `""`** —— 直辖市的 `city`、没有建筑物时的 `building.name`
 *    都回空数组。`String([])` 得到 `""` 看着没事，但 `addr.city || ""` 这种写法遇到
 *    `[]` 会**当成真值**，拼出 `[object Object]` 或空洞。必须显式判数组。
 * 2. **必须 `extensions=all` 才有 `pois`/`aois`** —— 而这两样正是把相距几十米的点
 *    分开的**唯一**依据；只要行政区划的话，换高德毫无意义。
 * 3. `city` 在直辖市为空，此时 `province` 已经是「北京市」，别再补一个。
 *
 * ⚠️ 调用方务必先把 WGS-84 转成 GCJ-02（见 gcj02.ts）—— 这是换高德最容易漏、
 * 漏了又不报错的一步。
 */

/** 高德把「没有」表示成空数组，`typeof` 判不出来。 */
function amapStr(v: unknown): string {
  if (typeof v === "string") return v.trim();
  if (typeof v === "number") return String(v);
  return ""; // [] / null / undefined / {} 一律当没有
}

/** POI 超过这个距离就不算「在这儿」，只是碰巧最近，写进地名会误导。 */
const POI_MAX_M = 150;

export type AmapRegeocode = Record<string, unknown>;

/**
 * 拼成「内蒙古自治区鄂尔多斯市康巴什区哈巴格希街道·XX公园」。
 *
 * 行政区划部分与 Nominatim 那条路保持同样的顺序与口径；真正多出来的是末尾那个
 * AOI/POI —— 它才是同一个街道里的两份能分开的原因。
 */
export function placeFromAmapRegeo(regeocode: AmapRegeocode | null | undefined): string {
  if (!regeocode) return "";
  const comp = (regeocode.addressComponent ?? {}) as Record<string, unknown>;

  const parts: string[] = [];
  const push = (raw: string) => {
    let v = raw;
    if (!v) return;
    // 高德也会自带上级前缀，同 Nominatim 那边的处理：已经在串里的前缀摘掉。
    for (const x of parts) if (v.startsWith(x) && v.length > x.length) v = v.slice(x.length);
    if (!v) return;
    if (parts.some((x) => x === v || x.includes(v))) return;
    parts.push(v);
  };

  push(amapStr(comp.province));
  push(amapStr(comp.city)); // 直辖市这里是 []，上面的 amapStr 会吃掉
  push(amapStr(comp.district));
  push(amapStr(comp.township));

  const admin = parts.join("");

  // —— 到这里为止都还只是「哪个街道」，跟 Nominatim 打平。下面这段才是换高德的理由 ——
  // AOI = 面状地物（公园、小区、校园），点落在里面，比 POI 可靠，优先。
  const aois = Array.isArray(regeocode.aois) ? (regeocode.aois as Record<string, unknown>[]) : [];
  const aoiName = amapStr(aois[0]?.name);
  if (aoiName) return admin ? `${admin}·${aoiName}` : aoiName;

  // 没有 AOI 再退到最近的 POI，且必须真的近 —— 远处的 POI 写进地名是撒谎。
  const pois = Array.isArray(regeocode.pois) ? (regeocode.pois as Record<string, unknown>[]) : [];
  let best = "";
  let bestD = Infinity;
  for (const p of pois) {
    // `Number("")` 是 0 —— 距离缺失会被当成「就在脚下」，把一个不知多远的 POI
    // 写进地名。缺就是缺，直接跳过。
    const dRaw = amapStr(p.distance);
    if (!dRaw) continue;
    const d = Number(dRaw);
    const n = amapStr(p.name);
    if (n && Number.isFinite(d) && d < bestD) {
      best = n;
      bestD = d;
    }
  }
  if (best && bestD <= POI_MAX_M) return admin ? `${admin}·${best}` : best;

  return admin;
}
