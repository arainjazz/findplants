import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { toast } from "sonner";
import { videoEmbedHtml } from "@/lib/embed";

type Comment = {
  id: string;
  plant_id: string;
  author_id: string | null;
  author_name: string | null;
  body: string;
  created_at: string;
};

export function PlantComments({ plantId }: { plantId: string }) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [body, setBody] = useState("");
  const [posting, setPosting] = useState(false);

  const { data: comments = [], isLoading } = useQuery({
    queryKey: ["plant-comments", plantId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("plant_comments")
        .select("*")
        .eq("plant_id", plantId)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as Comment[];
    },
  });

  const onPost = async () => {
    const text = body.trim();
    if (!text) return toast.error("请填写评论内容");
    if (text.length > 4000) return toast.error("评论过长（4000 字以内）");
    setPosting(true);
    const authorName =
      (user?.user_metadata?.full_name as string) ||
      (user?.user_metadata?.name as string) ||
      user?.email ||
      name.trim() ||
      null;
    const { error } = await supabase.from("plant_comments").insert({
      plant_id: plantId,
      author_id: user?.id ?? null,
      author_name: authorName,
      body: text,
    });
    setPosting(false);
    if (error) return toast.error(error.message);
    setBody("");
    setName("");
    toast.success("评论已发布");
    qc.invalidateQueries({ queryKey: ["plant-comments", plantId] });
  };

  const onDelete = async (c: Comment) => {
    if (!confirm("删除这条评论？")) return;
    const { error } = await supabase.from("plant_comments").delete().eq("id", c.id);
    if (error) return toast.error(error.message);
    toast.success("已删除");
    qc.invalidateQueries({ queryKey: ["plant-comments", plantId] });
  };

  return (
    <section className="mt-12 border-t-2 border-ink pt-8">
      <h2 className="font-display text-2xl font-bold mb-1">Write Comments · 写评论</h2>
      <p className="text-xs text-ink-faint mb-4">
        欢迎留下你的看法。粘贴 YouTube / Vimeo / Bilibili / .mp4 链接，将自动嵌入播放窗口。
      </p>
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
          rows={4}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="写下评论… 视频链接（YouTube / Vimeo / Bilibili / .mp4）将自动嵌入播放窗口"
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

      <div className="mt-6 space-y-5">
        {isLoading && <p className="text-ink-faint text-sm">载入中…</p>}
        {!isLoading && comments.length === 0 && (
          <p className="text-ink-faint text-sm italic">No comment yet</p>
        )}
        {comments.map((c) => (
          <CommentItem key={c.id} comment={c} canDelete={!!user && (user.id === c.author_id)} onDelete={() => onDelete(c)} />
        ))}
      </div>
    </section>
  );
}

function CommentItem({
  comment,
  canDelete,
  onDelete,
}: {
  comment: Comment;
  canDelete: boolean;
  onDelete: () => void;
}) {
  return (
    <article className="border-b border-rule-soft pb-4">
      <header className="flex items-center justify-between text-xs text-ink-faint mb-1">
        <span className="font-semibold text-ink">{comment.author_name || "匿名访客"}</span>
        <span>{new Date(comment.created_at).toLocaleString("zh-CN")}</span>
      </header>
      <CommentBody body={comment.body} />
      {canDelete && (
        <div className="mt-1 text-right">
          <button onClick={onDelete} className="text-xs text-destructive hover:underline">
            删除
          </button>
        </div>
      )}
    </article>
  );
}

/**
 * Render comment text. Auto-embeds recognized video URLs in a player frame,
 * preserving surrounding text. Non-video URLs become normal links.
 */
function CommentBody({ body }: { body: string }) {
  const URL_RE = /https?:\/\/[^\s]+/g;
  const parts: React.ReactNode[] = [];
  let cursor = 0;
  let i = 0;
  let m: RegExpExecArray | null;
  URL_RE.lastIndex = 0;
  while ((m = URL_RE.exec(body))) {
    const url = m[0];
    const idx = m.index;
    if (idx > cursor) parts.push(<span key={`t${i++}`}>{body.slice(cursor, idx)}</span>);
    const embed = videoEmbedHtml(url);
    if (embed) {
      parts.push(<div key={`v${i++}`} dangerouslySetInnerHTML={{ __html: embed }} />);
    } else {
      parts.push(
        <a key={`a${i++}`} href={url} target="_blank" rel="noreferrer noopener" className="text-vermilion underline break-all">
          {url}
        </a>,
      );
    }
    cursor = idx + url.length;
  }
  if (cursor < body.length) parts.push(<span key={`t${i++}`}>{body.slice(cursor)}</span>);
  return <div className="text-sm whitespace-pre-wrap leading-relaxed">{parts}</div>;
}
