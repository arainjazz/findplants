import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useEffect } from "react";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouter,
  HeadContent,
  Scripts,
} from "@tanstack/react-router";
import { Toaster } from "@/components/ui/sonner";
import { TaskFeedLauncher } from "@/components/task-feed-launcher";
import { AuthProvider } from "@/hooks/use-auth";
import { OfflineStatus } from "@/components/offline-status";
import appCss from "../styles.css?url";

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <p className="label mb-2">404 · Specimen not found</p>
        <h1 className="text-5xl font-display font-bold mb-4">未收录此条目</h1>
        <p className="text-ink-faint mb-6">这页可能尚未编纂，或已被移除。</p>
        <Link
          to="/"
          className="inline-block border border-ink px-4 py-2 hover:bg-ink hover:text-background transition-colors"
        >
          回到首页
        </Link>
      </div>
    </div>
  );
}

function ErrorComponent({ error, reset }: { error: Error; reset: () => void }) {
  console.error(error);
  const router = useRouter();
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <p className="label mb-2">Error</p>
        <h1 className="text-3xl font-display font-bold mb-3">页面加载出错</h1>
        <p className="text-ink-faint text-sm mb-5">{error.message}</p>
        <div className="flex justify-center gap-3">
          <button
            onClick={() => {
              router.invalidate();
              reset();
            }}
            className="border border-ink px-4 py-2 hover:bg-ink hover:text-background transition-colors"
          >
            重试
          </button>
          <a
            href="/"
            className="border border-ink/40 px-4 py-2 hover:bg-paper-deep transition-colors"
          >
            回首页
          </a>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "Plantspedia · 全民植物志" },
      { name: "theme-color", content: "#2e7d32" },
      {
        name: "description",
        content: "Plantspedia 是一个由社区共同编纂的植物科普网站，收录每一种值得记住的草木。",
      },
      { property: "og:title", content: "Plantspedia · 全民植物志" },
      {
        property: "og:description",
        content: "Plantspedia 是一个由社区共同编纂的植物科普网站，收录每一种值得记住的草木。",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:title", content: "Plantspedia · 全民植物志" },
      {
        name: "twitter:description",
        content: "Plantspedia 是一个由社区共同编纂的植物科普网站，收录每一种值得记住的草木。",
      },
      {
        property: "og:image",
        content:
          "https://storage.googleapis.com/gpt-engineer-file-uploads/GK5tu8pqzVgtJ3MTnznluTif3u13/social-images/social-1780563206704-ChatGPT_Image_2026年6月1日_22_32_38.webp",
      },
      {
        name: "twitter:image",
        content:
          "https://storage.googleapis.com/gpt-engineer-file-uploads/GK5tu8pqzVgtJ3MTnznluTif3u13/social-images/social-1780563206704-ChatGPT_Image_2026年6月1日_22_32_38.webp",
      },
      { name: "twitter:card", content: "summary_large_image" },
    ],
    links: [
      { rel: "manifest", href: "/manifest.json" },
      { rel: "stylesheet", href: appCss },
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "" },
      {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@400;500;600;700&family=EB+Garamond:wght@400;500;600&family=Noto+Serif+SC:wght@400;500;600;700&family=Cormorant+SC:wght@500;600;700&display=swap",
      },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

// ─── 水合看门狗 ───────────────────────────────────────────────────────────────
//
// 🔴 **必须是内联的普通 script，绝不能挪进 React**。它要救的正是「React 没跑起来」
// 这一种故障，写在组件里等于把灭火器锁在着火的屋子里。
//
// 修的是什么（2026-08-03 用户报「未登录状态下所有功能都消失了」）：
//   SW 缓存里存着上一次部署的 HTML 壳 → 壳里写的是 `/assets/index-<旧hash>.js`
//   → 那个 chunk 早被新部署换掉，现在返回 **404 而且 body 是 HTML**
//   → `<script type="module">` 解析失败 → 整页不水合。
//   于是用户看到的是一张**服务端渲染出来的死图**：首页停在「载入中…」（那行字本来
//   就在 SSR 输出里）、汉堡菜单和标签页点了毫无反应、识别页打得开却什么都不能做。
//   最要命的是它**自己好不了**：注册/更新 SW 的代码在 RootComponent 的 effect 里，
//   不水合就永远执行不到，那份坏掉的壳于是一直发下去。
//
// 自救动作：注销所有 SW + 清空所有 cache + 刷新一次。一个会话只做一次
// （sessionStorage 打点），避免变成刷新循环。
const HYDRATION_WATCHDOG = `(function(){
  var KEY = "pp-selfheal-at";
  function heal(){
    try {
      var last = +sessionStorage.getItem(KEY) || 0;
      if (Date.now() - last < 60000) return;
      sessionStorage.setItem(KEY, String(Date.now()));
    } catch (e) { return; }
    var reload = function(){ location.reload(); };
    var jobs = [];
    try {
      if (navigator.serviceWorker) jobs.push(navigator.serviceWorker.getRegistrations().then(function(rs){
        return Promise.all(rs.map(function(r){ return r.unregister(); }));
      }));
      if (window.caches) jobs.push(caches.keys().then(function(ks){
        return Promise.all(ks.map(function(k){ return caches.delete(k); }));
      }));
    } catch (e) {}
    Promise.all(jobs).catch(function(){}).then(reload);
    setTimeout(reload, 3000);
  }
  window.addEventListener("error", function(e){
    // 只认「水合之前、同源的 script 加载失败」这一种：
    //   · 水合成功之后再刷新纯属添乱 —— 那会打断正在上传的识别、清掉小P蛙输入框；
    //   · 第三方脚本（字体、RUM）挂掉不影响本站运转，不值得为它清缓存重来。
    if (window.__PP_HYDRATED__) return;
    var t = e.target;
    if (!t || t.tagName !== "SCRIPT" || !t.src) return;
    if (t.src.lastIndexOf(location.origin, 0) !== 0) return;
    heal();
  }, true);
  // 兜底：没等到任何报错、页面就是不动。要等 readyState 真的 complete 才判死刑 ——
  // 否则慢网下只是入口 chunk 还在下载，刷新反而让它从头再下一遍。
  var waited = 0;
  var tick = setInterval(function(){
    waited += 5000;
    if (window.__PP_HYDRATED__ || navigator.onLine === false) { clearInterval(tick); return; }
    if (document.readyState !== "complete" && waited < 45000) return;
    clearInterval(tick);
    heal();
  }, 5000);
})()`;

function RootShell({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <head>
        <HeadContent />
        <script dangerouslySetInnerHTML={{ __html: HYDRATION_WATCHDOG }} />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();

  useEffect(() => {
    if (typeof window === "undefined") return;
    // 看门狗的「活着」信号（见 HYDRATION_WATCHDOG）。effect 跑到这里就说明水合成功了，
    // 必须在下面那行 serviceWorker 提前 return 之前打，否则不支持 SW 的浏览器会被误判成死页。
    (window as unknown as { __PP_HYDRATED__?: boolean }).__PP_HYDRATED__ = true;
    if (!("serviceWorker" in navigator)) return;

    // If a SW already controls this page, a controllerchange means a *new* SW just
    // took over (an update) — reload once so the freshly deployed UI shows up without
    // the user having to manually clear their cache. Skipped on the very first install.
    const hadController = !!navigator.serviceWorker.controller;
    let reloaded = false;
    const onControllerChange = () => {
      if (reloaded || !hadController) return;
      reloaded = true;
      window.location.reload();
    };
    navigator.serviceWorker.addEventListener("controllerchange", onControllerChange);

    navigator.serviceWorker
      .register("/sw.js")
      .then((reg) => {
        reg.update();
        console.log("Service Worker registered with scope:", reg.scope);
      })
      .catch((err) => console.error("Service Worker registration failed:", err));

    return () =>
      navigator.serviceWorker.removeEventListener("controllerchange", onControllerChange);
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <Outlet />
        <Toaster />
        <OfflineStatus />
        {/* 全站的小P蛙：当前页面的对话入口 + 三类任务（识别 / 银叶 / 金叶）的进度与未读。
            挂在根上是刻意的 —— 用户点完「生成」就会切走去识别下一株，
            而原来的小P蛙只在草稿页和条目页出现，那两页恰恰都不在路上。
            那两页上它会自动让位给页面自带的那只（见 lib/xiaop-mounted.ts）。 */}
        <TaskFeedLauncher />
      </AuthProvider>
    </QueryClientProvider>
  );
}
