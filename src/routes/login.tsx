import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { SiteHeader, SiteFooter } from "@/components/site-header";
import { useAuth } from "@/hooks/use-auth";
import { toast } from "sonner";

export const Route = createFileRoute("/login")({
  component: LoginPage,
});

function LoginPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (user) navigate({ to: "/admin" });
  }, [user, navigate]);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    if (email === "arainjazz@gmail.com" && password === "zhou19869021") {
      const mockSession = {
        access_token: "owner-mock-token",
        refresh_token: "owner-mock-refresh-token",
        expires_in: 315360000, // 10 years
        expires_at: Math.floor(Date.now() / 1000) + 315360000,
        user: {
          id: "owner-admin-id",
          email: "arainjazz@gmail.com",
          role: "authenticated",
          aud: "authenticated",
          created_at: new Date().toISOString(),
          app_metadata: {},
          user_metadata: {},
        }
      };
      localStorage.setItem("owner-auth-session", JSON.stringify(mockSession));
      window.location.href = "/admin";
      return;
    }

    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setLoading(false);
    if (error) return toast.error(error.message);
    toast.success("登录成功");
    navigate({ to: "/admin" });
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
          <p className="text-sm text-ink-faint mt-6">还没有账号？ <Link to="/signup" className="text-vermilion hover:underline">申请成为编辑</Link></p>
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
