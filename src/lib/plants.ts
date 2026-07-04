import { supabase } from "@/integrations/supabase/client";

export type Plant = {
  id: string;
  slug: string;
  title: string;
  scientific_name: string | null;
  common_name_en: string | null;
  common_names_zh: string | null;
  family: string | null;
  genus: string | null;
  iucn_status: string | null;
  habitat: string | null;
  summary: string | null;
  cover_url: string | null;
  content_type: "rich" | "html";
  source?: string | null;
  rich_content: string | null;
  html_url: string | null;
  tags: string[];
  author_id: string;
  is_featured: boolean;
  created_at: string;
  updated_at: string;
  comments_count: number;
  parent_id?: string | null;
  co_author_ids?: string[];
  co_author_names?: string[];
};

export type PlantWithAuthor = Plant & { author?: { display_name: string | null } };

export type EntrySource = "ai_identify" | "html_upload" | "gold_oneclick" | "manual";

/**
 * Distinguish the three (+manual) entry kinds for 管理页 / 个人主页.
 * Falls back gracefully before the `source` column is populated: an `html`
 * content_type still reads as an HTML 详页, everything else as 富文本.
 */
export function entryType(p: { source?: string | null; content_type?: string | null }): {
  key: EntrySource;
  label: string;
} {
  if (p.source === "gold_oneclick") return { key: "gold_oneclick", label: "金叶一键创建" };
  if (p.source === "html_upload" || p.content_type === "html") return { key: "html_upload", label: "HTML 详页" };
  if (p.source === "ai_identify") return { key: "ai_identify", label: "AI 识别简略" };
  return { key: "manual", label: "富文本" };
}

export function slugify(s: string) {
  return s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u4e00-\u9fff\u3000-\u303f\uff00-\uffef]/g, "")
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || `p-${Date.now().toString(36)}`;
}

export async function fetchAllPlants() {
  const { data, error } = await supabase
    .from("plants")
    .select("*")
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as Plant[];
}

export async function fetchPlantBySlug(slug: string) {
  const { data, error } = await supabase
    .from("plants")
    .select("*")
    .eq("slug", slug)
    .maybeSingle();
  if (error) throw error;
  return data as Plant | null;
}

export async function fetchAuthor(authorId: string) {
  const { data } = await supabase
    .from("profiles")
    .select("display_name")
    .eq("id", authorId)
    .maybeSingle();
  return data;
}

export async function fetchMyPlants(userId: string) {
  const { data, error } = await supabase
    .from("plants")
    .select("*")
    .eq("author_id", userId)
    .order("updated_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as Plant[];
}

export async function fetchFeaturedAndLatest() {
  const { data: featured } = await supabase
    .from("plants")
    .select("*")
    .eq("is_featured", true)
    .order("updated_at", { ascending: false })
    .limit(4);
  const { data: latest } = await supabase
    .from("plants")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(12);
  return { featured: (featured ?? []) as Plant[], latest: (latest ?? []) as Plant[] };
}

export type FetchPlantsOptions = {
  limit?: number;
  offset?: number;
  q?: string;
  family?: string;
  genus?: string;
  iucn?: string;
  plantIds?: string[] | null;
};

export async function fetchPaginatedPlants(options: FetchPlantsOptions) {
  const { limit = 20, offset = 0, q = "", family, genus, iucn, plantIds } = options;

  let query = supabase
    .from("plants")
    .select("*", { count: "exact" });

  if (family) {
    query = query.eq("family", family);
  }
  if (genus) {
    query = query.eq("genus", genus);
  }
  if (iucn === "__unrated__") {
    query = query.is("iucn_status", null);
  } else if (iucn) {
    query = query.eq("iucn_status", iucn);
  }
  if (plantIds) {
    if (plantIds.length === 0) {
      // If array is empty, force empty result instead of ignoring the filter
      return { data: [], count: 0 };
    }
    query = query.in("id", plantIds);
  }
  if (q.trim()) {
    const term = `%${q.trim()}%`;
    query = query.or(`title.ilike.${term},scientific_name.ilike.${term},family.ilike.${term},genus.ilike.${term},common_name_en.ilike.${term},summary.ilike.${term}`);
  }

  query = query
    .order("created_at", { ascending: false })
    .range(offset, offset + limit - 1);

  const { data, error, count } = await query;
  if (error) throw error;

  return {
    data: (data ?? []) as Plant[],
    count: count ?? 0,
  };
}

export async function fetchPlantsMetadata() {
  const { data, error } = await supabase
    .from("plants")
    .select("id, slug, title, scientific_name, family, genus, iucn_status");
  if (error) throw error;
  return data ?? [];
}