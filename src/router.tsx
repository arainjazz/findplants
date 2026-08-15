import { QueryClient } from "@tanstack/react-query";
import { createRouter } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";
import { RoutePending } from "./components/route-pending";

export const getRouter = () => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 5 * 60 * 1000,
        gcTime: 30 * 60 * 1000,
        refetchOnWindowFocus: false,
        refetchOnReconnect: false,
      },
    },
  });

  const router = createRouter({
    routeTree,
    context: { queryClient },
    scrollRestoration: true,

    // ── 等 loader 的时候必须有东西可看 ──────────────────────────────────────
    // 没有 pendingComponent 时，router 会在新路由落地前**一直渲染旧页面**：慢就是
    // 「点了没反应」，卡住就是「永远没反应」（2026-08-15 线上取证，见 STATE.md）。
    // 250ms 才亮：快跳转根本轮不到它；亮了至少留 400ms，免得闪一下更像故障。
    defaultPendingComponent: RoutePending,
    defaultPendingMs: 250,
    defaultPendingMinMs: 400,

    // ── 预取 ───────────────────────────────────────────────────────────────
    // "intent" 在桌面是 hover/focus，在**移动端是 touchstart**（见 link.js 的
    // handleTouchStart，它不吃 preloadDelay），所以手指按下到抬起那段时间不再白等。
    defaultPreload: "intent",
    // 只对 hover 生效：鼠标扫过一屏链接不该把每条都预取一遍。
    defaultPreloadDelay: 60,
    // 🔑 原来是 0，那等于**预取白做** —— 数据一落地就算过期，点下去仍要把 loader 整个
    // 重跑一遍（每次点击两趟网络）。给 10 秒：预取只服务于「马上就要点的这一下」，
    // 再久就当没预取过。常规跳转不受影响（那条归 defaultStaleTime 管，仍是 0）。
    defaultPreloadStaleTime: 10_000,
  });

  return router;
};
