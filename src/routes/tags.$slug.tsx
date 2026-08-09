import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { SiteHeader, SiteFooter } from "@/components/site-header";
import { fetchTags, fetchTagMembership, type Tag, type TagMembership } from "@/lib/tags";
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

/** 已收录条目同理，只要列表要显示的那几列。 */
type TaggedPlant = {
  id: string;
  slug: string;
  title: string;
  scientific_name: string | null;
  family: string | null;
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

/** 按 id 精确取条目。以前这里拉的是 `fetchAllPlants()`（268 行整表）再在前端过滤出 3 条。 */
async function fetchPlantsByIds(ids: string[]): Promise<TaggedPlant[]> {
  if (!ids.length) return [];
  const { data, error } = await supabase
    .from("plants")
    .select("id,slug,title,scientific_name,family")
    .in("id", ids);
  if (error) return [];
  return (data ?? []) as TaggedPlant[];
}

/**
 * 兜底：slug 在 `tags` 表里查无此行时，按**标签名**直接找。
 *
 * 谁会走到这条路：条目页上那一排卡签里，除了人手动挂的主题标签，还有 AI 自动填的
 * **特征词**（盐生植物 / 多年生草本 / 耐盐碱…）。它们从来没有 tags 表的行，链接是拿
 * 标签名当 slug 拼的 —— 从前点下去直接撞 404「未收录此条目」，读者以为站坏了。
 * 现在照样给一份名单，只是页头会说明这是特征词而非专题。
 */
async function fetchByTagName(
  name: string,
): Promise<{ plants: TaggedPlant[]; drafts: TaggedDraft[] }> {
  if (!name) return { plants: [], drafts: [] };
  const [p, d] = await Promise.all([
    supabase
      .from("plants")
      .select("id,slug,title,scientific_name,family")
      .contains("tags", [name]),
    supabase
      .from("plant_drafts")
      .select("id,title,scientific_name,family,photo_url,status")
      .contains("tags", [name])
      .neq("status", "rejected"),
  ]);
  return {
    plants: (p.data ?? []) as TaggedPlant[],
    drafts: (d.data ?? []) as TaggedDraft[],
  };
}

function TagPage() {
  const { slug } = Route.useParams();

  // ── 标签本体 + 三源并集，一次查完 ─────────────────────────────────────────
  // 复用 /explore 的 ["explore-tag-index"] 缓存：那一页已经在用同一份数据，从地图点进
  // 专题页就是白拿。
  // ⚠️ 这里**刻意不用** `fetchAllTags`：它内部会自己跑一遍 fetchTagMembership，而下面
  // 还要再跑一遍 —— 三张表的分页拉取因此整整跑了两趟（实测这一页要空转 ~4 秒才出名单，
  // 期间页面上写着「此标签下还没有条目」，读者当场就走了）。这一页不需要计数，
  // 用 fetchTags（单表一次）+ 一趟 membership 就够。
  const { data: index, isLoading } = useQuery({
    queryKey: ["explore-tag-index"],
    queryFn: async () => {
      const tags = await fetchTags();
      if (!tags.length) return { tags, membership: new Map<string, TagMembership>() };
      return { tags, membership: await fetchTagMembership(tags) };
    },
    staleTime: 5 * 60 * 1000,
  });

  const tag: Tag | null = useMemo(
    () => (index?.tags ?? []).find((t) => t.slug === slug) ?? null,
    [index, slug],
  );
  const mine = tag ? index?.membership.get(tag.id) : undefined;

  const { data: plants = [], isFetching: plantsLoading } = useQuery({
    queryKey: ["tag-plants", tag?.id, mine?.plantIds.length ?? 0],
    queryFn: () => fetchPlantsByIds(mine?.plantIds ?? []),
    enabled: !!mine?.plantIds.length,
  });
  const { data: drafts = [], isFetching: draftsLoading } = useQuery({
    queryKey: ["tag-drafts", tag?.id, mine?.draftIds.length ?? 0],
    queryFn: () => fetchDraftsByIds(mine?.draftIds ?? []),
    enabled: !!mine?.draftIds.length,
  });

  // 特征词兜底（tags 表里没有这个 slug 时才跑）。
  const fallbackName = useMemo(() => {
    if (isLoading || tag) return "";
    try {
      return decodeURIComponent(slug);
    } catch {
      return slug;
    }
  }, [isLoading, tag, slug]);
  const { data: byName, isFetching: byNameLoading } = useQuery({
    queryKey: ["tag-by-name", fallbackName],
    queryFn: () => fetchByTagName(fallbackName),
    enabled: !!fallbackName,
  });

  const plantList = useMemo(() => {
    const rows = tag ? plants : (byName?.plants ?? []);
    return [...rows].sort((a, b) =>
      (a.scientific_name ?? a.title).localeCompare(b.scientific_name ?? b.title),
    );
  }, [tag, plants, byName]);
  const draftList = tag ? drafts : (byName?.drafts ?? []);

  /** 名单还在路上。**必须和「确实是空的」分开**：混成一句「此标签下还没有条目」，
   *  读者在等待的那几秒里看到的就是一句错话（用户 2026-08-08 报的正是这个）。 */
  const loading =
    isLoading ||
    (!!tag && !index) ||
    plantsLoading ||
    draftsLoading ||
    byNameLoading ||
    (!tag && !!fallbackName && !byName);

  const title = tag?.name || fallbackName || slug;

  if (isLoading) {
    return (
      <div className="min-h-screen flex flex-col">
        <SiteHeader />
        <main className="mx-auto max-w-3xl px-6 py-20 flex-1 text-ink-faint">载入中…</main>
        <SiteFooter />
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col">
      <SiteHeader />
      <main className="mx-auto max-w-5xl px-6 py-10 flex-1 w-full">
        <div className="flex flex-wrap items-center gap-4">
          <Link to="/" className="label hover:text-vermilion">
            ← 返回首页
          </Link>
          <Link to="/plants" className="label hover:text-vermilion">
            浏览全部标签 →
          </Link>
        </div>
        <div className="border-b-2 border-ink pb-6 mb-8 mt-4">
          <p className="label text-vermilion mb-2">
            {tag ? "Tag · 整理标签" : "Tag · 特征词"}
          </p>
          <h1 className="font-display text-5xl font-bold text-emerald-700">#{title}</h1>
          {tag?.description && <p className="text-ink-faint mt-3">{tag.description}</p>}
          <p className="text-xs text-ink-faint mt-2">
            {tag ? (
              <>
                由 {tag.created_by_name ?? "—"} 创建 ·{" "}
                {loading ? "正在统计…" : `已收录 ${plantList.length} 个物种`}
                {!loading && draftList.length > 0 && ` · 另有 ${draftList.length} 条待审草稿`}
              </>
            ) : (
              <>
                这是 AI 自动标注的<b>特征词</b>，不是人工整理的专题标签 ——
                下面列出正文里标了同一个词的物种。
              </>
            )}
          </p>
        </div>

        {loading ? (
          /* 骨架屏：先告诉读者「在查」，别让空名单被读成「这里什么都没有」。 */
          <div className="space-y-3" aria-busy="true">
            <p className="text-ink-faint text-sm">正在查找该标签下的物种…</p>
            {[0, 1, 2].map((i) => (
              <div key={i} className="h-10 rounded bg-paper-deep/60 animate-pulse" />
            ))}
          </div>
        ) : plantList.length === 0 && draftList.length === 0 ? (
          <p className="text-ink-faint">此标签下还没有条目。</p>
        ) : (
          <>
            {plantList.length > 0 && (
              <ul className="divide-y divide-rule border-y border-rule">
                {plantList.map((p) => (
                  <li key={p.id} className="py-3">
                    {/* `from` 让条目页知道「读者是从哪个标签名单点进来的」，
                        好在那一页顶上给一条「← 返回 #标签 名单」的退路。 */}
                    <Link
                      to="/plants/$slug"
                      params={{ slug: p.slug }}
                      search={{ from: slug }}
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
            {draftList.length > 0 && (
              <section className="mt-8">
                <h2 className="font-display text-lg font-semibold border-b border-rule pb-2 mb-3">
                  待审草稿（{draftList.length}）
                  <span className="ml-2 text-xs font-normal text-ink-faint">
                    来自识别简介摘要卡上手动挂的标签，尚未收录为正式条目
                  </span>
                </h2>
                <ul className="divide-y divide-rule border-y border-rule">
                  {draftList.map((d) => (
                    <li key={d.id} className="py-3">
                      <Link
                        to="/drafts/$id"
                        params={{ id: d.id }}
                        search={{ from: slug }}
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
