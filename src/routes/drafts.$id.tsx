import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { SiteHeader, SiteFooter } from "@/components/site-header";
import { fetchDraftById } from "@/lib/drafts";
import { approvePlantDraft, rejectPlantDraft } from "@/lib/identify-plant.functions";
import { useAuth } from "@/hooks/use-auth";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export const Route = createFileRoute("/drafts/$id")({
  component: DraftPage,
});

function DraftPage() {
  const { id } = Route.useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { user } = useAuth();
  const approveFn = useServerFn(approvePlantDraft);
  const rejectFn = useServerFn(rejectPlantDraft);
  const [busy, setBusy] = useState(false);

  const { data: draft, isLoading } = useQuery({
    queryKey: ["draft", id],
    queryFn: () => fetchDraftById(id),
  });

  const { data: isEditor = false } = useQuery({
    queryKey: ["is-editor", user?.id],
    enabled: !!user,
    queryFn: async () => {
      if (!user) return false;
      const { data } = await supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", user.id);
      return !!data?.some((r) => r.role === "editor" || r.role === "admin");
    },
  });

  const onApprove = async () => {
    setBusy(true);
    try {
      const res = await approveFn({ data: { draftId: id } });
      toast.success("已收录到本站");
      qc.invalidateQueries({ queryKey: ["home-all"] });
      qc.invalidateQueries({ queryKey: ["home-drafts"] });
      navigate({ to: "/plants/$slug", params: { slug: (res as { slug: string }).slug } });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "收录失败");
    } finally {
      setBusy(false);
    }
  };

  const onReject = async () => {
    if (!confirm("确定驳回这份草稿吗？")) return;
    setBusy(true);
    try {
      await rejectFn({ data: { draftId: id } });
      toast.success("已驳回");
      qc.invalidateQueries({ queryKey: ["home-drafts"] });
      navigate({ to: "/" });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "操作失败");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col">
      <SiteHeader />
      <main className="flex-1 w-full">
        {isLoading ? (
          <p className="text-center py-20 text-ink-faint">载入中…</p>
        ) : !draft ? (
          <p className="text-center py-20 text-ink-faint">草稿不存在或已被删除。</p>
        ) : (
          <>
            <div className="mx-auto max-w-5xl px-6 pt-6 flex flex-wrap items-center gap-3 text-sm">
              <Link to="/identify" className="label hover:text-vermilion">← 返回 AI 识别</Link>
              <span className="label text-vermilion">
                {draft.status === "pending" ? "待审核草稿" : draft.status === "approved" ? "已收录" : "已驳回"}
              </span>
              {isEditor && draft.status === "pending" && (
                <div className="ml-auto flex gap-2">
                  <button
                    onClick={onApprove}
                    disabled={busy}
                    className="bg-ink text-background px-4 py-1.5 text-sm hover:bg-vermilion transition-colors disabled:opacity-60"
                  >
                    {busy ? "处理中…" : "✓ 收录到本站"}
                  </button>
                  <button
                    onClick={onReject}
                    disabled={busy}
                    className="border border-rule text-ink-faint px-4 py-1.5 text-sm hover:border-ink hover:text-ink transition-colors disabled:opacity-60"
                  >
                    驳回
                  </button>
                </div>
              )}
              {draft.status === "approved" && draft.published_plant_id && (
                <Link to="/plants" className="ml-auto text-sm text-vermilion hover:underline">
                  浏览已收录 →
                </Link>
              )}
            </div>

            {/* Draft metadata: identifier / time / place / summary */}
            <section className="mx-auto max-w-5xl px-6 pt-6">
              <div className="border border-rule bg-paper-deep/30 p-5 md:p-6">
                <h1 className="font-display text-2xl md:text-3xl font-bold leading-tight">{draft.title}</h1>
                {draft.scientific_name && (
                  <p className="italic text-ink-faint mt-1">{draft.scientific_name}</p>
                )}
                <dl className="mt-4 grid grid-cols-1 sm:grid-cols-3 gap-x-6 gap-y-3 text-sm">
                  <div>
                    <dt className="label text-[10px] text-ink-faint">识别人</dt>
                    <dd className="mt-0.5">{draft.creator_label || "访客"}</dd>
                  </div>
                  <div>
                    <dt className="label text-[10px] text-ink-faint">识别时间</dt>
                    <dd className="mt-0.5">{new Date(draft.created_at).toLocaleString("zh-CN")}</dd>
                  </div>
                  <div>
                    <dt className="label text-[10px] text-ink-faint">识别地点</dt>
                    <dd className="mt-0.5 inline-flex items-center gap-1">
                      <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <path d="M12 21s-7-6.2-7-11a7 7 0 0 1 14 0c0 4.8-7 11-7 11Z"/>
                        <circle cx="12" cy="10" r="2.6"/>
                      </svg>
                      <span>{draft.capture_place || "未知地点"}</span>
                      {draft.capture_lat != null && draft.capture_lng != null && (
                        <span className="text-ink-faint text-xs">
                          ({draft.capture_lat.toFixed(4)}, {draft.capture_lng.toFixed(4)})
                        </span>
                      )}
                    </dd>
                  </div>
                </dl>
                {draft.summary && (
                  <div className="mt-4">
                    <dt className="label text-[10px] text-ink-faint">摘要 · Summary</dt>
                    <p className="mt-1.5 text-ink-soft leading-relaxed">{draft.summary}</p>
                  </div>
                )}
                {draft.tags && draft.tags.length > 0 && (
                  <div className="mt-4 flex flex-wrap gap-2">
                    {draft.tags.map((t) => (
                      <span key={t} className="text-xs border border-rule px-2 py-0.5 text-ink-faint">#{t}</span>
                    ))}
                  </div>
                )}
              </div>
            </section>

            {/* Render AI-generated HTML directly */}
            <iframe
              title={draft.title}
              srcDoc={draft.html_content}
              className="w-full border-0 mt-6"
              style={{ minHeight: "calc(100vh - 200px)" }}
            />
          </>
        )}
      </main>
      <SiteFooter />
    </div>
  );
}
