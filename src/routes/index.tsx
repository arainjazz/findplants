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
import { fetchPendingDrafts, type PlantDraft } from "@/lib/drafts";
import { DraftCard } from "@/components/draft-card";
import { useServerFn } from "@tanstack/react-start";
import { fetchPublishedPosts, blogCoverUrl, type BlogPost } from "@/lib/blog";
import { type EditorColumnEntry } from "@/lib/editor-stats";
import { fetchEditorColumnFn } from "@/lib/identify-plant.functions";
import { SafeImg } from "@/components/safe-img";

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
  const { data: blogPosts = [] } = useQuery({ queryKey: ["home-blog"], queryFn: fetchPublishedPosts });
  const editorColumnFn = useServerFn(fetchEditorColumnFn);
  const { data: editorColumn = [] } = useQuery({
    queryKey: ["editor-column"],
    queryFn: () => editorColumnFn() as Promise<EditorColumnEntry[]>,
  });
  const { data: isEditorOrAdmin = false } = useQuery({
    queryKey: ["is-editor-or-admin", user?.id],
    enabled: !!user,
    queryFn: async () => {
      if (!user) return false;
      const { data } = await supabase.from("user_roles").select("role").eq("user_id", user.id);
      return !!data?.some((r) => r.role === "editor" || r.role === "admin");
    },
  });
  const { data: drafts = [] } = useQuery({
    queryKey: ["home-drafts"],
    queryFn: () => fetchPendingDrafts(3),
    enabled: isEditorOrAdmin,
  });
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
  // 首页最多展示 18 个条目：hero(1) + sub(3) + rest(14)。
  const rest = sorted.slice(4, 18);

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
          <div className="mt-4 hidden md:flex items-start justify-between gap-3 flex-nowrap">
            <div className="min-w-0">
              <div className="text-[11px] md:text-xs lg:text-base whitespace-nowrap">地球上还有10万种植物等着你去发现</div>
              <div className="label mt-0.5 text-[10px] md:text-[10px] lg:text-xs whitespace-nowrap">Another 100,000 plant species remain to be discovered.</div>
            </div>
            <div className="text-right min-w-0">
              <div className="text-[11px] md:text-xs lg:text-base whitespace-nowrap">由社区编纂 · 持续更新</div>
              <div className="label mt-0.5 text-[10px] md:text-[10px] lg:text-xs whitespace-nowrap">Community-compiled, continuously updated.</div>
            </div>
          </div>
        </section>


        {/* Pending drafts feed — editors / admins only, max 3 on home */}
        {isEditorOrAdmin && drafts.length > 0 && <DraftsStrip drafts={drafts} />}


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
                {/* 紧凑的图片卡片网格（手机端 2 列，非列表式）。 */}
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-x-4 gap-y-6 sm:gap-x-6">
                  {rest.map((p) => (
                    <Link key={p.id} to="/plants/$slug" params={{ slug: p.slug }} className="group block">
                      <div className="overflow-hidden border border-rule bg-paper-deep mb-2 aspect-square">
                        {p.cover_url ? (
                          <img src={p.cover_url} alt={p.title} className="w-full h-full object-cover group-hover:scale-[1.04] transition-transform duration-500" />
                        ) : (
                          <PlantPattern />
                        )}
                      </div>
                      <h3 className="font-display text-sm sm:text-base font-semibold leading-tight line-clamp-2 group-hover:text-vermilion transition-colors">{p.title}</h3>
                      {p.scientific_name && <p className="italic text-[11px] text-ink-faint truncate">{p.scientific_name}</p>}
                      {tab === "hot" ? (
                        <p className="label text-[10px] mt-0.5">{p.comments_count ?? 0} 评论</p>
                      ) : (
                        p.family && <p className="label text-[10px] mt-0.5">{p.family}</p>
                      )}
                    </Link>
                  ))}
                </div>
              </section>
            )}
          </>
        )}

        {/* 编辑博文 · recent posts written by editors */}
        <EditorsBlogStrip posts={blogPosts} />

        {/* 编辑专栏 · contributor column (before footer) */}
        <ContributorsColumn editors={editorColumn} />

        {/* 植物搜图 · jumps to the standalone /plant-image-search.html sub-page */}
        <PlantImageSearchBox />
      </main>
      <SiteFooter />
    </div>
  );
}

function PlantImageSearchBox() {
  const [q, setQ] = useState("");
  const go = () => {
    const term = q.trim();
    // Standalone static sub-page lives outside the SPA → native navigation.
    window.location.href = "/plant-image-search.html" + (term ? "?q=" + encodeURIComponent(term) : "");
  };
  return (
    <section className="mt-16 border-t border-rule pt-10">
      <div className="mb-5">
        <p className="label text-vermilion">植物搜图 · Plant Image Search</p>
        <p className="text-xs text-ink-faint mt-1">
          输入植物名（中文 / 学名 / 英文俗名），从 iNaturalist · GBIF · Wikimedia 等全网图库以瀑布流检索图像。
        </p>
      </div>
      <form
        onSubmit={(e) => { e.preventDefault(); go(); }}
        className="flex items-stretch gap-2 max-w-2xl"
      >
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="如：银杏 / Ginkgo biloba / 蒲公英…"
          className="flex-1 border border-ink/40 px-4 py-3 text-sm bg-background focus:outline-none focus:border-vermilion"
        />
        <button type="submit" className="bg-ink text-background px-6 py-3 text-sm hover:bg-vermilion transition-colors shrink-0 whitespace-nowrap">
          检索图像
        </button>
      </form>
    </section>
  );
}

function EditorsBlogStrip({ posts }: { posts: BlogPost[] }) {
  if (!posts || posts.length === 0) return null;
  const list = posts.slice(0, 6);
  return (
    <section className="mt-16 border-t border-rule pt-10">
      <div className="flex items-baseline justify-between mb-6">
        <div>
          <p className="label text-vermilion">编辑博文 · From the Editors</p>
          <p className="text-xs text-ink-faint mt-1">编辑们的最新随笔、考据与栏目更新</p>
        </div>
        <Link to="/blog" className="label hover:text-vermilion">全部博文 →</Link>
      </div>
      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-8">
        {list.map((p) => (
          <Link key={p.id} to="/blog/$slug" params={{ slug: p.slug }} className="group block">
            <div className="overflow-hidden border border-rule bg-paper-deep mb-3 aspect-[16/10]">
              <SafeImg
                src={blogCoverUrl(p)}
                alt={p.title}
                className="w-full h-full object-cover group-hover:scale-[1.03] transition-transform duration-500"
                fallback={<PlantPattern />}
              />
            </div>
            <h3 className="font-display text-xl font-semibold leading-snug group-hover:text-vermilion transition-colors line-clamp-2">{p.title}</h3>
            {p.subtitle && <p className="text-sm text-ink-soft mt-1 line-clamp-2">{p.subtitle}</p>}
            <p className="label text-[10px] mt-2 text-ink-faint">
              {p.author_name || "编辑"} · {new Date(p.published_at || p.created_at).toLocaleDateString("zh-CN")}
            </p>
          </Link>
        ))}
      </div>
    </section>
  );
}

function StatBadge({ n, kind, caption }: { n: number; kind: "edit" | "identify" | "blog"; caption: string }) {
  // Frames are black (ink); only the number is colored.
  const numCls =
    kind === "edit"
      ? "text-vermilion" // 编辑量 → 红
      : kind === "identify"
        ? "text-[oklch(0.45_0.18_240)]" // 识别 → 蓝
        : "text-emerald-700"; // 博文 → 绿
  return (
    <div className="flex flex-col items-center gap-1" title={caption}>
      <span className="relative inline-flex items-center justify-center w-9 h-9">
        {kind === "edit" && <span className="absolute inset-[5%] border-2 border-ink rounded-[2px]" aria-hidden="true" />}
        {kind === "blog" && <span className="absolute inset-0 border-2 border-ink rounded-full" aria-hidden="true" />}
        {kind === "identify" && <FlowerMark className="absolute inset-0 w-full h-full text-ink" />}
        <span className={`relative text-sm font-bold tabular-nums ${numCls}`}>{n}</span>
      </span>
      <span className="text-[10px] text-ink-faint leading-none">{caption}</span>
    </div>
  );
}

// Flat black-line flower mark (no background) for the 识别 badge: 5 convex arcs
// with gaps (a scalloped flower), matching the reference image. Sized to fill the
// badge box like the square/circle beside it (radius near the viewBox edge).
function FlowerMark({ className }: { className?: string }) {
  // 5 plump petals (each a tightly-curved arc) with small gaps between them —
  // matches the reference flower. rPos = where petal endpoints sit; rArc (< the
  // chord-implied min would fail, so kept comfortably above) controls plumpness.
  // rPos/rArc scaled ×1.1 vs the prior 18/12 to enlarge the bloom ~10%.
  const cx = 24, cy = 24, rPos = 19.8, half = 29, rArc = 13.2;
  const pt = (deg: number) => {
    const a = (deg * Math.PI) / 180;
    return `${(cx + rPos * Math.cos(a)).toFixed(2)} ${(cy + rPos * Math.sin(a)).toFixed(2)}`;
  };
  const d = Array.from({ length: 5 }, (_, k) => {
    const c = -90 + k * 72; // first petal centered at the top
    return `M ${pt(c - half)} A ${rArc} ${rArc} 0 0 1 ${pt(c + half)}`;
  }).join(" ");
  return (
    <svg viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" className={className} aria-hidden="true">
      <path d={d} />
    </svg>
  );
}

function ContributorsColumn({ editors }: { editors: EditorColumnEntry[] }) {
  if (!editors || editors.length === 0) return null;
  return (
    <section className="mt-16 border-t border-rule pt-10">
      <div className="mb-6">
        <p className="label text-vermilion">编辑专栏 · Contributors</p>
        <p className="text-xs text-ink-faint mt-1">点击进入查看某位编辑贡献的全部内容</p>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-5">
        {editors.map((e) => (
          <a key={e.id} href={`/editors/${e.id}`} className="p-4 flex flex-col items-center text-center hover:bg-paper-deep/40 transition-colors cursor-pointer group rounded-sm">
            <div className="w-16 h-16 rounded-full overflow-hidden border border-rule bg-background flex items-center justify-center mb-2 group-hover:border-ink">
              <SafeImg
                src={e.avatar_url}
                alt={e.display_name}
                className="w-full h-full object-cover"
                fallback={<span className="font-display text-2xl text-ink-faint">{e.display_name.slice(0, 1)}</span>}
              />
            </div>
            <h3 className="font-semibold text-sm truncate max-w-full">{e.display_name}</h3>
            <p className="text-[10px] text-ink-faint mt-0.5">
              {e.joined_at ? `${new Date(e.joined_at).toLocaleDateString("zh-CN")} 加入` : "—"}
            </p>
            <p className="text-[10px] text-ink-faint max-w-full text-balance">
              {e.areas ? `活动于 ${e.areas}` : "活动区域未知"}
            </p>
            <div className="flex items-start justify-center gap-3 mt-3">
              <StatBadge n={e.editScore} kind="edit" caption="编辑" />
              <StatBadge n={e.identifyScore} kind="identify" caption="识别" />
              <StatBadge n={e.blogScore} kind="blog" caption="博文" />
            </div>
          </a>
        ))}
      </div>
    </section>
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

function DraftsStrip({ drafts }: { drafts: PlantDraft[] }) {
  return (
    <section id="drafts" className="mb-12 border-t border-rule pt-8 scroll-mt-20">
      <div className="flex items-baseline justify-between mb-4">
        <div>
          <p className="label text-vermilion">最新识别 · Pending AI Drafts</p>
          <p className="text-xs text-ink-faint mt-1">由访客拍摄并经 AI 识别的草稿，等待编辑审核后正式收录（首页仅展示最新 3 条）</p>
        </div>
        <Link to="/identify" className="text-xs text-ink-faint hover:text-vermilion">查看全部 →</Link>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {drafts.map((d) => (
          <DraftCard key={d.id} draft={d} showPendingBadge />
        ))}
      </div>
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
