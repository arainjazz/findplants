import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useMemo, useRef, useState } from "react";
import { SiteHeader, SiteFooter } from "@/components/site-header";
import { HtmlDocEditor, type HtmlDocEditorHandle } from "@/components/html-doc-editor";
import { ReplacePhotoDialog } from "@/components/replace-photo-dialog";
import { ReplaceImageFlow } from "@/components/replace-image-flow";
import { XiaoPAgentPanel } from "@/components/draft-agent-panel";
import { userModelArg } from "@/lib/xiaop-user-model";
import { enhanceDraftHtmlForViewing, replaceImageInDraftHtml } from "@/lib/draft-enhance";
import { fetchDraftById } from "@/lib/drafts";
import { fetchEditsForDraft } from "@/lib/edits";
import { EditLogSection } from "@/components/edit-log-section";
import { approvePlantDraft, rejectPlantDraft, saveDraftHtmlContentFn, logDraftEditFn, askDraftAgentFn, applyDraftAgentEditFn, revertDraftEditFn } from "@/lib/identify-plant.functions";
import { useAuth } from "@/hooks/use-auth";
import { supabase } from "@/integrations/supabase/client";
import { isOwnerEmail, setAdopted } from "@/lib/leaves";
import { LeafIcon } from "@/components/leaf-panel";
import { toast } from "sonner";

export const Route = createFileRoute("/drafts/$id")({
  component: DraftPage,
});

function DraftPage() {
  const { id } = Route.useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { user } = useAuth();
  const approveFn = useServerFn(approvePlantDraft);
  const rejectFn = useServerFn(rejectPlantDraft);
  const saveDraftHtml = useServerFn(saveDraftHtmlContentFn);
  const logDraftEdit = useServerFn(logDraftEditFn);
  const askAgent = useServerFn(askDraftAgentFn);
  const applyAgentEdit = useServerFn(applyDraftAgentEditFn);
  const revertDraftEdit = useServerFn(revertDraftEditFn);
  const [revertingId, setRevertingId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [replaceSlot, setReplaceSlot] = useState<number | null>(null);
  const [savingEdits, setSavingEdits] = useState(false);
  const [xiaopImg, setXiaopImg] = useState<{ query: string; instruction: string } | null>(null);
  const [draftHeight, setDraftHeight] = useState<number | null>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const editorRef = useRef<HtmlDocEditorHandle>(null);

  const { data: draft, isLoading } = useQuery({
    queryKey: ["draft", id],
    queryFn: () => fetchDraftById(id),
  });

  const { data: draftEdits = [] } = useQuery({
    queryKey: ["draft-edits", id],
    queryFn: () => fetchEditsForDraft(id),
  });

  // Stable object URL for the in-place editor: recomputed only when the draft's
  // HTML actually changes, so unrelated re-renders (e.g. the saving spinner)
  // don't reload the editor and discard in-progress edits.
  const editorHtmlUrl = useMemo(
    () =>
      draft?.html_content
        ? URL.createObjectURL(new Blob([draft.html_content], { type: "text/html;charset=utf-8" }))
        : "",
    [draft?.html_content],
  );
  // Section headings for 小P蛙 的「讨论范围（标注）」—— lets the editor focus the
  // conversation (and the images fed to the model) on one section of the draft.
  const pageSections = useMemo(() => {
    const html = draft?.html_content;
    if (!html || typeof window === "undefined") return [];
    const doc = new DOMParser().parseFromString(html, "text/html");
    const secs: { label: string; value: string }[] = [];
    const seen = new Set<string>();
    doc.querySelectorAll("h1, h2, h3").forEach((h) => {
      const t = (h.textContent || "").replace(/\s+/g, " ").trim();
      if (t && t.length <= 40 && !seen.has(t)) {
        seen.add(t);
        secs.push({ label: t, value: t });
      }
    });
    return secs.slice(0, 20);
  }, [draft?.html_content]);

  useEffect(() => {
    return () => {
      if (editorHtmlUrl) URL.revokeObjectURL(editorHtmlUrl);
    };
  }, [editorHtmlUrl]);

  const { data: isEditor = false } = useQuery({
    queryKey: ["is-editor", user?.id],
    enabled: !!user,
    queryFn: async () => {
      if (!user) return false;
      const { data } = await supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", user.id);
      return !!data?.some((r) => r.role === "editor" || r.role === "admin");
    },
  });

  // 采纳 (adopt) is owner-only — doubles the identifier's 识别铜叶.
  const isOwner = isOwnerEmail(user?.email);

  const onAdoptDraft = async () => {
    if (!user || !draft) return;
    try {
      await setAdopted("plant_drafts", id, !draft.adopted, user.id);
      toast.success(draft.adopted ? "已取消采纳" : "已采纳 · 识别人该枚识别铜叶 ×2");
      qc.invalidateQueries({ queryKey: ["draft", id] });
      qc.invalidateQueries({ queryKey: ["my-leaves"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "操作失败");
    }
  };

  const onRevertDraftEdit = async (editId: string) => {
    if (!confirm("确定撤销这条修改吗？将把草稿正文还原到该次修改之前。")) return;
    setRevertingId(editId);
    try {
      await revertDraftEdit({ data: { editId } });
      toast.success("已撤销该修改");
      qc.invalidateQueries({ queryKey: ["draft", id] });
      qc.invalidateQueries({ queryKey: ["draft-edits", id] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "撤销失败");
    } finally {
      setRevertingId(null);
    }
  };

  const onApprove = async () => {
    setBusy(true);
    try {
      const res = await approveFn({ data: { draftId: id } });
      toast.success("已收录到本站");
      qc.invalidateQueries({ queryKey: ["home-all"] });
      qc.invalidateQueries({ queryKey: ["home-drafts"] });
      navigate({ to: "/plants/$slug", params: { slug: (res as { slug: string }).slug } });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "收录失败");
    } finally {
      setBusy(false);
    }
  };

  const onReject = async () => {
    if (!confirm("确定驳回这份草稿吗？")) return;
    setBusy(true);
    try {
      await rejectFn({ data: { draftId: id } });
      toast.success("已驳回");
      qc.invalidateQueries({ queryKey: ["home-drafts"] });
      navigate({ to: "/" });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "操作失败");
    } finally {
      setBusy(false);
    }
  };

  const handleSaveLocally = () => {
    if (!draft?.html_content) return;
    const blob = new Blob([draft.html_content], { type: "text/html;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${draft.title || "plant"}-draft.html`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success("已生成 HTML 文件并开始下载");
  };

  const handleShare = async () => {
    const shareData = {
      title: `Plantspedia - ${draft?.title} AI 草稿`,
      text: `我在 Plantspedia 识别了植物「${draft?.title}」，快来看看 AI 生成的科普档案吧！`,
      url: window.location.href,
    };
    try {
      if (navigator.share) {
        await navigator.share(shareData);
        toast.success("分享成功");
      } else {
        await navigator.clipboard.writeText(window.location.href);
        toast.success("已复制分享链接到剪贴板，快发送给好友吧！");
      }
    } catch (err) {
      if ((err as Error).name !== "AbortError") {
        toast.error("分享链接复制失败，请手动复制当前网页地址");
      }
    }
  };

  const handleHtmlSaved = async (newUrl: string) => {
    try {
      const response = await fetch(newUrl);
      const newHtml = await response.text();

      const parser = new DOMParser();
      const doc = parser.parseFromString(newHtml, "text/html");
      const newTitle = doc.querySelector("h1, h2, title")?.textContent || draft?.title || "未命名";

      const { error } = await supabase
        .from("plant_drafts")
        .update({ 
          html_content: newHtml,
          title: newTitle
        })
        .eq("id", id);

      if (error) throw error;
      if (user)
        logDraftEdit({
          data: {
            draftId: id,
            kind: "draft_text",
            summary: "编辑手动修改了草稿正文",
            beforeHtml: draft?.html_content,
            afterHtml: newHtml,
            source: "draft_editor",
          },
        }).catch(() => {});
      toast.success("草稿已成功保存并更新");
      qc.invalidateQueries({ queryKey: ["draft", id] });
      qc.invalidateQueries({ queryKey: ["draft-edits", id] });
      setIsEditing(false);
    } catch (err) {
      toast.error("更新草稿失败：" + (err as Error).message);
    }
  };

  // Trigger the in-place HTML editor's save from a prominent top-level button
  // (the editor's own save sits far below the full-height editing surface).
  const onSaveEdits = async () => {
    if (!editorRef.current) return;
    setSavingEdits(true);
    try {
      await editorRef.current.save();
    } finally {
      setSavingEdits(false);
    }
  };

  // Listen for "replace this default image" clicks bubbled up from the draft iframe.
  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      const iframe = iframeRef.current;
      if (!iframe || e.source !== iframe.contentWindow) return;
      const d = e.data as { type?: string; slot?: number; height?: number };
      if (d?.type === "plantspedia:replace-image" && typeof d.slot === "number") {
        setReplaceSlot(d.slot);
      } else if (d?.type === "plantspedia:height" && typeof d.height === "number" && d.height > 0) {
        setDraftHeight(Math.min(Math.ceil(d.height), 200000));
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  const handleReplaceImage = async (url: string) => {
    if (replaceSlot == null || !draft?.html_content) return;
    try {
      const newHtml = replaceImageInDraftHtml(draft.html_content, replaceSlot, url);
      await saveDraftHtml({ data: { draftId: id, html: newHtml } });
      if (user)
        logDraftEdit({
          data: {
            draftId: id,
            kind: "draft_image",
            summary: "编辑替换了草稿配图",
            beforeHtml: draft.html_content,
            afterHtml: newHtml,
            source: "draft_editor",
          },
        }).catch(() => {});
      toast.success("配图已替换");
      setReplaceSlot(null);
      qc.invalidateQueries({ queryKey: ["draft", id] });
      qc.invalidateQueries({ queryKey: ["draft-edits", id] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "替换失败，请重试");
    }
  };

  return (
    <div className="min-h-screen flex flex-col">
      <SiteHeader />
      <main className="flex-1 w-full pb-28 md:pb-6">
        {isLoading ? (
          <p className="text-center py-20 text-ink-faint">载入中…</p>
        ) : !draft ? (
          <p className="text-center py-20 text-ink-faint">草稿不存在或已被删除。</p>
        ) : (
          <>
            <div className="mx-auto max-w-5xl px-6 pt-6 flex flex-col gap-4 border-b border-rule/40 pb-6">
              <div className="flex flex-wrap items-center gap-3 text-sm w-full">
                <Link to="/identify" className="label hover:text-vermilion">← 返回 AI 识别</Link>
                <span className="label text-vermilion">
                  {draft.status === "pending" ? "待审核草稿" : draft.status === "approved" ? "已收录" : "已驳回"}
                </span>

                <div className="ml-auto flex flex-wrap gap-2 items-center">
                  {isOwner && (
                    <button
                      onClick={onAdoptDraft}
                      title={draft.adopted ? "取消采纳（撤销识别铜叶翻倍）" : "采纳此次识别 · 识别人该枚识别铜叶 ×2"}
                      className={`px-3 py-1.5 text-xs transition-colors inline-flex items-center gap-1 cursor-pointer border ${
                        draft.adopted
                          ? "border-leaf bg-leaf/20 text-leaf-deep"
                          : "border-leaf text-leaf-deep hover:bg-leaf hover:text-background"
                      }`}
                    >
                      <LeafIcon tier="bronze" size={14} />
                      <span>{draft.adopted ? "已采纳 ✓" : "采纳识别"}</span>
                    </button>
                  )}
                  <button
                    onClick={() => toast.success("草稿已成功保存为待审批草稿！编委会审核通过后将正式收录。")}
                    className="border border-ink/40 text-ink px-3 py-1.5 text-xs hover:border-ink hover:bg-paper-deep transition-colors inline-flex items-center gap-1 cursor-pointer"
                  >
                    <CloudIcon className="w-3.5 h-3.5" />
                    <span>保存为待审批草稿</span>
                  </button>
                  <button
                    onClick={handleSaveLocally}
                    className="border border-ink/40 text-ink px-3 py-1.5 text-xs hover:border-ink hover:bg-paper-deep transition-colors inline-flex items-center gap-1 cursor-pointer"
                  >
                    <DownloadIcon className="w-3.5 h-3.5" />
                    <span>保存在本地</span>
                  </button>
                  <button
                    onClick={handleShare}
                    className="border border-ink/40 text-ink px-3 py-1.5 text-xs hover:border-ink hover:bg-paper-deep transition-colors inline-flex items-center gap-1 cursor-pointer"
                  >
                    <ShareIcon className="w-3.5 h-3.5" />
                    <span>分享给好友</span>
                  </button>
                  {isEditor && isEditing && (
                    <button
                      onClick={onSaveEdits}
                      disabled={savingEdits}
                      className="bg-ink text-background px-3 py-1.5 text-xs hover:bg-vermilion transition-colors inline-flex items-center gap-1 cursor-pointer disabled:opacity-60 font-semibold"
                    >
                      <CloudIcon className="w-3.5 h-3.5" />
                      <span>{savingEdits ? "保存中…" : "保存草稿修改"}</span>
                    </button>
                  )}
                  {isEditor && (
                    <button
                      onClick={() => setIsEditing(!isEditing)}
                      className={`px-3 py-1.5 text-xs transition-colors inline-flex items-center gap-1 cursor-pointer
                        ${isEditing
                          ? "border border-rule text-ink-faint hover:border-ink hover:text-ink"
                          : "border border-emerald-700 text-emerald-700 hover:bg-emerald-700 hover:text-background"
                        }`}
                    >
                      <EditIcon className="w-3.5 h-3.5" />
                      <span>{isEditing ? "退出编辑" : "继续编辑 HTML"}</span>
                    </button>
                  )}
                </div>
              </div>

              {isEditor && draft.status === "pending" && !isEditing && (
                <div className="flex justify-end gap-2 border-t border-rule/20 pt-4 w-full flex-wrap">
                  <button
                    onClick={() => setIsEditing(true)}
                    className="border border-emerald-700 text-emerald-700 px-5 py-2 text-sm hover:bg-emerald-700 hover:text-background transition-colors cursor-pointer font-semibold inline-flex items-center gap-1.5"
                  >
                    <EditIcon className="w-4 h-4" />
                    <span>进入编辑 (可以修改内容)</span>
                  </button>
                  <button
                    onClick={onApprove}
                    disabled={busy}
                    className="bg-ink text-background px-5 py-2 text-sm hover:bg-vermilion transition-colors disabled:opacity-60 cursor-pointer inline-flex items-center gap-1.5 font-semibold"
                  >
                    {busy ? "处理中…" : (
                      <>
                        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                          <polyline points="20 6 9 17 4 12" />
                        </svg>
                        <span>审核通过并收录本站</span>
                      </>
                    )}
                  </button>
                  <button
                    onClick={onReject}
                    disabled={busy}
                    className="border border-rule text-ink-faint px-5 py-2 text-sm hover:border-ink hover:text-ink transition-colors disabled:opacity-60 cursor-pointer font-semibold"
                  >
                    驳回草稿
                  </button>
                </div>
              )}
            </div>

            {!isEditing && (
              <section className="mx-auto max-w-5xl px-6 pt-6">
                <div className="border border-rule bg-paper-deep/30 p-5 md:p-6">
                  <h1 className="font-display text-2xl md:text-3xl font-bold leading-tight">{draft.title}</h1>
                  {draft.scientific_name && (
                    <p className="italic text-ink-faint mt-1">{draft.scientific_name}</p>
                  )}
                  <dl className="mt-4 grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-x-6 gap-y-3 text-sm">
                    <div>
                      <dt className="label text-[10px] text-ink-faint">中文俗名 / 商品名</dt>
                      <dd className="mt-0.5 font-medium">{draft.common_names_zh || draft.ai_payload?.common_names_zh || "—"}</dd>
                    </div>
                    <div>
                      <dt className="label text-[10px] text-ink-faint">英文俗名</dt>
                      <dd className="mt-0.5 font-medium">{draft.common_name_en || "—"}</dd>
                    </div>
                    <div>
                      <dt className="label text-[10px] text-ink-faint">识别人</dt>
                      <dd className="mt-0.5">{draft.creator_label || "访客"}</dd>
                    </div>
                    <div>
                      <dt className="label text-[10px] text-ink-faint">识别时间</dt>
                      <dd className="mt-0.5">{new Date(draft.created_at).toLocaleString("zh-CN")}</dd>
                    </div>
                    <div>
                      <dt className="label text-[10px] text-ink-faint">识别地点</dt>
                      <dd className="mt-0.5 inline-flex items-center gap-1">
                        <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                          <path d="M12 21s-7-6.2-7-11a7 7 0 0 1 14 0c0 4.8-7 11-7 11Z"/>
                          <circle cx="12" cy="10" r="2.6"/>
                        </svg>
                        <span>{draft.capture_place || "未知地点"}</span>
                        {draft.capture_lat != null && draft.capture_lng != null && (
                          <span className="text-ink-faint text-xs">
                            ({draft.capture_lat.toFixed(4)}, {draft.capture_lng.toFixed(4)})
                          </span>
                        )}
                      </dd>
                    </div>
                  </dl>
                  {draft.summary && (
                    <div className="mt-4">
                      <dt className="label text-[10px] text-ink-faint">摘要 · Summary</dt>
                      <p className="mt-1.5 text-ink-soft leading-relaxed">{draft.summary}</p>
                    </div>
                  )}
                  {draft.tags && draft.tags.length > 0 && (
                    <div className="mt-4 flex flex-wrap gap-2">
                      {draft.tags.map((t) => (
                        <span key={t} className="text-xs border border-rule px-2 py-0.5 text-ink-faint">#{t}</span>
                      ))}
                    </div>
                  )}
                </div>
              </section>
            )}

            {isEditing ? (
              <div className="mx-auto max-w-5xl px-6 mt-6">
                <div className="flex items-center justify-between gap-3 border border-ink/30 bg-paper-deep/40 px-4 py-2.5 mb-3 rounded-sm">
                  <span className="text-xs text-ink-faint">
                    正在编辑草稿正文：可改文字、点击/右键图片替换。改完点右侧
                    <strong className="text-ink">保存草稿修改</strong>。
                  </span>
                  <div className="flex gap-2 shrink-0">
                    <button
                      onClick={onSaveEdits}
                      disabled={savingEdits}
                      className="bg-ink text-background px-4 py-1.5 text-xs font-semibold hover:bg-vermilion transition-colors disabled:opacity-60 cursor-pointer inline-flex items-center gap-1"
                    >
                      <CloudIcon className="w-3.5 h-3.5" />
                      <span>{savingEdits ? "保存中…" : "保存草稿修改"}</span>
                    </button>
                    <button
                      onClick={() => setIsEditing(false)}
                      className="border border-rule text-ink-faint px-4 py-1.5 text-xs hover:border-ink hover:text-ink transition-colors cursor-pointer"
                    >
                      退出
                    </button>
                  </div>
                </div>
                <HtmlDocEditor
                  ref={editorRef}
                  htmlUrl={editorHtmlUrl}
                  onSaved={handleHtmlSaved}
                  persistImmediately={true}
                />
              </div>
            ) : (
              <iframe
                ref={iframeRef}
                title={draft.title}
                srcDoc={enhanceDraftHtmlForViewing(draft.html_content)}
                sandbox="allow-scripts allow-popups"
                scrolling="no"
                className="w-full border-0 mt-6 block"
                style={{ height: draftHeight ? `${draftHeight}px` : "80vh", minHeight: "550px" }}
              />
            )}

            {/* 修改记录 — 页面底部，默认折叠，编辑可撤销某条 */}
            <div className="mx-auto max-w-5xl px-6">
              <EditLogSection
                edits={draftEdits}
                isEditor={isEditor}
                reverting={revertingId}
                onRevert={(e) => onRevertDraftEdit(e.id)}
              />
            </div>

            {/* 小P蛙 审稿助手 — 审阅态可提问；编辑确认建议后自动改写并刷新草稿 */}
            {(
              <XiaoPAgentPanel
                storageKey={`draft:${id}`}
                greetingTitle={draft.title}
                canApply={isEditor && draft.status !== "approved"}
                scopes={pageSections}
                ask={async (question, history, scope) => {
                  const res = (await askAgent({ data: { draftId: id, question, scope, history, userModel: userModelArg() } })) as {
                    reply: string;
                    canEdit: boolean;
                    editInstruction: string;
                  };
                  return res;
                }}
                apply={async (instruction, scope) => {
                  const before = draft.html_content;
                  const { html } = (await applyAgentEdit({ data: { draftId: id, instruction, scope, userModel: userModelArg() } })) as {
                    html: string;
                  };
                  await saveDraftHtml({ data: { draftId: id, html } });
                  logDraftEdit({
                    data: {
                      draftId: id,
                      kind: "draft_text",
                      summary: `小P蛙改写${scope ? `（${scope}）` : "（整份草稿）"}：${instruction}`.slice(0, 500),
                      beforeHtml: before,
                      afterHtml: html,
                      source: "xiaop_agent",
                    },
                  }).catch(() => {});
                  qc.invalidateQueries({ queryKey: ["draft", id] });
                  qc.invalidateQueries({ queryKey: ["draft-edits", id] });
                }}
                onImageReplace={(query, instruction) =>
                  setXiaopImg({ query: query || draft.scientific_name || draft.title, instruction })
                }
              />
            )}
            {xiaopImg && draft.html_content && (
              <ReplaceImageFlow
                html={draft.html_content}
                initialQuery={xiaopImg.query}
                uploadPathPrefix={`drafts/xiaop/${id}`}
                onClose={() => setXiaopImg(null)}
                onDone={async (newHtml, oldUrl, newUrl) => {
                  const ctx = xiaopImg;
                  setXiaopImg(null);
                  try {
                    const before = draft.html_content;
                    await saveDraftHtml({ data: { draftId: id, html: newHtml } });
                    logDraftEdit({
                      data: {
                        draftId: id,
                        kind: "draft_image",
                        summary: `小P蛙换图（${ctx?.instruction || "手动"}）：${oldUrl} → ${newUrl}`.slice(0, 500),
                        beforeHtml: before,
                        afterHtml: newHtml,
                        source: "xiaop_agent",
                      },
                    }).catch(() => {});
                    qc.invalidateQueries({ queryKey: ["draft", id] });
                    qc.invalidateQueries({ queryKey: ["draft-edits", id] });
                    toast.success("配图已替换并保存");
                  } catch (e) {
                    toast.error(e instanceof Error ? e.message : "替换失败，请重试");
                  }
                }}
              />
            )}

            {replaceSlot != null && (
              <ReplacePhotoDialog
                draftId={id}
                slot={replaceSlot}
                names={{
                  scientific_name: draft.scientific_name,
                  common_name_en: draft.common_name_en,
                  common_names_zh:
                    draft.common_names_zh || draft.ai_payload?.common_names_zh || null,
                }}
                onReplaced={handleReplaceImage}
                onClose={() => setReplaceSlot(null)}
              />
            )}
          </>
        )}
      </main>
      <SiteFooter />
    </div>
  );
}

// Flat-style SVG icons matching system aesthetics
function CloudIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <path d="M17.5 19A3.5 3.5 0 0 0 21 15.5c0-2.79-2.54-4.5-5-4.5-.48 0-.96.06-1.4.17A5.5 5.5 0 0 0 4 12c0 3 2.5 5 5 5" />
      <path d="M12 11v6M9 14l3-3 3 3" />
    </svg>
  );
}

function DownloadIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3" />
    </svg>
  );
}

function ShareIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <circle cx="18" cy="5" r="3" />
      <circle cx="6" cy="12" r="3" />
      <circle cx="18" cy="19" r="3" />
      <line x1="8.59" y1="13.51" x2="15.42" y2="17.49" />
      <line x1="15.41" y1="6.51" x2="8.59" y2="10.49" />
    </svg>
  );
}

function EditIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7M18.5 2.5a2.121 2.121 0 1 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
    </svg>
  );
}
