import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { SiteHeader, SiteFooter } from "@/components/site-header";
import { CameraIdentify } from "@/components/camera-identify";
import { DraftCard } from "@/components/draft-card";
import { fetchPendingDrafts } from "@/lib/drafts";
import { displayPlace } from "@/lib/editor-stats";
import { useAuth } from "@/hooks/use-auth";
import { supabase } from "@/integrations/supabase/client";
import {
  saveAiConfigFn,
  getAiConfigFn,
  clearAiConfigFn,
  fetchAiUsageFn,
  savePlantNetKeyFn,
  getPlantNetKeyFn,
  clearPlantNetKeyFn,
} from "@/lib/identify-plant.functions";
import { XiaoPModelPanel } from "@/components/xiaop-model-panel";
import { toast } from "sonner";

export const Route = createFileRoute("/identify")({
  head: () => ({
    meta: [
      { title: "AI 识别植物 · Plantspedia" },
      { name: "description", content: "上传或拍摄一张植物照片，由 AI 识别物种并自动生成中英双语草稿。" },
    ],
  }),
  component: IdentifyPage,
});

// ── Types ──────────────────────────────────────────────────────────────────

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

// ── Admin Pl@ntNet Panel ─────────────────────────────────────────────────────

function PlantNetPanel() {
  const qc = useQueryClient();
  const [isOpen, setIsOpen] = useState(false);
  const [apiKey, setApiKey] = useState("");
  const [showKey, setShowKey] = useState(false);

  const saveFn = useServerFn(savePlantNetKeyFn);
  const getFn = useServerFn(getPlantNetKeyFn);
  const clearFn = useServerFn(clearPlantNetKeyFn);

  const { data: active, isLoading } = useQuery({
    queryKey: ["plantnet-key"],
    queryFn: () => getFn({ data: undefined }),
    retry: false,
  });

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!apiKey.trim()) throw new Error("请填写 Pl@ntNet API Key");
      await saveFn({ data: { apiKey: apiKey.replace(/\s+/g, "") } });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["plantnet-key"] });
      toast.success("✅ Pl@ntNet 已启用——全站识别将先专业定种");
      setIsOpen(false);
      setApiKey("");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const clearMutation = useMutation({
    mutationFn: () => clearFn({ data: undefined }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["plantnet-key"] });
      toast.success("已停用 Pl@ntNet（识别回退为纯大模型）");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="mb-6 animate-in fade-in slide-in-from-top-2 duration-300">
      {/* Header row */}
      <div className="flex items-center gap-3 mb-2">
        <span className="text-[11px] font-semibold tracking-widest uppercase text-ink-faint">管理员 · 专业识别引擎 Pl@ntNet</span>
        <div className="flex-1 h-px bg-rule/50" />
        {isLoading ? (
          <span className="text-[11px] text-ink-faint">加载中…</span>
        ) : active ? (
          <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold px-2.5 py-1 rounded-full bg-emerald-500/10 text-emerald-600 border border-emerald-500/25">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
            已启用 · {active.apiKeyMasked}
          </span>
        ) : (
          <span className="inline-flex items-center gap-1.5 text-[11px] text-ink-faint px-2.5 py-1 rounded-full border border-rule/50">
            未启用（纯大模型识别）
          </span>
        )}
      </div>

      {/* Button row */}
      <div className="flex items-center gap-2 flex-wrap">
        <button
          onClick={() => setIsOpen((v) => !v)}
          className="inline-flex items-center gap-2 text-xs font-medium px-3 py-1.5 rounded-lg border border-rule bg-paper hover:bg-ink hover:text-background transition-all cursor-pointer"
        >
          <LeafIcon className="w-3.5 h-3.5" />
          {isOpen ? "收起" : (active ? "修改 Key" : "配置 Pl@ntNet")}
        </button>
        {active && (
          <button
            onClick={() => clearMutation.mutate()}
            disabled={clearMutation.isPending}
            className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border border-rule/60 text-ink-soft hover:border-destructive hover:text-destructive hover:bg-destructive/5 transition-all cursor-pointer disabled:opacity-50"
          >
            {clearMutation.isPending ? "停用中…" : "停用"}
          </button>
        )}
      </div>

      {/* Expanded panel */}
      {isOpen && (
        <div className="mt-3 p-4 rounded-2xl border border-emerald-500/30 bg-emerald-500/5 space-y-4 animate-in fade-in slide-in-from-top-1 duration-200">
          <div className="flex gap-2 p-2.5 rounded-lg bg-emerald-50 border border-emerald-200 text-[11px] text-emerald-800 leading-relaxed">
            <span>🌿</span>
            <span>启用后，拍照识别会先由 Pl@ntNet 专业定种（带置信度），再交给上方所选大模型撰写双语草稿——全站立即生效，无需重新部署。</span>
          </div>
          <div>
            <label className="block text-xs font-semibold text-ink-soft mb-1.5">Pl@ntNet API Key</label>
            <div className="relative">
              <input
                type={showKey ? "text" : "password"}
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder="2b10xxxxxxxxxxxxxxxxxxxxxx"
                className="w-full pr-10 pl-3 py-2 text-xs rounded-lg border border-rule bg-background font-mono focus:outline-none focus:border-emerald-400 transition-colors"
              />
              <button
                type="button"
                onClick={() => setShowKey((v) => !v)}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-ink-faint hover:text-ink transition-colors cursor-pointer"
              >
                {showKey ? <EyeOffIcon className="w-3.5 h-3.5" /> : <EyeIcon className="w-3.5 h-3.5" />}
              </button>
            </div>
            <p className="mt-1 text-[11px] text-ink-faint">在 my.plantnet.org 免费注册获取（每日 500 次额度）。Key 加密存储在服务端数据库。</p>
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => saveMutation.mutate()}
              disabled={saveMutation.isPending}
              className="flex-1 py-2 text-xs font-bold rounded-lg bg-emerald-500 text-white hover:bg-emerald-600 transition-all cursor-pointer disabled:opacity-60"
            >
              {saveMutation.isPending ? "保存中…" : "保存并全站启用"}
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

// ── Admin Model Panel ────────────────────────────────────────────────────────

function AdminModelPanel() {
  const qc = useQueryClient();
  const [isOpen, setIsOpen] = useState(false);
  const [provider, setProvider] = useState<Provider>("gemini");
  const [apiKey, setApiKey] = useState("");
  const [model, setModel] = useState("gemini-2.5-flash");
  const [customModel, setCustomModel] = useState("");
  const [baseUrl, setBaseUrl] = useState("https://api.openai.com/v1");
  const [showKey, setShowKey] = useState(false);

  const saveFn = useServerFn(saveAiConfigFn);
  const getFn = useServerFn(getAiConfigFn);
  const clearFn = useServerFn(clearAiConfigFn);

  // Load current active config from server
  const { data: activeConfig, isLoading } = useQuery({
    queryKey: ["ai-config"],
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
          // Strip ALL whitespace — a key pasted with stray spaces/newlines silently
          // 401s on every identify (the server re-sanitizes too, as a safety net).
          apiKey: apiKey.replace(/\s+/g, ""),
          model: effectiveModel,
          baseUrl: meta.needsBaseUrl ? baseUrl.trim().replace(/\/+$/, "") : "",
        },
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["ai-config"] });
      toast.success("✅ AI 配置已保存，全站生效（包括手机端访客）");
      setIsOpen(false);
      setApiKey("");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const clearMutation = useMutation({
    mutationFn: () => clearFn({ data: undefined }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["ai-config"] });
      toast.success("已恢复默认 AI 配置（使用 .env 中的 Key）");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const meta = PROVIDERS.find((p) => p.id === provider)!;
  const effectiveModel = customModel.trim() || model;

  const handleProviderChange = (p: Provider) => {
    const m = PROVIDERS.find((x) => x.id === p)!;
    setProvider(p);
    setModel(m.defaultModel);
    setCustomModel("");
    if (p === "openai") setBaseUrl("https://api.openai.com/v1");
    else if (p === "anthropic") setBaseUrl("https://api.anthropic.com/v1");
    else if (p === "custom") setBaseUrl("");
  };

  const providerLabel = (id: string) => PROVIDERS.find((p) => p.id === id)?.label ?? id;
  const providerIcon = (id: string) => PROVIDERS.find((p) => p.id === id)?.icon ?? "🤖";

  return (
    <div className="mb-6 animate-in fade-in slide-in-from-top-2 duration-300">
      {/* Header row */}
      <div className="flex items-center gap-3 mb-2">
        <span className="text-[11px] font-semibold tracking-widest uppercase text-ink-faint">管理员 · AI 模型控制台</span>
        <div className="flex-1 h-px bg-rule/50" />
        {isLoading ? (
          <span className="text-[11px] text-ink-faint">加载中…</span>
        ) : activeConfig ? (
          <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold px-2.5 py-1 rounded-full bg-emerald-500/10 text-emerald-600 border border-emerald-500/25">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
            {providerIcon(activeConfig.provider)} {providerLabel(activeConfig.provider)} · {activeConfig.model}
          </span>
        ) : (
          <span className="inline-flex items-center gap-1.5 text-[11px] text-ink-faint px-2.5 py-1 rounded-full border border-rule/50">
            使用 .env 默认配置
          </span>
        )}
      </div>

      {/* Button row */}
      <div className="flex items-center gap-2 flex-wrap">
        <button
          id="admin-model-panel-toggle"
          onClick={() => setIsOpen((v) => !v)}
          className="inline-flex items-center gap-2 text-xs font-medium px-3 py-1.5 rounded-lg border border-rule bg-paper hover:bg-ink hover:text-background transition-all cursor-pointer"
        >
          <WrenchIcon className="w-3.5 h-3.5" />
          {isOpen ? "收起" : (activeConfig ? "修改配置" : "配置模型")}
        </button>

        {activeConfig && (
          <button
            onClick={() => clearMutation.mutate()}
            disabled={clearMutation.isPending}
            className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border border-rule/60 text-ink-soft hover:border-destructive hover:text-destructive hover:bg-destructive/5 transition-all cursor-pointer disabled:opacity-50"
          >
            <XCircleIcon className="w-3.5 h-3.5" />
            {clearMutation.isPending ? "清除中…" : "恢复 .env 默认"}
          </button>
        )}

        {activeConfig && (
          <span className="text-[11px] text-ink-faint">
            Key：{activeConfig.apiKeyMasked}
          </span>
        )}
      </div>

      {/* Expanded panel */}
      {isOpen && (
        <div className="mt-3 p-4 rounded-2xl border border-amber-500/30 bg-amber-500/5 space-y-4 animate-in fade-in slide-in-from-top-1 duration-200">

          {/* Notice */}
          <div className="flex gap-2 p-2.5 rounded-lg bg-amber-50 border border-amber-200 text-[11px] text-amber-800 leading-relaxed">
            <span>🌐</span>
            <span>保存后全站立即生效——所有用户（含手机端访客）的 AI 识别都将使用您选择的模型。</span>
          </div>

          {/* Provider tabs */}
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

          {/* API Key */}
          <div>
            <label className="block text-xs font-semibold text-ink-soft mb-1.5">
              API Key
            </label>
            <div className="relative">
              <input
                id="admin-ai-api-key"
                type={showKey ? "text" : "password"}
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder={meta.placeholder}
                className="w-full pr-10 pl-3 py-2 text-xs rounded-lg border border-rule bg-background font-mono focus:outline-none focus:border-amber-400 transition-colors"
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

          {/* Model */}
          <div>
            <label className="block text-xs font-semibold text-ink-soft mb-1.5">模型</label>
            {meta.models.length > 0 ? (
              <select
                id="admin-ai-model-select"
                value={customModel ? "__custom__" : model}
                onChange={(e) => {
                  if (e.target.value === "__custom__") {
                    setCustomModel(" ");
                  } else {
                    setModel(e.target.value);
                    setCustomModel("");
                  }
                }}
                className="w-full px-3 py-2 text-xs rounded-lg border border-rule bg-background focus:outline-none focus:border-amber-400 transition-colors cursor-pointer"
              >
                {meta.models.map((m) => (
                  <option key={m} value={m}>{m}</option>
                ))}
                <option value="__custom__">✏️ 手动输入其他模型名…</option>
              </select>
            ) : null}
            {(meta.models.length === 0 || customModel !== "") && (
              <input
                id="admin-ai-model-custom"
                type="text"
                value={customModel.trim() || model}
                onChange={(e) => setCustomModel(e.target.value)}
                placeholder="例：deepseek-vision / qwen-vl-plus"
                className="mt-1.5 w-full px-3 py-2 text-xs rounded-lg border border-rule bg-background font-mono focus:outline-none focus:border-amber-400 transition-colors"
              />
            )}
          </div>

          {/* Base URL (only for providers that need it) */}
          {meta.needsBaseUrl && (
            <div>
              <label className="block text-xs font-semibold text-ink-soft mb-1.5">
                API Base URL
                <span className="ml-1.5 font-normal text-ink-faint">（中转 / 代理 / 自定义接口）</span>
              </label>
              <input
                id="admin-ai-base-url"
                type="text"
                value={baseUrl}
                onChange={(e) => setBaseUrl(e.target.value)}
                placeholder="https://api.openai.com/v1"
                className="w-full px-3 py-2 text-xs rounded-lg border border-rule bg-background font-mono focus:outline-none focus:border-amber-400 transition-colors"
              />
              <p className="mt-1 text-[11px] text-ink-faint">兼容硅基流动、One API、阿里通义千问等 OpenAI 格式接口</p>
            </div>
          )}

          {/* Preview */}
          <div className="p-2.5 rounded-lg bg-background border border-rule/50 text-[11px] text-ink-soft font-mono">
            Provider: <strong>{provider}</strong> &nbsp;|&nbsp; Model: <strong>{effectiveModel || "（未填）"}</strong>
            {meta.needsBaseUrl && baseUrl && <> &nbsp;|&nbsp; URL: <strong>{baseUrl}</strong></>}
          </div>

          {/* Actions */}
          <div className="flex gap-2">
            <button
              id="admin-model-save-btn"
              onClick={() => saveMutation.mutate()}
              disabled={saveMutation.isPending}
              className="flex-1 py-2 text-xs font-bold rounded-lg bg-amber-500 text-white hover:bg-amber-600 transition-all cursor-pointer disabled:opacity-60"
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

// ── Page ─────────────────────────────────────────────────────────────────────

function IdentifyPage() {
  const { user } = useAuth();

  const { data: role = null } = useQuery({
    queryKey: ["user-role", user?.id],
    enabled: !!user,
    queryFn: async () => {
      if (!user) return null;
      const { data } = await supabase.from("user_roles").select("role").eq("user_id", user.id);
      if (data?.some((r) => r.role === "admin")) return "admin";
      if (data?.some((r) => r.role === "editor")) return "editor";
      return null;
    },
  });

  const isEditorOrAdmin = role === "editor" || role === "admin";
  const isAdmin = role === "admin";

  const { data: drafts = [] } = useQuery({
    queryKey: ["identify-drafts-all"],
    queryFn: () => fetchPendingDrafts(200),
    enabled: isEditorOrAdmin,
  });

  return (
    <div className="min-h-screen flex flex-col">
      <SiteHeader />
      <main className="mx-auto max-w-6xl px-6 py-10 flex-1 w-full">
        <header className="mb-8 border-b-2 border-ink pb-6">
          <p className="label text-vermilion mb-2">AI copilot · Plantspedia</p>
          <h1 className="font-display text-3xl md:text-5xl font-bold tracking-tight">AI 识别植物</h1>
          <p className="text-ink-soft mt-3 max-w-none">
            拍一张照片或从相册选择，AI 会自动识别物种并生成一份中英双语科普草稿，等待编辑审核后正式收录。
          </p>
        </header>

        {/* Admin-only model switcher — visible only to admin role */}
        {isAdmin && <AdminModelPanel />}

        {/* Admin-only professional plant-ID engine (Pl@ntNet) */}
        {isAdmin && <PlantNetPanel />}

        {/* Admin-only 小P蛙 agent model config */}
        {isAdmin && <XiaoPModelPanel />}

        <CameraIdentify />

        {isEditorOrAdmin && (
          <section className="mt-12 border-t border-rule pt-8">
            <div className="flex items-baseline justify-between mb-4">
              <div>
                <p className="label text-vermilion">待审草稿 · Pending AI Drafts</p>
                <p className="text-xs text-ink-faint mt-1">仅编辑与管理员可见，点击右上角红色按钮进入详情审核</p>
              </div>
              <span className="text-xs text-ink-faint">{drafts.length} 份待审</span>
            </div>
            {drafts.length === 0 ? (
              <p className="text-ink-faint text-sm py-12 text-center border border-dashed border-rule">
                目前没有待审草稿。
              </p>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {drafts.map((d) => (
                  <DraftCard key={d.id} draft={d} showPendingBadge />
                ))}
              </div>
            )}
          </section>
        )}

        {/* Admin-only: AI token usage statistics */}
        {isAdmin && <AdminUsagePanel />}

        {!isEditorOrAdmin && (
          <p className="text-xs text-ink-faint mt-10 text-center">
            草稿提交后会进入编辑审核队列，通过后将公开收录在站点档案中。
            {!user && (
              <>
                {" · "}
                <Link to="/login" className="hover:text-vermilion underline">编辑登录</Link>
              </>
            )}
          </p>
        )}
      </main>
      <SiteFooter />
    </div>
  );
}

// ── Admin Usage Panel ─────────────────────────────────────────────────────────

function AdminUsagePanel() {
  const fetchFn = useServerFn(fetchAiUsageFn);
  const [page, setPage] = useState(0);
  const PAGE_SIZE = 50;

  const { data, isLoading, refetch } = useQuery({
    queryKey: ["ai-usage", page],
    queryFn: () =>
      fetchFn({ data: { limit: PAGE_SIZE, offset: page * PAGE_SIZE } }),
    retry: false,
  });

  const fmt = (n: number) =>
    n >= 1_000_000 ? `${(n / 1_000_000).toFixed(2)}M` : n >= 1_000 ? `${(n / 1_000).toFixed(1)}K` : String(n);

  const providerColor: Record<string, string> = {
    gemini: "text-blue-600 bg-blue-50 border-blue-200",
    openai: "text-emerald-600 bg-emerald-50 border-emerald-200",
    anthropic: "text-amber-700 bg-amber-50 border-amber-200",
    custom: "text-purple-600 bg-purple-50 border-purple-200",
    lovable: "text-pink-600 bg-pink-50 border-pink-200",
  };

  return (
    <section className="mt-12 border-t border-rule pt-8 animate-in fade-in slide-in-from-bottom-2 duration-300">
      <div className="flex items-baseline justify-between mb-4">
        <div>
          <p className="label text-vermilion">AI 用量统计 · Token Usage</p>
          <p className="text-xs text-ink-faint mt-1">记录每次识别消耗的 token 量、使用者、地点与草稿内容</p>
        </div>
        <button
          onClick={() => refetch()}
          className="text-xs px-2.5 py-1 rounded-lg border border-rule text-ink-soft hover:bg-ink hover:text-background transition-all cursor-pointer"
        >
          刷新
        </button>
      </div>

      {/* Summary stat cards */}
      {data && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
          <div className="p-3 rounded-xl border border-rule bg-paper/60 text-center">
            <p className="text-2xl font-bold font-mono">{data.stats.total_calls}</p>
            <p className="text-[11px] text-ink-faint mt-1">总识别次数</p>
          </div>
          <div className="p-3 rounded-xl border border-rule bg-paper/60 text-center">
            <p className="text-2xl font-bold font-mono text-vermilion">{fmt(data.stats.total_tokens)}</p>
            <p className="text-[11px] text-ink-faint mt-1">累计 Tokens</p>
          </div>
          {Object.entries(data.stats.by_provider).slice(0, 2).map(([p, s]) => (
            <div key={p} className="p-3 rounded-xl border border-rule bg-paper/60 text-center">
              <p className="text-2xl font-bold font-mono">{s.calls}</p>
              <p className="text-[11px] text-ink-faint mt-1">{p} 调用</p>
              <p className="text-[10px] text-ink-faint">{fmt(s.tokens)} tokens</p>
            </div>
          ))}
        </div>
      )}

      {/* Model breakdown */}
      {data && Object.keys(data.stats.by_model).length > 0 && (
        <div className="mb-4 flex flex-wrap gap-2">
          {Object.entries(data.stats.by_model)
            .sort((a, b) => b[1].tokens - a[1].tokens)
            .map(([m, s]) => (
              <span key={m} className="inline-flex items-center gap-1.5 text-[11px] px-2 py-1 rounded-full border border-rule bg-paper font-mono">
                <strong>{m}</strong>
                <span className="text-ink-faint">· {s.calls}次 · {fmt(s.tokens)} tok</span>
              </span>
            ))}
        </div>
      )}

      {/* Log table */}
      {isLoading ? (
        <p className="text-ink-faint text-sm py-8 text-center">加载中…</p>
      ) : !data || data.rows.length === 0 ? (
        <p className="text-ink-faint text-sm py-8 text-center border border-dashed border-rule rounded-xl">
          暂无用量记录。识别成功后自动写入。
        </p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-rule">
          <table className="w-full text-xs">
            <thead className="bg-paper-deep/60 border-b border-rule">
              <tr>
                {["时间", "用户", "地点", "模型", "服务商", "输入", "输出", "合计", "草稿"].map((h) => (
                  <th key={h} className="px-3 py-2.5 text-left font-semibold text-ink-soft whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {(data.rows as Array<Record<string, unknown>>).map((r, i) => (
                <tr key={String(r.id)} className={`border-b border-rule/50 hover:bg-paper/40 transition-colors ${i % 2 === 0 ? "" : "bg-paper/20"}`}>
                  <td className="px-3 py-2 text-ink-faint whitespace-nowrap font-mono">
                    {new Date(String(r.created_at)).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })}
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap max-w-[100px] truncate" title={String(r.user_label ?? "")}>
                    <span className={`inline-flex items-center gap-1 ${r.user_id ? "text-ink" : "text-ink-faint"}`}>
                      {r.user_id ? "👤" : "👻"} {String(r.user_label ?? "访客")}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-ink-soft max-w-[120px] truncate" title={String(r.capture_place ?? "")}>
                    {r.capture_place ? displayPlace(String(r.capture_place)) : <span className="text-ink-faint">—</span>}
                  </td>
                  <td className="px-3 py-2 font-mono text-ink-soft max-w-[140px] truncate" title={String(r.model ?? "")}>
                    {String(r.model ?? "—")}
                  </td>
                  <td className="px-3 py-2">
                    <span className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-semibold border ${providerColor[String(r.provider)] ?? "text-ink-faint bg-rule/10 border-rule"}`}>
                      {String(r.provider ?? "—")}
                    </span>
                  </td>
                  <td className="px-3 py-2 font-mono text-right text-ink-soft">{fmt(Number(r.prompt_tokens ?? 0))}</td>
                  <td className="px-3 py-2 font-mono text-right text-ink-soft">{fmt(Number(r.completion_tokens ?? 0))}</td>
                  <td className="px-3 py-2 font-mono text-right font-bold text-vermilion">{fmt(Number(r.total_tokens ?? 0))}</td>
                  <td className="px-3 py-2 max-w-[120px] truncate" title={String(r.draft_title ?? "")}>
                    {r.draft_id ? (
                      <Link to="/drafts/$id" params={{ id: String(r.draft_id) }} className="hover:text-vermilion underline">
                        {String(r.draft_title ?? r.draft_id).slice(0, 12)}…
                      </Link>
                    ) : <span className="text-ink-faint">—</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Pagination */}
      {data && data.total > PAGE_SIZE && (
        <div className="flex items-center justify-between mt-3">
          <span className="text-xs text-ink-faint">共 {data.total} 条记录</span>
          <div className="flex gap-2">
            <button
              disabled={page === 0}
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              className="text-xs px-3 py-1.5 rounded-lg border border-rule disabled:opacity-40 hover:bg-ink hover:text-background transition-all cursor-pointer"
            >
              上一页
            </button>
            <span className="text-xs text-ink-faint px-2 py-1.5">第 {page + 1} / {Math.ceil(data.total / PAGE_SIZE)} 页</span>
            <button
              disabled={(page + 1) * PAGE_SIZE >= data.total}
              onClick={() => setPage((p) => p + 1)}
              className="text-xs px-3 py-1.5 rounded-lg border border-rule disabled:opacity-40 hover:bg-ink hover:text-background transition-all cursor-pointer"
            >
              下一页
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

// ── Icons ──────────────────────────────────────────────────────────────────

function WrenchIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"
      strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
    </svg>
  );
}

function XCircleIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"
      strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <circle cx="12" cy="12" r="10" />
      <path d="m15 9-6 6" />
      <path d="m9 9 6 6" />
    </svg>
  );
}

function LeafIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"
      strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <path d="M11 20A7 7 0 0 1 9.8 6.1C15.5 5 17 4.48 19 2c1 2 2 4.18 2 8 0 5.5-4.78 10-10 10Z" />
      <path d="M2 21c0-3 1.85-5.36 5.08-6" />
    </svg>
  );
}

function EyeIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"
      strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function EyeOffIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"
      strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <path d="M9.88 9.88a3 3 0 1 0 4.24 4.24" />
      <path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68" />
      <path d="M6.61 6.61A13.526 13.526 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61" />
      <line x1="2" x2="22" y1="2" y2="22" />
    </svg>
  );
}
