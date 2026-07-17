import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { SiteHeader, SiteFooter } from "@/components/site-header";
import { useAuth } from "@/hooks/use-auth";
import { isCurrentUserAdmin } from "@/lib/edits";
import { fetchAllPlants, fetchMyPlants, type Plant } from "@/lib/plants";
import { EntryTypeBadge } from "@/components/entry-type-badge";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { regionLabel, deleteCatalog, fetchMyCatalogs, type RegionalCatalog } from "@/lib/catalogs";
import { CatalogRow } from "@/components/catalog-row";
import {
  fetchConservationData,
  protectedListRank,
  CITES_APPENDICES,
  GTS_CATEGORIES,
  GRIIS_DEGREES,
  type ConservationList,
  type ConservationTaxon,
} from "@/lib/conservation";
import { fetchAllTags, type TagWithCount } from "@/lib/tags";
import { fetchMyPosts, type BlogPost } from "@/lib/blog";
import { fetchMyProjects, type Project } from "@/lib/projects";

export const Route = createFileRoute("/_authenticated/admin/")({
  component: AdminPage,
});

function AdminPage() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [searchQuery, setSearchQuery] = useState("");
  const { data: isAdmin = false } = useQuery({
    queryKey: ["is-admin", user?.id],
    queryFn: () => isCurrentUserAdmin(user?.id),
    enabled: !!user,
  });
  const { data: plants = [], isLoading } = useQuery({
    queryKey: ["my-plants", user?.id],
    queryFn: () => fetchMyPlants(user!.id),
    enabled: !!user,
  });

  const { data: myCatalogs = [] } = useQuery({
    queryKey: ["my-catalogs", user?.id],
    queryFn: () => fetchMyCatalogs(user!.id),
    enabled: !!user,
  });

  const { data: allPlants = [] } = useQuery({
    queryKey: ["plants"],
    queryFn: fetchAllPlants,
    enabled: !!user && (myCatalogs?.length ?? 0) > 0,
  });

  const { data: myTags = [] } = useQuery<TagWithCount[]>({
    queryKey: ["my-tags", user?.id, isAdmin],
    queryFn: async () => {
      const all = await fetchAllTags();
      return isAdmin ? all : all.filter((t) => t.created_by === user!.id);
    },
    enabled: !!user,
  });

  const { data: myPosts = [] } = useQuery<BlogPost[]>({
    queryKey: ["my-blog", user?.id],
    queryFn: () => fetchMyPosts(user!.id),
    enabled: !!user,
  });

  const { data: myProjects = [] } = useQuery<Project[]>({
    queryKey: ["my-projects", user?.id],
    queryFn: () => fetchMyProjects(user!.id),
    enabled: !!user,
  });

  // 保护名录（国家/省级重点保护 + CITES/GTS/GRIIS）— 与全站共用的 query key，
  // 详情页卡签 / 地图 / 档案检索 已经拉过一次，这里直接吃缓存。
  const { data: consData } = useQuery({
    queryKey: ["conservation-data"],
    queryFn: fetchConservationData,
    staleTime: 5 * 60 * 1000,
    enabled: !!user,
  });
  const consLists = consData?.lists ?? [];
  const consTaxa = consData?.taxa ?? [];
  const taxaByList = new Map<string, ConservationTaxon[]>();
  for (const t of consTaxa) {
    const a = taxaByList.get(t.list_id);
    if (a) a.push(t);
    else taxaByList.set(t.list_id, [t]);
  }

  // Category filter (dropdown right of the search box). "all" shows every section.
  type Category = "all" | "skill" | "ai" | "catalogs" | "global" | "tags" | "blog" | "projects";
  const [category, setCategory] = useState<Category>("all");
  const CATEGORY_OPTIONS: { value: Category; label: string }[] = [
    { value: "all", label: "全部类别" },
    { value: "skill", label: "搜索 skill 创建条目" },
    { value: "ai", label: "搜索 AI 识别条目" },
    { value: "catalogs", label: "搜索地区植物目录" },
    { value: "global", label: "搜索国际生物多样性保护" },
    { value: "tags", label: "搜索 tag 标签" },
    { value: "blog", label: "搜索博客" },
    { value: "projects", label: "搜索项目" },
  ];
  const showCat = (c: Category) => category === "all" || category === c;
  /** Section order — drives which section a search jumps to first. */
  const SECTION_ORDER = ["skill", "ai", "catalogs", "global", "tags", "blog", "projects"] as const;

  const onDelete = async (p: Plant) => {
    if (!confirm(`确定删除「${p.title}」？此操作不可撤销。`)) return;
    const { error } = await supabase.from("plants").delete().eq("id", p.id);
    if (error) return toast.error(error.message);
    toast.success("已删除");
    qc.invalidateQueries({ queryKey: ["my-plants"] });
    qc.invalidateQueries({ queryKey: ["plants"] });
    qc.invalidateQueries({ queryKey: ["home"] });
  };

  // 文本搜索（跨类别通用）+ 类别筛选
  const q = searchQuery.trim().toLowerCase();
  const matchPlant = (p: Plant) =>
    !q ||
    p.title?.toLowerCase().includes(q) ||
    p.scientific_name?.toLowerCase().includes(q) ||
    p.common_names_zh?.toLowerCase().includes(q);
  // AI 识别条目 = 拍照识别/金叶一键/补拍合并；其余（skill 生成 HTML、批量、手动）归为 skill 条目。
  const AI_SOURCES = new Set(["ai_identify", "gold_oneclick", "draft_merge"]);
  const isAiPlant = (p: Plant) => AI_SOURCES.has((p as { source?: string | null }).source ?? "");
  const skillPlants = plants.filter((p) => !isAiPlant(p) && matchPlant(p));
  const aiPlants = plants.filter((p) => isAiPlant(p) && matchPlant(p));
  // 搜索命中定位：关键词不只比标题/名称，也比内容里面（目录条目、博客正文、项目正文）。
  // 命中正文时告诉用户「命中在哪」——是哪份目录里的哪个物种、哪篇文章的哪一句。
  const stripHtml = (h: string) =>
    h
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/g, " ")
      .replace(/\s+/g, " ")
      .trim();

  /** A short excerpt around the keyword, for「命中：…关键词…」hints. */
  const excerpt = (text: string, keyword: string, pad = 18): string | null => {
    const i = text.toLowerCase().indexOf(keyword);
    if (i < 0) return null;
    const start = Math.max(0, i - pad);
    const end = Math.min(text.length, i + keyword.length + pad);
    return (start > 0 ? "…" : "") + text.slice(start, end).trim() + (end < text.length ? "…" : "");
  };

  type Hit<T> = { item: T; where: string | null };

  const catalogHits: Hit<(typeof myCatalogs)[number]>[] = myCatalogs
    .map((c) => {
      if (!q) return { item: c, where: null };
      if (regionLabel(c).toLowerCase().includes(q)) return { item: c, where: null };
      const names = c.entryNames.filter((n) => n.toLowerCase().includes(q));
      if (!names.length) return null;
      return {
        item: c,
        where: `命中目录内 ${names.length} 个物种：${names.slice(0, 3).join("、")}${names.length > 3 ? " 等" : ""}`,
      };
    })
    .filter(Boolean) as Hit<(typeof myCatalogs)[number]>[];

  // 保护名录命中：先比名录名 / 省份，再比名录**内部**的物种（和地区目录同一套规则）。
  const consHit = (l: ConservationList): Hit<ConservationList> | null => {
    if (!q) return { item: l, where: null };
    if (l.name.toLowerCase().includes(q) || (l.province ?? "").toLowerCase().includes(q))
      return { item: l, where: null };
    const names = (taxaByList.get(l.id) ?? [])
      .filter(
        (t) =>
          t.scientific_name.toLowerCase().includes(q) ||
          (t.chinese_name ?? "").toLowerCase().includes(q),
      )
      .map((t) => [t.chinese_name, t.scientific_name].filter(Boolean).join(" "));
    if (!names.length) return null;
    return {
      item: l,
      where: `命中名录内 ${names.length} 个物种：${names.slice(0, 3).join("、")}${names.length > 3 ? " 等" : ""}`,
    };
  };

  // 国家 + 各省重点保护目录（kind='protected'），国家在前、省份按既定顺序。
  const protectedHits = consLists
    .filter((l) => l.kind === "protected")
    .sort(
      (a, b) =>
        protectedListRank(a.province ?? a.name) - protectedListRank(b.province ?? b.name) ||
        a.name.localeCompare(b.name),
    )
    .map(consHit)
    .filter(Boolean) as Hit<ConservationList>[];

  // 国际生物多样性保护 = 本站收录的 CITES / GRIIS / GTS 三份全球名录。
  const GLOBAL_KINDS = ["cites", "griis", "gts"];
  const globalHits = consLists
    .filter((l) => GLOBAL_KINDS.includes(l.kind))
    .sort((a, b) => GLOBAL_KINDS.indexOf(a.kind) - GLOBAL_KINDS.indexOf(b.kind))
    .map(consHit)
    .filter(Boolean) as Hit<ConservationList>[];

  const tagHits: Hit<(typeof myTags)[number]>[] = myTags
    .filter((t) => !q || t.name.toLowerCase().includes(q) || t.slug.toLowerCase().includes(q))
    .map((t) => ({
      item: t,
      where: q && !t.name.toLowerCase().includes(q) ? `命中标签别名：${t.slug}` : null,
    }));

  const postHits: Hit<BlogPost>[] = myPosts
    .map((b) => {
      if (!q) return { item: b, where: null };
      if (b.title.toLowerCase().includes(q) || (b.subtitle ?? "").toLowerCase().includes(q))
        return { item: b, where: null };
      const ex = excerpt(stripHtml(b.content_html ?? ""), q);
      return ex ? { item: b, where: `命中正文：${ex}` } : null;
    })
    .filter(Boolean) as Hit<BlogPost>[];

  const projectHits: Hit<Project>[] = myProjects
    .map((pr) => {
      if (!q) return { item: pr, where: null };
      if (pr.title.toLowerCase().includes(q)) return { item: pr, where: null };
      for (const [label, val] of [
        ["地点", pr.location],
        ["主题", pr.theme],
        ["发起人", pr.initiator],
        ["摘要", pr.summary ?? ""],
      ] as const) {
        if ((val ?? "").toLowerCase().includes(q))
          return { item: pr, where: `命中${label}：${val}` };
      }
      const ex = excerpt(stripHtml(pr.content_html ?? ""), q);
      return ex ? { item: pr, where: `命中正文：${ex}` } : null;
    })
    .filter(Boolean) as Hit<Project>[];

  const catalogsF = catalogHits.map((h) => h.item);
  const tagsF = tagHits.map((h) => h.item);
  const postsF = postHits.map((h) => h.item);
  const projectsF = projectHits.map((h) => h.item);

  const onDeleteCatalog = async (c: RegionalCatalog) => {
    if (!confirm(`确定删除「${regionLabel(c)}」的目录？该地区下所有条目都会被移除。`)) return;
    try {
      await deleteCatalog(c.id);
      toast.success("已删除");
      qc.invalidateQueries({ queryKey: ["my-catalogs"] });
      qc.invalidateQueries({ queryKey: ["all-catalogs"] });
      qc.invalidateQueries({ queryKey: ["plant-edits"] });
    } catch (err) {
      toast.error((err as Error).message);
    }
  };

  // 每栏默认折叠；只有当前关键词在某栏检索到内容时，该栏才自动展开，且页面跳到第一栏命中处。
  const sectionCounts: Record<(typeof SECTION_ORDER)[number], number> = {
    skill: skillPlants.length,
    ai: aiPlants.length,
    catalogs: catalogsF.length + protectedHits.length,
    global: globalHits.length,
    tags: tagsF.length,
    blog: postsF.length,
    projects: projectsF.length,
  };
  const autoOpen = (c: (typeof SECTION_ORDER)[number]) => !!q && sectionCounts[c] > 0;
  const firstHitSection = q
    ? SECTION_ORDER.find((c) => showCat(c) && sectionCounts[c] > 0)
    : undefined;

  /**
   * 谁能删一份保护名录：admin（站长 owner）能删全部；普通编辑只能删自己添加的那几份。
   * 与 RLS 策略同源（见 20260716140000_conservation_lists_created_by.sql）——这里只是提前
   * 把删不掉的按钮藏起来，真正的闸门在库里。播种的 11 份 created_by 为 null → 仅 admin 可删。
   */
  const canDeleteConsList = (l: ConservationList) =>
    isAdmin || (!!l.created_by && l.created_by === user?.id);

  // 删除一份保护名录。conservation_taxa 有 ON DELETE CASCADE，故物种行随之清空。
  const onDeleteConsList = async (l: ConservationList) => {
    const n = taxaByList.get(l.id)?.length ?? 0;
    if (
      !confirm(
        `确定删除「${l.name}」名录？其下 ${n} 条物种记录会一并移除，全站卡签与检索都会失去该名录。`,
      )
    )
      return;
    const { error } = await supabase.from("conservation_lists").delete().eq("id", l.id);
    if (error) return toast.error(error.message);
    toast.success("已删除");
    qc.invalidateQueries({ queryKey: ["conservation-data"] });
  };

  return (
    <div className="min-h-screen flex flex-col">
      <SiteHeader />
      <main className="mx-auto max-w-6xl px-6 py-10 flex-1 w-full">
        <div className="border-b-2 border-ink pb-6 mb-8 flex items-end justify-between flex-wrap gap-4">
          <div>
            <p className="label text-vermilion mb-2">Editor's Desk · 编辑台</p>
            <h1 className="font-display text-4xl font-bold">添加/编辑内容</h1>
            <p className="text-ink-faint mt-2">由 {user?.email} 编纂</p>
          </div>
          <div className="flex gap-2">
            {isAdmin && (
              <Link
                to="/admin/tags"
                className="border border-emerald-700 text-emerald-700 px-5 py-2 hover:bg-emerald-700 hover:text-background transition-colors"
              >
                + 添加 #tag 归类整理标签
              </Link>
            )}
            <Link
              to="/admin/catalogs/new"
              className="border border-ink px-5 py-2 hover:bg-ink hover:text-background transition-colors"
            >
              + 地区植物目录
            </Link>
            <Link
              to="/admin/batch-new"
              className="border border-ink px-5 py-2 hover:bg-ink hover:text-background transition-colors"
            >
              + 批量添加 skill 条目
            </Link>
            <Link
              to="/admin/new"
              className="bg-ink text-background px-5 py-2 hover:bg-vermilion transition-colors"
            >
              + 添加 skill 条目
            </Link>
            <Link
              to="/admin/blog/new"
              className="bg-emerald-700 text-background px-5 py-2 hover:bg-vermilion transition-colors"
            >
              + 编辑博客
            </Link>
            <Link
              to="/admin/projects/new"
              className="bg-emerald-700 text-background px-5 py-2 hover:bg-vermilion transition-colors"
            >
              + 编辑项目
            </Link>
          </div>
        </div>

        <h2 className="font-display text-2xl font-bold border-b-2 border-ink pb-2 mb-4">
          内容列表
        </h2>

        {/* 搜索框 + 类别筛选下拉（下拉在搜索框右边） */}
        <div className="mb-6 flex flex-wrap items-center gap-3">
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="搜索名称 / 学名 / 标题…"
            className="flex-1 min-w-[220px] max-w-md px-4 py-2 text-sm border border-rule rounded-lg focus:outline-none focus:border-ink transition-colors"
          />
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value as Category)}
            className="px-3 py-2 text-sm border border-rule rounded-lg bg-background focus:outline-none focus:border-ink transition-colors cursor-pointer"
            title="按类别筛选"
          >
            {CATEGORY_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>

        {isLoading ? (
          <p className="text-ink-faint">载入中…</p>
        ) : (
          <>
            {showCat("skill") && (
              <CollapsibleSection
                title="skill 创建条目"
                count={skillPlants.length}
                autoOpen={autoOpen("skill")}
                scrollTo={firstHitSection === "skill"}
              >
                <PlantsTable plants={skillPlants} onDelete={onDelete} />
              </CollapsibleSection>
            )}
            {showCat("ai") && (
              <CollapsibleSection
                title="AI 识别条目"
                count={aiPlants.length}
                autoOpen={autoOpen("ai")}
                scrollTo={firstHitSection === "ai"}
              >
                <PlantsTable plants={aiPlants} onDelete={onDelete} />
              </CollapsibleSection>
            )}
            {showCat("catalogs") && (
              <CollapsibleSection
                title="地区植物目录"
                count={sectionCounts.catalogs}
                autoOpen={autoOpen("catalogs")}
                scrollTo={firstHitSection === "catalogs"}
              >
                {catalogHits.length || protectedHits.length ? (
                  <ul className="divide-y divide-rule border-y border-rule">
                    {catalogHits.map(({ item: c, where }) => (
                      <div key={c.id}>
                        <CatalogRow
                          catalog={c}
                          plants={allPlants}
                          onDelete={() => onDeleteCatalog(c)}
                        />
                        {where && <SearchHit>{where}</SearchHit>}
                      </div>
                    ))}
                    {protectedHits.map(({ item: l, where }) => (
                      <div key={l.id}>
                        <ConservationListRow
                          list={l}
                          taxa={taxaByList.get(l.id) ?? []}
                          plants={allPlants}
                          keyword={q}
                          canDelete={canDeleteConsList(l)}
                          onDelete={() => onDeleteConsList(l)}
                        />
                        {where && <SearchHit>{where}</SearchHit>}
                      </div>
                    ))}
                  </ul>
                ) : (
                  <Empty />
                )}
              </CollapsibleSection>
            )}
            {showCat("global") && (
              <CollapsibleSection
                title="国际生物多样性保护"
                count={globalHits.length}
                autoOpen={autoOpen("global")}
                scrollTo={firstHitSection === "global"}
              >
                {globalHits.length ? (
                  <ul className="divide-y divide-rule border-y border-rule">
                    {globalHits.map(({ item: l, where }) => (
                      <div key={l.id}>
                        <ConservationListRow
                          list={l}
                          taxa={taxaByList.get(l.id) ?? []}
                          plants={allPlants}
                          keyword={q}
                          canDelete={canDeleteConsList(l)}
                          onDelete={() => onDeleteConsList(l)}
                        />
                        {where && <SearchHit>{where}</SearchHit>}
                      </div>
                    ))}
                  </ul>
                ) : (
                  <Empty />
                )}
              </CollapsibleSection>
            )}
            {showCat("tags") && (
              <CollapsibleSection
                title={isAdmin ? "全部 #tag 归类标签" : "我的 #tag 标签"}
                count={tagsF.length}
                autoOpen={autoOpen("tags")}
                scrollTo={firstHitSection === "tags"}
              >
                {tagHits.length ? (
                  <div className="flex flex-wrap gap-2">
                    {tagHits.map(({ item: t, where }) => (
                      <Link
                        key={t.id}
                        to="/tags/$slug"
                        params={{ slug: t.slug }}
                        className="border border-emerald-700 text-emerald-700 px-3 py-1.5 text-sm hover:bg-emerald-700 hover:text-background transition-colors"
                        title={where ?? t.description ?? ""}
                      >
                        #{t.name} <span className="opacity-60">({t.plant_count})</span>
                      </Link>
                    ))}
                  </div>
                ) : (
                  <Empty />
                )}
              </CollapsibleSection>
            )}
            {showCat("blog") && (
              <CollapsibleSection
                title="博客"
                count={postsF.length}
                autoOpen={autoOpen("blog")}
                scrollTo={firstHitSection === "blog"}
              >
                {postHits.length ? (
                  <ul className="divide-y divide-rule border-y border-rule">
                    {postHits.map(({ item: b, where }) => (
                      <li key={b.id} className="py-3 text-sm">
                        <div className="flex items-center gap-3">
                          <Link
                            to="/blog/$slug"
                            params={{ slug: b.slug }}
                            className="flex-1 font-display text-lg font-semibold hover:text-vermilion"
                          >
                            {b.title}
                          </Link>
                          {!b.published && (
                            <span className="text-[11px] text-amber-600 border border-amber-500/40 rounded px-1.5 py-0.5">
                              草稿
                            </span>
                          )}
                          <Link
                            to="/admin/blog/edit/$id"
                            params={{ id: b.id }}
                            className="hover:text-vermilion"
                          >
                            编辑
                          </Link>
                        </div>
                        {where && <SearchHit>{where}</SearchHit>}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <Empty />
                )}
              </CollapsibleSection>
            )}
            {showCat("projects") && (
              <CollapsibleSection
                title="项目"
                count={projectsF.length}
                autoOpen={autoOpen("projects")}
                scrollTo={firstHitSection === "projects"}
              >
                {projectHits.length ? (
                  <ul className="divide-y divide-rule border-y border-rule">
                    {projectHits.map(({ item: pr, where }) => (
                      <li key={pr.id} className="py-3 text-sm">
                        <div className="flex items-center gap-3">
                          <span className="flex-1 font-display text-lg font-semibold">
                            {pr.title}
                          </span>
                          {!pr.published && (
                            <span className="text-[11px] text-amber-600 border border-amber-500/40 rounded px-1.5 py-0.5">
                              草稿
                            </span>
                          )}
                          <Link
                            to="/admin/projects/edit/$id"
                            params={{ id: pr.id }}
                            className="hover:text-vermilion"
                          >
                            编辑
                          </Link>
                        </div>
                        {where && <SearchHit>{where}</SearchHit>}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <Empty />
                )}
              </CollapsibleSection>
            )}
          </>
        )}
      </main>
      <SiteFooter />
    </div>
  );
}

/** 「命中在哪」提示 — only shown when the keyword matched inside the item's content
 *  rather than its title/name, so the user knows why a row is in the results. */
function SearchHit({ children }: { children: ReactNode }) {
  return (
    <p className="mt-1 text-[11px] text-ink-faint bg-paper-deep/40 border-l-2 border-vermilion/40 pl-2 py-1">
      {children}
    </p>
  );
}

/**
 * A category block with a collapsible heading. Collapsed by default — it only springs
 * open when the current keyword actually hits inside it (`autoOpen`), and the first such
 * section scrolls itself into view (`scrollTo`). Clearing the search re-collapses it.
 */
function CollapsibleSection({
  title,
  count,
  autoOpen = false,
  scrollTo = false,
  children,
}: {
  title: string;
  count: number;
  autoOpen?: boolean;
  scrollTo?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    setOpen(autoOpen);
    if (autoOpen && scrollTo) ref.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [autoOpen, scrollTo]);
  return (
    <section ref={ref} className="mb-8 scroll-mt-4">
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center gap-2 border-b-2 border-ink pb-2 mb-4 text-left group cursor-pointer"
        aria-expanded={open}
      >
        <span className="inline-block w-4 text-ink-faint">{open ? "▾" : "▸"}</span>
        <h2 className="font-display text-2xl font-bold group-hover:text-vermilion transition-colors flex-1">
          {title}
        </h2>
        <span className="text-sm text-ink-faint font-normal">{count}</span>
      </button>
      {open && children}
    </section>
  );
}

function PlantsTable({ plants, onDelete }: { plants: Plant[]; onDelete: (p: Plant) => void }) {
  if (plants.length === 0) return <Empty />;
  return (
    <table className="w-full border-collapse">
      <thead className="border-b border-ink">
        <tr className="label text-left">
          <th className="py-3">标题</th>
          <th className="py-3">类型</th>
          <th className="py-3">更新</th>
          <th className="py-3 text-right">操作</th>
        </tr>
      </thead>
      <tbody>
        {plants.map((p) => (
          <tr key={p.id} className="border-b border-rule-soft hover:bg-paper-deep/40">
            <td className="py-4">
              <Link
                to="/plants/$slug"
                params={{ slug: p.slug }}
                className="font-display text-lg font-semibold hover:text-vermilion"
              >
                {p.title}
              </Link>
              {p.scientific_name && (
                <p className="italic text-xs text-ink-faint">{p.scientific_name}</p>
              )}
            </td>
            <td className="py-4 text-sm">
              <EntryTypeBadge plant={p} />
            </td>
            <td className="py-4 text-sm text-ink-faint">
              {new Date(p.updated_at).toLocaleString("zh-CN")}
            </td>
            <td className="py-4 text-right space-x-3 text-sm">
              <Link to="/admin/edit/$id" params={{ id: p.id }} className="hover:text-vermilion">
                编辑
              </Link>
              <button onClick={() => onDelete(p)} className="text-destructive hover:underline">
                删除
              </button>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Empty() {
  return (
    <p className="text-ink-faint text-sm py-6 text-center border border-dashed border-rule rounded">
      没有匹配的内容
    </p>
  );
}

const CONS_KIND_LABEL: Record<string, string> = {
  protected: "重点保护野生植物名录",
  cites: "CITES 华盛顿公约贸易管制",
  gts: "GTS 全球树木红色名录",
  griis: "GRIIS 全球外来与入侵物种名录",
};

/** Human status text for one taxon row, per its parent list's kind. */
function consStatusLabel(kind: string, status: string): string {
  const find = (opts: { value: string; label: string }[]) =>
    opts.find((o) => o.value === status)?.label ?? status;
  if (kind === "cites") return find(CITES_APPENDICES);
  if (kind === "gts") return find(GTS_CATEGORIES);
  if (kind === "griis") return find(GRIIS_DEGREES);
  return status;
}

/** Rows past this are hidden behind a hint — 国家（2021）alone is ~1000 taxa. */
const CONS_ROW_CAP = 200;

/**
 * One seeded conservation registry (国家/省级重点保护 · CITES · GTS · GRIIS), rendered
 * like a 地区植物目录 row: expand to read the taxa, admin can delete the whole list.
 * Unlike regional_catalogs these have no per-entry editing — they are seeded reference
 * data, so the expanded view is read-only.
 */
function ConservationListRow({
  list,
  taxa,
  plants,
  keyword,
  canDelete,
  onDelete,
}: {
  list: ConservationList;
  taxa: ConservationTaxon[];
  plants: Plant[];
  keyword: string;
  canDelete: boolean;
  onDelete: () => void;
}) {
  const [open, setOpen] = useState(false);

  const plantBySci = new Map(
    plants
      .filter((p) => p.scientific_name)
      .map((p) => [p.scientific_name!.toLowerCase().trim(), p]),
  );

  // When a keyword is active, the expanded view shows only what matched — otherwise the
  // matched species would be buried under a thousand unrelated rows.
  const matched = keyword
    ? taxa.filter(
        (t) =>
          t.scientific_name.toLowerCase().includes(keyword) ||
          (t.chinese_name ?? "").toLowerCase().includes(keyword),
      )
    : taxa;
  const shown = [...matched]
    .sort((a, b) => a.scientific_name.localeCompare(b.scientific_name))
    .slice(0, CONS_ROW_CAP);

  return (
    <li className="py-3 text-sm">
      <div className="flex items-center gap-3">
        <button
          onClick={() => setOpen((o) => !o)}
          title="点击展开该名录收录的物种"
          className="inline-flex items-center gap-1 hover:text-vermilion"
          aria-expanded={open}
        >
          <span className="inline-block w-4 text-ink-faint">{open ? "▾" : "▸"}</span>
        </button>
        <div className="flex-1 min-w-0">
          <p>
            <span className="font-semibold">{list.name}</span>
            <span className="text-ink-faint mx-1">·</span>
            {CONS_KIND_LABEL[list.kind] ?? list.kind}
            <span className="font-semibold text-vermilion mx-1">{taxa.length}</span>
            条收录
          </p>
          <p className="text-xs text-ink-faint mt-0.5">
            {list.source_note ?? "本站收录的公开名录"}
            {list.source_url && (
              <>
                {" · "}
                <a
                  href={list.source_url}
                  target="_blank"
                  rel="noreferrer"
                  className="hover:text-vermilion underline"
                >
                  来源
                </a>
              </>
            )}
          </p>
        </div>
        {canDelete && (
          <button onClick={onDelete} className="text-destructive hover:underline">
            删除
          </button>
        )}
      </div>

      {open && (
        <div className="mt-3 ml-7 border-l border-rule pl-4">
          <ul className="divide-y divide-rule-soft">
            {shown.length === 0 && <li className="py-2 text-ink-faint text-xs">还没有条目</li>}
            {shown.map((t, i) => {
              const hit = plantBySci.get(t.scientific_name.toLowerCase().trim());
              const name = (
                <>
                  <span className="italic">{t.scientific_name}</span>
                  {t.rank !== "species" && <span className="not-italic"> 所有种</span>}
                  {t.chinese_name ? ` · ${t.chinese_name}` : ""}
                </>
              );
              return (
                <li
                  key={`${t.list_id}-${t.normalized_name}-${i}`}
                  className="py-1.5 flex items-center gap-2 text-xs"
                >
                  <span className="flex-1 min-w-0">
                    {hit ? (
                      <Link
                        to="/plants/$slug"
                        params={{ slug: hit.slug }}
                        className="text-[oklch(0.55_0.18_240)] hover:underline"
                      >
                        {name}
                      </Link>
                    ) : (
                      <span>{name}</span>
                    )}
                  </span>
                  <span className="text-[10px] text-ink-faint shrink-0">
                    {consStatusLabel(list.kind, t.status)}
                  </span>
                </li>
              );
            })}
          </ul>
          {matched.length > shown.length && (
            <p className="mt-2 text-[11px] text-ink-faint">
              仅显示前 {CONS_ROW_CAP} 条（共 {matched.length} 条）。用上方搜索框按学名 /
              中文名定位。
            </p>
          )}
        </div>
      )}
    </li>
  );
}
