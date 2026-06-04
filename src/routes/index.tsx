import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { SiteHeader, SiteFooter } from "@/components/site-header";
import { fetchAllPlants, type Plant } from "@/lib/plants";
import { useAuth } from "@/hooks/use-auth";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { fetchAllCatalogs, fetchAllEntries, buildPlantMatcher, type RegionalCatalog, type CatalogEntry } from "@/lib/catalogs";
import { fetchAllTags, fetchAllPlantTags, type TagWithCount } from "@/lib/tags";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Plantspedia · 协作植物图鉴" },
      { name: "description", content: "由植物爱好者共同编纂的科普图鉴。每一种草木都有它值得记下的故事。" },
    ],
  }),
  component: HomePage,
});

function HomePage() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const { data: allPlants = [], isLoading } = useQuery({
    queryKey: ["home-all"],
    queryFn: fetchAllPlants,
  });
  const { data: tags = [] } = useQuery({ queryKey: ["all-tags"], queryFn: fetchAllTags });
  const { data: plantTags = [] } = useQuery({ queryKey: ["all-plant-tags"], queryFn: fetchAllPlantTags });
  type Tab = "latest" | "featured" | "hot" | "regions" | "tags";
  const [tab, setTab] = useState<Tab>("latest");

  const sorted = useMemo(() => {
    const list = [...allPlants];
    if (tab === "latest") {
      list.sort((a, b) => +new Date(b.updated_at) - +new Date(a.updated_at));
      return list;
    }
    if (tab === "featured") {
      return list
        .filter((p) => p.is_featured)
        .sort((a, b) => +new Date(b.updated_at) - +new Date(a.updated_at));
    }
    return list.sort(
      (a, b) => (b.comments_count ?? 0) - (a.comments_count ?? 0) ||
                +new Date(b.updated_at) - +new Date(a.updated_at),
    );
  }, [allPlants, tab]);

  const hero: Plant | undefined = sorted[0];
  const sub = sorted.slice(1, 4);
  const rest = sorted.slice(4);

  const toggleFeatured = async (p: Plant) => {
    const { error } = await supabase
      .from("plants")
      .update({ is_featured: !p.is_featured })
      .eq("id", p.id);
    if (error) return toast.error(error.message);
    toast.success(!p.is_featured ? "已设为推荐" : "已取消推荐");
    qc.invalidateQueries({ queryKey: ["home-all"] });
    qc.invalidateQueries({ queryKey: ["plants"] });
  };

  return (
    <div className="min-h-screen flex flex-col">
      <SiteHeader />
      <main className="mx-auto max-w-6xl px-6 py-10 flex-1 w-full">
        {/* Masthead */}
        <section className="border-b-2 border-ink pb-6 mb-8">
          <h1 className="text-center font-display text-4xl md:text-6xl font-bold tracking-tight">
            Plantspedia · 草木志
          </h1>
          <div className="mt-4 flex items-start justify-between gap-4 flex-wrap">
            <div>
              <div className="text-sm md:text-base">未来还会有10万种植物将被命名</div>
              <div className="label mt-0.5">Another 100,000 plant species remain to be named.</div>
            </div>
            <div className="text-right">
              <div className="text-sm md:text-base">由社区编纂 · 持续更新</div>
              <div className="label mt-0.5">Community-compiled, continuously updated.</div>
            </div>
          </div>
        </section>

        {/* Tabs */}
        <div className="flex items-center gap-1 mb-8 border-b border-rule">
          {(
            [
              { id: "latest", label: "最新更新" },
              { id: "featured", label: "编辑推荐" },
              { id: "hot", label: "热度" },
              { id: "regions", label: "地区植物名录" },
              { id: "tags", label: "主题标签" },
            ] as { id: Tab; label: string }[]
          ).map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`px-4 py-2 text-sm border-b-2 -mb-px transition-colors ${
                tab === t.id
                  ? "border-vermilion text-vermilion font-semibold"
                  : "border-transparent text-ink-faint hover:text-ink"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {tab === "regions" ? (
          <RegionsBrowser plants={allPlants} />
        ) : tab === "tags" ? (
          <TagsBrowser tags={tags} plants={allPlants} plantTags={plantTags} />
        ) : isLoading ? (
          <p className="text-ink-faint">载入中…</p>
        ) : !hero ? (
          <EmptyState />
        ) : (
          <>
            {/* Hero feature */}
            <section className="mb-16">
              <Link to="/plants/$slug" params={{ slug: hero.slug }} className="block group">
                <div className="grid md:grid-cols-5 gap-8 items-start">
                  <div className="md:col-span-3 overflow-hidden border border-rule bg-paper-deep">
                    {hero.cover_url ? (
                      <img src={hero.cover_url} alt={hero.title} className="w-full h-auto block group-hover:scale-[1.02] transition-transform duration-700" />
                    ) : (
                      <div className="aspect-[4/3]"><PlantPattern /></div>
                    )}
                  </div>
                  <div className="md:col-span-2 flex flex-col justify-center">
                    <p className="label text-vermilion mb-3">
                      {tab === "hot" ? "最热 · Most Discussed" : tab === "featured" ? "编辑推荐 · Editor's Pick" : "最新 · Latest"}
                      {tab === "hot" && ` · ${hero.comments_count ?? 0} 条评论`}
                    </p>
                    <h2 className="font-display text-4xl md:text-5xl font-bold leading-tight mb-3 group-hover:text-vermilion transition-colors">{hero.title}</h2>
                    {hero.scientific_name && <p className="italic text-ink-faint mb-4 font-serif">{hero.scientific_name}</p>}
                    <p className="text-ink-soft line-clamp-5">{hero.summary || "（无摘要）"}</p>
                    <p className="label mt-6">阅读全文 →</p>
                  </div>
                </div>
              </Link>
              {user && (
                <div className="mt-3">
                  <FeatureToggle plant={hero} onToggle={toggleFeatured} />
                </div>
              )}
            </section>

            {/* Subfeatures */}
            {sub.length > 0 && (
              <section className="mb-16 border-t border-rule pt-10">
                <p className="label mb-6">
                  {tab === "hot" ? "热议 · Trending" : tab === "featured" ? "更多推荐 · More Picks" : "近期更新 · Recently Updated"}
                </p>
                <div className="grid md:grid-cols-3 gap-8">
                  {sub.map((p, i) => (
                    <PlantCard
                      key={p.id}
                      plant={p}
                      index={i + 2}
                      showFeatureToggle={!!user}
                      onToggleFeatured={toggleFeatured}
                      showComments={tab === "hot"}
                    />
                  ))}
                </div>
              </section>
            )}

            {/* Latest archive */}
            {rest.length > 0 && (
              <section className="border-t border-rule pt-10">
                <div className="flex items-baseline justify-between mb-6">
                  <p className="label">全部条目 · All Entries</p>
                  <Link to="/plants" className="label hover:text-vermilion">浏览全部 →</Link>
                </div>
                <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-x-8 gap-y-4">
                  {rest.map((p) => (
                    <Link key={p.id} to="/plants/$slug" params={{ slug: p.slug }} className="flex gap-4 py-3 border-b border-rule-soft hover:bg-paper-deep/40 px-2 -mx-2 transition-colors group">
                      <div className="w-16 h-16 flex-shrink-0 overflow-hidden border border-rule bg-paper-deep">
                        {p.cover_url ? <img src={p.cover_url} alt="" className="w-full h-full object-cover" /> : <PlantPattern small />}
                      </div>
                      <div className="min-w-0">
                        <h3 className="font-display text-lg font-semibold truncate group-hover:text-vermilion transition-colors">{p.title}</h3>
                        {p.scientific_name && <p className="italic text-xs text-ink-faint truncate">{p.scientific_name}</p>}
                        {tab === "hot" ? (
                          <p className="label text-[10px] mt-0.5">{p.comments_count ?? 0} 评论</p>
                        ) : (
                          p.family && <p className="label text-[10px] mt-0.5">{p.family}</p>
                        )}
                      </div>
                    </Link>
                  ))}
                </div>
              </section>
            )}
          </>
        )}
      </main>
      <SiteFooter />
    </div>
  );
}

function PlantCard({
  plant,
  index,
  showFeatureToggle,
  onToggleFeatured,
  showComments,
}: {
  plant: Plant;
  index: number;
  showFeatureToggle?: boolean;
  onToggleFeatured?: (p: Plant) => void;
  showComments?: boolean;
}) {
  return (
    <div>
      <Link to="/plants/$slug" params={{ slug: plant.slug }} className="group block">
        <div className="overflow-hidden border border-rule bg-paper-deep mb-4">
          {plant.cover_url ? (
            <img src={plant.cover_url} alt={plant.title} className="w-full h-auto block group-hover:scale-[1.03] transition-transform duration-500" />
          ) : (
            <div className="aspect-[4/3]"><PlantPattern /></div>
          )}
        </div>
        {showComments && (
          <p className="label text-ink-faint mb-1">{plant.comments_count ?? 0} 评论</p>
        )}
        <h3 className="font-display text-2xl font-semibold leading-tight group-hover:text-vermilion transition-colors">{plant.title}</h3>
        {plant.scientific_name && <p className="italic text-sm text-ink-faint mt-1">{plant.scientific_name}</p>}
        {plant.summary && <p className="text-sm text-ink-soft mt-2 line-clamp-3">{plant.summary}</p>}
      </Link>
      {showFeatureToggle && onToggleFeatured && (
        <div className="mt-2">
          <FeatureToggle plant={plant} onToggle={onToggleFeatured} />
        </div>
      )}
    </div>
  );
}

function FeatureToggle({ plant, onToggle }: { plant: Plant; onToggle: (p: Plant) => void }) {
  return (
    <button
      type="button"
      onClick={() => onToggle(plant)}
      className={`text-xs px-2 py-1 border transition-colors ${
        plant.is_featured
          ? "border-vermilion text-vermilion hover:bg-vermilion hover:text-background"
          : "border-rule text-ink-faint hover:border-ink hover:text-ink"
      }`}
    >
      {plant.is_featured ? "★ 已推荐（点击取消）" : "☆ 设为编辑推荐"}
    </button>
  );
}

function PlantPattern({ small = false }: { small?: boolean }) {
  return (
    <div className={`w-full h-full flex items-center justify-center ${small ? "" : ""}`} style={{ background: "repeating-linear-gradient(45deg, var(--paper-deep) 0 8px, var(--paper) 8px 16px)" }}>
      <span className="font-display text-leaf-deep/40" style={{ fontSize: small ? 24 : 56 }}>❦</span>
    </div>
  );
}

function EmptyState() {
  return (
    <section className="py-20 text-center border border-dashed border-rule">
      <p className="label mb-3">尚未收录任何条目</p>
      <h2 className="font-display text-3xl font-bold mb-3">从第一株植物开始</h2>
      <p className="text-ink-faint mb-6 max-w-md mx-auto">登录后进入「管理」即可创建首个条目，或直接上传一份精心排版的 HTML。</p>
      <Link to="/login" className="inline-block border border-ink px-5 py-2 hover:bg-ink hover:text-background transition-colors">登录开始编纂</Link>
    </section>
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

  if (tags.length === 0) {
    return (
      <div className="border border-dashed border-rule py-16 text-center">
        <p className="text-ink-faint">尚无主题标签。管理员可在「管理 → 主题标签」创建。</p>
      </div>
    );
  }

  return (
    <div className="divide-y divide-rule border-y border-rule">
      {tags.map((t) => {
        const isOpen = !!open[t.id];
        const list = byTag.get(t.id) ?? [];
        return (
          <section key={t.id} className="py-3">
            <button
              onClick={() => setOpen((s) => ({ ...s, [t.id]: !s[t.id] }))}
              className="w-full flex items-center gap-2 text-left hover:text-emerald-700 transition-colors"
              title={t.description ?? ""}
            >
              <span className="inline-block w-4 text-ink-faint">{isOpen ? "▾" : "▸"}</span>
              <h2 className="font-display text-xl font-semibold text-emerald-700">#{t.name}</h2>
              <span className="text-xs text-ink-faint">
                · 已收录 {t.plant_count} / 共 {t.expected_count ?? t.plant_count}
              </span>
              {t.description && (
                <span className="text-xs text-ink-faint truncate">· {t.description}</span>
              )}
            </button>
            {isOpen && (
              <ul className="mt-3 pl-6 text-sm space-y-1">
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
  );
}

function RegionsBrowser({ plants }: { plants: Plant[] }) {
  const { data: catalogs = [] } = useQuery({
    queryKey: ["all-catalogs"],
    queryFn: fetchAllCatalogs,
  });
  const { data: entries = [] } = useQuery({
    queryKey: ["all-catalog-entries"],
    queryFn: fetchAllEntries,
  });

  const match = useMemo(() => buildPlantMatcher(plants), [plants]);

  // Aggregate ALL entries by region (province|city|county), merging catalogs that share the same region
  type RegionGroup = {
    key: string;
    label: string;
    catalogs: RegionalCatalog[];
    entries: (CatalogEntry & { matchedPlant: Plant | null })[];
  };
  const regions = useMemo<RegionGroup[]>(() => {
    const catById = new Map<string, RegionalCatalog>();
    for (const c of catalogs) catById.set(c.id, c);
    const groups = new Map<string, RegionGroup>();
    for (const e of entries as CatalogEntry[]) {
      const c = catById.get(e.catalog_id);
      if (!c) continue;
      const key = `${c.province}|${c.city ?? ""}|${c.county ?? ""}`;
      const label = [c.province, c.city, c.county].filter(Boolean).join("");
      if (!groups.has(key)) groups.set(key, { key, label, catalogs: [], entries: [] });
      const g = groups.get(key)!;
      if (!g.catalogs.find((x) => x.id === c.id)) g.catalogs.push(c);
      const hit = match(e);
      g.entries.push({ ...e, matchedPlant: hit });
    }
    // Sort each group: matched (blue) first, then alphabetical
    for (const g of groups.values()) {
      g.entries.sort((a, b) => {
        if (!!a.matchedPlant !== !!b.matchedPlant) return a.matchedPlant ? -1 : 1;
        return a.scientific_name.localeCompare(b.scientific_name);
      });
    }
    return Array.from(groups.values()).sort((a, b) => a.label.localeCompare(b.label, "zh"));
  }, [catalogs, entries, match]);

  const [open, setOpen] = useState<Record<string, boolean>>({});

  if (regions.length === 0) {
    return (
      <div className="border border-dashed border-rule py-16 text-center">
        <p className="text-ink-faint">
          还没有任何地区植物名录。编辑可在「管理 → + 地区植物目录」添加。
        </p>
      </div>
    );
  }

  return (
    <div className="divide-y divide-rule border-y border-rule">
      {regions.map((g) => {
        const isOpen = !!open[g.key];
        const matched = g.entries.filter((e) => e.matchedPlant).length;
        return (
          <section key={g.key} className="py-3">
            <button
              onClick={() => setOpen((s) => ({ ...s, [g.key]: !s[g.key] }))}
              className="w-full flex items-center gap-2 text-left hover:text-vermilion transition-colors"
              title="点击展开该地区植物名录"
            >
              <span className="inline-block w-4 text-ink-faint">{isOpen ? "▾" : "▸"}</span>
              <h2 className="font-display text-xl font-semibold text-emerald-700">{g.label}</h2>
              <span className="text-xs text-ink-faint">
                · 已收录 {matched} / 共 {g.entries.length}
              </span>
            </button>
            {isOpen && (
              <div className="mt-3 pl-6">
                <p className="text-[11px] text-ink-faint mb-2">
                  来源：{g.catalogs.map((c) => `${c.contributor_name}（${c.source}）`).join("； ")}
                </p>
                <ul className="text-sm space-y-1">
                  {g.entries.map((e) =>
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
                          {e.matchedPlant.title
                            ? ` · ${e.matchedPlant.title}`
                            : e.chinese_name
                            ? ` · ${e.chinese_name}`
                            : ""}
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
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}
