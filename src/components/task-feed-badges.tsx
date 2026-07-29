// ─── 小P蛙浮标上的三色角标 ────────────────────────────────────────────────────
//
// 用户 2026-07-29 指定的语义：
//   · 图标**下面**：每类任务一条进度条 —— 绿=识别 / 蓝=银叶草稿 / 橙=金叶详页
//   · 图标**右上角**：每类一个圆圈，数字 = 已完成但没看过的条数
//
// 颜色一律从 task-feed.ts 的 TASK_KIND_META 取，不在这里硬写 ——
// 进度条、圆圈、摘要卡边框三处必须同色，各写各的迟早对不上。

import { TASK_KIND_META, type TaskFeedRow, type TaskKind } from "@/lib/task-feed";

const ORDER: TaskKind[] = ["identify", "enrich_draft", "gold_page"];

/**
 * 图标下面的进度条组。只显示**正在跑**的那几类，全都闲着时整块不渲染
 * （避免浮标下面常年挂着三条空槽）。
 */
export function TaskProgressBars({ active }: { active: Partial<Record<TaskKind, TaskFeedRow>> }) {
  const running = ORDER.filter((k) => active[k]);
  if (!running.length) return null;

  return (
    <div className="w-full flex flex-col gap-1 mt-1" aria-label="任务进度">
      {running.map((kind) => {
        const row = active[kind]!;
        const meta = TASK_KIND_META[kind];
        return (
          <div key={kind} className="w-full" title={`${meta.label}：${row.phase || "进行中"}`}>
            <div className="h-1.5 w-full rounded-full bg-ink/10 overflow-hidden">
              <div
                className={`h-full rounded-full ${meta.bar} transition-[width] duration-700 ease-out`}
                // 至少留 6% —— 进度 0 时一条完全看不见的进度条等于没有反馈。
                style={{ width: `${Math.max(6, row.progress)}%` }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}

/**
 * 图标右上角的未读圆圈。三类各一个，只在该类有未读时出现。
 *
 * 横排而不是叠在一起：三个数字要能同时看清，叠起来就只剩最上面那个可读。
 */
export function TaskUnreadRings({ unread }: { unread: Record<TaskKind, number> }) {
  const shown = ORDER.filter((k) => unread[k] > 0);
  if (!shown.length) return null;

  return (
    <span className="absolute -top-1.5 -right-1.5 flex flex-row-reverse gap-0.5" aria-live="polite">
      {shown.map((kind) => {
        const meta = TASK_KIND_META[kind];
        return (
          <span
            key={kind}
            title={`${meta.label}：${unread[kind]} 条未查看`}
            className={`${meta.ring} text-white text-[10px] font-bold leading-none min-w-[16px] h-4 px-1 rounded-full flex items-center justify-center shadow ring-2 ring-paper tabular-nums`}
          >
            {unread[kind] > 99 ? "99+" : unread[kind]}
          </span>
        );
      })}
    </span>
  );
}
