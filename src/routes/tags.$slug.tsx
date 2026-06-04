import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { SiteHeader, SiteFooter } from "@/components/site-header";
import { fetchTagBySlug, fetchPlantIdsForTag } from "@/lib/tags";
import { fetchAllPlants } from "@/lib/plants";
import { useMemo } from "react";

export const Route = createFileRoute("/tags/$slug")({
  component: TagPage,
});

function TagPage() {
  const { slug } = Route.useParams();
  const { data: tag, isLoading } = useQuery({
    queryKey: ["tag", slug],
    queryFn: () => fetchTagBySlug(slug),
  });
  const { data: plantIds = [] } = useQuery({
    queryKey: ["tag-plants", tag?.id],
    queryFn: () => (tag ? fetchPlantIdsForTag(tag.id) : Promise.resolve([])),
    enabled: !!tag,
  });
  const { data: plants = [] } = useQuery({ queryKey: ["plants"], queryFn: fetchAllPlants });

  const list = useMemo(() => {
    const set = new Set(plantIds);
    return plants
      .filter((p) => set.has(p.id))
      .sort((a, b) => (a.scientific_name ?? a.title).localeCompare(b.scientific_name ?? b.title));
  }, [plants, plantIds]);

  if (isLoading) {
    return (
      <div className="min-h-screen flex flex-col">
        <SiteHeader />
        <main className="mx-auto max-w-3xl px-6 py-20 flex-1 text-ink-faint">载入中…</main>
        <SiteFooter />
      </div>
    );
  }
  if (!tag) throw notFound();

  return (
    <div className="min-h-screen flex flex-col">
      <SiteHeader />
      <main className="mx-auto max-w-5xl px-6 py-10 flex-1 w-full">
        <Link to="/" className="label hover:text-vermilion">← 返回首页</Link>
        <div className="border-b-2 border-ink pb-6 mb-8 mt-4">
          <p className="label text-vermilion mb-2">Tag · 整理标签</p>
          <h1 className="font-display text-5xl font-bold text-emerald-700">#{tag.name}</h1>
          {tag.description && <p className="text-ink-faint mt-3">{tag.description}</p>}
          <p className="text-xs text-ink-faint mt-2">由 {tag.created_by_name ?? "—"} 创建 · 共 {list.length} 个物种</p>
        </div>
        {list.length === 0 ? (
          <p className="text-ink-faint">此标签下还没有物种。</p>
        ) : (
          <ul className="divide-y divide-rule border-y border-rule">
            {list.map((p) => (
              <li key={p.id} className="py-3">
                <Link
                  to="/plants/$slug"
                  params={{ slug: p.slug }}
                  className="flex items-baseline gap-3 hover:bg-paper-deep/40 px-2 -mx-2"
                >
                  <span className="font-display text-lg font-semibold text-emerald-700 hover:text-vermilion">
                    {p.title}
                  </span>
                  {p.scientific_name && (
                    <span className="italic text-sm text-ink-soft">{p.scientific_name}</span>
                  )}
                  {p.family && <span className="text-xs text-ink-faint">{p.family}</span>}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </main>
      <SiteFooter />
    </div>
  );
}
