import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { OWNER_EMAILS } from "@/lib/leaves";
import { ABOUT_MAX_CHARS, DEFAULT_ABOUT, readAboutDoc, type AboutDoc } from "@/lib/about-content";

/**
 * 「关于 / 使用指南」的读写。存 `site_config` 的这个 key —— 不新建表，
 * 与金叶创作指导同一套路（见 about-content.ts 顶部的说明）。
 */
const ABOUT_CONFIG_KEY = "about_page";

/**
 * 读：**公开**，不加鉴权中间件 —— 这是给未登录新访客看的介绍页，
 * 挂上鉴权它就打不开了。走 service-role 只是因为 site_config 是管理员表、
 * 匿名角色读不到，与"谁能看"无关。
 *
 * 读失败绝不能让页面白屏 → 一律回退到随站发布的初稿。
 */
export const getAboutFn = createServerFn({ method: "GET" }).handler(async (): Promise<AboutDoc> => {
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data } = await (supabaseAdmin as any)
      .from("site_config")
      .select("value")
      .eq("key", ABOUT_CONFIG_KEY)
      .maybeSingle();
    const raw = (data as { value?: unknown } | null)?.value;
    if (raw == null) return DEFAULT_ABOUT;
    return readAboutDoc(raw);
  } catch (e) {
    console.warn("[About] load failed; falling back to built-in draft:", e);
    return DEFAULT_ABOUT;
  }
});

const SectionInput = z.object({
  id: z
    .string()
    .min(1)
    .max(60)
    // 锚点 id 直接进 URL 的 #… 和 querySelector，限死字符集，免得存进一个能把
    // 目录跳转打断的怪串。
    .regex(/^[a-z0-9-]+$/, "章节 id 只能用小写字母、数字和连字符"),
  zh: z.string().min(1).max(80),
  en: z.string().max(80),
  level: z.union([z.literal(1), z.literal(2)]),
  kind: z.enum(["prose", "matrix"]),
  html: z.string().max(ABOUT_MAX_CHARS),
});

const SaveInput = z.object({
  sections: z.array(SectionInput).min(1).max(80),
});

/** 站长身份判定。token 里的 email 已由中间件验签，可信。 */
function assertOwner(claims: Record<string, unknown> | undefined, action: string) {
  const email = typeof claims?.email === "string" ? claims.email.trim().toLowerCase() : "";
  if (!email || !OWNER_EMAILS.includes(email)) {
    throw new Error(`仅网站所有者可${action}`);
  }
  return email;
}

/**
 * 写：**仅网站所有者**。这里刻意不用 assertAdmin —— 管理员比站长宽，
 * 而用户要的是「只有我能改这一页」。
 */
export const saveAboutFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => SaveInput.parse(input))
  .handler(async ({ data, context }) => {
    const { userId, claims } = context as {
      userId: string;
      claims: Record<string, unknown> | undefined;
    };
    assertOwner(claims, "编辑关于页");

    const total = data.sections.reduce((n, s) => n + s.html.length, 0);
    if (total > ABOUT_MAX_CHARS) {
      throw new Error(`正文合计 ${total} 字符，超过上限 ${ABOUT_MAX_CHARS}`);
    }
    const ids = new Set<string>();
    for (const s of data.sections) {
      if (ids.has(s.id)) throw new Error(`章节 id 重复：${s.id}`);
      ids.add(s.id);
    }

    const value: AboutDoc = {
      sections: data.sections,
      updatedAt: new Date().toISOString(),
      updatedBy: userId,
    };

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (supabaseAdmin as any)
      .from("site_config")
      .upsert({ key: ABOUT_CONFIG_KEY, value }, { onConflict: "key" });
    if (error) throw new Error(`保存失败：${error.message}`);
    return { ok: true, sections: data.sections.length, chars: total, updatedAt: value.updatedAt };
  });

/** 清空存档，整页退回随站发布的初稿。仅站长。 */
export const resetAboutFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { claims } = context as { claims: Record<string, unknown> | undefined };
    assertOwner(claims, "重置关于页");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (supabaseAdmin as any)
      .from("site_config")
      .delete()
      .eq("key", ABOUT_CONFIG_KEY);
    if (error) throw new Error(`重置失败：${error.message}`);
    return { ok: true };
  });
