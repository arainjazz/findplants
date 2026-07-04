import { useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import { useAuth } from "@/hooks/use-auth";
import { supabase } from "@/integrations/supabase/client";
import { compressImage } from "@/lib/image-compress";
import { BlockEditor } from "@/components/block-editor";
import { createProject, updateProject, type Project } from "@/lib/projects";

/** Create / edit a 项目驱动调研成果 entry. 时间/地点/主题/发起人 are required — they
 *  power the filters on the public /projects page. */
export function ProjectEditor({ initial }: { initial?: Project }) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const coverInputRef = useRef<HTMLInputElement>(null);

  const [title, setTitle] = useState(initial?.title ?? "");
  const [projectDate, setProjectDate] = useState(initial?.project_date ?? "");
  const [location, setLocation] = useState(initial?.location ?? "");
  const [theme, setTheme] = useState(initial?.theme ?? "");
  const [initiator, setInitiator] = useState(initial?.initiator ?? "");
  const [summary, setSummary] = useState(initial?.summary ?? "");
  const [coverUrl, setCoverUrl] = useState(initial?.cover_url ?? "");
  const [html, setHtml] = useState(initial?.content_html ?? "");
  const [busy, setBusy] = useState(false);

  const uploadToStorage = async (file: File, prefix: string): Promise<string> => {
    let toUpload: Blob | File = file;
    try {
      toUpload = await compressImage(file);
    } catch (err) {
      console.error("compress failed, using original:", err);
    }
    const ext = file.name.split(".").pop() || "jpg";
    const path = `${user!.id}/${prefix}/${Date.now()}-${Math.random().toString(36).slice(2, 6)}.${ext}`;
    const { error } = await supabase.storage
      .from("plant-images")
      .upload(path, toUpload, { upsert: false, contentType: file.type });
    if (error) throw error;
    return supabase.storage.from("plant-images").getPublicUrl(path).data.publicUrl;
  };

  const uploadCover = async (file: File) => {
    if (!user) return;
    setBusy(true);
    try {
      setCoverUrl(await uploadToStorage(file, "project-cover"));
      toast.success("封面已上传");
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const requiredMissing = () => {
    if (!title.trim()) return "请输入项目标题";
    if (!projectDate) return "请选择项目时间（必填）";
    if (!location.trim()) return "请填写项目地点（必填）";
    if (!theme.trim()) return "请填写主题（必填）";
    if (!initiator.trim()) return "请填写发起人（必填）";
    return null;
  };

  const save = async (publish: boolean) => {
    if (!user) return toast.error("请先登录");
    const miss = requiredMissing();
    if (miss) return toast.error(miss);
    setBusy(true);
    try {
      const authorName = (user.user_metadata?.full_name as string) || user.email || "编辑";
      const fields = {
        title: title.trim(),
        project_date: projectDate,
        location: location.trim(),
        theme: theme.trim(),
        initiator: initiator.trim(),
        summary: summary.trim() || null,
        content_html: html,
        cover_url: coverUrl.trim() || null,
      };
      if (initial) {
        await updateProject(initial.id, { ...fields, published: publish || initial.published });
        toast.success(publish ? "已发布" : "已保存");
        if (publish) navigate({ to: "/projects/$id", params: { id: initial.id } });
      } else {
        const created = await createProject({ ...fields, publish, authorId: user.id, authorName });
        toast.success(publish ? "已发布" : "草稿已保存");
        if (publish) navigate({ to: "/projects/$id", params: { id: created.id } });
        else navigate({ to: "/admin/projects/edit/$id", params: { id: created.id } });
      }
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const field = "w-full border border-rule rounded-lg px-3 py-2 text-sm bg-background outline-none focus:border-vermilion";

  return (
    <div className="max-w-3xl mx-auto">
      {coverUrl ? (
        <div className="relative group mb-6 -mx-6 md:-mx-12">
          <img src={coverUrl} alt="" className="w-full max-h-[280px] object-cover" />
          <div className="absolute top-2 right-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
            <button onClick={() => coverInputRef.current?.click()} className="text-xs bg-background/90 border border-ink/40 px-2 py-1 hover:bg-background">更换</button>
            <button onClick={() => setCoverUrl("")} className="text-xs bg-background/90 border border-ink/40 px-2 py-1 hover:bg-background">移除</button>
          </div>
        </div>
      ) : (
        <button onClick={() => coverInputRef.current?.click()} className="mb-6 text-xs text-ink-faint border border-dashed border-rule rounded-lg px-3 py-2 hover:border-ink hover:text-ink transition-colors">
          + 添加封面图（可选）
        </button>
      )}
      <input ref={coverInputRef} type="file" accept="image/*" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadCover(f); e.target.value = ""; }} />

      <textarea
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        rows={1}
        placeholder="项目标题…"
        className="w-full resize-none font-display text-3xl md:text-4xl font-bold bg-transparent outline-none placeholder:text-ink-faint/50 mb-4"
      />

      {/* Required metadata — these drive the public-page filters */}
      <div className="grid sm:grid-cols-2 gap-3 mb-3">
        <label className="block">
          <span className="label text-[11px] text-vermilion">项目时间 *</span>
          <input type="date" value={projectDate} onChange={(e) => setProjectDate(e.target.value)} className={field} />
        </label>
        <label className="block">
          <span className="label text-[11px] text-vermilion">项目地点 *</span>
          <input value={location} onChange={(e) => setLocation(e.target.value)} placeholder="如：鄂尔多斯市杭锦旗" className={field} />
        </label>
        <label className="block">
          <span className="label text-[11px] text-vermilion">主题 *</span>
          <input value={theme} onChange={(e) => setTheme(e.target.value)} placeholder="如：荒漠植被恢复调查" className={field} />
        </label>
        <label className="block">
          <span className="label text-[11px] text-vermilion">发起人 *</span>
          <input value={initiator} onChange={(e) => setInitiator(e.target.value)} placeholder="如：张三 / 某某研究团队" className={field} />
        </label>
      </div>
      <label className="block mb-5">
        <span className="label text-[11px] text-ink-faint">一句话简介（列表卡片摘要，可选）</span>
        <input value={summary} onChange={(e) => setSummary(e.target.value)} placeholder="用一句话概括这次调研…" className={field} />
      </label>

      <BlockEditor
        initialHTML={initial?.content_html ?? ""}
        onChange={setHtml}
        uploadFile={(f) => uploadToStorage(f, "project")}
        placeholder="输入 / 唤出命令菜单，像 Notion 一样撰写调研成果…"
      />

      <div className="flex items-center gap-3 mt-6 sticky bottom-0 bg-background/90 backdrop-blur py-3 border-t border-rule">
        <button onClick={() => save(false)} disabled={busy} className="border border-ink px-5 py-2 hover:bg-ink hover:text-background transition-colors disabled:opacity-50">
          {busy ? "保存中…" : "保存草稿"}
        </button>
        <button onClick={() => save(true)} disabled={busy} className="bg-ink text-background px-5 py-2 hover:bg-vermilion transition-colors disabled:opacity-50">
          {initial?.published ? "更新并发布" : "发布"}
        </button>
        <span className="text-[11px] text-ink-faint">带 * 为必填，用于成果页的时间/地点/主题/发起人筛选</span>
      </div>
    </div>
  );
}
