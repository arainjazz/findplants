import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { zodValidator, fallback } from "@tanstack/zod-adapter";
import { z } from "zod";
import { SiteHeader, SiteFooter } from "@/components/site-header";
import { fetchAllPlants } from "@/lib/plants";
import { fetchAllCatalogs, fetchAllEntries, buildPlantMatcher, regionLabel } from "@/lib/catalogs";
import { fetchAllTags } from "@/lib/tags";

const schema = z.object({ q: fallback(z.string(), "").default("") });

export const Route = createFileRoute("/search")({
  validateSearch: zodValidator(schema),
  component: SearchPage,
});

function SearchPage() {
  const { q } = Route.useSearch();
  const term = q.trim().toLowerCase();
  const { data: plants = [] } = useQuery({ queryKey: ["plants"], queryFn: fetchAllPlants });
  const { data: catalogs = [] } = useQuery({ queryKey: ["all-catalogs"], queryFn: fetchAllCatalogs });
  const { data: entries = [] } = useQuery({ queryKey: ["all-catalog-entries"], queryFn: fetchAllEntries });
  const { data: tags = [] } = useQuery({ queryKey: ["all-tags"], queryFn: fetchAllTags });

  const matcher = useMemo(() => buildPlantMatcher(plants), [plants]);

  const plantHits = useMemo(() => {
    if (!term) return [];
    return plants.filter((p) => {
      const hay = [p.title, p.scientific_name, p.common_names_zh, p.common_name_en, p.family, p.genus, p.habitat, p.summary, ...(p.tags ?? [])]
        .filter(Boolean).join(" ").toLowerCase();
      return hay.includes(term);
    });
  }, [plants, term]);

  const tagHits = useMemo(
    () => (term ? tags.filter((t) => (t.name + " " + (t.description ?? "")).toLowerCase().includes(term)) : []),
    [tags, term],
  );

  const catalogHits = useMemo(() => {
    if (!term) return [];
    const catById = new Map(catalogs.map((c) => [c.id, c] as const));
    return entries
      .filter((e) =>
        (e.scientific_name + " " + (e.chinese_name ?? "")).toLowerCase().includes(term),
      )
      .map((e) => ({
        entry: e,
        catalog: catById.get(e.catalog_id),
        plant: matcher(e),
      }))
      .filter((h) => !!h.catalog)
      .slice(0, 100);
  }, [entries, catalogs, term, matcher]);

  return (
    <div className="min-h-screen flex flex-col">
      <SiteHeader />
      <main className="mx-auto max-w-5xl px-6 py-10 flex-1 w-full">
        <div className="border-b-2 border-ink pb-6 mb-6">
          <p className="label text-vermilion mb-2">Search · 全文搜索</p>
          <h1 className="font-display text-4xl font-bold">
            搜索结果：<span className="text-vermilion">{q || "（空）"}</span>
          </h1>
          <p className="text-ink-faint mt-2 text-sm">
            搜索范围：已收录档案（标题/学名/英文俗名/科属/摘要/标签）+ 地区植物名录条目 + 标签
          </p>
        </div>

        {!term ? (
          <p className="text-ink-faint py-12 text-center">在导航栏输入关键词开始搜索。</p>
        ) : (
          <div className="space-y-10">
            <section>
              <h2 className="font-display text-xl font-bold mb-2 border-b border-ink pb-1">
                已收录档案 · {plantHits.length}
              </h2>
              {plantHits.length === 0 ? (
                <p className="text-ink-faint text-sm py-3">无匹配</p>
              ) : (
                <ul className="divide-y divide-rule">
                  {plantHits.map((p) => (
                    <li key={p.id} className="py-2">
                      <Link to="/plants/$slug" params={{ slug: p.slug }} className="flex items-baseline gap-2 hover:text-vermilion">
                        <span className="font-display font-semibold">{p.title}</span>
                        {p.scientific_name && <span className="italic text-sm text-ink-soft">{p.scientific_name}</span>}
                        {p.family && <span className="text-xs text-ink-faint">{p.family}</span>}
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section>
              <h2 className="font-display text-xl font-bold mb-2 border-b border-ink pb-1">
                标签 · {tagHits.length}
              </h2>
              {tagHits.length === 0 ? (
                <p className="text-ink-faint text-sm py-3">无匹配</p>
              ) : (
                <ul className="flex flex-wrap gap-2">
                  {tagHits.map((t) => (
                    <li key={t.id}>
                      <Link
                        to="/tags/$slug"
                        params={{ slug: t.slug }}
                        className="border border-emerald-700 text-emerald-700 px-3 py-1 text-sm hover:bg-emerald-700 hover:text-background"
                      >
                        #{t.name}
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section>
              <h2 className="font-display text-xl font-bold mb-2 border-b border-ink pb-1">
                地区植物名录 · {catalogHits.length}
              </h2>
              {catalogHits.length === 0 ? (
                <p className="text-ink-faint text-sm py-3">无匹配</p>
              ) : (
                <ul className="divide-y divide-rule text-sm">
                  {catalogHits.map((h) => (
                    <li key={h.entry.id} className="py-1.5 flex items-baseline gap-2 flex-wrap">
                      {h.plant ? (
                        <Link
                          to="/plants/$slug"
                          params={{ slug: h.plant.slug }}
                          className="text-[oklch(0.55_0.18_240)] hover:underline"
                        >
                          <span className="italic">{h.entry.scientific_name}</span>
                          {h.entry.chinese_name ? ` · ${h.entry.chinese_name}` : ""}
                        </Link>
                      ) : (
                        <span>
                          <span className="italic">{h.entry.scientific_name}</span>
                          {h.entry.chinese_name ? ` · ${h.entry.chinese_name}` : ""}
                        </span>
                      )}
                      <span className="text-xs text-ink-faint">
                        — {h.catalog ? regionLabel(h.catalog) : ""}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>
        )}
      </main>
      <SiteFooter />
    </div>
  );
}
