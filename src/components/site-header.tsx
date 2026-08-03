import { Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import { isCurrentUserAdmin } from "@/lib/edits";
import { fetchMyNotifications, countUnseen } from "@/lib/notifications";
import { supabase } from "@/integrations/supabase/client";
import { AdminExportButton } from "@/components/admin-export-button";
import logoUrl from "@/assets/logo.png";
import aiIdentifyIcon from "@/assets/ai-identify-logo.png";

export function SiteHeader() {
  const { user, signOut } = useAuth();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [q, setQ] = useState("");
  const [visible, setVisible] = useState(true);
  const [lastScrollY, setLastScrollY] = useState(0);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const handleScroll = () => {
      const currentScrollY = window.scrollY;
      if (currentScrollY < 10) {
        setVisible(true);
      } else if (currentScrollY > lastScrollY) {
        setVisible(false);
      } else {
        setVisible(true);
      }
      setLastScrollY(currentScrollY);
    };
    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => window.removeEventListener("scroll", handleScroll);
  }, [lastScrollY]);

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

  const { data: myNotifs = [] } = useQuery({
    queryKey: ["nav-notifications", user?.id],
    enabled: !!user,
    queryFn: () => fetchMyNotifications(user!.id),
    refetchInterval: 60000,
  });
  const unseenNotif = user ? countUnseen(myNotifs, user.id) : 0;

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
    <header 
      className={`border-b border-ink/80 bg-background/70 backdrop-blur-sm sticky top-0 z-50 transition-transform duration-300 ease-in-out
        ${visible ? "translate-y-0" : "-translate-y-full"}`}
    >
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

        {/* Search — always visible, grows on mobile. Magnifier inside on the right;
            Enter (form submit) or clicking the magnifier both trigger search. */}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!q.trim()) return;
            setMenuOpen(false);
            navigate({ to: "/search", search: { q: q.trim() } });
          }}
          className="flex items-center flex-1 min-w-0"
        >
          <div className="relative w-full md:w-56">
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="搜索全文…"
              className="border border-ink/40 pl-3 pr-9 py-1 text-sm bg-transparent focus:outline-none focus:border-vermilion w-full"
            />
            <button
              type="submit"
              aria-label="搜索"
              title="搜索"
              className="absolute right-1.5 top-1/2 -translate-y-1/2 text-ink-faint hover:text-vermilion transition-colors cursor-pointer"
            >
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <circle cx="11" cy="11" r="7" />
                <path d="m21 21-4.3-4.3" />
              </svg>
            </button>
          </div>
        </form>

        {/* AI 识别 logo + 文字 — right next to the search box, all sizes (not in the drawer). */}
        <Link
          to="/identify"
          className="relative shrink-0 inline-flex items-center gap-1.5 hover:text-vermilion transition-colors"
          activeProps={{ className: "font-semibold" }}
          title="AI 识别植物"
          aria-label="AI 识别植物"
          onClick={() => setMenuOpen(false)}
        >
          <img src={aiIdentifyIcon} alt="" className="w-8 h-8 object-contain" />
          <span className="text-sm whitespace-nowrap">AI识别</span>
          {isEditorOrAdmin && pendingDraftCount > 0 && (
            <span className="absolute -top-1.5 -right-2 bg-vermilion text-background text-[10px] leading-none px-1.5 py-0.5 rounded-full">
              {pendingDraftCount}
            </span>
          )}
        </Link>

        {/* Desktop full nav — only at lg+ to avoid iPad overlap */}
        <nav className="hidden lg:flex items-center gap-x-4 text-sm">
          <Link to="/plants" className="hover:text-vermilion transition-colors" activeProps={{ className: "font-semibold" }}>已收录档案检索</Link>
          <Link to="/explore" className="hover:text-vermilion transition-colors" activeProps={{ className: "font-semibold" }}>身边物种地图</Link>
          <a href="/plant-image-search.html" className="hover:text-vermilion transition-colors">植物搜图</a>
          <Link to="/blog" className="hover:text-vermilion transition-colors" activeProps={{ className: "font-semibold" }}>博客 blogs</Link>
          <Link to="/projects" className="hover:text-vermilion transition-colors" activeProps={{ className: "font-semibold" }}>项目预告与成果</Link>
          <Link to="/edits" className="hover:text-vermilion transition-colors" activeProps={{ className: "font-semibold" }}>Log</Link>
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
          {user && (
            <Link to="/profile" className="relative hover:text-vermilion transition-colors" activeProps={{ className: "font-semibold" }}>
              我的主页
              {unseenNotif > 0 && (
                <span className="absolute -top-2 -right-3 bg-vermilion text-background text-[10px] leading-none px-1.5 py-0.5 rounded-full">{unseenNotif}</span>
              )}
            </Link>
          )}
          {user && <Link to="/admin" className="hover:text-vermilion transition-colors">添加/编辑内容</Link>}
          {/* 关于 —— 对所有人可见（含未登录）。这是给新访客看的介绍页，藏在登录后面等于白做。 */}
          <Link to="/about" className="hover:text-vermilion transition-colors" activeProps={{ className: "font-semibold" }}>关于 about</Link>
          {user && isAdmin && <AdminExportButton />}
        </nav>

        {/* Login / logout — always visible */}
        <div className="hidden sm:flex items-center gap-2 text-sm shrink-0">
          {user ? (
            <button onClick={() => signOut()} className="text-ink-faint hover:text-ink transition-colors cursor-pointer">退出</button>
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
          {(pendingDraftCount + pendingCount + unseenNotif) > 0 && !menuOpen && (
            <span className="absolute -top-1 -right-1 bg-vermilion text-background text-[10px] leading-none px-1.5 py-0.5 rounded-full">
              {pendingDraftCount + pendingCount + unseenNotif}
            </span>
          )}
        </button>
      </div>

      {/* Drawer — tablet + mobile */}
      {menuOpen && (
        <nav className="lg:hidden border-t border-ink/30 bg-background px-4 py-3 flex flex-col gap-3 text-sm">
          <Link to="/" onClick={() => setMenuOpen(false)} className="hover:text-vermilion">首页</Link>
          <Link to="/plants" onClick={() => setMenuOpen(false)} className="hover:text-vermilion">已收录档案检索</Link>
          <Link to="/explore" onClick={() => setMenuOpen(false)} className="hover:text-vermilion">身边物种地图</Link>
          <a href="/plant-image-search.html" onClick={() => setMenuOpen(false)} className="hover:text-vermilion">植物搜图</a>
          <Link to="/blog" onClick={() => setMenuOpen(false)} className="hover:text-vermilion">博客 blogs</Link>
          <Link to="/projects" onClick={() => setMenuOpen(false)} className="hover:text-vermilion">项目预告与成果</Link>
          <Link to="/edits" onClick={() => setMenuOpen(false)} className="hover:text-vermilion">Log</Link>
          {user && isAdmin && (
            <Link to="/admin/applications" onClick={() => setMenuOpen(false)} className="hover:text-vermilion">
              编辑申请{pendingCount > 0 && <span className="ml-2 bg-vermilion text-background text-[10px] px-1.5 py-0.5 rounded-full">{pendingCount}</span>}
            </Link>
          )}
          {user && (
            <Link to="/profile" onClick={() => setMenuOpen(false)} className="inline-flex items-center gap-2 hover:text-vermilion">
              我的主页
              {unseenNotif > 0 && (
                <span className="bg-vermilion text-background text-[10px] px-1.5 py-0.5 rounded-full">{unseenNotif}</span>
              )}
            </Link>
          )}
          {user && <Link to="/admin" onClick={() => setMenuOpen(false)} className="hover:text-vermilion">添加/编辑内容</Link>}
          <Link to="/about" onClick={() => setMenuOpen(false)} className="hover:text-vermilion">关于 about</Link>
          <div className="border-t border-ink/20 mt-1 pt-3 flex flex-col gap-2">
            {user ? (
              <button
                onClick={() => { setMenuOpen(false); signOut(); }}
                className="rounded border border-ink px-3 py-2 text-center hover:bg-ink hover:text-background transition-colors cursor-pointer"
              >
                退出登录
              </button>
            ) : (
              <>
                <Link to="/login" onClick={() => setMenuOpen(false)} className="rounded border border-ink px-3 py-2 text-center hover:bg-ink hover:text-background transition-colors">登录</Link>
                <Link to="/signup" onClick={() => setMenuOpen(false)} className="rounded border border-ink/50 px-3 py-2 text-center hover:bg-ink hover:text-background transition-colors">申请成为编辑</Link>
              </>
            )}
          </div>
        </nav>
      )}
    </header>
  );
}


export function SiteFooter() {
  return (
    <footer className="border-t border-ink/40 bg-transparent mt-8 md:mt-10">
      <div className="mx-auto max-w-[min(100vw-2rem,1800px)] px-6 py-6 text-center">
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