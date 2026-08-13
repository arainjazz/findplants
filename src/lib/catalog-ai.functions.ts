import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const InputSchema = z.object({
  entries: z
    .array(
      z.object({
        scientific_name: z.string().min(1).max(200),
        chinese_name: z.string().nullable(),
      }),
    )
    .min(1)
    .max(500),
});

/**
 * Fills in missing Chinese common names for plants by scientific name using Lovable AI.
 * Returns the same array shape with chinese_name populated where the AI is confident.
 *
 * 🔒 **必须登录才能调**。这条接口每次会拿站点的 `LOVABLE_API_KEY` 去打一次大模型，
 * 而 server fn 在 `/_serverFn/<id>` 上是公开可 POST 的、id 就写在客户端 bundle 里 ——
 * 不设门槛的话任何人都能拿它当免费 AI 网关刷，额度是我们付钱。
 *
 * 门槛只定在「登录」而不是「管理员」：它真正的调用场景是**任何登录用户**在
 * plants.index / catalog-row 里「补充图鉴条目」时自动补中文名（那两处入口的条件就是
 * `user &&`）。收紧到管理员会让普通编辑者的补全静默失效 —— 调用处是 `catch {}` 吞掉的，
 * 用户只会看到中文名莫名其妙空着，连报错都没有。
 */
export const fillChineseNames = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => InputSchema.parse(input))
  .handler(async ({ data }) => {
    const missing = data.entries.filter((e) => !e.chinese_name || !e.chinese_name.trim());
    if (missing.length === 0) return { entries: data.entries };

    const key = process.env.LOVABLE_API_KEY;
    if (!key) return { entries: data.entries };

    const prompt = `请为下列植物学名补充常用中文名（种名优先；若你不确定，留空字符串）。仅返回 JSON 数组，元素形如 {"scientific_name": "...", "chinese_name": "..."}。\n\n${missing
      .map((e) => e.scientific_name)
      .join("\n")}`;

    try {
      const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Lovable-API-Key": key,
          "X-Lovable-AIG-SDK": "vercel-ai-sdk",
        },
        body: JSON.stringify({
          model: "google/gemini-3-flash-preview",
          messages: [
            { role: "system", content: "You are a botanical taxonomy assistant. Return only valid JSON when asked." },
            { role: "user", content: prompt },
          ],
          temperature: 0.1,
        }),
      });
      if (!res.ok) return { entries: data.entries };
      const j = await res.json();
      const content: string = j?.choices?.[0]?.message?.content ?? "";
      const match = content.match(/\[[\s\S]*\]/);
      if (!match) return { entries: data.entries };
      const parsed = JSON.parse(match[0]) as { scientific_name: string; chinese_name: string }[];
      const map = new Map(parsed.map((p) => [p.scientific_name.toLowerCase().trim(), p.chinese_name]));
      return {
        entries: data.entries.map((e) =>
          e.chinese_name
            ? e
            : {
                scientific_name: e.scientific_name,
                chinese_name: map.get(e.scientific_name.toLowerCase().trim()) || null,
              },
        ),
      };
    } catch {
      return { entries: data.entries };
    }
  });