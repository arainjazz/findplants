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
  parent_id?: string | null;
};

export function PlantComments({ plantId }: { plantId: string }) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [body, setBody] = useState("");
  const [posting, setPosting] = useState(false);
  const [replyTo, setReplyTo] = useState<string | null>(null);

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

  const resolveName = () =>
    (user?.user_metadata?.full_name as string) ||
    (user?.user_metadata?.name as string) ||
    user?.email ||
    name.trim() ||
    null;

  // Insert a comment or reply. Replies set parent_id; if that column doesn't
  // exist yet, fall back to a flat comment that @-mentions the parent author.
  const postComment = async (
    text: string,
    parentId: string | null,
    parentAuthor?: string | null,
  ): Promise<string | null> => {
    const base = { plant_id: plantId, author_id: user?.id ?? null, author_name: resolveName() };
    if (parentId) {
      const res = await (supabase.from("plant_comments") as unknown as {
        insert: (v: Record<string, unknown>) => Promise<{ error: { message: string } | null }>;
      }).insert({ ...base, body: text, parent_id: parentId });
      if (!res.error) return null;
      // Fallback: parent_id column missing → post flat with @mention.
      const { error } = await supabase
        .from("plant_comments")
        .insert({ ...base, body: parentAuthor ? `回复 @${parentAuthor}：${text}` : text });
      return error ? error.message : null;
    }
    const { error } = await supabase.from("plant_comments").insert({ ...base, body: text });
    return error ? error.message : null;
  };

  const onPostTop = async () => {
    const text = body.trim();
    if (!text) return toast.error("请填写评论内容");
    if (text.length > 4000) return toast.error("评论过长（4000 字以内）");
    setPosting(true);
    const err = await postComment(text, null);
    setPosting(false);
    if (err) return toast.error(err);
    setBody("");
    setName("");
    toast.success("评论已发布");
    qc.invalidateQueries({ queryKey: ["plant-comments", plantId] });
  };

  const onReplySubmit = async (parent: Comment, text: string): Promise<boolean> => {
    const err = await postComment(text, parent.id, parent.author_name);
    if (err) {
      toast.error(err);
      return false;
    }
    toast.success("回复已发布");
    setReplyTo(null);
    qc.invalidateQueries({ queryKey: ["plant-comments", plantId] });
    return true;
  };

  const onDelete = async (c: Comment) => {
    if (!confirm("删除这条评论？")) return;
    const { error } = await supabase.from("plant_comments").delete().eq("id", c.id);
    if (error) return toast.error(error.message);
    toast.success("已删除");
    qc.invalidateQueries({ queryKey: ["plant-comments", plantId] });
  };

  const topLevel = comments.filter((c) => !c.parent_id);
  const repliesByParent = new Map<string, Comment[]>();
  for (const c of comments) {
    if (!c.parent_id) continue;
    if (!repliesByParent.has(c.parent_id)) repliesByParent.set(c.parent_id, []);
    repliesByParent.get(c.parent_id)!.push(c);
  }
  for (const list of repliesByParent.values())
    list.sort((a, b) => +new Date(a.created_at) - +new Date(b.created_at));

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
            onClick={onPostTop}
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
        {topLevel.map((c) => (
          <div key={c.id}>
            <CommentItem
              comment={c}
              canDelete={!!user && user.id === c.author_id}
              onDelete={() => onDelete(c)}
              canReply={!!user}
              onReplyClick={() => setReplyTo(replyTo === c.id ? null : c.id)}
            />
            {replyTo === c.id && (
              <ReplyForm
                onCancel={() => setReplyTo(null)}
                onSubmit={(text) => onReplySubmit(c, text)}
              />
            )}
            {(repliesByParent.get(c.id) ?? []).length > 0 && (
              <div className="ml-6 mt-3 space-y-3 border-l-2 border-rule-soft pl-4">
                {(repliesByParent.get(c.id) ?? []).map((r) => (
                  <CommentItem
                    key={r.id}
                    comment={r}
                    canDelete={!!user && user.id === r.author_id}
                    onDelete={() => onDelete(r)}
                  />
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}

function CommentItem({
  comment,
  canDelete,
  onDelete,
  canReply,
  onReplyClick,
}: {
  comment: Comment;
  canDelete: boolean;
  onDelete: () => void;
  canReply?: boolean;
  onReplyClick?: () => void;
}) {
  return (
    <article className="border-b border-rule-soft pb-4">
      <header className="flex items-center justify-between text-xs text-ink-faint mb-1">
        <span className="font-semibold text-ink">{comment.author_name || "匿名访客"}</span>
        <span>{new Date(comment.created_at).toLocaleString("zh-CN")}</span>
      </header>
      <CommentBody body={comment.body} />
      <div className="mt-1 flex justify-end gap-3">
        {canReply && onReplyClick && (
          <button onClick={onReplyClick} className="text-xs text-ink-faint hover:text-vermilion">
            回复
          </button>
        )}
        {canDelete && (
          <button onClick={onDelete} className="text-xs text-destructive hover:underline">
            删除
          </button>
        )}
      </div>
    </article>
  );
}

function ReplyForm({
  onSubmit,
  onCancel,
}: {
  onSubmit: (text: string) => Promise<boolean>;
  onCancel: () => void;
}) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <div className="ml-6 mt-2 border border-rule bg-paper-deep/20 p-3 space-y-2">
      <textarea
        rows={3}
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="写下你的回复…"
        className="w-full border border-ink/40 bg-background px-3 py-2 text-sm focus:outline-none focus:border-vermilion"
      />
      <div className="flex justify-end gap-2">
        <button onClick={onCancel} className="text-xs border border-rule px-3 py-1 hover:border-ink">
          取消
        </button>
        <button
          disabled={busy}
          onClick={async () => {
            const t = text.trim();
            if (!t) return toast.error("请填写回复内容");
            setBusy(true);
            const ok = await onSubmit(t);
            setBusy(false);
            if (ok) setText("");
          }}
          className="text-xs bg-ink text-background px-3 py-1 hover:bg-vermilion transition-colors disabled:opacity-60"
        >
          {busy ? "发布中…" : "发布回复"}
        </button>
      </div>
    </div>
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
