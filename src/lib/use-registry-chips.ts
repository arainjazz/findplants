import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  fetchConservationData,
  buildConservationMatcher,
  registryChips,
  type RegistryChip,
} from "@/lib/conservation";
import { fetchAllCatalogs, fetchAllEntries, normalizeSciName, regionLabel } from "@/lib/catalogs";

/**
 * Compute the registry chip row for one plant: 重点保护名录 · CITES · GTS · GRIIS ·
 * 地区植物名录 · tag 标签. Shared by the draft page and the published detail page so
 * both read identically.
 *
 * Reuses the SAME react-query keys the map / 档案检索 pages already use
 * (["conservation-data"], ["all-catalogs"], ["all-catalog-entries"]), so the registry
 * tables are fetched once per session and served from cache here.
 */
export function useRegistryChips(plant: {
  scientific_name?: string | null;
  family?: string | null;
  tags?: string[] | null;
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

  const sci = plant.scientific_name ?? null;
  const family = plant.family ?? null;
  const tags = plant.tags ?? null;

  return useMemo(() => {
    if (!consData && !entries.length) return [];
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

    return registryChips(hit, consData?.lists ?? [], {
      catalogNames,
      tags: (tags ?? []).filter(Boolean),
    });
  }, [consData, catalogs, entries, sci, family, tags]);
}
