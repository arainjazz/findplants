import { useState } from "react";
import {
  getUserModel,
  setUserModel,
  clearUserModel,
  providerMeta,
  XIAOP_PROVIDERS,
  type XiaoPProvider,
  type XiaoPUserModel,
} from "@/lib/xiaop-user-model";
import { toast } from "sonner";

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
  const [apiKey, setApiKey] = useState(existing?.apiKey ?? "");
  const [model, setModel] = useState(existing?.model ?? providerMeta(existing?.provider ?? "gemini").defaultModel);
  const [baseUrl, setBaseUrl] = useState(
    existing?.baseUrl ?? providerMeta(existing?.provider ?? "gemini").baseUrlHint ?? "",
  );
  const [showKey, setShowKey] = useState(false);

  const meta = providerMeta(provider);

  const onProvider = (p: XiaoPProvider) => {
    const m = providerMeta(p);
    setProvider(p);
    setModel(m.defaultModel);
    setBaseUrl(m.baseUrlHint ?? "");
  };

  const save = () => {
    const key = apiKey.replace(/\s+/g, "");
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
        <label className="block text-[11px] font-semibold text-ink-soft mb-1.5">API Key</label>
        <div className="relative">
          <input
            type={showKey ? "text" : "password"}
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder={meta.keyPlaceholder}
            className="w-full pr-9 pl-3 py-2 text-xs rounded-lg border border-rule bg-background font-mono outline-none focus:border-leaf"
          />
          <button
            type="button"
            onClick={() => setShowKey((v) => !v)}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-ink-faint hover:text-ink cursor-pointer"
          >
            {showKey ? "隐藏" : "显示"}
          </button>
        </div>
      </div>

      <div>
        <label className="block text-[11px] font-semibold text-ink-soft mb-1.5">模型名称</label>
        {meta.models.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mb-1.5">
            {meta.models.map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setModel(m)}
                className={`text-[10px] px-2 py-1 rounded-full border cursor-pointer ${
                  model === m ? "bg-leaf text-background border-leaf" : "border-rule text-ink-soft hover:border-leaf"
                }`}
              >
                {m}
              </button>
            ))}
          </div>
        )}
        <input
          type="text"
          value={model}
          onChange={(e) => setModel(e.target.value)}
          placeholder="例：MiniMax-M3 / qwen-vl-max / glm-4v"
          className="w-full px-3 py-2 text-xs rounded-lg border border-rule bg-background font-mono outline-none focus:border-leaf"
        />
      </div>

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
            填到 <code className="text-leaf-deep">/v1</code> 为止（例：<code>https://域名/v1</code>）。
            系统会请求 <code>{"{BaseURL}"}/chat/completions</code>。兼容硅基流动 / One API / 通义等。
          </p>
        </div>
      )}

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
