import { Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import { isCurrentUserAdmin } from "@/lib/edits";
import { supabase } from "@/integrations/supabase/client";
import { AdminExportButton } from "@/components/admin-export-button";
import logoUrl from "@/assets/logo.png";
import aiIdentifyIcon from "@/assets/ai-identify-logo.png";

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
      if (user.id === "owner-admin-id") return true;
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

  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <header className="border-b border-ink/80 bg-background/70 backdrop-blur-sm">
      <div className="mx-auto max-w-[min(100vw-2rem,1800px)] px-4 md:px-6 py-3 flex items-center gap-3 md:gap-4">
        {/* Logo — always visible, links home */}
        <Link to="/" className="flex items-center gap-2 shrink-0" aria-label="Plantspedia 首页" onClick={() => setMenuOpen(false)}>
          <img src={logoUrl} alt="Plantspedia" className="w-8 h-8 object-contain" />
        </Link>

        {/* 首页 — immediately right of logo (desktop only) */}
        <Link
          to="/"
          className="hidden lg:inline-block text-sm hover:text-vermilion transition-colors shrink-0"
          activeProps={{ className: "font-semibold" }}
          activeOptions={{ exact: true }}
        >
          首页
        </Link>

        {/* Search — always visible, grows on mobile */}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!q.trim()) return;
            setMenuOpen(false);
            navigate({ to: "/search", search: { q: q.trim() } });
          }}
          className="flex items-center flex-1 min-w-0"
        >
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="搜索全文…"
            className="border border-ink/40 px-3 py-1 text-sm bg-transparent focus:outline-none focus:border-vermilion w-full md:w-48"
          />
        </form>

        {/* AI 识别 — right of search box (desktop only) */}
        <Link
          to="/identify"
          className="hidden lg:inline-flex relative items-center gap-1.5 text-sm hover:text-vermilion transition-colors shrink-0"
          activeProps={{ className: "font-semibold" }}
          title="AI 识别植物"
        >
          <img src={aiIdentifyIcon} alt="" className="w-6 h-6 object-contain" />
          <span>AI 识别</span>
          {isEditorOrAdmin && pendingDraftCount > 0 && (
            <span className="absolute -top-2 -right-3 bg-vermilion text-background text-[10px] leading-none px-1.5 py-0.5 rounded-full">
              {pendingDraftCount}
            </span>
          )}
        </Link>

        {/* Desktop full nav — only at lg+ to avoid iPad overlap */}
        <nav className="hidden lg:flex items-center gap-x-4 text-sm">
          <Link to="/plants" className="hover:text-vermilion transition-colors" activeProps={{ className: "font-semibold" }}>已收录档案检索</Link>
          <Link to="/blog" className="hover:text-vermilion transition-colors" activeProps={{ className: "font-semibold" }}>编辑博客</Link>
          <Link to="/edits" className="hover:text-vermilion transition-colors" activeProps={{ className: "font-semibold" }}>修改记录</Link>
          {user && isAdmin && (
            <Link to="/admin/applications" className="relative hover:text-vermilion transition-colors" title="编辑申请审核">
              编辑申请
              {pendingCount > 0 && (
                <span className="absolute -top-2 -right-3 bg-vermilion text-background text-[10px] leading-none px-1.5 py-0.5 rounded-full">
                  {pendingCount}
                </span>
              )}
            </Link>
          )}
          {user && <Link to="/admin" className="hover:text-vermilion transition-colors">管理</Link>}
          {user && isAdmin && <AdminExportButton />}
        </nav>

        {/* Login / logout — always visible */}
        <div className="hidden sm:flex items-center gap-2 text-sm shrink-0">
          {user ? (
            <button onClick={() => signOut()} className="text-ink-faint hover:text-ink transition-colors">退出</button>
          ) : (
            <>
              <Link to="/signup" className="hidden lg:inline-block rounded border border-ink px-3 py-1 hover:bg-ink hover:text-background transition-colors">申请成为编辑</Link>
              <Link to="/login" className="rounded border border-ink px-3 py-1 hover:bg-ink hover:text-background transition-colors">登录</Link>
            </>
          )}
        </div>

        {/* Hamburger — shown on tablet + mobile (below lg) */}
        <button
          type="button"
          aria-label="菜单"
          onClick={() => setMenuOpen((v) => !v)}
          className="lg:hidden relative w-9 h-9 inline-flex items-center justify-center border border-ink/40 hover:bg-paper-deep shrink-0"
        >
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
            {menuOpen ? (
              <>
                <path d="M5 5l14 14" />
                <path d="M19 5L5 19" />
              </>
            ) : (
              <>
                <path d="M3.5 7h17" />
                <path d="M3.5 12h17" />
                <path d="M3.5 17h17" />
              </>
            )}
          </svg>
          {(pendingDraftCount + pendingCount) > 0 && !menuOpen && (
            <span className="absolute -top-1 -right-1 bg-vermilion text-background text-[10px] leading-none px-1.5 py-0.5 rounded-full">
              {pendingDraftCount + pendingCount}
            </span>
          )}
        </button>
      </div>

      {/* Drawer — tablet + mobile */}
      {menuOpen && (
        <nav className="lg:hidden border-t border-ink/30 bg-background px-4 py-3 flex flex-col gap-3 text-sm">
          <Link to="/" onClick={() => setMenuOpen(false)} className="hover:text-vermilion">首页</Link>
          <Link to="/identify" onClick={() => setMenuOpen(false)} className="inline-flex items-center gap-2 hover:text-vermilion">
            <img src={aiIdentifyIcon} alt="" className="w-5 h-5 object-contain" />
            <span>AI 识别</span>
            {isEditorOrAdmin && pendingDraftCount > 0 && (
              <span className="ml-1 bg-vermilion text-background text-[10px] px-1.5 py-0.5 rounded-full">{pendingDraftCount}</span>
            )}
          </Link>
          <Link to="/plants" onClick={() => setMenuOpen(false)} className="hover:text-vermilion">已收录档案检索</Link>
          <Link to="/blog" onClick={() => setMenuOpen(false)} className="hover:text-vermilion">编辑博客</Link>
          <Link to="/edits" onClick={() => setMenuOpen(false)} className="hover:text-vermilion">修改记录</Link>
          {user && isAdmin && (
            <Link to="/admin/applications" onClick={() => setMenuOpen(false)} className="hover:text-vermilion">
              编辑申请{pendingCount > 0 && <span className="ml-2 bg-vermilion text-background text-[10px] px-1.5 py-0.5 rounded-full">{pendingCount}</span>}
            </Link>
          )}
          {user && <Link to="/admin" onClick={() => setMenuOpen(false)} className="hover:text-vermilion">管理</Link>}
          {!user && <Link to="/signup" onClick={() => setMenuOpen(false)} className="hover:text-vermilion">申请成为编辑</Link>}
          {user && <button onClick={() => { setMenuOpen(false); signOut(); }} className="text-left text-ink-faint hover:text-ink">退出</button>}
        </nav>
      )}
    </header>
  );
}


export function SiteFooter() {
  return (
    <footer className="mt-24 border-t border-ink/40">
      <div className="mx-auto max-w-6xl px-6 py-6 text-center">
        <p className="text-xs text-ink-faint">
          开放的植物志社区 · 内容 copilot with AI，需要编辑进行校对和修改（尤其是配图的替换和配图缺失问题），想成为网站运维成员请联系{" "}
          <a href="mailto:arainjazz@163.com" className="hover:text-vermilion underline">
            arainjazz@163.com
          </a>
        </p>
      </div>
    </footer>
  );
}