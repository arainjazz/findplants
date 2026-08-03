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
  /** 命中「国家和各省重点保护野生植物名录」（服务端按学名匹配，含属级/科级条目）。 */
  is_protected: boolean;
  /** 命中的名录名，如「国家（2021）」「内蒙古（2009）」；没命中为 null。 */
  protected_label: string | null;
  /**
   * 这条记录的 `capture_lat/lng`（以及 `capture_place`）**已被脱敏**。
   *
   * 保护物种恒为 true；站长 / 资深编辑走精确坐标入口时为 false。凡是把坐标显示给人看的
   * 地方，都必须读这个标志决定要不要标「已模糊」——见 lib/protected-coords.ts。
   */
  coords_fuzzed: boolean;
};

/**
 * Sightings for the "explore nearby" map: ONLY species identified from a real
 * photo carrying GPS coordinates (phone EXIF / geolocation). Excludes rejected
 * drafts and anything without coordinates, so every pin is a genuine, accurately
 * located observation rather than a synthetic placement.
 *
 * 🔴 **走服务端函数，不再在浏览器里直查 `plant_drafts`。** 重点保护物种的坐标必须在数据
 * 离开服务器之前就模糊掉；留在前端做等于把精确坐标先发给所有人、再假装看不见。
 * 精确坐标另有入口（`geoSightingsExactFn`，仅站长 / 资深编辑）。
 */
export async function fetchGeoSightings(limit = 500): Promise<GeoSighting[]> {
  const { geoSightingsFn } = await import("@/lib/geo-sightings.functions");
  return geoSightingsFn({ data: { limit } });
}

/**
 * plantId → 指向它的来源草稿里**有没有银叶那一份**。
 *
 * 已收录档案要把条目分成 🟢快速识别 / 🔵银叶科普 / 🟠skill详页 三类（用户 2026-08-01），
 * 而 `plants.source` 分不出前两类：采纳流程历史上有的写 `ai_identify`、有的留 null。
 * 唯一可靠的信号是来源草稿本身 —— 同一条目可能有好几份来源草稿（补拍 / 多人识别同一株），
 * **只要其中一份是银叶，这个条目就算银叶科普**（银叶正文必然含快速识别简介）。
 *
 * 一次拉全表建索引：逐条查太贵（一屏可能列几百个条目），与 `fetchPlantCapturePlaces`
 * 同一个路数。`enriched:ai_payload->>_enriched` 是 PostgREST 的 JSON 取值别名，
 * 返回字符串 "true"/"false"，不必把整个 ai_payload 拉回来。
 */
export async function fetchPlantSourceKinds(): Promise<Map<string, boolean>> {
  const m = new Map<string, boolean>();
  const { data, error } = await supabase
    .from("plant_drafts")
    .select("published_plant_id, enriched:ai_payload->>_enriched")
    .eq("status", "approved")
    .not("published_plant_id", "is", null);
  if (error) return m;
  type Row = {
    published_plant_id: string | null;
    enriched: string | null;
  };
  for (const d of (data ?? []) as Row[]) {
    if (!d.published_plant_id) continue;
    m.set(d.published_plant_id, (m.get(d.published_plant_id) ?? false) || d.enriched === "true");
  }
  return m;
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
