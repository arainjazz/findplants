import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  getModelQueueFn,
  saveModelQueueFn,
  clearModelQueueFn,
  listProviderModelsFn,
  getQueueBalancesFn,
  probeSlotVisionFn,
} from "@/lib/identify-plant.functions";
import {
  normalizeBaseUrl,
  visionOf,
  looksReasoningModel,
  defaultThinking,
  thinkingOf,
  type ModelProvider,
  type ModelSlot,
  type ThinkingMode,
} from "@/lib/model-queue";
import { visionBadge } from "@/lib/vision-probe";
import { checkKeyHealthFn, type KeyHealth } from "@/lib/key-health.functions";

/**
 * 「优先调用序列」控制台 —— AI 模型 / 疑似复核 / 小P蛙 三处共用。
 *
 * 每个序列项都是一套**完整自洽**的配置（厂商 + 单个 key + Base URL + 模型）。
 * 序列 1 是一线，失败（额度用尽 / key 无效 / 服务端故障）自动顺位给 2、3…。
 * 一个 key 只跟自己的厂商绑定 —— 以前那种「一池 key 混着多家厂商」的 401 从结构上没了。
 */

/**
 * 单个序列项的「视觉自检」行 —— 视觉链路（出卡 / 疑似复核 / 草稿生成）专用。
 *
 * 为什么值得单独一块 UI：2026-07-20 给出卡配的备胎 `deepseek-v4-flash` 看不见图，却返回
 * HTTP 200 并**编造了一个物种**。这种失败不报错、不触发顺位、日志里也看不出来 ——
 * 唯一能提前发现它的办法就是主动测一次，并把结论**记在这一项上**，让运行时能跳过它。
 */
function VisionProbeRow({
  consoleId,
  index,
  slot,
}: {
  consoleId: ConsoleId;
  index: number;
  slot: ModelSlot;
}) {
  const qc = useQueryClient();
  const probeFn = useServerFn(probeSlotVisionFn);
  const [result, setResult] = useState<{ verdict: string; note: string } | null>(null);

  // 存档结论只在**模型没被改过**时才作数（visionOf 的判据），改了模型就回到「未检测」。
  const stored = visionOf(slot);
  const shown = result ?? (stored ? { verdict: stored.verdict, note: stored.note } : null);
  const badge = visionBadge(shown?.verdict as never);

  const probe = useMutation({
    mutationFn: () => probeFn({ data: { consoleId, index } }),
    onSuccess: (r: { verdict: string; note: string }) => {
      setResult({ verdict: r.verdict, note: r.note });
      qc.invalidateQueries({ queryKey: ["model-queue", consoleId] });
      if (r.verdict === "pass") toast.success(`序列 ${index + 1}：确认能读图`);
      else if (r.verdict === "blind")
        toast.error(`序列 ${index + 1}：该模型看不见图片，已标记并将在视觉链路上跳过`, {
          duration: 8000,
        });
      else toast.warning(`序列 ${index + 1}：这次没测出结论（见说明）`, { duration: 8000 });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const healthFn = useServerFn(checkKeyHealthFn);
  const [healthMsg, setHealthMsg] = useState<KeyHealth | null>(null);
  const health = useMutation({
    mutationFn: () =>
      healthFn({
        data: {
          target: "openai-compat" as const,
          apiKey: slot.apiKey.trim(),
          baseUrl: slot.baseUrl.trim(),
          model: slot.model.trim() || undefined,
          provider: slot.provider,
        },
      }) as Promise<KeyHealth>,
    onSuccess: (r) => {
      setHealthMsg(r);
      if (r.ok) toast.success(`序列 ${index + 1}：${r.detail}`);
      else toast.error(`序列 ${index + 1}：${r.detail}`, { duration: 9000 });
    },
    onError: (e: Error) =>
      setHealthMsg({ ok: false, detail: e.message, remaining: null, limit: null }),
  });

  const tone =
    badge.tone === "ok"
      ? "text-emerald-700 border-emerald-600/40 bg-emerald-600/5"
      : badge.tone === "bad"
        ? "text-destructive border-destructive/40 bg-destructive/5"
        : "text-ink-faint border-rule";

  return (
    <div className="mt-1.5 pt-1.5 border-t border-rule/50">
      <div className="flex items-center gap-2 flex-wrap">
        <span className={`text-[10px] px-1.5 py-0.5 rounded-sm border ${tone}`}>{badge.text}</span>
        <button
          onClick={() => probe.mutate()}
          disabled={probe.isPending || !slot.model.trim() || !slot.apiKey.trim()}
          className="text-[10px] border border-rule px-2 py-0.5 rounded-sm hover:border-ink transition-colors cursor-pointer disabled:opacity-40"
          title="给这个模型发一张四象限纯色图，看它能否说出四个方块的颜色；同时比对带图/不带图的 prompt_tokens"
        >
          {probe.isPending ? "检测中…" : "视觉自检"}
        </button>
        {/* 与「视觉自检」分工明确：那个测「能不能看图」（要发一张真图、消耗 token）；
            这个只测「key 通不通、是不是正在被限流」，走 GET /models，不产生 token 费用。
            key 失效和模型看不见图是两种完全不同的故障，混在一个按钮里会误判。 */}
        <button
          onClick={() => health.mutate()}
          // 只要求 apiKey：**gemini / anthropic 用官方地址时 baseUrl 本来就是 ""**
          // （见 model-queue.ts 的 ModelSlot.baseUrl 注释），以前把 baseUrl 也列为必填，
          // 导致 Gemini 那几项的按钮永远是灰的（用户 2026-07-22 反馈「颜色不一样」）。
          disabled={health.isPending || !slot.apiKey.trim()}
          className="text-[10px] border border-rule px-2 py-0.5 rounded-sm hover:border-ink transition-colors cursor-pointer disabled:opacity-40"
          title="用 GET /models 测这个 Key 通不通、是否正在被限流（不消耗 token）"
        >
          {health.isPending ? "检测中…" : "连通体检"}
        </button>
        {stored?.at && !result && (
          <span className="text-[10px] text-ink-faint">
            {new Date(stored.at).toLocaleString("zh-CN")}
          </span>
        )}
      </div>
      {shown?.note && (
        <p className="text-[10px] text-ink-faint leading-relaxed mt-1">{shown.note}</p>
      )}
      {healthMsg && (
        <p
          className={`text-[10px] leading-relaxed mt-1 ${
            healthMsg.ok ? "text-emerald-700" : "text-destructive"
          }`}
        >
          {healthMsg.ok ? "✅ " : "❌ "}
          {healthMsg.detail}
        </p>
      )}
      {!shown && (
        <p className="text-[10px] text-ink-faint leading-relaxed mt-1">
          这条链路要把照片喂给模型。<b>没测过的项照常使用</b>；一旦测出「不读图」，
          运行时会自动跳过它 —— 那种模型会凭空编造物种且不报错。
        </p>
      )}
    </div>
  );
}

type ProviderMeta = {
  id: ModelProvider;
  label: string;
  icon: string;
  needsBaseUrl: boolean;
  defaultBase: string;
  defaultModel: string;
  models: string[];
};

const PROVIDERS: ProviderMeta[] = [
  {
    id: "gemini",
    label: "Google Gemini",
    icon: "🔵",
    needsBaseUrl: false,
    defaultBase: "",
    defaultModel: "gemini-3-flash-preview",
    models: ["gemini-3-flash-preview", "gemini-3-pro-preview"],
  },
  {
    id: "openai",
    label: "OpenAI / 中转",
    icon: "🟢",
    needsBaseUrl: true,
    defaultBase: "https://api.openai.com/v1",
    defaultModel: "gpt-4o",
    models: ["gpt-4o", "gpt-4o-mini"],
  },
  {
    id: "anthropic",
    label: "Anthropic Claude",
    icon: "🟤",
    needsBaseUrl: false,
    defaultBase: "",
    defaultModel: "claude-sonnet-5",
    models: ["claude-sonnet-5", "claude-opus-4-8", "claude-haiku-4-5-20251001"],
  },
  {
    id: "custom",
    label: "自定义接口",
    icon: "⚙️",
    needsBaseUrl: true,
    defaultBase: "",
    defaultModel: "",
    models: [],
  },
];

const metaOf = (p: ModelProvider) => PROVIDERS.find((x) => x.id === p) ?? PROVIDERS[0];

const emptySlot = (): ModelSlot => ({
  provider: "gemini",
  apiKey: "",
  baseUrl: "",
  model: "gemini-3-flash-preview",
});

// 与 identify-plant.functions.ts 的 CONSOLE_CONFIG_KEYS / ConsoleIdSchema 保持一致。
export type ConsoleId = "ai" | "card" | "enrich" | "second_opinion" | "xiaop" | "gold" | "organ";

/**
 * 每个控制台**该配什么样的模型**。
 *
 * 为什么必须写在界面上：这几个控制台长得一模一样，可它们对模型的要求天差地别 ——
 * 有的必须能读图，有的只要快，有的要能写长文。2026-07-26 线上就吃过亏：小P蛙序列 1
 * 配了纯文本的 `qwen3.7-max`，而当时小P蛙**还兼着配图器官识别**（要看图），于是带图调用
 * 一路 400，全站配图跟着归零；管理员从界面上完全看不出这里需要视觉模型。
 * （器官识别已于 2026-07-28 拆成独立控制台，但「界面要说清这里该配什么」这条教训通用。）
 *
 * `needs` 是硬要求，`jobs` 逐条列出**这个模型到底干哪些活**，`why` 说明为什么，
 * `avoid` 是常见的配错。
 *
 * `jobs` 是 2026-07-29 新增的：光说「该配能读图的模型」还不够 —— 管理员真正需要知道的是
 * 「我改这一项，会影响站上的哪些功能」。控制台名字（「出卡AI」「小P蛙」）根本传达不了
 * 这件事，而配错的代价是整条功能静默失效。
 */
const CONSOLE_ADVICE: Record<
  ConsoleId,
  {
    needs: React.ReactNode;
    /** 这个模型负责的**每一件**具体工作。改这里之前先看它影响什么。 */
    jobs: string[];
    why: React.ReactNode;
    avoid: React.ReactNode;
    thinkingWhy: string;
  }
> = {
  ai: {
    needs: "快速响应的纯文本模型",
    jobs: [
      "管理后台「批量添加条目」：从粘贴的 HTML 里提取物种元数据",
      "任何其它控制台**留空时**的最终兜底",
    ],
    why: "只做两件机械活：批量导入时从 HTML 里抠元数据、以及其它控制台没配时的兜底。不看图。",
    avoid: "不必用贵的多模态大模型；推理模型在这里纯属拖时间。",
    thinkingWhy: "机械提取，思维链无增益 → 默认关。",
  },
  card: {
    needs: "能读图的多模态模型，且要快",
    jobs: [
      "拍照识别：看图定种，写出物种名、学名、置信度",
      "写「快速识别简介」摘要卡的全部文字",
      "写分享卡上的文案",
      "补拍复核时重新看图给结论",
      "「配图器官识别」留空时顶上（两者画像一致：能读图 + 要快）",
    ],
    why: "拍照后当场看图写简介摘要卡 / 分享卡。整条识别卡在 Cloudflare 边缘 100 秒上限里。",
    avoid: "纯文本模型会直接失效（看不见图还会凭空编一个物种，且返回 200，顺位机制救不了）。",
    thinkingWhy: "实时路径、预算紧 → 默认关。",
  },
  enrich: {
    needs: "能读图、擅长长文的多模态模型",
    jobs: [
      "点「进一步生成草稿」后：写整份中英双语科普正文（银叶草稿）",
      "生成前的联网调研",
      "「金叶详页模型」留空时顶上",
    ],
    why: "写整份中英双语科普草稿，是全站最复杂的一次生成。跑在队列消费者的 15 分钟挂钟里，慢一点没关系。",
    avoid: "小快模型写出来的正文会明显偏薄。",
    thinkingWhy: "唯一真正吃思维链的链路，且不赶时间 → 默认开。",
  },
  second_opinion: {
    jobs: [
      "识别判「疑似」时：独立再看一眼图，给出物种与置信档位",
      "Pl@ntNet 拿不到结果 / 额度用尽时：直接顶替它做一线定种",
      "识别页「引擎自检」里被测的三条链路之一",
    ],
    needs: (
      <>
        能读图的多模态模型，<b>必须快</b>
      </>
    ),
    why: "识别判「疑似」时再看一眼图给个物种和档位；同时在 Pl@ntNet 拿不到结果时顶一线。整条只有几十秒预算。",
    avoid:
      "推理模型是这里的头号杀手：2026-07-26 线上 qwen3.7-plus 28 秒没返回，复核直接判为「未运行」。要用就选它的 non-thinking / turbo 版本。",
    thinkingWhy: "超时重灾区，思维链对「报个物种」几乎无增益 → 默认关。",
  },
  gold: {
    needs: "能写长文的强模型（能读图更好）",
    jobs: [
      "金叶详页：三轮联网调研（形态生境 / 人文民俗 / 生态科研）",
      "金叶详页：三轮长文撰稿（正文主体 / 人文应用 / 生态延伸）",
      "按「金叶详页创作指导」的章法组织全篇",
    ],
    why: (
      <>
        写整份<b>公开档案页</b>——三轮联网调研 + 三段长文，全站最重的一次生成。跑在队列消费者的 15
        分钟挂钟里，慢一点没关系。
      </>
    ),
    avoid:
      "别配为「跟手」调的快模型：金叶正文会明显偏薄，而且容易在三轮撰稿中途被截断（报 GOLD_BAD_JSON）。留空则自动借用「草稿生成模型」的配置。",
    thinkingWhy:
      "默认关（2026-07-30 从「开」改过来的）。挂钟够，但**中转的网关时限不够**：" +
      "实测 kimi-k3 开着思维链写第一轮正文，两三分钟不吐字节，中转直接判源站超时 → " +
      "每次都停在「正在撰稿 1/3」+ HTTP 524。这种失败没有救法（重试一样慢、改流式也没用，" +
      "因为思维链阶段不产生输出）。要开可以手动开，但配的必须是不经中转、或时限很宽的模型。",
  },
  organ: {
    needs: "能读图的多模态模型，要快要便宜",
    jobs: [
      "银叶草稿：判断每张候选配图展示的是花/叶/果/植株/生境/标本",
      "金叶详页：同上（9 个图槽的分配全依赖这一步）",
      "顺带判断每张图「可不可用」（滤掉人、建筑、水印、糊片）",
    ],
    why: (
      <>
        判断每张候选配图<b>展示的是花/叶/果/植株/生境</b>——银叶和金叶的分区能不能配上图，
        全看这一步。它只需要吐一个 JSON 数组，是纯机械活。
      </>
    ),
    avoid: (
      <>
        <b>纯文本模型会让全站配图直接归零</b>：认不出器官 = 标签为空 = 一张也进不了槽，
        而且它不报错、只在日志里留一行。这正是 2026-07-26 那次「银叶/金叶没有新增配图」的成因
        （当时它还挂在小P蛙序列上，配了纯文本的 qwen3.7-max）。留空则自动借用「出卡AI」。
      </>
    ),
    thinkingWhy: "机械打标签，思维链纯拖时间 → 默认关。",
  },
  xiaop: {
    needs: "能读图的多模态模型",
    jobs: [
      "小P蛙对话框里的所有问答",
      "按用户要求改写草稿 / 条目正文",
      "带图提问（「这张配图对不对」「图里是什么部位」）",
    ],
    why: (
      <>
        只管<b>交互式问答与改稿</b>。原先挂在这里的两件事已经拆走：金叶详页归「金叶详页模型」、
        配图器官识别归「配图器官识别模型」—— 它们和问答的诉求完全不同，共用必然互相拖累。
      </>
    ),
    avoid: (
      <>
        配纯文本模型会让<b>带图提问</b>失效（问某张配图、复核详页插图）。另外：中转若拒收图片， 可能
        <b>悄悄去掉图重发</b> —— 模型一张图没看见，却照样答得头头是道。
      </>
    ),
    thinkingWhy: "交互问答要跟手，等模型想半分钟没人受得了 → 默认关。",
  },
};

/**
 * 存储适配器。管理员的三个控制台存 site_config（走 server fn）；用户自己的
 * 小P蛙配置存浏览器 localStorage。除了存哪儿，两者的交互完全一样，所以把存储
 * 抽出来，界面只有一份。
 */
export type QueueStorage = {
  load: () => ModelSlot[];
  save: (sequence: ModelSlot[]) => void;
  clear: () => void;
};

/**
 * 一项的推理（思维链）开关。
 *
 * 三态而不是勾选框：「跟随默认」必须和「管理员明确选了和默认一样的值」区分开 ——
 * 否则以后调整某个控制台的默认值，所有老配置都会僵在旧默认上。
 *
 * ⚠️ 开关**永远显示**，不是只在「检测到推理模型」时才出现。因为 looksReasoningModel()
 * 只是按名字猜的启发式，而模型名从来不是能力契约（`qwen3.7-max` 听着像旗舰推理模型，
 * 实际是个纯文本模型）。猜中了就多给一句提示，猜不中也不挡管理员自己选。
 */
function ThinkingRow({
  consoleId,
  slot,
  onChange,
}: {
  consoleId: ConsoleId;
  slot: ModelSlot;
  onChange: (t: ThinkingMode | undefined) => void;
}) {
  const fallback = defaultThinking(consoleId);
  const effective = thinkingOf(slot, consoleId);
  const suspected = looksReasoningModel(slot.model);

  return (
    <div className="rounded-sm border border-rule/60 bg-paper/40 px-2 py-1.5 space-y-1">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-[11px] font-semibold">推理模式（思维链）</span>
        <select
          value={slot.thinking ?? ""}
          onChange={(e) => onChange((e.target.value || undefined) as ThinkingMode | undefined)}
          className="border border-rule rounded-sm px-1.5 py-1 text-[11px] bg-background cursor-pointer"
        >
          <option value="">跟随本控制台默认（{fallback === "on" ? "开" : "关"}）</option>
          <option value="off">强制关闭 —— 直接作答，最快</option>
          <option value="on">强制开启 —— 先想再答，更慢</option>
        </select>
        <span
          className={`text-[10px] px-1.5 py-0.5 rounded-full ${
            effective === "on" ? "bg-amber-500/15 text-amber-700" : "bg-leaf/15 text-leaf-deep"
          }`}
        >
          当前：{effective === "on" ? "开" : "关"}
        </span>
      </div>
      {suspected && effective === "on" && (
        <p className="text-[10px] text-amber-700 leading-relaxed">
          ⚠️「{slot.model}」看着像<b>推理模型</b>。它会先写一大段思维链再作答，一次调用常要 40
          秒以上 —— 若这条链路有超时预算，建议改成「强制关闭」，或换成该模型的 non-thinking / turbo
          版本。
        </p>
      )}
      <p className="text-[10px] text-ink-faint leading-relaxed">
        两档<b>都会真的发参数</b>，不是「建议」：OpenAI 兼容路发 enable_thinking / reasoning_effort
        / thinking 三种写法（不认的那个会被自动摘掉）；Gemini 发 thinkingConfig；Anthropic 发
        thinking。<b>三条路都已接通</b>—— 2026-07-30 之前只有 OpenAI 兼容那条认这个开关，配 Gemini
        或 Anthropic 时它是死的， 而「开」也只是「什么都不发、随模型默认」。
        <br />
        注意两件事：<b>Gemini 3 没有「完全不思考」这一档</b>，「关」对它是把强度压到最低；
        <b>部分模型（如 qwen3.8-max）思考不可关闭</b>，这时只能换模型。
      </p>
    </div>
  );
}

export function ModelQueueConsole({
  consoleId,
  storage,
  title,
  titleIcon,
  intro,
  openLabel = "配置后台 AI 模型",
  clearLabel = "恢复 .env 默认",
  defaultOpen = false,
  visionProbe = false,
  onSaved,
}: {
  /** 管理员控制台：存 site_config。与 storage 二选一。 */
  consoleId?: ConsoleId;
  /** 本地存储（用户自带 key）。与 consoleId 二选一。 */
  storage?: QueueStorage;
  title: string;
  titleIcon?: React.ReactNode;
  intro?: React.ReactNode;
  openLabel?: string;
  clearLabel?: string;
  defaultOpen?: boolean;
  /** 这条链路要给模型看图 → 每项显示「视觉自检」。只对管理员控制台（consoleId）有效。 */
  visionProbe?: boolean;
  onSaved?: (sequence: ModelSlot[]) => void;
}) {
  const qc = useQueryClient();
  const [isOpen, setIsOpen] = useState(defaultOpen);
  const [sequence, setSequence] = useState<ModelSlot[]>([emptySlot()]);
  const [showKeys, setShowKeys] = useState(false);
  // 每个序列项各自的「拉取可用模型」结果 —— 不同厂商的模型清单不能串。
  const [fetchedModels, setFetchedModels] = useState<Record<number, string[]>>({});
  const [fetchingAt, setFetchingAt] = useState<number | null>(null);

  const getFn = useServerFn(getModelQueueFn);
  const saveFn = useServerFn(saveModelQueueFn);
  const clearFn = useServerFn(clearModelQueueFn);
  const listFn = useServerFn(listProviderModelsFn);
  const balanceFn = useServerFn(getQueueBalancesFn);

  const queryKey = ["model-queue", consoleId ?? "local"];
  const { data: saved } = useQuery({
    queryKey,
    queryFn: async (): Promise<{ sequence: ModelSlot[] }> =>
      storage ? { sequence: storage.load() } : await getFn({ data: { consoleId: consoleId! } }),
    retry: false,
  });

  // 余额只有部分厂商能查（Moonshot 有接口，Gemini/Anthropic 没有）。查不到就如实标注，
  // 绝不用估算冒充 —— 编出来的余额比没有余额更容易误导人。
  const {
    data: balances,
    refetch: refetchBalances,
    isFetching: balLoading,
  } = useQuery({
    queryKey: ["model-queue-balance", consoleId],
    queryFn: () => balanceFn({ data: { consoleId: consoleId! } }),
    enabled: !!consoleId && !!saved?.sequence?.length,
    staleTime: 60_000,
    retry: false,
  });

  // 首次拿到已存配置就灌进表单（含从旧「逗号 key 池」自动折算出来的多个序列项）。
  const seeded = useRef(false);
  useEffect(() => {
    if (seeded.current || !saved) return;
    seeded.current = true;
    if (saved.sequence?.length) setSequence(saved.sequence);
  }, [saved]);

  const patch = (i: number, next: Partial<ModelSlot>) =>
    setSequence((prev) => prev.map((s, idx) => (idx === i ? { ...s, ...next } : s)));

  const changeProvider = (i: number, p: ModelProvider) => {
    const m = metaOf(p);
    patch(i, { provider: p, model: m.defaultModel, baseUrl: m.defaultBase });
    setFetchedModels((prev) => ({ ...prev, [i]: [] })); // 旧清单属于上一家厂商
  };

  const addSlot = () => {
    setSequence((prev) => [...prev, emptySlot()]);
    setShowKeys(true);
  };

  const removeSlot = (i: number) => {
    setSequence((prev) => (prev.length <= 1 ? prev : prev.filter((_, idx) => idx !== i)));
    setFetchedModels({});
  };

  /**
   * 把第 i 项挪到第 to 位（0-based），其余项顺次补位 —— 也就是用户说的
   * 「调整后按优先级 1~n 重排」。下拉选几，它就成为第几。
   */
  const moveSlot = (i: number, to: number) => {
    setSequence((prev) => {
      if (to < 0 || to >= prev.length || to === i) return prev;
      const next = [...prev];
      const [moved] = next.splice(i, 1);
      next.splice(to, 0, moved);
      return next;
    });
    setFetchedModels({}); // 索引全变了，按 index 存的清单一律作废
  };

  const fetchModels = async (i: number) => {
    const slot = sequence[i];
    const m = metaOf(slot.provider);
    if (!slot.apiKey.trim()) return toast.error(`序列 ${i + 1}：请先填写 API Key`);
    if (m.needsBaseUrl && !slot.baseUrl.trim())
      return toast.error(`序列 ${i + 1}：请先填写 API Base URL`);
    setFetchingAt(i);
    try {
      const res = (await listFn({
        data: {
          provider: slot.provider,
          apiKey: slot.apiKey.trim(),
          baseUrl: m.needsBaseUrl ? normalizeBaseUrl(slot.baseUrl) : "",
        },
      })) as { models: string[] };
      if (!res.models.length) return toast.error("没有拉取到可用模型（key 或接口可能不对）");
      setFetchedModels((prev) => ({ ...prev, [i]: res.models }));
      if (!res.models.includes(slot.model)) patch(i, { model: res.models[0] });
      toast.success(`序列 ${i + 1}：已拉取 ${res.models.length} 个可用模型`);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setFetchingAt(null);
    }
  };

  const saveMutation = useMutation({
    mutationFn: async () => {
      const cleaned = sequence.map((s, i) => {
        const m = metaOf(s.provider);
        if (!s.apiKey.trim()) throw new Error(`序列 ${i + 1}：请填写 API Key`);
        if (!s.model.trim()) throw new Error(`序列 ${i + 1}：请选择或填写模型`);
        if (m.needsBaseUrl && !s.baseUrl.trim())
          throw new Error(`序列 ${i + 1}：请填写 API Base URL`);
        return {
          provider: s.provider,
          apiKey: s.apiKey.trim(),
          baseUrl: m.needsBaseUrl ? normalizeBaseUrl(s.baseUrl) : "",
          model: s.model.trim(),
        };
      });
      if (storage) {
        storage.save(cleaned);
        return { count: cleaned.length, sequence: cleaned };
      }
      const r = await saveFn({ data: { consoleId: consoleId!, sequence: cleaned } });
      return { ...r, sequence: cleaned };
    },
    onSuccess: (r: { count: number; sequence: ModelSlot[] }) => {
      qc.invalidateQueries({ queryKey });
      toast.success(
        storage
          ? `✅ 已保存 ${r.count} 个调用序列（只存在你自己的浏览器里）`
          : `✅ 已保存 ${r.count} 个调用序列，全站立即生效`,
      );
      onSaved?.(r.sequence);
      setIsOpen(false);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const clearMutation = useMutation({
    mutationFn: async () => {
      if (storage) return storage.clear();
      return clearFn({ data: { consoleId: consoleId! } });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey });
      seeded.current = false;
      setSequence([emptySlot()]);
      onSaved?.([]);
      toast.success(storage ? "已清除，改回站点默认模型" : "已清除配置，恢复 .env 默认");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const savedSummary = saved?.sequence?.length
    ? saved.sequence
        .map((s, i) => `${i + 1}. ${metaOf(s.provider).label} · ${s.model}`)
        .join("　→　")
    : null;

  return (
    <div className="mb-6">
      <div className="flex items-center gap-3 mb-2 flex-wrap">
        <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold tracking-widest uppercase text-ink-faint">
          {titleIcon} {title}
        </span>
        <button
          onClick={() => setIsOpen((v) => !v)}
          className="text-[11px] border border-rule px-2.5 py-1 rounded-sm hover:border-ink transition-colors cursor-pointer"
        >
          {isOpen ? "收起" : openLabel}
        </button>
        {saved?.sequence?.length ? (
          <button
            onClick={() => clearMutation.mutate()}
            disabled={clearMutation.isPending}
            className="text-[11px] text-ink-faint hover:text-ink underline underline-offset-2 cursor-pointer disabled:opacity-50"
          >
            {clearLabel}
          </button>
        ) : null}
      </div>

      {/* 收起时也让人一眼看到当前的调用顺序 + 能查到的余额，不用点开 */}
      {!isOpen && savedSummary && (
        <div className="text-[11px] text-ink-faint mb-2 space-y-0.5">
          <p>当前调用顺序：{savedSummary}</p>
          {balances?.balances?.map((b) => (
            <p key={b.index} className="flex items-center gap-1.5">
              <span className="tabular-nums">{b.index + 1}.</span>
              <span className="font-mono">{b.model}</span>
              {b.state === "ok" ? (
                <span className="text-leaf-deep font-semibold">余额 {b.text}</span>
              ) : (
                <span className="opacity-70">余额未知 · {b.text}</span>
              )}
            </p>
          ))}
          {!!consoleId && !!saved?.sequence?.length && (
            <button
              onClick={() => refetchBalances()}
              disabled={balLoading}
              className="underline underline-offset-2 hover:text-ink cursor-pointer disabled:opacity-50"
            >
              {balLoading ? "查询余额中…" : "刷新余额"}
            </button>
          )}
        </div>
      )}

      {isOpen && (
        <div className="border border-rule rounded-md p-4 bg-paper/60 space-y-4">
          {intro}
          <p className="text-[11px] text-ink-faint leading-relaxed border-l-2 border-leaf-deep/40 pl-2">
            按 <b>序列 1 → 2 → 3…</b> 依次调用：排在前面的失败（额度用尽、限流、key
            失效、模型不存在、服务端故障、<b>这个模型不会读图</b>
            ）会自动顺位交给下一个。每个序列项都是一套
            <b>独立完整</b>的配置，各自带自己的 key —— 不同厂商可以混排。
          </p>

          {/* 这个控制台该配什么样的模型。五个控制台界面完全一样、要求却天差地别，
              不写出来只能靠记（而记错的代价见 CONSOLE_ADVICE 的注释）。 */}
          {(() => {
            const a = CONSOLE_ADVICE[consoleId ?? "xiaop"];
            return (
              <div className="rounded-md border border-leaf-deep/30 bg-leaf/5 px-3 py-2.5 space-y-1">
                <p className="text-[11px] font-semibold text-leaf-deep">这里该配：{a.needs}</p>
                {/* 「这个模型干哪些活」放在最前面 —— 管理员改配置前真正要知道的是
                    「我动了它会影响什么」，而控制台名字传达不了这件事。 */}
                <div className="rounded bg-background/60 border border-leaf-deep/20 px-2 py-1.5">
                  <p className="text-[10px] font-semibold text-leaf-deep mb-1">
                    这个模型负责站上这些工作：
                  </p>
                  <ul className="space-y-0.5">
                    {a.jobs.map((j) => (
                      <li
                        key={j}
                        className="text-[11px] text-ink-soft leading-relaxed flex gap-1.5"
                      >
                        <span className="text-leaf-deep shrink-0">·</span>
                        <span>{j}</span>
                      </li>
                    ))}
                  </ul>
                </div>
                <p className="text-[11px] text-ink-soft leading-relaxed">{a.why}</p>
                <p className="text-[11px] text-amber-700 leading-relaxed">⚠️ {a.avoid}</p>
                <p className="text-[10px] text-ink-faint leading-relaxed">
                  推理开关：{a.thinkingWhy}
                </p>
              </div>
            );
          })()}

          {sequence.map((slot, i) => {
            const m = metaOf(slot.provider);
            const options = fetchedModels[i]?.length ? fetchedModels[i] : m.models;
            return (
              <div key={i} className="border border-rule/70 rounded-md p-3 space-y-3 bg-background">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-[12px] font-semibold text-leaf-deep">
                    {i === 0 ? "优先调用序列 1" : `排队序列 ${i + 1}`}
                  </span>
                  {/* 点序列号即可下拉改优先级；选几就排第几，其余顺次补位。 */}
                  {sequence.length > 1 && (
                    <>
                      <select
                        value={i}
                        onChange={(e) => moveSlot(i, Number(e.target.value))}
                        className="text-[11px] border border-rule rounded-sm px-1.5 py-0.5 bg-background cursor-pointer"
                        title="调整这一项的调用优先级"
                      >
                        {sequence.map((_, n) => (
                          <option key={n} value={n}>
                            调整为第 {n + 1} 位
                          </option>
                        ))}
                      </select>
                      <button
                        onClick={() => removeSlot(i)}
                        className="text-[11px] text-ink-faint hover:text-red-600 cursor-pointer ml-auto"
                      >
                        删除本项
                      </button>
                    </>
                  )}
                </div>

                <div className="grid grid-cols-2 gap-2">
                  {PROVIDERS.map((p) => (
                    <button
                      key={p.id}
                      onClick={() => changeProvider(i, p.id)}
                      className={`text-left text-[12px] px-3 py-2 rounded-sm border transition-colors cursor-pointer ${
                        slot.provider === p.id
                          ? "bg-ink text-background border-ink"
                          : "border-rule hover:border-ink"
                      }`}
                    >
                      {p.icon} {p.label}
                    </button>
                  ))}
                </div>

                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="text-[11px] font-semibold">API Key（一项一个）</label>
                    <button
                      onClick={() => setShowKeys((v) => !v)}
                      className="text-[11px] text-ink-faint hover:text-ink cursor-pointer"
                    >
                      {showKeys ? "隐藏" : "显示"}
                    </button>
                  </div>
                  <input
                    type={showKeys ? "text" : "password"}
                    value={slot.apiKey}
                    onChange={(e) => patch(i, { apiKey: e.target.value })}
                    placeholder={m.id === "gemini" ? "AIza… / AQ.…" : "sk-…"}
                    className="w-full border border-rule rounded-sm px-2 py-1.5 text-[12px] font-mono bg-background"
                  />
                </div>

                {m.needsBaseUrl && (
                  <div>
                    <label className="text-[11px] font-semibold block mb-1">API Base URL</label>
                    <input
                      value={slot.baseUrl}
                      onChange={(e) => patch(i, { baseUrl: e.target.value })}
                      onBlur={(e) => patch(i, { baseUrl: normalizeBaseUrl(e.target.value) })}
                      placeholder="https://api.moonshot.cn/v1"
                      className="w-full border border-rule rounded-sm px-2 py-1.5 text-[12px] font-mono bg-background"
                    />
                    <p className="text-[10px] text-ink-faint mt-1">
                      填到 /v1 为止；粘完整的 …/chat/completions 也行，会自动裁掉。
                    </p>
                  </div>
                )}

                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="text-[11px] font-semibold">模型</label>
                    <button
                      onClick={() => fetchModels(i)}
                      disabled={fetchingAt === i}
                      className="text-[11px] bg-amber-600 text-background px-2 py-0.5 rounded-sm hover:bg-amber-500 transition-colors cursor-pointer disabled:opacity-50"
                    >
                      {fetchingAt === i ? "拉取中…" : "拉取可用模型"}
                    </button>
                  </div>
                  {options.length > 0 && (
                    <select
                      value={options.includes(slot.model) ? slot.model : ""}
                      onChange={(e) => patch(i, { model: e.target.value })}
                      className="w-full border border-rule rounded-sm px-2 py-1.5 text-[12px] bg-background mb-1 cursor-pointer"
                    >
                      <option value="">（手动填写）</option>
                      {options.map((o) => (
                        <option key={o} value={o}>
                          {o}
                        </option>
                      ))}
                    </select>
                  )}
                  <input
                    value={slot.model}
                    onChange={(e) => patch(i, { model: e.target.value })}
                    placeholder="例：kimi-k3 / gemini-3-flash-preview"
                    className="w-full border border-rule rounded-sm px-2 py-1.5 text-[12px] font-mono bg-background"
                  />
                </div>

                <ThinkingRow
                  consoleId={consoleId ?? "xiaop"}
                  slot={slot}
                  onChange={(thinking) => patch(i, { thinking })}
                />

                <p className="text-[10px] text-ink-faint font-mono">
                  {i + 1}. {m.label} | {slot.model || "（未填）"}
                  {slot.baseUrl ? ` | ${slot.baseUrl}` : ""}
                </p>

                {visionProbe && <VisionProbeRow consoleId={consoleId!} index={i} slot={slot} />}
              </div>
            );
          })}

          <div className="flex gap-2 flex-wrap">
            <button
              onClick={() => saveMutation.mutate()}
              disabled={saveMutation.isPending}
              className="flex-1 min-w-[180px] bg-amber-600 text-background px-4 py-2.5 text-sm font-semibold hover:bg-amber-500 transition-colors cursor-pointer rounded-sm disabled:opacity-50"
            >
              {saveMutation.isPending ? "保存中…" : "保存并全站生效"}
            </button>
            <button
              onClick={addSlot}
              className="border border-leaf-deep text-leaf-deep px-4 py-2.5 text-sm font-semibold hover:bg-leaf-deep hover:text-background transition-colors cursor-pointer rounded-sm"
            >
              + 添加排队序列 {sequence.length + 1}
            </button>
            <button
              onClick={() => setIsOpen(false)}
              className="border border-rule text-ink-faint px-4 py-2.5 text-sm hover:border-ink hover:text-ink transition-colors cursor-pointer rounded-sm"
            >
              取消
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
