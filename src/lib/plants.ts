import { supabase } from "@/integrations/supabase/client";

export type Plant = {
  id: string;
  slug: string;
  title: string;
  scientific_name: string | null;
  common_name_en: string | null;
  family: string | null;
  genus: string | null;
  iucn_status: string | null;
  habitat: string | null;
  summary: string | null;
  cover_url: string | null;
  content_type: "rich" | "html";
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