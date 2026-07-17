import xiaopLogoUrl from "@/assets/xiaop-logo.png";
import leafBronzeUrl from "@/assets/leaf-bronze.png";
import leafSilverUrl from "@/assets/leaf-silver.png";
import leafGoldUrl from "@/assets/leaf-gold.png";
import { proxyImageDataUrlFn } from "@/lib/image-proxy.functions";
import type { RegistryChip, RegistryChipKind } from "@/lib/conservation";

/**
 * Renders a plant-identification "share card" to a PNG Blob for social sharing
 * (微信 / 小红书 / 微博 / 抖音 …). We draw directly on a 2D canvas rather than pull
 * in a DOM-to-image dependency: it keeps the Worker bundle small and — crucially —
 * works reliably on iOS Safari/Chrome, where SVG-`foreignObject`→canvas is blocked.
 * The output is a tall 1080×1920 (9:16) image sized for phone feeds.
 *
 * Layout (per product spec):
 *   [小P蛙 logo + 品牌 ｜ 科·属右侧同行] · 坐标 · 分隔线 · 中文/拉丁/英/俗名 · 用户图
 *   · 发现者区：头像 ｜ 第一行「X 发现了一种新植物」/ 第二行 本轮铜叶 +N + 铜/银/金叶统计
 *   · 简介（前 140 字完整展示；超出才以「……」收尾）—— 居中坐在发现者区与页尾之间，上下留白等距
 *   · 页尾「X 邀请你加入 plantspedia.club…」
 *
 * 垂直排版是「两头钉死、照片吸收余量」：页尾固定在底部，摘要按行数预留，照片高度取剩余
 * 空间（420 下限护构图）。所以改动任一块的高度都要同步 photoBudget，否则摘要会被挤掉。
 */

export type ShareCardData = {
  title: string; // 中文名
  tentative?: boolean; // 疑似 → 中文名前缀「疑似」
  scientificName?: string | null;
  commonNameEn?: string | null;
  commonNamesZh?: string | null;
  family?: string | null;
  genus?: string | null;
  place?: string | null;
  lat?: number | null;
  lng?: number | null;
  summary?: string | null;
  photoUrl: string;
  /** 识别者显示名：注册用户名，或访客时为「小P蛙」。 */
  discovererName: string;
  /** 识别者头像 URL（圆形显示）。 */
  discovererAvatar?: string | null;
  /** This round's bronze leaves (1 + 补拍次数, or 1 if 疑似). */
  leafEarned?: number;
  /** Cumulative leaf balances (null → guest; stats area left blank, login CTA lives in the modal). */
  leafBronze?: number | null;
  leafSilver?: number | null;
  leafGold?: number | null;
  /** Registry chips (重点保护 / CITES / GTS / GRIIS / 地区名录 / tag) — same set the
   *  draft page and detail page show. Drawn as a pill row under the name block. */
  chips?: RegistryChip[];
  /** Visual theme for the card background/text. Default "light" (paper). */
  theme?: "light" | "dark";
  /** Language for the card's own chrome text (brand line, CTAs, footer). The plant's
   *  name / scientific name / summary come from `data` and are never translated. */
  lang?: "zh" | "en";
};

const W = 1080;
const H = 1920;
const PAD = 72;
const CW = W - PAD * 2;
const SUMMARY_MAX = 140; // hard cap on visible 简介 chars before the "阅读完整" tail

type Palette = { [K in keyof typeof PALETTES.light]: string };

const PALETTES = {
  light: {
    paper: "#faf7f0",
    ink: "#1f2a24",
    inkSoft: "#4b5a52",
    inkFaint: "#8a988f",
    rule: "#e2ddd1",
    leaf: "#2e9e5b",
    leafDeep: "#1f7a44",
    vermilion: "#c8452f",
    bronze: "#b07a43",
    silver: "#8a9aa3",
    gold: "#c79a3a",
    cites: "#5f45a3",
  },
  // Deep green-black background with light ink; greens/metals brightened so they
  // keep contrast against the dark paper.
  dark: {
    paper: "#141d18",
    ink: "#f1efe7",
    inkSoft: "#c0ccc3",
    inkFaint: "#849389",
    rule: "#2b3830",
    leaf: "#4fc888",
    leafDeep: "#78d7a2",
    vermilion: "#e8735b",
    bronze: "#cf9d67",
    silver: "#aab6bd",
    gold: "#dcb85a",
    cites: "#a992e8",
  },
} as const;

/** Card chrome strings by language. Only the card's own text — never the plant data. */
const STRINGS = {
  zh: {
    brandSub: "小P蛙 · AI 智能识别",
    unknownPlant: "未命名植物",
    tentative: (name: string) => `（疑似）${name}`,
    discovered: (name: string) => `${name}发现了一种新植物`,
    thisRoundBronze: (n: number) => `本轮铜叶 +${n}`,
    invite: (name: string) => `${name} 邀请你加入 plantspedia.club`,
    inviteSub: "一起认识更多身边的植物朋友",
  },
  en: {
    brandSub: "Xiao-P · AI Plant ID",
    unknownPlant: "Unnamed plant",
    tentative: (name: string) => `(tentative) ${name}`,
    discovered: (name: string) => `${name} discovered a plant`,
    thisRoundBronze: (n: number) => `+${n} bronze leaf`,
    invite: (name: string) => `${name} invites you to plantspedia.club`,
    inviteSub: "Discover more plants around you",
  },
} as const;

const FONT = `-apple-system, "PingFang SC", "Microsoft YaHei", "Noto Sans SC", sans-serif`;

function decodeImage(objectUrl: string): Promise<HTMLImageElement> {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const el = new Image();
    el.onload = () => resolve(el);
    el.onerror = () => reject(new Error("decode failed"));
    el.src = objectUrl;
  });
}

async function fetchAndDecode(src: string): Promise<HTMLImageElement | null> {
  try {
    const res = await fetch(src, { mode: "cors" });
    if (!res.ok) throw new Error(String(res.status));
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    try {
      return await decodeImage(url);
    } finally {
      setTimeout(() => URL.revokeObjectURL(url), 4000);
    }
  } catch {
    return null;
  }
}

async function loadImage(src: string): Promise<HTMLImageElement | null> {
  const direct = await fetchAndDecode(src);
  if (direct) return direct;
  // Cross-origin CDNs (iNaturalist / GBIF / Wikimedia) often send no CORS headers,
  // so the direct fetch fails and the canvas would be blank/tainted. Fall back to a
  // server-side proxy that returns a `data:` URL (which never taints the canvas).
  if (/^https?:\/\//i.test(src)) {
    try {
      const { dataUrl } = await proxyImageDataUrlFn({ data: { url: src } });
      if (dataUrl) return await decodeImage(dataUrl);
    } catch {
      /* proxy unavailable → give up, caller draws a placeholder */
    }
  }
  return null;
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

function drawCover(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) {
  ctx.save();
  roundRect(ctx, x, y, w, h, r);
  ctx.clip();
  const ir = img.width / img.height;
  const br = w / h;
  let dw = w,
    dh = h,
    dx = x,
    dy = y;
  if (ir > br) {
    dh = h;
    dw = h * ir;
    dx = x - (dw - w) / 2;
  } else {
    dw = w;
    dh = w / ir;
    dy = y - (dh - h) / 2;
  }
  ctx.drawImage(img, dx, dy, dw, dh);
  ctx.restore();
}

/** object-fit: contain — the whole image fits, nothing cropped. */
function drawContain(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  x: number,
  y: number,
  w: number,
  h: number,
) {
  const ir = img.width / img.height;
  const br = w / h;
  let dw: number, dh: number;
  if (ir > br) {
    dw = w;
    dh = w / ir;
  } else {
    dh = h;
    dw = h * ir;
  }
  ctx.drawImage(img, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
}

/** Single line, shrink font (down to minPx) so it never wraps; ellipsize if it still won't fit. */
function drawFitLine(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  maxWidth: number,
  weight: number,
  basePx: number,
  minPx: number,
) {
  let px = basePx;
  ctx.font = `${weight} ${px}px ${FONT}`;
  while (ctx.measureText(text).width > maxWidth && px > minPx) {
    px -= 1;
    ctx.font = `${weight} ${px}px ${FONT}`;
  }
  let out = text;
  if (ctx.measureText(out).width > maxWidth) {
    while (out && ctx.measureText(out + "…").width > maxWidth) out = out.slice(0, -1);
    out += "…";
  }
  ctx.fillText(out, x, y);
}

/** Chip colours per registry, per theme. Mirrors the on-site <RegistryChips> tones:
 *  保护=绿, CITES=紫, GTS=金, GRIIS(入侵)=红, 名录/tag=中性. */
function chipColors(kind: RegistryChipKind, C: Palette): { fg: string; bd: string } {
  switch (kind) {
    case "protected":
      return { fg: C.leafDeep, bd: C.leafDeep };
    case "cites":
      return { fg: C.cites, bd: C.cites };
    case "gts":
      return { fg: C.gold, bd: C.gold };
    case "griis":
      return { fg: C.vermilion, bd: C.vermilion };
    default:
      return { fg: C.inkFaint, bd: C.rule };
  }
}

const CHIP_H = 40;
const CHIP_GAP = 10;
const CHIP_PAD_X = 16;
const CHIP_FONT_PX = 22;

/** Lay chips out into rows that fit `maxWidth`. Returns rows of [chip, width]. */
function layoutChips(
  ctx: CanvasRenderingContext2D,
  chips: RegistryChip[],
  maxWidth: number,
): { chip: RegistryChip; w: number }[][] {
  ctx.font = `700 ${CHIP_FONT_PX}px ${FONT}`;
  const rows: { chip: RegistryChip; w: number }[][] = [];
  let row: { chip: RegistryChip; w: number }[] = [];
  let x = 0;
  for (const chip of chips) {
    const w = ctx.measureText(chip.label).width + CHIP_PAD_X * 2;
    if (row.length && x + w > maxWidth) {
      rows.push(row);
      row = [];
      x = 0;
    }
    row.push({ chip, w });
    x += w + CHIP_GAP;
  }
  if (row.length) rows.push(row);
  return rows;
}

/** Draw the chip rows starting at baseline-top `y`; returns the y below the last row. */
function drawChips(
  ctx: CanvasRenderingContext2D,
  rows: { chip: RegistryChip; w: number }[][],
  x0: number,
  y: number,
  C: Palette,
): number {
  let cursorY = y;
  for (const row of rows) {
    let x = x0;
    for (const { chip, w } of row) {
      const { fg, bd } = chipColors(chip.kind, C);
      ctx.save();
      roundRect(ctx, x, cursorY, w, CHIP_H, CHIP_H / 2);
      ctx.strokeStyle = bd;
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.clip();
      // Tint fill — same idea as the CSS chips' 10% background wash.
      ctx.globalAlpha = 0.12;
      ctx.fillStyle = bd;
      ctx.fillRect(x, cursorY, w, CHIP_H);
      ctx.restore();
      ctx.fillStyle = fg;
      ctx.font = `700 ${CHIP_FONT_PX}px ${FONT}`;
      ctx.textAlign = "center";
      ctx.fillText(chip.label, x + w / 2, cursorY + CHIP_H / 2 + CHIP_FONT_PX / 2 - 3);
      ctx.textAlign = "left";
      x += w + CHIP_GAP;
    }
    cursorY += CHIP_H + CHIP_GAP;
  }
  return cursorY;
}

/** Count how many lines drawWrapped will need (same wrap algorithm, no drawing).
 *  Callers must set ctx.font to the final summary font before measuring. */
function countWrappedLines(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): number {
  const chars = Array.from(text.trim());
  let line = "";
  let lines = 0;
  for (const ch of chars) {
    const test = line + ch;
    if (ctx.measureText(test).width > maxWidth && line) {
      lines++;
      line = ch;
    } else {
      line = test;
    }
  }
  if (line) lines++;
  return lines;
}

/** Word-wrap CJK+latin text; returns the next baseline y below the last line. */
function drawWrapped(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  maxWidth: number,
  lineHeight: number,
  maxLines = 999,
): number {
  const chars = Array.from(text.trim());
  let line = "";
  let lines = 0;
  let cursorY = y;
  for (let i = 0; i < chars.length; i++) {
    const test = line + chars[i];
    if (ctx.measureText(test).width > maxWidth && line) {
      if (lines === maxLines - 1) {
        let t = line;
        while (ctx.measureText(t + "…").width > maxWidth && t) t = t.slice(0, -1);
        ctx.fillText(t + "…", x, cursorY);
        return cursorY + lineHeight;
      }
      ctx.fillText(line, x, cursorY);
      line = chars[i];
      cursorY += lineHeight;
      lines++;
    } else {
      line = test;
    }
  }
  if (line) {
    ctx.fillText(line, x, cursorY);
    cursorY += lineHeight;
  }
  return cursorY;
}

export async function renderShareCard(data: ShareCardData): Promise<Blob> {
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("无法创建画布上下文");

  const C: Palette = PALETTES[data.theme === "dark" ? "dark" : "light"];
  const T = STRINGS[data.lang === "en" ? "en" : "zh"];

  ctx.fillStyle = C.paper;
  ctx.fillRect(0, 0, W, H);

  const [photo, logo, badgeBronze, badgeSilver, badgeGold, avatar] = await Promise.all([
    loadImage(data.photoUrl),
    loadImage(xiaopLogoUrl),
    loadImage(leafBronzeUrl),
    loadImage(leafSilverUrl),
    loadImage(leafGoldUrl),
    data.discovererAvatar ? loadImage(data.discovererAvatar) : Promise.resolve(null),
  ]);

  ctx.textBaseline = "alphabetic";
  ctx.textAlign = "left";

  // ── Header row: logo + 品牌 | 地点信息（右侧） ────────────────────────────────
  const headTop = PAD + 6;
  const logoSize = 96;
  if (logo) drawContain(ctx, logo, PAD, headTop, logoSize, logoSize);
  const brandX = PAD + logoSize + 22;
  ctx.fillStyle = C.ink;
  ctx.font = `800 34px ${FONT}`;
  ctx.fillText("Plantspedia", brandX, headTop + 38);
  ctx.fillStyle = C.inkFaint;
  ctx.font = `500 24px ${FONT}`;
  ctx.fillText(T.brandSub, brandX, headTop + 74);

  // 地点信息放在右侧（地点和坐标分两行）
  const rightX = W - PAD;
  if ((data.place || "").trim() || (data.lat != null && data.lng != null)) {
    ctx.textAlign = "right";
    let locY = headTop + 30;

    // 地点图标 + 地点名
    if ((data.place || "").trim()) {
      ctx.save();
      const pinX = rightX - 8;
      ctx.strokeStyle = C.vermilion;
      ctx.lineWidth = 2.4;
      ctx.beginPath();
      ctx.arc(pinX, locY, 7, Math.PI, 0);
      ctx.lineTo(pinX, locY + 14);
      ctx.closePath();
      ctx.stroke();
      ctx.fillStyle = C.vermilion;
      ctx.beginPath();
      ctx.arc(pinX, locY, 2.6, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();

      ctx.fillStyle = C.inkSoft;
      ctx.font = `500 24px ${FONT}`;
      ctx.fillText(data.place!.trim(), rightX - 30, locY + 6);
      locY += 32;
    }

    // 坐标
    if (data.lat != null && data.lng != null) {
      ctx.fillStyle = C.inkFaint;
      ctx.font = `400 22px ${FONT}`;
      ctx.fillText(`${data.lat.toFixed(4)}, ${data.lng.toFixed(4)}`, rightX, locY);
    }

    ctx.textAlign = "left";
  }

  let y = headTop + logoSize + 30;

  // ── 分隔线 ────────────────────────────────────────────────────────────────
  ctx.strokeStyle = C.rule;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(PAD, y);
  ctx.lineTo(W - PAD, y);
  ctx.stroke();
  y += 50;

  // ── 名称块（科属 + 中文名/拉丁学名同行 + 俗名）───────────────────────────
  const famGen = [data.family, data.genus]
    .map((s) => (s || "").trim())
    .filter(Boolean)
    .join("  ·  ");
  if (famGen) {
    ctx.fillStyle = C.leafDeep;
    ctx.font = `700 28px ${FONT}`;
    ctx.fillText(famGen, PAD, y);
    y += 62; // 增加科属与中文名的间距（原 44）
  }

  // 中文名和拉丁学名同行显示
  const cleanName = (data.title || "")
    .replace(/^（?\s*疑似\s*）?/, "")
    .replace(/^\(tentative\)\s*/i, "")
    .trim();
  const displayTitle = data.tentative
    ? T.tentative(cleanName || T.unknownPlant)
    : data.title || T.unknownPlant;
  ctx.fillStyle = data.tentative ? C.vermilion : C.ink;
  ctx.font = `800 52px ${FONT}`;

  const titleMetrics = ctx.measureText(displayTitle);
  const titleWidth = titleMetrics.width;

  // 拉丁学名（斜体，较小，灰色）
  const sciName = (data.scientificName || "").trim();
  ctx.fillText(displayTitle, PAD, y);

  if (sciName) {
    ctx.fillStyle = C.inkSoft;
    ctx.font = `italic 400 28px ${FONT}`;
    ctx.fillText(sciName, PAD + titleWidth + 20, y);
  }
  y += 62;

  // 俗名
  const alt = [data.commonNameEn, data.commonNamesZh]
    .map((s) => (s || "").trim())
    .filter(Boolean)
    .join("  ·  ");
  if (alt) {
    ctx.fillStyle = C.inkFaint;
    ctx.font = `400 26px ${FONT}`;
    y = drawWrapped(ctx, alt, PAD, y, CW, 34, 2);
  }

  // ── 卡签（重点保护 / CITES / GTS / GRIIS / 地区名录 / tag）──────────────────
  // 紧跟名称块：一眼就能看到这株植物的保护/入侵/收录身份。
  const chipRows = data.chips?.length ? layoutChips(ctx, data.chips, CW) : [];
  if (chipRows.length) {
    y += 16;
    y = drawChips(ctx, chipRows, PAD, y, C) - CHIP_GAP;
  }

  // ── 用户照片 ──────────────────────────────────────────────────────────────
  // 先量出 140 字摘要需要的行数，把照片高度收缩到「摘要必定完整放得下」的尺寸。
  // 这样截断只发生在 SUMMARY_MAX（140 字）处，不会因版面不够提前加省略号。
  const footerY = H - PAD - 80;
  const footerLineY = footerY - 40;
  const rawSummary = (data.summary || "").trim();
  const sumArr = Array.from(rawSummary);
  const summaryBody =
    sumArr.length > SUMMARY_MAX ? sumArr.slice(0, SUMMARY_MAX).join("") + "……" : rawSummary;
  const sumLineH = 46;
  const SUM_PX = 30;
  ctx.font = `400 ${SUM_PX}px ${FONT}`;
  const summaryLines = summaryBody ? countWrappedLines(ctx, summaryBody, CW) : 0;
  // Visual height of the summary block: first line's cap-height above its baseline,
  // plus one line-height per following line, plus a descender allowance. Used both to
  // budget the photo and to centre the block between 发现者区 and 页尾分割线.
  const summaryBlockH = summaryLines ? (summaryLines - 1) * sumLineH + SUM_PX + 8 : 0;

  y += 26;
  const avatarSize = 120; // 头像（较前版放大 50%：80 → 120）
  // 摘要要「上下留白等距」地坐在发现者区与页尾分割线之间 → 至少各留 SUMMARY_GAP_MIN。
  const SUMMARY_GAP_MIN = 44;
  // 垂直预算 = 页尾分割线以上 − 照片下间距 44 − 发现者区（头像高）− 摘要块
  //          − 摘要上下等距留白；剩下的全给照片（上限保持正方形，下限护住构图）。
  const photoBudget =
    footerLineY - y - 44 - avatarSize - summaryBlockH - (summaryBlockH ? SUMMARY_GAP_MIN * 2 : 72);
  const photoH = Math.max(420, Math.min(CW, photoBudget));
  if (photo) drawCover(ctx, photo, PAD, y, CW, photoH, 28);
  else {
    ctx.fillStyle = C.rule;
    roundRect(ctx, PAD, y, CW, photoH, 28);
    ctx.fill();
  }
  y += photoH + 44;

  // ── 发现者信息区（头像 + 名字 + 本轮铜叶统计，占两行）───────────────────
  const avatarX = PAD;
  const avatarY = y;

  // 圆形头像
  if (avatar) {
    ctx.save();
    ctx.beginPath();
    ctx.arc(avatarX + avatarSize / 2, avatarY + avatarSize / 2, avatarSize / 2, 0, Math.PI * 2);
    ctx.closePath();
    ctx.clip();
    drawCover(ctx, avatar, avatarX, avatarY, avatarSize, avatarSize, 0);
    ctx.restore();
  } else {
    // 默认头像（灰色圆）
    ctx.fillStyle = C.rule;
    ctx.beginPath();
    ctx.arc(avatarX + avatarSize / 2, avatarY + avatarSize / 2, avatarSize / 2, 0, Math.PI * 2);
    ctx.fill();
  }

  // 头像右边第一行：「X 发现了一种新植物」
  const textX = avatarX + avatarSize + 24;
  const line1Y = avatarY + 44;
  ctx.fillStyle = C.leafDeep;
  ctx.font = `800 30px ${FONT}`;
  ctx.fillText(T.discovered(data.discovererName), textX, line1Y);

  // 头像右边第二行：本轮铜叶 + 三叶统计。行距 54（原 38）——两行讲的是不同的事
  //（谁发现的 / 这轮拿了多少叶），挨太近会读成一句话。
  const line2Y = line1Y + 54;
  const miniBadge = 32;
  let cursorX = textX;

  // 本轮铜叶 only makes sense for an identify card; published-page cards omit
  // leafEarned entirely, so this line is skipped there.
  if (data.leafEarned != null) {
    ctx.fillStyle = C.bronze;
    ctx.font = `700 28px ${FONT}`;
    const bronzeLabel = T.thisRoundBronze(data.leafEarned);
    ctx.fillText(bronzeLabel, cursorX, line2Y);
    cursorX += ctx.measureText(bronzeLabel).width + 40;
  }

  // 三叶统计（紧凑显示）
  const hasStats = data.leafBronze != null;
  if (hasStats) {
    const chips: [HTMLImageElement | null, number, string][] = [
      [badgeBronze, data.leafBronze ?? 0, C.bronze],
      [badgeSilver, data.leafSilver ?? 0, C.silver],
      [badgeGold, data.leafGold ?? 0, C.gold],
    ];

    for (const [badge, val, col] of chips) {
      if (badge) drawContain(ctx, badge, cursorX, line2Y - miniBadge / 2, miniBadge, miniBadge);
      cursorX += miniBadge + 6;
      ctx.fillStyle = col;
      ctx.font = `700 26px ${FONT}`;
      ctx.fillText(String(val), cursorX, line2Y);
      cursorX += ctx.measureText(String(val)).width + 20;
    }
  }

  // ── 140字摘要 ─────────────────────────────────────────────────────────────
  // 摘要坐在「发现者区底边」与「页尾分割线」之间，上下留白等距 —— 所以这里不是
  // 「接着往下排」，而是先量出这段空档，再把摘要块居中放进去。
  if (summaryBody) {
    const blockBottom = avatarY + avatarSize;
    const gap = Math.max(24, (footerLineY - blockBottom - summaryBlockH) / 2);
    ctx.fillStyle = C.inkSoft;
    ctx.font = `400 ${SUM_PX}px ${FONT}`;
    // 首行基线 = 空档顶 + 等距留白 + 一个字高（drawWrapped 收的是基线，不是块顶）。
    const firstBaseline = blockBottom + gap + SUM_PX;
    // 版面已预留，这里的 maxLines 只是照片触及 420px 下限时的最终保险。
    const maxLines = Math.max(2, Math.floor((footerLineY - firstBaseline) / sumLineH) + 1);
    drawWrapped(ctx, summaryBody, PAD, firstBaseline, CW, sumLineH, maxLines);
  }

  // ── 页尾（居中，加分隔线）────────────────────────────────────────────────

  // 分隔线（居中短线）
  const lineWidth = 200;
  ctx.strokeStyle = C.rule;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo((W - lineWidth) / 2, footerLineY);
  ctx.lineTo((W + lineWidth) / 2, footerLineY);
  ctx.stroke();

  // 邀请文案（居中对齐，统一字号 30px，与"发现了一种新植物"相同）
  ctx.textAlign = "center";
  ctx.fillStyle = C.leafDeep;
  ctx.font = `800 30px ${FONT}`;
  ctx.fillText(T.invite(data.discovererName), W / 2, footerY);

  // 副标题（字号与摘要正文等大 30px）
  ctx.font = `500 30px ${FONT}`;
  ctx.fillStyle = C.inkSoft;
  ctx.fillText(T.inviteSub, W / 2, footerY + 40);

  // 重置 textAlign
  ctx.textAlign = "left";

  return await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("画布导出失败（图片可能存在跨域限制）"))),
      "image/png",
      0.95,
    );
  });
}

/**
 * Share a rendered card via the system share sheet (files) — the OS decides which
 * apps appear (微信/小红书/抖音/… if installed). The card PNG **and** the detail-page
 * link must both travel, so the receiver gets a clickable link card next to the image.
 *
 * Why the staged attempts: many platforms (iOS Safari, Android Chrome) refuse a
 * `files` + `url` payload — `canShare({files})` says yes, then `share()` either throws
 * or silently drops the url, which is how the link went missing. So we probe the full
 * payload first, and when it's rejected we fold the link into `text` (every target that
 * accepts text auto-links a bare URL) rather than lose it.
 *
 * Falls back to a plain download when the platform can't share files at all
 * (most desktop browsers).
 */
export async function shareOrSaveImage(
  blob: Blob,
  filename: string,
  opts?: { url?: string; text?: string; title?: string },
): Promise<"shared" | "downloaded" | "cancelled"> {
  const file = new File([blob], filename, { type: "image/png" });
  const nav = navigator as Navigator & {
    canShare?: (d: { files?: File[]; url?: string; text?: string }) => boolean;
    share?: (d: { files?: File[]; title?: string; text?: string; url?: string }) => Promise<void>;
  };
  const title = opts?.title ?? "Plantspedia 识别卡";
  const link = opts?.url;
  // Link folded into the caption — the fallback for targets that drop `url`.
  const textWithLink = [opts?.text, link].filter(Boolean).join("\n");

  if (nav.share && nav.canShare) {
    // The link rides in BOTH `url` and the caption text — deliberately duplicated.
    //
    // Why: the receiving app decides what it keeps. 微信 / 小红书 / 短信 / 邮箱 routinely take
    // the image and silently drop `url`, and share() still RESOLVES — so we cannot detect the
    // loss and cannot fall back after the fact (the old code only demoted the link into the
    // caption when the platform *rejected* the payload up front, which these apps don't do).
    // A bare URL inside the caption survives that stripping, and every one of those targets
    // auto-links it. Cost: targets that honour `url` show the link twice.
    const attempts: { files?: File[]; title?: string; text?: string; url?: string }[] = [];
    if (link) attempts.push({ files: [file], title, text: textWithLink, url: link });
    // Same payload minus `url`, for targets that reject the files+url combination outright.
    attempts.push({ files: [file], title, text: textWithLink || undefined });

    for (const payload of attempts) {
      if (!nav.canShare(payload)) continue;
      // Belt-and-braces: if the target strips the link from both fields, the user can still
      // paste it. Best-effort — a denied clipboard must not block the share.
      if (link) {
        try {
          await navigator.clipboard?.writeText(link);
        } catch {
          /* no clipboard → the link still rides in `text`/`url` */
        }
      }
      try {
        await nav.share(payload);
        return "shared";
      } catch (err) {
        if ((err as Error).name === "AbortError") return "cancelled";
        // Anything else (platform rejected the combination) → try the next shape.
      }
    }
  }
  // Desktop → the image downloads, so put the link on the clipboard instead of
  // dropping it (best-effort: clipboard needs permission/secure context).
  if (link) {
    try {
      await navigator.clipboard?.writeText(link);
    } catch {
      /* no clipboard → the user still has the image */
    }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
  return "downloaded";
}
