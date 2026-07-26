import "./lib/error-capture";

import { consumeLastCapturedError } from "./lib/error-capture";
import { renderErrorPage } from "./lib/error-page";

type ServerEntry = {
  fetch: (request: Request, env: unknown, ctx: unknown) => Promise<Response> | Response;
};

/** Cloudflare Queues 的 Message（只用到我们真正会碰的几个成员）。 */
type QueueMessage = { body: unknown; ack: () => void; retry: () => void };

let serverEntryPromise: Promise<ServerEntry> | undefined;

async function getServerEntry(): Promise<ServerEntry> {
  if (!serverEntryPromise) {
    serverEntryPromise = import("@tanstack/react-start/server-entry").then(
      (m) => (m as { default?: ServerEntry }).default ?? (m as unknown as ServerEntry),
    );
  }
  return serverEntryPromise;
}

function brandedErrorResponse(): Response {
  return new Response(renderErrorPage(), {
    status: 500,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

function isCatastrophicSsrErrorBody(body: string, responseStatus: number): boolean {
  let payload: unknown;
  try {
    payload = JSON.parse(body);
  } catch {
    return false;
  }

  if (!payload || Array.isArray(payload) || typeof payload !== "object") {
    return false;
  }

  const fields = payload as Record<string, unknown>;
  const expectedKeys = new Set(["message", "status", "unhandled"]);
  if (!Object.keys(fields).every((key) => expectedKeys.has(key))) {
    return false;
  }

  return (
    fields.unhandled === true &&
    fields.message === "HTTPError" &&
    (fields.status === undefined || fields.status === responseStatus)
  );
}

// h3 swallows in-handler throws into a normal 500 Response with body
// {"unhandled":true,"message":"HTTPError"} — try/catch alone never fires for those.
async function normalizeCatastrophicSsrResponse(response: Response): Promise<Response> {
  if (response.status < 500) return response;
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) return response;

  const body = await response.clone().text();
  if (!isCatastrophicSsrErrorBody(body, response.status)) {
    return response;
  }

  console.error(consumeLastCapturedError() ?? new Error(`h3 swallowed SSR error: ${body}`));
  return brandedErrorResponse();
}

export default {
  async fetch(request: Request, env: unknown, ctx: unknown) {
    // The ExecutionContext is only reachable here. Publish it on an AsyncLocalStorage
    // so long-running server fns can `ctx.waitUntil()` work that must outlive the
    // response (see lib/worker-ctx.ts and the 后台任务 in identify-plant.functions.ts).
    // 动态 import：静态导入会让 Vite 把 worker-ctx 整个命名空间对象并进入口 chunk
    // 并重新导出（`export { workerCtx as w }`）。Cloudflare 校验 worker 的每个导出，
    // 而命名空间对象的原型链止于 null 而非 Object → 部署被拒 10021
    // 「Exported value's prototype chain does not end in Object」。
    const { runWithExecutionCtx } = await import("./lib/worker-ctx");
    // env 一起带上：server fn 要靠它拿 Queues 的 producer 绑定（见 lib/job-queue.ts）。
    return runWithExecutionCtx(
      ctx,
      async () => {
        try {
          // MCP 端点先于 TanStack 渲染管线处理：它给外部 agent 提供**契约稳定**的入口
          // （server fn 的 /_serverFn/<hash> 是内部实现，hash 随构建变化，外部没法稳定调）。
          // 不匹配 /api/mcp/ 时返回 null，照常往下走。
          const { handleMcpRequest } = await import("./lib/mcp-api");
          const mcpResponse = await handleMcpRequest(request);
          if (mcpResponse) return mcpResponse;

          const handler = await getServerEntry();
          const response = await handler.fetch(request, env, ctx);
          return await normalizeCatastrophicSsrResponse(response);
        } catch (error) {
          console.error(error);
          return brandedErrorResponse();
        }
      },
      env,
    );
  },

  /**
   * Queues 消费者 —— 「进一步生成草稿」和「金叶详页」真正在这里跑。
   *
   * 为什么长任务非走这儿不可：`ctx.waitUntil` 官方上限 30 秒（生产探针实测 26 秒被掐），
   * 而冷启动生成要 3–10 分钟。Queues 消费者每次调用有 15 分钟挂钟。
   *
   * **每条消息单独 ack/retry**：一批里某个任务失败，不该把同批已经跑完的任务一起重投
   * （那正是「用户被扣两次叶子」的成因）。runQueuedJob 内部还有一层幂等保护。
   */
  async queue(batch: { messages: QueueMessage[] }, env: unknown, ctx: unknown) {
    const { runWithExecutionCtx } = await import("./lib/worker-ctx");
    const { parseJobMessage } = await import("./lib/job-queue");

    return runWithExecutionCtx(
      ctx,
      async () => {
        for (const m of batch.messages) {
          const parsed = parseJobMessage(m.body);
          if (!parsed) {
            // 脏消息重投多少次都还是脏的 —— 直接 ack 丢掉，只留一条日志。
            console.error("[queue] 无法解析的消息，已丢弃：", JSON.stringify(m.body).slice(0, 200));
            m.ack();
            continue;
          }
          try {
            const { runQueuedJob } = await import("./lib/identify-plant.functions");
            await runQueuedJob(parsed.jobId);
            m.ack();
          } catch (error) {
            // runQueuedJob 自己会把失败写进任务行（前端轮询看得到），所以这里
            // **不重投**：重投只会把同一个必然失败的生成再跑一遍，白烧 token。
            console.error(`[queue] 任务 ${parsed.jobId} 抛到了最外层：`, error);
            m.ack();
          }
        }
      },
      env,
    );
  },
};
