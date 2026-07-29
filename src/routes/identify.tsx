import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState, useEffect, useRef } from "react";
import { useServerFn } from "@tanstack/react-start";
import { SiteHeader, SiteFooter } from "@/components/site-header";
import { CameraIdentify } from "@/components/camera-identify";
import { ModelQueueConsole } from "@/components/model-queue-console";
import { DraftCard } from "@/components/draft-card";
import { fetchPendingDrafts } from "@/lib/drafts";
import { checkKeyHealthFn, type KeyHealth } from "@/lib/key-health.functions";
import { displayPlace } from "@/lib/editor-stats";
import { useAuth } from "@/hooks/use-auth";
import { supabase } from "@/integrations/supabase/client";
import {
  listProviderModelsFn,
  fetchAiUsageFn,
  savePlantNetKeyFn,
  getPlantNetKeyFn,
  clearPlantNetKeyFn,
  saveSecondOpinionConfigFn,
  getSecondOpinionConfigFn,
  clearSecondOpinionConfigFn,
  testIdentifyEnginesFn,
  listVisionModelsFn,
} from "@/lib/identify-plant.functions";
import { XiaoPModelPanel } from "@/components/xiaop-model-panel";
import { GoldSkillPanel } from "@/components/gold-skill-panel";
import { toast } from "sonner";
import { explainError } from "@/lib/explain-error";
import { normalizeBaseUrl } from "@/lib/ai-base-url";

export const Route = createFileRoute("/identify")({
  // Retake context carried from a draft's「去补拍」: retake=第几次补拍, st=物种中文名, ss=学名。
  // pick=1 → 让用户在「打开相机」和「选择相册图片」之间自己选（不自动弹相机）。走「草稿内容
  // 和我的观察不符」进来时用；「按提示去补拍」仍然直接弹相机（少一次点击）。
  validateSearch: (
    search: Record<string, unknown>,
  ): { retake?: number; st?: string; ss?: string; nmp?: string; md?: string; pick?: number } => ({
    retake:
      search.retake != null && Number(search.retake) > 0
        ? Math.min(10, Math.floor(Number(search.retake)))
        : undefined,
    st: typeof search.st === "string" ? search.st.slice(0, 200) : undefined,
    ss: typeof search.ss === "string" ? search.ss.slice(0, 200) : undefined,
    nmp: typeof search.nmp === "string" ? search.nmp.slice(0, 300) : undefined,
    md: typeof search.md === "string" ? search.md.slice(0, 64) : undefined,
    pick: Number(search.pick) === 1 ? 1 : undefined,
  }),
  head: () => ({
    meta: [
      { title: "AI 识别植物 · Plantspedia" },
      {
        name: "description",
        content: "上传或拍摄一张植物照片，由 AI 识别物种并自动生成中英双语草稿。",
      },
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

// ── Admin Pl@ntNet Panel ─────────────────────────────────────────────────────

function PlantNetPanel() {
  const qc = useQueryClient();
  const [isOpen, setIsOpen] = useState(false);
  const [apiKey, setApiKey] = useState("");
  const [showKey, setShowKey] = useState(false);

  const saveFn = useServerFn(savePlantNetKeyFn);
  const getFn = useServerFn(getPlantNetKeyFn);
  const clearFn = useServerFn(clearPlantNetKeyFn);
  const healthFn = useServerFn(checkKeyHealthFn);
  const [health, setHealth] = useState<KeyHealth | null>(null);

  const healthMutation = useMutation({
    // 传入框里正在编辑的 key（还没保存也能先测）；为空则服务端回落到库里已保存的那个。
    mutationFn: () =>
      healthFn({
        data: { target: "plantnet" as const, apiKey: apiKey.replace(/\s+/g, "") || undefined },
      }) as Promise<KeyHealth>,
    onSuccess: (r) => setHealth(r),
    onError: (e: unknown) =>
      setHealth({
        ok: false,
        detail: explainError(e, { action: "检测 Pl@ntNet Key" }),
        remaining: null,
        limit: null,
      }),
  });

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
    onError: (e: Error) =>
      toast.error(explainError(e, { action: "保存 Pl@ntNet 配置" }), { duration: 10000 }),
  });

  const clearMutation = useMutation({
    mutationFn: () => clearFn({ data: undefined }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["plantnet-key"] });
      toast.success("已停用 Pl@ntNet（识别回退为纯大模型）");
    },
    onError: (e: Error) =>
      toast.error(explainError(e, { action: "停用 Pl@ntNet" }), { duration: 10000 }),
  });

  return (
    <div className="mb-6 animate-in fade-in slide-in-from-top-2 duration-300">
      {/* Header row */}
      <div className="flex items-center gap-3 mb-2">
        <span className="text-[11px] font-semibold tracking-widest uppercase text-ink-faint">
          管理员 · 专业识别引擎 Pl@ntNet
        </span>
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
          {isOpen ? "收起" : active ? "修改 Key" : "配置 Pl@ntNet"}
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
            <span>
              启用后，拍照识别会先由 Pl@ntNet
              专业定种（带置信度），再交给上方所选大模型撰写双语草稿——全站立即生效，无需重新部署。
            </span>
          </div>
          <div>
            <label className="block text-xs font-semibold text-ink-soft mb-1.5">
              Pl@ntNet API Key
            </label>
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
                {showKey ? (
                  <EyeOffIcon className="w-3.5 h-3.5" />
                ) : (
                  <EyeIcon className="w-3.5 h-3.5" />
                )}
              </button>
            </div>
            <p className="mt-1 text-[11px] text-ink-faint">
              在 my.plantnet.org 免费注册获取（每日 500 次额度）。Key 加密存储在服务端数据库。
            </p>
          </div>
          {/* 独立的「连通 + 配额」体检。以前 Pl@ntNet 的每日 500 次额度是个黑盒 —— 只有识别
              撞上 429 的那一刻才知道用光了。这里按需查（不做轮询：查询本身也走它的网关）。 */}
          <div className="mb-2">
            <button
              onClick={() => healthMutation.mutate()}
              disabled={healthMutation.isPending}
              className="w-full py-2 text-xs rounded-lg border border-emerald-600/50 text-emerald-700 hover:bg-emerald-600 hover:text-white transition-all cursor-pointer disabled:opacity-60"
            >
              {healthMutation.isPending ? "检测中…" : "检测连通性与剩余额度"}
            </button>
            {health && (
              <div
                className={`mt-2 text-[11px] leading-relaxed rounded-lg p-2 border ${
                  health.ok
                    ? "border-emerald-600/40 bg-emerald-500/10 text-emerald-800"
                    : "border-red-500/40 bg-red-500/10 text-red-700"
                }`}
              >
                <p>
                  {health.ok ? "✅ " : "❌ "}
                  {health.detail}
                </p>
                {health.localState && <p className="mt-1 opacity-80">· {health.localState}</p>}
              </div>
            )}
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

// ── Admin 二次复核模型 Panel ──────────────────────────────────────────────────
// 识别判为「疑似」时，先让第二个视觉模型复核一遍；它有把握就直接出确诊卡、跳过补拍，
// 它同样没把握才进补拍。**厂商无关**：任何提供 OpenAI 兼容 /chat/completions 的服务都能用，
// 换厂商只改 apiKey + baseUrl + model 三个字段，不用改代码。

const SECOND_OPINION_BASE_PLACEHOLDER = "https://ark.cn-beijing.volces.com/api/v3";

/** 常见厂商的 OpenAI 兼容端点预设 —— 免得管理员去翻各家文档找 base URL。 */
const VISION_VENDOR_PRESETS: { label: string; baseUrl: string; hint: string }[] = [
  {
    label: "火山方舟(豆包)",
    baseUrl: "https://ark.cn-beijing.volces.com/api/v3",
    hint: "模型如 doubao-*-vision-*；账号未开通直调时填推理接入点 ep-…",
  },
  {
    label: "阿里 DashScope(通义千问)",
    baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    hint: "模型如 qwen-vl-max / qwen-vl-plus",
  },
  {
    label: "OpenAI",
    baseUrl: "https://api.openai.com/v1",
    hint: "模型如 gpt-4o",
  },
  {
    label: "智谱 GLM",
    baseUrl: "https://open.bigmodel.cn/api/paas/v4",
    hint: "模型如 glm-4v / glm-4.5v",
  },
];

/** 引擎自检 —— 独立于任何一个模型面板。
 *  它测的是「Pl@ntNet + 疑似复核模型」这两个**定种引擎**串起来通不通，跨越了两块配置，
 *  所以挂在复核模型面板里名不副实（用户会以为只测复核模型）。现在收到「三重奏」栏末尾，
 *  位置对应它的语义：三块都配完了，最后跑一次端到端验证。 */
function EngineSelfTestPanel() {
  const testFn = useServerFn(testIdentifyEnginesFn);

  type ChainStep = { label: string; ok: boolean; detail: string };
  type EngineTest = {
    plantnet: { ok: boolean; detail: string };
    review: { ok: boolean; detail: string };
    card: { ok: boolean; detail: string };
    chains: { name: string; ok: boolean; steps: ChainStep[]; note: string }[];
    plantNetQuotaFlagged: boolean;
    sample: string;
  };
  const [testResult, setTestResult] = useState<EngineTest | null>(null);

  const testMutation = useMutation({
    mutationFn: async () => (await testFn({ data: undefined })) as EngineTest,
    onSuccess: (r) => setTestResult(r),
    onError: (e: Error) =>
      toast.error(explainError(e, { action: "引擎自检" }), { duration: 10000 }),
  });

  return (
    <div className="mt-2 pt-4 border-t border-rule/50">
      <div className="flex items-center gap-3 mb-2">
        <span className="text-[11px] font-semibold tracking-widest uppercase text-ink-faint">
          三重奏 · 链路自检
        </span>
        <div className="flex-1 h-px bg-rule/50" />
      </div>
      <p className="text-[11px] text-ink-faint leading-relaxed mb-2">
        用站内一张<b>真实植物照片</b>跑三条**端到端链路**（不是只 ping key），每条对应识别时的一种
        真实走法 —— 只报「引擎通不通」是不够的，出卡模型不通照样出不了卡。
      </p>
      <button
        onClick={() => testMutation.mutate()}
        disabled={testMutation.isPending}
        className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border border-rule bg-paper hover:bg-ink hover:text-background transition-all cursor-pointer disabled:opacity-50"
      >
        {testMutation.isPending ? "自检中…" : "自检三条链路"}
      </button>

      {testResult && (
        <div className="mt-3 p-3 rounded-xl border border-rule bg-paper space-y-2 text-[11px] leading-relaxed">
          <div className="font-semibold text-ink-soft">
            链路自检结果{testResult.sample ? `（样本：${testResult.sample}）` : ""}
          </div>
          {/* 按**运行时真实链路**分组，而不是罗列孤立的引擎。以前只报「Pl@ntNet / 复核模型」
              两个点，两个都 ✅ 也仍然回答不了「拍一张照到底能不能出卡」—— 因为出卡模型
              那一环根本没被测到。 */}
          {(testResult.chains ?? []).map((c) => (
            <div key={c.name} className="rounded-lg border border-rule/70 p-2">
              <div className="flex gap-2 items-start">
                <span className={c.ok ? "text-emerald-600" : "text-destructive"}>
                  {c.ok ? "✅" : "❌"}
                </span>
                <div className="flex-1">
                  <div className="font-semibold text-ink-soft">{c.name}</div>
                  <div className="text-ink-faint mt-0.5">{c.note}</div>
                  <div className="mt-1 space-y-0.5">
                    {c.steps.map((s) => (
                      <div key={s.label} className="flex gap-1.5">
                        <span className={s.ok ? "text-emerald-600" : "text-destructive"}>
                          {s.ok ? "•" : "×"}
                        </span>
                        <span>
                          <b>{s.label}</b>：{s.detail}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          ))}
          {testResult.plantNetQuotaFlagged && (
            <div className="pt-1 text-amber-700">
              ⚠️ Pl@ntNet 当前被标记为「额度已用尽」，识别正由二次复核模型顶一线；额度重置后最迟 1
              小时自动切回。
            </div>
          )}
          <div className="pt-1 text-ink-faint">
            提示：Pl@ntNet 不消耗 token，所以它<b>不会</b>在用量统计里出现独立记录；它是否参与要看
            provider 列的前缀（如 <code>plantnet+gemini-quick</code>）。
          </div>
        </div>
      )}
    </div>
  );
}

function SecondOpinionPanel() {
  const qc = useQueryClient();
  const [isOpen, setIsOpen] = useState(false);
  const [apiKey, setApiKey] = useState("");
  const [model, setModel] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [showKey, setShowKey] = useState(false);

  const saveFn = useServerFn(saveSecondOpinionConfigFn);
  const getFn = useServerFn(getSecondOpinionConfigFn);
  const clearFn = useServerFn(clearSecondOpinionConfigFn);

  const modelsFn = useServerFn(listVisionModelsFn);
  type ModelList = {
    ok: boolean;
    total: number;
    hint: string;
    models: { id: string; callable: boolean; note: string }[];
  };
  const [modelList, setModelList] = useState<ModelList | null>(null);

  const modelsMutation = useMutation({
    // 用输入框里的值（还没保存也能试），留空则回退到库里已存的配置。
    mutationFn: async () =>
      (await modelsFn({
        data: {
          apiKey: apiKey.replace(/\s+/g, "") || undefined,
          baseUrl: baseUrl.trim() || undefined,
        },
      })) as ModelList,
    onSuccess: (r) => {
      setModelList(r);
      const usable = r.models.filter((m) => m.callable).length;
      if (usable) toast.success(`实测到 ${usable} 个可用的视觉模型`);
      else toast.warning("没有可直接调用的视觉模型，需创建推理接入点（ep-…）");
    },
    onError: (e: Error) =>
      toast.error(explainError(e, { action: "拉取模型" }), { duration: 10000 }),
  });

  const { data: active, isLoading } = useQuery({
    queryKey: ["second-opinion-config"],
    queryFn: () => getFn({ data: undefined }),
    retry: false,
  });

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!apiKey.trim()) throw new Error("请填写 API Key");
      if (!model.trim()) throw new Error("请填写模型 ID 或推理接入点 ID");
      await saveFn({
        data: {
          apiKey: apiKey.replace(/\s+/g, ""),
          model: model.trim(),
          baseUrl: baseUrl.trim() || undefined,
        },
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["second-opinion-config"] });
      toast.success("✅ 二次复核已启用——疑似结果会先复核再决定是否补拍");
      setIsOpen(false);
      setApiKey("");
    },
    onError: (e: Error) =>
      toast.error(explainError(e, { action: "保存复核模型配置" }), { duration: 10000 }),
  });

  const clearMutation = useMutation({
    mutationFn: () => clearFn({ data: undefined }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["second-opinion-config"] });
      toast.success("已停用二次复核（疑似结果直接进补拍）");
    },
    onError: (e: Error) =>
      toast.error(explainError(e, { action: "停用复核模型" }), { duration: 10000 }),
  });

  return (
    <div className="mb-6 animate-in fade-in slide-in-from-top-2 duration-300">
      <div className="flex items-center gap-3 mb-2">
        <span className="text-[11px] font-semibold tracking-widest uppercase text-ink-faint">
          管理员 · 疑似复核模型（可换任意厂商）
        </span>
        <div className="flex-1 h-px bg-rule/50" />
        {isLoading ? (
          <span className="text-[11px] text-ink-faint">加载中…</span>
        ) : active ? (
          <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold px-2.5 py-1 rounded-full bg-sky-500/10 text-sky-600 border border-sky-500/25">
            <span className="w-1.5 h-1.5 rounded-full bg-sky-500 animate-pulse" />
            已启用 · {active.model || active.apiKeyMasked}
          </span>
        ) : (
          <span className="inline-flex items-center gap-1.5 text-[11px] text-ink-faint px-2.5 py-1 rounded-full border border-rule/50">
            未启用（疑似直接进补拍）
          </span>
        )}
      </div>

      <div className="flex items-center gap-2 flex-wrap">
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

      {/* 配置表单与「AI 模型」「小P蛙」两个控制台共用同一套「优先调用序列」机制。
          上面的启用状态是复核模型独有的，保留在这里；引擎自检已上移到三重奏栏末尾。 */}
      <ModelQueueConsole
        consoleId="second_opinion"
        visionProbe
        title="疑似复核模型 · 优先调用序列"
        openLabel="配置复核模型"
        intro={
          <p className="text-[11px] text-ink-faint leading-relaxed">
            这个模型承担<b>两个角色</b>：①<b>疑似复核</b>——识别判为「疑似」时先让它独立复核，
            有把握就直接出确诊卡、<b>跳过补拍</b>；②<b>顶替 Pl@ntNet</b>——Pl@ntNet 每日免费额度
            用尽后由它承担一线专业定种。必须是<b>多模态（视觉）</b>模型，纯文本模型无法复核照片。
          </p>
        }
      />
    </div>
  );
}

// ── Admin Model Panel ────────────────────────────────────────────────────────

// ── 模型配置总开关 ───────────────────────────────────────────────────────────
// 识别页原本平铺着五块管理员面板，等于每次进来都要先滚过一屏配置才能拍照。
// 现在全部收进一个「配置 AI 模型」按钮，默认收起。

/**
 * 「识别复核出卡AI三重奏」—— 拍一张照片到出分享卡，全程只由这三块决定，
 * 所以它们必须放在一起看、一起调，且排在配置区第一位。
 *
 * 三重奏 = ① Pl@ntNet（专业定种引擎）② 疑似复核视觉模型（顶一线 + 复核）
 *          ③ 出卡AI（写出简介摘要卡 / 分享卡）。
 * 「草稿生成」「小P蛙」不在此列 —— 它们是出卡**之后**的事，慢一点无所谓，
 * 把它们混进来正是之前调参调乱的原因。
 *
 * ③ 以前直接借用「AI 模型控制台」，导致「一线出卡」和「其它杂项」共用一套配置、
 * 动一个必然影响另一个。现在它有了自己的控制台（consoleId="card"），
 * 「AI 模型控制台」已移出本折叠栏、降级为兜底 + 批量导入元数据提取。
 */
function IdentifyTrioSection() {
  const [open, setOpen] = useState(true);
  return (
    <div className="mb-4 rounded-xl border border-leaf-deep/30 bg-leaf-deep/[0.03]">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-2 px-3 py-2.5 text-xs font-semibold text-left cursor-pointer"
      >
        <LeafIcon className="w-3.5 h-3.5 text-leaf-deep" />
        识别复核出卡AI三重奏
        <span className="ml-auto opacity-60 font-normal">{open ? "▲ 收起" : "▼ 展开"}</span>
      </button>
      {open && (
        <div className="px-3 pb-3 animate-in fade-in slide-in-from-top-1 duration-200">
          <p className="text-[11px] text-ink-faint leading-relaxed mb-3">
            <b>这三块决定「拍照 → 出简介摘要卡 / 分享卡」的全部速度与准确度</b>，请只在这里调它们：
            ①<b>Pl@ntNet</b> 专业定种打头阵 → ②<b>疑似复核视觉模型</b>（Pl@ntNet
            拿不到结果时顶一线， 识别判「疑似」时二次判定）→ ③<b>出卡AI</b> 写卡。
            <br />
            ⚠️ 快速出卡那条链路<b>只会调用序列里的 Gemini 项</b>，其它厂商（Kimi
            等）在这条链路上会被 跳过；把它们放进来只会在 Gemini
            全部失效时才顶上，那一次必然又慢又贵。想用 Kimi 写长文， 请配到下面的
            <b>「草稿生成模型控制台」</b>。
          </p>
          <PlantNetPanel />
          <SecondOpinionPanel />
          <CardModelPanel />
          <EngineSelfTestPanel />
        </div>
      )}
    </div>
  );
}

function AdminModelHub() {
  const [open, setOpen] = useState(false);
  return (
    <div className="mb-6">
      <button
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-2 text-xs font-medium px-3 py-1.5 rounded-lg border border-rule bg-paper hover:bg-ink hover:text-background transition-all cursor-pointer"
      >
        <WrenchIcon className="w-3.5 h-3.5" />
        配置 AI 模型
        <span className="opacity-60">{open ? "▲ 收起" : "▼ 展开"}</span>
      </button>
      {open && (
        <div className="mt-3 border border-rule rounded-md p-4 bg-paper/40 space-y-2 animate-in fade-in slide-in-from-top-1 duration-200">
          <p className="text-[11px] text-ink-faint leading-relaxed mb-2">
            最上面的<b>三重奏</b>负责「拍照 → 出卡」这条一线链路；下面几块管的是出卡之后、
            或与出卡无关的事：<b>草稿生成</b>写整份科普草稿（银叶）、<b>小P蛙</b>负责对话与改写、
            <b>金叶详页模型</b>写公开档案页、<b>配图器官识别</b>决定分区能不能配上图、
            <b>AI 模型控制台</b>只兜底剩下的杂项。 每套都可配「优先调用序列」，前一个失败自动顺位。
            <br />
            最后一块<b>金叶详页 · 创作指导 Skill</b> 管的不是「用哪个模型」而是「按什么章法写」——
            粘一份 skill 进去，金叶详页就按它写，版本号会署在详页页尾。
          </p>
          <IdentifyTrioSection />
          <AdminModelPanel />
          <EnrichModelPanel />
          <XiaoPModelPanel />
          <OrganModelPanel />
          {/* 金叶两块相邻：先「用哪个模型」再「按什么章法写」。 */}
          <GoldModelPanel />
          <GoldSkillPanel />
        </div>
      )}
    </div>
  );
}

/**
 * 配图器官识别的模型 —— 2026-07-28 从小P蛙序列里拆出来。
 *
 * 拆的理由和金叶一样，但后果更隐蔽：器官识别是**机械的视觉打标签**，跟交互问答毫无关系，
 * 可它原来挂在小P蛙序列上。于是管理员在「小P蛙」里配了个纯文本模型，**全站配图当场归零**
 * ——而且不报错，只在日志里留一行，从控制台名字上完全想不到这两件事是连着的。
 */
function OrganModelPanel() {
  return (
    <ModelQueueConsole
      consoleId="organ"
      visionProbe
      title="管理员 · 配图器官识别模型"
      titleIcon={<WrenchIcon className="w-3.5 h-3.5" />}
      openLabel="配置配图器官识别模型"
      intro={
        <p className="text-[11px] text-ink-faint leading-relaxed">
          给每张候选配图<b>现看现标</b>它展示的是花 / 叶 / 果 / 植株 / 生境 —— 银叶草稿和金叶详页的
          分区<b>能不能配上图，全看这一步</b>。图源自带的器官标注覆盖率低到没法用，所以必须现看。
          <br />
          <b>必须是能读图的模型</b>：配成纯文本模型会让全站配图归零（认不出器官 = 一张也进不了槽），
          而且它不报错。建议配完点一下「视觉自检」。
          <br />
          <b>留空则自动沿用「出卡AI」的序列</b>（同样是「能读图 + 要快」的画像），不配也不会坏。
        </p>
      }
    />
  );
}

/**
 * 金叶详页的模型 —— 2026-07-28 从小P蛙序列里拆出来。
 *
 * 拆的理由：两者诉求正相反。小P蛙是**交互式问答/改稿**（要跟手、要便宜、常带图），
 * 金叶是**一次性写整份公开档案**（三轮调研 + 三轮撰稿，跑在队列的 15 分钟挂钟里）。
 * 共用一套必然互相将就：为小P蛙调快，金叶正文就变薄、还容易中途截断（GOLD_BAD_JSON）；
 * 为金叶调强，问答就变慢变贵。
 */
function GoldModelPanel() {
  return (
    <ModelQueueConsole
      consoleId="gold"
      visionProbe
      title="管理员 · 金叶详页模型"
      titleIcon={<WrenchIcon className="w-3.5 h-3.5" />}
      openLabel="配置金叶详页模型"
      intro={
        <p className="text-[11px] text-ink-faint leading-relaxed">
          点「金叶 skill 一键创建」时写整份<b>公开档案页</b>的模型 —— 三轮联网调研 + 三段长文，
          全站最重的一条链路。它<b>原来借用小P蛙的序列</b>，而小P蛙是为交互问答调的快模型，
          两边必然互相将就，所以现在拆开单独配。
          <br />
          <b>留空则自动沿用「草稿生成模型」的序列</b>（同属长文诉求，比借小P蛙合理），
          再留空才回退到「AI 模型控制台」，所以不配也不会坏。
        </p>
      }
    />
  );
}

function EnrichModelPanel() {
  return (
    <ModelQueueConsole
      consoleId="enrich"
      visionProbe
      title="管理员 · 草稿生成模型控制台"
      titleIcon={<WrenchIcon className="w-3.5 h-3.5" />}
      openLabel="配置草稿生成模型"
      intro={
        <p className="text-[11px] text-ink-faint leading-relaxed">
          点「进一步生成草稿」时写整份中英双语科普草稿的模型。它和一线识别的诉求不同 —— 识别要
          <b>快</b>、要便宜；写草稿要<b>长文能力</b>、能容忍慢，所以单独配一套。
          <b>留空则自动沿用「AI 模型控制台」的序列</b>，不配也不会坏。
        </p>
      }
    />
  );
}

/** 三重奏第三块：拍照之后写出简介摘要卡 / 分享卡的模型。 */
function CardModelPanel() {
  return (
    <ModelQueueConsole
      consoleId="card"
      visionProbe
      title="出卡AI"
      titleIcon={<WrenchIcon className="w-3.5 h-3.5" />}
      openLabel="配置出卡AI"
      intro={
        <p className="text-[11px] text-ink-faint leading-relaxed">
          拍照后<b>写出简介摘要卡 / 分享卡</b>的模型，三重奏的第三棒。保存后
          <b>全站立即生效</b> —— 所有用户（含手机端访客）出卡都走这里配置的序列。
          <br />
          <b>留空则自动沿用「AI 模型控制台」的序列</b>，所以不配也不会坏；想把出卡单独调快、
          调便宜，再来这里配。
        </p>
      }
    />
  );
}

/**
 * 兜底控制台。出卡 / 草稿生成 / 疑似复核 / 小P蛙 都已各自独立，这里只剩两件事，
 * 说明文案必须写清楚 —— 否则管理员会以为改这里能调识别，白折腾。
 */
function AdminModelPanel() {
  return (
    <ModelQueueConsole
      consoleId="ai"
      visionProbe
      title="管理员 · AI 模型控制台（兜底）"
      titleIcon={<WrenchIcon className="w-3.5 h-3.5" />}
      intro={
        <p className="text-[11px] text-ink-faint leading-relaxed">
          <b>不负责一线出卡</b>（那是上面三重奏里的「出卡AI」）。拆分之后它只管两件事：
          <br />①<b>批量导入条目时从 HTML 提取元数据</b>（管理后台「批量添加条目」的识别按钮，
          Gemini 专用，会把序列里所有 Gemini key 当轮换池用）；
          <br />②<b>兜底</b> —— 「出卡AI」「草稿生成模型」留空时，自动回退到这里的序列。
          <br />
          所以这里建议始终配一套<b>可用的通用 Gemini 序列</b>，别清空。
        </p>
      }
    />
  );
}

function IdentifyPage() {
  const { user } = useAuth();
  const { retake, st, ss, nmp, md, pick } = Route.useSearch();
  const retakeCtx =
    retake && retake > 0
      ? { count: retake, title: st, sci: ss, advice: nmp, mergeDraftId: md, pick: pick === 1 }
      : null;

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
          <h1 className="font-display text-3xl md:text-5xl font-bold tracking-tight">
            AI 识别植物
          </h1>
          <p className="text-ink-soft mt-3 max-w-none">
            拍一张照片或从相册选择，AI
            会自动识别物种并生成一份中英双语科普草稿，等待编辑审核后正式收录。
          </p>
        </header>

        {/* 所有模型配置收进一个开关 —— 五块面板平铺在识别页顶上，把「拍照」这个
            主任务挤到了折叠线以下。默认收起，要调再展开。 */}
        {isAdmin && <AdminModelHub />}

        <CameraIdentify retake={retakeCtx} />

        {isEditorOrAdmin && (
          <section className="mt-12 border-t border-rule pt-8">
            <div className="flex items-baseline justify-between mb-4">
              <div>
                <p className="label text-vermilion">待审草稿 · Pending AI Drafts</p>
                <p className="text-xs text-ink-faint mt-1">
                  仅编辑与管理员可见，点击右上角红色按钮进入详情审核
                </p>
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
                <Link to="/login" className="hover:text-vermilion underline">
                  编辑登录
                </Link>
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

// ── 用量总览 ─────────────────────────────────────────────────────────────────
// 原来只有四张「总次数 / 总 token」的卡，看不出钱花在哪。这里回答三个问题：
// ① 输入还是输出吃掉的？② 哪个环节吃的？③ 最近在涨还是在降？

const TASK_LABELS: Record<string, string> = {
  enrich_draft: "生成完整草稿",
  quick_identify: "快速识别出卡",
  identify: "识别",
  second_opinion: "疑似复核",
  xiaop: "小P蛙对话",
  unknown: "未标注",
};

function UsageBar({ input, output }: { input: number; output: number }) {
  const total = input + output;
  if (!total) return null;
  const ip = (input / total) * 100;
  return (
    <div className="flex h-2 w-full overflow-hidden rounded-full bg-paper-deep">
      <div className="bg-vermilion" style={{ width: `${ip}%` }} title={`输入 ${input}`} />
      <div className="bg-leaf-deep" style={{ width: `${100 - ip}%` }} title={`输出 ${output}`} />
    </div>
  );
}

function UsageOverview({ stats }: { stats: any }) {
  const fmtN = (n: number) =>
    n >= 1e6 ? `${(n / 1e6).toFixed(2)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}k` : String(n);
  const pct = (a: number, b: number) => (b ? Math.round((a / b) * 100) : 0);
  const tasks = Object.entries(stats.by_task ?? {})
    .map(([k, v]: any) => ({ key: k, ...v }))
    .sort((a, b) => b.tokens - a.tokens);
  const maxTask = tasks[0]?.tokens || 1;

  return (
    <div className="mb-6 space-y-4">
      {/* 三个时间窗：一眼看出最近在涨还是在降 */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: "近 24 小时", d: stats.window?.d1 },
          { label: "近 7 天", d: stats.window?.d7 },
          { label: "近 30 天", d: stats.window?.d30 },
          {
            label: "累计",
            d: {
              calls: stats.total_calls,
              tokens: stats.total_tokens,
              input: stats.total_input,
              output: stats.total_output,
            },
          },
        ].map(({ label, d }) => (
          <div key={label} className="p-3 rounded-xl border border-rule bg-paper/60">
            <p className="text-[11px] text-ink-faint">{label}</p>
            <p className="text-2xl font-bold font-mono text-vermilion leading-tight">
              {fmtN(d?.tokens ?? 0)}
            </p>
            <p className="text-[10px] text-ink-faint">tokens · {d?.calls ?? 0} 次调用</p>
            <div className="mt-1.5">
              <UsageBar input={d?.input ?? 0} output={d?.output ?? 0} />
            </div>
          </div>
        ))}
      </div>

      {/* 输入 / 输出构成 —— token 账单的大头几乎总是输入（每次都要塞照片 + 长 prompt） */}
      <div className="p-3 rounded-xl border border-rule bg-paper/60">
        <div className="flex items-baseline justify-between mb-2">
          <p className="text-[11px] font-semibold">Token 消耗构成</p>
          <p className="text-[10px] text-ink-faint">
            单次均耗 {fmtN(Math.round(stats.total_tokens / Math.max(stats.total_calls, 1)))} tokens
          </p>
        </div>
        <UsageBar input={stats.total_input} output={stats.total_output} />
        <div className="flex gap-4 mt-2 text-[11px]">
          <span className="inline-flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-sm bg-vermilion inline-block" />
            输入 {fmtN(stats.total_input)}（{pct(stats.total_input, stats.total_tokens)}%）
            <span className="text-ink-faint">照片 + prompt</span>
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-sm bg-leaf-deep inline-block" />
            输出 {fmtN(stats.total_output)}（{pct(stats.total_output, stats.total_tokens)}%）
            <span className="text-ink-faint">生成的正文</span>
          </span>
        </div>
      </div>

      {/* 按环节拆：到底是识别费还是写草稿费 */}
      {tasks.length > 0 && (
        <div className="p-3 rounded-xl border border-rule bg-paper/60">
          <p className="text-[11px] font-semibold mb-2">按环节拆分</p>
          <div className="space-y-2">
            {tasks.map((t) => (
              <div key={t.key}>
                <div className="flex items-baseline justify-between text-[11px]">
                  <span className="font-medium">{TASK_LABELS[t.key] ?? t.key}</span>
                  <span className="text-ink-faint font-mono">
                    {fmtN(t.tokens)} tok · {t.calls} 次 · 均{" "}
                    {fmtN(Math.round(t.tokens / Math.max(t.calls, 1)))}
                  </span>
                </div>
                <div className="h-1.5 w-full rounded-full bg-paper-deep overflow-hidden mt-1">
                  <div
                    className="h-full bg-vermilion/70"
                    style={{ width: `${Math.max((t.tokens / maxTask) * 100, 2)}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function AdminUsagePanel() {
  const fetchFn = useServerFn(fetchAiUsageFn);
  const [page, setPage] = useState(0);
  const PAGE_SIZE = 50;

  const { data, isLoading, refetch } = useQuery({
    queryKey: ["ai-usage", page],
    queryFn: () => fetchFn({ data: { limit: PAGE_SIZE, offset: page * PAGE_SIZE } }),
    retry: false,
  });

  const fmt = (n: number) =>
    n >= 1_000_000
      ? `${(n / 1_000_000).toFixed(2)}M`
      : n >= 1_000
        ? `${(n / 1_000).toFixed(1)}K`
        : String(n);

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
          <p className="text-xs text-ink-faint mt-1">
            记录每次识别消耗的 token 量、使用者、地点与草稿内容
          </p>
        </div>
        <button
          onClick={() => refetch()}
          className="text-xs px-2.5 py-1 rounded-lg border border-rule text-ink-soft hover:bg-ink hover:text-background transition-all cursor-pointer"
        >
          刷新
        </button>
      </div>

      {/* 用量总览：先回答「花了多少 / 花在哪 / 最近在涨吗」这三个问题 */}
      {data && <UsageOverview stats={data.stats} />}

      {/* Model breakdown */}
      {data && Object.keys(data.stats.by_model).length > 0 && (
        <div className="mb-4 flex flex-wrap gap-2">
          {Object.entries(data.stats.by_model)
            .sort((a, b) => b[1].tokens - a[1].tokens)
            .map(([m, s]) => (
              <span
                key={m}
                className="inline-flex items-center gap-1.5 text-[11px] px-2 py-1 rounded-full border border-rule bg-paper font-mono"
              >
                <strong>{m}</strong>
                <span className="text-ink-faint">
                  · {s.calls}次 · {fmt(s.tokens)} tok
                </span>
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
                {["时间", "用户", "地点", "模型", "服务商", "输入", "输出", "合计", "草稿"].map(
                  (h) => (
                    <th
                      key={h}
                      className="px-3 py-2.5 text-left font-semibold text-ink-soft whitespace-nowrap"
                    >
                      {h}
                    </th>
                  ),
                )}
              </tr>
            </thead>
            <tbody>
              {(data.rows as Array<Record<string, unknown>>).map((r, i) => (
                <tr
                  key={String(r.id)}
                  className={`border-b border-rule/50 hover:bg-paper/40 transition-colors ${i % 2 === 0 ? "" : "bg-paper/20"}`}
                >
                  <td className="px-3 py-2 text-ink-faint whitespace-nowrap font-mono">
                    {new Date(String(r.created_at)).toLocaleString("zh-CN", {
                      month: "2-digit",
                      day: "2-digit",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </td>
                  <td
                    className="px-3 py-2 whitespace-nowrap max-w-[100px] truncate"
                    title={String(r.user_label ?? "")}
                  >
                    <span
                      className={`inline-flex items-center gap-1 ${r.user_id ? "text-ink" : "text-ink-faint"}`}
                    >
                      {r.user_id ? "👤" : "👻"} {String(r.user_label ?? "访客")}
                    </span>
                  </td>
                  <td
                    className="px-3 py-2 text-ink-soft max-w-[120px] truncate"
                    title={String(r.capture_place ?? "")}
                  >
                    {r.capture_place ? (
                      displayPlace(String(r.capture_place))
                    ) : (
                      <span className="text-ink-faint">—</span>
                    )}
                  </td>
                  <td
                    className="px-3 py-2 font-mono text-ink-soft max-w-[140px] truncate"
                    title={String(r.model ?? "")}
                  >
                    {String(r.model ?? "—")}
                  </td>
                  <td className="px-3 py-2">
                    <span
                      className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-semibold border ${providerColor[String(r.provider)] ?? "text-ink-faint bg-rule/10 border-rule"}`}
                    >
                      {String(r.provider ?? "—")}
                    </span>
                  </td>
                  <td className="px-3 py-2 font-mono text-right text-ink-soft">
                    {fmt(Number(r.prompt_tokens ?? 0))}
                  </td>
                  <td className="px-3 py-2 font-mono text-right text-ink-soft">
                    {fmt(Number(r.completion_tokens ?? 0))}
                  </td>
                  <td className="px-3 py-2 font-mono text-right font-bold text-vermilion">
                    {fmt(Number(r.total_tokens ?? 0))}
                  </td>
                  <td
                    className="px-3 py-2 max-w-[120px] truncate"
                    title={String(r.draft_title ?? "")}
                  >
                    {r.draft_id ? (
                      <Link
                        to="/drafts/$id"
                        params={{ id: String(r.draft_id) }}
                        className="hover:text-vermilion underline"
                      >
                        {String(r.draft_title ?? r.draft_id).slice(0, 12)}…
                      </Link>
                    ) : (
                      <span className="text-ink-faint">—</span>
                    )}
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
            <span className="text-xs text-ink-faint px-2 py-1.5">
              第 {page + 1} / {Math.ceil(data.total / PAGE_SIZE)} 页
            </span>
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
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
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
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="10" />
      <path d="m15 9-6 6" />
      <path d="m9 9 6 6" />
    </svg>
  );
}

function LeafIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d="M11 20A7 7 0 0 1 9.8 6.1C15.5 5 17 4.48 19 2c1 2 2 4.18 2 8 0 5.5-4.78 10-10 10Z" />
      <path d="M2 21c0-3 1.85-5.36 5.08-6" />
    </svg>
  );
}

function EyeIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
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
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d="M9.88 9.88a3 3 0 1 0 4.24 4.24" />
      <path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68" />
      <path d="M6.61 6.61A13.526 13.526 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61" />
      <line x1="2" x2="22" y1="2" y2="22" />
    </svg>
  );
}
