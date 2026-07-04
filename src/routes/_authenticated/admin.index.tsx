import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { SiteHeader, SiteFooter } from "@/components/site-header";
import { useAuth } from "@/hooks/use-auth";
import { isCurrentUserAdmin } from "@/lib/edits";
import { fetchAllPlants, fetchMyPlants, type Plant } from "@/lib/plants";
import { EntryTypeBadge } from "@/components/entry-type-badge";
import { XiaoPModelPanel } from "@/components/xiaop-model-panel";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import {
  regionLabel,
  deleteCatalog,
  fetchEntries,
  appendEntries,
  deleteCatalogEntry,
  parseCatalogText,
  type RegionalCatalog,
  type CatalogEntry,
} from "@/lib/catalogs";
import { fillChineseNames } from "@/lib/catalog-ai.functions";
import { useServerFn } from "@tanstack/react-start";
import { fetchAllTags, type TagWithCount } from "@/lib/tags";

export const Route = createFileRoute("/_authenticated/admin/")({
  component: AdminPage,
});

function AdminPage() {
  const { user } = useAuth();
  const qc = useQueryClient();
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
    queryFn: async () => {
      const { data: cats, error } = await supabase
        .from("regional_catalogs")
        .select("*")
        .eq("created_by", user!.id)
        .order("created_at", { ascending: false });
      if (error) throw error;
      const list = (cats ?? []) as RegionalCatalog[];
      // entry counts
      const ids = list.map((c) => c.id);
      const counts: Record<string, number> = {};
      if (ids.length) {
        const { data: es } = await supabase
          .from("catalog_entries")
          .select("catalog_id")
          .in("catalog_id", ids);
        for (const e of es ?? []) counts[e.catalog_id] = (counts[e.catalog_id] ?? 0) + 1;
      }
      return list.map((c) => ({ ...c, count: counts[c.id] ?? 0 }));
    },
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

  const onDelete = async (p: Plant) => {
    if (!confirm(`确定删除「${p.title}」？此操作不可撤销。`)) return;
    const { error } = await supabase.from("plants").delete().eq("id", p.id);
    if (error) return toast.error(error.message);
    toast.success("已删除");
    qc.invalidateQueries({ queryKey: ["my-plants"] });
    qc.invalidateQueries({ queryKey: ["plants"] });
    qc.invalidateQueries({ queryKey: ["home"] });
  };

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

  return (
    <div className="min-h-screen flex flex-col">
      <SiteHeader />
      <main className="mx-auto max-w-6xl px-6 py-10 flex-1 w-full">
        <div className="border-b-2 border-ink pb-6 mb-8 flex items-end justify-between flex-wrap gap-4">
          <div>
            <p className="label text-vermilion mb-2">Editor's Desk · 编辑台</p>
            <h1 className="font-display text-4xl font-bold">我的条目</h1>
            <p className="text-ink-faint mt-2">由 {user?.email} 编纂</p>
          </div>
          <div className="flex gap-2">
            {isAdmin && (
              <Link to="/admin/tags" className="border border-emerald-700 text-emerald-700 px-5 py-2 hover:bg-emerald-700 hover:text-background transition-colors">+ 添加 #tag 归类整理标签</Link>
            )}
            <Link to="/admin/catalogs/new" className="border border-ink px-5 py-2 hover:bg-ink hover:text-background transition-colors">+ 地区植物目录</Link>
            <Link to="/admin/batch-new" className="border border-ink px-5 py-2 hover:bg-ink hover:text-background transition-colors">+ 批量添加条目</Link>
            <Link to="/admin/new" className="bg-ink text-background px-5 py-2 hover:bg-vermilion transition-colors">+ 新建条目</Link>
            <Link to="/admin/blog/new" className="bg-emerald-700 text-background px-5 py-2 hover:bg-vermilion transition-colors">+ 编辑博客</Link>
            <Link to="/admin/projects/new" className="bg-emerald-700 text-background px-5 py-2 hover:bg-vermilion transition-colors">+ 编辑项目</Link>
          </div>
        </div>

        {isAdmin && <XiaoPModelPanel />}

        {myCatalogs.length > 0 && (
          <section className="mb-10">
            <h2 className="font-display text-2xl font-bold border-b-2 border-ink pb-2 mb-4">
              我创建的地区植物名录
            </h2>
            <ul className="divide-y divide-rule border-y border-rule">
              {myCatalogs.map((c) => (
                <CatalogRow
                  key={c.id}
                  catalog={c}
                  plants={allPlants}
                  onDelete={() => onDeleteCatalog(c)}
                />
              ))}
            </ul>
          </section>
        )}

        {myTags.length > 0 && (
          <section className="mb-10">
            <h2 className="font-display text-2xl font-bold border-b-2 border-ink pb-2 mb-4">
              {isAdmin ? "全部 #tag 归类标签" : "我添加到的 #tag 标签"}
            </h2>
            <div className="flex flex-wrap gap-2">
              {myTags.map((t) => (
                <Link
                  key={t.id}
                  to="/tags/$slug"
                  params={{ slug: t.slug }}
                  className="border border-emerald-700 text-emerald-700 px-3 py-1.5 text-sm hover:bg-emerald-700 hover:text-background transition-colors"
                  title={t.description ?? ""}
                >
                  #{t.name} <span className="opacity-60">({t.plant_count})</span>
                </Link>
              ))}
            </div>
          </section>
        )}

        <h2 className="font-display text-2xl font-bold border-b-2 border-ink pb-2 mb-4">条目列表</h2>
        {isLoading ? (
          <p className="text-ink-faint">载入中…</p>
        ) : plants.length === 0 ? (
          <div className="border border-dashed border-rule py-16 text-center">
            <p className="text-ink-faint mb-4">还没有条目，从新建第一个开始。</p>
            <Link to="/admin/new" className="border border-ink px-4 py-2 hover:bg-ink hover:text-background transition-colors">+ 创建条目</Link>
          </div>
        ) : (
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
                    <Link to="/plants/$slug" params={{ slug: p.slug }} className="font-display text-lg font-semibold hover:text-vermilion">{p.title}</Link>
                    {p.scientific_name && <p className="italic text-xs text-ink-faint">{p.scientific_name}</p>}
                  </td>
                  <td className="py-4 text-sm"><EntryTypeBadge plant={p} /></td>
                  <td className="py-4 text-sm text-ink-faint">{new Date(p.updated_at).toLocaleString("zh-CN")}</td>
                  <td className="py-4 text-right space-x-3 text-sm">
                    <Link to="/admin/edit/$id" params={{ id: p.id }} className="hover:text-vermilion">编辑</Link>
                    <button onClick={() => onDelete(p)} className="text-destructive hover:underline">删除</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </main>
      <SiteFooter />
    </div>
  );
}

function CatalogRow({
  catalog,
  plants,
  onDelete,
}: {
  catalog: RegionalCatalog & { count: number };
  plants: Plant[];
  onDelete: () => void;
}) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const aiFill = useServerFn(fillChineseNames);
  const [open, setOpen] = useState(false);
  const [addText, setAddText] = useState("");
  const [busy, setBusy] = useState(false);

  const { data: entries = [] } = useQuery({
    queryKey: ["catalog-entries", catalog.id],
    queryFn: () => fetchEntries(catalog.id),
    enabled: open,
  });

  const plantBySci = new Map(
    plants.filter((p) => p.scientific_name).map((p) => [p.scientific_name!.toLowerCase().trim(), p]),
  );

  const sorted = [...entries].sort((a, b) => {
    const ha = plantBySci.has(a.scientific_name.toLowerCase().trim());
    const hb = plantBySci.has(b.scientific_name.toLowerCase().trim());
    if (ha !== hb) return ha ? -1 : 1;
    return a.scientific_name.localeCompare(b.scientific_name);
  });

  const onDeleteEntry = async (e: CatalogEntry) => {
    if (!confirm(`删除「${e.scientific_name}」？`)) return;
    try {
      await deleteCatalogEntry(e.id);
      qc.invalidateQueries({ queryKey: ["catalog-entries", catalog.id] });
      qc.invalidateQueries({ queryKey: ["my-catalogs"] });
      qc.invalidateQueries({ queryKey: ["all-catalog-entries"] });
    } catch (err) {
      toast.error((err as Error).message);
    }
  };

  const onAppend = async () => {
    if (!user) return;
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
        catalog.id,
        final,
        user.id,
        name,
        aiUsed
          ? "ai:google/gemini-3-flash-preview@lovable-ai+catalog_editor"
          : "catalog_editor",
      );
      toast.success(`已补充 ${final.length} 条`);
      setAddText("");
      qc.invalidateQueries({ queryKey: ["catalog-entries", catalog.id] });
      qc.invalidateQueries({ queryKey: ["my-catalogs"] });
      qc.invalidateQueries({ queryKey: ["all-catalog-entries"] });
      qc.invalidateQueries({ queryKey: ["plant-edits"] });
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <li className="py-3 text-sm">
      <div className="flex items-center gap-3">
        <button
          onClick={() => setOpen((o) => !o)}
          title="点击展开已添加的目录，然后可以进行编辑（删除某条，或者添加更多）"
          className="inline-flex items-center gap-1 hover:text-vermilion"
          aria-expanded={open}
        >
          <span className="inline-block w-4 text-ink-faint">{open ? "▾" : "▸"}</span>
        </button>
        <div className="flex-1 min-w-0">
          <p>
            为 <span className="font-semibold">{regionLabel(catalog)}</span> 添加了
            <span className="font-semibold text-vermilion mx-1">{catalog.count}</span>
            种植物名录
          </p>
          <p className="text-xs text-ink-faint mt-0.5">
            {new Date(catalog.created_at).toLocaleString("zh-CN")} · 来源：{catalog.source}
          </p>
        </div>
        <Link to="/admin/catalogs/$id" params={{ id: catalog.id }} className="hover:text-vermilion">
          详情
        </Link>
        <button onClick={onDelete} className="text-destructive hover:underline">删除</button>
      </div>

      {open && (
        <div className="mt-3 ml-7 border-l border-rule pl-4">
          <ul className="divide-y divide-rule-soft">
            {sorted.length === 0 && <li className="py-2 text-ink-faint text-xs">还没有条目</li>}
            {sorted.map((e) => {
              const hit = plantBySci.get(e.scientific_name.toLowerCase().trim());
              return (
                <li key={e.id} className="py-1.5 flex items-center gap-2 text-xs">
                  <span className="flex-1 min-w-0">
                    {hit ? (
                      <Link
                        to="/plants/$slug"
                        params={{ slug: hit.slug }}
                        className="text-[oklch(0.55_0.18_240)] hover:underline"
                      >
                        <span className="italic">{e.scientific_name}</span>
                        {e.chinese_name ? ` · ${e.chinese_name}` : ""}
                      </Link>
                    ) : (
                      <span>
                        <span className="italic">{e.scientific_name}</span>
                        {e.chinese_name ? ` · ${e.chinese_name}` : ""}
                      </span>
                    )}
                    <span className="text-[10px] text-ink-faint ml-2">添加：{e.added_by_name ?? "—"}</span>
                  </span>
                  <button onClick={() => onDeleteEntry(e)} className="text-destructive hover:underline shrink-0">
                    删除
                  </button>
                </li>
              );
            })}
          </ul>

          <div className="mt-3">
            <p className="label text-xs mb-1">+ 补充更多条目</p>
            <textarea
              rows={3}
              value={addText}
              onChange={(ev) => setAddText(ev.target.value)}
              className="w-full border border-ink p-2 bg-transparent font-mono text-xs focus:outline-none focus:border-vermilion"
              placeholder="每行一个学名，可附中文名"
            />
            <div className="flex justify-end mt-1">
              <button
                onClick={onAppend}
                disabled={busy}
                className="bg-ink text-background px-3 py-1 text-xs hover:bg-vermilion disabled:opacity-60"
              >
                {busy ? "处理中…" : "追加"}
              </button>
            </div>
          </div>
        </div>
      )}
    </li>
  );
}
