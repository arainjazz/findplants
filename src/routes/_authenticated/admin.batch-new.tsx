import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { FolderOpen, Link2, Image as ImageIcon, Globe, Trash2 } from "lucide-react";
import { SiteHeader, SiteFooter } from "@/components/site-header";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { slugify } from "@/lib/plants";
import { IUCN_CATEGORIES } from "@/lib/catalogs";
import { HtmlDocEditor, type HtmlDocEditorHandle, ImageSearchDialog } from "@/components/html-doc-editor";
import { buildAssetLookupKeys, findLocalAssetRefs, rewriteLocalAssetPaths } from "@/components/plant-editor";

export const Route = createFileRoute("/_authenticated/admin/batch-new")({
  component: BatchNewPage,
});

type Item = {
  key: string;
  fileName: string;
  htmlUrl: string;
  title: string;
  slug: string;
  scientificName: string;
  commonNameEn: string;
  family: string;
  genus: string;
  iucnStatus: string;
  habitat: string;
  summary: string;
  tags: string;
  coverUrl: string;
  extracting: boolean;
  creating: boolean;
  createdId: string | null;
};

function BatchNewPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const htmlOnlyRef = useRef<HTMLInputElement>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [uploading, setUploading] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [savingAll, setSavingAll] = useState(false);
  const [creatingAll, setCreatingAll] = useState(false);
  const editorRefs = useRef<Map<string, HtmlDocEditorHandle | null>>(new Map());

  // Build a normalized lookup of image files by name + relative path suffixes.
  const isImageFile = (file: File) =>
    file.type.startsWith("image/") || /\.(png|jpe?g|webp|gif|svg|avif|bmp|tiff?)$/i.test(file.name);

  const assetLookupKeys = (value: string) => buildAssetLookupKeys(value);

  const indexImageFiles = (imageFiles: File[]) => {
    const idx = new Map<string, File>();
    for (const f of imageFiles) {
      const rel = ((f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name).replace(/\\/g, "/");
      assetLookupKeys(rel).forEach((k) => idx.set(k, f));
      assetLookupKeys(f.name).forEach((k) => idx.set(k, f));
      const parts = rel.split("/");
      for (let i = 1; i < parts.length; i++) idx.set(parts.slice(i).join("/").toLowerCase(), f);
    }
    return idx;
  };

  const resolveRefs = (refs: string[], idx: Map<string, File>) => {
    const matched = new Map<string, File>();
    const missing: string[] = [];
    for (const ref of refs) {
      const file = assetLookupKeys(ref).map((k) => idx.get(k)).find(Boolean);
      if (file) matched.set(ref, file);
      else missing.push(ref);
    }
    return { matched, missing };
  };

  const uploadOneImage = async (img: File) => {
    if (!user) throw new Error("未登录");
    const ext = img.name.split(".").pop() || "bin";
    const path = `${user.id}/batch-img/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
    const { error } = await supabase.storage.from("plant-images").upload(path, img, {
      cacheControl: "3600", upsert: false, contentType: img.type || undefined,
    });
    if (error) throw error;
    return supabase.storage.from("plant-images").getPublicUrl(path).data.publicUrl;
  };

  // For a single HTML, given matched image files, upload them, rewrite the HTML, then upload the HTML.
  const uploadHtmlWithImages = async (
    htmlFile: File,
    text: string,
    matched: Map<string, File>,
  ): Promise<string> => {
    if (!user) throw new Error("未登录");
    let finalText = text;
    if (matched.size > 0) {
      const nameMap = new Map<string, string>();
      // Avoid re-uploading the same File twice when multiple refs share it.
      const fileToUrl = new Map<File, string>();
      for (const [ref, file] of matched.entries()) {
        let url = fileToUrl.get(file);
        if (!url) { url = await uploadOneImage(file); fileToUrl.set(file, url); }
        nameMap.set(ref, url);
        nameMap.set(file.name, url);
        const rel = (file as File & { webkitRelativePath?: string }).webkitRelativePath;
        if (rel) {
          nameMap.set(rel, url);
          const stripped = rel.split("/").slice(1).join("/");
          if (stripped) nameMap.set(stripped, url);
        }
      }
      finalText = rewriteLocalAssetPaths(text, nameMap);
    }
    const blob = new Blob([finalText], { type: "text/html" });
    const ext = htmlFile.name.split(".").pop() || "html";
    const path = `${user.id}/batch/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
    const { error } = await supabase.storage.from("plant-html").upload(path, blob, {
      cacheControl: "3600", upsert: false, contentType: "text/html",
    });
    if (error) throw error;
    return supabase.storage.from("plant-html").getPublicUrl(path).data.publicUrl;
  };

  const finalizeBatch = async (
    htmlEntries: { file: File; text: string; matched: Map<string, File> }[],
  ) => {
    const next: Item[] = [];
    for (const ent of htmlEntries) {
      try {
        const url = await uploadHtmlWithImages(ent.file, ent.text, ent.matched);
        next.push({
          key: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          fileName: ent.file.name,
          htmlUrl: url,
          title: ent.file.name.replace(/\.html?$/i, ""),
          slug: "",
          scientificName: "",
          commonNameEn: "",
          family: "",
          genus: "",
          iucnStatus: "",
          habitat: "",
          summary: "",
          tags: "",
          coverUrl: "",
          extracting: true,
          creating: false,
          createdId: null,
        });
      } catch (err) {
        toast.error(`${ent.file.name}: ${(err as Error).message}`);
      }
    }
    setItems((prev) => [...prev, ...next]);
    if (next.length) toast.success(`已上传 ${next.length} 个文件，正在识别…`);
    next.forEach((it) => runExtract(it.key, it.htmlUrl));
  };

  const onPickFiles = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    e.target.value = "";
    if (!files.length || !user) return;
    setUploading(true);
    try {
      const htmlFiles = files.filter((f) => /\.html?$/i.test(f.name) || f.type === "text/html");
      const imageFiles = files.filter((f) => isImageFile(f));
      if (htmlFiles.length === 0) {
        toast.error("请至少选择一个 .html 文件，或选择包含 HTML 与图片的文件夹");
        return;
      }
      const idx = indexImageFiles(imageFiles);
      // Pre-parse every HTML to resolve refs against the user's selection.
      const parsed: { file: File; text: string; matched: Map<string, File>; missing: string[] }[] = [];
      for (const f of htmlFiles) {
        const text = await f.text();
        const refs = findLocalAssetRefs(text);
        const { matched, missing } = resolveRefs(refs, idx);
        parsed.push({ file: f, text, matched, missing });
      }
      const totalRefs = parsed.reduce((n, p) => n + p.matched.size + p.missing.length, 0);
      const totalMissing = parsed.reduce((n, p) => n + p.missing.length, 0);
      if (totalMissing > 0) {
        const matchedCount = parsed.reduce((n, p) => n + p.matched.size, 0);
        toast.error(
          `已自动匹配 ${matchedCount} 张配图；仍有 ${totalMissing} 个本地图片路径未找到。请点“选择 HTML 所在文件夹”，系统会自动上传全部配图。`,
          { duration: 8000 },
        );
        return;
      }
      await finalizeBatch(parsed.map(({ file, text, matched }) => ({ file, text, matched })));
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setUploading(false);
    }
  };

  const updateItem = (key: string, patch: Partial<Item>) =>
    setItems((prev) => prev.map((it) => (it.key === key ? { ...it, ...patch } : it)));

  const runExtract = async (key: string, htmlUrl: string) => {
    try {
      const { data, error } = await supabase.functions.invoke("extract-plant-meta", {
        body: { htmlUrl },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      const meta = data as Record<string, unknown>;
      let rawFamily = typeof meta.family === "string" ? meta.family.trim() : "";
      let rawGenus = typeof meta.genus === "string" ? meta.genus.trim() : "";
      if (rawFamily) {
        const zhM = rawFamily.match(/^(.*?[\u4e00-\u9fff]科(?:\s+[A-Z][a-z]+)?)[\s,，;；·•|]+(.*?[\u4e00-\u9fff]属(?:\s+[A-Z][a-z]+)?.*)$/);
        if (zhM) {
          rawFamily = zhM[1].trim();
          if (!rawGenus) rawGenus = zhM[2].trim();
        } else {
          const laM = rawFamily.match(/^([A-Z][a-z]+aceae)\s+([A-Z][a-z]+)\b/);
          if (laM) {
            rawFamily = laM[1];
            if (!rawGenus) rawGenus = laM[2];
          }
        }
      }
      const sci = typeof meta.scientific_name === "string" ? meta.scientific_name.trim() : "";
      if (!rawGenus && sci) {
        const first = sci.split(/\s+/)[0];
        if (first && /^[A-Z][a-z]+$/.test(first)) rawGenus = first;
      }
      const tagsArr = Array.isArray(meta.tags) ? meta.tags.map((t) => String(t).trim()).filter(Boolean) : [];
      const titleStr = typeof meta.title === "string" && meta.title.trim() ? meta.title.trim() : "";
      const slugStr = (typeof meta.slug === "string" && meta.slug.trim()) || sci;
      const cleanedSlug = slugStr ? slugify(slugStr) : "";
      updateItem(key, {
        slug: cleanedSlug && !cleanedSlug.startsWith("p-") ? cleanedSlug : "",
        scientificName: sci,
        commonNameEn: typeof meta.common_name_en === "string" ? meta.common_name_en.trim() : "",
        family: rawFamily,
        genus: rawGenus,
        habitat: typeof meta.habitat === "string" ? meta.habitat.trim() : "",
        summary: typeof meta.summary === "string" ? meta.summary.trim() : "",
        tags: tagsArr.join(", "),
        iucnStatus:
          typeof meta.iucn_status === "string" &&
          IUCN_CATEGORIES.some((c) => c.code === (meta.iucn_status as string).trim().toUpperCase())
            ? (meta.iucn_status as string).trim().toUpperCase()
            : "",
        extracting: false,
      });
      if (titleStr) updateItem(key, { title: titleStr });
      // Auto-populate cover with the first <img> from the uploaded HTML so the
      // editor can immediately edit/replace it instead of starting from "no file chosen".
      try {
        const first = await firstImageFromHtml(htmlUrl);
        if (first) updateItem(key, { coverUrl: first });
      } catch { /* non-fatal */ }
    } catch (err) {
      updateItem(key, { extracting: false });
      toast.error(`识别失败：${(err as Error).message}`);
    }
  };

  const removeItem = (key: string) => {
    setItems((prev) => prev.filter((it) => it.key !== key));
    editorRefs.current.delete(key);
  };

  const onSaveAllHtml = async () => {
    setSavingAll(true);
    let ok = 0;
    let fail = 0;
    for (const it of items) {
      const handle = editorRefs.current.get(it.key);
      if (!handle) continue;
      const r = await handle.save();
      if (r) ok++;
      else fail++;
    }
    setSavingAll(false);
    if (fail) toast.error(`完成 ${ok} 个，失败 ${fail} 个`);
    else toast.success(`已应用 ${ok} 个 HTML 修改`);
  };

  const firstImageFromHtml = async (url: string): Promise<string | null> => {
    try {
      const text = await fetch(url).then((r) => r.text());
      const doc = new DOMParser().parseFromString(text, "text/html");
      const img = doc.querySelector("img");
      const src = img?.getAttribute("src");
      if (!src) return null;
      try { return new URL(src, url).href; } catch { return src; }
    } catch { return null; }
  };

  const createOne = async (it: Item): Promise<{ ok: boolean; msg?: string }> => {
    if (!user) return { ok: false, msg: "未登录" };
    if (!it.title.trim()) return { ok: false, msg: `${it.fileName}: 缺少标题` };
    let cover = it.coverUrl;
    if (!cover) cover = (await firstImageFromHtml(it.htmlUrl)) ?? "";
    const payload = {
      title: it.title.trim(),
      slug: it.slug.trim() || slugify(it.title) || `p-${Date.now()}`,
      scientific_name: it.scientificName.trim() || null,
      common_name_en: it.commonNameEn.trim() || null,
      family: it.family.trim() || null,
      genus: it.genus.trim() || null,
      iucn_status: it.iucnStatus || null,
      habitat: it.habitat.trim() || null,
      summary: it.summary.trim() || null,
      cover_url: cover || null,
      content_type: "html" as const,
      rich_content: null,
      html_url: it.htmlUrl,
      tags: it.tags.split(",").map((t) => t.trim()).filter(Boolean),
      is_featured: false,
      author_id: user.id,
    };
    const { data, error } = await supabase.from("plants").insert(payload).select("id").single();
    if (error) return { ok: false, msg: `${it.title}: ${error.message}` };
    const newId = data?.id as string | undefined;
    if (newId) {
      const editorName =
        (user.user_metadata?.full_name as string | undefined) ||
        (user.user_metadata?.name as string | undefined) ||
        user.email ||
        "编辑者";
      await supabase.from("plant_edits").insert({
        plant_id: newId,
        editor_id: user.id,
        editor_name: editorName,
        kind: "create",
        marker_n: 0,
        source: "batch_upload",
        summary: `${editorName} 通过批量上传创建条目「${payload.title}」（HTML）`,
      });
      await supabase.from("plant_edits").insert({
        plant_id: newId,
        editor_id: user.id,
        editor_name: editorName,
        kind: "html_save",
        marker_n: 0,
        source: "batch_upload",
        summary: `${editorName} 批量上传并保存 HTML 文件「${it.fileName}」`,
      });
    }
    return { ok: true, msg: data?.id };
  };

  const onCreateAll = async () => {
    if (!items.length) return;
    setCreatingAll(true);
    let ok = 0;
    let fail = 0;
    for (const it of items) {
      if (it.createdId) { ok++; continue; }
      updateItem(it.key, { creating: true });
      const res = await createOne(it);
      updateItem(it.key, { creating: false, createdId: res.ok ? res.msg ?? null : null });
      if (res.ok) ok++;
      else {
        fail++;
        toast.error(res.msg || "创建失败");
      }
    }
    setCreatingAll(false);
    qc.invalidateQueries({ queryKey: ["my-plants"] });
    qc.invalidateQueries({ queryKey: ["plants"] });
    qc.invalidateQueries({ queryKey: ["home"] });
    if (!fail) {
      toast.success(`已创建 ${ok} 个条目`);
      navigate({ to: "/admin" });
    } else {
      toast.message(`成功 ${ok}，失败 ${fail}`);
    }
  };

  // Lock body scroll when fullscreen.
  useEffect(() => {
    if (!fullscreen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, [fullscreen]);

  return (
    <div className="min-h-screen flex flex-col">
      <SiteHeader />
      <main className="mx-auto max-w-6xl px-6 py-10 flex-1 w-full">
        <Link to="/admin" className="label hover:text-vermilion">← 返回</Link>
        <div className="border-b-2 border-ink pb-6 mb-8 mt-4 flex items-end justify-between flex-wrap gap-4">
          <div>
            <p className="label text-vermilion mb-2">Batch Entry</p>
            <h1 className="font-display text-4xl font-bold">批量添加条目</h1>
            <p className="text-ink-faint mt-2 text-sm">一次上传多个 HTML，AI 自动识别并分别填充字段。</p>
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              disabled={uploading}
              className="bg-ink text-background px-5 py-2 hover:bg-vermilion transition-colors disabled:opacity-60"
            >
              {uploading ? "上传中…" : "+ 选择 HTML 所在文件夹"}
            </button>
            <button
              type="button"
              onClick={() => htmlOnlyRef.current?.click()}
              disabled={uploading}
              className="border border-ink/40 px-5 py-2 hover:bg-paper-deep transition-colors disabled:opacity-60"
            >
              仅上传 HTML
            </button>
            <input
              ref={fileRef}
              type="file"
              multiple
              {...({ webkitdirectory: "", directory: "" } as React.InputHTMLAttributes<HTMLInputElement> & { webkitdirectory: string; directory: string })}
              className="sr-only"
              onChange={onPickFiles}
            />
            <input
              ref={htmlOnlyRef}
              type="file"
              accept=".html,.htm,text/html,image/*"
              multiple
              className="sr-only"
              onChange={onPickFiles}
            />
          </div>
        </div>

        {items.length === 0 ? (
          <div className="border border-dashed border-rule py-20 text-center text-ink-faint">
            <p className="mb-4">选择包含 HTML 与图片的文件夹开始批量录入；系统会按 HTML 中的相对路径自动上传配图并改写链接，不再弹出二次选图窗口。</p>
            <button
              onClick={() => fileRef.current?.click()}
              className="border border-ink px-4 py-2 hover:bg-ink hover:text-background transition-colors"
            >
              + 选择 HTML 所在文件夹
            </button>
          </div>
        ) : (
          <>
            <div className="flex justify-end mb-3">
              <button
                onClick={() => setFullscreen((v) => !v)}
                className="border border-ink/40 px-3 py-1 text-xs hover:bg-paper-deep"
              >
                {fullscreen ? "退出全屏（每行 1）" : "全屏视图（每行 4）"}
              </button>
            </div>
            <div
              className={
                fullscreen
                  ? "fixed inset-0 z-40 bg-background overflow-auto p-4"
                  : "space-y-6"
              }
            >
              {fullscreen && (
                <div className="flex items-center justify-between mb-3 sticky top-0 bg-background py-2 z-10 border-b border-rule">
                  <p className="font-display font-semibold">批量编辑（{items.length}）</p>
                  <div className="flex gap-2">
                    <BulkButtons
                      savingAll={savingAll}
                      creatingAll={creatingAll}
                      onSaveAll={onSaveAllHtml}
                      onCreateAll={onCreateAll}
                    />
                    <button
                      onClick={() => setFullscreen(false)}
                      className="border border-ink/40 px-3 py-1 text-xs hover:bg-paper-deep"
                    >
                      退出全屏
                    </button>
                  </div>
                </div>
              )}
              <div
                className={
                  fullscreen
                    ? "grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4"
                    : "space-y-6"
                }
              >
                {items.map((it) => (
                  <BatchCard
                    key={it.key}
                    item={it}
                    compact={fullscreen}
                    setEditorRef={(h) => editorRefs.current.set(it.key, h)}
                    onUpdate={(p) => updateItem(it.key, p)}
                    onRemove={() => removeItem(it.key)}
                    onReExtract={() => { updateItem(it.key, { extracting: true }); runExtract(it.key, it.htmlUrl); }}
                  />
                ))}
              </div>
            </div>

            {!fullscreen && (
              <div className="mt-10 flex flex-wrap items-center gap-3 border-t-2 border-ink pt-6">
                <BulkButtons
                  savingAll={savingAll}
                  creatingAll={creatingAll}
                  onSaveAll={onSaveAllHtml}
                  onCreateAll={onCreateAll}
                />
              </div>
            )}
          </>
        )}
      </main>
      <SiteFooter />
    </div>
  );
}

function BulkButtons({
  savingAll,
  creatingAll,
  onSaveAll,
  onCreateAll,
}: {
  savingAll: boolean;
  creatingAll: boolean;
  onSaveAll: () => void;
  onCreateAll: () => void;
}) {
  return (
    <>
      <button
        type="button"
        onClick={onSaveAll}
        disabled={savingAll}
        className="bg-emerald-600 text-white px-5 py-2 hover:bg-emerald-700 disabled:opacity-60 transition-colors"
      >
        {savingAll ? "保存中…" : "全部应用修改并替换 HTML"}
      </button>
      <button
        type="button"
        onClick={onCreateAll}
        disabled={creatingAll}
        className="bg-emerald-700 text-white px-5 py-2 hover:bg-emerald-800 disabled:opacity-60 transition-colors"
      >
        {creatingAll ? "创建中…" : "全部创建条目"}
      </button>
    </>
  );
}

function BatchCard({
  item,
  compact,
  setEditorRef,
  onUpdate,
  onRemove,
  onReExtract,
}: {
  item: Item;
  compact: boolean;
  setEditorRef: (h: HtmlDocEditorHandle | null) => void;
  onUpdate: (p: Partial<Item>) => void;
  onRemove: () => void;
  onReExtract: () => void;
}) {
  const inputCls =
    "w-full border border-ink px-2 py-1 bg-transparent text-xs focus:outline-none focus:border-vermilion";
  const { user } = useAuth();
  const fileRef = useRef<HTMLInputElement>(null);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const [pagePickerOpen, setPagePickerOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [pageImages, setPageImages] = useState<string[]>([]);

  useEffect(() => {
    if (!item.htmlUrl) { setPageImages([]); return; }
    let cancel = false;
    fetch(item.htmlUrl).then((r) => r.text()).then((text) => {
      if (cancel) return;
      const doc = new DOMParser().parseFromString(text, "text/html");
      const srcs: string[] = [];
      doc.querySelectorAll("img").forEach((img) => {
        const s = img.getAttribute("src");
        if (!s) return;
        try { srcs.push(new URL(s, item.htmlUrl).href); } catch { srcs.push(s); }
      });
      setPageImages(Array.from(new Set(srcs)));
    }).catch(() => setPageImages([]));
    return () => { cancel = true; };
  }, [item.htmlUrl]);

  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    window.addEventListener("click", close);
    return () => window.removeEventListener("click", close);
  }, [menu]);

  const uploadCoverLocal = async (file: File) => {
    if (!user) return toast.error("请先登录");
    const ext = file.name.split(".").pop() || "jpg";
    const path = `${user.id}/cover/${Date.now()}.${ext}`;
    const { error } = await supabase.storage.from("plant-images").upload(path, file, {
      cacheControl: "3600", upsert: false, contentType: file.type,
    });
    if (error) return toast.error(error.message);
    const url = supabase.storage.from("plant-images").getPublicUrl(path).data.publicUrl;
    onUpdate({ coverUrl: url });
    toast.success("封面已更新");
  };

  const pickFirstFromHtml = async () => {
    try {
      const text = await fetch(item.htmlUrl).then((r) => r.text());
      const doc = new DOMParser().parseFromString(text, "text/html");
      const img = doc.querySelector("img");
      const src = img?.getAttribute("src");
      if (!src) return toast.error("HTML 中未找到图片");
      let abs = src; try { abs = new URL(src, item.htmlUrl).href; } catch { /* keep raw */ }
      onUpdate({ coverUrl: abs });
      toast.success("已使用 HTML 中第一张图片");
    } catch {
      toast.error("无法读取 HTML");
    }
  };

  return (
    <section className={`border-2 ${item.createdId ? "border-emerald-600" : "border-ink"} bg-background p-3 flex flex-col gap-2`}>
      <header className="flex items-center justify-between text-xs">
        <span className="font-mono truncate" title={item.fileName}>{item.fileName}</span>
        <div className="flex items-center gap-2">
          {item.extracting && <span className="text-ink-faint">AI 识别中…</span>}
          {item.createdId && <span className="text-emerald-700">✓ 已创建</span>}
          <button onClick={onReExtract} className="hover:text-vermilion" disabled={item.extracting}>
            重新识别
          </button>
          <button onClick={onRemove} className="text-destructive hover:underline">移除</button>
        </div>
      </header>

      <div className="grid grid-cols-2 gap-2">
        <label className="col-span-2">
          <span className="label text-[10px]">标题 *</span>
          <input value={item.title} onChange={(e) => onUpdate({ title: e.target.value })} className={inputCls} />
        </label>
        <label className="col-span-2">
          <span className="label text-[10px]">学名</span>
          <input value={item.scientificName} onChange={(e) => onUpdate({ scientificName: e.target.value })} className={inputCls} />
        </label>
        <label>
          <span className="label text-[10px]">科 Family</span>
          <input value={item.family} onChange={(e) => onUpdate({ family: e.target.value })} className={inputCls} />
        </label>
        <label>
          <span className="label text-[10px]">属 Genus</span>
          <input value={item.genus} onChange={(e) => onUpdate({ genus: e.target.value })} className={inputCls} />
        </label>
        <label>
          <span className="label text-[10px]">英文俗名</span>
          <input value={item.commonNameEn} onChange={(e) => onUpdate({ commonNameEn: e.target.value })} className={inputCls} />
        </label>
        <label>
          <span className="label text-[10px]">IUCN</span>
          <select value={item.iucnStatus} onChange={(e) => onUpdate({ iucnStatus: e.target.value })} className={inputCls}>
            <option value="">未评估</option>
            {IUCN_CATEGORIES.map((c) => (
              <option key={c.code} value={c.code}>{c.code}</option>
            ))}
          </select>
        </label>
        <label className="col-span-2">
          <span className="label text-[10px]">物种入侵</span>
          <input value={item.habitat} onChange={(e) => onUpdate({ habitat: e.target.value })} className={inputCls} />
        </label>
        <label className="col-span-2">
          <span className="label text-[10px]">标签</span>
          <input value={item.tags} onChange={(e) => onUpdate({ tags: e.target.value })} className={inputCls} />
        </label>
        <label className="col-span-2">
          <span className="label text-[10px]">Slug</span>
          <input value={item.slug} onChange={(e) => onUpdate({ slug: e.target.value })} className={inputCls} placeholder="自动生成" />
        </label>
        <label className="col-span-2">
          <span className="label text-[10px]">摘要</span>
          <textarea value={item.summary} onChange={(e) => onUpdate({ summary: e.target.value })} rows={2} className={inputCls} />
        </label>
      </div>

      <div className="border border-rule p-2">
        <div className="flex items-start gap-3">
          <div
            className="w-28 h-28 shrink-0 border border-ink bg-paper-deep/30 flex items-center justify-center overflow-hidden cursor-context-menu"
            onContextMenu={(e) => { e.preventDefault(); setMenu({ x: e.clientX, y: e.clientY }); }}
            onClick={(e) => { e.preventDefault(); setMenu({ x: e.clientX, y: e.clientY }); }}
            title="右键 / 单击 选择封面图编辑方式"
          >
            {item.coverUrl ? (
              <img src={item.coverUrl} alt="封面" className="w-full h-full object-cover" />
            ) : (
              <span className="text-[10px] text-ink-faint text-center px-1">无封面<br/>点击设置</span>
            )}
          </div>
          <div className="flex-1 min-w-0">
            <p className="label text-[10px] mb-1">封面图</p>
            <p className="text-[10px] text-ink-faint mb-1 break-all line-clamp-2">
              {item.coverUrl || "未设置（创建条目时将自动取 HTML 第一张图）"}
            </p>
            <div className="flex flex-wrap gap-1 text-[10px]">
              <button type="button" onClick={() => fileRef.current?.click()} className="border border-ink/40 px-2 py-0.5 hover:bg-paper-deep inline-flex items-center gap-1"><FolderOpen className="w-3 h-3" />本地</button>
              <button type="button" onClick={() => {
                const u = window.prompt("封面图片网址：", item.coverUrl);
                if (u !== null) onUpdate({ coverUrl: u.trim() });
              }} className="border border-ink/40 px-2 py-0.5 hover:bg-paper-deep inline-flex items-center gap-1"><Link2 className="w-3 h-3" />网址</button>
              <button type="button" onClick={pickFirstFromHtml} className="border border-ink/40 px-2 py-0.5 hover:bg-paper-deep inline-flex items-center gap-1"><ImageIcon className="w-3 h-3" />第一张</button>
              <button type="button" disabled={pageImages.length === 0} onClick={() => setPagePickerOpen(true)} className="border border-ink/40 px-2 py-0.5 hover:bg-paper-deep disabled:opacity-50 inline-flex items-center gap-1"><ImageIcon className="w-3 h-3" />选页面图({pageImages.length})</button>
              <button type="button" onClick={() => setSearchOpen(true)} className="border border-ink/40 px-2 py-0.5 hover:bg-paper-deep inline-flex items-center gap-1"><Globe className="w-3 h-3" />在线搜索</button>
              {item.coverUrl && (
                <button type="button" onClick={() => onUpdate({ coverUrl: "" })} className="border border-destructive/40 text-destructive px-2 py-0.5 hover:bg-destructive hover:text-background">清除</button>
              )}
            </div>
          </div>
        </div>
        <input ref={fileRef} type="file" accept="image/*" className="sr-only" onChange={(e) => {
          const f = e.target.files?.[0]; e.target.value = "";
          if (f) uploadCoverLocal(f);
        }} />
        {menu && (
          <div
            onClick={(e) => e.stopPropagation()}
            style={{ position: "fixed", left: menu.x, top: menu.y, zIndex: 70 }}
            className="bg-background border border-ink shadow-lg py-1 w-56 text-sm"
          >
            <button type="button" onClick={() => { setMenu(null); fileRef.current?.click(); }} className="w-full text-left px-3 py-2 hover:bg-paper-deep inline-flex items-center gap-2"><FolderOpen className="w-4 h-4" />替换为本地图片</button>
            <button type="button" onClick={() => {
              setMenu(null);
              const u = window.prompt("封面图片网址：", item.coverUrl);
              if (u !== null) onUpdate({ coverUrl: u.trim() });
            }} className="w-full text-left px-3 py-2 hover:bg-paper-deep inline-flex items-center gap-2"><Link2 className="w-4 h-4" />替换为图片网址</button>
            <button type="button" onClick={() => { setMenu(null); pickFirstFromHtml(); }} className="w-full text-left px-3 py-2 hover:bg-paper-deep inline-flex items-center gap-2"><ImageIcon className="w-4 h-4" />使用 HTML 中第一张图</button>
            <button type="button" disabled={pageImages.length === 0} onClick={() => { setMenu(null); setPagePickerOpen(true); }} className="w-full text-left px-3 py-2 hover:bg-paper-deep disabled:opacity-50 inline-flex items-center gap-2"><ImageIcon className="w-4 h-4" />从页面图中选择（{pageImages.length}）</button>
            <button type="button" onClick={() => { setMenu(null); setSearchOpen(true); }} className="w-full text-left px-3 py-2 hover:bg-paper-deep inline-flex items-center gap-2"><Globe className="w-4 h-4" />在线搜索图片替换</button>
            {item.coverUrl && (
              <>
                <div className="border-t border-rule my-1" />
                <button type="button" onClick={() => { setMenu(null); onUpdate({ coverUrl: "" }); }} className="w-full text-left px-3 py-2 text-destructive hover:bg-paper-deep inline-flex items-center gap-2"><Trash2 className="w-4 h-4" />清除封面</button>
              </>
            )}
          </div>
        )}
        {pagePickerOpen && (
          <div className="fixed inset-0 z-[60] bg-black/60 flex items-center justify-center p-4" onClick={() => setPagePickerOpen(false)}>
            <div className="bg-background border border-ink shadow-xl w-full max-w-3xl max-h-[80vh] overflow-auto p-4" onClick={(e) => e.stopPropagation()}>
              <div className="flex items-center justify-between mb-3">
                <h3 className="label text-vermilion">从页面图中选择</h3>
                <button onClick={() => setPagePickerOpen(false)} className="text-xl leading-none text-ink-faint hover:text-ink">×</button>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
                {pageImages.map((src) => (
                  <button key={src} type="button" onClick={() => { setPagePickerOpen(false); onUpdate({ coverUrl: src }); }} className="border border-rule hover:border-ink bg-paper-deep/30">
                    <img src={src} alt="" loading="lazy" className="w-full h-32 object-contain bg-background" />
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}
        {searchOpen && (
          <ImageSearchDialog
            initialQuery={item.scientificName || item.title}
            onClose={() => setSearchOpen(false)}
            onPick={(url) => { setSearchOpen(false); onUpdate({ coverUrl: url }); }}
          />
        )}
      </div>

      <div className={compact ? "h-[320px] overflow-hidden" : ""}>
        <p className="label text-[10px] mt-2 mb-1">HTML 在线编辑</p>
        <div className={compact ? "scale-[0.7] origin-top-left w-[143%] h-[460px] overflow-hidden" : ""}>
          <HtmlDocEditor
            ref={setEditorRef}
            htmlUrl={item.htmlUrl}
            plantId={item.createdId}
            persistImmediately={false}
            onSaved={(newUrl) => onUpdate({ htmlUrl: newUrl })}
          />
        </div>
      </div>
    </section>
  );
}
