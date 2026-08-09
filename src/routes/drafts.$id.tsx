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
import {
  applyImagePlan,
  listSectionSlots,
  summarizeChanges,
  type ImagePlanItem,
  type PlanPhoto,
} from "@/lib/xiaop-image-plan";
import {
  enhanceDraftHtmlForViewing,
  replaceImageInDraftHtml,
  stripStaleMissingNotes,
} from "@/lib/draft-enhance";
import {
  DRAFT_CARD_SCOPE,
  DRAFT_CARD_FIELD_KEYS,
  DRAFT_CARD_FIELD_LABELS,
  DRAFT_CARD_LONG_FIELDS,
  diffDraftCard,
  pickDraftCardFields,
  type DraftCardFields,
} from "@/lib/draft-card-fields";
import { stripTentativeMarks, isDraftTentative, tentativeResolution } from "@/lib/tentative";
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
  startEnrichDraftFn,
  startGoldDetailPageFn,
  submitDraftForReviewFn,
} from "@/lib/identify-plant.functions";
import { awaitJob, rememberJob, recallJob, forgetJob } from "@/lib/poll-job";
import { useAuth } from "@/hooks/use-auth";
import { supabase } from "@/integrations/supabase/client";
import { computeLeaves } from "@/lib/leaves";
import { setAdoptedFn, getMyRolesFn } from "@/lib/roles.functions";
import {
  FUZZ_EXPLAIN,
  FUZZ_ORANGE,
  FUZZ_SUFFIX,
  coarsenPlace,
  formatCoordPair,
  fuzzCoord,
} from "@/lib/protected-coords";
import { keepVisualAdvice } from "@/lib/retake-advice";
import { freshPhotoUrl } from "@/lib/fresh-photo";
import { LeafIcon } from "@/components/leaf-panel";
import { SafeImg } from "@/components/safe-img";
import { TagPicker } from "@/components/tag-picker";
import { fetchAllTags } from "@/lib/tags";
import { NameAuthorityNote, readNameStamp } from "@/components/name-authority-badge";
import { renderShareCard, shareOrSaveImage } from "@/lib/share-card";
import { markDraftReadFn } from "@/lib/task-feed.functions";
import { useTaskFeed } from "@/lib/use-task-feed";
import { lookupSpeciesExisting, type SpeciesExisting } from "@/lib/species-existing.functions";
import {
  SpeciesExistingLinks,
  SPECIES_EXISTING_STYLE,
  speciesExistingCountSuffix,
  speciesExistingLabel,
} from "@/components/species-existing-links";
import { computeIdentifyConfidence, traceSteps, type IdentifyTrace } from "@/lib/identify-trace";
import { JobProgressPanel } from "@/components/job-progress";
import { ConfidenceStars } from "@/components/confidence-stars";
import { RegistryChips } from "@/components/registry-chips";
import { BackToTagLink } from "@/components/back-to-tag";
import { useRegistryChips } from "@/lib/use-registry-chips";
import { toast } from "sonner";

export const Route = createFileRoute("/drafts/$id")({
  /** `?from=<tagSlug>` = 从某个标签的名单点进来的，页顶给一条回名单的路。
   *  只声明这一个可选键，理由见 plants.$slug 的同款注释。 */
  validateSearch: (search: Record<string, unknown>): { from?: string } => ({
    from: typeof search.from === "string" ? search.from.slice(0, 120) : undefined,
  }),
  // 分享草稿链接时也出「植物照片 + Plantspedia草木志·名称 + 简介」，而不是站点默认那句
  // （og:* 要在 SSR 时就写进 <head>，抓取器/微信才读得到；见 plants.$slug 同款注释）。
  // loader 用匿名 client 走 SSR，读不到（RLS / 不存在）就回落默认，绝不阻塞页面。
  //
  // ⏱ 客户端跳转时**先看 react-query 缓存**：loader 是会挡住导航的（跑完才渲染这一页），
  // 而识别刚跑完那一跳，相机页已经把服务端顺手带回的那一行喂进了缓存（见 camera-identify
  // 的 goToDraft）。不看缓存就等于再从浏览器往 Supabase 跑一趟同一行 —— 用户 2026-08-06
  // 报的「深度分析完成后很久才出分享卡」，这是其中一段串行等待。
  // 缓存里那份可能不是最新的（比如几分钟前看过这份草稿），但下面的 useQuery 配了
  // `refetchOnMount:"always"`，挂载后必回查一次真库，所以它只影响首帧和 <head>。
  loader: async ({ params, context }) => {
    const cached = (
      context as { queryClient?: { getQueryData: (k: unknown[]) => unknown } }
    ).queryClient?.getQueryData?.(["draft", params.id]);
    if (cached) return cached as Awaited<ReturnType<typeof fetchDraftById>>;
    try {
      return await fetchDraftById(params.id);
    } catch {
      return null;
    }
  },
  head: ({ loaderData }) => {
    const name = loaderData?.title || "";
    const shareTitle = name ? `Plantspedia草木志·${name}` : "Plantspedia · 全民植物志";
    const desc = (loaderData?.summary || "AI 识别生成的植物草稿，等待编辑审核收录。").slice(0, 180);
    const img = loaderData?.photo_url || "/default-og-image.jpg";
    return {
      meta: [
        { title: shareTitle },
        { name: "description", content: desc },
        { property: "og:title", content: shareTitle },
        { property: "og:description", content: desc },
        { property: "og:image", content: img },
        { property: "og:type", content: "article" },
        { name: "twitter:card", content: "summary_large_image" },
        { name: "twitter:title", content: shareTitle },
        { name: "twitter:description", content: desc },
        { name: "twitter:image", content: img },
      ],
    };
  },
  component: DraftPageRoute,
});

/**
 * **只做一件事：按草稿 id 给整棵子树打 key，强制换草稿时重新挂载。**
 *
 * 没有它，`/drafts/A` → `/drafts/B` 走的是 React 的同位置复用：元素类型没变，
 * DraftPage 这个实例就**一直活着**，只有 `useParams()` 的返回值变了。于是所有
 * 「属于某一份草稿」的局部状态全部跟着人走 —— goldProg / enrichProg / goldError /
 * goldDone / isEditing / cardUrl …，而 `resumedRef` 又是个 ref，新草稿自己的待续任务
 * 反而不会被接回。
 *
 * 2026-07-30 用户实测到的就是这个：在天人菊页点了「创建金叶详页」，随手从小P蛙动态流
 * 点进朝天委陵菜、又点进疑似高加索榉 —— 那块「正在生成金叶物种详细科普页 · 排队中」
 * 一路跟着走（秒表都不归零，01:06 → 01:53，正是「从没重新挂载过」的铁证），于是
 * 「补拍识别」和「银叶草稿」都被读成了金叶在排队。动态流本身是对的，串台的是这一页。
 */
function DraftPageRoute() {
  const { id } = Route.useParams();
  return <DraftPage key={id} />;
}

// Ordinal label for the retake counter (第一次补拍 / 第二次补拍 / 最后一次补拍).
// 3 is the last allowed retake (server forces a final result at count ≥ 3).
function retakeOrdinalLabel(count: number): string {
  if (count >= 3) return "最后一次补拍（第三次补拍）";
  return count === 1 ? "第一次补拍" : count === 2 ? "第二次补拍" : `第 ${count} 次补拍`;
}

/**
 * 分享卡「画的是哪一轮」的指纹。
 *
 * 必须按**内容**认、不能只看草稿 id：补拍会把新一轮识别**合并回同一份草稿**
 * （见 goRetake 的 `md: id`），id 一直没变，卡面内容却整个换了一个物种。
 * 任一影响卡面的字段变了 → 指纹变 → 卡要重画。
 */
function draftStamp(
  d:
    | {
        title?: string | null;
        scientific_name?: string | null;
        summary?: string | null;
        retake_count?: number | null;
        photo_url?: string | null;
        ai_payload?: { identification_confidence?: unknown } | null;
      }
    | null
    | undefined,
): string {
  if (!d) return "";
  return [
    d.title ?? "",
    d.scientific_name ?? "",
    (d.summary ?? "").slice(0, 40),
    String(d.retake_count ?? 0),
    String(d.ai_payload?.identification_confidence ?? ""),
    d.photo_url ?? "",
  ].join("|");
}

type MergePrompt = {
  conflict: true;
  target: { id: string; slug: string; title: string; scientific_name: string | null };
  whatsNew: string;
};

/** 草稿作者的公开档案（分享卡上的头像来源）。抽成独立函数是因为 useQuery **和**
 *  出卡那一刻都要用它：出卡不能只读 useQuery 的当前值，见 onMakeCard 里的说明。 */
/** 诊断意见的最短长度。**必须与 identify-plant.functions.ts 的 DIAGNOSIS_MIN 一致** ——
 *  服务端那道才是真闸门，这里只是别让编辑写完才吃报错。 */
const DIAGNOSIS_MIN = 8;

const creatorProfileKey = (uid: string) => ["profile", uid] as const;
async function fetchCreatorProfile(uid: string) {
  const { data } = await supabase
    .from("profiles")
    .select("avatar_url, display_name")
    .eq("id", uid)
    .maybeSingle();
  return data;
}

function DraftPage() {
  const { id } = Route.useParams();
  /** 从哪个标签名单点进来的（`?from=<tagSlug>`）——决定页顶那条「返回名单」出不出现。 */
  const fromTag = (Route.useSearch() as { from?: string }).from || null;
  const navigate = useNavigate();
  const qc = useQueryClient();
  // authLoading 是给自动出卡用的：整页加载时登录态要晚一拍才定下来，出卡不能抢在它前面。
  // 见下面 CARD_WAIT_MS 那一段。
  const { user, loading: authLoading } = useAuth();
  const approveFn = useServerFn(approvePlantDraft);
  const rejectFn = useServerFn(rejectPlantDraft);
  const saveDraftHtml = useServerFn(saveDraftHtmlContentFn);
  const logDraftEdit = useServerFn(logDraftEditFn);
  const askAgent = useServerFn(askDraftAgentFn);
  const applyAgentEdit = useServerFn(applyDraftAgentEditFn);
  const revertDraftEdit = useServerFn(revertDraftEditFn);
  const adoptDraftFn = useServerFn(setAdoptedFn);
  const startEnrich = useServerFn(startEnrichDraftFn);
  const lookupExisting = useServerFn(lookupSpeciesExisting);
  const markRead = useServerFn(markDraftReadFn);

  // ── 「进过详情页就算已读」（用户 2026-07-29 拍板的判据）───────────────────────
  // 判据刻意**不是**「在小P蛙里点了那张卡片」：用户真正想知道的是「这份东西我看过没有」，
  // 而看过的标志就是进过这一页 —— 从小P蛙点进来、从草稿列表点进来、直接贴 URL 进来，
  // 三条路都该算数。
  //
  // 只在 id 变化时跑一次。失败完全静默：标不上已读只是角标多显示一个数字，
  // 绝不能因此打扰用户或挡住页面。
  useEffect(() => {
    if (!user?.id || !id) return;
    void markRead({ data: { draftId: id } })
      .then((r) => {
        // 真的清掉了未读才去刷新动态流 —— 否则每进一次草稿页都白发一次请求。
        if (r?.marked) qc.invalidateQueries({ queryKey: ["task-feed"] });
      })
      .catch(() => {
        /* 动态流是锦上添花，标不上就算了 */
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, user?.id]);
  // 非空 = 金叶详页刚生成完，弹「立即查看 / 稍后查看」确认框。
  const [goldDone, setGoldDone] = useState<{ slug: string; goldRemaining: number | null } | null>(
    null,
  );
  // 非空 = 关掉分享卡后弹出的「这个物种已经有人做过了」三按钮面板。
  const [existing, setExisting] = useState<SpeciesExisting | null>(null);
  const submitForReview = useServerFn(submitDraftForReviewFn);
  const [submitting, setSubmitting] = useState(false);
  const [enriching, setEnriching] = useState(false);
  const [enrichError, setEnrichError] = useState<string | null>(null);
  // 银叶草稿的**成功**结论。原先只发一条 toast —— 用户 2026-07-31 要求去掉进度类 toast
  // （颜色进度条 + 小P蛙动态流已经把三态都显示了），成功这一条改成页内常驻，
  // 与失败那一条并排，不会一闪而过。
  const [enrichDone, setEnrichDone] = useState<string | null>(null);
  // 常驻进度：非空 = 该任务正在跑，页面上一直显示阶段文案 + 进度条 + 已用时。
  // toast 会自动消失、又挤在角落，几分钟的长任务里用户根本不知道它还在不在跑。
  type JobProg = { phase: string; progress: number; startedAt: number };
  const [enrichProg, setEnrichProg] = useState<JobProg | null>(null);
  const [goldProg, setGoldProg] = useState<JobProg | null>(null);
  // 第三条进度：**补拍识别**。它不是这一页发起的（补拍在 /identify 跑），所以没有本地
  // jobId 可轮询 —— 数据取自动态流（与小P蛙同一份 react-query 缓存，不额外发请求）。
  // 有它才补齐「绿=识别」这一色：用户从动态流点回这份草稿时，看到的是绿色的识别进度，
  // 而不是一块看不出主人的进度条。
  const taskFeed = useTaskFeed();
  const identifyRow =
    taskFeed.rows.find(
      (r) => r.kind === "identify" && r.draftId === id && r.status === "running",
    ) ?? null;
  // ── 疑似草稿的「编辑诊断意见」──────────────────────────────────────────────
  // 打开 = 编辑点了「采纳识别」而这条还是疑似结论。写满 DIAGNOSIS_MIN 字才放行；
  // 意见会随采纳一起收进条目正文，并让全站的「疑似」字样消失（服务端 approvePlantDraft）。
  const [diagOpen, setDiagOpen] = useState(false);
  const [diagText, setDiagText] = useState("");
  /** 撞上「同物种已有条目」时，合并那一步要把同一段意见再发一次。 */
  const diagnosisRef = useRef("");
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
  /** 刚刚采纳/合并成功后拿到的条目 slug —— 用来在页内给出「去看已收录条目」的去向。 */
  const [approvedSlug, setApprovedSlug] = useState<string | null>(null);
  const [cardBusy, setCardBusy] = useState(false);
  const [cardError, setCardError] = useState<string | null>(null);
  /** 「进一步科普页」那一栏是不是展开着（就地展开，不跳页）。 */
  const [inlineOpen, setInlineOpen] = useState(false);
  const [cardUrl, setCardUrl] = useState<string | null>(null);
  // 这张卡是不是「识别完自动弹出来的」（而非用户事后点按钮生成的）。决定关卡后要不要送去补拍。
  const [cardAutoOpened, setCardAutoOpened] = useState(false);
  const cardBlobRef = useRef<Blob | null>(null);
  /**
   * 出卡那一刻的**草稿快照**。卡面是一张 PNG（画完就冻住了），而卡片下面那几行字
   * 是活的 React 状态 —— 两边各读各的，就会出现用户 2026-07-30 报的那种自相矛盾：
   * 图上印着「草木樨状黄芪 · 置信度 9 颗星」，底下却写「本次结论为疑似（第三次补拍）」。
   * 成因是补拍把结果合并回**同一份草稿**，卡画完之后草稿又被新一轮识别改写了。
   * 所以：卡下面那几行一律读这份快照，与卡面同源；草稿真变了就重画（见下面的 effect）。
   */
  const [cardSnap, setCardSnap] = useState<{
    tentative: boolean;
    retakeCount: number;
    /** 画这张卡时草稿的 updated_at，用来发现「卡画完之后草稿又变了」。 */
    stamp: string;
    /** 画这张卡时用到的叶章数（铜/银/金）。等不及叶子统计就先出卡时它是空的，
     *  统计到了再据此重画一次 —— 见下面的重画 effect 与 leafKey。 */
    leavesKey: string;
    /** 画这张卡时用到的头像地址（没有就是空串）。同样是「等不到就先出卡、到了再补画」，
     *  所以出卡那一刻的头像等待被砍短了也不会真的丢掉头像。 */
    avatarKey: string;
  } | null>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const editorRef = useRef<HtmlDocEditorHandle>(null);

  const { data: draft, isLoading } = useQuery({
    queryKey: ["draft", id],
    queryFn: () => fetchDraftById(id),
    // SSR loader 已经取过一次（供分享 og:*），拿来当初值：省掉首屏再抓一次 + 空屏闪烁。
    // 读不到时 loader 回 null → 传 undefined，让 useQuery 照常用带登录态的 client 再抓一遍。
    initialData: Route.useLoaderData() ?? undefined,
    // ⚠️ 这两行是「补拍结果自己倒回去」的正面解药（2026-08-06 实库取证，见 STATE.md）。
    //
    // 这一页的数据**会在页面之外被改**：补拍是在 /identify 跑的，跑完把新一轮结果合并回
    // 同一份草稿。而全局默认是 staleTime 5min + 关掉 focus/reconnect 回查（router.tsx），
    // 再叠上 `initialData` 没有 initialDataUpdatedAt —— 不管 loader 那份快照多旧，落进
    // 缓存那一刻都被盖上「此刻新鲜」的戳。于是拿到一份快照之后，客户端 5 分钟内**一次都
    // 不回查**：A/B 实测（queryFn 里打点）——旧配置下「首屏」和「离开再返回」两处 queryFn
    // 都一次没跑过；加上下面三行之后两处都跑了。
    // ⚠️ 量它别用 Resource Timing（`performance.getEntriesByType("resource")`）：
    // supabase-js 的请求不进那张表，会得出「一个请求都没有」的假象。要在 queryFn 里打点。
    //
    // 后果不止是显示旧物种：页面上「去补拍」那个按钮的链接（retake 计数 + 物种名）就是按
    // 这份快照拼的，点下去等于拿旧结论去带偏新一轮识别 —— 库里真的会被改回去。
    //
    // 所以这一份查询单独破例：SSR/loader 的快照照常秒显（不闪空屏），但**每次挂载必回查**
    // 一次真库。代价是一条按主键读的行查询。
    staleTime: 0,
    refetchOnMount: "always",
    // 从别的 App / 标签页切回来也算「刚才可能发生过别的事」—— 补拍完锁屏、过一会儿再回到
    // 这一页，是这条链路上很常见的用法。
    refetchOnWindowFocus: true,
  });

  // Query the draft creator's profile to get their avatar
  const { data: creatorProfile } = useQuery({
    queryKey: creatorProfileKey(draft?.created_by ?? ""),
    enabled: !!draft?.created_by,
    queryFn: () => fetchCreatorProfile(draft!.created_by!),
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
  /** 卡面上印的那三个数字的指纹。空串 = 出卡时还没拿到统计。 */
  const leafKey = leaves ? `${leaves.bronze}/${leaves.silver}/${leaves.gold}` : "";

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

  /**
   * 编辑采纳这条疑似识别时写下的诊断意见（服务端 approvePlantDraft 写进 ai_payload）。
   * 有它 = 已经有人签字定种了，全站从此不再按「疑似」渲染这份草稿。
   */
  const editorDiagnosis =
    (
      draft?.ai_payload as
        | { _editor_diagnosis?: { text?: string; by_name?: string; at?: string } }
        | undefined
    )?._editor_diagnosis ?? null;

  /**
   * 「疑似」是不是已经被人签字解除，以及是谁解的（诊断意见 / 小P蛙定名复核）。
   * 可信度那张卡也要用它 —— 小P蛙复核过的 +20，见 identify-trace.ts。
   */
  const tentativeResolved = tentativeResolution(draft?.ai_payload);

  // 「疑似」单一判定：低置信度，或摘要/标题本身以「疑似」开头（模型偶尔 confidence 写
  // medium 却在正文说疑似）。标题、正文提示、分享卡、补拍激活都以它为准。
  // 已签字解除的一律不再算疑似 —— 这正是「采纳后疑似字样消除」那一条，以及「编辑已用
  // 小P蛙把定名复核改过一遍之后，采纳不必再填一遍意见」。
  const draftTentative = isDraftTentative(draft?.ai_payload, {
    title: draft?.title,
    summary: draft?.summary,
  });

  // 补拍建议：滤掉「摸一摸 / 闻一闻」这类拍不出来的条目 —— 库里的旧草稿存的还是 prompt
  // 加禁令之前的文案，照搬出来会让用户白跑一趟（他们只能回传照片）。滤空则不显示横幅。
  const retakeAdvice = keepVisualAdvice(draft?.ai_payload?.needs_more_photos_zh);

  /**
   * 简介卡上要不要摆「疑似」二字和补拍框 —— **只在快速识别简介那一档摆**。
   *
   * 银叶草稿是用户主动花一枚银叶、让 AI 通读资料写出的成篇内容，卡上再顶一个「疑似」、
   * 底下再压一个「此照片尚不足以确诊物种」的补拍框，等于自己拆自己的台：读者刚看完一整篇
   * 笃定的科普，抬头却是「其实我不确定这是什么」（2026-07-26 用户反馈）。
   * 银叶草稿要纠正物种，走的是正文下面那个「草稿内容和我的观察不符」——那里才是有依据的
   * 时机（读完全文之后）。`draftTentative` 本身不动：分享卡、铜叶计数仍按真实置信度算。
   */
  const showTentativeOnCard = draftTentative && notEnriched;

  // ── 识别过程 · 综合可信度 ────────────────────────────────────────────────
  // **必须在这里（React 卡片）渲染，不能只写进 html_content**：快速草稿的 html_content
  // 根本不上屏（下面是 `notEnriched ? null : <iframe>`），写在那里用户永远看不到 ——
  // 2026-07-21 就是这么踩空了一次，用户连报两轮「简介卡上没有可信度」。
  const identifyTrace = ((draft?.ai_payload as { _identify_trace?: IdentifyTrace } | undefined)
    ?._identify_trace ?? null) as IdentifyTrace | null;
  const finalConf = (draft?.ai_payload?.identification_confidence ?? "").toString();
  // 本功能上线前的老草稿没有痕迹字段。用户要求「无论疑似还是非疑似都要有数值」，所以
  // 兜一个只含置信档的最小痕迹：照样算得出百分比，依据里也会如实写明没有客观分。
  const traceForView: IdentifyTrace = identifyTrace ?? {
    primaryEngine: "none",
    primaryLabel: "",
    primaryPct: null,
    phase1Model: (draft?.ai_model ?? "").toString(),
    phase1Confidence: finalConf,
    review: { ran: false, reason: "本次识别早于该功能上线，没有留下过程记录" },
    retakeCount: Number(draft?.retake_count ?? 0),
  };
  // 传整份 meta（而不是只传 finalConf）：星数与「疑似」判据必须同源，
  // 否则会出现「本次结论为疑似 + 置信度 9 颗星」这种自相矛盾（见 identify-trace.ts）。
  const traceConfidence = computeIdentifyConfidence(
    traceForView,
    (draft?.scientific_name ?? "").toString(),
    {
      identification_confidence: finalConf,
      summary_zh: draft?.summary || draft?.ai_payload?.summary_zh,
      title: draft?.title,
    },
    tentativeResolved,
  );
  const traceStepList = traceSteps(traceForView);

  // 同物种在站内已有的成品（银叶草稿 / 金叶详页）。**常驻展示**，不只在关分享卡那一下弹：
  // 用户从「这张照片已识别过 → 去看已有简介卡」跳进来时，也要能顺着看到更完整的内容。
  const lookupExistingFn = useServerFn(lookupSpeciesExisting);
  const { data: speciesExisting } = useQuery({
    queryKey: ["species-existing", draft?.scientific_name, id],
    queryFn: () =>
      lookupExistingFn({
        data: { scientificName: draft?.scientific_name ?? null, excludeDraftId: id },
      }) as Promise<SpeciesExisting>,
    enabled: !!draft?.scientific_name,
    staleTime: 5 * 60_000,
  });

  // ── 草稿的 #tag 标签 ──────────────────────────────────────────────────────
  // 本地一份副本，点一下先动 UI 再落库 —— 挂标签是纯增量操作，写失败就回滚并报错，
  // 没必要为它转菊花。能改的人：草稿主人 + 编辑（与页面其它写操作同一条线，见 canEditTags）。
  // ⚠️ 必须声明在 useRegistryChips **之前**：卡签那一排读的就是这个值，读 draft.tags
  // 会让刚挂上的标签要等一次 refetch 才出现在卡签里 —— 用户点完看不到反应，会以为没存上。
  const [tagDraftLocal, setTagDraftLocal] = useState<string[] | null>(null);
  const draftTags = tagDraftLocal ?? draft?.tags ?? [];

  // ── 底部「手动添加 #tag 标签」只管**真手动标签** ────────────────────────────
  // draft.tags 里混着两拨：AI 自动识别的特征词（兰科 / 多年生 / 螺旋花序…）和人手动挑的
  // 主题标签（命中 tags 表的那些）。顶部卡签行两拨都显示（特征词无底色），但底部这个可增删的
  // 选择器**只该显示手动标签**，否则等于把 AI 特征词也铺成一排可删的 #标签（用户要求只留手动的）。
  // 复用 ["all-tags"] 这个 key —— useRegistryChips 已经在拉，这里只是订阅同一份缓存、不额外请求。
  const { data: allTagsForSplit = [] } = useQuery({
    queryKey: ["all-tags"],
    queryFn: fetchAllTags,
    staleTime: 5 * 60 * 1000,
  });
  const manualTagNames = useMemo(
    () => new Set(allTagsForSplit.map((t) => t.name)),
    [allTagsForSplit],
  );
  const manualDraftTags = useMemo(
    () => draftTags.filter((t) => manualTagNames.has(t)),
    [draftTags, manualTagNames],
  );
  const autoDraftTags = useMemo(
    () => draftTags.filter((t) => !manualTagNames.has(t)),
    [draftTags, manualTagNames],
  );

  // 重点保护 / CITES / GTS / GRIIS / 地区名录 / 主题标签 / 特征词 卡签（与详情页、分享卡同源）。
  const registryChipList = useRegistryChips({
    scientific_name: draft?.scientific_name,
    family: draft?.family,
    tags: draftTags,
  });

  // ── 重点保护物种的坐标脱敏 ────────────────────────────────────────────────
  // 这一页是从地图气泡「点进来」的那一页 —— 地图上把坐标模糊了，这里却原样印着
  // 四位小数的精确 GPS，等于把刚锁上的门开了一条缝。所以同一条规则必须在这里也生效。
  //
  // 谁能看到精确值：站长 / 资深编辑（要导出授权给科研机构、政府部门），
  // 外加**这条记录的提交者本人** —— 他人就站在那株植物旁边拍的照片，对他脱敏毫无意义。
  const protectedHere = registryChipList.some((c) => c.kind.startsWith("protected_"));
  const rolesFn = useServerFn(getMyRolesFn);
  const { data: myRoles } = useQuery({
    queryKey: ["my-roles", user?.id ?? "anon"],
    queryFn: () => rolesFn({ data: undefined }),
    enabled: !!user,
    staleTime: 5 * 60 * 1000,
  });
  const isAuthorOfDraft = !!user && !!draft?.created_by && draft.created_by === user.id;
  const hideExactCoords = protectedHere && !myRoles?.isSenior && !isAuthorOfDraft;
  /** 页面上要显示的坐标与地点：保护物种 + 无权看精确值时，这里已是脱敏后的值。 */
  const shownGeo = useMemo(() => {
    const lat = draft?.capture_lat ?? null;
    const lng = draft?.capture_lng ?? null;
    const place = draft?.capture_place ?? null;
    if (!hideExactCoords || lat == null || lng == null) return { lat, lng, place, fuzzed: false };
    const c = fuzzCoord(lat, lng, id);
    // 坐标模糊到 5 km、旁边却写着整条街道地址，等于没模糊 —— 地点一起粗化到区/县/旗。
    return { lat: c.lat, lng: c.lng, place: coarsenPlace(place) || "地点已隐去", fuzzed: true };
  }, [draft?.capture_lat, draft?.capture_lng, draft?.capture_place, hideExactCoords, id]);

  /** 分享卡上的坐标 —— 命中名录就一律模糊，不看身份（理由见 renderShareCard 调用处）。 */
  const cardGeo = useMemo(() => {
    const lat = draft?.capture_lat ?? null;
    const lng = draft?.capture_lng ?? null;
    if (!protectedHere || lat == null || lng == null) return { lat, lng, fuzzed: false };
    const c = fuzzCoord(lat, lng, id);
    return { lat: c.lat, lng: c.lng, fuzzed: true };
  }, [draft?.capture_lat, draft?.capture_lng, protectedHere, id]);

  // 「进一步生成草稿」与「金叶详页」都跑联网调研 + 长文生成，总耗时超过 Cloudflare 边缘
  // 100 秒响应上限 —— 以前是同一个前台 HTTP 请求，必被掐断（前端报 failed to fetch）。
  // 现在改为：server fn 立刻返回 jobId，服务端后台继续跑，这里每 3 秒轮询阶段进度。
  // jobId 存进 localStorage，所以刷新/关标签页/换设备回来都能接着看，不再需要
  //「请勿关闭或刷新标签页」那句提示。
  const enrichScope = `enrich:${id}`;
  const goldScope = `gold:${id}`;

  /** 轮询一个已启动的 enrich 任务直到结束，并落地 UI 反馈。 */
  const followEnrichJob = async (jobId: string) => {
    rememberJob(enrichScope, jobId);
    setEnrichProg({ phase: "正在启动生成任务…", progress: 0, startedAt: Date.now() });
    const out = await awaitJob<{ silverRemaining?: number | null }>(jobId, (phase, progress) => {
      setEnrichProg((p) => ({ phase, progress, startedAt: p?.startedAt ?? Date.now() }));
    });
    setEnrichProg(null);
    // 只有服务端给了明确结论（成功 / 明确失败）才丢掉 jobId。轮询侧自己放弃时
    // （超时、疑似卡死）**必须留着** —— 任务多半还在服务端跑，留着才能刷新接回。
    if (out.ok || out.reported) forgetJob(enrichScope);
    if (!out.ok) {
      setEnrichError(out.error); // 页内常驻，比一闪而过的提示更有用
      return;
    }
    await qc.invalidateQueries({ queryKey: ["draft", id] });
    await qc.invalidateQueries({ queryKey: ["leaves", user?.id] });
    const rem =
      out.result?.silverRemaining === null || out.result?.silverRemaining === undefined
        ? ""
        : `，剩余银叶 ${out.result.silverRemaining} 枚`;
    // 生成成功即 submitted_for_review=true（runEnrichCore 写库时就置了），所以这里把
    // 「已进待审序列」一并说清楚 —— 否则用户不知道自己还需不需要再点一次「提交审核」。
    setEnrichDone(`完整草稿已生成，自动进入待审序列${rem}`);
  };

  const onEnrich = async () => {
    if (enriching) return;
    setEnriching(true);
    setEnrichError(null);
    setEnrichDone(null);
    try {
      const res = (await startEnrich({ data: { draft_id: id } })) as {
        alreadyEnriched: boolean;
        jobId: string | null;
      };
      if (res.alreadyEnriched || !res.jobId) {
        await qc.invalidateQueries({ queryKey: ["draft", id] });
        setEnrichDone("这份草稿已经生成过完整内容了");
        return;
      }
      await followEnrichJob(res.jobId);
    } catch (e) {
      const msg =
        e instanceof Error && e.message
          ? e.message
          : "生成失败（UNKNOWN）：发生了未知错误，请重试。";
      setEnrichError(msg);
    } finally {
      setEnriching(false);
    }
  };

  // 金叶：一键创建物种详细科普页。消耗 1 枚金叶（服务端校验余额并扣减）。三段式 LLM +
  // 3 次联网调研 + 真实名录取证，耗时数分钟 —— 现在是**真正的服务端后台任务**：
  // server fn 立刻返回 jobId，生成在服务端继续，前端只负责轮询。关标签页也不会中断。
  const followGoldJob = async (jobId: string) => {
    rememberJob(goldScope, jobId);
    setGoldProg({ phase: "正在启动金叶详页生成任务…", progress: 0, startedAt: Date.now() });
    const out = await awaitJob<{ slug: string; goldRemaining: number | null }>(
      jobId,
      (phase, progress) => {
        setGoldProg((p) => ({ phase, progress, startedAt: p?.startedAt ?? Date.now() }));
      },
    );
    setGoldProg(null);
    if (out.ok || out.reported) forgetJob(goldScope);
    if (!out.ok) {
      setGoldError(out.error);
      return;
    }
    const r = out.result;
    void qc.invalidateQueries({ queryKey: ["leaves", user?.id] });
    // 成功走的是必须显式关闭的弹窗，把「立即查看 / 稍后查看」两条路摆明 ——
    // 用户等了好几分钟回来，一闪而过的提示接不住。
    setGoldDone(r);
  };

  const onCreateGoldPage = () => {
    if (goldBusy) return;
    setGoldBusy(true);
    setGoldError(null);
    setGoldConfirm(false);
    void startGoldDetailPageFn({ data: { draft_id: id, userModel: userModelArg() } })
      .then((res) => followGoldJob((res as { jobId: string }).jobId))
      .catch((e: unknown) => {
        const msg =
          e instanceof Error && e.message
            ? e.message
            : "创建失败（UNKNOWN）：发生了未知错误，请重试。";
        setGoldError(msg);
      })
      .finally(() => {
        setGoldBusy(false);
      });
  };

  // 断线续跑：进入页面时如果本地记着一个未完成的任务，就接回去继续轮询。
  // 这是「关标签页也不丢任务」真正兑现的地方 —— 任务本来就在服务端跑着。
  const resumedRef = useRef(false);
  useEffect(() => {
    if (resumedRef.current || !user) return;
    resumedRef.current = true;
    const pendingEnrich = recallJob(enrichScope);
    if (pendingEnrich) {
      setEnriching(true);
      void followEnrichJob(pendingEnrich).finally(() => setEnriching(false));
    }
    const pendingGold = recallJob(goldScope);
    if (pendingGold) {
      setGoldBusy(true);
      void followGoldJob(pendingGold).finally(() => setGoldBusy(false));
    }
    // 只在挂载后跑一次；followXxxJob 依赖的都是稳定引用（id / qc / user）。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

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
  // 第一项**恒为简介卡**：它不在 html_content 里（是 plant_drafts 的列），靠扫小标题
  // 永远扫不到它，于是「卡上的学名/摘要写错了」这类最常见的问题以前根本没法交给小P蛙
  // （2026-07-26 用户反馈）。服务端见到这个 scope 会切到「改字段」而不是「改 HTML」。
  const pageSections = useMemo(() => {
    const secs: { label: string; value: string }[] = [
      {
        // 只有简介卡的那一档：这张卡**就是**整份草稿，标签要照实说，别让人以为
        // 另有一份「全文」可选（下面还会把「整页 · 全文」那一项整个撤掉）。
        label: notEnriched
          ? `${DRAFT_CARD_SCOPE}（本草稿全部内容 · 摘要即正文）`
          : `${DRAFT_CARD_SCOPE}（名称 · 科属 · 俗名 · 摘要）`,
        value: DRAFT_CARD_SCOPE,
      },
    ];
    const html = draft?.html_content;
    // 精简摘要卡这一档：html_content 是一段**不上屏**的片段（见上面 notEnriched 那处
    // `? null :` 的注释），从里面扫出来的小标题在页面上根本找不到对应的东西 ——
    // 列出来只会诱导编辑去选一个「改了也看不见」的范围。这一档只提供简介卡。
    if (notEnriched) return secs;
    if (!html || typeof window === "undefined") return secs;
    const doc = new DOMParser().parseFromString(html, "text/html");
    const seen = new Set<string>();
    doc.querySelectorAll("h1, h2, h3").forEach((h) => {
      const t = (h.textContent || "").replace(/\s+/g, " ").trim();
      if (t && t.length <= 40 && !seen.has(t)) {
        seen.add(t);
        secs.push({ label: t, value: t });
      }
    });
    return secs.slice(0, 21);
  }, [draft?.html_content, notEnriched]);

  // 小P蛙换图方案要用的图槽清单（纯字符串扫描，不碰 DOM）。只用来在**执行之前**
  // 把「第 1 张 → Section II」翻译成人话，真正的替换在 onImagePlanApply 里重算一次。
  const imageSlots = useMemo(
    () => listSectionSlots(draft?.html_content || ""),
    [draft?.html_content],
  );

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

  /** 正名核对留痕。核对是服务端在内容生成那一刻做完的，这里只读不算。 */
  const nameStamp = useMemo(
    () => readNameStamp((draft?.ai_payload as Record<string, unknown> | null)?._name_authority),
    [draft?.ai_payload],
  );

  const [tagSaveErr, setTagSaveErr] = useState<string | null>(null);
  const canEditTags = !!user && (isEditor || leaves?.isOwner === true);

  // ── 简介卡（快速识别简介）的手动编辑 ──────────────────────────────────────
  // 卡上这几项是 plant_drafts 的**列**，不在 html_content 里 —— 所以「继续编辑 HTML」
  // 一个字也改不到它们（学名写错、摘要要改、标题上多个「疑似」都只能干看着）。
  // 这里给编辑一处直接改的地方，与小P蛙的 DRAFT_CARD_SCOPE 改的是同一批字段。
  const canEditCard = canEditTags;
  const cardFields = useMemo(
    () => pickDraftCardFields((draft ?? {}) as Record<string, unknown>),
    [draft],
  );
  const [cardEdit, setCardEdit] = useState<DraftCardFields | null>(null);
  const [cardSaving, setCardSaving] = useState(false);
  const [cardErr, setCardErr] = useState<string | null>(null);

  const onSaveCard = async () => {
    if (!cardEdit || cardSaving) return;
    const changes = diffDraftCard(cardFields, cardEdit);
    if (!changes.length) {
      setCardEdit(null);
      return;
    }
    setCardSaving(true);
    setCardErr(null);
    const { error } = await supabase.from("plant_drafts").update(cardEdit).eq("id", id);
    setCardSaving(false);
    if (error) {
      setCardErr(`简介卡没能保存：${error.message}`);
      return;
    }
    if (user)
      logDraftEdit({
        data: {
          draftId: id,
          kind: "draft_text",
          summary: `编辑修改了${DRAFT_CARD_SCOPE}：${changes.join("；")}`.slice(0, 500),
          source: "draft_editor",
        },
      }).catch(() => {});
    toast.success("简介卡已保存");
    setCardEdit(null);
    qc.invalidateQueries({ queryKey: ["draft", id] });
    qc.invalidateQueries({ queryKey: ["draft-edits", id] });
  };

  const saveDraftTags = async (next: string[]) => {
    const before = draftTags;
    setTagDraftLocal(next);
    setTagSaveErr(null);
    const { error } = await supabase.from("plant_drafts").update({ tags: next }).eq("id", id);
    if (error) {
      setTagDraftLocal(before); // 回滚，别让界面显示一个其实没存上的标签
      setTagSaveErr(`标签没能保存：${error.message}`);
      return;
    }
    void qc.invalidateQueries({ queryKey: ["draft", id] });
  };

  // 底部选择器改动的只是**手动标签**那一拨；写库时把 AI 特征词原样并回去，一个都不能丢
  // （它们还要喂顶部卡签行与搜索）。手动标签排前、特征词排后，与卡签行的先后一致。
  const saveManualDraftTags = (nextManual: string[]) =>
    saveDraftTags([...nextManual, ...autoDraftTags]);

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

  const onApprove = async (diagnosis?: string) => {
    setBusy(true);
    try {
      const res = await approveFn({ data: { draftId: id, diagnosis } });
      // 同物种已有条目 → 服务端返回 conflict（未写库），弹窗让编辑决定是否合并。
      if (res && (res as { conflict?: boolean }).conflict) {
        // 合并那一步要重发一次同样的诊断意见（服务端两条分支各写各的正文），先记下来。
        diagnosisRef.current = diagnosis ?? "";
        setMergePrompt(res as MergePrompt);
        return;
      }
      toast.success("已收录到本站");
      qc.invalidateQueries({ queryKey: ["home-all"] });
      qc.invalidateQueries({ queryKey: ["home-drafts"] });
      qc.invalidateQueries({ queryKey: ["draft", id] });
      qc.invalidateQueries({ queryKey: ["tag-membership"] });
      // 专题页（/tags/$slug）与地图共用这一份三源并集，收录会改变它 —— 一起作废。
      qc.invalidateQueries({ queryKey: ["explore-tag-index"] });
      // ⚠️ **采纳后刻意留在本页**，不再 navigate 去 /plants/$slug。
      // 原来一采纳就跳走，于是编辑眼里「简介摘要卡、可信度星、卡签、以及最重要的
      // 『使用金叶创建详页』按钮全部凭空消失，还多出一大片空白」—— 其实什么都没坏，
      // 只是被换到了另一个页面上，而那个页面本来就没有这些东西（2026-07-24 用户反馈）。
      // 采纳是**审稿动作**，不是「离开这份稿子」：编辑十有八九紧接着就要用金叶给它生成详页。
      // 收录去向改用下面那条常驻横幅给出链接，跳不跳由编辑自己决定。
      setApprovedSlug((res as { slug: string }).slug);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "收录失败");
    } finally {
      setBusy(false);
    }
  };

  // 编辑「采纳识别」= 先标记采纳（识别用户该枚识别铜叶 ×2，即 +2 效果），再审核通过并收录本站。
  //
  // ⚠️ 结论是「疑似」时**先拦一道**：必须由编辑写下诊断意见才能往下走（服务端 approvePlantDraft
  // 里有同一道闸门，那里才是真正管用的一道；这里只是把要求提前告诉人，别让他点完才吃报错）。
  const onAdoptApprove = async (diagnosis?: string) => {
    if (!user || !draft) return;
    if (draftTentative && (diagnosis ?? "").trim().length < DIAGNOSIS_MIN) {
      setDiagOpen(true);
      return;
    }
    try {
      // 采纳只有站长/资深编辑做得了（服务端闸门）。普通编辑点这个按钮时，
      // **收录照常、采纳那一笔被拒** —— 于是按钮对他就等价于「审核通过收录」。
      if (!draft.adopted) {
        await adoptDraftFn({ data: { table: "plant_drafts", id, adopted: true } });
      }
    } catch {
      /* 采纳标记失败（权限不足）不阻断收录 */
    }
    await onApprove(diagnosis);
  };

  const onConfirmMerge = async () => {
    if (!mergePrompt) return;
    setBusy(true);
    try {
      const res = await approveFn({
        data: {
          draftId: id,
          mergeTargetId: mergePrompt.target.id,
          diagnosis: diagnosisRef.current || undefined,
        },
      });
      setMergePrompt(null);
      toast.success("已合并到已有条目，并作为「补充观测」记入页尾");
      qc.invalidateQueries({ queryKey: ["home-all"] });
      qc.invalidateQueries({ queryKey: ["home-drafts"] });
      qc.invalidateQueries({ queryKey: ["draft", id] });
      qc.invalidateQueries({ queryKey: ["tag-membership"] });
      // 专题页（/tags/$slug）与地图共用这一份三源并集，收录会改变它 —— 一起作废。
      qc.invalidateQueries({ queryKey: ["explore-tag-index"] });
      // 同 onApprove：留在本页，去向用横幅给。
      setApprovedSlug((res as { slug: string }).slug);
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
    // 进度不发 toast —— 按钮自己就写着「生成中…」，失败落到 cardError 页内常驻。
    setCardError(null);
    try {
      // 头像**在出卡这一刻现取**，不能直接读 creatorProfile 的当前值：识别完这张卡是自动弹的
      // （见下方 autoCardFiredRef 那个 effect），它只等 draft + 叶子统计，profiles 那条查询
      // 常常还在飞 —— 于是同一个人有时有头像、有时是灰圆（2026-07-23 用户反馈）。
      // ensureQueryData 命中缓存就同步返回，没缓存才真发一次请求；到点拿不到就按无头像出卡
      // —— 少一个头像可以接受，卡出不来不行。
      // ⏱ 上限 2.5s → 0.9s（2026-08-08）：这一段是串在「出卡」前面的，等满就是白等那么久。
      // 砍短不会真丢头像 —— 头像后到时下面那个重画 effect 会按 avatarKey 再画一次。
      const avatarUrl = await (async (): Promise<string | null> => {
        if (creatorProfile) return creatorProfile.avatar_url || null;
        const uid = draft.created_by;
        if (!uid) return null;
        try {
          const p = await Promise.race([
            qc.ensureQueryData({
              queryKey: creatorProfileKey(uid),
              queryFn: () => fetchCreatorProfile(uid),
            }),
            new Promise<null>((r) => setTimeout(() => r(null), 900)),
          ]);
          return p?.avatar_url || null;
        } catch {
          return null;
        }
      })();
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
        // 分享卡的脱敏比页面更严：**只要命中名录就模糊**，站长、资深编辑、拍摄者本人
        // 一律如此。因为卡是拿去转发的 —— 有权看精确坐标 ≠ 有权把精确坐标发出去，
        // 而卡一旦被截图转出，就再也收不回来了。
        place: protectedHere ? coarsenPlace(draft.capture_place) || null : draft.capture_place,
        lat: cardGeo.lat,
        lng: cardGeo.lng,
        coordsFuzzed: cardGeo.fuzzed,
        summary: draft.summary || draft.ai_payload?.summary_zh,
        // 刚识别完这一次，照片的字节还在内存里（相机页跳转前留下的），直接画它 ——
        // 否则要把刚上传上去的同一张图再从云端下载一遍，而存储对象是 no-cache 的，
        // 每次都真跑一趟网络。拿不到就照常用云端地址（刷新过、或事后手动出卡）。
        photoUrl: freshPhotoUrl(id) ?? draft.photo_url,
        photoUrlFallback: draft.photo_url,
        discovererName,
        discovererAvatar: avatarUrl,
        // 名录卡签（重点保护 / 地区名录 / tag…）**故意不传给识别分享卡**：卡签是按物种匹配
        // 名录的，但一次识别只知道「这张照片里可能是什么」——在内蒙古拍到的未必是内蒙古的
        // 野生植物，可能是园艺栽培或花店里的盆栽；疑似时连物种本身都还没定。把这些标签印在
        // 一张会被转发出去的卡上，等于替用户断言了他没断言的事。草稿页/详情页仍照常显示
        // （那里有上下文，且详情页是编辑审过的）。
        // 置信度十星（画在照片右上角）。与卡签不同，这个**必须**传：卡签是替用户
        // 断言物种身份（所以不印），而星恰恰相反 —— 它标的是「这个结论有多不确定」。
        // 一张会被转发出去的卡，越是疑似越需要把把握程度一起带上。
        confidencePct: traceConfidence.pct,
        leafEarned: earned,
        leafBronze: leaves?.bronze ?? null,
        leafSilver: leaves?.silver ?? null,
        leafGold: leaves?.gold ?? null,
      });
      cardBlobRef.current = blob;
      // 把卡面所依据的那份草稿一并记下来 —— 卡下面的「本次结论为疑似 / 第几次补拍」
      // 只准读这份快照，绝不能读活状态（否则图与字会分别来自两轮识别）。
      setCardSnap({
        tentative,
        retakeCount,
        stamp: draftStamp(draft),
        leavesKey: leafKey,
        avatarKey: avatarUrl ?? "",
      });
      setCardUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return URL.createObjectURL(blob);
      });
      // 成功不必再说 —— 卡片当场就渲染出来了。
    } catch (e) {
      if (!opts?.silent) setCardError(e instanceof Error ? e.message : "生成分享卡失败");
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
   *  那时候把人拽走是耍流氓（他也未必找得回来）。
   *
   *  ⚠️ 判据一律取 `cardSnap`（出卡那一刻的快照），不取活状态：卡面是冻住的 PNG，
   *  底下这行字要和它说同一件事。没有快照（卡还没画完）时才退回活状态。 */
  const cardTentative = cardSnap?.tentative ?? draftTentative;
  const cardRetakeCount = cardSnap?.retakeCount ?? retakeCount;
  const jumpToRetakeOnClose = cardAutoOpened && cardTentative && cardRetakeCount < 3;

  /** 分享卡底部那一行放几个按钮：保存/分享 + 关闭 恒有，疑似多一个「去补拍」，未登录多一个
   *  「登录/注册」。全部挤在**同一行**（第二行会被手机浏览器地址栏压住，点不到），所以按数量
   *  逐档让位。两个阈值都是在 375px 上量出来的，不是拍脑袋：
   *   · ≥3 个 → 每个约 96px，px-3 + 图标 + 间距先吃掉 46px，只剩 50px 装 5 个字（需 60px），
   *     「保存/分享」会被 truncate 成「保存/…」。**收掉图标**后剩 72px，正好放得下。
   *   · ≥4 个 → 每个约 71px，还得把字号降到 text-xs、内边距降到 px-1.5。 */
  const cardActionCount = 2 + (jumpToRetakeOnClose ? 1 : 0) + (user ? 0 : 1);
  const cardActionIcons = cardActionCount <= 2;
  const cardActionsTight = cardActionCount >= 4;

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
    setCardSnap(null);
  };

  /** 关掉分享卡后，若这个物种已经有人做过，先把现成的推给用户 —— 别让他白花一枚银叶
   *  再等好几分钟生成一份重复的。只在**非疑似**时提：疑似连物种都还没定，谈不上「重复」，
   *  那条路归补拍关卡管。查库失败/没命中就静默跳过，绝不挡正常流程。 */
  const offerExistingWork = async () => {
    const sci = draft?.scientific_name;
    if (!sci) return;
    try {
      const found = (await lookupExisting({
        data: { scientificName: sci, excludeDraftId: id },
      })) as SpeciesExisting;
      // **快速简介卡不算「已经有人做过了」**：每次识别都会落一条，拿它弹面板等于天天打扰。
      // 只有银叶科普 / 金叶详页 / skill 详页才值得拦一下——那才是能替用户省下一枚银叶的东西。
      // （常驻那一栏仍然把绿色的快速卡列出来，两处门槛不同是有意的。）
      if (found.items.some((i) => i.kind !== "quick")) setExisting(found);
    } catch {
      /* 锦上添花的功能，查不到就当没有 */
    }
  };

  const closeCard = () => {
    const jump = jumpToRetakeOnClose;
    // 只认「识别完自动弹出来的那张卡」，与补拍关卡同一个判据：用户事后自己点「生成分享卡」
    // 时再弹一次推荐面板是打扰。
    const offer = cardAutoOpened && !draftTentative && notEnriched;
    closeCardOnly();
    // 疑似 → 不把人丢在草稿页上让他自己找「去补拍」，直接进补拍界面（建议 + 两种补拍方式）。
    if (jump) {
      goRetake();
      return;
    }
    if (offer) void offerExistingWork();
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
      // 编辑器里给空槽换上真图后，那句「暂无该物种的…公开照片」必须一起摘掉。
      // 保存这一刻做一次，库里的正文就是干净的（收录发布时照抄的正是它）。
      const newHtml = stripStaleMissingNotes(await response.text());

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

  // Trigger the in-place HTML editor's save. 编辑器本身已经没有保存按钮了 ——
  // 这个顶栏按钮就是草稿正文唯一的提交入口。
  const onSaveEdits = async () => {
    if (!editorRef.current) return;
    setSavingEdits(true);
    try {
      // 成功的提示由 handleHtmlSaved 落库后发（"草稿已成功保存并更新"），这里只补
      // 「压根没改动」这一种它覆盖不到的情况，避免同一次点击弹两条。
      if (!(await editorRef.current.save())) toast.info("正文没有改动，无需保存");
    } catch (err) {
      toast.error("保存失败：" + (err as Error).message);
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
  //
  // ⏱ 出卡前要等两件事，但**两件都不许死等**，共用下面这一个上限。
  //
  // ① 登录态（authLoading）。整页加载时 AuthProvider 是在 effect 里恢复会话的，而子组件的
  //    effect 比父组件先跑 —— 也就是说**首帧这里的 `user` 必然是 null**。不等它就出卡，
  //    卡面会按访客画：三个叶章数是空的。而这条路最常走的恰恰是
  //    「访客点卡上的登录 → 登录后回来领铜叶」：login.tsx 用的是 `window.location.href`
  //    （整页重载），所以每次都会踩中，用户登录后看到的还是一张没有叶章数的卡。
  //
  // ② 叶子统计（leaves）。原来是死等（`if (user && !leaves) return`），于是：
  //    · computeLeaves 是 7 条并发查询（其中一条拉该用户全部草稿行），慢网上就是白等；
  //    · 它要是**失败**了，React Query 默认重试 3 次（约 7 秒退避）后 leaves 永远是
  //      undefined —— 那个 return 就永久生效，卡**再也不弹**。用户 2026-08-06 报的
  //      「有时候停在已完成界面很久、不弹分享卡」就是这两条。
  //
  // 到点还没齐就先把卡画出来，数字后到再重画一次（见下面按 leavesKey 重画的 effect）。
  //
  // ⚠️ 两件事的上限**不一样**，这是 2026-08-08 拆开的：
  //  · 登录态（AUTH_WAIT_MS）值得多等 —— 抢在它前面出的是一张「访客版」卡，三个叶章数
  //    整个是空的，差别很大；而它在有缓存会话时下一拍就定了，2 秒的上限几乎碰不到。
  //  · 叶子统计（LEAVES_WAIT_MS）不值得等满 —— 从 /identify 跳过来时这条查询**必然是冷的**
  //    （全站只有本页在用 ["leaves"]），于是那 2 秒每次都要老老实实等掉，而缺的只是卡角上
  //    的三个数字，统计一到下面的 effect 立刻重画一次就补上了。用户报的「深度分析完成后
  //    很久才出分享卡」，这是最后一段。
  const AUTH_WAIT_MS = 2000;
  const LEAVES_WAIT_MS = 500;
  const [authWaitOver, setAuthWaitOver] = useState(false);
  const [leavesWaitOver, setLeavesWaitOver] = useState(false);
  useEffect(() => {
    const a = setTimeout(() => setAuthWaitOver(true), AUTH_WAIT_MS);
    const l = setTimeout(() => setLeavesWaitOver(true), LEAVES_WAIT_MS);
    return () => {
      clearTimeout(a);
      clearTimeout(l);
    };
  }, []);
  const autoCardFiredRef = useRef(false);
  useEffect(() => {
    if (autoCardFiredRef.current || !draft) return;
    const flag =
      typeof sessionStorage !== "undefined"
        ? sessionStorage.getItem("plantspedia:justIdentified")
        : null;
    if (flag !== id) return;
    if (authLoading && !authWaitOver) return; // 等登录态定下来（否则卡上缺叶章数）
    if (user && !leaves && !leavesWaitOver) return; // 再等叶子统计（等不到就先出卡，后到再重画）
    autoCardFiredRef.current = true;
    sessionStorage.removeItem("plantspedia:justIdentified");
    setCardAutoOpened(true);
    void onMakeCard({ silent: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft, leaves, authWaitOver, leavesWaitOver, authLoading, user, id]);

  /**
   * 卡还开着，草稿却变了 → 立刻按新数据重画。
   *
   * 补拍是把新一轮识别**合并回同一份草稿**的，草稿页可能在补拍任务还没跑完时就已经
   * 挂上了（从动态流点回来、或轮询接回），这时自动弹的那张卡画的是**上一轮**的物种。
   * 任务一收尾草稿被刷新，卡面就与页面上其余部分对不上了 —— 用户 2026-07-30 看到的
   * 「卡上 9 颗星的草木樨状黄芪 + 底下写着疑似、第三次补拍」正是这个。
   */
  // 叶章数、头像同理：为了尽快出卡，可能是在它们还没到的时候画的（卡上那三个数字会缺、
  // 头像是个灰圆）。谁先到就补画一次，卡面与页面其余部分才对得上。
  useEffect(() => {
    if (!cardUrl || cardBusy || !draft || !cardSnap) return;
    const avatarKey = creatorProfile?.avatar_url || "";
    if (
      draftStamp(draft) === cardSnap.stamp &&
      leafKey === cardSnap.leavesKey &&
      avatarKey === cardSnap.avatarKey
    )
      return;
    void onMakeCard({ silent: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft, cardUrl, cardBusy, cardSnap, leafKey, creatorProfile?.avatar_url]);

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
                {/* 从标签名单点进来的，先给一条回名单的路（读者多半要接着看下一条）。 */}
                {fromTag && (
                  <BackToTagLink from={fromTag} className="label text-emerald-700 hover:text-vermilion" />
                )}
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
                        onClick={() => onAdoptApprove()}
                        disabled={busy}
                        title={
                          draftTentative
                            ? "这条是「疑似」结论：点击后需先填写诊断意见，才能采纳并收录"
                            : "审核通过并收录本站 · 识别用户该枚识别铜叶 ×2（+2 枚铜叶）"
                        }
                        className="bg-ink text-background px-4 py-1.5 text-xs hover:bg-vermilion transition-colors disabled:opacity-60 cursor-pointer inline-flex items-center gap-1.5 font-semibold"
                      >
                        <LeafIcon tier="bronze" size={13} />
                        <span>
                          {busy ? "处理中…" : draftTentative ? "采纳识别（需诊断意见）" : "采纳识别"}
                        </span>
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
                        {draftTentative && (
                          <b className="text-vermilion">
                            {" "}
                            本条为「疑似」：须先填写诊断意见，采纳后该意见收进条目正文、「疑似」字样消除。
                          </b>
                        )}
                      </span>
                    </>
                  )}
                  {/* 采纳/合并成功后的去向。以前这里是「直接 navigate 走人」，编辑因此以为
                      简介卡、可信度、金叶按钮全丢了 —— 现在留在原地，去哪儿由他自己点。 */}
                  {approvedSlug && (
                    <span className="inline-flex items-center gap-2 text-[11px] text-leaf-deep w-full sm:w-auto">
                      ✅ 已收录到本站。
                      <Link
                        to="/plants/$slug"
                        params={{ slug: approvedSlug }}
                        className="underline underline-offset-2 hover:text-vermilion font-semibold"
                      >
                        查看已收录条目 →
                      </Link>
                      <span className="text-ink-faint">
                        （本页内容保持不变，可继续用下方金叶按钮生成详细科普页）
                      </span>
                    </span>
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
                  {cardError && (
                    <span className="text-[11px] text-destructive">
                      分享卡生成失败：{cardError}
                    </span>
                  )}
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
                      {/* 简介卡是「快速识别简介」这一档的全部内容，也是银叶草稿的门面。
                          它的字段不在 html_content 里，所以这里单独给编辑一个入口；
                          小P蛙那边选「讨论范围 = 快速识别简介卡」改的是同一批字段。 */}
                      {canEditCard && (
                        <div className="flex justify-end mb-1.5">
                          <button
                            onClick={() => {
                              setCardErr(null);
                              setCardEdit((c) => (c ? null : cardFields));
                            }}
                            className="inline-flex items-center gap-1 text-[11px] border border-leaf-deep/50 text-leaf-deep px-2.5 py-1 rounded-full hover:bg-leaf-deep hover:text-background transition-colors cursor-pointer"
                          >
                            <EditIcon className="w-3 h-3" />
                            {cardEdit ? "退出简介卡编辑" : "编辑简介卡内容"}
                          </button>
                        </div>
                      )}
                      {cardEdit && (
                        <DraftCardEditor
                          value={cardEdit}
                          onChange={setCardEdit}
                          onSave={onSaveCard}
                          onCancel={() => {
                            setCardEdit(null);
                            setCardErr(null);
                          }}
                          saving={cardSaving}
                          error={cardErr}
                        />
                      )}
                      {/* 科属信息（小字，在中文名上方） */}
                      {(draft.family || draft.genus) && (
                        <p className="text-xs text-leaf-deep font-semibold mb-1.5">
                          {[draft.family, draft.genus].filter(Boolean).join(" · ")}
                        </p>
                      )}
                      <h1 className="font-display text-2xl md:text-3xl font-bold leading-tight">
                        {/* 库里存的标题**本身**可能已经带「疑似」（draftTitleFor 写的），
                            所以两条分支都要先剥干净再决定加不加，否则银叶草稿的卡上仍会
                            露出一个「疑似」。 */}
                        {showTentativeOnCard
                          ? `疑似${stripTentativeMarks(draft.title || "")}`
                          : stripTentativeMarks(draft.title || "")}
                      </h1>
                      {draft.scientific_name && (
                        <p className="italic text-ink-faint mt-1">{draft.scientific_name}</p>
                      )}
                      {/* 正名核对结论：改过名的一定要说改了什么，否则一次错误的
                          自动改写（fuzzy 那条路会错）没人看得出来。 */}
                      <NameAuthorityNote stamp={nameStamp} className="mt-2" />
                      {registryChipList.length > 0 && (
                        <RegistryChips chips={registryChipList} className="mt-2.5" />
                      )}
                      {/* 编辑诊断意见 —— 疑似草稿被采纳时留下的那段签字。
                          必须在这里用 React 画一份：快速识别档的 html_content **不上屏**
                          （下面是 `notEnriched ? null : <iframe>`），只写进正文的话，
                          这一档的用户永远看不到它（识别过程那一栏当年就踩过同一个坑）。 */}
                      {editorDiagnosis?.text && (
                        <div className="mt-3 rounded-xl border-l-4 border border-leaf-deep/45 bg-leaf-deep/[0.06] px-4 py-3">
                          <p className="text-sm font-semibold text-leaf-deep">编辑诊断意见</p>
                          <p className="mt-1.5 text-sm text-ink-soft leading-relaxed whitespace-pre-line">
                            {editorDiagnosis.text}
                          </p>
                          <p className="mt-2 text-[11px] text-ink-faint">
                            —— {editorDiagnosis.by_name || "编辑"} ·{" "}
                            {(editorDiagnosis.at || "").slice(0, 10)} 复核采纳。本条目的定种以此
                            意见为准；下方「识别过程」栏保留 AI 初判的原始记录。
                          </p>
                        </div>
                      )}
                      {/* 小P蛙定名复核 —— 编辑在**采纳之前**就把这一条的定名改定了，「疑似」
                          就此解除。与上面那段诊断意见同理，必须在这里用 React 画：快速识别档
                          的 html_content 不上屏。不写出来，页面上就只是「疑似两个字凭空消失」，
                          谁在什么时候凭什么定的一概看不出来 —— 那正是这个项目一贯不允许的。 */}
                      {!editorDiagnosis?.text && tentativeResolved?.kind === "xiaop_fix" && (
                        <div className="mt-3 rounded-xl border border-leaf-deep/35 bg-leaf-deep/[0.05] px-4 py-2.5">
                          <p className="text-[13px] leading-relaxed text-ink-soft">
                            <span className="font-semibold text-leaf-deep">定名已复核</span>
                            {" —— "}
                            {tentativeResolved.byName || "编辑"}
                            {tentativeResolved.at ? ` · ${tentativeResolved.at.slice(0, 10)}` : ""}
                            {" 用小P蛙改定了本条的定名，AI 初判的「疑似」就此解除"}
                            （综合可信度 +20，依据见下方「识别过程」栏）。采纳收录时不再要求另填诊断意见。
                          </p>
                        </div>
                      )}
                      {/* #3 定种存疑提示：与标题同源（showTentativeOnCard）。一旦补拍升出疑似
                       （medium/high 且正文不再以「疑似」开头），或用户已用银叶生成完整草稿，
                       疑似字样与这个补拍框都消失。 */}
                      {showTentativeOnCard && retakeAdvice && (
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
                            <span>{shownGeo.place || "未知地点"}</span>
                            {shownGeo.lat != null && shownGeo.lng != null && (
                              <span
                                className="text-xs"
                                style={
                                  shownGeo.fuzzed
                                    ? { color: FUZZ_ORANGE, fontWeight: 600 }
                                    : undefined
                                }
                                title={shownGeo.fuzzed ? FUZZ_EXPLAIN : undefined}
                              >
                                ({formatCoordPair(shownGeo.lat, shownGeo.lng, shownGeo.fuzzed)})
                                {shownGeo.fuzzed && FUZZ_SUFFIX}
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
                      {/* 这里原本把 draft.tags 原样铺成一排 `#盐生植物 #多年生草本 …` ——
                          与学名下面那排自动识别出的特征词**是同一批内容**，同屏重复，
                          而且什么都点不了。改成只能从已建标签里挑的选择器（见 TagPicker）。 */}
                      <div className="mt-4">
                        <TagPicker
                          compact
                          value={manualDraftTags}
                          disabled={!canEditTags}
                          onChange={saveManualDraftTags}
                        />
                        {tagSaveErr && (
                          <p className="mt-1.5 text-xs text-vermilion">{tagSaveErr}</p>
                        )}
                      </div>
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

            {/* 识别过程 · 综合可信度 —— 紧跟简介摘要卡。无论疑似还是非疑似都显示：用户要的是
                「引擎到底给了多少分」，而不是只有一个『疑似』二字。老草稿没有痕迹字段时用
                最小痕迹兜底（依据里会写明没有客观分），保证这里永远有一个数。 */}
            {!isEditing && (
              <section className="mx-auto max-w-5xl px-6 mt-3">
                <div className="border border-rule rounded-lg bg-paper-deep/40 p-3">
                  <p className="text-[13px] font-bold text-leaf-deep mb-1.5">
                    识别过程 · 综合可信度 {traceConfidence.pct}%
                  </p>
                  {/* 十星打分紧跟在百分比下面。星给感觉、百分比给精度、下面那行给理由 ——
                      用户看到 45% 时第一反应是「这算高还是低」，十颗星里亮 5 颗就答完了。
                      与分享卡上照片右上角那组星**同一个取整规则**（confidenceStars）。 */}
                  <ConfidenceStars pct={traceConfidence.pct} className="mb-2" />
                  <ol className="text-[12px] text-ink-soft leading-relaxed list-decimal pl-5 space-y-0.5">
                    {traceStepList.map((s, i) => (
                      <li key={i}>
                        <span className="font-semibold">{s.label}</span>：{s.value}
                      </li>
                    ))}
                  </ol>
                  <p className="text-[11px] text-ink-faint mt-1.5">
                    可信度依据：{traceConfidence.basis}
                  </p>
                </div>
              </section>
            )}

            {/* 同物种站内已有的成品 —— 常驻在简介卡下方。与已收录条目页**共用同一个组件**，
                见 components/species-existing-links.tsx：绿=快速简介卡、蓝=银叶科普、
                橙=金叶/skill 详页；只有未收录的银叶草稿是就地展开，其余跳页。 */}
            {!isEditing && (
              <SpeciesExistingLinks
                existing={speciesExisting}
                fallbackTitle={draft?.title}
                className="mx-auto max-w-5xl px-6 mt-3"
                open={inlineOpen}
                onOpenChange={setInlineOpen}
              />
            )}

            {/* 生成任务的常驻进度面板。**刻意放在这里而不是各自按钮旁边**：按钮所在的分支会
                随 notEnriched / 余额 / 编辑态切换而消失，进度面板一旦跟着藏起来，用户就又回到
                「等了几分钟不知道还在不在跑」的老问题。这里是两种草稿状态下都稳定可见的位置。 */}
            {identifyRow && (
              <section className="mx-auto max-w-5xl px-6 mt-4">
                <JobProgressPanel
                  kind="identify"
                  // 补拍是这一页最常见的来源，但首识别的动态流行也会短暂带上 draftId ——
                  // 那时候说「补拍」就是假的，所以按 retake_count 分开写。
                  title={retakeCount > 0 ? "正在重新识别这株植物（补拍）" : "正在识别这株植物"}
                  subject={draft?.title}
                  phase={identifyRow.phase}
                  progress={identifyRow.progress}
                  // 动态流行没有本地起始时刻，用它的建行时间 —— 那正是任务真正开始排队的时刻。
                  startedAt={Date.parse(identifyRow.createdAt) || Date.now()}
                />
              </section>
            )}
            {enrichProg && (
              <section className="mx-auto max-w-5xl px-6 mt-4">
                <JobProgressPanel
                  kind="enrich_draft"
                  title="正在生成进一步介绍草稿"
                  subject={draft?.title}
                  phase={enrichProg.phase}
                  progress={enrichProg.progress}
                  startedAt={enrichProg.startedAt}
                />
              </section>
            )}
            {goldProg && (
              <section className="mx-auto max-w-5xl px-6 mt-4">
                <JobProgressPanel
                  kind="gold_page"
                  title="正在生成金叶物种详细科普页"
                  subject={draft?.title}
                  phase={goldProg.phase}
                  progress={goldProg.progress}
                  startedAt={goldProg.startedAt}
                />
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

            {/* Phase-1 → Phase-2: a lite summary-card draft offers a button to
                generate the full multi-image draft on demand (saves tokens + time
                until the user actually wants the deep write-up). */}
            {notEnriched && !isEditing && (
              <section className="mx-auto max-w-5xl px-6 mt-6">
                <div className="border border-leaf/40 bg-leaf/5 rounded-xl p-5 md:p-6 text-center">
                  <p className="text-sm text-ink-soft leading-relaxed">
                    以上是 AI 快速生成的<strong>简介摘要卡</strong>。点击下方按钮，AI
                    会撰写含名称和分类趣闻、形态特征、
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
                    生成在服务器后台进行（约 1–3 分钟，可关闭或刷新本页）。
                    <strong>完成后自动进入待审批草稿库。</strong>
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
                  {enrichDone && (
                    <div className="mt-3 text-left rounded-lg border border-leaf/50 bg-leaf/10 px-3 py-2.5 flex items-start gap-2">
                      <p className="flex-1 text-xs text-leaf-deep leading-relaxed">{enrichDone}</p>
                      <button
                        onClick={() => setEnrichDone(null)}
                        className="shrink-0 text-[11px] text-ink-faint hover:text-ink cursor-pointer"
                        title="知道了"
                      >
                        ✕
                      </button>
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
                />
              </div>
            ) : notEnriched /* 精简摘要卡草稿：正文与上方「简介摘要卡」重复，故不再重复渲染
                 （配图已移入摘要卡右侧）。点「让 AI 生成进一步介绍草稿」后才有完整正文。 */ ? null : (
              /* 正文 iframe 与上方各卡片**同宽**：本页所有分区都是 `mx-auto max-w-5xl px-6`，
                 而 iframe 原先是裸的 w-full，于是详页连同它自己的纸底背景在电脑上一路铺满
                 整个窗口，跟上面窄窄一列卡片对不齐（2026-07-23 用户反馈）。
                 手机上仍保持通栏（sm 以下不加 px-6）—— 那里本来就不足 max-w-5xl，
                 再削掉左右 24px 只会让正文更挤。 */
              <div className="mx-auto w-full max-w-5xl sm:px-6 mt-6">
                <iframe
                  ref={iframeRef}
                  title={draft.title}
                  srcDoc={enhanceDraftHtmlForViewing(draft.html_content)}
                  sandbox="allow-scripts allow-popups"
                  scrolling="no"
                  className="w-full border-0 block"
                  // ⚠️ `minHeight` **只在还没量到真实高度时**才给 —— 它是加载期的占位，
                  // 不是版面下限。以前无条件写死 550px：正文一旦比它矮（精简草稿、图片全裂、
                  // 或内容被编辑删短），iframe 仍撑满 550px，下面就裂出一大片谁也解释不了的空白，
                  // 而且它正好卡在正文和「使用金叶创建」按钮之间（2026-07-24 用户反馈）。
                  // 量到了就完全交给量出来的值，一像素都不额外撑。
                  style={
                    draftHeight
                      ? { height: `${draftHeight}px` }
                      : { height: "80vh", minHeight: "550px" }
                  }
                />
              </div>
            )}

            {/* 完整草稿的岔路口：只有在用户点过「让 AI 生成进一步介绍草稿」、AI 写出成篇内容
                之后才出现（notEnriched=false）。不受「疑似」限制 —— AI 说得笃定却认错物种，
                恰恰最该让用户纠正。补拍上限 3 次与上方补拍横幅同源。
                ⚠️ 位置有讲究，两条都是踩过的坑：
                ① **不能加 `!submittedForReview`**：runEnrichCore 写库时就置了
                   submitted_for_review=true，那个条件会让按钮在生成完成的同一刻自己藏掉。
                ② **必须放在正文 iframe 之后**：判断「AI 是不是认错了」的前提是读完正文，
                   而正文很长；早先放在正文**上方**，用户读完时它已在几屏之外，等于不存在
                   （2026-07-21/22 用户连续两轮反馈「没有这个按钮」，实为看不到）。 */}
            {!notEnriched && !isEditing && (
              <section className="mx-auto max-w-5xl px-6 mt-6">
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
                    读完上面的完整草稿，觉得 AI 认错了物种？点这个按钮去补拍——可以现拍，
                    也可以从相册选已有照片（{retakeOrdinalLabel(retakeCount + 1)}）。
                  </p>
                )}

                {/* 「不符」的反面 —— **只给编辑看**：普通用户点「符合我的观察」只是表个态，
                    而收录与否是审稿权。编辑读完全文点它 = 采纳识别（识别人该枚铜叶 ×2）
                    + 审核通过收录，与顶部「采纳识别」是同一条服务端路径（onAdoptApprove），
                    只是摆在读完正文之后 —— 那才是能下判断的位置。 */}
                {isEditor && (
                  <div className="mt-4 flex flex-col items-center gap-2">
                    {draft.status === "approved" ? (
                      <span className="inline-flex items-center gap-2 border-2 border-leaf-deep/40 text-leaf-deep px-8 py-3 text-base font-bold rounded-full bg-leaf/10">
                        <CheckIcon className="w-5 h-5" />
                        已采纳并收录为条目
                      </span>
                    ) : (
                      <button
                        onClick={() => onAdoptApprove()}
                        disabled={busy}
                        title="确认草稿内容与你的实地观察一致 → 采纳识别并收录为已收录条目（识别人 +2 枚铜叶）"
                        className="inline-flex items-center gap-2 border-2 border-leaf-deep bg-leaf-deep/10 text-leaf-deep px-8 py-3 text-base font-bold rounded-full hover:bg-leaf-deep hover:text-background transition-colors disabled:opacity-60 cursor-pointer"
                      >
                        <CheckIcon className="w-5 h-5" />
                        {busy ? "处理中…" : "草稿内容符合我的观察"}
                      </button>
                    )}
                    <p className="text-center text-[11px] text-ink-faint">
                      {draft.status === "approved" ? (
                        <>
                          这份草稿已进入已收录条目。
                          {approvedSlug && (
                            <Link
                              to="/plants/$slug"
                              params={{ slug: approvedSlug }}
                              className="ml-1 underline underline-offset-2 hover:text-vermilion font-semibold text-leaf-deep"
                            >
                              查看条目 →
                            </Link>
                          )}
                        </>
                      ) : (
                        <>
                          仅编辑可见。点击即<strong>采纳</strong>这份草稿并将其收录为已收录条目
                          （识别人该枚识别铜叶 ×2）。
                          {draftTentative && (
                            <b className="text-vermilion">
                              {" "}
                              本条 AI 结论为「疑似」，点击后需先填写诊断意见。
                            </b>
                          )}
                        </>
                      )}
                    </p>
                  </div>
                )}
              </section>
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
                // 只有简介卡的草稿：默认就选中那张卡，并且**不给**「整页 · 全文」这一项 ——
                // 这一档没有正文，选「整页」既指不到东西，又让服务端只能替编辑猜意图。
                defaultScope={notEnriched ? DRAFT_CARD_SCOPE : ""}
                allScopeLabel={notEnriched ? null : "整页 · 全文"}
                imageSlots={imageSlots}
                ask={async (question, history, scope, refPhotoCount) => {
                  const res = (await askAgent({
                    data: {
                      draftId: id,
                      question,
                      scope,
                      history,
                      refPhotoCount,
                      userModel: userModelArg(),
                    },
                  })) as {
                    reply: string;
                    canEdit: boolean;
                    editInstruction: string;
                  };
                  return res;
                }}
                apply={async (instruction, scope) => {
                  const before = draft.html_content;
                  const res = (await applyAgentEdit({
                    data: { draftId: id, instruction, scope, userModel: userModelArg() },
                  })) as {
                    html?: string;
                    card?: { changes: string[] };
                  };
                  // 简介卡是**字段**改动：服务端已经写库了（不经过 html_content），
                  // 这里只补一条修改记录 + 刷新页面数据。
                  if (res.card) {
                    logDraftEdit({
                      data: {
                        draftId: id,
                        kind: "draft_text",
                        summary:
                          `小P蛙改写（${DRAFT_CARD_SCOPE}）：${res.card.changes.join("；")}`.slice(
                            0,
                            500,
                          ),
                        source: "xiaop_agent",
                      },
                    }).catch(() => {});
                    qc.invalidateQueries({ queryKey: ["draft", id] });
                    qc.invalidateQueries({ queryKey: ["draft-edits", id] });
                    return;
                  }
                  const html = res.html ?? "";
                  if (!html) throw new Error("小P蛙没有返回可保存的内容，请重试。");
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
                onImagePlanApply={async (plan: ImagePlanItem[], photos: PlanPhoto[]) => {
                  const before = draft.html_content || "";
                  if (!before) throw new Error("这份草稿还没有正文，无从换图。");
                  const res = applyImagePlan(before, plan, photos);
                  const { changes, skipped } = res;
                  // 草稿模板的空槽旁边挂着一句「暂无该物种的…公开照片」。填上图之后那句话
                  // 就成了「图旁边写着没有图」——三条换图路径共用这个清理（见 draft-enhance.ts）。
                  const html = stripStaleMissingNotes(res.html);
                  const reasons = skipped.map((s) => s.reason);
                  // 一处都没换成就别写库 —— 存一份一模一样的 HTML、再记一条「换了 0 处」，
                  // 只会在修改记录里留一条没法撤销也没意义的流水。
                  if (!changes.length) return { changed: 0, skipped: reasons };
                  await saveDraftHtml({ data: { draftId: id, html } });
                  logDraftEdit({
                    data: {
                      draftId: id,
                      kind: "draft_image",
                      summary: `小P蛙按方案换图（${changes.length} 处）：${summarizeChanges(changes)}`.slice(
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
                  return { changed: changes.length, skipped: reasons };
                }}
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

      {/* ── 疑似草稿的采纳闸门：先写诊断意见 ──────────────────────────────────
          为什么要拦：AI 说「疑似」= 它没定下来种。这样一条如果一点按钮就进了正式档案，
          档案里就多了一条**没有任何人为它背书**的物种记录。所以采纳这一步改成：编辑
          写下据以定种的依据（看到了什么特征、和哪个近似种怎么区分），意见随条目一起
          发布进正文，条目上的「疑似」字样也在这一刻消除。 */}
      {diagOpen && (
        <div
          className="fixed inset-0 z-[75] bg-black/60 flex items-center justify-center p-4"
          onClick={() => !busy && setDiagOpen(false)}
        >
          <div
            className="bg-background border border-ink shadow-xl w-full max-w-lg p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="label text-vermilion mb-1">采纳前请填写诊断意见</h3>
            <p className="text-sm text-ink-soft mb-3 leading-relaxed">
              这份草稿的 AI 结论是
              <strong className="text-vermilion">「疑似</strong>
              <strong className="text-vermilion">
                {(draft?.title || "").replace(/^\s*（?\s*疑似\s*）?/, "")}」
              </strong>
              。请写明你据以定种的依据（看到了哪些特征、与哪些近似种如何区分）。
              这段意见会作为
              <strong>「编辑诊断意见」</strong>
              收录进条目正文，采纳后条目上的「疑似」字样一并消除。
            </p>
            <textarea
              value={diagText}
              onChange={(e) => setDiagText(e.target.value)}
              rows={5}
              autoFocus
              placeholder="例：叶背密被白色星状毛、萼筒无腺点，与同属的 XX 区分明确，可定为本种。"
              className="w-full border border-rule bg-paper-deep/20 px-3 py-2 text-sm leading-relaxed focus:outline-none focus:border-ink resize-y"
            />
            <p className="text-[11px] text-ink-faint mt-1">
              至少 {DIAGNOSIS_MIN} 字（当前 {diagText.trim().length} 字）。
              意见连同你的署名与日期一起写进正文，可在条目页「修改记录」里追溯。
            </p>
            <div className="flex flex-wrap justify-end gap-2 mt-4">
              <button
                onClick={() => setDiagOpen(false)}
                disabled={busy}
                className="border border-rule text-ink-faint px-4 py-2 text-sm hover:border-ink hover:text-ink transition-colors cursor-pointer disabled:opacity-60"
              >
                取消
              </button>
              <button
                onClick={async () => {
                  const text = diagText.trim();
                  if (text.length < DIAGNOSIS_MIN) return;
                  setDiagOpen(false);
                  await onAdoptApprove(text);
                }}
                disabled={busy || diagText.trim().length < DIAGNOSIS_MIN}
                className="bg-ink text-background px-4 py-2 text-sm font-semibold hover:bg-vermilion transition-colors cursor-pointer disabled:opacity-40"
              >
                {busy ? "处理中…" : "确认诊断并采纳"}
              </button>
            </div>
          </div>
        </div>
      )}

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
              亲爱的金叶编辑，详细页面生成<strong>等待时间较长</strong>（数分钟），且将
              <strong>消耗数百万 token</strong>；
              创建后建议您回到电脑上做详细校对，再收录到本站档案中。
            </p>
            <p className="text-[12px] text-ink-faint mb-4 leading-relaxed">
              生成在<strong>服务器后台</strong>进行：你可以关闭或刷新本页，甚至换台设备，
              回到这份草稿时会自动接着显示进度。
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
      {/* 金叶详页生成完成 —— 必须显式关闭的弹窗，而不是会自己消失的 toast。
          等待长达数分钟，用户多半切走做别的了，回来时 toast 早没了 → 「说是生成好了，
          结果不知道去哪看」。这里把结果去向摆明，并且「立即查看」直接跳到详页开头。 */}
      {goldDone && (
        <div
          className="fixed inset-0 z-[90] bg-black/70 flex items-center justify-center p-4"
          onClick={() => setGoldDone(null)}
        >
          <div
            className="bg-background border border-ink shadow-xl w-full max-w-sm p-5"
            onClick={(e) => e.stopPropagation()}
          >
            <p className="font-display text-xl font-bold text-amber-700 mb-1">🏅 金叶详页已创建</p>
            <p className="text-[12px] text-ink-soft leading-relaxed mb-4">
              「{draft?.title || draft?.scientific_name}」的物种详细科普页已生成并收录。剩余金叶{" "}
              {goldDone.goldRemaining === null ? "∞（管理员无限）" : `${goldDone.goldRemaining} 枚`}
              。
            </p>
            <div className="flex flex-col gap-2">
              <button
                onClick={() => {
                  const slug = goldDone.slug;
                  setGoldDone(null);
                  // 整页跳转而非 SPA 内跳：详页有自己的服务端渲染与脚本，
                  // 整页加载能保证用户落在页面**开头**从头浏览。
                  window.location.assign(`/plants/${slug}`);
                }}
                className="w-full bg-amber-600 text-background px-4 py-2.5 text-sm font-semibold hover:bg-amber-700 transition-colors cursor-pointer rounded-sm"
              >
                立即查看
              </button>
              <button
                onClick={() => setGoldDone(null)}
                className="w-full border border-rule text-ink-soft px-4 py-2.5 text-sm hover:border-ink hover:text-ink transition-colors cursor-pointer rounded-sm"
              >
                稍后查看
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 「这个物种已经有人做过了」——关掉分享卡后弹出（仅非疑似 + 本草稿尚未生成正文）。
          目的很直接：库里已有现成内容时，先推给用户，别让他白花一枚银叶等几分钟生成重复的。
          去向平铺，最后那个「仍然生成」始终保留 —— 推荐归推荐，不能剥夺「我就是要自己生成」。 */}
      {existing && (
        <div
          className="fixed inset-0 z-[80] bg-black/70 flex items-center justify-center p-4"
          onClick={() => setExisting(null)}
        >
          <div
            className="bg-background border border-ink shadow-xl w-full max-w-sm p-4"
            onClick={(e) => e.stopPropagation()}
          >
            <p className="label text-leaf-deep mb-1">站内已有这个物种的内容</p>
            <p className="text-[11px] text-ink-faint mb-3 leading-relaxed">
              本次识别为
              <strong className="text-ink">{draft?.title || draft?.scientific_name}</strong>
              （非疑似）。已经有现成内容可以直接看，不必再花一枚银叶等几分钟。
            </p>
            <div className="flex flex-col gap-2">
              {/* 颜色与文案跟常驻那一栏同一套（SPECIES_EXISTING_STYLE），两处不能各说各话。 */}
              {existing.items.map((item) => {
                const inline = item.kind === "silver" && !!item.draftId;
                return (
                  <button
                    key={item.kind}
                    onClick={() => {
                      setExisting(null);
                      // 未收录的银叶草稿：**不跳页**，就地展开在快速识别简介下面。
                      if (inline) setInlineOpen(true);
                      else if (item.draftId)
                        navigate({ to: "/drafts/$id", params: { id: item.draftId } });
                      else navigate({ to: "/plants/$slug", params: { slug: item.slug! } });
                    }}
                    className={`w-full border px-4 py-2.5 text-sm font-semibold transition-colors cursor-pointer rounded-sm text-left ${SPECIES_EXISTING_STYLE[item.kind].cls}`}
                  >
                    {speciesExistingLabel(item, draft?.title)}
                    {speciesExistingCountSuffix(item)}
                    <span className="block text-[11px] font-normal opacity-70">
                      {/* 这个弹窗只推**一份**现成的（目的就是止住那一枚银叶），所以有好几份时
                          得把话说明白 —— 否则标题写着「共 2 份」、点了只到一份，又是对不上。
                          要逐份挑，关掉弹窗后在下方常驻那一栏点开列表。 */}
                      {item.count > 1
                        ? "先带你看最新的一份 · 其余在下方那一栏点开"
                        : inline
                          ? "点击就在本页展开，不会跳走"
                          : "点击跳转到该页"}
                    </span>
                  </button>
                );
              })}
              <button
                onClick={() => {
                  setExisting(null);
                  if (!user) onLoginToEarn();
                  else void onEnrich();
                }}
                className="w-full border border-rule text-ink-soft px-4 py-2.5 text-sm hover:border-ink hover:text-ink transition-colors cursor-pointer rounded-sm text-left"
              >
                {user ? "仍然消耗 1 枚银叶，生成进一步介绍草稿" : "登录后生成进一步介绍草稿"}
                <span className="block text-[11px] opacity-70">需等待几分钟</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {cardUrl && (
        <div
          className="fixed inset-0 z-[80] bg-black/70 flex items-center justify-center p-4"
          onClick={closeCard}
        >
          <div
            /* max-h + overflow：手机浏览器地址栏会吃掉视口底部，卡片太高时按钮会被顶到
               地址栏底下点不着。用 dvh（跟着地址栏收放变化的视口高度）留出余量。 */
            className="bg-background border border-ink shadow-xl w-full max-w-sm p-4 flex flex-col items-center max-h-[92dvh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <p className="label text-leaf-deep mb-3 self-start">识别分享卡</p>
            <img
              src={cardUrl}
              alt="识别分享卡预览"
              className="w-full h-auto border border-rule rounded-md shadow-sm"
            />
            <p className="text-[11px] text-ink-faint mt-2 text-center leading-relaxed">
              手机上点「保存/分享」会调起系统面板，选「存储图像」即可存入相册，也可直接发到
              微信、小红书；长按上图同样能保存。分享出去的<strong>只有这张图片</strong>，不带链接。
            </p>
            {/* 疑似：三个去向都摆在下面同一行，各自一个颜色 —— 不用再猜「关闭」会把人送去哪。 */}
            {jumpToRetakeOnClose && (
              <p className="text-[11px] text-amber-700 mt-2 text-center leading-relaxed font-medium">
                本次结论为<strong>疑似</strong>，点「去补拍」会进入补拍界面（
                {retakeOrdinalLabel(cardRetakeCount + 1)}
                ）；点「关闭」则放弃补拍，直接看简介摘要卡。
              </p>
            )}
            {/* 「登录/注册」挪进按钮行后只剩四个字，为什么值得登录得由这行字来说。 */}
            {!user && (
              <p className="text-[11px] text-leaf-deep mt-2 text-center leading-relaxed font-medium">
                登录 / 注册后，每次识别都会为你<strong>积累叶片</strong>。
              </p>
            )}
            {/* 所有去向平铺在**同一行**、各给一个颜色，比「一个主按钮 + 底下再垫一行」更容易
                一眼选中想要的那个；更要紧的是**未登录时也只占一行** —— 第二行会被手机浏览器
                底部的地址栏压住，用户点不到（2026-07-23 用户反馈）。
                补拍是建议、不是强制 —— 「关闭」就是那条明确的退出路径。
                按钮一多就先收图标、再缩字号（阈值见 cardActionIcons / cardActionsTight），
                宁可朴素也不换行。 */}
            <div className="flex gap-2 mt-3 w-full">
              <button
                onClick={onShareCard}
                className={`flex-1 min-w-0 bg-leaf-deep text-background py-2.5 font-semibold hover:bg-leaf transition-colors inline-flex items-center justify-center gap-1.5 cursor-pointer rounded-sm ${
                  cardActionsTight ? "px-1.5 text-xs" : "px-3 text-sm"
                }`}
              >
                {cardActionIcons && <ShareIcon className="w-4 h-4 shrink-0" />}
                <span className="truncate">保存/分享</span>
              </button>
              {jumpToRetakeOnClose && (
                <button
                  onClick={closeCard}
                  className={`flex-1 min-w-0 bg-amber-600 text-background py-2.5 font-semibold hover:bg-amber-500 transition-colors inline-flex items-center justify-center gap-1.5 cursor-pointer rounded-sm ${
                    cardActionsTight ? "px-1.5 text-xs" : "px-3 text-sm"
                  }`}
                >
                  {cardActionIcons && <CameraIcon className="w-4 h-4 shrink-0" />}
                  <span className="truncate">去补拍</span>
                </button>
              )}
              <button
                onClick={jumpToRetakeOnClose ? closeCardOnly : closeCard}
                className={`flex-1 min-w-0 border border-rule text-ink-faint py-2.5 font-semibold hover:border-ink hover:text-ink transition-colors cursor-pointer rounded-sm ${
                  cardActionsTight ? "px-1.5 text-xs" : "px-3 text-sm"
                }`}
              >
                关闭
              </button>
              {/* Guests: log in / register to start banking leaves. Returns to this card. */}
              {!user && (
                <button
                  onClick={onLoginToEarn}
                  className={`flex-1 min-w-0 border border-leaf-deep/60 text-leaf-deep py-2.5 font-semibold hover:bg-leaf-deep hover:text-background transition-colors inline-flex items-center justify-center cursor-pointer rounded-sm ${
                    cardActionsTight ? "px-1.5 text-xs" : "px-3 text-sm"
                  }`}
                >
                  <span className="truncate">登录/注册</span>
                </button>
              )}
            </div>
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

/**
 * 简介卡字段编辑器（编辑 / 管理员可见）。
 *
 * 为什么单独有这么一处：卡上的中文名、学名、俗名、科属、摘要都是 plant_drafts 的**列**，
 * 而「继续编辑 HTML」编辑的是 html_content —— 两者互不相干，所以在这块内容上，编辑以前
 * 是完全没有着力点的（只能求小P蛙，而小P蛙那时也只会重写 HTML）。
 * 字段清单与小P蛙的 DRAFT_CARD_SCOPE 完全同源（见 lib/draft-card-fields.ts），两条路不会跑偏。
 */
function DraftCardEditor({
  value,
  onChange,
  onSave,
  onCancel,
  saving,
  error,
}: {
  value: DraftCardFields;
  onChange: (next: DraftCardFields) => void;
  onSave: () => void;
  onCancel: () => void;
  saving: boolean;
  error: string | null;
}) {
  const inputCls =
    "mt-1 w-full text-sm bg-background border border-rule/70 rounded-md px-2.5 py-1.5 outline-none focus:border-leaf";
  return (
    <div className="mb-4 border border-leaf-deep/40 bg-leaf/5 rounded-lg p-3.5">
      <p className="text-[11px] font-bold text-leaf-deep mb-2.5">
        正在编辑{DRAFT_CARD_SCOPE} · 改完点「保存简介卡」
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {DRAFT_CARD_FIELD_KEYS.map((k) => {
          const long = DRAFT_CARD_LONG_FIELDS.includes(k);
          return (
            <label key={k} className={long ? "sm:col-span-2 block" : "block"}>
              <span className="label text-[10px] text-ink-faint">{DRAFT_CARD_FIELD_LABELS[k]}</span>
              {long ? (
                <textarea
                  rows={5}
                  value={value[k]}
                  onChange={(e) => onChange({ ...value, [k]: e.target.value })}
                  className={`${inputCls} leading-relaxed resize-y`}
                />
              ) : (
                <input
                  value={value[k]}
                  onChange={(e) => onChange({ ...value, [k]: e.target.value })}
                  className={inputCls}
                />
              )}
            </label>
          );
        })}
      </div>
      {error && <p className="mt-2 text-xs text-vermilion">{error}</p>}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          onClick={onSave}
          disabled={saving}
          className="bg-leaf-deep text-background px-4 py-1.5 text-xs font-semibold rounded-sm hover:bg-leaf transition-colors disabled:opacity-60 cursor-pointer"
        >
          {saving ? "保存中…" : "保存简介卡"}
        </button>
        <button
          onClick={onCancel}
          disabled={saving}
          className="border border-rule text-ink-faint px-4 py-1.5 text-xs rounded-sm hover:border-ink hover:text-ink transition-colors disabled:opacity-60 cursor-pointer"
        >
          取消
        </button>
        <span className="text-[10px] text-ink-faint">
          中文名里若还留着「疑似」，直接删掉即可 —— 卡上的标题读的就是这个字段。
        </span>
      </div>
    </div>
  );
}

function CheckIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}
