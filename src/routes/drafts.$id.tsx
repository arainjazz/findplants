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
import {
  approvePlantDraft,
  rejectPlantDraft,
  saveDraftHtmlContentFn,
  logDraftEditFn,
  askDraftAgentFn,
  applyDraftAgentEditFn,
  revertDraftEditFn,
  enrichDraft,
  createGoldDetailPageFn,
  submitDraftForReviewFn,
} from "@/lib/identify-plant.functions";
import { useAuth } from "@/hooks/use-auth";
import { supabase } from "@/integrations/supabase/client";
import { setAdopted, computeLeaves } from "@/lib/leaves";
import { keepVisualAdvice } from "@/lib/retake-advice";
import { LeafIcon } from "@/components/leaf-panel";
import { SafeImg } from "@/components/safe-img";
import { renderShareCard, shareOrSaveImage } from "@/lib/share-card";
import { RegistryChips } from "@/components/registry-chips";
import { useRegistryChips } from "@/lib/use-registry-chips";
import { toast } from "sonner";

export const Route = createFileRoute("/drafts/$id")({
  component: DraftPage,
});

// Ordinal label for the retake counter (第一次补拍 / 第二次补拍 / 最后一次补拍).
// 3 is the last allowed retake (server forces a final result at count ≥ 3).
function retakeOrdinalLabel(count: number): string {
  if (count >= 3) return "最后一次补拍（第三次补拍）";
  return count === 1 ? "第一次补拍" : count === 2 ? "第二次补拍" : `第 ${count} 次补拍`;
}

type MergePrompt = {
  conflict: true;
  target: { id: string; slug: string; title: string; scientific_name: string | null };
  whatsNew: string;
};

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
  const enrich = useServerFn(enrichDraft);
  const submitForReview = useServerFn(submitDraftForReviewFn);
  const [submitting, setSubmitting] = useState(false);
  const [enriching, setEnriching] = useState(false);
  const [enrichError, setEnrichError] = useState<string | null>(null);
  const [goldConfirm, setGoldConfirm] = useState(false);
  const [goldBusy, setGoldBusy] = useState(false);
  const [goldError, setGoldError] = useState<string | null>(null);
  const [revertingId, setRevertingId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [replaceSlot, setReplaceSlot] = useState<number | null>(null);
  const [savingEdits, setSavingEdits] = useState(false);
  const [xiaopImg, setXiaopImg] = useState<{ query: string; instruction: string } | null>(null);
  const [mergePrompt, setMergePrompt] = useState<MergePrompt | null>(null);
  const [draftHeight, setDraftHeight] = useState<number | null>(null);
  const [cardBusy, setCardBusy] = useState(false);
  const [cardUrl, setCardUrl] = useState<string | null>(null);
  // 这张卡是不是「识别完自动弹出来的」（而非用户事后点按钮生成的）。决定关卡后要不要送去补拍。
  const [cardAutoOpened, setCardAutoOpened] = useState(false);
  const cardBlobRef = useRef<Blob | null>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const editorRef = useRef<HtmlDocEditorHandle>(null);

  const { data: draft, isLoading } = useQuery({
    queryKey: ["draft", id],
    queryFn: () => fetchDraftById(id),
  });

  // Query the draft creator's profile to get their avatar
  const { data: creatorProfile } = useQuery({
    queryKey: ["profile", draft?.created_by],
    enabled: !!draft?.created_by,
    queryFn: async () => {
      if (!draft?.created_by) return null;
      const { data } = await supabase
        .from("profiles")
        .select("avatar_url, display_name")
        .eq("id", draft.created_by)
        .maybeSingle();
      return data;
    },
  });

  const { data: draftEdits = [] } = useQuery({
    queryKey: ["draft-edits", id],
    queryFn: () => fetchEditsForDraft(id),
  });

  // Current user's leaf balance — the「金叶」detail-page button is gated on it.
  const { data: leaves } = useQuery({
    queryKey: ["leaves", user?.id],
    enabled: !!user,
    queryFn: () => computeLeaves(user!.id, user!.email),
  });
  const goldAvailable = leaves?.goldAvailable ?? 0;

  // Discoverer = the person who TOOK the photo (the draft's creator_label), NOT
  // whoever happens to be clicking「生成分享卡」. An editor/admin generating a card
  // for someone else's find must still credit the original photographer. Guests
  // who identified anonymously are credited as「小P蛙」.
  const discovererName =
    draft?.creator_label && draft.creator_label.trim() && draft.creator_label.trim() !== "访客"
      ? draft.creator_label.trim()
      : "小P蛙";

  // Phase-1 lite drafts carry ai_payload._enriched === false; older/full drafts
  // don't have the flag at all → treated as already enriched.
  const notEnriched =
    (draft?.ai_payload as { _enriched?: boolean } | undefined)?._enriched === false;

  // 「疑似」单一判定：低置信度，或摘要/标题本身以「疑似」开头（模型偶尔 confidence 写
  // medium 却在正文说疑似）。标题、正文提示、分享卡、补拍激活都以它为准。
  const draftTentative =
    draft?.ai_payload?.identification_confidence === "low" ||
    /^\s*疑似/.test((draft?.summary || draft?.ai_payload?.summary_zh || "").trim()) ||
    /^\s*（?\s*疑似/.test((draft?.title || "").trim());

  // 补拍建议：滤掉「摸一摸 / 闻一闻」这类拍不出来的条目 —— 库里的旧草稿存的还是 prompt
  // 加禁令之前的文案，照搬出来会让用户白跑一趟（他们只能回传照片）。滤空则不显示横幅。
  const retakeAdvice = keepVisualAdvice(draft?.ai_payload?.needs_more_photos_zh);

  // 重点保护 / CITES / GTS / GRIIS / 地区名录 / tag 卡签（与详情页、分享卡同源）。
  const registryChipList = useRegistryChips({
    scientific_name: draft?.scientific_name,
    family: draft?.family,
    tags: draft?.tags,
  });

  const onEnrich = async () => {
    if (enriching) return;
    setEnriching(true);
    setEnrichError(null);
    const tId = toast.loading("正在生成完整草稿（含多张配图），大约需 20–60 秒…");
    try {
      const res = (await enrich({ data: { draft_id: id } })) as { silverRemaining?: number | null };
      await qc.invalidateQueries({ queryKey: ["draft", id] });
      await qc.invalidateQueries({ queryKey: ["leaves", user?.id] });
      const rem =
        res?.silverRemaining === null || res?.silverRemaining === undefined
          ? ""
          : `，剩余银叶 ${res.silverRemaining} 枚`;
      toast.success(`完整草稿已生成${rem}`, { id: tId });
    } catch (e) {
      const msg =
        e instanceof Error && e.message
          ? e.message
          : "生成失败（UNKNOWN）：发生了未知错误，请重试。";
      setEnrichError(msg); // keep it on screen — the cause matters more than the toast
      toast.error(msg, { id: tId, duration: 12000 });
    } finally {
      setEnriching(false);
    }
  };

  // 金叶：一键创建物种详细科普页。消耗 1 枚金叶（服务端校验余额并扣减）。生成为三段式
  // LLM + 真实名录取证，耗时数分钟——因此改为【后台任务】：点确认后立即关弹窗、释放界面，
  // 用户可在站内继续浏览（SPA 客户端路由不会中断进行中的请求），完成后用全局 toast 通知并
  // 附「查看」链接。注意：这不是真正的服务端后台任务——**关闭/刷新标签页会中断生成**（若要
  // 跨标签页存活需 Cloudflare Queues，另立一期）。故仍提示「请勿关闭标签页」。
  //
  // 直接调用原始 serverFn（而非 useServerFn 包装版），避免请求被组件卸载时的 AbortSignal 取消——
  // 用户离开草稿页后生成仍继续。
  const onCreateGoldPage = () => {
    if (goldBusy) return;
    setGoldBusy(true);
    setGoldError(null);
    setGoldConfirm(false);
    const tId = toast.loading(
      "正在后台生成金叶详页：取证名录、检索配图、三段式撰稿…（可离开本页在站内继续浏览，完成后会通知你；请勿关闭或刷新标签页）",
      { duration: Infinity },
    );
    void createGoldDetailPageFn({ data: { draft_id: id, userModel: userModelArg() } })
      .then((res) => {
        const r = res as { slug: string; goldRemaining: number | null };
        void qc.invalidateQueries({ queryKey: ["leaves", user?.id] });
        toast.success(
          `金叶详页已生成，剩余金叶 ${r.goldRemaining === null ? "∞（管理员无限）" : `${r.goldRemaining} 枚`}`,
          {
            id: tId,
            duration: 12000,
            action: { label: "查看", onClick: () => window.location.assign(`/plants/${r.slug}`) },
          },
        );
      })
      .catch((e) => {
        const msg =
          e instanceof Error && e.message
            ? e.message
            : "创建失败（UNKNOWN）：发生了未知错误，请重试。";
        setGoldError(msg);
        toast.error(msg, { id: tId, duration: 14000 });
      })
      .finally(() => {
        setGoldBusy(false);
      });
  };

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
      const { data } = await supabase.from("user_roles").select("role").eq("user_id", user.id);
      return !!data?.some((r) => r.role === "editor" || r.role === "admin");
    },
  });

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
      // 同物种已有条目 → 服务端返回 conflict（未写库），弹窗让编辑决定是否合并。
      if (res && (res as { conflict?: boolean }).conflict) {
        setMergePrompt(res as MergePrompt);
        return;
      }
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

  // 编辑「采纳识别」= 先标记采纳（识别用户该枚识别铜叶 ×2，即 +2 效果），再审核通过并收录本站。
  const onAdoptApprove = async () => {
    if (!user || !draft) return;
    try {
      if (!draft.adopted) await setAdopted("plant_drafts", id, true, user.id);
    } catch {
      /* 采纳标记失败（如权限）不阻断收录 */
    }
    await onApprove();
  };

  const onConfirmMerge = async () => {
    if (!mergePrompt) return;
    setBusy(true);
    try {
      const res = await approveFn({ data: { draftId: id, mergeTargetId: mergePrompt.target.id } });
      setMergePrompt(null);
      toast.success("已合并到已有条目，并作为「补充观测」记入页尾");
      qc.invalidateQueries({ queryKey: ["home-all"] });
      qc.invalidateQueries({ queryKey: ["home-drafts"] });
      navigate({ to: "/plants/$slug", params: { slug: (res as { slug: string }).slug } });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "合并失败");
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

  // 保存为待审批草稿 = 把这份资料正式提交进审核流程。在此之前草稿是私有的：不进 AI
  // 待审队列、也不出现在身边物种地图（用户还在补拍/完善）。点击后翻 submitted_for_review。
  const submittedForReview =
    (draft as { submitted_for_review?: boolean | null } | undefined)?.submitted_for_review === true;
  /** 已用掉的补拍次数（3 次封顶，与服务端强制出结论的阈值同源）。 */
  const retakeCount = (draft as { retake_count?: number | null } | undefined)?.retake_count ?? 0;
  const onSubmitForReview = async () => {
    if (submitting) return;
    setSubmitting(true);
    try {
      await submitForReview({ data: { draft_id: id } });
      toast.success(
        "已保存为待审批草稿！该物种资料已进入审核流程，并会出现在身边物种地图（未采纳前显示为蓝点）。",
      );
      qc.invalidateQueries({ queryKey: ["draft", id] });
      qc.invalidateQueries({ queryKey: ["home-drafts"] });
      qc.invalidateQueries({ queryKey: ["identify-drafts-all"] });
      qc.invalidateQueries({ queryKey: ["geo-sightings"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "保存失败，请重试");
    } finally {
      setSubmitting(false);
    }
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

  // Render the identification into a phone-feed share image, then open a preview
  // modal from which the user shares (system sheet → 微信/小红书/…) or saves to
  // album. Rendering is client-side canvas; the user photo is fetched fresh so
  // the export is never tainted.
  const onMakeCard = async (opts?: { silent?: boolean }) => {
    if (!draft || cardBusy) return;
    setCardBusy(true);
    const tId = opts?.silent ? undefined : toast.loading("正在生成分享卡…");
    try {
      // 疑似判定用页面统一的 draftTentative（标题/正文/补拍横幅同源）。
      // 补拍次数决定本轮铜叶 = 1 + 补拍次数（疑似恒 1）。
      const tentative = draftTentative;
      const retakeCount = (draft as { retake_count?: number | null }).retake_count ?? 0;
      const earned = tentative ? 1 : 1 + retakeCount;
      const blob = await renderShareCard({
        title: draft.title,
        tentative,
        scientificName: draft.scientific_name,
        commonNameEn: draft.common_name_en,
        commonNamesZh: draft.common_names_zh || draft.ai_payload?.common_names_zh,
        family: draft.family || draft.ai_payload?.family,
        genus: draft.genus || draft.ai_payload?.genus,
        place: draft.capture_place,
        lat: draft.capture_lat,
        lng: draft.capture_lng,
        summary: draft.summary || draft.ai_payload?.summary_zh,
        photoUrl: draft.photo_url,
        discovererName,
        discovererAvatar: creatorProfile?.avatar_url || null,
        // 名录卡签（重点保护 / 地区名录 / tag…）**故意不传给识别分享卡**：卡签是按物种匹配
        // 名录的，但一次识别只知道「这张照片里可能是什么」——在内蒙古拍到的未必是内蒙古的
        // 野生植物，可能是园艺栽培或花店里的盆栽；疑似时连物种本身都还没定。把这些标签印在
        // 一张会被转发出去的卡上，等于替用户断言了他没断言的事。草稿页/详情页仍照常显示
        // （那里有上下文，且详情页是编辑审过的）。
        leafEarned: earned,
        leafBronze: leaves?.bronze ?? null,
        leafSilver: leaves?.silver ?? null,
        leafGold: leaves?.gold ?? null,
      });
      cardBlobRef.current = blob;
      setCardUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return URL.createObjectURL(blob);
      });
      if (tId) toast.success("分享卡已生成", { id: tId });
    } catch (e) {
      if (tId) toast.error(e instanceof Error ? e.message : "生成分享卡失败", { id: tId });
    } finally {
      setCardBusy(false);
    }
  };

  const onShareCard = async () => {
    const blob = cardBlobRef.current;
    if (!blob) return;
    const filename = `plantspedia-${(draft?.scientific_name || draft?.title || "plant")
      .replace(/[^\w一-龥-]+/g, "_")
      .slice(0, 40)}.png`;
    // 识别分享卡**只发图、不带链接**：卡面本身已经印了 plantspedia.club，再塞一份链接
    // 只会帮倒忙 —— 微信/小红书的分享扩展一看到链接就把这次分享判定成「分享网页」，
    // 渲染成链接卡片并丢掉图片，而这张卡的全部价值就是那张图。
    // 不传 opts → 不写剪贴板、不拼文案，系统面板里直接就是「存储图像」。
    const how = await shareOrSaveImage(blob, filename);
    if (how === "downloaded") toast.success("图片已保存");
    else if (how === "shared") toast.success("选「存储图像」即可存入相册");
  };

  /** 关掉分享卡后是否直接送去补拍：识别刚出结果、结论是疑似、且还有补拍次数。
   *  只认「识别完自动弹出来的那张卡」——用户事后自己点「生成分享卡」是想分享，
   *  那时候把人拽走是耍流氓（他也未必找得回来）。 */
  const jumpToRetakeOnClose = cardAutoOpened && draftTentative && retakeCount < 3;

  const goRetake = () => {
    navigate({
      to: "/identify",
      search: {
        retake: retakeCount + 1,
        st: draft?.title,
        ss: draft?.scientific_name ?? undefined,
        nmp: retakeAdvice.slice(0, 300) || undefined,
        md: id,
        pick: 1,
      },
    });
  };

  /** 只收起分享卡，不做任何跳转。`cardAutoOpened=false` 是关键：置回后即使用户之后再手动
   *  点「生成分享卡」，也不会被关卡二次拽去补拍。「放弃补拍」直接复用它。 */
  const closeCardOnly = () => {
    setCardUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return null;
    });
    cardBlobRef.current = null;
    setCardAutoOpened(false);
  };

  const closeCard = () => {
    const jump = jumpToRetakeOnClose;
    closeCardOnly();
    // 疑似 → 不把人丢在草稿页上让他自己找「去补拍」，直接进补拍界面（建议 + 两种补拍方式）。
    if (jump) goRetake();
  };

  // Guest → login/register, then return to THIS draft with the card re-opened.
  const onLoginToEarn = () => {
    try {
      sessionStorage.setItem("plantspedia:justIdentified", id);
    } catch {
      /* storage disabled — user can still re-open the card via the button */
    }
    navigate({ to: "/login", search: { redirect: `/drafts/${id}` } });
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
          title: newTitle,
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

  // Revoke the share-card object URL when the page unmounts.
  useEffect(() => {
    return () => {
      if (cardBlobRef.current) cardBlobRef.current = null;
      setCardUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return null;
      });
    };
  }, []);

  // Auto-show the share card as the FIRST thing after a fresh identification. The
  // camera flow stamps a sessionStorage flag with the new draft id; we consume it
  // once, waiting until the draft (and, for signed-in users, their leaf stats) have
  // loaded so the card carries the right +N / totals.
  const autoCardFiredRef = useRef(false);
  useEffect(() => {
    if (autoCardFiredRef.current || !draft) return;
    const flag =
      typeof sessionStorage !== "undefined"
        ? sessionStorage.getItem("plantspedia:justIdentified")
        : null;
    if (flag !== id) return;
    if (user && !leaves) return; // wait for stats before rendering
    autoCardFiredRef.current = true;
    sessionStorage.removeItem("plantspedia:justIdentified");
    setCardAutoOpened(true);
    void onMakeCard({ silent: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft, leaves, user, id]);

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
                <Link to="/identify" className="label hover:text-vermilion">
                  ← 返回 AI 识别
                </Link>
                <span className="label text-vermilion">
                  {draft.status === "pending"
                    ? "待审核草稿"
                    : draft.status === "approved"
                      ? "已收录"
                      : "已驳回"}
                </span>
              </div>

              {/* ── 编辑操作（仅有编辑权限的编辑可见）：继续编辑 HTML · 采纳识别 · 驳回草稿 ── */}
              {isEditor && (
                <div className="flex flex-wrap items-center gap-2 border border-emerald-700/30 bg-emerald-700/5 rounded-md px-3 py-2.5 w-full">
                  <span className="label text-[10px] text-emerald-700 mr-1 shrink-0">
                    编辑操作 · 审核
                  </span>
                  <button
                    onClick={() => setIsEditing(!isEditing)}
                    className={`px-3 py-1.5 text-xs transition-colors inline-flex items-center gap-1 cursor-pointer
                      ${
                        isEditing
                          ? "border border-rule text-ink-faint hover:border-ink hover:text-ink"
                          : "border border-emerald-700 text-emerald-700 hover:bg-emerald-700 hover:text-background"
                      }`}
                  >
                    <EditIcon className="w-3.5 h-3.5" />
                    <span>{isEditing ? "退出编辑" : "继续编辑 HTML"}</span>
                  </button>
                  {isEditing && (
                    <button
                      onClick={onSaveEdits}
                      disabled={savingEdits}
                      className="bg-ink text-background px-3 py-1.5 text-xs hover:bg-vermilion transition-colors inline-flex items-center gap-1 cursor-pointer disabled:opacity-60 font-semibold"
                    >
                      <CloudIcon className="w-3.5 h-3.5" />
                      <span>{savingEdits ? "保存中…" : "保存草稿修改"}</span>
                    </button>
                  )}
                  {draft.status === "pending" && !isEditing && (
                    <>
                      <button
                        onClick={onAdoptApprove}
                        disabled={busy}
                        title="审核通过并收录本站 · 识别用户该枚识别铜叶 ×2（+2 枚铜叶）"
                        className="bg-ink text-background px-4 py-1.5 text-xs hover:bg-vermilion transition-colors disabled:opacity-60 cursor-pointer inline-flex items-center gap-1.5 font-semibold"
                      >
                        <LeafIcon tier="bronze" size={13} />
                        <span>{busy ? "处理中…" : "采纳识别"}</span>
                      </button>
                      <button
                        onClick={onReject}
                        disabled={busy}
                        title="驳回本草稿（若曾消耗银叶生成，将自动退还）"
                        className="border border-rule text-ink-faint px-4 py-1.5 text-xs hover:border-ink hover:text-ink transition-colors disabled:opacity-60 cursor-pointer font-semibold"
                      >
                        驳回草稿
                      </button>
                      <span className="text-[10px] text-ink-faint w-full sm:w-auto sm:ml-1">
                        采纳识别 = 审核通过并收录本站，识别用户 +2 枚铜叶；驳回后银叶自动退还。
                      </span>
                    </>
                  )}
                </div>
              )}

              {/* ── 用户操作：进入编辑 · 保存为待审批草稿 · 保存在本地 · 生成分享卡 · 分享链接 ── */}
              {!isEditing && (
                <div className="flex flex-wrap items-center gap-2 w-full">
                  <span className="label text-[10px] text-ink-faint mr-1 shrink-0">用户操作</span>
                  <button
                    onClick={() => setIsEditing(true)}
                    className="border border-ink/40 text-ink px-3 py-1.5 text-xs hover:border-ink hover:bg-paper-deep transition-colors inline-flex items-center gap-1 cursor-pointer"
                  >
                    <EditIcon className="w-3.5 h-3.5" />
                    <span>进入编辑 (可以修改内容)</span>
                  </button>
                  {/* "保存为待审批草稿"按钮已移至简介卡下方 */}
                  {/* 双线边框强调 */}
                  <button
                    onClick={() => onMakeCard()}
                    disabled={cardBusy}
                    style={{ borderStyle: "double", borderWidth: "3px" }}
                    className="border-leaf-deep text-leaf-deep px-3 py-1.5 text-xs font-semibold hover:bg-leaf-deep hover:text-background transition-colors inline-flex items-center gap-1 cursor-pointer disabled:opacity-60"
                  >
                    <ImageIcon className="w-3.5 h-3.5" />
                    <span>{cardBusy ? "生成中…" : "生成分享卡·存相册"}</span>
                  </button>
                  <button
                    onClick={handleShare}
                    className="border border-ink/40 text-ink px-3 py-1.5 text-xs hover:border-ink hover:bg-paper-deep transition-colors inline-flex items-center gap-1 cursor-pointer"
                  >
                    <ShareIcon className="w-3.5 h-3.5" />
                    <span>分享链接</span>
                  </button>
                </div>
              )}
            </div>

            {!isEditing && (
              <section className="mx-auto max-w-5xl px-6 pt-6">
                <div className="border border-rule bg-paper-deep/30 p-5 md:p-6">
                  <div className="flex flex-col md:flex-row gap-5 md:gap-6">
                    <div className="flex-1 min-w-0">
                      {/* 科属信息（小字，在中文名上方） */}
                      {(draft.family || draft.genus) && (
                        <p className="text-xs text-leaf-deep font-semibold mb-1.5">
                          {[draft.family, draft.genus].filter(Boolean).join(" · ")}
                        </p>
                      )}
                      <h1 className="font-display text-2xl md:text-3xl font-bold leading-tight">
                        {draftTentative
                          ? `疑似${(draft.title || "").replace(/^\s*（?\s*疑似\s*）?/, "")}`
                          : draft.title}
                      </h1>
                      {draft.scientific_name && (
                        <p className="italic text-ink-faint mt-1">{draft.scientific_name}</p>
                      )}
                      {registryChipList.length > 0 && (
                        <RegistryChips chips={registryChipList} className="mt-2.5" />
                      )}
                      {/* #3 定种存疑提示：与标题/正文同源（draftTentative）。一旦补拍升出疑似
                       （medium/high 且正文不再以「疑似」开头），疑似字样与补拍横幅都消失。 */}
                      {draftTentative && retakeAdvice && (
                        <div className="mt-3 rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-3">
                          <p className="flex items-center gap-1.5 text-sm font-semibold text-amber-700">
                            <svg
                              viewBox="0 0 24 24"
                              width="15"
                              height="15"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="2"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              aria-hidden="true"
                            >
                              <path d="M12 9v4" />
                              <path d="M12 17h.01" />
                              <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z" />
                            </svg>
                            此照片尚不足以确诊物种（结果为疑似）
                          </p>
                          <p className="mt-1.5 text-sm text-ink-soft leading-relaxed whitespace-pre-line">
                            {retakeAdvice}
                          </p>
                          {((draft as { retake_count?: number | null }).retake_count ?? 0) < 3 ? (
                            <>
                              <Link
                                to="/identify"
                                search={{
                                  retake:
                                    ((draft as { retake_count?: number | null }).retake_count ??
                                      0) + 1,
                                  st: draft.title,
                                  ss: draft.scientific_name ?? undefined,
                                  nmp: retakeAdvice.slice(0, 300) || undefined,
                                  md: id,
                                }}
                                className="mt-3 inline-flex items-center gap-1.5 bg-amber-600 text-background px-4 py-2 text-sm font-semibold rounded-full hover:bg-amber-500 transition-colors"
                              >
                                <CameraIcon className="w-4 h-4" />
                                按上面的提示去补拍（
                                {retakeOrdinalLabel(
                                  ((draft as { retake_count?: number | null }).retake_count ?? 0) +
                                    1,
                                )}
                                ）
                              </Link>
                              <p className="mt-1.5 text-[11px] text-ink-faint leading-relaxed">
                                点击后可选「打开相机补拍」或「上传相册补拍」，对准同一株植物补拍即可自动重新识别；新照片会并入这份草稿（原来的简介卡将被覆盖为多图版）。补拍成功可多得铜叶
                                （
                                {retakeOrdinalLabel(
                                  ((draft as { retake_count?: number | null }).retake_count ?? 0) +
                                    1,
                                )}
                                ，成功可得
                                {1 +
                                  ((draft as { retake_count?: number | null }).retake_count ?? 0) +
                                  1}{" "}
                                枚铜叶）。
                              </p>
                            </>
                          ) : (
                            <p className="mt-3 text-[12px] text-amber-700 leading-relaxed font-medium">
                              已完成 3 次补拍（最后一次补拍），这是最终结果（疑似）。感谢你的坚持 —
                              本次识别记 1 枚铜叶。
                            </p>
                          )}
                        </div>
                      )}
                      <dl className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3 text-sm">
                        <div>
                          <dt className="label text-[10px] text-ink-faint">中文俗名 / 商品名</dt>
                          <dd className="mt-0.5 font-medium">
                            {draft.common_names_zh || draft.ai_payload?.common_names_zh || "—"}
                          </dd>
                        </div>
                        <div>
                          <dt className="label text-[10px] text-ink-faint">英文俗名</dt>
                          <dd className="mt-0.5 font-medium">{draft.common_name_en || "—"}</dd>
                        </div>
                        <div>
                          <dt className="label text-[10px] text-ink-faint">识别时间</dt>
                          <dd className="mt-0.5">
                            {new Date(draft.created_at).toLocaleString("zh-CN")}
                          </dd>
                          <dt className="label text-[10px] text-ink-faint mt-2.5">识别人</dt>
                          <dd className="mt-0.5">{draft.creator_label || "访客"}</dd>
                        </div>
                        <div>
                          <dt className="label text-[10px] text-ink-faint">识别地点</dt>
                          <dd className="mt-0.5 inline-flex items-center gap-1">
                            <svg
                              viewBox="0 0 24 24"
                              width="13"
                              height="13"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="1.8"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              aria-hidden="true"
                            >
                              <path d="M12 21s-7-6.2-7-11a7 7 0 0 1 14 0c0 4.8-7 11-7 11Z" />
                              <circle cx="12" cy="10" r="2.6" />
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
                            <span
                              key={t}
                              className="text-xs border border-rule px-2 py-0.5 text-ink-faint"
                            >
                              #{t}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                    {/* 配图移到简介摘要卡内部右侧。补拍会累积多张用户照片 → 显示为图库
                        （首图=最近一次让识别升出 low 的照片，同时作为分享卡封面）。 */}
                    {(() => {
                      const gallery = (
                        draft.user_photos && draft.user_photos.length
                          ? draft.user_photos
                          : draft.photo_url
                            ? [draft.photo_url]
                            : []
                      ).filter(Boolean) as string[];
                      if (!gallery.length) return null;
                      const [cover, ...rest] = gallery;
                      return (
                        <div className="md:w-60 lg:w-72 shrink-0">
                          <SafeImg
                            src={cover}
                            alt={draft.title}
                            className="w-full aspect-square object-cover border border-rule rounded-md"
                            fallback={
                              <div className="w-full aspect-square flex items-center justify-center border border-rule rounded-md bg-paper-deep">
                                <span className="font-display text-4xl text-leaf-deep/40">❦</span>
                              </div>
                            }
                          />
                          {rest.length > 0 && (
                            <>
                              <div className="mt-2 grid grid-cols-3 gap-1.5">
                                {rest.map((u, i) => (
                                  <SafeImg
                                    key={`${u}-${i}`}
                                    src={u}
                                    alt={`${draft.title} 补拍 ${i + 1}`}
                                    className="w-full aspect-square object-cover border border-rule rounded"
                                    fallback={
                                      <div className="w-full aspect-square border border-rule rounded bg-paper-deep" />
                                    }
                                  />
                                ))}
                              </div>
                              <p className="mt-1.5 text-[11px] text-ink-faint text-center">
                                共 {gallery.length} 张你拍摄的照片（含补拍）
                              </p>
                            </>
                          )}
                        </div>
                      );
                    })()}
                  </div>
                </div>
              </section>
            )}

            {/* 简介摘要卡下方：草稿在此之前是私有的（submitted_for_review = false），这里让用户
                把它正式送进审核流程。
                注意「草稿内容和我的观察不符」**不在这里** —— 快速简介卡只有寥寥几行，用户根本
                无从判断「符不符」；要等他点了「让 AI 生成进一步介绍草稿」、看到成篇的内容之后，
                这个判断才有依据。那个按钮因此挪到了下面的 !notEnriched 分支。 */}
            {notEnriched && !isEditing && (
              <section className="mx-auto max-w-5xl px-6 mt-4">
                <div className="flex flex-wrap justify-center gap-3">
                  <button
                    onClick={onSubmitForReview}
                    disabled={submitting || submittedForReview}
                    className="inline-flex items-center gap-2 bg-amber-600 text-background px-8 py-3 text-base font-bold rounded-full hover:bg-amber-500 transition-colors disabled:opacity-60 disabled:cursor-default cursor-pointer shadow-lg"
                  >
                    <CloudIcon className="w-5 h-5" />
                    <span>
                      {submittedForReview
                        ? "已提交待审批"
                        : submitting
                          ? "提交中…"
                          : "保存为待审批草稿"}
                    </span>
                  </button>
                </div>
              </section>
            )}

            {/* 完整草稿的岔路口：只有在用户点过「让 AI 生成进一步介绍草稿」、AI 写出成篇内容
                之后才出现（notEnriched=false）。此时他才读得到足以判断「AI 是不是认错了」的
                内容。不受「疑似」限制 —— AI 说得笃定却认错物种，恰恰最该让用户纠正。
                补拍上限 3 次与上方补拍横幅同源。 */}
            {!notEnriched && !isEditing && !submittedForReview && (
              <section className="mx-auto max-w-5xl px-6 mt-4">
                <div className="flex flex-wrap justify-center gap-3">
                  {retakeCount < 3 ? (
                    <Link
                      to="/identify"
                      search={{
                        retake: retakeCount + 1,
                        st: draft.title,
                        ss: draft.scientific_name ?? undefined,
                        nmp: retakeAdvice.slice(0, 300) || undefined,
                        md: id,
                        pick: 1,
                      }}
                      className="inline-flex items-center gap-2 border-2 border-amber-600 text-amber-700 px-8 py-3 text-base font-bold rounded-full hover:bg-amber-600 hover:text-background transition-colors cursor-pointer"
                    >
                      <CameraIcon className="w-5 h-5" />
                      草稿内容和我的观察不符
                    </Link>
                  ) : (
                    <span className="inline-flex items-center px-4 py-3 text-sm text-ink-faint">
                      已用完 3 次补拍机会
                    </span>
                  )}
                </div>
                {retakeCount < 3 && (
                  <p className="mt-2 text-center text-[11px] text-ink-faint">
                    读下面的完整草稿时，觉得 AI 认错了物种？点上面这个按钮去补拍——可以现拍，
                    也可以从相册选已有照片（{retakeOrdinalLabel(retakeCount + 1)}）。
                  </p>
                )}
              </section>
            )}

            {/* Phase-1 → Phase-2: a lite summary-card draft offers a button to
                generate the full multi-image draft on demand (saves tokens + time
                until the user actually wants the deep write-up). */}
            {notEnriched && !isEditing && (
              <section className="mx-auto max-w-5xl px-6 mt-6">
                <div className="border border-leaf/40 bg-leaf/5 rounded-xl p-5 md:p-6 text-center">
                  <p className="text-sm text-ink-soft leading-relaxed">
                    以上是 AI 快速生成的<strong>简介摘要卡</strong>。点击下方按钮，AI
                    会撰写含名称溯源、形态特征、
                    生境分布、植物人文、养护建议等分区，并自动配上多张物种图片的
                    <strong>完整科普草稿</strong>。
                  </p>
                  {user ? (
                    <button
                      onClick={onEnrich}
                      disabled={enriching}
                      className="mt-4 inline-flex items-center gap-2 bg-leaf-deep text-background px-6 py-2.5 text-sm font-semibold rounded-full hover:bg-leaf transition-colors disabled:opacity-60 cursor-pointer"
                    >
                      {enriching ? (
                        <>
                          <span className="w-4 h-4 rounded-full border-2 border-background/30 border-t-background animate-spin" />
                          正在生成完整草稿…
                        </>
                      ) : (
                        <>
                          <SparkleIcon className="w-4 h-4" />让 AI 生成进一步介绍草稿
                        </>
                      )}
                    </button>
                  ) : (
                    <Link
                      to="/login"
                      className="mt-4 inline-flex items-center gap-2 border border-leaf-deep text-leaf-deep px-6 py-2.5 text-sm font-semibold rounded-full hover:bg-leaf-deep hover:text-background transition-colors"
                    >
                      <SparkleIcon className="w-4 h-4" />
                      登录后可生成（需 1 枚银叶）
                    </Link>
                  )}
                  <p className="mt-2 text-[11px] text-ink-faint">
                    生成需 20–60 秒，请勿重复点击。<strong>自动进入待审批草稿库。</strong>
                  </p>
                  <div className="mt-2 inline-flex items-center gap-1.5 text-[11px] text-ink-soft bg-paper-deep/50 border border-rule/40 rounded-full px-3 py-1">
                    <LeafIcon tier="silver" />
                    {isEditor ? (
                      <span>
                        你是已通过申请的<strong>编辑</strong>，此操作<strong>免银叶</strong>。
                      </span>
                    ) : (
                      <span>
                        本操作消耗 <strong>1 枚银叶</strong>
                        {typeof leaves?.silverAvailable === "number" &&
                        isFinite(leaves.silverAvailable)
                          ? `（当前可用 ${leaves.silverAvailable} 枚）`
                          : leaves?.isOwner
                            ? "（管理员无限）"
                            : ""}
                        ；若草稿被驳回，银叶将<strong>自动退还</strong>；通过申请成为编辑后
                        <strong>免银叶</strong>。
                      </span>
                    )}
                  </div>
                  {enrichError && (
                    <div className="mt-3 text-left rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-2.5">
                      <p className="text-xs font-semibold text-destructive">生成失败</p>
                      <p className="mt-1 text-xs text-ink-soft leading-relaxed">{enrichError}</p>
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
            ) : notEnriched /* 精简摘要卡草稿：正文与上方「简介摘要卡」重复，故不再重复渲染
                 （配图已移入摘要卡右侧）。点「让 AI 生成进一步介绍草稿」后才有完整正文。 */ ? null : (
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

            {/* 金叶编辑专属：一键创建物种详细科普页入口。仅在草稿已生成完整内容、且当前
                用户有可用金叶时出现（无金叶不显示）。生成器为后续单独一期，故此处只做
                权限门控 + 确认，暂不消耗金叶。 */}
            {!isEditing && !notEnriched && goldAvailable > 0 && (
              <div className="mx-auto max-w-5xl px-6 mt-8">
                <div className="border border-amber-500/40 bg-amber-500/5 rounded-xl p-5 md:p-6 text-center">
                  <button
                    onClick={() => setGoldConfirm(true)}
                    className="inline-flex items-center gap-2 bg-amber-600 text-background px-6 py-2.5 text-sm font-semibold rounded-full hover:bg-amber-500 transition-colors cursor-pointer"
                  >
                    <LeafIcon tier="gold" />
                    使用一张金叶创建该物种详细科普页面
                  </button>
                  <p className="mt-2.5 text-[11px] text-ink-faint leading-relaxed max-w-md mx-auto">
                    *亲爱的金叶编辑，详细页面生成等待时间较长，且将消耗数百万
                    token，创建后还建议您回到电脑上做详细校对再收录到本站档案中。
                  </p>
                  <p className="mt-1 text-[10px] text-amber-700/70">
                    当前可用金叶：{goldAvailable}
                  </p>
                </div>
              </div>
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
            {
              <XiaoPAgentPanel
                storageKey={`draft:${id}`}
                greetingTitle={draft.title}
                canApply={isEditor && draft.status !== "approved"}
                isRegistered={!!user}
                scopes={pageSections}
                ask={async (question, history, scope) => {
                  const res = (await askAgent({
                    data: { draftId: id, question, scope, history, userModel: userModelArg() },
                  })) as {
                    reply: string;
                    canEdit: boolean;
                    editInstruction: string;
                  };
                  return res;
                }}
                apply={async (instruction, scope) => {
                  const before = draft.html_content;
                  const { html } = (await applyAgentEdit({
                    data: { draftId: id, instruction, scope, userModel: userModelArg() },
                  })) as {
                    html: string;
                  };
                  await saveDraftHtml({ data: { draftId: id, html } });
                  logDraftEdit({
                    data: {
                      draftId: id,
                      kind: "draft_text",
                      summary:
                        `小P蛙改写${scope ? `（${scope}）` : "（整份草稿）"}：${instruction}`.slice(
                          0,
                          500,
                        ),
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
            }
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
                        summary:
                          `小P蛙换图（${ctx?.instruction || "手动"}）：${oldUrl} → ${newUrl}`.slice(
                            0,
                            500,
                          ),
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

      {mergePrompt && (
        <div
          className="fixed inset-0 z-[70] bg-black/60 flex items-center justify-center p-4"
          onClick={() => !busy && setMergePrompt(null)}
        >
          <div
            className="bg-background border border-ink shadow-xl w-full max-w-lg p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="label text-vermilion mb-1">该物种已有条目</h3>
            <p className="text-sm text-ink mb-3">
              已收录档案里已存在同物种条目「
              <span className="font-semibold">{mergePrompt.target.title}</span>」
              {mergePrompt.target.scientific_name && (
                <span className="text-ink-faint italic">
                  （{mergePrompt.target.scientific_name}）
                </span>
              )}
              。
            </p>
            <p className="text-sm text-ink-soft bg-paper-deep/40 border border-rule px-3 py-2 mb-5 leading-relaxed">
              {mergePrompt.whatsNew}
            </p>
            <div className="flex flex-wrap justify-end gap-2">
              <a
                href={`/plants/${mergePrompt.target.slug}`}
                target="_blank"
                rel="noreferrer"
                className="border border-rule text-ink-faint px-4 py-2 text-sm hover:border-ink hover:text-ink transition-colors"
              >
                查看已有条目
              </a>
              <button
                onClick={() => setMergePrompt(null)}
                disabled={busy}
                className="border border-rule text-ink-faint px-4 py-2 text-sm hover:border-ink hover:text-ink transition-colors disabled:opacity-60"
              >
                取消
              </button>
              <button
                onClick={onConfirmMerge}
                disabled={busy}
                className="bg-ink text-background px-4 py-2 text-sm hover:bg-vermilion transition-colors disabled:opacity-60 font-semibold"
              >
                {busy ? "合并中…" : "确认合并"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 金叶创建详页 · 二次确认。生成器为后续单独一期，本期仅完成入口 + 权限门控 +
          确认；确认后暂不消耗金叶（等生成器上线再接入真实创建 + 扣叶）。 */}
      {goldConfirm && (
        <div
          className="fixed inset-0 z-[70] bg-black/60 flex items-center justify-center p-4"
          onClick={() => !goldBusy && setGoldConfirm(false)}
        >
          <div
            className="bg-background border border-ink shadow-xl w-full max-w-lg p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="label text-amber-700 mb-2 flex items-center gap-1.5">
              <LeafIcon tier="gold" />
              使用一张金叶创建详细科普页面
            </h3>
            <p className="text-sm text-ink-soft bg-amber-500/10 border border-amber-500/30 px-3 py-2.5 mb-4 leading-relaxed rounded-sm">
              亲爱的金叶编辑，详细页面生成<strong>等待时间较长</strong>，且将
              <strong>消耗数百万 token</strong>；
              创建后建议您回到电脑上做详细校对，再收录到本站档案中。
            </p>
            <p className="text-[12px] text-ink-faint mb-4">
              当前可用金叶：{goldAvailable}。确认后本次创建将消耗 1 枚。
            </p>
            {goldError && (
              <div className="mb-4 rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-2.5">
                <p className="text-xs font-semibold text-destructive">创建失败</p>
                <p className="mt-1 text-xs text-ink-soft leading-relaxed">{goldError}</p>
              </div>
            )}
            <div className="flex flex-wrap justify-end gap-2">
              <button
                onClick={() => setGoldConfirm(false)}
                disabled={goldBusy}
                className="border border-rule text-ink-faint px-4 py-2 text-sm hover:border-ink hover:text-ink transition-colors disabled:opacity-60 cursor-pointer"
              >
                取消
              </button>
              <button
                onClick={onCreateGoldPage}
                disabled={goldBusy}
                className="bg-amber-600 text-background px-4 py-2 text-sm hover:bg-amber-500 transition-colors font-semibold disabled:opacity-60 cursor-pointer inline-flex items-center gap-2"
              >
                {goldBusy ? (
                  <>
                    <span className="w-3.5 h-3.5 rounded-full border-2 border-background/30 border-t-background animate-spin" />
                    正在生成…
                  </>
                ) : (
                  "确认创建"
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 分享卡预览 — 生成后弹出，用户可分享到系统面板（微信/小红书/…）或存相册。 */}
      {cardUrl && (
        <div
          className="fixed inset-0 z-[80] bg-black/70 flex items-center justify-center p-4"
          onClick={closeCard}
        >
          <div
            className="bg-background border border-ink shadow-xl w-full max-w-sm p-4 flex flex-col items-center"
            onClick={(e) => e.stopPropagation()}
          >
            <p className="label text-leaf-deep mb-3 self-start">识别分享卡</p>
            <img
              src={cardUrl}
              alt="识别分享卡预览"
              className="w-full h-auto border border-rule rounded-md shadow-sm"
            />
            <p className="text-[11px] text-ink-faint mt-2 text-center leading-relaxed">
              手机上点「保存到相册」会调起系统面板，选「存储图像」即可存入相册，也可直接发到
              微信、小红书；长按上图同样能保存。分享出去的<strong>只有这张图片</strong>，不带链接。
            </p>
            {/* 疑似：关卡后会直接进补拍界面 —— 先说清楚，别让「关闭」把人莫名其妙送走。 */}
            {jumpToRetakeOnClose && (
              <p className="text-[11px] text-amber-700 mt-2 text-center leading-relaxed font-medium">
                本次结论为<strong>疑似</strong>，点「去补拍」会进入补拍界面（
                {retakeOrdinalLabel(retakeCount + 1)}）；不想补拍可点下方「放弃补拍」。
              </p>
            )}
            {/* Guests: log in / register to start banking leaves. Returns to this card. */}
            {!user && (
              <button
                onClick={onLoginToEarn}
                className="mt-3 w-full border border-leaf-deep/60 text-leaf-deep px-4 py-2.5 text-sm font-semibold hover:bg-leaf-deep hover:text-background transition-colors inline-flex items-center justify-center gap-1.5 cursor-pointer rounded-sm"
              >
                登录 / 注册后积累叶片
                <span aria-hidden="true">→</span>
              </button>
            )}
            <div className="flex gap-2 mt-3 w-full">
              <button
                onClick={onShareCard}
                className="flex-1 bg-leaf-deep text-background px-4 py-2.5 text-sm font-semibold hover:bg-leaf transition-colors inline-flex items-center justify-center gap-1.5 cursor-pointer rounded-sm"
              >
                <ShareIcon className="w-4 h-4" />
                保存到相册
              </button>
              <button
                onClick={closeCard}
                className={
                  jumpToRetakeOnClose
                    ? "border-2 border-amber-600 text-amber-700 px-4 py-2.5 text-sm font-semibold hover:bg-amber-600 hover:text-background transition-colors cursor-pointer rounded-sm inline-flex items-center gap-1.5 shrink-0"
                    : "border border-rule text-ink-faint px-4 py-2.5 text-sm hover:border-ink hover:text-ink transition-colors cursor-pointer rounded-sm"
                }
              >
                {jumpToRetakeOnClose ? (
                  <>
                    <CameraIcon className="w-4 h-4" />
                    去补拍
                  </>
                ) : (
                  "关闭"
                )}
              </button>
            </div>
            {/* 补拍是建议、不是强制 —— 给一条明确的退出路径，否则疑似结果等于把人锁在补拍循环里。 */}
            {jumpToRetakeOnClose && (
              <button
                onClick={closeCardOnly}
                className="mt-2 w-full text-[12px] text-ink-faint hover:text-ink underline underline-offset-2 transition-colors cursor-pointer py-1"
              >
                放弃补拍，直接看简介摘要卡
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// Flat-style SVG icons matching system aesthetics
function CameraIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3Z" />
      <circle cx="12" cy="13" r="3.5" />
    </svg>
  );
}

function ImageIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <circle cx="9" cy="9" r="2" />
      <path d="m21 15-3.5-3.5a2 2 0 0 0-2.8 0L5 21" />
    </svg>
  );
}

function SparkleIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9L12 3z" />
    </svg>
  );
}

function CloudIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d="M17.5 19A3.5 3.5 0 0 0 21 15.5c0-2.79-2.54-4.5-5-4.5-.48 0-.96.06-1.4.17A5.5 5.5 0 0 0 4 12c0 3 2.5 5 5 5" />
      <path d="M12 11v6M9 14l3-3 3 3" />
    </svg>
  );
}

function ShareIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
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
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7M18.5 2.5a2.121 2.121 0 1 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
    </svg>
  );
}
