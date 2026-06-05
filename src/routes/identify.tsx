import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { SiteHeader, SiteFooter } from "@/components/site-header";
import { CameraIdentify } from "@/components/camera-identify";
import { DraftCard } from "@/components/draft-card";
import { fetchPendingDrafts } from "@/lib/drafts";
import { useAuth } from "@/hooks/use-auth";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/identify")({
  head: () => ({
    meta: [
      { title: "AI 识别植物 · Plantspedia" },
      { name: "description", content: "上传或拍摄一张植物照片，由 AI 识别物种并自动生成中英双语草稿。" },
    ],
  }),
  component: IdentifyPage,
});

function IdentifyPage() {
  const { user } = useAuth();

  const { data: isEditorOrAdmin = false } = useQuery({
    queryKey: ["is-editor-or-admin", user?.id],
    enabled: !!user,
    queryFn: async () => {
      if (!user) return false;
      if (user.id === "owner-admin-id") return true;
      const { data } = await supabase.from("user_roles").select("role").eq("user_id", user.id);
      return !!data?.some((r) => r.role === "editor" || r.role === "admin");
    },
  });

  const { data: drafts = [] } = useQuery({
    queryKey: ["identify-drafts-all"],
    queryFn: () => fetchPendingDrafts(200),
    enabled: isEditorOrAdmin,
  });

  return (
    <div className="min-h-screen flex flex-col">
      <SiteHeader />
      <main className="mx-auto max-w-6xl px-6 py-10 flex-1 w-full">
        <header className="mb-8 border-b-2 border-ink pb-6">
          <p className="label text-vermilion mb-2">AI copilot · Plantspedia</p>
          <h1 className="font-display text-3xl md:text-5xl font-bold tracking-tight">AI 识别植物</h1>
          <p className="text-ink-soft mt-3 max-w-none">
            拍一张照片或从相册选择，AI 会自动识别物种并生成一份中英双语科普草稿，等待编辑审核后正式收录。
          </p>
        </header>

        <CameraIdentify />

        {isEditorOrAdmin && (
          <section className="mt-12 border-t border-rule pt-8">
            <div className="flex items-baseline justify-between mb-4">
              <div>
                <p className="label text-vermilion">待审草稿 · Pending AI Drafts</p>
                <p className="text-xs text-ink-faint mt-1">仅编辑与管理员可见，点击右上角红色按钮进入详情审核</p>
              </div>
              <span className="text-xs text-ink-faint">{drafts.length} 份待审</span>
            </div>
            {drafts.length === 0 ? (
              <p className="text-ink-faint text-sm py-12 text-center border border-dashed border-rule">
                目前没有待审草稿。
              </p>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {drafts.map((d) => (
                  <DraftCard key={d.id} draft={d} showPendingBadge />
                ))}
              </div>
            )}
          </section>
        )}

        {!isEditorOrAdmin && (
          <p className="text-xs text-ink-faint mt-10 text-center">
            草稿提交后会进入编辑审核队列，通过后将公开收录在站点档案中。
            {!user && (
              <>
                {" · "}
                <Link to="/login" className="hover:text-vermilion underline">编辑登录</Link>
              </>
            )}
          </p>
        )}
      </main>
      <SiteFooter />
    </div>
  );
}
