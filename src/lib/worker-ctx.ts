// ─── Cloudflare ExecutionContext passthrough ─────────────────────────────────
// Cloudflare 边缘对**响应**有 100 秒上限：一个 server fn 要是跑到 100 秒还没回，
// 连接就被掐断（前端表现为 `failed to fetch`）。长任务（进一步生成草稿 / 金叶详页）
// 必须「立刻回一个任务 ID，剩下的活在响应之后继续跑」。
//
// Workers 里让工作活过响应的唯一正规手段是 `ctx.waitUntil(promise)`。而 ctx 只在
// worker 的 fetch 入口拿得到（见 src/server.ts），server fn 里没有。这里用
// AsyncLocalStorage 把它顺着调用链传下去 —— 不能用模块级全局变量：同一个 isolate 会
// 并发处理多个请求，拿错别人的（可能已结束的）ctx，waitUntil 会失效甚至抛错。
//
// nodejs_compat 已在 wrangler.jsonc 打开，所以 node:async_hooks 可用；万一不可用
// （本地某些运行时/测试环境），下面会优雅退化成「不追踪、直接后台跑」。

type ExecutionCtxLike = { waitUntil?: (p: Promise<unknown>) => void };

/**
 * Worker 的 env（各类绑定所在处）。目前只用到 Queues 的 producer 绑定。
 * 和 ctx 一样，它只在 fetch 入口拿得到，所以搭同一趟 ALS 顺风车。
 */
export type WorkerEnvLike = {
  PLANT_JOBS?: { send: (body: unknown) => Promise<void> };
  [k: string]: unknown;
};

type Store = { ctx: ExecutionCtxLike | undefined; env: WorkerEnvLike | undefined };

let als: { run<T>(s: Store, fn: () => T): T; getStore(): Store | undefined } | undefined;
let alsPromise: Promise<typeof als> | undefined;

async function getAls() {
  if (als) return als;
  if (!alsPromise) {
    alsPromise = import("node:async_hooks")
      .then((m) => {
        als = new m.AsyncLocalStorage<Store>();
        return als;
      })
      .catch((e) => {
        console.warn("[worker-ctx] AsyncLocalStorage unavailable; waitUntil disabled:", e);
        return undefined;
      });
  }
  return alsPromise;
}

/** Wrap the worker's fetch handler so anything downstream can reach `ctx` / `env`. */
export async function runWithExecutionCtx<T>(
  ctx: unknown,
  fn: () => T | Promise<T>,
  env?: unknown,
): Promise<T> {
  const store = await getAls();
  if (!store) return fn();
  return store.run(
    {
      ctx: (ctx ?? undefined) as ExecutionCtxLike | undefined,
      env: (env ?? undefined) as WorkerEnvLike | undefined,
    },
    fn,
  ) as Promise<T>;
}

/** The ExecutionContext of the request currently being handled, if any. */
export function currentExecutionCtx(): ExecutionCtxLike | undefined {
  return als?.getStore()?.ctx;
}

/**
 * 当前请求的 worker env（绑定）。本地 vite dev 没有 workerd，这里会是 undefined ——
 * 调用方必须能接受拿不到绑定并降级，不能假定它一定在。
 */
export function currentEnv(): WorkerEnvLike | undefined {
  return als?.getStore()?.env;
}

/**
 * Keep `promise` alive after the HTTP response has been sent.
 *
 * With a real ExecutionContext this is `ctx.waitUntil`.
 *
 * ⚠️ **它只能续命约 30 秒**（官方 limits 页写明 waitUntil 最多延长 30s，2026-07-20
 * 生产探针实测在第 26 秒被掐）。所以它**不是**长任务的载体 —— 真正的长任务走
 * Cloudflare Queues（消费者 15 分钟），见 lib/job-queue.ts。这里保留 waitUntil
 * 只是「队列绑定不可用时」的退路，聊胜于无。
 *
 * Without one (dev server, tests) it degrades to plain fire-and-forget, which
 * is fine there because the process isn't torn down per request.
 *
 * Never rejects: an unhandled rejection inside waitUntil would take the whole
 * request down, and the job store already records the failure.
 */
export function keepAlive(promise: Promise<unknown>): void {
  const safe = promise.catch((e) => {
    console.error("[worker-ctx] background task rejected:", e);
  });
  const ctx = currentExecutionCtx();
  if (ctx?.waitUntil) {
    try {
      ctx.waitUntil(safe);
      return;
    } catch (e) {
      console.warn("[worker-ctx] waitUntil threw; falling back to fire-and-forget:", e);
    }
  }
  void safe;
}
