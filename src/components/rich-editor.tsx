import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useEditor, EditorContent, type Editor } from "@tiptap/react";
import type { EditorView } from "@tiptap/pm/view";
import StarterKit from "@tiptap/starter-kit";
import Image from "@tiptap/extension-image";
import Link from "@tiptap/extension-link";
import Placeholder from "@tiptap/extension-placeholder";
import { FolderOpen, Link2, Search, Pencil, ExternalLink, Trash2, Image as ImageIcon } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { toast } from "sonner";

type Props = { value: string; onChange: (html: string) => void };

type ImageTarget = { pos: number; src: string; alt: string };
type MenuState = ({ x: number; y: number } & ImageTarget) | null;
type SearchState = { open: boolean; pos: number | null };
type UrlReplaceState = { open: boolean; target: ImageTarget | null; value: string };

function getTargetImage(target: HTMLElement | null) {
  return target?.closest("img") ?? null;
}

function getImagePosition(view: EditorView, img: HTMLImageElement, event: MouseEvent) {
  const posAtDom = view.posAtDOM(img, 0);
  if (typeof posAtDom === "number" && posAtDom >= 0) return posAtDom;
  const coordsPos = view.posAtCoords({ left: event.clientX, top: event.clientY });
  return coordsPos?.pos ?? null;
}

function normalizeImageSrc(src: string) {
  try {
    return new URL(src, window.location.href).href;
  } catch {
    return src;
  }
}

function stopEditorDefault(event: React.SyntheticEvent | Event) {
  event.preventDefault();
  event.stopPropagation();
  const nativeEvent = "nativeEvent" in event ? event.nativeEvent : event;
  if ("stopImmediatePropagation" in nativeEvent) nativeEvent.stopImmediatePropagation();
}

function stopEditorPropagation(event: React.SyntheticEvent | Event) {
  event.stopPropagation();
}

export function RichEditor({ value, onChange }: Props) {
  const { user } = useAuth();
  const insertFileRef = useRef<HTMLInputElement>(null);
  const replaceFileRef = useRef<HTMLInputElement>(null);
  const activeImageRef = useRef<ImageTarget | null>(null);
  const [menu, setMenu] = useState<MenuState>(null);
  const [search, setSearch] = useState<SearchState>({ open: false, pos: null });
  const [urlReplace, setUrlReplace] = useState<UrlReplaceState>({
    open: false,
    target: null,
    value: "",
  });

  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit.configure({ link: false }),
      Image.configure({ HTMLAttributes: { class: "rounded border border-rule my-4 max-w-full" } }),
      Link.configure({ openOnClick: false, HTMLAttributes: { class: "text-vermilion underline" } }),
      Placeholder.configure({
        placeholder: "在此撰写正文… 支持标题、列表、引用、图片。右键图片可调出编辑菜单。",
      }),
    ],
    content: value || "",
    onUpdate: ({ editor }) => onChange(editor.getHTML()),
    editorProps: {
      attributes: { class: "prose-plant min-h-[400px] focus:outline-none px-4 py-4" },
      handleDOMEvents: {
        contextmenu: (view, event) => {
          const target = event.target as HTMLElement | null;
          const img = getTargetImage(target);
          if (!img) return false;
          event.preventDefault();
          event.stopPropagation();
          const pos = getImagePosition(view, img, event as MouseEvent);
          if (pos == null) return true;
          openImageMenu(img, event as MouseEvent);
          return true;
        },
      },
    },
  });

  useEffect(() => {
    if (!editor || value === editor.getHTML()) return;
    editor.commands.setContent(value || "", { emitUpdate: false });
  }, [editor, value]);

  // Close menu on outside click / escape
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

  const uploadAndReturnUrl = useCallback(
    async (file: File) => {
      if (!user) throw new Error("请先登录");
      const ext = file.name.split(".").pop() || "jpg";
      const path = `${user.id}/inline/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
      const { error } = await supabase.storage.from("plant-images").upload(path, file, {
        cacheControl: "3600",
        upsert: false,
        contentType: file.type,
      });
      if (error) throw error;
      return supabase.storage.from("plant-images").getPublicUrl(path).data.publicUrl;
    },
    [user],
  );

  const insertImageFromFile = async (file: File) => {
    try {
      const url = await uploadAndReturnUrl(file);
      editor?.chain().focus().setImage({ src: url, alt: file.name }).run();
    } catch (err) {
      toast.error((err as Error).message);
    }
  };

  const onPickInsert = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) insertImageFromFile(f);
    e.target.value = "";
  };

  const findImagePos = (target: ImageTarget) => {
    if (!editor) return null;
    const direct = editor.state.doc.nodeAt(target.pos);
    if (direct?.type.name === "image") return target.pos;
    const normalizedTargetSrc = normalizeImageSrc(target.src);
    let srcOnly: number | null = null;
    let exact: number | null = null;
    editor.state.doc.descendants((node, pos) => {
      if (node.type.name !== "image") return true;
      const nodeSrc = String(node.attrs.src || "");
      if (nodeSrc === target.src || normalizeImageSrc(nodeSrc) === normalizedTargetSrc) {
        srcOnly ??= pos;
        if ((node.attrs.alt || "") === target.alt) exact ??= pos;
      }
      return exact == null;
    });
    return exact ?? srcOnly;
  };

  const replaceImageTarget = (target: ImageTarget, src: string, alt?: string) => {
    if (!editor) return false;
    const pos = findImagePos(target);
    if (pos == null) {
      toast.error("未找到要替换的图片，请重新右键选择");
      return false;
    }
    const node = editor.state.doc.nodeAt(pos);
    if (node?.type.name !== "image") {
      toast.error("未找到要替换的图片，请重新右键选择");
      return false;
    }
    const nextTarget = { pos, src, alt: alt ?? "" };
    editor.view.dispatch(
      editor.state.tr.replaceWith(
        pos,
        pos + node.nodeSize,
        node.type.create({ ...node.attrs, src, alt: alt ?? "" }),
      ),
    );
    activeImageRef.current = nextTarget;
    editor.commands.focus();
    return true;
  };

  const deleteImageTarget = (target: ImageTarget) => {
    if (!editor) return;
    const pos = findImagePos(target);
    if (pos == null) return toast.error("未找到要删除的图片，请重新右键选择");
    const node = editor.state.doc.nodeAt(pos);
    if (node?.type.name !== "image") return toast.error("未找到要删除的图片，请重新右键选择");
    editor.view.dispatch(editor.state.tr.delete(pos, pos + node.nodeSize));
    editor.commands.focus();
  };

  const onPickReplace = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = "";
    const target = activeImageRef.current;
    if (!f || target == null) return;
    try {
      const url = await uploadAndReturnUrl(f);
      const replaced = replaceImageTarget(target, url, f.name);
      if (!replaced) return;
      setMenu(null);
      toast.success("已替换");
    } catch (err) {
      toast.error((err as Error).message);
    }
  };

  const openImageMenu = (img: HTMLImageElement, event: MouseEvent | React.MouseEvent) => {
    if (!editor) return;
    const pos = getImagePosition(
      editor.view,
      img,
      "nativeEvent" in event ? event.nativeEvent : event,
    );
    if (pos == null) return;
    const target = { pos, src: img.getAttribute("src") || "", alt: img.getAttribute("alt") || "" };
    activeImageRef.current = target;
    setMenu({ x: event.clientX, y: event.clientY, ...target });
  };

  if (!editor) return <div className="border border-ink p-4 text-ink-faint">载入编辑器…</div>;

  return (
    <div
      className="border border-ink bg-background relative"
      onSubmitCapture={(event) => stopEditorDefault(event)}
      onContextMenuCapture={(event) => {
        if (!editor) return;
        const img = getTargetImage(event.target as HTMLElement | null);
        if (!img || !editor.view.dom.contains(img)) return;
        stopEditorDefault(event);
        openImageMenu(img, event);
      }}
    >
      <Toolbar editor={editor} onPickImage={() => insertFileRef.current?.click()} />
      <input
        ref={insertFileRef}
        type="file"
        accept="image/*"
        onChange={onPickInsert}
        className="sr-only"
        tabIndex={-1}
      />
      <input
        ref={replaceFileRef}
        type="file"
        accept="image/*"
        onChange={onPickReplace}
        className="sr-only"
        tabIndex={-1}
      />
      <EditorContent editor={editor} />

      {menu && (
        <PortalLayer>
          <ImageContextMenu
            menu={menu}
            onClose={() => setMenu(null)}
            onReplaceLocal={() => {
              activeImageRef.current = menu;
              replaceFileRef.current?.click();
            }}
            onReplaceUrl={() => {
              activeImageRef.current = menu;
              setUrlReplace({ open: true, target: menu, value: menu.src });
              setMenu(null);
            }}
            onSearchOnline={() => {
              activeImageRef.current = menu;
              setSearch({ open: true, pos: menu.pos });
              setMenu(null);
            }}
            onEditAlt={() => {
              const alt = window.prompt("图片说明文字（alt）：", menu.alt);
              if (alt === null) return;
              replaceImageTarget(menu, menu.src, alt);
              setMenu(null);
            }}
            onOpenInNewTab={() => {
              window.open(menu.src, "_blank");
              setMenu(null);
            }}
            onDelete={() => {
              deleteImageTarget(menu);
              setMenu(null);
              toast.success("已删除");
            }}
          />
        </PortalLayer>
      )}

      {search.open && (
        <PortalLayer>
          <ImageSearchDialog
            onClose={() => setSearch({ open: false, pos: null })}
            onPick={(url, alt) => {
              const target = activeImageRef.current;
              if (target == null || !replaceImageTarget(target, url, alt)) return;
              setSearch({ open: false, pos: null });
              toast.success("已替换");
            }}
          />
        </PortalLayer>
      )}

      {urlReplace.open && (
        <PortalLayer>
          <ImageUrlDialog
            value={urlReplace.value}
            onChange={(value) => setUrlReplace((state) => ({ ...state, value }))}
            onClose={() => setUrlReplace({ open: false, target: null, value: "" })}
            onSubmit={() => {
              const url = urlReplace.value.trim();
              const target = urlReplace.target ?? activeImageRef.current;
              if (!url || !target) return;
              const replaced = replaceImageTarget(target, url, target.alt);
              if (!replaced) return;
              setUrlReplace({ open: false, target: null, value: "" });
              toast.success("已替换");
            }}
          />
        </PortalLayer>
      )}

      <style>{`
        .prose-plant { font-size: 16px; line-height: 1.8; color: var(--ink); }
        .prose-plant p { margin: 0 0 1em; }
        .prose-plant h2 { font-family: var(--font-display); font-size: 1.6rem; margin: 1.4em 0 .5em; font-weight: 600; }
        .prose-plant h3 { font-family: var(--font-display); font-size: 1.25rem; margin: 1.2em 0 .4em; font-weight: 600; }
        .prose-plant ul, .prose-plant ol { margin: 0 0 1em 1.4em; }
        .prose-plant ul { list-style: disc; } .prose-plant ol { list-style: decimal; }
        .prose-plant blockquote { border-left: 3px solid var(--vermilion); padding-left: 1em; margin: 1em 0; color: var(--ink-soft); font-style: italic; }
        .prose-plant img { display: block; cursor: context-menu; }
        .prose-plant img.ProseMirror-selectednode { outline: 2px solid var(--vermilion); }
        .prose-plant p.is-editor-empty:first-child::before { content: attr(data-placeholder); color: var(--ink-faint); float: left; pointer-events: none; height: 0; }
      `}</style>
    </div>
  );
}

function PortalLayer({ children }: { children: React.ReactNode }) {
  if (typeof document === "undefined") return null;
  return createPortal(<>{children}</>, document.body);
}

/* ---------- Right-click menu ---------- */

function ImageContextMenu({
  menu,
  onClose,
  onReplaceLocal,
  onReplaceUrl,
  onSearchOnline,
  onEditAlt,
  onOpenInNewTab,
  onDelete,
}: {
  menu: NonNullable<MenuState>;
  onClose: () => void;
  onReplaceLocal: () => void;
  onReplaceUrl: () => void;
  onSearchOnline: () => void;
  onEditAlt: () => void;
  onOpenInNewTab: () => void;
  onDelete: () => void;
}) {
  // Clamp inside viewport
  const W = 220,
    H = 280;
  const x = Math.min(menu.x, window.innerWidth - W - 8);
  const y = Math.min(menu.y, window.innerHeight - H - 8);
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
      onMouseDown={stopEditorDefault}
      onPointerDown={stopEditorDefault}
      onClick={(e) => {
        stopEditorDefault(e);
        onClick();
      }}
      className={`w-full text-left px-3 py-2 text-sm hover:bg-paper-deep ${danger ? "text-destructive hover:text-destructive" : ""}`}
    >
      {children}
    </button>
  );
  return (
    <div
      onClick={stopEditorPropagation}
      onMouseDown={stopEditorPropagation}
      onPointerDown={stopEditorPropagation}
      onContextMenu={stopEditorDefault}
      onSubmitCapture={stopEditorDefault}
      style={{ position: "fixed", left: x, top: y, width: W, zIndex: 50 }}
      className="bg-background border border-ink shadow-lg py-1"
    >
      <div className="px-3 py-1.5 text-[10px] uppercase tracking-wider text-ink-faint border-b border-rule">
        图片操作
      </div>
      <Item onClick={onReplaceLocal}><span className="inline-flex items-center gap-2"><FolderOpen className="w-4 h-4" />替换为本地图片</span></Item>
      <Item onClick={onReplaceUrl}><span className="inline-flex items-center gap-2"><Link2 className="w-4 h-4" />替换为图片网址</span></Item>
      <Item onClick={onSearchOnline}><span className="inline-flex items-center gap-2"><Search className="w-4 h-4" />在线搜索替换</span></Item>
      <Item onClick={onEditAlt}><span className="inline-flex items-center gap-2"><Pencil className="w-4 h-4" />修改说明文字</span></Item>
      <Item onClick={onOpenInNewTab}><span className="inline-flex items-center gap-2"><ExternalLink className="w-4 h-4" />新标签打开原图</span></Item>
      <div className="border-t border-rule my-1" />
      <Item onClick={onDelete} danger>
        <span className="inline-flex items-center gap-2"><Trash2 className="w-4 h-4" />删除图片</span>
      </Item>
      <button
        type="button"
        onMouseDown={stopEditorDefault}
        onPointerDown={stopEditorDefault}
        onClick={(e) => {
          stopEditorDefault(e);
          onClose();
        }}
        className="w-full text-left px-3 py-1.5 text-xs text-ink-faint hover:bg-paper-deep"
      >
        取消
      </button>
    </div>
  );
}

function ImageUrlDialog({
  value,
  onChange,
  onClose,
  onSubmit,
}: {
  value: string;
  onChange: (value: string) => void;
  onClose: () => void;
  onSubmit: () => void;
}) {
  return (
    <div
      onClick={onClose}
      onContextMenu={stopEditorDefault}
      className="fixed inset-0 z-[60] bg-ink/40 flex items-center justify-center p-4"
    >
      <div
        role="dialog"
        aria-modal="true"
        onClick={stopEditorPropagation}
        onMouseDown={stopEditorPropagation}
        onPointerDown={stopEditorPropagation}
        onContextMenu={stopEditorDefault}
        onSubmitCapture={stopEditorDefault}
        className="bg-background border border-ink w-full max-w-xl"
      >
        <div className="flex items-center justify-between border-b border-rule px-4 py-3">
          <p className="font-display text-lg font-semibold">替换为图片网址</p>
          <button type="button" onClick={onClose} className="text-ink-faint hover:text-vermilion">
            ✕
          </button>
        </div>
        <div className="space-y-3 p-4">
          <input
            value={value}
            onChange={(e) => onChange(e.target.value)}
            autoFocus
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                stopEditorDefault(e);
                onSubmit();
              }
            }}
            placeholder="https://example.com/image.jpg"
            className="w-full border border-ink px-3 py-2 bg-transparent focus:outline-none focus:border-vermilion"
          />
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="border border-ink/40 px-4 py-2 hover:bg-paper-deep"
            >
              取消
            </button>
            <button
              type="button"
              onClick={(e) => {
                stopEditorDefault(e);
                onSubmit();
              }}
              className="bg-ink text-background px-4 py-2 hover:bg-vermilion transition-colors"
            >
              替换
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ---------- Online image search (Wikimedia Commons) ---------- */

type WMResult = { title: string; thumb: string; url: string };
type ImgSrc = "iNaturalist" | "Wikimedia Commons";
type WMPage = {
  title: string;
  imageinfo?: Array<{ url?: string; thumburl?: string; mime?: string }>;
};
type WMContinue = { gsroffset?: number; continue?: string } | undefined;

const COMMONS_API = "https://commons.wikimedia.org/w/api.php";

const toCommonsUrl = (params: Record<string, string>) =>
  `${COMMONS_API}?${new URLSearchParams({ format: "json", origin: "*", ...params }).toString()}`;

const isUsableImage = (info?: { url?: string; mime?: string }) => {
  if (!info?.url) return false;
  return (
    /^image\/(jpeg|png|webp|gif)$/i.test(info.mime || "") ||
    /\.(jpe?g|png|webp|gif)(?:[?#].*)?$/i.test(info.url)
  );
};

const normalizeCommonsPages = (pages: WMPage[]) =>
  pages
    .filter((p) => isUsableImage(p.imageinfo?.[0]))
    .map((p) => ({
      title: p.title.replace(/^File:/, ""),
      thumb: p.imageinfo![0].thumburl || p.imageinfo![0].url!,
      url: p.imageinfo![0].url!,
    }));

const stringifyContinue = (next: NonNullable<WMContinue>) =>
  Object.fromEntries(Object.entries(next).map(([key, value]) => [key, String(value)]));

const dedupeResults = (items: WMResult[]) =>
  Array.from(new Map(items.map((item) => [item.url, item])).values());

async function searchINatRich(term: string): Promise<WMResult[]> {
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
  const out: WMResult[] = [];
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
        url: large,
      });
      if (out.length >= 30) break;
    }
    if (out.length >= 30) break;
  }
  return out;
}

function ImageSearchDialog({
  onClose,
  onPick,
}: {
  onClose: () => void;
  onPick: (url: string, alt: string) => void;
}) {
  const [q, setQ] = useState("");
  const [src, setSrc] = useState<ImgSrc>("iNaturalist");
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<WMResult[]>([]);

  const runSearch = async (query: string, source: ImgSrc = src) => {
    if (!query.trim()) return;
    setLoading(true);
    setResults([]);
    try {
      if (source === "iNaturalist") {
        const items = await searchINatRich(query.trim());
        setResults(items);
        if (items.length === 0) toast.message("未找到相关图片");
        return;
      }
      const params: Record<string, string> = {
        action: "query",
        prop: "imageinfo",
        generator: "search",
        gsrnamespace: "6",
        gsrlimit: "50",
        gsrsearch: query.trim(),
        iiprop: "url|mime",
        iiurlwidth: "320",
      };
      let next: WMContinue;
      const pages: WMPage[] = [];
      for (let i = 0; i < 8; i += 1) {
        const r = await fetch(
          toCommonsUrl(next ? { ...params, ...stringifyContinue(next) } : params),
          { headers: { Accept: "application/json" } },
        );
        if (!r.ok) throw new Error("bad response");
        const j = await r.json();
        pages.push(...(j?.query?.pages ? (Object.values(j.query.pages) as WMPage[]) : []));
        next = j?.continue as WMContinue;
        if (!next) break;
      }

      const items = dedupeResults(normalizeCommonsPages(pages));
      setResults(items);
      if (items.length === 0) toast.message("未找到相关图片");
    } catch {
      toast.error("搜索失败，请稍后重试");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      onClick={onClose}
      onContextMenu={stopEditorDefault}
      className="fixed inset-0 z-[60] bg-ink/40 flex items-center justify-center p-4"
    >
      <div
        onClick={stopEditorPropagation}
        onMouseDown={stopEditorPropagation}
        onPointerDown={stopEditorPropagation}
        onContextMenu={stopEditorDefault}
        onSubmitCapture={stopEditorDefault}
        className="bg-background border border-ink w-full max-w-3xl max-h-[85vh] flex flex-col"
      >
        <div className="flex items-center justify-between border-b border-rule px-4 py-3">
          <div>
            <p className="font-display text-lg font-semibold">在线搜索图片</p>
            <p className="text-xs text-ink-faint">
              来源：iNaturalist（物种照片，按 taxon 匹配）/ Wikimedia Commons（CC / 公共领域）
            </p>
          </div>
          <button type="button" onClick={onClose} className="text-ink-faint hover:text-vermilion">
            ✕
          </button>
        </div>
        <div className="flex flex-col gap-2 p-4 border-b border-rule">
          <div className="flex gap-1">
            {(["iNaturalist", "Wikimedia Commons"] as ImgSrc[]).map((s) => (
              <button
                key={s}
                type="button"
                onClick={(e) => {
                  stopEditorDefault(e);
                  setSrc(s);
                  if (q.trim()) runSearch(q, s);
                }}
                className={`px-3 py-1 text-xs border ${
                  src === s ? "bg-ink text-background border-ink" : "border-rule hover:border-ink"
                }`}
              >
                {s}
              </button>
            ))}
          </div>
          <div className="flex gap-2">
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            autoFocus
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                stopEditorDefault(e);
                runSearch(q);
              }
            }}
            placeholder="例：Butomus umbellatus、银杏、Ginkgo biloba…"
            className="flex-1 border border-ink px-3 py-2 bg-transparent focus:outline-none focus:border-vermilion"
          />
          <button
            type="button"
            onClick={(e) => {
              stopEditorDefault(e);
              runSearch(q);
            }}
            className="bg-ink text-background px-5 py-2 hover:bg-vermilion transition-colors"
          >
            搜索
          </button>
          </div>
        </div>
        <div className="flex-1 overflow-auto p-4">
          {loading ? (
            <p className="text-ink-faint text-center py-10">搜索中…</p>
          ) : results.length === 0 ? (
            <p className="text-ink-faint text-center py-10">输入关键词开始搜索</p>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
              {results.map((r) => (
                <button
                  key={r.url}
                  type="button"
                  onClick={(e) => {
                    stopEditorDefault(e);
                    onPick(r.url, r.title);
                  }}
                  className="group border border-rule hover:border-vermilion text-left"
                >
                  <div className="aspect-square bg-paper-deep overflow-hidden">
                    <img
                      src={r.thumb}
                      alt={r.title}
                      loading="lazy"
                      className="w-full h-full object-cover group-hover:opacity-90"
                    />
                  </div>
                  <p className="px-2 py-1 text-[11px] text-ink-faint truncate">{r.title}</p>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ---------- Toolbar ---------- */

function Toolbar({ editor, onPickImage }: { editor: Editor; onPickImage: () => void }) {
  const Btn = ({
    onClick,
    active,
    children,
    title,
  }: {
    onClick: () => void;
    active?: boolean;
    children: React.ReactNode;
    title: string;
  }) => (
    <button
      type="button"
      title={title}
      onClick={onClick}
      className={`px-2 py-1 text-sm border border-transparent hover:border-ink/30 ${active ? "bg-ink text-background" : ""}`}
    >
      {children}
    </button>
  );
  const setLink = () => {
    const prev = editor.getAttributes("link").href as string | undefined;
    const url = window.prompt("链接地址（留空可移除）：", prev ?? "https://");
    if (url === null) return;
    if (url === "") return editor.chain().focus().extendMarkRange("link").unsetLink().run();
    editor.chain().focus().extendMarkRange("link").setLink({ href: url }).run();
  };
  return (
    <div className="flex flex-wrap gap-1 border-b border-rule px-2 py-1.5 bg-paper-deep/40">
      <Btn
        title="加粗"
        active={editor.isActive("bold")}
        onClick={() => editor.chain().focus().toggleBold().run()}
      >
        <b>B</b>
      </Btn>
      <Btn
        title="斜体"
        active={editor.isActive("italic")}
        onClick={() => editor.chain().focus().toggleItalic().run()}
      >
        <i>I</i>
      </Btn>
      <Btn
        title="删除线"
        active={editor.isActive("strike")}
        onClick={() => editor.chain().focus().toggleStrike().run()}
      >
        <s>S</s>
      </Btn>
      <span className="w-px bg-rule mx-1" />
      <Btn
        title="标题 2"
        active={editor.isActive("heading", { level: 2 })}
        onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
      >
        H2
      </Btn>
      <Btn
        title="标题 3"
        active={editor.isActive("heading", { level: 3 })}
        onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
      >
        H3
      </Btn>
      <Btn
        title="正文"
        active={editor.isActive("paragraph")}
        onClick={() => editor.chain().focus().setParagraph().run()}
      >
        ¶
      </Btn>
      <span className="w-px bg-rule mx-1" />
      <Btn
        title="无序列表"
        active={editor.isActive("bulletList")}
        onClick={() => editor.chain().focus().toggleBulletList().run()}
      >
        • 列表
      </Btn>
      <Btn
        title="有序列表"
        active={editor.isActive("orderedList")}
        onClick={() => editor.chain().focus().toggleOrderedList().run()}
      >
        1. 列表
      </Btn>
      <Btn
        title="引用"
        active={editor.isActive("blockquote")}
        onClick={() => editor.chain().focus().toggleBlockquote().run()}
      >
        " "
      </Btn>
      <Btn title="分隔线" onClick={() => editor.chain().focus().setHorizontalRule().run()}>
        ―
      </Btn>
      <span className="w-px bg-rule mx-1" />
      <Btn title="链接" active={editor.isActive("link")} onClick={setLink}>
        🔗 链接
      </Btn>
      <Btn title="插入图片" onClick={onPickImage}>
        🖼 图片
      </Btn>
      <span className="w-px bg-rule mx-1" />
      <Btn title="撤销" onClick={() => editor.chain().focus().undo().run()}>
        ↶
      </Btn>
      <Btn title="重做" onClick={() => editor.chain().focus().redo().run()}>
        ↷
      </Btn>
    </div>
  );
}
