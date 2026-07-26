import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import {
  buildLookup,
  canonicalKey,
  resolveName,
  type ChecklistEntry,
  type NameInput,
  type NameVerdict,
} from "./name-authority";

// ─── 正名核对的服务端入口 ────────────────────────────────────────────────────
//
// 纯逻辑全在 `name-authority.ts`（有 25 条断言的离线测试）；这里只负责
// **把候选行从 species_names 捞出来**，再交给那个纯函数判。
//
// 为什么不把 47,927 条全塞进 Worker bundle：一次识别只需要一个属（平均 ~10 条）
// 加上同名的几行。捞候选是一次带索引的查询，比在每个 isolate 里驻留几 MB 划算得多。

/**
 * 一次查询捞齐**四条匹配路径**需要的全部候选行：
 *   ① 学名精确（name_key 相等）
 *   ② 双名 + 种下等级（同属即可覆盖）
 *   ③ 拉丁词尾性数折叠（同属即可覆盖）
 *   ④ 中文名反查
 * 所以 or 条件是「同属 OR 同中文名 OR 同 name_key」—— 一个来回，不是四个。
 */
const COLS =
  "name_code,name_key,accepted_code,accepted_key,is_accepted,status,scientific_name,author," +
  "chinese_name,genus_la,genus_zh,family_la,family_zh,order_zh,class_zh,phylum_zh,rank," +
  "common_names,distribution_zh";

async function fetchCandidates(input: NameInput): Promise<ChecklistEntry[]> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const key = canonicalKey(input.scientificName ?? "");
  const genus = key.split(" ").filter((t) => t !== "×")[0] ?? "";
  const title = (input.title ?? "").trim();

  const ors: string[] = [];
  if (key) ors.push(`name_key.eq.${key}`);
  // genus_la 是原样大小写；canonicalKey 出来是小写 → 用 ilike 走索引外的大小写不敏感匹配。
  if (genus) ors.push(`genus_la.ilike.${genus}`);
  if (title) ors.push(`chinese_name.eq.${title}`);
  if (!ors.length) return [];

  const { data, error } = await (supabaseAdmin as any)
    .from("species_names")
    .select(COLS)
    .or(ors.join(","))
    // 一个属最多几百条；给个上限免得某个巨属把内存吃掉。
    // 2026 版含异名，同属行数约是只有正名时的 2.5 倍 → 上限从 600 提到 1500。
    .limit(1500);
  if (error) {
    console.warn("[NameAuthority] 候选查询失败：", error.message);
    return [];
  }
  const rows = (data ?? []) as ChecklistEntry[];
  if (!rows.length) return rows;

  // 命中的可能是**异名**，而它的正名不一定在上面那批里 —— 异名与正名常常不同属
  // （属被拆并正是产生异名的主要原因），按属捞根本捞不到。把缺的正名单独补一次，
  // 否则 collapseCandidates 顺着 accepted_key 找不到人，只能退回「标注不改名」，
  // 白白浪费这份异名索引。
  const have = new Set(rows.map((r) => r.name_key));
  const missing = [
    ...new Set(
      rows
        .filter((r) => !r.is_accepted && r.accepted_key && !have.has(r.accepted_key))
        .map((r) => r.accepted_key as string),
    ),
  ].slice(0, 50);
  if (missing.length) {
    const { data: extra } = await (supabaseAdmin as any)
      .from("species_names")
      .select(COLS)
      .in("name_key", missing)
      .eq("is_accepted", true)
      .limit(200);
    if (extra?.length) rows.push(...(extra as ChecklistEntry[]));
  }
  return rows;
}

/**
 * 核对一条内容的名字。**任何失败都退回「原样不动」** —— 名录表还没导入、
 * 查询超时、RLS 变了……都不该让一次识别或一份草稿因此失败。
 */
export async function checkName(input: NameInput): Promise<NameVerdict> {
  try {
    const candidates = await fetchCandidates(input);
    if (!candidates.length) {
      return resolveName(input, buildLookup([]));
    }
    return resolveName(input, buildLookup(candidates));
  } catch (e) {
    console.warn("[NameAuthority] 核对失败，按未核对处理：", e);
    return {
      status: "unmatched",
      acceptedZh: (input.title ?? "").trim() || null,
      acceptedLa: (input.scientificName ?? "").trim() || null,
      familyLa: null,
      familyZh: null,
      genusLa: null,
      genusZh: null,
      aliases: [],
      matchedBy: "none",
      note: "正名核对服务暂时不可用，本条未与名录核对。",
    };
  }
}

/** 一份内容里与名字有关的字段。识别草稿的 AiMeta、金叶的 VerifiedFacts、
 *  编辑提交的表单都能塞进这个形状。 */
export type NamedFields = {
  title?: string | null;
  scientific_name?: string | null;
  family?: string | null;
  genus?: string | null;
  common_names_zh?: string | null;
};

/** 写进内容里的核对留痕。存 `ai_payload._name_authority`，供页面渲染别名与「待核对」提示。 */
export type NameAuthorityStamp = {
  status: NameVerdict["status"];
  matchedBy: NameVerdict["matchedBy"];
  aliases: NameVerdict["aliases"];
  note: string;
  /** 被改掉的原值，出问题时能回溯。 */
  was: { title: string | null; scientific_name: string | null; family: string | null };
  source: "COL-China-2026";
  at: string;
};

/**
 * **把一份内容的名字对齐到名录正名**。AI 识别 / 银叶草稿 / 金叶详页 / 编辑提交四条链路共用。
 *
 * 原地改 `fields`，并回传一份留痕。改写规则严格照 `resolveName` 的判定：
 *  · `accepted` / `renamed` → 采用名录的中文正名、学名、科属；原名进 aliases。
 *  · `ambiguous` / `unmatched` → **一个字都不改**，只留痕 + 提示人工核对。
 *
 * 别名同时并入 `common_names_zh`，这样站内搜「圆果水麦冬」仍然搜得到「海韭菜」那一条 ——
 * 换正名不能让老名字变成搜不到的死名。
 */
export async function applyNameAuthority(
  fields: NamedFields,
): Promise<{ verdict: NameVerdict; stamp: NameAuthorityStamp; changed: boolean }> {
  const verdict = await checkName({
    title: fields.title,
    scientificName: fields.scientific_name,
    family: fields.family,
    genus: fields.genus,
    commonNamesZh: fields.common_names_zh,
  });

  const was = {
    title: fields.title ?? null,
    scientific_name: fields.scientific_name ?? null,
    family: fields.family ?? null,
  };

  let changed = false;
  if (verdict.status === "accepted" || verdict.status === "renamed") {
    if (verdict.acceptedZh && fields.title !== verdict.acceptedZh) {
      fields.title = verdict.acceptedZh;
      changed = true;
    }
    if (verdict.acceptedLa && fields.scientific_name !== verdict.acceptedLa) {
      fields.scientific_name = verdict.acceptedLa;
      changed = true;
    }
    const fam = verdict.familyZh && verdict.familyLa ? `${verdict.familyZh} ${verdict.familyLa}` : null;
    if (fam && fields.family !== fam) {
      fields.family = fam;
      changed = true;
    }
    const gen = verdict.genusZh && verdict.genusLa ? `${verdict.genusZh} ${verdict.genusLa}` : null;
    if (gen && fields.genus !== gen) {
      fields.genus = gen;
      changed = true;
    }
    // 别名并入俗名，保住可搜索性
    if (verdict.aliases.length) {
      const existing = (fields.common_names_zh ?? "")
        .split(/[,，、;；]/)
        .map((s) => s.trim())
        .filter(Boolean);
      const merged = [...existing];
      for (const a of verdict.aliases) if (!merged.includes(a.name)) merged.push(a.name);
      const joined = merged.join(", ");
      if (joined !== (fields.common_names_zh ?? "")) {
        fields.common_names_zh = joined;
        changed = true;
      }
    }
  }

  return {
    verdict,
    stamp: {
      status: verdict.status,
      matchedBy: verdict.matchedBy,
      aliases: verdict.aliases,
      note: verdict.note,
      was,
      source: "COL-China-2026",
      at: new Date().toISOString(),
    },
    changed,
  };
}

const CheckInput = z.object({
  title: z.string().max(200).nullable().optional(),
  scientificName: z.string().max(300).nullable().optional(),
  family: z.string().max(200).nullable().optional(),
  genus: z.string().max(200).nullable().optional(),
  commonNamesZh: z.string().max(2000).nullable().optional(),
});

/** 供编辑器「核对正名」按钮调用。 */
export const checkNameFn = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => CheckInput.parse(input))
  .handler(async ({ data }): Promise<NameVerdict> => checkName(data));

// ─── 已收录档案检索：名录搜索 ────────────────────────────────────────────────

const SearchInput = z.object({
  q: z.string().trim().max(120),
  limit: z.number().int().min(1).max(100).optional(),
});

export type ChecklistHit = ChecklistEntry & { in_site: boolean };

/**
 * 在名录里搜物种。中文名 / 学名 / 科名 / 属名都能搜（trigram 索引）。
 *
 * `in_site` = 本站是否已有该物种的成品页 —— 检索结果里要能一眼看出
 * 「名录有、本站还没做」的空白，那正是这份名录进检索页的意义。
 */
export const searchChecklistFn = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => SearchInput.parse(input))
  .handler(async ({ data }): Promise<ChecklistHit[]> => {
    const q = data.q.trim();
    if (!q) return [];
    try {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const like = `%${q.replace(/[%_,()]/g, " ")}%`;
      const { data: rows, error } = await (supabaseAdmin as any)
        .from("species_names")
        .select(COLS)
        .or(
          [
            `chinese_name.ilike.${like}`,
            `scientific_name.ilike.${like}`,
            `family_zh.ilike.${like}`,
            `genus_zh.ilike.${like}`,
          ].join(","),
        )
        .limit(data.limit ?? 50);
      if (error) throw new Error(error.message);
      let hits = (rows ?? []) as ChecklistEntry[];
      if (!hits.length) return [];

      // 搜到的可能是**异名**（用户拿旧书上的名字来搜，正是最该被接住的情形）。
      // 把异名换成它的正名再去重 —— 检索结果里应该只出现正名，否则同一个物种会
      // 以三四个历史名字重复列出来。
      const synKeys = [
        ...new Set(
          hits.filter((h) => !h.is_accepted && h.accepted_key).map((h) => h.accepted_key as string),
        ),
      ].slice(0, 100);
      if (synKeys.length) {
        const { data: acc } = await (supabaseAdmin as any)
          .from("species_names")
          .select(COLS)
          .in("name_key", synKeys)
          .eq("is_accepted", true)
          .limit(200);
        const byKey = new Map(
          ((acc ?? []) as ChecklistEntry[]).map((a) => [a.name_key, a]),
        );
        hits = hits.map((h) =>
          !h.is_accepted && h.accepted_key ? (byKey.get(h.accepted_key) ?? h) : h,
        );
      }
      const seen = new Set<string>();
      hits = hits.filter((h) => {
        const k = h.name_code ?? h.name_key;
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      });

      // 哪些已经有成品页：一次 in 查询，不逐条打。
      const keys = hits.map((h) => h.name_key);
      const { data: mine } = await (supabaseAdmin as any)
        .from("plants")
        .select("scientific_name")
        .not("scientific_name", "is", null)
        .limit(5000);
      const have = new Set(
        ((mine ?? []) as { scientific_name: string | null }[])
          .map((p) => canonicalKey(p.scientific_name))
          .filter(Boolean),
      );
      return hits.map((h, i) => ({ ...h, in_site: have.has(keys[i]) }));
    } catch (e) {
      console.warn("[NameAuthority] 名录搜索失败：", e);
      return [];
    }
  });
