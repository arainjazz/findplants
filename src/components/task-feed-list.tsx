// ─── 任务动态的摘要卡列表 ─────────────────────────────────────────────────────
//
// 两处共用：全局通知浮标（task-feed-launcher）和草稿页/条目页那只小P蛙的对话框
// （draft-agent-panel）。抽出来是因为**同一份东西在两个地方长得不一样是 bug 不是特性** ——
// 用户在哪只青蛙里看到的卡片都该一模一样。
//
// 点卡片 → 进那份草稿的详情页。已读**不在这里标**：判据是「进过详情页」，
// 由 drafts.$id 挂载时自己去标（见 task-feed.functions 的 markDraftReadFn）。
// 这样从草稿列表、从分享链接进去也一样算数。

import { useEffect, useState } from "react";
import { Link, useRouterState } from "@tanstack/react-router";
import { TASK_KIND_META, type TaskFeedRow } from "@/lib/task-feed";

/** 相对时间，够用即可（不为这一处引第三方库）。 */
export function ago(iso: string): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "";
  const s = Math.max(0, Math.round((Date.now() - t) / 1000));
  if (s < 60) return "刚刚";
  if (s < 3600) return `${Math.floor(s / 60)} 分钟前`;
  if (s < 86400) return `${Math.floor(s / 3600)} 小时前`;
  return `${Math.floor(s / 86400)} 天前`;
}

function CardBody({ row, opening }: { row: TaskFeedRow; opening?: boolean }) {
  const meta = TASK_KIND_META[row.kind];
  const unread = row.status === "done" && !row.readAt;
  return (
    <>
      {row.thumbUrl ? (
        <img
          src={row.thumbUrl}
          alt=""
          loading="lazy"
          className="w-12 h-12 rounded-lg object-cover border border-rule/50 shrink-0"
        />
      ) : (
        <div className="w-12 h-12 rounded-lg bg-ink/5 border border-rule/50 shrink-0" />
      )}
      <div className="min-w-0 flex-1 text-left">
        <div className="flex items-center gap-1.5">
          <span className={`text-[10px] font-semibold ${meta.text}`}>{meta.label}</span>
          {unread && (
            <span className={`w-1.5 h-1.5 rounded-full ${meta.ring}`} aria-label="未查看" />
          )}
          {/* 点开那一下的回执：手机上网络慢，这张卡是用户唯一看得见的「我收到了」。 */}
          <span className="text-[10px] text-ink-faint ml-auto shrink-0">
            {opening ? <span className="text-leaf-deep font-semibold">正在打开…</span> : ago(row.updatedAt)}
          </span>
        </div>
        <p className="text-xs font-semibold text-ink truncate">{row.title || "（未命名）"}</p>
        {row.status === "running" ? (
          <>
            <p className="text-[10px] text-ink-soft truncate">{row.phase || "进行中…"}</p>
            <div className="h-1 w-full rounded-full bg-ink/10 overflow-hidden mt-1">
              <div
                className={`h-full rounded-full ${meta.bar} transition-[width] duration-700`}
                style={{ width: `${Math.max(6, row.progress)}%` }}
              />
            </div>
          </>
        ) : row.status === "error" ? (
          <p className="text-[10px] text-destructive line-clamp-2">{row.error || "生成失败"}</p>
        ) : (
          <p className="text-[10px] text-ink-soft line-clamp-2">{row.summary || "已完成"}</p>
        )}
      </div>
    </>
  );
}

export function TaskFeedList({ rows, onGo }: { rows: TaskFeedRow[]; onGo?: () => void }) {
  // 正在打开的那一份（draftId）。
  const [opening, setOpening] = useState<string | null>(null);
  // ⚠️ 判据**不能只看 pathname 变了没有**：实测 URL 会在页面渲染之前就切过去
  // （loader 挂死那次，985ms 时 URL 已是 /drafts/…，8 秒后屏幕还停在原页面）。
  // 取「status 回到 idle 那一刻的 pathname」才是真落地。
  const settled = useRouterState({
    select: (s) => (s.status === "idle" ? s.location.pathname : null),
  });

  // 🔑 抽屉**等路由落地才收**（原来是 onClick 里立刻收）。手机上先收抽屉、页面又还没换，
  // 用户看到的就是「浮层没了、页面没动」—— 跟没跳一模一样，连重试的入口都一起没了。
  useEffect(() => {
    if (!opening) return;
    if (settled === `/drafts/${opening}`) {
      setOpening(null);
      onGo?.();
    }
  }, [settled, opening, onGo]);

  // 兜底：万一那一跳彻底没落地（chunk 取不到 / 请求卡死），卡片不能一直挂着「正在打开…」。
  useEffect(() => {
    if (!opening) return;
    const t = setTimeout(() => setOpening(null), 10_000);
    return () => clearTimeout(t);
  }, [opening]);

  if (!rows.length) {
    return (
      <div className="px-4 py-8 text-center text-[11px] text-ink-faint leading-relaxed">
        还没有任务动态。
        <br />
        识别植物、生成银叶草稿或金叶详页后，进度会出现在这里。
      </div>
    );
  }
  return (
    <>
      {rows.map((row) =>
        // 没有 draftId（理论上不该出现）时不做成链接，免得点了跳到坏地址。
        row.draftId ? (
          <Link
            key={row.id}
            to="/drafts/$id"
            params={{ id: row.draftId }}
            onClick={() => setOpening(row.draftId)}
            className={`flex gap-2.5 px-3 py-2.5 border-b border-rule/40 transition-colors ${
              opening === row.draftId ? "bg-leaf/10" : "hover:bg-leaf/5"
            }`}
          >
            <CardBody row={row} opening={opening === row.draftId} />
          </Link>
        ) : (
          <div key={row.id} className="flex gap-2.5 px-3 py-2.5 border-b border-rule/40">
            <CardBody row={row} />
          </div>
        ),
      )}
    </>
  );
}
