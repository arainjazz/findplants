import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { OWNER_EMAILS, SENIOR_ROLE } from "@/lib/leaves";

// ─── 矛盾红框的「采用这个说法」──────────────────────────────────────────────
//
// 检测本身是纯函数、在前端跑（lib/field-conflicts.ts）；这里只管**落库**。
//
// 🔴 为什么采用一个说法要**同时改来源草稿**：不改的话，条目和草稿依旧各说各话，
// 下次进页面红框原样再来一遍 —— 红框就成了永远消不掉的噪音，编辑很快学会无视它。
// 所以「采用」的语义是**统一口径**：条目和它所有来源草稿的这一字段一起改成选定值，
// 并在修改记录里留一条写明「原来各方说的是什么」。谁改的、改成什么、什么时候，全在案。
//
// 🔴 `kind` 必须用 `plant_edits_kind_check` **已经允许**的值。那个 CHECK 很窄，
// 加新 kind 要去 Supabase dashboard 跑迁移（hosted 项目、无本地 CLI），而所有
// plant_edits 写入都是 best-effort catch 掉的 —— 用没被允许的值会**静默失败**、
// 修改记录里什么都不出现。字段口径统一本质上就是一次文本修改，用 `text`。

const FIELDS = [
  "scientific_name",
  "family",
  "genus",
  "title",
  "common_name_en",
  "common_names_zh",
] as const;

const FIELD_LABEL: Record<(typeof FIELDS)[number], string> = {
  scientific_name: "学名",
  family: "科",
  genus: "属",
  title: "中文名",
  common_name_en: "英文俗名",
  common_names_zh: "中文俗名",
};

const Input = z.object({
  plantId: z.string().uuid(),
  field: z.enum(FIELDS),
  value: z.string().trim().min(1).max(300),
  /** 各方原来的说法，只用来写进修改记录的摘要，让这条记录自己看得懂。 */
  was: z.array(z.string().max(300)).max(20).optional(),
});

export type ResolveConflictResult = { ok: true } | { ok: false; reason: string };

export const resolveFieldConflictFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => Input.parse(input))
  .handler(async ({ data, context }): Promise<ResolveConflictResult> => {
    const { userId, claims } = context as {
      userId: string;
      claims: Record<string, unknown> | undefined;
    };
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // 权限：站长 / 资深编辑 / 编辑 / 管理员。与「采纳」同一档 —— 统一字段口径是编辑工作。
    const email = typeof claims?.email === "string" ? claims.email.trim().toLowerCase() : "";
    const isOwner = !!email && OWNER_EMAILS.includes(email);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: roleRows } = await (supabaseAdmin as any)
      .from("user_roles")
      .select("role")
      .eq("user_id", userId);
    const roles = ((roleRows ?? []) as { role: string }[]).map((r) => r.role);
    const allowed =
      isOwner || roles.includes("admin") || roles.includes("editor") || roles.includes(SENIOR_ROLE);
    if (!allowed) return { ok: false, reason: "只有编辑可以统一字段口径。" };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = supabaseAdmin as any;
    const { data: plant } = await sb
      .from("plants")
      .select("id, title")
      .eq("id", data.plantId)
      .maybeSingle();
    if (!plant) return { ok: false, reason: "找不到这个条目。" };

    const { error: upErr } = await sb
      .from("plants")
      .update({ [data.field]: data.value })
      .eq("id", data.plantId);
    if (upErr) return { ok: false, reason: `写入条目失败：${upErr.message}` };

    // 来源草稿一起改，否则下次进页面这条矛盾原样再来一遍。
    await sb
      .from("plant_drafts")
      .update({ [data.field]: data.value })
      .eq("published_plant_id", data.plantId);

    let editorName = "编辑";
    const { data: prof } = await sb
      .from("profiles")
      .select("display_name")
      .eq("id", userId)
      .maybeSingle();
    if (prof?.display_name) editorName = prof.display_name;

    const wasText = (data.was ?? []).filter((w) => w && w !== data.value).join("、");
    await sb
      .from("plant_edits")
      .insert({
        plant_id: data.plantId,
        editor_id: userId,
        editor_name: editorName,
        kind: "text",
        marker_n: 0,
        source: "conflict_resolve",
        summary:
          `统一「${FIELD_LABEL[data.field]}」口径为「${data.value}」` +
          (wasText ? `（合并前各来源说法：${wasText}）` : ""),
      })
      // 记录写不进去不该让已经生效的字段修改回滚 —— 但也别静默：打日志。
      .then(
        (r: { error?: { message?: string } }) =>
          r?.error && console.warn("[ConflictResolve] 记录修改日志失败：", r.error.message),
      );

    return { ok: true };
  });
