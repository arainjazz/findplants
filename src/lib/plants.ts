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

/**
 * 归一化学名到「属+种」查重键：去掉 markdown 星号/下划线，取前两个空格分词，小写。
 * 用于判定「同一物种」——容忍命名人后缀与格式差异。
 *   "*Anthurium crystallinum* Linden ex André" → "anthurium crystallinum"
 *   "Anthurium crystallinum Linden & André"     → "anthurium crystallinum"
 */
export function speciesKey(scientificName: string | null | undefined): string {
  if (!scientificName) return "";
  const cleaned = scientificName.replace(/[*_]/g, " ").replace(/\s+/g, " ").trim();
  const tokens = cleaned.split(" ").filter(Boolean);
  return tokens.slice(0, 2).join(" ").toLowerCase();
}

/** 剥离 HTML → 可见正文纯文本（去 script/style/标签/实体/补充观测卡片）。用于查重相似度与 body_text 存储。 */
export function visibleBodyText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<section[^>]*class="merged-observation"[\s\S]*?<\/section>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&[a-z#0-9]+;/gi, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}
/** 字符 n-gram 集合（对中文友好：先去空白再切 3-gram）。 */
export function textShingles(text: string, n = 3): Set<string> {
  const t = text.replace(/\s+/g, "");
  const s = new Set<string>();
  for (let i = 0; i + n <= t.length; i++) s.add(t.slice(i, i + n));
  return s;
}
/** 两个 shingle 集合的 Jaccard 相似度（0–1）。 */
export function jaccardSimilarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  const uni = a.size + b.size - inter;
  return uni === 0 ? 0 : inter / uni;
}
/** 便捷：两段可见正文文本的相似度。 */
export function bodyTextSimilarity(textA: string, textB: string): number {
  return jaccardSimilarity(textShingles(textA), textShingles(textB));
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