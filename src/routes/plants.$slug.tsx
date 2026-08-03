import { createFileRoute, Link, notFound, useNavigate } from "@tanstack/react-router";
import { compressImage, extForMime } from "@/lib/image-compress";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { SiteHeader, SiteFooter } from "@/components/site-header";
import { XiaoPAgentPanel } from "@/components/draft-agent-panel";
import { askPlantAgentFn, applyPlantAgentEditFn } from "@/lib/identify-plant.functions";
import { userModelArg } from "@/lib/xiaop-user-model";
import { fetchPlantBySlug, fetchAuthor, plantEntryKind } from "@/lib/plants";
import { fetchPlantSourceKinds } from "@/lib/drafts";
import { PlantKindBadge } from "@/components/plant-kind-badge";
import { useAuth } from "@/hooks/use-auth";
import { fetchEditById, isCurrentUserAdmin, revertEdit, fetchEditsForPlant, fetchOriginProvenance, fetchPlantProvenance, type PlantEdit } from "@/lib/edits";
import { detectFieldConflicts } from "@/lib/field-conflicts";
import { FieldConflictsPanel } from "@/components/field-conflicts-panel";
import { EditLogSection } from "@/components/edit-log-section";
import { PlantComments } from "@/components/plant-comments";
import { embedVideosInHtml } from "@/lib/embed";
import { rewriteDraftOnlyHints } from "@/lib/draft-enhance";
import {
  SpeciesExistingLinks,
  useSpeciesExistingForPlant,
} from "@/components/species-existing-links";
import { ImageSearchDialog } from "@/components/html-doc-editor";
import { ReplaceImageFlow } from "@/components/replace-image-flow";
import { ShareButton } from "@/components/share-button";
import { ShareCardButton } from "@/components/share-card-button";
import { RegistryChips } from "@/components/registry-chips";
import { NameAuthorityNote, readNameStamp } from "@/components/name-authority-badge";
import { useRegistryChips } from "@/lib/use-registry-chips";
import { supabase } from "@/integrations/supabase/client";
import { FolderOpen, Link2, Image as ImageIcon, Globe } from "lucide-react";

export const Route = createFileRoute("/plants/$slug")({
  loader: async ({ params }) => {
    return fetchPlantBySlug(params.slug);
  },
  head: ({ loaderData }) => {
    // 分享卡：标题「Plantspedia草木志·中文名」、简介用该植物的 summary、缩略图用它的封面照片。
    // ⚠️ 必须**显式**写 og:title / og:description / twitter:* —— 只写 `title`/`description` 的话，
    //    og:title、og:description 会**继承 __root.tsx 的站点默认**（"Plantspedia·全民植物志 /
    //    由社区共同编纂…"），微信/Twitter 等抓的正是 og:*，于是分享出去永远是那句固定文案
    //    （用户 2026-07-25 反馈）。
    const name = loaderData?.title || "";
    const shareTitle = name ? `Plantspedia草木志·${name}` : "Plantspedia · 全民植物志";
    const desc = (loaderData?.summary || "查看该植物的详细特征、分布与科普信息。").slice(0, 180);
    const img = loaderData?.cover_url || "/default-og-image.jpg";
    return {
      meta: [
        { title: shareTitle },
        { name: "description", content: desc },
        { property: "og:title", content: shareTitle },
        { property: "og:description", content: desc },
        { property: "og:image", content: img },
        { property: "og:type", content: "article" },
        { name: "twitter:card", content: "summary_large_image" },
        { name: "twitter:title", content: shareTitle },
        { name: "twitter:description", content: desc },
        { name: "twitter:image", content: img },
      ],
    };
  },
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
  // 「注 N」被点击时，要在页尾「修改记录」里定位到对应那条并高亮。
  const [focusedNoteId, setFocusedNoteId] = useState<string | null>(null);
  const coverFileRef = (typeof window !== "undefined" ? { current: null as HTMLInputElement | null } : { current: null });
  // ResizeObserver 观察 iframe 内容高度变化以自适应外层 iframe 高度。
  const roRef = useRef<ResizeObserver | null>(null);
  useEffect(() => () => roRef.current?.disconnect(), []);
  /** 已经接好点击/量高监听的那份 iframe document —— 防止一次 load 接一遍、重复挂监听。 */
  const wiredDocRef = useRef<Document | null>(null);
  /** 上一次真正写回 iframe 的高度。差 ≤1px 就不再写，掐掉回授循环。换文档时归零。 */
  const lastSizedRef = useRef(0);
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

  // 重点保护 / CITES / GTS / GRIIS / 地区名录 / tag 卡签（与草稿页、分享卡同源）。
  const registryChipList = useRegistryChips({
    scientific_name: plant?.scientific_name,
    family: plant?.family,
    tags: plant?.tags,
    // 已发布条目的主题标签在 `plant_tags` 关联表里（编辑器写的是那张表），
    // 不在 `plants.tags` —— 不传 plantId 的话手动挂的标签一个都不会出现在卡签里。
    plantId: plant?.id,
  });

  // 本条目属于三类里的哪一类（🟢快速识别 / 🔵银叶科普 / 🟠skill 详页）。判据是来源草稿，
  // 见 lib/plants.ts `plantEntryKind`；查的是全表小索引（当前 25 行），与档案列表共用缓存。
  const { data: sourceKinds } = useQuery({
    queryKey: ["plant-source-kinds"],
    queryFn: fetchPlantSourceKinds,
  });
  const entryKind = plant ? plantEntryKind(plant, sourceKinds) : null;

  // 同物种在站内的其它成品（银叶「进一步科普页」/ 金叶详页），本页自己排除在外。
  const { data: speciesExisting } = useSpeciesExistingForPlant(
    plant?.scientific_name,
    plant?.slug ?? "",
  );

  // 溯源表头：「AI 识别条目」显示「最早识别人/地点/时间」，从最早那条来源草稿回溯。
  // 注意：采纳流程当前不写 source（留 null）、content_type 为 html，故无法靠字段区分
  // AI识别 vs skill 上传——唯一可靠信号是「是否存在来源草稿」。对所有条目都查（有索引，
  // 无草稿的 skill 上传返回 null 即不显示）。
  const { data: originProv } = useQuery({
    queryKey: ["plant-origin", plant?.id],
    queryFn: () => fetchOriginProvenance(plant!.id),
    enabled: !!plant?.id,
  });

  // 来源草稿一次查回来：页尾的分角色贡献表 + 矛盾红框都用它，见 lib/edits.ts。
  const { data: provenance } = useQuery({
    queryKey: ["plant-provenance", plant?.id],
    queryFn: () => fetchPlantProvenance(plant!.id),
    enabled: !!plant?.id,
  });
  const contributors = provenance?.contributors ?? [];
  // 合并后互相打架的结构化字段。纯前端比对，不花 token，见 lib/field-conflicts.ts。
  const fieldConflicts = useMemo(
    () => (plant && provenance ? detectFieldConflicts(plant, provenance.sources) : []),
    [plant, provenance],
  );

  // Fetch HTML content for srcdoc rendering (so relative refs / fonts work without host CORS issues)
  const [htmlDoc, setHtmlDoc] = useState<string | null>(null);
  useEffect(() => {
    if (plant?.content_type === "html" && plant.html_url) {
      fetch(plant.html_url)
        .then((r) => r.text())
        .then((text) => {
          // Inject responsive-image CSS so original fixed-width <img> tags scale to viewport.
          const css = `<style>img,video,iframe{max-width:100%!important;height:auto!important;}body{overflow-x:hidden;}` +
            // 🔴 iframe 自适应高度的**前提条件**（与草稿预览同一条，见 draft-enhance.ts 的
            // VIEWER_STYLE）：模板给 body 写了 min-height:100vh —— 独立成页时是对的，但在
            // iframe 里 100vh = 父层刚按上一次量到的值设好的 iframe 高度，于是 body 至少这么高，
            // 再加 margin 量回去就又高一点，ResizeObserver 持续触发、永不收敛。
            // 假连翘条目页实测：正文只有 7338px，iframe 却涨到 78378px 且还在长，下面裂出
            // 七万像素的空白（2026-08-01 用户反馈）。草稿预览 07-21 就修了，条目页一直漏着。
            `html,body{height:auto!important;min-height:0!important;}` +
            // 合并进来的「补充观测」卡片限宽居中，其配图限高，避免在模板内容列之外被撑满整页。
            `.merged-observation{max-width:680px!important;margin-left:auto!important;margin-right:auto!important;}` +
            `.merged-observation figure{max-width:420px!important;margin-left:0!important;}` +
            `.merged-observation img{max-height:360px!important;max-width:100%!important;width:auto!important;height:auto!important;object-fit:contain;}` +
            // 入侵警示卡片头部在窄屏换行，避免「入侵等级」徽章被 overflow:hidden 裁掉（修复存量条目）。
            `@media(max-width:640px){.invasive-card .ic-head{flex-wrap:wrap!important;gap:8px 12px!important;padding:14px 16px!important;}.invasive-card .ic-head h2{font-size:19px!important;}.invasive-card .ic-badge{margin-left:0!important;order:3!important;flex-basis:100%!important;white-space:normal!important;}}` +
            // 图片相框修复：ccplants skill 页把每张图写死成 4:3/16:9 相框 + object-fit:cover 裁剪。
            // 改为按图片原始比例完整显示、不裁剪，仅设一个最大高度防止超高竖图占满屏。
            // 保留 .broken 占位框的固定尺寸（否则空图会塌成一条线）。
            `.img-slot:not(.broken),.img-slot.habitat-photo:not(.broken){aspect-ratio:auto!important;height:auto!important;overflow:visible!important;}` +
            `.img-slot:not(.broken) img{position:static!important;width:100%!important;height:auto!important;max-height:80vh!important;object-fit:contain!important;}` +
            `</style>`;
          // Forward right-click on edit markers to the parent page.
          const script = `<script>document.addEventListener('contextmenu',function(e){var t=e.target;var m=t&&t.closest&&t.closest('.lov-edit-mark');if(!m)return;e.preventDefault();var id=m.getAttribute('data-edit-id');if(!id)return;var r=m.getBoundingClientRect();parent.postMessage({type:'lov-edit-mark-ctx',editId:id,x:r.left+r.width,y:r.top+r.height},'*');});</script>`;
          const inject = css + script;
          // 摘要卡页尾那句「点击『让 AI 生成进一步介绍草稿』」在条目页上是**点不动的**
          // （按钮长在草稿页）。发布路径已经改写掉，这里再改一次是为了存量条目 ——
          // 2026-07-31 线上 12 个 ai_identify 条目里有 3 个带着它，不必为此跑迁移。
          // 真正的去路由下面那块「站内已有该物种的内容」提供。
          let processed = rewriteDraftOnlyHints(text);
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

    const ext = extForMime(fileToUpload.type, file.name.split(".").pop() || "jpg");
    const path = `${user.id}/cover/${Date.now()}.${ext}`;
    const { error } = await supabase.storage.from("plant-images").upload(path, fileToUpload, {
      cacheControl: "3600", upsert: false, contentType: fileToUpload.type,
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

  // iframe 自适应高度：内容多高 iframe 就多高，整页由父窗口单一滚动 —— 消除固定
  // calc(100vh-120px) 造成的内部双滚动，以及短页面时页尾被空白撑满的问题。
  const sizeIframe = (iframe: HTMLIFrameElement) => {
    const doc = iframe.contentDocument;
    if (!doc) return;
    // 容器宽度塌缩（≈0 宽）时，内容会回流成极高的窄条，量到的 scrollHeight 是垃圾值。
    // 跳过；等宽度恢复后 ResizeObserver 会再次触发、量到正确高度。
    if (iframe.clientWidth < 240) return;
    const body = doc.body;
    if (!body) return;
    // 🔴 **绝不能用 documentElement.scrollHeight**（草稿预览 07-21 踩过同一个坑，
    // 见 draft-enhance.ts 里那段注释）：它不小于视口高，而 iframe 里的视口高就是父层刚按
    // 上一次量到的值设好的 iframe 高度 —— 于是高度只增不减，内容变矮时永远缩不回去；配上
    // 模板的 min-height:100vh 更是每轮 +16px（body margin）无限长高。
    // 正确做法：只量 body 自身的内容盒 + 外边距，这个值与视口无关，因此收敛。
    const rect = body.getBoundingClientRect();
    const cs = doc.defaultView?.getComputedStyle(body);
    const mt = parseFloat(cs?.marginTop || "0") || 0;
    const mb = parseFloat(cs?.marginBottom || "0") || 0;
    const h = Math.ceil(rect.height + mt + mb);
    // 没有实质变化就不写回去，掐掉任何残余的回授循环。
    if (h > 0 && Math.abs(h - lastSizedRef.current) > 1) {
      lastSizedRef.current = h;
      iframe.style.height = `${h}px`;
      // ⚠️ 量到真高度就**必须拆掉 minHeight**。它原本写死 60vh 当加载占位，可 CSS 里
      // min-height 永远压过 height —— 内容比 60vh 矮时（精简摘要卡草稿被采纳后的条目就是
      // 这种），iframe 照样撑满 60vh，正文下面裂出一大片空白（2026-07-24 用户反馈）。
      iframe.style.minHeight = "0px";
    }
  };

  // 「注 N」= 正文里的 .lov-edit-mark 上标。iframe 出于安全无 allow-scripts（中和上传 HTML 里的脚本），
  // 但 srcDoc + allow-same-origin 是同源，父页面可直接给 iframe 文档挂点击监听 → 定位到页尾「修改记录」，
  // 并接管页内锚点跳转（沙箱里点 #hash 会把 iframe 导航到 about:srcdoc 显示源码乱码）。
  const wireIframe = (iframe: HTMLIFrameElement) => {
    const doc = iframe.contentDocument;
    if (!doc) return;
    // 同一个 iframe 的 load 会触发不止一次（srcDoc 换了、about:blank 先来一发）。
    // 每次都挂一遍监听，点一下卡片就会滚动好几次、ResizeObserver 也会重复量高。
    // 记住已经接好的那份 document；**文档换了就重接**（换文档 = 老监听已经随文档没了）。
    const already = wiredDocRef.current === doc;
    // 换了文档 = 换了一篇正文，上一篇的高度不能拿来当「没变化」的基准，否则新页量到相近
    // 高度就被 ≤1px 阈值挡掉，iframe 一直卡在旧高度上。
    if (!already) lastSizedRef.current = 0;
    wiredDocRef.current = doc;
    // 自适应高度 + 图片/字体加载后重新量高。
    sizeIframe(iframe);
    if (already) return;
    [120, 400, 1000, 2500].forEach((t) => setTimeout(() => sizeIframe(iframe), t));
    try {
      doc.querySelectorAll("img").forEach((im) => im.addEventListener("load", () => sizeIframe(iframe)));
      const f = (doc as unknown as { fonts?: { ready?: Promise<unknown> } }).fonts;
      if (f?.ready) f.ready.then(() => sizeIframe(iframe));
      roRef.current?.disconnect();
      const ro = new ResizeObserver(() => sizeIframe(iframe));
      ro.observe(doc.documentElement);
      roRef.current = ro;
    } catch { /* ResizeObserver 不支持时退回定时量高 */ }
    // 🔴 **capture 阶段**。页内锚点一旦走到浏览器的默认行为，沙箱 srcdoc 就会被导航成
    // about:srcdoc#... 、渲染出一屏源码乱码，而且**不可挽回**。挂在捕获阶段可以确保
    // 无论上传的 HTML 里有没有别的监听、会不会 stopPropagation，我们都先拦到。
    doc.addEventListener("click", (ev) => {
      const target = ev.target as Element | null;
      const mark = (target?.closest?.(".lov-edit-mark") as HTMLElement | null) ?? null;
      if (mark) {
        const id = mark.getAttribute("data-edit-id");
        if (!id) return;
        ev.preventDefault();
        // 置空再设：连续点同一条「注」也能重新触发滚动 + 高亮。
        setFocusedNoteId(null);
        requestAnimationFrame(() => setFocusedNoteId(id));
        return;
      }
      // 页内锚点（如「博物趣闻」摘要卡 href="#section-vi"）：手动滚动父窗口到目标，
      // 避免沙箱 srcdoc 的 #hash 导航把 iframe 变成一屏源码乱码。
      const anchor = (target?.closest?.('a[href^="#"]') as HTMLAnchorElement | null) ?? null;
      if (anchor) {
        const rawId = (anchor.getAttribute("href") || "").slice(1);
        if (!rawId) return;
        let el: Element | null = null;
        try { el = doc.getElementById(decodeURIComponent(rawId)) || doc.getElementById(rawId); } catch { el = doc.getElementById(rawId); }
        if (!el) return;
        ev.preventDefault();
        const top = iframe.getBoundingClientRect().top + window.scrollY + el.getBoundingClientRect().top;
        window.scrollTo({ top: Math.max(0, top - 90), behavior: "smooth" });
      }
    }, true);
  };

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

  // Share-card content for the published entry. leafEarned is intentionally omitted
  // (no identify-round context here → the card skips the「本轮铜叶」line). Rendered
  // only when there's a cover photo to put on the card.
  const shareCardNode = plant.cover_url ? (
    <ShareCardButton
      card={{
        title: plant.title,
        scientificName: plant.scientific_name,
        commonNameEn: plant.common_name_en,
        commonNamesZh: plant.common_names_zh,
        family: plant.family,
        genus: plant.genus,
        summary: plant.summary,
        photoUrl: plant.cover_url,
        discovererName: author?.display_name ?? "Plantspedia",
        chips: registryChipList,
      }}
    />
  ) : null;

  /** 正名核对留痕（服务端在金叶生成/编辑保存那一刻写下的，这里只读）。 */
  const nameStamp = readNameStamp((plant as { name_authority?: unknown } | null)?.name_authority);

  const chipsNode = registryChipList.length ? (
    <RegistryChips chips={registryChipList} linkTags />
  ) : null;

  const fmtDate = (ts: string) => {
    try {
      return new Date(ts).toLocaleDateString("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit" });
    } catch {
      return ts;
    }
  };
  // 采纳编辑/时间：用现有 create 行（editor_name 已解析），无需额外查询。
  const createRow = plantEdits.find((e) => e.kind === "create");

  // 合并进来的每一份来源草稿都会写一条 merge 行（见 identify-plant.functions 的采纳合并），
  // 它就是页内那张「补充观测」卡片上「注 N」指向的东西 —— 贡献表里把它单独列出来，
  // 读者才知道这一页是几个人凑出来的、哪一段是谁补的。
  const mergeRows = plantEdits.filter((e) => e.kind === "merge");

  /**
   * 分角色贡献表（用户 2026-08-01 的要求：「合并后还能清晰追溯不同的识别人和生成人」）。
   *
   * 从前这里只有「最早识别：某某」一行 —— 一株被补拍三次、由三个人识别、再由第四个人
   * 花银叶生成正文时，后面三个人全被「最早」两个字盖掉了。现在按角色分行，每行列全人名。
   */
  const roleRow = (label: string, names: React.ReactNode) => (
    <p>
      {label}：{names}
    </p>
  );
  const identifiers = contributors.filter((c) => c.role === "identify");
  const enrichers = contributors.filter((c) => c.role === "enrich");

  const attributionFooter = (
    <div className="mt-10 pt-6 border-t border-rule text-xs text-ink-faint space-y-1">
      <p className="font-semibold text-ink-soft">本页贡献</p>
      {identifiers.length > 0 &&
        roleRow(
          `识别人（${identifiers.length} 次识别）`,
          identifiers.map((c, i) => (
            <span key={c.draftId + i}>
              {i > 0 && "、"}
              <span className="text-ink">{c.name}</span>
              {c.place && <> · {c.place}</>}
              {" · "}
              {fmtDate(c.at)}
            </span>
          )),
        )}
      {enrichers.length > 0 &&
        roleRow(
          "银叶生成人",
          enrichers.map((c, i) => (
            <span key={c.draftId + i}>
              {i > 0 && "、"}
              <span className="text-ink">{c.name}</span>
              {" · "}
              {fmtDate(c.at)}
              {/* 2026-08-01 之前生成的草稿没记生成人，只能退回识别人 —— 必须注明，
                  不能把推断出来的名字当成查到的。 */}
              {c.inferred && <span className="opacity-70">（存量数据未记录，按识别人推断）</span>}
            </span>
          )),
        )}
      {identifiers.length === 0 &&
        roleRow(
          "skill 创建者",
          <span className="text-ink">
            {createRow?.editor_name ?? author?.display_name ?? "编辑"}
          </span>,
        )}
      {roleRow(
        identifiers.length > 0 ? "采纳收录" : "上传",
        <>
          <span className="text-ink">
            {createRow?.editor_name ?? author?.display_name ?? "编辑"}
          </span>
          {" · "}
          {fmtDate(createRow?.created_at ?? plant.created_at)}
        </>,
      )}
      {mergeRows.length > 0 &&
        roleRow(
          `合并补充（${mergeRows.length} 次）`,
          mergeRows.map((e, i) => (
            <span key={e.id}>
              {i > 0 && "、"}
              <button
                type="button"
                onClick={() => {
                  setFocusedNoteId(null);
                  requestAnimationFrame(() => setFocusedNoteId(e.id));
                }}
                className="text-ink underline decoration-dotted hover:text-vermilion cursor-pointer"
              >
                注 {e.marker_n ?? i + 1}
              </button>
              {" · "}
              {e.editor_name ?? "编辑"}
              {" · "}
              {fmtDate(e.created_at)}
            </span>
          )),
        )}
      {plant.co_author_names && plant.co_author_names.length > 0 &&
        roleRow(
          "共建者",
          <span className="text-ink">{plant.co_author_names.join("，")}</span>,
        )}
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
            <p className="label flex items-center gap-2">
              {plant.scientific_name || plant.title}
              {entryKind && <PlantKindBadge kind={entryKind} />}
            </p>
            <div className="flex items-center gap-2">
              {shareCardNode}
              <ShareButton title={plant.title} summary={plant.summary} />
              {canEdit && (
                <Link to="/admin/edit/$id" params={{ id: plant.id }} className="label hover:text-vermilion">编辑 →</Link>
              )}
            </div>
          </div>
        </div>
        {chipsNode && (
          <div className="border-b border-rule bg-background">
            <div className="mx-auto max-w-6xl px-6 py-2.5">{chipsNode}</div>
          </div>
        )}
        {/* 正名核对结论。放在正文 iframe **之前** —— 正文是上传的整页 HTML，
            我们没法往里插东西；而「这个名字被自动改过」必须在读正文之前就看到。 */}
        {nameStamp && (
          <div className="border-b border-rule bg-background">
            <div className="mx-auto max-w-6xl px-6 py-2.5">
              <NameAuthorityNote stamp={nameStamp} />
            </div>
          </div>
        )}
        {/* 矛盾红框。与正名核对同理放在正文 **之前**：正文是上传的整页 HTML，插不进去，
            而「这一页的科属此刻有两种说法」必须在读正文之前就看到。 */}
        <FieldConflictsPanel
          plantId={plant.id}
          conflicts={fieldConflicts}
          canEdit={canEdit}
          onResolved={() => {
            void qc.invalidateQueries({ queryKey: ["plant", slug] });
            void qc.invalidateQueries({ queryKey: ["plant-provenance", plant.id] });
            void qc.invalidateQueries({ queryKey: ["plant-edits", plant.id] });
          }}
          className="mx-auto max-w-6xl px-6 w-full mt-3"
        />
        <main className="flex-1">
          {htmlDoc ? (
            <iframe
              title={plant.title}
              srcDoc={htmlDoc}
              sandbox="allow-same-origin allow-popups"
              onLoad={(e) => wireIframe(e.currentTarget)}
              className="w-full block"
              scrolling="no"
              style={{ minHeight: "60vh" }}
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
        {/* 同物种在站内的其它成品。**紧跟正文之后**，与草稿页共用同一个组件。
            为什么条目页也要有（2026-07-31 用户反馈）：采纳「快速识别简介」落成的条目，
            正文就是那张摘要卡，页尾还印着「点击『让 AI 生成进一步介绍草稿』」——
            可那个按钮长在草稿页上，这一页根本没有。读者读完摘要就断了路。
            现在断路补上了：绿=快速简介卡、蓝=银叶科普、橙=金叶/skill 详页；
            本页自己、以及**被本页收录的那份来源草稿**都已排除（否则会指回自己）。 */}
        <SpeciesExistingLinks
          existing={speciesExisting}
          fallbackTitle={plant.title}
          className="mx-auto max-w-3xl px-6 w-full mt-6"
          // 🟢 快速识别条目：正文只有一张摘要卡，同物种若已有银叶科普就**默认展开在下面**。
          defaultOpen={entryKind === "quick"}
        />
        <div className="mx-auto max-w-3xl px-6 w-full">
          {/* 封面图不在此重复展示——编辑封面请用条目右上角「编辑 →」。 */}
          {attributionFooter}
          <EditLogSection
            edits={plantEdits}
            isEditor={canEdit}
            reverting={revertingId}
            onRevert={onRevertPlantEdit}
            focusEditId={focusedNoteId}
          />
          <PlantComments plantId={plant.id} />
        </div>
        {/* 小P蛙 — 编辑登录后可对该已发布页提问并改写（标注范围或整页），保存上线并记入修改记录 */}
        {canEdit && (
          <XiaoPAgentPanel
            storageKey={`plant:${plant.id}`}
            greetingTitle={plant.title}
            canApply={true}
            isRegistered={!!user}
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
          <div className="flex items-center gap-2">
            {shareCardNode}
            <ShareButton title={plant.title} summary={plant.summary} />
          </div>
        </div>
        <article className="mt-6">
          <header className="border-b border-ink pb-6 mb-8">
            <p className="label text-vermilion mb-2 flex items-center gap-2">
              Specimen Entry
              {entryKind && <PlantKindBadge kind={entryKind} />}
            </p>
            <h1 className="font-display text-5xl md:text-6xl font-bold leading-tight">{plant.title}</h1>
            {plant.scientific_name && <p className="italic text-ink-faint mt-3 text-xl font-serif">{plant.scientific_name}</p>}
            {chipsNode && <div className="mt-4">{chipsNode}</div>}
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
            <FieldConflictsPanel
              plantId={plant.id}
              conflicts={fieldConflicts}
              canEdit={canEdit}
              onResolved={() => {
                void qc.invalidateQueries({ queryKey: ["plant", slug] });
                void qc.invalidateQueries({ queryKey: ["plant-provenance", plant.id] });
                void qc.invalidateQueries({ queryKey: ["plant-edits", plant.id] });
              }}
              className="mt-5"
            />
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

          {/* tag 不在此重复列出——它们已作为卡签随 重点保护/CITES/GTS/GRIIS/地区名录
              一起显示在标题下方的 chipsNode 里（可点击跳 /tags）。 */}
          {attributionFooter}
          <EditLogSection
            edits={plantEdits}
            isEditor={canEdit}
            reverting={revertingId}
            onRevert={onRevertPlantEdit}
            focusEditId={focusedNoteId}
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
        .prose-plant img { max-width: 100%; height: auto; margin: 1.5em 0; border: 1px solid var(--rule); }
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
