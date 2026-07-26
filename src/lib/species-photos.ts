/**
 * 物种配图的**许可与署名**。
 *
 * 起因（2026-07-20 实测，不是推断）：站内配图来自 iNaturalist / GBIF，抓下来后由
 * `rehostImages` 转存进我们自己的 Supabase bucket 并公开展示，**全程不带任何署名**。
 * 而 iNat 上 research-grade 观测里有相当大一部分是 **`license_code: null`
 * = 保留所有权利**：
 *
 *   沙冬青 8/20 · 柠条锦鸡儿 22/40 · 玫瑰 9/40 · 蒲公英 9/40
 *
 * 也就是说线上每张配图里有四到五成，我们既没有使用许可、也没有署名。这不是"少写了
 * 一行 credit"的体面问题，是实打实的侵权敞口。
 *
 * 本模块做两件事：
 *   1. **准入**：只接受明确授权可复用的许可（见 REUSABLE_LICENSES）。
 *   2. **署名**：把摄影者 / 许可证 / 原始页面一路带到渲染层，落在图注上。
 *
 * 纯函数、无网络无数据库 —— `scratch/species-photos.test.mjs` 直接跑本体。
 */

/** 图里主要展示的部位。CP4b 的视觉验证会填这个字段；现在由数据源的标注给出。 */
export type Organ = "leaf" | "flower" | "fruit" | "plant" | "habitat" | "specimen" | "";

export type PhotoCandidate = {
  url: string;
  organ: Organ;
  /** 拍摄地点（多样性挑选用） */
  place: string;
  /** 月份，用于错开物候 */
  season: string;
  /** 摄影者 id / 名字（多样性挑选 + 署名） */
  who: string;
  /** 原始许可代码，统一小写；`""` = 数据源没给（按保留所有权利处理） */
  license: string;
  /** 数据源直接给的成品署名串（iNat 的 `attribution` 字段），可能为空 */
  attribution: string;
  /** 原始观测/图片页，署名要可点回去 */
  sourceUrl: string;
  /** 数据源名，如 iNaturalist / GBIF / Wikimedia Commons */
  sourceName: string;
};

/**
 * 允许复用的许可。**`null` / 空 / 未知一律拒收** —— iNat 用 `license_code: null`
 * 表示「保留所有权利」，把未知当可用正是当前线上问题的根源。
 *
 * 刻意**不含 ND（禁止演绎）**：`rehostImages` 会把图缩到 1280px 并转 WebP，
 * 那是演绎行为。宁可少几张图，也不要踩这条线。
 */
export const REUSABLE_LICENSES = new Set([
  "cc0",
  "cc-by",
  "cc-by-sa",
  "cc-by-nc",
  "cc-by-nc-sa",
  "pd", // public domain
  "publicdomain",
]);

/** 把各家五花八门的许可写法归一成 `cc-by-nc` 这种代码。 */
export function normalizeLicense(raw: unknown): string {
  const s = String(raw ?? "")
    .trim()
    .toLowerCase();
  if (!s) return "";
  // GBIF 给的是完整 URL：http://creativecommons.org/licenses/by-nc/4.0/
  const m = /creativecommons\.org\/(?:licenses|publicdomain)\/([a-z-]+)/.exec(s);
  if (m) {
    const seg = m[1];
    if (seg === "zero" || seg === "mark") return "cc0";
    return `cc-${seg}`;
  }
  if (/^cc[-_ ]?0$/.test(s) || s.includes("public domain")) return "cc0";
  return (
    s
      .replace(/\s+/g, "-")
      .replace(/^cc[-_ ]?/, "cc-")
      // Wikimedia Commons 给的是带版本号的 `cc-by-sa-4.0` / `cc-by-2.5`；
      // 版本不影响「能不能用」，统一裁掉，否则会被当成未知许可而全部误杀。
      .replace(/-\d+(\.\d+)?$/, "")
      .replace(/-(en|deed)$/, "")
  );
}

/** Commons 的 Artist 字段是 HTML（带 <a> 链接）。署名要落到图注上，先拆成纯文本。 */
export function stripHtml(s: unknown): string {
  return String(s ?? "")
    .replace(/<[^>]*>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

export function isReusableLicense(raw: unknown): boolean {
  return REUSABLE_LICENSES.has(normalizeLicense(raw));
}

/** 展示用的许可名，如 `CC BY-NC`。空/未知返回空串。 */
export function licenseLabel(raw: unknown): string {
  const c = normalizeLicense(raw);
  if (!c) return "";
  if (c === "cc0") return "CC0 公共领域";
  if (c === "pd" || c === "publicdomain") return "公共领域";
  return c.toUpperCase().replace(/^CC-/, "CC ");
}

/**
 * 一张图的中文图注署名，如：
 *   `摄影：Urgamal Magsar · CC BY-NC · iNaturalist`
 *
 * 拿不到摄影者时退而用数据源自带的 attribution 串；两者都没有就只写许可与来源 ——
 * **绝不编造摄影者**。
 */
export function creditLine(
  c: Pick<PhotoCandidate, "who" | "attribution" | "license" | "sourceName">,
): string {
  const parts: string[] = [];
  const who = (c.who || "").trim();
  if (who) parts.push(`摄影：${who}`);
  else if ((c.attribution || "").trim()) parts.push(c.attribution.trim());
  const lic = licenseLabel(c.license);
  if (lic) parts.push(lic);
  if ((c.sourceName || "").trim()) parts.push(c.sourceName.trim());
  return parts.join(" · ");
}

/**
 * 过滤出可以合法使用的候选，并顺手去重。
 * 返回 `{ kept, dropped }` —— dropped 的数量要打日志，否则"图变少了"会变成一个查不出
 * 原因的玄学问题。
 */
export function filterLicensed(cands: PhotoCandidate[]): {
  kept: PhotoCandidate[];
  dropped: number;
} {
  const seen = new Set<string>();
  const kept: PhotoCandidate[] = [];
  let dropped = 0;
  for (const c of cands) {
    if (!c?.url || seen.has(c.url)) continue;
    if (!isReusableLicense(c.license)) {
      dropped++;
      continue;
    }
    seen.add(c.url);
    kept.push(c);
  }
  return { kept, dropped };
}
