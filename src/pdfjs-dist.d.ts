// pdfjs-dist 6.x 的 package.json **没有 `exports` 字段**（`main` 指向
// build/pdf.mjs），所以深路径 import 在运行时完全合法，只是 TS 找不到声明。
//
// 为什么非要走深路径而不是裸包名 `import("pdfjs-dist")`：见 src/lib/doc-to-images.ts
// 顶部那段注释 —— 裸包名解析到 **pdf.mjs（未压缩版）**，而 worker 走的是
// **pdf.worker.min.mjs（压缩版）**，两边不是同一份构建产物；实测这种搭配下
// getDocument() 会永久 pending。两边都钉死在 `.min.mjs` 上。

declare module "pdfjs-dist/build/pdf.min.mjs" {
  export * from "pdfjs-dist";
}

// Vite 的 `?worker` 后缀：默认导出一个用 `{ type: "module" }` 实例化 Worker 的构造器。
// pdfjs v6 的 worker 是 ES module，必须由它来构造（详见 doc-to-images.ts）。
declare module "pdfjs-dist/build/pdf.worker.min.mjs?worker" {
  const WorkerConstructor: new () => Worker;
  export default WorkerConstructor;
}
