import { supabase } from "@/integrations/supabase/client";

/**
 * Editor leaf / points model (Phase 1).
 *
 * Leaves are DERIVED at read-time from existing contributions:
 *   - 识别铜叶 (identify)  = one per plant_drafts row created by the user
 *   - 修文铜叶 (text edit) = one per plant_edits kind='text'  (on a 收录 entry), not reverted
 *   - 换图铜叶 (image edit) = one per plant_edits kind='image' (on a 收录 entry), not reverted
 * Each contribution earns 1 bronze leaf; once the owner/senior editor 采纳 (adopts)
 * it (the `adopted` flag), that single leaf DOUBLES (counts as 2).
 *
 *   铜叶合计 = 识别 + 修文 + 换图   (always shown cumulatively, never consumed)
 *   银叶     = floor(铜叶合计 / 10)
 *   金叶     = floor(银叶 / 10)
 * Each 金叶 grants one「一键创建物种科普详页」use; spent ones live in profiles.gold_used.
 */

// Site owner(s) — default 资深编辑 regardless of leaf count (per product decision).
export const OWNER_EMAILS = ["arainjazz@gmail.com", "arainjazz@163.com"];

export function isOwnerEmail(email: string | null | undefined): boolean {
  return !!email && OWNER_EMAILS.includes(email.trim().toLowerCase());
}

/**
 * 「资深编辑」落在 `user_roles` 的哪个角色上。
 *
 * 复用现有 `app_role` 枚举里一直没被用过的 **moderator** —— 枚举加值要跑 DB 迁移
 * （hosted 项目、只能去 dashboard 手工执行），而这里不需要新语义、只需要一个空位。
 * 站内一律显示为「资深编辑」，moderator 这个词只活在数据库里。
 */
export const SENIOR_ROLE = "moderator";

/**
 * 某人是不是资深编辑。**只读判定**，用来决定 UI 显不显示采纳/撤销按钮；
 * 真正的闸门在 roles.functions.ts 的服务端函数里（前端判据永远只是方便，不是安全边界）。
 */
export async function fetchIsSeniorEditor(userId: string | undefined | null): Promise<boolean> {
  if (!userId) return false;
  const { data } = await supabase
    .from("user_roles")
    .select("role")
    .eq("user_id", userId)
    .eq("role", SENIOR_ROLE as "moderator")
    .maybeSingle();
  return !!data;
}

export type LeafLevel = "senior" | "gold" | "silver" | "bronze" | "none";

export const LEVEL_LABEL: Record<LeafLevel, string> = {
  senior: "资深编辑",
  gold: "金叶编辑",
  silver: "银叶编辑",
  bronze: "铜叶编辑",
  none: "见习编辑",
};

export type LeafStats = {
  identify: number; // 识别铜叶 (after doubling adopted ones)
  text: number; // 修文铜叶
  image: number; // 换图铜叶
  bronze: number; // 铜叶合计
  silver: number; // 银叶
  gold: number; // 金叶 (earned, total)
  goldUsed: number; // 已用金叶
  goldAvailable: number; // 可用金叶 (Infinity for owner)
  silverUsed: number; // 已用银叶（进一步草稿消耗）
  silverAvailable: number; // 可用银叶 (Infinity for owner)
  level: LeafLevel;
  isOwner: boolean;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function countRows(query: any): Promise<number> {
  const { count, error } = await query;
  if (error) return 0;
  return count ?? 0;
}

const draftCount = (userId: string, adopted?: boolean) => {
  let q = supabase
    .from("plant_drafts")
    .select("id", { count: "exact", head: true })
    .eq("created_by", userId);
  if (adopted) q = q.eq("adopted", true);
  return countRows(q);
};

/**
 * 识别铜叶（变量制）：每份草稿的价值 = 疑似(low)恒 1；否则 1 + 补拍次数(retake_count)，
 * 采纳(adopted)再翻倍。整体求和。若 retake_count 列尚未迁移 → 优雅回退到旧的计数制
 * （草稿数 + 采纳数，等价于每份 +1、采纳 +1），保证部署早于迁移也不崩。
 */
async function identifyBronze(userId: string): Promise<number> {
  const { data, error } = await supabase
    .from("plant_drafts")
    .select("retake_count, adopted, conf:ai_payload->>identification_confidence")
    .eq("created_by", userId);
  if (error || !data) {
    // Column missing / query failed → legacy count-based value.
    const [total, adopted] = await Promise.all([draftCount(userId), draftCount(userId, true)]);
    return total + adopted;
  }
  let sum = 0;
  for (const row of data as Array<{
    retake_count: number | null;
    adopted: boolean | null;
    conf: string | null;
  }>) {
    const tentative = row.conf === "low";
    if (tentative) {
      sum += 1; // 疑似恒 +1，不随补拍/采纳增加
    } else {
      const base = 1 + (row.retake_count ?? 0);
      sum += row.adopted ? base * 2 : base;
    }
  }
  return sum;
}

const editCount = (userId: string, kind: "text" | "image", adopted?: boolean) => {
  let q = supabase
    .from("plant_edits")
    .select("id", { count: "exact", head: true })
    .eq("editor_id", userId)
    .eq("kind", kind)
    .eq("reverted", false);
  if (adopted) q = q.eq("adopted", true);
  return countRows(q);
};

/**
 * ⛔ 客户端直写的 `setAdopted()` 已删除（2026-07-31）。改用 roles.functions.ts 的
 * **`setAdoptedFn`** 服务端函数。
 *
 * 原因：它靠 RLS 兜底，而两张表的 RLS 松紧完全不同 —— `plant_edits` 只让 admin 写、
 * `plant_drafts` 却让**任何已批准编辑**写。结果是「采纳」这件事对修文/换图是站长专属、
 * 对识别草稿却人人可做，前端还各自另写了一套判据。现在统一到服务端一道门：
 * 站长或资深编辑，用 service-role 落库。
 */

export async function computeLeaves(userId: string, email?: string | null): Promise<LeafStats> {
  const isOwner = isOwnerEmail(email);

  const [identify, textTotal, textAdopted, imageTotal, imageAdopted, prof, senior] =
    await Promise.all([
      identifyBronze(userId),
      editCount(userId, "text"),
      editCount(userId, "text", true),
      editCount(userId, "image"),
      editCount(userId, "image", true),
      supabase.from("profiles").select("gold_used, silver_used").eq("id", userId).maybeSingle(),
      fetchIsSeniorEditor(userId),
    ]);
  const isSenior = isOwner || senior;

  // Each adopted contribution counts twice → base + adopted.
  const text = textTotal + textAdopted;
  const image = imageTotal + imageAdopted;
  const bronze = identify + text + image;
  const silver = Math.floor(bronze / 10);
  const gold = Math.floor(silver / 10);

  const goldUsed = (prof.data?.gold_used as number | undefined) ?? 0;
  const silverUsed = (prof.data?.silver_used as number | undefined) ?? 0;
  // The owner spends unlimited silver + gold → Infinity available (gating passes
  // and the UI formats it as ∞). Everyone else is earned-minus-used.
  // 资深编辑（用户 2026-07-31 选定的范围）：**银叶无限**，金叶照常按攒的算 ——
  // 银叶换的是「完整科普草稿」，正是希望他们多写的东西；金叶那条整页生成的链路更贵，
  // 留在站长手上。
  const goldAvailable = isOwner ? Infinity : Math.max(0, gold - goldUsed);
  const silverAvailable = isSenior ? Infinity : Math.max(0, silver - silverUsed);

  // 「资深编辑」= 站长或被站长指定的人。**不再是 `gold >= 10` 自动升**（2026-07-31）：
  // 那条规则让它成了一个纯头衔 —— 不解锁任何权限，也没有任何人能指定谁当。
  let level: LeafLevel = "none";
  if (isSenior) level = "senior";
  else if (gold >= 1) level = "gold";
  else if (silver >= 1) level = "silver";
  else if (bronze >= 1) level = "bronze";

  return {
    identify,
    text,
    image,
    bronze,
    silver,
    gold,
    goldUsed,
    goldAvailable,
    silverUsed,
    silverAvailable,
    level,
    isOwner,
  };
}
