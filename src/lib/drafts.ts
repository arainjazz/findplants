import { supabase } from "@/integrations/supabase/client";

export type PlantDraft = {
  id: string;
  created_at: string;
  updated_at: string;
  created_by: string | null;
  creator_label: string;
  photo_url: string;
  capture_lat: number | null;
  capture_lng: number | null;
  capture_place: string | null;
  ai_model: string | null;
  title: string;
  scientific_name: string | null;
  common_name_en: string | null;
  family: string | null;
  genus: string | null;
  summary: string | null;
  tags: string[];
  iucn_status: string | null;
  html_content: string;
  status: "pending" | "approved" | "rejected";
  published_plant_id: string | null;
  ai_payload?: any;
  common_names_zh?: string | null;
  adopted?: boolean;
  adopted_by?: string | null;
  adopted_at?: string | null;
  retake_count?: number | null;
  /** True once the user tapped「保存为待审批草稿」— gates queue/map visibility. */
  submitted_for_review?: boolean | null;
  /** Ordered list of the user's own shots (newest first); retakes append here. */
  user_photos?: string[] | null;
};

export async function fetchPendingDrafts(limit = 12): Promise<PlantDraft[]> {
  // Only drafts the user has explicitly「保存为待审批草稿」(submitted_for_review=true)
  // enter the review queue. If that column doesn't exist yet (migration pending), fall
  // back to showing all pending drafts so the queue never breaks.
  const base = () =>
    supabase
      .from("plant_drafts")
      .select("*")
      .eq("status", "pending")
      .order("created_at", { ascending: false })
      .limit(limit);
  let { data, error } = await base().eq("submitted_for_review", true);
  if (error) {
    console.warn("[fetchPendingDrafts] submitted_for_review missing, falling back:", error.message);
    ({ data, error } = await base());
  }
  if (error) throw error;
  return (data ?? []) as PlantDraft[];
}

export type GeoSighting = {
  id: string;
  title: string;
  scientific_name: string | null;
  family: string | null;
  genus: string | null;
  capture_lat: number;
  capture_lng: number;
  capture_place: string | null;
  photo_url: string;
  status: "pending" | "approved" | "rejected";
  published_plant_id: string | null;
  /** GBIF/GRIIS-confirmed invasive alien species in China (danger triangle on the map). */
  is_invasive: boolean;
  /** GBIF taxon key — used to pull China occurrence distribution points on demand. */
  gbif_taxon_key: number | null;
  /** Creation timestamp for sorting by recency. */
  created_at: string;
  /** Identifying user's id — drives the「只显示我识别的植物」map filter (null = guest). */
  created_by: string | null;
};

/**
 * Sightings for the "explore nearby" map: ONLY species identified from a real
 * photo carrying GPS coordinates (phone EXIF / geolocation). Excludes rejected
 * drafts and anything without coordinates, so every pin is a genuine, accurately
 * located observation rather than a synthetic placement.
 */
export async function fetchGeoSightings(limit = 500): Promise<GeoSighting[]> {
  const BASE = "id,title,scientific_name,family,genus,capture_lat,capture_lng,capture_place,photo_url,status,published_plant_id,created_at,created_by";
  // A sighting only shows on the map after the user submitted it for review. When the
  // submitted_for_review column is missing (migration pending) the .eq is dropped by
  // the fallback ladder so the map never breaks.
  const run = (cols: string, gated: boolean) => {
    let q = supabase
      .from("plant_drafts")
      .select(cols)
      .not("capture_lat", "is", null)
      .not("capture_lng", "is", null)
      .neq("status", "rejected");
    if (gated) q = q.eq("submitted_for_review", true);
    return q.order("created_at", { ascending: false }).limit(limit);
  };

  // Prefer invasive columns + review gate; degrade gracefully if either migration is
  // unapplied (invasive flag defaults false; ungated shows all).
  let { data, error } = await run(`${BASE},is_invasive,gbif_taxon_key`, true);
  if (error) {
    console.warn("[fetchGeoSightings] gated/invasive columns missing, falling back:", error.message);
    ({ data, error } = await run(`${BASE},is_invasive,gbif_taxon_key`, false));
  }
  if (error) {
    ({ data, error } = await run(BASE, false));
  }
  if (error) throw error;
  return (data ?? [])
    .filter((d: any) => typeof d.capture_lat === "number" && typeof d.capture_lng === "number")
    .map((d: any) => ({ ...d, is_invasive: !!d.is_invasive, gbif_taxon_key: d.gbif_taxon_key ?? null, created_by: d.created_by ?? null })) as GeoSighting[];
}

/** Set of plant ids that originated from an approved AI-identification draft. */
export async function fetchAiPlantIds(): Promise<Set<string>> {
  const { data, error } = await supabase
    .from("plant_drafts")
    .select("published_plant_id")
    .eq("status", "approved")
    .not("published_plant_id", "is", null);
  if (error) return new Set<string>();
  return new Set((data ?? []).map((d) => d.published_plant_id).filter(Boolean) as string[]);
}

export async function fetchDraftById(id: string): Promise<PlantDraft | null> {
  const { data, error } = await supabase
    .from("plant_drafts")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  return data as PlantDraft | null;
}
