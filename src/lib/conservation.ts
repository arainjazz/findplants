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
  const [listsRes, taxaRes] = await Promise.all([
    supabase.from("conservation_lists").select("id,kind,name,province,source_note,source_url"),
    supabase
      .from("conservation_taxa")
      .select("list_id,scientific_name,chinese_name,normalized_name,status,rank,excluded_names"),
  ]);
  if (listsRes.error) throw listsRes.error;
  if (taxaRes.error) throw taxaRes.error;
  return { lists: listsRes.data ?? [], taxa: taxaRes.data ?? [] };
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

  return (scientificName: string | null | undefined, familyLatin?: string | null): ConservationHit => {
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
  if (hit.griis) {
    const o = GRIIS_DEGREES.find((x) => x.value === hit.griis);
    badges.push({ kind: "griis", label: `GRIIS 全球入侵等级 · ${o?.label ?? hit.griis}` });
  }
  return badges;
}
