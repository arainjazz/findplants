import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useRef, useState } from "react";
import { SiteHeader, SiteFooter } from "@/components/site-header";
import { useAuth } from "@/hooks/use-auth";
import { supabase } from "@/integrations/supabase/client";
import { uploadAssetFn } from "@/lib/identify-plant.functions";
import { fetchMyPosts, blogCoverUrl } from "@/lib/blog";
import { fetchMyNotifications, getLastSeen, markNotificationsSeen } from "@/lib/notifications";
import { compressImage, extForMime } from "@/lib/image-compress";
import { computeLeaves } from "@/lib/leaves";
import { LeafPanel } from "@/components/leaf-panel";
import { EntryTypeBadge } from "@/components/entry-type-badge";
import { toast } from "sonner";

export const Route = createFileRoute("/profile")({
  head: () => ({ meta: [{ title: "我的主页 · Plantspedia" }] }),
  component: ProfilePage,
});

function ProfilePage() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const upload = useServerFn(uploadAssetFn);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const uid = user?.id;

  const { data: profile } = useQuery({
    queryKey: ["my-profile", uid],
    enabled: !!uid,
    queryFn: async () => {
      const { data } = await supabase.from("profiles").select("*").eq("id", uid!).maybeSingle();
      return data as Record<string, unknown> | null;
    },
  });

  const [name, setName] = useState("");
  const [bio, setBio] = useState("");
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);

  useEffect(() => {
    if (!profile) return;
    setName((profile.display_name as string) || user?.user_metadata?.full_name as string || "");
    setBio((profile.bio as string) || "");
    setAvatarUrl((profile.avatar_url as string) || null);
  }, [profile, user]);

  const { data: myPlants = [] } = useQuery({
    queryKey: ["my-plants", uid],
    enabled: !!uid,
    queryFn: async () => {
      const { data } = await supabase
        .from("plants")
        .select("id, slug, title, scientific_name, cover_url, updated_at, content_type, source")
        .eq("author_id", uid!)
        .order("updated_at", { ascending: false });
      return data ?? [];
    },
  });
  const { data: myPosts = [] } = useQuery({
    queryKey: ["my-posts", uid],
    enabled: !!uid,
    queryFn: () => fetchMyPosts(uid!),
  });
  const { data: myDrafts = [] } = useQuery({
    queryKey: ["my-drafts", uid],
    enabled: !!uid,
    queryFn: async () => {
      const { data } = await supabase
        .from("plant_drafts")
        .select("id, title, status, created_at, photo_url")
        .eq("created_by", uid!)
        .order("created_at", { ascending: false });
      return data ?? [];
    },
  });
  const { data: leaves } = useQuery({
    queryKey: ["my-leaves", uid],
    enabled: !!uid,
    queryFn: () => computeLeaves(uid!, user?.email),
  });

  // Notifications: capture "last seen" before marking, so this visit still
  // highlights what's new; then mark seen so the nav dot clears next time.
  const seenAtRef = useRef<number | null>(null);
  if (uid && seenAtRef.current === null) seenAtRef.current = getLastSeen(uid);
  const { data: notifications = [] } = useQuery({
    queryKey: ["my-notifications", uid],
    enabled: !!uid,
    queryFn: () => fetchMyNotifications(uid!),
  });
  useEffect(() => {
    if (uid && notifications.length) markNotificationsSeen(uid);
  }, [uid, notifications.length]);

  const onPickAvatar = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f || !uid) return;
    if (!f.type.startsWith("image/")) return toast.error("请选择图片文件");
    setUploadingAvatar(true);
    try {
      let blob: Blob | File = f;
      try { blob = await compressImage(f, 512, 512, 0.85); } catch { /* keep original */ }
      const base64 = await blobToBase64(blob);
      const mime = blob.type || "image/jpeg";
      const res = await upload({
        data: {
          bucket: "plant-images",
          path: `avatars/${uid}-${Date.now()}.${extForMime(mime)}`,
          file_base64: base64,
          content_type: mime,
        },
      });
      const url = (res as { url: string }).url;
      setAvatarUrl(url);
      await supabase.from("profiles").update({ avatar_url: url }).eq("id", uid);
      qc.invalidateQueries({ queryKey: ["my-profile", uid] });
      qc.invalidateQueries({ queryKey: ["editor-column"] });
      toast.success("头像已更新");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "头像上传失败");
    } finally {
      setUploadingAvatar(false);
    }
  };

  const onSave = async () => {
    if (!uid) return;
    setSaving(true);
    try {
      const { error } = await supabase
        .from("profiles")
        .update({ display_name: name.trim() || "编辑者" })
        .eq("id", uid);
      if (error) throw error;
      // keep auth metadata in sync (used by comments / editors elsewhere)
      await supabase.auth.updateUser({ data: { full_name: name.trim() } }).catch(() => {});
      // bio lives in a column that may not exist yet — attempt, but don't fail the save.
      const { error: bioErr } = await supabase
        .from("profiles")
        .update({ bio: bio.trim() } as never)
        .eq("id", uid);
      qc.invalidateQueries({ queryKey: ["my-profile", uid] });
      qc.invalidateQueries({ queryKey: ["editor-column"] });
      if (bioErr) {
        toast.success("昵称已保存（简介待数据库升级后可保存）");
      } else {
        toast.success("资料已保存");
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "保存失败");
    } finally {
      setSaving(false);
    }
  };

  if (!user) {
    return (
      <div className="min-h-screen flex flex-col">
        <SiteHeader />
        <main className="flex-1 flex items-center justify-center">
          <div className="text-center">
            <p className="label mb-3">需要登录</p>
            <Link to="/login" className="border border-ink px-5 py-2 hover:bg-ink hover:text-background transition-colors">
              去登录
            </Link>
          </div>
        </main>
        <SiteFooter />
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col">
      <SiteHeader />
      <main className="mx-auto max-w-4xl px-6 py-10 flex-1 w-full">
        <div className="border-b-2 border-ink pb-6 mb-8">
          <p className="label text-vermilion mb-2">My Profile · 个人主页</p>
          <h1 className="font-display text-4xl font-bold">我的主页</h1>
        </div>

        {/* Edit card + leaf/points panel (top-right) */}
        <div className="flex flex-col md:flex-row gap-6 mb-10 items-start">
        <section className="border border-rule bg-paper-deep/30 p-5 md:p-6 flex-1 w-full min-w-0">
          <div className="flex flex-col sm:flex-row gap-6">
            <div className="flex flex-col items-center gap-2 shrink-0">
              <div className="w-24 h-24 rounded-full overflow-hidden border border-rule bg-background flex items-center justify-center">
                {avatarUrl ? (
                  <img src={avatarUrl} alt="头像" className="w-full h-full object-cover" />
                ) : (
                  <span className="font-display text-4xl text-ink-faint">{(name || "编").slice(0, 1)}</span>
                )}
              </div>
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                disabled={uploadingAvatar}
                className="text-xs border border-ink/40 px-3 py-1 hover:bg-ink hover:text-background transition-colors disabled:opacity-60"
              >
                {uploadingAvatar ? "上传中…" : "更换头像"}
              </button>
              <input ref={fileRef} type="file" accept="image/*" className="sr-only" onChange={onPickAvatar} />
            </div>

            <div className="flex-1 space-y-4">
              <div>
                <label className="label text-[10px] text-ink-faint block mb-1">昵称</label>
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  maxLength={40}
                  className="w-full border border-ink/40 px-3 py-2 text-sm bg-background focus:outline-none focus:border-vermilion"
                  placeholder="你的昵称"
                />
              </div>
              <div>
                <label className="label text-[10px] text-ink-faint block mb-1">个人简介</label>
                <textarea
                  value={bio}
                  onChange={(e) => setBio(e.target.value)}
                  maxLength={300}
                  rows={3}
                  className="w-full border border-ink/40 px-3 py-2 text-sm bg-background focus:outline-none focus:border-vermilion resize-y"
                  placeholder="一句话介绍自己、你的关注领域或所在地区…"
                />
              </div>
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={onSave}
                  disabled={saving}
                  className="bg-ink text-background px-5 py-2 text-sm hover:bg-vermilion transition-colors disabled:opacity-60"
                >
                  {saving ? "保存中…" : "保存资料"}
                </button>
                <span className="text-xs text-ink-faint">
                  邮箱：{user.email} · 修改记录请见 <Link to="/edits" className="underline hover:text-vermilion">修改记录</Link>
                </span>
              </div>
            </div>
          </div>
        </section>
          {leaves && <LeafPanel stats={leaves} name={name || user.email || undefined} />}
        </div>

        {/* Notifications */}
        {notifications.length > 0 && (
          <section className="mb-10">
            <h2 className="font-display text-xl font-semibold border-b border-rule pb-2 mb-3">
              消息提醒 · {notifications.length}
            </h2>
            <ul className="space-y-2">
              {notifications.map((n) => {
                const isNew = +new Date(n.created_at) > (seenAtRef.current ?? 0);
                return (
                  <li key={n.id} className="text-sm border-b border-rule-soft pb-2">
                    <div className="flex items-baseline gap-2 flex-wrap">
                      {isNew && <span className="text-[10px] bg-vermilion text-background px-1 rounded">新</span>}
                      <span className="text-ink-faint text-xs">
                        {n.type === "reply_to_you" ? "有人回复了你的评论" : "你的条目收到新评论"}
                        {n.author_name ? ` · ${n.author_name}` : ""} ·{" "}
                        {new Date(n.created_at).toLocaleDateString("zh-CN")}
                      </span>
                    </div>
                    <p className="mt-0.5 line-clamp-2 text-ink-soft">{n.body}</p>
                    {n.plant_slug && (
                      <Link to="/plants/$slug" params={{ slug: n.plant_slug }} className="text-xs text-vermilion hover:underline">
                        查看「{n.plant_title}」→
                      </Link>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>
        )}

        {/* My works */}
        <WorksSection title={`我的条目 · ${myPlants.length}`}>
          {myPlants.length === 0 ? (
            <Empty>还没有创建条目。</Empty>
          ) : (
            <ul className="grid sm:grid-cols-2 gap-3">
              {myPlants.map((p) => (
                <li key={p.id}>
                  <Link to="/plants/$slug" params={{ slug: p.slug }} className="flex gap-3 items-center border border-rule p-2 hover:bg-paper-deep/40 transition-colors">
                    <div className="w-12 h-12 shrink-0 border border-rule bg-paper-deep overflow-hidden">
                      {p.cover_url && <img src={p.cover_url} alt="" className="w-full h-full object-cover" />}
                    </div>
                    <div className="min-w-0">
                      <p className="font-semibold text-sm truncate">{p.title}</p>
                      {p.scientific_name && <p className="italic text-xs text-ink-faint truncate">{p.scientific_name}</p>}
                      <EntryTypeBadge plant={p} className="mt-1" />
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </WorksSection>

        <WorksSection title={`我的博文 · ${myPosts.length}`}>
          {myPosts.length === 0 ? (
            <Empty>还没有博文。<Link to="/blog" className="underline hover:text-vermilion">去写一篇 →</Link></Empty>
          ) : (
            <ul className="grid sm:grid-cols-2 gap-3">
              {myPosts.map((p) => {
                const cover = blogCoverUrl(p);
                return (
                  <li key={p.id}>
                    <Link to="/blog/$slug" params={{ slug: p.slug }} className="flex gap-3 items-center border border-rule p-2 hover:bg-paper-deep/40 transition-colors">
                      <div className="w-12 h-12 shrink-0 border border-rule bg-paper-deep overflow-hidden">
                        {cover && <img src={cover} alt="" className="w-full h-full object-cover" />}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="font-semibold text-sm truncate hover:text-vermilion">{p.title}</p>
                        <p className="text-[10px] text-ink-faint mt-0.5">
                          {p.published ? "已发布" : "草稿"} · {new Date(p.updated_at).toLocaleDateString("zh-CN")}
                        </p>
                      </div>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </WorksSection>

        <WorksSection title={`我的识别 · ${myDrafts.length}`}>
          {myDrafts.length === 0 ? (
            <Empty>还没有 AI 识别记录。<Link to="/identify" className="underline hover:text-vermilion">去识别 →</Link></Empty>
          ) : (
            <ul className="grid sm:grid-cols-2 gap-3">
              {myDrafts.map((d) => (
                <li key={d.id}>
                  <Link to="/drafts/$id" params={{ id: d.id }} className="flex gap-3 items-center border border-rule p-2 hover:bg-paper-deep/40 transition-colors">
                    <div className="w-12 h-12 shrink-0 border border-rule bg-paper-deep overflow-hidden">
                      {d.photo_url && <img src={d.photo_url} alt="" className="w-full h-full object-cover" />}
                    </div>
                    <div className="min-w-0">
                      <p className="font-semibold text-sm truncate">{d.title}</p>
                      <p className="text-[10px] text-ink-faint">
                        {d.status === "approved" ? "已收录" : d.status === "rejected" ? "已驳回" : "待审核"} ·{" "}
                        {new Date(d.created_at).toLocaleDateString("zh-CN")}
                      </p>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </WorksSection>
      </main>
      <SiteFooter />
    </div>
  );
}

function WorksSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-8">
      <h2 className="font-display text-xl font-semibold border-b border-rule pb-2 mb-3">{title}</h2>
      {children}
    </section>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="text-sm text-ink-faint py-4">{children}</p>;
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const dataUrl = reader.result as string;
      resolve(dataUrl.slice(dataUrl.indexOf(",") + 1));
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}
