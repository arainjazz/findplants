import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { compressImage, extForMime } from "@/lib/image-compress";
import { useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import { useAuth } from "@/hooks/use-auth";
import { supabase } from "@/integrations/supabase/client";
import { BlockEditor } from "@/components/block-editor";
import { createPost, updatePost, firstImageSrc, type BlogPost } from "@/lib/blog";

export function BlogEditor({ initial }: { initial?: BlogPost }) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const coverInputRef = useRef<HTMLInputElement>(null);

  const [title, setTitle] = useState(initial?.title ?? "");
  const [subtitle, setSubtitle] = useState(initial?.subtitle ?? "");
  const [coverUrl, setCoverUrl] = useState(initial?.cover_url ?? "");
  const [html, setHtml] = useState(initial?.content_html ?? "");
  const [busy, setBusy] = useState(false);

  // Auto-resize title textarea
  const titleRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const el = titleRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [title]);

  const uploadCover = async (file: File) => {
    if (!user) return;
    setBusy(true);
    try {
      let fileToUpload: Blob | File = file;
      try {
        fileToUpload = await compressImage(file);
      } catch (err) {
        console.error("Image compression failed, using original:", err);
      }

      const ext = extForMime(fileToUpload.type, file.name.split(".").pop() || "jpg");
      const path = `${user.id}/blog-cover/${Date.now()}.${ext}`;
      const { error } = await supabase.storage
        .from("plant-images")
        .upload(path, fileToUpload, { upsert: false, contentType: fileToUpload.type });
      if (error) throw error;
      const url = supabase.storage.from("plant-images").getPublicUrl(path).data
        .publicUrl;
      setCoverUrl(url);
      toast.success("封面已上传");
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  // Best-effort: record a publish in the edit log so the owner sees it.
  const logBlogPublish = async (postId: string, t: string) => {
    if (!user) return;
    try {
      await supabase.from("plant_edits").insert({
        plant_id: null,
        editor_id: user.id,
        editor_name: (user.user_metadata?.full_name as string) || user.email || "编辑",
        kind: "blog_publish",
        marker_n: 0,
        block_path: postId, // target id for revert (unpublish)
        source: "blog",
        summary: `发布博文：${t}`,
      });
    } catch {
      /* logging is best-effort */
    }
  };

  // Record an edit to an existing post (content/title/cover changed) so it shows
  // in 修改记录. Carries before/after HTML for the diff viewer + image thumbnails.
  const logBlogEdit = async (postId: string, t: string, beforeHtml: string, afterHtml: string) => {
    if (!user) return;
    try {
      await supabase.from("plant_edits").insert({
        plant_id: null,
        editor_id: user.id,
        editor_name: (user.user_metadata?.full_name as string) || user.email || "编辑",
        kind: "blog_edit",
        marker_n: 0,
        block_path: postId,
        source: "blog",
        summary: `编辑博文：${t}`,
        before_html: beforeHtml,
        after_html: afterHtml,
      });
    } catch {
      /* logging is best-effort */
    }
  };

  const save = async (publish: boolean) => {
    if (!user) return toast.error("请先登录");
    if (!title.trim()) return toast.error("请输入标题");
    setBusy(true);
    try {
      const authorName =
        (user.user_metadata?.full_name as string) || user.email || "作者";
      if (initial) {
        const changed =
          html !== (initial.content_html ?? "") ||
          title.trim() !== (initial.title ?? "") ||
          (subtitle.trim() || null) !== (initial.subtitle ?? null) ||
          (coverUrl.trim() || null) !== (initial.cover_url ?? null);
        const next = await updatePost(initial.id, {
          title: title.trim(),
          subtitle: subtitle.trim() || null,
          cover_url: coverUrl.trim() || null,
          content_html: html,
          published: publish || initial.published,
        });
        toast.success(publish ? "已发布" : "已保存");
        if (publish && !initial.published) await logBlogPublish(next.id, next.title);
        else if (changed) await logBlogEdit(next.id, next.title, initial.content_html ?? "", html);
        if (publish) navigate({ to: "/blog/$slug", params: { slug: next.slug } });
      } else {
        const post = await createPost({
          title: title.trim(),
          subtitle: subtitle.trim() || null,
          cover_url: coverUrl.trim() || null,
          content_html: html,
          publish,
          authorId: user.id,
          authorName,
        });
        toast.success(publish ? "已发布" : "草稿已保存");
        if (publish) await logBlogPublish(post.id, post.title);
        if (publish) navigate({ to: "/blog/$slug", params: { slug: post.slug } });
        else navigate({ to: "/admin/blog/edit/$id", params: { id: post.id } });
      }
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="max-w-3xl mx-auto">
      {/* Notion-style: minimal chrome, big airy title */}
      <div className="mb-6">
        {coverUrl ? (
          <div className="relative group mb-8 -mx-6 md:-mx-12">
            <img
              src={coverUrl}
              alt=""
              className="w-full max-h-[280px] object-cover"
            />
            <div className="absolute top-2 right-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
              <button
                onClick={() => coverInputRef.current?.click()}
                className="text-xs bg-background/90 border border-ink/40 px-2 py-1 hover:bg-background"
              >
                更换
              </button>
              <button
                onClick={() => setCoverUrl("")}
                className="text-xs bg-background/90 border border-ink/40 px-2 py-1 hover:bg-background"
              >
                移除
              </button>
            </div>
          </div>
        ) : null}
        <input
          ref={coverInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) uploadCover(f);
            e.target.value = "";
          }}
        />
        <textarea
          ref={titleRef}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="无标题"
          rows={1}
          className="w-full resize-none font-display text-5xl font-bold leading-tight bg-transparent border-none outline-none placeholder:text-ink-faint/40 mb-2"
        />
        <input
          value={subtitle}
          onChange={(e) => setSubtitle(e.target.value)}
          placeholder="副标题（可选）"
          className="w-full text-lg text-ink-soft bg-transparent border-none outline-none placeholder:text-ink-faint/40 mb-3"
        />
        <CoverControl
          coverUrl={coverUrl}
          fallback={firstImageSrc(html)}
          onUpload={() => coverInputRef.current?.click()}
          onUseFirstImage={() => {
            setCoverUrl("");
            toast.success("封面将默认使用正文第一张图");
          }}
        />
      </div>

      <BlockEditor
        initialHTML={initial?.content_html ?? ""}
        onChange={setHtml}
        uploadFile={async (file) => {
          let f: Blob | File = file;
          try {
            f = await compressImage(file);
          } catch {
            /* use original on compress failure */
          }
          const ext = extForMime(f.type, file.name.split(".").pop() || "jpg");
          const path = `${user!.id}/blog/${Date.now()}-${Math.random().toString(36).slice(2, 6)}.${ext}`;
          const { error } = await supabase.storage
            .from("plant-images")
            .upload(path, f, { upsert: false, contentType: f.type });
          if (error) throw error;
          return supabase.storage.from("plant-images").getPublicUrl(path).data.publicUrl;
        }}
        placeholder="输入 / 唤出命令菜单，像 Notion 一样写作…"
      />

      <div className="mt-6 flex items-center justify-end gap-3 sticky bottom-4 bg-background/90 backdrop-blur border border-rule p-3 z-10">
        <button
          onClick={() => save(false)}
          disabled={busy}
          className="border border-ink/40 px-4 py-2 text-sm hover:bg-paper-deep disabled:opacity-60"
        >
          {busy ? "保存中…" : initial ? "保存" : "保存为草稿"}
        </button>
        <button
          onClick={() => save(true)}
          disabled={busy}
          className="bg-ink text-background px-5 py-2 text-sm hover:bg-vermilion transition-colors disabled:opacity-60"
        >
          {initial?.published ? "更新发布" : "发布"}
        </button>
      </div>
    </div>
  );
}

function CoverControl({
  coverUrl,
  fallback,
  onUpload,
  onUseFirstImage,
}: {
  coverUrl: string;
  fallback: string | null;
  onUpload: () => void;
  onUseFirstImage: () => void;
}) {
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    window.addEventListener("click", close);
    return () => window.removeEventListener("click", close);
  }, [menu]);
  const effective = coverUrl || fallback || null;
  return (
    <div className="mb-6">
      <div
        onClick={onUpload}
        onContextMenu={(e) => {
          e.preventDefault();
          setMenu({ x: e.clientX, y: e.clientY });
        }}
        title="点击上传 / 替换封面；右键查看更多选项"
        className="inline-flex items-center gap-3 border border-rule bg-paper-deep/30 px-3 py-2 cursor-pointer hover:border-ink transition-colors select-none"
      >
        <div className="w-16 h-11 border border-rule bg-background overflow-hidden flex items-center justify-center shrink-0">
          {effective ? (
            <img src={effective} alt="封面预览" className="w-full h-full object-cover" />
          ) : (
            <span className="text-ink-faint text-[10px]">无图</span>
          )}
        </div>
        <div className="text-xs leading-tight">
          <p className="font-semibold text-ink">封面图</p>
          <p className="text-ink-faint mt-0.5">
            {coverUrl ? "自定义封面（点击替换）" : fallback ? "默认：正文第一张图" : "点击选择，或右键更多"}
          </p>
        </div>
      </div>
      {menu &&
        createPortal(
          <div
            onClick={(e) => e.stopPropagation()}
            style={{ position: "fixed", left: Math.min(menu.x, window.innerWidth - 200), top: menu.y, width: 188, zIndex: 60 }}
            className="bg-background border border-ink shadow-lg py-1 text-sm"
          >
            <button type="button" onClick={() => { setMenu(null); onUpload(); }} className="w-full text-left px-3 py-2 hover:bg-paper-deep">
              上传 / 替换封面
            </button>
            <button type="button" onClick={() => { setMenu(null); onUseFirstImage(); }} className="w-full text-left px-3 py-2 hover:bg-paper-deep">
              用正文首图作封面
            </button>
          </div>,
          document.body,
        )}
    </div>
  );
}