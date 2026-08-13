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
// 🔧 **上限可以在后台改，不用重新部署**：往 `site_config` 写一行
// `anon_identify_daily_limit`（值直接写数字即可），下一次请求就生效；删掉这行就回到
// 代码里的默认值。同 `ai_model_config` 的路子。写 `0` = 彻底关掉匿名识别（急停开关）。
//
// ⚠️ 已知取舍，别当 bug 修：
// · **共用出口 IP 会互相挤占**（学校、公司、运营商 CGNAT）。一个班的人是**一起分**这个
//   额度的，所以上限定得比"够用"宽得多：宁可放过一些刷子，也不能让他们互相顶掉。
//   被挡下的人**登录即可继续**，登录用户完全不走这条路。
// · **读-改-写不是原子的**：同一 IP 并发打进来可能都读到同一个计数，实际放行会略多于
//   上限。对限流来说无所谓 —— 它要挡的是「一天几千次」，不是「精确到第 60 次」。
//   为此上了原子的 RPC 反而要写迁移（托管 Supabase，得用户手工去控制台跑）。
// · 拿不到 IP（本地 dev、非 Cloudflare 环境）时**放行**。宁可不限，也不能让本地开发和
//   任何非预期部署环境下的识别整个瘫掉。

/**
 * 匿名访客每个 IP 每天最多起多少次识别 —— **默认值**，真正生效的值优先读库
 * （`site_config.anon_identify_daily_limit`，见 `readLimit`）。
 *
 * 放宽到 60 是刻意的：共用出口 IP 的用户是**一起分**这个额度的，一个班同时用就撞上了。
 * 纯按成本算 10 次都够，但宁可放过一些刷子，也不能让一个机房的人互相顶掉。
 */
export const ANON_IDENTIFY_DAILY_LIMIT = 60;

export const KEY_PREFIX = "rl:identify:";

/**
 * 上限的库内覆盖键。放在 `site_config` 里是为了**改完立刻生效、不用重新部署** ——
 * 同 `ai_model_config` 的路子。真撞上共用网络的投诉时，改代码 + build + deploy 要几分钟，
 * 而这里在后台改一个数就行。
 */
export const LIMIT_KEY = "anon_identify_daily_limit";

/**
 * 解析库里那个覆盖值。看不懂就回 null（调用方用代码里的默认值）。
 *
 * 容忍几种写法，因为这一列是 jsonb、而人是手工在控制台填的：
 * 直接写数字 `150`、写成字符串 `"150"`、或包一层 `{"limit":150}` / `{"value":150}`。
 *
 * ⚠️ **`0` 是有效值，含义是「彻底关掉匿名识别」** —— 这是被刷爆时的急停开关，
 * 不用等一次部署。正因为它有效，才要把「负数 / 小数 / 非数字」明确挡掉回 null：
 * 手滑写个 `-1` 或 `abc` 应该退回默认值，而不是把游客识别整个关死。
 */
export function parseLimitOverride(raw: unknown): number | null {
  let v: unknown = raw;
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    v = o.limit ?? o.value;
  }
  if (typeof v === "string") v = v.trim() === "" ? NaN : Number(v);
  if (typeof v !== "number" || !Number.isInteger(v) || v < 0) return null;
  return v;
}

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
  let limit = ANON_IDENTIFY_DAILY_LIMIT;
  try {
    const ip = await clientIp();
    // 本地 dev / 非 Cloudflare 环境：没有这个头，不限。
    if (!ip) return { allowed: true, used: 0, limit };

    const day = today();
    const key = await ipKey(ip, day);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = supabaseAdmin as any;

    // 计数行和上限覆盖值**一次查回来**。分两次查会给每一次匿名识别多加一个往返，
    // 而这两行都在同一张表里，用 `.in()` 取回再分拣即可。
    const { data } = await db.from("site_config").select("key,value").in("key", [key, LIMIT_KEY]);
    const rows = (data ?? []) as { key?: unknown; value?: unknown }[];
    const valueOf = (k: string): unknown => {
      const row = rows.find((r) => r.key === k);
      const raw = row?.value;
      // 这一列是 jsonb，但历史上也有存成字符串的，两种都接住。
      if (typeof raw !== "string") return raw;
      try {
        return JSON.parse(raw);
      } catch {
        return raw;
      }
    };

    // 库里配了就用库里的，改完立刻生效、不用重新部署；没配 / 配得看不懂就用代码默认值。
    const override = parseLimitOverride(valueOf(LIMIT_KEY));
    if (override !== null) limit = override;

    const rec = valueOf(key) as Counter | null;
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
