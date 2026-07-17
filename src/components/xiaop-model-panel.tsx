import { useState, useEffect, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  saveXiaoPConfigFn,
  getXiaoPConfigFn,
  clearXiaoPConfigFn,
  listProviderModelsFn,
} from "@/lib/identify-plant.functions";
import { XiaoPLogo } from "@/components/xiaop-logo";
import { toast } from "sonner";
import { useAuth } from "@/hooks/use-auth";
import { isOwnerEmail } from "@/lib/leaves";

type Provider = "gemini" | "openai" | "anthropic" | "custom";

interface ProviderMeta {
  id: Provider;
  label: string;
  icon: string;
  placeholder: string;
  defaultModel: string;
  models: string[];
  needsBaseUrl: boolean;
}

const PROVIDERS: ProviderMeta[] = [
  {
    id: "gemini",
    label: "Google Gemini",
    icon: "🔵",
    placeholder: "AQ.xxx... 或 AIzaSy...",
    defaultModel: "gemini-3-flash-preview",
    models: [
      "gemini-3-flash-preview",
      "gemini-3-pro-preview",
      "gemini-3.1-pro-preview",
      "gemini-2.5-flash",
      "gemini-2.5-pro",
      "gemini-2.5-flash-lite",
    ],
    needsBaseUrl: false,
  },
  {
    id: "openai",
    label: "OpenAI / 中转",
    icon: "🟢",
    placeholder: "sk-...",
    defaultModel: "gpt-4o",
    models: ["gpt-4o", "gpt-4o-mini", "gpt-4-turbo", "gpt-4", "o1-mini", "o1", "o3-mini"],
    needsBaseUrl: true,
  },
  {
    id: "anthropic",
    label: "Anthropic Claude",
    icon: "🟤",
    placeholder: "sk-ant-...",
    defaultModel: "claude-3-5-sonnet-20241022",
    models: [
      "claude-3-5-sonnet-20241022",
      "claude-3-5-haiku-20241022",
      "claude-3-opus-20240229",
      "claude-3-sonnet-20240229",
    ],
    needsBaseUrl: false,
  },
  {
    id: "custom",
    label: "自定义接口",
    icon: "⚙️",
    placeholder: "自定义 API Key",
    defaultModel: "",
    models: [],
    needsBaseUrl: true,
  },
];

/**
 * Admin-only control panel for the model behind 小P蛙 (the Plantspedia AI agent),
 * independent of the identify pipeline. Stored in site_config `xiaop_model_config`;
 * unset → defaults to the .env Gemini. Reusable on /identify and /admin.
 */
export function XiaoPModelPanel() {
  const { user } = useAuth();
  const isOwner = isOwnerEmail(user?.email);

  // 仅 owner 可见
  if (!isOwner) return null;

  const qc = useQueryClient();
  const [isOpen, setIsOpen] = useState(false);
  const [provider, setProvider] = useState<Provider>("gemini");
  // One input PER key — same pattern as AdminModelPanel for consistency
  const [keys, setKeys] = useState<string[]>([""]);
  const joinedKey = keys
    .map((k) => k.trim())
    .filter(Boolean)
    .join(",");
  const [model, setModel] = useState("gemini-3-flash-preview");
  const [customModel, setCustomModel] = useState("");
  const [baseUrl, setBaseUrl] = useState("https://api.openai.com/v1");
  const [showKey, setShowKey] = useState(true); // owner 需看到完整 key 拖动排序，默认显示
  // Live-fetched model IDs (from the provider's list-models endpoint). When set,
  // they replace the hard-coded preset list in the dropdown.
  const [fetchedModels, setFetchedModels] = useState<string[]>([]);
  const [fetching, setFetching] = useState(false);

  const saveFn = useServerFn(saveXiaoPConfigFn);
  const getFn = useServerFn(getXiaoPConfigFn);
  const clearFn = useServerFn(clearXiaoPConfigFn);
  const listFn = useServerFn(listProviderModelsFn);

  const { data: activeConfig, isLoading } = useQuery({
    queryKey: ["xiaop-config"],
    queryFn: () => getFn({ data: undefined }),
    retry: false,
  });

  // Seed the editable form from the saved config (once) so the owner sees ALL
  // configured keys + model/provider and can drag-reorder key priority.
  const seededRef = useRef(false);
  useEffect(() => {
    if (seededRef.current || !activeConfig) return;
    seededRef.current = true;
    setProvider(activeConfig.provider as Provider);
    const savedKeys = (activeConfig.apiKeys ?? []).filter(Boolean);
    if (savedKeys.length) setKeys(savedKeys);
    if (activeConfig.model) setModel(activeConfig.model);
    if (activeConfig.baseUrl) setBaseUrl(activeConfig.baseUrl);
  }, [activeConfig]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      const effectiveModel = customModel.trim() || model;
      if (!joinedKey) throw new Error("请至少填写一个 API Key");
      if (!effectiveModel) throw new Error("请选择或填写模型名称");
      const meta = PROVIDERS.find((p) => p.id === provider)!;
      if (meta.needsBaseUrl && !baseUrl.trim()) throw new Error("请填写 API Base URL");
      await saveFn({
        data: {
          provider,
          apiKey: joinedKey,
          model: effectiveModel,
          baseUrl: meta.needsBaseUrl ? baseUrl.trim().replace(/\/+$/, "") : "",
        },
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["xiaop-config"] });
      toast.success("✅ 小P蛙模型已保存，全站对话/改写生效");
      setIsOpen(false);
      setKeys([""]);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const clearMutation = useMutation({
    mutationFn: () => clearFn({ data: undefined }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["xiaop-config"] });
      toast.success("已恢复小P蛙默认模型（.env 中的 Gemini）");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const meta = PROVIDERS.find((p) => p.id === provider)!;
  const effectiveModel = customModel.trim() || model;
  const providerLabel = (id: string) => PROVIDERS.find((p) => p.id === id)?.label ?? id;
  const providerIcon = (id: string) => PROVIDERS.find((p) => p.id === id)?.icon ?? "🤖";

  const handleProviderChange = (p: Provider) => {
    const m = PROVIDERS.find((x) => x.id === p)!;
    setProvider(p);
    setModel(m.defaultModel);
    setCustomModel("");
    setFetchedModels([]); // stale for the old provider
    if (p === "openai") setBaseUrl("https://api.openai.com/v1");
    else if (p === "anthropic") setBaseUrl("https://api.anthropic.com/v1");
    else if (p === "custom") setBaseUrl("");
  };

  // Live-list the models this key can actually use (real auto-detect).
  const fetchModels = async () => {
    if (!joinedKey) return toast.error("请先填写 API Key，再拉取可用模型");
    if (meta.needsBaseUrl && !baseUrl.trim()) return toast.error("请先填写 API Base URL");
    setFetching(true);
    try {
      const res = (await listFn({
        data: {
          provider,
          apiKey: joinedKey,
          baseUrl: meta.needsBaseUrl ? baseUrl.trim().replace(/\/+$/, "") : "",
        },
      })) as { models: string[] };
      if (!res.models.length) return toast.error("没有拉取到可用模型（key 或接口可能不对）");
      setFetchedModels(res.models);
      if (!res.models.includes(effectiveModel)) {
        setModel(res.models[0]);
        setCustomModel("");
      }
      toast.success(`已拉取 ${res.models.length} 个可用模型`);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setFetching(false);
    }
  };
  // Options shown in the dropdown: real fetched list if available, else presets.
  const optionModels = fetchedModels.length > 0 ? fetchedModels : meta.models;

  return (
    <div className="mb-6 animate-in fade-in slide-in-from-top-2 duration-300">
      <div className="flex items-center gap-3 mb-2">
        <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold tracking-widest uppercase text-ink-faint">
          <XiaoPLogo className="w-3.5 h-4" /> 管理员 · 小P蛙 模型控制台
        </span>
        <div className="flex-1 h-px bg-rule/50" />
        {isLoading ? (
          <span className="text-[11px] text-ink-faint">加载中…</span>
        ) : activeConfig ? (
          <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold px-2.5 py-1 rounded-full bg-leaf/10 text-leaf-deep border border-leaf/25">
            <span className="w-1.5 h-1.5 rounded-full bg-leaf animate-pulse" />
            {providerIcon(activeConfig.provider)} {providerLabel(activeConfig.provider)} ·{" "}
            {activeConfig.model}
          </span>
        ) : (
          <span className="inline-flex items-center gap-1.5 text-[11px] text-ink-faint px-2.5 py-1 rounded-full border border-rule/50">
            默认 Gemini（.env）
          </span>
        )}
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <button
          onClick={() => setIsOpen((v) => !v)}
          className="inline-flex items-center gap-2 text-xs font-medium px-3 py-1.5 rounded-lg border border-rule bg-paper hover:bg-ink hover:text-background transition-all cursor-pointer"
        >
          <WrenchIcon className="w-3.5 h-3.5" />
          {isOpen ? "收起" : activeConfig ? "修改小P模型" : "配置小P模型"}
        </button>
        {activeConfig && (
          <button
            onClick={() => clearMutation.mutate()}
            disabled={clearMutation.isPending}
            className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border border-rule/60 text-ink-soft hover:border-destructive hover:text-destructive hover:bg-destructive/5 transition-all cursor-pointer disabled:opacity-50"
          >
            <XCircleIcon className="w-3.5 h-3.5" />
            {clearMutation.isPending ? "清除中…" : "恢复默认 Gemini"}
          </button>
        )}
        {activeConfig && (
          <span className="text-[11px] text-ink-faint">Key：{activeConfig.apiKeyMasked}</span>
        )}
      </div>

      {isOpen && (
        <div className="mt-3 p-4 rounded-2xl border border-leaf/30 bg-leaf/5 space-y-4 animate-in fade-in slide-in-from-top-1 duration-200">
          <div className="flex gap-2 p-2.5 rounded-lg bg-leaf/10 border border-leaf/20 text-[11px] text-leaf-deep leading-relaxed">
            <span>🐸</span>
            <span>
              此处仅设置「小P蛙 AI
              agent」对话与改写所用的大模型；与识别管线模型相互独立。不配置则默认使用 .env 的
              Gemini。
            </span>
          </div>

          <div>
            <label className="block text-xs font-semibold text-ink-soft mb-2">AI 服务商</label>
            <div className="grid grid-cols-2 gap-2">
              {PROVIDERS.map((p) => (
                <button
                  key={p.id}
                  onClick={() => handleProviderChange(p.id)}
                  className={`py-2 px-3 rounded-lg text-xs font-bold border transition-all cursor-pointer text-left ${
                    provider === p.id
                      ? "bg-ink text-background border-ink"
                      : "bg-paper text-ink-soft border-rule hover:border-ink/50"
                  }`}
                >
                  {p.icon} {p.label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="block text-xs font-semibold text-ink-soft">
                API Key（可加多个，拖动调整优先级）
              </label>
              <button
                type="button"
                onClick={() => setShowKey((v) => !v)}
                className="text-[11px] text-ink-faint hover:text-ink transition-colors cursor-pointer inline-flex items-center gap-1"
              >
                {showKey ? (
                  <EyeOffIcon className="w-3.5 h-3.5" />
                ) : (
                  <EyeIcon className="w-3.5 h-3.5" />
                )}
                {showKey ? "隐藏" : "显示"}
              </button>
            </div>
            <div className="space-y-2">
              {keys.map((k, i) => (
                <div
                  key={i}
                  draggable={keys.length > 1}
                  onDragStart={(e) => {
                    e.dataTransfer.effectAllowed = "move";
                    e.dataTransfer.setData("text/plain", String(i));
                    (e.currentTarget as HTMLElement).style.opacity = "0.5";
                  }}
                  onDragEnd={(e) => {
                    (e.currentTarget as HTMLElement).style.opacity = "1";
                  }}
                  onDragOver={(e) => {
                    e.preventDefault();
                    e.dataTransfer.dropEffect = "move";
                  }}
                  onDrop={(e) => {
                    e.preventDefault();
                    const fromIndex = parseInt(e.dataTransfer.getData("text/plain"), 10);
                    const toIndex = i;
                    if (fromIndex !== toIndex) {
                      setKeys((arr) => {
                        const newArr = [...arr];
                        const [moved] = newArr.splice(fromIndex, 1);
                        newArr.splice(toIndex, 0, moved);
                        return newArr;
                      });
                    }
                  }}
                  className={`flex items-center gap-2 ${keys.length > 1 ? "cursor-move" : ""} group`}
                >
                  {keys.length > 1 && (
                    <div
                      className="shrink-0 text-ink-faint group-hover:text-ink transition-colors"
                      title="拖动调整优先级"
                    >
                      <svg
                        className="w-4 h-4"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M4 8h16M4 16h16"
                        />
                      </svg>
                    </div>
                  )}
                  <input
                    type={showKey ? "text" : "password"}
                    value={k}
                    onChange={(e) =>
                      setKeys((arr) => arr.map((x, j) => (j === i ? e.target.value : x)))
                    }
                    placeholder={`${meta.placeholder}${keys.length > 1 ? `（优先级 ${i + 1}）` : ""}`}
                    className="flex-1 min-w-0 px-3 py-2 text-xs rounded-lg border border-rule bg-background font-mono focus:outline-none focus:border-leaf transition-colors"
                  />
                  {keys.length > 1 && (
                    <button
                      type="button"
                      onClick={() => setKeys((arr) => arr.filter((_, j) => j !== i))}
                      title="移除这个 key"
                      className="shrink-0 w-7 h-7 rounded-lg border border-rule text-ink-faint hover:border-destructive hover:text-destructive transition-colors cursor-pointer inline-flex items-center justify-center"
                    >
                      ×
                    </button>
                  )}
                </div>
              ))}
            </div>
            <button
              type="button"
              onClick={() => setKeys((arr) => [...arr, ""])}
              className="mt-2 text-[11px] text-leaf-deep hover:text-leaf font-medium cursor-pointer inline-flex items-center gap-1"
            >
              ＋ 再加一个 API Key
            </button>
            <p className="mt-1 text-[11px] text-ink-faint">
              ⚠️ Key 完整显示在此页面，请注意屏幕分享时遮挡。Key 加密存储在服务端。 多个 key
              按顺序优先使用；Gemini 限流时（429）自动换下一个。
            </p>
          </div>

          {/* Base URL first (needed before fetching models). */}
          {meta.needsBaseUrl ? (
            <div>
              <label className="block text-xs font-semibold text-ink-soft mb-1.5">
                API Base URL{" "}
                <span className="ml-1.5 font-normal text-ink-faint">
                  （中转 / 代理 / 自定义接口）
                </span>
              </label>
              <input
                type="text"
                value={baseUrl}
                onChange={(e) => setBaseUrl(e.target.value)}
                placeholder="https://api.openai.com/v1"
                className="w-full px-3 py-2 text-xs rounded-lg border border-rule bg-background font-mono focus:outline-none focus:border-leaf transition-colors"
              />
              <p className="mt-1 text-[11px] text-ink-faint leading-relaxed">
                {provider === "openai"
                  ? "OpenAI 官方填 https://api.openai.com/v1；中转填到 /v1 为止。系统请求 {BaseURL}/chat/completions。"
                  : "OpenAI 兼容格式，填到 /v1 为止（例：https://你的中转域名/v1）。系统请求 {BaseURL}/chat/completions；兼容硅基流动 / One API / 通义 / DeepSeek 等。"}
              </p>
            </div>
          ) : (
            <p className="text-[11px] text-ink-faint leading-relaxed">
              {provider === "gemini"
                ? "Gemini 无需填 Base URL（走 Google 官方地址）。填好 Key 后点下方「拉取可用模型」。"
                : "Anthropic 无需填 Base URL（走官方 api.anthropic.com）。填好 Key 后点下方「拉取可用模型」。"}
            </p>
          )}

          {/* Model after Base URL, with live Fetch. */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="block text-xs font-semibold text-ink-soft">模型</label>
              <button
                type="button"
                onClick={fetchModels}
                disabled={fetching}
                title="用上面的 Key / Base URL 向服务商拉取你实际可用的模型列表"
                className="inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded-md border border-leaf/40 text-leaf-deep hover:bg-leaf hover:text-background transition-colors cursor-pointer disabled:opacity-50"
              >
                {fetching ? (
                  <span className="w-3 h-3 rounded-full border-2 border-leaf/30 border-t-leaf animate-spin" />
                ) : (
                  <RefreshIcon className="w-3 h-3" />
                )}
                {fetching ? "拉取中…" : "拉取可用模型"}
              </button>
            </div>
            {optionModels.length > 0 ? (
              <select
                value={customModel ? "__custom__" : model}
                onChange={(e) => {
                  if (e.target.value === "__custom__") setCustomModel(" ");
                  else {
                    setModel(e.target.value);
                    setCustomModel("");
                  }
                }}
                className="w-full px-3 py-2 text-xs rounded-lg border border-rule bg-background focus:outline-none focus:border-leaf transition-colors cursor-pointer"
              >
                {optionModels.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
                <option value="__custom__">✏️ 手动输入其他模型名…</option>
              </select>
            ) : null}
            {(optionModels.length === 0 || customModel !== "") && (
              <input
                type="text"
                value={customModel.trim() || model}
                onChange={(e) => setCustomModel(e.target.value)}
                placeholder="例：deepseek-chat / qwen-plus / glm-4"
                className="mt-1.5 w-full px-3 py-2 text-xs rounded-lg border border-rule bg-background font-mono focus:outline-none focus:border-leaf transition-colors"
              />
            )}
            {fetchedModels.length > 0 && (
              <p className="mt-1 text-[11px] text-leaf-deep">
                ✓ 已按你的 Key 列出 {fetchedModels.length} 个可用模型
              </p>
            )}
          </div>

          <div className="p-2.5 rounded-lg bg-background border border-rule/50 text-[11px] text-ink-soft font-mono">
            Provider: <strong>{provider}</strong> &nbsp;|&nbsp; Model:{" "}
            <strong>{effectiveModel || "（未填）"}</strong>
            {meta.needsBaseUrl && baseUrl && (
              <>
                {" "}
                &nbsp;|&nbsp; URL: <strong>{baseUrl}</strong>
              </>
            )}
          </div>

          <div className="flex gap-2">
            <button
              onClick={() => saveMutation.mutate()}
              disabled={saveMutation.isPending}
              className="flex-1 py-2 text-xs font-bold rounded-lg bg-leaf text-background hover:bg-leaf-deep transition-all cursor-pointer disabled:opacity-60"
            >
              {saveMutation.isPending ? "保存中…" : "保存并全站生效"}
            </button>
            <button
              onClick={() => setIsOpen(false)}
              className="px-4 py-2 text-xs rounded-lg border border-rule text-ink-soft hover:bg-paper-deep transition-all cursor-pointer"
            >
              取消
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function RefreshIcon({ className }: { className?: string }) {
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
      <path d="M3 12a9 9 0 0 1 15-6.7L21 8" />
      <path d="M21 3v5h-5" />
      <path d="M21 12a9 9 0 0 1-15 6.7L3 16" />
      <path d="M3 21v-5h5" />
    </svg>
  );
}

function WrenchIcon({ className }: { className?: string }) {
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
      <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
    </svg>
  );
}

function XCircleIcon({ className }: { className?: string }) {
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
      <circle cx="12" cy="12" r="10" />
      <path d="m15 9-6 6M9 9l6 6" />
    </svg>
  );
}

function EyeIcon({ className }: { className?: string }) {
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
      <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function EyeOffIcon({ className }: { className?: string }) {
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
      <path d="M9.88 9.88a3 3 0 1 0 4.24 4.24" />
      <path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68" />
      <path d="M6.61 6.61A13.526 13.526 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61" />
      <path d="m2 2 20 20" />
    </svg>
  );
}
