// ─── PDF / PPT → 压缩图片 ────────────────────────────────────────────────────
//
// 需求：项目页 / 博客页的编辑插入 PDF 或 PPT 时，要**渲染成压缩后的图片**展示，
// 用户右键另存只能存到图片，拿不到 PDF / PPT 源文件。
//
// 关键设计：**源文件根本不上传**。
// 转换全在浏览器里做，只有渲染出来的图片会进 storage。这不是「把下载按钮藏起来」——
// 服务器上压根没有那份 PDF，没有任何 URL 能指向它。任何靠前端拦右键 / 加水印 / 关
// contextmenu 的做法都是纸糊的（F12 一开就绕过），只有「不存在」是真的拿不到。
//
// ⚠️ 右键存图**永远拦不住**，那是显示图片的固有属性，也不是用户要拦的东西 ——
// 用户要拦的是「拿到可再分发的源文件」，这一点由上面那条保证。

import { compressImage, extForMime } from "./image-compress";

export type PageImage = { file: File; page: number };

/** 一次最多渲染多少页 —— 防止有人拖进来一本 300 页的年报把浏览器跑死。 */
const MAX_PAGES = 60;

/** PPT 家族。浏览器**渲染不了**这些，只能让编辑先导出成 PDF。 */
const PPT_MIMES = new Set([
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/vnd.oasis.opendocument.presentation",
]);

export function isPdf(f: File) {
  return f.type === "application/pdf" || /\.pdf$/i.test(f.name);
}

export function isPpt(f: File) {
  return PPT_MIMES.has(f.type) || /\.(pptx?|odp)$/i.test(f.name);
}

export function isConvertibleDoc(f: File) {
  return isPdf(f) || isPpt(f);
}

/**
 * 把一份 PDF 逐页渲染成压缩图片。
 *
 * pdfjs 是**动态 import** 的：它加上 worker 有 1 MB 上下，而绝大多数访客一辈子
 * 不会在编辑器里插 PDF，没道理让所有人的首屏为它买单。
 *
 * @param scale 渲染倍率。1.5 在 A4 上约合 1240px 宽，和站内配图的 1280 基本对齐；
 *              再高只是把压缩前的像素浪费掉。
 */
export async function pdfToImages(
  file: File,
  opts: { scale?: number; onProgress?: (done: number, total: number) => void } = {},
): Promise<PageImage[]> {
  const { scale = 1.5, onProgress } = opts;

  // ⚠️ 主线程这里**必须写死 `build/pdf.min.mjs` 这条深路径**，不能用裸包名
  // `import("pdfjs-dist")`。原因是裸包名按 package.json 的 `main` 解析到
  // **pdf.mjs（未压缩版）**，而 worker 走的是 **pdf.worker.min.mjs（压缩版）**——
  // 两边不是同一份构建产物，握手永远走不完：getDocument() 既不 resolve 也不 reject，
  // 页面静静挂住，控制台一个字都没有。
  // 决定性对照实验（2026-07-23 浏览器实测）：同一份 PDF，直接 import
  // `build/pdf.min.mjs` + `?worker` → numPages 正常；经裸包名 → 永久 pending。
  // 类型声明见 src/pdfjs-dist.d.ts（pdfjs-dist 无 exports 字段，深路径运行时合法）。
  const pdfjs = await import("pdfjs-dist/build/pdf.min.mjs");

  // ⚠️ 必须用 `?worker` + workerPort，**不能**用 `?url` + workerSrc。
  // pdfjs v6 的 worker 是 **ES module**（里面有 import 语句），而 pdfjs 在收到
  // workerSrc 时是拿 classic `new Worker(url)` 去加载的 —— 浏览器直接
  // `SyntaxError: Cannot use import statement outside a module`，然后整个
  // getDocument() **静默挂住不返回**（不报错、不 reject，就是永远 pending）。
  // 这个坑是真跑一份 PDF 才发现的：tsc 过、build 过、worker chunk 也确实打出来了。
  // Vite 的 `?worker` 会用正确的 { type: "module" } 实例化。
  const PdfWorker = (await import("pdfjs-dist/build/pdf.worker.min.mjs?worker")).default;
  pdfjs.GlobalWorkerOptions.workerPort = new PdfWorker();

  const buf = await file.arrayBuffer();
  const doc = await pdfjs.getDocument({ data: buf }).promise;
  const total = Math.min(doc.numPages, MAX_PAGES);
  const out: PageImage[] = [];

  for (let n = 1; n <= total; n++) {
    const page = await doc.getPage(n);
    const viewport = page.getViewport({ scale });
    const canvas = document.createElement("canvas");
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("浏览器不支持 canvas，无法渲染 PDF。");
    // 白底：PDF 页面本身是透明的，直接转 WebP 会得到一张黑底的图。
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // ⚠️ `intent: "print"` 不是笔误，也不是为了打印 —— 它是**唯一**能让这里不依赖
    // `requestAnimationFrame` 的公开开关。
    //
    // pdfjs 的 InternalRenderTask 默认一帧画一块，靠 rAF 推进
    // （源码：`useRequestAnimationFrame: !intentPrint`）。而**后台标签页里 rAF 基本
    // 不触发** —— render().promise 既不 resolve 也不 reject，症状与之前被记成
    // 「getDocument 挂死」的那个 blocker 一模一样：无异常、无日志、无网络请求。
    // 编辑插一份 PDF 后顺手切去别的标签页是再正常不过的操作，必须走得通。
    //
    // 同一份 PDF 在隐藏标签页里的实测（2026-07-24，浏览器四组对照）：
    //   默认                    → 8 秒超时未完成（rAF=true）
    //   设 task.onContinue      → 8 秒超时未完成（rAF=true）← onContinue 拿到的
    //                             继续函数内部仍然走 _scheduleNext → rAF，没用
    //   intent:"print"          → 3 ms 完成（rAF=false）✅
    //   手改私有 _useRequestAnimationFrame → 2 ms（同样有效，但动私有字段，不用）
    //
    // 语义上也对得上：我们要的正是「这一页打印出来长什么样」的一张位图，表单域
    // 按打印外观压平反而更合适；页面本来也只取 canvas 像素，没有交互注释层。
    await page.render({ canvas, canvasContext: ctx, viewport, intent: "print" }).promise;

    const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, "image/png"));
    if (!blob) throw new Error(`第 ${n} 页渲染失败。`);
    const raw = new File([blob], `page-${String(n).padStart(3, "0")}.png`, { type: "image/png" });
    // 走站内统一的压缩（默认输出 WebP，1600px 上限）—— 一页 A4 的 PNG 常有 2–3 MB，
    // 压完通常 100–200 KB。
    const blob2 = await compressImage(raw, 1600, 1600, 0.82);
    // compressImage 回的是 Blob；storage 上传要文件名与扩展名，包成 File。
    // ⚠️ 扩展名必须由**实际输出 MIME** 推，不能只判 webp 然后一律叫 .jpg：
    // compressImage 对 200 KB 以下的图**原样返回**（不转码），此时 blob 还是 PNG，
    // 原来那行会给它起名 page-001.jpg —— 实测就是这样，`.jpg` 的名字配 image/png
    // 的内容。上传后 storage 的 content-type 与扩展名对不上，浏览器和下游工具
    // 都可能拒渲染。extForMime 就是站内专门干这件事的函数。
    const compressed = new File(
      [blob2],
      `page-${String(n).padStart(3, "0")}.${extForMime(blob2.type)}`,
      { type: blob2.type },
    );
    out.push({ file: compressed, page: n });
    onProgress?.(n, total);
  }

  // v6 起 destroy 挪到了 loadingTask 上；两种都兼容一下，拿不到就算了（GC 会收）。
  await (doc as { destroy?: () => Promise<void> }).destroy?.();
  return out;
}

/** 文档转图片的统一入口。PPT 走不通时抛一个**说清楚下一步**的错误。 */
export async function docToImages(
  file: File,
  opts: { scale?: number; onProgress?: (done: number, total: number) => void } = {},
): Promise<PageImage[]> {
  if (isPdf(file)) return pdfToImages(file, opts);
  if (isPpt(file)) {
    // 浏览器里没有任何可靠办法渲染 PPT：PPTX 是一包 XML + 主题 + 字体 + 动画，
    // 要正确出图等于实现半个 PowerPoint。服务端转要 LibreOffice，而本站跑在
    // Cloudflare Workers 上，没有那个进程。所以老老实实要求先导出 PDF。
    throw new Error(
      "暂不支持直接插入 PPT。请先在 PowerPoint / Keynote / WPS 里「导出为 PDF」，" +
        "再把 PDF 拖进来 —— 转出的图片效果和字体都会更准。",
    );
  }
  throw new Error("只支持 PDF（PPT 请先导出为 PDF）。");
}
