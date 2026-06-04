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

function buildHtml(innerHtml: string) {
  const styles = Array.from(document.querySelectorAll("link[rel='stylesheet'], style"))
    .map((n) => absolutize(n.outerHTML))
    .join("\n");
  const body = absolutize(innerHtml);
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8" />
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
    preparePrintBody(parsed);
    const bodyHtml = absolutize(parsed.body?.innerHTML ?? "", base);
    const headHtml = absolutize(parsed.head?.innerHTML ?? "", base)
      .replace(/<base\b[^>]*>/gi, "")
      .replace(/<meta[^>]+name=("|')viewport\1[^>]*>/gi, "");
    const fluidHtml = buildHtml(bodyHtml).replace(
      /<\/head>/i,
      `<base href="${base}" />\n${headHtml}\n</head>`,
    );
    iframe.srcdoc = fluidHtml;
    await new Promise<void>((resolve, reject) => {
      iframe.onload = () => resolve();
      iframe.onerror = () => reject(new Error("长图渲染失败"));
    });
    const doc = iframe.contentDocument;
    if (!doc?.body) throw new Error("长图内容为空");
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
    return snapshot(doc.body, scale);
  } finally {
    iframe.remove();
  }
}

async function getExportDocumentHtml(): Promise<{ html: string; base: string }> {
  const main = getMain();
  if (!main) throw new Error("找不到主内容区域");
  const contentFrame = Array.from(main.querySelectorAll("iframe")).find(
    (frame) => frame.id !== "pdf-preview-iframe",
  ) as HTMLIFrameElement | undefined;
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

function preparePrintBody(doc: Document) {
  doc.querySelectorAll("script").forEach((script) => script.remove());
  doc.querySelectorAll("[contenteditable]").forEach((el) => el.removeAttribute("contenteditable"));
  doc.querySelectorAll("style").forEach((style) => {
    if (style.textContent?.includes("lov-edit-mark-ctx")) style.remove();
  });

  const pageBreakTargets = ["I", "III", "IV"];
  doc.querySelectorAll(".sec-rule").forEach((sectionRule) => {
    const num = sectionRule.querySelector(".num")?.textContent?.replace(/[.\s]/g, "").toUpperCase();
    if (!num || !pageBreakTargets.includes(num)) return;
    const previous = sectionRule.previousElementSibling;
    if (previous?.classList.contains("page-break")) return;
    const br = doc.createElement("div");
    br.className = "page-break";
    sectionRule.parentNode?.insertBefore(br, sectionRule);
  });
}

export function AdminExportButton() {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [pdfDialogOpen, setPdfDialogOpen] = useState(false);
  const [paperSize, setPaperSize] = useState<PaperSize>("A3");
  const [orientation, setOrientation] = useState<Orientation>("portrait");
  const [margins, setMargins] = useState<MarginPreset>("normal");
  const [scale, setScale] = useState(100);
  const [headerFooter, setHeaderFooter] = useState(true);
  const [pagesPerSheet, setPagesPerSheet] = useState<PagesPerSheet>(1);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewBuilding, setPreviewBuilding] = useState(false);
  const [previewReady, setPreviewReady] = useState(false);

  useEffect(() => {
    if (!previewUrl) return;
    return () => URL.revokeObjectURL(previewUrl);
  }, [previewUrl]);

  const run = async (fn: () => Promise<void>, label: string) => {
    setBusy(label);
    try {
      await fn();
    } catch (e) {
      console.error(e);
      toast.error("导出失败：" + (e as Error).message);
    } finally {
      setBusy(null);
      setOpen(false);
    }
  };

  const exportHtml = async () => {
    // Prefer the inner iframe document when present (HTML-type plant pages):
    // exporting the iframe shell instead of the original document keeps the
    // user's authored layout AND lets our fluid CSS take over the width.
    const source = await getExportDocumentHtml();
    const doc = new DOMParser().parseFromString(source.html, "text/html");
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
    downloadBlob(new Blob([html], { type: "text/html" }), `${safeName()}.html`);
    toast.success("已导出 HTML（宽度随窗口自适应）");
  };

  const exportMarkdown = async () => {
    const main = getMain();
    if (!main) throw new Error("找不到主内容区域");
    const td = new TurndownService({ headingStyle: "atx", codeBlockStyle: "fenced" });
    const md = td.turndown(main.innerHTML);
    downloadBlob(new Blob([md], { type: "text/markdown" }), `${safeName()}.md`);
    toast.success("已导出 Markdown");
  };

  const exportPng = async () => {
    const source = await getExportDocumentHtml();
    const canvas = await snapshotHtmlDocument(source.html, source.base, 2);
    await new Promise<void>((resolve, reject) => {
      canvas.toBlob((blob) => {
        if (!blob) return reject(new Error("生成 PNG 失败"));
        downloadBlob(blob, `${safeName()}.png`);
        toast.success("已导出长图，可上传至小红书");
        resolve();
      }, "image/png");
    });
  };

  const buildPdfHtml = async (
    size: PaperSize,
    ori: Orientation,
    marginPreset: MarginPreset,
    scalePct: number,
    showHeaderFooter: boolean,
    nUp: PagesPerSheet,
  ) => {
    const source = await getExportDocumentHtml();
    const doc = new DOMParser().parseFromString(source.html, "text/html");
    preparePrintBody(doc);
    const pagedSrc = new URL("/paged.polyfill.js", window.location.origin).href;
    const bodyHtml = absolutize(doc.body?.innerHTML ?? "", source.base);
    const headHtml = absolutize(doc.head?.innerHTML ?? "", source.base)
      .replace(/<base\b[^>]*>/gi, "")
      .replace(/<meta[^>]+name=("|')viewport\1[^>]*>/gi, "");
    const mm = MARGIN_MM[marginPreset];
    const cols = PAGES_PER_SHEET_COLS[nUp];
    const nUpScale = nUp === 1 ? 1 : 1 / cols;
    const headerFooterCss = showHeaderFooter
      ? `@bottom-center { content: counter(page) " / " counter(pages); font-size: 10pt; color: #666; }
         @top-center { content: "${(document.title || "").replace(/"/g, "")}"; font-size: 9pt; color: #888; }`
      : "";
    const pageCss = `
      @page {
        size: ${size} ${ori};
        margin: ${mm}mm;
        ${headerFooterCss}
      }
      html, body { margin: 0 !important; padding: 0 !important; background: #fff !important; color: #111; }
      body {
        font-family: ui-serif, "Songti SC", "Source Han Serif SC", Georgia, serif;
        font-size: ${(13.2 * scalePct) / 100}pt;
        line-height: 1.72;
        width: auto !important;
        max-width: none !important;
        min-height: auto !important;
        overflow: visible !important;
        background-image: none !important;
      }
      .pagedjs_pages {
        display: grid;
        grid-template-columns: repeat(${cols}, auto);
        justify-content: center;
        gap: 8mm;
        background: #e8e4dd;
        padding: 12mm;
      }
      .pagedjs_page { background: #fff; box-shadow: 0 8px 28px rgba(0,0,0,.18); }
      ${nUp > 1 ? `.pagedjs_page { transform: scale(${nUpScale}); transform-origin: top left; margin: 0; }` : ""}
      .pagedjs_page_content { overflow: hidden; }
      .pagedjs_first_page { break-before: auto; }
      .refs ol { columns: 2; column-gap: 18mm; }
      .refs li { break-inside: avoid; page-break-inside: avoid; }
      .colophon { margin-top: 18mm; break-inside: avoid; page-break-inside: avoid; }
      .image-frame, .intro-image, .feat-img, .habitat-photo, .hum-illu, .ee-image {
        box-shadow: 0 0 0 3px var(--paper, #fff), 0 0 0 4px var(--rule-soft, #ddd) !important;
      }
      .sec-rule, h2, h3 { break-after: avoid-page; page-break-after: avoid; }
      h1 { font-size: ${(78 * scalePct) / 100}pt; }
      h2 { font-size: ${(22 * scalePct) / 100}pt; }
      h3 { font-size: ${(18 * scalePct) / 100}pt; }
      h4 { font-size: ${(15 * scalePct) / 100}pt; }
      p { font-size: ${(13.2 * scalePct) / 100}pt; line-height: 1.72; orphans: 3; widows: 3; }
      .en-p { font-size: ${(11 * scalePct) / 100}pt; }
      .page-break { break-before: page; page-break-before: always; }
      p, li { orphans: 3; widows: 3; }
      section, article, .hero, .cover, .intro, figure, table, pre, blockquote,
      .image-frame, .intro-image, .feat-img, .habitat-photo, .hum-illu, .ee-image {
        break-inside: avoid; page-break-inside: avoid;
      }
      img, svg, video, canvas { max-width: 100% !important; height: auto !important; break-inside: avoid; page-break-inside: avoid; }
      figure { margin: 10pt 0; }
      figcaption { font-size: 9.5pt; color: #555; text-align: center; margin-top: 4pt; }
      a { color: #111; text-decoration: none; }
      nav, header, footer, button, .no-print, .lov-edit-mark-row { display: none !important; }
      @media print {
        .pagedjs_pages { display: block; background: #fff; padding: 0; }
        .pagedjs_page { box-shadow: none; margin: 0; }
      }
    `;
    return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${document.title}</title>
<base href="${source.base}" />
${headHtml}
<style>${pageCss}</style>
</head>
<body>
${bodyHtml}
<script src="${pagedSrc}"><\/script>
</body>
</html>`;
  };

  const openPdfDialog = async () => {
    setOpen(false);
    setPdfDialogOpen(true);
    await rebuildPreview(paperSize, orientation, margins, scale, headerFooter, pagesPerSheet);
  };

  const rebuildPreview = async (
    size: PaperSize,
    ori: Orientation,
    m: MarginPreset,
    s: number,
    hf: boolean,
    nUp: PagesPerSheet,
  ) => {
    setPreviewBuilding(true);
    setPreviewReady(false);
    try {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      const html = await buildPdfHtml(size, ori, m, s, hf, nUp);
      const blob = new Blob([html], { type: "text/html" });
      setPreviewUrl(URL.createObjectURL(blob));
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setPreviewBuilding(false);
    }
  };

  const updateOption = <T,>(setter: (v: T) => void, value: T, build: Partial<{
    size: PaperSize; ori: Orientation; m: MarginPreset; s: number; hf: boolean; n: PagesPerSheet;
  }>) => {
    setter(value);
    rebuildPreview(
      build.size ?? paperSize,
      build.ori ?? orientation,
      build.m ?? margins,
      build.s ?? scale,
      build.hf ?? headerFooter,
      build.n ?? pagesPerSheet,
    );
  };

  const confirmPdf = () => {
    const iframe = document.getElementById("pdf-preview-iframe") as HTMLIFrameElement | null;
    if (!iframe?.contentWindow) {
      toast.error("预览未就绪，请稍候");
      return;
    }
    try {
      iframe.contentWindow.focus();
      iframe.contentWindow.print();
      toast.success("打印设置请选：边距默认、缩放 100%、开启背景图形、关闭页眉页脚");
    } catch (e) {
      toast.error("调用打印失败：" + (e as Error).message);
    }
  };

  const exportZip = async () => {
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
    const blob = await zip.generateAsync({ type: "blob" });
    downloadBlob(blob, `${safeName()}.zip`);
    toast.success("已导出文件夹 ZIP");
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
              onClick={() => run(fn as () => Promise<void>, label as string)}
              disabled={!!busy}
              className="block w-full text-left px-3 py-2 text-sm hover:bg-paper-deep disabled:opacity-50"
            >
              {label as string}
            </button>
          ))}
        </div>
      )}
      <Dialog
        open={pdfDialogOpen}
        onOpenChange={(v) => {
          setPdfDialogOpen(v);
          if (!v && previewUrl) {
            URL.revokeObjectURL(previewUrl);
            setPreviewUrl(null);
          }
        }}
      >
        <DialogContent className="max-w-4xl">
          <DialogHeader>
            <DialogTitle>PDF 保存设置</DialogTitle>
          </DialogHeader>
          <div className="flex flex-wrap gap-4 items-end">
            <div className="flex flex-col gap-1">
              <label className="text-xs text-ink-faint">纸张尺寸</label>
              <Select
                value={paperSize}
                onValueChange={(v) => updateOption(setPaperSize, v as PaperSize, { size: v as PaperSize })}
              >
                <SelectTrigger className="w-[140px]"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {PAPER_SIZES.map((s) => (
                    <SelectItem key={s} value={s}>{s}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs text-ink-faint">方向</label>
              <Select
                value={orientation}
                onValueChange={(v) => updateOption(setOrientation, v as Orientation, { ori: v as Orientation })}
              >
                <SelectTrigger className="w-[140px]"><SelectValue /></SelectTrigger>
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
                <SelectTrigger className="w-[120px]"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {PAGES_PER_SHEET.map((n) => (
                    <SelectItem key={n} value={String(n)}>{n}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs text-ink-faint">页边距</label>
              <Select
                value={margins}
                onValueChange={(v) => updateOption(setMargins, v as MarginPreset, { m: v as MarginPreset })}
              >
                <SelectTrigger className="w-[120px]"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">无 0mm</SelectItem>
                  <SelectItem value="narrow">窄 10mm</SelectItem>
                  <SelectItem value="normal">默认 20mm</SelectItem>
                  <SelectItem value="wide">宽 25mm</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1 min-w-[180px]">
              <label className="text-xs text-ink-faint">缩放 {scale}%</label>
              <Slider
                min={50}
                max={150}
                step={5}
                value={[scale]}
                onValueChange={(v) => setScale(v[0])}
                onValueCommit={(v) => updateOption(setScale, v[0], { s: v[0] })}
              />
            </div>
            <label className="flex items-center gap-2 text-xs">
              <Switch
                checked={headerFooter}
                onCheckedChange={(v) => updateOption(setHeaderFooter, v, { hf: v })}
              />
              页眉 / 页脚
            </label>
            <div className="text-xs text-ink-faint ml-auto">
              {previewBuilding || !previewReady ? "排版中…" : "Paged.js 自动分页预览"}
            </div>
          </div>
          <div className="border border-ink/30 bg-paper-deep h-[60vh] overflow-hidden">
            {previewUrl ? (
              <iframe
                id="pdf-preview-iframe"
                src={previewUrl}
                title="PDF 预览"
                onLoad={() => setTimeout(() => setPreviewReady(true), 900)}
                className="w-full h-full bg-white"
              />
            ) : (
              <div className="w-full h-full flex items-center justify-center text-sm text-ink-faint">
                正在生成预览…
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
              className="text-sm border border-ink bg-ink text-background px-3 py-1 hover:opacity-90"
              onClick={confirmPdf}
              disabled={previewBuilding || !previewUrl || !previewReady}
            >
              确定保存为 PDF
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}