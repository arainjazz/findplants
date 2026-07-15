import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { SiteHeader, SiteFooter } from "@/components/site-header";
import { useAuth } from "@/hooks/use-auth";
import { toast } from "sonner";

export const Route = createFileRoute("/login")({
  // Optional post-login destination (e.g. back to a share card). Only same-origin
  // relative paths are honored, so it can't be turned into an open redirect.
  validateSearch: (search: Record<string, unknown>): { redirect?: string } => ({
    redirect: typeof search.redirect === "string" && search.redirect.startsWith("/") ? search.redirect : undefined,
  }),
  component: LoginPage,
});

function LoginPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { redirect } = Route.useSearch();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  const goNext = () => {
    if (redirect) window.location.href = redirect;
    else navigate({ to: "/admin" });
  };

  useEffect(() => {
    if (user) goNext();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setLoading(false);
    if (error) return toast.error(error.message);
    toast.success("登录成功");
    goNext();
  };

  return (
    <div className="min-h-screen flex flex-col">
      <SiteHeader />
      <main className="flex-1 flex items-center justify-center px-6 py-16">
        <div className="w-full max-w-sm">
          <p className="label text-vermilion mb-2">Sign In</p>
          <h1 className="font-display text-4xl font-bold mb-6">登录</h1>
          <form onSubmit={onSubmit} className="space-y-4">
            <div>
              <label className="label block mb-1">邮箱</label>
              <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} className="w-full border border-ink px-3 py-2 bg-transparent focus:outline-none focus:border-vermilion" />
            </div>
            <div>
              <label className="label block mb-1">密码</label>
              <input type="password" required value={password} onChange={(e) => setPassword(e.target.value)} className="w-full border border-ink px-3 py-2 bg-transparent focus:outline-none focus:border-vermilion" />
            </div>
            <button type="submit" disabled={loading} className="w-full bg-ink text-background py-2 hover:bg-vermilion transition-colors disabled:opacity-60">
              {loading ? "正在登录…" : "登录"}
            </button>
          </form>
          <p className="text-sm text-ink-faint mt-6">还没有账号？ <Link to="/signup" search={redirect ? { redirect } : undefined} className="text-vermilion hover:underline">申请成为编辑</Link></p>
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
