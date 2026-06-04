import { Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import { isCurrentUserAdmin } from "@/lib/edits";
import { supabase } from "@/integrations/supabase/client";
import { AdminExportButton } from "@/components/admin-export-button";
import logoUrl from "@/assets/logo.png";

export function SiteHeader() {
  const { user, signOut } = useAuth();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [q, setQ] = useState("");

  const { data: isAdmin = false } = useQuery({
    queryKey: ["is-admin", user?.id],
    queryFn: () => isCurrentUserAdmin(user?.id),
    enabled: !!user,
  });

  // Anyone with editor or admin role gets the pending drafts notification.
  const { data: isEditorOrAdmin = false } = useQuery({
    queryKey: ["is-editor-or-admin", user?.id],
    enabled: !!user,
    queryFn: async () => {
      if (!user) return false;
      const { data } = await supabase.from("user_roles").select("role").eq("user_id", user.id);
      return !!data?.some((r) => r.role === "editor" || r.role === "admin");
    },
  });

  const { data: pendingCount = 0 } = useQuery({
    queryKey: ["pending-applications-count"],
    queryFn: async () => {
      const { count } = await supabase
        .from("editor_applications")
        .select("id", { count: "exact", head: true })
        .eq("status", "pending");
      return count ?? 0;
    },
    enabled: isAdmin,
    refetchInterval: 30000,
  });

  const { data: pendingDraftCount = 0 } = useQuery({
    queryKey: ["pending-drafts-count"],
    queryFn: async () => {
      const { count } = await supabase
        .from("plant_drafts")
        .select("id", { count: "exact", head: true })
        .eq("status", "pending");
      return count ?? 0;
    },
    enabled: isEditorOrAdmin,
    refetchInterval: 30000,
  });

  useEffect(() => {
    if (!isAdmin) return;
    const ch = supabase
      .channel("editor_applications-header")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "editor_applications" },
        () => {
          qc.invalidateQueries({ queryKey: ["pending-applications-count"] });
          qc.invalidateQueries({ queryKey: ["editor-applications"] });
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [isAdmin, qc]);

  useEffect(() => {
    if (!isEditorOrAdmin) return;
    const ch = supabase
      .channel("plant_drafts-header")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "plant_drafts" },
        () => {
          qc.invalidateQueries({ queryKey: ["pending-drafts-count"] });
          qc.invalidateQueries({ queryKey: ["home-drafts"] });
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [isEditorOrAdmin, qc]);

  return (
    <header className="border-b border-ink/80 bg-background/70 backdrop-blur-sm">
      <div className="mx-auto max-w-[min(100vw-2rem,1800px)] px-6 py-3 flex items-center justify-between gap-4 flex-wrap">
        <nav className="flex items-center gap-x-4 gap-y-2 text-sm flex-wrap">
          <Link to="/" className="flex items-center gap-2 mr-2" aria-label="Plantspedia 首页">
            <img src={logoUrl} alt="Plantspedia" className="w-8 h-8 object-contain" />
          </Link>
          <Link to="/" className="hover:text-vermilion transition-colors" activeProps={{ className: "font-semibold" }}>首页</Link>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (!q.trim()) return;
              navigate({ to: "/search", search: { q: q.trim() } });
            }}
            className="flex items-center"
          >
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="搜索全文…"
              className="border border-ink/40 px-3 py-1 text-sm bg-transparent focus:outline-none focus:border-vermilion w-48"
            />
          </form>
        </nav>
        <nav className="flex items-center justify-end gap-x-4 gap-y-2 text-sm flex-wrap">
          <Link to="/plants" className="hover:text-vermilion transition-colors" activeProps={{ className: "font-semibold" }}>已收录档案检索</Link>
          <Link to="/blog" className="hover:text-vermilion transition-colors" activeProps={{ className: "font-semibold" }}>编辑博客</Link>
          <Link to="/edits" className="hover:text-vermilion transition-colors" activeProps={{ className: "font-semibold" }}>修改记录</Link>
          {user ? (
            <>
              {isAdmin && (
                <Link
                  to="/admin/applications"
                  className="relative hover:text-vermilion transition-colors"
                  title="编辑申请审核"
                >
                  编辑申请
                  {pendingCount > 0 && (
                    <span className="absolute -top-2 -right-3 bg-vermilion text-background text-[10px] leading-none px-1.5 py-0.5 rounded-full">
                      {pendingCount}
                    </span>
                  )}
                </Link>
              )}
              <Link to="/admin" className="hover:text-vermilion transition-colors">管理</Link>
              <button onClick={() => signOut()} className="text-ink-faint hover:text-ink transition-colors">退出</button>
              {isAdmin && <AdminExportButton />}
            </>
          ) : (
            <>
              <Link to="/signup" className="rounded border border-ink px-3 py-1 hover:bg-ink hover:text-background transition-colors">申请成为编辑</Link>
              <Link to="/login" className="rounded border border-ink px-3 py-1 hover:bg-ink hover:text-background transition-colors">登录</Link>
            </>
          )}
        </nav>
      </div>
    </header>
  );
}

export function SiteFooter() {
  return (
    <footer className="mt-24 border-t border-ink/40">
      <div className="mx-auto max-w-6xl px-6 py-6 text-center">
        <p className="text-xs text-ink-faint">
          开放的植物志社区 · 内容 copilot with AI，需要编辑进行校对和修改（尤其是配图缺失需要补充），加入编辑协作团队或投稿请联系{" "}
          <a href="mailto:arainjazz@163.com" className="hover:text-vermilion underline">
            arainjazz@163.com
          </a>
        </p>
      </div>
    </footer>
  );
}