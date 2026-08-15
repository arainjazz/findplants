// ─── 路由等待中的占位 ────────────────────────────────────────────────────────
//
// 2026-08-15：全站**一个 pendingComponent 都没有**，于是任何路由在 loader 落地前都会
// 继续渲染**上一页** —— 点了之后屏幕一动不动，用户只能理解成「没跳」。线上取证：把
// 草稿页 loader 的那条查询挂起，URL 985ms 就切走了，可 8 秒内 DOM 变化 0 次。
//
// 🔑 **这个文件不许引任何重东西**（它跟着 router 进主包，且要在最慢的那一刻才顶用）：
// 只有一段内联 SVG 和几个 Tailwind 类，不碰 SiteHeader、不发请求。
// 什么时候出现由 `defaultPendingMs` 决定 —— 快的跳转根本轮不到它，不会闪。

export function RoutePending() {
  return (
    <div
      className="min-h-screen flex flex-col items-center justify-center gap-3 px-6"
      role="status"
      aria-live="polite"
    >
      <svg
        viewBox="0 0 24 24"
        width="28"
        height="28"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="text-leaf-deep animate-pulse"
        aria-hidden="true"
      >
        {/* 一片叶子：和站内的叶脉语汇对齐，比转圈更像这个站的东西 */}
        <path d="M20 4c0 8-5 13-13 13H4c0-8 5-13 13-13h3Z" />
        <path d="M4 20c3-6 7-9 12-11" />
      </svg>
      <p className="label text-[10px] text-ink-soft">载入中…</p>
    </div>
  );
}
