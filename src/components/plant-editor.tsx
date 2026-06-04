import { useState, useEffect, useRef } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import {
  FolderOpen,
  Link2,
  Image as ImageIcon,
  Globe,
  Trash2,
  Wand2,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { slugify, type Plant } from "@/lib/plants";
import { toast } from "sonner";
import { RichEditor } from "@/components/rich-editor";
import { HtmlDocEditor, ImageSearchDialog } from "@/components/html-doc-editor";
import { IUCN_CATEGORIES } from "@/lib/catalogs";
import {
  fetchAllTags,
  fetchTagsForPlant,
  attachPlantsToTag,
  detachPlantFromTag,
  type TagWithCount,
} from "@/lib/tags";

type Props = { initial?: Plant | null };

export function PlantEditor({ initial }: Props) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const htmlInputRef = useRef<HTMLInputElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const pendingHtmlRef = useRef<{ file: File; text: string; refs: string[] } | null>(null);
  const hydratedDraftRef = useRef(false);
  const draftKey = `plant-editor-draft:${initial?.id ?? "new"}`;

  const [title, setTitle] = useState(initial?.title ?? "");
  const [slug, setSlug] = useState(initial?.slug ?? "");
  const [scientificName, setScientificName] = useState(initial?.scientific_name ?? "");
  const [commonNameEn, setCommonNameEn] = useState(initial?.common_name_en ?? "");
  const [family, setFamily] = useState(initial?.family ?? "");
  const [genus, setGenus] = useState(initial?.genus ?? "");
  const [iucnStatus, setIucnStatus] = useState(initial?.iucn_status ?? "");
  const [habitat, setHabitat] = useState(initial?.habitat ?? "");
  const [summary, setSummary] = useState(initial?.summary ?? "");
  const [coverUrl, setCoverUrl] = useState(initial?.cover_url ?? "");
  const [contentType, setContentType] = useState<"rich" | "html">(initial?.content_type ?? "rich");
  const [richContent, setRichContent] = useState(initial?.rich_content ?? "");
  const [htmlUrl, setHtmlUrl] = useState(initial?.html_url ?? "");
  const [tags, setTags] = useState<string>((initial?.tags ?? []).join(", "));
  const [isFeatured, setIsFeatured] = useState(initial?.is_featured ?? false);
  const [saving, setSaving] = useState(false);
  const [uploadingCover, setUploadingCover] = useState(false);
  const [uploadingHtml, setUploadingHtml] = useState(false);
  const [extracting, setExtracting] = useState(false);
  const [coverMenu, setCoverMenu] = useState<{ x: number; y: number } | null>(null);
  const coverFileRef = useRef<HTMLInputElement>(null);
  const coverEdited = useRef(Boolean(initial?.cover_url));
  const slugTouchedRef = useRef(Boolean(initial?.slug));
  const [allTags, setAllTags] = useState<TagWithCount[]>([]);
  const [selectedTagIds, setSelectedTagIds] = useState<Set<string>>(new Set());
  const [originalTagIds, setOriginalTagIds] = useState<Set<string>>(new Set());
  const [showCoverSearch, setShowCoverSearch] = useState(false);
  const [pageImages, setPageImages] = useState<string[]>([]);
  const [showPagePicker, setShowPagePicker] = useState(false);
  const [dupCandidates, setDupCandidates] = useState<
    Array<{ id: string; title: string; slug: string; html_url: string | null; co_author_names: string[]; author_id: string }>
  >([]);
  const [dupOpen, setDupOpen] = useState(false);
  const [mergeBusy, setMergeBusy] = useState(false);

  // Load all tags + current plant's tags
  useEffect(() => {
    fetchAllTags().then(setAllTags).catch(() => {});
    if (initial?.id) {
      fetchTagsForPlant(initial.id).then((ts) => {
        const ids = new Set(ts.map((t) => t.id));
        setSelectedTagIds(ids);
        setOriginalTagIds(new Set(ids));
      }).catch(() => {});
    }
  }, [initial?.id]);

  // Load all <img> srcs from html doc whenever htmlUrl changes (for page picker)
  useEffect(() => {
    if (!htmlUrl) { setPageImages([]); return; }
    let cancel = false;
    fetch(htmlUrl).then((r) => r.text()).then((text) => {
      if (cancel) return;
      const doc = new DOMParser().parseFromString(text, "text/html");
      const srcs: string[] = [];
      doc.querySelectorAll("img").forEach((img) => {
        const s = img.getAttribute("src");
        if (!s) return;
        try { srcs.push(new URL(s, htmlUrl).href); } catch { srcs.push(s); }
      });
      const unique = Array.from(new Set(srcs));
      setPageImages(unique);
      // Auto-populate cover with the first image as soon as HTML is uploaded,
      // so the editor can immediately right-click to refine it instead of
      // hunting for a file input.
      if (unique.length > 0 && !coverEdited.current && !coverUrl) {
        setCoverUrl(unique[0]);
      }
    }).catch(() => setPageImages([]));
    return () => { cancel = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [htmlUrl]);

  useEffect(() => {
    if (!initial && title && !slug) setSlug(slugify(title));
  }, [title, initial, slug]);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(draftKey);
      if (!raw) return;
      const draft = JSON.parse(raw);
      const dbTime = initial?.updated_at ? new Date(initial.updated_at).getTime() : 0;
      if (!draft.savedAt || draft.savedAt <= dbTime) return;
      setTitle(draft.title ?? "");
      setSlug(draft.slug ?? "");
      setScientificName(draft.scientificName ?? "");
      setCommonNameEn(draft.commonNameEn ?? "");
      setFamily(draft.family ?? "");
      setGenus(draft.genus ?? "");
      setIucnStatus(draft.iucnStatus ?? "");
      setHabitat(draft.habitat ?? "");
      setSummary(draft.summary ?? "");
      setCoverUrl(draft.coverUrl ?? "");
      setContentType(draft.contentType ?? "rich");
      setRichContent(draft.richContent ?? "");
      setHtmlUrl(draft.htmlUrl ?? "");
      setTags(draft.tags ?? "");
      setIsFeatured(Boolean(draft.isFeatured));
      toast.message("已恢复上次未保存的编辑草稿");
    } finally {
      hydratedDraftRef.current = true;
    }
  }, [draftKey, initial?.updated_at]);

  useEffect(() => {
    if (!hydratedDraftRef.current) return;
    const draft = {
      savedAt: Date.now(),
      title,
      slug,
      scientificName,
      commonNameEn,
      family,
      genus,
      iucnStatus,
      habitat,
      summary,
      coverUrl,
      contentType,
      richContent,
      htmlUrl,
      tags,
      isFeatured,
    };
    localStorage.setItem(draftKey, JSON.stringify(draft));
  }, [
    coverUrl,
    contentType,
    draftKey,
    family,
    genus,
    iucnStatus,
    habitat,
    htmlUrl,
    isFeatured,
    richContent,
    scientificName,
    commonNameEn,
    slug,
    summary,
    tags,
    title,
  ]);

  const uploadFile = async (file: File, bucket: "plant-images" | "plant-html") => {
    if (!user) throw new Error("未登录");
    const ext = file.name.split(".").pop() || "bin";
    const path = `${user.id}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
    const { error } = await supabase.storage.from(bucket).upload(path, file, {
      cacheControl: "3600",
      upsert: false,
      contentType: file.type || (bucket === "plant-html" ? "text/html" : undefined),
    });
    if (error) throw error;
    return supabase.storage.from(bucket).getPublicUrl(path).data.publicUrl;
  };

  const onCoverUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    setUploadingCover(true);
    try {
      setCoverUrl(await uploadFile(f, "plant-images"));
      coverEdited.current = true;
      toast.success("封面已上传");
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setUploadingCover(false);
    }
  };

  // Close cover menu on outside click / escape
  useEffect(() => {
    if (!coverMenu) return;
    const close = () => setCoverMenu(null);
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") close(); };
    window.addEventListener("click", close);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("click", close);
      window.removeEventListener("keydown", onKey);
    };
  }, [coverMenu]);

  // Pull the first <img> from an uploaded HTML doc, used as fallback cover when user didn't set one.
  const firstImageFromHtml = async (url: string): Promise<string | null> => {
    try {
      const text = await fetch(url).then((r) => r.text());
      const doc = new DOMParser().parseFromString(text, "text/html");
      const img = doc.querySelector("img");
      const src = img?.getAttribute("src");
      if (!src) return null;
      try { return new URL(src, url).href; } catch { return src; }
    } catch { return null; }
  };

  const applyExtractedMeta = (data: Record<string, unknown>) => {
    // The model occasionally puts both family + genus into one string like
    // "花蔺科 Butomaceae 花蔺属 Butomus" or "Butomaceae Butomus".
    // Split them so each field gets its own value.
    let rawFamily = typeof data.family === "string" ? data.family.trim() : "";
    let rawGenus = typeof data.genus === "string" ? data.genus.trim() : "";
    if (rawFamily) {
      // Chinese "X科 Y属 Z" style
      const zhM = rawFamily.match(/^(.*?[\u4e00-\u9fff]科(?:\s+[A-Z][a-z]+)?)[\s,，;；·•|]+(.*?[\u4e00-\u9fff]属(?:\s+[A-Z][a-z]+)?.*)$/);
      if (zhM) {
        rawFamily = zhM[1].trim();
        if (!rawGenus) rawGenus = zhM[2].trim();
      } else {
        // Pure latin "Butomaceae Butomus"
        const laM = rawFamily.match(/^([A-Z][a-z]+aceae)\s+([A-Z][a-z]+)\b/);
        if (laM) {
          rawFamily = laM[1];
          if (!rawGenus) rawGenus = laM[2];
        }
      }
    }
    if (typeof data.title === "string" && data.title.trim()) setTitle(data.title.trim());
    if (typeof data.scientific_name === "string" && data.scientific_name.trim())
      setScientificName(data.scientific_name.trim());
    if (typeof data.common_name_en === "string" && data.common_name_en.trim())
      setCommonNameEn(data.common_name_en.trim());
    if (rawFamily) setFamily(rawFamily);
    if (rawGenus) setGenus(rawGenus);
    else if (!rawGenus && typeof data.scientific_name === "string") {
      // Fall back to first token of scientific name as genus
      const first = data.scientific_name.trim().split(/\s+/)[0];
      if (first && /^[A-Z][a-z]+$/.test(first)) setGenus(first);
    }
    if (typeof data.habitat === "string" && data.habitat.trim()) setHabitat(data.habitat.trim());
    if (typeof data.iucn_status === "string" && data.iucn_status.trim()) {
      const code = data.iucn_status.trim().toUpperCase();
      if (IUCN_CATEGORIES.some((c) => c.code === code)) setIucnStatus(code);
    }
    if (typeof data.summary === "string" && data.summary.trim()) setSummary(data.summary.trim());
    if (Array.isArray(data.tags) && data.tags.length) {
      const existing = tags
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean);
      const incoming = data.tags.map((t) => String(t).trim()).filter(Boolean);
      setTags(Array.from(new Set([...existing, ...incoming])).join(", "));
    }
    if (!slugTouchedRef.current) {
      const rawSlug =
        (typeof data.slug === "string" && data.slug.trim()) ||
        (typeof data.scientific_name === "string" && data.scientific_name.trim()) ||
        "";
      const cleaned = slugify(rawSlug);
      // Reject if slugify produced a fallback p-xxx (means input had no ASCII)
      if (cleaned && !cleaned.startsWith("p-")) setSlug(cleaned);
    }
  };

  const extractMetaFromUrl = async (url: string, successMessage: string) => {
    setExtracting(true);
    try {
      const { data, error } = await supabase.functions.invoke("extract-plant-meta", {
        body: { htmlUrl: url },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      applyExtractedMeta(data);
      toast.success(successMessage);
      // After AI extraction, check for duplicate scientific name (new entries only).
      const sci = typeof data?.scientific_name === "string" ? data.scientific_name.trim() : "";
      if (sci && !initial) await checkDuplicateScientific(sci);
    } catch (err) {
      toast.error("识别失败：" + (err as Error).message);
    } finally {
      setExtracting(false);
    }
  };

  const checkDuplicateScientific = async (sci: string) => {
    const { data } = await supabase
      .from("plants")
      .select("id, title, slug, html_url, co_author_names, author_id, parent_id")
      .ilike("scientific_name", sci)
      .is("parent_id", null)
      .limit(8);
    const hits = (data ?? []) as typeof dupCandidates extends Array<infer T> ? T[] : never;
    if (hits.length > 0) {
      setDupCandidates(hits as typeof dupCandidates);
      setDupOpen(true);
    }
  };

  // Merge: append uploaded html body into target plant's html as a new section,
  // upload merged file, set target html_url, add current user as co-author.
  const performMerge = async (target: typeof dupCandidates[number]) => {
    if (!user || !htmlUrl) return;
    setMergeBusy(true);
    try {
      const [origText, newText] = await Promise.all([
        target.html_url ? fetch(target.html_url).then((r) => r.text()) : Promise.resolve(""),
        fetch(htmlUrl).then((r) => r.text()),
      ]);
      const origDoc = new DOMParser().parseFromString(origText || "<!doctype html><html><head></head><body></body></html>", "text/html");
      const newDoc = new DOMParser().parseFromString(newText, "text/html");
      const section = origDoc.createElement("section");
      const editorName =
        (user.user_metadata?.full_name as string | undefined) ||
        (user.user_metadata?.name as string | undefined) ||
        user.email || "共建者";
      section.setAttribute("class", "merged-contribution");
      section.setAttribute("style", "margin:3rem 0;padding:1.5rem 0;border-top:2px solid #c0392b;");
      const heading = origDoc.createElement("h2");
      heading.textContent = `共建者补充：${editorName} · ${new Date().toLocaleDateString("zh-CN")}`;
      heading.setAttribute("style", "font-size:1.3em;color:#c0392b;margin:0 0 1rem;");
      section.appendChild(heading);
      // Append the body of the new doc (so we keep its block markup)
      while (newDoc.body && newDoc.body.firstChild) {
        section.appendChild(origDoc.importNode(newDoc.body.firstChild, true));
        newDoc.body.removeChild(newDoc.body.firstChild);
      }
      origDoc.body.appendChild(section);
      const fullDoc = "<!DOCTYPE html>\n" + origDoc.documentElement.outerHTML;
      const blob = new Blob([fullDoc], { type: "text/html" });
      const path = `${user.id}/merge-${Date.now()}.html`;
      const { error: upErr } = await supabase.storage.from("plant-html").upload(path, blob, {
        cacheControl: "3600", upsert: false, contentType: "text/html",
      });
      if (upErr) throw upErr;
      const mergedUrl = supabase.storage.from("plant-html").getPublicUrl(path).data.publicUrl;
      // Add co-author if not already present.
      const coIds = Array.from(new Set([...(target.co_author_names ? (target as any).co_author_ids ?? [] : []), user.id]));
      const coNames = Array.from(new Set([...(target.co_author_names ?? []), editorName]));
      const { error: updErr } = await supabase.from("plants")
        .update({ html_url: mergedUrl, co_author_ids: coIds, co_author_names: coNames })
        .eq("id", target.id);
      if (updErr) throw updErr;
      await supabase.from("plant_edits").insert({
        plant_id: target.id,
        editor_id: user.id,
        editor_name: editorName,
        kind: "merge",
        marker_n: 0,
        source: "plant_editor",
        summary: `${editorName} 将新上传的 HTML 合并到已有条目「${target.title}」并成为共建者`,
      });
      toast.success("已合并到现有条目");
      setDupOpen(false);
      localStorage.removeItem(draftKey);
      qc.invalidateQueries({ queryKey: ["plants"] });
      qc.invalidateQueries({ queryKey: ["plant", target.slug] });
      qc.invalidateQueries({ queryKey: ["home"] });
      navigate({ to: "/plants/$slug", params: { slug: target.slug } });
    } catch (err) {
      toast.error("合并失败：" + (err as Error).message);
    } finally {
      setMergeBusy(false);
    }
  };

  // Branch: continue with normal save but record parent_id and a "branch" log.
  const [branchParentId, setBranchParentId] = useState<string | null>(null);
  const performBranch = (target: typeof dupCandidates[number]) => {
    setBranchParentId(target.id);
    setDupOpen(false);
    toast.message("已设为分支，保存时将关联到原条目并显示「由 X 创建」标签");
  };

  // Finalize: rewrite refs (if image map provided) and upload HTML to storage.
  const finalizeHtmlUpload = async (htmlFile: File, text: string, imageFiles: File[]) => {
    let finalText = text;
    if (imageFiles.length > 0) {
      toast.message(`正在上传 ${imageFiles.length} 张配图…`);
      const nameMap = new Map<string, string>();
      for (const img of imageFiles) {
        const url = await uploadFile(img, "plant-images");
        nameMap.set(img.name, url);
        const rel = (img as File & { webkitRelativePath?: string }).webkitRelativePath;
        if (rel) {
          nameMap.set(rel, url);
          const stripped = rel.split("/").slice(1).join("/");
          if (stripped) nameMap.set(stripped, url);
        }
      }
      finalText = rewriteLocalAssetPaths(text, nameMap);
      toast.success(`已重写 HTML 中的本地图片路径（${imageFiles.length} 张）`);
    }
    const finalHtmlFile = new File([finalText], htmlFile.name, { type: "text/html" });
    const uploadedUrl = await uploadFile(finalHtmlFile, "plant-html");
    setHtmlUrl(uploadedUrl);
    toast.success("HTML 已上传");
    await extractMetaFromUrl(uploadedUrl, "已根据 HTML 自动填入标题和字段，请检查后保存");
  };

  const onHtmlUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    e.target.value = "";
    if (files.length === 0) return;
    const htmlFile = files.find((f) => /\.html?$/i.test(f.name) || f.type === "text/html");
    if (!htmlFile) return toast.error("请至少选择一个 HTML 文件");
    const imageFiles = files.filter((f) => f !== htmlFile && f.type.startsWith("image/"));
    setUploadingHtml(true);
    try {
      const text = await htmlFile.text();
      // If user only picked the HTML (no images alongside), check for local refs.
      // When found, auto-open a second image picker so the user only has to
      // choose the referenced images — no manual Ctrl/⌘ multi-select required.
      if (imageFiles.length === 0) {
        const localRefs = findLocalAssetRefs(text);
        if (localRefs.length > 0) {
          pendingHtmlRef.current = { file: htmlFile, text, refs: localRefs };
          const sample = localRefs.slice(0, 3).join("、");
          toast.message(
            `检测到 ${localRefs.length} 张本地图片（如 ${sample}${localRefs.length > 3 ? " …" : ""}），请在弹窗中选中它们`,
            { duration: 6000 },
          );
          setUploadingHtml(false);
          setTimeout(() => imageInputRef.current?.click(), 50);
          return;
        }
      }
      await finalizeHtmlUpload(htmlFile, text, imageFiles);
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setUploadingHtml(false);
    }
  };

  const onImagesForPendingHtml = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    e.target.value = "";
    const pending = pendingHtmlRef.current;
    if (!pending) return;
    setUploadingHtml(true);
    try {
      if (files.length === 0) {
        toast.warning("未选择图片，已按原样上传 HTML；线上将无法显示这些本地图片");
        await finalizeHtmlUpload(pending.file, pending.text, []);
      } else {
        await finalizeHtmlUpload(pending.file, pending.text, files.filter((f) => f.type.startsWith("image/")));
      }
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      pendingHtmlRef.current = null;
      setUploadingHtml(false);
    }
  };


  const onExtractMeta = async () => {
    if (!htmlUrl) return;
    await extractMetaFromUrl(htmlUrl, "已识别并填充，请检查后点「保存修改」提交");
  };

  const onSave = async () => {
    if (!user) return;
    if (!title.trim()) return toast.error("请填写标题");
    const finalSlug = slug.trim() || slugify(title);
    if (contentType === "html" && !htmlUrl) return toast.error("请上传 HTML 文件");

    // If user never touched the cover and we have an HTML doc, fall back to its first image.
    let resolvedCover = coverUrl;
    if (!resolvedCover && !coverEdited.current && contentType === "html" && htmlUrl) {
      resolvedCover = (await firstImageFromHtml(htmlUrl)) ?? "";
      if (resolvedCover) setCoverUrl(resolvedCover);
    }

    setSaving(true);
    const payload = {
      title: title.trim(),
      slug: finalSlug,
      scientific_name: scientificName.trim() || null,
      common_name_en: commonNameEn.trim() || null,
      family: family.trim() || null,
      genus: genus.trim() || null,
      iucn_status: iucnStatus || null,
      habitat: habitat.trim() || null,
      summary: summary.trim() || null,
      cover_url: resolvedCover || null,
      content_type: contentType,
      rich_content: contentType === "rich" ? richContent : null,
      html_url: contentType === "html" ? htmlUrl : null,
      tags: tags
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean),
      is_featured: isFeatured,
      author_id: user.id,
    };

    let newPlantId: string | null = null;
    let error;
    if (initial) {
      ({ error } = await supabase.from("plants").update(payload).eq("id", initial.id));
    } else {
      const insertPayload = branchParentId
        ? { ...payload, parent_id: branchParentId }
        : payload;
      const res = await supabase.from("plants").insert(insertPayload).select("id").single();
      error = res.error;
      newPlantId = (res.data?.id as string) ?? null;
    }

    setSaving(false);
    if (error) return toast.error(error.message);

    if (newPlantId) {
      const editorName =
        (user.user_metadata?.full_name as string | undefined) ||
        (user.user_metadata?.name as string | undefined) ||
        user.email ||
        "编辑者";
      await supabase.from("plant_edits").insert({
        plant_id: newPlantId,
        editor_id: user.id,
        editor_name: editorName,
        kind: "create",
        marker_n: 0,
        source: "plant_editor",
        summary: `${editorName} 新建了条目「${payload.title}」${payload.content_type === "html" ? "（HTML）" : ""}`,
      });
      if (branchParentId) {
        await supabase.from("plant_edits").insert({
          plant_id: newPlantId,
          editor_id: user.id,
          editor_name: editorName,
          kind: "branch",
          marker_n: 0,
          source: "plant_editor",
          summary: `${editorName} 创建了同名分支条目（保留各自详情页，原条目 id=${branchParentId}）`,
        });
      }
    }

    // Sync plant_tags (only for editors — RLS will reject otherwise; ignore errors silently)
    const targetId = initial?.id ?? newPlantId;
    if (targetId) {
      const toAdd = [...selectedTagIds].filter((id) => !originalTagIds.has(id));
      const toRemove = [...originalTagIds].filter((id) => !selectedTagIds.has(id));
      for (const tid of toAdd) {
        await attachPlantsToTag(tid, [targetId], user.id).catch(() => {});
      }
      for (const tid of toRemove) {
        await detachPlantFromTag(tid, targetId).catch(() => {});
      }
    }

    localStorage.removeItem(draftKey);
    toast.success(initial ? "已更新" : "已创建");
    qc.invalidateQueries({ queryKey: ["my-plants"] });
    qc.invalidateQueries({ queryKey: ["plants"] });
    qc.invalidateQueries({ queryKey: ["home"] });
    navigate({ to: "/admin" });
  };

  return (
    <div
      className="space-y-6 w-full"
      onKeyDownCapture={(e) => {
        // 防止任意输入框回车触发隐式表单提交（本组件已不再使用 <form>）
        if (e.key === "Enter") {
          const target = e.target as HTMLElement;
          if (target.tagName === "INPUT") e.preventDefault();
        }
      }}
    >
      <input
        ref={htmlInputRef}
        type="file"
        accept=".html,.htm,text/html,image/*"
        multiple
        onChange={onHtmlUpload}
        disabled={uploadingHtml || extracting}
        className="sr-only"
        tabIndex={-1}
      />
      <input
        ref={imageInputRef}
        type="file"
        accept="image/*"
        multiple
        onChange={onImagesForPendingHtml}
        className="sr-only"
        tabIndex={-1}
      />
      <Field label="标题 *">
        <input value={title} onChange={(e) => setTitle(e.target.value)} className={inputCls} />
      </Field>
      <Field label="Slug（URL 路径）">
        <input
          value={slug}
          onChange={(e) => {
            slugTouchedRef.current = true;
            setSlug(e.target.value);
          }}
          className={inputCls}
          placeholder="自动从标题生成"
        />
      </Field>
      <div className="grid sm:grid-cols-2 gap-4">
        <Field label="学名">
          <input
            value={scientificName}
            onChange={(e) => setScientificName(e.target.value)}
            className={inputCls}
            placeholder="Butomus umbellatus L."
          />
        </Field>
        <Field label="英文俗名（Common name）">
          <input
            value={commonNameEn}
            onChange={(e) => setCommonNameEn(e.target.value)}
            className={inputCls}
            placeholder="Flowering rush"
          />
        </Field>
        <Field label="科 Family">
          <input
            value={family}
            onChange={(e) => setFamily(e.target.value)}
            className={inputCls}
            placeholder="花蔺科 Butomaceae"
          />
        </Field>
        <Field label="属 Genus">
          <input
            value={genus}
            onChange={(e) => setGenus(e.target.value)}
            className={inputCls}
            placeholder="Butomus"
          />
        </Field>
        <Field label="IUCN 评级">
          <select
            value={iucnStatus}
            onChange={(e) => setIucnStatus(e.target.value)}
            className={inputCls}
          >
            <option value="">未评估 / 不填</option>
            {IUCN_CATEGORIES.map((c) => (
              <option key={c.code} value={c.code}>{c.code} · {c.zh}</option>
            ))}
          </select>
        </Field>
        <Field label="物种入侵 Invasion">
          <input
            value={habitat}
            onChange={(e) => setHabitat(e.target.value)}
            className={inputCls}
            placeholder="如：在北美、欧洲构成入侵；无则填「无记录」"
          />
        </Field>
        <Field label="标签（逗号分隔）">
          <input
            value={tags}
            onChange={(e) => setTags(e.target.value)}
            className={inputCls}
            placeholder="水生, 多年生"
          />
        </Field>
      </div>
      <Field label="摘要">
        <textarea
          rows={3}
          value={summary}
          onChange={(e) => setSummary(e.target.value)}
          className={inputCls}
        />
      </Field>

      <Field label="封面图">
        <div className="space-y-2">
          <input
            ref={coverFileRef}
            type="file"
            accept="image/*"
            onChange={onCoverUpload}
            disabled={uploadingCover}
            className="sr-only"
            tabIndex={-1}
          />
          {coverUrl ? (
            <div className="flex items-start gap-3 flex-wrap">
              <img
                src={coverUrl}
                alt="封面"
                className="w-40 h-40 object-cover border border-rule cursor-context-menu"
                onContextMenu={(e) => {
                  e.preventDefault();
                  setCoverMenu({ x: e.clientX, y: e.clientY });
                }}
              />
              <div className="text-xs text-ink-faint space-y-1 max-w-md">
                <p>默认选择页面中的第一张作为封面图,你也可以右键点击封面可:</p>
                <ul className="space-y-0.5 list-none">
                  <li className="inline-flex items-center gap-1.5"><FolderOpen className="w-3.5 h-3.5" /> 本地上传</li>
                  <li className="inline-flex items-center gap-1.5 ml-3"><Link2 className="w-3.5 h-3.5" /> 输入网址</li>
                  <li className="inline-flex items-center gap-1.5 ml-3"><ImageIcon className="w-3.5 h-3.5" /> 从详情页选图</li>
                  <li className="inline-flex items-center gap-1.5 ml-3"><Globe className="w-3.5 h-3.5" /> 在线搜索(GBIF/iNaturalist/Wikimedia)</li>
                </ul>
              </div>
            </div>
          ) : (
            <div className="flex items-center gap-3 flex-wrap text-sm">
              <button
                type="button"
                onClick={() => coverFileRef.current?.click()}
                disabled={uploadingCover}
                className="border border-ink px-3 py-1.5 hover:bg-ink hover:text-background transition-colors disabled:opacity-60 inline-flex items-center gap-1.5"
              >
                <FolderOpen className="w-4 h-4" />
                {uploadingCover ? "上传中…" : "本地上传"}
              </button>
              <button
                type="button"
                onClick={() => setShowCoverSearch(true)}
                className="border border-ink px-3 py-1.5 hover:bg-ink hover:text-background transition-colors inline-flex items-center gap-1.5"
              >
                <Globe className="w-4 h-4" />
                在线搜索
              </button>
              {pageImages.length > 0 && (
                <button
                  type="button"
                  onClick={() => setShowPagePicker(true)}
                  className="border border-ink px-3 py-1.5 hover:bg-ink hover:text-background transition-colors inline-flex items-center gap-1.5"
                >
                  <ImageIcon className="w-4 h-4" />
                  从详情页选图({pageImages.length})
                </button>
              )}
              {contentType === "html" && htmlUrl && (
                <span className="text-xs text-ink-faint">未设置封面:保存时将自动选取 HTML 中的第一张图片。</span>
              )}
            </div>
          )}
          {coverMenu && (
            <div
              role="menu"
              onClick={(e) => e.stopPropagation()}
              style={{ position: "fixed", left: coverMenu.x, top: coverMenu.y, zIndex: 60 }}
              className="bg-background border border-ink shadow-lg py-1 w-60 text-sm"
            >
              <MenuItem onClick={() => { setCoverMenu(null); coverFileRef.current?.click(); }} icon={<FolderOpen className="w-4 h-4" />}>替换为本地图片</MenuItem>
              <MenuItem
                onClick={() => {
                  const url = window.prompt("封面图片网址:", coverUrl);
                  if (url !== null) { setCoverUrl(url.trim()); coverEdited.current = true; }
                  setCoverMenu(null);
                }}
                icon={<Link2 className="w-4 h-4" />}
              >替换为图片网址</MenuItem>
              <MenuItem
                onClick={async () => {
                  setCoverMenu(null);
                  if (!htmlUrl) return toast.error("还未上传 HTML,无法选取");
                  const first = await firstImageFromHtml(htmlUrl);
                  if (!first) return toast.error("HTML 中未找到图片");
                  setCoverUrl(first); coverEdited.current = true;
                  toast.success("已使用 HTML 中第一张图片");
                }}
                icon={<ImageIcon className="w-4 h-4" />}
              >使用 HTML 中第一张图</MenuItem>
              <MenuItem
                onClick={() => { setCoverMenu(null); setShowPagePicker(true); }}
                disabled={pageImages.length === 0}
                icon={<ImageIcon className="w-4 h-4" />}
              >从详情页已有图片中选择({pageImages.length})</MenuItem>
              <MenuItem onClick={() => { setCoverMenu(null); setShowCoverSearch(true); }} icon={<Globe className="w-4 h-4" />}>在线搜索图片替换封面</MenuItem>
              <div className="border-t border-rule my-1" />
              <MenuItem
                onClick={() => { setCoverUrl(""); coverEdited.current = false; setCoverMenu(null); }}
                icon={<Trash2 className="w-4 h-4" />}
                danger
              >清除封面</MenuItem>
            </div>
          )}
        </div>
      </Field>

      <fieldset className="border border-ink p-5">
        <legend className="label px-2">正文类型</legend>
        <div className="flex gap-6 mb-4">
          <label className="flex items-center gap-2">
            <input
              type="radio"
              checked={contentType === "rich"}
              onChange={() => setContentType("rich")}
            />
            站内编辑
          </label>
          <label className="flex items-center gap-2">
            <input
              type="radio"
              checked={contentType === "html"}
              onChange={() => {
                setContentType("html");
                htmlInputRef.current?.click();
              }}
            />
            上传 HTML 文件
          </label>
        </div>
        {contentType === "rich" ? (
          <Field label="正文（所见即所得：可加粗、插标题、插图片、链接等）">
            <RichEditor value={richContent} onChange={setRichContent} />
          </Field>
        ) : (
          <div className="space-y-2">
            <button
              type="button"
              onClick={() => htmlInputRef.current?.click()}
              disabled={uploadingHtml || extracting}
              className="border border-ink px-4 py-2 hover:bg-ink hover:text-background transition-colors disabled:opacity-60 text-sm"
            >
              {uploadingHtml ? "上传中…" : extracting ? "AI 识别中…" : "选择 HTML 文件"}
            </button>
            {htmlUrl && (
              <>
                <p className="text-xs text-ink-faint break-all">
                  已上传：
                  <a
                    href={htmlUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="text-vermilion underline"
                  >
                    {htmlUrl}
                  </a>
                </p>
                <button
                  type="button"
                  onClick={onExtractMeta}
                  disabled={extracting}
                  className="border border-ink px-4 py-2 hover:bg-ink hover:text-background transition-colors disabled:opacity-60 text-sm inline-flex items-center gap-1.5"
                >
                  <Wand2 className="w-4 h-4" />
                  {extracting ? "AI 识别中…" : "AI 识别并自动填充字段"}
                </button>
                <p className="text-xs text-ink-faint">
                  将自动填入：学名、Slug、科属（科+属）、物种入侵、标签、摘要。已手动改过的 Slug 不会被覆盖。
                </p>
                {/* Tag dropdown — multi-select existing tags */}
                <div className="border border-rule p-3 mt-3 bg-paper-deep/20">
                  <p className="label text-[11px] mb-2">选择 Tag（多选，可挂到已创建的标签下）</p>
                  {allTags.length === 0 ? (
                    <p className="text-xs text-ink-faint">暂无已创建的 Tag，可前往管理页创建。</p>
                  ) : (
                    <div className="flex flex-wrap gap-1.5">
                      {allTags.map((t) => {
                        const on = selectedTagIds.has(t.id);
                        return (
                          <button
                            key={t.id}
                            type="button"
                            onClick={() => {
                              setSelectedTagIds((prev) => {
                                const next = new Set(prev);
                                if (next.has(t.id)) next.delete(t.id);
                                else next.add(t.id);
                                return next;
                              });
                            }}
                            className={`text-xs px-2 py-1 border ${
                              on
                                ? "bg-ink text-background border-ink"
                                : "border-rule hover:border-ink"
                            }`}
                            title={t.description ?? ""}
                          >
                            #{t.name}
                            <span className="ml-1 opacity-60">({t.plant_count})</span>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              </>
            )}
            <p className="text-xs text-ink-faint">
              提示：上传后整页将以原样在 iframe 中渲染（保留你的字体与排版）。
              <br />
              <strong>含本地图片的页面：</strong>只需选择 HTML 文件即可——系统会自动检测其中引用的本地图片，并弹出第二个窗口让你一次选中所有图片，自动上传到站内并改写 HTML 中的相对路径，避免线上无法显示。
            </p>
            {htmlUrl && (
              <div className="mt-5 pt-5 border-t border-rule">
                <p className="label mb-3">在线编辑此 HTML</p>
                <HtmlDocEditor
                  htmlUrl={htmlUrl}
                  plantId={initial?.id ?? null}
                  persistImmediately={!!initial}
                  onSaved={async (url, commentsCount) => {
                    setHtmlUrl(url);
                    if (!initial) return;
                    const { error } = await supabase
                      .from("plants")
                      .update({ html_url: url, content_type: "html" })
                      .eq("id", initial.id);
                    if (error) {
                      toast.error("自动保存失败，请点底部“保存修改”重试：" + error.message);
                      return;
                    }
                    qc.invalidateQueries({ queryKey: ["plant-by-id", initial.id] });
                    qc.invalidateQueries({ queryKey: ["plant", initial.slug] });
                    qc.invalidateQueries({ queryKey: ["plants"] });
                    qc.invalidateQueries({ queryKey: ["home"] });
                  }}
                />
              </div>
            )}
          </div>
        )}
      </fieldset>

      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={isFeatured}
          onChange={(e) => setIsFeatured(e.target.checked)}
        />
        设为「本期推荐」（在首页头条/特辑展示）
      </label>

      <div className="flex gap-3 pt-4 border-t border-rule">
        <button
          type="button"
          onClick={onSave}
          disabled={saving}
          className="bg-ink text-background px-6 py-2 hover:bg-vermilion transition-colors disabled:opacity-60"
        >
          {saving ? "保存中…" : initial ? "保存修改" : "创建条目"}
        </button>
        <button
          type="button"
          onClick={() => navigate({ to: "/admin" })}
          className="border border-ink/40 px-6 py-2 hover:bg-paper-deep"
        >
          取消
        </button>
      </div>

      {showCoverSearch && (
        <ImageSearchDialog
          initialQuery={scientificName || commonNameEn || title}
          onClose={() => setShowCoverSearch(false)}
          onPick={(url, t) => {
            setCoverUrl(url);
            coverEdited.current = true;
            setShowCoverSearch(false);
            toast.success(`已设为封面：${t}`);
          }}
        />
      )}

      {showPagePicker && (
        <div
          className="fixed inset-0 z-[60] bg-black/60 flex items-center justify-center p-4"
          onClick={() => setShowPagePicker(false)}
        >
          <div
            className="bg-background border border-ink shadow-xl w-full max-w-3xl max-h-[80vh] overflow-auto p-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-3">
              <h3 className="label text-vermilion">选择详情页中已有的图片作为封面</h3>
              <button onClick={() => setShowPagePicker(false)} className="text-xl leading-none text-ink-faint hover:text-ink">×</button>
            </div>
            {pageImages.length === 0 ? (
              <p className="text-sm text-ink-faint">未找到图片。</p>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
                {pageImages.map((src) => (
                  <button
                    key={src}
                    type="button"
                    onClick={() => {
                      setCoverUrl(src); coverEdited.current = true; setShowPagePicker(false);
                      toast.success("已设为封面");
                    }}
                    className="border border-rule hover:border-ink bg-paper-deep/30"
                  >
                    <img src={src} alt="" loading="lazy" className="w-full h-32 object-contain bg-background" />
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {dupOpen && (
        <div className="fixed inset-0 z-[60] bg-black/60 flex items-center justify-center p-4" onClick={() => setDupOpen(false)}>
          <div className="bg-background border border-ink shadow-xl w-full max-w-2xl p-5" onClick={(e) => e.stopPropagation()}>
            <h3 className="label text-vermilion mb-2">检测到同名学名已存在</h3>
            <p className="text-sm mb-3">学名「<em className="font-serif">{scientificName}</em>」已存在以下条目，请选择：</p>
            <ul className="space-y-3">
              {dupCandidates.map((c) => (
                <li key={c.id} className="border border-rule p-3">
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <p className="font-medium">{c.title}</p>
                      <p className="text-xs text-ink-faint">/plants/{c.slug}</p>
                      {c.co_author_names?.length > 0 && (
                        <p className="text-[11px] text-ink-faint mt-1">共建者：{c.co_author_names.join(", ")}</p>
                      )}
                    </div>
                    <div className="flex gap-2 shrink-0">
                      <button
                        type="button"
                        disabled={mergeBusy}
                        onClick={() => performMerge(c)}
                        className="bg-emerald-700 text-white px-3 py-1.5 text-xs hover:bg-emerald-800 disabled:opacity-60"
                      >
                        {mergeBusy ? "合并中…" : "合并到此条目"}
                      </button>
                      <button
                        type="button"
                        onClick={() => performBranch(c)}
                        className="border border-ink px-3 py-1.5 text-xs hover:bg-ink hover:text-background"
                      >
                        不合并 · 创建分支
                      </button>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
            <div className="flex justify-end mt-4">
              <button onClick={() => setDupOpen(false)} className="text-sm text-ink-faint hover:text-ink">取消</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const inputCls =
  "w-full border border-ink px-3 py-2 bg-transparent focus:outline-none focus:border-vermilion";
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="block">
      <span className="label block mb-1">{label}</span>
      {children}
    </div>
  );
}

function MenuItem({
  onClick,
  icon,
  disabled,
  danger,
  children,
}: {
  onClick: () => void;
  icon?: React.ReactNode;
  disabled?: boolean;
  danger?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`w-full text-left px-3 py-2 hover:bg-paper-deep inline-flex items-center gap-2 ${danger ? "text-destructive" : ""} disabled:opacity-50`}
    >
      {icon}
      <span>{children}</span>
    </button>
  );

// ─── Local asset helpers for HTML uploads ───────────────────────────────────
// Detect <img src>, <source src/srcset>, <link href>, plain href, and inline
// url(...) references that point to local relative paths (not http/https/data/blob).
const LOCAL_REF_RE =
  /(?:src|href)\s*=\s*["']([^"'#?][^"']*)["']|srcset\s*=\s*["']([^"']+)["']|url\(\s*["']?([^"')]+)["']?\s*\)/gi;

function isExternalRef(v: string): boolean {
  return /^(https?:|data:|blob:|\/\/|#|mailto:|cid:)/i.test(v);
}

function splitSrcset(v: string): string[] {
  return v.split(",").map((s) => s.trim().split(/\s+/)[0]).filter(Boolean);
}

export function findLocalAssetRefs(html: string): string[] {
  const out = new Set<string>();
  let m: RegExpExecArray | null;
  const re = new RegExp(LOCAL_REF_RE.source, "gi");
  while ((m = re.exec(html))) {
    const candidates: string[] = [];
    if (m[1]) candidates.push(m[1]);
    if (m[2]) candidates.push(...splitSrcset(m[2]));
    if (m[3]) candidates.push(m[3]);
    for (const raw of candidates) {
      const v = raw.trim();
      if (!v || isExternalRef(v)) continue;
      if (v.startsWith("#") || v.startsWith("?")) continue;
      out.add(v);
    }
  }
  return Array.from(out);
}

function lookupAsset(raw: string, map: Map<string, string>): string | null {
  const tries = new Set<string>();
  const push = (s: string) => { if (s) tries.add(s); tries.add(s.toLowerCase()); };
  push(raw);
  push(raw.replace(/^\.{0,2}\/+/, ""));
  push(raw.split("/").pop() ?? raw);
  try { push(decodeURIComponent(raw)); } catch { /* ignore */ }
  try { push(decodeURIComponent(raw.split("/").pop() ?? raw)); } catch { /* ignore */ }
  // last 2 segments (e.g. images/foo.jpg)
  const parts = raw.split("/").filter(Boolean);
  if (parts.length >= 2) push(parts.slice(-2).join("/"));
  for (const c of tries) {
    const hit = map.get(c);
    if (hit) return hit;
  }
  return null;
}

export function rewriteLocalAssetPaths(html: string, srcMap: Map<string, string>): string {
  // Build a case-insensitive lookup map (preserve original keys too).
  const map = new Map<string, string>();
  for (const [k, v] of srcMap.entries()) {
    map.set(k, v);
    map.set(k.toLowerCase(), v);
  }
  return html.replace(LOCAL_REF_RE, (full, srcVal?: string, srcsetVal?: string, urlVal?: string) => {
    if (srcVal !== undefined) {
      const raw = srcVal.trim();
      if (!raw || isExternalRef(raw)) return full;
      const hit = lookupAsset(raw, map);
      return hit ? full.replace(raw, hit) : full;
    }
    if (srcsetVal !== undefined) {
      // Rewrite each candidate inside the srcset string.
      const rewritten = srcsetVal
        .split(",")
        .map((part) => {
          const trimmed = part.trim();
          if (!trimmed) return part;
          const [u, ...rest] = trimmed.split(/\s+/);
          if (!u || isExternalRef(u)) return part;
          const hit = lookupAsset(u, map);
          return hit ? [hit, ...rest].join(" ") : part;
        })
        .join(", ");
      return full.replace(srcsetVal, rewritten);
    }
    if (urlVal !== undefined) {
      const raw = urlVal.trim();
      if (!raw || isExternalRef(raw)) return full;
      const hit = lookupAsset(raw, map);
      return hit ? `url("${hit}")` : full;
    }
    return full;
  });
}

