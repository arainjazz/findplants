import { supabase } from "@/integrations/supabase/client";

export type Tag = {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  expected_count: number | null;
  created_by: string;
  created_by_name: string | null;
  created_at: string;
  updated_at: string;
};

export type TagWithCount = Tag & { plant_count: number };

export function slugifyTag(s: string) {
  return s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u4e00-\u9fff\u3000-\u303f\uff00-\uffef]/g, (m) => encodeURIComponent(m).replace(/%/g, ""))
    .replace(/[^a-z0-9\-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || `t-${Date.now().toString(36)}`;
}

export async function fetchAllTags(): Promise<TagWithCount[]> {
  const { data, error } = await supabase
    .from("tags")
    .select("*")
    .order("created_at", { ascending: false });
  if (error) throw error;
  const tags = (data ?? []) as Tag[];
  if (tags.length === 0) return [];
  const { data: pts } = await supabase.from("plant_tags").select("tag_id");
  const counts: Record<string, number> = {};
  for (const row of pts ?? []) counts[row.tag_id] = (counts[row.tag_id] ?? 0) + 1;
  return tags.map((t) => ({ ...t, plant_count: counts[t.id] ?? 0 }));
}

export async function fetchTagBySlug(slug: string) {
  const { data, error } = await supabase
    .from("tags")
    .select("*")
    .eq("slug", slug)
    .maybeSingle();
  if (error) throw error;
  return data as Tag | null;
}

export async function fetchTagByName(name: string) {
  const { data } = await supabase
    .from("tags")
    .select("*")
    .ilike("name", name.trim())
    .maybeSingle();
  return (data ?? null) as Tag | null;
}

export async function fetchPlantIdsForTag(tagId: string): Promise<string[]> {
  const { data } = await supabase.from("plant_tags").select("plant_id").eq("tag_id", tagId);
  return (data ?? []).map((r) => r.plant_id as string);
}

export async function fetchTagsForPlant(plantId: string): Promise<Tag[]> {
  const { data } = await supabase
    .from("plant_tags")
    .select("tags(*)")
    .eq("plant_id", plantId);
  return (data ?? []).map((r) => (r as { tags: Tag }).tags).filter(Boolean);
}

export async function fetchAllPlantTags(): Promise<{ tag_id: string; plant_id: string }[]> {
  const { data, error } = await supabase.from("plant_tags").select("tag_id,plant_id");
  if (error) throw error;
  return (data ?? []) as { tag_id: string; plant_id: string }[];
}

export async function createTag(input: { name: string; description: string }, userId: string, userName: string) {
  const slug = slugifyTag(input.name);
  const { data, error } = await supabase
    .from("tags")
    .insert({
      slug,
      name: input.name.trim(),
      description: input.description.trim() || null,
      created_by: userId,
      created_by_name: userName,
    })
    .select()
    .single();
  if (error) throw error;
  await supabase.from("plant_edits").insert({
    plant_id: null,
    editor_id: userId,
    editor_name: userName,
    kind: "tag_create",
    marker_n: 0,
    source: "tag_editor",
    summary: `${userName} 创建了 #${input.name} 标签`,
  });
  return data as Tag;
}

export async function updateTag(id: string, patch: Partial<Pick<Tag, "name" | "description" | "expected_count">>) {
  const { error } = await supabase.from("tags").update(patch).eq("id", id);
  if (error) throw error;
}

export async function deleteTag(id: string) {
  const { error } = await supabase.from("tags").delete().eq("id", id);
  if (error) throw error;
}

export async function attachPlantsToTag(tagId: string, plantIds: string[], userId: string) {
  if (plantIds.length === 0) return;
  const rows = plantIds.map((pid) => ({ tag_id: tagId, plant_id: pid, added_by: userId }));
  const { error } = await supabase.from("plant_tags").upsert(rows, { onConflict: "tag_id,plant_id", ignoreDuplicates: true });
  if (error) throw error;
}

export async function detachPlantFromTag(tagId: string, plantId: string) {
  const { error } = await supabase.from("plant_tags").delete().eq("tag_id", tagId).eq("plant_id", plantId);
  if (error) throw error;
}
