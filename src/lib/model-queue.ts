/**
 * 模型调用配置 —— 统一的「优先调用序列」模型。
 *
 * 旧机制的毛病：一个控制台存**一个** provider + 一**池**逗号拼接的 key。可是 key 是
 * 跟着厂商走的，池子里混进别家的 key 就必然 401（Gemini 的 AQ.… 拿去问 Moonshot），
 * 而且「Gemini 额度用完换 Kimi」这种需求根本表达不了 —— provider / baseUrl / model
 * 只有一份，换不了家。
 *
 * 新机制：一个控制台存一个**有序数组**，每一项都是一套**完整且自洽**的配置
 * （厂商 + 单个 key + Base URL + 模型）。序列 1 是一线，失败就顺位交给 2、3…。
 * 一个 key 只跟自己的厂商绑定，跨厂商混用的整类问题就不存在了。
 */

export type ModelProvider = "gemini" | "openai" | "anthropic" | "custom";

/**
 * 视觉准入检测的存档结果（见 vision-probe.ts）。
 * `undefined` = 从没测过（**不等于**不可用；老配置全都是这个状态）。
 */
export type SlotVision = {
  verdict: "pass" | "blind" | "unknown";
  at: string; // ISO
  note: string;
  imageTokenDelta: number | null;
  /** 测的是哪个模型 —— 管理员把 model 改了，旧结论就作废（见 visionOf）。 */
  model: string;
};

/**
 * 推理（思维链）开关。**两档都是「强制」，不是「建议」**。
 *
 * `"off"` = 发一组厂商无关的关思考参数（`THINKING_OFF`）；
 * `"on"`  = 发一组厂商无关的开思考参数（`THINKING_ON`）；
 * **不设** = 沿用该控制台的默认（见 `THINKING_DEFAULTS`）。
 *
 * 三态而不是布尔：要能区分「管理员明确要求开」和「还没表态、跟着默认走」——
 * 否则以后调整默认值时，所有老配置都会被当成「明确选了旧默认」而僵在那里。
 *
 * 🔴 **2026-07-30 语义修正**：`"on"` 以前的实现是**一个参数都不发**、让模型按自己的
 * 默认来 —— 于是这个开关只有一半是真的（「关」真能关，「开」只是「不管」）。
 * 用户明确要求「点击开关是真的可以关闭或开启」，现在两档都会真的发参数。
 * 同时三条传输层（openai-compat / gemini / anthropic）**都**接这个开关；
 * 在此之前只有 openai-compat 一条路认它，配 Gemini 或 Anthropic 时开关是死的。
 */
export type ThinkingMode = "on" | "off";

/** 序列里的一项：能独立发起一次调用所需的全部信息。 */
export type ModelSlot = {
  provider: ModelProvider;
  apiKey: string; // 恰好一个 key。要多个 key → 建多个序列项。
  baseUrl: string; // gemini / anthropic 用官方地址时为 ""
  model: string;
  /** 视觉准入检测结果；没测过就没有这个字段。 */
  vision?: SlotVision;
  /** 推理开关；不设 = 跟随控制台默认。 */
  thinking?: ThinkingMode;
};

const VERDICTS = ["pass", "blind", "unknown"] as const;

function readVision(raw: unknown): SlotVision | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const v = raw as Record<string, unknown>;
  if (!VERDICTS.includes(v.verdict as (typeof VERDICTS)[number])) return undefined;
  return {
    verdict: v.verdict as SlotVision["verdict"],
    at: String(v.at ?? ""),
    note: String(v.note ?? ""),
    imageTokenDelta: typeof v.imageTokenDelta === "number" ? v.imageTokenDelta : null,
    model: String(v.model ?? ""),
  };
}

/** 只认 "on" / "off"；其余（含 undefined）一律回 undefined = 跟随控制台默认。 */
function readThinking(raw: unknown): ThinkingMode | undefined {
  return raw === "on" || raw === "off" ? raw : undefined;
}

/**
 * 取一项**当前有效**的视觉结论。
 *
 * 关键：结论是绑在**某个具体模型 ID** 上的。管理员把 model 从 `qwen3.5-omni-flash` 改成
 * `deepseek-v4-flash` 却没重测，旧的 pass 绝不能继续替新模型背书 —— 那正好会把这套机制
 * 变成事故的帮凶。model 对不上就当没测过。
 */
export function visionOf(slot: ModelSlot): SlotVision | undefined {
  const v = slot.vision;
  if (!v) return undefined;
  if (v.model && v.model !== slot.model) return undefined;
  return v;
}

/** 这一项是否**已知**看不见图。只有明确测出 blind 才为 true；没测过一律 false。 */
export function isKnownBlind(slot: ModelSlot): boolean {
  return visionOf(slot)?.verdict === "blind";
}

// ─── 推理开关：识别、默认值、判定 ────────────────────────────────────────────

/** 一眼能看出「这是关了思考的版本」的后缀 —— 命中就直接判定不是推理模型。 */
const NON_THINKING_HINT = /non[-_]?think|no[-_]?think|instruct\b|turbo\b|flash\b|-fast\b/i;

/** 会先写一大段思维链的模型的常见命名特征。 */
const REASONING_HINT = new RegExp(
  [
    "think", // qwen3-thinking / glm-thinking / gemini-*-thinking
    "reason", // deepseek-reasoner / *-reasoning
    "^o\\d", // OpenAI o1 / o3 / o4-mini
    "\\bo\\d-", //  …以及带前缀的写法
    "-r\\d", // deepseek-r1 / -r2
    "qwen[\\d.]*-(?:plus|max)", // 阿里 Qwen3 plus/max 默认开思考
    "deepseek-(?:v[\\d.]+)?r", //
    "glm-[\\d.]+v?-?(?:plus|air|thinking)",
    "kimi-k[\\d.]+(?!.*turbo)",
  ].join("|"),
  "i",
);

/**
 * 模型 ID **看起来**像不像推理模型。
 *
 * ⚠️ 这是个**启发式，不是事实** —— 模型名从来不是能力契约，厂商随时能给同一个名字
 * 换掉底层行为（`qwen3.7-max` 这次就是个纯文本模型，名字上完全看不出来）。所以它只
 * 用来在界面上给一句「看着像推理模型」的提示 + 挑一个初始默认值，**绝不**用来替管理员
 * 做决定：开关永远显示、永远可手动改，最终以人选的为准。
 */
export function looksReasoningModel(model: string): boolean {
  const m = String(model ?? "").trim();
  if (!m) return false;
  if (NON_THINKING_HINT.test(m)) return false;
  return REASONING_HINT.test(m);
}

/**
 * 每个控制台的推理默认值 —— 取决于**这条链路要的是「快」还是「想得深」**。
 *
 * 关（off）的四个都卡在用户等待的实时路径上，且干的是机械活：
 *  - `second_opinion` 二次复核：2026-07-26 线上 `qwen3.7-plus` **28 秒没返回**，
 *    整条复核判为「未运行」。它的活是「再看一眼图，报个物种和档位」，思维链几乎无增益。
 *  - `card` 出卡：整条 phase-1 卡在 Cloudflare 边缘 100 秒上限里，没有思考的余量。
 *  - `xiaop` 小P蛙：交互问答要跟手；它还兼着**配图器官分类**（机械打标签）。
 *  - `ai` 兜底：批量导入时从 HTML 里抠字段，纯提取。
 *
 * 开（on）的只有 `enrich` 撰写长文 —— 它跑在 Queues 消费者的 **15 分钟**挂钟里
 * （见 job-queue.ts），慢一点无所谓，而中英双语科普长文正是思维链真能加分的地方。
 */
export const THINKING_DEFAULTS: Record<string, ThinkingMode> = {
  ai: "off",
  card: "off",
  enrich: "on",
  second_opinion: "off",
  xiaop: "off",
  // 🔴 金叶从 "on" 改成 "off"（2026-07-30，实测逼出来的）。
  //
  // 原来的理由是「与 enrich 同类：写整份公开档案，跑在 15 分钟挂钟里，不赶时间」——
  // 挂钟确实够，但**中转的网关时限不够**。实测：gold 配 kimi-k3（推理模型）+ 默认 "on"，
  // 三轮撰稿的第一轮「正文主体」prompt 最长，模型先写两三分钟思维链、一个字节都不吐，
  // Moonshot 前面那道 Cloudflare 网关直接判源站超时 → **每一次**都停在
  // 「正在撰稿 1/3」+ HTTP 524。整条链路没有任何救法：重试一样慢；放宽我们自己的
  // timeoutMs 无效（是对方掐的）；改成流式也无效（**思维链阶段不产生 content 增量**，
  // 网关照样看不到字节）。
  //
  // 所以对「一次要写很长、且经过中转」的链路，思维链的成本不是「慢一点」而是「必然失败」。
  // 管理员仍然可以在控制台把这一项显式设回 "on"（界面上会提示超时风险）。
  gold: "off",
  // 器官识别是**机械的视觉打标签**（这张图是花还是叶），思维链毫无增益，
  // 却会把一次配图从几秒拖到几十秒；而它在 enrich/金叶 里都是串在长流程中间的一步。
  organ: "off",
};

/** 该控制台没有明确配置时的默认值。未知控制台一律保守关掉。 */
export function defaultThinking(consoleId: string): ThinkingMode {
  return THINKING_DEFAULTS[consoleId] ?? "off";
}

/** 这一项这次调用**到底**开不开思考。管理员显式选过就以他为准，否则跟随控制台默认。 */
export function thinkingOf(slot: Pick<ModelSlot, "thinking">, consoleId: string): ThinkingMode {
  return slot.thinking ?? defaultThinking(consoleId);
}

/** 一个控制台的完整配置。sequence[0] 即「优先调用序列 1」。 */
export type ModelQueue = {
  sequence: ModelSlot[];
  updatedAt?: string;
  updatedBy?: string;
};

export const EMPTY_QUEUE: ModelQueue = { sequence: [] };

const PROVIDERS: ModelProvider[] = ["gemini", "openai", "anthropic", "custom"];

function asProvider(v: unknown): ModelProvider {
  return PROVIDERS.includes(v as ModelProvider) ? (v as ModelProvider) : "gemini";
}

/** 我们自己拼路径（调用拼 /chat/completions、列模型拼 /models），base 里已含路由就得裁掉。 */
export function normalizeBaseUrl(raw: unknown): string {
  return String(raw ?? "")
    .trim()
    .replace(/\/+$/, "")
    .replace(/\/(chat\/completions|completions|responses|messages)$/i, "")
    .replace(/\/+$/, "");
}

/**
 * 把 site_config 里存的任意历史形态读成 ModelQueue。
 *
 * 认三种形态：
 *  1. 新的 `{ sequence: [...] }`
 *  2. 旧的单配置 `{ provider, apiKey, model, baseUrl }`
 *  3. 旧的单配置 + 逗号 key 池 `apiKey: "k1,k2,k3"`
 *
 * 形态 3 会**按 key 展开成多个序列项**（provider / model / baseUrl 原样复制）：
 * 老的「同厂商多 key 轮换」语义被完整保留，只是换成了新的表达方式。管理员下次
 * 打开控制台就能看到它们已经排好队，不需要手工迁移。
 */
export function readModelQueue(value: unknown): ModelQueue {
  if (!value || typeof value !== "object") return EMPTY_QUEUE;
  const v = value as Record<string, unknown>;

  if (Array.isArray(v.sequence)) {
    const sequence = v.sequence
      .map((s) => {
        const slot = (s ?? {}) as Record<string, unknown>;
        const vision = readVision(slot.vision);
        const thinking = readThinking(slot.thinking);
        return {
          provider: asProvider(slot.provider),
          apiKey: String(slot.apiKey ?? "").trim(),
          baseUrl: normalizeBaseUrl(slot.baseUrl),
          model: String(slot.model ?? "").trim(),
          ...(vision ? { vision } : {}),
          ...(thinking ? { thinking } : {}),
        };
      })
      .filter((s) => s.apiKey && s.model);
    return {
      sequence,
      updatedAt: typeof v.updatedAt === "string" ? v.updatedAt : undefined,
      updatedBy: typeof v.updatedBy === "string" ? v.updatedBy : undefined,
    };
  }

  // ── 旧形态：单配置（apiKey 可能是逗号 key 池）→ 展开成序列 ──
  const provider = asProvider(v.provider);
  const model = String(v.model ?? "").trim();
  const baseUrl = normalizeBaseUrl(v.baseUrl);
  const keys = String(v.apiKey ?? "")
    .split(",")
    .map((k) => k.trim())
    .filter(Boolean);
  if (!model || !keys.length) return EMPTY_QUEUE;
  return {
    sequence: keys.map((apiKey) => ({ provider, apiKey, baseUrl, model })),
    updatedAt: typeof v.updatedAt === "string" ? v.updatedAt : undefined,
    updatedBy: typeof v.updatedBy === "string" ? v.updatedBy : undefined,
  };
}

/**
 * 存回 site_config 的形态。
 *
 * 视觉结论**跟着模型走**：保存时若该项的 model 与结论记录的 model 不符（管理员刚换了模型），
 * 就把结论丢掉 —— 让它回到「未检测」，而不是继续挂着一个属于旧模型的 pass。
 */
export function writeModelQueue(sequence: ModelSlot[], updatedBy: string): ModelQueue {
  return {
    sequence: sequence.map((s) => {
      const model = String(s.model ?? "").trim();
      const vision = s.vision && s.vision.model === model ? s.vision : undefined;
      const thinking = readThinking(s.thinking);
      return {
        provider: asProvider(s.provider),
        apiKey: String(s.apiKey ?? "").trim(),
        baseUrl: normalizeBaseUrl(s.baseUrl),
        model,
        ...(vision ? { vision } : {}),
        // 推理开关**不**跟着换模型清空（不同于 vision）：它是管理员对「这条链路要快还是要深」
        // 的判断，换个模型 ID 这个判断照样成立；而 vision 是对某个具体模型的实测结论。
        ...(thinking ? { thinking } : {}),
      };
    }),
    updatedAt: new Date().toISOString(),
    updatedBy,
  };
}

/** 序列项在 UI / 日志里的短标签，例如「序列 2 · Kimi kimi-k3」。key 一律打码。 */
export function slotLabel(slot: ModelSlot, index: number): string {
  return `序列 ${index + 1} · ${slot.provider} ${slot.model}`;
}

export function maskKey(k: string): string {
  const s = String(k ?? "");
  return s.length <= 10 ? "…" : `${s.slice(0, 4)}…${s.slice(-4)}`;
}

/**
 * 有些 400 其实是「**这一项**不可用」，不是「请求本身有毛病」。
 *
 * 真实案例（2026-07-20）：阿里云百炼对未开通的模型返回 **HTTP 400**
 * `The product is not activated, please confirm that you have activated products`。
 * 序列里第 2 项 glm-5.2 本来好好的，却因为第 1 项的 400 被判定「换模型也没用」而
 * 整个停止顺位 —— 用户看到的就是「草稿生成失败」，而备胎压根没被试过。
 *
 * 这类 400 讲的都是**账号 / 模型的可用性**（未开通、未授权、欠费、模型不存在），
 * 换一项完全可能就好了，必须顺位。
 */
const SLOT_SPECIFIC_400 =
  /not activated|not enabled|not authorized|no permission|unauthorized|insufficient|balance|quota|arrears|expired|model not found|does not exist|unsupported model|未开通|未激活|未授权|无权限|欠费|余额|不存在|已过期/i;

/**
 * 第二类「换一项就好」的 400：**这个模型没有这项能力**，而不是请求写错了。
 *
 * 真实案例（2026-07-26 线上）：小P蛙序列 1 配了阿里云百炼的 `qwen3.7-max` —— 一个
 * **纯文本模型**。带图调用时它回 HTTP 400：
 *   `InternalError.Algo.InvalidParameter: The provided messages input is invalid.
 *    The error info is [Unexpected item type in content.]`
 * 意思是「content 数组里出现了我不认识的项」，指的就是那张图。
 *
 * 旧规则把它归进「请求本身有毛病，换厂商也没用」，于是整条序列**停在第 1 项**，
 * 后面那个已验证读图的 gemini-3.5-flash 压根没被试过 —— 用户看到的就是
 * 「已依次尝试 1/3 个序列（末项的错误无法靠换模型解决，已停止顺位）」。
 * 事实恰恰相反：**请求完全合法，只是这一项不会读图**，顺位给下一项正是序列机制的意义。
 *
 * ⚠️ 必须和「图片本身有问题」划清界限（那种确实换谁都挂，不该顺位、也不该把真错误埋掉）：
 * 这里只认「**模型/接口不支持这类内容**」的说法，不认「图太大 / 解码失败 / 格式不对」。
 * 所以下面每一条都要求把话说到「不支持」或「要的是纯文本」，而不是笼统的 invalid。
 */
const CAPABILITY_400 = new RegExp(
  [
    // 阿里百炼 / DashScope：content 数组里有它不认的项（= 那张图）
    "unexpected item type",
    // 纯文本接口：要求 content 是字符串，给了数组就拒
    "content must be a string",
    "unsupported content",
    "invalid content type",
    // 「(does) not support … image/vision/多模态」——限定宾语，避免误伤参数类报错
    "(?:not|n[o']?t) support\\w*[^.]{0,24}(?:image|vision|multi-?modal|picture)",
    // 反过来的语序：「image input is not supported」。**必须**限定成
    // image_input / image_url / vision / multimodal 这类「输入模态」的说法 ——
    // 光写 `image .* not supported` 会把「webp 这种**格式**不支持」也吃进来，
    // 而那是图本身的问题，换厂商一样挂（见下面的 BAD_IMAGE_400）。
    "(?:image[_ ]?(?:input|url)|vision|multi-?modal)[^.]{0,20}(?:not|un)\\s?supported",
    "only supports? text",
    "text[- ]only model",
    "不支持(?:图片|图像|多模态|视觉)",
    "(?:仅|只)支持文本",
  ].join("|"),
  "i",
);

/**
 * 否决闸门：话里在说**这张图本身**不行（格式、体积、解码、损坏）。
 *
 * 这类换哪家都一样挂，顺位只是白等一轮，还会把「你的图有什么毛病」这条真正有用的
 * 报错埋在最后一项的错误信息底下。所以即使措辞碰巧撞上 CAPABILITY_400，也一律不顺位。
 */
const BAD_IMAGE_400 =
  /\bformats?\b|invalid image|decode|corrupt|too large|exceeds|file size|图片格式|解码|损坏|过大/i;

/**
 * 判断一次失败要不要顺位给下一个序列项。
 *
 * 会顺位：401/403（key 无效或不属于这家）、404（模型 ID 在这家不存在）、
 * 429（限流 / 额度用尽，正是「Gemini 用完换 Kimi」的场景）、5xx（服务端故障）、
 * 网络错误 / 超时（status 传 0），以及两类 400 —— **讲可用性的**（SLOT_SPECIFIC_400）
 * 和**讲能力的**（CAPABILITY_400，例如把图发给了纯文本模型）。
 *
 * 不顺位：其余 400 —— 请求本身有问题（图片损坏、参数不合法），换个厂商同样会挂，
 * 白等一轮还会把真正的错误信息埋掉。BAD_IMAGE_400 命中时**一票否决**能力顺位。
 */
export function shouldFailOver(status: number, message = ""): boolean {
  if (status === 400) {
    if (SLOT_SPECIFIC_400.test(message)) return true;
    return CAPABILITY_400.test(message) && !BAD_IMAGE_400.test(message);
  }
  if (status === 0) return true; // 网络错误 / 超时
  return status === 401 || status === 403 || status === 404 || status === 429 || status >= 500;
}
