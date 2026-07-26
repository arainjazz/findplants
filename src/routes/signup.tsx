import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { SiteHeader, SiteFooter } from "@/components/site-header";
import { useAuth } from "@/hooks/use-auth";
import { toast } from "sonner";

// ─── 注册 / 申请成为编辑 ──────────────────────────────────────────────────────
//
// 这一个路由承两种意图，靠 `?mode=` 分：
//   mode=register（普通注册）—— 只要邮箱+密码，拿一个普通账号：能评论、能提交识别草稿
//                              并署自己的名、有个人主页。**不**填个人简述。
//   mode=editor（申请成为编辑）—— 现状：必填个人简述，提交后进管理员的「编辑申请」队列。
//
// 为什么普通注册不需要任何数据库改动：`handle_new_user()` 触发器是**看
// `raw_user_meta_data->>'editor_application_bio'` 有没有值**才往 editor_applications
// 插一行的（见 20260712090000_restore_editor_application_insert.sql）。普通注册压根
// 不发这个字段 → 触发器自然不建申请单，只建 profiles 行。
//
// 默认值取 "editor"：站内旧链接（登录页那句「还没有账号？申请成为编辑」、邮件里的
// /signup）都不带 mode，必须维持原来的语义，不能悄悄变成普通注册。
type SignupMode = "register" | "editor";

export const Route = createFileRoute("/signup")({
  validateSearch: (search: Record<string, unknown>): { redirect?: string; mode?: SignupMode } => ({
    redirect: typeof search.redirect === "string" && search.redirect.startsWith("/") ? search.redirect : undefined,
    mode: search.mode === "register" ? "register" : "editor",
  }),
  component: SignupPage,
});

function SignupPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { redirect, mode = "editor" } = Route.useSearch();
  const isEditorApplication = mode === "editor";
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [bio, setBio] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (user) {
      if (redirect) window.location.href = redirect;
      else navigate({ to: "/admin" });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isEditorApplication && bio.trim().length < 20) {
      toast.error("请填写完整的个人简述（至少 20 字）");
      return;
    }
    setLoading(true);
    const { data: signUpData, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        // After the email link, land back where they came from (or /login).
        emailRedirectTo: `${window.location.origin}${redirect ?? "/login"}`,
        data: {
          display_name: name || email.split("@")[0],
          // 只有「申请成为编辑」才带这个字段 —— 带了触发器就会建一条待审申请。
          ...(isEditorApplication ? { editor_application_bio: bio.trim() } : {}),
        },
      },
    });
    if (error) {
      setLoading(false);
      return toast.error(error.message);
    }
    setLoading(false);
    // If email confirmation is disabled, signUp returns a live session → the user
    // is already logged in; go straight back to the card. Otherwise they must
    // verify first, so send them to login carrying the same redirect.
    if (signUpData.session) {
      toast.success(isEditorApplication ? "注册成功，已自动登录（编辑申请已提交待审）" : "注册成功，已自动登录");
      if (redirect) { window.location.href = redirect; return; }
      navigate({ to: "/admin" });
      return;
    }
    toast.success(
      isEditorApplication
        ? "申请已提交！请验证邮箱；管理员审核通过后即可获得编辑权限。"
        : "注册成功！请到邮箱点验证链接，然后回来登录。",
    );
    navigate({ to: "/login", search: redirect ? { redirect } : undefined });
  };

  return (
    <div className="min-h-screen flex flex-col">
      <SiteHeader />
      <main className="flex-1 flex items-center justify-center px-6 py-16">
        <div className="w-full max-w-sm">
          <p className="label text-vermilion mb-2">{isEditorApplication ? "Join the Almanac" : "Create Account"}</p>
          <h1 className="font-display text-4xl font-bold mb-2">{isEditorApplication ? "申请成为编辑" : "注册账号"}</h1>
          <p className="text-xs text-ink-faint mb-6 leading-relaxed">
            {isEditorApplication
              ? "编辑可以创建 / 编辑物种详页、整理标签与名录。需管理员审核。"
              : "普通账号即可评论、提交识别草稿并署上自己的名字、拥有个人主页。想创建和编辑物种详页，请改走「申请成为编辑」。"}
          </p>
          <form onSubmit={onSubmit} className="space-y-4">
            <div>
              <label className="label block mb-1">显示名</label>
              <input value={name} onChange={(e) => setName(e.target.value)} className="w-full border border-ink px-3 py-2 bg-transparent focus:outline-none focus:border-vermilion" />
            </div>
            <div>
              <label className="label block mb-1">邮箱</label>
              <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} className="w-full border border-ink px-3 py-2 bg-transparent focus:outline-none focus:border-vermilion" />
            </div>
            <div>
              <label className="label block mb-1">密码</label>
              <input type="password" required minLength={6} value={password} onChange={(e) => setPassword(e.target.value)} className="w-full border border-ink px-3 py-2 bg-transparent focus:outline-none focus:border-vermilion" />
              <p className="text-xs text-ink-faint mt-1">至少 6 位</p>
            </div>
            {isEditorApplication && (
              <div>
                <label className="label block mb-1">个人简述</label>
                <textarea
                  required
                  value={bio}
                  onChange={(e) => setBio(e.target.value)}
                  rows={6}
                  placeholder={"请填写：\n1. 姓名\n2. 专业\n3. 是否修过植物学\n4. 是否学过编程\n5. 是否有参与过线上内容社区的编写或管理协作经验"}
                  className="w-full border border-ink px-3 py-2 bg-transparent focus:outline-none focus:border-vermilion text-sm"
                />
                <p className="text-xs text-ink-faint mt-1">提交后由管理员审核，审核通过方可获得编辑权限。</p>
              </div>
            )}
            <button type="submit" disabled={loading} className="w-full bg-ink text-background py-2 hover:bg-vermilion transition-colors disabled:opacity-60">
              {loading ? "正在提交…" : isEditorApplication ? "申请成为编辑" : "注册"}
            </button>
          </form>
          <p className="text-sm text-ink-faint mt-6">
            {isEditorApplication ? (
              <>
                只想要个普通账号？{" "}
                <Link to="/signup" search={{ ...(redirect ? { redirect } : {}), mode: "register" as const }} className="text-vermilion hover:underline">
                  去注册
                </Link>
              </>
            ) : (
              <>
                想创建 / 编辑物种详页？{" "}
                <Link to="/signup" search={{ ...(redirect ? { redirect } : {}), mode: "editor" as const }} className="text-vermilion hover:underline">
                  申请成为编辑
                </Link>
              </>
            )}
          </p>
          <p className="text-sm text-ink-faint mt-2">已有账号？ <Link to="/login" search={redirect ? { redirect } : undefined} className="text-vermilion hover:underline">登录</Link></p>
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
