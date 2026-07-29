// ─── 任务动态流的服务端读写 ───────────────────────────────────────────────────
//
// 纯逻辑（未读计数、进度条选谁、三色语义）在 task-feed.ts，那边能脱离网络直接测。
// 这里只管跟数据库打交道：写入一律走 service-role，读取按登录身份。
//
// **写入为什么必须走 service-role**：`task_feed` 上有一条 policy 允许本人 update 自己的行
// （为了「标已读」），但 Postgres 的 RLS 表达不了「只能改 read_at 这一列」。
// 迁移里因此加了 `task_feed_guard_update_trg` 触发器，把普通用户的其余列改动**静默还原**。
// service-role 绕过 RLS，也被触发器显式放行 —— 所以进度/状态只可能由服务端写进去，
// 前端伪造不了「任务已完成」。
//
// **写入全部吞异常**：动态流是给用户看的锦上添花，它写不进去绝不能让整趟生成翻车。
// 任务能不能跑完的权威始终是 site_config 里的 job 行，不是这张表。

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { readFeedRow, FEED_LIMIT, type TaskFeedRow, type TaskKind } from "./task-feed";

async function admin() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  // task_feed 是 2026-07-29 手工迁移建的表；查询构建器的类型来自 types.ts 的手写补丁，
  // 与本仓库其它手工建表处（site_config 等）的做法一致。
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return supabaseAdmin as any;
}

/**
 * 建/更新一条动态。**同一个人 + 同一类 + 同一份草稿只留一条** ——
 * 重跑银叶不该在流里堆两条，而是把原来那条更新掉。
 *
 * 重跑时 `read_at` 被显式清回 null：内容变了，就该重新算作「未看过」。
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * 🔴 **为什么整个函数都不能用 `.upsert({ onConflict })`**（2026-07-29 实测确诊）
 *
 * 迁移里的唯一索引是**部分索引**：
 *     create unique index … on task_feed (user_id, kind, draft_id)
 *       where draft_id is not null;
 * 而 Postgres 的 `ON CONFLICT (cols)` **匹配不上部分索引**，除非语句里带上同样的
 * 谓词；PostgREST 的 `on_conflict` 参数只会发列名、不发谓词。结果是每一次
 * draft_id 路的写入都原地报
 *     42P10 there is no unique or exclusion constraint matching the ON CONFLICT specification
 * 而本函数把异常全吞了（写动态流不该拖垮生成）→ **这个失败完全无声**。
 *
 * 后果正是用户连报三轮的那些症状：银叶/金叶的动态**一条都没写进去过**（所以蓝条、
 * 橙条永远不出现）；识别的动态只有我上一轮加的 job_id 分支写得进去，而收尾的
 * `feedFinish` 又走 draft_id 路 → **识别永远停在 running**：绿条不消失、不转未读、
 * 点开也没有摘要卡。探针脚本 `scratch/probe_task_feed_upsert.mjs` 复现了这一切：
 * 全表只有 4 行、清一色 `identify/running`，upsert 报 42P10，普通 insert 正常。
 *
 * 所以两条路**都**改成「先更新，没更到再插入」。不加迁移就能立刻生效，
 * 而 onPhase 一趟只有 4 次，多一次往返完全付得起。
 * ⚠️ 别再改回 upsert —— 除非先把那个索引换成非部分索引（那需要一次迁移）。
 * ─────────────────────────────────────────────────────────────────────────────
 */
export async function upsertTaskFeed(input: {
  userId: string | null | undefined;
  kind: TaskKind;
  draftId: string | null;
  jobId?: string | null;
  status?: "running" | "done" | "error";
  phase?: string;
  progress?: number;
  title?: string | null;
  thumbUrl?: string | null;
  summary?: string | null;
  error?: string | null;
  /** true = 这次更新要把它重新标成未读（重跑、或刚刚完成）。 */
  markUnread?: boolean;
}): Promise<void> {
  // 匿名识别不进动态流（表上 user_id not null）—— 用户 2026-07-29：重点照顾注册用户与编辑。
  if (!input.userId) return;
  // 草稿和任务两个身份**一个都没有**才是真写不了：认不出该更新哪一行，写进去就是垃圾行。
  if (!input.draftId && !input.jobId) return;
  try {
    const db = await admin();
    const row: Record<string, unknown> = {
      user_id: input.userId,
      kind: input.kind,
      draft_id: input.draftId,
      updated_at: new Date().toISOString(),
    };
    if (input.jobId !== undefined) row.job_id = input.jobId;
    if (input.status !== undefined) row.status = input.status;
    if (input.phase !== undefined) row.phase = input.phase;
    if (input.progress !== undefined)
      row.progress = Math.max(0, Math.min(100, Math.round(input.progress)));
    if (input.title !== undefined) row.title = input.title;
    if (input.thumbUrl !== undefined) row.thumb_url = input.thumbUrl;
    if (input.summary !== undefined) row.summary = input.summary;
    if (input.error !== undefined) row.error = input.error;
    if (input.markUnread) row.read_at = null;

    // 认这一行的身份：有草稿就按草稿认，没有（新建识别，草稿跑完才诞生）就按任务认。
    const matchRow = () => {
      const q = db.from("task_feed").eq("user_id", input.userId).eq("kind", input.kind);
      return input.draftId
        ? q.eq("draft_id", input.draftId)
        : q.eq("job_id", input.jobId).is("draft_id", null);
    };

    // ① 先更新。`.select("id")` 是关键 —— 没有它就分不清「更新成功」和「没有匹配行」。
    const { data: updated, error: upErr } = await matchRow().update(row).select("id");
    if (upErr) {
      console.error("[TaskFeed] 更新失败:", upErr.message);
      return;
    }
    if (updated?.length) return;

    // ② 一行都没更到 = 这条动态还不存在，插一条。
    const { error: insErr } = await db.from("task_feed").insert(row);
    if (!insErr) return;

    // ③ 插入被拒，几乎只剩一种可能：另一个并发写抢先插了同一条，撞上那个部分唯一索引。
    //    那就说明行已经在了 —— 回到 ① 再更新一次，别把这次的进度丢掉。
    console.warn("[TaskFeed] 插入被拒，改为重试更新:", insErr.message);
    const { error: retryErr } = await matchRow().update(row);
    if (retryErr) console.error("[TaskFeed] 重试更新仍失败:", retryErr.message);
  } catch (e) {
    // 动态流写不进去只是少一条通知，绝不能让整趟生成翻车。
    // 但**必须吼出来**：正是「静悄悄地失败」让 42P10 藏过了三轮用户反馈。
    console.error("[TaskFeed] 写入抛异常:", e instanceof Error ? e.message : e);
  }
}

/**
 * 把「按 jobId 建的占位动态」认领给刚刚诞生的草稿。
 *
 * **不认领会留下一条永远 running 的孤儿**：新建识别跑完后 `feedFinish` 按 draft_id 写，
 * 那是另一条记录；占位那条没人再更新，20 分钟后被 `isFeedStale` 判成失联，
 * 用户在动态流里看到一条永远转圈的幽灵。
 *
 * 认领失败的唯一情形是「这份草稿已经有同类动态了」（补拍重识别）——
 * 部分唯一索引会挡下来。那时占位那条已无价值，直接删掉。
 */
export async function adoptFeedDraft(
  userId: string,
  kind: TaskKind,
  jobId: string,
  draftId: string,
): Promise<void> {
  if (!userId || !jobId || !draftId) return;
  try {
    const db = await admin();
    const { error } = await db
      .from("task_feed")
      .update({ draft_id: draftId })
      .eq("user_id", userId)
      .eq("kind", kind)
      .eq("job_id", jobId)
      .is("draft_id", null);
    if (!error) return;
    console.warn("[TaskFeed] adopt failed, dropping placeholder:", error.message);
    await db
      .from("task_feed")
      .delete()
      .eq("user_id", userId)
      .eq("kind", kind)
      .eq("job_id", jobId)
      .is("draft_id", null);
  } catch (e) {
    console.warn("[TaskFeed] adopt threw:", e instanceof Error ? e.message : e);
  }
}

/** 拉本人的动态流。前端每几秒问一次，用来画进度条和未读圆圈。 */
export const fetchTaskFeedFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<{ rows: TaskFeedRow[] }> => {
    const { userId } = context as { userId: string };
    try {
      const db = await admin();
      const { data, error } = await db
        .from("task_feed")
        .select("*")
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .limit(FEED_LIMIT);
      if (error) {
        console.warn("[TaskFeed] fetch failed:", error.message);
        return { rows: [] };
      }
      return { rows: (data ?? []).map(readFeedRow).filter(Boolean) as TaskFeedRow[] };
    } catch (e) {
      // 拉不到就当没有 —— 小P蛙上少个角标，不该把页面搞崩。
      console.warn("[TaskFeed] fetch threw:", e instanceof Error ? e.message : e);
      return { rows: [] };
    }
  });

/**
 * 把某份草稿的动态标为已读。
 *
 * 已读判据是用户 2026-07-29 拍板的：**进过那份草稿的详情页就算已读**，
 * 而不是「在小P蛙里点了那张卡片」。所以调用点在 /drafts/$id 的挂载处，
 * 不在小P蛙的列表里。
 *
 * 一份草稿可能同时有银叶和金叶两条动态（kind 不同），这里**一并标掉** ——
 * 用户看的是那一页，不是某一类任务。
 */
export const markDraftReadFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ draftId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }): Promise<{ marked: number }> => {
    const { userId } = context as { userId: string };
    try {
      const db = await admin();
      const { data: rows, error } = await db
        .from("task_feed")
        .update({ read_at: new Date().toISOString() })
        .eq("user_id", userId)
        .eq("draft_id", data.draftId)
        .is("read_at", null)
        .select("id");
      if (error) {
        console.warn("[TaskFeed] markRead failed:", error.message);
        return { marked: 0 };
      }
      return { marked: (rows ?? []).length };
    } catch (e) {
      console.warn("[TaskFeed] markRead threw:", e instanceof Error ? e.message : e);
      return { marked: 0 };
    }
  });

/**
 * 把**失败**的动态标为已读。用户在小P蛙里打开「任务动态」列表时调用。
 *
 * 为什么失败必须走单独一条路：正常完成的那条判据是「进过那份草稿的详情页」，
 * 可失败的任务**往往根本没有草稿页可进**（识别炸了就没建成草稿），
 * 于是右上角那个红圈会永远挂着、没有任何办法消掉。错误信息只在列表里，
 * 所以「列表被打开」就是这类动态唯一合理的已读时机。
 *
 * 只动 error 行 —— 顺手把未读的完成项也清了，就等于把用户还没看的结果偷偷标掉了。
 */
export const markFailedReadFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<{ marked: number }> => {
    const { userId } = context as { userId: string };
    try {
      const db = await admin();
      const { data: rows, error } = await db
        .from("task_feed")
        .update({ read_at: new Date().toISOString() })
        .eq("user_id", userId)
        .eq("status", "error")
        .is("read_at", null)
        .select("id");
      if (error) {
        console.warn("[TaskFeed] markFailedRead failed:", error.message);
        return { marked: 0 };
      }
      return { marked: (rows ?? []).length };
    } catch (e) {
      console.warn("[TaskFeed] markFailedRead threw:", e instanceof Error ? e.message : e);
      return { marked: 0 };
    }
  });
