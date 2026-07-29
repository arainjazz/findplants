// ─── 任务动态流：小P蛙通知中心的数据层 ────────────────────────────────────────
//
// 三类 AI 任务（识别 / 银叶草稿 / 金叶详页）跑起来都要几十秒到十几分钟。在此之前，
// 进度只在**发起它的那个页面**上可见 —— 用户切走去识别下一株就再也看不到，
// 更不知道哪几个已经跑完。这个模块把「谁的、什么任务、跑到哪了、看过没有」
// 落到 `task_feed` 表，让小P蛙浮标能长期显示它们。
//
// 分工（与 background-jobs.ts 划清界限）：
//   · `site_config` 的 job 行 = **执行状态**，队列消费者读写，6 小时后被清掉；
//   · 本表           = **动态流 + 已读**，长期保留，只为 UI 服务。
// 两边都写是刻意的：job 行是任务能不能跑完的权威，动态流断了不影响任务本身。
//
// 已读判定（用户 2026-07-29 拍板）：**进过那份草稿的详情页就算已读**，
// 而不是「在小P蛙里点了卡片」。所以 markDraftRead 由 /drafts/$id 在挂载时调用。
//
// 匿名用户不进动态流（表上 user_id not null）—— 用户明确表示重点照顾注册用户与编辑。
// 匿名识别一切照旧，只是不出现在小P蛙里。

/** 任务类型 → 小P蛙上的颜色。改这里就改了全站三色的语义。 */
export type TaskKind = "identify" | "enrich_draft" | "gold_page";

export type TaskStatus = "running" | "done" | "error";

export type TaskFeedRow = {
  id: string;
  kind: TaskKind;
  jobId: string | null;
  draftId: string | null;
  status: TaskStatus;
  phase: string;
  progress: number;
  title: string | null;
  thumbUrl: string | null;
  summary: string | null;
  error: string | null;
  readAt: string | null;
  createdAt: string;
  updatedAt: string;
};

/**
 * 三类任务在界面上的呈现规格。**颜色写在这里，不散落在组件里** ——
 * 进度条、未读圆圈、摘要卡边框三处必须同色，分散写迟早对不上。
 */
export const TASK_KIND_META: Record<
  TaskKind,
  { label: string; color: string; ring: string; bar: string; text: string }
> = {
  identify: {
    label: "识别",
    color: "绿",
    ring: "bg-emerald-500",
    bar: "bg-emerald-500",
    text: "text-emerald-600",
  },
  enrich_draft: {
    label: "银叶草稿",
    color: "蓝",
    ring: "bg-sky-500",
    bar: "bg-sky-500",
    text: "text-sky-600",
  },
  gold_page: {
    label: "金叶详页",
    color: "橙",
    ring: "bg-amber-500",
    bar: "bg-amber-500",
    text: "text-amber-600",
  },
};

/** 动态流一次拉多少条。够铺满小P蛙的列表，又不至于把首屏拖慢。 */
export const FEED_LIMIT = 30;

/**
 * 动态流里「还在跑」的任务多久算失联。
 *
 * 比 background-jobs 的 JOB_STALE_MS（2 分钟）**宽得多**：那个判的是「任务是不是死了」，
 * 有 15 秒心跳做依据；这里判的只是「进度条要不要显示成灰的」，而动态流的 updated_at
 * 只在阶段推进时才写（不跟心跳），撰稿一跑五分钟是常态。卡太紧会把正常任务显示成失联。
 */
export const FEED_STALE_MS = 20 * 60 * 1000;

export function isFeedStale(row: TaskFeedRow, now = Date.now()): boolean {
  if (row.status !== "running") return false;
  const t = Date.parse(row.updatedAt);
  if (!Number.isFinite(t)) return false;
  return now - t > FEED_STALE_MS;
}

/** DB 行（snake_case）→ 前端形状（camelCase）。 */
export function readFeedRow(raw: unknown): TaskFeedRow | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const kind = String(r.kind ?? "");
  if (kind !== "identify" && kind !== "enrich_draft" && kind !== "gold_page") return null;
  const status = String(r.status ?? "running");
  return {
    id: String(r.id ?? ""),
    kind,
    jobId: r.job_id ? String(r.job_id) : null,
    draftId: r.draft_id ? String(r.draft_id) : null,
    status: status === "done" || status === "error" ? status : "running",
    phase: String(r.phase ?? ""),
    progress: Math.max(0, Math.min(100, Number(r.progress ?? 0) || 0)),
    title: r.title ? String(r.title) : null,
    thumbUrl: r.thumb_url ? String(r.thumb_url) : null,
    summary: r.summary ? String(r.summary) : null,
    error: r.error ? String(r.error) : null,
    readAt: r.read_at ? String(r.read_at) : null,
    createdAt: String(r.created_at ?? ""),
    updatedAt: String(r.updated_at ?? ""),
  };
}

/** 每类任务的未读数（右上角圆圈里的数字）。只数**已完成且没看过**的。 */
export function unreadCounts(rows: TaskFeedRow[]): Record<TaskKind, number> {
  const out: Record<TaskKind, number> = { identify: 0, enrich_draft: 0, gold_page: 0 };
  for (const r of rows) {
    if (r.status === "done" && !r.readAt) out[r.kind] += 1;
  }
  return out;
}

/**
 * 每类任务「失败且没看过」的条数。
 *
 * 为什么要单独数一份：`unreadCounts` 只数 done，于是**任务失败时浮标上什么都不出现** ——
 * 进度条没有（已不 running）、未读圈也没有（不是 done）。用户 2026-07-29 报的
 * 「识别失败了，可小P蛙底下没进度条、右上角也没角标」正是这个。失败恰恰是最该主动
 * 告诉人的一件事，不该是三类状态里最安静的那个。
 */
export function failedCounts(rows: TaskFeedRow[]): Record<TaskKind, number> {
  const out: Record<TaskKind, number> = { identify: 0, enrich_draft: 0, gold_page: 0 };
  for (const r of rows) {
    if (r.status === "error" && !r.readAt) out[r.kind] += 1;
  }
  return out;
}

/** 未看过的失败总数（右上角那个红圈里的数字）。 */
export function totalFailed(rows: TaskFeedRow[]): number {
  const c = failedCounts(rows);
  return c.identify + c.enrich_draft + c.gold_page;
}

/**
 * 每类任务当前**正在跑**的那一条（小P蛙图标下面的进度条画的就是它）。
 *
 * 同类有多个在跑时取**最近更新**的那条 —— 用户连着点了三次「进一步生成草稿」时，
 * 进度条该跟着最新的那个走，而不是卡在第一个上。
 */
export function activeByKind(
  rows: TaskFeedRow[],
  now = Date.now(),
): Partial<Record<TaskKind, TaskFeedRow>> {
  const out: Partial<Record<TaskKind, TaskFeedRow>> = {};
  for (const r of rows) {
    if (r.status !== "running" || isFeedStale(r, now)) continue;
    const cur = out[r.kind];
    if (!cur || Date.parse(r.updatedAt) > Date.parse(cur.updatedAt)) out[r.kind] = r;
  }
  return out;
}

/** 未读总数（浮标上只显示一个大数时用）。 */
export function totalUnread(rows: TaskFeedRow[]): number {
  const c = unreadCounts(rows);
  return c.identify + c.enrich_draft + c.gold_page;
}
