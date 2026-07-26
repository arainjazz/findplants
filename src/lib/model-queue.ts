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

/** 序列里的一项：能独立发起一次调用所需的全部信息。 */
export type ModelSlot = {
  provider: ModelProvider;
  apiKey: string; // 恰好一个 key。要多个 key → 建多个序列项。
  baseUrl: string; // gemini / anthropic 用官方地址时为 ""
  model: string;
  /** 视觉准入检测结果；没测过就没有这个字段。 */
  vision?: SlotVision;
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
        return {
          provider: asProvider(slot.provider),
          apiKey: String(slot.apiKey ?? "").trim(),
          baseUrl: normalizeBaseUrl(slot.baseUrl),
          model: String(slot.model ?? "").trim(),
          ...(vision ? { vision } : {}),
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
      return {
        provider: asProvider(s.provider),
        apiKey: String(s.apiKey ?? "").trim(),
        baseUrl: normalizeBaseUrl(s.baseUrl),
        model,
        ...(vision ? { vision } : {}),
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
 * 判断一次失败要不要顺位给下一个序列项。
 *
 * 会顺位：401/403（key 无效或不属于这家）、404（模型 ID 在这家不存在）、
 * 429（限流 / 额度用尽，正是「Gemini 用完换 Kimi」的场景）、5xx（服务端故障）、
 * 网络错误 / 超时（status 传 0），以及**讲可用性的 400**（见 SLOT_SPECIFIC_400）。
 *
 * 不顺位：其余 400 —— 请求本身有问题（图片格式、参数不合法），换个厂商同样会挂，
 * 白等一轮还会把真正的错误信息埋掉。
 */
export function shouldFailOver(status: number, message = ""): boolean {
  if (status === 400) return SLOT_SPECIFIC_400.test(message);
  if (status === 0) return true; // 网络错误 / 超时
  return status === 401 || status === 403 || status === 404 || status === 429 || status >= 500;
}
