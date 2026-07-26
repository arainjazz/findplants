import { useState, useEffect, useRef } from "react";
import { compressImage, extForMime } from "@/lib/image-compress";
import { useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { extractPlantMetaFn, savePlantFn, uploadAssetFn, checkSkillDuplicateFn } from "@/lib/identify-plant.functions";
import { checkNameFn } from "@/lib/name-authority.functions";
import type { NameVerdict } from "@/lib/name-authority";
import { useQueryClient } from "@tanstack/react-query";
import {
  FolderOpen,
  Link2,
  Image as ImageIcon,
  Globe,
  Trash2,
  Wand2,
  UploadCloud,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { slugify, visibleBodyText, type Plant } from "@/lib/plants";
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
import { TagPicker } from "@/components/tag-picker";

type Props = { initial?: Plant | null };

export function PlantEditor({ initial }: Props) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const extractMeta = useServerFn(extractPlantMetaFn);
  const savePlant = useServerFn(savePlantFn);
  const uploadAsset = useServerFn(uploadAssetFn);
  const checkSkillDup = useServerFn(checkSkillDuplicateFn);
  const checkName = useServerFn(checkNameFn);
  const htmlInputRef = useRef<HTMLInputElement>(null);
  const htmlFolderInputRef = useRef<HTMLInputElement>(null);
  const hydratedDraftRef = useRef(false);
  const draftKey = `plant-editor-draft:${initial?.id ?? "new"}`;

  const [title, setTitle] = useState(initial?.title ?? "");
  const [slug, setSlug] = useState(initial?.slug ?? "");
  const [scientificName, setScientificName] = useState(initial?.scientific_name ?? "");
  const [commonNameEn, setCommonNameEn] = useState(initial?.common_name_en ?? "");
  const [commonNamesZh, setCommonNamesZh] = useState(initial?.common_names_zh ?? "");
  const [family, setFamily] = useState(initial?.family ?? "");
  const [genus, setGenus] = useState(initial?.genus ?? "");
  const [iucnStatus, setIucnStatus] = useState(initial?.iucn_status ?? "");
  const [habitat, setHabitat] = useState(initial?.habitat ?? "");
  const [summary, setSummary] = useState(initial?.summary ?? "");
  const [coverUrl, setCoverUrl] = useState(initial?.cover_url ?? "");
  // skill 条目一律走上传 HTML（站内富文本编辑已下线）；旧的 rich 条目仍能渲染。
  const [contentType, setContentType] = useState<"rich" | "html">(initial?.content_type ?? "html");
  const [richContent, setRichContent] = useState(initial?.rich_content ?? "");
  const [htmlUrl, setHtmlUrl] = useState(initial?.html_url ?? "");
  const [tags, setTags] = useState<string>((initial?.tags ?? []).join(", "));
  const [isFeatured, setIsFeatured] = useState(initial?.is_featured ?? false);
  const [saving, setSaving] = useState(false);
  const [uploadingCover, setUploadingCover] = useState(false);
  const [uploadingHtml, setUploadingHtml] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [extracting, setExtracting] = useState(false);
  const [coverMenu, setCoverMenu] = useState<{ x: number; y: number } | null>(null);
  const coverFileRef = useRef<HTMLInputElement>(null);
  const coverEdited = useRef(Boolean(initial?.cover_url));
  const slugTouchedRef = useRef(Boolean(initial?.slug));
  const [allTags, setAllTags] = useState<TagWithCount[]>([]);
  const [selectedTagIds, setSelectedTagIds] = useState<Set<string>>(new Set());
  const [originalTagIds, setOriginalTagIds] = useState<Set<string>>(new Set());
  // 保存前的正名核对（只提示、不静默改写 —— 见 runNameCheck 注释）。
  const [nameChecking, setNameChecking] = useState(false);
  const [nameVerdict, setNameVerdict] = useState<NameVerdict | null>(null);
  const [nameDialogOpen, setNameDialogOpen] = useState(false);

  const [showCoverSearch, setShowCoverSearch] = useState(false);
  const [pageImages, setPageImages] = useState<string[]>([]);
  const [showPagePicker, setShowPagePicker] = useState(false);
  // skill 查重（P3）：单个最相似命中 + 相似度分档。
  type DupTarget = { id: string; title: string; slug: string; html_url: string | null; co_author_names: string[]; author_id: string };
  const [dupMatch, setDupMatch] = useState<{ target: DupTarget; similarity: number; band: "high" | "low" } | null>(null);
  const [dupOpen, setDupOpen] = useState(false);
  const [mergeBusy, setMergeBusy] = useState(false);
  const [bodyText, setBodyText] = useState("");

  // 名字 → id 的**同步**索引。TagPicker 对外说的是标签**名**（草稿的 tags 是 text[]），
  // 而这里存的是 id（保存时要算 tagIdsToAdd / tagIdsToRemove）。就地新建标签时，
  // TagPicker 会「先刷新列表、紧接着 onChange 带上新名字」——两件事在同一个 tick 里，
  // 走 useState 的 allTags 还没重渲染，onChange 里会查不到新标签的 id。ref 是同步写的，
  // 所以用它做映射，setAllTags 只管渲染。
  const tagIdByName = useRef(new Map<string, string>());
  const syncTagIndex = (list: TagWithCount[]) => {
    tagIdByName.current = new Map(list.map((t) => [t.name, t.id]));
    setAllTags(list);
  };

  // Load all tags + current plant's tags
  useEffect(() => {
    fetchAllTags().then(syncTagIndex).catch(() => {});
    if (initial?.id) {
      fetchTagsForPlant(initial.id).then((ts) => {
        const ids = new Set(ts.map((t) => t.id));
        setSelectedTagIds(ids);
        setOriginalTagIds(new Set(ids));
      }).catch(() => {});
    }
  }, [initial?.id]);

  /** 选中的标签**名字** —— TagPicker 对外说名字，这里存 id（保存时要算增删差集）。 */
  const selectedTagNames = allTags.filter((t) => selectedTagIds.has(t.id)).map((t) => t.name);

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
      setCommonNamesZh(draft.commonNamesZh ?? "");
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
      commonNamesZh,
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
    commonNamesZh,
    slug,
    summary,
    tags,
    title,
  ]);

  const uploadFile = async (file: File, bucket: "plant-images" | "plant-html") => {
    if (!user) throw new Error("未登录");

    let fileToUpload: Blob | File = file;
    if (bucket === "plant-images") {
      try {
        fileToUpload = await compressImage(file);
      } catch (err) {
        console.error("Image compression failed, using original:", err);
      }
    }

    const ext = extForMime(fileToUpload.type, file.name.split(".").pop() || "bin");
    const path = `${user.id}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;

    const reader = new FileReader();
    const base64Promise = new Promise<string>((resolve, reject) => {
      reader.onload = () => {
        const result = reader.result as string;
        const base64 = result.split(",")[1];
        resolve(base64);
      };
      reader.onerror = (err) => reject(err);
    });
    reader.readAsDataURL(fileToUpload);
    const file_base64 = await base64Promise;

    // China→Cloudflare uploads can be reset mid-flight ("failed to fetch"); retry a
    // couple times before giving the user an actionable message.
    let lastErr: unknown = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const res = await uploadAsset({
          data: {
            bucket,
            path,
            file_base64,
            content_type: fileToUpload.type || (bucket === "plant-html" ? "text/html" : undefined),
          },
        });
        return res.url;
      } catch (err) {
        lastErr = err;
        await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
      }
    }
    const msg = lastErr instanceof Error ? lastErr.message : String(lastErr);
    if (/failed to fetch|fetch failed|network|load failed/i.test(msg)) {
      throw new Error(
        "上传中断（failed to fetch）：从国内网络上传到 Cloudflare 易被重置。请挂 VPN 后重试，或改用命令行 publish.py 上传。",
      );
    }
    throw new Error(`上传失败：${msg}`);
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
    if (typeof data.common_names_zh === "string" && data.common_names_zh.trim())
      setCommonNamesZh(data.common_names_zh.trim());
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
      const data = await extractMeta({ data: { htmlUrl: url } });
      applyExtractedMeta(data);
      toast.success(successMessage);
      return data;
    } catch (err) {
      toast.error("识别失败：" + (err as Error).message);
      return null;
    } finally {
      setExtracting(false);
    }
  };

  /**
   * skill 查重（P3）：学名前两词相同 + 正文相似度分档。newBodyText 由客户端从上传的 HTML 算好传入。
   * 命中则弹分档对话框（≥60% 高相似 / <60% 低相似）。仅新建（!initial）时触发。
   */
  const runSkillDupCheck = async (sci: string, newBodyText: string) => {
    try {
      const res = await checkSkillDup({ data: { scientificName: sci, newBodyText, excludePlantId: initial?.id } });
      if (res?.match) {
        setDupMatch({ target: res.match as DupTarget, similarity: res.similarity ?? 0, band: (res.band as "high" | "low") ?? "low" });
        setDupOpen(true);
      }
    } catch {
      /* 查重失败不阻塞保存 */
    }
  };

  // Merge: append uploaded html body into target plant's html as a new section,
  // upload merged file, set target html_url, add current user as co-author.
  const performMerge = async (target: DupTarget) => {
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
  const performBranch = (target: DupTarget) => {
    setBranchParentId(target.id);
    setDupOpen(false);
    toast.message("已设为平行条目，保存时将与原条目同名并列，右上角标注编辑名");
  };

  // 去已有页面编辑添加内容：跳到该条目的编辑页。
  const performGoEdit = (target: DupTarget) => {
    setDupOpen(false);
    navigate({ to: "/admin/edit/$id", params: { id: target.id } });
  };

  // Finalize: rewrite refs (if image map provided) and upload HTML to storage.
  const finalizeHtmlUpload = async (htmlFile: File, text: string, matchedImages: Map<string, File>) => {
    let finalText = text;
    if (matchedImages.size > 0) {
      const uniqueFiles = Array.from(new Set(matchedImages.values()));
      toast.message(`正在上传 ${uniqueFiles.length} 张配图…`);
      const nameMap = new Map<string, string>();
      const uploaded = await Promise.all(uniqueFiles.map(async (img) => [img, await uploadFile(img, "plant-images")] as const));
      const fileToUrl = new Map<File, string>(uploaded);
      for (const [ref, img] of matchedImages.entries()) {
        const url = fileToUrl.get(img)!;
        nameMap.set(ref, url);
        nameMap.set(img.name, url);
        const rel = (img as File & { webkitRelativePath?: string }).webkitRelativePath;
        if (rel) {
          nameMap.set(rel, url);
          const stripped = rel.split("/").slice(1).join("/");
          if (stripped) nameMap.set(stripped, url);
        }
      }
      finalText = rewriteLocalAssetPaths(text, nameMap);
      toast.success(`已重写 HTML 中的本地图片路径（${uniqueFiles.length} 张）`);
    }
    const finalHtmlFile = new File([finalText], htmlFile.name, { type: "text/html" });
    const uploadedUrl = await uploadFile(finalHtmlFile, "plant-html");
    setHtmlUrl(uploadedUrl);
    setUploadingHtml(false);
    toast.success("HTML 已上传");
    // 捕获正文可见文本：既用于 body_text 存储，也用于 skill 查重（避免服务端抓 HTML）。
    const bt = visibleBodyText(finalText);
    setBodyText(bt);
    const meta = await extractMetaFromUrl(uploadedUrl, "已根据 HTML 自动填入标题和字段，请检查后保存");
    const sci = typeof meta?.scientific_name === "string" ? meta.scientific_name.trim() : "";
    if (sci && !initial) await runSkillDupCheck(sci, bt);
  };

  const isImageFile = (file: File) =>
    file.type.startsWith("image/") || /\.(png|jpe?g|webp|gif|svg|avif|bmp|tiff?)$/i.test(file.name);

  const assetLookupKeys = (value: string) => buildAssetLookupKeys(value);

  // Match each local HTML ref (e.g. "images/leaf.jpg") to one of the user-selected image files.
  const matchRefsToFiles = (refs: string[], imageFiles: File[]) => {
    const filesByName = new Map<string, File>();
    for (const f of imageFiles) {
      const rel = ((f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name).replace(/\\/g, "/");
      assetLookupKeys(rel).forEach((k) => filesByName.set(k, f));
      assetLookupKeys(f.name).forEach((k) => filesByName.set(k, f));
      const parts = rel.split("/");
      for (let i = 1; i < parts.length; i++) {
        filesByName.set(parts.slice(i).join("/").toLowerCase(), f);
      }
    }
    const matched = new Map<string, File>();
    const missing: string[] = [];
    for (const ref of refs) {
      const file = assetLookupKeys(ref).map((k) => filesByName.get(k)).find(Boolean);
      if (file) matched.set(ref, file);
      else missing.push(ref);
    }
    return { matched, missing };
  };

  const processHtmlFiles = async (files: File[]) => {
    if (files.length === 0) return;
    const htmlFile = files.find((f) => /\.html?$/i.test(f.name) || f.type === "text/html");
    if (!htmlFile) return toast.error("请选择 .html 文件，或拖入包含 HTML 与图片的文件夹");
    setUploadingHtml(true);
    try {
      const text = await htmlFile.text();
      const localRefs = findLocalAssetRefs(text);
      const imageFiles = files.filter((f) => f !== htmlFile && isImageFile(f));
      const { matched, missing } = matchRefsToFiles(localRefs, imageFiles);
      if (missing.length > 0) {
        toast.error(
          `HTML 中有 ${missing.length} 个本地图片路径未找到。请将包含图片和 HTML 的文件夹拖进拖拽区，或在命令行使用 publish.py 脚本一键发布。`,
          { duration: 8000 },
        );
        return;
      }
      await finalizeHtmlUpload(htmlFile, text, matched);
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setUploadingHtml(false);
    }
  };

  const onHtmlUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    e.target.value = "";
    await processHtmlFiles(files);
  };

  const scanFiles = async (dataTransfer: DataTransfer): Promise<File[]> => {
    const files: File[] = [];
    const entries: any[] = [];
    for (let i = 0; i < dataTransfer.items.length; i++) {
      const item = dataTransfer.items[i];
      if (item.kind === "file") {
        const entry = item.webkitGetAsEntry();
        if (entry) entries.push(entry);
      }
    }
    const readEntry = async (entry: any, path = "") => {
      if (entry.isFile) {
        const file = await new Promise<File>((resolve, reject) => entry.file(resolve, reject));
        const fullPath = path ? `${path}/${file.name}` : file.name;
        Object.defineProperty(file, "webkitRelativePath", {
          value: fullPath,
          writable: true,
          configurable: true,
        });
        files.push(file);
      } else if (entry.isDirectory) {
        const dirReader = entry.createReader();
        const readAllEntries = async (): Promise<any[]> => {
          let all: any[] = [];
          const readBatch = async (): Promise<any[]> => {
            return new Promise((resolve) => {
              dirReader.readEntries((results: any[]) => {
                resolve(results);
              });
            });
          };
          while (true) {
            const batch = await readBatch();
            if (batch.length === 0) break;
            all = all.concat(batch);
          }
          return all;
        };
        const subEntries = await readAllEntries();
        const currentPath = path ? `${path}/${entry.name}` : entry.name;
        for (const sub of subEntries) {
          await readEntry(sub, currentPath);
        }
      }
    };
    for (const entry of entries) {
      await readEntry(entry);
    }
    return files;
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    if (uploadingHtml || extracting) return;
    if (e.dataTransfer.items) {
      try {
        const files = await scanFiles(e.dataTransfer);
        await processHtmlFiles(files);
      } catch (err) {
        toast.error((err as Error).message);
      }
    }
  };



  const onExtractMeta = async () => {
    if (!htmlUrl) return;
    await extractMetaFromUrl(htmlUrl, "已识别并填充，请检查后点「保存修改」提交");
  };

  /**
   * 保存前对一次名录。
   *
   * **刻意只提示、不静默改写** —— 这条链路上的名字是人写的，不是模型生成的。
   * AI 草稿那两条链路可以自动对齐（模型本来就没有署名权），但把编辑亲手敲进去的
   * 名字在他不知情的时候换掉，是另一回事：名录也会有他知道而我们不知道的例外。
   * 所以这里弹一个「名录说 X，你写的是 Y」，改不改他定。
   */
  const runNameCheck = async (): Promise<boolean> => {
    if (!scientificName.trim() && !title.trim()) return true;
    setNameChecking(true);
    try {
      const v = await checkName({
        data: {
          title: title.trim() || null,
          scientificName: scientificName.trim() || null,
          family: family.trim() || null,
          genus: genus.trim() || null,
          commonNamesZh: commonNamesZh.trim() || null,
        },
      });
      setNameVerdict(v);
      // 与名录一致，或名录里查无此名（境外种等）→ 不打扰，直接放行。
      if (v.status === "accepted" || v.status === "unmatched") return true;
      setNameDialogOpen(true);
      return false; // 等用户在弹窗里定夺
    } catch {
      return true; // 核对服务挂了绝不能挡住保存
    } finally {
      setNameChecking(false);
    }
  };

  /** 采纳名录正名：把字段改掉，原名并进俗名（不丢信息）。 */
  const adoptChecklistName = () => {
    const v = nameVerdict;
    if (!v) return;
    const extra: string[] = [];
    if (v.acceptedZh && title.trim() && title.trim() !== v.acceptedZh) extra.push(title.trim());
    for (const a of v.aliases) extra.push(a.name);
    if (v.acceptedZh) setTitle(v.acceptedZh);
    if (v.acceptedLa) setScientificName(v.acceptedLa);
    if (v.familyZh && v.familyLa) setFamily(`${v.familyZh} ${v.familyLa}`);
    if (v.genusZh && v.genusLa) setGenus(`${v.genusZh} ${v.genusLa}`);
    if (extra.length) {
      const cur = commonNamesZh.split(/[,，、;；]/).map((x) => x.trim()).filter(Boolean);
      for (const e of extra) if (e && !cur.includes(e)) cur.push(e);
      setCommonNamesZh(cur.join(", "));
    }
    setNameDialogOpen(false);
    toast.success("已采用名录正名，原名已并入中文俗名");
  };

  const onSave = async (opts?: { skipNameCheck?: boolean }) => {
    if (!user) return;
    if (!title.trim()) return toast.error("请填写标题");
    if (!opts?.skipNameCheck && !(await runNameCheck())) return;
    const finalSlug = slug.trim() || slugify(title);
    if (contentType === "html" && !htmlUrl) return toast.error("请上传 HTML 文件");

    // If user never touched the cover and we have an HTML doc, fall back to its first image.
    let resolvedCover = coverUrl;
    if (!resolvedCover && !coverEdited.current && contentType === "html" && htmlUrl) {
      resolvedCover = (await firstImageFromHtml(htmlUrl)) ?? "";
      if (resolvedCover) setCoverUrl(resolvedCover);
    }

    setSaving(true);

    const editorName =
      (user.user_metadata?.full_name as string | undefined) ||
      (user.user_metadata?.name as string | undefined) ||
      user.email ||
      "编辑者";

    const toAdd = [...selectedTagIds].filter((id) => !originalTagIds.has(id));
    const toRemove = [...originalTagIds].filter((id) => !selectedTagIds.has(id));

    try {
      await savePlant({
        data: {
          id: initial?.id,
          payload: {
            title: title.trim(),
            slug: finalSlug,
            scientific_name: scientificName.trim() || null,
            common_name_en: commonNameEn.trim() || null,
            common_names_zh: commonNamesZh.trim() || null,
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
            parent_id: branchParentId || null,
            // 正文可见文本（skill 查重用）；纯编辑无新上传时为空 → 传 undefined，服务端保持原值。
            body_text: bodyText || undefined,
          },
          editorName,
          editSummary: initial ? `${editorName} 编辑修改了条目「${title.trim()}」` : undefined,
          tagIdsToAdd: toAdd,
          tagIdsToRemove: toRemove,
        }
      });

      setSaving(false);
      localStorage.removeItem(draftKey);
      toast.success(initial ? "已更新" : "已创建");
      qc.invalidateQueries({ queryKey: ["my-plants"] });
      qc.invalidateQueries({ queryKey: ["plants"] });
      qc.invalidateQueries({ queryKey: ["home"] });
      navigate({ to: "/admin" });
    } catch (err) {
      setSaving(false);
      toast.error("保存失败：" + (err as Error).message);
    }
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
        ref={htmlFolderInputRef}
        type="file"
        webkitdirectory=""
        onChange={onHtmlUpload}
        disabled={uploadingHtml || extracting}
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
        <Field label="中文俗名 / 别名 / 商品名">
          <input
            value={commonNamesZh}
            onChange={(e) => setCommonNamesZh(e.target.value)}
            className={inputCls}
            placeholder="如：发财树, 瓜栗, 招财树（半角逗号分隔）"
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
        {/* ⚠️ 这一栏和下面的「主题标签 #tag」是**两套东西**，以前都叫「标签」，
            所以谁也说不清 AI 自动填进来的那串词到底干什么用。
            这里是 plants.tags（text[]）—— 只进全站搜索的匹配范围 + 详页/草稿页/分享卡
            顶部那排卡签，**不会**把条目挂进任何专题页。挂专题页要用下面的主题标签。 */}
        <Field label="特征词（逗号分隔 · 供搜索与卡签，不建专题）">
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
        <legend className="label px-2">上传 HTML 正文</legend>
        {contentType === "rich" ? (
          <Field label="正文（所见即所得：可加粗、插标题、插图片、链接等）">
            <RichEditor value={richContent} onChange={setRichContent} />
          </Field>
        ) : (
          <div className="space-y-2">
            <div
              onDragOver={(e) => {
                e.preventDefault();
                setDragOver(true);
              }}
              onDragLeave={() => setDragOver(false)}
              onDrop={handleDrop}
              className={`border-2 border-dashed rounded-lg p-8 text-center transition-all ${
                dragOver
                  ? "border-vermilion bg-vermilion/5 text-vermilion"
                  : "border-rule hover:border-ink bg-paper-deep/10 text-ink"
              }`}
            >
              <div className="flex flex-col items-center justify-center gap-2">
                <UploadCloud className={`w-8 h-8 ${dragOver ? "text-vermilion animate-bounce" : "text-ink-faint"}`} />
                <p className="text-sm font-semibold">
                  {uploadingHtml ? "正在上传中…" : extracting ? "AI 正在识别中…" : "拖入 HTML 文件或包含图片的文件夹"}
                </p>
                <p className="text-xs text-ink-faint max-w-md mx-auto leading-relaxed">
                  当你的页面有本地配图时，请拖入文件夹；或使用下方按钮点击上传。
                </p>
                <div className="flex flex-wrap justify-center gap-3 mt-3">
                  <button
                    type="button"
                    onClick={() => htmlInputRef.current?.click()}
                    disabled={uploadingHtml || extracting}
                    className="px-4 py-2 text-xs bg-ink text-background hover:bg-vermilion hover:text-white transition-colors"
                  >
                    选择文件
                  </button>
                  <button
                    type="button"
                    onClick={() => htmlFolderInputRef.current?.click()}
                    disabled={uploadingHtml || extracting}
                    className="px-4 py-2 text-xs border border-ink hover:bg-ink hover:text-background transition-colors"
                  >
                    选择文件夹
                  </button>
                </div>
              </div>
            </div>
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
                  将自动填入：学名、Slug、科属（科+属）、物种入侵、<b>特征词</b>、摘要。已手动改过的
                  Slug 不会被覆盖。自动填的是<b>特征词</b>（进搜索与卡签）；要挂专题页请用下面的「主题标签 #tag」。
                </p>
              </>
            )}
            <p className="text-xs text-ink-faint">
              提示：上传后整页将以原样在 iframe 中渲染（保留你的字体与排版）。
              <br />
              <strong>含本地图片的页面：</strong>请在命令行使用 publish.py 脚本一键发布（推荐，可全自动解析并上传本地图片），或选择文件时将 HTML 和图片一起选中上传。
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

        {/* ── 项目标签 #tag ─────────────────────────────────────────────────
            这块原先埋在 `{htmlUrl && …}` 里面 —— 只有传了 HTML 文件才出现，
            富文本模式和「还没上传」时整个不见，用户报的「+标签#tag 按键消失了」
            就是这个。挪到 fieldset 末尾，**两种内容类型都常驻**。
            另补回就地新建标签的按钮：以前要新建得跳去管理页，回来编辑内容全丢。 */}
        <div className="border border-rule p-3 mt-4 bg-paper-deep/20">
          <p className="label text-[11px] mb-2">主题标签 #tag（决定这条详页出现在哪些专题页）</p>
          {/* 原先是把全部标签平铺成一墙 chip 让人扫。标签一多（现在已经在长）那面墙
              会把「保存」按钮顶到屏幕外，而且和草稿页简介卡上那个「手动添加 #tag 标签」
              明明是同一件事，长得却完全不同 —— 用户会以为是两套功能。
              统一换成同一个 TagPicker：黑底白字按钮 + 可搜索下拉，两处一模一样。
              这里只挂**已创建的标签**；编辑可以就地新建（allowCreate）。 */}
          <TagPicker
            allowCreate
            value={selectedTagNames}
            onTagsLoaded={syncTagIndex}
            onChange={(names) => {
              const ids = new Set<string>();
              for (const n of names) {
                const id = tagIdByName.current.get(n);
                if (id) ids.add(id);
              }
              setSelectedTagIds(ids);
            }}
          />
          <p className="mt-2 text-xs text-ink-faint leading-relaxed">
            挂上后这条会出现在 <b>/tags/该标签</b> 专题页与首页「主题标签」里。
            和上面那栏「特征词」不是一回事 —— 特征词只进搜索和卡签，不建专题。
          </p>
        </div>
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
          onClick={() => void onSave()}
          disabled={saving || nameChecking}
          className="bg-ink text-background px-6 py-2 hover:bg-vermilion transition-colors disabled:opacity-60"
        >
          {nameChecking ? "核对名录中…" : saving ? "保存中…" : initial ? "保存修改" : "创建条目"}
        </button>

        {/* 名录核对结论。**只提示不静默改写** —— 这里的名字是编辑亲手敲的，
            名录也会有他知道而我们不知道的例外，改不改由他定。 */}
        {nameDialogOpen && nameVerdict && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 p-4">
            <div className="max-h-[85dvh] w-full max-w-lg overflow-y-auto rounded-lg border border-rule bg-background p-5 shadow-xl">
              <p className="label text-vermilion">核对《中国植物物种名录 2026》</p>
              <h3 className="mt-1 font-display text-xl font-bold">
                {nameVerdict.status === "ambiguous" ? "名录里对不上唯一一条" : "与名录正名不一致"}
              </h3>
              <p className="mt-2 text-sm leading-relaxed text-ink-soft">{nameVerdict.note}</p>

              {nameVerdict.status !== "ambiguous" && (
                <div className="mt-4 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-sm">
                  <span className="text-ink-faint">你写的</span>
                  <span>
                    {title.trim() || "—"} <i className="text-ink-faint">{scientificName.trim()}</i>
                  </span>
                  <span className="text-ink-faint">名录正名</span>
                  <span className="font-medium text-vermilion">
                    {nameVerdict.acceptedZh ?? "—"}{" "}
                    <i className="font-normal">{nameVerdict.acceptedLa ?? ""}</i>
                  </span>
                  {nameVerdict.familyZh && (
                    <>
                      <span className="text-ink-faint">名录科</span>
                      <span>
                        {nameVerdict.familyZh} {nameVerdict.familyLa}
                      </span>
                    </>
                  )}
                </div>
              )}

              <div className="mt-5 flex flex-wrap justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setNameDialogOpen(false)}
                  className="border border-rule px-4 py-2 text-sm hover:border-ink"
                >
                  返回修改
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setNameDialogOpen(false);
                    void onSave({ skipNameCheck: true });
                  }}
                  className="border border-ink px-4 py-2 text-sm hover:bg-ink hover:text-background"
                >
                  保持我写的，直接保存
                </button>
                {nameVerdict.status !== "ambiguous" && nameVerdict.acceptedLa && (
                  <button
                    type="button"
                    onClick={adoptChecklistName}
                    className="bg-vermilion px-4 py-2 text-sm text-background hover:bg-vermilion/85"
                  >
                    采用名录正名
                  </button>
                )}
              </div>
            </div>
          </div>
        )}
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

      {dupOpen && dupMatch && (
        <div className="fixed inset-0 z-[60] bg-black/60 flex items-center justify-center p-4" onClick={() => setDupOpen(false)}>
          <div className="bg-background border border-ink shadow-xl w-full max-w-lg p-5" onClick={(e) => e.stopPropagation()}>
            <h3 className="label text-vermilion mb-2">该物种条目已存在</h3>
            <p className="text-sm mb-1">
              已收录档案里已有同物种条目「<span className="font-medium">{dupMatch.target.title}</span>」
              <span className="text-ink-faint">（/plants/{dupMatch.target.slug}）</span>。
            </p>
            <p className="text-xs text-ink-faint mb-4">
              正文相似度约 <span className="font-semibold text-ink">{Math.round(dupMatch.similarity * 100)}%</span>
              {dupMatch.band === "high"
                ? "（≥60%：内容高度相似，建议合并或去原页编辑，不另建重复页）"
                : "（<60%：内容差异较大，可平行并列、合并或去原页编辑）"}
            </p>
            <div className="flex flex-col gap-2">
              {/* 低相似度（<60%）才提供「平行存在」 */}
              {dupMatch.band === "low" && (
                <button
                  type="button"
                  onClick={() => performBranch(dupMatch.target)}
                  className="border border-ink px-3 py-2 text-sm hover:bg-ink hover:text-background text-left"
                >
                  和已有版本平行存在<span className="text-xs opacity-70"> · 同名并列，右上角标注编辑名</span>
                </button>
              )}
              <button
                type="button"
                disabled={mergeBusy}
                onClick={() => performMerge(dupMatch.target)}
                className="bg-emerald-700 text-white px-3 py-2 text-sm hover:bg-emerald-800 disabled:opacity-60 text-left"
              >
                {mergeBusy ? "合并中…" : "自动合并"}<span className="text-xs opacity-80"> · 新内容注入原页，做成卡片加「注」</span>
              </button>
              <button
                type="button"
                onClick={() => performGoEdit(dupMatch.target)}
                className="border border-ink px-3 py-2 text-sm hover:bg-ink hover:text-background text-left"
              >
                去已有页面编辑添加内容<span className="text-xs opacity-70"> · 跳到该条目编辑页手动整合</span>
              </button>
            </div>
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
}



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

function isLikelyImageAssetRef(value: string): boolean {
  const clean = value.split(/[?#]/)[0];
  try {
    return /\.(png|jpe?g|webp|gif|svg|avif|bmp|tiff?|ico)$/i.test(decodeURIComponent(clean));
  } catch {
    return /\.(png|jpe?g|webp|gif|svg|avif|bmp|tiff?|ico)$/i.test(clean);
  }
}

export function buildAssetLookupKeys(value: string): string[] {
  const cleaned = value.split(/[?#]/)[0].replace(/\\/g, "/").replace(/^file:\/\/+/, "").replace(/^\.?\/+/, "");
  const variants = new Set<string>();
  const add = (v: string) => {
    if (!v) return;
    const normalized = v.replace(/\\/g, "/").replace(/^\.?\/+/, "");
    variants.add(normalized);
    variants.add(normalized.split("/").pop() || "");
    const parts = normalized.split("/").filter(Boolean);
    for (let i = 1; i < parts.length; i++) variants.add(parts.slice(i).join("/"));
  };
  add(cleaned);
  try { add(decodeURIComponent(cleaned)); } catch { /* ignore */ }
  return Array.from(variants).filter(Boolean).map((k) => k.toLowerCase());
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
      if (!isLikelyImageAssetRef(v)) continue;
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

