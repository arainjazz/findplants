/**
 * Per-user 小P蛙 model config, stored in the browser (localStorage) and forwarded
 * to the server on each ask/apply as `userModel`. Priority on the server is:
 *   this per-user override  >  admin site_config  >  env Gemini.
 * No account/DB needed — the key never leaves the user's browser + the request.
 *
 * 与管理员控制台一样，这里存的是一个**优先调用序列**：每项一套完整自洽的配置
 * （厂商 + 单个 key + Base URL + 模型），序列 1 失败就顺位交给 2、3…。
 */

import { readModelQueue, type ModelSlot } from "./model-queue";

export type XiaoPProvider = "gemini" | "openai" | "anthropic" | "custom";

/** 旧形态（v1）：单配置，apiKey 可能是逗号 key 池。仍用于向服务端传参的兼容字段。 */
export type XiaoPUserModel = {
  provider: XiaoPProvider;
  apiKey: string;
  model: string;
  baseUrl?: string;
};

const STORAGE_KEY = "xiaop_user_model_v1";

/**
 * 读用户自己的调用序列。localStorage 里可能是 v1 的单配置（含逗号 key 池），
 * readModelQueue() 会把它折算成序列 —— 老用户不用重配。
 */
export function getUserSequence(): ModelSlot[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    return readModelQueue(JSON.parse(raw)).sequence;
  } catch {
    return [];
  }
}

export function setUserSequence(sequence: ModelSlot[]): void {
  if (typeof window === "undefined") return;
  if (!sequence.length) return clearUserModel();
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ sequence }));
}

/** 兼容旧调用方：只回序列 1。 */
export function getUserModel(): XiaoPUserModel | null {
  const first = getUserSequence()[0];
  if (!first) return null;
  return {
    provider: first.provider,
    apiKey: first.apiKey,
    model: first.model,
    baseUrl: first.baseUrl || undefined,
  };
}

export function setUserModel(m: XiaoPUserModel): void {
  setUserSequence([
    { provider: m.provider, apiKey: m.apiKey, baseUrl: m.baseUrl ?? "", model: m.model },
  ]);
}

export function clearUserModel(): void {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(STORAGE_KEY);
}

/**
 * 传给 server fn 的 `userModel` 参数。带上整个序列，服务端才能按序降级；
 * 同时保留 v1 的扁平字段（= 序列 1），老版本服务端也读得懂。
 */
export function userModelArg(): (XiaoPUserModel & { sequence: ModelSlot[] }) | undefined {
  const sequence = getUserSequence();
  const first = sequence[0];
  if (!first) return undefined;
  return {
    provider: first.provider,
    apiKey: first.apiKey,
    model: first.model,
    baseUrl: first.baseUrl || undefined,
    sequence,
  };
}

export interface XiaoPProviderMeta {
  id: XiaoPProvider;
  label: string;
  icon: string;
  keyPlaceholder: string;
  defaultModel: string;
  models: string[];
  needsBaseUrl: boolean;
  /** Example base URL to prefill / hint. */
  baseUrlHint?: string;
  /** Whether this provider's default models can see images (vision). */
  visionNote: string;
}

/** Provider presets for the per-user settings form. Kept lightweight and biased
 *  toward vision-capable defaults, since 小P蛙 must be able to SEE the photos. */
export const XIAOP_PROVIDERS: XiaoPProviderMeta[] = [
  {
    id: "gemini",
    label: "Google Gemini",
    icon: "🔵",
    keyPlaceholder: "AIzaSy... 或 AQ.xxx...",
    defaultModel: "gemini-3-flash-preview",
    models: ["gemini-3-flash-preview", "gemini-3-pro-preview", "gemini-3.1-pro-preview"],
    needsBaseUrl: false,
    visionNote: "Gemini 全系支持视觉，推荐。",
  },
  {
    id: "openai",
    label: "OpenAI / 中转",
    icon: "🟢",
    keyPlaceholder: "sk-...",
    defaultModel: "gpt-4o",
    models: ["gpt-4o", "gpt-4o-mini", "gpt-4.1", "gpt-4.1-mini"],
    needsBaseUrl: true,
    baseUrlHint: "https://api.openai.com/v1",
    visionNote: "请选带视觉的型号（gpt-4o / 4.1 系列）；纯文本型号无法看图。",
  },
  {
    id: "anthropic",
    label: "Anthropic Claude",
    icon: "🟤",
    keyPlaceholder: "sk-ant-...",
    defaultModel: "claude-sonnet-5",
    models: ["claude-sonnet-5", "claude-opus-4-8", "claude-haiku-4-5-20251001"],
    needsBaseUrl: false,
    visionNote: "Claude 全系支持视觉。",
  },
  {
    id: "custom",
    label: "自定义 / 兼容 OpenAI",
    icon: "⚙️",
    keyPlaceholder: "自定义 API Key",
    defaultModel: "",
    models: [],
    needsBaseUrl: true,
    baseUrlHint: "https://你的中转域名/v1",
    visionNote:
      "务必用支持「视觉理解」的多模态模型（如 MiniMax、qwen-vl、glm-4v 等），否则看不了照片。",
  },
];

export function providerMeta(id: XiaoPProvider): XiaoPProviderMeta {
  return XIAOP_PROVIDERS.find((p) => p.id === id) ?? XIAOP_PROVIDERS[0];
}
