// ─── 全局的小P蛙通知浮标 ──────────────────────────────────────────────────────
//
// 为什么要单独做一个：原来的小P蛙（draft-agent-panel）**只挂在草稿页和条目页**，
// 而用户要的恰恰是「去识别下一株时也能看到上一株的进度」—— 那两页都不在路上。
//
// 与 draft-agent-panel 的分工：
//   · 本组件 = **通知中心**，全站可见，管进度条 / 未读圆圈 / 摘要卡列表；
//   · draft-agent-panel = **对话 agent**，只在有正文可聊的页面出现。
// 两者都会画同一套角标（共用 task-feed-badges），但**同一页只出现一只青蛙** ——
// 有对话面板的页面上，本组件自动让位（见 XiaoPAgentMountedContext）。

import { createContext, useContext, useState } from "react";
import { XiaoPLogo } from "./xiaop-logo";
import { TaskProgressBars, TaskUnreadRings } from "./task-feed-badges";
import { TaskFeedList } from "./task-feed-list";
import { useTaskFeed } from "@/lib/use-task-feed";

/**
 * 页面上有没有挂完整的小P蛙对话面板。
 *
 * 草稿页/条目页把它置 true，本组件就不再画第二只青蛙 —— 否则右下角会并排出现
 * 两个一模一样的图标，用户根本分不清该点哪个。
 */
export const XiaoPAgentMountedContext = createContext(false);

export function TaskFeedLauncher() {
  const agentMounted = useContext(XiaoPAgentMountedContext);
  const { rows, active, unread, unreadTotal, anyRunning } = useTaskFeed();
  const [open, setOpen] = useState(false);

  // 有完整对话面板的页面上让位，避免两只青蛙。
  if (agentMounted) return null;
  // 没有任何任务、也没有未读时整个浮标不出现 —— 通知中心空着还占着右下角就是噪音。
  if (!rows.length) return null;

  return (
    <>
      {!open && (
        <button
          onClick={() => setOpen(true)}
          title={
            anyRunning
              ? "小P蛙 · 有任务正在跑"
              : unreadTotal
                ? `小P蛙 · ${unreadTotal} 条未查看`
                : "小P蛙 · 任务动态"
          }
          className="fixed bottom-24 right-3 md:bottom-8 md:right-6 z-40 w-16 md:w-20 flex flex-col items-center animate-in fade-in slide-in-from-right-2"
        >
          <span className="relative">
            <XiaoPLogo className="w-10 h-10 md:w-16 md:h-16 drop-shadow-lg hover:scale-105 active:scale-95 transition-transform" />
            <TaskUnreadRings unread={unread} />
          </span>
          {/* 进度条在图标**下面** —— 用户明确指定的位置。 */}
          <TaskProgressBars active={active} />
        </button>
      )}

      {open && (
        <div
          className="fixed inset-0 z-[70] flex items-end md:items-center justify-center bg-black/40 p-0 md:p-4"
          onClick={() => setOpen(false)}
        >
          <div
            className="bg-background border border-rule w-full md:max-w-sm md:rounded-2xl rounded-t-2xl shadow-2xl max-h-[75vh] flex flex-col animate-in slide-in-from-bottom-4 md:zoom-in-95"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-2 px-3 py-2.5 border-b border-rule">
              <XiaoPLogo className="w-6 h-6" />
              <div className="min-w-0">
                <p className="text-xs font-semibold text-leaf-deep leading-tight">
                  小P蛙 · 任务动态
                </p>
                <p className="text-[10px] text-ink-faint leading-tight">
                  点任意一条进入它的页面（进过就算已查看）
                </p>
              </div>
              <button
                onClick={() => setOpen(false)}
                className="ml-auto text-ink-faint hover:text-vermilion text-lg leading-none px-1 cursor-pointer"
                aria-label="关闭"
              >
                ×
              </button>
            </div>
            <div className="overflow-y-auto overscroll-contain">
              <TaskFeedList rows={rows} onGo={() => setOpen(false)} />
            </div>
          </div>
        </div>
      )}
    </>
  );
}
