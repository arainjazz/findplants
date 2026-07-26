/**
 * Conservation / trade-control / invasion registries used across 档案检索, 上传自动填写,
 * AI 识别草稿 and 身边物种地图.
 *
 * Data model decision (confirmed with user 2026-07-03): ALL seven registries are stored
 * in LOCAL tables (conservation_lists + conservation_taxa) and matched by normalized
 * scientific name — NOT live-queried. This module holds the shared option sets + labels
 * so every surface renders the exact same dropdowns.
 *
 * The seven registries:
 *   1. 国家和各省重点保护目录  (国家2021 + 省级名录; region-catalog backed — see regional_catalogs)
 *   2. IUCN 最新评估名单        (IUCN_CATEGORIES in catalogs.ts)
 *   3. 华盛顿贸易管制 CITES      (this file — CITES_APPENDICES)
 *   4. GTS 全球树木红色名录      (this file — GTS_CATEGORIES)
 *   5. GRIIS 全球外来与入侵物种  (this file — GRIIS_DEGREES)
 */

import { supabase } from "@/integrations/supabase/client";
import { normalizeSciName } from "@/lib/catalogs";

/** Option shape shared with <FilterDropdown/>. */
export type RegistryOption = { value: string; label: string };

export type ConservationList = {
  id: string;
  kind: string; // protected | cites | gts | griis
  name: string;
  province: string | null;
  source_note: string | null;
  source_url: string | null;
  /** 添加这份名录的编辑；播种的 11 份名录为 null（无添加人 → 只有 admin 能删）。 */
  created_by: string | null;
};

export type ConservationTaxon = {
  list_id: string;
  scientific_name: string;
  chinese_name: string | null;
  normalized_name: string;
  status: string;
  rank: string; // species | genus | family | section
  excluded_names: string[] | null;
};

export type ConservationData = { lists: ConservationList[]; taxa: ConservationTaxon[] };

/**
 * Load the conservation registries. Empty-safe: returns empty arrays until the tables
 * are seeded (or if the migration hasn't been applied and the query errors, callers
 * using react-query just get no data).
 */
export async function fetchConservationData(): Promise<ConservationData> {
  const listsRes = await supabase
    .from("conservation_lists")
    .select("id,kind,name,province,source_note,source_url,created_by");
  if (listsRes.error) throw listsRes.error;
  // conservation_taxa exceeds PostgREST's default 1000-row cap (2000+ rows across
  // national/provincial/CITES/GTS/GRIIS). Page through ALL rows — otherwise the
  // later-seeded registries (GRIIS/GTS) fall past row 1000 and never match, so the
  // map never flags invasives and the /plants GRIIS·GTS filters return nothing.
  const PAGE = 1000;
  const taxa: ConservationTaxon[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from("conservation_taxa")
      .select("list_id,scientific_name,chinese_name,normalized_name,status,rank,excluded_names")
      .range(from, from + PAGE - 1);
    if (error) throw error;
    const rows = (data ?? []) as ConservationTaxon[];
    taxa.push(...rows);
    if (rows.length < PAGE) break;
  }
  return { lists: listsRes.data ?? [], taxa };
}

/** What a single plant matched, across all registries. */
export type ConservationHit = {
  protectedLists: Map<string, string>; // conservation_lists.id -> 一级/二级
  cites?: string;
  gts?: string;
  griis?: string;
};

/**
 * Build a rank-aware matcher over the registries. A plant matches a taxon by:
 *  - species: normalized "genus species" equality
 *  - genus:   genus token equality, unless the plant is in the group's excluded_names
 *  - family:  Latin family token equality (only when the plant carries a Latin family),
 *             minus excluded_names
 */
export function buildConservationMatcher(data: ConservationData) {
  const kindByList = new Map(data.lists.map((l) => [l.id, l.kind]));
  const speciesIdx = new Map<string, ConservationTaxon[]>();
  const genusIdx = new Map<string, ConservationTaxon[]>();
  const familyIdx = new Map<string, ConservationTaxon[]>();
  const push = (m: Map<string, ConservationTaxon[]>, k: string, t: ConservationTaxon) => {
    const a = m.get(k);
    if (a) a.push(t);
    else m.set(k, [t]);
  };
  for (const t of data.taxa) {
    if (t.rank === "genus") push(genusIdx, t.normalized_name, t);
    else if (t.rank === "family") push(familyIdx, t.normalized_name, t);
    else if (t.rank === "species") push(speciesIdx, t.normalized_name, t);
    // 'section' groups are intentionally not indexed — see parser note (avoids
    // false-flagging common ornamentals whose genus contains a protected section).
  }

  const apply = (hit: ConservationHit, t: ConservationTaxon) => {
    const kind = kindByList.get(t.list_id);
    if (kind === "protected") hit.protectedLists.set(t.list_id, t.status);
    else if (kind === "cites") hit.cites = t.status;
    else if (kind === "gts") hit.gts = t.status;
    else if (kind === "griis") hit.griis = t.status;
  };

  return (
    scientificName: string | null | undefined,
    familyLatin?: string | null,
  ): ConservationHit => {
    const hit: ConservationHit = { protectedLists: new Map() };
    const norm = normalizeSciName(scientificName);
    if (!norm) return hit;
    const genus = norm.split(" ")[0];
    for (const t of speciesIdx.get(norm) ?? []) apply(hit, t);
    for (const t of genusIdx.get(genus) ?? []) {
      if (t.excluded_names?.includes(norm)) continue;
      apply(hit, t);
    }
    if (familyLatin) {
      const fam = normalizeSciName(familyLatin).split(" ")[0];
      if (fam)
        for (const t of familyIdx.get(fam) ?? []) {
          if (t.excluded_names?.includes(norm)) continue;
          apply(hit, t);
        }
    }
    return hit;
  };
}

/**
 * CITES appendices — 华盛顿贸易管制. Only Ⅰ/Ⅱ per spec (Ⅲ omitted).
 * `value` matches the CITES checklist appendix codes ("I" / "II").
 */
export const CITES_APPENDICES: RegistryOption[] = [
  { value: "I", label: "CITES 附录I" },
  { value: "II", label: "CITES 附录II" },
  { value: "III", label: "CITES 附录III" },
];

/**
 * GlobalTree Portal / GlobalTreeSearch (全球树木红色名录) threatened categories.
 * Uses the IUCN threat codes BGCI applies to trees.
 */
export const GTS_CATEGORIES: RegistryOption[] = [
  { value: "CR", label: "CR 极危" },
  { value: "EN", label: "EN 濒危" },
  { value: "VU", label: "VU 易危" },
];

/**
 * GRIIS invasion degree. `value` matches Darwin Core `degreeOfEstablishment`
 * literals (casual / established / invasive / widespreadInvasive) so live GBIF/GRIIS
 * records can map straight in when the data increment lands.
 */
export const GRIIS_DEGREES: RegistryOption[] = [
  { value: "casual", label: "Casual 偶现·未建群" },
  { value: "established", label: "Established 无明确生态危害证据" },
  { value: "invasive", label: "Invasive 入侵物种" },
  { value: "widespreadInvasive", label: "Widespread Invasive 高危入侵物种" },
];

/**
 * Canonical display order for the 国家和各省重点保护目录 dropdown (国家 first, then
 * provinces). The dropdown itself is data-driven from `regional_catalogs`; this list
 * only fixes ordering + the expected label set once those catalogs exist.
 */
export const PROTECTED_LIST_ORDER: string[] = [
  "国家",
  "内蒙古",
  "海南",
  "广东",
  "福建",
  "云南",
  "贵州",
  "四川",
];

/** Sort key for a protected-list region label (国家 first, known provinces next, rest after). */
export function protectedListRank(label: string): number {
  for (let i = 0; i < PROTECTED_LIST_ORDER.length; i++) {
    if (label.startsWith(PROTECTED_LIST_ORDER[i])) return i;
  }
  return PROTECTED_LIST_ORDER.length;
}

/** A single display badge for the draft/detail conservation card. */
export type ConservationBadge = { kind: string; label: string };

/**
 * Turn a raw {@link ConservationHit} into display-ready badges (list name + human
 * status labels), reusing the same option label sets the filter dropdowns show.
 * Shared by the draft HTML template (增量③) and any other surface that wants to
 * render a plant's registry status. Empty array when the plant matched nothing.
 * NOTE: GRIIS (全球入侵) is EXCLUDED — it has its own standalone card, not part of
 * the green "保护与名录收录" card. Only protected/CITES/GTS appear here.
 */
export function conservationBadges(
  hit: ConservationHit,
  lists: ConservationList[],
): ConservationBadge[] {
  const nameById = new Map(lists.map((l) => [l.id, l.name]));
  const badges: ConservationBadge[] = [];
  for (const [listId, status] of hit.protectedLists) {
    const nm = nameById.get(listId) ?? "重点保护名录";
    badges.push({ kind: "protected", label: status ? `${nm} · ${status}` : nm });
  }
  if (hit.cites) {
    const o = CITES_APPENDICES.find((x) => x.value === hit.cites);
    badges.push({ kind: "cites", label: o?.label ?? `CITES 附录${hit.cites}` });
  }
  if (hit.gts) {
    const o = GTS_CATEGORIES.find((x) => x.value === hit.gts);
    badges.push({ kind: "gts", label: `GTS 全球树木红色名录 · ${o?.label ?? hit.gts}` });
  }
  // GRIIS intentionally omitted — it renders in a separate invasive-species warning card
  return badges;
}

// ── Registry chips (统一卡签) ─────────────────────────────────────────────────
// Every surface that shows a plant (简介摘要卡 / 草稿页 / 分享卡 / 详情页) renders the
// SAME set of chips, one per registry hit, so a species reads identically everywhere.
//
// Deliberately separate from conservationBadges() above: that one feeds the green
// 「保护与名录收录」card and must keep excluding GRIIS (which owns a standalone warning
// card). These chips are the at-a-glance row and DO include GRIIS.

export type RegistryChipKind =
  // 重点保护名录按级别分两色（用户指定）：国家名录=粉，省级/地区名录=黄。
  // 拆成两个 kind 而不是靠 label 前缀判色 —— 渲染端（网页/分享卡/服务端卡）只认 kind。
  | "protected_national"
  | "protected_regional"
  | "cites"
  | "gts"
  | "griis"
  | "catalog"
  | "tag"
  /**
   * **人手动挂上的主题标签**（名字命中 `tags` 表的那些）。与 "tag" 分开是因为二者的
   * 来源和分量完全不同：
   *  - `tag`  = `plants.tags` / `plant_drafts.tags` 里的**特征词**，AI 自动填的，
   *             只进搜索和这排卡签，不建专题；
   *  - `tag_manual` = 有人在「手动添加 #tag 标签」里挑中的、`tags` 表里真实存在的主题标签，
   *             它决定这条会出现在哪个专题页 —— 是一次**人的判断**，所以排在最前、绿框加重。
   */
  | "tag_manual";

export type RegistryChip = {
  kind: RegistryChipKind;
  /** Short chip text, e.g.「国家二级保护」「CITES 附录II」「入侵物种」. */
  label: string;
  /** Longer text for tooltips / the detail page. */
  title?: string;
  /**
   * 专题页 slug（只有 `tag_manual` 有）。**必须由调用方从 `tags` 表带过来，不能用
   * slugifyTag(label) 现算** —— slug 是建标签那一刻算出来存进库的，规则日后一改，
   * 现算的结果就和库里对不上，链接全部 404。有真值才渲染成链接。
   */
  slug?: string;
  /** 绿色系第几号（只有 `tag_manual` 有）。见 {@link manualTagTone}。 */
  tone?: number;
};

/**
 * 手动主题标签的**绿色系**色板格数。手动标签一律是绿（区别于名录那几色），但不同标签取
 * 不同的绿，这样「圣水草原的植被」和「城市行道树」并排时一眼看得出是两个专题。
 *
 * 取模式的哈希意味着标签多了会撞色 —— 这里可以接受：绿号只用来做视觉区分，不承载任何
 * 语义（真正的身份是 slug 和文字）。反过来，哈希保证同一个标签名在**网页卡签、分享卡、
 * 服务端简介卡**三处永远同色，不需要任何一处去查库或对表。
 */
export const MANUAL_TAG_TONES = 4;

/** 标签名 → 绿号（0..MANUAL_TAG_TONES-1）。纯函数、跨端一致（djb2 变体，够散且短）。 */
export function manualTagTone(name: string): number {
  let h = 5381;
  for (let i = 0; i < name.length; i++) h = ((h * 33) ^ name.charCodeAt(i)) >>> 0;
  return h % MANUAL_TAG_TONES;
}

/** GRIIS degree → short chip label. Only the two harmful degrees read as a warning. */
function griisChipLabel(degree: string): string {
  const o = GRIIS_DEGREES.find((x) => x.value === degree);
  switch (degree) {
    case "widespreadInvasive":
      return "高危入侵";
    case "invasive":
      return "入侵物种";
    case "established":
      return "外来·已建群";
    case "casual":
      return "外来·偶现";
    default:
      return o?.label ?? degree;
  }
}

/**
 * Build the chip row for one plant. `catalogNames` / `tags` are passed in because they
 * come from different tables (regional_catalogs / plant_tags) than the conservation
 * registries. Returns [] when the plant matched nothing — callers render no row at all.
 */
export function registryChips(
  hit: ConservationHit,
  lists: ConservationList[],
  extra?: {
    catalogNames?: string[];
    tags?: string[];
    /**
     * `tags` 表里已建主题标签的 **名字 → slug** 映射。传了才分得出「人手动挂的主题标签」
     * 和「AI 自动填的特征词」—— 两者都躺在同一个 `tags` text[] 里，光看数组区分不了。
     * 不传（服务端出卡等拿不到该表的场合）则全部按特征词处理，行为与改动前一致。
     */
    knownTags?: Map<string, string>;
  },
): RegistryChip[] {
  const listById = new Map(lists.map((l) => [l.id, l]));
  const chips: RegistryChip[] = [];

  // 人手动挂的主题标签**排在最前面**（在保护名录、CITES 之前）。
  // 理由：这排卡签里其余各项都是「按学名自动匹配名录」的机器判断，只有它是一次
  // 明确的人的判断 —— 有人特意把这条归到了这个专题下。既然人特意做了，就该第一眼看到。
  const manualTags: { name: string; slug: string }[] = [];
  const autoTags: string[] = [];
  for (const t of extra?.tags ?? []) {
    if (!t) continue;
    const slug = extra?.knownTags?.get(t);
    if (slug) manualTags.push({ name: t, slug });
    else autoTags.push(t);
  }
  for (const t of manualTags) {
    chips.push({
      kind: "tag_manual",
      label: t.name,
      slug: t.slug,
      tone: manualTagTone(t.name),
      title: `主题标签（手动添加）：${t.name} —— 这条会出现在该标签的专题页`,
    });
  }

  for (const [listId, status] of hit.protectedLists) {
    const l = listById.get(listId);
    const nm = l?.name ?? "重点保护名录";
    // Real data shape: name =「国家（2021）」/「内蒙古（2009）」, province =「国家」/「内蒙古」,
    // status =「一级」/「二级」 → chip reads 「国家二级保护」/「内蒙古二级保护」.
    const short = [l?.province ?? "", status, "保护"].filter(Boolean).join("");
    // 国家名录（province=「国家」）走粉，省级/地区名录走黄。province 为空时按地区处理
    // —— 国家名录一定带「国家」，缺省更可能是某份地方名录漏填省份。
    chips.push({
      kind: l?.province === "国家" ? "protected_national" : "protected_regional",
      label: short || nm,
      title: `重点保护野生植物名录 ${nm}${status ? " · " + status : ""}`,
    });
  }
  if (hit.cites) {
    const o = CITES_APPENDICES.find((x) => x.value === hit.cites);
    chips.push({
      kind: "cites",
      label: o?.label ?? `CITES 附录${hit.cites}`,
      title: `华盛顿公约 CITES 贸易管制 · 附录${hit.cites}`,
    });
  }
  if (hit.gts) {
    const o = GTS_CATEGORIES.find((x) => x.value === hit.gts);
    chips.push({
      kind: "gts",
      label: `GTS ${o?.label ?? hit.gts}`,
      title: `GTS 全球树木红色名录 · ${o?.label ?? hit.gts}`,
    });
  }
  if (hit.griis) {
    chips.push({
      kind: "griis",
      label: griisChipLabel(hit.griis),
      title: `GRIIS 全球外来与入侵物种名录 · ${GRIIS_DEGREES.find((x) => x.value === hit.griis)?.label ?? hit.griis}`,
    });
  }
  for (const c of extra?.catalogNames ?? []) {
    chips.push({ kind: "catalog", label: c, title: `已收录于地区植物名录：${c}` });
  }
  for (const t of autoTags) {
    chips.push({ kind: "tag", label: t, title: `特征词（自动识别）：${t}` });
  }
  return chips;
}
