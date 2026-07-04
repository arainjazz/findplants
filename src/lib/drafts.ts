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
};

export async function fetchPendingDrafts(limit = 12): Promise<PlantDraft[]> {
  const { data, error } = await supabase
    .from("plant_drafts")
    .select("*")
    .eq("status", "pending")
    .order("created_at", { ascending: false })
    .limit(limit);
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
};

/**
 * Sightings for the "explore nearby" map: ONLY species identified from a real
 * photo carrying GPS coordinates (phone EXIF / geolocation). Excludes rejected
 * drafts and anything without coordinates, so every pin is a genuine, accurately
 * located observation rather than a synthetic placement.
 */
export async function fetchGeoSightings(limit = 500): Promise<GeoSighting[]> {
  const BASE = "id,title,scientific_name,family,genus,capture_lat,capture_lng,capture_place,photo_url,status,published_plant_id";
  const run = (cols: string) =>
    supabase
      .from("plant_drafts")
      .select(cols)
      .not("capture_lat", "is", null)
      .not("capture_lng", "is", null)
      .neq("status", "rejected")
      .order("created_at", { ascending: false })
      .limit(limit);

  // Prefer the invasive columns; if the 20260703 migration hasn't been applied
  // yet, fall back to the base columns so the map never breaks (invasive flag
  // defaults to false).
  let { data, error } = await run(`${BASE},is_invasive,gbif_taxon_key`);
  if (error) {
    console.warn("[fetchGeoSightings] invasive columns missing, falling back:", error.message);
    ({ data, error } = await run(BASE));
  }
  if (error) throw error;
  return (data ?? [])
    .filter((d: any) => typeof d.capture_lat === "number" && typeof d.capture_lng === "number")
    .map((d: any) => ({ ...d, is_invasive: !!d.is_invasive, gbif_taxon_key: d.gbif_taxon_key ?? null })) as GeoSighting[];
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
