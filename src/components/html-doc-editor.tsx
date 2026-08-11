import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import { compressImage, extForMime } from "@/lib/image-compress";
import { clearMissingOrganMarkers } from "@/lib/draft-enhance";
import { createPortal } from "react-dom";
import { FolderOpen, Clipboard, Link2, Globe, Pencil, ExternalLink, Trash2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { RichEditor } from "@/components/rich-editor";
import { toast } from "sonner";

type Props = {
  htmlUrl: string;
  /** Plant id to attach edit history to. Null for new (unsaved) plants. */
  plantId?: string | null;
  onSaved: (newUrl: string, commentsCount: number) => void | Promise<void>;
};

const COMMENTS_MARKER_CLASS = "editor-comments";
const BLOCK_SELECTOR =
  "figure,section,article,aside,header,footer,p,h1,h2,h3,h4,h5,h6,blockquote,li,table,pre,div";

type DirtyInfo = { kinds: Set<string>; at: number; beforeHtml: string };

export type AppliedEditMark = {
  id: string;
  kind: "text" | "image";
  marker_n: number;
  block_path: string;
  before_html: string;
  after_html: string;
};

export type HtmlDocEditorHandle = {
  /**
   * Serialize the edited doc, upload it and hand back the new public URL.
   * Returns null when nothing was touched (caller keeps the URL it already has).
   * **Throws** on failure — the caller owns the error message, because this now
   * runs as the first half of the host form's single「保存修改」action.
   */
  save: () => Promise<{ url: string; commentsCount: number } | null>;
  /** True while a save is currently running. */
  isSaving: () => boolean;
  /** True when the body or the editor comments have been changed since load. */
  isDirty: () => boolean;
};

type ImgTarget = { src: string; alt: string; el: HTMLImageElement };
type MenuState = ({ x: number; y: number } & ImgTarget) | null;

/**
 * Loads an uploaded HTML file into an iframe and lets the user edit the body
 * IN-PLACE via contentEditable. This preserves the ORIGINAL <head> (fonts,
 * stylesheets, meta) and ALL original body markup (classes, inline styles,
 * structure) untouched — only text/image edits flow through. Right-click on
 * any image (including <svg>-as-img) opens a replace/delete menu.
 * The Editor Comments block uses RichEditor and is appended on save.
 */
export const HtmlDocEditor = forwardRef<HtmlDocEditorHandle, Props>(function HtmlDocEditor(
  { htmlUrl, plantId, onSaved },
  ref,
) {
  const { user } = useAuth();
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const insertFileRef = useRef<HTMLInputElement>(null);
  const replaceFileRef = useRef<HTMLInputElement>(null);
  const activeImgRef = useRef<HTMLImageElement | null>(null);
  const dirtyBlocksRef = useRef<Map<HTMLElement, DirtyInfo>>(new Map());
  /** 载入时页面里原有的评论正文 —— 用来判断「评论改过没有」。 */
  const baseCommentsRef = useRef("");

  const [loading, setLoading] = useState(true);
  const [docText, setDocText] = useState<string>("");
  const [saving, setSaving] = useState(false);
  const [commentsHtml, setCommentsHtml] = useState("");
  const [commentsVersion, setCommentsVersion] = useState(0);
  const [menu, setMenu] = useState<MenuState>(null);
  const [wikiOpen, setWikiOpen] = useState(false);
  const cacheKey = `html-doc-editor:${htmlUrl}`;

  /** Best-effort draft cache write. sessionStorage is ~5MB; a large edited doc can
   *  overflow it and throw QuotaExceededError. That must NOT abort the edit action
   *  itself (image replace / insert / formatting) — the cache is only a crash-recovery
   *  convenience, so swallow the failure. (Matches the guarded initial-load/typing
   *  effects; the image-mutation helpers below previously called setItem unguarded.) */
  const persistDocCache = (idoc: Document | null | undefined) => {
    if (!idoc) return;
    try {
      sessionStorage.setItem(cacheKey, "<!DOCTYPE html>\n" + idoc.documentElement.outerHTML);
    } catch {
      // quota exceeded / storage disabled — recovery cache is optional
    }
  };

  /** Snapshot block.outerHTML BEFORE the very first dirty event lands. */
  const snapshotBlock = useCallback((block: HTMLElement | null) => {
    if (!block) return;
    const map = dirtyBlocksRef.current;
    if (!map.has(block)) {
      map.set(block, {
        kinds: new Set<string>(),
        at: Date.now(),
        beforeHtml: block.outerHTML,
      });
    }
  }, []);

  const markDirty = useCallback(
    (node: Node | null, kind: string) => {
      const block = nearestBlock(node);
      if (!block) return;
      snapshotBlock(block);
      const info = dirtyBlocksRef.current.get(block)!;
      info.kinds.add(kind);
      info.at = Date.now();
    },
    [snapshotBlock],
  );

  // Fetch original HTML (or restore cached edits) ----------------------------
  useEffect(() => {
    let cancelled = false;
    setLoading(true);

    const apply = (text: string) => {
      // Pull existing comments block out so the editor surfaces it separately.
      try {
        const doc = new DOMParser().parseFromString(text, "text/html");
        const existing = doc.body?.querySelector(`section.${COMMENTS_MARKER_CLASS}`);
        let extracted = "";
        if (existing) {
          const inner = existing.querySelector(`[data-comments-body]`);
          extracted = (inner?.innerHTML ?? "").trim();
          existing.remove();
        }
        baseCommentsRef.current = extracted;
        setCommentsHtml(extracted);
        setCommentsVersion((v) => v + 1);
        setDocText("<!DOCTYPE html>\n" + doc.documentElement.outerHTML);
      } catch {
        setDocText(text);
      }
      setLoading(false);
    };

    const cached = sessionStorage.getItem(cacheKey);
    if (cached) {
      apply(cached);
      return () => {
        cancelled = true;
      };
    }
    fetch(htmlUrl)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.text();
      })
      .then((text) => {
        if (cancelled) return;
        // sessionStorage has a ~5MB quota — a batch of large HTML files fills it
        // fast, and QuotaExceededError must not blank the editor. Cache is optional.
        try {
          sessionStorage.setItem(cacheKey, text);
        } catch {
          /* quota full — skip caching, still render */
        }
        apply(text);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setLoading(false);
        toast.error(`无法读取 HTML 文件（${err instanceof Error ? err.message : String(err)}）`);
      });
    return () => {
      cancelled = true;
    };
  }, [cacheKey, htmlUrl]);

  // Wire up iframe: enable contentEditable + image right-click ---------------
  const onIframeLoad = useCallback(() => {
    const ifr = iframeRef.current;
    const idoc = ifr?.contentDocument;
    if (!ifr || !idoc?.body) return;
    idoc.body.setAttribute("contenteditable", "true");
    (idoc.body.style as CSSStyleDeclaration).outline = "none";
    // Use designMode in addition to contenteditable — more reliable across
    // iframes/srcDoc reloads, and lets the user click anywhere (including
    // empty space inside complex original layouts) to start editing.
    try {
      idoc.designMode = "on";
    } catch {
      /* ignore */
    }
    // Inject editor-only CSS that:
    //  - keeps existing edit markers visible but never blocks clicks/right-click
    //    on the underlying image or text;
    //  - guarantees images are still right-clickable on top of figure overlays.
    if (!idoc.getElementById("lov-editor-runtime-style")) {
      const s = idoc.createElement("style");
      s.id = "lov-editor-runtime-style";
      s.textContent = `
        .lov-edit-mark-row{pointer-events:none!important;}
        .lov-edit-mark{pointer-events:auto!important;}
        img,svg{cursor:context-menu;}
        body{caret-color:#c0392b;}
        /* 图片按原图比例显示 —— 与预览态（draft-enhance 的 VIEWER_STYLE）保持一致。
           以前编辑器少了这一条：图上的硬编码 height 属性 / 内联高度没人压得住，换了新配图
           仍按旧的固定比例显示，非要点进预览才恢复正常（2026-07-22 用户实测反馈）。
           编辑器和预览必须看到同一个渲染结果，否则编辑就是在盲改。
           注意：本 style 块在保存时会被剔除（见 onSave 里对 lov-editor-runtime-style 的处理），
           所以这些规则只作用于编辑视图，不会污染存进库的正文。 */
        img{height:auto!important;max-width:100%!important;}
        /* 刚换过的图闪一圈红框（见 flashImage）。随本 style 块一起在保存时被剔除。 */
        .${FLASH_CLASS}{outline:3px solid #c0392b!important;outline-offset:3px;}
      `;
      (idoc.head ?? idoc.documentElement).appendChild(s);
    }

    // Snapshot the block BEFORE the user actually mutates it (text path).
    const onBeforeInput = () => {
      try {
        const sel = idoc.getSelection?.();
        const block = nearestBlock(sel?.anchorNode ?? null);
        snapshotBlock(block);
      } catch {
        // ignore
      }
    };
    idoc.addEventListener("beforeinput", onBeforeInput);

    const onCtx = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      // Robust image lookup: try direct closest first, then walk up to the
      // nearest figure/block and find an img/svg inside it. This handles
      // edit-mark overlays, <figcaption> clicks, and other wrappers that
      // would otherwise miss the image entirely.
      //
      // ⚠️ 往上退到容器里找图时，必须挑**离鼠标最近的那张**，不能拿 querySelector 的
      // 第一张。一个 section 里有好几张图时，「第一张」几乎注定不是用户右键的那张 ——
      // 于是换掉的是别处那张图，眼前这张纹丝不动，但提示写着「已替换」
      // （2026-08-07 用户反馈的第二类成因）。
      let img =
        (target?.closest?.("img,svg") as HTMLElement | null) ??
        nearestImageIn(target?.closest?.("figure,picture,a") ?? null, e.clientX, e.clientY);
      if (!img) img = nearestImageIn(nearestBlock(target), e.clientX, e.clientY);
      if (!img) return;
      e.preventDefault();
      // Get position in parent viewport coords.
      const rect = ifr.getBoundingClientRect();
      let el: HTMLImageElement;
      if (img.tagName.toLowerCase() === "svg") {
        // Snapshot BEFORE svg→img conversion mutates the block.
        snapshotBlock(nearestBlock(img));
        // Convert <svg> in place to <img> so we can edit/replace.
        const replaced = svgToImage(img as unknown as SVGElement, idoc);
        if (!replaced) return;
        el = replaced;
      } else {
        el = img as HTMLImageElement;
      }
      activeImgRef.current = el;
      setMenu({
        x: rect.left + e.clientX,
        y: rect.top + e.clientY,
        src: el.getAttribute("src") || "",
        alt: el.getAttribute("alt") || "",
        el,
      });
    };
    idoc.addEventListener("contextmenu", onCtx);
    // Click anywhere in iframe closes parent menu.
    const onClick = () => setMenu(null);
    idoc.addEventListener("click", onClick);
    return () => {
      idoc.removeEventListener("beforeinput", onBeforeInput);
      idoc.removeEventListener("contextmenu", onCtx);
      idoc.removeEventListener("click", onClick);
    };
  }, [snapshotBlock]);

  // Persist edits to sessionStorage as user types ----------------------------
  useEffect(() => {
    if (loading) return;
    const ifr = iframeRef.current;
    const idoc = ifr?.contentDocument;
    if (!idoc) return;
    const handler = () => {
      try {
        const sel = idoc.getSelection?.();
        markDirty(sel?.anchorNode ?? null, "text");
      } catch {
        // ignore
      }
      try {
        const full = "<!DOCTYPE html>\n" + idoc.documentElement.outerHTML;
        sessionStorage.setItem(cacheKey, full);
      } catch {
        // ignore
      }
    };
    idoc.addEventListener("input", handler);
    return () => idoc.removeEventListener("input", handler);
  }, [loading, cacheKey, docText, markDirty]);

  // Close menu on outside click / escape -------------------------------------
  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("click", close);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("click", close);
      window.removeEventListener("keydown", onKey);
    };
  }, [menu]);

  // Image upload helper ------------------------------------------------------
  const uploadImageFile = async (file: File) => {
    if (!user) throw new Error("请先登录");

    let fileToUpload: Blob | File = file;
    try {
      fileToUpload = await compressImage(file);
    } catch (err) {
      console.error("Image compression failed, using original:", err);
    }

    const ext = extForMime(fileToUpload.type, file.name.split(".").pop() || "jpg");
    const path = `${user.id}/inline/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
    const { error } = await supabase.storage.from("plant-images").upload(path, fileToUpload, {
      cacheControl: "3600",
      upsert: false,
      contentType: fileToUpload.type,
    });
    if (error) throw error;
    return supabase.storage.from("plant-images").getPublicUrl(path).data.publicUrl;
  };

  const replaceActiveSrc = (src: string, alt?: string) => {
    const el = activeImgRef.current;
    if (!el) return;
    // Snapshot the host block BEFORE we mutate the image.
    snapshotBlock(nearestBlock(el));
    const isNewSrc = el.getAttribute("src") !== src;
    if (isNewSrc) {
      // 🔴 **先拆掉所有会压过 src 的东西，再写 src**，否则新图根本不会被显示出来
      // ——「提示替换成功、画面纹丝不动」的第一类成因（2026-08-07 用户反馈）：
      //   · srcset / sizes 存在时浏览器**优先**按 srcset 挑图，src 只是后备；
      //   · <picture> 里任一 <source> 命中，img 的 src 同样被无视。
      el.removeAttribute("srcset");
      el.removeAttribute("sizes");
      const picture = el.closest("picture");
      if (picture) picture.querySelectorAll("source").forEach((s) => s.remove());
      // 第二类成因：ccplants 模板给每张图挂了
      // `onerror="this.parentElement.classList.add('broken')"`，而 CSS 里
      // `.img-slot.broken img{display:none}`。新图只要有一次没加载出来（网络抖动、
      // 存储对象刚落地），这个 onerror 就会把它永久藏起来，且再也不会自己恢复。
      // 换图之后这个兜底已经没有意义（图是编辑刚挑的），直接摘掉。
      el.removeAttribute("onerror");
      (el as HTMLImageElement).onerror = null;
      // 懒加载会让「刚换的图要滚到才出现」，在编辑器里就是「没换成功」。
      el.removeAttribute("loading");
    }
    el.setAttribute("src", src);
    if (alt !== undefined) el.setAttribute("alt", alt);
    if (isNewSrc) {
      // Drop SVG-era hard width/height so the new image's natural aspect wins.
      el.removeAttribute("width");
      el.removeAttribute("height");
      el.style.width = "";
      el.style.height = "auto";
      el.style.maxWidth = "100%";
      // 兜底解除隐藏：图槽历史上可能被 onerror / 模板写成 display:none 或 hidden。
      if (el.style.display === "none") el.style.display = "";
      el.removeAttribute("hidden");
      // 清掉宿主图槽的**失败态**。`.img-slot.broken` 带 aspect-ratio:4/3（premium-page.ts），
      // 那是给「图挂了、空槽会塌成一条线」用的占位框。换上新图后若不摘掉这个类，新图就被
      // 困在 4:3 里按固定比例显示 —— 这正是「编辑器里比例不跟着变、进预览才恢复」的原因
      // （预览走 enhanceDraftHtmlForViewing，编辑器 srcDoc 用的是原始 HTML，没有那层中和 CSS）。
      // 属性/内联样式清除对 CSS 类规则无效，必须显式摘类。
      // 注意 `.broken` 也可能挂在 figure 之外的祖先容器上，故两处都摘。
      const slot = el.closest(".img-slot") ?? el.parentElement;
      if (slot) slot.classList.remove("broken", "no-organ");
      // 草稿模板的空槽（`<img class="sec-img" hidden src="">` + 一行「暂无该物种的…公开
      // 照片」）：右键换图时是通过 figure 找到那个隐藏 img 的，换上真图后必须把缺图标记
      // 和那句说明一起摘掉 —— 否则新配图下面还挂着「暂无照片」（2026-07-26 用户反馈）。
      clearMissingOrganMarkers(el);
      // 换的是哪一张，必须让人**看见**。图可能在视口外（右键菜单是浮在父页面上的，
      // iframe 自己不会跟着滚），不滚过去的话换成功了也像没反应。
      flashImage(el);
    }
    markDirty(el, "image");
    // Trigger a synthetic input event so caching effect picks it up.
    el.dispatchEvent(new Event("input", { bubbles: true }));
    persistDocCache(iframeRef.current?.contentDocument);
  };

  const runDocCommand = (command: string, value?: string) => {
    const idoc = iframeRef.current?.contentDocument;
    if (!idoc) return;
    const sel = idoc.getSelection?.();
    snapshotBlock(nearestBlock(sel?.anchorNode ?? null));
    idoc.body?.focus();
    idoc.execCommand(command, false, value);
    markDirty(sel?.anchorNode ?? idoc.body, command.startsWith("justify") ? "text" : "text");
    persistDocCache(idoc);
  };

  const insertImageByUrl = (src: string, alt = "") => {
    const idoc = iframeRef.current?.contentDocument;
    if (!idoc) return;
    const sel = idoc.getSelection?.();
    snapshotBlock(nearestBlock(sel?.anchorNode ?? null));
    idoc.body?.focus();
    idoc.execCommand(
      "insertHTML",
      false,
      `<img src="${escapeAttr(src)}" alt="${escapeAttr(alt)}" style="max-width:100%;height:auto;" />`,
    );
    markDirty(sel?.anchorNode ?? idoc.body, "image");
    persistDocCache(idoc);
  };

  const onPickInsertFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    try {
      const url = await uploadImageFile(f);
      insertImageByUrl(url, f.name);
      toast.success("已添加图片");
    } catch (err) {
      toast.error((err as Error).message);
    }
  };

  const onPickReplaceFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f || !activeImgRef.current) return;
    try {
      const url = await uploadImageFile(f);
      replaceActiveSrc(url, f.name);
      setMenu(null);
      toast.success("已替换");
    } catch (err) {
      toast.error((err as Error).message);
    }
  };

  /** 正文或评论动过没有 —— 没动就不必重传一份一模一样的 HTML 到存储桶。 */
  const isDirtyNow = () =>
    dirtyBlocksRef.current.size > 0 || commentsHtml !== baseCommentsRef.current;

  // Save: serialize iframe + append comments + upload as new HTML ------------
  //
  // 由宿主表单的「保存修改」调用（见 plant-editor.tsx）——本组件不再有自己的保存按钮。
  // 从前两个按钮做同一件事：先点「应用修改并替换 HTML 文件」，再点「保存修改」，
  // 于是修改记录里一次编辑留下两条「我按了保存」的流水（2026-08-07 用户反馈）。
  // 失败**抛出**而不是自己弹 toast：宿主要靠异常决定要不要中止整次保存。
  const runSave = async (): Promise<{ url: string; commentsCount: number } | null> => {
    if (!user) throw new Error("请先登录");
    const idoc = iframeRef.current?.contentDocument;
    if (!idoc) throw new Error("编辑器未就绪");
    if (!isDirtyNow()) return null;
    setSaving(true);
    try {
      // Stamp [N] edit markers (right-aligned, with hover tooltip) onto the
      // live doc BEFORE cloning so element refs in dirtyBlocksRef are valid.
      const editorName =
        (user.user_metadata?.full_name as string | undefined) ||
        (user.user_metadata?.name as string | undefined) ||
        user.email ||
        "编辑者";
      const applied = applyEditMarkers(idoc, dirtyBlocksRef.current, editorName);
      dirtyBlocksRef.current = new Map();

      // Persist edit history rows (only when we know which plant this is).
      if (plantId && applied.length > 0) {
        const rows = applied.map((a) => ({
          plant_id: plantId,
          editor_id: user.id,
          editor_name: editorName,
          kind: a.kind,
          marker_n: a.marker_n,
          block_path: a.block_path,
          before_html: a.before_html,
          after_html: a.after_html,
          id: a.id,
          source: "html_editor",
        }));
        const { error: insErr } = await supabase.from("plant_edits").insert(rows);
        if (insErr) {
          console.error("plant_edits insert failed", insErr);
          toast.error("修改记录写入失败：" + insErr.message);
        }
      }

      // ⛔️ 这里**不再**写「XX 保存了 HTML 修改（N 处标记）」那条 html_save 流水。
      // 它记的是「有人按了保存」，不是内容改了什么：marker_n=0、没有 before/after，
      // 撤销按钮点下去只会报「找不到该修改对应的内容块」。真正的内容改动由上面那批
      // 带 before_html / after_html 的逐块标记行记录，「注 N」与撤销也都靠它们。

      // Strip any pre-existing comments block in the live doc, then append fresh.
      const docClone = idoc.cloneNode(true) as Document;
      const old = docClone.body.querySelector(`section.${COMMENTS_MARKER_CLASS}`);
      if (old) old.remove();
      // 编辑器专用样式**绝不能存进正文**：它含 img{height:auto!important} 这类只该作用于
      // 编辑视图的规则，写进库里会永久覆盖模板对图片的排版。cloneNode 会把它一起复制过来，
      // 所以必须在序列化前显式摘掉。
      // 用 querySelector 而非 getElementById：后者在 cloneNode 出来的 Document 上不保证
      // 可靠（ID 缓存未必随克隆重建）。漏删一次，这段 CSS 就被永久写进正文。
      docClone.querySelector("#lov-editor-runtime-style")?.remove();
      // 换图时的高亮 class 只是编辑期的视觉提示（规则住在上面那块被剔除的样式表里），
      // 但 class 名本身会跟着 outerHTML 存进库 —— 保存前统一摘掉。
      docClone.querySelectorAll(`.${FLASH_CLASS}`).forEach((e) => e.classList.remove(FLASH_CLASS));
      docClone.body.removeAttribute("contenteditable");
      const commentsBlock = buildCommentsSection(commentsHtml, docClone);
      docClone.body.appendChild(commentsBlock);

      const fullDoc = "<!DOCTYPE html>\n" + docClone.documentElement.outerHTML;
      const blob = new Blob([fullDoc], { type: "text/html" });
      const path = `${user.id}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.html`;
      const { error } = await supabase.storage.from("plant-html").upload(path, blob, {
        cacheControl: "3600",
        upsert: false,
        contentType: "text/html",
      });
      if (error) throw error;
      const url = supabase.storage.from("plant-html").getPublicUrl(path).data.publicUrl;
      sessionStorage.removeItem(cacheKey);
      const commentsCount = countComments(commentsHtml);
      // 保存成功 = 这份内容成了新的基线，下一次「没改动」才判得准。
      baseCommentsRef.current = commentsHtml;
      await onSaved(url, commentsCount);
      return { url, commentsCount };
    } finally {
      setSaving(false);
    }
  };

  const hasComments = useMemo(() => stripHtml(commentsHtml).trim().length > 0, [commentsHtml]);

  // 句柄本身建一次就够，但它调用的闭包必须**永远是最新那份** —— 从前 deps 只有 [saving]，
  // 于是 save() 里捞到的 commentsHtml / plantId 都停在句柄创建那一刻，评论改了也存不进去。
  const liveRef = useRef({ runSave, isDirtyNow, saving });
  liveRef.current = { runSave, isDirtyNow, saving };
  useImperativeHandle(
    ref,
    () => ({
      save: () => liveRef.current.runSave(),
      isSaving: () => liveRef.current.saving,
      isDirty: () => liveRef.current.isDirtyNow(),
    }),
    [],
  );

  return (
    <div className="space-y-3">
      <div className="text-xs text-ink-faint">
        正文在原排版上直接编辑：可改文字、可右键图片（含 SVG）替换 / 删除。原文件
        <code>&lt;head&gt;</code> 和 <code>&lt;body&gt;</code> 上的样式、类名、结构都
        保持不变。评论会追加到页面末尾。
      </div>

      {loading ? (
        <div className="border border-ink p-6 text-sm text-ink-faint">载入 HTML 中…</div>
      ) : (
        <div className="border border-ink bg-background">
          <div className="sticky top-0 z-30 bg-background">
            <HtmlEditToolbar
              onCommand={runDocCommand}
              onPickImage={() => insertFileRef.current?.click()}
              onImageUrl={() => {
                const url = window.prompt("图片地址 URL：", "https://");
                if (!url?.trim()) return;
                const alt = window.prompt("图片说明文字（alt）：", "") ?? "";
                insertImageByUrl(url.trim(), alt);
              }}
            />
          </div>
          <iframe
            ref={iframeRef}
            title="HTML 正文编辑器"
            srcDoc={docText}
            onLoad={onIframeLoad}
            sandbox="allow-same-origin allow-scripts"
            className="w-full"
            style={{
              height: "calc(100vh - 240px)",
              minHeight: 520,
              border: "none",
              display: "block",
            }}
          />
        </div>
      )}

      <input
        ref={insertFileRef}
        type="file"
        accept="image/*"
        onChange={onPickInsertFile}
        className="sr-only"
        tabIndex={-1}
      />

      <input
        ref={replaceFileRef}
        type="file"
        accept="image/*"
        onChange={onPickReplaceFile}
        className="sr-only"
        tabIndex={-1}
      />

      {menu &&
        createPortal(
          <ImageContextMenu
            menu={menu}
            onClose={() => setMenu(null)}
            onReplaceLocal={() => replaceFileRef.current?.click()}
            onReplaceFromClipboard={async () => {
              try {
                if (!navigator.clipboard?.read) {
                  toast.error("当前浏览器不支持读取剪贴板，请改用「替换为本地图片」");
                  return;
                }
                const items = await navigator.clipboard.read();
                for (const it of items) {
                  const type = it.types.find((t) => t.startsWith("image/"));
                  if (!type) continue;
                  const blob = await it.getType(type);
                  const ext = type.split("/")[1] || "png";
                  const file = new File([blob], `clipboard-${Date.now()}.${ext}`, { type });
                  const url = await uploadImageFile(file);
                  replaceActiveSrc(url);
                  setMenu(null);
                  toast.success("已使用剪贴板图片替换");
                  return;
                }
                toast.error("剪贴板中没有图片，请先复制一张图片再试");
              } catch (err) {
                toast.error("读取剪贴板失败：" + (err as Error).message);
              }
            }}
            onReplaceUrl={() => {
              const url = window.prompt("粘贴图片地址 URL 替换：", menu.src);
              if (url === null) return;
              const trimmed = url.trim();
              if (trimmed) replaceActiveSrc(trimmed);
              setMenu(null);
            }}
            onSearchWiki={() => {
              setWikiOpen(true);
              setMenu(null);
            }}
            onEditAlt={() => {
              const alt = window.prompt("图片说明文字（alt）：", menu.alt);
              if (alt === null) return;
              replaceActiveSrc(menu.src, alt);
              setMenu(null);
            }}
            onOpenInNewTab={() => {
              window.open(menu.src, "_blank");
              setMenu(null);
            }}
            onDelete={() => {
              const el = activeImgRef.current;
              if (el) {
                markDirty(el.parentElement, "image");
                el.remove();
              }
              const idoc = iframeRef.current?.contentDocument;
              if (idoc) {
                sessionStorage.setItem(
                  cacheKey,
                  "<!DOCTYPE html>\n" + idoc.documentElement.outerHTML,
                );
              }
              setMenu(null);
              toast.success("已删除");
            }}
          />,
          document.body,
        )}

      {wikiOpen &&
        createPortal(
          <ImageSearchDialog
            initialQuery={activeImgRef.current?.getAttribute("alt") || ""}
            onClose={() => setWikiOpen(false)}
            onPick={(url, title, source) => {
              replaceActiveSrc(url, title);
              setWikiOpen(false);
              toast.success(`已替换为 ${source} 图片`);
            }}
          />,
          document.body,
        )}

      <section className="border border-rule bg-paper-deep/30 p-4 space-y-2">
        <div>
          <p className="label text-vermilion mb-1">编辑评论 Editor Comments</p>
          <p className="text-xs text-ink-faint">
            支持文字、图片、链接。将插入到 HTML 页面最末尾；为空时访客看到 “No comment yet”。
          </p>
        </div>
        <RichEditor
          key={`comments-${commentsVersion}`}
          value={commentsHtml}
          onChange={setCommentsHtml}
        />
        <p className="text-xs text-ink-faint">
          当前状态：{hasComments ? "已编写评论" : "未填写（将显示 No comment yet）"}
        </p>
      </section>

      {/* 这里从前有个「应用修改并替换 HTML 文件」按钮。它和页面底部的「保存修改」做的
          是同一件事，用户得连点两下、修改记录里也留下两条「我按了保存」的流水
          （2026-08-07 反馈）。现在统一由底部那个按钮一次搞定。 */}
      <p className="text-xs text-ink-faint">
        {saving
          ? "正在写入正文…"
          : "正文改动会随页面底部的「保存修改」一起提交；原 HTML 排版完整保留，仅文字 / 图片改动会被写入。"}
      </p>
    </div>
  );
});

function HtmlEditToolbar({
  onCommand,
  onPickImage,
  onImageUrl,
}: {
  onCommand: (command: string, value?: string) => void;
  onPickImage: () => void;
  onImageUrl: () => void;
}) {
  const Btn = ({
    label,
    title,
    onClick,
  }: {
    label: string;
    title: string;
    onClick: () => void;
  }) => (
    <button
      type="button"
      title={title}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      className="border border-transparent px-2 py-1 text-xs hover:border-ink/40 hover:bg-paper-deep"
    >
      {label}
    </button>
  );
  return (
    <div className="flex flex-wrap items-center gap-1 border-b border-rule bg-paper-deep/40 px-2 py-1.5">
      <select
        aria-label="字体"
        defaultValue=""
        onChange={(e) => e.target.value && onCommand("fontName", e.target.value)}
        className="border border-rule bg-background px-2 py-1 text-xs"
      >
        <option value="">字体</option>
        <option value="宋体, SimSun, serif">宋体</option>
        <option value="黑体, SimHei, sans-serif">黑体</option>
        <option value="Georgia, serif">Georgia</option>
        <option value="Arial, sans-serif">Arial</option>
      </select>
      <select
        aria-label="段落"
        defaultValue="P"
        onChange={(e) => onCommand("formatBlock", e.target.value)}
        className="border border-rule bg-background px-2 py-1 text-xs"
      >
        <option value="P">段落</option>
        <option value="H1">标题 1</option>
        <option value="H2">标题 2</option>
        <option value="H3">标题 3</option>
        <option value="BLOCKQUOTE">引用</option>
      </select>
      <span className="mx-1 h-5 w-px bg-rule" />
      <Btn label="B" title="加粗" onClick={() => onCommand("bold")} />
      <Btn label="I" title="斜体" onClick={() => onCommand("italic")} />
      <Btn label="U" title="下划线" onClick={() => onCommand("underline")} />
      <span className="mx-1 h-5 w-px bg-rule" />
      <Btn label="左" title="左对齐" onClick={() => onCommand("justifyLeft")} />
      <Btn label="中" title="居中" onClick={() => onCommand("justifyCenter")} />
      <Btn label="右" title="右对齐" onClick={() => onCommand("justifyRight")} />
      <Btn label="齐" title="两端对齐" onClick={() => onCommand("justifyFull")} />
      <span className="mx-1 h-5 w-px bg-rule" />
      <Btn label="• 列表" title="无序列表" onClick={() => onCommand("insertUnorderedList")} />
      <Btn label="1. 列表" title="有序列表" onClick={() => onCommand("insertOrderedList")} />
      <Btn
        label="链接"
        title="添加链接"
        onClick={() => {
          const url = window.prompt("链接地址：", "https://");
          if (url?.trim()) onCommand("createLink", url.trim());
        }}
      />
      <Btn label="本地图" title="添加本地图片" onClick={onPickImage} />
      <Btn label="URL图" title="添加图片 URL" onClick={onImageUrl} />
      <span className="mx-1 h-5 w-px bg-rule" />
      <Btn label="↶" title="撤销" onClick={() => onCommand("undo")} />
      <Btn label="↷" title="重做" onClick={() => onCommand("redo")} />
    </div>
  );
}

/* ---------------- Image right-click menu ---------------- */

function ImageContextMenu({
  menu,
  onClose,
  onReplaceLocal,
  onReplaceFromClipboard,
  onReplaceUrl,
  onSearchWiki,
  onEditAlt,
  onOpenInNewTab,
  onDelete,
}: {
  menu: NonNullable<MenuState>;
  onClose: () => void;
  onReplaceLocal: () => void;
  onReplaceFromClipboard: () => void;
  onReplaceUrl: () => void;
  onSearchWiki: () => void;
  onEditAlt: () => void;
  onOpenInNewTab: () => void;
  onDelete: () => void;
}) {
  const W = 240,
    H = 300;
  const x = Math.min(menu.x, window.innerWidth - W - 8);
  const y = Math.min(menu.y, window.innerHeight - H - 8);
  const stop = (e: React.SyntheticEvent) => {
    e.preventDefault();
    e.stopPropagation();
  };
  const Item = ({
    onClick,
    children,
    danger,
  }: {
    onClick: () => void;
    children: React.ReactNode;
    danger?: boolean;
  }) => (
    <button
      type="button"
      onMouseDown={stop}
      onClick={(e) => {
        stop(e);
        onClick();
      }}
      className={`w-full text-left px-3 py-2 text-sm hover:bg-paper-deep ${danger ? "text-destructive" : ""}`}
    >
      {children}
    </button>
  );
  return (
    <div
      onClick={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
      onContextMenu={stop}
      style={{ position: "fixed", left: x, top: y, width: W, zIndex: 50 }}
      className="bg-background border border-ink shadow-lg py-1"
    >
      <div className="px-3 py-1.5 text-[10px] uppercase tracking-wider text-ink-faint border-b border-rule">
        图片操作
      </div>
      <Item onClick={onReplaceLocal}>
        <span className="inline-flex items-center gap-2">
          <FolderOpen className="w-4 h-4" />
          替换为本地图片
        </span>
      </Item>
      <Item onClick={onReplaceFromClipboard}>
        <span className="inline-flex items-center gap-2">
          <Clipboard className="w-4 h-4" />
          从剪贴板粘贴替换
        </span>
      </Item>
      <Item onClick={onReplaceUrl}>
        <span className="inline-flex items-center gap-2">
          <Link2 className="w-4 h-4" />
          粘贴图片地址 URL 替换
        </span>
      </Item>
      <Item onClick={onSearchWiki}>
        <span className="inline-flex items-center gap-2">
          <Globe className="w-4 h-4" />
          在线搜索替换图片（iNaturalist / Wikimedia）
        </span>
      </Item>
      <Item onClick={onEditAlt}>
        <span className="inline-flex items-center gap-2">
          <Pencil className="w-4 h-4" />
          修改说明文字
        </span>
      </Item>
      <Item onClick={onOpenInNewTab}>
        <span className="inline-flex items-center gap-2">
          <ExternalLink className="w-4 h-4" />
          新标签打开原图
        </span>
      </Item>
      <div className="border-t border-rule my-1" />
      <Item onClick={onDelete} danger>
        <span className="inline-flex items-center gap-2">
          <Trash2 className="w-4 h-4" />
          删除图片
        </span>
      </Item>
      <button
        type="button"
        onMouseDown={stop}
        onClick={(e) => {
          stop(e);
          onClose();
        }}
        className="w-full text-left px-3 py-1.5 text-xs text-ink-faint hover:bg-paper-deep"
      >
        取消
      </button>
    </div>
  );
}

/* ---------------- helpers ---------------- */

function buildCommentsSection(commentsHtml: string, doc: Document) {
  const hasContent = stripHtml(commentsHtml).trim().length > 0;
  const inner = hasContent
    ? commentsHtml
    : `<p style="opacity:.55;font-style:italic;margin:0;">No comment yet</p>`;
  const section = doc.createElement("section");
  section.setAttribute("class", COMMENTS_MARKER_CLASS);
  section.setAttribute(
    "style",
    "margin:3rem 0 0;padding:1.5rem 0 0;border-top:1px solid currentColor;",
  );
  section.innerHTML = `
  <h2 style="margin:0 0 1rem;font:inherit;font-size:1.4em;font-weight:600;">Editor Comments</h2>
  <div data-comments-body style="line-height:1.7;">${inner}</div>
  <style>img,video,iframe{max-width:100%;height:auto;}</style>`;
  return section;
}

function stripHtml(html: string) {
  return html.replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ");
}

/** 容器里离 (x, y) 最近的 img/svg。容器为空或没有图时返回 null。 */
function nearestImageIn(root: Element | null, x: number, y: number): HTMLElement | null {
  if (!root) return null;
  const list = Array.from(root.querySelectorAll("img,svg")) as HTMLElement[];
  if (list.length <= 1) return list[0] ?? null;
  let best: HTMLElement | null = null;
  let bestDist = Infinity;
  for (const cand of list) {
    const r = cand.getBoundingClientRect();
    // 点在矩形内 → 距离 0；否则取到矩形边的距离。
    const dx = Math.max(r.left - x, 0, x - r.right);
    const dy = Math.max(r.top - y, 0, y - r.bottom);
    const d = dx * dx + dy * dy;
    if (d < bestDist) {
      bestDist = d;
      best = cand;
    }
  }
  return best;
}

const FLASH_CLASS = "lov-img-flash";

/** 滚到刚换的那张图并闪一圈红框 —— 让「换成功了」在屏幕上看得见。
 *  用 class 而不是内联样式：这条规则住在保存时会被剔除的编辑器样式表里，
 *  class 本身也在序列化前统一摘掉（见 onSave），不会渗进存库的正文。 */
function flashImage(el: HTMLElement) {
  try {
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    el.classList.add(FLASH_CLASS);
    setTimeout(() => el.classList.remove(FLASH_CLASS), 1400);
  } catch {
    /* 纯提示，失败无所谓 */
  }
}

function escapeAttr(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function countComments(html: string): number {
  if (!html || !stripHtml(html).trim()) return 0;
  try {
    const doc = new DOMParser().parseFromString(`<div>${html}</div>`, "text/html");
    const root = doc.body.firstElementChild;
    if (!root) return 0;
    const blocks = Array.from(root.children).filter((el) => {
      if (el.tagName === "BR") return false;
      const text = (el.textContent ?? "").trim();
      const hasMedia = el.querySelector("img,a,video,iframe");
      return text.length > 0 || !!hasMedia;
    });
    return blocks.length || 1;
  } catch {
    return 1;
  }
}

function encodeSnapshotAttr(value: string): string {
  try {
    return btoa(unescape(encodeURIComponent(value)));
  } catch {
    return encodeURIComponent(value);
  }
}

/**
 * Convert an inline <svg> in the iframe doc into an <img> with a data-URI src
 * so it becomes a normal editable / replaceable image. Returns the new <img>
 * or null on failure.
 */
function svgToImage(svg: SVGElement, doc: Document): HTMLImageElement | null {
  try {
    const clone = svg.cloneNode(true) as SVGElement;
    if (!clone.getAttribute("xmlns")) clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
    const serialized = new XMLSerializer().serializeToString(clone);
    let src: string;
    try {
      src = `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(serialized)))}`;
    } catch {
      src = `data:image/svg+xml;utf8,${encodeURIComponent(serialized)}`;
    }
    const img = doc.createElement("img");
    img.setAttribute("src", src);
    img.setAttribute("alt", svg.getAttribute("aria-label") || "illustration");
    const w = svg.getAttribute("width");
    const h = svg.getAttribute("height");
    if (w) img.setAttribute("width", w);
    if (h) img.setAttribute("height", h);
    img.style.maxWidth = "100%";
    img.style.height = "auto";
    svg.replaceWith(img);
    return img;
  } catch {
    return null;
  }
}

/* ---------------- Edit marker helpers ---------------- */

export function nearestBlock(node: Node | null): HTMLElement | null {
  let n: Node | null = node;
  while (n && n.nodeType !== 1) n = n.parentNode;
  let el = n as HTMLElement | null;
  const body = el?.ownerDocument?.body ?? null;
  while (el && el !== body) {
    if (el.matches?.(BLOCK_SELECTOR)) return el;
    el = el.parentElement;
  }
  return el;
}

const EDIT_MARK_STYLE_ID = "lov-edit-mark-style";
const EDIT_MARK_CSS = `
[data-edit-mark-host]{position:relative!important;}
.lov-edit-mark-row{position:absolute;top:2px;right:4px;display:inline-flex;gap:2px;z-index:5;pointer-events:none;}
.lov-edit-mark{pointer-events:auto;display:inline-block;font-size:10px;line-height:1;padding:2px 5px;background:#c0392b;color:#fff;border-radius:3px;font-family:ui-sans-serif,system-ui,-apple-system,sans-serif;cursor:help;text-decoration:none;font-weight:600;font-style:normal;position:relative;}
.lov-edit-mark:hover::after{content:attr(data-tip);position:absolute;top:130%;right:0;background:#222;color:#fff;padding:6px 8px;font-size:11px;white-space:pre-wrap;max-width:320px;width:max-content;border-radius:3px;z-index:10;font-weight:400;pointer-events:none;line-height:1.4;text-align:left;}
`;

export function applyEditMarkers(
  doc: Document,
  dirty: Map<HTMLElement, DirtyInfo>,
  by: string,
): AppliedEditMark[] {
  if (dirty.size === 0) return [];
  if (!doc.getElementById(EDIT_MARK_STYLE_ID)) {
    const style = doc.createElement("style");
    style.id = EDIT_MARK_STYLE_ID;
    style.textContent = EDIT_MARK_CSS;
    (doc.head ?? doc.documentElement).appendChild(style);
  }
  let maxN = 0;
  doc.querySelectorAll("[data-edit-n]").forEach((e) => {
    const n = parseInt(e.getAttribute("data-edit-n") || "0", 10);
    if (n > maxN) maxN = n;
  });
  const entries = Array.from(dirty.entries())
    .filter(([el]) => el.isConnected)
    .sort((a, b) => a[1].at - b[1].at);
  const kindLabel: Record<string, string> = { text: "文字", image: "图片" };
  const applied: AppliedEditMark[] = [];
  for (const [el, info] of entries) {
    // Skip no-op edits: user merely focused/clicked into the block but never
    // actually changed any markup. Comparing the current outerHTML (still
    // pristine — no marker appended yet) to the snapshot taken on the first
    // dirty event detects this and keeps the audit log clean.
    if (el.outerHTML === info.beforeHtml) continue;
    maxN += 1;
    el.setAttribute("data-edit-mark-host", "");
    let row = el.querySelector(":scope > .lov-edit-mark-row") as HTMLElement | null;
    if (!row) {
      row = el.ownerDocument!.createElement("span");
      row.className = "lov-edit-mark-row";
      row.setAttribute("contenteditable", "false");
      el.appendChild(row);
    }
    const sup = el.ownerDocument!.createElement("sup");
    sup.className = "lov-edit-mark";
    sup.setAttribute("data-edit-n", String(maxN));
    const editId =
      typeof crypto !== "undefined" && crypto.randomUUID
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    sup.setAttribute("data-edit-id", editId);
    sup.setAttribute("data-before-html", encodeSnapshotAttr(info.beforeHtml));
    const date = new Date(info.at);
    const stamp = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")} ${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
    const kindStr = Array.from(info.kinds)
      .map((k) => kindLabel[k] ?? k)
      .join(" / ");
    const beforeText = textPreview(info.beforeHtml);
    sup.setAttribute("data-tip", `编辑：${by} · ${stamp} · ${kindStr}\n修改前：${beforeText}`);
    sup.textContent = `[${maxN}]`;
    row.appendChild(sup);

    // Capture after_html AFTER the marker row has been appended (it lives
    // inside outerHTML but is harmless — the marker is restored on render).
    const primaryKind: "text" | "image" = info.kinds.has("image") ? "image" : "text";
    const afterHtml = el.outerHTML;
    sup.setAttribute("data-after-html", encodeSnapshotAttr(afterHtml));
    applied.push({
      id: editId,
      kind: primaryKind,
      marker_n: maxN,
      block_path: cssPath(el),
      before_html: info.beforeHtml,
      after_html: afterHtml,
    });
  }
  return applied;
}

function textPreview(html: string, max = 80): string {
  const text = (html || "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!text) return "（无文字）";
  return text.length > max ? text.slice(0, max) + "…" : text;
}

function cssPath(el: HTMLElement): string {
  const parts: string[] = [];
  let cur: HTMLElement | null = el;
  const root = el.ownerDocument?.body ?? null;
  while (cur && cur !== root) {
    const tag = cur.tagName.toLowerCase();
    const parentEl: HTMLElement | null = cur.parentElement;
    if (!parentEl) {
      parts.unshift(tag);
      break;
    }
    const sibs = (Array.from(parentEl.children) as Element[]).filter(
      (c) => c.tagName === cur!.tagName,
    );
    const idx = sibs.indexOf(cur);
    parts.unshift(`${tag}:nth-of-type(${idx + 1})`);
    cur = parentEl;
  }
  return parts.join(" > ");
}

/* ---------------- Online image search dialog ---------------- */

export type ImgSource = "Wikimedia Commons" | "iNaturalist" | "GBIF";
type ImgHit = { title: string; thumb: string; full: string; credit?: string };

async function searchWikimedia(term: string): Promise<ImgHit[]> {
  const url =
    "https://commons.wikimedia.org/w/api.php?" +
    new URLSearchParams({
      action: "query",
      format: "json",
      origin: "*",
      generator: "search",
      gsrnamespace: "6",
      gsrsearch: term + " filetype:bitmap|drawing",
      gsrlimit: "30",
      prop: "imageinfo",
      iiprop: "url|extmetadata|mime",
      iiurlwidth: "320",
    }).toString();
  const j = await fetch(url).then((r) => r.json());
  const pages = j?.query?.pages ?? {};
  const out: ImgHit[] = [];
  for (const k of Object.keys(pages)) {
    const p = pages[k];
    const ii = p?.imageinfo?.[0];
    if (!ii?.thumburl) continue;
    if ((ii.mime || "").includes("svg")) continue;
    out.push({
      title: (p.title || "").replace(/^File:/, ""),
      thumb: ii.thumburl,
      full: ii.url,
      credit: "Wikimedia Commons",
    });
  }
  return out;
}

async function searchINaturalist(term: string): Promise<ImgHit[]> {
  // Try a taxon-scoped observation search first (gives high-quality photos
  // tagged to the species). Fall back to a free-text observation search if
  // we can't resolve a taxon.
  let taxonId: number | null = null;
  try {
    const tx = await fetch(
      "https://api.inaturalist.org/v1/taxa?" +
        new URLSearchParams({ q: term, per_page: "1", rank: "species,genus" }),
    ).then((r) => r.json());
    taxonId = tx?.results?.[0]?.id ?? null;
  } catch {
    taxonId = null;
  }
  const params = new URLSearchParams({
    photos: "true",
    per_page: "30",
    order: "desc",
    order_by: "votes",
    quality_grade: "research",
  });
  if (taxonId) params.set("taxon_id", String(taxonId));
  else params.set("q", term);
  const j = await fetch("https://api.inaturalist.org/v1/observations?" + params).then((r) =>
    r.json(),
  );
  const out: ImgHit[] = [];
  for (const obs of j?.results ?? []) {
    for (const ph of obs?.photos ?? []) {
      if (!ph?.url) continue;
      const small = String(ph.url);
      const large = small.replace(/\/square\./, "/large.").replace(/\/medium\./, "/large.");
      out.push({
        title:
          obs?.taxon?.preferred_common_name ||
          obs?.taxon?.name ||
          obs?.species_guess ||
          "iNaturalist photo",
        thumb: small,
        full: large,
        credit: ph?.attribution || "iNaturalist",
      });
      if (out.length >= 30) break;
    }
    if (out.length >= 30) break;
  }
  return out;
}

async function searchGBIF(term: string): Promise<ImgHit[]> {
  // Resolve a species key via GBIF species match, then pull occurrences with media.
  let speciesKey: number | null = null;
  try {
    const m = await fetch(
      "https://api.gbif.org/v1/species/match?" + new URLSearchParams({ name: term }),
    ).then((r) => r.json());
    speciesKey = m?.usageKey ?? null;
  } catch {
    speciesKey = null;
  }
  const params = new URLSearchParams({ mediaType: "StillImage", limit: "30" });
  if (speciesKey) params.set("taxonKey", String(speciesKey));
  else params.set("q", term);
  const j = await fetch("https://api.gbif.org/v1/occurrence/search?" + params).then((r) =>
    r.json(),
  );
  const out: ImgHit[] = [];
  for (const occ of j?.results ?? []) {
    for (const media of occ?.media ?? []) {
      const url = media?.identifier;
      if (!url) continue;
      out.push({
        title: occ?.scientificName || occ?.species || "GBIF occurrence",
        thumb: url,
        full: url,
        credit: media?.rightsHolder || media?.publisher || "GBIF.org",
      });
      if (out.length >= 30) break;
    }
    if (out.length >= 30) break;
  }
  return out;
}

export type PlantImgHit = { title: string; thumb: string; full: string; credit?: string };

/** Combined plant-image lookup for 小P蛙 reference photos: tries iNaturalist →
 *  GBIF → Wikimedia Commons and returns the first source that yields results. */
export async function searchPlantImages(term: string, limit = 3): Promise<PlantImgHit[]> {
  const sources = [searchINaturalist, searchGBIF, searchWikimedia];
  for (const fn of sources) {
    try {
      const out = await fn(term);
      if (out && out.length) return out.slice(0, limit);
    } catch {
      /* try next source */
    }
  }
  return [];
}

export function ImageSearchDialog({
  initialQuery,
  initialUrl,
  onClose,
  onPick,
  nameChips,
  onUploadFile,
}: {
  initialQuery: string;
  /** 预填在「或粘贴图片地址」里的 URL —— 编辑在对话里已经给出地址时（小P蛙那条路）
   *  就不该让他再复制粘贴一次。 */
  initialUrl?: string;
  onClose: () => void;
  onPick: (url: string, title: string, source: ImgSource) => void;
  /** Optional one-tap quick-fill chips (e.g. Latin / English / Chinese names). */
  nameChips?: { label: string; value: string }[];
  /** When provided, shows a 本地上传 button: the file is uploaded via this
   *  callback (returns the public URL), then flows through onPick like a hit. */
  onUploadFile?: (file: File) => Promise<string>;
}) {
  const [source, setSource] = useState<ImgSource>("iNaturalist");
  const [q, setQ] = useState(initialQuery);
  const [hits, setHits] = useState<ImgHit[]>([]);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [urlInput, setUrlInput] = useState(initialUrl ?? "");
  const [urlErr, setUrlErr] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  /** 「使用此地址」：只挡明显不是 http(s) 的输入，不去猜后缀 —— iNaturalist / 维基的
   *  很多图片地址并不以 .jpg 结尾，按后缀拦会把正经图挡在外面。 */
  const applyPastedUrl = () => {
    const u = urlInput.trim();
    if (!u) return setUrlErr("请先粘贴图片地址");
    let parsed: URL;
    try {
      parsed = new URL(u);
    } catch {
      return setUrlErr("这不是一个有效的网址，请粘贴以 http:// 或 https:// 开头的图片地址");
    }
    if (!/^https?:$/.test(parsed.protocol))
      return setUrlErr("只支持 http:// 或 https:// 开头的图片地址");
    setUrlErr(null);
    onPick(u, "粘贴的图片地址", source);
  };

  const handleFile = async (f: File | undefined | null) => {
    if (!f || !onUploadFile) return;
    setUploading(true);
    setErr(null);
    try {
      const url = await onUploadFile(f);
      onPick(url, f.name, source);
    } catch (e) {
      setErr((e as Error).message || "上传失败，请重试");
      setUploading(false);
    }
  };

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  const search = useCallback(async (term: string, src: ImgSource) => {
    const text = term.trim();
    if (!text) {
      setHits([]);
      return;
    }
    setLoading(true);
    setErr(null);
    try {
      const out =
        src === "iNaturalist"
          ? await searchINaturalist(text)
          : src === "Wikimedia Commons"
            ? await searchWikimedia(text)
            : await searchGBIF(text);
      setHits(out);
      if (out.length === 0) setErr("没有找到匹配的图片，换一个关键词或切换图源试试");
    } catch (e) {
      setErr((e as Error).message || "搜索失败");
    } finally {
      setLoading(false);
    }
  }, []);

  const onKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      search(q, source);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[60] bg-black/60 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-background border border-ink shadow-xl w-full max-w-4xl max-h-[85vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-rule px-4 py-3">
          <h3 className="label text-vermilion">在线搜索替换图片</h3>
          <button
            type="button"
            onClick={onClose}
            className="text-ink-faint hover:text-ink text-xl leading-none"
            aria-label="关闭"
          >
            ×
          </button>
        </div>
        <div className="px-4 py-3 border-b border-rule space-y-2">
          <div className="flex gap-1 flex-wrap">
            {(["iNaturalist", "Wikimedia Commons", "GBIF"] as ImgSource[]).map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => {
                  setSource(s);
                  if (q.trim()) search(q, s);
                }}
                className={`px-3 py-1.5 text-xs border ${
                  source === s
                    ? "bg-ink text-background border-ink"
                    : "border-rule hover:border-ink"
                }`}
              >
                {s}
              </button>
            ))}
            {onUploadFile && (
              <>
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => {
                    void handleFile(e.target.files?.[0]);
                    e.target.value = "";
                  }}
                />
                <button
                  type="button"
                  onClick={() => fileRef.current?.click()}
                  disabled={uploading}
                  className="px-3 py-1.5 text-xs border border-leaf text-leaf-deep hover:bg-leaf hover:text-background transition-colors disabled:opacity-60"
                >
                  {uploading ? "上传中…" : "📁 本地上传"}
                </button>
              </>
            )}
          </div>
          <div className="flex gap-2">
            <input
              ref={inputRef}
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={onKey}
              placeholder="输入学名前两个单词或者英文俗名命中率会更高，选图时注意甄别是否是目标物种"
              className="flex-1 border border-ink px-3 py-2 text-sm bg-background"
            />
            <button
              type="button"
              onClick={() => search(q, source)}
              disabled={loading}
              className="border border-ink px-4 py-2 text-sm hover:bg-ink hover:text-background transition-colors disabled:opacity-60"
            >
              {loading ? "搜索中…" : "搜索"}
            </button>
          </div>
          {nameChips && nameChips.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-[11px] text-ink-faint">一键填入：</span>
              {nameChips.map((c) => (
                <button
                  key={c.label}
                  type="button"
                  onClick={() => {
                    setQ(c.value);
                    search(c.value, source);
                  }}
                  title={c.value}
                  className="text-[11px] border border-rule px-2 py-0.5 hover:border-ink hover:bg-paper-deep"
                >
                  {c.label}
                </button>
              ))}
            </div>
          )}
          {/* 直接粘一个图片地址。搜图搜不到、或已经在别处挑好了图（小P蛙给的、
              iNaturalist 页面上复制的）时，这是唯一一条不用先上传就能用的路 ——
              从前只有「搜」和「传」两种，手里攥着 URL 的人无处可去。 */}
          <div className="flex gap-2">
            <input
              value={urlInput}
              onChange={(e) => {
                setUrlInput(e.target.value);
                setUrlErr(null);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  applyPastedUrl();
                }
              }}
              placeholder="或粘贴图片地址：https://…jpg / .png / .webp"
              className="flex-1 border border-rule px-3 py-2 text-sm bg-background"
            />
            <button
              type="button"
              onClick={applyPastedUrl}
              className="border border-leaf text-leaf-deep px-4 py-2 text-sm hover:bg-leaf hover:text-background transition-colors"
            >
              使用此地址
            </button>
          </div>
          {urlErr && <p className="text-[11px] text-destructive">{urlErr}</p>}
          <p className="text-[11px] text-ink-faint">
            提示：建议一次只用<strong className="text-ink-soft">一类</strong>关键词（拉丁学名 /
            英文俗名 / 中文常用名）命中率更高。iNaturalist 适合物种照片（自动按学名匹配
            taxon），Wikimedia Commons 适合插画 / 历史图谱。请遵循各自的版权与署名要求。
          </p>
        </div>
        <div className="flex-1 overflow-auto p-4">
          {err && <p className="text-xs text-destructive mb-2">{err}</p>}
          {hits.length === 0 && !loading && !err && (
            <p className="text-sm text-ink-faint">输入关键词后按回车或点击“搜索”。</p>
          )}
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
            {hits.map((h, idx) => (
              <button
                key={h.full + idx}
                type="button"
                onClick={() => onPick(h.full, h.title, source)}
                className="group border border-rule hover:border-ink text-left bg-paper-deep/30"
                title={h.title}
              >
                <img
                  src={h.thumb}
                  alt={h.title}
                  loading="lazy"
                  className="w-full h-32 object-contain bg-background"
                />
                <div className="px-2 py-1.5 text-[11px] line-clamp-2 leading-snug">{h.title}</div>
              </button>
            ))}
          </div>
        </div>
        <div className="border-t border-rule px-4 py-2 flex items-center justify-between text-[11px] text-ink-faint">
          <span>来源：{source}</span>
          <span>点击图片即替换当前选中的图</span>
        </div>
      </div>
    </div>
  );
}
