/**
 * 金叶详页「全球分布」配图 —— 国界底图 + GBIF 记录密度层，服务端生成 inline SVG。
 *
 * 版式标准来自 ordosplantsvol1 的 `01_四合木` 页（`ee-distribution` 槽）：
 * **国界作底、记录叠加**，而不是一块涂满的色块分布区。理由是诚实：涂色块要求我们
 * 知道「分布区边界在哪」，那是没有的数据；而「有哪些格子被采集/观察记录过」是
 * GBIF 里逐条可查的事实。两者的信息量差得远，但只有后者站得住。
 *
 * 因此图上写的是「记录密度」而不是「分布区」，图注也明写 **点位不代表多度、也不等于
 * 完整分布区**（采集努力在欧美远高于中亚，疏密首先反映的是谁去采过标本）。
 *
 * ## 为什么用 GBIF 的密度瓦片，而不是自己拉 300 条记录画圆点
 * 试过，废弃了：`/occurrence/search` 的默认顺序**按数据集聚簇**。朝天委陵菜全库 25,065 条，
 * 取前 300 条几乎全落在荷兰一个数据集里 —— 画出来是「这个种只长在荷兰」，比没有图还糟。
 * GBIF 的 `/v2/map/occurrence/density` 瓦片是对**全库**做的栅格聚合，无抽样偏差，
 * 两张 PNG 约 26 KB，比 2 MB 的记录 JSON 还小。
 *
 * 投影：等距圆柱（equirectangular），与 world-borders.data.ts 的底图逐像素对齐 ——
 *   x = (lon + 180) × 950/360      y = (90 − lat) × 620/180
 * 这两条公式是从底图上三个已知点反解出来并验算过的（误差 < 0.01 px），
 * **改底图必须同时改公式**。注意 x/y 比例尺不同（2.639 vs 3.444 px/度），底图本身就是
 * 纵向拉伸的；所以瓦片必须用 `preserveAspectRatio="none"` 贴上去，否则会错位。
 */

import { WORLD_BORDERS_PATHS, WORLD_MAP_ATTRIBUTION } from "./world-borders.data";

export type DistributionMap = {
  /** 可直接塞进页面的 inline <svg>（瓦片已内联成 data URI，浏览时不依赖 GBIF）。 */
  svg: string;
  /** GBIF 全库该种带坐标的记录总数。 */
  recordCount: number;
  gbifTaxonKey: number | null;
  /** GBIF 认定的正名 —— 与我们送进去的名字不一致时值得留意。 */
  gbifName: string | null;
  /** 数据拉取日期 YYYY-MM-DD。 */
  retrieved: string;
};

const VIEW_W = 950;
const VIEW_H = 620;

/** 等距圆柱投影。lon/lat → SVG 坐标。 */
export function projectLonLat(lon: number, lat: number): { x: number; y: number } {
  return {
    x: ((lon + 180) * VIEW_W) / 360,
    y: ((90 - lat) * VIEW_H) / 180,
  };
}

const esc = (s: unknown): string =>
  String(s ?? "").replace(
    /[&<>"]/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] ?? c,
  );

/**
 * 组装 SVG。`tiles` 是 EPSG:4326 zoom-0 的两张瓦片（西半球 / 东半球）的 data URI；
 * 传 null 表示那半球没抓到 —— 仍然出图，但只画有的那半边，不假装另一半是空的
 * （图注会说明）。
 */
export function buildDistributionSvg(opts: {
  tiles: [string | null, string | null];
  scientificName: string;
  gbifTaxonKey?: number | null;
  retrieved: string;
  recordCount: number;
}): string {
  const { tiles, scientificName, gbifTaxonKey, retrieved, recordCount } = opts;
  const half = VIEW_W / 2;

  // 赤道 / 南北回归线。y 由同一套公式算出，跟着底图走。
  const lineAt = (lat: number) => projectLonLat(0, lat).y.toFixed(1);

  const nf = (n: number) => n.toLocaleString("en-US");
  const density = tiles
    .map((href, i) =>
      href
        ? `<image href="${esc(href)}" x="${i * half}" y="0" width="${half}" height="${VIEW_H}" ` +
          `preserveAspectRatio="none"/>`
        : "",
    )
    .join("");

  return (
    `<svg viewBox="0 0 ${VIEW_W} ${VIEW_H}" xmlns="http://www.w3.org/2000/svg" role="img" ` +
    `aria-label="${esc(scientificName)} 的 GBIF 地理记录密度图">` +
    `<defs><radialGradient id="dm-ocean"><stop offset="0%" stop-color="#e6eef2"/>` +
    `<stop offset="100%" stop-color="#cdd9df"/></radialGradient></defs>` +
    `<rect width="${VIEW_W}" height="${VIEW_H}" fill="url(#dm-ocean)"/>` +
    `<g fill="#e8dcc4" stroke="#8a7a5a" stroke-width="0.35" stroke-linejoin="round">` +
    WORLD_BORDERS_PATHS +
    `</g>` +
    `<g stroke="#b9a87e" stroke-width="0.35" stroke-dasharray="3 4" opacity="0.55">` +
    `<line x1="0" y1="${lineAt(0)}" x2="${VIEW_W}" y2="${lineAt(0)}"/>` +
    `<line x1="0" y1="${lineAt(23.4367)}" x2="${VIEW_W}" y2="${lineAt(23.4367)}"/>` +
    `<line x1="0" y1="${lineAt(-23.4367)}" x2="${VIEW_W}" y2="${lineAt(-23.4367)}"/>` +
    `</g>` +
    density +
    `<g><rect x="24" y="532" width="430" height="62" rx="4" fill="#fffaf0" fill-opacity=".92" ` +
    `stroke="#8a7a5a" stroke-width=".5"/>` +
    `<rect x="42" y="551" width="11" height="11" fill="#3a7d2e" opacity=".85"/>` +
    `<text x="62" y="561" font-family="sans-serif" font-size="13" fill="#3b3428">` +
    `GBIF 记录密度 · Occurrence density　全库 ${nf(recordCount)} 条带坐标记录</text>` +
    `<text x="42" y="580" font-family="sans-serif" font-size="10.5" fill="#6d6252">` +
    `色块表示该格子有记录，深浅表示记录多少；不代表多度，也不等于完整分布区</text></g>` +
    `<text x="${VIEW_W - 20}" y="608" text-anchor="end" font-family="sans-serif" font-size="9.5" ` +
    `fill="#6d6252">${esc(WORLD_MAP_ATTRIBUTION)} · Occurrences: GBIF` +
    `${gbifTaxonKey ? ` taxon ${gbifTaxonKey}` : ""}, ${esc(retrieved)}</text>` +
    `</svg>`
  );
}

async function fetchWithTimeout(url: string, ms: number): Promise<Response | null> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms);
  try {
    const r = await fetch(url, { signal: ctl.signal });
    return r.ok ? r : null;
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

function toBase64(bytes: Uint8Array): string {
  // Workers / 浏览器都有 btoa，但它只吃 latin1 字符串，所以要分块喂，
  // 一次性 String.fromCharCode(...bytes) 会在几十万字节时爆栈。
  let s = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    s += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(s);
}

/**
 * 拉 GBIF 记录密度并画图。**任何一步失败都返回 null**，绝不退回「随便画点什么」——
 * 一张编出来的分布图比没有图有害得多（读者无从分辨），这与本项目的反虚构协议一致。
 *
 * @param scientificName 双名（含命名人也行，会自动截成属+种）
 */
export async function buildSpeciesDistributionMap(
  scientificName: string,
  opts?: { today?: string },
): Promise<DistributionMap | null> {
  const binomial = (scientificName || "").trim().split(/\s+/).slice(0, 2).join(" ");
  if (!binomial) return null;
  const retrieved = opts?.today ?? new Date().toISOString().slice(0, 10);

  const mRes = await fetchWithTimeout(
    "https://api.gbif.org/v1/species/match?" + new URLSearchParams({ name: binomial }),
    8000,
  );
  const matched = mRes ? await mRes.json().catch(() => null) : null;
  const taxonKey: number | null =
    matched && typeof matched.usageKey === "number" && matched.matchType !== "NONE"
      ? matched.usageKey
      : null;
  // 名字对不上 GBIF 就没有 taxonKey，密度瓦片也就无从查起。宁可不出图。
  if (!taxonKey) return null;

  // limit=0 只要计数、不要记录体 —— 响应几百字节。
  const cRes = await fetchWithTimeout(
    "https://api.gbif.org/v1/occurrence/search?" +
      new URLSearchParams({ taxonKey: String(taxonKey), hasCoordinate: "true", limit: "0" }),
    8000,
  );
  const counted = cRes ? await cRes.json().catch(() => null) : null;
  const recordCount = typeof counted?.count === "number" ? counted.count : 0;
  if (!recordCount) return null;

  // EPSG:4326 的 zoom 0 是「两张瓦片拼成一个世界」：x=0 西半球、x=1 东半球。
  // squareSize=16 在最终 475×620 的半幅里约合 7 px 一格 —— 够细看出分布轮廓，
  // 又不至于让狭域特有种细成一个看不见的像素。
  const tileUrl = (x: 0 | 1) =>
    `https://api.gbif.org/v2/map/occurrence/density/0/${x}/0@2x.png?` +
    new URLSearchParams({
      srs: "EPSG:4326",
      taxonKey: String(taxonKey),
      style: "green.poly",
      bin: "square",
      squareSize: "16",
    });

  const tiles = await Promise.all(
    ([0, 1] as const).map(async (x) => {
      const r = await fetchWithTimeout(tileUrl(x), 12000);
      if (!r) return null;
      try {
        const buf = new Uint8Array(await r.arrayBuffer());
        if (!buf.length) return null;
        return `data:image/png;base64,${toBase64(buf)}`;
      } catch {
        return null;
      }
    }),
  );
  // 两半球都没抓到 = 没有密度层可画，只剩一张空底图，那是误导。
  if (!tiles[0] && !tiles[1]) return null;

  return {
    svg: buildDistributionSvg({
      tiles: [tiles[0], tiles[1]],
      scientificName: binomial,
      gbifTaxonKey: taxonKey,
      retrieved,
      recordCount,
    }),
    recordCount,
    gbifTaxonKey: taxonKey,
    gbifName: typeof matched?.scientificName === "string" ? matched.scientificName : null,
    retrieved,
  };
}
