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
  // 登录失败且看起来是「这个邮箱压根没注册」时，把两条出路顶到眼前。
  // Supabase 出于**账号枚举防护**，对「邮箱不存在」和「密码错」都回同一句
  // `Invalid login credentials` —— 服务端不肯告诉我们是哪一种，所以这里只能
  // 措辞成两问（「没注册过？还是密码记错了？」），不能断言用户不存在。
  const [maybeUnregistered, setMaybeUnregistered] = useState(false);

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
    setMaybeUnregistered(false);

    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setLoading(false);
    if (error) {
      if (/invalid login credentials/i.test(error.message)) setMaybeUnregistered(true);
      return toast.error(error.message);
    }
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
          {maybeUnregistered && (
            <div className="mt-5 border border-vermilion/40 bg-vermilion/5 px-3 py-2.5 text-xs leading-relaxed text-ink-soft">
              登录没通过。<b className="text-ink">还没注册过？</b>下面两条路任选一条；
              如果确定注册过，那多半是密码记错了，请再试一次。
            </div>
          )}

          {/* 原先这里只有一句「还没有账号？申请成为编辑」——把唯一的注册入口挂在
              「申请成为编辑」上，等于逼所有只想评论 / 提交识别草稿的访客去写一份
              至少 20 字的编辑申请，还得等管理员审。两条路拆开并列。 */}
          <div className="mt-6 border-t border-rule pt-5">
            <p className="text-sm text-ink-faint mb-3">还没有账号？</p>
            <div className="grid grid-cols-2 gap-2">
              <Link
                to="/signup"
                search={{ ...(redirect ? { redirect } : {}), mode: "register" as const }}
                className="border border-ink px-3 py-2 text-center text-sm hover:bg-ink hover:text-background transition-colors"
              >
                去注册
              </Link>
              <Link
                to="/signup"
                search={{ ...(redirect ? { redirect } : {}), mode: "editor" as const }}
                className="bg-ink text-background px-3 py-2 text-center text-sm hover:bg-vermilion transition-colors"
              >
                申请成为编辑
              </Link>
            </div>
            <p className="mt-2 text-xs text-ink-faint leading-relaxed">
              普通账号可评论、提交识别草稿并署名；编辑还能创建 / 编辑物种详页、整理标签与名录（需管理员审核）。
            </p>
          </div>
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
