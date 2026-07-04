import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { isCurrentUserAdmin } from "@/lib/edits";
import { toast } from "sonner";

type BlogComment = {
  id: string;
  blog_id: string;
  author_id: string | null;
  author_name: string | null;
  body: string;
  likes: number;
  pinned: boolean;
  created_at: string;
};

const likedKey = (id: string) => `pp-bloglike:${id}`;

/**
 * Comments under a blog post. Visitors can like (flat thumbs-up + count); the
 * post author and site admin can pin or delete any comment. Requires the
 * `blog_comments` table + `like_blog_comment` RPC — if absent the section shows
 * a hint instead of crashing.
 */
export function BlogComments({ postId, postAuthorId }: { postId: string; postAuthorId: string }) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [body, setBody] = useState("");
  const [posting, setPosting] = useState(false);

  const { data: isAdmin = false } = useQuery({
    queryKey: ["is-admin", user?.id],
    enabled: !!user,
    queryFn: () => isCurrentUserAdmin(user?.id),
  });

  const { data, isLoading } = useQuery({
    queryKey: ["blog-comments", postId],
    queryFn: async () => {
      const res = await supabase
        .from("blog_comments" as never)
        .select("*")
        .eq("blog_id", postId)
        .order("pinned", { ascending: false })
        .order("created_at", { ascending: false });
      if (res.error) return { rows: [] as BlogComment[], unavailable: true };
      return { rows: (res.data ?? []) as unknown as BlogComment[], unavailable: false };
    },
  });
  const comments = data?.rows ?? [];
  const unavailable = data?.unavailable;

  const canModerate = !!user && (isAdmin || user.id === postAuthorId);

  const onPost = async () => {
    const text = body.trim();
    if (!text) return toast.error("请填写评论内容");
    setPosting(true);
    const authorName =
      (user?.user_metadata?.full_name as string) || user?.email || name.trim() || null;
    const { error } = await supabase
      .from("blog_comments" as never)
      .insert({ blog_id: postId, author_id: user?.id ?? null, author_name: authorName, body: text } as never);
    setPosting(false);
    if (error) return toast.error(error.message);
    setBody("");
    setName("");
    toast.success("评论已发布");
    qc.invalidateQueries({ queryKey: ["blog-comments", postId] });
  };

  const onLike = async (c: BlogComment) => {
    let alreadyLiked = false;
    try {
      alreadyLiked = !!localStorage.getItem(likedKey(c.id));
    } catch {
      /* ignore */
    }
    if (alreadyLiked) return toast.message("你已经点过赞啦");
    try {
      localStorage.setItem(likedKey(c.id), "1");
    } catch {
      /* ignore */
    }
    const { error } = await supabase.rpc("like_blog_comment" as never, { c_id: c.id } as never);
    if (error) {
      try {
        localStorage.removeItem(likedKey(c.id));
      } catch {
        /* ignore */
      }
      return toast.error("点赞失败");
    }
    qc.invalidateQueries({ queryKey: ["blog-comments", postId] });
  };

  const onTogglePin = async (c: BlogComment) => {
    const { error } = await supabase
      .from("blog_comments" as never)
      .update({ pinned: !c.pinned } as never)
      .eq("id", c.id);
    if (error) return toast.error(error.message);
    toast.success(c.pinned ? "已取消置顶" : "已置顶");
    qc.invalidateQueries({ queryKey: ["blog-comments", postId] });
  };

  const onDelete = async (c: BlogComment) => {
    if (!confirm("删除这条评论？")) return;
    const { error } = await supabase.from("blog_comments" as never).delete().eq("id", c.id);
    if (error) return toast.error(error.message);
    toast.success("已删除");
    qc.invalidateQueries({ queryKey: ["blog-comments", postId] });
  };

  return (
    <section className="mt-12 border-t-2 border-ink pt-8">
      <h2 className="font-display text-2xl font-bold mb-4">评论 · Comments</h2>

      {unavailable ? (
        <p className="text-sm text-ink-faint italic">评论功能即将开启。</p>
      ) : (
        <>
          <div className="border border-ink p-4 bg-paper-deep/30 space-y-3">
            {!user && (
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="昵称（可选）"
                maxLength={80}
                className="w-full border border-ink/40 bg-background px-3 py-2 text-sm focus:outline-none focus:border-vermilion"
              />
            )}
            <textarea
              rows={3}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder="写下你的评论…"
              className="w-full border border-ink bg-background px-3 py-2 text-sm focus:outline-none focus:border-vermilion"
            />
            <div className="flex justify-end">
              <button
                type="button"
                onClick={onPost}
                disabled={posting}
                className="bg-ink text-background px-5 py-2 hover:bg-vermilion transition-colors disabled:opacity-60"
              >
                {posting ? "发布中…" : "发布评论"}
              </button>
            </div>
          </div>

          <div className="mt-6 space-y-4">
            {isLoading && <p className="text-ink-faint text-sm">载入中…</p>}
            {!isLoading && comments.length === 0 && (
              <p className="text-ink-faint text-sm italic">还没有评论，来做第一个吧。</p>
            )}
            {comments.map((c) => {
              let liked = false;
              try {
                liked = !!localStorage.getItem(likedKey(c.id));
              } catch {
                /* ignore */
              }
              return (
                <article key={c.id} className={`border-b border-rule-soft pb-3 ${c.pinned ? "bg-vermilion/5 -mx-2 px-2 rounded" : ""}`}>
                  <header className="flex items-center justify-between text-xs text-ink-faint mb-1">
                    <span className="font-semibold text-ink inline-flex items-center gap-1.5">
                      {c.pinned && <span className="text-[10px] bg-vermilion text-background px-1 rounded">置顶</span>}
                      {c.author_name || "匿名访客"}
                    </span>
                    <span>{new Date(c.created_at).toLocaleString("zh-CN")}</span>
                  </header>
                  <p className="text-sm whitespace-pre-wrap leading-relaxed">{c.body}</p>
                  <div className="mt-1.5 flex items-center gap-4 text-xs">
                    <button
                      onClick={() => onLike(c)}
                      className={`inline-flex items-center gap-1 transition-colors ${liked ? "text-vermilion" : "text-ink-faint hover:text-vermilion"}`}
                      title="点赞"
                    >
                      <ThumbIcon className="w-4 h-4" />
                      <span>{c.likes ?? 0}</span>
                    </button>
                    {canModerate && (
                      <>
                        <button onClick={() => onTogglePin(c)} className="text-ink-faint hover:text-vermilion">
                          {c.pinned ? "取消置顶" : "置顶"}
                        </button>
                        <button onClick={() => onDelete(c)} className="text-destructive hover:underline">
                          删除
                        </button>
                      </>
                    )}
                    {!canModerate && !!user && user.id === c.author_id && (
                      <button onClick={() => onDelete(c)} className="text-destructive hover:underline">
                        删除
                      </button>
                    )}
                  </div>
                </article>
              );
            })}
          </div>
        </>
      )}
    </section>
  );
}

function ThumbIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <path d="M7 10v11" />
      <path d="M5 21h11.5a2 2 0 0 0 2-1.7l1.3-8A2 2 0 0 0 17.8 9H13l.8-4.2a1.6 1.6 0 0 0-3-1L7 10" />
    </svg>
  );
}
