// ─── 只在服务端存在的「读当前请求的 Authorization 头」──────────────────────────
//
// 为什么要单独一个 `.server.ts`：`@tanstack/react-start/server` 被 import-protection
// 插件列为**客户端禁止导入**。它原本写在 `resolveCreator` 里没出事，是因为那条链路
// 只从 `createServerFn().handler()` 的闭包里进得去，而编译器会把 handler 体从客户端
// 产物里剥掉。
//
// 2026-07-29 把 quickIdentify 的 658 行 handler 体抽成模块级的 `runQuickIdentifyCore`
// （为了让队列消费者也能调）之后，这条链路变成了**模块级可达**，那句 import 就跟着
// 泄进客户端依赖图 —— dev server 直接 500，而 `npm run build` 却照过，非常有迷惑性。
//
// `.server.ts` 后缀是本仓库既有的服务端边界约定（见 integrations/supabase/client.server）。

/**
 * 取当前请求的 `Authorization` 头。拿不到（不在请求上下文里、或运行时不支持）返回 null ——
 * 调用方一律把它当「匿名」处理，绝不因此抛错。
 */
export async function getAuthorizationHeader(): Promise<string | null> {
  try {
    const { getRequestHeader } = await import("@tanstack/react-start/server");
    return getRequestHeader("Authorization") ?? null;
  } catch {
    return null;
  }
}
