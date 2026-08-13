// ─── 匿名识别的按 IP 日限 ─────────────────────────────────────────────────────
//
// 为什么需要：识别是全站**最贵**的一次操作（Pl@ntNet + 一线视觉模型 + 疑似复核 + 出卡，
// 外加两次存储写入），而它对未登录访客开放 —— 这是刻意的产品选择，不改。
//
// 原有的那道闸（`ANON_MAX_ACTIVE_JOBS = 2`）挡不住刷：它认的是**前端传上来的**
// `anon_id`，而 `lib/anon-id.ts` 的注释自己就写着「清掉浏览器存储就换一个新的……
// 本来就只是防手滑连点，不是防刷的安全边界」。换个 id 的成本是零。
//
// 这里补的是一道**前端伪造不了**的闸：Cloudflare 在边缘写入 `CF-Connecting-IP`，
// 请求里自带的同名头会被它覆盖掉，所以这个值可信。
//
// ⚠️ 已知取舍，别当 bug 修：
// · **共用出口 IP 会互相挤占**（学校、公司、运营商 CGNAT）。所以上限定得比"够用"宽得多，
//   宁可放过一些刷子，也不能让一个班的学生互相顶掉。登录用户完全不受这条限制。
// · **读-改-写不是原子的**：同一 IP 并发打进来可能都读到同一个计数，实际放行会略多于
//   上限。对限流来说无所谓 —— 它要挡的是「一天几千次」，不是「精确到第 60 次」。
//   为此上了原子的 RPC 反而要写迁移（托管 Supabase，得用户手工去控制台跑）。
// · 拿不到 IP（本地 dev、非 Cloudflare 环境）时**放行**。宁可不限，也不能让本地开发和
//   任何非预期部署环境下的识别整个瘫掉。

/** 匿名访客每个 IP 每天最多起多少次识别。放宽是刻意的 —— 见文件头的取舍说明。 */
export const ANON_IDENTIFY_DAILY_LIMIT = 60;

export const KEY_PREFIX = "rl:identify:";

/** UTC 日期，形如 `2026-08-13`。用 UTC 是为了让 Worker 在哪个地区跑都切在同一刻。 */
function today(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * 从 `site_config` 的一批 key 里挑出**该删的往日计数行**。
 *
 * 单独抽出来是因为它是这个模块里**最危险的一段**：挑错一条就会去删 AI key 或后台任务行。
 * 抽成纯函数才能离线逐条钉死（`scratch/check_identify_rate_limit.mjs`）。
 * 判据是白名单式的：必须以本模块的前缀开头，且不是今天的，两条都过才进删除列表。
 */
export function selectStaleCounterKeys(keys: unknown[], day: string): string[] {
  const todayPrefix = `${KEY_PREFIX}${day}:`;
  return keys
    .filter((k): k is string => typeof k === "string")
    .filter((k) => k.startsWith(KEY_PREFIX) && !k.startsWith(todayPrefix));
}

/**
 * IP 不落库 —— 存的是**带当日日期一起哈希**出来的短摘要。导出仅供断言使用。
 *
 * 为什么要哈希：这是访客的网络地址，属于个人信息，没有理由在 `site_config` 里留一张
 * 明文清单。为什么把日期拌进去：IPv4 空间小，光 SHA-256 一个 IP 是能穷举反推的；
 * 每天换一次盐，至少让隔天的记录无法互相关联，且计数键一天一换本来就是需要的。
 */
export async function ipKey(ip: string, day: string): Promise<string> {
  const data = new TextEncoder().encode(`${day}|${ip}`);
  const digest = await crypto.subtle.digest("SHA-256", data);
  const hex = Array.from(new Uint8Array(digest))
    .slice(0, 10)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return `${KEY_PREFIX}${day}:${hex}`;
}

/**
 * 取本次请求的真实客户端 IP。拿不到回 null（调用方一律放行）。
 *
 * 只认 `CF-Connecting-IP`：`X-Forwarded-For` 是客户端能自己塞的，认它等于没限。
 */
export async function clientIp(): Promise<string | null> {
  try {
    const { getRequestHeader } = await import("@tanstack/react-start/server");
    const ip = getRequestHeader("CF-Connecting-IP");
    return ip && ip.trim() ? ip.trim() : null;
  } catch {
    // 不在请求上下文里，或运行时不支持 —— 当作拿不到。
    return null;
  }
}

type Counter = { day: string; count: number };

/**
 * 记一次匿名识别，并回报是否已经超限。
 *
 * 回 `{ allowed: true }` 就放行。**任何异常都放行** —— 限流是防滥用的辅助措施，
 * 不该因为它自己出故障就把正常用户挡在门外。
 */
export async function bumpAnonIdentify(): Promise<{
  allowed: boolean;
  used: number;
  limit: number;
}> {
  const limit = ANON_IDENTIFY_DAILY_LIMIT;
  try {
    const ip = await clientIp();
    // 本地 dev / 非 Cloudflare 环境：没有这个头，不限。
    if (!ip) return { allowed: true, used: 0, limit };

    const day = today();
    const key = await ipKey(ip, day);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = supabaseAdmin as any;

    const { data } = await db.from("site_config").select("value").eq("key", key).maybeSingle();
    const raw = (data as { value?: unknown } | null)?.value;
    const rec = (typeof raw === "string" ? JSON.parse(raw) : raw) as Counter | null;
    const used = rec && rec.day === day && typeof rec.count === "number" ? rec.count : 0;

    if (used >= limit) return { allowed: false, used, limit };

    const next: Counter = { day, count: used + 1 };
    await db.from("site_config").upsert({ key, value: next }, { onConflict: "key" });

    // 当天这个 IP 的第一次 —— 顺手把往日的计数行清掉。每个 IP 每天最多触发一次，
    // 比每次请求都扫一遍便宜得多（同 `pruneExpiredJobs` 挂在建任务上的思路）。
    if (used === 0) void pruneOldCounters(day);

    return { allowed: true, used: used + 1, limit };
  } catch (e) {
    console.warn("[rate-limit] 匿名识别计数失败，放行：", e);
    return { allowed: true, used: 0, limit };
  }
}

/**
 * 删掉不属于今天的计数行。失败只记日志 —— 清不掉最多留几行垃圾，不该影响识别。
 *
 * 🔴 **刻意不写成一条 `.delete().like(...).not(...)`**。要删的是 `site_config` ——
 * 那张表里同时放着 AI key、模型配置、Pl@ntNet 配额状态和全部后台任务行。条件删只要有
 * 一个筛子没生效（列名写错、PostgREST 语法变动、`.not` 被忽略），一条语句就能把整张表
 * 清空，而且**不会报错**。这个仓库在 2026-07-13 已经栽过一次同类的事故（孤儿清理误删
 * 博客封面 / 头像 / 草稿照片，不可恢复）。
 *
 * 所以：先查出来 → 在代码里逐条核对前缀 → 按**精确 key 列表**删。这样即便查询条件失效，
 * 白名单式的前缀核对也不会放任何一条不该删的行进入删除列表。
 */
async function pruneOldCounters(day: string): Promise<void> {
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = supabaseAdmin as any;
    const { data, error } = await db
      .from("site_config")
      .select("key")
      .like("key", `${KEY_PREFIX}%`);
    if (error || !data) return;

    const doomed = selectStaleCounterKeys(
      (data as { key?: unknown }[]).map((r) => r.key),
      day,
    );
    if (doomed.length === 0) return;

    await db.from("site_config").delete().in("key", doomed);
  } catch (e) {
    console.warn("[rate-limit] 清理往日计数行失败：", e);
  }
}
