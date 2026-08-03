// ─── 未登录访客的本地身份 ─────────────────────────────────────────────────────
//
// 匿名识别搬进队列之后（2026-08-03），服务端那份 job 行必须有个「领主」——
// 轮询时靠它判断「这是不是你的任务」，否则要么谁都读得到别人的任务，
// 要么匿名用户连自己刚提交的那条都查不到。
//
// 这个 id **只是一把取件号，不是身份凭证**：
// · 随机 uuid，猜不中 —— 别人无法凭它翻到你的识别任务；
// · 它换不来任何登录用户的权限：服务端一律给它加 `anon:` 前缀（见 background-jobs.ts），
//   永远落不进真实用户的 uuid 空间；
// · 清掉浏览器存储就换一个新的 —— 代价只是「排队上限重新计数」，所以匿名的并发上限
//   本来就只是防手滑连点，不是防刷的安全边界。
//
// 存 localStorage 而不是 sessionStorage：识别要跑几分钟，用户中途可能关标签页再回来，
// 取件号得还在。隐私模式下写不进去就每次新生成一个 —— 那只影响「刷新后接回进度」。

const KEY = "plantspedia:anon-id";

function newId(): string {
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (c?.randomUUID) return c.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/** 拿到（必要时生成）本浏览器的访客取件号。仅在浏览器里调用。 */
export function getAnonId(): string {
  try {
    const existing = localStorage.getItem(KEY);
    if (existing) return existing;
    const id = newId();
    localStorage.setItem(KEY, id);
    return id;
  } catch {
    // 隐私模式 / 存储满：给一个一次性的，本次识别照样能轮询，只是刷新后接不回来。
    return newId();
  }
}
