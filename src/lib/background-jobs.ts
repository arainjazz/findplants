// ─── 后台任务store（无需数据库迁移）──────────────────────────────────────────
// 「进一步生成草稿」和「金叶详页」都要跑联网调研 + 长文生成，总耗时超过 Cloudflare
// 边缘 100 秒响应上限 → 连接被掐断 → 前端 `failed to fetch`。配了推理模型（Kimi K3
// 这类）之后必现，且重试无用：每次都同样慢。
//
// 解法：server fn 立刻返回一个任务 ID，真正的活交给 `keepAlive()`（= ctx.waitUntil）
// 在响应之后继续跑，进度写进这张表，前端每几秒轮询一次。这样用户离开页面、刷新、甚至
// 关掉标签页，任务照跑不误 —— 正是金叶那句「请勿关闭或刷新标签页」要解决的痛点。
//
// **存储：复用已有的 `site_config`（key text 主键 + value jsonb）**，key 形如
// `job:<uuid>`。这是刻意的选择：这是托管 Supabase，本地没有 CLI，任何新表都得让用户
// 去控制台手动执行迁移。site_config 已经在被 plantnet_quota_state / 四套模型配置这样
// 用（读写都走 service-role，绕过 RLS），所以这套方案**零迁移即可上线**。
// 代价是任务行会堆积 —— 用 `pruneExpiredJobs()` 在建任务时顺手清掉过期行。

export type JobStatus = "running" | "done" | "error";

export type JobRecord = {
  id: string;
  /** 哪种任务，决定前端怎么呈现结果。 */
  kind: "enrich_draft" | "gold_page";
  status: JobStatus;
  /** 给用户看的阶段文案，例如「正在联网调研…」。 */
  phase: string;
  /** 0–100，粗略进度；纯展示用，不参与任何判定。 */
  progress: number;
  /** 发起人 —— 轮询时校验，别人的任务读不到。 */
  userId: string;
  draftId: string;
  /** status === "done" 时的返回值（原来 server fn 直接 return 的那个对象）。 */
  result?: unknown;
  /** status === "error" 时的用户可读错误信息。 */
  error?: string;
  /**
   * 任务的真实入参，由队列消费者取出来重放。
   *
   * **为什么放这里而不是队列消息里**：它含 email、以及金叶那条链路的「用户自带模型配置」
   * （里面有 API Key）。队列消息会在 Cloudflare 侧留存最多 24 小时；site_config 本来就是
   * 存各类 key 的地方（service-role 才读得到），放这儿不额外扩大暴露面。
   * 顺带好处：队列消息永远只有一个 jobId，不可能撞上 128KB 上限。
   */
  payload?: unknown;
  createdAt: string;
  updatedAt: string;
};

/** 过期阈值：超过这个时间的任务行会在下次建任务时被清掉。 */
export const JOB_TTL_MS = 6 * 60 * 60 * 1000; // 6h

/**
 * 心跳间隔。后台任务活着的唯一证据就是它在按时推 `updatedAt`。
 *
 * **为什么必须有独立心跳：** 阶段文案切得很稀 —— enrich 全程只有 4 次 onPhase，
 * 其中「撰稿」到「保存」之间是一整个 `await buildDraftContent()`。换上推理模型
 * （Kimi K3 这类）后这一步跑五分钟以上是常态，期间 `updatedAt` 一动不动，
 * isJobStale 就把**还在正常干活**的任务判成死了，前端弹「生成似乎已中断」。
 * 把「存活」和「阶段推进」拆开，这个误判才根除。
 */
export const JOB_HEARTBEAT_MS = 15 * 1000;

/**
 * 前端认定「任务卡死」的阈值。有了心跳，这里可以卡得比过去紧得多：
 * 连丢 8 次心跳才判死，既不会误杀慢模型，真被 isolate 回收时也能两分钟内报出来
 * （旧值是 5 分钟，且因为没有心跳而必然误杀）。
 */
export const JOB_STALE_MS = 2 * 60 * 1000; // 2min ≈ 8 次心跳

const KEY_PREFIX = "job:";

const jobKey = (id: string) => `${KEY_PREFIX}${id}`;

// `site_config` 是管理员维护的 key/value 表，不在 Supabase 生成的 types.ts 里，
// 所以查询构建器拿不到类型 —— 与本仓库其它 site_config 读写处的做法一致。
async function admin() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return supabaseAdmin as any;
}

function newId(): string {
  // crypto.randomUUID 在 Workers 与 Node 18+ 都有；兜底只是为了不在奇怪环境里炸。
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (c?.randomUUID) return c.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/** 建一个任务行，返回任务 ID。写失败会抛 —— 拿不到 ID 的话前端根本无从轮询。 */
export async function createJob(input: {
  kind: JobRecord["kind"];
  userId: string;
  draftId: string;
  phase: string;
  payload?: unknown;
}): Promise<JobRecord> {
  const now = new Date().toISOString();
  const rec: JobRecord = {
    id: newId(),
    kind: input.kind,
    status: "running",
    phase: input.phase,
    progress: 1,
    userId: input.userId,
    draftId: input.draftId,
    payload: input.payload,
    createdAt: now,
    updatedAt: now,
  };
  const db = await admin();
  const { error } = await db
    .from("site_config")
    .upsert({ key: jobKey(rec.id), value: rec }, { onConflict: "key" });
  if (error) throw new Error(`无法创建后台任务：${error.message}`);
  return rec;
}

/** 读任务。找不到 / 不是本人的 → null（不区分，免得暴露别人任务的存在）。 */
export async function readJob(id: string, userId?: string): Promise<JobRecord | null> {
  const db = await admin();
  const { data, error } = await db
    .from("site_config")
    .select("value")
    .eq("key", jobKey(id))
    .maybeSingle();
  if (error || !data) return null;
  const raw = (data as { value?: unknown }).value;
  const rec = (typeof raw === "string" ? JSON.parse(raw) : raw) as JobRecord | null;
  if (!rec || typeof rec !== "object" || !rec.id) return null;
  if (userId && rec.userId !== userId) return null;
  return rec;
}

/**
 * 把一批更新**绑定到「内存里的这一份 JobRecord」**，每次只做**一次** blind upsert
 * —— 不再「先 readJob 后 upsert」。
 *
 * **为什么这是关键（而不是省事）**：Cloudflare 免费版**单次调用最多 50 个子请求（对外
 * fetch）**。旧写法里每次心跳 / 每次阶段更新都要 read + write = 2 个子请求，enrich 一趟光
 * 「~5 次心跳 + 4 次阶段 + 收尾」就吃掉约 20 个，把预算耗到写库那步都没配额（实测 2026-07-21：
 * 正文生成完，最后 `plant_drafts` 写回报 `Too many subrequests`，连 failJob 也写不进去 →
 * 前端只能退回「连续两分钟没心跳」）。改成 blind upsert 后，每次更新省掉那次 read，整趟腰斩。
 *
 * **为什么内存副本就是权威值、可以不 read**：一个任务只在**一个**队列消费者调用里跑，
 * runQueuedJob 是这份记录的唯一属主，没有别的写者（前端只 pollJobFn 读、不写）。
 * `terminal` 一旦置位，晚到的心跳/阶段就不再写，避免把 done/error 覆盖回 running。
 */
export function bindJobUpdates(initial: JobRecord) {
  let rec: JobRecord = { ...initial };
  let terminal = false;

  const flush = async (): Promise<void> => {
    try {
      const db = await admin();
      const { error } = await db
        .from("site_config")
        .upsert({ key: jobKey(rec.id), value: rec }, { onConflict: "key" });
      if (error) console.warn(`[jobs] write failed for ${rec.id}:`, error.message);
    } catch (e) {
      // 网络抖动不该让整趟生成翻车 —— 写不进去只是这一次进度/心跳丢了。
      console.warn(`[jobs] write threw for ${rec.id}:`, e);
    }
  };

  /** 推进阶段文案 + 进度。耗时步骤前调一次。终态后静默忽略。 */
  const phase = (phaseText: string, progress: number): Promise<void> => {
    if (terminal) return Promise.resolve();
    rec = {
      ...rec,
      phase: phaseText,
      progress: Math.max(0, Math.min(99, Math.round(progress))),
      updatedAt: new Date().toISOString(),
    };
    return flush();
  };

  /** 心跳一次 —— 只推 updatedAt。终态后静默忽略。 */
  const heartbeat = (): Promise<void> => {
    if (terminal) return Promise.resolve();
    rec = { ...rec, updatedAt: new Date().toISOString() };
    return flush();
  };

  const finish = (result: unknown): Promise<void> => {
    terminal = true;
    rec = { ...rec, status: "done", phase: "已完成", progress: 100, result, updatedAt: new Date().toISOString() };
    return flush();
  };

  const fail = (message: string): Promise<void> => {
    terminal = true;
    rec = { ...rec, status: "error", phase: "已失败", error: message, updatedAt: new Date().toISOString() };
    return flush();
  };

  /**
   * 开始打心跳，返回 `stop()`。**务必在 finally 里调 stop()** —— 没停的定时器会一直把
   * isolate 钉在内存里。自重排 setTimeout（非 setInterval）：写库慢时不会叠加并发写。
   */
  const startHeartbeat = (intervalMs = JOB_HEARTBEAT_MS): (() => void) => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const beat = () => {
      if (stopped || terminal) return;
      timer = setTimeout(() => {
        if (stopped || terminal) return;
        void heartbeat().then(beat);
      }, intervalMs);
    };
    beat();
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
    };
  };

  return { phase, heartbeat, finish, fail, startHeartbeat };
}

/**
 * 清掉过期任务行。site_config 是站点配置表，不该被任务行喂胖 —— 每次建任务时顺手扫一次。
 * 失败无所谓（只是没清干净），所以整段吞异常。
 */
export async function pruneExpiredJobs(): Promise<number> {
  try {
    const cutoff = new Date(Date.now() - JOB_TTL_MS).toISOString();
    const db = await admin();
    const { data } = await db
      .from("site_config")
      .select("key, value")
      .like("key", `${KEY_PREFIX}%`);
    const stale = (data ?? [])
      .filter((row: { key: string; value: unknown }) => {
        const raw = row.value;
        const rec = (typeof raw === "string" ? JSON.parse(raw) : raw) as JobRecord | null;
        // 解析不出来的行也算垃圾，一并清掉。
        return !rec?.createdAt || rec.createdAt < cutoff;
      })
      .map((row: { key: string }) => row.key);
    if (!stale.length) return 0;
    await db.from("site_config").delete().in("key", stale);
    return stale.length;
  } catch (e) {
    console.warn("[jobs] prune failed:", e);
    return 0;
  }
}

/** 任务是否「疑似卡死」：还在 running，但很久没更新过阶段了。 */
export function isJobStale(rec: JobRecord, now = Date.now()): boolean {
  if (rec.status !== "running") return false;
  const t = Date.parse(rec.updatedAt);
  if (!Number.isFinite(t)) return false;
  return now - t > JOB_STALE_MS;
}
