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

/**
 * ## 为什么要按类型筛，而不是有名字就用
 *
 * 高德在居民区给的最近地物就是**小区名**（和悦云锦 `120302`、悦和城、公租房），
 * 甚至能细到**楼栋号**（「和悦云锦12栋」）。这一栏是公开展示的，访客上传的观测
 * 大多拍在自家附近 —— 把地名写到小区/楼栋，等于替拍摄者公布了住址。
 * 保护名录那套粗化只管**物种**（把珍稀植物的点糊到市+区），管不到这件事：
 * 这里泄露的是**人**，不是植物。所以在拼装这一层就得把住宅类摘掉，
 * 让它自然退回到街道级。
 *
 * 反过来，景区 / 公园 / 产业园区 / 校园这些恰恰是最有用的地名，必须留下
 * （圣水草原、成吉思汗陵旅游区、鄂尔多斯国家高新技术产业开发区）。
 *
 * 判据用高德自己的类型编码体系（POI 与 AOI 共用）：
 *   `12` = 商务住宅大类；其中 `1203` = 住宅区（小区/别墅/宿舍），`1202` = 产业园区。
 * 所以规则是「商务住宅大类一律不用，**产业园区除外**」。
 */
/**
 * 能当「地点」用的大类 —— 白名单而不是黑名单。
 *
 * 只按住宅过滤是不够的：过滤完之后兜底 POI 挑中的是**离得最近的那个商户**，
 * 于是出现「…青春山街道·隆升源美味牛肉拉面(珠江店)」「…·海川口腔」
 * 「…·中共鄂托克旗委巡察工作领导小组办公室」。植物不长在拉面馆里 ——
 * 这些只是碰巧 100 米内有个店，写进标本记录既误导又难看，而且店会关门、改名。
 *
 * 留下的是**地物**：景区、公园、湿地、园区、高速服务区、校园、村庄名、道路名。
 * 这类名字指的是一片地方，不是一门生意，几年后依然成立。
 * 匹配不上就退回街道级 —— 退回去永远是安全的。
 */
const PLACE_LIKE_TOP = [
  "风景名胜", // 景区、公园、广场、纪念地
  "交通设施服务", // 高速服务区（路边采集全靠它）、停车场
  "地名地址信息", // 村庄级地名、道路名（门牌/楼栋在下面单独排除）
  "科教文化服务", // 校园、博物馆
];

function isPublishable(typeStr: string): boolean {
  const t = typeStr.trim();
  if (!t) return true; // 没给类型就别瞎猜，交给距离和调用方判断

  // 中文三级类型串：「商务住宅;住宅区;住宅小区」
  if (t.includes(";")) {
    const [top, mid = ""] = t.split(";");
    if (mid.includes("产业园区")) return true; // 园区留下（它挂在商务住宅大类下）
    if (top.includes("商务住宅")) return false; // 其余住宅类摘掉
    // 「地名地址信息;门牌信息;楼栋号」—— 比小区名还精确到单元，绝不能上墙
    if (t.includes("门牌信息") || t.includes("楼栋号")) return false;
    // 「通行设施;临街院门」—— 大门不是地点，用它会把「圣水草原」和
    // 「圣水草原(入口)」拆成两种写法，同一个地方看着像两处
    if (top.includes("通行设施")) return false;
    return PLACE_LIKE_TOP.some((x) => top.includes(x));
  }

  // AOI 给的是 6 位数字编码，前两位就是大类
  if (/^\d{6}$/.test(t)) {
    if (t.startsWith("1202")) return true; // 产业园区
    if (t.startsWith("12")) return false; // 商务住宅大类（含 1203 住宅区、120000 泛指）
    // 11=风景名胜 14=科教文化 15=交通设施 19=地名地址信息
    return ["11", "14", "15", "19"].some((p) => t.startsWith(p));
  }
  return true;
}

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
  const aois = Array.isArray(regeocode.aois) ? (regeocode.aois as Record<string, unknown>[]) : [];
  const pois = Array.isArray(regeocode.pois) ? (regeocode.pois as Record<string, unknown>[]) : [];

  // 光按类型筛不够：住宅小区旁边总有**沾着小区名的非住宅 POI** ——
  // 「和悦云锦接待中心」(生活服务)、「百姓饭店(悦和城店)」(餐饮)、「和悦云锦12栋」。
  // 类型上它们清清白白，名字却把小区抖了个干净。所以先把这一带的住宅实体名收集起来，
  // 凡是名字里带上它的候选一律不用（`includes` 而非 `startsWith`，带括号的店名才拦得住）。
  const blocked: string[] = [];
  for (const x of [...aois, ...pois]) {
    const name = amapStr(x.name);
    if (name && !isPublishable(amapStr(x.type))) blocked.push(name);
  }
  const leaksHome = (name: string) => blocked.some((b) => name.includes(b));

  // AOI = 面状地物（公园、景区、园区、校园），点落在里面，比 POI 可靠，优先。
  // **不能直接取 aois[0]** —— 一个点常同时落在好几个 AOI 里（悦和城/公租房/万和城
  // 三个住宅 AOI 叠在一起），第一个恰好是住宅就把整条路堵死了。要挑第一个能公开的。
  for (const a of aois) {
    const name = amapStr(a.name);
    if (name && isPublishable(amapStr(a.type)) && !leaksHome(name)) {
      return admin ? `${admin}·${name}` : name;
    }
  }

  // 没有 AOI 再退到最近的 POI，且必须真的近 —— 远处的 POI 写进地名是撒谎。
  let best = "";
  let bestD = Infinity;
  for (const p of pois) {
    // `Number("")` 是 0 —— 距离缺失会被当成「就在脚下」，把一个不知多远的 POI
    // 写进地名。缺就是缺，直接跳过。
    const dRaw = amapStr(p.distance);
    if (!dRaw) continue;
    if (!isPublishable(amapStr(p.type))) continue; // 住宅/楼栋/院门都不作数
    const d = Number(dRaw);
    const n = amapStr(p.name);
    if (n && leaksHome(n)) continue; // 类型清白但名字带小区的，同样不用
    if (n && Number.isFinite(d) && d < bestD) {
      best = n;
      bestD = d;
    }
  }
  if (best && bestD <= POI_MAX_M) return admin ? `${admin}·${best}` : best;

  return admin;
}
