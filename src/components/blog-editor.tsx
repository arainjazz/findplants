import { useEffect, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import { useAuth } from "@/hooks/use-auth";
import { supabase } from "@/integrations/supabase/client";
import { RichEditor } from "@/components/rich-editor";
import { createPost, updatePost, type BlogPost } from "@/lib/blog";

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
      const ext = file.name.split(".").pop() || "jpg";
      const path = `${user.id}/blog-cover/${Date.now()}.${ext}`;
      const { error } = await supabase.storage
        .from("plant-images")
        .upload(path, file, { upsert: false, contentType: file.type });
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

  const save = async (publish: boolean) => {
    if (!user) return toast.error("请先登录");
    if (!title.trim()) return toast.error("请输入标题");
    setBusy(true);
    try {
      const authorName =
        (user.user_metadata?.full_name as string) || user.email || "作者";
      if (initial) {
        const next = await updatePost(initial.id, {
          title: title.trim(),
          subtitle: subtitle.trim() || null,
          cover_url: coverUrl.trim() || null,
          content_html: html,
          published: publish || initial.published,
        });
        toast.success(publish ? "已发布" : "已保存");
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
        ) : (
          <button
            type="button"
            onClick={() => coverInputRef.current?.click()}
            className="text-xs text-ink-faint hover:text-vermilion mb-4"
          >
            + 添加封面图
          </button>
        )}
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
          className="w-full text-lg text-ink-soft bg-transparent border-none outline-none placeholder:text-ink-faint/40 mb-6"
        />
      </div>

      <RichEditor value={html} onChange={setHtml} />

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