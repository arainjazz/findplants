import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { SiteHeader, SiteFooter } from "@/components/site-header";
import {
  fetchAllEdits,
  fetchDerivedCreations,
  fetchEditsForUser,
  isCurrentUserAdmin,
  logCategory,
  revertEdit,
  type LogCategory,
  type PlantEdit,
} from "@/lib/edits";
import { revertCatalogEdit } from "@/lib/catalogs";
import { fetchAllPlants, type Plant } from "@/lib/plants";
import { useAuth } from "@/hooks/use-auth";
import { toast } from "sonner";
import { sourceLabel, sourceIsAI } from "@/lib/edit-source";
import { isOwnerEmail, setAdopted } from "@/lib/leaves";

export const Route = createFileRoute("/edits")({
  head: () => ({
    meta: [
      { title: "Log · Plantspedia" },
      { name: "description", content: "查看社区的创建记录与修改记录。" },
    ],
  }),
  component: EditsPage,
});

type GroupBy = "time" | "editor" | "plant";

function EditsPage() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [groupBy, setGroupBy] = useState<GroupBy>("time");
  const [filter, setFilter] = useState("");
  const [tab, setTab] = useState<LogCategory>("modify");

  const { data: isAdmin = false } = useQuery({
    queryKey: ["is-admin", user?.id],
    queryFn: () => isCurrentUserAdmin(user?.id),
    enabled: !!user,
  });
  // 采纳 (adopt) is owner-only, per product decision (资深编辑 = 仅所有者).
  const isOwner = isOwnerEmail(user?.email);

  // Owner (admin) sees every editor's history; a normal editor sees only their
  // own (including entries reverted/rejected by the owner); anon sees nothing.
  const { data: edits = [], isLoading } = useQuery({
    queryKey: ["plant-edits", isAdmin, user?.id ?? "anon"],
    queryFn: () =>
      isAdmin
        ? fetchAllEdits()
        : user
          ? fetchEditsForUser(user.id)
          : Promise.resolve([] as PlantEdit[]),
    staleTime: 0,
    refetchOnMount: "always",
    refetchOnWindowFocus: true,
  });

  // 创建记录里 plant_edits 拿不到的部分（AI 草稿 / 博客 / 项目 / 评论）——从源表重建。
  // 见 fetchDerivedCreations 的注释：这些 kind 被 DB CHECK 约束挡在门外，从未写进日志。
  const { data: derived = [] } = useQuery({
    queryKey: ["derived-creations", isAdmin, user?.id ?? "anon"],
    queryFn: () =>
      isAdmin
        ? fetchDerivedCreations()
        : user
          ? fetchDerivedCreations(user.id)
          : Promise.resolve([]),
    enabled: !!user,
  });

  // Realtime: any insert/update on plant_edits invalidates the list
  useEffect(() => {
    const ch = supabase
      .channel("plant_edits-feed")
      .on("postgres_changes", { event: "*", schema: "public", table: "plant_edits" }, () =>
        qc.invalidateQueries({ queryKey: ["plant-edits"] }),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [qc]);
  const { data: plants = [] } = useQuery({ queryKey: ["plants"], queryFn: fetchAllPlants });

  const plantById = useMemo(() => {
    const m = new Map<string, Plant>();
    for (const p of plants) m.set(p.id, p);
    return m;
  }, [plants]);

  // 创建记录 = plant_edits 里的创建类 kind + 从源表重建的（草稿/博客/项目/评论）。
  // 修改记录 = plant_edits 里的改动类 kind。
  const createRows = useMemo(
    () =>
      [...edits.filter((e) => logCategory(e.kind) === "create"), ...derived].sort(
        (a, b) => +new Date(b.created_at) - +new Date(a.created_at),
      ),
    [edits, derived],
  );
  const modifyRows = useMemo(() => edits.filter((e) => logCategory(e.kind) === "modify"), [edits]);
  const tabRows = tab === "create" ? createRows : modifyRows;

  const filtered = useMemo(() => {
    const t = filter.trim().toLowerCase();
    if (!t) return tabRows;
    return tabRows.filter((e) => {
      const p = plantById.get(e.plant_id);
      const hay = [
        e.editor_name,
        e.kind,
        e.summary,
        p?.title,
        p?.scientific_name,
        p?.common_name_en,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return hay.includes(t);
    });
  }, [tabRows, filter, plantById]);

  const grouped = useMemo(() => {
    const map = new Map<string, PlantEdit[]>();
    for (const e of filtered) {
      let k: string;
      if (groupBy === "time") {
        const d = new Date(e.created_at);
        k = `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`;
      } else if (groupBy === "editor") {
        k = e.editor_name || e.editor_id;
      } else {
        k = plantById.get(e.plant_id)?.title || e.plant_id;
      }
      if (!map.has(k)) map.set(k, []);
      map.get(k)!.push(e);
    }
    return Array.from(map.entries()).map(([key, items]) => ({ key, items }));
  }, [filtered, groupBy, plantById]);

  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const toggle = (k: string) => setCollapsed((c) => ({ ...c, [k]: !c[k] }));
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  // 点击图片修改记录里的缩略图 → 放大预览；任意位置点击关闭。
  const [lightbox, setLightbox] = useState<string | null>(null);

  const toggleSelect = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const onBulkRevert = async () => {
    if (!user || selected.size === 0) return;
    if (!confirm(`确定批量撤销选中的 ${selected.size} 条修改？`)) return;
    setBulkBusy(true);
    let ok = 0,
      fail = 0;
    for (const e of filtered) {
      if (!selected.has(e.id) || e.reverted) continue;
      if (e.id.startsWith("derived:")) continue; // 重建行不是真实日志，无可撤销
      try {
        if (e.kind === "catalog_create" || e.kind === "catalog_append") {
          const adminName = (user.user_metadata?.full_name as string) || user.email || "admin";
          await revertCatalogEdit({
            editId: e.id,
            kind: e.kind,
            catalog_id: e.catalog_id,
            entry_ids: e.entry_ids ?? null,
            adminId: user.id,
            adminName,
          });
        } else if (e.kind !== "revert") {
          await revertEdit(e, user.id);
        }
        ok++;
      } catch {
        fail++;
      }
    }
    setBulkBusy(false);
    setSelected(new Set());
    qc.invalidateQueries({ queryKey: ["plant-edits"] });
    qc.invalidateQueries({ queryKey: ["plants"] });
    qc.invalidateQueries({ queryKey: ["all-catalogs"] });
    qc.invalidateQueries({ queryKey: ["all-catalog-entries"] });
    toast[fail ? "message" : "success"](`已撤销 ${ok} 条${fail ? `，失败 ${fail} 条` : ""}`);
  };

  const selectAllInGroup = (items: PlantEdit[], on: boolean) =>
    setSelected((prev) => {
      const next = new Set(prev);
      for (const it of items)
        if (!it.reverted && it.kind !== "revert") {
          if (on) next.add(it.id);
          else next.delete(it.id);
        }
      return next;
    });

  const markReverted = (id: string) =>
    supabase
      .from("plant_edits")
      .update({ reverted: true, reverted_by: user!.id, reverted_at: new Date().toISOString() })
      .eq("id", id);

  const onAdopt = async (e: PlantEdit) => {
    if (!user) return;
    try {
      await setAdopted("plant_edits", e.id, !e.adopted, user.id);
      toast.success(e.adopted ? "已取消采纳" : "已采纳 · 作者该枚铜叶 ×2");
      qc.invalidateQueries({ queryKey: ["plant-edits"] });
      qc.invalidateQueries({ queryKey: ["my-leaves"] });
    } catch (err) {
      toast.error("操作失败：" + (err as Error).message);
    }
  };

  const onRevert = async (e: PlantEdit) => {
    if (!user) return;
    if (e.kind === "draft_image" || e.kind === "draft_text") {
      toast.message("这是草稿编辑记录，无需撤销。");
      return;
    }
    if (e.kind === "draft_reject") {
      if (!confirm("撤销驳回：将该 AI 草稿恢复为「待审核」？")) return;
      const { error } = await supabase
        .from("plant_drafts")
        .update({ status: "pending" })
        .eq("id", e.block_path ?? "");
      if (error) return toast.error(error.message);
      await markReverted(e.id);
      toast.success("已撤销驳回，草稿恢复为待审核");
      qc.invalidateQueries({ queryKey: ["plant-edits"] });
      qc.invalidateQueries({ queryKey: ["home-drafts"] });
      return;
    }
    if (e.kind === "blog_publish") {
      if (!confirm("撤回该博文的发布（设为未发布草稿）？")) return;
      const { error } = await supabase
        .from("blog_posts")
        .update({ published: false })
        .eq("id", e.block_path ?? "");
      if (error) return toast.error(error.message);
      await markReverted(e.id);
      toast.success("已撤回博文发布");
      qc.invalidateQueries({ queryKey: ["plant-edits"] });
      qc.invalidateQueries({ queryKey: ["blog-posts"] });
      qc.invalidateQueries({ queryKey: ["home-blog"] });
      return;
    }
    if (e.kind === "blog_edit") {
      if (!e.before_html) return toast.message("该编辑没有可恢复的修改前快照。");
      if (!confirm("撤销这次博文编辑：将正文恢复到这次修改之前？")) return;
      const { error } = await supabase
        .from("blog_posts")
        .update({ content_html: e.before_html })
        .eq("id", e.block_path ?? "");
      if (error) return toast.error(error.message);
      await markReverted(e.id);
      toast.success("已恢复到该次修改前的博文正文");
      qc.invalidateQueries({ queryKey: ["plant-edits"] });
      qc.invalidateQueries({ queryKey: ["blog-posts"] });
      qc.invalidateQueries({ queryKey: ["home-blog"] });
      return;
    }
    if (e.kind === "draft_approve") {
      toast.message("撤销收录较复杂：请到对应条目页逐条「撤销」内容，或直接删除该条目。");
      return;
    }
    if (e.kind === "catalog_create" || e.kind === "catalog_append") {
      const label = e.kind === "catalog_create" ? "整个目录及其条目" : "该次追加的全部条目";
      if (
        !confirm(
          `确定撤销该${e.kind === "catalog_create" ? "新目录" : "目录补充"}？将删除${label}。`,
        )
      )
        return;
      try {
        const adminName = (user.user_metadata?.full_name as string) || user.email || "admin";
        await revertCatalogEdit({
          editId: e.id,
          kind: e.kind,
          catalog_id: e.catalog_id,
          entry_ids: e.entry_ids ?? null,
          adminId: user.id,
          adminName,
        });
        toast.success("已撤销");
        qc.invalidateQueries({ queryKey: ["plant-edits"] });
        qc.invalidateQueries({ queryKey: ["all-catalogs"] });
        qc.invalidateQueries({ queryKey: ["all-catalog-entries"] });
      } catch (err) {
        toast.error("撤销失败：" + (err as Error).message);
      }
      return;
    }
    const restoring = e.reverted;
    const action = restoring ? "恢复" : "撤销";
    const msg = `确定${action}该编辑？\n编辑者：${e.editor_name ?? "—"}\n时间：${new Date(e.created_at).toLocaleString("zh-CN")}`;
    if (!confirm(msg)) return;
    try {
      const res = await revertEdit(e, user.id);
      toast.success(res.restored ? "已恢复该修改" : "已撤销该修改");
      qc.invalidateQueries({ queryKey: ["plant-edits"] });
      qc.invalidateQueries({ queryKey: ["plant", res.slug] });
      qc.invalidateQueries({ queryKey: ["plants"] });
    } catch (err) {
      toast.error(`${action}失败：` + (err as Error).message);
    }
  };

  return (
    <div className="min-h-screen flex flex-col">
      <SiteHeader />
      <main className="mx-auto max-w-5xl px-6 py-10 flex-1 w-full">
        <div className="border-b-2 border-ink pb-6 mb-6">
          <p className="label text-vermilion mb-2">Community Log · 社区日志</p>
          <h1 className="font-display text-5xl font-bold">Log</h1>
          <p className="text-ink-faint mt-2">
            {isAdmin
              ? "你以网站所有者身份登录，可查看全部编辑者的记录，并撤销任意一条修改。"
              : user
                ? "这里是你本人的记录，包含被所有者撤销或驳回的条目。"
                : "登录后可查看你本人的记录。"}
          </p>
        </div>

        {/* 两大类：修改记录 / 创建记录。点标题切换。 */}
        <div className="flex items-center gap-5 border-b border-rule mb-5">
          {(["modify", "create"] as const).map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => setTab(c)}
              className={`pb-2 -mb-px border-b-2 font-display text-lg font-semibold transition-colors cursor-pointer ${
                tab === c
                  ? "border-vermilion text-vermilion"
                  : "border-transparent text-ink-faint hover:text-ink"
              }`}
            >
              {c === "modify" ? "修改记录" : "创建记录"}
              <span className="ml-1.5 text-xs font-normal opacity-70">
                {c === "modify" ? modifyRows.length : createRows.length}
              </span>
            </button>
          ))}
          <span className="ml-auto text-[11px] text-ink-faint">点击标题切换</span>
        </div>

        <div className="flex flex-wrap gap-3 items-center mb-6">
          <div className="flex border border-ink">
            {(["time", "editor", "plant"] as GroupBy[]).map((g) => (
              <button
                key={g}
                onClick={() => setGroupBy(g)}
                className={`px-4 py-2 text-sm ${groupBy === g ? "bg-ink text-background" : "hover:bg-paper-deep"}`}
              >
                {g === "time" ? "按时间" : g === "editor" ? "按编辑者" : "按种名"}
              </button>
            ))}
          </div>
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="搜索编辑者 / 种名 / 学名…"
            className="border border-ink px-3 py-2 text-sm bg-transparent flex-1 min-w-[240px] focus:outline-none focus:border-vermilion"
          />
          {isAdmin && (
            <button
              type="button"
              onClick={onBulkRevert}
              disabled={selected.size === 0 || bulkBusy}
              className="bg-destructive text-background px-4 py-2 text-sm hover:bg-destructive/80 disabled:opacity-40"
            >
              {bulkBusy ? "撤销中…" : `撤销选中（${selected.size}）`}
            </button>
          )}
        </div>

        {!user ? (
          <div className="py-12 text-center">
            <p className="text-ink-faint mb-3">登录后可查看你本人的修改记录。</p>
            <Link
              to="/login"
              className="inline-block border border-ink px-4 py-2 hover:bg-ink hover:text-background transition-colors"
            >
              去登录
            </Link>
          </div>
        ) : isLoading ? (
          <p className="text-ink-faint">载入中…</p>
        ) : filtered.length === 0 ? (
          <p className="text-ink-faint py-12 text-center">还没有任何修改记录。</p>
        ) : (
          <div className="space-y-6">
            {grouped.map((g) => {
              const isOpen = !collapsed[g.key];
              return (
                <section key={g.key}>
                  <button
                    onClick={() => toggle(g.key)}
                    className="w-full flex items-center justify-between gap-2 mb-2 border-b border-rule pb-1 text-left hover:text-vermilion transition-colors"
                  >
                    <h2 className="font-display text-xl font-semibold">
                      <span className="inline-block w-4 text-ink-faint">{isOpen ? "▾" : "▸"}</span>
                      {g.key}{" "}
                      <span className="text-xs text-ink-faint font-normal">
                        · {g.items.length} 条
                      </span>
                    </h2>
                  </button>
                  {isOpen && isAdmin && (
                    <div className="flex gap-3 text-xs mb-2 px-2">
                      <button
                        type="button"
                        onClick={() => selectAllInGroup(g.items, true)}
                        className="text-vermilion hover:underline"
                      >
                        全选本组
                      </button>
                      <button
                        type="button"
                        onClick={() => selectAllInGroup(g.items, false)}
                        className="text-ink-faint hover:underline"
                      >
                        取消本组
                      </button>
                    </div>
                  )}
                  {isOpen && (
                    <ul className="divide-y divide-rule border-y border-rule">
                      {g.items.map((e) => (
                        <EditRow
                          key={e.id}
                          edit={e}
                          plant={plantById.get(e.plant_id)}
                          isAdmin={isAdmin}
                          isOwner={isOwner}
                          onRevert={() => onRevert(e)}
                          onAdopt={() => onAdopt(e)}
                          selected={selected.has(e.id)}
                          onToggleSelect={() => toggleSelect(e.id)}
                          onZoom={setLightbox}
                        />
                      ))}
                    </ul>
                  )}
                </section>
              );
            })}
          </div>
        )}
      </main>
      <SiteFooter />

      {/* 图片放大预览（点击缩略图打开，任意位置点击关闭）。 */}
      {lightbox && (
        <div
          className="fixed inset-0 z-[90] bg-black/80 flex items-center justify-center p-4 cursor-zoom-out"
          onClick={() => setLightbox(null)}
        >
          <img
            src={lightbox}
            alt="修改图片大图"
            className="max-w-full max-h-full object-contain shadow-2xl"
          />
        </div>
      )}
    </div>
  );
}

function EditRow({
  edit,
  plant,
  isAdmin,
  isOwner,
  onRevert,
  onAdopt,
  selected,
  onToggleSelect,
  onZoom,
}: {
  edit: PlantEdit;
  plant: Plant | undefined;
  isAdmin: boolean;
  isOwner: boolean;
  onRevert: () => void;
  onAdopt: () => void;
  selected: boolean;
  onToggleSelect: () => void;
  onZoom: (url: string) => void;
}) {
  const [showDiff, setShowDiff] = useState(false);
  const kindLabel: Record<string, string> = {
    text: "文字",
    image: "图片",
    revert: "撤销",
    catalog_create: "新目录",
    catalog_append: "目录补充",
    create: "新建条目",
    tag_create: "新标签",
    html_save: "HTML 保存",
    branch: "分支创建",
    merge: "合并共建",
    draft_image: "草稿配图",
    draft_text: "草稿文字",
    draft_approve: "草稿通过收录",
    draft_reject: "草稿驳回",
    blog_publish: "博文发布",
    blog_edit: "博文编辑",
  };
  const kindColor: Record<string, string> = {
    text: "bg-leaf/15 text-leaf-deep",
    image: "bg-vermilion/15 text-vermilion",
    revert: "bg-ink/15 text-ink",
    catalog_create: "bg-leaf/15 text-leaf-deep",
    catalog_append: "bg-leaf/10 text-leaf-deep",
    create: "bg-vermilion/10 text-vermilion",
    tag_create: "bg-emerald-100 text-emerald-700",
    html_save: "bg-leaf/10 text-leaf-deep",
    branch: "bg-vermilion/15 text-vermilion",
    merge: "bg-leaf/15 text-leaf-deep",
    draft_image: "bg-[oklch(0.55_0.18_240)]/15 text-[oklch(0.45_0.18_240)]",
    draft_text: "bg-[oklch(0.55_0.18_240)]/10 text-[oklch(0.45_0.18_240)]",
    draft_approve: "bg-leaf/15 text-leaf-deep",
    draft_reject: "bg-destructive/15 text-destructive",
    blog_publish: "bg-emerald-100 text-emerald-700",
    blog_edit: "bg-emerald-50 text-emerald-700",
  };

  // 从源表重建的创建记录（fetchDerivedCreations）不是真实 plant_edits 行——没有快照可恢复，
  // 其 id 也不存在于表里。必须屏蔽掉「撤销」与批量勾选，否则会去撤一条不存在的记录。
  const isDerived = edit.id.startsWith("derived:");

  const isCatalog =
    edit.kind === "catalog_create" ||
    edit.kind === "catalog_append" ||
    edit.kind === "tag_create" ||
    edit.kind === "html_save" ||
    edit.kind === "branch" ||
    edit.kind === "merge" ||
    edit.kind === "draft_image" ||
    edit.kind === "draft_text" ||
    edit.kind === "draft_approve" ||
    edit.kind === "draft_reject" ||
    edit.kind === "blog_publish" ||
    edit.kind === "blog_edit";

  const srcLabel = sourceLabel(edit.source);
  const isAI = sourceIsAI(edit.source);
  const SourceBadge = edit.source ? (
    <span
      title={edit.source}
      className={`px-1.5 py-0.5 rounded text-[10px] shrink-0 ${
        isAI
          ? "bg-[oklch(0.55_0.18_280)]/15 text-[oklch(0.45_0.18_280)]"
          : "bg-ink/10 text-ink-soft"
      }`}
    >
      {srcLabel}
    </span>
  ) : null;

  if (isCatalog) {
    return (
      <li className="py-1.5 flex items-start gap-2 text-xs">
        {isAdmin && !edit.reverted && edit.kind !== "revert" && !isDerived && (
          <input type="checkbox" checked={selected} onChange={onToggleSelect} className="mt-1" />
        )}
        <span
          className={`px-1.5 py-0.5 rounded text-[10px] font-semibold shrink-0 ${kindColor[edit.kind] ?? ""}`}
        >
          {kindLabel[edit.kind] ?? edit.kind}
        </span>
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
            <span className="text-ink-faint text-[11px]">
              {new Date(edit.created_at).toLocaleString("zh-CN", { hour12: false })}
            </span>
            {SourceBadge}
            {edit.reverted && (
              <span className="text-[10px] px-1 py-0 bg-destructive/15 text-destructive rounded">
                已撤销
              </span>
            )}
          </div>
          <p className="mt-0.5 text-sm">{edit.summary ?? "（无摘要）"}</p>
        </div>
        {isAdmin && !edit.reverted && !isDerived && (
          <button
            onClick={onRevert}
            className="shrink-0 text-[11px] border border-destructive text-destructive hover:bg-destructive hover:text-background px-1.5 py-0.5"
          >
            撤销
          </button>
        )}
      </li>
    );
  }

  return (
    <li className="py-1.5 flex items-start gap-2 text-xs">
      {isAdmin && !edit.reverted && edit.kind !== "revert" && (
        <input type="checkbox" checked={selected} onChange={onToggleSelect} className="mt-1" />
      )}
      <span
        className={`px-1.5 py-0.5 rounded text-[10px] font-semibold shrink-0 ${kindColor[edit.kind] ?? ""}`}
      >
        {kindLabel[edit.kind] ?? edit.kind}
      </span>
      <div className="flex-1 min-w-0">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
          <span className="font-semibold">{edit.editor_name ?? "匿名"}</span>
          <span className="text-ink-faint text-[11px]">
            {new Date(edit.created_at).toLocaleString("zh-CN", { hour12: false })}
          </span>
          {SourceBadge}
          {plant ? (
            <Link
              to="/plants/$slug"
              params={{ slug: plant.slug }}
              className="text-vermilion hover:underline"
            >
              {plant.title}
              {plant.scientific_name ? ` · ${plant.scientific_name}` : ""}
            </Link>
          ) : (
            <span className="text-ink-faint">（条目已删除）</span>
          )}
          {edit.reverted && (
            <span className="text-[10px] px-1 py-0 bg-destructive/15 text-destructive rounded">
              已撤销
            </span>
          )}
        </div>
        <div className="mt-0.5 grid sm:grid-cols-2 gap-1 text-[11px]">
          <div className="border border-rule px-1.5 py-1 bg-paper-deep/30">
            <span className="label text-ink-faint mr-1">前:</span>
            <EditSnapshotPreview html={edit.before_html} kind={edit.kind} onZoom={onZoom} />
          </div>
          <div className="border border-rule px-1.5 py-1 bg-paper-deep/30">
            <span className="label text-ink-faint mr-1">后:</span>
            <EditSnapshotPreview html={edit.after_html} kind={edit.kind} onZoom={onZoom} />
          </div>
        </div>
        {edit.kind !== "revert" && (edit.before_html || edit.after_html) && (
          <div className="mt-2">
            <button
              type="button"
              onClick={() => setShowDiff(!showDiff)}
              className="text-[10px] uppercase tracking-wider text-vermilion hover:underline font-semibold"
            >
              {showDiff ? "隐藏对比" : "显示 Git 格式差异对比 (Diff)"}
            </button>
            {showDiff && (
              <GitDiffViewer beforeHtml={edit.before_html} afterHtml={edit.after_html} />
            )}
          </div>
        )}
      </div>
      {isOwner && (edit.kind === "text" || edit.kind === "image") && !edit.reverted && (
        <button
          onClick={onAdopt}
          title={edit.adopted ? "取消采纳（撤销该枚铜叶翻倍）" : "采纳此修改 · 作者该枚铜叶 ×2"}
          className={`shrink-0 text-[11px] border px-1.5 py-0.5 transition-colors ${
            edit.adopted
              ? "border-leaf bg-leaf/20 text-leaf-deep"
              : "border-leaf text-leaf-deep hover:bg-leaf hover:text-background"
          }`}
        >
          {edit.adopted ? "已采纳 ✓" : "采纳"}
        </button>
      )}
      {isAdmin &&
        edit.kind !== "revert" &&
        (() => {
          const restoring = edit.reverted;
          return (
            <button
              onClick={onRevert}
              title={restoring ? "恢复到修改后的内容" : "撤销此修改，回到修改前内容"}
              className={`shrink-0 text-[11px] border px-1.5 py-0.5 transition-colors ${
                restoring
                  ? "border-leaf text-leaf-deep hover:bg-leaf hover:text-background"
                  : "border-destructive text-destructive hover:bg-destructive hover:text-background"
              }`}
            >
              {restoring ? "恢复" : "撤销"}
            </button>
          );
        })()}
    </li>
  );
}

function EditSnapshotPreview({
  html,
  kind,
  onZoom,
}: {
  html: string | null;
  kind: PlantEdit["kind"];
  onZoom?: (url: string) => void;
}) {
  const thumb = imagePreview(html);
  const text = textPreview(html, kind === "image" ? 20 : 20);
  return (
    <span className="inline-flex max-w-full items-center gap-1 align-top">
      {thumb && (
        <button
          type="button"
          onClick={() => onZoom?.(thumb)}
          title="点击查看大图"
          className="shrink-0 cursor-zoom-in"
        >
          <img
            src={thumb}
            alt="修改图片缩略图"
            loading="lazy"
            className="h-8 w-8 border border-rule object-cover hover:ring-2 hover:ring-vermilion/60"
          />
        </button>
      )}
      <span className="line-clamp-2 break-words">{text}</span>
    </span>
  );
}

function imagePreview(html: string | null): string | null {
  if (!html) return null;
  const match = html.match(/<img\b[^>]*\bsrc=("|')([^"']+)\1/i);
  return match?.[2] ?? null;
}

function textPreview(html: string | null, max = 20): string {
  if (!html) return "（空）";
  const text = html
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!text) return "（空）";
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

/* ---------------- LCS DP Line-by-line Diff Engine ---------------- */

type DiffLine = {
  type: "added" | "removed" | "unchanged";
  text: string;
  lineNumberOld?: number;
  lineNumberNew?: number;
};

function diffLines(oldStr: string, newStr: string): DiffLine[] {
  const oldLines = oldStr ? oldStr.split(/\r?\n/) : [];
  const newLines = newStr ? newStr.split(/\r?\n/) : [];

  const m = oldLines.length;
  const n = newLines.length;

  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (oldLines[i - 1] === newLines[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }
  }

  const diff: DiffLine[] = [];
  let i = m;
  let j = n;

  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && oldLines[i - 1] === newLines[j - 1]) {
      diff.unshift({
        type: "unchanged",
        text: oldLines[i - 1],
        lineNumberOld: i,
        lineNumberNew: j,
      });
      i--;
      j--;
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      diff.unshift({
        type: "added",
        text: newLines[j - 1],
        lineNumberNew: j,
      });
      j--;
    } else {
      diff.unshift({
        type: "removed",
        text: oldLines[i - 1],
        lineNumberOld: i,
      });
      i--;
    }
  }

  return diff;
}

function GitDiffViewer({
  beforeHtml,
  afterHtml,
}: {
  beforeHtml: string | null;
  afterHtml: string | null;
}) {
  const diff = useMemo(() => {
    return diffLines(beforeHtml || "", afterHtml || "");
  }, [beforeHtml, afterHtml]);

  return (
    <div className="border border-rule bg-paper-deep/30 rounded overflow-hidden font-mono text-[11px] leading-relaxed mt-2 max-h-96 overflow-y-auto">
      <table className="w-full border-collapse">
        <tbody>
          {diff.map((line, idx) => {
            let rowClass = "text-ink-soft";
            let codeClass = "";
            let sign = " ";
            if (line.type === "added") {
              rowClass = "bg-emerald-950/20 text-emerald-400";
              codeClass = "bg-emerald-950/40";
              sign = "+";
            } else if (line.type === "removed") {
              rowClass = "bg-red-950/20 text-red-400 line-through";
              codeClass = "bg-red-950/40";
              sign = "-";
            }

            return (
              <tr key={idx} className={`${rowClass} hover:bg-paper-deep/40 transition-colors`}>
                <td className="w-10 text-right pr-2 text-ink-faint select-none border-r border-rule py-0.5 px-1 bg-paper-deep/20">
                  {line.lineNumberOld || ""}
                </td>
                <td className="w-10 text-right pr-2 text-ink-faint select-none border-r border-rule py-0.5 px-1 bg-paper-deep/20">
                  {line.lineNumberNew || ""}
                </td>
                <td className="w-6 text-center select-none font-bold text-xs py-0.5 px-1">
                  {sign}
                </td>
                <td className={`pl-2 pr-4 py-0.5 whitespace-pre-wrap break-all ${codeClass}`}>
                  {line.text}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
