// ─── 前端：后台任务轮询 ───────────────────────────────────────────────────────
// 配套 lib/background-jobs.ts。长任务（进一步生成草稿 / 金叶详页）现在由 server fn
// 立刻返回一个 jobId，真正的活在服务端后台跑；这里负责每几秒问一次进度，并把阶段文案
// 交给调用方去更新 toast。
//
// 关键收益：任务活在**服务端**，不再挂在那一个前台 HTTP 请求上。所以用户刷新页面、
// 关掉标签页、换台设备再回来，只要 jobId 还在（存 localStorage），都能接着看进度。

import { pollJobFn } from "./identify-plant.functions";

/** 轮询间隔。3 秒足够跟手，又不会把 site_config 打爆。 */
const POLL_INTERVAL_MS = 3000;
/** 兜底上限：任务再慢也不该超过这个时长，超了就当它挂了，免得无限转圈。 */
const POLL_TIMEOUT_MS = 20 * 60 * 1000;

export type JobOutcome<T> =
  | { ok: true; result: T }
  | {
      ok: false;
      error: string;
      /** true = 服务端已明确判定失败（而非轮询侧放弃） */ reported: boolean;
      /** 用户自己撤销的 —— 调用方据此静默收场，不要弹「识别失败」。 */
      cancelled?: boolean;
    };

/** 可被 signal 打断的等待：取消时不该再干等满 3 秒才有反应。 */
const sleepOrAbort = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve) => {
    if (signal?.aborted) return resolve();
    const t = setTimeout(done, ms);
    function done() {
      clearTimeout(t);
      signal?.removeEventListener("abort", done);
      resolve();
    }
    signal?.addEventListener("abort", done, { once: true });
  });

/**
 * 一直轮询到任务结束。**不会 reject** —— 失败信息走返回值，调用方只需处理一种分支。
 *
 * `onPhase` 每次拿到新阶段文案时被调用（同一段文案不会重复回调，避免 toast 抖动）。
 *
 * `opts.signal` 一旦 abort，轮询立刻收手并返回 `cancelled: true`。**注意它只停轮询、
 * 不停服务端**：真正让服务端别再往草稿里写，靠的是 `cancelJobFn` 写的取消标记
 * （见 background-jobs.ts 的 requestJobCancel）。两件事必须都做。
 */
export async function awaitJob<T>(
  jobId: string,
  onPhase?: (phase: string, progress: number) => void,
  opts?: {
    signal?: AbortSignal;
    /**
     * 未登录访客的取件号（见 lib/anon-id.ts）。没有它，服务端认不出这份任务归谁，
     * 一律回 `found:false` —— 匿名识别就会在「找不到这个生成任务」上原地打转。
     * 登录用户不传：服务端只认令牌。
     */
    anonId?: string;
  },
): Promise<JobOutcome<T>> {
  const startedAt = Date.now();
  let lastPhase = "";
  // 连续读不到任务行时的容错：偶发网络抖动不该直接判死，连着几次才算数。
  let missStreak = 0;

  for (;;) {
    if (opts?.signal?.aborted) {
      return { ok: false, reported: true, cancelled: true, error: "已取消这次识别。" };
    }
    if (Date.now() - startedAt > POLL_TIMEOUT_MS) {
      return {
        ok: false,
        reported: false,
        error:
          "生成超时：已等待 20 分钟，前端先停下了。任务可能仍在服务端跑 —— 刷新本页会自动接回，请先别急着重试。",
      };
    }

    let snap: Awaited<ReturnType<typeof pollJobFn>> | null = null;
    try {
      snap = await pollJobFn({ data: { jobId, anonId: opts?.anonId } });
    } catch {
      // 网络/鉴权抖动：下一轮再试。
      snap = null;
    }

    if (snap && snap.found) {
      missStreak = 0;
      if (snap.phase && snap.phase !== lastPhase) {
        lastPhase = snap.phase;
        onPhase?.(snap.phase, snap.progress);
      }
      if (snap.status === "done") return { ok: true, result: snap.result as T };
      if (snap.status === "error") {
        return {
          ok: false,
          reported: true,
          error: snap.error || "生成失败（UNKNOWN）：发生了未知错误，请重试。",
        };
      }
      if (snap.stale) {
        // 走到这里意味着：任务**已经被消费者接走**（有 startedAt），然后连丢两分钟心跳。
        // 排队等待期间不会再进这个分支了 —— 那是 2026-07-29 修掉的一个大误判：
        // 心跳由消费者打，排队中的任务本来就没有心跳，却被 2 分钟阈值判成了死亡，
        // 于是用户一次连开几个任务，后面几个必然弹「生成中断」，而它们其实都跑完了。
        //
        // ⚠️ 文案**刻意不再归因到「平台单次请求上限」**：那是 2026-07-21 免费版时期的
        // 真凶，用户当天就开了 Workers Paid（子请求 50→1000），这条归因从此是错的，
        // 却一直把人往「精简配图 / 升级套餐」这个死胡同里带。现在只说观察到的事实，
        // 并把人指向真正查得到东西的地方（管理后台的任务记录里有服务端写下的真错误）。
        return {
          ok: false,
          reported: false,
          error:
            "生成中断：任务在服务端失去响应（已连续两分钟没有心跳）。" +
            // 从前这里断言「多半是模型那端长时间不返回」—— 那是猜的，而且常常猜错。
            // 真正的判定现在由服务端给：任务被平台掐死时会走死信队列，几十秒内就会
            // 被如实写成「生成中断（SERVER_ABORTED）」。所以这里只说观察到的事实，
            // 并告诉用户去哪儿看真结论。
            "服务端可能仍在收尾 —— 稍等片刻刷新本页，若确实失败了，小P蛙动态流里会写出具体原因。" +
            "反复出现请把这个时间点告诉站点维护者，Cloudflare 日志里有确切死因。",
        };
      }
    } else if (snap) {
      // found:false —— 任务行不见了（过期清理 / 从未建成）。
      if (++missStreak >= 3) {
        return { ok: false, reported: false, error: "找不到这个生成任务，它可能已过期。请重试。" };
      }
    }

    await sleepOrAbort(POLL_INTERVAL_MS, opts?.signal);
  }
}

// ── 断线续跑：把进行中的 jobId 记在本地，刷新后自动接回去 ──────────────────────
const LS_PREFIX = "plantspedia:job:";

export function rememberJob(scope: string, jobId: string): void {
  try {
    localStorage.setItem(LS_PREFIX + scope, jobId);
  } catch {
    /* 隐私模式 / 存储满 —— 只是少了续跑能力，不影响本次生成 */
  }
}

export function recallJob(scope: string): string | null {
  try {
    return localStorage.getItem(LS_PREFIX + scope);
  } catch {
    return null;
  }
}

export function forgetJob(scope: string): void {
  try {
    localStorage.removeItem(LS_PREFIX + scope);
  } catch {
    /* ignore */
  }
}
