/**
 * Per-user 小P蛙 model config, stored in the browser (localStorage) and forwarded
 * to the server on each ask/apply as `userModel`. Priority on the server is:
 *   this per-user override  >  admin site_config  >  env Gemini.
 * No account/DB needed — the key never leaves the user's browser + the request.
 */

export type XiaoPProvider = "gemini" | "openai" | "anthropic" | "custom";

export type XiaoPUserModel = {
  provider: XiaoPProvider;
  apiKey: string;
  model: string;
  baseUrl?: string;
};

const STORAGE_KEY = "xiaop_user_model_v1";

/** Read the user's saved model config, or null if none / unavailable. */
export function getUserModel(): XiaoPUserModel | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const m = JSON.parse(raw) as Partial<XiaoPUserModel>;
    if (!m || !m.provider || !m.apiKey || !m.model) return null;
    return {
      provider: m.provider,
      apiKey: String(m.apiKey).replace(/\s+/g, ""),
      model: String(m.model).trim(),
      baseUrl: m.baseUrl ? String(m.baseUrl).trim().replace(/\/+$/, "") : undefined,
    };
  } catch {
    return null;
  }
}

export function setUserModel(m: XiaoPUserModel): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(m));
}

export function clearUserModel(): void {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(STORAGE_KEY);
}

/** Shape the server-fn `userModel` argument expects (undefined when unset). */
export function userModelArg(): XiaoPUserModel | undefined {
  return getUserModel() ?? undefined;
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
    defaultModel: "gemini-2.5-flash",
    models: ["gemini-2.5-flash", "gemini-2.5-pro", "gemini-2.0-flash"],
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
    defaultModel: "claude-3-5-sonnet-20241022",
    models: ["claude-3-5-sonnet-20241022", "claude-3-5-haiku-20241022"],
    needsBaseUrl: false,
    visionNote: "Claude 3.5 系列支持视觉。",
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
    visionNote: "务必用支持「视觉理解」的多模态模型（如 MiniMax、qwen-vl、glm-4v 等），否则看不了照片。",
  },
];

export function providerMeta(id: XiaoPProvider): XiaoPProviderMeta {
  return XIAOP_PROVIDERS.find((p) => p.id === id) ?? XIAOP_PROVIDERS[0];
}
