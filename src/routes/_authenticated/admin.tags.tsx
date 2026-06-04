import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { SiteHeader, SiteFooter } from "@/components/site-header";
import { useAuth } from "@/hooks/use-auth";
import { isCurrentUserAdmin } from "@/lib/edits";
import {
  fetchAllTags,
  createTag,
  deleteTag,
  fetchTagByName,
  attachPlantsToTag,
  detachPlantFromTag,
  fetchPlantIdsForTag,
  type Tag,
} from "@/lib/tags";
import { fetchAllPlants, type Plant } from "@/lib/plants";
import { normalizeSciName, IUCN_CATEGORIES } from "@/lib/catalogs";

export const Route = createFileRoute("/_authenticated/admin/tags")({
  component: AdminTagsPage,
});

function AdminTagsPage() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { data: isAdmin = false } = useQuery({
    queryKey: ["is-admin", user?.id],
    queryFn: () => isCurrentUserAdmin(user?.id),
    enabled: !!user,
  });
  const { data: tags = [] } = useQuery({ queryKey: ["all-tags"], queryFn: fetchAllTags });
  const { data: plants = [] } = useQuery({ queryKey: ["plants"], queryFn: fetchAllPlants });

  const [editingId, setEditingId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  if (!user) return null;
  if (!isAdmin) {
    return (
      <div className="min-h-screen flex flex-col">
        <SiteHeader />
        <main className="mx-auto max-w-3xl px-6 py-20 flex-1 text-center">
          <p className="text-ink-faint">该页面仅管理员可访问。</p>
        </main>
        <SiteFooter />
      </div>
    );
  }

  const onDelete = async (t: Tag) => {
    if (!confirm(`删除 #${t.name} 标签？已关联的物种将被解绑。`)) return;
    try {
      await deleteTag(t.id);
      toast.success("已删除");
      qc.invalidateQueries({ queryKey: ["all-tags"] });
    } catch (err) {
      toast.error((err as Error).message);
    }
  };

  const editing = tags.find((t) => t.id === editingId);

  return (
    <div className="min-h-screen flex flex-col">
      <SiteHeader />
      <main className="mx-auto max-w-6xl px-6 py-10 flex-1 w-full">
        <Link to="/admin" className="label hover:text-vermilion">← 返回</Link>
        <div className="border-b-2 border-ink pb-6 mb-8 mt-4 flex items-end justify-between flex-wrap gap-4">
          <div>
            <p className="label text-vermilion mb-2">Tags · 整理标签</p>
            <h1 className="font-display text-4xl font-bold">#tag 归类整理标签</h1>
            <p className="text-ink-faint mt-2 text-sm">管理员可创建主题标签，把已收录条目分组展示在首页。</p>
          </div>
          <button
            onClick={() => { setCreating(true); setEditingId(null); }}
            className="bg-ink text-background px-5 py-2 hover:bg-vermilion transition-colors"
          >
            + 添加 #tag 归类整理标签
          </button>
        </div>

        {creating && (
          <TagEditor
            mode="create"
            plants={plants}
            onClose={() => setCreating(false)}
            onSaved={(id) => {
              setCreating(false);
              setEditingId(id);
              qc.invalidateQueries({ queryKey: ["all-tags"] });
            }}
          />
        )}

        {editing && (
          <TagEditor
            mode="edit"
            tag={editing}
            plants={plants}
            onClose={() => setEditingId(null)}
            onSaved={() => {
              qc.invalidateQueries({ queryKey: ["all-tags"] });
            }}
          />
        )}

        <section className="mt-10">
          <h2 className="font-display text-xl font-bold border-b border-ink pb-2 mb-4">已创建的标签</h2>
          {tags.length === 0 ? (
            <p className="text-ink-faint text-sm">还没有标签。</p>
          ) : (
            <ul className="divide-y divide-rule border-y border-rule">
              {tags.map((t) => (
                <li key={t.id} className="py-3 flex items-baseline gap-3 text-sm">
                  <Link
                    to="/tags/$slug"
                    params={{ slug: t.slug }}
                    className="font-display text-lg font-semibold text-emerald-700 hover:underline"
                  >
                    #{t.name}
                  </Link>
                  <span className="text-xs text-ink-faint">{t.plant_count} 条物种</span>
                  {t.description && (
                    <span className="text-xs text-ink-faint truncate flex-1">— {t.description}</span>
                  )}
                  <span className="text-[11px] text-ink-faint">由 {t.created_by_name ?? "—"} 创建</span>
                  <button
                    onClick={() => { setEditingId(t.id); setCreating(false); }}
                    className="hover:text-vermilion"
                  >
                    编辑
                  </button>
                  <button onClick={() => onDelete(t)} className="text-destructive hover:underline">
                    删除
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}

function TagEditor({
  mode,
  tag,
  plants,
  onClose,
  onSaved,
}: {
  mode: "create" | "edit";
  tag?: Tag;
  plants: Plant[];
  onClose: () => void;
  onSaved: (id: string) => void;
}) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [name, setName] = useState(tag?.name ?? "");
  const [description, setDescription] = useState(tag?.description ?? "");
  const [expectedCount, setExpectedCount] = useState<string>(
    tag?.expected_count != null ? String(tag.expected_count) : "",
  );
  const [busy, setBusy] = useState(false);
  const [picker, setPicker] = useState<"none" | "archive" | "paste">("none");
  const [paste, setPaste] = useState("");
  const [archiveQ, setArchiveQ] = useState("");
  const [archiveGroupBy, setArchiveGroupBy] = useState<"alpha" | "family" | "region" | "iucn">("alpha");
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const { data: linkedIds = [] } = useQuery({
    queryKey: ["tag-plants", tag?.id],
    queryFn: () => (tag ? fetchPlantIdsForTag(tag.id) : Promise.resolve([])),
    enabled: !!tag,
  });

  const linkedSet = useMemo(() => new Set(linkedIds), [linkedIds]);

  const onCreate = async () => {
    if (!user) return;
    if (!name.trim()) return toast.error("请填写标签名称");
    setBusy(true);
    try {
      const existing = await fetchTagByName(name);
      if (existing) {
        toast.error(`该标签已由「${existing.created_by_name ?? "他人"}」创建`);
        setBusy(false);
        return;
      }
      const name_ = (user.user_metadata?.full_name as string) || user.email || "admin";
      const t = await createTag({ name: name.trim(), description }, user.id, name_);
      toast.success("标签已创建");
      onSaved(t.id);
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const onUpdate = async () => {
    if (!tag) return;
    setBusy(true);
    try {
      const { supabase } = await import("@/integrations/supabase/client");
      const exp = expectedCount.trim() === "" ? null : Math.max(0, parseInt(expectedCount, 10) || 0);
      const { error } = await supabase
        .from("tags")
        .update({ name: name.trim(), description: description.trim() || null, expected_count: exp })
        .eq("id", tag.id);
      if (error) throw error;
      toast.success("已更新");
      onSaved(tag.id);
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const onAttachSelected = async () => {
    if (!tag || !user || selected.size === 0) return;
    setBusy(true);
    try {
      await attachPlantsToTag(tag.id, Array.from(selected), user.id);
      toast.success(`已加入 ${selected.size} 个物种`);
      setSelected(new Set());
      setPicker("none");
      qc.invalidateQueries({ queryKey: ["tag-plants", tag.id] });
      qc.invalidateQueries({ queryKey: ["all-tags"] });
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const onPasteAttach = async () => {
    if (!tag || !user) return;
    const names = paste
      .split(/[\r\n,]+/)
      .map((s) => s.trim())
      .filter(Boolean);
    if (!names.length) return toast.error("请粘贴学名");
    const keys = new Set(names.map(normalizeSciName).filter(Boolean));
    const matched = plants.filter((p) => keys.has(normalizeSciName(p.scientific_name)));
    if (matched.length === 0) return toast.error("没有匹配任何已收录学名");
    setBusy(true);
    try {
      await attachPlantsToTag(tag.id, matched.map((p) => p.id), user.id);
      toast.success(`匹配并加入 ${matched.length} 个物种（输入 ${names.length} 个）`);
      setPaste("");
      setPicker("none");
      qc.invalidateQueries({ queryKey: ["tag-plants", tag.id] });
      qc.invalidateQueries({ queryKey: ["all-tags"] });
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const onDetach = async (plantId: string) => {
    if (!tag) return;
    try {
      await detachPlantFromTag(tag.id, plantId);
      qc.invalidateQueries({ queryKey: ["tag-plants", tag.id] });
      qc.invalidateQueries({ queryKey: ["all-tags"] });
    } catch (err) {
      toast.error((err as Error).message);
    }
  };

  // Group plants for archive picker
  const grouped = useMemo(() => {
    const t = archiveQ.trim().toLowerCase();
    const list = plants.filter((p) => {
      if (!t) return true;
      return (
        p.title.toLowerCase().includes(t) ||
        (p.scientific_name ?? "").toLowerCase().includes(t) ||
        (p.family ?? "").toLowerCase().includes(t) ||
        (p.genus ?? "").toLowerCase().includes(t)
      );
    });
    if (archiveGroupBy === "alpha") {
      const sorted = [...list].sort((a, b) => (a.scientific_name ?? a.title).localeCompare(b.scientific_name ?? b.title));
      const groups = new Map<string, Plant[]>();
      for (const p of sorted) {
        const k = ((p.scientific_name ?? p.title)[0] || "?").toUpperCase();
        if (!groups.has(k)) groups.set(k, []);
        groups.get(k)!.push(p);
      }
      return Array.from(groups.entries()).map(([k, v]) => ({ key: k, label: k, items: v }));
    }
    if (archiveGroupBy === "family") {
      const groups = new Map<string, Map<string, Plant[]>>();
      for (const p of list) {
        const fam = (p.family ?? "（未填科）").trim() || "（未填科）";
        const gen = (p.genus ?? "（未填属）").trim() || "（未填属）";
        if (!groups.has(fam)) groups.set(fam, new Map());
        const fm = groups.get(fam)!;
        if (!fm.has(gen)) fm.set(gen, []);
        fm.get(gen)!.push(p);
      }
      return Array.from(groups.entries()).sort((a, b) => a[0].localeCompare(b[0])).map(([fam, gm]) => ({
        key: fam,
        label: fam,
        items: Array.from(gm.entries()).flatMap(([gen, ps]) => [
          { __sub: gen, items: ps } as unknown as Plant,
        ]),
      }));
    }
    if (archiveGroupBy === "iucn") {
      const groups = new Map<string, Plant[]>();
      for (const p of list) {
        const k = p.iucn_status || "未评估";
        if (!groups.has(k)) groups.set(k, []);
        groups.get(k)!.push(p);
      }
      const order = [...IUCN_CATEGORIES.map((c) => c.code), "未评估"];
      return order
        .filter((k) => groups.has(k))
        .map((k) => ({ key: k, label: k, items: groups.get(k)! }));
    }
    // by region — would need catalogs lookup, fall back to alpha
    return [{ key: "all", label: "全部（按学名排）", items: [...list].sort((a, b) => (a.scientific_name ?? a.title).localeCompare(b.scientific_name ?? b.title)) }];
  }, [plants, archiveQ, archiveGroupBy]);

  return (
    <section className="border-2 border-ink p-5 mb-8 bg-paper-deep/20">
      <div className="flex items-center justify-between mb-3">
        <p className="label text-vermilion">{mode === "create" ? "新建标签" : `编辑 #${tag?.name}`}</p>
        <button onClick={onClose} className="text-ink-faint hover:text-ink">关闭</button>
      </div>
      <div className="grid sm:grid-cols-2 gap-3 mb-3">
        <label className="block">
          <span className="label text-xs block mb-1">标签名称</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="例如：北方湿地"
            className="w-full border border-ink px-3 py-2 bg-transparent"
          />
        </label>
        <label className="block">
          <span className="label text-xs block mb-1">标签说明</span>
          <input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="简短描述这个主题"
            className="w-full border border-ink px-3 py-2 bg-transparent"
          />
        </label>
        <label className="block sm:col-span-2">
          <span className="label text-xs block mb-1">总名录数（可选 · 用于显示 n/x，留空则与已收录数相同）</span>
          <input
            type="number"
            min={0}
            value={expectedCount}
            onChange={(e) => setExpectedCount(e.target.value)}
            placeholder="例如：保护名录共 120 种"
            className="w-full sm:w-60 border border-ink px-3 py-2 bg-transparent"
          />
        </label>
      </div>
      <div className="flex gap-2 mb-4">
        {mode === "create" ? (
          <button onClick={onCreate} disabled={busy} className="bg-ink text-background px-4 py-2 hover:bg-vermilion disabled:opacity-60">
            {busy ? "保存中…" : "创建标签"}
          </button>
        ) : (
          <button onClick={onUpdate} disabled={busy} className="bg-ink text-background px-4 py-2 hover:bg-vermilion disabled:opacity-60">
            {busy ? "保存中…" : "保存名称/说明"}
          </button>
        )}
      </div>

      {mode === "edit" && tag && (
        <>
          <div className="border-t border-rule pt-4">
            <div className="flex items-baseline justify-between mb-2">
              <h3 className="font-display text-lg font-semibold">已纳入此标签的物种（{linkedIds.length}）</h3>
              <div className="flex gap-2">
                <button onClick={() => { setPicker("archive"); }} className="text-xs border border-ink px-3 py-1 hover:bg-paper-deep">+ 从已收录的条目中选择</button>
                <button onClick={() => { setPicker("paste"); }} className="text-xs border border-ink px-3 py-1 hover:bg-paper-deep">+ 粘贴带学名的目录</button>
              </div>
            </div>
            {linkedIds.length === 0 ? (
              <p className="text-xs text-ink-faint">还没有物种被加入此标签。</p>
            ) : (
              <ul className="grid sm:grid-cols-2 lg:grid-cols-3 gap-x-4 gap-y-1 text-sm">
                {plants.filter((p) => linkedSet.has(p.id)).map((p) => (
                  <li key={p.id} className="flex items-baseline gap-2">
                    <Link to="/plants/$slug" params={{ slug: p.slug }} className="text-emerald-700 hover:underline truncate">
                      {p.title} · <span className="italic text-ink-soft">{p.scientific_name}</span>
                    </Link>
                    <button onClick={() => onDetach(p.id)} className="text-destructive hover:underline text-xs">×</button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {picker === "paste" && (
            <div className="mt-4 pt-4 border-t border-rule">
              <p className="label text-xs mb-1">粘贴带学名的目录（每行一个学名，自动按学名匹配已收录条目）</p>
              <textarea
                rows={6}
                value={paste}
                onChange={(e) => setPaste(e.target.value)}
                className="w-full border border-ink p-2 font-mono text-xs bg-transparent"
                placeholder={"Butomus umbellatus\nPrimula nutans"}
              />
              <div className="flex justify-end gap-2 mt-2">
                <button onClick={() => setPicker("none")} className="text-xs px-3 py-1 border border-rule">取消</button>
                <button onClick={onPasteAttach} disabled={busy} className="bg-ink text-background text-xs px-3 py-1 disabled:opacity-60">
                  {busy ? "处理中…" : "匹配并加入"}
                </button>
              </div>
            </div>
          )}

          {picker === "archive" && (
            <div className="mt-4 pt-4 border-t border-rule">
              <div className="flex flex-wrap items-center gap-2 mb-3">
                <input
                  value={archiveQ}
                  onChange={(e) => setArchiveQ(e.target.value)}
                  placeholder="搜索学名/中文名/科/属…"
                  className="border border-ink px-3 py-1 text-sm bg-transparent flex-1 min-w-[200px]"
                />
                <div className="flex border border-ink text-xs">
                  {(["alpha", "family", "iucn"] as const).map((g) => (
                    <button
                      key={g}
                      onClick={() => setArchiveGroupBy(g)}
                      className={`px-3 py-1 ${archiveGroupBy === g ? "bg-ink text-background" : "hover:bg-paper-deep"}`}
                    >
                      {g === "alpha" ? "首字母" : g === "family" ? "科属树" : "IUCN"}
                    </button>
                  ))}
                </div>
                <span className="text-xs text-ink-faint">已选 {selected.size}</span>
                <button onClick={onAttachSelected} disabled={busy || selected.size === 0} className="bg-emerald-700 text-white text-xs px-3 py-1 disabled:opacity-60">
                  {busy ? "加入中…" : "加入此标签"}
                </button>
                <button onClick={() => setPicker("none")} className="text-xs px-3 py-1 border border-rule">取消</button>
              </div>
              <div className="max-h-[400px] overflow-auto border border-rule p-3 space-y-3 bg-background">
                {grouped.map((g) => (
                  <div key={g.key}>
                    <p className="label text-xs text-vermilion mb-1">{g.label}</p>
                    <ul className="grid sm:grid-cols-2 gap-x-3 gap-y-0.5 text-xs">
                      {(g.items as Plant[]).map((p) => {
                        if ((p as unknown as { __sub?: string }).__sub) {
                          const sub = p as unknown as { __sub: string; items: Plant[] };
                          return (
                            <li key={sub.__sub} className="col-span-2">
                              <p className="text-[11px] text-ink-faint mt-1 mb-0.5">└ {sub.__sub}</p>
                              <ul className="grid sm:grid-cols-2 gap-x-3 gap-y-0.5">
                                {sub.items.map((sp) => (
                                  <PickRow
                                    key={sp.id}
                                    plant={sp}
                                    checked={selected.has(sp.id) || linkedSet.has(sp.id)}
                                    disabled={linkedSet.has(sp.id)}
                                    onToggle={() => {
                                      setSelected((s) => {
                                        const n = new Set(s);
                                        if (n.has(sp.id)) n.delete(sp.id);
                                        else n.add(sp.id);
                                        return n;
                                      });
                                    }}
                                  />
                                ))}
                              </ul>
                            </li>
                          );
                        }
                        return (
                          <PickRow
                            key={p.id}
                            plant={p}
                            checked={selected.has(p.id) || linkedSet.has(p.id)}
                            disabled={linkedSet.has(p.id)}
                            onToggle={() => {
                              setSelected((s) => {
                                const n = new Set(s);
                                if (n.has(p.id)) n.delete(p.id);
                                else n.add(p.id);
                                return n;
                              });
                            }}
                          />
                        );
                      })}
                    </ul>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </section>
  );
}

function PickRow({ plant, checked, disabled, onToggle }: { plant: Plant; checked: boolean; disabled: boolean; onToggle: () => void }) {
  return (
    <li>
      <label className={`flex items-center gap-1 ${disabled ? "opacity-50" : "cursor-pointer hover:text-vermilion"}`}>
        <input type="checkbox" checked={checked} disabled={disabled} onChange={onToggle} />
        <span className="truncate">
          {plant.title} · <span className="italic">{plant.scientific_name}</span>
        </span>
      </label>
    </li>
  );
}
