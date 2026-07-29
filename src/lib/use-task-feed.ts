// ─── 动态流的前端钩子 ─────────────────────────────────────────────────────────
//
// 小P蛙浮标要长期显示「三条进度 + 三个未读圆圈」，数据来源就是这里。
//
// 轮询策略：**有任务在跑时 5 秒一次，全都跑完就退到 60 秒**。
// 长任务动辄十几分钟，一直 5 秒打一次是白烧请求；但一旦有东西在跑，进度条不跟手
// 又会让人以为卡死了。所以按「当前有没有 running」自动切换。

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { fetchTaskFeedFn } from "./task-feed.functions";
import { useAuth } from "@/hooks/use-auth";
import {
  activeByKind,
  unreadCounts,
  totalUnread,
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
  /** 有没有任何任务在跑 —— 决定浮标要不要显示进度条。 */
  anyRunning: boolean;
  refresh: () => void;
};

const EMPTY: Record<TaskKind, number> = { identify: 0, enrich_draft: 0, gold_page: 0 };

export function useTaskFeed(): TaskFeedState {
  const { user } = useAuth();
  const fetchFeed = useServerFn(fetchTaskFeedFn);
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
  return {
    rows,
    active: user?.id ? activeByKind(rows) : {},
    unread: user?.id ? unreadCounts(rows) : EMPTY,
    unreadTotal: user?.id ? totalUnread(rows) : 0,
    anyRunning: rows.some((r) => r.status === "running"),
    refresh: () => qc.invalidateQueries({ queryKey: ["task-feed"] }),
  };
}
