import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { SiteHeader, SiteFooter } from "@/components/site-header";
import { fetchAllEdits, isCurrentUserAdmin, revertEdit, type PlantEdit } from "@/lib/edits";
import { revertCatalogEdit } from "@/lib/catalogs";
import { fetchAllPlants, type Plant } from "@/lib/plants";
import { useAuth } from "@/hooks/use-auth";
import { toast } from "sonner";
import { sourceLabel, sourceIsAI } from "@/lib/edit-source";

export const Route = createFileRoute("/edits")({
  head: () => ({
    meta: [
      { title: "修改记录 · Plantspedia" },
      { name: "description", content: "查看社区编辑对各条目所做的全部修改记录。" },
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

  const { data: edits = [], isLoading } = useQuery({
    queryKey: ["plant-edits"],
    queryFn: fetchAllEdits,
    staleTime: 0,
    refetchOnMount: "always",
    refetchOnWindowFocus: true,
  });

  // Realtime: any insert/update on plant_edits invalidates the list
  useEffect(() => {
    const ch = supabase
      .channel("plant_edits-feed")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "plant_edits" },
        () => qc.invalidateQueries({ queryKey: ["plant-edits"] }),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [qc]);
  const { data: plants = [] } = useQuery({ queryKey: ["plants"], queryFn: fetchAllPlants });
  const { data: isAdmin = false } = useQuery({
    queryKey: ["is-admin", user?.id],
    queryFn: () => isCurrentUserAdmin(user?.id),
    enabled: !!user,
  });

  const plantById = useMemo(() => {
    const m = new Map<string, Plant>();
    for (const p of plants) m.set(p.id, p);
    return m;
  }, [plants]);

  const filtered = useMemo(() => {
    const t = filter.trim().toLowerCase();
    if (!t) return edits;
    return edits.filter((e) => {
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
  }, [edits, filter, plantById]);

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

  const toggleSelect = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });

  const onBulkRevert = async () => {
    if (!user || selected.size === 0) return;
    if (!confirm(`确定批量撤销选中的 ${selected.size} 条修改？`)) return;
    setBulkBusy(true);
    let ok = 0, fail = 0;
    for (const e of filtered) {
      if (!selected.has(e.id) || e.reverted) continue;
      try {
        if (e.kind === "catalog_create" || e.kind === "catalog_append") {
          const adminName = (user.user_metadata?.full_name as string) || user.email || "admin";
          await revertCatalogEdit({
            editId: e.id, kind: e.kind, catalog_id: e.catalog_id,
            entry_ids: e.entry_ids ?? null, adminId: user.id, adminName,
          });
        } else if (e.kind !== "revert") {
          await revertEdit(e, user.id);
        }
        ok++;
      } catch { fail++; }
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
      for (const it of items) if (!it.reverted && it.kind !== "revert") {
        if (on) next.add(it.id); else next.delete(it.id);
      }
      return next;
    });

  const onRevert = async (e: PlantEdit) => {
    if (!user) return;
    if (e.kind === "catalog_create" || e.kind === "catalog_append") {
      const label = e.kind === "catalog_create" ? "整个目录及其条目" : "该次追加的全部条目";
      if (!confirm(`确定撤销该${e.kind === "catalog_create" ? "新目录" : "目录补充"}？将删除${label}。`)) return;
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
          <p className="label text-vermilion mb-2">Community Log · 社区编辑日志</p>
          <h1 className="font-display text-5xl font-bold">修改记录</h1>
          <p className="text-ink-faint mt-2">
            所有编辑者对条目所做的修改都会在此存档。
            {isAdmin ? " 你以管理员身份登录，可撤销任意一条修改。" : " 仅管理员可撤销修改。"}
          </p>
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

        {isLoading ? (
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
                      <span className="text-xs text-ink-faint font-normal">· {g.items.length} 条</span>
                    </h2>
                  </button>
                  {isOpen && isAdmin && (
                    <div className="flex gap-3 text-xs mb-2 px-2">
                      <button type="button" onClick={() => selectAllInGroup(g.items, true)} className="text-vermilion hover:underline">
                        全选本组
                      </button>
                      <button type="button" onClick={() => selectAllInGroup(g.items, false)} className="text-ink-faint hover:underline">
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
                          onRevert={() => onRevert(e)}
                          selected={selected.has(e.id)}
                          onToggleSelect={() => toggleSelect(e.id)}
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
    </div>
  );
}

function EditRow({
  edit,
  plant,
  isAdmin,
  onRevert,
  selected,
  onToggleSelect,
}: {
  edit: PlantEdit;
  plant: Plant | undefined;
  isAdmin: boolean;
  onRevert: () => void;
  selected: boolean;
  onToggleSelect: () => void;
}) {
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
  };

  const isCatalog =
    edit.kind === "catalog_create" ||
    edit.kind === "catalog_append" ||
    edit.kind === "tag_create" ||
    edit.kind === "html_save" ||
    edit.kind === "branch" ||
    edit.kind === "merge";

  const srcLabel = sourceLabel(edit.source);
  const isAI = sourceIsAI(edit.source);
  const SourceBadge =
    edit.source ? (
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
        {isAdmin && !edit.reverted && edit.kind !== "revert" && (
          <input type="checkbox" checked={selected} onChange={onToggleSelect} className="mt-1" />
        )}
        <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold shrink-0 ${kindColor[edit.kind] ?? ""}`}>
          {kindLabel[edit.kind] ?? edit.kind}
        </span>
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
            <span className="text-ink-faint text-[11px]">
              {new Date(edit.created_at).toLocaleString("zh-CN", { hour12: false })}
            </span>
            {SourceBadge}
            {edit.reverted && (
              <span className="text-[10px] px-1 py-0 bg-destructive/15 text-destructive rounded">已撤销</span>
            )}
          </div>
          <p className="mt-0.5 text-sm">{edit.summary ?? "（无摘要）"}</p>
        </div>
        {isAdmin && !edit.reverted && (
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
      <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold shrink-0 ${kindColor[edit.kind] ?? ""}`}>
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
            <EditSnapshotPreview html={edit.before_html} kind={edit.kind} />
          </div>
          <div className="border border-rule px-1.5 py-1 bg-paper-deep/30">
            <span className="label text-ink-faint mr-1">后:</span>
            <EditSnapshotPreview html={edit.after_html} kind={edit.kind} />
          </div>
        </div>
      </div>
      {isAdmin && edit.kind !== "revert" && (() => {
        const restoring = edit.reverted;
        return (
          <button
            onClick={onRevert}
            title={
              restoring
                ? "恢复到修改后的内容"
                : "撤销此修改，回到修改前内容"
            }
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

function EditSnapshotPreview({ html, kind }: { html: string | null; kind: PlantEdit["kind"] }) {
  const thumb = imagePreview(html);
  const text = textPreview(html, kind === "image" ? 20 : 20);
  return (
    <span className="inline-flex max-w-full items-center gap-1 align-top">
      {thumb && (
        <img
          src={thumb}
          alt="修改图片缩略图"
          loading="lazy"
          className="h-8 w-8 shrink-0 border border-rule object-cover"
        />
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
