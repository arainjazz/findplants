import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { OWNER_EMAILS, SENIOR_ROLE } from "@/lib/leaves";

/**
 * 「资深编辑」的授予与它解锁的两项特权（采纳 / 撤销）。
 *
 * 背景（2026-07-31，用户提问「我目前该如何指定资深编辑」时挖出来的）：在此之前
 * 「资深编辑」只是个**头衔**——`computeLeaves` 里 `gold >= 10` 自动升，不解锁任何权限；
 * 而真正的采纳权散在三个互不一致的判据上：
 *   · /edits 的采纳按钮只认硬编码的 OWNER_EMAILS；
 *   · `plant_edits` 的 UPDATE RLS 只认 `admin` 角色；
 *   · `plant_drafts` 的 UPDATE RLS 认**任何已批准编辑** —— 于是识别铜叶谁都能给人翻倍。
 * 现在统一成一道门：**站长 或 资深编辑**，判据写在本文件里。
 *
 * 🔴 为什么走 service-role 而不是改 RLS：`plant_edits` 的 UPDATE 策略是 admin-only，
 * 要让 moderator 能写就得去 Supabase dashboard 改策略（hosted 项目、无本地 CLI，只能手工跑）。
 * 而这两项操作本来就该有服务端闸门 —— 把权限判定收进 TS、用 service-role 落库，
 * 既不用动 RLS，也不会因为前端判据和数据库判据不一致再次跑偏。
 */

/** 三个身份的判定结果，UI 拿它决定显示什么。 */
export type MyRoles = { isOwner: boolean; isSenior: boolean; isAdmin: boolean };

function ownerFromClaims(claims: Record<string, unknown> | undefined): boolean {
  const email = typeof claims?.email === "string" ? claims.email.trim().toLowerCase() : "";
  return !!email && OWNER_EMAILS.includes(email);
}

async function rolesOf(userId: string): Promise<string[]> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data } = await (supabaseAdmin as any)
    .from("user_roles")
    .select("role")
    .eq("user_id", userId);
  return ((data ?? []) as { role: string }[]).map((r) => r.role);
}

/**
 * 解析调用者的身份。站长恒为资深编辑（不必再给自己发一个角色）。
 *
 * 导出是给**别的服务端模块**复用的（如 geo-sightings.functions.ts 的精确坐标闸门）——
 * 身份判据必须全站只有一份，各处自己抄一遍迟早会跑偏（这正是本文件开头记的那次教训）。
 */
export async function resolveRoles(
  userId: string,
  claims: Record<string, unknown> | undefined,
): Promise<MyRoles> {
  const isOwner = ownerFromClaims(claims);
  const roles = await rolesOf(userId);
  return {
    isOwner,
    isAdmin: roles.includes("admin"),
    isSenior: isOwner || roles.includes(SENIOR_ROLE),
  };
}

/** 当前登录者的身份。UI 用它决定「采纳」「撤销」「设为资深编辑」显不显示。 */
export const getMyRolesFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<MyRoles> => {
    const { userId, claims } = context as {
      userId: string;
      claims: Record<string, unknown> | undefined;
    };
    return resolveRoles(userId, claims);
  });

// ─── 授予 / 收回资深编辑 ─────────────────────────────────────────────────────

const SetSeniorInput = z.object({
  userId: z.string().uuid(),
  senior: z.boolean(),
});

/**
 * 指定 / 取消资深编辑。**仅站长** —— 这一项就是用户要的那个「指定」入口，
 * 不能让资深编辑再去发资深编辑（否则权限会自我扩散）。
 */
export const setSeniorEditorFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => SetSeniorInput.parse(input))
  .handler(async ({ data, context }) => {
    const { claims } = context as { claims: Record<string, unknown> | undefined };
    if (!ownerFromClaims(claims)) throw new Error("仅网站所有者可指定资深编辑");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    if (data.senior) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error } = await (supabaseAdmin as any)
        .from("user_roles")
        .insert({ user_id: data.userId, role: SENIOR_ROLE });
      // 重复授予不算错 —— 按钮可能被点两下，结果一样就行。
      if (error && !String(error.message).toLowerCase().includes("duplicate")) throw error;
    } else {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error } = await (supabaseAdmin as any)
        .from("user_roles")
        .delete()
        .eq("user_id", data.userId)
        .eq("role", SENIOR_ROLE);
      if (error) throw error;
    }
    return { ok: true, senior: data.senior };
  });

/** 现有资深编辑的 user_id 列表。仅站长 —— 申请页用它把开关显示成正确的状态。 */
export const listSeniorEditorsFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<string[]> => {
    const { claims } = context as { claims: Record<string, unknown> | undefined };
    if (!ownerFromClaims(claims)) return [];
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data } = await (supabaseAdmin as any)
      .from("user_roles")
      .select("user_id")
      .eq("role", SENIOR_ROLE);
    return ((data ?? []) as { user_id: string }[]).map((r) => r.user_id);
  });

// ─── 采纳 ────────────────────────────────────────────────────────────────────

const SetAdoptedInput = z.object({
  table: z.enum(["plant_edits", "plant_drafts"]),
  id: z.string().uuid(),
  adopted: z.boolean(),
});

/**
 * 采纳 / 取消采纳一份贡献 —— 作者那一枚铜叶随之 ×2 / 还原。
 * **站长或资深编辑**。原先客户端直写的 `setAdopted()` 已由本函数取代。
 */
export const setAdoptedFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => SetAdoptedInput.parse(input))
  .handler(async ({ data, context }) => {
    const { userId, claims } = context as {
      userId: string;
      claims: Record<string, unknown> | undefined;
    };
    const roles = await resolveRoles(userId, claims);
    if (!roles.isSenior) throw new Error("仅站长或资深编辑可采纳他人的贡献");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (supabaseAdmin as any)
      .from(data.table)
      .update({
        adopted: data.adopted,
        adopted_by: data.adopted ? userId : null,
        adopted_at: data.adopted ? new Date().toISOString() : null,
      })
      .eq("id", data.id);
    if (error) throw new Error(`采纳失败：${error.message}`);
    return { ok: true, adopted: data.adopted };
  });

// ─── 撤销他人的改动 ──────────────────────────────────────────────────────────

const ApplyRevertInput = z.object({
  plantId: z.string().uuid(),
  /** 已经在浏览器里改好、传上 storage 的新 HTML 地址。 */
  newHtmlUrl: z.string().url(),
  editId: z.string().uuid(),
  beforeHtml: z.string().nullable(),
  afterHtml: z.string().nullable(),
  /** true = 这次是「恢复」（把之前撤销掉的改动装回去）。 */
  restoring: z.boolean(),
});

/**
 * 撤销 / 恢复的**落库**部分。DOM 那一半必须留在浏览器里（`revertEdit` 用 DOMParser，
 * 服务端没有），所以这里只收尾：换 plants.html_url + 翻 plant_edits 的 reverted 标记。
 * **站长、资深编辑或管理员**。
 */
export const applyRevertFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => ApplyRevertInput.parse(input))
  .handler(async ({ data, context }) => {
    const { userId, claims } = context as {
      userId: string;
      claims: Record<string, unknown> | undefined;
    };
    const roles = await resolveRoles(userId, claims);
    if (!roles.isSenior && !roles.isAdmin) throw new Error("仅站长、资深编辑或管理员可撤销改动");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error: updErr } = await (supabaseAdmin as any)
      .from("plants")
      .update({ html_url: data.newHtmlUrl })
      .eq("id", data.plantId);
    if (updErr) throw new Error(`写回条目失败：${updErr.message}`);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error: revErr } = await (supabaseAdmin as any)
      .from("plant_edits")
      .update({
        before_html: data.beforeHtml,
        after_html: data.afterHtml,
        reverted: !data.restoring,
        reverted_by: data.restoring ? null : userId,
        reverted_at: data.restoring ? null : new Date().toISOString(),
      })
      .eq("id", data.editId);
    if (revErr) throw new Error(`标记撤销失败：${revErr.message}`);

    return { ok: true, reverted: !data.restoring };
  });
