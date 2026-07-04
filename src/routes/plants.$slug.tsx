import { createFileRoute, Link, notFound, useNavigate } from "@tanstack/react-router";
import { compressImage } from "@/lib/image-compress";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { SiteHeader, SiteFooter } from "@/components/site-header";
import { XiaoPAgentPanel } from "@/components/draft-agent-panel";
import { askPlantAgentFn, applyPlantAgentEditFn } from "@/lib/identify-plant.functions";
import { userModelArg } from "@/lib/xiaop-user-model";
import { fetchPlantBySlug, fetchAuthor } from "@/lib/plants";
import { useAuth } from "@/hooks/use-auth";
import { fetchEditById, isCurrentUserAdmin, revertEdit, fetchEditsForPlant, type PlantEdit } from "@/lib/edits";
import { EditLogSection } from "@/components/edit-log-section";
import { PlantComments } from "@/components/plant-comments";
import { embedVideosInHtml } from "@/lib/embed";
import { ImageSearchDialog } from "@/components/html-doc-editor";
import { ReplaceImageFlow } from "@/components/replace-image-flow";
import { ShareButton } from "@/components/share-button";
import { supabase } from "@/integrations/supabase/client";
import { FolderOpen, Link2, Image as ImageIcon, Globe } from "lucide-react";

export const Route = createFileRoute("/plants/$slug")({
  loader: async ({ params }) => {
    return fetchPlantBySlug(params.slug);
  },
  head: ({ loaderData }) => ({
    meta: [
      { title: loaderData ? `${loaderData.title} (${loaderData.scientific_name || ""}) · Plantspedia` : "Plantspedia · 全民植物志" },
      { name: "description", content: loaderData?.summary || "查看该植物的详细特征、分布与科普信息。" },
      { property: "og:image", content: loaderData?.cover_url || "/default-og-image.jpg" },
      { property: "og:type", content: "article" },
    ],
  }),
  component: PlantDetail,
});

function PlantDetail() {
  const { slug } = Route.useParams();
  const { user } = useAuth();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const loaderData = Route.useLoaderData();
  const { data: plant, isLoading } = useQuery({
    queryKey: ["plant", slug],
    queryFn: () => fetchPlantBySlug(slug),
    initialData: loaderData,
  });
  const { data: isAdmin = false } = useQuery({
    queryKey: ["is-admin", user?.id],
    queryFn: () => isCurrentUserAdmin(user?.id),
    enabled: !!user,
  });
  const [editMenu, setEditMenu] = useState<{ x: number; y: number; editId: string } | null>(null);
  const [coverMenu, setCoverMenu] = useState<{ x: number; y: number } | null>(null);
  const [coverSearch, setCoverSearch] = useState(false);
  const [coverPagePicker, setCoverPagePicker] = useState(false);
  const [pageImages, setPageImages] = useState<string[]>([]);
  const [pageSections, setPageSections] = useState<{ label: string; value: string }[]>([]);
  // 小P蛙 image-replace: holds the search query + the edit instruction while the
  // online image-search dialog is open; on pick we rewrite that <img> and save.
  const [xiaopImg, setXiaopImg] = useState<{ query: string; instruction: string } | null>(null);
  const [revertingId, setRevertingId] = useState<string | null>(null);
  const coverFileRef = (typeof window !== "undefined" ? { current: null as HTMLInputElement | null } : { current: null });
  const askPlantAgent = useServerFn(askPlantAgentFn);
  const applyPlantAgent = useServerFn(applyPlantAgentEditFn);

  const { data: author } = useQuery({
    queryKey: ["author", plant?.author_id],
    queryFn: () => fetchAuthor(plant!.author_id),
    enabled: !!plant?.author_id,
  });

  const { data: plantEdits = [] } = useQuery({
    queryKey: ["plant-edits", plant?.id],
    queryFn: () => fetchEditsForPlant(plant!.id),
    enabled: !!plant?.id,
  });

  // Fetch HTML content for srcdoc rendering (so relative refs / fonts work without host CORS issues)
  const [htmlDoc, setHtmlDoc] = useState<string | null>(null);
  useEffect(() => {
    if (plant?.content_type === "html" && plant.html_url) {
      fetch(plant.html_url)
        .then((r) => r.text())
        .then((text) => {
          // Inject responsive-image CSS so original fixed-width <img> tags scale to viewport.
          const css = `<style>img,video,iframe{max-width:100%!important;height:auto!important;}body{overflow-x:hidden;}</style>`;
          // Forward right-click on edit markers to the parent page.
          const script = `<script>document.addEventListener('contextmenu',function(e){var t=e.target;var m=t&&t.closest&&t.closest('.lov-edit-mark');if(!m)return;e.preventDefault();var id=m.getAttribute('data-edit-id');if(!id)return;var r=m.getBoundingClientRect();parent.postMessage({type:'lov-edit-mark-ctx',editId:id,x:r.left+r.width,y:r.top+r.height},'*');});</script>`;
          const inject = css + script;
          // Embed video URLs inside the editor-comments section.
          let processed = text;
          try {
            const parsed = new DOMParser().parseFromString(text, "text/html");
            const ec = parsed.body?.querySelector("section.editor-comments [data-comments-body]");
            if (ec) {
              ec.innerHTML = embedVideosInHtml(ec.innerHTML);
              processed = "<!DOCTYPE html>\n" + parsed.documentElement.outerHTML;
            }
          } catch {/* fall through */}
          const injected = /<\/head>/i.test(processed)
            ? processed.replace(/<\/head>/i, `${inject}</head>`)
            : `${inject}${processed}`;
          setHtmlDoc(injected);
        })
        .catch(() => setHtmlDoc(null));
    }
  }, [plant?.html_url, plant?.content_type]);

  // Collect images + section headings from the HTML page (cover picker + 小P蛙标注范围).
  const [rawHtml, setRawHtml] = useState<string | null>(null);
  useEffect(() => {
    if (!plant?.html_url) { setPageImages([]); setPageSections([]); setRawHtml(null); return; }
    fetch(plant.html_url).then((r) => r.text()).then((text) => {
      setRawHtml(text);
      const doc = new DOMParser().parseFromString(text, "text/html");
      const srcs: string[] = [];
      doc.querySelectorAll("img").forEach((img) => {
        const s = img.getAttribute("src");
        if (!s) return;
        try { srcs.push(new URL(s, plant.html_url!).href); } catch { srcs.push(s); }
      });
      setPageImages(Array.from(new Set(srcs)));
      const secs: { label: string; value: string }[] = [];
      const seen = new Set<string>();
      doc.querySelectorAll("h1, h2, h3").forEach((h) => {
        const t = (h.textContent || "").replace(/\s+/g, " ").trim();
        if (t && t.length <= 40 && !seen.has(t)) { seen.add(t); secs.push({ label: t, value: t }); }
      });
      setPageSections(secs.slice(0, 20));
    }).catch(() => { setPageImages([]); setPageSections([]); });
  }, [plant?.html_url]);

  useEffect(() => {
    if (!coverMenu) return;
    const close = () => setCoverMenu(null);
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") close(); };
    window.addEventListener("click", close);
    window.addEventListener("keydown", onKey);
    return () => { window.removeEventListener("click", close); window.removeEventListener("keydown", onKey); };
  }, [coverMenu]);

  const updateCover = async (url: string) => {
    if (!plant) return;
    const { error } = await supabase.from("plants").update({ cover_url: url }).eq("id", plant.id);
    if (error) return toast.error(error.message);
    toast.success("封面已更新");
    qc.invalidateQueries({ queryKey: ["plant", plant.slug] });
    qc.invalidateQueries({ queryKey: ["home"] });
    qc.invalidateQueries({ queryKey: ["plants"] });
  };

  const onCoverLocal = async (file: File) => {
    if (!user) return toast.error("请先登录");

    let fileToUpload: Blob | File = file;
    try {
      fileToUpload = await compressImage(file);
    } catch (err) {
      console.error("Image compression failed, using original:", err);
    }

    const ext = file.name.split(".").pop() || "jpg";
    const path = `${user.id}/cover/${Date.now()}.${ext}`;
    const { error } = await supabase.storage.from("plant-images").upload(path, fileToUpload, {
      cacheControl: "3600", upsert: false, contentType: file.type,
    });
    if (error) return toast.error(error.message);
    await updateCover(supabase.storage.from("plant-images").getPublicUrl(path).data.publicUrl);
  };

  // Listen for postMessage from the iframe when an edit marker is right-clicked.
  useEffect(() => {
    const onMsg = (e: MessageEvent) => {
      const d = e.data;
      if (!d || d.type !== "lov-edit-mark-ctx" || typeof d.editId !== "string") return;
      // Iframe sits below page chrome (~120px header bar); offset to parent coords.
      const iframe = document.querySelector("iframe[title]") as HTMLIFrameElement | null;
      const rect = iframe?.getBoundingClientRect();
      setEditMenu({
        x: (rect?.left ?? 0) + (typeof d.x === "number" ? d.x : 0),
        y: (rect?.top ?? 0) + (typeof d.y === "number" ? d.y : 0),
        editId: d.editId,
      });
    };
    window.addEventListener("message", onMsg);
    const close = () => setEditMenu(null);
    window.addEventListener("click", close);
    return () => {
      window.removeEventListener("message", onMsg);
      window.removeEventListener("click", close);
    };
  }, []);

  // 小P蛙: ask about this published page.
  const askXiaoP = async (
    question: string,
    history: { role: "assistant" | "user"; text: string }[],
    scope?: string,
  ) => {
    if (!plant) throw new Error("页面未加载");
    return (await askPlantAgent({
      data: { plantId: plant.id, question, scope, history, userModel: userModelArg() },
    })) as { reply: string; canEdit: boolean; editInstruction: string };
  };

  // Persist a new page HTML: upload to the plant-html bucket, repoint the plant,
  // and write a DETAILED plant_edits record so the change is auditable/revertible.
  const persistPlantHtml = async (html: string, oldHtml: string, summary: string) => {
    if (!plant || !user) throw new Error("请先登录");
    const bucket = "plant-html";
    const path = `${user.id}/xiaop-${Date.now()}.html`;
    const blob = new Blob([html], { type: "text/html" });
    const { error: upErr } = await supabase.storage
      .from(bucket)
      .upload(path, blob, { cacheControl: "3600", upsert: false, contentType: "text/html" });
    if (upErr) throw upErr;
    const newUrl = supabase.storage.from(bucket).getPublicUrl(path).data.publicUrl;

    const { error: updErr } = await supabase.from("plants").update({ html_url: newUrl }).eq("id", plant.id);
    if (updErr) throw updErr;

    let editorName = "编辑";
    try {
      const { data: prof } = await supabase
        .from("profiles")
        .select("display_name")
        .eq("id", user.id)
        .maybeSingle();
      if (prof?.display_name) editorName = prof.display_name;
    } catch { /* fall back to 编辑 */ }

    await supabase.from("plant_edits").insert({
      plant_id: plant.id,
      editor_id: user.id,
      editor_name: editorName,
      kind: "ai_page_edit",
      marker_n: 0,
      source: "xiaop_agent",
      summary: summary.slice(0, 500),
      before_html: oldHtml,
      after_html: html,
    });

    qc.invalidateQueries({ queryKey: ["plant", slug] });
    qc.invalidateQueries({ queryKey: ["plant-edits"] });
    qc.invalidateQueries({ queryKey: ["plants"] });
    qc.invalidateQueries({ queryKey: ["home"] });
  };

  // 小P蛙: apply an agreed TEXT edit — rewrite HTML (server LLM), then persist.
  const applyXiaoP = async (instruction: string, scope?: string) => {
    if (!plant || !user) throw new Error("请先登录");
    const { html, oldHtml } = (await applyPlantAgent({
      data: { plantId: plant.id, instruction, scope, userModel: userModelArg() },
    })) as { html: string; oldHtml: string };
    await persistPlantHtml(html, oldHtml, `小P蛙改写${scope ? `（${scope}）` : "（整页）"}：${instruction}`);
  };

  // Revert one change from the bottom log. 小P蛙 full-page rewrites (ai_page_edit)
  // store a full before_html snapshot → restore it as a new file + repoint. Other
  // (block-marker) edits go through the existing revertEdit machinery.
  const onRevertPlantEdit = async (edit: PlantEdit) => {
    if (!plant || !user) return;
    if (!confirm("确定撤销这条修改吗？")) return;
    setRevertingId(edit.id);
    try {
      if (edit.kind === "ai_page_edit" && edit.before_html) {
        const bucket = "plant-html";
        const path = `${user.id}/revert-${Date.now()}.html`;
        const blob = new Blob([edit.before_html], { type: "text/html" });
        const { error: upErr } = await supabase.storage
          .from(bucket)
          .upload(path, blob, { cacheControl: "3600", upsert: false, contentType: "text/html" });
        if (upErr) throw upErr;
        const newUrl = supabase.storage.from(bucket).getPublicUrl(path).data.publicUrl;
        const { error: updErr } = await supabase.from("plants").update({ html_url: newUrl }).eq("id", plant.id);
        if (updErr) throw updErr;
        await supabase
          .from("plant_edits")
          .update({ reverted: true, reverted_by: user.id, reverted_at: new Date().toISOString() })
          .eq("id", edit.id);
      } else {
        await revertEdit(edit, user.id);
      }
      toast.success("已撤销该修改");
      qc.invalidateQueries({ queryKey: ["plant", slug] });
      qc.invalidateQueries({ queryKey: ["plant-edits", plant.id] });
      navigate({ to: "/plants/$slug", params: { slug: plant.slug } });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "撤销失败");
    } finally {
      setRevertingId(null);
    }
  };

  const onRevertFromMenu = async () => {
    if (!editMenu || !user) return;
    const editId = editMenu.editId;
    setEditMenu(null);
    try {
      const edit = await fetchEditById(editId);
      if (!edit) return toast.error("找不到该修改记录");
      if (!confirm(`确定撤销该修改？\n编辑者：${edit.editor_name ?? "—"}\n时间：${new Date(edit.created_at).toLocaleString("zh-CN")}`)) return;
      const res = await revertEdit(edit, user.id);
      toast.success("已撤销该修改");
      qc.invalidateQueries({ queryKey: ["plant", res.slug] });
      qc.invalidateQueries({ queryKey: ["plant-edits"] });
      // Force iframe reload by navigating to the same slug
      navigate({ to: "/plants/$slug", params: { slug: res.slug } });
    } catch (err) {
      toast.error("撤销失败：" + (err as Error).message);
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen flex flex-col">
        <SiteHeader />
        <main className="mx-auto max-w-3xl px-6 py-20 flex-1 text-ink-faint">载入中…</main>
        <SiteFooter />
      </div>
    );
  }
  if (!plant) throw notFound();

  const canEdit = !!user && (
    user.id === plant.author_id ||
    isAdmin ||
    (plant.co_author_ids ?? []).includes(user.id)
  );

  const attributionFooter = (
    <div className="mt-10 pt-6 border-t border-rule text-xs text-ink-faint">
      <p>
        创建者：<span className="text-ink">{author?.display_name ?? "佚名"}</span>
        {plant.co_author_names && plant.co_author_names.length > 0 && (
          <>
            {" · "}共建者：
            <span className="text-ink">{plant.co_author_names.join("，")}</span>
          </>
        )}
      </p>
    </div>
  );

  const renderCoverMenu = () => (
    <>
      <input
        ref={(el) => { coverFileRef.current = el; }}
        type="file"
        accept="image/*"
        className="sr-only"
        onChange={(e) => {
          const f = e.target.files?.[0]; e.target.value = "";
          if (f) onCoverLocal(f);
        }}
      />
      {coverMenu && canEdit && (
        <div
          onClick={(e) => e.stopPropagation()}
          style={{ position: "fixed", left: coverMenu.x, top: coverMenu.y, zIndex: 70 }}
          className="bg-background border border-ink shadow-lg py-1 w-56 text-sm"
        >
          <button type="button" onClick={() => { setCoverMenu(null); coverFileRef.current?.click(); }} className="w-full text-left px-3 py-2 hover:bg-paper-deep inline-flex items-center gap-2"><FolderOpen className="w-4 h-4" />替换为本地图片</button>
          <button type="button" onClick={() => {
            const url = window.prompt("封面图片网址：", plant.cover_url ?? "");
            setCoverMenu(null);
            if (url !== null && url.trim()) updateCover(url.trim());
          }} className="w-full text-left px-3 py-2 hover:bg-paper-deep inline-flex items-center gap-2"><Link2 className="w-4 h-4" />替换为图片网址</button>
          <button type="button" onClick={() => { setCoverMenu(null); setCoverPagePicker(true); }} disabled={pageImages.length === 0} className="w-full text-left px-3 py-2 hover:bg-paper-deep disabled:opacity-50 inline-flex items-center gap-2"><ImageIcon className="w-4 h-4" />选择详情页中已有图片（{pageImages.length}）</button>
          <button type="button" onClick={() => { setCoverMenu(null); setCoverSearch(true); }} className="w-full text-left px-3 py-2 hover:bg-paper-deep inline-flex items-center gap-2"><Globe className="w-4 h-4" />在线搜索替换图片</button>
        </div>
      )}
      {coverSearch && (
        <ImageSearchDialog
          initialQuery={plant.scientific_name || plant.common_name_en || plant.title}
          onClose={() => setCoverSearch(false)}
          onPick={(url) => { setCoverSearch(false); updateCover(url); }}
        />
      )}
      {coverPagePicker && (
        <div className="fixed inset-0 z-[60] bg-black/60 flex items-center justify-center p-4" onClick={() => setCoverPagePicker(false)}>
          <div className="bg-background border border-ink shadow-xl w-full max-w-3xl max-h-[80vh] overflow-auto p-4" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-3">
              <h3 className="label text-vermilion">从详情页已有图片中选择</h3>
              <button onClick={() => setCoverPagePicker(false)} className="text-xl leading-none text-ink-faint hover:text-ink">×</button>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
              {pageImages.map((src) => (
                <button key={src} type="button" onClick={() => { setCoverPagePicker(false); updateCover(src); }} className="border border-rule hover:border-ink bg-paper-deep/30">
                  <img src={src} alt="" loading="lazy" className="w-full h-32 object-contain bg-background" />
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </>
  );

  if (plant.content_type === "html") {
    return (
      <div className="min-h-screen flex flex-col">
        <SiteHeader />
        <div className="border-b border-ink/30 bg-paper-deep/40">
          <div className="mx-auto max-w-6xl px-6 py-3 flex items-center justify-between text-sm">
            <Link to="/" className="label hover:text-vermilion">← 返回首页</Link>
            <p className="label">{plant.scientific_name || plant.title}</p>
            <div className="flex items-center gap-2">
              <ShareButton title={plant.title} summary={plant.summary} />
              {canEdit && (
                <Link to="/admin/edit/$id" params={{ id: plant.id }} className="label hover:text-vermilion">编辑 →</Link>
              )}
            </div>
          </div>
        </div>
        <main className="flex-1">
          {htmlDoc ? (
            <iframe
              title={plant.title}
              srcDoc={htmlDoc}
              sandbox="allow-same-origin allow-popups"
              className="w-full"
              style={{ height: "calc(100vh - 120px)" }}
            />
          ) : plant.html_url ? (
            <iframe
              title={plant.title}
              src={plant.html_url}
              sandbox="allow-same-origin allow-popups"
              className="w-full"
              style={{ height: "calc(100vh - 120px)" }}
            />
          ) : (
            <p className="p-10 text-center text-ink-faint">未提供 HTML 文件。</p>
          )}
        </main>
        <div className="mx-auto max-w-3xl px-6 w-full">
          {plant.cover_url && (
            <figure
              className="mt-6 border border-rule cursor-context-menu"
              onContextMenu={(e) => {
                if (!canEdit) return;
                e.preventDefault();
                setCoverMenu({ x: e.clientX, y: e.clientY });
              }}
            >
              <img src={plant.cover_url} alt={plant.title} className="w-full" />
              {canEdit && (
                <figcaption className="px-2 py-1 text-[10px] text-ink-faint">右键封面图可编辑</figcaption>
              )}
            </figure>
          )}
          {attributionFooter}
          <EditLogSection
            edits={plantEdits}
            isEditor={canEdit}
            reverting={revertingId}
            onRevert={onRevertPlantEdit}
          />
          <PlantComments plantId={plant.id} />
        </div>
        {renderCoverMenu()}
        {/* 小P蛙 — 编辑登录后可对该已发布页提问并改写（标注范围或整页），保存上线并记入修改记录 */}
        {canEdit && (
          <XiaoPAgentPanel
            storageKey={`plant:${plant.id}`}
            greetingTitle={plant.title}
            canApply={true}
            scopes={pageSections}
            ask={askXiaoP}
            apply={applyXiaoP}
            onImageReplace={(query, instruction) =>
              setXiaopImg({ query: query || plant.scientific_name || plant.title, instruction })
            }
          />
        )}
        {xiaopImg && rawHtml && (
          <ReplaceImageFlow
            html={rawHtml}
            initialQuery={xiaopImg.query}
            uploadPathPrefix={`plants/xiaop/${plant.id}`}
            onClose={() => setXiaopImg(null)}
            onDone={async (newHtml, oldUrl, newUrl) => {
              const ctx = xiaopImg;
              setXiaopImg(null);
              try {
                await persistPlantHtml(
                  newHtml,
                  rawHtml,
                  `小P蛙换图（${ctx?.instruction || "手动"}）：${oldUrl} → ${newUrl}`,
                );
                toast.success("配图已替换并保存");
                navigate({ to: "/plants/$slug", params: { slug: plant.slug } });
              } catch (e) {
                toast.error(e instanceof Error ? e.message : "替换失败，请重试");
              }
            }}
          />
        )}
        {editMenu && isAdmin && (
          <div
            onClick={(e) => e.stopPropagation()}
            style={{ position: "fixed", left: editMenu.x, top: editMenu.y, zIndex: 60 }}
            className="bg-background border border-ink shadow-lg py-1 w-48 text-sm"
          >
            <div className="px-3 py-1.5 text-[10px] uppercase tracking-wider text-ink-faint border-b border-rule">
              修改记录
            </div>
            <button
              type="button"
              onClick={onRevertFromMenu}
              className="w-full text-left px-3 py-2 text-destructive hover:bg-paper-deep"
            >
              ↶ 撤销此修改
            </button>
            <Link
              to="/edits"
              className="block px-3 py-2 hover:bg-paper-deep"
              onClick={() => setEditMenu(null)}
            >
              📑 查看完整修改记录
            </Link>
          </div>
        )}
        {editMenu && !isAdmin && (
          <div
            onClick={(e) => e.stopPropagation()}
            style={{ position: "fixed", left: editMenu.x, top: editMenu.y, zIndex: 60 }}
            className="bg-background border border-ink shadow-lg py-2 px-3 text-xs text-ink-faint w-56"
          >
            仅管理员可撤销修改。<br />
            <Link to="/edits" className="text-vermilion hover:underline" onClick={() => setEditMenu(null)}>
              查看完整修改记录 →
            </Link>
          </div>
        )}
        <SiteFooter />
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col">
      <SiteHeader />
      <main className="mx-auto max-w-3xl px-6 py-12 flex-1 w-full">
        <div className="flex items-center justify-between">
          <Link to="/" className="label hover:text-vermilion">← 返回首页</Link>
          <ShareButton title={plant.title} summary={plant.summary} />
        </div>
        <article className="mt-6">
          <header className="border-b border-ink pb-6 mb-8">
            <p className="label text-vermilion mb-2">Specimen Entry</p>
            <h1 className="font-display text-5xl md:text-6xl font-bold leading-tight">{plant.title}</h1>
            {plant.scientific_name && <p className="italic text-ink-faint mt-3 text-xl font-serif">{plant.scientific_name}</p>}
            <dl className="mt-6 grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm">
              {plant.family && <Meta label="科属" value={plant.family} />}
              {plant.habitat && <Meta label="生境" value={plant.habitat} />}
              <Meta label="编纂者" value={author?.display_name ?? "佚名"} />
              <Meta label="更新" value={new Date(plant.updated_at).toLocaleDateString("zh-CN")} />
            </dl>
            {canEdit && (
              <div className="mt-5">
                <Link to="/admin/edit/$id" params={{ id: plant.id }} className="text-sm border border-ink/40 px-3 py-1 hover:bg-ink hover:text-background transition-colors">编辑此条</Link>
              </div>
            )}
          </header>

          {plant.cover_url && (
            <figure className="mb-8 border border-rule">
              <img
                src={plant.cover_url}
                alt={plant.title}
                className="w-full cursor-context-menu"
                onContextMenu={(e) => {
                  if (!canEdit) return;
                  e.preventDefault();
                  setCoverMenu({ x: e.clientX, y: e.clientY });
                }}
              />
            </figure>
          )}

          {plant.summary && (
            <p className="text-xl font-display italic text-ink-soft mb-8 border-l-2 border-vermilion pl-5">{plant.summary}</p>
          )}

          {plant.rich_content ? (
            <div
              className="prose-plant"
              // user-authored content; kept raw to support inline styles. For multi-author wikis you may want to sanitize.
              dangerouslySetInnerHTML={{ __html: embedVideosInHtml(renderContent(plant.rich_content)) }}
            />
          ) : (
            <p className="text-ink-faint">（暂无正文）</p>
          )}

          {plant.tags?.length > 0 && (
            <div className="mt-10 pt-6 border-t border-rule flex flex-wrap gap-2">
              {plant.tags.map((t) => (
                <span key={t} className="label border border-rule px-2 py-1">{t}</span>
              ))}
            </div>
          )}
          {attributionFooter}
          <EditLogSection
            edits={plantEdits}
            isEditor={canEdit}
            reverting={revertingId}
            onRevert={onRevertPlantEdit}
          />
        </article>
        <PlantComments plantId={plant.id} />
        {renderCoverMenu()}
      </main>
      <SiteFooter />
      <style>{`
        .prose-plant { font-size: 17px; line-height: 1.85; color: var(--ink); }
        .prose-plant p { margin: 0 0 1.1em; }
        .prose-plant h2 { font-family: var(--font-display); font-size: 2rem; margin: 2em 0 0.6em; font-weight: 600; }
        .prose-plant h3 { font-family: var(--font-display); font-size: 1.4rem; margin: 1.6em 0 0.5em; font-weight: 600; }
        .prose-plant img { max-width: 100%; margin: 1.5em 0; border: 1px solid var(--rule); }
        .prose-plant ul, .prose-plant ol { margin: 0 0 1.1em 1.4em; }
        .prose-plant blockquote { border-left: 3px solid var(--vermilion); padding-left: 1em; margin: 1.2em 0; color: var(--ink-soft); font-style: italic; }
        .prose-plant a { color: var(--vermilion); text-decoration: underline; }
      `}</style>
    </div>
  );
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="label text-ink-faint">{label}</dt>
      <dd className="mt-1">{value}</dd>
    </div>
  );
}

// Convert simple line-broken text to paragraphs if no HTML tags; otherwise pass through.
function renderContent(input: string): string {
  if (/<[a-z][\s\S]*>/i.test(input)) return input;
  return input
    .split(/\n{2,}/)
    .map((para) => `<p>${para.replace(/\n/g, "<br/>")}</p>`)
    .join("");
}
