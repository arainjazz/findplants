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
    };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * 一直轮询到任务结束。**不会 reject** —— 失败信息走返回值，调用方只需处理一种分支。
 *
 * `onPhase` 每次拿到新阶段文案时被调用（同一段文案不会重复回调，避免 toast 抖动）。
 */
export async function awaitJob<T>(
  jobId: string,
  onPhase?: (phase: string, progress: number) => void,
): Promise<JobOutcome<T>> {
  const startedAt = Date.now();
  let lastPhase = "";
  // 连续读不到任务行时的容错：偶发网络抖动不该直接判死，连着几次才算数。
  let missStreak = 0;

  for (;;) {
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
      snap = await pollJobFn({ data: { jobId } });
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
        // 后台任务每 15 秒打一次心跳，所以「连丢两分钟心跳」基本只剩一种解释：
        // 那个 isolate 真的没了、任务不会自己复活。**换模型救不了**，这跟模型快慢无关。
        // 实测过的真凶：生成一趟发的对外请求数超过 Cloudflare 单次调用上限（免费版 50），
        // 连「把失败原因写回任务行」的那次写入都没了配额 → 只能退回这条兜底文案。
        // 已按「减少每趟子请求数」优化；若仍反复出现，多半是配图/联网调研太重，
        // 需要进一步精简或升级 Workers 套餐（子请求上限 50→1000），而不是换模型。
        return {
          ok: false,
          reported: false,
          error:
            "生成中断：任务在服务端异常结束（多为触及平台单次请求上限，与模型快慢无关）。请重试一次；若反复出现，请联系站点维护者精简配图或升级 Workers 套餐。",
        };
      }
    } else if (snap) {
      // found:false —— 任务行不见了（过期清理 / 从未建成）。
      if (++missStreak >= 3) {
        return { ok: false, reported: false, error: "找不到这个生成任务，它可能已过期。请重试。" };
      }
    }

    await sleep(POLL_INTERVAL_MS);
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
