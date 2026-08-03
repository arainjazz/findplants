import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useMemo, useRef, useState, type TouchEvent as ReactTouchEvent } from "react";
import { SiteHeader, SiteFooter } from "@/components/site-header";
import { fetchGeoSightings, type GeoSighting } from "@/lib/drafts";
import { gbifChinaOccurrencesFn } from "@/lib/identify-plant.functions";
import { geoSightingsExactFn } from "@/lib/geo-sightings.functions";
import { getMyRolesFn } from "@/lib/roles.functions";
import { displayPlace } from "@/lib/editor-stats";
import { fetchConservationData, buildConservationMatcher } from "@/lib/conservation";
import {
  FUZZ_EXPLAIN,
  FUZZ_NOTICE,
  FUZZ_ORANGE,
  FUZZ_SUFFIX,
  formatCoordPair,
} from "@/lib/protected-coords";
import { fetchTags, fetchTagMembership, type TagMembership } from "@/lib/tags";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useAuth } from "@/hooks/use-auth";

export const Route = createFileRoute("/explore")({
  head: () => ({
    meta: [
      { title: "身边物种地图 · Plantspedia" },
      { name: "description", content: "基于真实 GPS 坐标，探索身边被手机拍摄识别的野生与栽培植物分布。" },
    ],
  }),
  component: ExplorePage,
});

const BASE_LAYERS = {
  flat: { label: "平面" },
  satellite: { label: "卫星" },
} as const;
type BaseMode = keyof typeof BASE_LAYERS;

// ── WGS-84 → GCJ-02 (高德加密坐标) ───────────────────────────────────────────
const GCJ_PI = Math.PI;
const GCJ_A = 6378245.0;
const GCJ_EE = 0.00669342162296594323;
function outOfChina(lng: number, lat: number) {
  return lng < 72.004 || lng > 137.8347 || lat < 0.8293 || lat > 55.8271;
}
function transformLat(x: number, y: number) {
  let ret = -100 + 2 * x + 3 * y + 0.2 * y * y + 0.1 * x * y + 0.2 * Math.sqrt(Math.abs(x));
  ret += ((20 * Math.sin(6 * x * GCJ_PI) + 20 * Math.sin(2 * x * GCJ_PI)) * 2) / 3;
  ret += ((20 * Math.sin(y * GCJ_PI) + 40 * Math.sin((y / 3) * GCJ_PI)) * 2) / 3;
  ret += ((160 * Math.sin((y / 12) * GCJ_PI) + 320 * Math.sin((y * GCJ_PI) / 30)) * 2) / 3;
  return ret;
}
function transformLng(x: number, y: number) {
  let ret = 300 + x + 2 * y + 0.1 * x * x + 0.1 * x * y + 0.1 * Math.sqrt(Math.abs(x));
  ret += ((20 * Math.sin(6 * x * GCJ_PI) + 20 * Math.sin(2 * x * GCJ_PI)) * 2) / 3;
  ret += ((20 * Math.sin(x * GCJ_PI) + 40 * Math.sin((x / 3) * GCJ_PI)) * 2) / 3;
  ret += ((150 * Math.sin((x / 12) * GCJ_PI) + 300 * Math.sin((x / 30) * GCJ_PI)) * 2) / 3;
  return ret;
}
function wgs84togcj02(lng: number, lat: number): [number, number] {
  if (outOfChina(lng, lat)) return [lng, lat];
  let dLat = transformLat(lng - 105, lat - 35);
  let dLng = transformLng(lng - 105, lat - 35);
  const radLat = (lat / 180) * GCJ_PI;
  let magic = Math.sin(radLat);
  magic = 1 - GCJ_EE * magic * magic;
  const sqrtMagic = Math.sqrt(magic);
  dLat = (dLat * 180) / (((GCJ_A * (1 - GCJ_EE)) / (magic * sqrtMagic)) * GCJ_PI);
  dLng = (dLng * 180) / ((GCJ_A / sqrtMagic) * Math.cos(radLat) * GCJ_PI);
  return [lng + dLng, lat + dLat];
}

function boundsOf(AMap: any, coords: [number, number][]) {
  let minLng = Infinity, minLat = Infinity, maxLng = -Infinity, maxLat = -Infinity;
  for (const [lng, lat] of coords) {
    minLng = Math.min(minLng, lng); maxLng = Math.max(maxLng, lng);
    minLat = Math.min(minLat, lat); maxLat = Math.max(maxLat, lat);
  }
  return new AMap.Bounds([minLng, minLat], [maxLng, maxLat]);
}

function useAMap() {
  const [AMap, setAMap] = useState<any>(null);
  useEffect(() => {
    if (typeof window === "undefined") return;
    if ((window as any).AMap) {
      setAMap((window as any).AMap);
      return;
    }
    const env = (import.meta as any).env ?? {};
    const KEY = env.VITE_AMAP_KEY as string | undefined;
    const SECURITY = env.VITE_AMAP_SECURITY as string | undefined;
    if (!KEY) {
      console.error("[AMap] 缺少 VITE_AMAP_KEY（请在 .env 配置），地图无法加载。");
      return;
    }
    (window as any)._AMapSecurityConfig = { securityJsCode: SECURITY };
    const s = document.createElement("script");
    s.src = `https://webapi.amap.com/maps?v=2.0&key=${KEY}&plugin=AMap.ToolBar,AMap.MarkerCluster,AMap.Driving`;
    s.async = true;
    s.onload = () => setAMap((window as any).AMap);
    s.onerror = () => console.error("[AMap] JSAPI 脚本加载失败（检查 key / 网络）。");
    document.body.appendChild(s);
    return () => {
      s.remove();
    };
  }, []);
  return AMap;
}

function haversineKm(a: [number, number], b: [number, number]) {
  const R = 6371;
  const dLat = ((b[0] - a[0]) * Math.PI) / 180;
  const dLng = ((b[1] - a[1]) * Math.PI) / 180;
  const la1 = (a[0] * Math.PI) / 180;
  const la2 = (b[0] * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string),
  );
}

function speciesKey(s: GeoSighting) {
  return s.scientific_name?.trim().toLowerCase() || s.title?.trim().toLowerCase() || "";
}

// GBIF China occurrence overlay point — a small, faded HOLLOW triangle, visually
// subordinate to our own GPS sightings (these are reference distribution points,
// coarser than a real observation).
const GBIF_MARKER_HTML =
  '<div style="cursor:default;line-height:0;"><svg width="18" height="16" viewBox="0 0 30 28" xmlns="http://www.w3.org/2000/svg">' +
  '<path d="M15 3 L27 25 L3 25 Z" fill="rgba(220,38,38,0.22)" stroke="rgba(220,38,38,0.7)" stroke-width="2.5" stroke-linejoin="round"/></svg></div>';

const gbifClusterHtml = (n: number) =>
  `<div style="min-width:26px;height:26px;padding:0 6px;border-radius:9999px;background:rgba(220,38,38,0.72);color:#fff;border:1.5px solid #fff;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:12px;box-shadow:0 1px 4px rgba(0,0,0,0.3);">${n}</div>`;

function ExplorePage() {
  const AMap = useAMap();
  const [map, setMap] = useState<any>(null);
  const [userCoords, setUserCoords] = useState<[number, number] | null>(null);
  const [permissionState, setPermissionState] = useState<"prompt" | "granted" | "denied">("prompt");
  const [panelOpen, setPanelOpen] = useState(true);
  const [selectedArea, setSelectedArea] = useState<string | null>(null);
  const [invasiveOnly, setInvasiveOnly] = useState(false);
  const [protectedOnly, setProtectedOnly] = useState(false);
  /** 选中的主题标签 id；null = 全部主题（不筛）。 */
  const [themeTag, setThemeTag] = useState<string | null>(null);
  // 「只显示我识别的植物」— login-only. Off = everyone's sightings; on = only mine.
  const { user } = useAuth();
  const [mineOnly, setMineOnly] = useState(false);
  const [baseMode, setBaseMode] = useState<BaseMode>("flat");
  const [expanded, setExpanded] = useState<{ lng: number; lat: number; items: GeoSighting[] } | null>(null);
  const [tick, setTick] = useState(0);
  const [routeStops, setRouteStops] = useState<GeoSighting[]>([]);
  const [routeInfo, setRouteInfo] = useState<{ distance: number; time: number } | null>(null);
  const [routeMsg, setRouteMsg] = useState("");
  // True only right after a successful 生成路线 — shows the route-stops radial preview.
  const [routeFanActive, setRouteFanActive] = useState(false);

  const satLayerRef = useRef<any>(null);
  const infoWindowRef = useRef<any>(null);
  const drivingRef = useRef<any>(null);
  const searchSeqRef = useRef(0);
  const justExpandedRef = useRef(0);
  // The popup's 加入路线 button needs the freshest route-stop list to disable itself etc.
  const routeStopsRef = useRef<GeoSighting[]>([]);
  useEffect(() => {
    routeStopsRef.current = routeStops;
  }, [routeStops]);

  // Any change to the stop list invalidates the generated route: drop the drawn route,
  // its info, and the preview radial. Bumping the seq makes any in-flight search callback
  // a no-op (prevents the stale "[object Event]" failures when adjusting stops mid-search).
  useEffect(() => {
    searchSeqRef.current++;
    setRouteFanActive(false);
    setRouteInfo(null);
    try {
      drivingRef.current?.clear();
    } catch {
      /* noop */
    }
  }, [routeStops]);

  const { data: publicSightings = [], isLoading } = useQuery({
    queryKey: ["geo-sightings"],
    queryFn: () => fetchGeoSightings(500),
  });

  // ── 保护物种的精确坐标（仅站长 / 资深编辑）────────────────────────────────────
  // 公开数据里，命中重点保护名录的记录坐标与地点都已在服务端脱敏（见 protected-coords.ts）。
  // 站长要把准确数据导出授权给科研机构 / 政府部门，所以给他们留一条精确入口：
  // **点开「只显示重点保护物种」时**才切到精确坐标 —— 平时浏览全图看到的和所有人一样是
  // 模糊值，避免站长自己截个图发出去就把位置泄了。
  const rolesFn = useServerFn(getMyRolesFn);
  const { data: myRoles } = useQuery({
    queryKey: ["my-roles", user?.id ?? "anon"],
    queryFn: () => rolesFn({ data: undefined }),
    enabled: !!user,
    staleTime: 5 * 60 * 1000,
  });
  const canSeeExact = !!myRoles?.isSenior; // isSenior 已含站长

  const exactFn = useServerFn(geoSightingsExactFn);
  const exactMode = canSeeExact && protectedOnly;
  const { data: exactSightings, isFetching: exactLoading } = useQuery({
    queryKey: ["geo-sightings", "exact"],
    queryFn: () => exactFn({ data: { limit: 500 } }),
    enabled: exactMode,
    staleTime: 5 * 60 * 1000,
  });

  // 精确那份到手之前先用公开（模糊）的顶着，地图不会空一下。
  const sightings = exactMode && exactSightings ? exactSightings : publicSightings;

  // Conservation registries (国家/省级重点保护 · CITES · GTS · GRIIS) — loaded once and
  // matched client-side against each sighting's scientific name (same rank-aware matcher
  // the 档案检索 filters use). Empty-safe: empty tables → nobody flagged.
  const { data: consData } = useQuery({
    queryKey: ["conservation-data"],
    queryFn: fetchConservationData,
    staleTime: 1000 * 60 * 30,
  });
  const consStatus = useMemo(() => {
    const m = new Map<string, { protected: boolean; griis: boolean; label?: string }>();
    if (!consData || !consData.taxa.length) return m;
    const match = buildConservationMatcher(consData);
    const nameById = new Map(consData.lists.map((l) => [l.id, l.name]));
    for (const s of sightings) {
      const hit = match(s.scientific_name, null);
      const label = [...hit.protectedLists.keys()].map((id) => nameById.get(id) || "").find(Boolean);
      m.set(s.id, { protected: hit.protectedLists.size > 0, griis: !!hit.griis, label });
    }
    return m;
  }, [consData, sightings]);
  // A sighting counts as invasive if the draft was GRIIS-flagged at ingest OR the local
  // GRIIS registry matches it; protected if any 重点保护 list matches.
  const isInvasiveSighting = (s: GeoSighting) => s.is_invasive || !!consStatus.get(s.id)?.griis;
  // 服务端判定（决定坐标脱不脱敏）与前端匹配器**取并集**：两边用的是同一套匹配规则，
  // 但名录表是分页拉的，万一前端那份少了一页，也绝不能因此把某条按「非保护」显示 ——
  // 宁可多打一次盾牌，不可少模糊一个坐标。
  const isProtectedSighting = (s: GeoSighting) => s.is_protected || !!consStatus.get(s.id)?.protected;
  const protectedLabelOf = (s: GeoSighting) =>
    consStatus.get(s.id)?.label || s.protected_label || "重点保护物种";

  // ── 地图 4 类点：按优先级取单色 入侵红 > 保护棕 > 采纳绿 > 未采纳蓝 ──
  // 采纳 = 草稿已收录(status='approved')；入侵/保护由物种身份决定，与采纳无关。
  type PtCat = "invasive" | "protected" | "adopted" | "unadopted";
  const CAT_COLOR: Record<PtCat, string> = {
    invasive: "#dc2626", protected: "#b45309", adopted: "#2e9e5b", unadopted: "#2563eb",
  };
  const CAT_LABEL: Record<PtCat, string> = {
    invasive: "入侵物种", protected: "重点保护", adopted: "已采纳", unadopted: "未采纳",
  };
  const CAT_GLYPH: Record<PtCat, string> = { invasive: "!", protected: "🛡", adopted: "", unadopted: "" };
  const CAT_ORDER: PtCat[] = ["invasive", "protected", "adopted", "unadopted"];
  const categoryOf = (s: GeoSighting): PtCat => {
    if (isInvasiveSighting(s)) return "invasive";
    if (isProtectedSighting(s)) return "protected";
    if (s.status === "approved") return "adopted";
    return "unadopted";
  };
  const catZ = (c: PtCat) => (c === "invasive" ? 14 : c === "protected" ? 13 : c === "adopted" ? 12 : 11);
  // 单点：4 色实心圈（入侵/保护带小字形）。
  const singleMarkerHtml = (cat: PtCat) => {
    const glyph = CAT_GLYPH[cat]
      ? `<span style="color:#fff;font-weight:800;font-size:12px;line-height:1;">${CAT_GLYPH[cat]}</span>` : "";
    return `<div style="cursor:pointer;width:20px;height:20px;border-radius:9999px;background:${CAT_COLOR[cat]};border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,0.4);display:flex;align-items:center;justify-content:center;">${glyph}</div>`;
  };
  // 聚合：按成员类型比例上色的饼环 + 中心计数。
  const clusterPieHtml = (items: GeoSighting[]) => {
    const counts: Record<PtCat, number> = { invasive: 0, protected: 0, adopted: 0, unadopted: 0 };
    for (const s of items) counts[categoryOf(s)]++;
    const total = items.length || 1;
    let acc = 0;
    const stops: string[] = [];
    for (const cat of CAT_ORDER) {
      const c = counts[cat];
      if (!c) continue;
      const start = (acc / total) * 360;
      acc += c;
      const end = (acc / total) * 360;
      stops.push(`${CAT_COLOR[cat]} ${start}deg ${end}deg`);
    }
    const bg = `conic-gradient(${stops.join(",")})`;
    return `<div style="position:relative;width:40px;height:40px;border-radius:9999px;background:${bg};box-shadow:0 2px 6px rgba(0,0,0,0.35);display:flex;align-items:center;justify-content:center;cursor:pointer;">` +
      `<div style="width:26px;height:26px;border-radius:9999px;background:#fff;color:#1e1008;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:13px;">${items.length}</div></div>`;
  };

  const gcjMap = useMemo(() => {
    const m = new Map<string, [number, number]>();
    for (const s of sightings) m.set(s.id, wgs84togcj02(s.capture_lng, s.capture_lat));
    return m;
  }, [sightings]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          setUserCoords([pos.coords.latitude, pos.coords.longitude]);
          setPermissionState("granted");
        },
        () => setPermissionState("denied"),
        { enableHighAccuracy: true, timeout: 5000 },
      );
    } else {
      setPermissionState("denied");
    }
  }, []);

  // "我的当前位置" button: (re)locate and recentre the map on the user.
  const [locating, setLocating] = useState(false);
  const locateMe = () => {
    if (!navigator.geolocation || locating) return;
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const lat = pos.coords.latitude;
        const lng = pos.coords.longitude;
        setUserCoords([lat, lng]);
        setPermissionState("granted");
        if (map) {
          const [glng, glat] = wgs84togcj02(lng, lat);
          map.setZoomAndCenter(15, [glng, glat]);
        }
        setLocating(false);
      },
      () => {
        setPermissionState("denied");
        setLocating(false);
      },
      { enableHighAccuracy: false, timeout: 12000, maximumAge: 60000 },
    );
  };

  // Swipe the info panel away (mobile): the top-right collapse button is easy to
  // miss, so a horizontal swipe (either direction) also collapses it.
  const panelTouchRef = useRef<{ x: number; y: number } | null>(null);
  const onPanelTouchStart = (e: ReactTouchEvent) => {
    const t = e.touches[0];
    panelTouchRef.current = { x: t.clientX, y: t.clientY };
  };
  const onPanelTouchEnd = (e: ReactTouchEvent) => {
    const s = panelTouchRef.current;
    panelTouchRef.current = null;
    if (!s) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - s.x;
    const dy = t.clientY - s.y;
    // Horizontal-dominant swipe > 55px → collapse (won't fire on a tap or a scroll).
    if (Math.abs(dx) > 55 && Math.abs(dx) > Math.abs(dy) * 1.4) setPanelOpen(false);
  };

  const sortedSightings = useMemo(() => {
    if (!userCoords) return sightings;
    return [...sightings].sort(
      (a, b) =>
        haversineKm(userCoords, [a.capture_lat, a.capture_lng]) -
        haversineKm(userCoords, [b.capture_lat, b.capture_lng]),
    );
  }, [sightings, userCoords]);

  // Area groups: sorted by most recently identified (creation time), not by count.
  // Show only top 6 for "最近上传识别地区".
  const areaGroups = useMemo(() => {
    const m = new Map<string, GeoSighting[]>();
    for (const s of sightings) {
      const area = displayPlace(s.capture_place);
      if (!area) continue;
      if (!m.has(area)) m.set(area, []);
      m.get(area)!.push(s);
    }
    // Sort by the most recent sighting's created_at in each area (descending).
    return Array.from(m, ([area, items]) => {
      const newest = items.reduce((a, b) => (a.created_at > b.created_at ? a : b));
      return { area, items, newestAt: newest.created_at };
    })
      .sort((a, b) => b.newestAt.localeCompare(a.newestAt))
      .slice(0, 6); // Only show top 6 most recent areas
  }, [sightings]);

  // ── 主题标签筛选（「只显示某个专题下的物种分布」）────────────────────────────
  // 走 fetchTagMembership 而不是自己拿 `plant_drafts.tags` 比名字 —— 主题标签有**三个
  // 来源**（plant_tags 关联表 / plants.tags / plant_drafts.tags），只认其中一个，
  // 就会出现「专题页说有 5 条、地图上只有 3 条」这种对不上账的情况（那正是 07-24
  // 「手动添加的标签下面永远是 0」那个 bug 的由来，见 tags.ts 开头的长注释）。
  const { data: tagIndex } = useQuery({
    queryKey: ["explore-tag-index"],
    queryFn: async () => {
      const tags = await fetchTags();
      if (!tags.length) return { tags, membership: new Map<string, TagMembership>() };
      return { tags, membership: await fetchTagMembership(tags) };
    },
    staleTime: 5 * 60 * 1000,
  });

  /** tagId → 该专题下的草稿 id / 已收录条目 id，查成 Set 好逐条 O(1) 判定。 */
  const tagSets = useMemo(() => {
    const m = new Map<string, { drafts: Set<string>; plants: Set<string> }>();
    for (const [id, v] of tagIndex?.membership ?? []) {
      m.set(id, { drafts: new Set(v.draftIds), plants: new Set(v.plantIds) });
    }
    return m;
  }, [tagIndex]);

  /**
   * 一条实拍记录算不算在某个专题下。
   *
   * 两条都要认：记录本身挂了标签（草稿），**或者**它已被采纳、而标签挂在采纳后的
   * 条目上。只认前者的话，一个专题越是"做得好"（条目都收录了）、地图上反而越空。
   */
  const inTheme = (s: GeoSighting, tagId: string) => {
    const set = tagSets.get(tagId);
    if (!set) return false;
    return set.drafts.has(s.id) || (!!s.published_plant_id && set.plants.has(s.published_plant_id));
  };

  /** 下拉里列出的专题：只留**地图上真有点**的，并按记录数从多到少排。 */
  const themeOptions = useMemo(() => {
    if (!tagIndex?.tags.length) return [];
    return tagIndex.tags
      .map((t) => ({ id: t.id, name: t.name, count: sightings.filter((s) => inTheme(s, t.id)).length }))
      .filter((t) => t.count > 0)
      .sort((a, b) => b.count - a.count);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tagIndex, tagSets, sightings]);

  // 选中的专题若因数据变化不再有点（例如刚好被别的筛选清空），自动退回「全部」，
  // 免得下拉显示着一个专题、地图却是空的。
  useEffect(() => {
    if (themeTag && !themeOptions.some((t) => t.id === themeTag)) setThemeTag(null);
  }, [themeOptions, themeTag]);

  const themeFilter = (s: GeoSighting) => !themeTag || inTheme(s, themeTag);

  // When either 名录 filter is on, keep sightings matching EITHER active category (union).
  const consFilter = (s: GeoSighting) =>
    !invasiveOnly && !protectedOnly
      ? true
      : (invasiveOnly && isInvasiveSighting(s)) || (protectedOnly && isProtectedSighting(s));

  // 「只显示我识别的植物」: when on (login-only), keep only the current user's records.
  const mineFilter = (s: GeoSighting) => !mineOnly || (!!user && s.created_by === user.id);

  const visibleSightings = useMemo(() => {
    let arr = sortedSightings.filter((s) => consFilter(s) && mineFilter(s) && themeFilter(s));
    if (selectedArea) arr = arr.filter((s) => displayPlace(s.capture_place) === selectedArea);
    return arr;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sortedSightings, selectedArea, invasiveOnly, protectedOnly, mineOnly, themeTag, tagSets, user?.id, consStatus]);

  // Sightings drawn on the map (名录 filters narrow to flagged species).
  const mapSightings = useMemo(
    () => sightings.filter((s) => consFilter(s) && mineFilter(s) && themeFilter(s)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sightings, invasiveOnly, protectedOnly, mineOnly, themeTag, tagSets, user?.id, consStatus],
  );
  // Count of the current user's own sightings — shown on the mine-only toggle.
  const mineCount = useMemo(
    () => (user ? sightings.filter((s) => s.created_by === user.id).length : 0),
    [sightings, user?.id],
  );
  const invasiveCount = useMemo(() => sightings.filter(isInvasiveSighting).length, [sightings, consStatus]);
  const protectedCount = useMemo(() => sightings.filter(isProtectedSighting).length, [sightings, consStatus]);
  // Distinct GBIF taxon keys of the invasive species present — feeds the overlay.
  const invasiveTaxonKeys = useMemo(
    () =>
      Array.from(
        new Set(sightings.filter((s) => s.is_invasive && s.gbif_taxon_key).map((s) => s.gbif_taxon_key as number)),
      ).sort((a, b) => a - b),
    [sightings],
  );

  // GBIF China occurrence overlay (design C). Lazy: only fetched when the
  // 只显示入侵 view is on and we have taxon keys. Server-side proxy (outside the
  // GFW); cached only in this query cache — no permanent storage.
  const { data: gbifOcc, isFetching: gbifLoading } = useQuery({
    queryKey: ["gbif-cn-occ", invasiveTaxonKeys],
    queryFn: () => gbifChinaOccurrencesFn({ data: { taxonKeys: invasiveTaxonKeys } }),
    enabled: invasiveOnly && invasiveTaxonKeys.length > 0,
    staleTime: 1000 * 60 * 30,
  });

  // Add a sighting as a route waypoint (functional update; deduped; max 16).
  const addStop = (s: GeoSighting) =>
    setRouteStops((prev) => (prev.find((x) => x.id === s.id) || prev.length >= 16 ? prev : [...prev, s]));

  // Initialize the AMap map.
  useEffect(() => {
    if (!AMap || map) return;
    let center: [number, number];
    if (userCoords) {
      center = wgs84togcj02(userCoords[1], userCoords[0]);
    } else if (sightings.length) {
      const avgLat = sightings.reduce((s, p) => s + p.capture_lat, 0) / sightings.length;
      const avgLng = sightings.reduce((s, p) => s + p.capture_lng, 0) / sightings.length;
      center = wgs84togcj02(avgLng, avgLat);
    } else {
      center = [104.2, 35.86];
    }
    const m = new AMap.Map("explore-map", {
      zoom: userCoords ? 13 : 5,
      center,
      viewMode: "2D",
      zoomControl: false,
    });
    if (AMap.ToolBar) {
      try {
        m.addControl(new AMap.ToolBar({ position: "RB" }));
      } catch {
        /* optional */
      }
    }
    setMap(m);
  }, [AMap, userCoords, sightings, map]);

  // Base layer swap.
  useEffect(() => {
    if (!AMap || !map) return;
    if (baseMode === "satellite") {
      if (!satLayerRef.current) satLayerRef.current = new AMap.TileLayer.Satellite();
      map.add(satLayerRef.current);
    } else if (satLayerRef.current) {
      map.remove(satLayerRef.current);
    }
  }, [AMap, map, baseMode]);

  // Markers + clustering. EACH marker carries its own click handler (reliable for
  // single, un-clustered points); the cluster only groups them visually and handles
  // cluster-bubble clicks (fan-out <20 / zoom-in ≥20).
  useEffect(() => {
    if (!AMap || !map) return;

    const openPopup = (s: GeoSighting) => {
      const g = gcjMap.get(s.id);
      if (!g) return;
      if (!infoWindowRef.current) {
        infoWindowRef.current = new AMap.InfoWindow({ offset: new AMap.Pixel(0, -18) });
      }
      infoWindowRef.current.setContent(buildPopupNode(s, g[0], g[1]));
      infoWindowRef.current.open(map, g);
    };

    // Build the popup as a real DOM node so its 导航 + 加入路线 buttons work.
    const buildPopupNode = (s: GeoSighting, glng: number, glat: number) => {
      const name = s.title || s.scientific_name || "植物";
      const nav =
        `https://uri.amap.com/navigation?to=${glng.toFixed(6)},${glat.toFixed(6)},` +
        `${encodeURIComponent(name)}&mode=car&coordinate=gaode&callnative=1`;
      // 坐标那一行只对**保护物种**出，因为只有它有话要说：要么标明已模糊（橙字），
      // 要么标明这是站长/资深编辑才看得到的精确值（绿字）。普通记录的坐标信息由
      // 「📍 地点」和图钉位置本身表达，不必再堆一行数字。
      const coordLine = !isProtectedSighting(s)
        ? ""
        : s.coords_fuzzed
          ? `<p style="margin:0 0 6px 0;font-size:11px;font-weight:700;color:${FUZZ_ORANGE};" title="${escapeHtml(FUZZ_EXPLAIN)}">🧭 ${formatCoordPair(s.capture_lat, s.capture_lng, true)}${FUZZ_SUFFIX}</p>`
          : `<p style="margin:0 0 6px 0;font-size:11px;font-weight:700;color:#15803d;" title="保护物种的精确坐标，仅网站所有者与资深编辑可见，请勿外传或截图分享。">🧭 ${formatCoordPair(s.capture_lat, s.capture_lng, false)}（精确·仅你可见）</p>`;
      const div = document.createElement("div");
      div.style.cssText = "min-width:210px;font-family:system-ui,sans-serif;padding:2px 2px 0;";
      div.innerHTML = `
        <h4 style="margin:0 0 2px 0;font-weight:700;font-size:14px;color:#1e1008;">${escapeHtml(s.title)}</h4>
        ${s.scientific_name ? `<p style="margin:0 0 4px 0;font-style:italic;font-size:12px;color:#6e4c28;">${escapeHtml(s.scientific_name)}</p>` : ""}
        ${isInvasiveSighting(s) ? `<p style="margin:0 0 6px 0;display:inline-block;background:#dc2626;color:#fff;font-size:11px;font-weight:700;padding:2px 8px;border-radius:999px;">⚠️ 外来入侵物种</p>` : ""}
        ${!isInvasiveSighting(s) && isProtectedSighting(s) ? `<p style="margin:0 0 6px 0;display:inline-block;background:#ca8a04;color:#fff;font-size:11px;font-weight:700;padding:2px 8px;border-radius:999px;">🛡️ ${escapeHtml(protectedLabelOf(s))}</p>` : ""}
        ${!isInvasiveSighting(s) && !isProtectedSighting(s) ? `<p style="margin:0 0 6px 0;display:inline-block;background:${s.status === "approved" ? "#2e9e5b" : "#2563eb"};color:#fff;font-size:11px;font-weight:700;padding:2px 8px;border-radius:999px;">${s.status === "approved" ? "✓ 已采纳收录" : "待编辑采纳"}</p>` : ""}
        ${s.capture_place ? `<p style="margin:0 0 6px 0;font-size:11px;color:#6e4c28;">📍 ${escapeHtml(s.capture_place)}</p>` : ""}
        ${coordLine}
        ${s.photo_url ? `<img src="${escapeHtml(s.photo_url)}" style="width:100%;height:96px;object-fit:cover;border-radius:4px;margin-top:4px;" />` : ""}
        <a href="${nav}" target="_blank" rel="noopener" style="display:block;text-align:center;background:#2e9e5b;color:#fff;font-size:12px;font-weight:600;padding:6px;border-radius:4px;margin-top:8px;text-decoration:none;">🧭 导航到此地</a>
        <button data-role="addstop" style="display:block;width:100%;text-align:center;background:#c2410c;color:#fff;font-size:12px;font-weight:600;padding:6px;border-radius:4px;margin-top:6px;border:none;cursor:pointer;">➕ 加入路线</button>
        <a href="/drafts/${s.id}" style="display:block;text-align:center;background:#2e7d32;color:#fff;font-size:12px;font-weight:600;padding:6px;border-radius:4px;margin-top:6px;text-decoration:none;">查看识别档案 →</a>`;
      const btn = div.querySelector('[data-role="addstop"]') as HTMLButtonElement | null;
      if (btn) {
        const already = routeStopsRef.current.find((x) => x.id === s.id);
        if (already) {
          btn.textContent = "✓ 已在路线中";
          btn.disabled = true;
          btn.style.opacity = "0.6";
          btn.style.cursor = "default";
        }
        btn.addEventListener("click", () => {
          addStop(s);
          btn.textContent = "✓ 已加入路线";
          btn.disabled = true;
          btn.style.opacity = "0.6";
          btn.style.cursor = "default";
        });
      }
      return div;
    };

    const onClusterClick = (items: GeoSighting[], lng: number, lat: number) => {
      if (!items.length) return;
      if (items.length < 20) {
        justExpandedRef.current = Date.now();
        setExpanded({ lng, lat, items });
        return;
      }
      // Large cluster: zoom to its members' bounds so AMap re-splits it into smaller
      // sub-clusters (which can then be fanned out). If the members are essentially
      // co-located (zoom can't separate them), fan out directly instead.
      const coords = items.map((s) => gcjMap.get(s.id)).filter(Boolean) as [number, number][];
      let minLng = Infinity, minLat = Infinity, maxLng = -Infinity, maxLat = -Infinity;
      for (const [clng, clat] of coords) {
        minLng = Math.min(minLng, clng); maxLng = Math.max(maxLng, clng);
        minLat = Math.min(minLat, clat); maxLat = Math.max(maxLat, clat);
      }
      const tiny = maxLng - minLng < 1e-4 && maxLat - minLat < 1e-4;
      if (tiny || coords.length < 2) {
        justExpandedRef.current = Date.now();
        setExpanded({ lng, lat, items });
      } else {
        try {
          map.setBounds(boundsOf(AMap, coords), false, [80, 80, 80, 80]);
        } catch {
          map.setZoomAndCenter(Math.min(18, map.getZoom() + 2), [lng, lat]);
        }
      }
    };

    // Custom distance-based clustering (replaces AMap's grid clustering, which leaves
    // markers overlapping at max zoom due to grid-boundary artifacts). Any points whose
    // 32px 🌱 circles overlap past ~half — centers within CLUSTER_PX — collapse into one
    // numbered bubble. Recomputed on every zoom (pan doesn't change pixel spacing).
    const CLUSTER_PX = 15;
    let markers: any[] = [];
    const renderMarkers = () => {
      if (markers.length) {
        try {
          map.remove(markers);
        } catch {
          /* noop */
        }
      }
      const pts = mapSightings
        .map((s) => {
          const g = gcjMap.get(s.id);
          if (!g) return null;
          const p = map.lngLatToContainer(new AMap.LngLat(g[0], g[1]));
          return { s, g, x: p.x != null ? p.x : p.getX(), y: p.y != null ? p.y : p.getY() };
        })
        .filter(Boolean) as { s: GeoSighting; g: [number, number]; x: number; y: number }[];

      const used = new Array(pts.length).fill(false);
      const out: any[] = [];
      for (let i = 0; i < pts.length; i++) {
        if (used[i]) continue;
        used[i] = true;
        const grp = [pts[i]];
        for (let j = i + 1; j < pts.length; j++) {
          if (used[j]) continue;
          const dx = pts[i].x - pts[j].x;
          const dy = pts[i].y - pts[j].y;
          if (dx * dx + dy * dy <= CLUSTER_PX * CLUSTER_PX) {
            used[j] = true;
            grp.push(pts[j]);
          }
        }
        if (grp.length === 1) {
          const { s, g } = grp[0];
          const cat = categoryOf(s);
          const m = new AMap.Marker({
            position: g,
            anchor: "center",
            content: singleMarkerHtml(cat),
            zIndex: catZ(cat),
          });
          m.on("click", () => openPopup(s));
          out.push(m);
        } else {
          const cgLng = grp.reduce((a, p) => a + p.g[0], 0) / grp.length;
          const cgLat = grp.reduce((a, p) => a + p.g[1], 0) / grp.length;
          const items = grp.map((p) => p.s);
          // 聚合圈按成员 4 类的比例上色（饼环）；zIndex 取最高优先级成员。
          const topCat = CAT_ORDER.find((c) => items.some((s) => categoryOf(s) === c)) ?? "unadopted";
          const m = new AMap.Marker({
            position: [cgLng, cgLat],
            anchor: "center",
            zIndex: catZ(topCat),
            content: clusterPieHtml(items),
          });
          m.on("click", () => onClusterClick(items, cgLng, cgLat));
          out.push(m);
        }
      }
      if (out.length) map.add(out);
      markers = out;
    };

    renderMarkers();
    let raf = 0;
    const onZoom = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(renderMarkers);
    };
    map.on("zoomend", onZoom);

    try {
      const coords = mapSightings.map((s) => gcjMap.get(s.id)).filter(Boolean) as [number, number][];
      if (userCoords) coords.push(wgs84togcj02(userCoords[1], userCoords[0]));
      if (coords.length > 1) map.setBounds(boundsOf(AMap, coords), false, [60, 60, 60, 60]);
      else if (coords.length === 1) map.setZoomAndCenter(13, coords[0]);
    } catch {
      /* framing optional */
    }

    return () => {
      map.off("zoomend", onZoom);
      cancelAnimationFrame(raf);
      if (markers.length) {
        try {
          map.remove(markers);
        } catch {
          /* noop */
        }
      }
    };
  }, [AMap, map, mapSightings, gcjMap, userCoords, consStatus]);

  // ── GBIF China occurrence overlay (design C) ───────────────────────────────
  // Faded hollow danger triangles showing the broader China distribution of the
  // invasive species on the map. Only active in the 只显示入侵 view. Points are
  // WGS-84 → converted per-point (so no GCJ-02 offset), viewport-culled and
  // pixel-clustered so the on-screen marker count stays sane; non-interactive.
  useEffect(() => {
    if (!AMap || !map) return;
    let overlay: any[] = [];
    const clear = () => {
      if (overlay.length) {
        try {
          map.remove(overlay);
        } catch {
          /* noop */
        }
        overlay = [];
      }
    };
    const raw = invasiveOnly ? gbifOcc?.points ?? [] : [];
    if (!raw.length) {
      clear();
      return;
    }
    const gcj = raw.map((p) => wgs84togcj02(p.lng, p.lat));

    const OVERLAY_PX = 14;
    const render = () => {
      clear();
      let bounds: any = null;
      try {
        bounds = map.getBounds();
      } catch {
        /* whole-world fallback */
      }
      const proj = gcj
        .map((g) => {
          if (bounds && !bounds.contains(new AMap.LngLat(g[0], g[1]))) return null;
          const pt = map.lngLatToContainer(new AMap.LngLat(g[0], g[1]));
          return { g, x: pt.x != null ? pt.x : pt.getX(), y: pt.y != null ? pt.y : pt.getY() };
        })
        .filter(Boolean) as { g: [number, number]; x: number; y: number }[];
      const used = new Array(proj.length).fill(false);
      const out: any[] = [];
      for (let i = 0; i < proj.length; i++) {
        if (used[i]) continue;
        used[i] = true;
        const grp = [proj[i]];
        for (let j = i + 1; j < proj.length; j++) {
          if (used[j]) continue;
          const dx = proj[i].x - proj[j].x;
          const dy = proj[i].y - proj[j].y;
          if (dx * dx + dy * dy <= OVERLAY_PX * OVERLAY_PX) {
            used[j] = true;
            grp.push(proj[j]);
          }
        }
        const clng = grp.reduce((a, p) => a + p.g[0], 0) / grp.length;
        const clat = grp.reduce((a, p) => a + p.g[1], 0) / grp.length;
        out.push(
          new AMap.Marker({
            position: [clng, clat],
            anchor: "center",
            zIndex: 6, // below our own GPS sightings (zIndex 12–14)
            bubble: true,
            clickable: false,
            content: grp.length === 1 ? GBIF_MARKER_HTML : gbifClusterHtml(grp.length),
          }),
        );
        if (out.length >= 1200) break; // hard cap on rendered overlay markers
      }
      if (out.length) map.add(out);
      overlay = out;
    };

    render();
    let raf = 0;
    const onMove = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(render);
    };
    map.on("zoomend", onMove);
    map.on("moveend", onMove);
    return () => {
      map.off("zoomend", onMove);
      map.off("moveend", onMove);
      cancelAnimationFrame(raf);
      clear();
    };
  }, [AMap, map, invasiveOnly, gbifOcc]);

  // User-location blue dot.
  useEffect(() => {
    if (!AMap || !map || !userCoords) return;
    const [ulng, ulat] = wgs84togcj02(userCoords[1], userCoords[0]);
    const um = new AMap.Marker({
      position: [ulng, ulat],
      anchor: "center",
      content: `<div class="relative flex items-center justify-center">
          <span class="absolute inline-flex h-6 w-6 rounded-full bg-blue-400 opacity-75 animate-ping"></span>
          <span class="relative inline-flex rounded-full h-3.5 w-3.5 bg-blue-500 border-2 border-white shadow-md"></span>
        </div>`,
    });
    map.add(um);
    return () => {
      try {
        map.remove(um);
      } catch {
        /* noop */
      }
    };
  }, [AMap, map, userCoords]);

  // Pan/zoom to the selected area's markers.
  useEffect(() => {
    if (!AMap || !map || !selectedArea) return;
    const group = areaGroups.find((g) => g.area === selectedArea);
    if (!group || !group.items.length) return;
    const coords = group.items.map((s) => gcjMap.get(s.id)).filter(Boolean) as [number, number][];
    if (coords.length) {
      try {
        map.setBounds(boundsOf(AMap, coords), false, [80, 80, 80, 80]);
      } catch {
        /* noop */
      }
    }
  }, [AMap, map, selectedArea, areaGroups, gcjMap]);

  // Keep the fan-out overlay anchored: re-project on any view change.
  useEffect(() => {
    if (!map) return;
    let raf = 0;
    const bump = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => setTick((t) => t + 1));
    };
    const close = () => {
      if (Date.now() - justExpandedRef.current > 300) setExpanded(null);
    };
    map.on("mapmove", bump);
    map.on("zoomchange", bump);
    map.on("resize", bump);
    map.on("moveend", bump);
    map.on("zoomend", bump);
    map.on("click", close);
    return () => {
      map.off("mapmove", bump);
      map.off("zoomchange", bump);
      map.off("resize", bump);
      map.off("moveend", bump);
      map.off("zoomend", bump);
      map.off("click", close);
      cancelAnimationFrame(raf);
    };
  }, [map]);

  useEffect(() => {
    return () => {
      try {
        drivingRef.current?.clear();
      } catch {
        /* noop */
      }
    };
  }, []);

  const fan = useMemo(() => {
    if (!map || !AMap || !expanded || !expanded.items.length) return null;
    try {
      const el = document.getElementById("explore-map");
      if (!el) return null;
      const W = el.clientWidth;
      const H = el.clientHeight;
      const toPx = (lng: number, lat: number) => {
        const p = map.lngLatToContainer(new AMap.LngLat(lng, lat));
        return { x: p.x != null ? p.x : p.getX(), y: p.y != null ? p.y : p.getY() };
      };
      const center = toPx(expanded.lng, expanded.lat);
      const items = expanded.items;
      const n = items.length;
      const cardW = 232;
      const rightGap = 16;
      const cardX = W - rightGap - cardW;
      const padTop = 56;
      const padBot = 20;
      const avail = Math.max(120, H - padTop - padBot);
      const slot = Math.min(112, avail / n);
      const totalH = slot * n;
      const startY = Math.max(padTop, padTop + (avail - totalH) / 2);
      const cardH = Math.max(56, slot - 10);
      const idsIn = new Set(items.map((s) => s.id));
      const cards = items.map((s, i) => {
        const cy = startY + slot * i + slot / 2;
        const key = speciesKey(s);
        const links: { x: number; y: number }[] = [];
        if (key) {
          for (const o of sightings) {
            if (idsIn.has(o.id)) continue;
            if (speciesKey(o) !== key) continue;
            const g = gcjMap.get(o.id);
            if (!g) continue;
            links.push(toPx(g[0], g[1]));
          }
        }
        return { s, i, cy, top: cy - cardH / 2, links };
      });
      return { W, H, center, cards, cardX, cardW, cardH };
    } catch {
      return null;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, AMap, expanded, tick, sightings, gcjMap]);

  // Radial preview of the GENERATED route's stops: each stop links to a right-side card.
  const routeFan = useMemo(() => {
    if (!map || !AMap || !routeFanActive || routeStops.length === 0) return null;
    try {
      const el = document.getElementById("explore-map");
      if (!el) return null;
      const W = el.clientWidth;
      const H = el.clientHeight;
      const toPx = (lng: number, lat: number) => {
        const p = map.lngLatToContainer(new AMap.LngLat(lng, lat));
        return { x: p.x != null ? p.x : p.getX(), y: p.y != null ? p.y : p.getY() };
      };
      const n = routeStops.length;
      const cardW = 232;
      const rightGap = 16;
      const cardX = W - rightGap - cardW;
      const padTop = 56;
      const padBot = 20;
      const avail = Math.max(120, H - padTop - padBot);
      const slot = Math.min(112, avail / n);
      const totalH = slot * n;
      const startY = Math.max(padTop, padTop + (avail - totalH) / 2);
      const cardH = Math.max(56, slot - 10);
      const projected = routeStops.map((s, i) => {
        const g = gcjMap.get(s.id);
        const mp = g ? toPx(g[0], g[1]) : { x: cardX, y: H / 2 };
        const role = n === 1 ? "终" : i === n - 1 ? "终" : "途";
        return { s, role, mx: mp.x, my: mp.y };
      });
      // Order cards by their source vertical position so leader lines never cross.
      projected.sort((a, b) => a.my - b.my);
      const cards = projected.map((p, row) => {
        const cy = startY + slot * row + slot / 2;
        return { s: p.s, role: p.role, mx: p.mx, my: p.my, cy, top: cy - cardH / 2 };
      });
      return { W, H, cards, cardX, cardW, cardH };
    } catch {
      return null;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, AMap, routeFanActive, routeStops, tick, gcjMap]);

  const removeStop = (id: string) => setRouteStops((prev) => prev.filter((s) => s.id !== id));
  // Route order = [起点, …途经…, 终点]. last item is always the destination.
  const setAsDestination = (s: GeoSighting) =>
    setRouteStops((prev) => {
      const without = prev.filter((x) => x.id !== s.id);
      if (without.length >= 16) return prev;
      return [...without, s]; // append → becomes 终点 (rightmost)
    });
  const setAsWaypoint = (s: GeoSighting) =>
    setRouteStops((prev) => {
      if (prev.find((x) => x.id === s.id)) return prev;
      if (prev.length >= 16) return prev;
      if (prev.length <= 1) return [...prev, s];
      const copy = prev.slice();
      copy.splice(copy.length - 1, 0, s); // insert before the current 终点
      return copy;
    });
  const moveStop = (i: number, dir: -1 | 1) =>
    setRouteStops((prev) => {
      const j = i + dir;
      if (j < 0 || j >= prev.length) return prev;
      const copy = prev.slice();
      [copy[i], copy[j]] = [copy[j], copy[i]];
      return copy;
    });
  const navigateRoute = () => {
    if (!routeStops.length) return;
    if (!userCoords) {
      setRouteMsg("需要你的定位作为起点，请允许浏览器定位后重试");
      return;
    }
    const startG = wgs84togcj02(userCoords[1], userCoords[0]);
    const stops = routeStops
      .map((s) => ({ g: gcjMap.get(s.id), name: s.title || "途经点" }))
      .filter((x) => x.g) as { g: [number, number]; name: string }[];
    if (!stops.length) return;
    const dest = stops[stops.length - 1];
    const vias = stops.slice(0, -1); // all but last = 途经点

    const isMobile = /android|iphone|ipad|ipod|harmonyos/i.test(navigator.userAgent);

    if (isMobile) {
      // 高德 APP 深链支持多个途经点（vian/vialons/vialats/vianames）。coords 已是 GCJ-02 → dev=0。
      let appUrl =
        `amapuri://route/plan/?sourceApplication=Plantspedia` +
        `&slat=${startG[1].toFixed(6)}&slon=${startG[0].toFixed(6)}&sname=${encodeURIComponent("我的位置")}` +
        `&dlat=${dest.g[1].toFixed(6)}&dlon=${dest.g[0].toFixed(6)}&dname=${encodeURIComponent(dest.name)}` +
        `&dev=0&t=0`;
      if (vias.length) {
        appUrl +=
          `&vian=${vias.length}` +
          `&vialons=${vias.map((v) => v.g[0].toFixed(6)).join("|")}` +
          `&vialats=${vias.map((v) => v.g[1].toFixed(6)).join("|")}` +
          `&vianames=${vias.map((v) => encodeURIComponent(v.name)).join("|")}`;
      }
      window.location.href = appUrl;
      return;
    }

    // Desktop fallback: web URI supports at most ONE via point (高德 限制).
    let webUrl =
      `https://uri.amap.com/navigation?from=${startG[0].toFixed(6)},${startG[1].toFixed(6)},${encodeURIComponent("我的位置")}` +
      `&to=${dest.g[0].toFixed(6)},${dest.g[1].toFixed(6)},${encodeURIComponent(dest.name)}`;
    if (vias.length) {
      webUrl += `&via=${vias[0].g[0].toFixed(6)},${vias[0].g[1].toFixed(6)},${encodeURIComponent(vias[0].name)}`;
    }
    webUrl += "&mode=car&coordinate=gaode&callnative=1";
    window.open(webUrl, "_blank", "noopener");
  };
  const clearRoute = () => {
    try {
      drivingRef.current?.clear();
    } catch {
      /* noop */
    }
    setRouteInfo(null);
    setRouteMsg("");
    setRouteStops([]);
  };
  const generateRoute = () => {
    setRouteMsg("");
    if (!AMap || !map) return;
    if (!routeStops.length) {
      setRouteMsg("请先选择目标物种");
      return;
    }
    if (!userCoords) {
      setRouteMsg("需要你的定位作为起点，请允许浏览器定位后重试");
      return;
    }
    try {
      // Reuse ONE Driving instance (creating/destroying per click was the source of
      // stale-callback "[object Event]" errors).
      if (!drivingRef.current) {
        drivingRef.current = new AMap.Driving({ map, autoFitView: true, hideMarkers: false });
      }
      const driving = drivingRef.current;
      driving.clear();
      // 起点 = 我的当前位置；途经 = 除最后一个外的所有物种；终点 = 最后一个物种。
      const startG = wgs84togcj02(userCoords[1], userCoords[0]);
      const stops = routeStops.map((s) => gcjMap.get(s.id)).filter(Boolean) as [number, number][];
      const start = new AMap.LngLat(startG[0], startG[1]);
      const end = new AMap.LngLat(stops[stops.length - 1][0], stops[stops.length - 1][1]);
      const waypoints = stops.slice(0, -1).map((c) => new AMap.LngLat(c[0], c[1]));
      const mySeq = ++searchSeqRef.current;
      driving.search(start, end, { waypoints }, (status: string, result: any) => {
        if (mySeq !== searchSeqRef.current) return; // superseded by a newer request/edit
        if (status === "complete" && result && result.routes && result.routes.length) {
          const r = result.routes[0];
          setRouteInfo({ distance: r.distance, time: r.time });
          setRouteMsg("");
          // Close any open popup / cluster fan-out, then show the route-stops radial.
          try {
            infoWindowRef.current?.close();
          } catch {
            /* noop */
          }
          setExpanded(null);
          setRouteFanActive(true);
        } else {
          const detail =
            typeof result === "string"
              ? result
              : result && typeof result.info === "string"
                ? result.info
                : "";
          setRouteInfo(null);
          setRouteMsg("路线规划失败" + (detail ? "：" + detail : "，请重试"));
        }
      });
    } catch (e: any) {
      setRouteMsg("规划出错：" + (e && typeof e.message === "string" ? e.message : "请重试"));
    }
  };

  return (
    <div className="min-h-screen flex flex-col">
      <SiteHeader />
      <main className="flex-1 flex flex-col relative w-full h-[calc(100vh-120px)] min-h-[500px]">
        {/* 我的当前位置 — recentre the map on the user. Bottom-left, clear of the
            AMap ToolBar (bottom-right) and the info panel (top-left). */}
        <button
          type="button"
          onClick={locateMe}
          disabled={locating}
          aria-label="定位到我的当前位置"
          title="我的当前位置"
          className="absolute bottom-6 left-4 z-[500] w-11 h-11 rounded-full bg-background/95 backdrop-blur-md border border-ink/20 shadow-xl flex items-center justify-center text-ink hover:text-vermilion transition-colors disabled:opacity-60"
        >
          {locating ? (
            <span className="w-5 h-5 rounded-full border-2 border-ink/20 border-t-vermilion animate-spin" />
          ) : (
            <svg viewBox="0 0 24 24" width="21" height="21" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <circle cx="12" cy="12" r="3" />
              <path d="M12 2v3M12 19v3M2 12h3M19 12h3" />
            </svg>
          )}
        </button>

        {!panelOpen && (
          <>
            <button
              type="button"
              onClick={() => setPanelOpen(true)}
              aria-label="展开物种列表"
              className="absolute top-4 left-4 z-[500] w-11 h-11 rounded-full bg-background/95 backdrop-blur-md border border-ink/20 shadow-xl flex items-center justify-center text-ink hover:text-vermilion transition-colors"
            >
              <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <circle cx="11" cy="11" r="7" />
                <path d="m21 21-4.3-4.3" />
              </svg>
            </button>
            {/* 面板收起后声明也不能跟着消失 —— 用户要的是「所有人的界面都提示」，
                而移动端多数时间面板是收着的。 */}
            <div
              className="absolute top-4 left-[4.25rem] right-4 z-[500] rounded-full bg-amber-50/95 backdrop-blur-md border border-amber-300 px-3 py-2 shadow-lg pointer-events-none"
              title={FUZZ_EXPLAIN}
            >
              <p className="text-[10px] font-semibold text-amber-900 leading-snug truncate">
                <span aria-hidden="true">🛡️ </span>
                {FUZZ_NOTICE}
              </p>
            </div>
          </>
        )}

        {panelOpen && (
          <div
            className="absolute top-4 left-4 z-[500] max-w-sm w-[calc(100vw-2rem)] bg-background/92 backdrop-blur-md border border-ink/15 p-5 rounded-lg shadow-2xl"
            onTouchStart={onPanelTouchStart}
            onTouchEnd={onPanelTouchEnd}
          >
            <button
              type="button"
              onClick={() => setPanelOpen(false)}
              aria-label="折叠面板"
              title="折叠（避免遮挡地图）"
              className="absolute top-2.5 right-2.5 w-7 h-7 rounded-full border border-ink/15 flex items-center justify-center text-ink-faint hover:text-vermilion hover:border-vermilion transition-colors"
            >
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M5 12h14" />
              </svg>
            </button>
            <p className="md:hidden text-[10px] text-ink-faint/70 mb-1">← 左右滑动此卡片即可收起 →</p>
            <p className="label text-vermilion mb-1 pr-8">Explorer · 身边物种地图</p>
            <h1 className="font-display text-2xl font-bold leading-tight mb-2 text-ink">身边物种地图</h1>
            <p className="text-xs text-ink-faint leading-relaxed mb-3">
              地图上每个标记都是有人用手机拍照识别、并带真实 GPS 坐标的物种记录。点击标记可「导航到此地」或「加入路线」；聚合圆点（少于 20 种）点开会在右侧展开物种卡片，同种在别处的记录以绿线相连。
            </p>

            {/* 坐标脱敏声明 —— 所有人（含未登录）都看得到，不受任何筛选开关影响。
                放在筛选按钮之前：这是地图数据的一条**前提**，不是某个视图下的补充说明。 */}
            <div className="mb-4 rounded-md border border-amber-300 bg-amber-50 px-3 py-2">
              <p className="text-[11px] font-semibold text-amber-900 leading-snug">
                <span aria-hidden="true">🛡️ </span>
                {FUZZ_NOTICE}
              </p>
              <p className="mt-1 text-[10px] text-amber-800/90 leading-relaxed">
                命中国家 / 省级重点保护野生植物名录的记录，对外只显示模糊坐标与区县级地点，
                <b>以防不法盗挖</b>；图钉位置随之偏移，不代表植株的真实所在。
              </p>
            </div>

            {/* 主题标签筛选。放在所有开关**之前**：其它几个是「在当前这批点里再挑一挑」，
                而选专题是先决定「看哪一批点」，顺序应当由粗到细。
                只在真有可选专题时出现 —— 一个永远只有「全部主题」的下拉是纯噪音。 */}
            {!isLoading && themeOptions.length > 0 && (
              <div className="mb-3">
                <Select
                  value={themeTag ?? "__all__"}
                  onValueChange={(v) => setThemeTag(v === "__all__" ? null : v)}
                >
                  <SelectTrigger
                    className={`w-full h-auto text-xs font-semibold px-3 py-2 rounded-md border transition-colors ${
                      themeTag
                        ? "bg-vermilion text-background border-vermilion shadow"
                        : "bg-paper-deep/60 text-ink border-ink/20 hover:border-vermilion"
                    }`}
                    title="按主题标签筛选：只显示该专题下的物种分布"
                  >
                    <span aria-hidden="true" className="mr-1.5">🏷️</span>
                    <SelectValue placeholder="按主题标签筛选" />
                  </SelectTrigger>
                  {/* z-[900]：下拉是 portal 到 body 的，默认 z-50 会被面板（z-500）和
                      高德自己的图层压住，必须显式抬高，否则点开是一片空白。 */}
                  <SelectContent className="z-[900] max-h-[50vh]">
                    <SelectItem value="__all__">全部主题（不筛选）</SelectItem>
                    {themeOptions.map((t) => (
                      <SelectItem key={t.id} value={t.id}>
                        {t.name} · {t.count}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {themeTag && (
                  <p className="mt-1.5 text-[10px] text-ink-faint leading-relaxed">
                    当前只显示
                    <b className="text-vermilion">
                      「{themeOptions.find((t) => t.id === themeTag)?.name}」专题下的{" "}
                      {themeOptions.find((t) => t.id === themeTag)?.count} 条记录
                    </b>
                    ；含挂在草稿上和已收录条目上的两种。
                    <button
                      type="button"
                      onClick={() => setThemeTag(null)}
                      className="ml-1 underline hover:text-vermilion"
                    >
                      清除
                    </button>
                  </p>
                )}
              </div>
            )}

            {/* 只显示我识别的植物 — login-only. Guests never see this button; without
                logging in there's no way to tell「我的」记录 apart. */}
            {!isLoading && user && (
              <div className="mb-3">
                <button
                  type="button"
                  onClick={() => setMineOnly((v) => !v)}
                  className={`w-full flex items-center gap-2 text-xs font-semibold px-3 py-2 rounded-md border transition-colors ${
                    mineOnly
                      ? "bg-emerald-600 text-white border-emerald-600 shadow"
                      : "bg-emerald-50 text-emerald-800 border-emerald-300 hover:border-emerald-500"
                  }`}
                  title="只在地图上显示你本人识别上传的植物记录；再次点击恢复显示所有人的识别"
                >
                  <span aria-hidden="true">🙋</span>
                  <span className="flex-1 text-left">只显示我识别的植物</span>
                  <span className={mineOnly ? "opacity-90" : "text-emerald-600"}>{mineCount}</span>
                </button>
                {mineOnly && (
                  <p className="mt-1.5 text-[10px] text-ink-faint leading-relaxed">
                    当前只显示<b className="text-emerald-700">你识别的 {mineCount} 条记录</b>；再次点击可恢复显示所有人的识别。
                  </p>
                )}
              </div>
            )}

            {!isLoading && invasiveCount > 0 && (
              <div className="mb-3">
                <button
                  type="button"
                  onClick={() => setInvasiveOnly((v) => !v)}
                  className={`w-full flex items-center gap-2 text-xs font-semibold px-3 py-2 rounded-md border transition-colors ${
                    invasiveOnly
                      ? "bg-red-600 text-white border-red-600 shadow"
                      : "bg-red-50 text-red-700 border-red-300 hover:border-red-500"
                  }`}
                  title="只在地图上显示 GBIF/GRIIS 确认的中国外来入侵物种，并叠加其在中国的分布点"
                >
                  <span aria-hidden="true">⚠️</span>
                  <span className="flex-1 text-left">只显示外来入侵物种分布</span>
                  <span className={invasiveOnly ? "opacity-90" : "text-red-500"}>{invasiveCount}</span>
                </button>
                {invasiveOnly && (
                  <p className="mt-1.5 text-[10px] text-ink-faint leading-relaxed">
                    实心红三角＝本站实拍的入侵种记录；淡色空心三角＝
                    <b className="text-red-600">GBIF 参考分布点</b>（中国境内，精度较粗，仅供参考）。
                    {gbifLoading && <span className="animate-pulse"> · 正在载入分布…</span>}
                    {!gbifLoading && gbifOcc && <span> · 共 {gbifOcc.points.length} 个分布点</span>}
                  </p>
                )}
              </div>
            )}

            {!isLoading && protectedCount > 0 && (
              <div className="mb-3">
                <button
                  type="button"
                  onClick={() => setProtectedOnly((v) => !v)}
                  className={`w-full flex items-center gap-2 text-xs font-semibold px-3 py-2 rounded-md border transition-colors ${
                    protectedOnly
                      ? "bg-amber-600 text-white border-amber-600 shadow"
                      : "bg-amber-50 text-amber-800 border-amber-300 hover:border-amber-500"
                  }`}
                  title="只在地图上显示匹配「国家和各省重点保护目录」的物种记录"
                >
                  <span aria-hidden="true">🛡️</span>
                  <span className="flex-1 text-left">只显示重点保护物种</span>
                  <span className={protectedOnly ? "opacity-90" : "text-amber-600"}>{protectedCount}</span>
                </button>
                {protectedOnly && (
                  <>
                    <p className="mt-1.5 text-[10px] text-ink-faint leading-relaxed">
                      金色盾牌＝匹配<b className="text-amber-700">国家/省级重点保护名录</b>的实拍记录（按学名匹配，含属级/科级条目）。
                    </p>
                    {/* 站长 / 资深编辑：此视图下切到精确坐标，供日后导出授权给科研机构或政府部门。
                        这块提示必须显眼 —— 屏幕上正摆着一份不该外传的数据，得让人知道自己在看什么。 */}
                    {canSeeExact && (
                      <div className="mt-2 rounded-md border border-emerald-400 bg-emerald-50 px-2.5 py-2">
                        <p className="text-[10px] font-bold text-emerald-900 leading-snug">
                          🔓 精确坐标模式{exactLoading && <span className="animate-pulse font-normal"> · 载入中…</span>}
                        </p>
                        <p className="mt-1 text-[10px] text-emerald-800 leading-relaxed">
                          你的身份为<b>{myRoles?.isOwner ? "网站所有者" : "资深编辑"}</b>，本视图显示的是保护物种的
                          <b>真实 GPS 坐标</b>（其他人看到的是模糊值）。请勿截图外传；关闭本开关即恢复模糊显示。
                        </p>
                      </div>
                    )}
                  </>
                )}
              </div>
            )}

            {/* 图例：分布点 4 类配色 — 移到侧边栏"只显示重点保护植物"按钮下方 */}
            <div className="mb-3 bg-paper border border-ink/10 rounded-lg px-3 py-2.5 text-[11px] text-ink-soft">
              <p className="font-semibold text-ink mb-1.5 text-xs">分布点图例</p>
              <div className="grid grid-cols-2 gap-x-3 gap-y-1.5">
                {([
                  ["#2563eb", "未采纳"],
                  ["#2e9e5b", "已采纳"],
                  ["#dc2626", "入侵物种"],
                  ["#b45309", "重点保护"],
                ] as const).map(([color, label]) => (
                  <div key={label} className="flex items-center gap-1.5">
                    <span className="inline-block w-3 h-3 rounded-full border border-white shadow" style={{ background: color }} />
                    {label}
                  </div>
                ))}
              </div>
              <p className="mt-1.5 text-[9px] text-ink-faint leading-snug">多点重叠时圈内数字为物种数；点开聚合圆会在右侧展开物种卡片。</p>
            </div>

            {!isLoading && areaGroups.length > 0 && (
              <div className="mb-3">
                <p className="label text-[10px] text-ink-faint mb-1.5">最近上传识别地区（6个）</p>
                <div className="flex flex-wrap gap-1.5 max-h-24 overflow-y-auto pr-1">
                  <button
                    type="button"
                    onClick={() => setSelectedArea(null)}
                    className={`text-[11px] px-2 py-0.5 rounded-full border transition-colors ${
                      selectedArea === null
                        ? "bg-vermilion text-background border-vermilion"
                        : "border-ink/15 text-ink-soft hover:border-vermilion"
                    }`}
                  >
                    全部 <span className={selectedArea === null ? "opacity-90" : "text-ink-faint"}>{sightings.length}</span>
                  </button>
                  {areaGroups.map((g) => (
                    <button
                      key={g.area}
                      type="button"
                      onClick={() => setSelectedArea((cur) => (cur === g.area ? null : g.area))}
                      title={`${g.area} · ${g.items.length} 条识别记录`}
                      className={`text-[11px] px-2 py-0.5 rounded-full border transition-colors ${
                        selectedArea === g.area
                          ? "bg-vermilion text-background border-vermilion"
                          : "border-ink/15 text-ink-soft hover:border-vermilion"
                      }`}
                    >
                      {g.area} <span className={selectedArea === g.area ? "opacity-90" : "text-ink-faint"}>{g.items.length}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {isLoading ? (
              <p className="text-xs text-ink-faint animate-pulse">正在载入物种标记…</p>
            ) : sortedSightings.length === 0 ? (
              <p className="text-xs text-ink-soft bg-paper-deep/60 p-3 border border-rule/40 rounded leading-relaxed">
                还没有带定位的识别记录。用手机到「AI 识别」页拍照（并允许定位），就能在这里点亮第一个物种。
              </p>
            ) : (
              <>
                <p className="label text-[10px] text-ink-faint mb-1.5">最新识别物种（6个）</p>
                <div className="space-y-2 max-h-52 overflow-y-auto pr-1">
                  {visibleSightings.slice(0, 6).map((p: GeoSighting) => (
                  <a
                    key={p.id}
                    href={`/drafts/${p.id}`}
                    className="flex items-center gap-2 text-xs py-1.5 border-b border-ink/10 hover:text-vermilion"
                  >
                    <span
                      className={
                        isInvasiveSighting(p)
                          ? "text-red-600"
                          : isProtectedSighting(p)
                            ? "text-amber-600"
                            : "text-emerald-600"
                      }
                    >
                      {isInvasiveSighting(p) ? "⚠️" : isProtectedSighting(p) ? "🛡️" : "🌱"}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="font-semibold truncate text-ink">{p.title}</p>
                      <p className="text-[10px] text-ink-faint truncate" title={p.capture_place || undefined}>
                        {displayPlace(p.capture_place) || p.scientific_name || "未知地点"}
                      </p>
                    </div>
                    {permissionState === "granted" && userCoords && (
                      <span className="text-[10px] text-ink-faint shrink-0">
                        约 {haversineKm(userCoords, [p.capture_lat, p.capture_lng]).toFixed(1)} km
                      </span>
                    )}
                  </a>
                ))}
              </div>
              </>
            )}

            {permissionState === "denied" && (
              <p className="mt-4 text-[10px] text-vermilion bg-vermilion/10 p-2 border border-vermilion/20 rounded">
                ⚠️ 未能获取你的位置，已展示全部带定位的识别记录。允许浏览器定位后可按距离排序。
              </p>
            )}
          </div>
        )}

        {/* Base-layer switcher: 平面 / 卫星 */}
        <div className="absolute bottom-4 left-4 z-[500] flex rounded-full overflow-hidden border border-ink/20 shadow-xl bg-background/95 backdrop-blur-md text-xs">
          {(Object.keys(BASE_LAYERS) as BaseMode[]).map((mode) => (
            <button
              key={mode}
              type="button"
              onClick={() => setBaseMode(mode)}
              className={`px-3 py-1.5 transition-colors ${
                baseMode === mode ? "bg-ink text-background" : "text-ink-soft hover:text-vermilion"
              }`}
            >
              {BASE_LAYERS[mode].label}
            </button>
          ))}
        </div>

        {/* Map */}
        <div id="explore-map" className="w-full h-full flex-1 bg-[#eaeae4]" />

        {/* Route bar (appears only after 加入路线/设为终点 from a popup or fan card) */}
        {routeStops.length > 0 && (
          <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-[600] w-[min(680px,calc(100vw-2rem))] bg-background/95 backdrop-blur-md border border-ink/15 px-3 py-2 rounded-xl shadow-2xl">
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-[11px] font-semibold text-ink">路线规划 · {routeStops.length} 点</span>
              {routeInfo && (
                <span className="text-[11px] text-emerald-700">
                  全程 {(routeInfo.distance / 1000).toFixed(1)} km · {Math.round(routeInfo.time / 60)} 分钟
                </span>
              )}
            </div>
            <div className="flex gap-1.5 overflow-x-auto pb-1 mb-1.5">
              {/* 起点固定为我的当前位置 */}
              <span className="inline-flex items-center gap-1 text-[10px] bg-paper-deep/60 border border-ink/10 rounded-lg pl-1 pr-1.5 py-0.5 shrink-0">
                <span className="w-4 h-4 rounded text-white flex items-center justify-center text-[9px] font-bold" style={{ background: userCoords ? "#16a34a" : "#9ca3af" }}>起</span>
                <span className="text-ink">{userCoords ? "我的位置" : "（需定位）"}</span>
              </span>
              {routeStops.map((s, i) => {
                const role = i === routeStops.length - 1 ? "终" : "途";
                const roleBg = role === "终" ? "#c2410c" : "#2563eb";
                return (
                  <span key={s.id} className="inline-flex items-center gap-1 text-[10px] bg-paper-deep/60 border border-ink/10 rounded-lg pl-1 pr-1 py-0.5 shrink-0">
                    <span className="w-4 h-4 rounded text-white flex items-center justify-center text-[9px] font-bold" style={{ background: roleBg }}>{role}</span>
                    <span className="max-w-[72px] truncate text-ink">{s.title}</span>
                    <button type="button" onClick={() => moveStop(i, -1)} disabled={i === 0} className="text-ink-faint disabled:opacity-30 hover:text-vermilion px-0.5" aria-label="左移">◀</button>
                    <button type="button" onClick={() => moveStop(i, 1)} disabled={i === routeStops.length - 1} className="text-ink-faint disabled:opacity-30 hover:text-vermilion px-0.5" aria-label="右移">▶</button>
                    <button type="button" onClick={() => removeStop(s.id)} className="text-ink-faint hover:text-vermilion px-0.5" aria-label="移除">✕</button>
                  </span>
                );
              })}
            </div>
            {routeMsg && <p className="text-[11px] text-vermilion mb-1.5">{routeMsg}</p>}
            <div className="flex gap-1.5">
              <button type="button" onClick={generateRoute} disabled={routeStops.length < 1 || !userCoords} className="flex-1 text-[11px] py-1 rounded-lg bg-ink text-background disabled:opacity-40">
                生成路线
              </button>
              <button type="button" onClick={navigateRoute} disabled={routeStops.length < 1 || !userCoords} className="flex-1 text-[11px] py-1 rounded-lg bg-vermilion text-background disabled:opacity-40">
                立即导航
              </button>
              <button type="button" onClick={clearRoute} className="text-[11px] px-2.5 py-1 rounded-lg border border-ink/15 text-ink-soft hover:border-vermilion">
                清空
              </button>
            </div>
          </div>
        )}

        {/* Fan-out overlay (hidden while the generated-route preview is showing) */}
        {!routeFanActive && fan && (
          <>
            <button
              type="button"
              onClick={() => setExpanded(null)}
              className="absolute z-[600] top-4 left-1/2 -translate-x-1/2 rounded-full bg-ink text-background text-xs px-3 py-1.5 shadow-xl hover:bg-vermilion transition-colors"
            >
              收起 · {fan.cards.length} 个物种 ✕
            </button>

            <div className="absolute inset-0 z-[450] pointer-events-none">
              <svg width={fan.W} height={fan.H} className="absolute inset-0">
                {fan.cards.flatMap((c) =>
                  c.links.map((p, k) => (
                    <g key={`g-${c.i}-${k}`}>
                      <line x1={fan.cardX} y1={c.cy} x2={p.x} y2={p.y} stroke="#2e9e5b" strokeWidth={1.5} strokeDasharray="5 4" strokeOpacity={0.85} />
                      <circle cx={p.x} cy={p.y} r={6} fill="#2e9e5b" fillOpacity={0.25} stroke="#2e9e5b" strokeWidth={1.5} />
                    </g>
                  )),
                )}
                {fan.cards.map((c) => {
                  const elbowX = fan.cardX - 30;
                  return (
                    <polyline
                      key={`b-${c.i}`}
                      points={`${fan.center.x},${fan.center.y} ${elbowX},${c.cy} ${fan.cardX},${c.cy}`}
                      fill="none"
                      stroke="#1e1008"
                      strokeWidth={1.4}
                      strokeOpacity={0.7}
                    />
                  );
                })}
                <circle cx={fan.center.x} cy={fan.center.y} r={5} fill="#1e1008" />
                <circle cx={fan.center.x} cy={fan.center.y} r={10} fill="none" stroke="#1e1008" strokeOpacity={0.35} strokeWidth={1.5} />
              </svg>

              {fan.cards.map((c) => {
                const thumb = Math.max(30, fan.cardH);
                return (
                  <div
                    key={c.s.id}
                    className="absolute pointer-events-auto bg-background/95 backdrop-blur-sm border border-ink/20 rounded-md shadow-xl overflow-hidden flex items-stretch hover:border-vermilion transition-colors"
                    style={{ left: fan.cardX, top: c.top, width: fan.cardW, height: fan.cardH }}
                    title={`${c.s.title}${c.s.scientific_name ? ` · ${c.s.scientific_name}` : ""}`}
                  >
                    {/* 右上角类型角标：入侵红 / 保护棕 / 已采纳绿 / 未采纳蓝 */}
                    <span
                      className="absolute top-0 right-0 z-10 px-1 py-px rounded-bl text-[8px] font-bold text-white leading-none"
                      style={{ background: CAT_COLOR[categoryOf(c.s)] }}
                    >
                      {CAT_LABEL[categoryOf(c.s)]}
                    </span>
                    <a href={`/drafts/${c.s.id}`} className="relative h-full shrink-0 bg-paper-deep flex items-center justify-center text-emerald-600" style={{ width: thumb }}>
                      🌱
                      {c.s.photo_url && (
                        <img
                          src={c.s.photo_url}
                          alt=""
                          className="absolute inset-0 w-full h-full object-cover"
                          onError={(e) => {
                            e.currentTarget.style.display = "none";
                          }}
                        />
                      )}
                    </a>
                    <div className="min-w-0 flex-1 px-2 py-1 flex flex-col justify-center gap-0.5">
                      <a href={`/drafts/${c.s.id}`} className="block min-w-0 hover:text-vermilion">
                        <p className="font-semibold text-ink text-xs leading-tight truncate">{c.s.title}</p>
                        {c.s.scientific_name && (
                          <p className="italic text-[10px] text-ink-soft leading-tight truncate">{c.s.scientific_name}</p>
                        )}
                      </a>
                      <div className="flex gap-1 mt-0.5">
                        <button type="button" onClick={() => setAsWaypoint(c.s)} className="text-[9px] px-1.5 py-0.5 rounded font-semibold" style={{ background: "#2563eb", color: "#fff" }}>设为途经</button>
                        <button type="button" onClick={() => setAsDestination(c.s)} className="text-[9px] px-1.5 py-0.5 rounded font-semibold" style={{ background: "#c2410c", color: "#fff" }}>设为终点</button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}

        {/* Generated-route radial preview: each route stop → a right-side card */}
        {routeFan && (
          <>
            <button
              type="button"
              onClick={() => setRouteFanActive(false)}
              className="absolute z-[600] top-4 left-1/2 -translate-x-1/2 rounded-full bg-ink text-background text-xs px-3 py-1.5 shadow-xl hover:bg-vermilion transition-colors"
            >
              收起路线预览 · {routeFan.cards.length} 点 ✕
            </button>

            <div className="absolute inset-0 z-[450] pointer-events-none">
              <svg width={routeFan.W} height={routeFan.H} className="absolute inset-0">
                {routeFan.cards.map((c) => {
                  const elbowX = routeFan.cardX - 28;
                  return (
                    <g key={`rf-${c.s.id}`}>
                      <polyline
                        points={`${c.mx},${c.my} ${elbowX},${c.cy} ${routeFan.cardX},${c.cy}`}
                        fill="none"
                        stroke="#c2410c"
                        strokeWidth={1.6}
                        strokeOpacity={0.8}
                      />
                      <circle cx={c.mx} cy={c.my} r={5} fill="#c2410c" />
                    </g>
                  );
                })}
              </svg>

              {routeFan.cards.map((c) => {
                const thumb = Math.max(30, routeFan.cardH);
                return (
                  <div
                    key={c.s.id}
                    className="absolute pointer-events-auto bg-background/95 backdrop-blur-sm border border-ink/20 rounded-md shadow-xl overflow-hidden flex items-stretch"
                    style={{ left: routeFan.cardX, top: c.top, width: routeFan.cardW, height: routeFan.cardH }}
                    title={`${c.s.title}${c.s.scientific_name ? ` · ${c.s.scientific_name}` : ""}`}
                  >
                    <a href={`/drafts/${c.s.id}`} className="relative h-full shrink-0 bg-paper-deep flex items-center justify-center text-emerald-600" style={{ width: thumb }}>
                      🌱
                      {c.s.photo_url && (
                        <img
                          src={c.s.photo_url}
                          alt=""
                          className="absolute inset-0 w-full h-full object-cover"
                          onError={(e) => {
                            e.currentTarget.style.display = "none";
                          }}
                        />
                      )}
                    </a>
                    <div className="min-w-0 flex-1 px-2 py-1 flex flex-col justify-center gap-0.5">
                      <div className="flex items-center gap-1">
                        <span className="w-4 h-4 rounded text-white flex items-center justify-center text-[9px] font-bold shrink-0" style={{ background: c.role === "终" ? "#c2410c" : "#2563eb" }}>{c.role}</span>
                        <a href={`/drafts/${c.s.id}`} className="font-semibold text-ink text-xs leading-tight truncate hover:text-vermilion">{c.s.title}</a>
                      </div>
                      {c.s.scientific_name && (
                        <p className="italic text-[10px] text-ink-soft leading-tight truncate">{c.s.scientific_name}</p>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </main>
      <SiteFooter />

      <style>{`
        .amap-info-content { border-radius:6px; }
      `}</style>
    </div>
  );
}
