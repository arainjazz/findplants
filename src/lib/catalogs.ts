import { supabase } from "@/integrations/supabase/client";
import type { Plant } from "@/lib/plants";

export const IUCN_CATEGORIES: { code: string; zh: string }[] = [
  { code: "NE", zh: "未评估" },
  { code: "EW", zh: "野外灭绝" },
  { code: "CR", zh: "极危" },
  { code: "EN", zh: "濒危" },
  { code: "VU", zh: "易危" },
  { code: "NT", zh: "近危" },
  { code: "LC", zh: "无危" },
  { code: "DD", zh: "数据缺乏" },
];

export type RegionalCatalog = {
  id: string;
  province: string;
  city: string | null;
  county: string | null;
  source: string;
  contributor_name: string;
  created_by: string;
  created_at: string;
  updated_at: string;
};

export type CatalogEntry = {
  id: string;
  catalog_id: string;
  scientific_name: string;
  chinese_name: string | null;
  added_by: string;
  added_by_name: string | null;
  created_at: string;
};

export type CatalogSuggestion = {
  id: string;
  catalog_id: string;
  target_entry_id: string | null;
  target_name: string;
  suggestion_type: "delete" | "rename" | "other";
  proposed_name: string | null;
  reason: string | null;
  source_type: "book" | "url" | "other" | null;
  source_book_title: string | null;
  source_book_pages: string | null;
  source_url: string | null;
  status: "open" | "accepted" | "rejected";
  suggested_by: string;
  suggested_by_name: string | null;
  created_at: string;
};

/**
 * Normalize a scientific name for fuzzy matching.
 * Strips authority (trailing " L.", " (Author) Author", years), keeps first 2 tokens
 * (genus + species). Lower-cased, whitespace-collapsed.
 */
export function normalizeSciName(s: string | null | undefined): string {
  if (!s) return "";
  let v = s
    .normalize("NFKD") // fold diacritics: Isoëtes -> Isoetes, Houpoëa -> Houpoea
    .replace(/[̀-ͯ]/g, "")
    .replace(/\([^)]*\)/g, " ") // remove parenthesised authorities
    .replace(/[×]/g, "x")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
  const tokens = v.split(" ").filter(Boolean);
  // keep first 2 tokens (genus + species epithet) when present
  if (tokens.length >= 2) v = `${tokens[0]} ${tokens[1]}`;
  return v;
}

/**
 * Build a matcher that resolves a catalog entry to a plant by:
 *  1) normalized scientific name (genus + species)
 *  2) Chinese name (plant.title or plant.scientific_name fragments)
 */
export function buildPlantMatcher(plants: Plant[]) {
  const bySci = new Map<string, Plant>();
  for (const p of plants) {
    const key = normalizeSciName(p.scientific_name);
    if (key) bySci.set(key, p);
  }
  // Match strictly by Latin scientific name (genus + species). Chinese names are ignored.
  return (entry: { scientific_name: string; chinese_name: string | null }): Plant | null => {
    const sciKey = normalizeSciName(entry.scientific_name);
    if (sciKey && bySci.has(sciKey)) return bySci.get(sciKey)!;
    return null;
  };
}

export async function fetchAllCatalogs() {
  const { data, error } = await supabase
    .from("regional_catalogs")
    .select("*")
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as RegionalCatalog[];
}

export async function fetchCatalog(id: string) {
  const { data, error } = await supabase
    .from("regional_catalogs")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  return data as RegionalCatalog | null;
}

export async function fetchEntries(catalogId: string) {
  const { data, error } = await supabase
    .from("catalog_entries")
    .select("*")
    .eq("catalog_id", catalogId)
    .order("scientific_name");
  if (error) throw error;
  return (data ?? []) as CatalogEntry[];
}

export async function fetchAllEntries() {
  const { data, error } = await supabase
    .from("catalog_entries")
    .select("*");
  if (error) throw error;
  return (data ?? []) as CatalogEntry[];
}

export async function fetchSuggestionsForCatalogs(catalogIds: string[]) {
  if (catalogIds.length === 0) return [] as CatalogSuggestion[];
  const { data, error } = await supabase
    .from("catalog_suggestions")
    .select("*")
    .in("catalog_id", catalogIds)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as CatalogSuggestion[];
}

export async function createSuggestion(input: Omit<CatalogSuggestion, "id" | "created_at" | "status">) {
  const { error } = await supabase.from("catalog_suggestions").insert({ ...input, status: "open" });
  if (error) throw error;
}

export async function deleteSuggestion(id: string) {
  const { error } = await supabase.from("catalog_suggestions").delete().eq("id", id);
  if (error) throw error;
}

export function regionLabel(c: Pick<RegionalCatalog, "province" | "city" | "county">) {
  return [c.province, c.city, c.county].filter(Boolean).join("");
}

/**
 * Parse pasted catalog text. Each non-empty line is one entry.
 * Accepts forms:
 *   "Butomus umbellatus L." (scientific only)
 *   "花蔺 Butomus umbellatus"
 *   "Butomus umbellatus 花蔺"
 *   "花蔺,Butomus umbellatus"
 */
export function parseCatalogText(raw: string): { scientific_name: string; chinese_name: string | null }[] {
  const lines = raw
    .split(/[\r\n]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  const out: { scientific_name: string; chinese_name: string | null }[] = [];
  for (const line of lines) {
    // Split each line into Chinese segment (CJK run) and Latin segment
    // (everything else, including authority like "L." / "Pall." / "(Author) ...").
    const chineseParts = line.match(/[\u4e00-\u9fff·•]+/g) ?? [];
    const chinese = chineseParts.length ? chineseParts.join("").trim() : null;
    // Remove Chinese chars + common separators to leave the full Latin name.
    const sci = line
      .replace(/[\u4e00-\u9fff]+/g, " ")
      .replace(/[,，;；|]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    if (!sci) {
      // No Latin part — keep raw so validation can flag it.
      out.push({ scientific_name: line, chinese_name: null });
      continue;
    }
    out.push({ scientific_name: sci, chinese_name: chinese });
  }
  return out;
}

export type CreateCatalogInput = {
  province: string;
  city?: string | null;
  county?: string | null;
  source: string;
  contributor_name: string;
  entries: { scientific_name: string; chinese_name: string | null }[];
};

export async function createCatalog(
  input: CreateCatalogInput,
  userId: string,
  userName: string,
  editSource: string = "catalog_editor",
) {
  // Deduplicate input by normalized Latin name — first occurrence wins.
  const seen = new Set<string>();
  const dedupedEntries = input.entries.filter((e) => {
    const k = normalizeSciName(e.scientific_name);
    if (!k) return true; // keep oddballs without a parseable Latin name
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });

  const { data: cat, error } = await supabase
    .from("regional_catalogs")
    .insert({
      province: input.province,
      city: input.city ?? null,
      county: input.county ?? null,
      source: input.source,
      contributor_name: input.contributor_name,
      created_by: userId,
    })
    .select()
    .single();
  if (error) throw error;

  let insertedIds: string[] = [];
  if (dedupedEntries.length > 0) {
    const rows = dedupedEntries.map((e) => ({
      catalog_id: cat.id,
      scientific_name: e.scientific_name,
      chinese_name: e.chinese_name,
      added_by: userId,
      added_by_name: userName,
    }));
    const { data: inserted, error: eErr } = await supabase
      .from("catalog_entries")
      .insert(rows)
      .select("id");
    if (eErr) throw eErr;
    insertedIds = (inserted ?? []).map((r) => r.id as string);
  }

  // Audit row
  const regionStr = regionLabel(cat);
  await supabase.from("plant_edits").insert({
    plant_id: null,
    editor_id: userId,
    editor_name: userName,
    kind: "catalog_create",
    marker_n: 0,
    catalog_id: cat.id,
    entry_ids: insertedIds,
    source: editSource,
    summary: `${userName} 添加了「${regionStr}」的目录，共 ${dedupedEntries.length} 条${
      dedupedEntries.length < input.entries.length
        ? `（已自动合并 ${input.entries.length - dedupedEntries.length} 条重复学名）`
        : ""
    }`,
  });

  return cat as RegionalCatalog;
}

export async function appendEntries(
  catalogId: string,
  entries: { scientific_name: string; chinese_name: string | null }[],
  userId: string,
  userName: string,
  editSource: string = "catalog_editor",
) {
  if (entries.length === 0) return;

  // 1. Dedupe within the incoming batch by normalized Latin name.
  const seen = new Set<string>();
  const inputDeduped = entries.filter((e) => {
    const k = normalizeSciName(e.scientific_name);
    if (!k) return true;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });

  // 2. Drop entries whose Latin name already exists in this catalog.
  const existing = await fetchEntries(catalogId);
  const existingKeys = new Set(existing.map((e) => normalizeSciName(e.scientific_name)).filter(Boolean));
  const newEntries = inputDeduped.filter((e) => {
    const k = normalizeSciName(e.scientific_name);
    return !k || !existingKeys.has(k);
  });
  const mergedCount = entries.length - newEntries.length;

  if (newEntries.length === 0) {
    throw new Error("所有学名都已存在于该地区目录中，无需重复添加");
  }

  const rows = newEntries.map((e) => ({
    catalog_id: catalogId,
    scientific_name: e.scientific_name,
    chinese_name: e.chinese_name,
    added_by: userId,
    added_by_name: userName,
  }));
  const { data: inserted, error } = await supabase
    .from("catalog_entries")
    .insert(rows)
    .select("id");
  if (error) throw error;
  const insertedIds = (inserted ?? []).map((r) => r.id as string);

  const cat = await fetchCatalog(catalogId);
  const { count } = await supabase
    .from("catalog_entries")
    .select("id", { count: "exact", head: true })
    .eq("catalog_id", catalogId);
  const regionStr = cat ? regionLabel(cat) : "该地区";

  await supabase.from("plant_edits").insert({
    plant_id: null,
    editor_id: userId,
    editor_name: userName,
    kind: "catalog_append",
    marker_n: 0,
    catalog_id: catalogId,
    entry_ids: insertedIds,
    source: editSource,
    summary: `${userName} 在「${regionStr}」的目录下添加了 ${newEntries.length} 条新目录${
      mergedCount > 0 ? `（已自动合并 ${mergedCount} 条重复学名）` : ""
    }，该地区共计 ${count ?? "?"} 条目录`,
  });
}

/**
 * Admin revert for catalog edits.
 *  - catalog_create: delete the whole catalog (cascades entries + suggestions).
 *  - catalog_append: delete the entries this edit inserted (entry_ids).
 * Inserts a "revert" audit row and marks the source edit as reverted.
 */
export async function revertCatalogEdit(args: {
  editId: string;
  kind: "catalog_create" | "catalog_append";
  catalog_id: string | null;
  entry_ids: string[] | null;
  adminId: string;
  adminName: string;
}) {
  const { editId, kind, catalog_id, entry_ids, adminId, adminName } = args;
  if (kind === "catalog_create") {
    if (!catalog_id) throw new Error("缺少目录 id，无法撤销");
    const { error } = await supabase.from("regional_catalogs").delete().eq("id", catalog_id);
    if (error) throw error;
  } else {
    const ids = entry_ids ?? [];
    if (ids.length === 0) throw new Error("该追加记录未保存条目 id，无法精确撤销");
    const { error } = await supabase.from("catalog_entries").delete().in("id", ids);
    if (error) throw error;
  }
  await supabase
    .from("plant_edits")
    .update({ reverted: true, reverted_by: adminId, reverted_at: new Date().toISOString() })
    .eq("id", editId);
  await supabase.from("plant_edits").insert({
    plant_id: null,
    editor_id: adminId,
    editor_name: adminName,
    kind: "revert",
    marker_n: 0,
    catalog_id,
    summary: `${adminName} 撤销了一条${kind === "catalog_create" ? "新目录" : "目录补充"}记录`,
  });
}

export async function deleteCatalogEntry(entryId: string) {
  const { error } = await supabase.from("catalog_entries").delete().eq("id", entryId);
  if (error) throw error;
}

export async function deleteCatalog(catalogId: string) {
  const { error } = await supabase.from("regional_catalogs").delete().eq("id", catalogId);
  if (error) throw error;
}