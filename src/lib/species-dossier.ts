/**
 * 物种资料包 —— 「同一物种只写一次，全站复用」。
 *
 * 背景见 supabase/migrations/20260720120000_species_dossiers.sql 顶部注释。
 * 一句话：**内容分两类**——
 *   - **物种级**（通用）：词源、形态、生境、人文、养护、标签、IUCN…… 同一物种人人一样。
 *   - **照片级**（个人）：拍摄记录、拍摄地点/时间、这张照片本身。每个人都不同。
 * 资料包只存前者；草稿 = 资料包 + 后者。
 *
 * 本文件的**纯函数部分**（字段划分、完整性判定、覆写策略）不碰数据库，
 * `scratch/species-dossier.test.mjs` 直接跑本体。数据库读写在文件下半部分，
 * 一律通过 supabaseAdmin（本表 RLS 全关、无 policy，只有 service-role 能进）。
 */

import { speciesKey } from "./plants";

/**
 * **照片级字段** —— 这些绝不能进资料包，否则甲的拍摄记录会出现在乙的草稿里。
 *
 * 这份清单是本模块最容易出错的地方：漏掉一个，就会有人在自己的草稿里读到别人的
 * 拍摄地点。新增 AiMeta 字段时务必回来判断它属于哪一类。
 */
export const PHOTO_SPECIFIC_FIELDS = [
  "field_notes_zh",
  "field_notes_en",
  "photo_url",
  "capture_place",
  "capture_lat",
  "capture_lng",
  "capture_date",
  // 置信度与补拍建议是**对这张照片**的判断，不是对物种的判断。
  "identification_confidence",
  "needs_more_photos_zh",
  "needs_more_photos_en",
  // 内部标记，不属于内容
  "_enriched",
  "ai_model",
] as const;

/** 判定「这份资料包有没有真正的正文」的必备字段。缺任一项就不算可复用。 */
const REQUIRED_BODY_FIELDS = ["morphology_zh", "habitat_zh"] as const;

export type DossierStatus = "unverified" | "curated";

export type SpeciesDossier = {
  id?: string;
  speciesKey: string;
  gbifTaxonKey: number | null;
  scientificName: string;
  title: string | null;
  commonNameEn: string | null;
  commonNamesZh: string | null;
  family: string | null;
  genus: string | null;
  status: DossierStatus;
  body: Record<string, unknown>;
  facts: unknown | null;
  research: unknown | null;
  images: string[];
  aiModel: string | null;
  skillSignature: string | null;
  hitCount: number;
  generatedAt: string | null;
  curatedAt: string | null;
};

/**
 * 从一份完整的草稿 AiMeta 里切出**物种级**内容。
 * 照片级字段一律剔除（见 PHOTO_SPECIFIC_FIELDS）。
 */
export function toDossierBody(meta: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const drop = new Set<string>(PHOTO_SPECIFIC_FIELDS as readonly string[]);
  for (const [k, v] of Object.entries(meta ?? {})) {
    if (drop.has(k)) continue;
    if (v === null || v === undefined || v === "") continue;
    out[k] = v;
  }
  return out;
}

/**
 * 这份资料包能不能拿来出草稿。
 *
 * 判据沿用改造前 `findExistingSpeciesDraft` 的那条硬规则：**必须有真正的长正文**。
 * phase-1 的「简介摘要卡」只有 summary + field_notes，拿它当资料包会渲染出
 * 一堆有配图、没文字的空分区 —— 这个坑踩过一次，不能再踩。
 */
export function isDossierUsable(body: Record<string, unknown> | null | undefined): boolean {
  if (!body) return false;
  return REQUIRED_BODY_FIELDS.every((f) => String(body[f] ?? "").trim().length > 0);
}

/**
 * 把资料包 + 这张照片的个人信息合成一份完整 AiMeta。
 *
 * 顺序很重要：**照片级字段最后覆盖**，因为它们才是"这一次"的真相。
 * 尤其 identification_confidence / needs_more_photos_* —— 若让资料包里的旧值漏进来，
 * 甲那次「拍得很清楚」的 high 就会替乙那张糊照背书，补拍关卡直接失效。
 */
export function assembleDraftMeta(
  dossier: Pick<SpeciesDossier, "body" | "scientificName" | "title">,
  perPhoto: Record<string, unknown>,
): Record<string, unknown> {
  const base: Record<string, unknown> = {
    ...dossier.body,
    scientific_name: dossier.scientificName,
    ...(dossier.title ? { title: dossier.title } : {}),
  };
  for (const f of PHOTO_SPECIFIC_FIELDS) delete base[f];
  return { ...base, ...perPhoto };
}

/**
 * AI 的新产出能不能覆盖已有的资料包。
 *
 * **`curated` 一律不覆写** —— 这是用户拍板的核心规则：人改过一次之后，AI 就再也不许
 * 动它。否则下一个用户点一次「进一步生成草稿」，主编刚校对完的内容就被冲掉了，
 * 而且没有任何提示。
 *
 * `unverified` 则只在新内容**确实可用**时才覆写：一次退化的生成（模型截断、字段缺失）
 * 不该把一份好资料包换成坏的。
 */
export function shouldOverwriteDossier(
  existing: Pick<SpeciesDossier, "status" | "body"> | null,
  incomingBody: Record<string, unknown>,
): { write: boolean; reason: string } {
  if (!isDossierUsable(incomingBody))
    return { write: false, reason: "新内容缺少长正文（morphology_zh / habitat_zh），不入库" };
  if (!existing) return { write: true, reason: "新建" };
  if (existing.status === "curated")
    return { write: false, reason: "已被人工校订（curated），AI 不覆写" };
  return { write: true, reason: "覆盖 unverified 旧版本" };
}

// ─────────────────────────────────────────────────────────────────────────────
// 数据库读写（service-role）
// ─────────────────────────────────────────────────────────────────────────────

const TABLE = "species_dossiers";

function rowToDossier(r: any): SpeciesDossier {
  return {
    id: r.id,
    speciesKey: r.species_key,
    gbifTaxonKey: r.gbif_taxon_key ?? null,
    scientificName: r.scientific_name,
    title: r.title ?? null,
    commonNameEn: r.common_name_en ?? null,
    commonNamesZh: r.common_names_zh ?? null,
    family: r.family ?? null,
    genus: r.genus ?? null,
    status: r.status === "curated" ? "curated" : "unverified",
    body: (r.body ?? {}) as Record<string, unknown>,
    facts: r.facts ?? null,
    research: r.research ?? null,
    images: Array.isArray(r.images) ? (r.images as string[]) : [],
    aiModel: r.ai_model ?? null,
    skillSignature: r.skill_signature ?? null,
    hitCount: r.hit_count ?? 0,
    generatedAt: r.generated_at ?? null,
    curatedAt: r.curated_at ?? null,
  };
}

/**
 * 按学名查资料包。查不到 / 表还没建 / 查询出错一律返回 null ——
 * **绝不能因为资料包没查到就让草稿生成失败**，它是加速层，不是必需品。
 */
export async function loadDossier(scientificName: string): Promise<SpeciesDossier | null> {
  const key = speciesKey(scientificName);
  if (!key) return null;
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await (supabaseAdmin as any)
      .from(TABLE)
      .select("*")
      .eq("species_key", key)
      .maybeSingle();
    if (error) {
      // 迁移还没应用时会走这里（relation does not exist）——降级到「没有资料包」，
      // 整条链路照常跑完整生成，不影响用户。
      console.warn(`[Dossier] 查询失败（迁移可能未应用）：${error.message}`);
      return null;
    }
    return data ? rowToDossier(data) : null;
  } catch (e) {
    console.warn("[Dossier] load 异常:", e);
    return null;
  }
}

/** 记一次命中。纯统计，失败无所谓 —— 不 await 也行。 */
export async function bumpDossierHit(id: string, current: number): Promise<void> {
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await (supabaseAdmin as any)
      .from(TABLE)
      .update({ hit_count: current + 1 })
      .eq("id", id);
  } catch (e) {
    console.warn("[Dossier] hit_count 累加失败（不影响出稿）:", e);
  }
}

export type DossierUpsertInput = {
  scientificName: string;
  title?: string | null;
  commonNameEn?: string | null;
  commonNamesZh?: string | null;
  family?: string | null;
  genus?: string | null;
  gbifTaxonKey?: number | null;
  body: Record<string, unknown>;
  facts?: unknown;
  research?: unknown;
  images?: string[];
  aiModel?: string | null;
  skillSignature?: string | null;
  sourceDraftId?: string | null;
  sourcePlantId?: string | null;
};

/**
 * 写入 / 更新资料包。遵守 curated 保护（见 shouldOverwriteDossier）。
 *
 * **整个过程对调用方非致命**：写库失败只记日志，用户的草稿已经生成好了，
 * 不能因为"缓存没存上"就让他白等一场。返回值告诉调用方发生了什么，仅供日志。
 */
export async function upsertDossier(
  input: DossierUpsertInput,
): Promise<{ ok: boolean; reason: string }> {
  const key = speciesKey(input.scientificName);
  if (!key) return { ok: false, reason: "学名为空，无法归一化物种键" };

  try {
    const existing = await loadDossier(input.scientificName);
    const decision = shouldOverwriteDossier(existing, input.body);
    if (!decision.write) {
      console.log(`[Dossier] 跳过写入「${key}」：${decision.reason}`);
      return { ok: false, reason: decision.reason };
    }

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const row = {
      species_key: key,
      scientific_name: input.scientificName,
      title: input.title ?? null,
      common_name_en: input.commonNameEn ?? null,
      common_names_zh: input.commonNamesZh ?? null,
      family: input.family ?? null,
      genus: input.genus ?? null,
      gbif_taxon_key: input.gbifTaxonKey ?? null,
      status: "unverified" as const,
      body: input.body,
      facts: input.facts ?? null,
      research: input.research ?? null,
      images: input.images ?? [],
      ai_model: input.aiModel ?? null,
      skill_signature: input.skillSignature ?? null,
      source_draft_id: input.sourceDraftId ?? null,
      source_plant_id: input.sourcePlantId ?? null,
      generated_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    const { error } = await (supabaseAdmin as any)
      .from(TABLE)
      .upsert(row, { onConflict: "species_key" });
    if (error) {
      console.warn(`[Dossier] 写入失败（迁移可能未应用）：${error.message}`);
      return { ok: false, reason: error.message };
    }
    console.log(`[Dossier] 已${existing ? "更新" : "建立"}资料包「${key}」（${decision.reason}）`);
    return { ok: true, reason: decision.reason };
  } catch (e) {
    console.warn("[Dossier] upsert 异常:", e);
    return { ok: false, reason: e instanceof Error ? e.message : String(e) };
  }
}
