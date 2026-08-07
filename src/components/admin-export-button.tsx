import { useEffect, useState } from "react";
import { toast } from "sonner";
import TurndownService from "turndown";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";

type PaperSize = "A4" | "A3" | "A5" | "Letter" | "Legal" | "B5";
type Orientation = "portrait" | "landscape";
type MarginPreset = "none" | "narrow" | "normal" | "wide";
type PagesPerSheet = 1 | 2 | 4 | 6 | 9;
const PAPER_SIZES: PaperSize[] = ["A4", "A3", "A5", "Letter", "Legal", "B5"];
/** 纵向时的 [宽, 高]，单位 mm。 */
const PAPER_MM: Record<PaperSize, [number, number]> = {
  A4: [210, 297],
  A3: [297, 420],
  A5: [148, 210],
  Letter: [215.9, 279.4],
  Legal: [215.9, 355.6],
  B5: [176, 250],
};
const MARGIN_MM: Record<MarginPreset, number> = { none: 0, narrow: 10, normal: 20, wide: 25 };
const PAGES_PER_SHEET: PagesPerSheet[] = [1, 2, 4, 6, 9];
const PAGES_PER_SHEET_COLS: Record<PagesPerSheet, number> = { 1: 1, 2: 2, 4: 2, 6: 3, 9: 3 };

function getMain(): HTMLElement | null {
  return document.querySelector("main");
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

/* ───────────────────────── 保存位置对话框 ─────────────────────────
   以前所有导出都走 `<a download>`：浏览器不问一声，直接丢进默认下载目录 ——
   用户报的「保存为长图 PNG 并未出现选择保存路径窗口」就是这个。
   改用 File System Access API 的 showSaveFilePicker，拿到系统「另存为」窗口。 */

type FileSystemWritableLike = { write: (data: Blob) => Promise<void>; close: () => Promise<void> };
type FileSystemFileHandleLike = { createWritable: () => Promise<FileSystemWritableLike> };
type ShowSaveFilePicker = (opts: {
  suggestedName?: string;
  types?: { description: string; accept: Record<string, string[]> }[];
}) => Promise<FileSystemFileHandleLike>;

type SaveTarget = { handle: FileSystemFileHandleLike } | { fallbackName: string };

/** 用户在「另存为」窗口点了取消 —— 是正常操作，不是错误，不该弹红字。 */
class ExportCancelled extends Error {
  constructor() {
    super("已取消");
    this.name = "ExportCancelled";
  }
}

/**
 * 弹出系统「保存到哪里」窗口并拿到写入句柄。
 *
 * ⚠️ 必须在点击之后的**第一个 await** 调用。showSaveFilePicker 要求短暂用户手势
 * （transient activation），等长图渲染完好几秒再调，手势早就过期，只会抛
 * NotAllowedError —— 那正是「先渲染再问路径」这种写法必然失败的原因。
 * Firefox / Safari 没有这个 API，返回 fallback 名字走老的 a[download]。
 */
async function pickSaveTarget(
  name: string,
  description: string,
  mime: string,
  exts: string[],
): Promise<SaveTarget> {
  const picker = (window as unknown as { showSaveFilePicker?: ShowSaveFilePicker })
    .showSaveFilePicker;
  if (typeof picker === "function") {
    try {
      const handle = await picker({
        suggestedName: name,
        types: [{ description, accept: { [mime]: exts } }],
      });
      return { handle };
    } catch (e) {
      if ((e as DOMException)?.name === "AbortError") throw new ExportCancelled();
      // 其它失败（非安全上下文、手势过期、策略禁用…）：退回下载，别让导出整个断掉。
      console.warn("showSaveFilePicker unavailable, falling back to download", e);
    }
  }
  return { fallbackName: name };
}

async function deliver(target: SaveTarget, blob: Blob) {
  if ("handle" in target) {
    const writable = await target.handle.createWritable();
    await writable.write(blob);
    await writable.close();
    return;
  }
  downloadBlob(blob, target.fallbackName);
}

function safeName() {
  const t = (document.title || "page").replace(/[\\/:*?"<>|]+/g, "-").slice(0, 60);
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  return `${t}-${stamp}`;
}

function absolutize(html: string, base = window.location.href): string {
  return html.replace(/\b(href|src)=("|')([^"']*)\2/g, (match, attr, q, raw) => {
    if (!raw || /^(data:|blob:|mailto:|tel:|#|javascript:)/i.test(raw)) return match;
    try {
      return `${attr}=${q}${new URL(raw, base).href}${q}`;
    } catch {
      return match;
    }
  });
}

/** 渲染用 iframe 的「这份文档已经是我要的那份」标记，见 waitForFrameDoc。 */
const EXPORT_DOC_MARKER = "lov-export-doc";

function buildHtml(innerHtml: string) {
  const styles = Array.from(document.querySelectorAll("link[rel='stylesheet'], style"))
    .map((n) => absolutize(n.outerHTML))
    .join("\n");
  const body = absolutize(innerHtml);
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8" />
<meta name="${EXPORT_DOC_MARKER}" content="1" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${document.title}</title>
${styles}
<style>
  html, body { margin: 0; padding: 0; background: #fff; }
  body {
    width: 100%;
    max-width: 100%;
    margin: 0;
    padding: clamp(16px, 3vw, 48px);
    font-family: ui-sans-serif, system-ui, "PingFang SC", "Hiragino Sans GB", sans-serif;
    box-sizing: border-box;
  }
  /* Force fluid width on every container — defeats hard-coded widths from the source page */
  body, body *, main, article, section, header, footer, aside, nav,
  div, figure, table, pre, blockquote, .container, .wrapper, .page, .content {
    max-width: 100% !important;
    box-sizing: border-box;
  }
  body, main, article, section, header, footer, aside, nav, div, figure {
    min-width: 0 !important;
  }
  img, video, iframe, svg, canvas { max-width: 100% !important; height: auto; display: block; }
  table { width: 100% !important; table-layout: auto; }
  pre, code { white-space: pre-wrap; word-break: break-word; }
</style>
</head>
<body>${body}</body>
</html>`;
}

/** Snapshot canvas with html2canvas-pro (supports oklch / modern color funcs). */
async function snapshot(el: HTMLElement, scale = 2) {
  const html2canvas = (await import("html2canvas-pro")).default;
  return html2canvas(el, {
    useCORS: true,
    scale,
    backgroundColor: "#ffffff",
    windowWidth: Math.max(el.scrollWidth, el.clientWidth, 1200),
    windowHeight: Math.max(el.scrollHeight, el.clientHeight, 800),
    logging: false,
  });
}

/** 等到 iframe 里真正装的是我们写进去的那份文档（而不是先来一发的 about:blank）。 */
async function waitForFrameDoc(iframe: HTMLIFrameElement, timeoutMs = 30000): Promise<Document> {
  const start = performance.now();
  for (;;) {
    const d = iframe.contentDocument;
    if (
      d &&
      d.defaultView &&
      d.readyState !== "loading" &&
      d.querySelector(`meta[name="${EXPORT_DOC_MARKER}"]`)
    ) {
      return d;
    }
    if (performance.now() - start > timeoutMs) throw new Error("页面渲染超时，请重试");
    await new Promise((r) => setTimeout(r, 60));
  }
}

async function snapshotHtmlDocument(html: string, base: string, scale = 2) {
  const iframe = document.createElement("iframe");
  iframe.setAttribute("aria-hidden", "true");
  iframe.style.position = "fixed";
  iframe.style.left = "-10000px";
  iframe.style.top = "0";
  iframe.style.width = "1200px";
  iframe.style.height = "800px";
  iframe.style.border = "0";
  document.body.appendChild(iframe);
  try {
    const parsed = new DOMParser().parseFromString(html, "text/html");
    prepareExportBody(parsed);
    const bodyHtml = absolutize(parsed.body?.innerHTML ?? "", base);
    const headHtml = absolutize(parsed.head?.innerHTML ?? "", base)
      .replace(/<base\b[^>]*>/gi, "")
      .replace(/<meta[^>]+name=("|')viewport\1[^>]*>/gi, "");
    // 末尾这条 0.01px 字距是**给 html2canvas 用的开关**，不是排版意图：
    // 它的 breakText() 只在 letterSpacing !== 0 时才逐字素定位，等于 0 时改走
    // Intl.Segmenter 的分词路径，而那条路径会把英文单词之间的空格整个吞掉
    // （实测：「the name retained here following」被画成「thename retained herefollowing」）。
    // 0.01px 肉眼不可见，却能把渲染切到正确的那条路上。
    // 特意放在源文档自己的 <head> 之后、且只用 `body *` 这种最低特异性 ——
    // 模板里真正想要的字距（.hero h1 / .tagline 等）依然压得过它。
    const fluidHtml = buildHtml(bodyHtml).replace(
      /<\/head>/i,
      `<base href="${base}" />\n${headHtml}\n<style>body,body *{letter-spacing:0.01px;}</style>\n</head>`,
    );
    iframe.srcdoc = fluidHtml;
    // 🔴 不能只等一次 `load`。刚 append 进 DOM 的 iframe 会先加载一份 about:blank，
    // 那一发 load 可能先到 —— 于是我们抓到的是 about:blank 的 document，等 srcdoc 真正
    // 装好，这份旧 document 就被卸掉了，html2canvas 抛
    // 「Document is not attached to a window」，整个导出直接失败（PDF / 长图都中招）。
    // 改成轮询「文档就绪 + 带着我们埋的标记」，只认那一份。
    const doc = await waitForFrameDoc(iframe);
    if (!doc.body) throw new Error("长图内容为空");
    await Promise.all(
      Array.from(doc.images).map((img) =>
        img.complete
          ? Promise.resolve()
          : new Promise<void>((resolve) => {
              img.onload = () => resolve();
              img.onerror = () => resolve();
            }),
      ),
    );
    await doc.fonts?.ready.catch(() => undefined);
    const width = Math.max(doc.documentElement.scrollWidth, doc.body.scrollWidth, 1200);
    const height = Math.max(doc.documentElement.scrollHeight, doc.body.scrollHeight, 800);
    iframe.style.width = `${width}px`;
    iframe.style.height = `${height}px`;
    doc.documentElement.style.background = "#ffffff";
    doc.body.style.background = "#ffffff";
    // 🔴 必须 `await` 之后再 return。写成 `return snapshot(...)` 时，async 函数会先把
    // 这个**尚未兑现**的 promise 定为返回值、立刻执行下面的 finally 把 iframe 摘掉，
    // 然后 html2canvas 才真正开跑 —— 此时 doc.defaultView 已经是 null，直接抛
    // 「Document is not attached to a window」。PDF 与长图 PNG 都栽在这一行上。
    const canvas = await snapshot(doc.body, scale);
    return canvas;
  } finally {
    iframe.remove();
  }
}

async function getExportDocumentHtml(): Promise<{ html: string; base: string }> {
  const main = getMain();
  if (!main) throw new Error("找不到主内容区域");
  const contentFrame = main.querySelector("iframe") as HTMLIFrameElement | null;
  if (contentFrame) {
    let frameDoc: Document | null = null;
    try {
      frameDoc = contentFrame.contentDocument;
    } catch {
      frameDoc = null;
    }
    const inner = frameDoc?.body?.innerHTML?.trim() ?? "";
    if (inner) {
      return {
        html: "<!DOCTYPE html>\n" + frameDoc!.documentElement.outerHTML,
        base: contentFrame.src || window.location.href,
      };
    }
    // Fallback: fetch the iframe source directly (handles cross-origin / unloaded iframes)
    const src = contentFrame.src || contentFrame.getAttribute("src");
    if (src && /^https?:/i.test(src)) {
      try {
        const text = await fetch(src).then((r) => r.text());
        return { html: text, base: src };
      } catch {
        // fall through to main fallback
      }
    }
  }
  return {
    html: `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8" /></head><body>${main.outerHTML}</body></html>`,
    base: window.location.href,
  };
}

/**
 * 导出前的清理。**只摘编辑期的东西**，绝不动版面。
 *
 * 从前这里还会往正文里塞 `.page-break`、并靠一条
 * `nav, header, footer, button { display:none !important }` 去「隐藏站点框架」——
 * 可导出的是条目自己那份 HTML，它的 <header> 就是封面题图、<footer> 就是版权页脚，
 * 于是一导 PDF 封面和页脚整块消失，正文再被硬塞的分页符切开：这正是「保存 PDF 出现
 * 排版错乱」的来源（2026-08-07 用户反馈）。现在导出所见即所得，两条都不再需要。
 */
function prepareExportBody(doc: Document) {
  doc.querySelectorAll("script").forEach((script) => script.remove());
  doc.querySelectorAll("[contenteditable]").forEach((el) => el.removeAttribute("contenteditable"));
  doc.querySelectorAll("style").forEach((style) => {
    if (style.textContent?.includes("lov-edit-mark-ctx")) style.remove();
  });
  // 正文里的 [1] [2] 编辑标记是站内审计用的，不该出现在导出的成品里。
  doc.querySelectorAll(".lov-edit-mark-row").forEach((el) => el.remove());
}

/* ───────────────────────── PDF：所见即所得分页 ─────────────────────────
   旧实现是 Paged.js 重排 + 调浏览器打印对话框。Paged.js 要把作者写死的 grid /
   绝对定位 / vh 单位重新塞进固定页框，一页复杂排版进去就散架；再叠上一层用户在系统
   打印对话框里的缩放，结果谁也预料不到。
   现在改成：整页渲染成一张图 → 按纸张比例切页 → 逐页贴进 PDF。
   代价是文字不可选、文件偏大；换来的是「预览里长什么样，PDF 就长什么样」。 */

type PageSlice = { dataUrl: string; wPx: number; hPx: number };

/** 取整张画布左上角像素当纸底色，用来填补最后一页/智能切页留下的空白。 */
function sampleBackground(canvas: HTMLCanvasElement): string {
  try {
    const d = canvas.getContext("2d")!.getImageData(0, 0, 1, 1).data;
    return `#${[d[0], d[1], d[2]].map((v) => v.toString(16).padStart(2, "0")).join("")}`;
  } catch {
    return "#ffffff";
  }
}

/**
 * 在 [minY, maxY] 里找一条「整行同色」的横线当切口 —— 段落之间的空白。
 * 找不到就返回 null，由调用方硬切。
 * 从下往上找：尽量把页塞满，同时不把一行字劈成两半。
 */
function findCleanCut(
  ctx: CanvasRenderingContext2D,
  width: number,
  minY: number,
  maxY: number,
): number | null {
  const bandHeight = maxY - minY;
  if (bandHeight <= 1) return null;
  let band: ImageData;
  try {
    band = ctx.getImageData(0, minY, width, bandHeight);
  } catch {
    return null; // 画布被跨源图片污染，读不了像素 —— 退回硬切
  }
  const data = band.data;
  // 横向抽样即可，逐像素扫一整行太慢且没必要。
  const step = Math.max(1, Math.floor(width / 240));
  for (let row = bandHeight - 1; row >= 0; row--) {
    const base = row * width * 4;
    const r0 = data[base];
    const g0 = data[base + 1];
    const b0 = data[base + 2];
    let uniform = true;
    for (let x = step; x < width; x += step) {
      const i = base + x * 4;
      if (
        Math.abs(data[i] - r0) > 6 ||
        Math.abs(data[i + 1] - g0) > 6 ||
        Math.abs(data[i + 2] - b0) > 6
      ) {
        uniform = false;
        break;
      }
    }
    if (uniform) return minY + row;
  }
  return null;
}

/** 把长画布切成一页页的 JPEG。pageHeightPx = 一页纸的内容区在画布上占多少像素。 */
function slicePages(canvas: HTMLCanvasElement, pageHeightPx: number): PageSlice[] {
  const ctx = canvas.getContext("2d");
  const out: PageSlice[] = [];
  const total = canvas.height;
  const page = Math.max(80, Math.round(pageHeightPx));
  // 智能切页的回溯上限：最多往上让出一页的 14%，再多就得不偿失（页尾大片空白）。
  const slack = Math.round(page * 0.14);
  const bg = sampleBackground(canvas);
  let y = 0;
  let guard = 0;
  while (y < total && guard++ < 400) {
    let end = Math.min(y + page, total);
    if (end < total && ctx) {
      const cut = findCleanCut(ctx, canvas.width, Math.max(y + page - slack, y + 1), end);
      if (cut && cut > y + page * 0.4) end = cut;
    }
    const h = end - y;
    const tmp = document.createElement("canvas");
    tmp.width = canvas.width;
    tmp.height = h;
    const tctx = tmp.getContext("2d")!;
    tctx.fillStyle = bg;
    tctx.fillRect(0, 0, tmp.width, tmp.height);
    tctx.drawImage(canvas, 0, y, canvas.width, h, 0, 0, canvas.width, h);
    out.push({ dataUrl: tmp.toDataURL("image/jpeg", 0.85), wPx: canvas.width, hPx: h });
    y = end;
  }
  return out;
}

export function AdminExportButton() {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [pdfDialogOpen, setPdfDialogOpen] = useState(false);
  const [paperSize, setPaperSize] = useState<PaperSize>("A3");
  const [orientation, setOrientation] = useState<Orientation>("portrait");
  const [margins, setMargins] = useState<MarginPreset>("normal");
  const [scale, setScale] = useState(100);
  const [pageNumbers, setPageNumbers] = useState(true);
  const [pagesPerSheet, setPagesPerSheet] = useState<PagesPerSheet>(1);
  /** 整页快照。开一次对话框只渲染一次，改纸张/页边距/缩放都只是重新切页。 */
  const [master, setMaster] = useState<HTMLCanvasElement | null>(null);
  const [pages, setPages] = useState<PageSlice[]>([]);
  const [rendering, setRendering] = useState(false);
  const [pdfError, setPdfError] = useState<string | null>(null);

  /** 一页纸的内容区尺寸（mm），含方向与页边距。 */
  const sheetGeometry = (size: PaperSize, ori: Orientation, m: MarginPreset) => {
    const [pw, ph] = PAPER_MM[size];
    const sheetW = ori === "landscape" ? ph : pw;
    const sheetH = ori === "landscape" ? pw : ph;
    const mm = MARGIN_MM[m];
    return { sheetW, sheetH, mm, contentW: sheetW - mm * 2, contentH: sheetH - mm * 2 };
  };

  /** 一「虚拟页」在纸上的落地尺寸。nUp>1 时整页等比缩进格子里。 */
  const pageBox = (
    size: PaperSize,
    ori: Orientation,
    m: MarginPreset,
    s: number,
    nUp: PagesPerSheet,
  ) => {
    const g = sheetGeometry(size, ori, m);
    const cols = PAGES_PER_SHEET_COLS[nUp];
    const rows = Math.ceil(nUp / cols);
    const cellW = g.contentW / cols;
    const cellH = g.contentH / rows;
    // 缩放只往小里调：内容宽度永远不超出内容区，>100% 会直接被纸边裁掉。
    const drawW = (g.contentW * Math.min(s, 100)) / 100;
    const drawH = g.contentH;
    const fit = nUp === 1 ? 1 : Math.min(cellW / g.contentW, cellH / g.contentH);
    return { ...g, cols, rows, cellW, cellH, drawW, drawH, fit };
  };

  const reslice = (
    canvas: HTMLCanvasElement,
    size: PaperSize,
    ori: Orientation,
    m: MarginPreset,
    s: number,
    nUp: PagesPerSheet,
  ) => {
    const box = pageBox(size, ori, m, s, nUp);
    // 图宽固定映射到 drawW，于是每毫米对应多少画布像素是定死的；一页纸的内容高度
    // 换算成画布像素就是切页步长。
    const pxPerMm = canvas.width / box.drawW;
    setPages(slicePages(canvas, box.drawH * pxPerMm));
  };

  const openPdfDialog = async () => {
    setOpen(false);
    setPdfDialogOpen(true);
    setPdfError(null);
    setMaster(null);
    setPages([]);
    setRendering(true);
    try {
      const source = await getExportDocumentHtml();
      const canvas = await snapshotHtmlDocument(source.html, source.base, 2);
      setMaster(canvas);
      reslice(canvas, paperSize, orientation, margins, scale, pagesPerSheet);
    } catch (e) {
      console.error(e);
      setPdfError((e as Error).message || "渲染失败");
    } finally {
      setRendering(false);
    }
  };

  useEffect(() => {
    if (!pdfDialogOpen) {
      setMaster(null);
      setPages([]);
    }
  }, [pdfDialogOpen]);

  const updateOption = <T,>(
    setter: (v: T) => void,
    value: T,
    build: Partial<{
      size: PaperSize;
      ori: Orientation;
      m: MarginPreset;
      s: number;
      n: PagesPerSheet;
    }>,
  ) => {
    setter(value);
    if (!master) return;
    reslice(
      master,
      build.size ?? paperSize,
      build.ori ?? orientation,
      build.m ?? margins,
      build.s ?? scale,
      build.n ?? pagesPerSheet,
    );
  };

  const confirmPdf = async () => {
    if (!pages.length) return toast.error("预览未就绪，请稍候");
    let target: SaveTarget;
    try {
      // 先问路径（此刻用户手势还在），再干重活。
      target = await pickSaveTarget(`${safeName()}.pdf`, "PDF 文档", "application/pdf", [".pdf"]);
    } catch (e) {
      if (e instanceof ExportCancelled) return;
      throw e;
    }
    setBusy("PDF");
    try {
      const { jsPDF } = await import("jspdf");
      const box = pageBox(paperSize, orientation, margins, scale, pagesPerSheet);
      const doc = new jsPDF({
        unit: "mm",
        format: [box.sheetW, box.sheetH],
        orientation: box.sheetW > box.sheetH ? "landscape" : "portrait",
        compress: true,
      });
      const perSheet = pagesPerSheet;
      const mmPerPx = box.drawW / (pages[0]?.wPx || 1);
      pages.forEach((p, i) => {
        const cell = i % perSheet;
        if (i > 0 && cell === 0) doc.addPage([box.sheetW, box.sheetH]);
        const col = cell % box.cols;
        const row = Math.floor(cell / box.cols);
        const w = box.drawW * box.fit;
        const h = p.hPx * mmPerPx * box.fit;
        // 横向居中、纵向靠上：末页内容短时不该吊在格子中间。
        const x = box.mm + col * box.cellW + (box.cellW - w) / 2;
        const y = box.mm + row * box.cellH;
        doc.addImage(p.dataUrl, "JPEG", x, y, w, h, undefined, "FAST");
      });
      if (pageNumbers) {
        const sheets = doc.getNumberOfPages();
        doc.setFontSize(9);
        doc.setTextColor(120);
        for (let s = 1; s <= sheets; s++) {
          doc.setPage(s);
          // 只画数字：jsPDF 内置字体没有中文字形，写标题会变成一串问号。
          doc.text(`${s} / ${sheets}`, box.sheetW / 2, box.sheetH - 6, { align: "center" });
        }
      }
      await deliver(target, doc.output("blob"));
      setPdfDialogOpen(false);
      toast.success(`已保存 PDF（${pages.length} 页内容 / ${doc.getNumberOfPages()} 张纸）`);
    } catch (e) {
      console.error(e);
      toast.error("导出失败：" + (e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const run = async (fn: () => Promise<void>, label: string) => {
    setOpen(false);
    setBusy(label);
    try {
      await fn();
    } catch (e) {
      if (!(e instanceof ExportCancelled)) {
        console.error(e);
        toast.error("导出失败：" + (e as Error).message);
      }
    } finally {
      setBusy(null);
    }
  };

  const exportHtml = async () => {
    const target = await pickSaveTarget(`${safeName()}.html`, "网页", "text/html", [".html"]);
    // Prefer the inner iframe document when present (HTML-type plant pages):
    // exporting the iframe shell instead of the original document keeps the
    // user's authored layout AND lets our fluid CSS take over the width.
    const source = await getExportDocumentHtml();
    const doc = new DOMParser().parseFromString(source.html, "text/html");
    prepareExportBody(doc);
    // Strip page-internal width/min-width styles that lock the layout.
    doc.querySelectorAll<HTMLElement>("[style]").forEach((el) => {
      const s = el.getAttribute("style") || "";
      const cleaned = s
        .replace(/(?:^|;)\s*(?:min-)?width\s*:[^;]+/gi, "")
        .replace(/(?:^|;)\s*max-width\s*:[^;]+/gi, "")
        .replace(/^;+/, "")
        .trim();
      if (cleaned !== s) el.setAttribute("style", cleaned);
    });
    doc.querySelectorAll<HTMLElement>("[width]").forEach((el) => el.removeAttribute("width"));
    const inner = absolutize(doc.body?.innerHTML ?? "", source.base);
    const headExtras = absolutize(doc.head?.innerHTML ?? "", source.base)
      .replace(/<base\b[^>]*>/gi, "")
      .replace(/<meta[^>]+name=("|')viewport\1[^>]*>/gi, "");
    const html = buildHtml(inner).replace(
      /<\/head>/i,
      `<base href="${source.base}" />\n${headExtras}\n</head>`,
    );
    await deliver(target, new Blob([html], { type: "text/html" }));
    toast.success("已保存 HTML（宽度随窗口自适应）");
  };

  const exportMarkdown = async () => {
    const target = await pickSaveTarget(`${safeName()}.md`, "Markdown", "text/markdown", [".md"]);
    const main = getMain();
    if (!main) throw new Error("找不到主内容区域");
    const td = new TurndownService({ headingStyle: "atx", codeBlockStyle: "fenced" });
    const md = td.turndown(main.innerHTML);
    await deliver(target, new Blob([md], { type: "text/markdown" }));
    toast.success("已保存 Markdown");
  };

  const exportPng = async () => {
    const target = await pickSaveTarget(`${safeName()}.png`, "PNG 图片", "image/png", [".png"]);
    const source = await getExportDocumentHtml();
    const canvas = await snapshotHtmlDocument(source.html, source.base, 2);
    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("生成 PNG 失败"))), "image/png");
    });
    await deliver(target, blob);
    toast.success("已保存长图，可上传至小红书");
  };

  const exportZip = async () => {
    const target = await pickSaveTarget(`${safeName()}.zip`, "ZIP 压缩包", "application/zip", [
      ".zip",
    ]);
    const main = getMain();
    if (!main) throw new Error("找不到主内容区域");
    const JSZip = (await import("jszip")).default;
    const zip = new JSZip();
    const folder = zip.folder("assets")!;
    // Clone main and rewrite img src to local paths
    const clone = main.cloneNode(true) as HTMLElement;
    const imgs = Array.from(clone.querySelectorAll("img"));
    let i = 0;
    for (const img of imgs) {
      const src = img.getAttribute("src");
      if (!src || src.startsWith("data:")) continue;
      try {
        const r = await fetch(src);
        const blob = await r.blob();
        const ext = (blob.type.split("/")[1] || "bin").split(";")[0];
        const name = `image-${i++}.${ext}`;
        folder.file(name, blob);
        img.setAttribute("src", `assets/${name}`);
      } catch {
        // leave original src on failure
      }
    }
    zip.file("index.html", buildHtml(clone.outerHTML));
    await deliver(target, await zip.generateAsync({ type: "blob" }));
    toast.success("已保存文件夹 ZIP");
  };

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className="text-sm border border-ink px-3 py-1 hover:bg-ink hover:text-background transition-colors"
      >
        {busy ? `导出中：${busy}…` : "保存"}
      </button>
      {open && (
        <div
          className="absolute right-0 top-full mt-1 z-30 bg-background border border-ink shadow-lg min-w-[160px]"
          onMouseLeave={() => setOpen(false)}
        >
          {[
            ["Markdown", exportMarkdown],
            ["HTML", exportHtml],
            ["PDF", openPdfDialog],
            ["长图 PNG", exportPng],
            ["文件夹 ZIP", exportZip],
          ].map(([label, fn]) => (
            <button
              key={label as string}
              onClick={() =>
                label === "PDF"
                  ? (fn as () => Promise<void>)()
                  : run(fn as () => Promise<void>, label as string)
              }
              disabled={!!busy}
              className="block w-full text-left px-3 py-2 text-sm hover:bg-paper-deep disabled:opacity-50"
            >
              {label as string}
            </button>
          ))}
        </div>
      )}
      <Dialog open={pdfDialogOpen} onOpenChange={setPdfDialogOpen}>
        <DialogContent className="max-w-4xl">
          <DialogHeader>
            <DialogTitle>PDF 保存设置</DialogTitle>
          </DialogHeader>
          <div className="flex flex-wrap gap-4 items-end">
            <div className="flex flex-col gap-1">
              <label className="text-xs text-ink-faint">纸张尺寸</label>
              <Select
                value={paperSize}
                onValueChange={(v) =>
                  updateOption(setPaperSize, v as PaperSize, { size: v as PaperSize })
                }
              >
                <SelectTrigger className="w-[140px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PAPER_SIZES.map((s) => (
                    <SelectItem key={s} value={s}>
                      {s}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs text-ink-faint">方向</label>
              <Select
                value={orientation}
                onValueChange={(v) =>
                  updateOption(setOrientation, v as Orientation, { ori: v as Orientation })
                }
              >
                <SelectTrigger className="w-[140px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="portrait">纵向 Portrait</SelectItem>
                  <SelectItem value="landscape">横向 Landscape</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs text-ink-faint">每张纸页数</label>
              <Select
                value={String(pagesPerSheet)}
                onValueChange={(v) => {
                  const n = Number(v) as PagesPerSheet;
                  updateOption(setPagesPerSheet, n, { n });
                }}
              >
                <SelectTrigger className="w-[120px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PAGES_PER_SHEET.map((n) => (
                    <SelectItem key={n} value={String(n)}>
                      {n}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs text-ink-faint">页边距</label>
              <Select
                value={margins}
                onValueChange={(v) =>
                  updateOption(setMargins, v as MarginPreset, { m: v as MarginPreset })
                }
              >
                <SelectTrigger className="w-[120px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">无 0mm</SelectItem>
                  <SelectItem value="narrow">窄 10mm</SelectItem>
                  <SelectItem value="normal">默认 20mm</SelectItem>
                  <SelectItem value="wide">宽 25mm</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1 min-w-[180px]">
              <label className="text-xs text-ink-faint">内容缩放 {scale}%（100% = 满版宽）</label>
              <Slider
                min={50}
                max={100}
                step={5}
                value={[scale]}
                onValueChange={(v) => setScale(v[0])}
                onValueCommit={(v) => updateOption(setScale, v[0], { s: v[0] })}
              />
            </div>
            <label className="flex items-center gap-2 text-xs">
              <Switch checked={pageNumbers} onCheckedChange={setPageNumbers} />
              页码
            </label>
            <div className="text-xs text-ink-faint ml-auto">
              {rendering ? "渲染整页中…" : pages.length ? `共 ${pages.length} 页 · 所见即所得` : ""}
            </div>
          </div>
          <div className="border border-ink/30 bg-paper-deep h-[60vh] overflow-auto p-4">
            {pdfError ? (
              <div className="w-full h-full flex items-center justify-center text-sm text-destructive">
                {pdfError}
              </div>
            ) : rendering || !pages.length ? (
              <div className="w-full h-full flex items-center justify-center text-sm text-ink-faint">
                正在渲染整页并分页…（页数越多越久，请稍候）
              </div>
            ) : (
              <div className="flex flex-col items-center gap-4">
                {pages.map((p, i) => (
                  <div key={i} className="w-full max-w-[520px]">
                    <img
                      src={p.dataUrl}
                      alt={`第 ${i + 1} 页`}
                      className="w-full block bg-white shadow-[0_8px_28px_rgba(0,0,0,.18)]"
                    />
                    <p className="text-center text-[11px] text-ink-faint mt-1">
                      第 {i + 1} / {pages.length} 页
                    </p>
                  </div>
                ))}
              </div>
            )}
          </div>
          <DialogFooter>
            <button
              className="text-sm border border-ink px-3 py-1 hover:bg-ink hover:text-background transition-colors"
              onClick={() => setPdfDialogOpen(false)}
            >
              取消
            </button>
            <button
              className="text-sm border border-ink bg-ink text-background px-3 py-1 hover:opacity-90 disabled:opacity-50"
              onClick={() => void confirmPdf()}
              disabled={rendering || !pages.length || busy === "PDF"}
            >
              {busy === "PDF" ? "生成中…" : "选择位置并保存 PDF"}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
