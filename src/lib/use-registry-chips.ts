import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  fetchConservationData,
  buildConservationMatcher,
  registryChips,
  type RegistryChip,
} from "@/lib/conservation";
import { fetchAllCatalogs, fetchAllEntries, normalizeSciName, regionLabel } from "@/lib/catalogs";
import { fetchAllTags, fetchAllPlantTags } from "@/lib/tags";

/**
 * Compute the registry chip row for one plant: 主题标签 · 重点保护名录 · CITES · GTS ·
 * GRIIS · 地区植物名录 · 特征词. Shared by the draft page and the published detail page
 * so both read identically.
 *
 * Reuses the SAME react-query keys the map / 档案检索 pages already use
 * (["conservation-data"], ["all-catalogs"], ["all-catalog-entries"], ["all-tags"],
 * ["all-plant-tags"]), so those tables are fetched once per session and served from
 * cache here.
 *
 * ⚠️ **主题标签在草稿和已发布条目上存的地方不一样**，别以为传个 tags 就够了：
 *  - 草稿：TagPicker 直接写进 `plant_drafts.tags`（text[]），与 AI 填的特征词同一个数组
 *    —— 靠「名字在不在 tags 表里」把两者分开。
 *  - 已发布条目：编辑器写的是 `plant_tags` **关联表**（保存时算 tagIdsToAdd/Remove），
 *    `plants.tags` 里存的只是特征词。所以详情页必须额外传 `plantId`，否则手动挂的
 *    主题标签在卡签里一个都不会出现。
 */
export function useRegistryChips(plant: {
  scientific_name?: string | null;
  family?: string | null;
  tags?: string[] | null;
  /** 已发布条目的 id。给了才会把 `plant_tags` 里挂着的主题标签也算进来。 */
  plantId?: string | null;
}): RegistryChip[] {
  const { data: consData } = useQuery({
    queryKey: ["conservation-data"],
    queryFn: fetchConservationData,
    staleTime: 5 * 60 * 1000,
  });
  const { data: catalogs = [] } = useQuery({
    queryKey: ["all-catalogs"],
    queryFn: fetchAllCatalogs,
    staleTime: 5 * 60 * 1000,
  });
  const { data: entries = [] } = useQuery({
    queryKey: ["all-catalog-entries"],
    queryFn: fetchAllEntries,
    staleTime: 5 * 60 * 1000,
  });
  // 已建的主题标签。**只用来区分**「人手动挂的主题标签」和「AI 自动填的特征词」——
  // 两者都躺在同一个 tags text[] 里，光看数组分不出来。命中 tags 表的排最前、绿框、可点。
  // 复用 ["all-tags"] 这个 key（首页/检索页/标签管理页都在用），一个会话只拉一次。
  const { data: allTags = [] } = useQuery({
    queryKey: ["all-tags"],
    queryFn: fetchAllTags,
    staleTime: 5 * 60 * 1000,
  });

  // 已发布条目的主题标签在关联表里。用**全表**那一份（首页 / 档案检索页已经在用同一个
  // key），而不是 fetchTagsForPlant(id) 每页一查 —— 同一会话里换页看条目就不用反复查。
  const plantId = plant.plantId ?? null;
  const { data: allPlantTags = [] } = useQuery({
    queryKey: ["all-plant-tags"],
    queryFn: fetchAllPlantTags,
    enabled: !!plantId,
    staleTime: 5 * 60 * 1000,
  });

  const sci = plant.scientific_name ?? null;
  const family = plant.family ?? null;
  const tags = plant.tags ?? null;

  return useMemo(() => {
    // ⚠️ 这里刻意**不**因为「名录还没加载」就早退成 []：手动挂的主题标签只依赖 tags 表，
    // 与保护名录毫无关系。早退会让用户刚点完「手动添加 #tag 标签」、卡签那一排却是空的
    // （名录表是两千多行、要分页拉，慢得多），看起来像是没保存上。
    if (!consData && !entries.length && !allTags.length) return [];
    const hit = buildConservationMatcher(consData ?? { lists: [], taxa: [] })(sci, family);

    // Which 地区植物名录 list this species — matched on normalized Latin name, the same
    // rule buildPlantMatcher uses, so a plant is chipped by exactly the catalogs that
    // would link to it elsewhere.
    const norm = normalizeSciName(sci);
    const catalogNames: string[] = [];
    if (norm) {
      const catById = new Map(catalogs.map((c) => [c.id, c]));
      const seen = new Set<string>();
      for (const e of entries) {
        if (normalizeSciName(e.scientific_name) !== norm) continue;
        const c = catById.get(e.catalog_id);
        if (!c || seen.has(c.id)) continue;
        seen.add(c.id);
        catalogNames.push(regionLabel(c));
      }
    }

    // 关联表里挂着的主题标签，排在数组最前 —— registryChips 是按传入顺序吐 chip 的，
    // 所以「先挂的先出现」，与编辑器里的勾选顺序无关但至少稳定。
    const attached: string[] = [];
    if (plantId) {
      const tagById = new Map(allTags.map((t) => [t.id, t.name]));
      for (const row of allPlantTags) {
        if (row.plant_id !== plantId) continue;
        const nm = tagById.get(row.tag_id);
        if (nm) attached.push(nm);
      }
    }
    // 去重：一个标签既可能挂在关联表上，又恰好被 AI 写进了 tags 数组。
    const merged = Array.from(new Set([...attached, ...(tags ?? []).filter(Boolean)]));

    return registryChips(hit, consData?.lists ?? [], {
      catalogNames,
      tags: merged,
      // slug 从库里带走，不现算 —— 见 RegistryChip.slug 的注释。
      knownTags: new Map(allTags.map((t) => [t.name, t.slug])),
    });
  }, [consData, catalogs, entries, allTags, allPlantTags, plantId, sci, family, tags]);
}
