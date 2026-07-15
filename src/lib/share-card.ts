import xiaopLogoUrl from "@/assets/xiaop-logo.png";
import leafBronzeUrl from "@/assets/leaf-bronze.png";
import leafSilverUrl from "@/assets/leaf-silver.png";
import leafGoldUrl from "@/assets/leaf-gold.png";

/**
 * Renders a plant-identification "share card" to a PNG Blob for social sharing
 * (微信 / 小红书 / 微博 / 抖音 …). We draw directly on a 2D canvas rather than pull
 * in a DOM-to-image dependency: it keeps the Worker bundle small and — crucially —
 * works reliably on iOS Safari/Chrome, where SVG-`foreignObject`→canvas is blocked.
 * The output is a tall 1080×1920 (9:16) image sized for phone feeds.
 *
 * Layout (per product spec):
 *   [小P蛙 logo + 品牌 ｜ 科·属右侧同行] · 坐标 · 分隔线 · 中文/拉丁/英/俗名 · 用户图
 *   · 「X 发现了一种新植物！」+ 简介（140 字，超出→……访问 plantspedia.club 阅读完整内容）
 *   · 铜叶徽 本轮 +N ｜ 右侧 铜/银/金叶徽章统计 · 银叶/金叶权益（两行）
 *   · 页尾「X 邀请你加入 plantspedia.club…」
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
};

const W = 1080;
const H = 1920;
const PAD = 72;
const CW = W - PAD * 2;
const SUMMARY_MAX = 140; // hard cap on visible 简介 chars before the "阅读完整" tail

const C = {
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
};

const FONT = `-apple-system, "PingFang SC", "Microsoft YaHei", "Noto Sans SC", sans-serif`;

async function loadImage(src: string): Promise<HTMLImageElement | null> {
  try {
    const res = await fetch(src, { mode: "cors" });
    if (!res.ok) throw new Error(String(res.status));
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    try {
      return await new Promise<HTMLImageElement>((resolve, reject) => {
        const el = new Image();
        el.onload = () => resolve(el);
        el.onerror = () => reject(new Error("decode failed"));
        el.src = url;
      });
    } finally {
      setTimeout(() => URL.revokeObjectURL(url), 4000);
    }
  } catch {
    return null;
  }
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

function drawCover(ctx: CanvasRenderingContext2D, img: HTMLImageElement, x: number, y: number, w: number, h: number, r: number) {
  ctx.save();
  roundRect(ctx, x, y, w, h, r);
  ctx.clip();
  const ir = img.width / img.height;
  const br = w / h;
  let dw = w, dh = h, dx = x, dy = y;
  if (ir > br) { dh = h; dw = h * ir; dx = x - (dw - w) / 2; }
  else { dw = w; dh = w / ir; dy = y - (dh - h) / 2; }
  ctx.drawImage(img, dx, dy, dw, dh);
  ctx.restore();
}

/** object-fit: contain — the whole image fits, nothing cropped. */
function drawContain(ctx: CanvasRenderingContext2D, img: HTMLImageElement, x: number, y: number, w: number, h: number) {
  const ir = img.width / img.height;
  const br = w / h;
  let dw: number, dh: number;
  if (ir > br) { dw = w; dh = w / ir; } else { dh = h; dw = h * ir; }
  ctx.drawImage(img, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
}

/** Single line, shrink font (down to minPx) so it never wraps; ellipsize if it still won't fit. */
function drawFitLine(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, maxWidth: number, weight: number, basePx: number, minPx: number) {
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

/** Word-wrap CJK+latin text; returns the next baseline y below the last line. */
function drawWrapped(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, maxWidth: number, lineHeight: number, maxLines = 999): number {
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
  if (line) { ctx.fillText(line, x, cursorY); cursorY += lineHeight; }
  return cursorY;
}

export async function renderShareCard(data: ShareCardData): Promise<Blob> {
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("无法创建画布上下文");

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
  ctx.fillText("小P蛙 · AI 智能识别", brandX, headTop + 74);

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
  const famGen = [data.family, data.genus].map((s) => (s || "").trim()).filter(Boolean).join("  ·  ");
  if (famGen) {
    ctx.fillStyle = C.leafDeep;
    ctx.font = `700 28px ${FONT}`;
    ctx.fillText(famGen, PAD, y);
    y += 62;  // 增加科属与中文名的间距（原 44）
  }

  // 中文名和拉丁学名同行显示
  const cleanName = (data.title || "未知植物").replace(/^（?\s*疑似\s*）?/, "").trim();
  const displayTitle = data.tentative ? `（疑似）${cleanName}` : data.title || "未命名植物";
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
  const alt = [data.commonNameEn, data.commonNamesZh].map((s) => (s || "").trim()).filter(Boolean).join("  ·  ");
  if (alt) {
    ctx.fillStyle = C.inkFaint;
    ctx.font = `400 26px ${FONT}`;
    y = drawWrapped(ctx, alt, PAD, y, CW, 34, 2);
  }

  // ── 用户照片（正方形）────────────────────────────────────────────────────
  y += 26;
  const photoH = CW;
  if (photo) drawCover(ctx, photo, PAD, y, CW, photoH, 28);
  else { ctx.fillStyle = C.rule; roundRect(ctx, PAD, y, CW, photoH, 28); ctx.fill(); }
  y += photoH + 44;

  // ── 发现者信息区（头像 + 名字 + 本轮铜叶统计，占两行）───────────────────
  const avatarSize = 80;
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
  const textX = avatarX + avatarSize + 20;
  const line1Y = avatarY + 28;
  ctx.fillStyle = C.leafDeep;
  ctx.font = `800 30px ${FONT}`;
  ctx.fillText(`${data.discovererName}发现了一种新植物`, textX, line1Y);

  // 头像右边第二行：本轮铜叶 + 三叶统计
  const line2Y = avatarY + 66;
  const earned = data.leafEarned ?? 1;
  const miniBadge = 32;

  ctx.fillStyle = C.bronze;
  ctx.font = `700 28px ${FONT}`;
  let cursorX = textX;
  ctx.fillText(`本轮铜叶 +${earned}`, cursorX, line2Y);
  cursorX += ctx.measureText(`本轮铜叶 +${earned}`).width + 40;

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

  y = avatarY + avatarSize + 40;

  // ── 140字摘要 ────────────────────────────────────────────────────────────
  const rawSummary = (data.summary || "").trim();
  if (rawSummary) {
    const arr = Array.from(rawSummary);
    const overflowed = arr.length > SUMMARY_MAX;
    const body = overflowed ? arr.slice(0, SUMMARY_MAX).join("") : rawSummary;
    // 简介正文
    ctx.fillStyle = C.inkSoft;
    ctx.font = `400 30px ${FONT}`;
    const lineH = 46;
    const maxLines = 5;
    y = drawWrapped(ctx, body, PAD, y, CW, lineH, maxLines);
    // 如果溢出，在下一行显示"（访问plantspedia.club...）"
    if (overflowed) {
      y += 10;  // 稍微增加间距
      ctx.fillStyle = C.inkFaint;
      ctx.font = `400 26px ${FONT}`;
      ctx.fillText("（访问 plantspedia.club 阅读完整简介）", PAD, y);
      y += lineH;
    }
  }

  // ── 页尾（居中，加分隔线）────────────────────────────────────────────────
  const footerY = H - PAD - 80;
  const footerLineY = footerY - 40;

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
  ctx.fillText(`${data.discovererName} 邀请你加入 plantspedia.club`, W / 2, footerY);

  // 副标题（字号保持 22px）
  ctx.font = `500 22px ${FONT}`;
  ctx.fillStyle = C.inkSoft;
  ctx.fillText("一起认识更多身边的植物朋友", W / 2, footerY + 36);

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
 * apps appear (微信/小红书/抖音/… if installed). Attaches the detail-page URL and
 * caption so a clickable link travels alongside the image. Falls back to a plain
 * download when the platform can't share files (most desktop browsers).
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
  if (nav.share && nav.canShare && nav.canShare({ files: [file] })) {
    try {
      await nav.share({ files: [file], title: opts?.title ?? "Plantspedia 识别卡", text: opts?.text, url: opts?.url });
      return "shared";
    } catch (err) {
      if ((err as Error).name === "AbortError") return "cancelled";
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
