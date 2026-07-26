import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { speciesKey } from "./plants";

// ─── 「这个物种已经有人做过了」查询 ──────────────────────────────────────────
// 识别出**非疑似**结果后，草稿页在关掉分享卡时用它决定要不要拦一下：库里已经有同物种的
// 银叶草稿 / 金叶详页时，先把现成的推给用户，别让他再白花一枚银叶等好几分钟。
//
// 走服务端（service role）而不是前端直查：要跨用户统计「几份 / 几人」，前端受 RLS 限制
// 拿不全别人的草稿，算出来的数字会偏小且因人而异。

const Input = z.object({
  scientificName: z.string().max(300).nullable().optional(),
  /** 当前这份草稿自己不算进去。 */
  excludeDraftId: z.string().uuid().nullable().optional(),
});

export type SpeciesExisting = {
  drafts: { count: number; userCount: number; latestId: string | null };
  plant: { slug: string; title: string } | null;
};

const EMPTY: SpeciesExisting = {
  drafts: { count: 0, userCount: 0, latestId: null },
  plant: null,
};

/**
 * 「这张照片是不是已经识别过了」。
 *
 * 指纹 = **原始文件字节**的 SHA-256（客户端在压缩之前算，见 camera-identify）。用原始字节
 * 而不是压缩后的：同一个文件重新选一次，原始字节必然一模一样；压缩是有损再编码，不保证
 * 跨次比特一致。
 *
 * 存在 `ai_payload._photo_sha256` 而不是新开一列：hosted Supabase 加列要人工去 dashboard
 * 跑迁移，能不加就不加。代价是这个 JSON 路径没索引 —— 目前草稿量级下无所谓，真慢了再补
 * 一个 `create index on plant_drafts ((ai_payload->>'_photo_sha256'))`。
 */
export const findDraftByPhotoHash = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) =>
    z.object({ hash: z.string().regex(/^[a-f0-9]{64}$/) }).parse(input),
  )
  .handler(async ({ data }): Promise<{ draftId: string; title: string | null } | null> => {
    try {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const { data: rows } = await (supabaseAdmin as any)
        .from("plant_drafts")
        .select("id, title, created_at")
        .eq("ai_payload->>_photo_sha256", data.hash)
        .order("created_at", { ascending: false })
        .limit(1);
      const hit = (rows ?? [])[0];
      return hit ? { draftId: hit.id, title: hit.title ?? null } : null;
    } catch (e) {
      // 查重失败绝不能挡住识别 —— 大不了重复识别一次。
      console.warn("[PhotoDedup] lookup failed:", e);
      return null;
    }
  });

export const lookupSpeciesExisting = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => Input.parse(input))
  .handler(async ({ data }): Promise<SpeciesExisting> => {
    const key = speciesKey(data.scientificName ?? "");
    if (!key) return EMPTY;
    // 属名前缀粗筛（能走索引）→ 再用 speciesKey 精确比对。库里的 scientific_name 写法很不
    // 统一（带命名人、亚种、大小写、markdown 星号），直接等值匹配会漏掉一大半。
    const genus = key.split(" ")[0];
    if (!genus) return EMPTY;

    try {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

      const [draftRes, plantRes] = await Promise.all([
        // `_enriched` 是布尔且快速草稿会显式写 false，所以必须判 = true：
        // 只有真正跑过「生成进一步介绍草稿」的银叶草稿才算数。只有简介摘要卡的快速识别
        // 不能算——每次识别都会落一条，算进来会导致几乎每次都弹按钮，功能立刻变噪音。
        (supabaseAdmin as any)
          .from("plant_drafts")
          .select("id, created_by, scientific_name, created_at")
          .ilike("scientific_name", `${genus}%`)
          .eq("ai_payload->>_enriched", "true")
          .order("created_at", { ascending: false })
          .limit(300),
        (supabaseAdmin as any)
          .from("plants")
          .select("slug, title, scientific_name")
          .ilike("scientific_name", `${genus}%`)
          .limit(300),
      ]);

      const rows: { id: string; created_by: string | null; scientific_name: string | null }[] =
        (draftRes?.data ?? []).filter(
          (r: any) => speciesKey(r.scientific_name) === key && r.id !== data.excludeDraftId,
        );

      const userIds = new Set(rows.map((r) => r.created_by).filter(Boolean) as string[]);
      const plantRow = (plantRes?.data ?? []).find(
        (p: any) => speciesKey(p.scientific_name) === key,
      );

      return {
        drafts: {
          count: rows.length,
          userCount: userIds.size,
          // 已按 created_at 倒序，第一条就是最新的那份。
          latestId: rows[0]?.id ?? null,
        },
        plant: plantRow ? { slug: plantRow.slug, title: plantRow.title } : null,
      };
    } catch (e) {
      // 纯锦上添花的功能：查不到就当没有，绝不能因此挡住用户正常的生成流程。
      console.warn("[SpeciesExisting] lookup failed:", e);
      return EMPTY;
    }
  });
