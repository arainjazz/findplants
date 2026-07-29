// ─── 「这一页有没有自己的小P蛙」的登记处 ──────────────────────────────────────
//
// 为什么不能用 React context（原来那版就是，且**从来没生效过**）：
// 全局那只青蛙挂在 `__root.tsx`，而页面自带的那只（drafts/$id、plants/$slug）
// 在 `<Outlet/>` **里面** —— 是全局那只的**兄弟节点的后代**。context 只能向下流，
// 后代里的 Provider 对上面的兄弟毫无影响，于是 `useContext` 永远读到默认值 false。
// 这个 bug 一直被「动态流为空时全局浮标整个不渲染」掩盖着：两只青蛙都没出现，
// 自然也看不出去重失效。把「浮标必须常驻」修好的同一刻，它就会暴露成右下角并排两只。
//
// 所以改用一个模块级的订阅小仓库：页面自带的那只在挂载时登记，全局那只据此让位。
// 计数而不是布尔：路由切换时新页面的 panel 可能先挂载、旧页面的后卸载，
// 用布尔会被后卸载的那次误置回 false。

import { useEffect, useLayoutEffect, useState, useSyncExternalStore } from "react";

/** SSR 下 useLayoutEffect 会告警，服务端本来也不需要登记 —— 退回 useEffect。 */
const useIsomorphicLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

let mountedCount = 0;
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

/**
 * 页面自带的小P蛙在挂载时调用，返回卸载时要执行的注销函数。
 *
 * ⚠️ 调用点必须是 `useLayoutEffect` 而不是 `useEffect`：全局那只要靠自己的
 * `useEffect` 判断该不该出现，而 React 的执行顺序是「后代的 layout effect →
 * 后代的 effect → 祖先的 effect」。用 useEffect 登记会与全局那只赛跑，
 * 表现为右下角闪一下两只青蛙。
 */
export function registerPageXiaoP(): () => void {
  mountedCount += 1;
  emit();
  let released = false;
  return () => {
    if (released) return; // 防重复调用把计数减穿
    released = true;
    mountedCount -= 1;
    emit();
  };
}

/**
 * 页面自带的小P蛙在自己组件里调用一次就行，挂载/卸载的登记与注销都包好了。
 *
 * 🔴 `enabled` 不是可有可无的开关，**全局那只必须传 false**：它渲染的也是
 * `XiaoPAgentPanel`，若照样登记，就成了「我登记 → 我看到有人登记了 → 我让位 →
 * 登记消失 → 我又出现」的自锁死循环。实测报的是 React
 * “Maximum update depth exceeded”，栈顶正是 useSyncExternalStore 的
 * forceStoreRerender —— 整个 TaskFeedLauncher 被错误边界吃掉，页面上一只青蛙都没有。
 */
export function usePageXiaoPRegistration(enabled = true): void {
  useIsomorphicLayoutEffect(() => {
    if (!enabled) return;
    return registerPageXiaoP();
  }, [enabled]);
}

/** 当前页面有没有自带的小P蛙对话面板。 */
export function usePageXiaoPMounted(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => mountedCount > 0,
    () => false, // SSR：服务端没有「已挂载」这回事
  );
}

/**
 * 是否已经完成水合。全局那只青蛙用它把首帧让掉 ——
 * 服务端渲染时读不到登记状态，直接画会在自带面板的页面上闪出第二只。
 */
export function useHydrated(): boolean {
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => setHydrated(true), []);
  return hydrated;
}
