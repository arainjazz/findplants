import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState, useEffect } from "react";
import { zodValidator, fallback } from "@tanstack/zod-adapter";
import { z } from "zod";
import { SiteHeader, SiteFooter } from "@/components/site-header";
import { fetchPaginatedPlants, fetchPlantsMetadata, type Plant } from "@/lib/plants";
import { FilterDropdown } from "@/components/filter-dropdown";
import {
  fetchAllCatalogs,
  fetchAllEntries,
  fetchSuggestionsForCatalogs,
  createSuggestion,
  deleteSuggestion,
  appendEntries,
  parseCatalogText,
  buildPlantMatcher,
  normalizeSciName,
  IUCN_CATEGORIES,
  regionLabel,
  type RegionalCatalog,
  type CatalogEntry,
  type CatalogSuggestion,
} from "@/lib/catalogs";
import { fillChineseNames } from "@/lib/catalog-ai.functions";
import { useServerFn } from "@tanstack/react-start";
import { useAuth } from "@/hooks/use-auth";
import { toast } from "sonner";
import { fetchAllTags, fetchAllPlantTags, type TagWithCount } from "@/lib/tags";
import { fetchAiPlantIds } from "@/lib/drafts";
import {
  CITES_APPENDICES,
  GTS_CATEGORIES,
  GRIIS_DEGREES,
  protectedListRank,
  fetchConservationData,
  buildConservationMatcher,
  type ConservationTaxon,
} from "@/lib/conservation";

const searchSchema = z.object({
  family: fallback(z.string(), "").default(""),
  genus: fallback(z.string(), "").default(""),
  iucn: fallback(z.string(), "").default(""),
  region: fallback(z.string(), "").default(""), // 国家和各省重点保护目录: conservation list id
  tag: fallback(z.string(), "").default(""), // 归类标签 slug
  rcat: fallback(z.string(), "").default(""), // 地区名录（自建 regional_catalogs）region label
  cites: fallback(z.string(), "").default(""), // 华盛顿贸易管制 appendix: "I" | "II"
  gts: fallback(z.string(), "").default(""), // GTS 全球树木红色名录: "CR" | "EN" | "VU"
  griis: fallback(z.string(), "").default(""), // GRIIS degreeOfEstablishment
  type: fallback(z.string(), "").default(""), // "" | "ai" | "edited"
  page: fallback(z.number(), 1).default(1),
  q: fallback(z.string(), "").default(""),
});

export const Route = createFileRoute("/plants/")({
  head: () => ({
    meta: [
      { title: "已收录档案 · Plantspedia" },
      { name: "description", content: "浏览已收录的植物条目，含中文名、拉丁学名、英文俗名与科属信息。" },
    ],
  }),
  validateSearch: zodValidator(searchSchema),
  component: PlantsList,
});

const EMPTY_ID_SET = new Set<string>();

function PlantsList() {
  const { family, genus, iucn, region, tag, rcat, cites, gts, griis, type, page, q: searchVal } = Route.useSearch();
  const navigate = Route.useNavigate();

  const { data: plantsMetadata = [], isLoading: isMetaLoading } = useQuery({
    queryKey: ["plants-metadata"],
    queryFn: fetchPlantsMetadata,
  });

  const { data: catalogs = [] } = useQuery({ queryKey: ["all-catalogs"], queryFn: fetchAllCatalogs });
  const { data: catalogEntries = [] } = useQuery({ queryKey: ["all-catalog-entries"], queryFn: fetchAllEntries });
  const { data: allTags = [] } = useQuery<TagWithCount[]>({ queryKey: ["all-tags"], queryFn: fetchAllTags });
  const { data: allPlantTags = [] } = useQuery({ queryKey: ["all-plant-tags"], queryFn: fetchAllPlantTags });

  // Conservation registries (国家/省级重点保护 + CITES/GTS/GRIIS). Matcher is rank-aware.
  const { data: conservationData } = useQuery({ queryKey: ["conservation-data"], queryFn: fetchConservationData });
  const conservationMatcher = useMemo(
    () => buildConservationMatcher(conservationData ?? { lists: [], taxa: [] }),
    [conservationData],
  );
  const protectedLists = useMemo(
    () => (conservationData?.lists ?? []).filter((l) => l.kind === "protected"),
    [conservationData],
  );

  // Count of the site's *identified* (published) species per protected list and per
  // GRIIS degree — shown in the filter dropdowns as （n）.
  const conservationCounts = useMemo(() => {
    const protectedCount = new Map<string, number>();
    const griisCount = new Map<string, number>();
    for (const p of plantsMetadata) {
      const hit = conservationMatcher(p.scientific_name, (p as { family?: string | null }).family);
      for (const listId of hit.protectedLists.keys())
        protectedCount.set(listId, (protectedCount.get(listId) ?? 0) + 1);
      if (hit.griis) griisCount.set(hit.griis, (griisCount.get(hit.griis) ?? 0) + 1);
    }
    return { protectedCount, griisCount };
  }, [plantsMetadata, conservationMatcher]);

  // GRIIS degrees actually present in the loaded registry — the four-level scheme
  // is collapsed to the levels China's data really uses (drops levels we can't flag).
  const griisOptions = useMemo(() => {
    const griisListIds = new Set(
      (conservationData?.lists ?? []).filter((l) => l.kind === "griis").map((l) => l.id),
    );
    const present = new Set<string>();
    for (const t of conservationData?.taxa ?? [])
      if (griisListIds.has(t.list_id) && t.status) present.add(t.status);
    return GRIIS_DEGREES.filter((o) => present.has(o.value)).map((o) => {
      const n = conservationCounts.griisCount.get(o.value) ?? 0;
      return { ...o, label: `${o.label}（${n}）` };
    });
  }, [conservationData, conservationCounts]);

  // ---- bottom directory sections (full 名录 listings) ----
  const taxaByList = useMemo(() => {
    const m = new Map<string, ConservationTaxon[]>();
    for (const t of conservationData?.taxa ?? []) {
      const a = m.get(t.list_id);
      if (a) a.push(t);
      else m.set(t.list_id, [t]);
    }
    return m;
  }, [conservationData]);

  // Which taxa the site has actually published (for recorded vs unrecorded coloring).
  const recorded = useMemo(() => {
    const norms = new Set<string>();
    const genera = new Set<string>();
    for (const p of plantsMetadata) {
      const n = normalizeSciName(p.scientific_name);
      if (n) {
        norms.add(n);
        genera.add(n.split(" ")[0]);
      }
    }
    return { norms, genera };
  }, [plantsMetadata]);

  const orderedProtectedLists = useMemo(() => {
    const lists = [...protectedLists];
    lists.sort(
      (a, b) =>
        protectedListRank(a.province ?? a.name) - protectedListRank(b.province ?? b.name) ||
        a.name.localeCompare(b.name, "zh"),
    );
    return lists;
  }, [protectedLists]);

  const plantsByTag = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const pt of allPlantTags) {
      const a = m.get(pt.tag_id);
      if (a) a.push(pt.plant_id);
      else m.set(pt.tag_id, [pt.plant_id]);
    }
    return m;
  }, [allPlantTags]);

  const plantsById = useMemo(() => new Map(plantsMetadata.map((p) => [p.id, p])), [plantsMetadata]);

  const plantByNorm = useMemo(() => {
    const m = new Map<string, (typeof plantsMetadata)[number]>();
    for (const p of plantsMetadata) {
      const n = normalizeSciName(p.scientific_name);
      if (n && !m.has(n)) m.set(n, p);
    }
    return m;
  }, [plantsMetadata]);

  const taxonRecorded = (t: ConservationTaxon) =>
    t.rank === "genus"
      ? recorded.genera.has(t.normalized_name)
      : t.rank === "species"
      ? recorded.norms.has(t.normalized_name)
      : false;

  const [qInput, setQInput] = useState(searchVal);

  // 声明框: statement shown on dropdown-option hover (source for 保护目录, editor/time/ref for 标签).
  // Persists until another filter is applied; clicking it scrolls to that directory's section.
  const [statement, setStatement] = useState<{ text: string; anchorId: string } | null>(null);
  const scrollToId = (id: string) => document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });

  useEffect(() => {
    setQInput(searchVal);
  }, [searchVal]);

  const familyOptions = useMemo(() => {
    const s = new Set<string>();
    for (const p of plantsMetadata) {
      if (genus && p.genus?.trim() !== genus) continue;
      if (p.family?.trim()) s.add(p.family.trim());
    }
    return Array.from(s).sort().map((v) => ({ value: v, label: v }));
  }, [plantsMetadata, genus]);

  const genusOptions = useMemo(() => {
    const s = new Set<string>();
    for (const p of plantsMetadata) {
      if (family && p.family?.trim() !== family) continue;
      if (p.genus?.trim()) s.add(p.genus.trim());
    }
    return Array.from(s).sort().map((v) => ({ value: v, label: v }));
  }, [plantsMetadata, family]);

  const iucnCounts = useMemo(() => {
    const m: Record<string, number> = {};
    let unrated = 0;
    for (const p of plantsMetadata) {
      if (family && p.family?.trim() !== family) continue;
      if (genus && p.genus?.trim() !== genus) continue;
      if (p.iucn_status) m[p.iucn_status] = (m[p.iucn_status] ?? 0) + 1;
      else unrated += 1;
    }
    return { m, unrated };
  }, [plantsMetadata, family, genus]);

  const iucnOptions = useMemo(() => [
    ...IUCN_CATEGORIES.map((c) => ({
      value: c.code,
      label: `${c.code}·${c.zh}（${iucnCounts.m[c.code] ?? 0}）`,
    })),
  ], [iucnCounts]);

  // 国家和各省重点保护目录 — conservation_lists (kind=protected), ordered 国家 → 省级.
  const regionOptions = useMemo(() => {
    const lists = [...protectedLists];
    lists.sort(
      (a, b) =>
        protectedListRank(a.province ?? a.name) - protectedListRank(b.province ?? b.name) ||
        a.name.localeCompare(b.name, "zh"),
    );
    return lists.map((l) => {
      const n = conservationCounts.protectedCount.get(l.id) ?? 0;
      return {
        value: l.id,
        label: `${l.name}（${n}）`,
        hover: { text: l.source_note ?? `${l.name}·重点保护野生植物名录`, anchorId: `dir-${l.id}` },
      };
    });
  }, [protectedLists, conservationCounts]);

  // 归类标签 — separate dropdown. Hover shows who added it, when, and the reference (description).
  const tagOptions = useMemo(
    () =>
      allTags.map((t) => {
        const when = t.created_at ? new Date(t.created_at).toLocaleDateString("zh-CN") : "";
        const ref = t.description ? `；参考资料：${t.description}` : "";
        return {
          value: t.slug,
          label: `# ${t.name}（${t.plant_count}/${t.expected_count ?? t.plant_count}）`,
          hover: {
            text: `归类标签「${t.name}」：由 ${t.created_by_name ?? "编辑"} 于 ${when} 添加${ref}`,
            anchorId: `tag-${t.slug}`,
          },
        };
      }),
    [allTags],
  );

  const selectedRegion = region; // conservation protected list id
  const selectedTagSlug = tag;
  const selectedRcat = rcat; // user-curated regional_catalogs region label (browse panel)

  const regionPlantSlugs = useMemo(() => {
    const sets: Set<string>[] = [];
    // 重点保护目录 membership via the rank-aware conservation matcher.
    if (selectedRegion) {
      const s = new Set<string>();
      for (const p of plantsMetadata) {
        if (conservationMatcher(p.scientific_name, (p as { family?: string | null }).family).protectedLists.has(selectedRegion))
          s.add(p.id);
      }
      sets.push(s);
    }
    // 归类标签 membership.
    if (selectedTagSlug) {
      const s = new Set<string>();
      const tagObj = allTags.find((t) => t.slug === selectedTagSlug);
      if (tagObj) for (const pt of allPlantTags) if (pt.tag_id === tagObj.id) s.add(pt.plant_id);
      sets.push(s);
    }
    // 地区名录（自建 regional_catalogs）membership.
    if (selectedRcat) {
      const catIds = new Set(catalogs.filter((c) => regionLabel(c) === selectedRcat).map((c) => c.id));
      const match = buildPlantMatcher(plantsMetadata as any);
      const s = new Set<string>();
      for (const e of catalogEntries) {
        if (!catIds.has(e.catalog_id)) continue;
        const hit = match(e);
        if (hit) s.add(hit.id);
      }
      sets.push(s);
    }
    if (sets.length === 0) return null;
    sets.sort((a, b) => a.size - b.size);
    return new Set(Array.from(sets[0]).filter((id) => sets.every((s) => s.has(id))));
  }, [
    selectedRegion, selectedTagSlug, selectedRcat, conservationMatcher,
    catalogs, catalogEntries, plantsMetadata, allTags, allPlantTags,
  ]);

  const filteredMetadataIds = useMemo(() => {
    if (!family && !genus && !iucn) return null;
    const ids = new Set<string>();
    for (const p of plantsMetadata) {
      if (family && p.family?.trim() !== family) continue;
      if (genus && p.genus?.trim() !== genus) continue;
      if (iucn && p.iucn_status !== iucn) continue;
      ids.add(p.id);
    }
    return ids;
  }, [plantsMetadata, family, genus, iucn]);

  // Conservation-registry filters (CITES / GTS / GRIIS), matched via the shared rank-aware
  // matcher. Empty-safe until each registry is seeded. Returns null when none is active.
  const conservationIds = useMemo(() => {
    if (!cites && !gts && !griis) return null;
    const ids = new Set<string>();
    for (const p of plantsMetadata) {
      const hit = conservationMatcher(p.scientific_name, (p as { family?: string | null }).family);
      if (cites && hit.cites !== cites) continue;
      if (gts && hit.gts !== gts) continue;
      if (griis && hit.griis !== griis) continue;
      ids.add(p.id);
    }
    return ids;
  }, [plantsMetadata, cites, gts, griis, conservationMatcher]);

  const PAGE_SIZE = 15;
  const offset = (page - 1) * PAGE_SIZE;

  const { data: aiIdsData } = useQuery({ queryKey: ["ai-plant-ids"], queryFn: fetchAiPlantIds });
  const aiIds = aiIdsData ?? EMPTY_ID_SET;

  // Combine the region/tag filter with the 条目类型 (AI vs edited) filter into a
  // single inclusion id-list for the paginated query (null = no id constraint).
  const plantIdsFilter = useMemo(() => {
    let typeSet: Set<string> | null = null;
    if (type === "ai") typeSet = aiIds;
    else if (type === "edited")
      typeSet = new Set(plantsMetadata.filter((p) => !aiIds.has(p.id)).map((p) => p.id));
    // Intersect every active id-constraint (region/tag, 条目类型, conservation registries).
    const sets = [regionPlantSlugs, typeSet, conservationIds].filter(
      (s): s is Set<string> => s !== null,
    );
    if (sets.length === 0) return null;
    sets.sort((a, b) => a.size - b.size);
    return Array.from(sets[0]).filter((id) => sets.every((s) => s.has(id)));
  }, [regionPlantSlugs, type, aiIds, plantsMetadata, conservationIds]);

  const { data: paginatedData, isLoading: isListLoading } = useQuery({
    queryKey: ["plants-paginated", { family, genus, iucn, q: searchVal, page, plantIds: plantIdsFilter }],
    queryFn: () => fetchPaginatedPlants({
      limit: PAGE_SIZE,
      offset,
      family,
      genus,
      iucn,
      q: searchVal,
      plantIds: plantIdsFilter,
    }),
  });

  const paginatedPlants = paginatedData?.data ?? [];
  const totalCount = paginatedData?.count ?? 0;
  const totalPages = Math.ceil(totalCount / PAGE_SIZE) || 1;
  const isLoading = isMetaLoading || isListLoading;

  const setParam = (
    key: "family" | "genus" | "iucn" | "region" | "tag" | "rcat" | "cites" | "gts" | "griis" | "type" | "page" | "q",
    value: any,
  ) => {
    setStatement(null); // 点击其它筛选条件 → 声明框消失
    navigate({
      search: (prev) => {
        const next: Record<string, any> = { ...prev, [key]: value };
        if (key !== "page") {
          next.page = 1; // Reset to page 1 on any filter/search change
        }
        if (key === "genus" && value) {
          const hit = plantsMetadata.find((p) => p.genus?.trim() === value && p.family?.trim());
          if (hit?.family) next.family = hit.family.trim();
        }
        if (key === "family" && value && prev.genus) {
          const stillValid = plantsMetadata.some(
            (p) => p.family?.trim() === value && p.genus?.trim() === prev.genus,
          );
          if (!stillValid) next.genus = "";
        }
        return next as typeof prev;
      },
    });
  };

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setParam("q", qInput.trim());
  };

  return (
    <div className="min-h-screen flex flex-col">
      <SiteHeader />
      <main className="mx-auto max-w-5xl px-6 py-10 flex-1 w-full">
        <div id="filter-bar" className="border-b-2 border-ink pb-6 mb-2 flex items-end justify-between gap-6 flex-wrap scroll-mt-20">
          <div>
            <p className="label text-vermilion mb-2">Index · 已收录档案</p>
            <h1 className="font-display text-5xl font-bold">全部条目</h1>
            <p className="text-ink-faint mt-2">共 {plantsMetadata.length} 条收录</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <FilterDropdown
              label="国家和各省重点保护目录"
              value={region}
              options={regionOptions}
              onChange={(v) => setParam("region", v)}
              onOptionHover={setStatement}
            />
            <FilterDropdown
              label="归类标签"
              value={tag}
              options={tagOptions}
              onChange={(v) => setParam("tag", v)}
              onOptionHover={setStatement}
            />
            <FilterDropdown label="科" value={family} options={familyOptions} onChange={(v) => setParam("family", v)} />
            <FilterDropdown label="属" value={genus} options={genusOptions} onChange={(v) => setParam("genus", v)} />
            <FilterDropdown label="IUCN" value={iucn} options={iucnOptions} onChange={(v) => setParam("iucn", v)} />
            <FilterDropdown
              label="国际贸易管制"
              value={cites}
              options={CITES_APPENDICES}
              onChange={(v) => setParam("cites", v)}
            />
            <FilterDropdown label="GTS" value={gts} options={GTS_CATEGORIES} onChange={(v) => setParam("gts", v)} />
            <FilterDropdown
              label="GRIIS全球入侵等级"
              value={griis}
              options={griisOptions}
              onChange={(v) => setParam("griis", v)}
            />
            <FilterDropdown
              label="条目类型"
              value={type}
              options={[
                { value: "ai", label: "AI 识别条目" },
                { value: "edited", label: "编辑提交条目" },
              ]}
              emptyLabel="全部条目"
              onChange={(v) => setParam("type", v)}
            />
            <form onSubmit={handleSearchSubmit} className="flex items-center">
              <input
                value={qInput}
                onChange={(e) => setQInput(e.target.value)}
                placeholder="回车搜索…"
                className="border border-ink px-3 py-2 bg-transparent w-56 focus:outline-none focus:border-vermilion"
              />
            </form>
          </div>
        </div>

        {/* 声明框: appears on dropdown-option hover; click to jump to that directory. */}
        <div className="mb-8 min-h-[1.5rem]">
          {statement && (
            <button
              type="button"
              onClick={() => {
                scrollToId(statement.anchorId);
                setStatement(null);
              }}
              className="w-full text-left border-l-4 border-vermilion bg-paper-deep/30 px-4 py-3 text-sm text-ink hover:bg-paper-deep/60 transition-colors"
              title="点击查看完整目录"
            >
              <span className="label text-vermilion text-[10px] mr-2">资料来源 · 点击查看完整名录 ↓</span>
              {statement.text}
            </button>
          )}
        </div>

        {isLoading ? (
          <p className="text-ink-faint">载入中…</p>
        ) : (
          <>
            {allTags.length > 0 && (
              <TagsBrowser tags={allTags} plants={plantsMetadata as any} plantTags={allPlantTags} />
            )}
            {!selectedRcat && catalogs.length > 0 && (
              <section className="mb-6 border border-rule p-4 bg-paper-deep/20">
                <h2 className="font-display text-lg font-semibold mb-2">地区植物名录（自建）</h2>
                <div className="flex flex-wrap gap-2">
                  {Array.from(new Set(catalogs.map((c) => regionLabel(c)))).sort().map((label) => (
                    <button
                      key={label}
                      type="button"
                      onClick={() => setParam("rcat", label)}
                      className="border border-ink/60 text-ink px-2.5 py-1 text-xs hover:bg-ink hover:text-background transition-colors"
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </section>
            )}
            {selectedRcat && (
              <RegionalCatalogPanel
                region={selectedRcat}
                catalogs={catalogs}
                allEntries={catalogEntries}
                plants={plantsMetadata as any}
                filteredPlantIds={filteredMetadataIds}
              />
            )}
            {paginatedPlants.length === 0 ? (
              <p className="text-ink-faint py-12 text-center">
                {selectedRegion
                  ? "该保护目录下暂无已收录档案匹配。"
                  : selectedRcat
                  ? "该地区暂无已收录档案匹配。"
                  : selectedTagSlug
                  ? "该标签下还没有已收录条目。"
                  : "没有匹配的条目。"}
              </p>
            ) : (
              <>
                <ul className="divide-y divide-rule border-y border-rule">
                  {paginatedPlants.map((p) => (
                    <PlantRow key={p.id} plant={p} isAi={aiIds.has(p.id)} />
                  ))}
                </ul>

                {totalPages > 1 && (
                  <div className="flex items-center justify-between mt-8 border-t border-rule pt-6">
                    <button
                      disabled={page <= 1}
                      onClick={() => setParam("page", page - 1)}
                      className="px-4 py-2 border border-ink/40 text-sm font-semibold hover:bg-ink hover:text-background transition-colors disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-ink shrink-0"
                    >
                      ← 上一页
                    </button>
                    <div className="flex items-center gap-1.5 overflow-x-auto px-4 max-w-[200px] sm:max-w-none no-scrollbar">
                      {Array.from({ length: totalPages }).map((_, i) => {
                        const pNum = i + 1;
                        const isCurrent = pNum === page;
                        return (
                          <button
                            key={pNum}
                            onClick={() => setParam("page", pNum)}
                            className={`w-9 h-9 flex items-center justify-center border text-xs font-bold transition-all ${
                              isCurrent
                                ? "bg-leaf border-leaf text-white"
                                : "border-rule hover:border-ink"
                            }`}
                          >
                            {pNum}
                          </button>
                        );
                      })}
                    </div>
                    <button
                      disabled={page >= totalPages}
                      onClick={() => setParam("page", page + 1)}
                      className="px-4 py-2 border border-ink/40 text-sm font-semibold hover:bg-ink hover:text-background transition-colors disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-ink shrink-0"
                    >
                      下一页 →
                    </button>
                  </div>
                )}
              </>
            )}
          </>
        )}

        {/* ===== 名录目录（页末完整名单，收录/未收录着色）===== */}
        {!isLoading && orderedProtectedLists.length > 0 && (
          <section className="mt-20 pt-10 border-t-2 border-ink">
            <div className="flex items-end justify-between gap-4 mb-2 flex-wrap">
              <div>
                <p className="label text-vermilion mb-2">Directories · 名录目录</p>
                <h2 className="font-display text-3xl font-bold">国家和各省重点保护目录</h2>
              </div>
              <p className="text-xs text-ink-faint">
                <span className="text-ink font-semibold">深色</span> = 本站已收录 ·{" "}
                <span className="text-ink-faint/50">浅色</span> = 本站未收录
              </p>
            </div>

            {orderedProtectedLists.map((list) => {
              const taxa = taxaByList.get(list.id) ?? [];
              const recCount = taxa.filter(taxonRecorded).length;
              return (
                <div key={list.id} id={`dir-${list.id}`} className="mt-10 scroll-mt-20">
                  <div className="flex items-start justify-between gap-4 border-b border-rule pb-2 mb-3">
                    <div>
                      <h3 className="font-display text-xl font-semibold">{list.name}</h3>
                      {list.source_note && (
                        <p className="text-xs text-ink-faint mt-1 max-w-3xl leading-relaxed">{list.source_note}</p>
                      )}
                      <p className="text-[11px] text-ink-faint mt-1">
                        共 {taxa.length} 条 · 本站已收录 {recCount} 条
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => scrollToId("filter-bar")}
                      className="shrink-0 border border-ink/50 px-3 py-1.5 text-xs hover:bg-ink hover:text-background transition-colors"
                    >
                      ↑ 回到筛选栏
                    </button>
                  </div>
                  <div className="flex flex-wrap gap-x-4 gap-y-1.5">
                    {taxa.map((t, i) => {
                      const rec = taxonRecorded(t);
                      const p = t.rank === "species" ? plantByNorm.get(t.normalized_name) : undefined;
                      const inner = (
                        <>
                          {t.chinese_name || t.scientific_name} <i className="opacity-80">{t.scientific_name}</i>
                        </>
                      );
                      return p ? (
                        <Link
                          key={i}
                          to="/plants/$slug"
                          params={{ slug: p.slug }}
                          className="text-sm text-ink hover:text-vermilion underline decoration-dotted"
                        >
                          {inner}
                        </Link>
                      ) : (
                        <span key={i} className={`text-sm ${rec ? "text-ink" : "text-ink-faint/50"}`}>
                          {inner}
                        </span>
                      );
                    })}
                  </div>
                </div>
              );
            })}

            {allTags.length > 0 && (
              <div className="mt-16">
                <h2 className="font-display text-2xl font-bold border-b border-ink pb-2 mb-2">
                  归类标签名录（用户添加）
                </h2>
                {allTags.map((t) => {
                  const pids = plantsByTag.get(t.id) ?? [];
                  const when = t.created_at ? new Date(t.created_at).toLocaleDateString("zh-CN") : "";
                  return (
                    <div key={t.id} id={`tag-${t.slug}`} className="mt-8 scroll-mt-20">
                      <div className="flex items-start justify-between gap-4 border-b border-rule pb-2 mb-3">
                        <div>
                          <h3 className="font-display text-lg font-semibold"># {t.name}</h3>
                          <p className="text-xs text-ink-faint mt-1">
                            由 {t.created_by_name ?? "编辑"} 于 {when} 添加
                            {t.description ? ` · 参考资料：${t.description}` : ""}
                          </p>
                          <p className="text-[11px] text-ink-faint mt-1">共 {pids.length} 条收录</p>
                        </div>
                        <button
                          type="button"
                          onClick={() => scrollToId("filter-bar")}
                          className="shrink-0 border border-ink/50 px-3 py-1.5 text-xs hover:bg-ink hover:text-background transition-colors"
                        >
                          ↑ 回到筛选栏
                        </button>
                      </div>
                      <div className="flex flex-wrap gap-x-4 gap-y-1.5">
                        {pids.map((pid) => {
                          const p = plantsById.get(pid);
                          if (!p) return null;
                          return (
                            <Link
                              key={pid}
                              to="/plants/$slug"
                              params={{ slug: p.slug }}
                              className="text-sm text-ink hover:text-vermilion underline decoration-dotted"
                            >
                              {p.title} <i className="opacity-80">{p.scientific_name}</i>
                            </Link>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        )}
      </main>
      <SiteFooter />
    </div>
  );
}

function PlantRow({ plant, isAi }: { plant: Plant; isAi?: boolean }) {
  return (
    <li>
      <Link
        to="/plants/$slug"
        params={{ slug: plant.slug }}
        className="flex items-center gap-5 py-4 hover:bg-paper-deep/40 transition-colors group"
      >
        <div className="w-16 h-16 flex-shrink-0 border border-rule bg-paper-deep overflow-hidden">
          {plant.cover_url ? (
            <img
              src={plant.cover_url}
              alt={plant.title}
              loading="lazy"
              className="w-full h-full object-cover"
            />
          ) : (
            <div
              className="w-full h-full flex items-center justify-center"
              style={{ background: "repeating-linear-gradient(45deg, var(--paper-deep) 0 6px, var(--paper) 6px 12px)" }}
            >
              <span className="font-display text-leaf-deep/40">❦</span>
            </div>
          )}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline gap-2 flex-wrap">
            <h3 className="font-display text-xl font-semibold leading-tight group-hover:text-vermilion transition-colors">
              {isAi ? `[${plant.title}]` : plant.title}
            </h3>
            {isAi && (
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-[oklch(0.45_0.18_240)]/12 text-[oklch(0.45_0.18_240)] shrink-0">AI 识别</span>
            )}
            {plant.scientific_name && (
              <span className="italic text-sm text-ink-soft">{plant.scientific_name}</span>
            )}
            {plant.common_name_en && (
              <span className="text-sm text-ink-faint">· {plant.common_name_en}</span>
            )}
          </div>
          {plant.common_names_zh && (
            <p className="text-xs text-ink-soft mt-1">俗名/商品名：{plant.common_names_zh}</p>
          )}
          {plant.family && (
            <p className={`text-xs text-ink-faint ${plant.common_names_zh ? "mt-0.5" : "mt-1"}`}>{plant.family}</p>
          )}
        </div>
      </Link>
    </li>
  );
}

function TagsBrowser({
  tags,
  plants,
  plantTags,
}: {
  tags: TagWithCount[];
  plants: Plant[];
  plantTags: { tag_id: string; plant_id: string }[];
}) {
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const plantById = useMemo(() => {
    const m = new Map<string, Plant>();
    for (const p of plants) m.set(p.id, p);
    return m;
  }, [plants]);
  const byTag = useMemo(() => {
    const m = new Map<string, Plant[]>();
    for (const pt of plantTags) {
      const p = plantById.get(pt.plant_id);
      if (!p) continue;
      if (!m.has(pt.tag_id)) m.set(pt.tag_id, []);
      m.get(pt.tag_id)!.push(p);
    }
    for (const list of m.values()) list.sort((a, b) => a.title.localeCompare(b.title, "zh"));
    return m;
  }, [plantTags, plantById]);
  return (
    <section className="mb-6 border border-rule bg-paper-deep/20">
      <h2 className="font-display text-lg font-semibold px-4 pt-3">#tag 归类标签</h2>
      <div className="divide-y divide-rule px-4 pb-2">
        {tags.map((t) => {
          const isOpen = !!open[t.id];
          const list = byTag.get(t.id) ?? [];
          return (
            <section key={t.id} className="py-2">
              <button
                onClick={() => setOpen((s) => ({ ...s, [t.id]: !s[t.id] }))}
                className="w-full flex items-center gap-2 text-left hover:text-emerald-700 transition-colors"
              >
                <span className="inline-block w-4 text-ink-faint">{isOpen ? "▾" : "▸"}</span>
                <span className="font-display text-base font-semibold text-emerald-700">#{t.name}</span>
                <span className="text-xs text-ink-faint">
                  · 已收录 {t.plant_count} / 共 {t.expected_count ?? t.plant_count}
                </span>
                {t.description && (
                  <span className="text-xs text-ink-faint truncate">· {t.description}</span>
                )}
              </button>
              {isOpen && (
                <ul className="mt-2 pl-6 text-sm space-y-1">
                  {list.length === 0 ? (
                    <li className="text-ink-faint text-xs">尚无已收录条目。</li>
                  ) : (
                    list.map((p) => (
                      <li key={p.id}>
                        <Link
                          to="/plants/$slug"
                          params={{ slug: p.slug }}
                          className="text-emerald-700 hover:underline"
                        >
                          {p.scientific_name && <span className="italic">{p.scientific_name}</span>}
                          {p.title ? ` · ${p.title}` : ""}
                        </Link>
                      </li>
                    ))
                  )}
                </ul>
              )}
            </section>
          );
        })}
      </div>
    </section>
  );
}

function RegionalCatalogPanel({
  region,
  catalogs,
  allEntries,
  plants,
  filteredPlantIds,
}: {
  region: string;
  catalogs: RegionalCatalog[];
  allEntries: CatalogEntry[];
  plants: Plant[];
  filteredPlantIds: Set<string> | null;
}) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const aiFill = useServerFn(fillChineseNames);
  const matching = catalogs.filter((c) => regionLabel(c) === region);
  const catIds = new Set(matching.map((c) => c.id));
  const match = useMemo(() => buildPlantMatcher(plants), [plants]);
  const entries = useMemo(() => {
    const list = allEntries
      .filter((e) => catIds.has(e.catalog_id))
      .map((e) => ({
        ...e,
        matchedPlant: match(e),
      }));
    // Dedupe by normalized Latin name within this region — merge duplicates
    // (whether already in DB or recently added). Prefer the entry that has a
    // matched plant, then the earliest one.
    const groups = new Map<string, typeof list[number]>();
    for (const e of list) {
      const key = normalizeSciName(e.scientific_name) || `__raw__:${e.scientific_name}`;
      const cur = groups.get(key);
      if (!cur) { groups.set(key, e); continue; }
      const better =
        (!!e.matchedPlant && !cur.matchedPlant) ||
        (!!e.matchedPlant === !!cur.matchedPlant && e.created_at < cur.created_at);
      if (better) groups.set(key, e);
    }
    let deduped = Array.from(groups.values());
    // When upstream filters (family/genus/iucn) are active, only keep
    // entries whose matched plant survived those filters.
    const restricted = filteredPlantIds
      ? deduped.filter((e) => e.matchedPlant && filteredPlantIds.has(e.matchedPlant.id))
      : deduped;
    restricted.sort((a, b) => {
      if (!!a.matchedPlant !== !!b.matchedPlant) return a.matchedPlant ? -1 : 1;
      return a.scientific_name.localeCompare(b.scientific_name);
    });
    return restricted;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allEntries, plants, region, match, filteredPlantIds]);

  const { data: suggestions = [] } = useQuery({
    queryKey: ["catalog-suggestions", matching.map((c) => c.id).join(",")],
    queryFn: () => fetchSuggestionsForCatalogs(matching.map((c) => c.id)),
    enabled: matching.length > 0,
  });

  const [addCatalogId, setAddCatalogId] = useState<string>(matching[0]?.id ?? "");
  const [addText, setAddText] = useState("");
  const [busy, setBusy] = useState(false);

  if (matching.length === 0) return null;
  const matchedCount = entries.filter((e) => e.matchedPlant).length;
  const targetCatalogId = addCatalogId || matching[0].id;

  const onAppend = async () => {
    if (!user) return toast.error("请先登录");
    const parsed = parseCatalogText(addText);
    if (parsed.length === 0) return toast.error("没有可补充的条目");
    setBusy(true);
    try {
      let final = parsed;
      let aiUsed = false;
      try {
        const out = await aiFill({ data: { entries: parsed } });
        if (out?.entries) { final = out.entries; aiUsed = true; }
      } catch {/* ignore */}
      const name = (user.user_metadata?.full_name as string) || user.email || "编辑者";
      await appendEntries(
        targetCatalogId,
        final,
        user.id,
        name,
        aiUsed
          ? "ai:google/gemini-3-flash-preview@lovable-ai+catalog_editor"
          : "catalog_editor",
      );
      toast.success(`已补充 ${final.length} 条`);
      setAddText("");
      qc.invalidateQueries({ queryKey: ["all-catalog-entries"] });
      qc.invalidateQueries({ queryKey: ["plant-edits"] });
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="mb-8 border border-rule p-5 bg-paper-deep/30">
      <div className="flex items-baseline justify-between flex-wrap gap-2 mb-3">
        <h2 className="font-display text-2xl font-semibold">{region}</h2>
        <p className="text-xs text-ink-faint">
          名录共 {entries.length} 种 · 已收录 {matchedCount} 种 · 来自{" "}
          {matching.map((c, i) => (
            <span key={c.id}>
              {i > 0 && "、"}
              <Link
                to="/admin/catalogs/$id"
                params={{ id: c.id }}
                className="text-vermilion hover:underline"
              >
                {c.contributor_name}（{c.source}）
              </Link>
            </span>
          ))}
        </p>
      </div>
      {entries.length === 0 ? (
        <p className="text-xs text-ink-faint">该地区名录中没有匹配当前筛选的条目。</p>
      ) : (
        <ul className="text-sm space-y-1">
          {entries.map((e) =>
            e.matchedPlant ? (
              <li key={e.id} className="flex flex-wrap items-baseline gap-x-2">
                <Link
                  to="/plants/$slug"
                  params={{ slug: e.matchedPlant.slug }}
                  className="text-[oklch(0.55_0.18_240)] hover:underline"
                >
                  <span className="italic">
                    {e.matchedPlant.scientific_name || e.scientific_name}
                  </span>
                  {e.matchedPlant.title ? ` · ${e.matchedPlant.title}` : e.chinese_name ? ` · ${e.chinese_name}` : ""}
                </Link>
                <span className="text-[11px] text-ink-faint">
                  · 由 {e.added_by_name ?? "编辑者"} 添加 ·{" "}
                  {new Date(e.created_at).toLocaleDateString("zh-CN")}
                </span>
              </li>
            ) : (
              <li key={e.id} className="flex flex-wrap items-baseline gap-x-2 text-ink">
                <span>
                  <span className="italic">{e.scientific_name}</span>
                  {e.chinese_name ? ` · ${e.chinese_name}` : ""}
                </span>
                <span className="text-[11px] text-ink-faint">
                  · 由 {e.added_by_name ?? "编辑者"} 添加 ·{" "}
                  {new Date(e.created_at).toLocaleDateString("zh-CN")}
                </span>
              </li>
            ),
          )}
        </ul>
      )}

      {/* Editor bar */}
      {user && (
        <div className="mt-5 pt-4 border-t border-rule space-y-4">
          <details className="text-sm">
            <summary className="cursor-pointer font-semibold hover:text-vermilion">＋ 补充条目到该地区</summary>
            <div className="mt-2 space-y-2">
              {matching.length > 1 && (
                <select
                  value={targetCatalogId}
                  onChange={(e) => setAddCatalogId(e.target.value)}
                  className="border border-ink px-2 py-1 text-xs bg-transparent"
                >
                  {matching.map((c) => (
                    <option key={c.id} value={c.id}>追加到：{c.contributor_name}（{c.source}）</option>
                  ))}
                </select>
              )}
              <textarea
                rows={4}
                value={addText}
                onChange={(e) => setAddText(e.target.value)}
                className="w-full border border-ink p-2 bg-transparent font-mono text-xs focus:outline-none focus:border-vermilion"
                placeholder="每行一个学名，可附中文名"
              />
              <button
                onClick={onAppend}
                disabled={busy}
                className="bg-ink text-background px-3 py-1 text-xs hover:bg-vermilion disabled:opacity-60"
              >
                {busy ? "处理中…" : "追加"}
              </button>
            </div>
          </details>

          <SuggestionForm
            catalogs={matching}
            entries={entries}
            onCreated={() => qc.invalidateQueries({ queryKey: ["catalog-suggestions"] })}
          />

          {suggestions.length > 0 && (
            <details>
              <summary className="cursor-pointer text-sm font-semibold hover:text-vermilion">
                修改意见（{suggestions.length}）
              </summary>
              <ul className="mt-2 space-y-2 text-xs">
                {suggestions.map((s) => (
                  <SuggestionRow key={s.id} s={s} />
                ))}
              </ul>
            </details>
          )}
        </div>
      )}
    </section>
  );
}

function SuggestionForm({
  catalogs,
  entries,
  onCreated,
}: {
  catalogs: RegionalCatalog[];
  entries: CatalogEntry[];
  onCreated: () => void;
}) {
  const { user } = useAuth();
  const [target, setTarget] = useState("");
  const [type, setType] = useState<"delete" | "rename" | "other">("delete");
  const [proposedName, setProposedName] = useState("");
  const [reason, setReason] = useState("");
  const [sourceType, setSourceType] = useState<"book" | "url" | "other">("book");
  const [bookTitle, setBookTitle] = useState("");
  const [bookPages, setBookPages] = useState("");
  const [sourceUrl, setSourceUrl] = useState("");
  const [busy, setBusy] = useState(false);

  // @ autocomplete: filter entries by name fragment after the last @
  const atMatch = target.match(/@([^\s@]*)$/);
  const suggestions = atMatch
    ? entries
        .filter((e) =>
          (e.scientific_name + " " + (e.chinese_name ?? "")).toLowerCase().includes(atMatch[1].toLowerCase()),
        )
        .slice(0, 6)
    : [];

  const onSubmit = async () => {
    if (!user) return toast.error("请先登录");
    const cleanTarget = target.replace(/^@/, "").trim();
    if (!cleanTarget) return toast.error("请填写要修改的物种（用 @ 选择）");
    if (sourceType === "book" && !bookTitle.trim()) return toast.error("请填写书名");
    if (sourceType === "url" && !sourceUrl.trim()) return toast.error("请填写链接");
    setBusy(true);
    try {
      const matched = entries.find(
        (e) => e.scientific_name === cleanTarget || e.chinese_name === cleanTarget,
      );
      const catalog_id = matched?.catalog_id ?? catalogs[0].id;
      const name = (user.user_metadata?.full_name as string) || user.email || "编辑者";
      await createSuggestion({
        catalog_id,
        target_entry_id: matched?.id ?? null,
        target_name: cleanTarget,
        suggestion_type: type,
        proposed_name: type === "rename" ? proposedName.trim() || null : null,
        reason: reason.trim() || null,
        source_type: sourceType,
        source_book_title: sourceType === "book" ? bookTitle.trim() : null,
        source_book_pages: sourceType === "book" ? bookPages.trim() : null,
        source_url: sourceType === "url" ? sourceUrl.trim() : null,
        suggested_by: user.id,
        suggested_by_name: name,
      });
      toast.success("已提交修改意见");
      setTarget(""); setProposedName(""); setReason(""); setBookTitle(""); setBookPages(""); setSourceUrl("");
      onCreated();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <details className="text-sm">
      <summary className="cursor-pointer font-semibold hover:text-vermilion">
        @ 提出修改意见（删除 / 改名）
      </summary>
      <div className="mt-2 space-y-2 text-xs">
        <div className="relative">
          <input
            value={target}
            onChange={(e) => setTarget(e.target.value)}
            placeholder="@ 在此输入物种名（学名或中文名）"
            className="w-full border border-ink px-2 py-1 bg-transparent focus:outline-none focus:border-vermilion"
          />
          {suggestions.length > 0 && (
            <ul className="absolute left-0 right-0 top-full z-10 border border-ink bg-background max-h-40 overflow-auto">
              {suggestions.map((e) => (
                <li
                  key={e.id}
                  className="px-2 py-1 hover:bg-paper-deep cursor-pointer"
                  onClick={() => setTarget(`@${e.scientific_name}`)}
                >
                  <span className="italic">{e.scientific_name}</span>
                  {e.chinese_name ? ` · ${e.chinese_name}` : ""}
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="flex gap-2 flex-wrap">
          <label><input type="radio" checked={type === "delete"} onChange={() => setType("delete")} /> 删除</label>
          <label><input type="radio" checked={type === "rename"} onChange={() => setType("rename")} /> 改名</label>
          <label><input type="radio" checked={type === "other"} onChange={() => setType("other")} /> 其他</label>
        </div>
        {type === "rename" && (
          <input
            value={proposedName}
            onChange={(e) => setProposedName(e.target.value)}
            placeholder="建议改为"
            className="w-full border border-ink px-2 py-1 bg-transparent focus:outline-none focus:border-vermilion"
          />
        )}
        <textarea
          rows={2}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="说明（可选）"
          className="w-full border border-ink px-2 py-1 bg-transparent focus:outline-none focus:border-vermilion"
        />
        <div className="flex gap-2 flex-wrap items-center">
          <span className="text-ink-faint">依据：</span>
          <label><input type="radio" checked={sourceType === "book"} onChange={() => setSourceType("book")} /> 书籍</label>
          <label><input type="radio" checked={sourceType === "url"} onChange={() => setSourceType("url")} /> 网址</label>
          <label><input type="radio" checked={sourceType === "other"} onChange={() => setSourceType("other")} /> 其他</label>
        </div>
        {sourceType === "book" && (
          <div className="flex gap-2">
            <input
              value={bookTitle}
              onChange={(e) => setBookTitle(e.target.value)}
              placeholder="书名"
              className="flex-1 border border-ink px-2 py-1 bg-transparent focus:outline-none focus:border-vermilion"
            />
            <input
              value={bookPages}
              onChange={(e) => setBookPages(e.target.value)}
              placeholder="页码"
              className="w-24 border border-ink px-2 py-1 bg-transparent focus:outline-none focus:border-vermilion"
            />
          </div>
        )}
        {sourceType === "url" && (
          <input
            value={sourceUrl}
            onChange={(e) => setSourceUrl(e.target.value)}
            placeholder="https://…"
            className="w-full border border-ink px-2 py-1 bg-transparent focus:outline-none focus:border-vermilion"
          />
        )}
        <button
          onClick={onSubmit}
          disabled={busy}
          className="bg-ink text-background px-3 py-1 hover:bg-vermilion disabled:opacity-60"
        >
          {busy ? "提交中…" : "提交意见"}
        </button>
      </div>
    </details>
  );
}

function SuggestionRow({ s }: { s: CatalogSuggestion }) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const canDelete = user?.id === s.suggested_by;
  const typeLabel = s.suggestion_type === "delete" ? "删除" : s.suggestion_type === "rename" ? "改名" : "其他";
  return (
    <li className="border border-rule p-2 bg-background/40">
      <div className="flex justify-between items-start gap-2">
        <div>
          <span className="font-semibold">{s.suggested_by_name ?? "编辑者"}</span>
          <span className="text-ink-faint ml-2">{new Date(s.created_at).toLocaleString("zh-CN")}</span>
          <span className="ml-2 px-1.5 py-0.5 bg-leaf/15 text-leaf-deep rounded text-[10px]">{typeLabel}</span>
        </div>
        {canDelete && (
          <button
            className="text-destructive hover:underline"
            onClick={async () => {
              await deleteSuggestion(s.id);
              qc.invalidateQueries({ queryKey: ["catalog-suggestions"] });
            }}
          >
            撤回
          </button>
        )}
      </div>
      <p className="mt-1">
        @<span className="italic">{s.target_name}</span>
        {s.proposed_name && <> → <span className="italic">{s.proposed_name}</span></>}
      </p>
      {s.reason && <p className="mt-1 text-ink-soft">{s.reason}</p>}
      <p className="mt-1 text-ink-faint">
        依据：
        {s.source_type === "book" && `《${s.source_book_title}》${s.source_book_pages ? ` p.${s.source_book_pages}` : ""}`}
        {s.source_type === "url" && (
          <a href={s.source_url ?? "#"} target="_blank" rel="noreferrer" className="text-vermilion hover:underline">
            {s.source_url}
          </a>
        )}
        {s.source_type === "other" && "（其他）"}
      </p>
    </li>
  );
}
