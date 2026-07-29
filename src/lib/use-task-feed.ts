// ─── 动态流的前端钩子 ─────────────────────────────────────────────────────────
//
// 小P蛙浮标要长期显示「三条进度 + 三个未读圆圈」，数据来源就是这里。
//
// 轮询策略：**有任务在跑时 5 秒一次，全都跑完就退到 60 秒**。
// 长任务动辄十几分钟，一直 5 秒打一次是白烧请求；但一旦有东西在跑，进度条不跟手
// 又会让人以为卡死了。所以按「当前有没有 running」自动切换。

import { useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { fetchTaskFeedFn, markFailedReadFn } from "./task-feed.functions";
import { useAuth } from "@/hooks/use-auth";
import {
  activeByKind,
  unreadCounts,
  totalUnread,
  failedCounts,
  totalFailed,
  type TaskFeedRow,
  type TaskKind,
} from "./task-feed";

/** 有任务在跑时的轮询间隔。 */
const POLL_ACTIVE_MS = 5000;
/** 全部跑完后的轮询间隔 —— 只为发现「别的设备上新起了一个任务」。 */
const POLL_IDLE_MS = 60_000;

export type TaskFeedState = {
  rows: TaskFeedRow[];
  /** 每类当前在跑的那一条（画进度条用）。 */
  active: Partial<Record<TaskKind, TaskFeedRow>>;
  /** 每类「已完成但没看过」的条数（画圆圈用）。 */
  unread: Record<TaskKind, number>;
  unreadTotal: number;
  /** 每类「失败且没看过」的条数（画右上角那个红圈用）。 */
  failed: Record<TaskKind, number>;
  failedTotal: number;
  /**
   * 需要用户看一眼的总条数 = 未读完成 + 未看过的失败。
   * 点开小P蛙时用它决定「直接落在动态流」还是「回到对话」—— 失败也必须能把人带过去。
   */
  attentionTotal: number;
  /** 有没有任何任务在跑 —— 决定浮标要不要显示进度条。 */
  anyRunning: boolean;
  refresh: () => void;
  /**
   * 把失败的动态标为已读。小P蛙**打开「任务动态」列表时**调用 ——
   * 失败的任务常常没有草稿页可进，不给这条路那个红圈就永远消不掉（见 markFailedReadFn）。
   */
  markFailedRead: () => void;
};

const EMPTY: Record<TaskKind, number> = { identify: 0, enrich_draft: 0, gold_page: 0 };

export function useTaskFeed(): TaskFeedState {
  const { user } = useAuth();
  const fetchFeed = useServerFn(fetchTaskFeedFn);
  const markFailed = useServerFn(markFailedReadFn);
  const qc = useQueryClient();

  const { data } = useQuery({
    queryKey: ["task-feed", user?.id ?? "anon"],
    // 匿名用户没有动态流（表上 user_id not null）—— 不发这个请求。
    enabled: !!user?.id,
    queryFn: async () => (await fetchFeed({ data: undefined })).rows,
    // 轮询间隔跟着「有没有在跑」走，见文件头。
    refetchInterval: (q) => {
      const rows = (q.state.data ?? []) as TaskFeedRow[];
      return rows.some((r) => r.status === "running") ? POLL_ACTIVE_MS : POLL_IDLE_MS;
    },
    // 切回标签页时立刻对一次 —— 用户离开期间任务多半已经跑完了。
    refetchOnWindowFocus: true,
    staleTime: 0,
  });

  const rows = data ?? [];
  const signedIn = !!user?.id;
  const unreadTotal = signedIn ? totalUnread(rows) : 0;
  const failedTotal = signedIn ? totalFailed(rows) : 0;

  // ⚠️ 必须是稳定引用：调用点是个 useEffect，每次渲染换一个新函数就会打成请求风暴
  // （标记 → 刷新之间 failedTotal 还是 >0，早退那道闸拦不住）。
  // 依赖里只有 failedTotal 会变，所以「有失败 → 标一次 → 归零 → 不再标」正好一趟。
  const markFailedRead = useCallback(() => {
    if (!signedIn || !failedTotal) return;
    void markFailed({ data: undefined })
      .then(() => qc.invalidateQueries({ queryKey: ["task-feed"] }))
      // 标不上只是红圈多留一会儿，不值得打断用户。
      .catch(() => {});
  }, [signedIn, failedTotal, markFailed, qc]);

  return {
    rows,
    active: signedIn ? activeByKind(rows) : {},
    unread: signedIn ? unreadCounts(rows) : EMPTY,
    unreadTotal,
    failed: signedIn ? failedCounts(rows) : EMPTY,
    failedTotal,
    attentionTotal: unreadTotal + failedTotal,
    anyRunning: rows.some((r) => r.status === "running"),
    refresh: () => qc.invalidateQueries({ queryKey: ["task-feed"] }),
    markFailedRead,
  };
}
