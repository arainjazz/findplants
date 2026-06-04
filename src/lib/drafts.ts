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

export async function fetchDraftById(id: string): Promise<PlantDraft | null> {
  const { data, error } = await supabase
    .from("plant_drafts")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  return data as PlantDraft | null;
}
