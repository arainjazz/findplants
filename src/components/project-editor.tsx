import { useRef, useState } from "react";
import { FileText } from "lucide-react";
import { useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import { useAuth } from "@/hooks/use-auth";
import { supabase } from "@/integrations/supabase/client";
import { compressImage, extForMime } from "@/lib/image-compress";
import { BlockEditor, type BlockEditorHandle } from "@/components/block-editor";
import { docToImages, isConvertibleDoc } from "@/lib/doc-to-images";
import { createProject, updateProject, type Project } from "@/lib/projects";

/** Create / edit a 项目驱动调研成果 entry. 时间/地点/主题/发起人 are required — they
 *  power the filters on the public /projects page. */
export function ProjectEditor({ initial }: { initial?: Project }) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const coverInputRef = useRef<HTMLInputElement>(null);
  const docInputRef = useRef<HTMLInputElement>(null);
  const editorRef = useRef<BlockEditorHandle>(null);

  const [title, setTitle] = useState(initial?.title ?? "");
  const [projectDate, setProjectDate] = useState(initial?.project_date ?? "");
  const [location, setLocation] = useState(initial?.location ?? "");
  const [theme, setTheme] = useState(initial?.theme ?? "");
  const [initiator, setInitiator] = useState(initial?.initiator ?? "");
  const [summary, setSummary] = useState(initial?.summary ?? "");
  const [coverUrl, setCoverUrl] = useState(initial?.cover_url ?? "");
  const [html, setHtml] = useState(initial?.content_html ?? "");
  const [busy, setBusy] = useState(false);
  const [docBusy, setDocBusy] = useState(false);
  const [docProgress, setDocProgress] = useState("");

  // ── PDF → 图片 ────────────────────────────────────────────────────────────
  // 源文件**一次都不上传**：转换在浏览器里做完，只有渲染出的图片进 storage。
  // 服务器上没有那份 PDF，也就没有任何 URL 能指向它 —— 这比前端拦右键靠谱得多
  // （拦右键 F12 一开就绕过了）。
  const insertDoc = async (file: File) => {
    if (!user) return void toast.error("请先登录");
    setDocBusy(true);
    setDocProgress("");
    try {
      const pages = await docToImages(file, {
        onProgress: (done, total) => setDocProgress(`渲染中 ${done}/${total}`),
      });
      setDocProgress(`上传中 0/${pages.length}`);
      const urls: string[] = [];
      for (const [i, p] of pages.entries()) {
        urls.push(await uploadToStorage(p.file, "project-doc", /* alreadyCompressed */ true));
        setDocProgress(`上传中 ${i + 1}/${pages.length}`);
      }
      editorRef.current?.appendImages(urls);
      toast.success(`已插入 ${urls.length} 页图片`);
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setDocBusy(false);
      setDocProgress("");
    }
  };

  /**
   * 编辑器自己的上传口。**必须在这里拦 PDF/PPT** —— BlockNote 允许直接把文件拖进
   * 正文，不拦的话 `uploadToStorage` 会把 PDF 原样传上去（compressImage 对 PDF 抛错，
   * 而那个 catch 是「压缩失败就传原件」），源文件就这么泄出去了。
   * 拦下来顺手转掉：第一页交还给 BlockNote 自己那个块，其余页追加到文末。
   */
  const handleEditorUpload = async (f: File): Promise<string> => {
    if (isConvertibleDoc(f)) {
      const pages = await docToImages(f, {
        onProgress: (done, total) => setDocProgress(`渲染中 ${done}/${total}`),
      });
      const urls: string[] = [];
      for (const p of pages) urls.push(await uploadToStorage(p.file, "project-doc", true));
      setDocProgress("");
      if (urls.length > 1) editorRef.current?.appendImages(urls.slice(1));
      return urls[0];
    }
    if (!f.type.startsWith("image/")) {
      throw new Error("正文只支持插入图片与 PDF（PDF 会转成图片）。");
    }
    return uploadToStorage(f, "project");
  };

  const uploadToStorage = async (
    file: File,
    prefix: string,
    alreadyCompressed = false,
  ): Promise<string> => {
    let toUpload: Blob | File = file;
    if (!alreadyCompressed) {
      try {
        toUpload = await compressImage(file);
      } catch (err) {
        console.error("compress failed, using original:", err);
      }
    }
    const ext = extForMime(toUpload.type, file.name.split(".").pop() || "jpg");
    const path = `${user!.id}/${prefix}/${Date.now()}-${Math.random().toString(36).slice(2, 6)}.${ext}`;
    const { error } = await supabase.storage
      .from("plant-images")
      .upload(path, toUpload, { upsert: false, contentType: toUpload.type });
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

  const requiredMissing = (publish: boolean) => {
    if (!title.trim()) return "请输入项目标题";
    // 预告与成果页的展示风格是 发起人+封面海报+时间+地点+主题+摘要 —— 缺海报那张卡就是空的。
    // 但只在**发布**时卡：草稿可以先把文字存下来、海报后补。
    if (publish && !coverUrl.trim()) return "请添加封面海报（发布必填）";
    if (!projectDate) return "请选择项目时间（必填）";
    if (!location.trim()) return "请填写项目地点（必填）";
    if (!theme.trim()) return "请填写主题（必填）";
    if (!initiator.trim()) return "请填写发起人（必填）";
    return null;
  };

  const save = async (publish: boolean) => {
    if (!user) return toast.error("请先登录");
    const miss = requiredMissing(publish);
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
          <img src={coverUrl} alt="" className="w-full h-auto block" />
          <div className="absolute top-2 right-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
            <button onClick={() => coverInputRef.current?.click()} className="text-xs bg-background/90 border border-ink/40 px-2 py-1 hover:bg-background">更换</button>
            <button onClick={() => setCoverUrl("")} className="text-xs bg-background/90 border border-ink/40 px-2 py-1 hover:bg-background">移除</button>
          </div>
        </div>
      ) : (
        <button onClick={() => coverInputRef.current?.click()} className="mb-6 text-xs text-ink-faint border border-dashed border-rule rounded-lg px-3 py-2 hover:border-ink hover:text-ink transition-colors">
          + 添加封面海报（发布必填）
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

      {/* 插入文档按钮：从 text-xs 细边框放大到 border-2 + text-sm，并把说明挪到按钮下方
          单独成行 —— 之前和一长串说明挤在 flex-wrap 同一行里，窄屏上按钮又小又难点中
          （用户 2026-07-25 反馈「非常难选择到文件这个按钮」）。 */}
      <div className="mb-2">
        <button
          type="button"
          onClick={() => docInputRef.current?.click()}
          disabled={docBusy}
          className="inline-flex items-center gap-2 border-2 border-ink px-4 py-2 text-sm font-semibold transition-colors hover:bg-ink hover:text-background disabled:opacity-50"
        >
          <FileText className="h-4 w-4" />
          {docBusy ? docProgress || "转换中…" : "插入 PDF / 幻灯片（转为图片）"}
        </button>
        <p className="mt-1.5 text-xs text-ink-faint">
          PDF 会逐页转成压缩图片插入正文，源文件不上传 —— 读者右键只能存到图片。
          幻灯片（PPT / PPTX / Keynote）请先在原软件里「导出为 PDF」，再选它插入。
        </p>
      </div>
      {/* accept 放开到也能选中 PPT/Keynote —— 之前只收 .pdf，用户想插幻灯片时文件被灰掉、
          根本选不中（正是「很难选择到文件」的一半原因）。选中后 docToImages 会给出
          「请先导出为 PDF」的明确指引，好过让文件在选择框里直接不可选。 */}
      <input
        ref={docInputRef}
        type="file"
        accept="application/pdf,.pdf,.ppt,.pptx,.odp,application/vnd.ms-powerpoint,application/vnd.openxmlformats-officedocument.presentationml.presentation,application/vnd.oasis.opendocument.presentation"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void insertDoc(f);
          e.target.value = "";
        }}
      />

      <BlockEditor
        ref={editorRef}
        initialHTML={initial?.content_html ?? ""}
        onChange={setHtml}
        uploadFile={handleEditorUpload}
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
