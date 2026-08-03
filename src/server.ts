import "./lib/error-capture";

import { consumeLastCapturedError } from "./lib/error-capture";
import { renderErrorPage } from "./lib/error-page";

type ServerEntry = {
  fetch: (request: Request, env: unknown, ctx: unknown) => Promise<Response> | Response;
};

/** Cloudflare Queues 的 Message（只用到我们真正会碰的几个成员）。 */
type QueueMessage = { body: unknown; ack: () => void; retry: () => void };

/** 死信队列名 —— 与 wrangler.jsonc 的 `dead_letter_queue` 必须一致。 */
const DLQ_NAME = "plant-jobs-dlq";

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
  async queue(batch: { queue?: string; messages: QueueMessage[] }, env: unknown, ctx: unknown) {
    const { runWithExecutionCtx } = await import("./lib/worker-ctx");
    const { parseJobMessage } = await import("./lib/job-queue");

    return runWithExecutionCtx(
      ctx,
      async () => {
        // ── 死信队列：把「被平台掐死、来不及写错误」的任务补一个终态 ───────────
        //
        // 消息走到这里意味着主队列已经重投过、仍然没有 ack。最常见的成因是 isolate
        // 被直接终止（超 CPU / 超内存）—— 那种情况下 runQueuedJob 的 catch 根本没
        // 执行的机会，任务行会永远停在 running，前端只能靠「连续两分钟没心跳」去猜。
        // 这里如实写成失败，用户和管理后台看到的才是服务端真正发生的事。
        if (batch.queue === DLQ_NAME) {
          const { readJob, bindJobUpdates } = await import("./lib/background-jobs");
          for (const m of batch.messages) {
            const parsed = parseJobMessage(m.body);
            m.ack(); // 无论标不标得上，死信都不该再转圈
            if (!parsed) continue;
            try {
              const rec = await readJob(parsed.jobId);
              // 已经是 done/error 的就别覆盖 —— 那是任务自己写下的结论，比这里准。
              if (!rec || rec.status !== "running") continue;
              const msg =
                `生成中断（SERVER_ABORTED）：这次生成在服务端被中止，未能跑完（阶段：${rec.phase || "未知"}）。` +
                `已重试过一次仍失败，通常是单次执行超出了平台的 CPU/内存上限。请重试；` +
                `反复出现请把这个时间点告诉站点维护者，Cloudflare 日志里有具体原因。`;
              await bindJobUpdates(rec).fail(msg);
              // 动态流也要收尾：不写的话小P蛙那条橙色进度条会永远转下去
              // （2026-07-29 修过一次同样的病，成因是收尾没 await）。
              const { upsertTaskFeed } = await import("./lib/task-feed.functions");
              await upsertTaskFeed({
                userId: rec.userId,
                kind:
                  rec.kind === "quick_identify"
                    ? "identify"
                    : rec.kind === "enrich_draft"
                      ? "enrich_draft"
                      : "gold_page",
                draftId: rec.draftId || null,
                jobId: rec.id,
                status: "error",
                phase: "已失败",
                error: msg.slice(0, 500),
                markUnread: true,
              });
              console.error(`[queue-dlq] 任务 ${parsed.jobId} 进入死信，已标记为失败`);
            } catch (e) {
              console.error(`[queue-dlq] 标记任务 ${parsed.jobId} 失败时出错：`, e);
            }
          }
          return;
        }

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
