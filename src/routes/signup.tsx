import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { SiteHeader, SiteFooter } from "@/components/site-header";
import { useAuth } from "@/hooks/use-auth";
import { toast } from "sonner";

export const Route = createFileRoute("/signup")({
  component: SignupPage,
});

function SignupPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [bio, setBio] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (user) navigate({ to: "/admin" });
  }, [user, navigate]);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (bio.trim().length < 20) {
      toast.error("请填写完整的个人简述（至少 20 字）");
      return;
    }
    setLoading(true);
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: `${window.location.origin}/login`,
        data: {
          display_name: name || email.split("@")[0],
          editor_application_bio: bio.trim(),
        },
      },
    });
    if (error) {
      setLoading(false);
      return toast.error(error.message);
    }
    setLoading(false);
    toast.success("申请已提交！请验证邮箱；管理员审核通过后即可获得编辑权限。");
    navigate({ to: "/login" });
  };

  return (
    <div className="min-h-screen flex flex-col">
      <SiteHeader />
      <main className="flex-1 flex items-center justify-center px-6 py-16">
        <div className="w-full max-w-sm">
          <p className="label text-vermilion mb-2">Join the Almanac</p>
          <h1 className="font-display text-4xl font-bold mb-6">申请成为编辑</h1>
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
            <button type="submit" disabled={loading} className="w-full bg-ink text-background py-2 hover:bg-vermilion transition-colors disabled:opacity-60">
              {loading ? "正在提交…" : "申请成为编辑"}
            </button>
          </form>
          <p className="text-sm text-ink-faint mt-6">已有账号？ <Link to="/login" className="text-vermilion hover:underline">登录</Link></p>
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
