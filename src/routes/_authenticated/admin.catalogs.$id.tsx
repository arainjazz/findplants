import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { SiteHeader, SiteFooter } from "@/components/site-header";
import { useAuth } from "@/hooks/use-auth";
import {
  fetchCatalog,
  fetchAllCatalogs,
  appendEntries,
  deleteCatalogEntry,
  deleteCatalog,
  parseCatalogText,
  regionLabel,
  type CatalogEntry,
} from "@/lib/catalogs";
import { isCurrentUserAdmin } from "@/lib/edits";
import { fetchAllPlants } from "@/lib/plants";
import { fillChineseNames } from "@/lib/catalog-ai.functions";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/_authenticated/admin/catalogs/$id")({
  component: CatalogDetail,
});

function CatalogDetail() {
  const { id } = Route.useParams();
  const { user } = useAuth();
  const qc = useQueryClient();
  const aiFill = useServerFn(fillChineseNames);

  const { data: cat, isLoading } = useQuery({
    queryKey: ["catalog", id],
    queryFn: () => fetchCatalog(id),
  });
  const { data: allCatalogs = [] } = useQuery({ queryKey: ["all-catalogs"], queryFn: fetchAllCatalogs });
  // Merge all catalogs that share the same province+city+county
  const siblingCatalogs = cat
    ? allCatalogs.filter(
        (c) => c.province === cat.province && (c.city ?? "") === (cat.city ?? "") && (c.county ?? "") === (cat.county ?? ""),
      )
    : [];
  const { data: entries = [] } = useQuery({
    queryKey: ["catalog-entries-region", siblingCatalogs.map((c) => c.id).join(",")],
    enabled: siblingCatalogs.length > 0,
    queryFn: async () => {
      const ids = siblingCatalogs.map((c) => c.id);
      const { data, error } = await supabase
        .from("catalog_entries")
        .select("*")
        .in("catalog_id", ids)
        .order("scientific_name");
      if (error) throw error;
      return (data ?? []) as CatalogEntry[];
    },
  });
  const { data: plants = [] } = useQuery({ queryKey: ["plants"], queryFn: fetchAllPlants });
  const { data: isAdmin = false } = useQuery({
    queryKey: ["is-admin", user?.id],
    queryFn: () => isCurrentUserAdmin(user?.id),
    enabled: !!user,
  });

  const [addText, setAddText] = useState("");
  const [busy, setBusy] = useState(false);

  if (isLoading) return <Shell><p className="text-ink-faint">载入中…</p></Shell>;
  if (!cat) throw notFound();

  const isOwner = user?.id === cat.created_by;
  const canDeleteCatalog = isOwner || isAdmin;
  const plantBySci = new Map(
    plants.filter((p) => p.scientific_name).map((p) => [p.scientific_name!.toLowerCase().trim(), p]),
  );

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
        id,
        final,
        user.id,
        name,
        aiUsed
          ? "ai:google/gemini-3-flash-preview@lovable-ai+catalog_editor"
          : "catalog_editor",
      );
      toast.success(`已补充 ${final.length} 条`);
      setAddText("");
      qc.invalidateQueries({ queryKey: ["catalog-entries-region"] });
      qc.invalidateQueries({ queryKey: ["plant-edits"] });
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const onDeleteEntry = async (entryId: string) => {
    if (!confirm("删除该条目？")) return;
    try {
      await deleteCatalogEntry(entryId);
      qc.invalidateQueries({ queryKey: ["catalog-entries-region"] });
    } catch (err) {
      toast.error((err as Error).message);
    }
  };

  const onDeleteCatalog = async () => {
    if (!confirm("确定删除整个目录？该地区下所有条目都会被移除。")) return;
    try {
      await deleteCatalog(id);
      toast.success("已删除目录");
      window.location.href = "/admin";
    } catch (err) {
      toast.error((err as Error).message);
    }
  };

  return (
    <Shell>
      <Link to="/admin" className="label hover:text-vermilion">← 返回</Link>
      <div className="border-b-2 border-ink pb-6 mb-6 mt-4 flex items-end justify-between flex-wrap gap-3">
        <div>
          <p className="label text-vermilion mb-2">Regional Catalog</p>
          <h1 className="font-display text-3xl font-bold">{regionLabel(cat)} 植物目录</h1>
          <p className="text-xs text-ink-faint mt-2">
            共 {entries.length} 条 · 由 {siblingCatalogs.length} 份目录合并展示
          </p>
          <ul className="text-xs text-ink-faint mt-1 space-y-0.5">
            {siblingCatalogs.map((sc) => (
              <li key={sc.id}>
                · {sc.contributor_name}（{new Date(sc.created_at).toLocaleDateString("zh-CN")}）— 来源：{sc.source}
              </li>
            ))}
          </ul>
        </div>
        {canDeleteCatalog && (
          <button
            onClick={onDeleteCatalog}
            className="border border-destructive text-destructive px-3 py-1 text-sm hover:bg-destructive hover:text-background"
          >
            删除整个目录
          </button>
        )}
      </div>

      <section className="mb-8">
        <h2 className="label mb-2">+ 补充条目（任何已批准编辑均可）</h2>
        <textarea
          rows={5}
          value={addText}
          onChange={(e) => setAddText(e.target.value)}
          className="w-full border border-ink p-3 bg-transparent font-mono text-sm focus:outline-none focus:border-vermilion"
          placeholder="每行一个学名，可附中文名"
        />
        <div className="flex justify-end mt-2">
          <button
            onClick={onAppend}
            disabled={busy}
            className="bg-ink text-background px-4 py-1.5 text-sm hover:bg-vermilion disabled:opacity-60"
          >
            {busy ? "处理中…" : "追加"}
          </button>
        </div>
      </section>

      <section>
        <h2 className="label mb-2">目录条目（{entries.length}）</h2>
        <ul className="divide-y divide-rule border-y border-rule">
          {entries.map((e) => {
            const hit = plantBySci.get(e.scientific_name.toLowerCase().trim());
            const canDelete = e.added_by === user?.id || isOwner || isAdmin;
            return (
              <li key={e.id} className="py-2 flex items-center gap-3 text-sm">
                <div className="flex-1 min-w-0">
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
                    <span className="text-ink">
                      <span className="italic">{e.scientific_name}</span>
                      {e.chinese_name ? ` · ${e.chinese_name}` : ""}
                    </span>
                  )}
                  <span className="text-[10px] text-ink-faint ml-2">添加：{e.added_by_name ?? "—"}</span>
                </div>
                {canDelete && (
                  <button
                    onClick={() => onDeleteEntry(e.id)}
                    className="text-xs text-destructive hover:underline shrink-0"
                  >
                    删除
                  </button>
                )}
              </li>
            );
          })}
          {entries.length === 0 && <li className="py-4 text-ink-faint text-sm">还没有条目</li>}
        </ul>
      </section>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen flex flex-col">
      <SiteHeader />
      <main className="mx-auto max-w-4xl px-6 py-10 flex-1 w-full">{children}</main>
      <SiteFooter />
    </div>
  );
}