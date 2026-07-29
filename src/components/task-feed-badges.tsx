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

/** 最多同时画几根条。再多就只报数字 —— 一摞条子糊在浮标下面反而读不出信息。 */
const MAX_BARS = 5;

/**
 * 图标下面的进度条组：**一个在跑的任务一根条**，颜色按类走。
 * 全都闲着时整块不渲染（避免浮标下面常年挂着空槽）。
 *
 * 自带不透明底板是刻意的：浮标下面紧挨着「小P蛙」白名牌，那块有 `shadow-sm`，
 * 阴影糊到 6px 高的细条上，看起来就是被啃掉一半（用户 2026-07-29：「白色状态框
 * 会对颜色进度条造成遮挡」）。给它自己的卡片 + `relative z-10`，谁也压不住谁。
 */
export function TaskProgressBars({ tasks }: { tasks: TaskFeedRow[] }) {
  if (!tasks.length) return null;
  const shown = tasks.slice(0, MAX_BARS);
  const hidden = tasks.length - shown.length;

  return (
    <div
      // min-w：不给下限的话整块宽度由「小P蛙」名牌决定（约 92px），
      // 去掉类型名和内边距后留给条子的只剩 60 来 px，进度差别根本看不出来。
      className="relative z-10 w-full min-w-[7.5rem] flex flex-col gap-[3px] bg-paper/95 border border-leaf/30 rounded-lg px-1.5 py-1 shadow-sm"
      aria-label={`${tasks.length} 个任务进行中`}
    >
      {shown.map((row) => {
        const meta = TASK_KIND_META[row.kind];
        return (
          <div
            key={row.id}
            className="flex items-center gap-1"
            title={`${meta.label}${row.title ? ` · ${row.title}` : ""}：${row.phase || "进行中"}（${row.progress}%）`}
          >
            {/* 条上带类型名：三根条同时在跑时，光靠颜色分辨要求用户先背下
                「绿=识别 / 蓝=银叶 / 橙=金叶」。写出来就不用猜，也让颜色对不对
                一眼可验（用户 2026-07-29 就在质疑某根条的颜色对不对）。 */}
            <span className={`text-[9px] leading-none shrink-0 font-semibold ${meta.text}`}>
              {meta.short}
            </span>
            <span className="h-2 flex-1 rounded-full bg-ink/10 overflow-hidden">
              <span
                className={`block h-full rounded-full ${meta.bar} transition-[width] duration-700 ease-out`}
                // 至少留 6% —— 进度 0 时一条完全看不见的进度条等于没有反馈。
                style={{ width: `${Math.max(6, row.progress)}%` }}
              />
            </span>
          </div>
        );
      })}
      {hidden > 0 && (
        <span className="text-[9px] leading-none text-ink-soft text-center tabular-nums">
          +{hidden} 个在跑
        </span>
      )}
    </div>
  );
}

/**
 * 图标右上角的未读圆圈。三类各一个，只在该类有未读时出现。
 *
 * 横排而不是叠在一起：三个数字要能同时看清，叠起来就只剩最上面那个可读。
 *
 * **红圈 = 失败**，排在三色之外单独一个：失败若也按类着色，用户就分不出
 * 「绿3」是三条识别好了还是三条识别炸了 —— 这两件事的处理方式完全相反。
 */
export function TaskUnreadRings({
  unread,
  failed,
}: {
  unread: Record<TaskKind, number>;
  /** 每类「失败且没看过」的条数。缺省视作没有失败。 */
  failed?: Record<TaskKind, number>;
}) {
  const shown = ORDER.filter((k) => unread[k] > 0);
  const failedTotal = failed ? ORDER.reduce((n, k) => n + (failed[k] || 0), 0) : 0;
  if (!shown.length && !failedTotal) return null;

  return (
    <span className="absolute -top-1.5 -right-1.5 flex flex-row-reverse gap-0.5" aria-live="polite">
      {failedTotal > 0 && (
        <span
          title={`失败：${ORDER.filter((k) => failed![k] > 0)
            .map((k) => `${TASK_KIND_META[k].label} ${failed![k]}`)
            .join("、")} —— 点开小P蛙看原因`}
          className="bg-destructive text-white text-[10px] font-bold leading-none min-w-[16px] h-4 px-1 rounded-full flex items-center justify-center shadow ring-2 ring-paper tabular-nums"
        >
          {failedTotal > 99 ? "99+" : failedTotal}
        </span>
      )}
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
