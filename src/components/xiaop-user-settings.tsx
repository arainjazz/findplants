import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import {
  getUserModel,
  setUserModel,
  clearUserModel,
  providerMeta,
  XIAOP_PROVIDERS,
  type XiaoPProvider,
  type XiaoPUserModel,
} from "@/lib/xiaop-user-model";
import { listProviderModelsFn } from "@/lib/identify-plant.functions";
import { toast } from "sonner";

/** Per-provider Base-URL format guidance (OpenAI-compatible relays vary a lot). */
const BASE_URL_HELP: Record<string, string> = {
  openai: "填到 /v1 为止，例：https://api.openai.com/v1。系统会请求 {BaseURL}/chat/completions。",
  custom:
    "OpenAI 兼容格式，填到 /v1 为止，例：https://你的中转域名/v1。系统请求 {BaseURL}/chat/completions；兼容硅基流动 / One API / 通义 / DeepSeek 等。",
};

/**
 * In-panel settings view for the user's OWN 小P蛙 model (API key). Saved to the
 * browser (localStorage) and forwarded on each ask/apply — no login/DB needed.
 * Unset → 小P蛙 falls back to the site default (admin config or Gemini).
 */
export function XiaoPUserSettings({
  onClose,
  onSaved,
}: {
  onClose: () => void;
  onSaved: (m: XiaoPUserModel | null) => void;
}) {
  const existing = getUserModel();
  const [provider, setProvider] = useState<XiaoPProvider>(existing?.provider ?? "gemini");
  // Support multiple keys like AdminModelPanel and XiaoPModelPanel
  const existingKey = existing?.apiKey ?? "";
  const [keys, setKeys] = useState<string[]>(existingKey ? existingKey.split(",").map(k => k.trim()) : [""]);
  const joinedKey = keys.map((k) => k.trim()).filter(Boolean).join(",");
  const [model, setModel] = useState(existing?.model ?? providerMeta(existing?.provider ?? "gemini").defaultModel);
  const [baseUrl, setBaseUrl] = useState(
    existing?.baseUrl ?? providerMeta(existing?.provider ?? "gemini").baseUrlHint ?? "",
  );
  const [showKey, setShowKey] = useState(false);
  const [fetchedModels, setFetchedModels] = useState<string[]>([]);
  const [fetching, setFetching] = useState(false);
  const listFn = useServerFn(listProviderModelsFn);

  const meta = providerMeta(provider);
  const optionModels = fetchedModels.length > 0 ? fetchedModels : meta.models;

  const onProvider = (p: XiaoPProvider) => {
    const m = providerMeta(p);
    setProvider(p);
    setModel(m.defaultModel);
    setBaseUrl(m.baseUrlHint ?? "");
    setFetchedModels([]);
  };

  // Live-list the models this key can actually call (real auto-detect).
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
      if (!res.models.includes(model.trim())) setModel(res.models[0]);
      toast.success(`已拉取 ${res.models.length} 个可用模型`);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setFetching(false);
    }
  };

  const save = () => {
    const key = joinedKey;
    const mdl = model.trim();
    if (!key) return toast.error("请填写 API Key");
    if (!mdl) return toast.error("请选择或填写模型名称");
    if (meta.needsBaseUrl && !baseUrl.trim()) return toast.error("请填写 API Base URL");
    const cfg: XiaoPUserModel = {
      provider,
      apiKey: key,
      model: mdl,
      baseUrl: meta.needsBaseUrl ? baseUrl.trim().replace(/\/+$/, "") : undefined,
    };
    setUserModel(cfg);
    onSaved(cfg);
    toast.success("已保存你的小P蛙模型（仅存于本浏览器）");
    onClose();
  };

  const reset = () => {
    clearUserModel();
    onSaved(null);
    toast.success("已清除，恢复站点默认模型");
    onClose();
  };

  return (
    <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
      <div className="flex gap-2 p-2.5 rounded-lg bg-leaf/10 border border-leaf/20 text-[11px] text-leaf-deep leading-relaxed">
        <span>🐸</span>
        <span>
          在这里配置<strong>你自己的</strong>大模型给小P蛙用（对话与改写）。
          <strong>请务必选支持「视觉理解」的多模态模型</strong>，否则它看不了照片、无法核对物种。
          不填则使用站点默认模型。Key 只存在<strong>你本机浏览器</strong>，不会上传保存。
        </span>
      </div>

      <div>
        <label className="block text-[11px] font-semibold text-ink-soft mb-1.5">服务商</label>
        <div className="grid grid-cols-2 gap-2">
          {XIAOP_PROVIDERS.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => onProvider(p.id)}
              className={`py-2 px-2.5 rounded-lg text-[11px] font-bold border transition-all cursor-pointer text-left ${
                provider === p.id
                  ? "bg-ink text-background border-ink"
                  : "bg-paper text-ink-soft border-rule hover:border-ink/50"
              }`}
            >
              {p.icon} {p.label}
            </button>
          ))}
        </div>
        <p className="mt-1.5 text-[10px] text-ink-faint leading-relaxed">👁 {meta.visionNote}</p>
      </div>

      <div>
        <div className="flex items-center justify-between mb-1.5">
          <label className="block text-[11px] font-semibold text-ink-soft">
            API Key（可加多个，拖动调整优先级）
          </label>
          <button
            type="button"
            onClick={() => setShowKey((v) => !v)}
            className="text-[10px] text-ink-faint hover:text-ink cursor-pointer"
          >
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
                <div className="shrink-0 text-ink-faint group-hover:text-ink transition-colors" title="拖动调整优先级">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 8h16M4 16h16" />
                  </svg>
                </div>
              )}
              <input
                type={showKey ? "text" : "password"}
                value={k}
                onChange={(e) => setKeys((arr) => arr.map((x, j) => (j === i ? e.target.value : x)))}
                placeholder={`${meta.keyPlaceholder}${keys.length > 1 ? `（优先级 ${i + 1}）` : ""}`}
                className="flex-1 min-w-0 px-3 py-2 text-xs rounded-lg border border-rule bg-background font-mono outline-none focus:border-leaf"
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
          className="mt-2 text-[10px] text-leaf-deep hover:text-leaf font-medium cursor-pointer inline-flex items-center gap-1"
        >
          ＋ 再加一个 API Key
        </button>
        <p className="mt-1.5 text-[10px] text-ink-faint">
          ⚠️ Key 完整显示在此页面，请注意屏幕分享时遮挡。Key 仅存本机浏览器。
          多个 key 按顺序优先使用；Gemini 限流时（429）自动换下一个。
        </p>
      </div>

      {/* API Base URL — filled BEFORE fetching models (needed to reach the endpoint). */}
      {meta.needsBaseUrl && (
        <div>
          <label className="block text-[11px] font-semibold text-ink-soft mb-1.5">
            API Base URL <span className="font-normal text-ink-faint">（中转 / 兼容 OpenAI）</span>
          </label>
          <input
            type="text"
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
            placeholder={meta.baseUrlHint}
            className="w-full px-3 py-2 text-xs rounded-lg border border-rule bg-background font-mono outline-none focus:border-leaf"
          />
          <p className="mt-1 text-[10px] text-ink-faint leading-relaxed">
            {BASE_URL_HELP[provider] ?? "填到 /v1 为止（例：https://域名/v1）。系统会请求 {BaseURL}/chat/completions。"}
          </p>
        </div>
      )}
      {!meta.needsBaseUrl && (
        <p className="text-[10px] text-ink-faint leading-relaxed -mt-1">
          {provider === "gemini"
            ? "Gemini 无需填 Base URL（走 Google 官方地址）。填好 Key 后点下方「拉取可用模型」。"
            : provider === "anthropic"
              ? "Anthropic 无需填 Base URL（走官方 api.anthropic.com）。填好 Key 后点「拉取可用模型」。"
              : ""}
        </p>
      )}

      {/* Model — with a live Fetch, placed AFTER the Base URL so the endpoint is ready. */}
      <div>
        <div className="flex items-center justify-between mb-1.5">
          <label className="block text-[11px] font-semibold text-ink-soft">模型名称</label>
          <button
            type="button"
            onClick={fetchModels}
            disabled={fetching}
            title="用上面的 Key / Base URL 拉取你实际可用的模型"
            className="text-[10px] px-2 py-1 rounded-md border border-leaf/60 text-leaf-deep hover:bg-leaf hover:text-background transition-all cursor-pointer disabled:opacity-50"
          >
            {fetching ? "拉取中…" : "拉取可用模型"}
          </button>
        </div>
        {optionModels.length > 0 && (
          <select
            value={optionModels.includes(model) ? model : "__custom__"}
            onChange={(e) => {
              if (e.target.value !== "__custom__") setModel(e.target.value);
            }}
            className="w-full mb-1.5 px-3 py-2 text-xs rounded-lg border border-rule bg-background outline-none focus:border-leaf cursor-pointer"
          >
            {optionModels.map((m) => (
              <option key={m} value={m}>{m}</option>
            ))}
            <option value="__custom__">✏️ 手动输入其他模型名…</option>
          </select>
        )}
        <input
          type="text"
          value={model}
          onChange={(e) => setModel(e.target.value)}
          placeholder="例：MiniMax-M3 / qwen-vl-max / glm-4v"
          className="w-full px-3 py-2 text-xs rounded-lg border border-rule bg-background font-mono outline-none focus:border-leaf"
        />
        {fetchedModels.length > 0 && (
          <p className="mt-1 text-[10px] text-leaf-deep">✓ 已按你的 Key 列出 {fetchedModels.length} 个可用模型</p>
        )}
      </div>

      <div className="flex gap-2 pt-1">
        <button
          type="button"
          onClick={save}
          className="flex-1 py-2 text-xs font-bold rounded-lg bg-leaf text-background hover:bg-leaf-deep transition-all cursor-pointer"
        >
          保存
        </button>
        {existing && (
          <button
            type="button"
            onClick={reset}
            className="px-3 py-2 text-xs rounded-lg border border-rule/60 text-ink-soft hover:border-destructive hover:text-destructive transition-all cursor-pointer"
          >
            恢复默认
          </button>
        )}
        <button
          type="button"
          onClick={onClose}
          className="px-3 py-2 text-xs rounded-lg border border-rule text-ink-soft hover:bg-paper-deep transition-all cursor-pointer"
        >
          返回
        </button>
      </div>
    </div>
  );
}
