// ─── 全站的小P蛙 ──────────────────────────────────────────────────────────────
//
// 挂在 `__root.tsx` 上，**每一页都出现**（用户 2026-07-29：「小P蛙图标应该出现在
// 所有页面上」）。它同时是三件事：
//   ① 对话入口 —— 针对**当前这一页**的内容问答（正文从 DOM 抓，见 readPageText）；
//   ② 通知中心 —— 图标下面的三色进度条、右上角的三色未读圆圈、点开的摘要卡列表；
//   ③ 模型设置 —— 用户自带模型的入口（这三个视图都由 XiaoPAgentPanel 提供）。
//
// **与页面自带的那两只（drafts/$id、plants/$slug）的分工**：那两页的正文在库里，
// 小P蛙能改写并保存；本组件拿到的只是 DOM 文本，**只问不改**（askPageAgentFn 里
// canEdit 恒为 false）。所以那两页上本组件让位，由页面自带的那只接管 —— 让位靠
// `lib/xiaop-mounted.ts` 的登记处，不是 context（原来那版方向反了，从未生效）。
//
// 🔑 **本组件不再因为「动态流为空」就整个消失**。原来那行 `if (!rows.length) return null`
// 是「识别页没有小P蛙」的直接原因：新用户、或还没跑过任何任务的用户，动态流是空的，
// 于是全站除了草稿页/条目页以外一只青蛙都看不到。通知为空只该让**角标**不画，
// 不该让入口消失。

import { useCallback } from "react";
import { useRouterState } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { XiaoPAgentPanel, type AgentAskResult, type AgentHistory } from "./draft-agent-panel";
import { askPageAgentFn } from "@/lib/identify-plant.functions";
import { userModelArg } from "@/lib/xiaop-user-model";
import { usePageXiaoPMounted, useHydrated } from "@/lib/xiaop-mounted";
import { useAuth } from "@/hooks/use-auth";

/** 送给模型的页面正文上限。够覆盖一屏到几屏内容，又不至于让每轮对话都贵得离谱。 */
const PAGE_TEXT_LIMIT = 8000;

/**
 * 把当前页面的可见文本抓出来喂给小P蛙。
 *
 * 优先 `<main>`：站内页面的正文都在里面，抓 body 会把页眉、页脚、导航连同小P蛙
 * 自己的对话记录一起塞进去 —— 对话记录进 prompt 会让它把自己说过的话当成页面内容。
 */
function readPageText(): string {
  if (typeof document === "undefined") return "";
  const root = document.querySelector("main") ?? document.body;
  if (!root) return "";
  const raw = (root as HTMLElement).innerText ?? "";
  // 连续空行压成一行：站内页面里大量空 div 会撑出几十行空白，白白占 token。
  return raw
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, PAGE_TEXT_LIMIT);
}

export function TaskFeedLauncher() {
  const { user } = useAuth();
  const pageHasOwn = usePageXiaoPMounted();
  const hydrated = useHydrated();
  const askPage = useServerFn(askPageAgentFn);
  // 路径既用来告诉模型「用户在看哪一页」，也用来分隔每页各自的对话记忆。
  const path = useRouterState({ select: (s) => s.location.pathname });

  const ask = useCallback(
    async (question: string, history: AgentHistory): Promise<AgentAskResult> => {
      const res = (await askPage({
        data: {
          path,
          pageTitle: typeof document !== "undefined" ? document.title.slice(0, 300) : undefined,
          pageText: readPageText(),
          question,
          history,
          userModel: userModelArg(),
        },
      })) as AgentAskResult;
      return res;
    },
    [askPage, path],
  );

  // 这条通道落不了地（服务端也把 canEdit 钉死成 false），所以 apply 永远不会被调到。
  // 留一个会抛错的实现而不是空函数：真被调到了要立刻看得见，而不是静默无事发生。
  const apply = useCallback(async () => {
    throw new Error("这一页的内容不能由小P蛙直接改写。可到植物条目页或草稿页找我。");
  }, []);

  // 页面自带完整面板时让位（草稿页 / 条目页）。首帧一并让掉 —— 服务端读不到登记状态，
  // 直接画会在那两页上闪出第二只青蛙。
  if (!hydrated || pageHasOwn) return null;

  return (
    <XiaoPAgentPanel
      // 每页各自的对话记忆：从识别页切到名录再切回来，刚才聊的还在。
      storageKey={`page:${path}`}
      canApply={false}
      isRegistered={!!user}
      // 🔴 全站这只**绝不能**登记 —— 它就是靠登记表决定自己该不该出现的那个组件。
      // 登记 = 自己把自己关掉、然后又出现，React 直接报 Maximum update depth exceeded。
      registerAsPageAgent={false}
      ask={ask}
      apply={apply}
    />
  );
}
