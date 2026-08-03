/**
 * 身边物种地图的数据源 —— **带重点保护物种坐标脱敏的服务端闸门**。
 *
 * ## 为什么从客户端直查改成服务端函数
 * 原先 `fetchGeoSightings()` 在浏览器里拿 anon key 直查 `plant_drafts`。那样的话，
 * 无论前端怎么"模糊"，**精确坐标都已经躺在网络响应里了** —— 打开开发者工具就能看到，
 * 等于没做。脱敏要有意义，就必须在数据离开服务器之前完成。所以坐标模糊化、名录匹配、
 * 身份判定全部收进这里，浏览器拿到的就只有模糊值。
 *
 * ## 两个入口，两种权限
 *  - {@link geoSightingsFn}      公开、无鉴权，保护物种**恒为模糊坐标**。
 *  - {@link geoSightingsExactFn} 需登录，且必须是**站长或资深编辑**，返回精确坐标。
 *
 * 拆成两个函数而不是一个带 `exact` 开关的：开关意味着"信任前端传来的布尔值"，
 * 哪天中间件漏了一层就直接漏数据。分开写的话，公开那条路径的代码里根本不存在
 * "返回精确坐标"这个分支。
 *
 * ## ⚠️ 仍然敞着的口子（需要在 Supabase dashboard 补一刀）
 * `plant_drafts` 至今对 anon 角色有 `GRANT SELECT`（见 all_migrations.sql:1088）。
 * 也就是说，拿着前端 bundle 里的 anon key 直接打 PostgREST，照样能读到精确的
 * `capture_lat/capture_lng`。本文件挡住的是**本站所有界面**，挡不住绕开界面直连 API 的人。
 * 要彻底堵死，得把精确坐标从 anon 可读范围里摘出去（见 docs/protected-coords.md）。
 */

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { coarsenPlace, fuzzCoord } from "@/lib/protected-coords";
import type { GeoSighting } from "@/lib/drafts";

const Input = z.object({ limit: z.number().int().min(1).max(2000).optional() });

/** 与旧客户端查询完全一致的列集合，改这里要同步 GeoSighting。 */
const BASE =
  "id,title,scientific_name,family,genus,capture_lat,capture_lng,capture_place," +
  "photo_url,status,published_plant_id,created_at,created_by";

type Row = Record<string, unknown>;

/**
 * 名录匹配器。与识别流程（identify-plant.functions.ts）同一套：分页拉全 `conservation_taxa`
 * —— 这张表两千多行，PostgREST 默认 1000 行封顶，不分页会让后播种的名录整段匹配不上。
 */
async function loadMatcher() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const listsRes = await supabaseAdmin
    .from("conservation_lists")
    .select("id,kind,name,province,source_note,source_url,created_by");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const lists = (listsRes.data ?? []) as any[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const taxa: any[] = [];
  for (let from = 0; ; from += 1000) {
    const { data } = await supabaseAdmin
      .from("conservation_taxa")
      .select("list_id,scientific_name,chinese_name,normalized_name,status,rank,excluded_names")
      .range(from, from + 999);
    const rows = data ?? [];
    taxa.push(...rows);
    if (rows.length < 1000) break;
  }
  const { buildConservationMatcher } = await import("./conservation");
  return {
    match: buildConservationMatcher({ lists, taxa }),
    nameById: new Map<string, string>(lists.map((l) => [l.id as string, l.name as string])),
  };
}

/**
 * 拉草稿 → 逐条匹配名录 → 命中重点保护的按需脱敏。
 *
 * `exact=true` 只由 {@link geoSightingsExactFn} 在**验完身份之后**传进来；公开入口
 * 压根不传这个参数。
 */
async function loadSightings(limit: number, exact: boolean): Promise<GeoSighting[]> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  // 与旧实现同样的降级梯子：invasive 列 / 送审闸门任一迁移没跑，也不能让地图整个白掉。
  const run = (cols: string, gated: boolean) => {
    let q = supabaseAdmin
      .from("plant_drafts")
      .select(cols)
      .not("capture_lat", "is", null)
      .not("capture_lng", "is", null)
      .neq("status", "rejected");
    if (gated) q = q.eq("submitted_for_review", true);
    return q.order("created_at", { ascending: false }).limit(limit);
  };

  let { data, error } = await run(`${BASE},is_invasive,gbif_taxon_key`, true);
  if (error) {
    console.warn("[geoSightings] gated/invasive columns missing, falling back:", error.message);
    ({ data, error } = await run(`${BASE},is_invasive,gbif_taxon_key`, false));
  }
  if (error) ({ data, error } = await run(BASE, false));
  if (error) throw error;

  const { match, nameById } = await loadMatcher();

  // 三级降级梯子让 `data` 的推断类型退化成联合类型，只能穿 unknown 落到 Row[]。
  return ((data ?? []) as unknown as Row[])
    .filter((d) => typeof d.capture_lat === "number" && typeof d.capture_lng === "number")
    .map((d) => {
      const id = d.id as string;
      const lat = d.capture_lat as number;
      const lng = d.capture_lng as number;
      const hit = match(
        (d.scientific_name as string | null) ?? null,
        (d.family as string | null) ?? null,
      );
      const isProtected = hit.protectedLists.size > 0;
      // 命中的第一份名录名（「国家（2021）」/「内蒙古（2009）」）——气泡上要显示。
      const protectedLabel =
        [...hit.protectedLists.keys()].map((k) => nameById.get(k) || "").find(Boolean) ?? null;
      const fuzzed = isProtected && !exact;
      const c = fuzzed ? fuzzCoord(lat, lng, id) : { lat, lng };
      return {
        id,
        title: d.title as string,
        scientific_name: (d.scientific_name as string | null) ?? null,
        family: (d.family as string | null) ?? null,
        genus: (d.genus as string | null) ?? null,
        capture_lat: c.lat,
        capture_lng: c.lng,
        // 坐标模糊了、地点却写着整条街道地址，等于没模糊 —— 一起粗化到区/县/旗。
        capture_place: fuzzed
          ? coarsenPlace(d.capture_place as string | null)
          : ((d.capture_place as string | null) ?? null),
        photo_url: d.photo_url as string,
        status: d.status as GeoSighting["status"],
        published_plant_id: (d.published_plant_id as string | null) ?? null,
        is_invasive: !!d.is_invasive,
        gbif_taxon_key: (d.gbif_taxon_key as number | null) ?? null,
        created_at: d.created_at as string,
        created_by: (d.created_by as string | null) ?? null,
        is_protected: isProtected,
        protected_label: protectedLabel,
        coords_fuzzed: fuzzed,
      };
    });
}

/** 公开地图数据。保护物种的坐标与地点**一律**已脱敏，这条路径没有别的分支。 */
export const geoSightingsFn = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => Input.parse(input ?? {}))
  .handler(async ({ data }): Promise<GeoSighting[]> => loadSightings(data.limit ?? 500, false));

/**
 * 精确坐标。**仅站长或资深编辑** —— 站长要拿这份数据将来授权给科研机构 / 政府部门，
 * 所以这里返回的是未经任何处理的原始 GPS 值。
 *
 * 身份在服务端重新解析（`resolveRoles` 与采纳 / 撤销闸门同一份判据），前端传什么都不作数。
 */
export const geoSightingsExactFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => Input.parse(input ?? {}))
  .handler(async ({ data, context }): Promise<GeoSighting[]> => {
    const { userId, claims } = context as {
      userId: string;
      claims: Record<string, unknown> | undefined;
    };
    const { resolveRoles } = await import("./roles.functions");
    const roles = await resolveRoles(userId, claims);
    if (!roles.isSenior) throw new Error("仅网站所有者或资深编辑可查看保护物种的精确坐标");
    return loadSightings(data.limit ?? 500, true);
  });
