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
  goldAvailable: number; // 可用金叶
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
 * Owner-only 采纳 (adopt) toggle on a contribution — doubles the author's bronze
 * leaf. Writes the adopted flag on a plant_edits (修文/换图) or plant_drafts (识别)
 * row. RLS already lets an admin/owner update both tables.
 */
export async function setAdopted(
  table: "plant_edits" | "plant_drafts",
  id: string,
  adopted: boolean,
  ownerId: string,
) {
  const patch = {
    adopted,
    adopted_by: adopted ? ownerId : null,
    adopted_at: adopted ? new Date().toISOString() : null,
  };
  // table is a runtime union → cast the builder to keep update() typing simple.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase.from(table) as any).update(patch).eq("id", id);
  if (error) throw error;
}

export async function computeLeaves(userId: string, email?: string | null): Promise<LeafStats> {
  const isOwner = isOwnerEmail(email);

  const [idTotal, idAdopted, textTotal, textAdopted, imageTotal, imageAdopted, prof] = await Promise.all([
    draftCount(userId),
    draftCount(userId, true),
    editCount(userId, "text"),
    editCount(userId, "text", true),
    editCount(userId, "image"),
    editCount(userId, "image", true),
    supabase.from("profiles").select("gold_used").eq("id", userId).maybeSingle(),
  ]);

  // Each adopted contribution counts twice → base + adopted.
  const identify = idTotal + idAdopted;
  const text = textTotal + textAdopted;
  const image = imageTotal + imageAdopted;
  const bronze = identify + text + image;
  const silver = Math.floor(bronze / 10);
  const gold = Math.floor(silver / 10);

  const goldUsed = (prof.data?.gold_used as number | undefined) ?? 0;
  const goldAvailable = Math.max(0, gold - goldUsed);

  let level: LeafLevel = "none";
  if (isOwner || gold >= 10) level = "senior";
  else if (gold >= 1) level = "gold";
  else if (silver >= 1) level = "silver";
  else if (bronze >= 1) level = "bronze";

  return { identify, text, image, bronze, silver, gold, goldUsed, goldAvailable, level, isOwner };
}
