import { supabase } from "@/integrations/supabase/client";
import { stripInlineMarkdown, markdownEmphasisToHtml } from "./strip-markdown";

/**
 * 防御性清洗：库里**已有**的草稿字段仍带着模型写进去的 markdown（`*Allium*`、正文里的
 * `*Ficus lyrata*`）。写入端已修，但存量数据只能在读取时就地清 —— 纯文本字段去星号，
 * 正文 HTML 里的 `*Latin*` 转 <em>。新识别的草稿本就干净，再清一遍是幂等的。
 */
function cleanDraftForDisplay(d: PlantDraft): PlantDraft {
  const s = (v: string | null | undefined) => (v == null ? v : stripInlineMarkdown(v));
  d.title = stripInlineMarkdown(d.title);
  d.scientific_name = s(d.scientific_name) ?? null;
  d.family = s(d.family) ?? null;
  d.genus = s(d.genus) ?? null;
  d.common_name_en = s(d.common_name_en) ?? null;
  d.common_names_zh = s(d.common_names_zh);
  d.summary = s(d.summary) ?? null;
  if (d.html_content) d.html_content = markdownEmphasisToHtml(d.html_content);
  // 分享卡会在顶层列为空时回落到 ai_payload 的镜像字段，一并清掉。
  const p = d.ai_payload as Record<string, unknown> | null | undefined;
  if (p && typeof p === "object") {
    for (const k of ["scientific_name", "family", "genus", "common_names_zh", "summary_zh"]) {
      if (typeof p[k] === "string") p[k] = stripInlineMarkdown(p[k] as string);
    }
  }
  return d;
}

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

/**
 * 已发布条目 → 识别地点（plant_id → capture_place）。
 *
 * 条目表本身**不存**识别地点：地点只在来源草稿的 `capture_place` 上，采纳后草稿不删除、
 * `published_plant_id` 指向条目（见 fetchOriginProvenance）。逐条查太贵（标签选择器
 * 一屏可能列几百个条目），所以这里一次性拉全表建索引。
 *
 * 同一条目可能有多条来源草稿（补拍 / 多人识别同一株）——取**最早**那条，与详页页头
 * 「最早识别人 / 地点 / 时间」的口径保持一致。
 *
 * ⚠️ capture_place 是自由文本，粒度从「鄂尔多斯市」到整条街道地址都有（见 CLAUDE.md），
 * 所以调用方应当做**子串匹配**，不要指望能枚举出干净的地点集合。
 */
export async function fetchPlantCapturePlaces(): Promise<Map<string, string>> {
  const PAGE = 1000;
  const byPlant = new Map<string, { place: string; at: string }>();
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from("plant_drafts")
      .select("published_plant_id,capture_place,created_at")
      .not("published_plant_id", "is", null)
      .not("capture_place", "is", null)
      .order("created_at", { ascending: true })
      .range(from, from + PAGE - 1);
    // 这是个纯锦上添花的筛选维度：查不到就当没有地点，别把整个标签管理页拖垮。
    if (error) break;
    const rows = (data ?? []) as { published_plant_id: string; capture_place: string; created_at: string }[];
    for (const r of rows) {
      const place = (r.capture_place ?? "").trim();
      if (!place) continue;
      const prev = byPlant.get(r.published_plant_id);
      if (!prev || r.created_at < prev.at) byPlant.set(r.published_plant_id, { place, at: r.created_at });
    }
    if (rows.length < PAGE) break;
  }
  return new Map(Array.from(byPlant, ([id, v]) => [id, v.place]));
}

export async function fetchDraftById(id: string): Promise<PlantDraft | null> {
  const { data, error } = await supabase
    .from("plant_drafts")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  return data ? cleanDraftForDisplay(data as PlantDraft) : null;
}
