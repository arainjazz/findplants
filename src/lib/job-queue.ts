// ─── 长任务的真正载体：Cloudflare Queues ─────────────────────────────────────
//
// **为什么不是 waitUntil**（这条弯路走了两轮，别再走第三次）：
// 官方 limits 页写明 `waitUntil()` 最多把执行延长 **30 秒**；2026-07-20 用生产探针
// 实测是第 26 秒被掐（探针只做 sleep + 写库，排除了「任务抛错」这个替代解释）。
// 而「进一步生成草稿」冷启动要跑联网调研 + 抓图 + 视觉分类 + 长文撰写，3–10 分钟起步。
// 换模型、换 key、调心跳阈值都救不了 —— 这是平台硬限制。
//
// Queues 的消费者每次调用有 **15 分钟**挂钟（已查官方 limits 页，2026-07-20），
// 且**不要求 Workers Paid**（限制对免费版同样适用，只有消息保留期不同：
// 免费 24 小时不可配，付费可配到 14 天）。这纠正了 STATE 续15 里「几乎可以确定
// 需要 Paid」的猜测。
//
// **消息里只放 jobId。** 任务的真实入参（email、用户自带模型配置）存在
// `site_config` 的任务行里 —— 那些配置含 API Key，不该被写进队列存上 24 小时。
// 顺带好处：消息永远远小于 128KB 上限，不用担心 draft 变大把消息撑爆。

import { currentEnv } from "./worker-ctx";

/** 队列消息体。刻意只有一个字段 —— 其余一切从 site_config 的任务行里读。 */
export type JobMessage = { jobId: string };

/** 绑定名，与 wrangler.jsonc 里的 `queues.producers[].binding` 必须一致。 */
const BINDING = "PLANT_JOBS";
/** 长任务车道的绑定名。见下面 `lane` 的注释。 */
const BINDING_LONG = "PLANT_JOBS_LONG";

/**
 * 走哪条车道。
 *
 * **为什么要分**（2026-09-08）：识别和「银叶草稿 / 金叶详页」原本挤在同一条队列上，
 * 而两者的时长差两个数量级 —— 识别 20–40 秒，金叶 3–10 分钟。
 * 给消费者设并发上限（把爆发削成排队、别一口气打爆免费模型的额度）时，这就要命了：
 * 上限压到 2，两个金叶任务就能把识别堵在后面十分钟，用户拍完照只能干等。
 *
 * 拆开之后两条车道各自限流：
 *  · `fast`（`plant-jobs`）—— 只跑识别，并发 2，用户在等，必须一直有位置；
 *  · `long`（`plant-jobs-long`）—— 银叶/金叶，并发 1，慢就慢，反正是后台任务。
 */
export type JobLane = "fast" | "long";

/**
 * 把任务推进队列。**返回 false 表示没推成**（本地 vite dev 没有 workerd，
 * 或队列尚未创建/绑定），调用方必须据此退回 waitUntil，绝不能假定它一定成功 ——
 * 否则功能上线那一刻，任何绑定问题都会变成「点了按钮什么也没发生」。
 *
 * `lane` 选不到绑定时**自动退回主队列**再退回 waitUntil。这一层降级是刻意的：
 * 代码可能先于 `plant-jobs-long` 队列上线（或者队列被误删），那时长任务照样得能跑，
 * 只是暂时和识别挤在一起 —— 比直接掉进 26 秒的 waitUntil 强得多。
 */
export async function enqueueJob(jobId: string, lane: JobLane = "fast"): Promise<boolean> {
  try {
    const env = currentEnv();
    const wanted = lane === "long" ? BINDING_LONG : BINDING;
    let name = wanted;
    let q = env?.[name] as { send?: (b: unknown) => Promise<void> } | undefined;
    if (!q?.send && lane === "long") {
      console.warn(`[job-queue] 没有 ${BINDING_LONG} 绑定，长任务暂时退回 ${BINDING}`);
      name = BINDING;
      q = env?.[name] as { send?: (b: unknown) => Promise<void> } | undefined;
    }
    if (!q?.send) {
      console.warn(`[job-queue] 没有 ${name} 绑定，退回 waitUntil（仅约 26 秒）`);
      return false;
    }
    const msg: JobMessage = { jobId };
    await q.send(msg);
    console.log(`[job-queue] 已入队 job ${jobId}（车道 ${lane} → ${name}）`);
    return true;
  } catch (e) {
    console.warn("[job-queue] 入队失败，退回 waitUntil：", e instanceof Error ? e.message : e);
    return false;
  }
}

/** 解析队列消息体，形状不对返回 null（脏消息不该让整批 retry）。 */
export function parseJobMessage(body: unknown): JobMessage | null {
  if (!body || typeof body !== "object") return null;
  const id = (body as { jobId?: unknown }).jobId;
  return typeof id === "string" && id ? { jobId: id } : null;
}
