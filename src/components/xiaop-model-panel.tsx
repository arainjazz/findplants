import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  saveXiaoPConfigFn,
  getXiaoPConfigFn,
  clearXiaoPConfigFn,
} from "@/lib/identify-plant.functions";
import { XiaoPLogo } from "@/components/xiaop-logo";
import { toast } from "sonner";

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
    defaultModel: "gemini-2.5-flash",
    models: ["gemini-2.5-flash", "gemini-2.5-pro", "gemini-2.0-flash", "gemini-1.5-flash", "gemini-1.5-pro"],
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
  const qc = useQueryClient();
  const [isOpen, setIsOpen] = useState(false);
  const [provider, setProvider] = useState<Provider>("gemini");
  const [apiKey, setApiKey] = useState("");
  const [model, setModel] = useState("gemini-2.5-flash");
  const [customModel, setCustomModel] = useState("");
  const [baseUrl, setBaseUrl] = useState("https://api.openai.com/v1");
  const [showKey, setShowKey] = useState(false);

  const saveFn = useServerFn(saveXiaoPConfigFn);
  const getFn = useServerFn(getXiaoPConfigFn);
  const clearFn = useServerFn(clearXiaoPConfigFn);

  const { data: activeConfig, isLoading } = useQuery({
    queryKey: ["xiaop-config"],
    queryFn: () => getFn({ data: undefined }),
    retry: false,
  });

  const saveMutation = useMutation({
    mutationFn: async () => {
      const effectiveModel = customModel.trim() || model;
      if (!apiKey.trim()) throw new Error("请填写 API Key");
      if (!effectiveModel) throw new Error("请选择或填写模型名称");
      const meta = PROVIDERS.find((p) => p.id === provider)!;
      if (meta.needsBaseUrl && !baseUrl.trim()) throw new Error("请填写 API Base URL");
      await saveFn({
        data: {
          provider,
          apiKey: apiKey.replace(/\s+/g, ""),
          model: effectiveModel,
          baseUrl: meta.needsBaseUrl ? baseUrl.trim().replace(/\/+$/, "") : "",
        },
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["xiaop-config"] });
      toast.success("✅ 小P蛙模型已保存，全站对话/改写生效");
      setIsOpen(false);
      setApiKey("");
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
    if (p === "openai") setBaseUrl("https://api.openai.com/v1");
    else if (p === "anthropic") setBaseUrl("https://api.anthropic.com/v1");
    else if (p === "custom") setBaseUrl("");
  };

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
            {providerIcon(activeConfig.provider)} {providerLabel(activeConfig.provider)} · {activeConfig.model}
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
        {activeConfig && <span className="text-[11px] text-ink-faint">Key：{activeConfig.apiKeyMasked}</span>}
      </div>

      {isOpen && (
        <div className="mt-3 p-4 rounded-2xl border border-leaf/30 bg-leaf/5 space-y-4 animate-in fade-in slide-in-from-top-1 duration-200">
          <div className="flex gap-2 p-2.5 rounded-lg bg-leaf/10 border border-leaf/20 text-[11px] text-leaf-deep leading-relaxed">
            <span>🐸</span>
            <span>此处仅设置「小P蛙 AI agent」对话与改写所用的大模型；与识别管线模型相互独立。不配置则默认使用 .env 的 Gemini。</span>
          </div>

          <div>
            <label className="block text-xs font-semibold text-ink-soft mb-2">AI 服务商</label>
            <div className="grid grid-cols-2 gap-2">
              {PROVIDERS.map((p) => (
                <button
                  key={p.id}
                  onClick={() => handleProviderChange(p.id)}
                  className={`py-2 px-3 rounded-lg text-xs font-bold border transition-all cursor-pointer text-left ${
                    provider === p.id ? "bg-ink text-background border-ink" : "bg-paper text-ink-soft border-rule hover:border-ink/50"
                  }`}
                >
                  {p.icon} {p.label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-ink-soft mb-1.5">API Key</label>
            <div className="relative">
              <input
                type={showKey ? "text" : "password"}
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder={meta.placeholder}
                className="w-full pr-10 pl-3 py-2 text-xs rounded-lg border border-rule bg-background font-mono focus:outline-none focus:border-leaf transition-colors"
              />
              <button
                type="button"
                onClick={() => setShowKey((v) => !v)}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-ink-faint hover:text-ink transition-colors cursor-pointer"
              >
                {showKey ? <EyeOffIcon className="w-3.5 h-3.5" /> : <EyeIcon className="w-3.5 h-3.5" />}
              </button>
            </div>
            <p className="mt-1 text-[11px] text-ink-faint">Key 加密存储在服务端数据库，浏览器不可读取。</p>
          </div>

          <div>
            <label className="block text-xs font-semibold text-ink-soft mb-1.5">模型</label>
            {meta.models.length > 0 ? (
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
                {meta.models.map((m) => (
                  <option key={m} value={m}>{m}</option>
                ))}
                <option value="__custom__">✏️ 手动输入其他模型名…</option>
              </select>
            ) : null}
            {(meta.models.length === 0 || customModel !== "") && (
              <input
                type="text"
                value={customModel.trim() || model}
                onChange={(e) => setCustomModel(e.target.value)}
                placeholder="例：deepseek-chat / qwen-plus / glm-4"
                className="mt-1.5 w-full px-3 py-2 text-xs rounded-lg border border-rule bg-background font-mono focus:outline-none focus:border-leaf transition-colors"
              />
            )}
          </div>

          {meta.needsBaseUrl && (
            <div>
              <label className="block text-xs font-semibold text-ink-soft mb-1.5">
                API Base URL <span className="ml-1.5 font-normal text-ink-faint">（中转 / 代理 / 自定义接口）</span>
              </label>
              <input
                type="text"
                value={baseUrl}
                onChange={(e) => setBaseUrl(e.target.value)}
                placeholder="https://api.openai.com/v1"
                className="w-full px-3 py-2 text-xs rounded-lg border border-rule bg-background font-mono focus:outline-none focus:border-leaf transition-colors"
              />
              <p className="mt-1 text-[11px] text-ink-faint">兼容硅基流动、One API、阿里通义千问等 OpenAI 格式接口</p>
            </div>
          )}

          <div className="p-2.5 rounded-lg bg-background border border-rule/50 text-[11px] text-ink-soft font-mono">
            Provider: <strong>{provider}</strong> &nbsp;|&nbsp; Model: <strong>{effectiveModel || "（未填）"}</strong>
            {meta.needsBaseUrl && baseUrl && <> &nbsp;|&nbsp; URL: <strong>{baseUrl}</strong></>}
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

function WrenchIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
    </svg>
  );
}

function XCircleIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <circle cx="12" cy="12" r="10" />
      <path d="m15 9-6 6M9 9l6 6" />
    </svg>
  );
}

function EyeIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function EyeOffIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <path d="M9.88 9.88a3 3 0 1 0 4.24 4.24" />
      <path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68" />
      <path d="M6.61 6.61A13.526 13.526 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61" />
      <path d="m2 2 20 20" />
    </svg>
  );
}
