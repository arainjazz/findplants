import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { SiteHeader, SiteFooter } from "@/components/site-header";
import { fetchTagBySlug, fetchAllTags, fetchTagMembership } from "@/lib/tags";
import { fetchAllPlants } from "@/lib/plants";
import { supabase } from "@/integrations/supabase/client";
import { useMemo } from "react";

export const Route = createFileRoute("/tags/$slug")({
  component: TagPage,
});

/** 专题页要展示的草稿字段。只取这几列 —— 草稿表很宽，整行拉回来纯属浪费。 */
type TaggedDraft = {
  id: string;
  title: string | null;
  scientific_name: string | null;
  family: string | null;
  photo_url: string | null;
  status: string | null;
};

async function fetchDraftsByIds(ids: string[]): Promise<TaggedDraft[]> {
  if (!ids.length) return [];
  const { data, error } = await supabase
    .from("plant_drafts")
    .select("id,title,scientific_name,family,photo_url,status")
    .in("id", ids);
  if (error) return [];
  return (data ?? []) as TaggedDraft[];
}

function TagPage() {
  const { slug } = Route.useParams();
  const { data: tag, isLoading } = useQuery({
    queryKey: ["tag", slug],
    queryFn: () => fetchTagBySlug(slug),
  });
  // 🔴 这一页曾经只读 `plant_tags` 关联表 → 用户在识别卡上「手动添加 #tag 标签」挂上的
  // 草稿一条都不显示，专题页永远是「此标签下还没有物种」。membership 现在取三源并集
  // （关联表 + plants.tags + plant_drafts.tags），见 lib/tags.ts 顶部注释。
  const { data: allTags = [] } = useQuery({ queryKey: ["all-tags"], queryFn: fetchAllTags });
  const { data: membership } = useQuery({
    queryKey: ["tag-membership"],
    queryFn: () => fetchTagMembership(allTags),
    enabled: allTags.length > 0,
    staleTime: 60_000,
  });
  const mine = tag ? membership?.get(tag.id) : undefined;

  const { data: plants = [] } = useQuery({ queryKey: ["plants"], queryFn: fetchAllPlants });
  const { data: drafts = [] } = useQuery({
    queryKey: ["tag-drafts", tag?.id, mine?.draftIds.length ?? 0],
    queryFn: () => fetchDraftsByIds(mine?.draftIds ?? []),
    enabled: !!mine?.draftIds.length,
  });

  const list = useMemo(() => {
    const set = new Set(mine?.plantIds ?? []);
    return plants
      .filter((p) => set.has(p.id))
      .sort((a, b) => (a.scientific_name ?? a.title).localeCompare(b.scientific_name ?? b.title));
  }, [plants, mine]);

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
          <p className="text-xs text-ink-faint mt-2">
            由 {tag.created_by_name ?? "—"} 创建 · 已收录 {list.length} 个物种
            {drafts.length > 0 && ` · 另有 ${drafts.length} 条待审草稿`}
          </p>
        </div>

        {list.length === 0 && drafts.length === 0 ? (
          <p className="text-ink-faint">此标签下还没有条目。</p>
        ) : (
          <>
            {list.length > 0 && (
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

            {/* 草稿单独一组、且排在已收录条目之后 —— 它们还没过审，不该和成品混在一起
                读成「本专题已有 N 种」。但也必须显示：用户在识别卡上挂标签产生的就是草稿，
                看不到的话，标签挂了等于没挂（这正是这一页原来的毛病）。 */}
            {drafts.length > 0 && (
              <section className="mt-8">
                <h2 className="font-display text-lg font-semibold border-b border-rule pb-2 mb-3">
                  待审草稿（{drafts.length}）
                  <span className="ml-2 text-xs font-normal text-ink-faint">
                    来自识别简介摘要卡上手动挂的标签，尚未收录为正式条目
                  </span>
                </h2>
                <ul className="divide-y divide-rule border-y border-rule">
                  {drafts.map((d) => (
                    <li key={d.id} className="py-3">
                      <Link
                        to="/drafts/$id"
                        params={{ id: d.id }}
                        className="flex items-baseline gap-3 hover:bg-paper-deep/40 px-2 -mx-2"
                      >
                        <span className="font-display text-base font-semibold text-ink-soft hover:text-vermilion">
                          {d.title || "未命名草稿"}
                        </span>
                        {d.scientific_name && (
                          <span className="italic text-sm text-ink-faint">{d.scientific_name}</span>
                        )}
                        {d.family && <span className="text-xs text-ink-faint">{d.family}</span>}
                      </Link>
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </>
        )}
      </main>
      <SiteFooter />
    </div>
  );
}
