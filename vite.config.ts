// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - tanstackStart, viteReact, tailwindcss, tsConfigPaths, cloudflare (build-only),
//     componentTagger (dev-only), VITE_* env injection, @ path alias, React/TanStack dedupe,
//     error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... } }) if needed.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";

// Redirect TanStack Start's bundled server entry to src/server.ts (our SSR error wrapper).
// @cloudflare/vite-plugin builds from this — wrangler.jsonc main alone is insufficient.
export default defineConfig({
  tanstackStart: {
    server: { entry: "server" },
  },
  vite: {
    optimizeDeps: {
      // pdfjs-dist 必须**排除**预打包（见 src/lib/doc-to-images.ts）。
      // 主线程走 `import("pdfjs-dist")` 会被 esbuild 预打包成 .vite/deps/ 里的一份副本，
      // 而 worker 走 `?worker` 用的是 node_modules 里的真实文件 —— 两个不同实例之间
      // 的握手**永远不会完成**：getDocument() 既不 resolve 也不 reject，页面就那么
      // 静静挂住，控制台一个字都没有。排除之后两边用同一份文件。
      // （这个只在 dev 复现：生产构建不走 optimizeDeps。）
      exclude: ["pdfjs-dist"],
    },
  },
});
