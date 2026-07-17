import { Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { useAuth } from "@/hooks/use-auth";
import type { Plant } from "@/lib/plants";
import { fillChineseNames } from "@/lib/catalog-ai.functions";
import {
  regionLabel,
  fetchEntries,
  appendEntries,
  deleteCatalogEntry,
  parseCatalogText,
  type RegionalCatalog,
  type CatalogEntry,
} from "@/lib/catalogs";

/**
 * One 地区植物目录 the current editor added: expand it to read the entries, delete any
 * single entry, or append more. Shared by 编辑台 (/admin) and 我的主页 (/profile) so an
 * editor can maintain their own catalogs from either place.
 */
export function CatalogRow({
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
    plants
      .filter((p) => p.scientific_name)
      .map((p) => [p.scientific_name!.toLowerCase().trim(), p]),
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
        if (out?.entries) {
          final = out.entries;
          aiUsed = true;
        }
      } catch {
        /* ignore */
      }
      const name = (user.user_metadata?.full_name as string) || user.email || "编辑者";
      await appendEntries(
        catalog.id,
        final,
        user.id,
        name,
        aiUsed ? "ai:google/gemini-3-flash-preview@lovable-ai+catalog_editor" : "catalog_editor",
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
        <button onClick={onDelete} className="text-destructive hover:underline">
          删除
        </button>
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
                    <span className="text-[10px] text-ink-faint ml-2">
                      添加：{e.added_by_name ?? "—"}
                    </span>
                  </span>
                  <button
                    onClick={() => onDeleteEntry(e)}
                    className="text-destructive hover:underline shrink-0"
                  >
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
