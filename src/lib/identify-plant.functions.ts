import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { renderDraftHtml, type PlantDraftFields } from "./plant-html-template";
import {
  renderPremiumHtml,
  premiumPrompt1,
  premiumPrompt2,
  premiumPrompt3,
  PREMIUM_SCHEMA_1,
  PREMIUM_SCHEMA_2,
  PREMIUM_SCHEMA_3,
  type PremiumFields,
  type VerifiedFacts,
} from "./premium-page";
import {
  readGoldSkill,
  activeGoldSkill,
  suggestSkillMeta,
  skillSignature,
  GOLD_SKILL_MAX_CHARS,
  type GoldSkill,
} from "./gold-skill";
import {
  loadDossier,
  upsertDossier,
  bumpDossierHit,
  isDossierUsable,
  assembleDraftMeta,
  toDossierBody,
} from "./species-dossier";
import {
  filterLicensed,
  creditLine,
  stripHtml,
  applyOrganVerdicts,
  userPhotoCandidates,
  type PhotoCandidate,
  type Organ,
} from "./species-photos";
import {
  assignSlots,
  describeAssignment,
  normalizeOrgan,
  DRAFT_SLOTS,
  GOLD_SLOTS,
} from "./photo-slots";
import { checkDraftQuality, checkGoldQuality, describeIssues } from "./quality-gate";
import { lookupChinaInvasive } from "./china-invasive-list";
import { keepVisualAdvice, DEFAULT_VISUAL_ADVICE } from "./retake-advice";
import { stripMetaMarkdown, markdownEmphasisToHtml } from "./strip-markdown";
import {
  TENTATIVE_RE,
  stripTentativePrefix,
  isTentative,
  draftTitleFor,
  sanitizeSpeciesName,
} from "./tentative";
import { stripStaleMissingNotes } from "./draft-enhance";
import {
  DRAFT_CARD_SCOPE,
  DRAFT_CARD_FIELD_KEYS,
  DRAFT_CARD_FIELD_LABELS,
  diffDraftCard,
  draftCardToText,
  pickDraftCardFields,
} from "./draft-card-fields";
import { stripModelChatter } from "./model-chatter";
import { type IdentifyTrace, computeIdentifyConfidence, confZh } from "./identify-trace";
import { normalizeBaseUrl } from "./ai-base-url";
import {
  bearerFetchRotating,
  keyRejected,
  splitKeyPool,
  postOpenAICompat,
  postOpenAICompatStream,
  THINKING_OFF,
} from "./ai-key-pool";
import {
  readModelQueue,
  writeModelQueue,
  shouldFailOver,
  slotLabel,
  isKnownBlind,
  thinkingOf,
  type ModelSlot,
  type ModelQueue,
  type SlotVision,
  type ThinkingMode,
} from "./model-queue";
import {
  VISION_PROBE_PNG_B64,
  VISION_PROBE_MIME,
  VISION_PROBE_PROMPT,
  VISION_PROBE_TEXT_ONLY_PROMPT,
  gradeVisionAnswer,
  judgeVisionProbe,
  speedNote,
} from "./vision-probe";
import { slugify, speciesKey, visibleBodyText, textShingles, jaccardSimilarity } from "./plants";
import type { TaskKind } from "./task-feed";

const AI_MODEL = "google/gemini-2.5-pro";
const AI_GATEWAY = "https://ai.gateway.lovable.dev/v1/chat/completions";

type AiMeta = Omit<
  PlantDraftFields,
  "photo_url" | "capture_place" | "capture_lat" | "capture_lng" | "capture_date" | "ai_model"
>;

// Shared structured-output schema for the AI calls (identify + enrich).
const AI_META_SCHEMA = {
  type: "object",
  properties: {
    title: { type: "string", description: "中文物种名" },
    scientific_name: { type: "string", description: "拉丁学名（含命名人）" },
    common_name_en: { type: "string", description: "英文俗名" },
    common_names_zh: { type: "string", description: "中文俗名及商品名（逗号分隔）" },
    family: { type: "string", description: "科（中文+拉丁）" },
    genus: { type: "string", description: "属（中文+拉丁）" },
    iucn_status: { type: "string", description: "IUCN 评级" },
    tags: { type: "array", items: { type: "string" } },
    summary_zh: { type: "string" },
    summary_en: { type: "string" },
    field_notes_zh: {
      type: "string",
      description: "拍摄记录：对本张照片的形态分析 + 定种判断依据",
    },
    field_notes_en: { type: "string" },
    name_origin_zh: { type: "string" },
    name_origin_en: { type: "string" },
    morphology_zh: { type: "string" },
    morphology_en: { type: "string" },
    habitat_zh: { type: "string" },
    habitat_en: { type: "string" },
    culture_zh: { type: "string" },
    culture_en: { type: "string" },
    care_tips_zh: { type: "string" },
    care_tips_en: { type: "string" },
    care_facts: {
      type: "array",
      description:
        "养护卡片：酸碱/施肥/光照/基质/浇水/温度/湿度/病害，共 8 张，每张含 category/value/tag/detail",
      items: {
        type: "object",
        properties: {
          category: {
            type: "string",
            description:
              "类别名：酸碱偏好/施肥方案/光照需求/土壤基质/浇水方法/温度区间/空气湿度/病害防治",
          },
          value: {
            type: "string",
            description:
              "核心数值或范围或名称，如「PH 6.0–6.5」「15000–40000 lux」「18–28℃」「红蜘蛛 / 白粉病」",
          },
          tag: {
            type: "string",
            description: "括号标签，如「中性」「喜阳·散射」「合成：吡虫啉／有机：苦楝油」",
          },
          detail: { type: "string", description: "该项简介，≤ 50 字" },
        },
        required: ["category", "value", "tag", "detail"],
      },
    },
    identification_confidence: {
      type: "string",
      enum: ["high", "medium", "low"],
      description:
        "对本次定种的置信度。照片清晰、诊断特征充分且与已知物种高度吻合=high；有把握到属但种一级存疑=medium；照片不足以确诊、只能给疑似猜测=low。宁可 low 也不要为凑高置信度而武断定种。",
    },
    needs_more_photos_zh: {
      type: "string",
      description:
        "仅当 identification_confidence 为 low（或 medium 且需补证）时填写。**面向完全没有植物学基础的普通用户**，用大白话写 2–4 条可直接照做的拍摄动作，① ② ③ 编号，每条一句话、一个动作，说明「拍哪里 + 怎么拍」。禁止使用专业术语（脉序、被毛、托叶、花序、苞片、腋生 等）；确需提到部位时用日常说法并加括号解释，例如「把叶子翻过来拍背面（看清叶脉和有没有细毛）」「凑近拍一朵完整的花，正面拍清花瓣数量」「拍一下果实或种子」「退后一步拍整棵植物的样子（看高矮和分枝）」「拍一下茎和叶子相连的地方」。high 时留空字符串。",
    },
    needs_more_photos_en: {
      type: "string",
      description: "英文对应，同样用通俗易懂的日常英语；high 时留空。",
    },
  },
  required: [
    "title",
    "scientific_name",
    "common_name_en",
    "common_names_zh",
    "family",
    "genus",
    "iucn_status",
    "tags",
    "summary_zh",
    "summary_en",
    "field_notes_zh",
    "field_notes_en",
    "name_origin_zh",
    "name_origin_en",
    "morphology_zh",
    "morphology_en",
    "habitat_zh",
    "habitat_en",
    "culture_zh",
    "culture_en",
    "care_tips_zh",
    "care_tips_en",
    "care_facts",
  ],
};

function cleanJson(str: string): string {
  let cleaned = str.trim();
  if (cleaned.startsWith("```")) {
    cleaned = cleaned
      .replace(/^```json\s*/i, "")
      .replace(/```$/, "")
      .trim();
  }
  return cleaned;
}

// ── User-facing error reporting ───────────────────────────────────────────────
// House rule: an error shown to a user must carry BOTH a machine-readable code AND
// a plain-language cause + next step. `message` is rendered verbatim in the UI, so
// it has to read like a sentence, not a stack trace.
class AiError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "AiError";
    this.code = code;
  }
}

/** Extract Google's structured error detail from a Generative Language error body. */
function parseGeminiError(body: string): {
  status: string;
  message: string;
  quotaId: string;
  retryDelaySec: number | null;
} {
  let status = "";
  let message = "";
  let quotaId = "";
  let retryDelaySec: number | null = null;
  try {
    const j = JSON.parse(body);
    const e = j?.error ?? j?.[0]?.error ?? {};
    status = e.status || "";
    message = e.message || "";
    for (const d of e.details ?? []) {
      const t = String(d?.["@type"] || "");
      if (t.includes("QuotaFailure")) quotaId = d?.violations?.[0]?.quotaId || quotaId;
      else if (t.includes("RetryInfo") && typeof d?.retryDelay === "string") {
        const m = d.retryDelay.match(/([\d.]+)s/);
        if (m) retryDelaySec = Math.ceil(parseFloat(m[1]));
      }
    }
  } catch {
    /* body wasn't JSON — fall back to the generic copy */
  }
  return { status, message, quotaId, retryDelaySec };
}

/** A daily-quota 429 will NOT recover today, so retrying is pure latency. */
const isDailyQuota = (quotaId: string) => /PerDay/i.test(quotaId);

/**
 * 把 Google 的 quotaId 翻成人话。
 *
 * **为什么必须区分**：429 不只是「请求数」超了 —— Gemini 免费额度同时卡
 * **请求数**和 **token 数**，两者各自又分每分钟 / 每日。以前这里一律写成
 * 「每日免费请求额度已用尽」，于是 token 配额打满时（quotaId 形如
 * `...InputTokensPerModelPerDay`，同样含 PerDay）也报「请求额度用尽」，
 * 管理员去用量后台一看请求数才个位数，完全对不上，白白怀疑是 key 坏了。
 */
function quotaDimension(quotaId: string): { unit: string; window: string } {
  const unit = /Token/i.test(quotaId) ? "token 数" : /Request/i.test(quotaId) ? "请求数" : "用量";
  const window = /PerDay/i.test(quotaId) ? "每日" : /PerMinute/i.test(quotaId) ? "每分钟" : "";
  return { unit, window };
}

/** Map a Gemini HTTP failure onto an actionable Chinese message. */
function describeGeminiError(httpStatus: number, body: string, model: string): AiError {
  const { status, message, quotaId, retryDelaySec } = parseGeminiError(body);
  const tail = status ? ` · ${status}` : "";
  const code = `GEMINI_${httpStatus}${status ? "_" + status : ""}`;
  const detail = message ? ` Google 原始说明：${message.slice(0, 220)}` : "";
  const head = `AI 文案生成失败（HTTP ${httpStatus}${tail}）`;

  if (httpStatus === 429) {
    if (isDailyQuota(quotaId)) {
      const { unit, window } = quotaDimension(quotaId);
      return new AiError(
        code,
        `${head}：Gemini 的「${window}免费${unit}额度」已用尽。今天无法再生成。` +
          `⚠️ 超的是**${unit}**，不一定是请求数 —— 免费额度同时卡「请求数」和「token 数」。` +
          `用量后台看到请求数很少却报这个错，基本都是 **token 数**打满了：识别要传图、` +
          `生成长文要吐几十万 token，请求数还是个位数时 token 配额就可能见底。` +
          `另外 **preview 版模型**（名字带 -preview）的免费额度比正式版低得多。` +
          `⚠️ 免费额度按 **Google Cloud 项目** 计，同一项目下新建 API key ` +
          `共用同一个已耗尽的额度，换 key 不会恢复。真正有效的做法是：① 等配额重置` +
          `（太平洋时间次日 0 点）；② 换一个**不同 Google Cloud 项目**签发的 key；` +
          `③ 给项目开通结算、升级为付费配额；④ 在管理后台把**非 Gemini 的模型**` +
          `（如 Kimi / DeepSeek）排到「优先调用序列 2」当备胎，序列 1 挂了会自动顺位。` +
          `${quotaId ? ` 配额项：${quotaId}。` : ""}${detail}`,
      );
    }
    const { unit, window } = quotaDimension(quotaId);
    return new AiError(
      code,
      `${head}：超出 Gemini 的「${window || "每分钟"}${unit}」限制。请${retryDelaySec ? ` ${retryDelaySec} 秒` : "稍"}后重试；` +
        `若频繁出现，说明免费额度偏低，建议升级配额或在管理后台加一个非 Gemini 的备胎序列。` +
        `${quotaId ? ` 配额项：${quotaId}。` : ""}${detail}`,
    );
  }
  if (httpStatus === 503)
    return new AiError(
      code,
      `${head}：Gemini 模型当前过载，已自动重试 3 次仍失败。这是 Google 侧的临时故障，请稍后再试。${detail}`,
    );
  if (httpStatus === 400) {
    // Google geo-restriction: the Generative Language API is unavailable in the
    // caller's region (e.g. running the dev server behind GFW / an unsupported
    // country). Surfaces as FAILED_PRECONDITION「User location is not supported」.
    if (/user location is not supported/i.test(body) || status === "FAILED_PRECONDITION") {
      return new AiError(
        code,
        `${head}：Gemini API 在当前服务器/网络所在地区不可用（Google 未开放该地区）。这不是照片或密钥的问题。` +
          `本地开发时若直连（如在中国大陆），需让请求经由受支持地区的代理/VPN 出口；线上部署在 Cloudflare Workers 通常不受此限。` +
          `也可在管理后台改用其它服务商（OpenAI/中转）。${detail}`,
      );
    }
    return new AiError(
      code,
      `${head}：请求被 Gemini 拒绝。常见原因是照片过大或格式不受支持，也可能是 API key 格式不正确。${detail}`,
    );
  }
  if (httpStatus === 401 || httpStatus === 403)
    return new AiError(
      code,
      `${head}：Gemini API key 无效、已被撤销，或该 key 未启用 Generative Language API。请到管理后台检查密钥。${detail}`,
    );
  if (httpStatus === 404)
    return new AiError(
      code,
      `${head}：模型「${model}」不存在，或当前 key 无权访问它。请在管理后台改用可用的模型名。${detail}`,
    );
  if (httpStatus >= 500)
    return new AiError(
      code,
      `${head}：Google 服务器内部错误，不是本站的问题，请稍后再试。${detail}`,
    );
  return new AiError(code, `${head}。${detail || "Gemini 未返回更多说明。"}`);
}

// ── Gemini API key pool ───────────────────────────────────────────────────────
// Free-tier Gemini quota (both RPM and RPD) is metered per Google Cloud PROJECT,
// and each API key belongs to one project. So N keys from N projects/accounts = N
// independent quota buckets. On a per-minute rate limit we therefore ROTATE to the
// next key instead of sleeping — another project's RPM bucket is usually still open.
//
// Keys come in two formats: the legacy `AIzaSy…` (~39 chars) and the newer `AQ.…`.
// Several may be given, separated by comma / newline / semicolon. A legacy single
// key that merely picked up a stray space is still healed (stitched back).
const GEMINI_KEY_RE = /^AIza[\w-]{20,}$/;

/** Split a token that is two+ keys concatenated with NO separator. A single-line
 *  <input> silently drops newlines on paste, fusing `KEY1\nKEY2` into `KEY1KEY2`.
 *  Only split when every resulting part is a well-formed ~39-char key, so a key that
 *  merely happens to contain "AIza" inside it is never mangled. */
function unfuseGeminiKeys(token: string): string[] {
  // Legacy `AIza…` pair fused by a lost newline.
  if ((token.match(/AIza/g) ?? []).length >= 2) {
    const parts = token.split(/(?=AIza)/).filter(Boolean);
    if (
      parts.length >= 2 &&
      parts.every((p) => GEMINI_KEY_RE.test(p) && p.length >= 35 && p.length <= 45)
    )
      return parts;
  }
  // New-format `AQ.…` pair fused (e.g. comma dropped by an earlier buggy normalize).
  // The `AQ.` prefix is a clean split marker; only accept if every part looks like a key.
  if ((token.match(/AQ\./g) ?? []).length >= 2) {
    const parts = token.split(/(?=AQ\.)/).filter(Boolean);
    if (parts.length >= 2 && parts.every((p) => /^AQ\.[A-Za-z0-9._-]{15,}$/.test(p))) return parts;
  }
  return [token];
}

function splitGeminiKeys(raw: string | null | undefined): string[] {
  const s = String(raw ?? "");
  // STRONG, intentional separators first: comma / semicolon / newline. If the user
  // wrote "keyA,keyB" we must honour it for ANY key format — the old code required
  // every part to match the `AIza…` regex and otherwise re-fused them, which turned
  // two comma-separated NEW-format `AQ.…` keys back into one garbage string → 401.
  const strong = s
    .split(/[,;\n\r]+/)
    .map((x) => x.trim())
    .filter(Boolean);
  if (strong.length >= 2) {
    // Explicit pool — strip only INTERNAL whitespace from each key (heal a stray space).
    return Array.from(new Set(strong.map((k) => k.replace(/\s+/g, "")).filter(Boolean)));
  }
  // Single chunk: no intentional separator was used.
  const one = (strong[0] ?? "").trim();
  if (!one) return [];
  // Whitespace-separated pool of well-formed legacy keys → treat as a pool.
  const bySpace = one.split(/\s+/).filter(Boolean);
  if (bySpace.length >= 2 && bySpace.every((t) => GEMINI_KEY_RE.test(t))) {
    return Array.from(new Set(bySpace));
  }
  // Otherwise it's ONE key — possibly mangled by internal spaces, or two legacy keys
  // fused by a lost newline on paste. Strip whitespace, then try to unfuse AIza pairs.
  return Array.from(new Set(unfuseGeminiKeys(one.replace(/\s+/g, ""))));
}

/**
 * Canonicalize a stored/submitted API key. For Gemini this preserves a multi-key
 * POOL (re-joined on ","); for every other provider it keeps the old behaviour of
 * stripping all whitespace (a stray space in an OpenAI key caused 401s).
 */
function normalizeApiKey(
  provider: string | null | undefined,
  raw: string | null | undefined,
): string {
  const s = String(raw ?? "");
  if (provider === "gemini") return splitGeminiKeys(s).join(",") || s.replace(/\s+/g, "");
  return s.replace(/\s+/g, "");
}

type GeminiCallOpts = { model: string; body: unknown; timeoutMs?: number; label?: string };

/**
 * POST to Gemini generateContent, rotating across the key pool.
 *
 * Per key: 429-daily → retire that key for this request; 429-per-minute → immediately
 * try the NEXT key (its project has its own RPM bucket); 401/403/invalid-key → retire
 * it; 5xx → try another key. Only once every key has been swept do we back off a
 * single time (honouring Google's RetryInfo) and sweep the still-viable keys again.
 * 400/404 are config errors (identical for every key) → surface immediately.
 * Throws a described AiError when nothing works; otherwise returns the parsed JSON.
 */
async function callGeminiWithRotation(keys: string[], opts: GeminiCallOpts): Promise<any> {
  const { model, body, timeoutMs = 55_000, label = "Gemini" } = opts;
  if (!keys.length) {
    throw new AiError(
      "GEMINI_NO_KEY",
      "AI 文案生成失败（GEMINI_NO_KEY）：服务器没有配置任何 Gemini API key，请到管理后台填写。",
    );
  }
  const dead = new Set<number>(); // daily-quota exhausted or invalid → skip for this request
  let lastErr: AiError | null = null;
  let suggestedDelay: number | null = null;
  const payload = JSON.stringify(body);

  for (let round = 0; round < 2; round++) {
    for (let i = 0; i < keys.length; i++) {
      if (dead.has(i)) continue;
      const tag = `${label} key#${i + 1}/${keys.length}`;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const resp = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${keys[i]}`,
          {
            method: "POST",
            signal: controller.signal,
            headers: { "Content-Type": "application/json" },
            body: payload,
          },
        );
        if (resp.ok) {
          if (i > 0 || round > 0) console.log(`[${tag}] succeeded after rotation`);
          return await resp.json();
        }

        const text = await resp.text().catch(() => "");
        lastErr = describeGeminiError(resp.status, text, model);
        const { quotaId, retryDelaySec, message } = parseGeminiError(text);
        if (retryDelaySec)
          suggestedDelay = Math.min(suggestedDelay ?? retryDelaySec, retryDelaySec);

        if (resp.status === 429) {
          if (isDailyQuota(quotaId)) {
            console.warn(`[${tag}] daily quota exhausted — retiring this key for the request`);
            dead.add(i);
          } else {
            console.warn(`[${tag}] per-minute rate limit — rotating to next key`);
          }
          continue;
        }
        if (
          resp.status === 401 ||
          resp.status === 403 ||
          /API key not valid|API_KEY_INVALID/i.test(message)
        ) {
          console.warn(`[${tag}] key rejected (invalid / unauthorised) — retiring it`);
          dead.add(i);
          continue;
        }
        if (resp.status >= 500) {
          console.warn(`[${tag}] upstream ${resp.status} — trying another key`);
          continue;
        }
        throw lastErr; // 400 / 404 → same outcome on every key
      } catch (e) {
        if (e instanceof AiError) throw e;
        console.warn(`[${tag}] network error:`, e instanceof Error ? e.message : e);
        lastErr = new AiError(
          "GEMINI_NETWORK",
          `AI 文案生成失败（GEMINI_NETWORK）：无法连接 Gemini 服务器（${e instanceof Error ? e.message : "网络错误"}）。请检查服务器到 Google API 的连通性。`,
        );
      } finally {
        clearTimeout(timer);
      }
    }
    // Whole pool swept. If any key is still viable, back off once, then re-sweep.
    if (round === 0 && dead.size < keys.length) {
      const delay = Math.min((suggestedDelay ?? 20) * 1000, 30_000);
      console.warn(
        `[${label}] all ${keys.length} key(s) rate-limited; backing off ${delay / 1000}s before a final sweep`,
      );
      await new Promise((r) => setTimeout(r, delay));
    }
  }

  throw (
    lastErr ??
    new AiError(
      "GEMINI_UNKNOWN",
      "AI 文案生成失败（GEMINI_UNKNOWN）：所有 Gemini API key 均不可用，请稍后重试或在管理后台补充新的 key。",
    )
  );
}

/** Generic describer for the OpenAI-compatible / Anthropic branches. */
function describeHttpAiError(tag: string, httpStatus: number, body: string): AiError {
  let message = "";
  try {
    const j = JSON.parse(body);
    message = j?.error?.message || j?.message || "";
  } catch {
    message = body.slice(0, 200);
  }
  const detail = message ? ` 原始说明：${message.slice(0, 220)}` : "";
  const code = `${tag.toUpperCase()}_${httpStatus}`;
  const head = `${tag} 文案生成失败（HTTP ${httpStatus}）`;
  if (httpStatus === 429)
    return new AiError(
      code,
      `${head}：请求过于频繁或额度已用尽（rate limit / quota）。请稍后重试，或在管理后台更换 key、升级配额。${detail}`,
    );
  if (httpStatus === 401 || httpStatus === 403)
    return new AiError(
      code,
      `${head}：API key 无效或无权访问该模型。请到管理后台检查密钥。${detail}`,
    );
  if (httpStatus === 402)
    return new AiError(code, `${head}：账户余额不足 / 额度已耗尽，请充值后重试。${detail}`);
  if (httpStatus === 404)
    return new AiError(
      code,
      `${head}：模型名不存在或该 key 无权访问。请在管理后台改用可用的模型名。${detail}`,
    );
  if (httpStatus >= 500)
    return new AiError(code, `${head}：上游服务（或中转网关）内部错误，请稍后再试。${detail}`);
  return new AiError(code, `${head}。${detail}`);
}

type AgentReply = {
  reply: string;
  canEdit: boolean;
  editInstruction: string;
  imageEdit: boolean;
  imageQuery: string;
  showImages: boolean;
  imageQueries: string[];
};

/** Tolerantly parse a 小P agent response into {reply,canEdit,editInstruction}.
 *  Relay / reasoning models often answer in prose or return slightly malformed /
 *  truncated JSON — instead of throwing, we degrade gracefully so the editor still
 *  sees the model's answer:
 *   1) strict JSON; 2) regex-extract the fields from imperfect JSON; 3) treat the
 *   whole thing as a plain chat reply. */
function parseAgentReply(raw: string): AgentReply {
  const txt = cleanJson(raw);
  // Models drift on the reply key — accept common synonyms.
  const pickReply = (o: Record<string, unknown>) =>
    o.reply ?? o.response ?? o.answer ?? o.message ?? o.text ?? o.content;
  try {
    const o = JSON.parse(txt);
    if (o && typeof o === "object") {
      const reply = pickReply(o as Record<string, unknown>);
      if (typeof reply === "string") {
        const rec = o as Record<string, unknown>;
        const iqRaw = (rec.imageQueries ?? rec.image_queries) as unknown;
        const imageQueries = Array.isArray(iqRaw)
          ? iqRaw.map((x) => String(x).trim()).filter(Boolean)
          : [];
        return {
          reply: reply.trim(),
          canEdit: rec.canEdit === true || rec.canEdit === "true",
          editInstruction: String(rec.editInstruction || rec.edit_instruction || "").trim(),
          imageEdit: rec.imageEdit === true || rec.imageEdit === "true" || rec.image_edit === true,
          imageQuery: String(rec.imageQuery || rec.image_query || "").trim(),
          showImages:
            rec.showImages === true || rec.showImages === "true" || rec.show_images === true,
          imageQueries,
        };
      }
    }
  } catch {
    /* fall through to lenient extraction */
  }

  const unesc = (s: string) =>
    s.replace(/\\"/g, '"').replace(/\\n/g, "\n").replace(/\\t/g, "\t").replace(/\\\\/g, "\\");
  const replyM = txt.match(
    /"(?:reply|response|answer|message|text|content)"\s*:\s*"((?:[^"\\]|\\.)*)"/i,
  );
  if (replyM) {
    const canM = txt.match(/"canEdit"\s*:\s*(true|false)/i);
    const insM = txt.match(/"editInstruction"\s*:\s*"((?:[^"\\]|\\.)*)"/);
    const imgM = txt.match(/"imageEdit"\s*:\s*(true|false)/i);
    const iqM = txt.match(/"imageQuery"\s*:\s*"((?:[^"\\]|\\.)*)"/);
    const siM = txt.match(/"showImages"\s*:\s*(true|false)/i);
    const iqsM = txt.match(/"imageQueries"\s*:\s*\[([^\]]*)\]/i);
    const imageQueries = iqsM
      ? [...iqsM[1].matchAll(/"((?:[^"\\]|\\.)*)"/g)].map((m) => unesc(m[1]).trim()).filter(Boolean)
      : [];
    return {
      reply: unesc(replyM[1]).trim(),
      canEdit: canM ? canM[1].toLowerCase() === "true" : false,
      editInstruction: insM ? unesc(insM[1]).trim() : "",
      imageEdit: imgM ? imgM[1].toLowerCase() === "true" : false,
      imageQuery: iqM ? unesc(iqM[1]).trim() : "",
      showImages: siM ? siM[1].toLowerCase() === "true" : false,
      imageQueries,
    };
  }
  // Pure prose (or unparseable) — show the model's text as the reply.
  return {
    reply: raw.trim(),
    canEdit: false,
    editInstruction: "",
    imageEdit: false,
    imageQuery: "",
    showImages: false,
    imageQueries: [],
  };
}

/** Some models (esp. relay/reasoning) only PROMISE to show reference photos in prose
 *  ("我再调出几组参考图…") without setting showImages/imageQueries. Detect that promise
 *  and harvest Latin binomials from the reply so the photos actually get shown. */
function harvestImageIntent(r: AgentReply): AgentReply {
  if (r.showImages && (r.imageQueries.length || r.imageQuery)) {
    return r.imageQueries.length ? r : { ...r, imageQueries: [r.imageQuery] };
  }
  const promised =
    /(参考(图|照片|图片))|(调出[^。！\n]*(图|照片))|(展示[^。！\n]*(图片|照片|图))|(比对[^。！\n]*(照片|图))|(几组[^。！\n]*(图|照片))|(给您?看[^。！\n]*(图|照片))/.test(
      r.reply,
    );
  if (!promised) return r;
  const found: string[] = [];
  for (const m of r.reply.matchAll(/\b[A-Z][a-z]+\s+[a-z]{3,}\b/g)) {
    if (!found.includes(m[0])) found.push(m[0]);
    if (found.length >= 4) break;
  }
  const queries = r.imageQueries.length ? r.imageQueries : r.imageQuery ? [r.imageQuery] : found;
  if (!queries.length) return r;
  return { ...r, showImages: true, imageQueries: queries };
}

/** Some models discuss/agree to a concrete edit in prose but never set canEdit/
 *  editInstruction, so the "采纳并保存" button never appears. When both the editor's
 *  request and the reply are clearly about a change (not an image / not a plain Q&A),
 *  enable the edit and use the editor's own request as the instruction. The editor
 *  still has to click 采纳 — this only makes the button show up. */
function harvestEditIntent(r: AgentReply, question: string): AgentReply {
  if (r.imageEdit || r.showImages) return r;
  if (r.canEdit && r.editInstruction) return r;
  const EDIT_RE =
    /(修改|订正|更正|改写|调整|修正|替换|更换|更新|补充|删除|去掉|加上|改成|换成|改为|应为|应该是|把.*改)/;
  const replyEditish = EDIT_RE.test(r.reply);
  const userWantsEdit =
    EDIT_RE.test(question) || /(帮我|请把|帮忙|麻烦你).*(改|换|加|删|订正|更新)/.test(question);
  if (replyEditish && userWantsEdit) {
    return { ...r, canEdit: true, editInstruction: r.editInstruction || question.trim() };
  }
  return r;
}

// ─── AI Provider Config (stored server-side in site_config table) ───────────
// Supports: gemini | openai (and OpenAI-compatible) | anthropic | custom
type AiProviderConfig = {
  provider: "gemini" | "openai" | "anthropic" | "custom";
  apiKey: string;
  model: string;
  baseUrl?: string; // for openai-compatible, anthropic or custom endpoints
  /**
   * 这次调用开不开思维链。**已经是解析过的最终值**（`thinkingOf(slot, consoleId)` 的输出），
   * 下游只管照着发参数，不用再知道是哪个控制台、管理员有没有显式选过。
   */
  thinking?: ThinkingMode;
};

/**
 * 按配置决定要不要发那组「别思考，直接答」的参数。
 *
 * 展开进请求体即可：`...thinkingParams(cfg)`。开思考时返回空对象 —— **什么都不发**，
 * 让模型按自己的默认来，而不是反过来发一组「请思考」的参数（那种参数各家写法更乱，
 * 且对本来就不推理的模型纯属白发一个会被 400 的键）。
 */
function thinkingParams(cfg: Pick<AiProviderConfig, "thinking">): Record<string, unknown> {
  return cfg.thinking === "on" ? {} : { ...THINKING_OFF };
}

// ─── 优先调用序列：读写（三个控制台共用一套）──────────────────────────────────
// 每个控制台在 site_config 里占一个 key，存的都是同一个 ModelQueue 形态。
// 读的时候 readModelQueue() 会把历史形态（单配置 / 逗号 key 池）自动折算成序列，
// 所以线上老数据不需要任何手工迁移。

const CONSOLE_CONFIG_KEYS = {
  ai: "ai_model_config",
  // 「出卡AI」—— 三重奏的第三块：拍照后写出简介摘要卡 / 分享卡的那个模型。
  // 以前它没有自己的控制台，直接借用 ai_model_config，于是「一线出卡」和「其它杂项」
  // 被迫共用一套配置，调其中一个必然影响另一个。现在拆出来单独配。
  card: "card_model_config",
  // 「进一步生成草稿」（enrichDraft 的重活）单独一套 —— 它和一线识别的诉求不同：
  // 识别要快、要便宜；写整份科普草稿要长文能力、能容忍慢。分开配才不用互相将就。
  enrich: "enrich_model_config",
  second_opinion: "second_opinion_config",
  xiaop: "xiaop_model_config",
  // 「金叶详页」单独一套 —— 它以前借用小P蛙的序列，可两者的诉求正好相反：
  // 小P蛙是**交互式问答/改稿**（要跟手、要便宜、常带图），金叶是**一次性写整份公开档案**
  // （全站最复杂的一次生成，三轮撰稿，跑在队列的 15 分钟挂钟里，慢一点无所谓）。
  // 共用一套的后果是必然互相将就：为小P蛙调快，金叶正文就变薄；为金叶调强，问答就变慢变贵。
  gold: "gold_model_config",
  // 「配图器官识别」单独一套 —— 它以前挂在小P蛙序列上，而这两件事毫无关系：
  // 小P蛙是**交互式问答/改稿**，器官识别是**机械的视觉打标签**（判断一张图是花/叶/果/植株）。
  // 后果 2026-07-26 线上验证过：小P蛙序列 1 配了纯文本的 qwen3.7-max，带图调用一路 400，
  // **配图分类跟着一起废**，银叶/金叶全成空槽 —— 而管理员从「小P蛙」这个名字上
  // 根本想不到它还管着配图。
  organ: "organ_model_config",
} as const;
type ConsoleId = keyof typeof CONSOLE_CONFIG_KEYS;

/**
 * **只跑在 Cloudflare Queues 里**的控制台（消费者有 15 分钟挂钟）。
 *
 * 它们的单次请求超时可以给得比交互式链路宽得多 —— 小P对话挂在 HTTP 请求上，
 * 边缘本身就只有 100 秒，等更久毫无意义；而金叶/银叶这种一跑几分钟的，
 * 卡在 2 分钟只会把 kimi-k3 那类「先写一大段思维链」的推理模型全判成超时
 * （用户 2026-07-29 配 kimi-k3 建金叶，正是这么超的）。
 *
 * ⚠️ **`card` / `second_opinion` 故意不在这里**：它们在 `runQuickIdentifyCore` 里，
 * 而那条核心有两条入口 —— 登录用户走队列，**匿名用户仍走同步 HTTP**。
 * 给它们放宽到 5 分钟，匿名识别会先撞上边缘 100 秒硬上限，
 * 用户看到的是「Load failed」而不是一句说得清的超时，反而更糟。
 */
const BACKGROUND_CONSOLES = new Set<ConsoleId>(["gold", "enrich"]);

const CONSOLE_LABELS: Record<ConsoleId, string> = {
  ai: "AI 模型",
  card: "出卡AI",
  enrich: "草稿生成模型",
  second_opinion: "疑似复核模型",
  xiaop: "小P蛙模型",
  gold: "金叶详页模型",
  organ: "配图器官识别模型",
};

async function loadModelQueue(consoleId: ConsoleId): Promise<ModelQueue> {
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data } = await (supabaseAdmin as any)
      .from("site_config")
      .select("value")
      .eq("key", CONSOLE_CONFIG_KEYS[consoleId])
      .maybeSingle();
    const raw = (data as { value?: unknown } | null)?.value;
    if (!raw) return { sequence: [] };
    return readModelQueue(typeof raw === "string" ? JSON.parse(raw) : raw);
  } catch (e) {
    console.warn(`[${consoleId} queue] load failed:`, e);
    return { sequence: [] };
  }
}

const loadXiaoPQueue = () => loadModelQueue("xiaop");
const loadAiQueue = () => loadModelQueue("ai");
/**
 * 「出卡AI」的序列 —— 三重奏第三块，负责拍照后写出简介摘要卡 / 分享卡。
 *
 * **没单独配时回退到 AI 模型控制台**，与 loadEnrichQueue 同款兜底。这条回退是刻意的：
 * 新控制台上线时 card_model_config 必然是空的，靠它才能做到「部署即生效、行为不变」，
 * 管理员想把出卡单独调开再去配即可。
 */
async function loadCardQueue(): Promise<ModelQueue> {
  const own = await loadModelQueue("card");
  return own.sequence.length ? own : await loadAiQueue();
}
/**
 * 「进一步生成草稿」的序列。**没单独配时回退到「AI 模型控制台」** —— 这样新加的控制台
 * 留空也不会让草稿生成失灵，管理员想分开调再去配。
 */
async function loadEnrichQueue(): Promise<ModelQueue> {
  const own = await loadModelQueue("enrich");
  return own.sequence.length ? own : await loadAiQueue();
}
const loadSecondOpinionQueue = () => loadModelQueue("second_opinion");
/**
 * 「金叶详页」的序列。
 *
 * **兜底链是 gold → enrich → ai**，而不是回到小P蛙：金叶干的活（写整份公开档案）跟
 * 「进一步生成草稿」是同一类诉求 —— 要长文能力、能容忍慢 —— 所以没单独配时借草稿生成的
 * 配置远比借小P蛙（为交互问答调的快模型）合理。
 * 这条回退同样保证「部署即生效」：新 key 上线时必然是空的，不会让金叶当场失灵。
 */
async function loadGoldQueue(): Promise<ModelQueue> {
  const own = await loadModelQueue("gold");
  return own.sequence.length ? own : await loadEnrichQueue();
}
/**
 * 「配图器官识别」的序列。
 *
 * **兜底链是 organ → card → ai**：器官识别要的是「能读图 + 快 + 便宜」，这正是
 * 出卡AI 的画像，比回到小P蛙（为交互问答调的）合理得多。
 * 同样保证「部署即生效」—— 新 key 上线时是空的，不会让配图当场失灵。
 */
async function loadOrganQueue(): Promise<ModelQueue> {
  const own = await loadModelQueue("organ");
  return own.sequence.length ? own : await loadCardQueue();
}

/** 「金叶详页创作指导 Skill」在 site_config 里的 key。 */
const GOLD_SKILL_CONFIG_KEY = "gold_skill_config";

/**
 * 读取管理员粘贴的金叶创作指导。没配 / 读失败 → null → 撰稿走 premium-page.ts 的内置底版，
 * 与本功能上线前逐字相同。**读失败绝不能让金叶生成整体失败**（用户已经付了金叶）。
 */
async function loadGoldSkill(): Promise<GoldSkill | null> {
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data } = await (supabaseAdmin as any)
      .from("site_config")
      .select("value")
      .eq("key", GOLD_SKILL_CONFIG_KEY)
      .maybeSingle();
    return readGoldSkill((data as { value?: unknown } | null)?.value ?? null);
  } catch (e) {
    console.warn("[GoldSkill] load failed; falling back to built-in prompts:", e);
    return null;
  }
}

/** Read admin-configured AI model from the site_config table (service-role only). */
async function loadAiConfig(): Promise<AiProviderConfig | null> {
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    // site_config is an admin-managed key/value table not in the generated types.
    const { data } = await (supabaseAdmin as any)
      .from("site_config")
      .select("value")
      .eq("key", "ai_model_config")
      .maybeSingle();
    const raw = (data as { value?: unknown } | null)?.value;
    if (!raw) return null;
    // readModelQueue() 同时认新的 sequence 形态和旧的单配置/逗号 key 池，所以这里
    // 拿到的永远是一个规整的序列。本函数为兼容老调用方而存在，只回**序列 1**；
    // 需要「失败顺位下一个」的调用方请改用 loadAiQueue() + runModelQueue()。
    const q = readModelQueue(typeof raw === "string" ? JSON.parse(raw) : raw);
    const first = q.sequence[0];
    if (!first) return null;
    return {
      provider: first.provider,
      apiKey: first.apiKey,
      model: first.model,
      baseUrl: first.baseUrl,
    };
  } catch (e) {
    console.warn("[AI Config] Failed to load ai_model_config from site_config:", e);
    return null;
  }
}

type AiTokenUsage = {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
};

/** A chat/text call result carrying both the model's text and its token usage. */
type AiTextResult = { text: string; usage: AiTokenUsage };

const ZERO_USAGE: AiTokenUsage = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };

/** Sum two usage records (immutably). */
function addUsage(a: AiTokenUsage, b: AiTokenUsage | null | undefined): AiTokenUsage {
  if (!b) return a;
  return {
    prompt_tokens: a.prompt_tokens + b.prompt_tokens,
    completion_tokens: a.completion_tokens + b.completion_tokens,
    total_tokens: a.total_tokens + b.total_tokens,
  };
}

// ─── 优先调用序列：执行器 ────────────────────────────────────────────────────
// 按 1→n 依次尝试，可降级的失败（额度用尽 / key 无效 / 模型不存在 / 服务端故障 /
// 网络错误）就顺位交给下一项；不可降级的失败（400，请求本身有毛病）立刻抛出。

/**
 * 从一个抛出的错误里还原 HTTP 状态码。各家调用函数抛的都是
 * `…(HTTP 401)…` / `…（HTTP 429）…` 这种带码的中文消息（半角与全角括号都有），
 * 没有码就当作网络错误（0）—— 网络错误本来也该降级。
 */
function httpStatusOf(e: unknown): number {
  const withStatus = e as { status?: unknown };
  if (typeof withStatus?.status === "number") return withStatus.status;
  const m = /HTTP\s*(\d{3})/.exec(e instanceof Error ? e.message : String(e));
  return m ? Number(m[1]) : 0;
}

/**
 * 依次跑完整个序列，返回第一个成功的结果。
 * 全挂时抛出的错误里带**每一项各自的失败原因**（key 打码）—— 不然管理员只会看到
 * 最后一项的报错，根本不知道前面几项为什么没顶上。
 */
async function runModelQueue<T>(
  sequence: ModelSlot[],
  callSlot: (slot: ModelSlot, index: number) => Promise<T>,
  label: string,
  /**
   * `requireVision` = 这条链路要给模型看图。**已被视觉准入检测判定为 blind 的项会被跳过**
   * （见 vision-probe.ts 的事故背景：看不见图的模型会凭空编一个物种出来、还返回 200，
   * 靠 shouldFailOver 永远拦不住，因为它压根没报错）。
   *
   * 只跳过**明确测出 blind** 的项；没测过的照跑不误 —— 否则本功能上线当天就会把所有
   * 未检测的序列清空，比事故本身更糟。
   */
  opts?: { requireVision?: boolean },
): Promise<T> {
  if (!sequence.length) throw new Error(`${label} 暂不可用：优先调用序列为空，请在控制台配置。`);

  if (opts?.requireVision) {
    const blind = sequence.filter(isKnownBlind);
    if (blind.length) {
      const usable = sequence.filter((s) => !isKnownBlind(s));
      console.warn(
        `[${label}] 跳过 ${blind.length} 个已测出「不读图」的序列项：${blind.map((s) => s.model).join("、")}`,
      );
      if (!usable.length)
        throw new Error(
          `${label} 暂不可用：序列里 ${sequence.length} 个模型**全部**被视觉准入检测判定为看不见图` +
            `（${blind.map((s) => s.model).join("、")}）。这条链路必须给模型看照片，` +
            `继续用它们只会得到凭空编造的结果。请在控制台换成实测支持视觉的模型。`,
        );
      sequence = usable;
    }
  }
  const failures: string[] = [];
  for (const [i, slot] of sequence.entries()) {
    try {
      return await callSlot(slot, i);
    } catch (e) {
      const status = httpStatusOf(e);
      const msg = e instanceof Error ? e.message : String(e);
      failures.push(`${slotLabel(slot, i)}（${maskKey(slot.apiKey)}）：${msg.slice(0, 160)}`);
      if (!shouldFailOver(status, msg) || i === sequence.length - 1) {
        if (sequence.length === 1) throw e;
        // 报「试了几个」而不是「一共几个」—— 遇到不可降级的错误（400）会提前停，
        // 说成「N 个都没出结果」会让人以为后面的替补试过了、白白去查没问题的配置。
        const tried = failures.length;
        const stoppedEarly = tried < sequence.length;
        throw new Error(
          `${label} 失败：已依次尝试 ${tried} / ${sequence.length} 个序列` +
            (stoppedEarly ? "（末项的错误无法靠换模型解决，已停止顺位）" : "") +
            `：\n${failures.join("\n")}`,
        );
      }
      // 可降级 → 继续下一项。
    }
  }
  throw new Error(`${label} 暂不可用：优先调用序列为空。`);
}

/** Stage 1 of the two-stage pipeline: a quick species ID from an OpenAI-compatible
 *  vision relay (e.g. glm-5v-turbo). A small request the reasoning model handles
 *  reliably; returns just the Chinese + Latin name (or null on any failure, so the
 *  caller falls back to a Gemini-only draft). */
async function quickIdentify(
  photoDataUrl: string,
  cfg: AiProviderConfig,
): Promise<{ title: string; scientific_name: string; usage: AiTokenUsage; model: string } | null> {
  const apiBase = cfg.baseUrl || "https://api.openai.com/v1";
  const resp = await postOpenAICompat(`${apiBase}/chat/completions`, cfg.apiKey, {
    model: cfg.model,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "text",
            text: '识别这张照片里的植物，只返回一个 JSON 对象（不要 markdown、不要多余文字），格式：{"title":"中文物种名","scientific_name":"拉丁学名（尽量精确到种）"}。若不确定，title 用最可能的中文名并在前面加「疑似」。',
          },
          { type: "image_url", image_url: { url: photoDataUrl } },
        ],
      },
    ],
    max_tokens: 3000,
    temperature: 0,
  });
  if (!resp.ok) {
    console.warn("[quickIdentify] HTTP", resp.status);
    return null;
  }
  const data = await resp.json();
  const content = data.choices?.[0]?.message?.content;
  if (!content) return null;
  const meta = JSON.parse(cleanJson(content));
  const u = data.usage ?? {};
  return {
    title: (meta.title || "").toString().trim(),
    scientific_name: (meta.scientific_name || "").toString().trim(),
    usage: {
      prompt_tokens: u.prompt_tokens ?? 0,
      completion_tokens: u.completion_tokens ?? 0,
      total_tokens: u.total_tokens ?? 0,
    },
    model: cfg.model,
  };
}

// ─── Pl@ntNet professional plant-ID (Stage 0) ───────────────────────────────
// A dedicated botanical classifier — far more reliable at species-level ID than a
// general vision LLM. Its verdict (ranked species + confidence) is fed into the
// draft-writer's system prompt as a hint, so it upgrades accuracy for ANY provider.

/** Read the Pl@ntNet key from site_config (admin-set, all users); fall back to .env. */
async function loadPlantNetKey(): Promise<string> {
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data } = await (supabaseAdmin as any)
      .from("site_config")
      .select("value")
      .eq("key", "plantnet_api_key")
      .maybeSingle();
    const raw = (data as { value?: unknown } | null)?.value;
    if (raw) {
      const cfg = typeof raw === "string" ? JSON.parse(raw) : raw;
      const key = typeof cfg === "string" ? cfg : cfg?.apiKey;
      if (key) return String(key).replace(/\s+/g, "");
    }
  } catch (e) {
    console.warn("[Pl@ntNet] Failed to load key from site_config:", e);
  }
  return (process.env.PLANTNET_API_KEY ?? "").replace(/\s+/g, "");
}

type PlantNetVerdict = {
  scientific_name: string;
  family: string;
  genus: string;
  score: number;
  candidates: string[];
};

// ─── Pl@ntNet 免费额度（500 次/天）耗尽的持久标记 ────────────────────────────
// Workers 是无状态的（每个 isolate 各自的内存缓存不可靠），所以把「已耗尽」写进
// site_config。命中标记时直接跳过 Pl@ntNet、改用二次复核模型顶一线，省掉一次必定 429 的往返。
// 用时间戳 + 1 小时窗口而不是「按 UTC 日期」：Pl@ntNet 的重置时区没有明确文档，
// 猜错时区会导致整天不恢复；1 小时窗口最多每小时浪费一次 429（不消耗额度），
// 且额度重置后最迟 1 小时自动恢复。
const PLANTNET_QUOTA_RETRY_MS = 60 * 60 * 1000;

/** True if Pl@ntNet was marked quota-exhausted within the retry window. */
async function isPlantNetQuotaExhausted(): Promise<boolean> {
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data } = await (supabaseAdmin as any)
      .from("site_config")
      .select("value")
      .eq("key", "plantnet_quota_state")
      .maybeSingle();
    const raw = (data as { value?: unknown } | null)?.value;
    if (!raw) return false;
    const cfg = typeof raw === "string" ? JSON.parse(raw) : raw;
    const at = Date.parse(cfg?.exhaustedAt ?? "");
    if (!Number.isFinite(at)) return false;
    return Date.now() - at < PLANTNET_QUOTA_RETRY_MS;
  } catch (e) {
    console.warn("[Pl@ntNet] quota-state read failed; assuming quota OK:", e);
    return false;
  }
}

/** Record that Pl@ntNet returned 429 so subsequent identifies skip it for a while. */
async function markPlantNetQuotaExhausted(): Promise<void> {
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await (supabaseAdmin as any).from("site_config").upsert(
      {
        key: "plantnet_quota_state",
        value: { exhaustedAt: new Date().toISOString() },
      },
      { onConflict: "key" },
    );
    console.warn("[Pl@ntNet] 429 每日额度已用尽 → 标记状态，改由二次复核模型顶一线识别");
  } catch (e) {
    console.warn("[Pl@ntNet] quota-state write failed:", e);
  }
}

/** Identify a plant photo via Pl@ntNet. `verdict` is the top species + alternates
 *  (null on any failure → caller continues with the fallback identifier).
 *  `quotaExhausted` is true only on HTTP 429 — the daily free quota (500/day) ran out,
 *  which is the signal to hand the first-line job over to Doubao. */
async function plantNetIdentify(
  photoDataUrl: string,
  apiKey: string,
  /** 同一株植物的额外角度照（data URL）。Pl@ntNet 官方支持一次提交多张图并**综合**给分，
   *  这是它自家推荐的提准手段（多角度比单张更容易定到种），所以补拍带来的 2 张一起发。
   *  非 JPEG/PNG 的会被就地跳过，绝不因为一张格式不对而拖垮整次请求。 */
  extraDataUrls: string[] = [],
): Promise<{
  verdict: PlantNetVerdict | null;
  quotaExhausted: boolean;
  /** HTTP 状态码（0 = 请求本身抛异常）。自检靠它区分「key 无效」和「图认不出来」。 */
  status: number;
  /** 非 2xx 时的响应体片段，用于把真实原因带到自检界面。 */
  body: string;
}> {
  const m = photoDataUrl.match(/^data:([^;]+);base64,(.+)$/);
  const mime = m?.[1] ?? "image/jpeg";
  const b64 = m?.[2] ?? photoDataUrl;
  // Pl@ntNet 只接受 JPEG / PNG。收到 WebP 会 400「Unsupported file type」——
  // 而前端 compressImage 默认输出的正是 WebP，这曾让专业定种整条链路静默失效。
  // 识别链路已改为强制 JPEG（compressImage 的 preferType），这里再兜一道：
  // 遇到不支持的格式直接短路，不白发一次注定 400 的请求，并把原因明确暴露给自检。
  if (!/(jpeg|jpg|png)/i.test(mime)) {
    console.warn(
      `[Pl@ntNet] 跳过：不支持的图片格式 ${mime}（只收 JPEG/PNG）。识别链路应在前端压成 JPEG。`,
    );
    return {
      verdict: null,
      quotaExhausted: false,
      status: 415,
      body: `不支持的图片格式 ${mime}，Pl@ntNet 只接受 JPEG/PNG`,
    };
  }
  const ext = mime.includes("png") ? "png" : "jpg";
  const bytes = Buffer.from(b64, "base64");

  const form = new FormData();
  form.append("images", new Blob([new Uint8Array(bytes)], { type: mime }), `plant.${ext}`);
  form.append("organs", "auto");
  // 额外角度照：每张都要 images + organs **成对**追加，Pl@ntNet 按顺序一一对应，
  // 少一个 organs 就会整体 400。上限 4 张（连主图 5 张，是 Pl@ntNet 单次请求的上限）。
  for (const [i, du] of extraDataUrls.slice(0, 4).entries()) {
    const em = du.match(/^data:([^;]+);base64,(.+)$/);
    const emime = em?.[1] ?? "image/jpeg";
    if (!/(jpeg|jpg|png)/i.test(emime)) {
      console.warn(`[Pl@ntNet] 跳过额外角度照 #${i + 1}：不支持的格式 ${emime}`);
      continue;
    }
    const eb64 = em?.[2] ?? du;
    const eext = emime.includes("png") ? "png" : "jpg";
    form.append(
      "images",
      new Blob([new Uint8Array(Buffer.from(eb64, "base64"))], { type: emime }),
      `plant-${i + 2}.${eext}`,
    );
    form.append("organs", "auto");
  }

  // project=all (k-world-flora)：PlantNet 公共库没有专门的中国/内蒙 flora，盲切区域库反而
  // 可能漏掉本地种；若日后确认有可用亚洲库再切 project。
  // no-reject=true：对把握不足的图也返回最可能候选（否则可能 404 Species not found），一线
  // 信号更稳；nb-results=5：多带备选进 hint，帮下游模型排除易混种。
  const url = `https://my-api.plantnet.org/v2/identify/all?api-key=${encodeURIComponent(apiKey)}&nb-results=5&no-reject=true`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20_000);
  let resp: Response;
  try {
    resp = await fetch(url, { method: "POST", body: form, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
  if (!resp.ok) {
    const body = (await resp.text().catch(() => "")).slice(0, 200);
    console.warn("[Pl@ntNet] HTTP", resp.status, body);
    // 429 = 每日免费额度（500 次）用尽。只有这一种状态值得持久标记并交棒给二次复核模型；
    // 401/403 之类是 key 配置问题，本次失败即可，不该让 Pl@ntNet 被长期跳过。
    return { verdict: null, quotaExhausted: resp.status === 429, status: resp.status, body };
  }
  const data = await resp.json();
  const results = Array.isArray(data.results) ? data.results : [];
  const top = results[0];
  const sci = top?.species?.scientificNameWithoutAuthor ?? top?.species?.scientificName ?? "";
  // HTTP 200 但没有可用判定 = key 有效、只是这张图认不出来。自检要能区分这两种情况。
  if (!sci) return { verdict: null, quotaExhausted: false, status: resp.status, body: "" };
  return {
    quotaExhausted: false,
    status: resp.status,
    body: "",
    verdict: {
      scientific_name: sci,
      family: top.species?.family?.scientificNameWithoutAuthor ?? "",
      genus: top.species?.genus?.scientificNameWithoutAuthor ?? "",
      score: typeof top.score === "number" ? top.score : 0,
      candidates: results.slice(0, 4).map((r: any) => {
        const n = r.species?.scientificNameWithoutAuthor ?? r.species?.scientificName ?? "?";
        const s = typeof r.score === "number" ? Math.round(r.score * 100) : 0;
        return `${n}（${s}%）`;
      }),
    },
  };
}

// ─── 二次复核视觉模型（任意 OpenAI 兼容厂商）──────────────────────────────────
// 只在 phase-1（Pl@ntNet + Gemini）判为「疑似」时才咨询的第二个多模态模型。它返回与
// identifyQuick 相同的摘要卡字段，所以一个有把握的判定可以整卡替换 phase-1 结果
// （确认或纠正皆走同一条路径），从而跳过补拍；它若同样没把握，则维持疑似 → 照常补拍。
//
// **厂商无关**：只要求对方提供 OpenAI 兼容的 /chat/completions（image_url 传图）。已知可用：
//   · 火山方舟(二次复核模型)  https://ark.cn-beijing.volces.com/api/v3        模型 doubao-*-vision-* / ep-*
//   · 阿里 DashScope  https://dashscope.aliyuncs.com/compatible-mode/v1  模型 qwen-vl-max / qwen-vl-plus
//   · OpenAI          https://api.openai.com/v1                        模型 gpt-4o 等
// 因此换厂商只需在管理面板改 apiKey + baseUrl + model，无需改代码。
// 注意各家 Key 都要用**推理（数据面）Key**，不是控制台的 AK/SK。
type SecondOpinionConfig = {
  apiKey: string;
  model: string;
  baseUrl: string;
  /** 已解析的推理开关（默认 off —— 复核就是被推理模型拖超时的重灾区）。 */
  thinking?: ThinkingMode;
};

const SECOND_OPINION_DEFAULT_BASE = "https://ark.cn-beijing.volces.com/api/v3";

/** 32×32 的极小 JPEG，用来探测某个模型**是否真的具备图像能力** —— 纯文本 ping 只能测出
 *  模型存不存在，测不出它能不能看图。约 1KB base64，探测成本可忽略。 */
const VISION_PROBE_JPEG_B64 =
  "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAA0JCgsKCA0LCgsODg0PEyAVExISEyccHhcgLikxMC4pLSwzOko+MzZGNywtQFdBRkxOUlNSMj5aYVpQYEpRUk//2wBDAQ4ODhMREyYVFSZPNS01T09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT0//wAARCAAgACADASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwCCpYreWbPlIWA79BRbRedcJHnAJ5+lbyIsaBEACjoK4W7HGkYUtrPCu6SMgevWoa6QgEEEAg9Qaw76AQXBVfukZHtSUrg0NtJRDcpI3QHn+VbwIIBBBB6EVzdWLe8mgXapBX0YdKJK4Jm7WJqEyzXJKEFVG3I70TX88ybCVVT12jrVWiMbA2f/2Q==";

/** 读二次复核模型配置：优先新 key `second_opinion_config`，回退旧的 `doubao_vision_config`
 *  （早期只支持二次复核模型时用的名字），最后回退环境变量。旧配置无需迁移即可继续生效。 */
async function loadSecondOpinionConfig(): Promise<SecondOpinionConfig | null> {
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data } = await (supabaseAdmin as any)
      .from("site_config")
      .select("key, value")
      .in("key", ["second_opinion_config", "doubao_vision_config"]);
    const rows: any[] = Array.isArray(data) ? data : [];
    const pick =
      rows.find((r) => r.key === "second_opinion_config") ??
      rows.find((r) => r.key === "doubao_vision_config");
    const raw = pick?.value;
    if (raw) {
      // 同上：认新旧两种形态，本函数只回序列 1（顺位降级见 loadSecondOpinionQueue()）。
      const q = readModelQueue(typeof raw === "string" ? JSON.parse(raw) : raw);
      const first = q.sequence[0];
      if (first?.apiKey && first?.model) {
        return {
          apiKey: first.apiKey,
          model: first.model,
          baseUrl: first.baseUrl || SECOND_OPINION_DEFAULT_BASE,
        };
      }
    }
  } catch (e) {
    console.warn("[SecondOpinion] Failed to load config from site_config:", e);
  }
  const envKey = (process.env.SECOND_OPINION_API_KEY ?? process.env.DOUBAO_API_KEY ?? "").replace(
    /\s+/g,
    "",
  );
  const envModel = (process.env.SECOND_OPINION_MODEL ?? process.env.DOUBAO_MODEL ?? "").trim();
  if (envKey && envModel) {
    const baseUrl =
      normalizeBaseUrl(
        process.env.SECOND_OPINION_API_BASE ??
          process.env.DOUBAO_API_BASE ??
          SECOND_OPINION_DEFAULT_BASE,
      ) || SECOND_OPINION_DEFAULT_BASE;
    return { apiKey: envKey, model: envModel, baseUrl };
  }
  return null;
}

/**
 * 按二次复核的**优先调用序列**依次尝试，返回第一个出结果的。
 * 两个消费点本来就是「任何失败都返回 null」的优雅风格，所以降级就是
 * 「挨个试到有结果为止」—— 不会因为序列 1 挂了就整个功能哑掉。
 * 序列为空时退回 loadSecondOpinionConfig()（它自带 .env 兜底）。
 */
/**
 * 复核失败的**真实原因**。
 *
 * 为什么要有这个：原先复核一失败就统一报「模型限流、超时或未配置」—— 那是一句**猜测**，
 * 而且三个猜测里没一个对得上真实故障（真凶是 response_format 被中转拒收）。用户在后台
 * 看到「连通体检 ✅ 视觉自检 ✅」，前台却说「未配置」，只能一脸问号。
 * 现在把每个序列项的实际失败写进来，原样呈给用户。
 */
let secondOpinionFailures: string[] = [];
function noteFailure(msg: string) {
  if (secondOpinionFailures.length < 4) secondOpinionFailures.push(msg);
}
/** 取出并清空本次识别累积的复核失败原因。 */
function takeSecondOpinionFailures(): string {
  const s = secondOpinionFailures.join("；");
  secondOpinionFailures = [];
  return s;
}

/**
 * 整轮二次复核的**总时间预算**（毫秒），跨全部序列项共享。
 *
 * 为什么必须是「总预算」而不是「每项 N 秒」（2026-07-24 用户实测）：
 * 原来每项固定 30 秒，配 3 个序列项 → 最坏 90 秒。而 phase-1 是**前台 HTTP 请求**，
 * Cloudflare 边缘 100 秒就掐断，等于把整次识别一起赔进去。所以顺位必须在总预算内进行：
 * 预算见底就不再起新的一项，如实告诉用户「预算已用完，还剩几项没试」。
 *
 * 45 秒是这么定的：phase-1 里 Pl@ntNet + 出卡模型通常占 10–25 秒，留 45 秒给复核后
 * 仍有约 30 秒余量应付上传与写库。**不要为了迁就某个慢模型往上调** —— 该换模型，
 * 或者在控制台把它排到序列后面。
 */
const SECOND_OPINION_TOTAL_BUDGET_MS = 45_000;
/** 单项上限。留出余量让下一项还有机会跑，别让第一个慢模型独吞整个预算。 */
const SECOND_OPINION_SLOT_CAP_MS = 28_000;
/** 起一项新调用至少要剩这么多时间，否则起了也只是白等一次超时。 */
const SECOND_OPINION_MIN_SLOT_MS = 8_000;

/** 本轮复核的截止时刻（epoch ms）。withSecondOpinionSlots 进入时设定。 */
let secondOpinionDeadline = 0;

/** 当前这一项能用的超时（毫秒）；已无预算返回 0。 */
function secondOpinionSlotTimeout(): number {
  const left = secondOpinionDeadline - Date.now();
  if (left < SECOND_OPINION_MIN_SLOT_MS) return 0;
  return Math.min(left, SECOND_OPINION_SLOT_CAP_MS);
}

async function withSecondOpinionSlots<T>(
  fn: (cfg: SecondOpinionConfig) => Promise<T | null>,
): Promise<T | null> {
  secondOpinionFailures = [];
  secondOpinionDeadline = Date.now() + SECOND_OPINION_TOTAL_BUDGET_MS;
  const { sequence } = await loadSecondOpinionQueue();
  // 复核链路**必须**能看照片（它的全部工作就是重看一遍图）。已测出 blind 的项直接剔除 ——
  // 留着它只会得到一个凭空编造的"复核结论"，而且因为它 HTTP 200，顺位机制永远不会救场。
  const seeing = sequence.filter((s) => !isKnownBlind(s));
  if (seeing.length < sequence.length)
    console.warn(`[二次复核] 跳过 ${sequence.length - seeing.length} 个已测出「不读图」的序列项`);
  // ⚠️ 兜底只在**控制台压根没配序列**时才走。
  // 曾经写成「seeing 为空就兜底」，结果 blind 过滤被自己架空：
  // loadSecondOpinionConfig() 读的正是同一个控制台的 sequence[0] —— 也就是刚被判定
  // 不读图、刚被剔除的那一个。于是照样把它打了一遍，白花一次调用、必然拿不到有效复核，
  // 而且因为 slots 非空，上面那句「全部被测出不读图」的说明也不会报出来 ——
  // 用户只看到一句语焉不详的「复核未能完成」，查不到真正原因（07-24 线上实测就是这样）。
  const slots: SecondOpinionConfig[] = seeing.length
    ? seeing.map((s) => ({
        apiKey: s.apiKey,
        model: s.model,
        baseUrl: s.baseUrl || SECOND_OPINION_DEFAULT_BASE,
        thinking: thinkingOf(s, "second_opinion"),
      }))
    : sequence.length
      ? [] // 配了、但全是 blind → 直接放弃，别再拿同一个瞎模型试一次
      : await loadSecondOpinionConfig().then((c) => (c ? [c] : []));
  if (!slots.length) {
    noteFailure(
      sequence.length
        ? `「二次复核」控制台的 ${sequence.length} 个序列项**全部被测出不读图**` +
            `（${sequence.map((s) => s.model).join("、")}），已跳过 —— ` +
            `请在该控制台换成能读图的视觉模型，并点「视觉自检」验证`
        : "「二次复核」控制台没有配置任何模型",
    );
  }
  for (const [i, cfg] of slots.entries()) {
    // 预算见底就停 —— 起一项注定超时的调用，只会把 phase-1 整体推向边缘 100 秒上限。
    if (secondOpinionSlotTimeout() === 0) {
      noteFailure(
        `复核总预算 ${Math.round(SECOND_OPINION_TOTAL_BUDGET_MS / 1000)} 秒已用完，` +
          `剩余 ${slots.length - i} 个序列项（${slots
            .slice(i)
            .map((s) => s.model)
            .join("、")}）未再尝试`,
      );
      break;
    }
    const r = await fn(cfg);
    if (r) return r;
    if (i < slots.length - 1)
      console.warn(`[二次复核] 序列 ${i + 1}（${cfg.model}）没出结果，顺位下一个`);
  }
  return null;
}

/** Second-opinion identify via Doubao. Returns the SAME quick-card fields as identifyQuick
 *  (so a confident verdict can replace the phase-1 card wholesale), or null on any failure /
 *  missing config — in which case the caller keeps the 疑似 result and routes to 补拍. */
async function secondOpinionIdentify(
  photoDataUrl: string,
  priorPhotos: InlineImage[],
  hintPlace: string,
  ctx: { candidate?: string | null; plantNetHint?: string | null },
): Promise<{ meta: AiMeta; model: string; usage: AiTokenUsage } | null> {
  return withSecondOpinionSlots(async (cfg) => {
    // 补拍照片从 4 张收到 2 张：图片是这次请求里**最重的输入**，每多一张都同时推高
    // 上传耗时与首字延迟，而复核要的只是「再看一眼、给个物种」——第 3、4 张补拍照
    // 对结论的边际贡献远不抵它们对超时风险的贡献。最新那张永远单独发（下面 photoDataUrl）。
    const prior = priorPhotos.slice(0, 2);
    const cand = (ctx.candidate || "").trim();
    const system = `你是资深植物分类学家，正在对一张实地拍摄的植物照片做「二次复核」识别。前序识别（Pl@ntNet 专业引擎 + Gemini）对本图把握不足、判为「疑似」。请你**独立判断**：若你有充分把握，可确认或**纠正**为你认为正确的物种（不必迁就前序判断）；若你同样无法确诊到种，请诚实给 low。
只返回一个 JSON 对象（不要 markdown、不要多余文字），字段如下。为了尽快出卡，**只输出下列字段，不要生成英文摘要、拍摄记录等额外内容**（与 phase-1 简介摘要卡的字段集保持一致）：
{"title":"中文物种名","scientific_name":"拉丁学名（尽量精确到种）","common_name_en":"英文俗名","common_names_zh":"中文俗名（逗号分隔，可留空）","family":"科（中文+拉丁）","genus":"属（中文+拉丁）","summary_zh":"150–260 字趣味导语（博物学家口吻，讲与生活相关的趣闻/冷知识，勾起好奇心；不要罗列科属学名形态，也不要复述拍摄地点）","identification_confidence":"high 或 medium 或 low","needs_more_photos_zh":"","needs_more_photos_en":""}
硬性规则：
- 置信度必须诚实：诊断特征充分且高度吻合=high；仅能到属=medium；照片不足只能疑似=low。**宁可 low 也不要凭有限照片武断定成错误物种——错误定种比暂不定种更糟。**
- 为 low（medium 视需要）时：summary_zh 以「疑似」开头，且 needs_more_photos_zh/en 必须写 2–4 条面向**完全不懂植物学的普通人**的大白话拍摄动作，① ② ③ 编号，每条一句话一个动作，讲清「拍哪里+怎么拍」，**严禁专业术语**（脉序/被毛/托叶/花序/苞片…）。**每条都必须是「拍下来能看见」的动作——严禁摸质感/闻气味/尝味道这类非视觉建议**（用户唯一能给你的就是照片）。每条都要瞄准最能把本物种与常见易混种区分开的那个部位。identification_confidence 为 high 时，两个 needs_more_photos_* 一律留空字符串。
- 拍摄地点真实性（硬性）：仅当下文给出拍摄地点时才可写具体地名；未提供则严禁编造或反推任何地名。
- 中文用正式植物志措辞；不要在字段里使用 * 等 markdown 强调符。`;

    const content: unknown[] = [
      {
        type: "text",
        text:
          `请复核识别这${prior.length ? "组" : "张"}植物照片。` +
          (prior.length
            ? `第 1 张是最新、最清晰的照片，随后 ${prior.length} 张是同一株植物先前拍摄的，请**综合全部 ${prior.length + 1} 张照片**判定。`
            : "") +
          (cand ? `前序倾向判断为「${cand}」，仅供参考、可以推翻。` : "") +
          (ctx.plantNetHint ? `${ctx.plantNetHint}` : "") +
          (hintPlace ? `拍摄地点：${hintPlace}。` : "") +
          `只按上面的 JSON 结构返回。`,
      },
      { type: "image_url", image_url: { url: photoDataUrl } },
      ...prior.map((im) => ({
        type: "image_url",
        image_url: { url: `data:${im.mimeType};base64,${im.base64}` },
      })),
    ];

    const budgetMs = secondOpinionSlotTimeout();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), budgetMs);
    const startedAt = Date.now();
    try {
      // ⚠️ **流式**，不是普通 POST。这正是 2026-07-24 用户报「换了好几个模型、自检三条链路
      // 全过，二次复核照样不运行」的直接原因之一：复核配的多半是第三方聚合中转，中转在
      // 上游没吐完之前**一个字节都不回**，于是整段生成时间全砸在「等第一个字节」上。
      // 开了流以后 token 是边生成边回的，同样的模型往往能在预算内完成。
      // postOpenAICompatStream 会把 SSE 增量拼回与普通响应同形的 JSON，下面的解析不用改；
      // 中转要是压根不支持流式，它会回 599，我们再退回非流式重来一次（见 catch 之外那段）。
      let resp = await postOpenAICompatStream(
        `${cfg.baseUrl}/chat/completions`,
        cfg.apiKey,
        {
          model: cfg.model,
          messages: [
            { role: "system", content: system },
            { role: "user", content },
          ],
          // 关思考。复核模型常是推理模型，默认先写一大段思维链 —— 对「再看一眼图报个物种」
          // 这件事几乎没有增益，却能把 8 秒的调用拖到 40 秒以上，必然撞超时。
          // 三种写法一起发，不认的那个会被 postOpenAICompat 从 400 报错里认出来并摘掉。
          ...thinkingParams(cfg),
          // ⚠️ **刻意不发 `response_format: {type:"json_object"}`**。
          // 复核链路配的基本都是第三方中转（能列出两百多个模型的那种聚合站），而中转对这个
          // 参数的支持五花八门：不认的直接 400，认一半的返回空字符串。callAiIdentify
          // （见下方 `provider === "custom"` 那处）和 `send()` 早就因为同样的原因绕开了它，
          // 这里是漏网的一处 —— 症状极具迷惑性：**后台「连通体检」和「视觉自检」全绿**
          // （那两个请求都不带这个参数），偏偏一到真复核就失败，于是报成「未配置」。
          // prompt 里已经写死「只返回一个 JSON 对象」，且 cleanJson() 能剥掉 ``` 围栏。
          // 3000 → 1200：这张卡最长的字段是 150–260 字导语，加上其余字段 1200 token 绰绰有余。
          // 上限本身不影响正常返回，但它是**推理模型思维链的天花板** —— 调小相当于给
          // 「想太久」封了顶，超时时也能更快落地到下一个序列项。
          max_tokens: 1200,
          temperature: 0,
        },
        { signal: controller.signal },
      );
      // 中转把 stream 参数吃掉了（回了 200 但不是 SSE）→ postOpenAICompatStream 约定回 599。
      // 这不是模型的问题，退回非流式再打一次，别白白判这一项失败。
      if (resp.status === 599) {
        console.warn(`[SecondOpinion] ${cfg.model} 的中转不支持流式，退回非流式重试`);
        resp = await postOpenAICompat(
          `${cfg.baseUrl}/chat/completions`,
          cfg.apiKey,
          {
            model: cfg.model,
            messages: [
              { role: "system", content: system },
              { role: "user", content },
            ],
            ...thinkingParams(cfg),
            max_tokens: 1200,
            temperature: 0,
          },
          { signal: controller.signal },
        );
      }
      if (!resp.ok) {
        const body = (await resp.text().catch(() => "")).slice(0, 300);
        console.warn("[SecondOpinion] HTTP", resp.status, body);
        noteFailure(
          `${cfg.model} 返回 HTTP ${resp.status}${body ? "：" + body.slice(0, 120) : ""}`,
        );
        return null;
      }
      const data = await resp.json();
      const text = data.choices?.[0]?.message?.content;
      if (!text) {
        console.warn("[SecondOpinion] 空响应", cfg.model, JSON.stringify(data).slice(0, 200));
        noteFailure(`${cfg.model} 返回了空内容（HTTP 200 但 choices[0].message.content 为空）`);
        return null;
      }
      const meta = JSON.parse(cleanJson(text)) as AiMeta;
      const u = data.usage ?? {};
      console.log(`[SecondOpinion] ${cfg.model} 复核完成，耗时 ${Date.now() - startedAt} ms`);
      return {
        meta,
        model: cfg.model,
        usage: {
          prompt_tokens: u.prompt_tokens ?? 0,
          completion_tokens: u.completion_tokens ?? 0,
          total_tokens: u.total_tokens ?? 0,
        },
      };
    } catch (e) {
      // Non-fatal by design: a failed second opinion just means we keep the 疑似 verdict.
      const msg = e instanceof Error ? e.message : String(e);
      const spent = Math.round((Date.now() - startedAt) / 1000);
      console.warn(`[SecondOpinion] second opinion failed after ${spent}s:`, msg);
      noteFailure(
        controller.signal.aborted
          ? // ⚠️ 这句话必须点破「自检全绿 ≠ 真复核能跑完」。用户实测里最费解的一点就是：
            // 后台三条自检全过，前台却说复核没运行。原因是自检发的是一张 846 字节的
            // 四色小图 + 只要四个词的回答（约 2 秒），而真复核发的是整张实拍照片（外加
            // 补拍照）+ 要一段 150–260 字的导语 —— 两者的耗时根本不是一个量级。
            // 自检回答的是「这个 key 能用吗 / 这个模型看得见图吗」，从来不回答「它够不够快」。
            `${cfg.model} 在 ${Math.round(budgetMs / 1000)} 秒内没返回（实际等了 ${spent} 秒）。` +
              `注意：后台「连通体检 / 视觉自检」发的是一张几百字节的小图、只要四个词的回答，` +
              `全绿只说明 key 可用、模型能读图，**测不出它答一次真实复核要多久** —— ` +
              `推理模型（qwen3 / glm / deepseek 的 thinking 版等）常常要 40 秒以上。` +
              `建议在「二次复核」控制台换成非推理的视觉模型（或该模型的 non-thinking / turbo 版本），` +
              `并把慢的那个排到序列后面。`
          : `${cfg.model} 调用出错（第 ${spent} 秒）：${msg.slice(0, 140)}`,
      );
      return null;
    } finally {
      clearTimeout(timer);
    }
  });
}

/** 二次复核模型顶替 Pl@ntNet 做「一线专业定种」——只在 Pl@ntNet 不可用（每日 500 次免费额度用尽 /
 *  未配 key / 请求失败）时调用。刻意只要极少字段：产物只是喂给 Gemini 的定种基准 hint，不需要
 *  成篇内容，所以比 secondOpinionIdentify（完整摘要卡）快得多也便宜得多。失败返回 null → 退回纯 Gemini。*/
async function secondOpinionPrimaryVerdict(
  photoDataUrl: string,
  priorPhotos: InlineImage[],
): Promise<{ hint: string; label: string; usage: AiTokenUsage; model: string } | null> {
  return withSecondOpinionSlots(async (cfg) => {
    const prior = priorPhotos.slice(0, 4);
    const system = `你是专业植物分类引擎。识别照片里的植物，只返回一个 JSON 对象（不要 markdown、不要多余文字）：
{"scientific_name":"最可能物种的拉丁学名（尽量到种）","family":"科（拉丁）","genus":"属（拉丁）","confidence":0到100的整数,"candidates":["候选学名（xx%）","…最多 4 个，按可能性降序"]}
规则：confidence 是你对首选物种的把握（0–100 整数），**必须诚实**——照片不足以确诊到种时就给低分，不要为了给出答案而虚高。candidates 至少包含首选本身。`;

    const content: unknown[] = [
      {
        type: "text",
        text:
          `识别这${prior.length ? "组" : "张"}植物照片。` +
          (prior.length ? `共 ${prior.length + 1} 张同一株植物的不同角度，请综合判定。` : "") +
          `只按上面的 JSON 结构返回。`,
      },
      { type: "image_url", image_url: { url: photoDataUrl } },
      ...prior.map((im) => ({
        type: "image_url",
        image_url: { url: `data:${im.mimeType};base64,${im.base64}` },
      })),
    ];

    const controller = new AbortController();
    // 与复核共用同一份总预算（都走 withSecondOpinionSlots）。这条路只要几个字段、
    // 不写导语，本来就快得多，所以给 20 秒封顶就够。
    const timer = setTimeout(
      () => controller.abort(),
      Math.min(secondOpinionSlotTimeout() || 1, 20_000),
    );
    try {
      const resp = await postOpenAICompat(
        `${cfg.baseUrl}/chat/completions`,
        cfg.apiKey,
        {
          model: cfg.model,
          messages: [
            { role: "system", content: system },
            { role: "user", content },
          ],
          // 同复核：顶替定种只要一个学名和一个分数，思维链纯属拖时间。
          ...thinkingParams(cfg),
          response_format: { type: "json_object" },
          max_tokens: 600,
          temperature: 0,
        },
        { signal: controller.signal },
      );
      if (!resp.ok) {
        console.warn(
          "[SecondOpinion] primary verdict HTTP",
          resp.status,
          (await resp.text().catch(() => "")).slice(0, 300),
        );
        return null;
      }
      const data = await resp.json();
      const text = data.choices?.[0]?.message?.content;
      if (!text) return null;
      const v = JSON.parse(cleanJson(text)) as {
        scientific_name?: string;
        family?: string;
        genus?: string;
        confidence?: number;
        candidates?: string[];
      };
      const sci = (v.scientific_name || "").toString().trim();
      if (!sci) return null;
      const pct = Math.max(0, Math.min(100, Math.round(Number(v.confidence) || 0)));
      const cands = Array.isArray(v.candidates) ? v.candidates.slice(0, 4).map(String) : [];
      const u = data.usage ?? {};
      return {
        label: `${sci}@${pct}%`,
        hint:
          `【专业识别判定（二次复核模型视觉 · Pl@ntNet 额度用尽时顶替）】最可能物种：${sci}` +
          `${v.family ? `（科 ${v.family}${v.genus ? ` / 属 ${v.genus}` : ""}）` : ""}` +
          `，置信度 ${pct}%。${cands.length ? `备选：${cands.join("、")}。` : ""}` +
          `请以此判定为基准核对照片；若置信度偏低（低于 30%）或与照片明显不符，` +
          `请在 summary_zh 开头标注「疑似」并简述分歧依据。`,
        model: cfg.model,
        usage: {
          prompt_tokens: u.prompt_tokens ?? 0,
          completion_tokens: u.completion_tokens ?? 0,
          total_tokens: u.total_tokens ?? 0,
        },
      };
    } catch (e) {
      console.warn("[SecondOpinion] primary verdict failed:", e instanceof Error ? e.message : e);
      return null;
    } finally {
      clearTimeout(timer);
    }
  });
}

/** Token-saving helper: given a species key (normalized scientific name), query the
 *  most recent approved draft of that species and return its ai_payload (the full AiMeta
 *  stored at generation time). Returns null if no match or the payload is missing. */
async function findExistingSpeciesDraft(speciesName: string): Promise<AiMeta | null> {
  if (!speciesName) return null;
  const key = speciesKey(speciesName); // normalize to genus+species lowercase
  if (!key) return null;

  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    // Find the most recent draft whose scientific_name matches the same species key.
    // We prefer approved drafts (higher quality) but fall back to any draft if needed.
    const { data } = await supabaseAdmin
      .from("plant_drafts")
      .select("ai_payload, scientific_name")
      .not("ai_payload", "is", null)
      .order("created_at", { ascending: false })
      .limit(50); // check recent 50 drafts for a match

    if (!data?.length) return null;

    for (const row of data) {
      if (!row.scientific_name) continue;
      const rowKey = speciesKey(row.scientific_name);
      if (rowKey !== key || !row.ai_payload) continue;
      const payload = row.ai_payload as AiMeta & { _enriched?: boolean };
      // CRITICAL: never reuse a phase-1 "lite" card (or any payload missing the
      // long-form body). Those carry only summary/field_notes — reusing one makes
      // the "生成完整草稿" step render section images with EMPTY text. Require real
      // body content before treating a draft as a reusable full draft.
      if (payload._enriched === false) continue;
      if (!(payload.morphology_zh || "").trim() || !(payload.habitat_zh || "").trim()) continue;
      console.log(`[TokenSave] Found existing FULL draft for species key "${key}"`);
      return payload;
    }
  } catch (e) {
    console.warn("[TokenSave] Failed to query existing drafts:", e);
  }
  return null;
}

/** Token-saving helper: given a photo and the existing species' universal content,
 *  generate ONLY the field_notes (the photo-specific observation) via a small AI call.
 *  Returns {field_notes_zh, field_notes_en, usage} or null on any failure. */
async function generateFieldNotesOnly(
  photoDataUrl: string,
  hintPlace: string,
  speciesName: string,
  existingTitle: string,
): Promise<{ field_notes_zh: string; field_notes_en: string; usage: AiTokenUsage } | null> {
  const geminiKey = process.env.GEMINI_API_KEY;
  if (!geminiKey) return null; // need Gemini for this small reliable call

  const prompt = `你是 Plantspedia 的植物学家。给定一张实地拍摄的 **${existingTitle}（${speciesName}）** 照片${hintPlace ? `（拍摄于 ${hintPlace}）` : ""}，请生成一份「拍摄记录」，120–220 字中文 + 45–85 词英文。

**主题必须是对这张照片的形态分析，以及据此定种的判断依据**（不要写物种通用知识，只针对本图）：
① 照片中实际可见的诊断性特征（叶序/叶形/叶缘、花色花瓣数、果实、茎刺毛被、拍摄季节等）；
② 由这些可见特征如何推导到该物种，哪些特征可与易混种相区分；
③ 若照片信息不足以确诊，需要哪些补充角度（花特写、果实、叶背等）。

只返回一个 JSON 对象，格式：{"field_notes_zh":"中文拍摄记录","field_notes_en":"English field notes"}。不要 markdown、不要多余文字。`;

  try {
    const match = photoDataUrl.match(/^data:([^;]+);base64,(.+)$/);
    const mimeType = match ? match[1] : "image/jpeg";
    const base64Data = match ? match[2] : photoDataUrl;

    const model = process.env.AI_MODEL || "gemini-3-flash-preview";
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${geminiKey}`;

    const resp = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [
          {
            role: "user",
            parts: [{ text: prompt }, { inlineData: { mimeType, data: base64Data } }],
          },
        ],
        generationConfig: {
          responseMimeType: "application/json",
          temperature: 0.0,
        },
      }),
    });

    if (!resp.ok) {
      console.warn("[TokenSave] field_notes generation failed:", resp.status);
      return null;
    }

    const data = await resp.json();
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) return null;

    const parsed = JSON.parse(cleanJson(text));
    const u = data.usageMetadata ?? {};

    return {
      field_notes_zh: (parsed.field_notes_zh || "").toString().trim(),
      field_notes_en: (parsed.field_notes_en || "").toString().trim(),
      usage: {
        prompt_tokens: u.promptTokenCount ?? 0,
        completion_tokens: u.candidatesTokenCount ?? 0,
        total_tokens: u.totalTokenCount ?? 0,
      },
    };
  } catch (e) {
    console.warn("[TokenSave] field_notes generation error:", e);
    return null;
  }
}

/**
 * 识别一线调用：按管理员配置的**优先调用序列**依次尝试，序列 1 失败（额度用尽 /
 * 限流 / key 失效 / 模型不存在 / 服务端故障）就顺位交给 2、3…。
 * 序列为空时回退到 .env（保持老部署可用）。
 */
async function callAiIdentify(
  photoDataUrl: string,
  hintPlace: string,
  speciesHint?: { title?: string; scientificName?: string } | null,
  webResearch?: { digest: string; sources: { title: string; uri: string }[] },
  // 哪条链路在调用：拍照出卡走「出卡AI」序列；enrichDraft 的重活走「草稿生成模型」
  // 序列。两者未单独配置时都自动回退到「AI 模型控制台」。
  queueKind: "card" | "enrich" = "card",
): Promise<{ meta: AiMeta; model: string; provider: string; usage: AiTokenUsage }> {
  const { sequence } = queueKind === "enrich" ? await loadEnrichQueue() : await loadCardQueue();
  // 没配序列 → 传 null，让下游走 .env Gemini 兜底（与改造前行为一致）。
  if (!sequence.length)
    return callAiIdentifyWithConfig(null, photoDataUrl, hintPlace, speciesHint, webResearch);
  return runModelQueue(
    sequence,
    (slot) =>
      callAiIdentifyWithConfig(
        {
          provider: slot.provider,
          apiKey: slot.apiKey,
          model: slot.model,
          baseUrl: slot.baseUrl,
          thinking: thinkingOf(slot, queueKind),
        },
        photoDataUrl,
        hintPlace,
        speciesHint,
        webResearch,
      ),
    queueKind === "enrich" ? "草稿生成" : "出卡AI",
    // 两条链路都要把用户拍的照片喂给模型 —— 正是 deepseek-v4-flash 事故的现场。
    { requireVision: true },
  );
}

/**
 * 用**指定的一套配置**跑一次完整识别。外面的 callAiIdentify() 负责按优先调用序列
 * 依次喂不同的配置进来 —— 这里只管「用这一套跑通」，不关心降级。
 */
async function callAiIdentifyWithConfig(
  slotConfig: AiProviderConfig | null,
  photoDataUrl: string,
  hintPlace: string,
  // When the species is ALREADY decided (e.g. phase-2 enrich of a phase-1 card),
  // pass it here so the full draft is written FOR that species instead of being
  // re-identified from scratch — this is what keeps the enriched draft's name
  // consistent with the summary card the user already saw.
  speciesHint?: { title?: string; scientificName?: string } | null,
  // Web research digest from enrichDraft's 联网调研 step. Injected into the system
  // prompt as authoritative reference material for accuracy + timeliness.
  webResearch?: { digest: string; sources: { title: string; uri: string }[] },
): Promise<{ meta: AiMeta; model: string; provider: string; usage: AiTokenUsage }> {
  // 这一套配置由调用方（序列执行器）给定；null = 走 .env 兜底路径。
  const dbConfig = slotConfig;

  // ── Two-stage: glm 快速识别 + Gemini 出草稿 ─────────────────────────────────
  // A custom relay (great at a quick vision ID, unreliable on the heavy 21-field draft)
  // identifies the species; then Gemini writes the full schema-enforced draft using that
  // ID as a hint. Needs a saved `custom` config AND an env Gemini key. If the quick ID
  // fails we still fall through to a Gemini-only draft, so identify never breaks.
  let stageModel = "";
  let idHint = "";
  // A pinned species short-circuits re-identification and locks the name.
  const pinnedSci = (speciesHint?.scientificName || "").trim();
  const pinnedTitle = (speciesHint?.title || "").trim();
  // Treat EITHER a Chinese name or a Latin name as "already identified". Gating only
  // on pinnedSci was a hole: a phase-1 card with a 中文名 but empty 学名 would still
  // trigger re-identification here → the Latin name could drift after enrich.
  const pinned = !!(pinnedSci || pinnedTitle);
  if (pinned) {
    idHint +=
      `\n\n【物种已确定 · 硬性】本图所属物种已由前序识别确定为「${pinnedTitle || pinnedSci}」` +
      `${pinnedSci ? `（拉丁学名 ${pinnedSci}）` : ""}。请**不要重新定种**，直接据此撰写完整图鉴；` +
      `返回的 title / scientific_name / family / genus 必须与该物种一致，不得改判为其它物种。`;
  }

  // ── Stage 0: 专业植物识别引擎 Pl@ntNet（独立于写稿大模型；命中即作为定种基准）──
  // Runs first whenever a key is configured, regardless of which LLM writes the draft.
  // Feeds a ranked species verdict + confidence into the shared system prompt. Failure
  // is non-fatal — we simply continue with LLM-only identification.
  let earlySpeciesName = pinnedSci || ""; // seed from a pinned species (enrich); else set by cheap stages
  const plantNetKey = await loadPlantNetKey();
  // When the species is already pinned, skip re-identification entirely — it only
  // risks disagreeing with the card the user saw, and wastes a Pl@ntNet call.
  if (plantNetKey && !pinned) {
    const pnRes = await plantNetIdentify(photoDataUrl, plantNetKey).catch((e) => {
      console.warn("[Pl@ntNet] identify failed; continuing with LLM-only:", e);
      return { verdict: null, quotaExhausted: false, status: 0, body: "" };
    });
    if (pnRes.quotaExhausted) await markPlantNetQuotaExhausted();
    const pn = pnRes.verdict;
    if (pn && pn.scientific_name) {
      earlySpeciesName = pn.scientific_name;
      const pct = Math.round((pn.score ?? 0) * 100);
      idHint +=
        `\n\n【专业识别引擎 Pl@ntNet 判定】最可能物种：${pn.scientific_name}` +
        `${pn.family ? `（科 ${pn.family}${pn.genus ? ` / 属 ${pn.genus}` : ""}）` : ""}` +
        `，置信度 ${pct}%。备选：${pn.candidates.join("、")}。` +
        `请以此专业判定为基准核对照片并生成草稿；若置信度偏低（低于 30%）或与照片明显不符，` +
        `请在 summary_zh 开头标注「疑似」并简述分歧依据。`;
      stageModel = "plantnet";
    }
  }

  // 【已移除：custom → env Gemini 的改道】
  // 旧设计假设 custom 只是个「弱视觉中转」，让它做快速定种、再把写文案的重活交给
  // env 里的 Gemini。在「优先调用序列」下这个假设不成立了：每个序列项都是管理员
  // **明确指定**的完整配置，把序列 1 的 Kimi 偷偷换成 env Gemini 既违背配置意图，
  // 又会在 env key 失效/额度耗尽时报出一个与所配模型毫不相干的错误
  // （实际发生过：序列 1 明明是 kimi-k2.6，报的却是「Gemini API key 无效」）。
  // 现在一律用当前序列项自己的模型跑完整份草稿。

  // ── 复用分支：物种级内容只写一次，全站共享 ──────────────────────────────────
  // 命中时**只重新生成拍摄记录**（唯一因人而异的字段），其余照搬。整条链路对失败
  // 完全非致命：任何一步不成就落到下面的完整生成。
  //
  // 查两层，顺序刻意：
  //   ① species_dossiers —— 正式的资料包表（CP3）。
  //   ② 旧的「扫最近 50 条草稿」启发式 —— 表刚建、还没攒下资料包的过渡期靠它兜底。
  //      等资料包铺开后可以删掉②。
  let dossierHit: { id?: string; hitCount: number } | null = null;
  if (earlySpeciesName) {
    let existing: AiMeta | null = null;
    const dossier = await loadDossier(earlySpeciesName);
    if (dossier && isDossierUsable(dossier.body)) {
      existing = dossier.body as AiMeta;
      dossierHit = { id: dossier.id, hitCount: dossier.hitCount };
      console.log(
        `[Dossier] 命中「${dossier.speciesKey}」（${dossier.status}，已被复用 ${dossier.hitCount} 次）`,
      );
    } else {
      existing = await findExistingSpeciesDraft(earlySpeciesName).catch((e) => {
        console.warn("[TokenSave] Query failed:", e);
        return null;
      });
    }
    if (existing) {
      const fieldNotesResult = await generateFieldNotesOnly(
        photoDataUrl,
        hintPlace,
        existing.scientific_name || earlySpeciesName,
        existing.title || "本物种",
      ).catch((e) => {
        console.warn("[TokenSave] field_notes generation failed:", e);
        return null;
      });

      if (fieldNotesResult && fieldNotesResult.field_notes_zh) {
        // 通用内容 + 这张照片的个人信息。走 assembleDraftMeta 而不是直接展开，是为了
        // **剥掉所有照片级字段**再合并 —— 旧代码只覆盖了 field_notes，把来源草稿的
        // identification_confidence 和 needs_more_photos_* 一起继承了过来：甲那张糊照
        // 的「疑似 + 请补拍花的特写」会原样出现在乙的清晰照草稿上。见
        // species-dossier.ts 的 PHOTO_SPECIFIC_FIELDS。
        const meta = assembleDraftMeta(
          {
            body: existing as Record<string, unknown>,
            scientificName: existing.scientific_name || earlySpeciesName,
            title: existing.title ?? null,
          },
          {
            field_notes_zh: fieldNotesResult.field_notes_zh,
            field_notes_en: fieldNotesResult.field_notes_en,
          },
        ) as AiMeta;
        if (dossierHit?.id) void bumpDossierHit(dossierHit.id, dossierHit.hitCount);
        const totalUsage: AiTokenUsage = {
          prompt_tokens: fieldNotesResult.usage.prompt_tokens,
          completion_tokens: fieldNotesResult.usage.completion_tokens,
          total_tokens: fieldNotesResult.usage.total_tokens,
        };
        const via = dossierHit ? "dossier" : "legacy-scan";
        console.log(
          `[TokenSave] 复用${via === "dossier" ? "物种资料包" : "历史草稿"}，只重生成拍摄记录。Tokens: ${totalUsage.total_tokens}`,
        );
        return {
          meta,
          model: stageModel ? `${stageModel}→reuse+field_notes` : "reuse+field_notes",
          provider: stageModel ? `${stageModel}+reuse` : "reuse",
          usage: totalUsage,
        };
      }
    }
  }

  // A saved admin config is AUTHORITATIVE: route EXCLUSIVELY to that provider and
  // ignore every .env provider key. Otherwise a leftover GEMINI_API_KEY in .env
  // keeps the Gemini branch (which runs first) truthy and hijacks a custom/openai/
  // anthropic config — the chosen endpoint is never called, identify fails, and the
  // usage log records the wrong model. Only with NO db config do we use env keys.
  const geminiKey = dbConfig
    ? dbConfig.provider === "gemini"
      ? dbConfig.apiKey
      : ""
    : process.env.GEMINI_API_KEY;
  const openaiKey = dbConfig
    ? dbConfig.provider === "openai" || dbConfig.provider === "custom"
      ? dbConfig.apiKey
      : ""
    : process.env.OPENAI_API_KEY;
  const anthropicKey = dbConfig
    ? dbConfig.provider === "anthropic"
      ? dbConfig.apiKey
      : ""
    : process.env.ANTHROPIC_API_KEY;
  const lovableKey = dbConfig ? "" : process.env.LOVABLE_API_KEY;

  // Build web research context block (if provided by enrichDraft).
  let webContext = "";
  if (webResearch && webResearch.digest) {
    const srcList = webResearch.sources.length
      ? "\n参考来源：\n" +
        webResearch.sources.map((s, i) => `[${i + 1}] ${s.title || s.uri} — ${s.uri}`).join("\n")
      : "";
    webContext = `\n\n【联网调研·权威参考资料】以下是对该物种最新研究进展、保护状态、分布更新等的联网检索结果，请据此确保你撰写的内容准确、时效性强：\n${webResearch.digest}${srcList}\n`;
  }

  const systemPrompt =
    `你是 Plantspedia 的首席植物学家与资深图鉴编辑。给定一张实地拍摄的植物照片（如提供了拍摄的经纬度或行政区划信息，请结合该地理背景进行识别），请遵循极其严格的植物学形态学分类标准，识别出精准的物种（拉丁学名需精确到种、变种或亚种），并返回一份完整、信息密度高、辞藻精炼的科普草稿——直接对标已收录的精品条目（如「戈壁天门冬」）。

内容要求（请逐条满足，缺一不可）：
- summary_zh：150–260 字，一段引人入胜的「开篇导语」，以一位博学的博物学家兼科普博主的口吻来写。**主题是这种植物与人们生活相关的趣闻、要闻、冷知识或近期资讯**——例如它奇特的生存智慧、与人类饮食/医药/民俗/生态的意外联系、常被认错的趣事、名字背后的故事、或与之相关的新闻热点等，目的是勾起读者的好奇心。语气生动、有画面感、带一点惊叹与幽默，但严谨不编造。**切勿在此罗列科属、拉丁学名、形态特征或生境概要（这些放到下方各分区），也不要复述「本次拍摄于……」这类拍摄记录**，避免与页面其它部分重复。如不确定物种，开头用「疑似……」并简述判断依据。summary_en：50–90 词，同样是趣味导语式的精炼意译，而非形态总览。
- field_notes_zh：120–220 字，这是「拍摄记录」栏，**主题必须是对用户上传的这一张照片的分析，以及你据此定种的判断依据**，与 summary 内容完全不同、不得重复。具体写：① 照片里实际可见的诊断性特征（例如叶序/叶形/叶缘、花色花瓣数与排列、果实、茎/刺/毛被、拍摄季节物候等——只描述照片中真正能看到的，不要脑补看不见的部位）；② 由这些可见特征如何推导到该物种/属，哪些特征可与易混近缘种相区分；③ 若照片信息不足以确诊，如实说明还需要哪些部位或角度的照片（如花的特写、果实、叶背）才能进一步确定。口吻是植物学家在做实物鉴定，客观、就图论图。field_notes_en：45–85 词，对应意译。
- common_names_zh：包含该植物的所有中文俗名、别名、以及花卉市场常见的商品名/交易名，用半角逗号隔开（例如 "发财树, 瓜栗, 招财树"）。
- name_origin_zh：220–360 字，本节标题是「名称和分类趣闻」，所以**名称与分类各占一半、都要写出「趣」来**：① 名称——中文名（俗名、古名、地方名）的字源与典籍出处，以及拉丁学名属名 + 种加词的词根含义、命名人/命名年代背景；② 分类趣闻——本种在分类学上值得一说的事，例如曾被归入哪个属、后来因分子系统学证据被移出（写清改到哪个属）、种下等级或异名的争议、与哪个常被张冠李戴的同名/近似种长期混淆、以及所属科属本身的特点。**不要写成词源的流水账**：挑真正有意思的点讲，宁可只讲一件事讲透。分类学上的改动若记不清确切文献就只作定性表述，绝不编造年份、人名与期刊。name_origin_en：80–140 词。
- morphology_zh：320–500 字，按 株型/根 → 茎 → 叶 → 花 → 果实/种子 顺序描述，包含具体数值（如高度 cm、叶长 mm、花期月份）。morphology_en：100–160 词。
- habitat_zh：260–400 字，包含：典型生境与海拔/土壤、世界分布范围、中国分布省份，以及本次拍摄地点的生态记录。${hintPlace ? `本段必须自然带入「本次拍摄于 ${hintPlace}」一句。` : "⚠️ 本次未提供可靠的拍摄定位：严禁臆造、推断或填入任何具体拍摄地名（省/市/区/县/街道均不可），如需提及拍摄地点只能写「本次拍摄地点未知」。"}habitat_en：90–140 词。
- culture_zh：360–600 字，本部分的主题是「植物人文」，请尽量分点覆盖以下维度（无相关内容的维度可略写，但严禁编造）：① 文化与民俗；② 植物民族志——世界不同民族/地区对该植物的认知、命名与地方性知识；③ 文学——若有名篇名句或典籍记载，请引用原文片段并注明出处/作者；④ 食用与药用；⑤ 茶饮（若相关）；⑥ 商贸与经济价值；⑦ 博物学史（被发现、引种、命名、栽培传播的历史）。若该物种确无人文记载，则转而详述其生态角色与近缘种的文化对比。culture_en：120–180 词，对应中文要点的精炼意译。
- care_tips_zh：220–320 字，本部分是「养护方案的依据说明」——结合该物种的原生生境、形态适应与生长习性，解释为什么给出下方 8 张养护卡片里的方案（讲清"为什么"，不要简单罗列数值；具体数值一律放进 care_facts 卡片）。care_tips_en：80–120 词。
- care_facts：养护卡片，为对象数组，必须依次输出以下 8 张卡片，每张含 4 个字段 category/value/tag/detail（detail ≤ 50 字，简洁实用）：① category「酸碱偏好」，value=适宜 PH 范围（如「PH 6.0–6.5」），tag=酸/碱/中性 之一，detail 说明酸碱偏好及如何用施肥/有机方式调节；② category「施肥方案」，value=常见肥名称，tag=「合成：…／有机：…」，detail 区分速效与缓释；③ category「光照需求」，value=光照强度范围（如「15000–40000 lux / 全日照」），tag 从 喜阳/喜阴/直照/散射 选填，detail 说明光照需求；④ category「土壤基质」，value=土壤类型或配比（如「腐叶土:珍珠岩=3:1」），tag=砂质/泥质/腐殖质/寄生 之一，detail 给基质调配指南；⑤ category「浇水方法」，value=不同生长期每日需水量（如「生长期见干见湿，休眠期少水」），tag=水生/湿土/怕水多烂根/耐旱 之一，detail 说明浇水频率与方法；⑥ category「温度区间」，value=适宜生长温度范围（如「18–28℃，耐 5℃」），tag=热带/亚热带/温带/寒带 之一，detail 说明温度耐受；⑦ category「空气湿度」，value=适宜湿度范围（如「50%–70%」），tag=喜湿/喜干 之一，detail 说明空气湿度；⑧ category「病害防治」，value=常见害虫或病害类型（如「红蜘蛛 / 白粉病」），tag=「合成：药剂名／有机：方法」，detail 给病害防护指南。
- tags：5–10 个简短中文/英文标签，用于站内检索，如「水生」「禾本科」「多年生」「invasive」「荒漠植物」。
- iucn_status：仅在你**确有把握**时填入 LC/NT/VU/EN/CR/DD 之一，否则留空字符串。
- identification_confidence + needs_more_photos_zh/en（**定种严谨性，硬性要求**）：请对本次定种给出诚实的置信度。**宁可承认「无法确定」，也不要凭有限照片武断定成一个错误物种——错误定种比暂不定种更糟。** 判定标准：诊断性特征清晰充分、与某一物种高度吻合才可 high；仅能定到属、种一级仍有多个近似候选记 medium；照片信息不足（缺花/果/叶背等关键器官、角度不佳、主体不清）只能给疑似猜测时记 low。当为 low（medium 视需要）时，**必须**填写 needs_more_photos_zh/en：**读者是完全不懂植物学的普通人**，请用大白话写 2–4 条可直接照做的拍摄动作，① ② ③ 编号，每条一句话、一个动作，讲清「拍哪里 + 怎么拍」。**严禁专业术语**（脉序、被毛、托叶、花序、苞片、腋生…）；确需提到部位时改用日常说法并加括号解释，例如「把叶子翻过来拍背面（看清叶脉和有没有细毛）」「凑近拍一朵完整的花，正面拍清花瓣数量」「拍一下果实或种子」「退后一步拍整棵植物（看清高矮和分枝）」。**每条都必须是「拍下来能看见」的动作——严禁非视觉建议**（摸一摸质感、闻一闻气味、尝味道、掐断看汁液、搓叶子闻香…）：用户唯一能给你的就是照片，摸和闻的结果传不过来，写了也白写。请针对该疑似类群，挑最能区分近似种的那几项。此时 title/scientific_name 给出最可能的猜测但 summary_zh 必须以「疑似……」开头并说明存疑点，不得使用确诊口吻。high 时 needs_more_photos_* 留空字符串。
- 所有中文段落采用 Noto Serif SC 风格的正式植物志措辞，避免空话套话；英文段落为对应中文段落的精炼意译，保留拉丁学名斜体（用 *Genus species* 标记）。
- 若识别不确定，仍要给出最可能的物种，并在 summary 标注「疑似」。

【精准识别与校对指南】
1. 形态特征分析清单：仔细观察照片中显现的特征（如单叶/复叶、互生/对生、花瓣数、花冠对称性等）。
2. 地理与生境匹配：如果提供了拍摄地点，优先考虑该生境下可能分布的本土、归化或常见栽培植物，避免识别出地理分布不符的远缘物种。
3. 近缘种与疑似种对比：如果特征不够完整，请在 summary 中说明「疑似某物种，需与同属的类似物种进行区分，区分要点为……」，展现严谨的植物学素养。
4. 拍摄地点的真实性（硬性要求）：仅当上文明确提供了拍摄地点时，才可在任何段落写出具体地名；若未提供拍摄地点，则**严禁**在 summary_zh / field_notes_zh / habitat_zh / culture_zh 或任何字段中编造、猜测或推断出具体的拍摄地名（不得根据物种分布或照片背景反推一个地名），一律以「拍摄地点未知」表述。` +
    webContext +
    idHint;

  // ── 1. Google Gemini ──────────────────────────────────────────────────────
  if (geminiKey) {
    try {
      const model =
        dbConfig?.provider === "gemini" && dbConfig.model
          ? dbConfig.model
          : process.env.AI_MODEL || "gemini-3-flash-preview";
      console.log(
        `[AI Identify] Routing to Gemini API using model: ${model}${dbConfig ? " (db config)" : ""}`,
      );

      const match = photoDataUrl.match(/^data:([^;]+);base64,(.+)$/);
      const mimeType = match ? match[1] : "image/jpeg";
      const base64Data = match ? match[2] : photoDataUrl;

      const keyPool = splitGeminiKeys(geminiKey);
      console.log(`[AI Identify] Gemini key pool size: ${keyPool.length}`);

      // 55s timeout per attempt — Gemini vision calls can be slow for large images.
      const data = await callGeminiWithRotation(keyPool, {
        model,
        timeoutMs: 55_000,
        label: "AI Identify",
        body: {
          contents: [
            {
              role: "user",
              parts: [
                {
                  text: `请识别这张植物照片。${hintPlace ? `拍摄地点：${hintPlace}。` : ""}请按照指定的 JSON 结构返回完整的识别信息。`,
                },
                { inlineData: { mimeType, data: base64Data } },
              ],
            },
          ],
          systemInstruction: { parts: [{ text: systemPrompt }] },
          generationConfig: {
            responseMimeType: "application/json",
            responseSchema: AI_META_SCHEMA,
            temperature: 0.0,
          },
        },
      });
      const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!text) {
        console.error("Gemini invalid response structure:", JSON.stringify(data));
        const blockReason =
          data?.promptFeedback?.blockReason || data?.candidates?.[0]?.finishReason || "";
        throw new AiError(
          `GEMINI_EMPTY${blockReason ? "_" + blockReason : ""}`,
          `AI 文案生成失败（GEMINI_EMPTY${blockReason ? " · " + blockReason : ""}）：Gemini 没有返回任何内容。` +
            (blockReason === "SAFETY"
              ? "照片或提示词触发了 Google 的安全过滤，请换一张照片重试。"
              : blockReason === "MAX_TOKENS"
                ? "生成内容超出长度上限被截断，请稍后重试。"
                : "这通常是模型侧的临时异常，请重试一次。"),
        );
      }

      try {
        const meta = JSON.parse(cleanJson(text));
        const u = data.usageMetadata ?? {};
        return {
          meta,
          model: stageModel ? `${stageModel}→${model}` : model,
          provider: stageModel ? `${stageModel}+gemini` : "gemini",
          usage: {
            prompt_tokens: u.promptTokenCount ?? 0,
            completion_tokens: u.candidatesTokenCount ?? 0,
            total_tokens: u.totalTokenCount ?? 0,
          },
        };
      } catch (e) {
        console.error("Failed to parse Gemini response as JSON:", text, e);
        throw new AiError(
          "GEMINI_BAD_JSON",
          "AI 文案生成失败（GEMINI_BAD_JSON）：Gemini 返回的内容不是完整的 JSON，通常是生成被中途截断。请重试一次；若反复出现，可在管理后台换一个模型。",
        );
      }
    } catch (err) {
      console.error(
        "[AI Identify] Google Gemini API call failed. Trying OpenAI or Lovable gateway fallbacks:",
        err,
      );
      if (!openaiKey && !lovableKey) {
        throw err;
      }
    }
  }

  // ── 2. Anthropic Claude ───────────────────────────────────────────────────
  if (anthropicKey) {
    const model =
      dbConfig?.provider === "anthropic" && dbConfig.model
        ? dbConfig.model
        : process.env.ANTHROPIC_MODEL || "claude-3-5-sonnet-20241022";
    const baseUrl = dbConfig?.baseUrl || "https://api.anthropic.com/v1";
    console.log(
      `[AI Identify] Routing to Anthropic API using model: ${model}${dbConfig ? " (db config)" : ""}`,
    );

    const resp = await fetch(`${baseUrl}/messages`, {
      method: "POST",
      headers: {
        "x-api-key": anthropicKey,
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        max_tokens: 8192,
        system: systemPrompt,
        messages: [
          {
            role: "user",
            content: [
              {
                type: "image",
                source: {
                  type: "base64",
                  media_type: photoDataUrl.match(/^data:([^;]+)/)?.[1] || "image/jpeg",
                  data: photoDataUrl.replace(/^data:[^;]+;base64,/, ""),
                },
              },
              {
                type: "text",
                text: `请识别这张植物照片。${hintPlace ? `拍摄地点：${hintPlace}。` : ""}请只返回 JSON 对象，不要任何多余文字。`,
              },
            ],
          },
        ],
      }),
    });

    if (!resp.ok) {
      const t = await resp.text();
      console.error("Anthropic API Error:", resp.status, t);
      throw describeHttpAiError("Anthropic", resp.status, t);
    }

    const data = await resp.json();
    const content = data.content?.[0]?.text;
    if (!content) throw new Error("Anthropic 未返回有效内容");

    try {
      const meta = JSON.parse(cleanJson(content));
      const u = data.usage ?? {};
      return {
        meta,
        model,
        provider: "anthropic",
        usage: {
          prompt_tokens: u.input_tokens ?? 0,
          completion_tokens: u.output_tokens ?? 0,
          total_tokens: (u.input_tokens ?? 0) + (u.output_tokens ?? 0),
        },
      };
    } catch (e) {
      console.error("Failed to parse Anthropic response as JSON:", content, e);
      throw new Error("Anthropic 返回的 JSON 格式不完整");
    }
  }

  // ── 3. OpenAI / OpenAI-compatible / Custom ────────────────────────────────
  if (openaiKey) {
    const apiBase =
      (dbConfig?.provider === "openai" || dbConfig?.provider === "custom") && dbConfig.baseUrl
        ? dbConfig.baseUrl
        : process.env.OPENAI_API_BASE || process.env.AI_API_BASE || "https://api.openai.com/v1";
    const model =
      (dbConfig?.provider === "openai" || dbConfig?.provider === "custom") && dbConfig.model
        ? dbConfig.model
        : process.env.OPENAI_MODEL || process.env.AI_MODEL || "gpt-4o-mini";
    console.log(
      `[AI Identify] Routing to OpenAI-compatible API: ${apiBase} using model: ${model}${dbConfig ? " (db config)" : ""}`,
    );

    const requestBody: Record<string, unknown> = {
      model,
      messages: [
        { role: "system", content: systemPrompt },
        {
          role: "user",
          content: [
            {
              type: "text",
              text: `请识别这张植物照片。${hintPlace ? `拍摄地点：${hintPlace}。` : ""}请直接调用工具返回完整的结构化 JSON 结果，所有字段都必须按要求填满，且仅返回 JSON 对象本身，不要用 markdown 代码块包裹。`,
            },
            {
              type: "image_url",
              image_url: { url: photoDataUrl },
            },
          ],
        },
      ],
      // Reasoning vision models (e.g. glm-5v-turbo) spend tokens on hidden reasoning
      // before emitting the answer → need a generous max_tokens or `content` comes back
      // empty/truncated. Many custom relays also reject response_format:json_object
      // (returns an empty reply), so only send it for real OpenAI and otherwise rely on
      // the prompt + cleanJson() to get a bare JSON object.
      max_tokens: 16000,
      temperature: 0.0,
      ...(dbConfig?.provider === "custom" ? {} : { response_format: { type: "json_object" } }),
    };

    // 429 = rate limit, 503 = overloaded — both transient on relay/中转 endpoints
    // (which often have strict per-account rate limits). Retry with backoff so a
    // burst of visitors doesn't fail identify outright.
    let attempts = 0;
    const maxAttempts = 3;
    let resp: Response | null = null;
    while (attempts < maxAttempts) {
      attempts++;
      // postOpenAICompat：某个可调参数被 400 拒收时（如 Kimi K3 只允许 temperature=1）
      // 自动去掉该参数重试一次。
      resp = await postOpenAICompat(`${apiBase}/chat/completions`, openaiKey, requestBody);

      // 524/504/408 = 网关等不到上游吐字节就判超时。整份草稿要生成几十秒到几分钟，
      // 慢模型（Kimi K3 这类推理模型）每次都会同样慢 → 重试多少次都还是超时。
      // 改用流式：token 边生成边回，网关一直看得到数据就不会超时。
      // 若对方压根不支持流式（回 599 = 拿到的不是 SSE），就退回原来的非流式结果。
      if (resp.status === 524 || resp.status === 504 || resp.status === 408) {
        console.warn(`[AI Identify] HTTP ${resp.status} 网关超时，改用流式重试`);
        const streamed = await postOpenAICompatStream(
          `${apiBase}/chat/completions`,
          openaiKey,
          requestBody,
        );
        if (streamed.ok) {
          resp = streamed;
          break;
        }
        console.warn(`[AI Identify] 流式重试也失败（HTTP ${streamed.status}），回到常规重试`);
      }

      // 429 = rate limit; 5xx = relay/中转 gateway hiccup (these endpoints often 502/504
      // on slow, heavy generations like the full draft). Both transient → retry.
      if (
        (resp.status === 429 || (resp.status >= 500 && resp.status < 600)) &&
        attempts < maxAttempts
      ) {
        const delay = attempts * 5000; // 5s, 10s
        console.warn(
          `[AI Identify] OpenAI-compatible API returned ${resp.status}. Retrying in ${delay / 1000}s... (Attempt ${attempts}/${maxAttempts})`,
        );
        await new Promise((resolve) => setTimeout(resolve, delay));
        continue;
      }
      break;
    }

    if (!resp || !resp.ok) {
      const status = resp ? resp.status : 500;
      const t = resp ? await resp.text() : "网络请求失败";
      console.error("OpenAI API Error:", status, t);
      const tag = dbConfig?.provider === "custom" ? "自定义接口" : "OpenAI";
      // Text-only models (e.g. DeepSeek deepseek-chat) reject the vision `image_url`
      // content block. Photo ID is impossible without a multimodal model, so surface
      // a clear, actionable message instead of the raw serde error.
      if (
        /image_url|unknown variant|expected\s+`?text`?|does ?n['’]?t support image|not support.*image|multimodal|vision/i.test(
          t,
        )
      ) {
        throw new AiError(
          "AI_MODEL_NOT_MULTIMODAL",
          `AI 文案生成失败（AI_MODEL_NOT_MULTIMODAL）：${tag}的模型「${model}」不支持图片识别（仅接受纯文本）。` +
            `拍照识别必须用多模态/视觉模型，例如 Gemini、GPT-4o、Claude 3.5 Sonnet、或通义千问 Qwen-VL。请到管理后台更换模型。`,
        );
      }
      throw describeHttpAiError(tag, status, t);
    }

    const data = await resp.json();
    const content = data.choices?.[0]?.message?.content;
    if (!content) {
      console.error("OpenAI invalid response structure:", JSON.stringify(data));
      throw new Error("OpenAI 未能返回有效内容");
    }

    try {
      const meta = JSON.parse(cleanJson(content));
      const u = data.usage ?? {};
      const providerTag = dbConfig?.provider === "custom" ? "custom" : "openai";
      return {
        meta,
        model,
        provider: providerTag,
        usage: {
          prompt_tokens: u.prompt_tokens ?? 0,
          completion_tokens: u.completion_tokens ?? 0,
          total_tokens: u.total_tokens ?? 0,
        },
      };
    } catch (e) {
      console.error("Failed to parse OpenAI response as JSON:", content, e);
      throw new Error("OpenAI 返回的 JSON 格式不正确");
    }
  }

  // Fallback to Lovable Gateway
  if (lovableKey) {
    console.log(`[AI Identify] Routing to Lovable API gateway using model: ${AI_MODEL}`);
    const body = {
      model: AI_MODEL,
      temperature: 0.0,
      messages: [
        { role: "system", content: systemPrompt },
        {
          role: "user",
          content: [
            {
              type: "text",
              text: `请识别这张植物照片。${hintPlace ? `拍摄地点：${hintPlace}。` : ""}请直接调用工具返回完整的结构化结果，所有字段都必须按指定字数填满，不要省略任何段落。`,
            },
            { type: "image_url", image_url: { url: photoDataUrl } },
          ],
        },
      ],
      max_tokens: 32000,
      tools: [
        {
          type: "function",
          function: {
            name: "emit_plant_draft",
            description: "返回植物识别与科普草稿",
            parameters: {
              type: "object",
              properties: {
                title: { type: "string", description: "中文物种名" },
                scientific_name: { type: "string", description: "拉丁学名（含命名人）" },
                common_name_en: { type: "string", description: "英文 common name" },
                common_names_zh: { type: "string", description: "中文俗名及商品名（逗号分隔）" },
                family: { type: "string", description: "科（中文+拉丁，如『禾本科 Poaceae』）" },
                genus: { type: "string", description: "属（中文+拉丁）" },
                iucn_status: { type: "string" },
                tags: { type: "array", items: { type: "string" } },
                summary_zh: { type: "string" },
                summary_en: { type: "string" },
                field_notes_zh: {
                  type: "string",
                  description: "拍摄记录：对本张照片的形态分析 + 定种判断依据",
                },
                field_notes_en: { type: "string" },
                name_origin_zh: { type: "string" },
                name_origin_en: { type: "string" },
                morphology_zh: { type: "string" },
                morphology_en: { type: "string" },
                habitat_zh: { type: "string" },
                habitat_en: { type: "string" },
                culture_zh: { type: "string" },
                culture_en: { type: "string" },
                care_tips_zh: { type: "string" },
                care_tips_en: { type: "string" },
                care_facts: {
                  type: "array",
                  description:
                    "养护卡片：酸碱/施肥/光照/基质/浇水/温度/湿度/病害，共 8 张，每张含 category/value/tag/detail",
                  items: {
                    type: "object",
                    properties: {
                      category: {
                        type: "string",
                        description:
                          "类别名：酸碱偏好/施肥方案/光照需求/土壤基质/浇水方法/温度区间/空气湿度/病害防治",
                      },
                      value: {
                        type: "string",
                        description:
                          "核心数值或范围或名称，如「PH 6.0–6.5」「15000–40000 lux」「18–28℃」「红蜘蛛 / 白粉病」",
                      },
                      tag: {
                        type: "string",
                        description:
                          "括号标签，如「中性」「喜阳·散射」「合成：吡虫啉／有机：苦楝油」",
                      },
                      detail: { type: "string", description: "该项简介，≤ 50 字" },
                    },
                    required: ["category", "value", "tag", "detail"],
                  },
                },
              },
              required: [
                "title",
                "scientific_name",
                "common_name_en",
                "common_names_zh",
                "family",
                "genus",
                "iucn_status",
                "tags",
                "summary_zh",
                "summary_en",
                "field_notes_zh",
                "field_notes_en",
                "name_origin_zh",
                "name_origin_en",
                "morphology_zh",
                "morphology_en",
                "habitat_zh",
                "habitat_en",
                "culture_zh",
                "culture_en",
                "care_tips_zh",
                "care_tips_en",
                "care_facts",
              ],
              additionalProperties: false,
            },
          },
        },
      ],
      tool_choice: { type: "function", function: { name: "emit_plant_draft" } },
    };

    const resp = await fetch(AI_GATEWAY, {
      method: "POST",
      headers: { Authorization: `Bearer ${lovableKey}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!resp.ok) {
      if (resp.status === 429) throw new Error("AI 调用太频繁，请稍后重试");
      if (resp.status === 402) throw new Error("AI 额度已用完，请到工作区充值");
      const t = await resp.text();
      console.error("AI gateway error", resp.status, t);
      throw new Error(`AI 网关错误 ${resp.status}`);
    }
    const data = await resp.json();
    const choice = data.choices?.[0];
    const finish = choice?.finish_reason;
    const args = choice?.message?.tool_calls?.[0]?.function?.arguments;
    if (!args) {
      console.error("AI no tool_call", JSON.stringify(data).slice(0, 800));
      throw new Error("AI 未返回结构化结果");
    }
    try {
      const meta = typeof args === "string" ? JSON.parse(args) : args;
      return {
        meta,
        model: AI_MODEL,
        provider: "lovable",
        usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
      };
    } catch (e) {
      console.error("AI args parse failed; finish_reason=", finish, "len=", String(args).length);
      throw new Error(
        finish === "length"
          ? "AI 返回内容被截断，请重试（已自动放大 token 上限）"
          : "AI 返回格式不完整，请重试",
      );
    }
  }

  throw new Error(
    "AI 识别服务未配置。请在云端管理后台配置 GEMINI_API_KEY 或 OPENAI_API_KEY。若您在国内使用，推荐申请免费的 Google Gemini API 密鉅，设置简单且免 VPN 使用。",
  );
}

async function reverseGeocode(lat: number, lng: number): Promise<string> {
  // 1) Try OpenStreetMap Nominatim free public geocoding API first to avoid consuming Gemini rate limits
  try {
    const url = `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json&accept-language=zh-CN`;
    const resp = await fetch(url, {
      headers: {
        "User-Agent": "Plantspedia/1.0 (arainjazz@163.com)",
      },
    });
    if (resp.ok) {
      const data = await resp.json();
      const addr = data.address;
      if (addr) {
        const province = addr.province || addr.state || "";
        const city = addr.city || addr.town || addr.city_district || "";
        const county = addr.county || addr.district || addr.suburb || "";
        const road = addr.road || "";
        const parts = [province, city, county, road].filter(Boolean);
        if (parts.length > 0) {
          const placeName = parts.join("");
          console.log(`[ReverseGeocode] Resolved via Nominatim: ${placeName}`);
          return placeName;
        }
      }
    }
  } catch (err) {
    console.warn("[ReverseGeocode] Nominatim reverse geocode failed, falling back to AI:", err);
  }

  const geminiKey = process.env.GEMINI_API_KEY;
  const openaiKey = process.env.OPENAI_API_KEY;
  const lovableKey = process.env.LOVABLE_API_KEY;

  const systemPrompt =
    "你是高精度地理位置解析助手。给定 WGS-84 经纬度坐标，请返回其在中国或世界范围内的行政区划位置（如：浙江省杭州市西湖区，或法国巴黎），越精确越好，只返回这一行地名，不要解释、不要标点。";
  const userPrompt = `纬度 ${lat}，经度 ${lng}`;

  if (geminiKey) {
    try {
      const model = process.env.AI_MODEL || "gemini-3-flash-preview";
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${geminiKey}`;
      const resp = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: userPrompt }] }],
          systemInstruction: { parts: [{ text: systemPrompt }] },
        }),
      });
      if (resp.ok) {
        const data = await resp.json();
        const txt = data.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
        return txt.trim().split("\n")[0].slice(0, 60);
      }
    } catch (e) {
      console.error("Gemini reverseGeocode error", e);
    }
  }

  if (openaiKey) {
    try {
      const apiBase =
        process.env.OPENAI_API_BASE || process.env.AI_API_BASE || "https://api.openai.com/v1";
      const model = process.env.OPENAI_MODEL || process.env.AI_MODEL || "gpt-4o-mini";
      const resp = await fetch(`${apiBase}/chat/completions`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${openaiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model,
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userPrompt },
          ],
        }),
      });
      if (resp.ok) {
        const data = await resp.json();
        const txt = data.choices?.[0]?.message?.content ?? "";
        return txt.trim().split("\n")[0].slice(0, 60);
      }
    } catch (e) {
      console.error("OpenAI reverseGeocode error", e);
    }
  }

  if (lovableKey) {
    try {
      const resp = await fetch(AI_GATEWAY, {
        method: "POST",
        headers: { Authorization: `Bearer ${lovableKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "google/gemini-3-flash-preview",
          messages: [
            {
              role: "system",
              content: systemPrompt,
            },
            { role: "user", content: userPrompt },
          ],
        }),
      });
      if (resp.ok) {
        const data = await resp.json();
        const txt: string = data.choices?.[0]?.message?.content ?? "";
        return txt.trim().split("\n")[0].slice(0, 60);
      }
    } catch (e) {
      console.error("Lovable reverseGeocode error", e);
    }
  }

  return "";
}

/**
 * 找该物种的公开实拍图。返回**带许可与署名的候选**，不再是裸 URL —— 2026-07-20 起
 * 每张图都必须能回答「谁拍的、什么许可、原始页在哪」，否则不许用（见 species-photos.ts）。
 *
 * 四级数据源，按「对读者的价值」排序：iNat 实拍 → GBIF 观测 → Commons → 腊叶标本/图版。
 * 每一级都先过许可闸门再进多样性挑选。
 */
async function fetchSpeciesPhotos(
  term: string,
  n: number,
  opts: {
    /**
     * **至少**要凑够几张标本台纸 / 科学图版（organ = specimen）。
     *
     * 为什么需要这个下限：第 4/5 级（标本、图版）都被 `picked.length < n` 守着，
     * 于是**物种在 iNat 收录得越好，这两级越轮不到跑** —— 前三级早就把 n 填满了。
     * 而金叶的「人文·科学绘图」槽 want 是单元素 `["specimen"]`，没有任何降级余地，
     * 结果就是：**越常见的物种，那个槽越是恒空**（结构性必空，跟这个物种有没有图版无关）。
     * 给它一个独立于 n 的小额配额，这条链路才真正有机会填上。
     */
    specimenFloor?: number;
  } = {},
): Promise<PhotoCandidate[]> {
  const q = (term || "").trim();
  if (!q) return [];
  const timeoutFetch = async (url: string) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    try {
      const r = await fetch(url, {
        signal: controller.signal,
        headers: { "User-Agent": PLANTSPEDIA_UA },
      });
      return r.ok ? await r.json() : null;
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
  };

  const picked: PhotoCandidate[] = [];
  const seen = new Set<string>();
  /** 每一级被许可闸门拦下多少张 —— 必须打日志，否则「图变少了」会变成玄学问题。 */
  let droppedTotal = 0;

  const add = (c: PhotoCandidate | null | undefined) => {
    if (!c?.url || seen.has(c.url)) return;
    seen.add(c.url);
    picked.push(c);
  };

  // Greedy diversity pick: never take two photos that share a place / season /
  // photographer until we're forced to. Without this the top-voted photos of one
  // species are usually the SAME plant shot by the same person on the same day.
  // `organ` = which part the shot shows, so the picker can spread the chosen photos
  // across plant parts rather than return five near-identical flower close-ups.
  const pickDiverse = (cands: PhotoCandidate[], want: number): PhotoCandidate[] => {
    const out: PhotoCandidate[] = [];
    const places = new Set<string>();
    const seasons = new Set<string>();
    const whos = new Set<string>();
    const organs = new Set<string>();
    // pass 3 = all axes (incl. organ) must be new; pass 2 = place must be new; pass 1 = anything.
    for (const strict of [3, 2, 1]) {
      for (const c of cands) {
        if (out.length >= want) return out;
        if (seen.has(c.url)) continue;
        if (
          strict === 3 &&
          ((c.place && places.has(c.place)) ||
            (c.season && seasons.has(c.season)) ||
            (c.who && whos.has(c.who)) ||
            (c.organ && organs.has(c.organ)))
        )
          continue;
        if (strict === 2 && c.place && places.has(c.place)) continue;
        seen.add(c.url);
        out.push(c);
        if (c.place) places.add(c.place);
        if (c.season) seasons.add(c.season);
        if (c.who) whos.add(c.who);
        if (c.organ) organs.add(c.organ);
      }
    }
    return out;
  };

  /** Take the best candidate from `pool` that doesn't repeat a place/photographer
   *  already used. Used to guarantee one shot per organ before any filler. */
  const takeOne = (
    pool: PhotoCandidate[],
    places: Set<string>,
    whos: Set<string>,
  ): PhotoCandidate | null => {
    for (const relax of [false, true]) {
      for (const c of pool) {
        if (seen.has(c.url)) continue;
        if (!relax && ((c.place && places.has(c.place)) || (c.who && whos.has(c.who)))) continue;
        seen.add(c.url);
        if (c.place) places.add(c.place);
        if (c.who) whos.add(c.who);
        return c;
      }
    }
    return null;
  };

  /** 过许可闸门 + 记账。所有数据源共用。 */
  const licensed = (cands: PhotoCandidate[]): PhotoCandidate[] => {
    const { kept, dropped } = filterLicensed(cands);
    droppedTotal += dropped;
    return kept;
  };

  // ── 标本/图版的独立配额（见 opts.specimenFloor）────────────────────────────
  const specimenFloor = opts.specimenFloor ?? 0;
  const specimenDeficit = () =>
    Math.max(0, specimenFloor - picked.filter((c) => c.organ === "specimen").length);
  /** 还要不要继续抓：总数没够 **或** 标本配额没凑齐。 */
  const wantMore = () => picked.length < n || specimenDeficit() > 0;
  /** 这一级该取几张。标本级要在「补总数」和「补配额」里取大的那个。 */
  const takeCount = (forSpecimen = false) =>
    forSpecimen ? Math.max(n - picked.length, specimenDeficit()) : Math.max(0, n - picked.length);

  // 1) iNaturalist — best for real, vetted species field photos. Pull a general
  //    votes-sorted pool PLUS organ-annotated pools so the draft's section images span
  //    叶 / 花 / 果 / 植株 / 生境 rather than five near-identical flower close-ups.
  //
  //    Annotation term ids are the live values from /v1/controlled_terms (verified, not
  //    guessed): 36「Leaves」→ 38 Green Leaves; 12「Flowers and Fruits」→ 13 Flowers,
  //    14 Fruits or Seeds, 21 No Flowers or Fruits (= vegetative → whole-plant/habitat).
  //
  //    Reality check that shapes the code below: for the rare Ordos species this site
  //    cares about, the annotated pools are nearly EMPTY (2026-07-20 实测：沙冬青
  //    20 条 research-grade 里只有 1 条带器官标注，柠条锦鸡儿 4/40，蒲公英 4/40)。
  //    So the organ pools are treated as a best-effort *bonus* on top of the general
  //    pool, never as the only source — otherwise rare species come back with nothing.
  //    真正把器官对上号要靠 CP4b 的视觉验证，标注只是免费的先验。
  try {
    const tx = await timeoutFetch(
      "https://api.inaturalist.org/v1/taxa?" +
        new URLSearchParams({ q, per_page: "1", rank: "species,genus" }),
    );
    const taxonId = tx?.results?.[0]?.id ?? null;

    // `size` keeps the payload sane: iNat observation records are fat (~60 KB each),
    // so 5 pools × 40 would pull >10 MB of JSON per draft. The organ pools only need
    // enough depth to offer a few place/photographer choices (Pass A takes ONE from
    // each), while the general pool stays deep because it does the filling.
    const fetchPool = async (
      extra: Record<string, string>,
      organ: Organ,
      size = "15",
    ): Promise<PhotoCandidate[]> => {
      const params = new URLSearchParams({
        photos: "true",
        per_page: size,
        order: "desc",
        order_by: "votes",
        quality_grade: "research",
        ...extra,
      });
      if (taxonId) params.set("taxon_id", String(taxonId));
      else params.set("q", q);
      const j = await timeoutFetch("https://api.inaturalist.org/v1/observations?" + params);
      const out: PhotoCandidate[] = [];
      for (const obs of j?.results ?? []) {
        // ONE photo per observation — extra photos of the same observation are the
        // same individual from near-identical angles.
        const ph = obs?.photos?.[0];
        if (!ph?.url) continue;
        const coords: number[] = obs?.geojson?.coordinates ?? [];
        out.push({
          url: String(ph.url)
            .replace(/\/square\./, "/large.")
            .replace(/\/medium\./, "/large."),
          organ,
          place: obs?.place_guess || coords.map((c) => Math.round(c)).join(","),
          season: (obs?.observed_on || "").slice(5, 7), // month → different phenology/生境
          // 署名优先用真名，没有再用 login。
          who: obs?.user?.name || obs?.user?.login || "",
          // ⚠️ iNat 用 license_code: null 表示「保留所有权利」。空串会被
          // isReusableLicense 判为不可用 —— 这正是我们要的行为。
          license: ph?.license_code ?? "",
          attribution: ph?.attribution ?? "",
          sourceUrl: obs?.uri || "",
          sourceName: "iNaturalist",
        });
      }
      return licensed(out);
    };

    const [general, leaves, flowering, fruiting, vegetative] = await Promise.all([
      fetchPool({}, "", "40"),
      fetchPool({ term_id: "36", term_value_id: "38" }, "leaf"),
      fetchPool({ term_id: "12", term_value_id: "13" }, "flower"),
      fetchPool({ term_id: "12", term_value_id: "14" }, "fruit"),
      fetchPool({ term_id: "12", term_value_id: "21" }, "plant"),
    ]);

    // Pass A — one shot per organ, scarcest first, so 叶/花/果/植株 each get a slot
    // before any pool is allowed to spend a second one. Whole-plant/habitat framing
    // has no annotation on iNat, so `vegetative` (no flowers/fruits) stands in for it;
    // the general pool then supplies the remaining habitat-ish wide shots.
    const usedPlaces = new Set<string>();
    const usedWhos = new Set<string>();
    for (const pool of [fruiting, flowering, leaves, vegetative]) {
      if (picked.length >= n) break;
      const c = takeOne(pool, usedPlaces, usedWhos);
      if (c) picked.push(c);
    }

    // Pass B — fill the rest from every pool, still spreading across
    // place / season / photographer / organ (`seen` already excludes Pass A picks).
    if (picked.length < n) {
      const cands: PhotoCandidate[] = [];
      const pools = [fruiting, flowering, leaves, vegetative, general];
      const maxLen = Math.max(...pools.map((p) => p.length));
      for (let i = 0; i < maxLen; i++) for (const p of pools) if (p[i]) cands.push(p[i]);
      for (const c of pickDiverse(cands, n - picked.length)) picked.push(c);
    }
    // ⚠️ 不是 `picked.length >= n` —— 那样常见种在这里就返回了，下面的标本/图版级
    // 永远轮不到跑，金叶「人文·科学绘图」槽因此结构性必空（见 opts.specimenFloor）。
    if (!wantMore()) return finish();
  } catch {
    /* fall through to next source */
  }

  // 2) GBIF occurrences with media.
  if (picked.length < n) {
    try {
      const m = await timeoutFetch(
        "https://api.gbif.org/v1/species/match?" + new URLSearchParams({ name: q }),
      );
      const key = m?.usageKey ?? null;
      const params = new URLSearchParams({ mediaType: "StillImage", limit: "60" });
      if (key) params.set("taxonKey", String(key));
      else params.set("q", q);
      const j = await timeoutFetch("https://api.gbif.org/v1/occurrence/search?" + params);
      const cands: PhotoCandidate[] = [];
      for (const occ of j?.results ?? []) {
        const media = occ?.media?.[0]; // one image per occurrence
        if (!media?.identifier) continue;
        cands.push({
          url: String(media.identifier),
          organ: "",
          place: occ?.stateProvince || occ?.country || occ?.locality || "",
          season: String(occ?.month ?? ""),
          who: media?.rightsHolder || media?.creator || occ?.recordedBy || "",
          license: media?.license ?? "",
          attribution: "",
          sourceUrl: media?.references || "",
          sourceName: media?.publisher ? `GBIF · ${media.publisher}` : "GBIF",
        });
      }
      for (const c of pickDiverse(licensed(cands), n - picked.length)) picked.push(c);
      if (!wantMore()) return finish();
    } catch {
      /* fall through */
    }
  }

  // 3) Wikimedia Commons live photos.
  //    extmetadata 才带 License / Artist —— 没有它就无从判断能不能用，必须请求。
  const commonsSearch = async (
    search: string,
    limit: string,
    organ: Organ = "",
    /** 这一级取几张。默认按「还差多少凑够 n」，标本/图版级会传标本配额。 */
    take = takeCount(),
  ) => {
    const j = await timeoutFetch(
      "https://commons.wikimedia.org/w/api.php?" +
        new URLSearchParams({
          action: "query",
          format: "json",
          origin: "*",
          generator: "search",
          gsrnamespace: "6",
          gsrsearch: search,
          gsrlimit: limit,
          prop: "imageinfo",
          iiprop: "url|mime|extmetadata",
          iiextmetadatafilter: "License|LicenseShortName|Artist|Credit",
          iiurlwidth: "1200",
        }),
    );
    const pages = j?.query?.pages ?? {};
    const cands: PhotoCandidate[] = [];
    for (const k of Object.keys(pages)) {
      const ii = pages[k]?.imageinfo?.[0];
      if (!ii?.url || (ii.mime || "").includes("svg")) continue;
      const em = ii.extmetadata ?? {};
      cands.push({
        // `url` is the FULL-SIZE original (often 10–50 MB). `thumburl` is the scaled
        // 1200px render — always prefer it so we store a sane file.
        url: ii.thumburl || ii.url,
        organ,
        place: "",
        season: "",
        // Artist 是 HTML（常带 <a> 链接），署名要落到图注上，先拆成纯文本。
        who: stripHtml(em.Artist?.value ?? ""),
        license: em.License?.value ?? "",
        attribution: stripHtml(em.Credit?.value ?? ""),
        sourceUrl: ii.descriptionurl || "",
        sourceName: "Wikimedia Commons",
      });
    }
    for (const c of pickDiverse(licensed(cands), take)) picked.push(c);
    return !wantMore();
  };

  if (picked.length < n) {
    try {
      // commonsSearch 现在返回 !wantMore()，所以标本配额没凑齐时不会在这里提前收工。
      if (await commonsSearch(q + " filetype:bitmap", "30")) return finish();
    } catch {
      /* fall through */
    }
  }

  // 4) LAST RESORT — herbarium specimen sheets + botanical illustrations / line
  //    drawings. Deliberately last: a pressed specimen or a plate teaches far less
  //    about a living plant than a field photo, so these only fill slots that real
  //    photos could not. Rare species (few/no iNat observations) are exactly the case
  //    where this tier saves a draft from shipping with blank image slots.
  // ⚠️ 守卫是 wantMore() 而不是 `picked.length < n`：常见种前三级就把 n 填满了，
  // 用旧守卫这一级永远不跑，金叶「人文·科学绘图」槽也就永远是空的。
  if (wantMore()) {
    try {
      const params = new URLSearchParams({
        mediaType: "StillImage",
        basisOfRecord: "PRESERVED_SPECIMEN",
        limit: "40",
        q,
      });
      const j = await timeoutFetch("https://api.gbif.org/v1/occurrence/search?" + params);
      const cands: PhotoCandidate[] = [];
      for (const occ of j?.results ?? []) {
        const media = occ?.media?.[0];
        if (!media?.identifier) continue;
        cands.push({
          url: String(media.identifier),
          organ: "specimen",
          // Herbarium sheets: spread across collections rather than place/season.
          place: occ?.institutionCode || occ?.collectionCode || "",
          season: "",
          who: media?.rightsHolder || media?.creator || occ?.recordedBy || "",
          license: media?.license ?? "",
          attribution: "",
          sourceUrl: media?.references || "",
          sourceName: occ?.institutionCode ? `标本 · ${occ.institutionCode}` : "腊叶标本",
        });
      }
      for (const c of pickDiverse(licensed(cands), takeCount(true))) picked.push(c);
      if (!wantMore()) return finish();
    } catch {
      /* fall through */
    }
  }

  if (wantMore()) {
    try {
      // Commons hosts the classic plates (Flora of China / Curtis's / BHL scans) and
      // line drawings under these terms.
      for (const term of ["illustration", "botanical illustration", "line drawing"]) {
        if (await commonsSearch(`${q} ${term} filetype:bitmap`, "15", "specimen", takeCount(true)))
          return finish();
      }
    } catch {
      /* give up gracefully */
    }
  }

  return finish();

  function finish(): PhotoCandidate[] {
    const spec = picked.filter((c) => c.organ === "specimen").length;
    console.log(
      `[SpeciesPhotos]「${q}」：采用 ${picked.length}/${n} 张` +
        (specimenFloor ? `（标本/图版 ${spec}/${specimenFloor}）` : "") +
        (droppedTotal ? `，因许可不明/保留所有权利丢弃 ${droppedTotal} 张` : ""),
    );
    return picked;
  }
}

/**
 * 让视觉模型**现看现标**每张候选图展示的是哪个器官。
 *
 * 为什么必须有它：数据源自带的器官标注覆盖率低到没法用（2026-07-20 实测 iNat
 * research-grade 观测里带标注的只有 沙冬青 1/20、柠条锦鸡儿 4/40、蒲公英 4/40）。
 * 不现看一遍，「配图能展示叶、花、果、生境」就只是一句口号 —— 页面会继续把随机图
 * 按位置塞进「花」的位置。
 *
 * 三条刻意的设计：
 * 1. **在转存之前分类**。分类用数据源的小图（iNat 的 /medium.），只有被选中的图才会
 *    进 rehostImages —— 省带宽、省 Supabase 存储，也不用为丢弃的图付转存成本。
 * 2. **完全非致命**。模型不通/超时/返回乱码，一律原样返回候选（退回数据源标注），
 *    绝不让分类失败连累出稿。
 * 3. **认不出就置空**，不猜。空器官不会被任何槽的 want 命中 = 自动弃用，
 *    这比猜一个安全（见 photo-slots.ts 的 normalizeOrgan）。
 */
async function classifyPhotoOrgans(
  cands: PhotoCandidate[],
  speciesName: string,
): Promise<PhotoCandidate[]> {
  if (!cands.length) return cands;
  // 一次最多看 14 张：再多既撑 payload 又拖慢，而 9 个槽用不了那么多候选。
  const batch = cands.slice(0, 14);
  try {
    // iNat 的 /large. 换成 /medium.（≈500px）够判器官了，省一半以上流量。
    const fetched = await fetchInlineImagesIndexed(
      batch.map((c) => c.url.replace(/\/large\./, "/medium.")),
    );
    // **逐张容错，不再全批放弃。** 旧写法是 `thumbs.length !== batch.length → return cands`，
    // 于是 8 张里坏 1 张就整批退回空标签；而空标签命不中任何槽的 want，页面就一张配图都没有
    // （这正是用户报的「银叶/金叶没有新增配图」的主因之一）。现在只把**取到的那些**送去看，
    // 缺的那张保留它自己的数据源标注 —— 少一张图，远好过一份草稿全空。
    const sendable = fetched
      .map((img, batchIndex) => ({ img, batchIndex }))
      .filter((x): x is { img: InlineImage; batchIndex: number } => x.img != null);

    if (!sendable.length) {
      console.warn(
        `[PhotoOrgans]「${speciesName}」：${batch.length} 张缩略图**一张都没取到**，` +
          `跳过分类（保留数据源标注）。多为图源 403/超时 —— 检查 User-Agent 与网络出口。`,
      );
      return cands;
    }
    if (sendable.length < batch.length) {
      console.warn(
        `[PhotoOrgans]「${speciesName}」：只取到 ${sendable.length}/${batch.length} 张缩略图，` +
          `**仅对这些分类**，其余保留数据源标注（旧版会整批放弃）。`,
      );
    }
    const thumbs = sendable.map((x) => x.img);

    // ⚠️ prompt 里的数量与下标**必须按实际送出的子集**（sendable），不能再用 batch.length ——
    // 送 7 张却说「这里有 8 张、i 从 0 到 7」，模型会照着编号，返回的 i 与图对不上，
    // 器官就会被系统性地错标到别的图上。下面解析时再把 i 映射回原 batch 下标。
    const system =
      `你在为一份植物科普页面挑配图。用户会依次给你 ${sendable.length} 张照片，` +
      `它们**据称**都是「${speciesName}」。请**只描述你实际看到的画面**，不要依赖对该物种的既有知识。\n` +
      `对每张图判断它主要展示什么，只返回一个 JSON 数组，不要 markdown、不要多余文字：\n` +
      `[{"i":0,"organ":"leaf","usable":true,"caption_zh":"一句话说明画面内容，20字以内"}, …]\n` +
      `organ 只能取以下之一：\n` +
      `- leaf 叶片特写（主体是叶）\n` +
      `- flower 花特写（能看清花的结构）\n` +
      `- fruit 果实或种子特写\n` +
      `- plant 整株或枝条（看得出植株形态，但没有花果特写）\n` +
      `- habitat 生境/群落广角（画面里植物是环境的一部分）\n` +
      `- specimen 腊叶标本台纸、科学绘图或线描图版\n` +
      `- other 以上都不是\n` +
      `usable=false 的情形：画面主体是人、动物、建筑、文字标签、截图、水印严重、` +
      `严重模糊或过曝、或根本看不出是植物。\n` +
      `**判不准就给 other，不要猜**——一张标错器官的图比一个空位有害得多。` +
      `数组必须恰好 ${sendable.length} 项，i 从 0 到 ${sendable.length - 1}。`;

    const { text } = await xiaopTextCall({
      contents: [
        {
          role: "user",
          parts: [{ text: `请依次判断这 ${sendable.length} 张照片各自展示的部位。` }],
        },
      ],
      system,
      images: thumbs,
      consoleId: "organ",
      // 看不见图的「器官判定」是纯编造，且 HTTP 200 无从察觉 —— 宁可 400 顺位给序列 2。
      imagesEssential: true,
    });

    const parsed = JSON.parse(cleanJson(text));
    if (!Array.isArray(parsed)) throw new Error("返回的不是数组");

    // 映射逻辑收在 species-photos.ts 的纯函数里 —— 「模型给的序号是**送出子集**的下标、
    // 不是 batch 下标」是这条链路最容易错且后果最严重的一处（错标 = 一张标着「花」的
    // 叶子特写进了花槽），必须能脱离网络和模型直接测。见 scratch/organ-verdicts.test.mjs。
    const { out, dropped } = applyOrganVerdicts(
      batch,
      sendable.map((x) => x.batchIndex),
      parsed,
      normalizeOrgan,
    );
    // 超出 batch 的候选原样带上，别白扔。
    out.push(...cands.slice(14));

    const tally = out.reduce<Record<string, number>>((a, c) => {
      const k = c.organ || "(未知)";
      a[k] = (a[k] ?? 0) + 1;
      return a;
    }, {});
    console.log(
      `[PhotoOrgans]「${speciesName}」候选 ${batch.length} 张 / 实际看图 ${sendable.length} 张，` +
        `弃用 ${dropped} 张，器官分布：${JSON.stringify(tally)}`,
    );
    return out;
  } catch (e) {
    console.warn(
      "[PhotoOrgans] 视觉分类失败，退回数据源标注：",
      e instanceof Error ? e.message : e,
    );
    return cands;
  }
}

/**
 * Re-host external species photos into our own Supabase Storage so the published
 * page / draft never hotlinks iNaturalist / GBIF / Wikimedia directly. Those hosts
 * are slow-or-blocked from mainland China (AWS-backed iNat static, GBIF media that
 * frequently 404s, Wikimedia), so hotlinked `<img>` render broken for local users.
 *
 * Downloads each URL and uploads it under `${prefix}`. Fully non-fatal and
 * per-image: a URL that fails to fetch/upload is dropped — fewer good images beats
 * broken ones. Returns the public URLs, preserving order.
 *
 * COMPRESSION (never store an unbounded original):
 *  1. Sources are asked for a scaled variant up front (iNat `/large.` ≈1024px,
 *     Wikimedia `thumburl` @1200px) — see fetchSpeciesPhotos.
 *  2. This fetch requests Cloudflare Image Resizing (`cf.image`). Where the zone has
 *     it enabled the body arrives already downscaled + re-encoded to WebP; where it
 *     isn't, the option is ignored and the original comes through (safe no-op).
 *  3. Hard caps: refuse to download beyond MAX_SOURCE_BYTES, refuse to store beyond
 *     MAX_STORE_BYTES. Workers has no sharp/canvas, so anything still oversized after
 *     (1)+(2) is skipped rather than stored.
 */
/** 保序版转存：失败的位置留 `null`，长度恒等于入参。 */
async function rehostImagesIndexed(
  cands: PhotoCandidate[],
  prefix: string,
): Promise<(PhotoCandidate | null)[]> {
  // 返回**候选对象**而不是裸 URL：署名/许可必须跟着图一路走到渲染层。转存只换 url，
  // 其余字段原样保留 —— 图存进了我们自己的 bucket，并不改变它的著作权归属。
  const out: (PhotoCandidate | null)[] = [];
  const MAX_STORE_BYTES = 5 * 1024 * 1024; // never persist more than 5 MB per image
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  // Download one image → {bytes, contentType} or null. Tries Cloudflare Image
  // Resizing first (downscale+WebP); if that subrequest fails (zone lacks the
  // Image Resizing add-on → the resized fetch can error or 4xx) it RETRIES with a
  // plain fetch so the image still gets re-hosted. This is why gold-page images
  // could come back empty: a failed `cf.image` fetch dropped every slot.
  const download = async (
    src: string,
    useResize: boolean,
  ): Promise<{ ab: ArrayBuffer; ct: string } | null> => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 12_000);
    try {
      const init = {
        signal: controller.signal,
        headers: { "User-Agent": PLANTSPEDIA_UA },
        ...(useResize
          ? { cf: { image: { width: 1280, quality: 78, fit: "scale-down", format: "webp" } } }
          : {}),
      } as RequestInit;
      const r = await fetch(src, init);
      if (!r.ok) return null;
      const ct = (r.headers.get("content-type") || "").toLowerCase();
      if (!ct.startsWith("image/") || ct.includes("svg")) return null;
      const ab = await r.arrayBuffer();
      if (ab.byteLength === 0 || ab.byteLength > MAX_STORE_BYTES) return null;
      return { ab, ct };
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
  };

  for (let i = 0; i < cands.length; i++) {
    const cand = cands[i];
    const src = cand.url;
    try {
      // Resized first; fall back to the plain original if resizing isn't available.
      const got = (await download(src, true)) ?? (await download(src, false));
      if (!got) {
        console.warn(`[RehostImages] no usable body (resized+plain both failed): ${src}`);
        continue;
      }
      const { ab, ct } = got;
      const ext = ct.includes("png")
        ? "png"
        : ct.includes("webp")
          ? "webp"
          : ct.includes("gif")
            ? "gif"
            : "jpg";
      const path = `${prefix}-${Date.now()}-${i}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
      const { error } = await supabaseAdmin.storage
        .from("plant-images")
        .upload(path, Buffer.from(ab), { contentType: ct, upsert: false });
      if (error) {
        console.warn(`[RehostImages] upload failed for ${src}:`, error.message);
        out.push(null);
        continue;
      }
      out.push({
        ...cand,
        url: supabaseAdmin.storage.from("plant-images").getPublicUrl(path).data.publicUrl,
      });
    } catch (e) {
      console.warn(`[RehostImages] failed for ${src}:`, e instanceof Error ? e.message : e);
      out.push(null);
    }
  }
  return out;
}

/**
 * 转存一批图，**逐张回落**：这一张没转成就用它自己的原始外链，而不是整批退回去。
 *
 * 旧写法是 `rehosted.length === chosen.length ? rehosted : chosen` —— 只要有一张失败，
 * **整页的图全部退回外链**。而外链是 inaturalist / gbif / wikimedia 的域名，国内基本加载
 * 不出来：日志里 `[PhotoSlots]` 会显示 5/5 槽有图，用户看到的却是一排裂图。
 * 逐张回落之后，失败的只影响它自己。
 */
async function rehostImagesAligned(
  cands: PhotoCandidate[],
  prefix: string,
): Promise<PhotoCandidate[]> {
  const rehosted = await rehostImagesIndexed(cands, prefix);
  return cands.map((c, i) => rehosted[i] ?? c);
}

// ── GBIF / GRIIS invasive-species check ──────────────────────────────────────
// A species is treated as an "外来入侵物种 in China" iff GBIF's species
// distributions carry a record with country == "CN" sourced from the GRIIS China
// checklist (verified live: source string below; datasetKey 6d11211b-caa0-4e63-
// b99c-e944099d5017). establishmentMeans there is "INTRODUCED"; GRIIS-China
// membership is itself the invasive signal. Read-only, no API key. Non-fatal.
const GRIIS_CHINA_SOURCE = "Global Register of Introduced and Invasive Species";

type InvasiveCheck = {
  isInvasive: boolean;
  taxonKey: number | null;
  source: string;
  establishmentMeans: string;
};

/** Fetch JSON with a hard timeout; returns null on any failure (never throws). */
async function timeoutJson(url: string, ms = 8000): Promise<any> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    const r = await fetch(url, {
      signal: controller.signal,
      headers: { "User-Agent": PLANTSPEDIA_UA },
    });
    return r.ok ? await r.json() : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Check whether a species is registered as an invasive alien species in China
 *  (GBIF species → GRIIS China distribution). Returns null only if the lookup
 *  itself could not be completed (network); an authoritative "not invasive"
 *  comes back as { isInvasive: false }. */
async function gbifCheckInvasive(scientificName: string): Promise<InvasiveCheck | null> {
  const name = (scientificName || "").trim().split(/\s+/).slice(0, 2).join(" ");
  if (!name) return null;
  try {
    const m = await timeoutJson(
      "https://api.gbif.org/v1/species/match?" + new URLSearchParams({ name }),
    );
    const key: number | null = m?.usageKey ?? null;
    if (!key) return { isInvasive: false, taxonKey: null, source: "", establishmentMeans: "" };
    const j = await timeoutJson(`https://api.gbif.org/v1/species/${key}/distributions?limit=1000`);
    if (!j) return null; // could not complete the distributions lookup
    const recs: any[] = j?.results ?? [];
    const cnGriis = recs.find(
      (r) =>
        r?.country === "CN" &&
        typeof r?.source === "string" &&
        r.source.includes(GRIIS_CHINA_SOURCE),
    );
    // Fallback: a CN record explicitly flagged INVASIVE by any checklist.
    const hit =
      cnGriis ||
      recs.find(
        (r) =>
          r?.country === "CN" && String(r?.establishmentMeans || "").toUpperCase() === "INVASIVE",
      );
    return {
      isInvasive: !!hit,
      taxonKey: key,
      source: hit?.source || "",
      establishmentMeans: hit?.establishmentMeans || "",
    };
  } catch (e) {
    console.warn("[gbifCheckInvasive] failed:", e);
    return null;
  }
}

/** Write the three-part warning-card prose (invasion status / ecological harm /
 *  control advice) for a confirmed China invasive. Draft copy, editor-reviewed —
 *  same trust model as the rest of the AI draft. Returns null on failure. */
async function generateInvasiveCard(
  title: string,
  scientificName: string,
): Promise<{ status_zh: string; harm_zh: string; control_zh: string } | null> {
  const system =
    "你是中国外来入侵物种防控领域的专家。给定一个已被 GBIF/GRIIS 中国名录确认为外来入侵物种的植物，" +
    "请用严谨、准确、可操作的中文，生成一张警示卡片的三段内容。只依据可靠的植物学与入侵生态学常识，" +
    "不编造具体数据、年份、地名或事件；不确定处用审慎措辞（如「据记载」「通常」）。";
  const userText =
    `物种：${title}（学名 ${scientificName}）。请生成三段内容：\n` +
    "1) status_zh：该物种在中国的入侵状况——原产地、主要传入途径、大致分布区域与扩散趋势，约 80–140 字。\n" +
    "2) harm_zh：生态危害及对农林、经济或人体健康的影响，约 80–140 字。\n" +
    "3) control_zh：管控与防治建议——物理、化学、生物或管理措施中可操作的做法，约 80–140 字。\n" +
    '只返回 JSON：{"status_zh":"...","harm_zh":"...","control_zh":"..."}';
  const schema = {
    type: "object",
    properties: {
      status_zh: { type: "string" },
      harm_zh: { type: "string" },
      control_zh: { type: "string" },
    },
    required: ["status_zh", "harm_zh", "control_zh"],
  };
  try {
    const { text: txt } = await xiaopTextCall({
      contents: [{ role: "user", parts: [{ text: userText }] }],
      system,
      schema,
      maxRetry: 2,
    });
    const obj = JSON.parse(cleanJson(txt));
    const status_zh = String(obj?.status_zh || "").trim();
    const harm_zh = String(obj?.harm_zh || "").trim();
    const control_zh = String(obj?.control_zh || "").trim();
    if (!status_zh && !harm_zh && !control_zh) return null;
    return { status_zh, harm_zh, control_zh };
  } catch (e) {
    console.warn("[generateInvasiveCard] failed:", e);
    return null;
  }
}

async function generateConservationCard(
  title: string,
  scientificName: string,
): Promise<{ status_zh: string; value_zh: string; advice_zh: string } | null> {
  const system =
    "你是中国野生植物保护领域的专家。给定一个已被国家/省级重点保护名录收录的植物，" +
    "请用严谨、准确的中文生成一张保护卡片的三段内容。只依据可靠的植物学与保护生物学常识，" +
    "不编造具体数据、年份、地名或事件；不确定处用审慎措辞（如「据记载」「通常」）。";
  const userText =
    `物种：${title}（学名 ${scientificName}）。请生成三段内容：\n` +
    "1) status_zh：该物种当前的珍稀濒危状况或所面临的主要威胁挑战——如种群规模、分布狭窄、生境退化、人为采挖等，约 80–140 字。\n" +
    "2) value_zh：该物种的生态价值——在生态系统、生物多样性、科研或遗传资源等方面的意义，约 80–140 字。\n" +
    "3) advice_zh：保护建议——就地/迁地保护、生境恢复、公众参与、禁止采挖等可操作措施，约 80–140 字。\n" +
    '只返回 JSON：{"status_zh":"...","value_zh":"...","advice_zh":"..."}';
  const schema = {
    type: "object",
    properties: {
      status_zh: { type: "string" },
      value_zh: { type: "string" },
      advice_zh: { type: "string" },
    },
    required: ["status_zh", "value_zh", "advice_zh"],
  };
  try {
    const { text: txt } = await xiaopTextCall({
      contents: [{ role: "user", parts: [{ text: userText }] }],
      system,
      schema,
      maxRetry: 2,
    });
    const obj = JSON.parse(cleanJson(txt));
    const status_zh = String(obj?.status_zh || "").trim();
    const value_zh = String(obj?.value_zh || "").trim();
    const advice_zh = String(obj?.advice_zh || "").trim();
    if (!status_zh && !value_zh && !advice_zh) return null;
    return { status_zh, value_zh, advice_zh };
  } catch (e) {
    console.warn("[generateConservationCard] failed:", e);
    return null;
  }
}

// ── Phase-1 fast summary card ────────────────────────────────────────────────
// Light schema: species ID + a short bilingual summary + field notes + honest
// confidence/abstain guidance. NO long-form sections → far fewer output tokens →
// returns fast so the user sees a card quickly instead of waiting for the full draft.
const AI_QUICK_SCHEMA = {
  type: "object",
  properties: {
    title: { type: "string", description: "中文物种名" },
    scientific_name: { type: "string", description: "拉丁学名（含命名人）" },
    common_name_en: { type: "string", description: "英文俗名" },
    common_names_zh: { type: "string", description: "中文俗名及商品名（逗号分隔）" },
    family: { type: "string", description: "科（中文+拉丁）" },
    genus: { type: "string", description: "属（中文+拉丁）" },
    iucn_status: { type: "string", description: "IUCN 评级，无把握留空" },
    tags: { type: "array", items: { type: "string" } },
    summary_zh: { type: "string", description: "150–260 字趣味导语式摘要" },
    // 刻意不含 summary_en / field_notes_zh / field_notes_en：简介摘要卡（buildSummaryCardHtml）
    // 完全不用它们，让它们出现在 schema 里只会白白拉长 flash 的顺序生成、拖慢出卡。enrich
    // 生成完整草稿时会用 full schema 另行产出这些字段。
    identification_confidence: { type: "string", enum: ["high", "medium", "low"] },
    needs_more_photos_zh: {
      type: "string",
      description:
        "low/medium 时填写：面向不懂植物学的普通用户，用大白话写 2–4 条可直接照做的拍摄动作，① ② ③ 编号，每条一句话一个动作，禁用专业术语（脉序/被毛/托叶/花序 等）。**每条都要瞄准能最快确认或排除本物种、把它和常见易混种区分开的那个关键部位**（例如疑似两个近似种时，指出去拍哪个部位就能一锤定音），如「把叶子翻过来拍背面（看清叶脉和有没有细毛）」「凑近拍一朵完整的花，正面拍清花瓣数量」。high 留空",
    },
    needs_more_photos_en: { type: "string", description: "英文对应，同样通俗；high 留空" },
  },
  required: [
    "title",
    "scientific_name",
    "family",
    "genus",
    "summary_zh",
    "identification_confidence",
  ],
};

/** Fast phase-1 identify: species + short summary + confidence, via Gemini only.
 *  Returns null if no Gemini key (caller then falls back to the full pipeline). */
async function identifyQuick(
  photoDataUrl: string,
  hintPlace: string,
  opts?: {
    speciesHint?: { title?: string; sci?: string } | null;
    forceResult?: boolean;
    retakeCount?: number;
    /** Prior shots of the SAME plant (earlier 补拍) — sent alongside the new photo so
     *  the model judges from ALL angles together, not just the latest frame. */
    priorPhotos?: InlineImage[];
    /** Pl@ntNet 的专业定种判定（含置信度/备选），作为定种基准提示注入 system prompt。
     *  这样 Gemini 的置信度会吸收 Pl@ntNet 信号：低分或明显不符 → 倾向标「疑似」。 */
    plantNetHint?: string;
  },
): Promise<{ meta: AiMeta; model: string; provider: string; usage: AiTokenUsage } | null> {
  // 快速出卡是 Gemini 专用链路，所以只取序列里的 Gemini 项 —— 但要取**全部**，
  // 一个额度用尽就换下一个。序列里没有 Gemini 项时退回 .env。
  // 走「出卡AI」控制台（未单独配置时自动回退到「AI 模型控制台」）。
  const { sequence } = await loadCardQueue();
  const geminiSlots = sequence.filter((s) => s.provider === "gemini" && s.apiKey);
  const envFallback: ModelSlot[] = process.env.GEMINI_API_KEY
    ? [
        {
          provider: "gemini",
          apiKey: process.env.GEMINI_API_KEY,
          baseUrl: "",
          model: process.env.AI_MODEL || "gemini-3-flash-preview",
        },
      ]
    : [];
  const quickSlots = geminiSlots.length ? geminiSlots : envFallback;
  if (!quickSlots.length) return null;
  // 序列里还有非 Gemini 的替补（如 Kimi）能接手重链路吗？有的话，快速链路全挂时
  // 就**不该**把错误抛给用户 —— 抛了等于在降级发生之前先把流程掐死。
  const hasNonGeminiBackup = sequence.some((s) => s.provider !== "gemini" && s.apiKey);

  // 补拍复核语境：把上一轮判断和「必须出结论」的硬指令拼进 system prompt。
  const hintTitle = (opts?.speciesHint?.title || "").trim();
  const hintSci = (opts?.speciesHint?.sci || "").trim();
  const retakeCtx =
    hintTitle || hintSci
      ? `\n- 补拍复核（硬性）：这是同一株植物的第 ${opts?.retakeCount ?? 1} 次补拍。上一轮倾向判断为「${hintTitle}${hintSci ? `（${hintSci}）` : ""}」。请结合本次更清晰的照片**确认或修正**该判断——若新证据支持另一物种，请大胆改判。`
      : "";
  const forceCtx = opts?.forceResult
    ? `\n- 最终裁定（硬性）：这已是第 ${opts?.retakeCount ?? 3} 次补拍，**必须给出最终结论**。即使证据仍不充分，也要输出你认为最可能的物种，并把 identification_confidence 设为 low（表示"疑似"）、summary_zh 以「疑似」开头；needs_more_photos_zh/en **一律留空**，不要再要求补拍。`
    : "";
  const pnHint = (opts?.plantNetHint || "").trim();
  const plantNetCtx = pnHint ? `\n- ${pnHint}` : "";

  const system = `你是 Plantspedia 的首席植物学家。请**快速**识别这张实地拍摄的植物照片，并只产出一张"简介摘要卡"所需的少量字段（不要写形态/人文/养护等长篇分区）。为了尽快出卡，**只输出下列字段，不要生成英文摘要、拍摄记录等额外内容**。${retakeCtx}${forceCtx}${plantNetCtx}
- summary_zh：150–260 字趣味导语（博物学家口吻，讲与生活相关的趣闻/冷知识，勾起好奇心；不要罗列科属学名形态，也不要复述「本次拍摄于…」）。
- identification_confidence + needs_more_photos_zh/en（**硬性**）：诚实给出置信度。**宁可 low 也不要凭有限照片武断定成错误物种——错误定种比暂不定种更糟。** 诊断特征充分且高度吻合=high；仅能到属=medium；照片不足只能疑似=low。为 low（medium 视需要）时必须填 needs_more_photos_*：**读者是完全不懂植物学的普通人**，用大白话写 2–4 条可直接照做的拍摄动作，① ② ③ 编号，每条一句话一个动作，讲清「拍哪里+怎么拍」；**严禁专业术语**（脉序/被毛/托叶/花序/苞片…）。**每条都必须是「拍下来能看见」的动作——严禁非视觉建议**（摸质感/闻气味/尝味道/掐断看汁液/搓叶子闻香…）：用户唯一能给你的就是照片，摸和闻的结果传不过来。**关键：每条都要瞄准最能一锤定音、把该物种与常见易混种区分开的那个部位**——先在心里想清楚"要确认它是不是这个种、还差看哪一处"，再让用户去拍那一处（例如「凑近拍一朵完整的花、正面数清花瓣几片」「把叶子翻过来拍背面看有没有细毛」「拍一下果实的形状和有没有刺」「退后一步拍整棵的株型」），不要给泛泛而无区分力的建议。且 summary_zh 以「疑似……」开头、不得用确诊口吻；high 时 needs_more_photos_* 留空。
- 拍摄地点真实性（硬性）：仅当上文给出拍摄地点时才可写具体地名；未提供则严禁编造/反推任何地名，一律「拍摄地点未知」。
- 中文用正式植物志措辞；拉丁学名用 *Genus species* 斜体标记。`;

  const match = photoDataUrl.match(/^data:([^;]+);base64,(.+)$/);
  const mimeType = match ? match[1] : "image/jpeg";
  const base64Data = match ? match[2] : photoDataUrl;

  // On 补拍, feed the earlier shots too so the model cross-references every angle of
  // the same plant (综合多张图判定), not just the newest frame.
  const prior = (opts?.priorPhotos ?? []).slice(0, 4);
  const multiNote =
    prior.length > 0
      ? `本次为同一株植物的补拍：第 1 张是最新、最清晰的照片，随后 ${prior.length} 张是先前拍摄的照片。请**综合全部 ${prior.length + 1} 张照片**（不同角度/部位/光线）做出定种判断。`
      : "";

  return runModelQueue(
    quickSlots,
    async (slot) => {
      const parts: unknown[] = [
        {
          text: `请识别这${prior.length ? "组" : "张"}植物照片。${multiNote}${hintPlace ? `拍摄地点：${hintPlace}。` : ""}只按指定 JSON 结构返回简介摘要卡字段。`,
        },
        { inlineData: { mimeType, data: base64Data } },
        ...prior.map((im) => ({ inlineData: { mimeType: im.mimeType, data: im.base64 } })),
      ];
      const data = await callGeminiWithRotation(splitGeminiKeys(slot.apiKey), {
        model: slot.model,
        timeoutMs: 45_000,
        label: "identifyQuick",
        body: {
          contents: [{ role: "user", parts }],
          systemInstruction: { parts: [{ text: system }] },
          generationConfig: {
            responseMimeType: "application/json",
            responseSchema: AI_QUICK_SCHEMA,
            temperature: 0.0,
          },
        },
      });
      const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!text) return null;
      const meta = JSON.parse(cleanJson(text)) as AiMeta;
      const u = data.usageMetadata ?? {};
      return {
        meta,
        model: slot.model,
        provider: "gemini-quick",
        usage: {
          prompt_tokens: u.promptTokenCount ?? 0,
          completion_tokens: u.candidatesTokenCount ?? 0,
          total_tokens: u.totalTokenCount ?? 0,
        },
      };
    },
    "快速出卡",
    { requireVision: true },
  ).catch((e) => {
    // 走到这里说明**每个 Gemini 序列项都挂了**。
    // 序列里还有非 Gemini 的替补（Kimi 等）时，返回 null 让流程继续走重链路 ——
    // 重链路会按序列降级到那些替补。旧代码在这里直接 throw，那是「只有一个厂商、
    // 重链路必撞同一堵墙」时代的判断，现在会在降级发生之前就把流程掐死。
    if (hasNonGeminiBackup) {
      console.warn(
        "[identifyQuick] 所有 Gemini 序列项均失败，转交重链路的非 Gemini 替补：",
        e instanceof Error ? e.message : e,
      );
      return null;
    }
    // 没有任何替补 → 重链路同样无解，把带解释的错误如实抛给用户。
    if (e instanceof AiError) throw e;
    console.warn("[identifyQuick] soft failure, falling back:", e instanceof Error ? e.message : e);
    return null;
  });
}

/**
 * Shared HEAVY draft compute (no DB writes). Runs the full pipeline:
 *   full-schema AI identify+copy → species section photos (fetch+re-host) →
 *   conservation registry match → invasive card → render full draft HTML.
 * Used by BOTH the one-shot `submitPlantDraft` (INSERT) and the two-phase
 * `enrichDraft` (UPDATE) so the ~160-line pipeline lives in exactly one place.
 * Caller uploads the user photo and passes its public `photoUrl`.
 */
async function buildDraftContent(opts: {
  dataUrl: string;
  photoUrl: string;
  place: string;
  lat: number | null;
  lng: number | null;
  /** Pin the species (enrich path) so the draft matches the card the user saw. */
  speciesHint?: { title?: string; scientificName?: string } | null;
  /** Web research digest (from enrichDraft联网调研 step), injected into AI prompt. */
  webResearch?: { digest: string; sources: { title: string; uri: string }[] };
  /** 走哪套模型序列：拍照出卡用「出卡AI」控制台，enrichDraft 的重活用「草稿生成模型」。 */
  queueKind?: "card" | "enrich";
  /** 这份草稿累积的用户实拍（补拍会追加）。进配图候选池，与公开图同等参与器官识别。 */
  userPhotos?: unknown;
  /** 用户实拍的署名（草稿的 creator_label / 昵称）。拿不到就不写摄影者，绝不编造。 */
  photographer?: string | null;
}): Promise<{
  meta: AiMeta;
  usedModel: string;
  usedProvider: string;
  usage: AiTokenUsage;
  html: string;
  isInvasive: boolean;
  gbifTaxonKey: number | null;
}> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { dataUrl, photoUrl, place, lat, lng, speciesHint, webResearch } = opts;

  // Call AI to identify + generate copy (reads DB config server-side).
  const {
    meta,
    model: usedModel,
    provider: usedProvider,
    usage,
  } = await callAiIdentify(dataUrl, place, speciesHint, webResearch, opts.queueKind ?? "card");

  // 去掉模型写进字段的 markdown 强调符（学名/属名/俗名/摘要都是当纯文本渲染的）。
  // 正文 html 里的 `*Latin*` 另行转 <em>（见下方 html 组装处）。
  stripMetaMarkdown(meta);

  // Belt-and-suspenders: if a species was pinned, force the rendered name to match
  // it even if the model quietly drifted, so the page title == the card title.
  if (speciesHint?.title) meta.title = speciesHint.title;
  if (speciesHint?.scientificName) meta.scientific_name = speciesHint.scientificName;

  // 【正名核对】以《中国生物物种名录 2025·植物界》为准把名字对齐。
  // 位置刻意选在**配图与 HTML 渲染之前** —— 正文里的科名、图注、标题全从 meta 取，
  // 放在渲染之后就得改两处，迟早对不上。
  // 拿不准（同名异物 / 不在名录）时 applyNameAuthority 一个字都不改，只留痕。
  {
    const { applyNameAuthority } = await import("./name-authority.functions");
    const { stamp, changed } = await applyNameAuthority(meta);
    (meta as unknown as Record<string, unknown>)._name_authority = stamp;
    console.log(
      `[NameAuthority] 草稿「${meta.title}」：${stamp.status}/${stamp.matchedBy}` +
        `${changed ? " · 已按名录改写" : ""}${stamp.note ? " · " + stamp.note.slice(0, 120) : ""}`,
    );
  }

  // Find real online field photos of the species for the body sections (the hero
  // keeps the user's own photo). Re-host into our own bucket so the page doesn't
  // hotlink foreign hosts (broken/slow from China). Non-fatal.
  let sectionPhotos: (PhotoCandidate | null)[] = [];
  let sectionMissing: string[] = [];
  /** 降级配图的如实说明，与 sectionPhotos 同下标对齐。 */
  let sectionNotes: string[] = [];
  try {
    const sci = (meta.scientific_name || "").trim().split(/\s+/).slice(0, 2).join(" ");
    const term = sci || meta.common_name_en || meta.title || "";
    if (term) {
      // 多抓一些候选，分槽才有得挑（5 个槽 × 器官各异，只抓 5 张必然对不上号）。
      // 12→8：草稿一趟要卡在 Cloudflare 免费版「50 子请求/次调用」以内，而 classifyPhotoOrgans
      // 会把每个候选都抓一张缩略图（12 张≈12 个子请求）。8 张对 5 个槽够挑，且更容易全数抓到、
      // 让分类真正生效（thumbs 差一张就整批跳过分类，见 classifyPhotoOrgans）。
      const external = await fetchSpeciesPhotos(term, 8);
      // 用户自己拍的照片**排在候选池最前面** —— 拍的就是这一株、这个季节、这个地点，
      // 是最贴题的图源。但它们**不享受特权**：和外部图一起过 classifyPhotoOrgans 现看现标，
      // 器官对不上照样进不了槽（见 userPhotoCandidates 的注释）。
      const mine = userPhotoCandidates({
        photoUrl: opts.photoUrl,
        userPhotos: opts.userPhotos,
        who: opts.photographer,
        place: opts.place,
      });
      // 现看现标器官 → 按标签入槽。**分类在转存之前**，只有中选的图才进 bucket。
      const labelled = await classifyPhotoOrgans([...mine, ...external], term);
      const assigned = assignSlots(labelled, DRAFT_SLOTS);
      console.log(
        `[PhotoSlots] 草稿「${term}」：${describeAssignment(assigned)}` +
          `（候选 ${mine.length} 张用户实拍 + ${external.length} 张公开图）`,
      );
      const chosen = assigned.map((a) => a.photo).filter(Boolean) as PhotoCandidate[];
      // 逐张回落：这一张没转成就用它自己的外链，不再整批退回去（见 rehostImagesAligned）。
      const finalPhotos = await rehostImagesAligned(chosen, "drafts/species/section");
      // 回填到槽位顺序上，空槽保持 null —— 模板据此渲染「暂无……公开照片」而不是塞图。
      let k = 0;
      sectionPhotos = assigned.map((a) => (a.photo ? (finalPhotos[k++] ?? null) : null));
      sectionMissing = assigned.map((a) => (a.photo ? "" : a.spec.missingNote));
      sectionNotes = assigned.map((a) => (a.photo ? a.mismatchNote : ""));
    }
  } catch (e) {
    console.warn("[buildDraftContent] species photo search failed:", e);
  }

  // ── Conservation registry match (国家/省级重点保护 · CITES · GTS · GRIIS) ──
  let conservationBadgesList: PlantDraftFields["conservation"] = null;
  let conservationCardObj: PlantDraftFields["conservation_card"] = null;
  let griisHit: { degreeLabel: string; source: string; source_url: string | null } | null = null;
  const sciFull = (meta.scientific_name || "").trim();
  try {
    if (sciFull) {
      const listsRes = await supabaseAdmin
        .from("conservation_lists")
        .select("id,kind,name,province,version,source_note,source_url");
      const lists = (listsRes.data ?? []) as any[];
      const taxa: any[] = [];
      for (let from = 0; ; from += 1000) {
        const { data } = await supabaseAdmin
          .from("conservation_taxa")
          .select("list_id,scientific_name,chinese_name,normalized_name,status,rank,excluded_names")
          .range(from, from + 999);
        const rows = data ?? [];
        taxa.push(...rows);
        if (rows.length < 1000) break;
      }
      if (taxa.length) {
        const { buildConservationMatcher, conservationBadges, GRIIS_DEGREES } =
          await import("./conservation");
        const hit = buildConservationMatcher({ lists, taxa })(sciFull, meta.family || null);
        const badges = conservationBadges(hit, lists);
        if (badges.length) conservationBadgesList = badges;
        const protectedEntries = [...hit.protectedLists.entries()];
        if (protectedEntries.length) {
          const protLists = protectedEntries.map(([id, status]) => {
            const l = lists.find((x) => x.id === id);
            return {
              name: (l?.name as string) ?? "重点保护名录",
              version: (l?.version as string) ?? null,
              status: (status as string) ?? null,
              url: (l?.source_url as string) ?? null,
              province: (l?.province as string) ?? null,
            };
          });
          const card = await generateConservationCard(
            meta.title || sciFull,
            meta.scientific_name || sciFull,
          );
          conservationCardObj = {
            basis_zh: protLists
              .map(
                (p) =>
                  `${p.name}${p.version ? "（" + p.version + "）" : ""}${p.status ? " · " + p.status : ""}`,
              )
              .join("；"),
            status_zh: card?.status_zh ?? "",
            value_zh: card?.value_zh ?? "",
            advice_zh: card?.advice_zh ?? "",
            level: protLists.map((p) => p.status).find(Boolean) ?? null,
            national: protLists.some((p) => !p.province),
            sources: protLists.map((p) => ({ name: p.name, url: p.url })),
          };
        }
        if (hit.griis) {
          const gl = lists.find((l) => l.kind === "griis");
          const deg = GRIIS_DEGREES.find((d) => d.value === hit.griis);
          griisHit = {
            degreeLabel: deg?.label ?? hit.griis,
            source: gl
              ? `${gl.name}${gl.version ? "（" + gl.version + "）" : ""}`
              : "GRIIS 全球入侵物种数据库·中国",
            source_url: gl?.source_url ?? null,
          };
        }
      }
    }
  } catch (e) {
    console.warn("[buildDraftContent] conservation match failed:", e);
  }

  // ── Invasive-species warning card ──
  let invasiveCard: PlantDraftFields["invasive"] = null;
  let isInvasive = false;
  let gbifTaxonKey: number | null = null;
  try {
    const sciBinomial = sciFull.split(/\s+/).slice(0, 2).join(" ");
    if (sciBinomial) {
      const chk = await gbifCheckInvasive(sciBinomial);
      if (chk) {
        gbifTaxonKey = chk.taxonKey;
        isInvasive = chk.isInvasive;
      }
      const cl = lookupChinaInvasive(sciFull || sciBinomial);
      if (chk?.isInvasive || griisHit || cl) {
        isInvasive = true;
        const card = await generateInvasiveCard(
          meta.title || sciBinomial,
          meta.scientific_name || sciBinomial,
        );
        invasiveCard = {
          status_zh: card?.status_zh ?? "",
          harm_zh: card?.harm_zh ?? "",
          control_zh: card?.control_zh ?? "",
          degree: griisHit?.degreeLabel ?? null,
          source: griisHit?.source ?? chk?.source ?? "GBIF · GRIIS 中国名录",
          source_url: griisHit?.source_url ?? null,
          china_list: cl
            ? { batch: cl.batch, date: cl.date, publisher: cl.publisher, keyManaged: cl.keyManaged }
            : null,
        };
      }
    }
  } catch (e) {
    console.warn("[buildDraftContent] invasive check failed:", e);
  }

  const captureDate = new Date().toISOString().slice(0, 10);
  const rawHtml = renderDraftHtml({
    ...meta,
    photo_url: photoUrl,
    section_images: sectionPhotos.map((c) => c?.url ?? ""),
    section_credits: sectionPhotos.map((c) => (c ? creditLine(c) : "")),
    section_sources: sectionPhotos.map((c) => c?.sourceUrl ?? ""),
    section_missing: sectionMissing,
    section_notes: sectionNotes,
    invasive: invasiveCard,
    conservation: conservationBadgesList,
    conservation_card: conservationCardObj,
    capture_place: place || "未知地点",
    capture_lat: lat != null ? lat.toFixed(5) : "",
    capture_lng: lng != null ? lng.toFixed(5) : "",
    capture_date: captureDate,
    ai_model: usedModel,
  });
  // 正文里模型爱把拉丁名写成 markdown 斜体 `*Ficus lyrata*`，原样渲染就是字面星号。
  // 在最终 HTML 上统一转 <em>，一次覆盖所有分区（形态/分布/人文…），不用逐字段列举。
  const html = markdownEmphasisToHtml(rawHtml);

  return { meta, usedModel, usedProvider, usage, html, isInvasive, gbifTaxonKey };
}

// Lite summary-card HTML for a phase-1 draft. Shows ALL of the user's own shots
// (a gallery, newest first) so retakes visibly accumulate, plus the short summary.
// ── 「疑似」单一信号源 ────────────────────────────────────────────────────────
// 名称、正文、补拍横幅必须一致：要么都疑似，要么都不疑似。模型偶尔会 confidence 写
// medium 却在 summary_zh 里说「疑似」（反之亦然），导致标题不带疑似但正文带、补拍不激活。
// 这里把 meta 就地规范化为唯一真相：任一处露出疑似 → 全部疑似（confidence=low，激活补拍），
// 并保证 summary 带疑似前缀、needs_more_photos_zh 非空（补拍横幅依赖它）。
// 判据与拼名收在 lib/tentative.ts（纯函数，可独立测试）。
function normalizeIdentification(meta: AiMeta): void {
  // 先去掉模型写进字段的 markdown 强调符（`*Allium*` / `葱属 *Allium*`）—— 这些字段当纯文本
  // 渲染，星号会原样露出来。要在「疑似前缀」逻辑之前跑，否则 `疑似` 会加在残留的 * 后面。
  stripMetaMarkdown(meta);
  // 再清掉模型的元话语与复读残留（2026-07-25 线上：整段「任务完成。请查收。祝好！再见！」
  // 写进了字段内部）。**必须在疑似前缀逻辑之前跑** —— 否则「疑似」会被加在一段闲聊前面，
  // 而消毒后剩下的真内容反倒没有前缀。整段都是闲聊时留空串，交给下面的兜底文案。
  meta.summary_zh = stripModelChatter(meta.summary_zh as string);
  meta.summary_en = stripModelChatter(meta.summary_en as string);
  const summaryZh = (meta.summary_zh || "").toString();
  const tentative = isTentative(meta);
  if (tentative) {
    meta.identification_confidence = "low";
    // summary 以「疑似」开头（剥掉已有前缀再统一加，避免「疑似疑似」）。
    const body = stripTentativePrefix(summaryZh);
    meta.summary_zh = body ? `疑似${body}` : "疑似（依据现有照片暂无法确诊到种）";
    // 先滤掉「摸/闻」这类拍不出来的建议，再判空 —— 顺序不能反，否则整条被滤空时
    // needs_more_photos_zh 会留下空串，补拍横幅就不显示了。
    meta.needs_more_photos_zh = keepVisualAdvice(meta.needs_more_photos_zh as string);
    meta.needs_more_photos_en = keepVisualAdvice(meta.needs_more_photos_en as string);
    // 补拍横幅同时要求 needs_more_photos_zh 非空；模型漏填（或全被滤掉）时补一句通用引导。
    if (!meta.needs_more_photos_zh.trim()) meta.needs_more_photos_zh = DEFAULT_VISUAL_ADVICE;
  } else {
    // 非疑似：清掉正文里任何残留的疑似前缀，保持与「不疑似」一致。
    if (TENTATIVE_RE.test(summaryZh.trim().slice(0, 6))) {
      meta.summary_zh = stripTentativePrefix(summaryZh);
    }
    // 消毒后整段没了（模型这一趟基本只吐了闲聊）→ 给一句诚实的占位，别留白卡。
    // 疑似分支不需要这条：它上面已有「疑似（依据现有照片暂无法确诊到种）」兜底。
    if (!(meta.summary_zh || "").toString().trim()) {
      meta.summary_zh =
        "本次未能生成简介文案（模型返回内容异常）。物种判定见上方名称，可点「进一步生成草稿」重新撰写。";
    }
  }
}

// The heavy multi-image科普草稿 is generated later, on demand, by enrichDraft.
/**
 * Look up the registry chips (重点保护 / CITES / GTS / GRIIS) for one species, for the
 * server-rendered 简介摘要卡. The React surfaces (草稿页/详情页/分享卡) compute the same
 * chips client-side via useRegistryChips; this is the server-side twin so the summary
 * card baked into html_content carries them too.
 *
 * 地区名录 / tag chips are intentionally NOT included here: at quick-identify time the
 * draft has no tags yet, and catalog membership is a curation decision made later.
 * Best-effort — any failure returns [] and the card renders without a chip row.
 */
async function lookupRegistryChips(
  sci: string | null | undefined,
  family: string | null | undefined,
): Promise<{ kind: string; label: string }[]> {
  const s = (sci || "").trim();
  if (!s) return [];
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const listsRes = await supabaseAdmin
      .from("conservation_lists")
      .select("id,kind,name,province,source_note,source_url");
    const lists = (listsRes.data ?? []) as any[];
    if (!lists.length) return [];
    const taxa: any[] = [];
    for (let from = 0; ; from += 1000) {
      const { data } = await supabaseAdmin
        .from("conservation_taxa")
        .select("list_id,scientific_name,chinese_name,normalized_name,status,rank,excluded_names")
        .range(from, from + 999);
      const rows = data ?? [];
      taxa.push(...rows);
      if (rows.length < 1000) break;
    }
    if (!taxa.length) return [];
    const { buildConservationMatcher, registryChips } = await import("./conservation");
    const hit = buildConservationMatcher({ lists, taxa })(s, family || null);
    return registryChips(hit, lists);
  } catch (e) {
    console.warn("[lookupRegistryChips] failed:", e instanceof Error ? e.message : e);
    return [];
  }
}

/** Inline chip pills for the summary card — mirrors <RegistryChips> / the share card. */
function registryChipsHtml(chips: { kind: string; label: string; tone?: number }[]): string {
  if (!chips.length) return "";
  // 手动主题标签的绿色系，与网页 <RegistryChips> / 分享卡同一组色号（见 manualTagTone）。
  const MANUAL_GREENS = [
    { fg: "#245a42", bd: "#2d6a4f" },
    { fg: "#125e58", bd: "#17726b" },
    { fg: "#496523", bd: "#5b7c2a" },
    { fg: "#2f7548", bd: "#3f8f5a" },
  ];
  // 一名录一色系（与网页 <RegistryChips> / 分享卡同源）：国家保护=粉 / 地区保护=黄 /
  // CITES=紫 / GTS=蓝 / GRIIS 入侵=橙 / 手动主题标签=绿。旧值 protected 保留兜底。
  const TONE: Record<string, { fg: string; bd: string }> = {
    tag_manual: { fg: "#1f7a44", bd: "#2e9e5b" },
    protected_national: { fg: "#a63a6b", bd: "#c85a8a" },
    protected_regional: { fg: "#8a6410", bd: "#c99a2e" },
    protected: { fg: "#1f7a44", bd: "#2e9e5b" },
    cites: { fg: "#5f45a3", bd: "#7a5cc4" },
    gts: { fg: "#2c5488", bd: "#3f74b8" },
    griis: { fg: "#b3600f", bd: "#dd8324" },
  };
  const pills = chips
    .map((c) => {
      const t =
        c.kind === "tag_manual"
          ? MANUAL_GREENS[(c.tone ?? 0) % MANUAL_GREENS.length]
          : (TONE[c.kind] ?? { fg: "#8a6b4a", bd: "#e2ddd1" });
      return (
        `<span style="display:inline-block;border:1.5px solid ${t.bd};color:${t.fg};` +
        `border-radius:999px;padding:2px 10px;font-size:12px;font-weight:600;line-height:1.6">` +
        `${htmlEsc(c.label)}</span>`
      );
    })
    .join("");
  return `<div style="display:flex;flex-wrap:wrap;gap:6px;margin:.5em 0 .2em">${pills}</div>`;
}

// ── 识别过程痕迹 → 简介卡上的「识别过程 · 综合可信度」 ──────────────────────
// 类型与算法都在 lib/identify-trace.ts（纯函数）：草稿页的 React 卡片要用同一套算法算
// 同一个数字，各写一份迟早算出两个不一样的百分比。

/** 把痕迹渲染成简介卡底部那块「识别过程」。分享卡不含此块（分享出去只要结论）。 */
function identifyTraceHtml(t: IdentifyTrace, finalSci: string, finalConf: string): string {
  const { pct, basis } = computeIdentifyConfidence(t, finalSci, finalConf);
  const steps: string[] = [];
  if (t.primaryEngine === "plantnet") {
    steps.push(
      `<li><b>专业引擎 Pl@ntNet</b>：${htmlEsc(t.primaryLabel)} —— 引擎置信度 ${t.primaryPct}%</li>`,
    );
  } else if (t.primaryEngine === "vision") {
    steps.push(
      `<li><b>专业引擎 Pl@ntNet</b>：未参与（额度用尽或未配置）→ 由复核模型顶替一线定种：${htmlEsc(t.primaryLabel)}</li>`,
    );
  } else {
    steps.push(`<li><b>专业引擎 Pl@ntNet</b>：未参与</li>`);
  }
  steps.push(
    `<li><b>一线识别模型</b>${t.phase1Model ? `（${htmlEsc(t.phase1Model)}）` : ""}：${confZh(t.phase1Confidence)}</li>`,
  );
  if (t.review.ran) {
    steps.push(
      `<li><b>二次自动复核</b>（${htmlEsc(t.review.model)}）：${confZh(t.review.confidence)} · ` +
        `${t.review.action === "confirm" ? "确认原判" : "纠正物种"} → ` +
        `${t.review.adopted ? "<b>已采纳，跳过补拍</b>" : "未采纳，维持疑似"}</li>`,
    );
  } else {
    steps.push(`<li><b>二次自动复核</b>：未运行 —— ${htmlEsc(t.review.reason)}</li>`);
  }
  if (t.retakeCount > 0) steps.push(`<li><b>补拍</b>：这是第 ${t.retakeCount} 次补拍后的结果</li>`);
  return (
    `<div style="margin-top:14px;padding:10px 12px;border:1px solid #e3d6c3;border-radius:10px;background:#fbf7f0">` +
    `<p style="margin:0 0 6px;font-size:13px;font-weight:700;color:#6e4c28">识别过程 · 综合可信度 ${pct}%</p>` +
    `<ol style="margin:0;padding-left:1.2em;font-size:12px;color:#6b5a45;line-height:1.75">${steps.join("")}</ol>` +
    `<p style="margin:6px 0 0;font-size:11px;color:#8a6b4a">可信度依据：${htmlEsc(basis)}</p>` +
    `</div>`
  );
}

function buildSummaryCardHtml(opts: {
  photos: string[];
  title: string;
  sci: string;
  summaryZh: string;
  family?: string | null;
  genus?: string | null;
  tentative?: boolean;
  chips?: { kind: string; label: string }[];
  trace?: IdentifyTrace | null;
  finalConfidence?: string;
}): string {
  const { photos, sci, summaryZh, family, genus, tentative } = opts;
  const cleanTitle = stripTentativePrefix(opts.title) || "待鉴定植物";
  const displayTitle = tentative ? `疑似${cleanTitle}` : cleanTitle;
  const list = photos.filter(Boolean);
  const hero = list[0] || "";
  const rest = list.slice(1);
  const heroImg = hero
    ? `<img src="${htmlEsc(hero)}" alt="${htmlEsc(displayTitle)}" style="width:100%;border-radius:12px;display:block"/>`
    : "";
  const gallery = rest.length
    ? `<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(90px,1fr));gap:6px;margin-top:8px">` +
      rest
        .map(
          (u) =>
            `<img src="${htmlEsc(u)}" alt="${htmlEsc(displayTitle)}" style="width:100%;aspect-ratio:1/1;object-fit:cover;border-radius:8px;display:block"/>`,
        )
        .join("") +
      `</div>` +
      `<p style="color:#8a6b4a;font-size:12px;margin:.3em 0 0">共 ${list.length} 张你拍摄的照片</p>`
    : "";
  const famGen = [family, genus]
    .map((s) => (s || "").trim())
    .filter(Boolean)
    .join(" · ");
  const famGenLine = famGen
    ? `<p style="color:#2e7d46;font-size:14px;font-weight:600;letter-spacing:.02em;margin:.1em 0 .4em">${htmlEsc(famGen)}</p>`
    : "";
  return (
    `<div style="max-width:680px;margin:0 auto;padding:8px 4px;font-family:'Noto Serif SC',serif;line-height:1.7">` +
    heroImg +
    gallery +
    `<h1 style="margin:.6em 0 .15em${tentative ? ";color:#c8452f" : ""}">${htmlEsc(displayTitle)} <i style="font-weight:400;color:#6e4c28">${htmlEsc(sci)}</i></h1>` +
    famGenLine +
    registryChipsHtml(opts.chips ?? []) +
    `<p>${htmlEsc(summaryZh)}</p>` +
    (opts.trace ? identifyTraceHtml(opts.trace, sci, opts.finalConfidence || "") : "") +
    `<p style="color:#8a6b4a;font-size:13px">— 简介摘要卡（点击「让 AI 生成进一步介绍草稿」可生成含多张配图的完整科普草稿）</p>` +
    `</div>`
  );
}

const SubmitInput = z.object({
  photo_base64: z.string().min(100).max(8_000_000),
  photo_mime: z
    .string()
    .regex(/^image\/(jpeg|jpg|png|webp)$/i)
    .default("image/jpeg"),
  lat: z.number().nullable().optional(),
  lng: z.number().nullable().optional(),
  creator_label: z.string().max(80).optional(),
  // 前端传递：当前登录用户的 ID，用于识别人显示（非访客）
  logged_in_user_id: z.string().uuid().optional(),
  // 补拍复核：这是同一株植物的第 N 次补拍。retake_count 决定识别铜叶 = 1 + retake_count
  // （疑似恒 1）；≥3 时强制出结论（哪怕疑似）。species_hint 传上一轮的判断供复核。
  retake_count: z.number().int().min(0).max(10).optional().default(0),
  species_hint_title: z.string().max(200).optional(),
  species_hint_sci: z.string().max(200).optional(),
  // 补拍复核时携带：把新照片合并进这份既有草稿（不再新建一份），照片追加进 user_photos、
  // 覆盖封面与摘要卡、刷新置信度/补拍建议。为空则走新建逻辑。
  merge_draft_id: z.string().uuid().optional(),
  /** 原始文件字节的 SHA-256，客户端在压缩前算好传来。用于「这张照片已经识别过」查重。 */
  photo_sha256: z
    .string()
    .regex(/^[a-f0-9]{64}$/)
    .optional(),
  /**
   * 同一株植物的**额外角度照**，与 photo_base64 一起本轮同时识别（补拍时最多再带 2 张，
   * 连主图共 3 张）。
   *
   * 上限 2 是**对齐模型侧既有的 3 张上限**定的，不是随手取的：secondOpinionIdentify 一直
   * `prior.slice(0, 2)` + 当前 1 张 —— 图片是这个请求里最重的输入，每多一张都同时推高上传
   * 耗时与首字延迟，而第 4 张往后对结论的边际贡献抵不上它带来的超时风险。
   */
  extra_photos: z
    .array(
      z.object({
        base64: z.string().min(100).max(8_000_000),
        mime: z
          .string()
          .regex(/^image\/(jpeg|jpg|png|webp)$/i)
          .default("image/jpeg"),
      }),
    )
    .max(2)
    .optional(),
});

export const submitPlantDraft = createServerFn({ method: "POST" })
  .inputValidator((input) => SubmitInput.parse(input))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // Try to identify the authenticated user (optional — anon is allowed).
    let createdBy: string | null = null;
    let creatorLabel = data.creator_label?.trim() || "访客";
    try {
      // 经 `.server.ts` 边界拿 —— 直接 import 会把服务端专用模块泄进客户端依赖图
      // （2026-07-29 抽 runQuickIdentifyCore 时踩过：dev 500 而 build 照过，极具迷惑性）。
      const { getAuthorizationHeader } = await import("./request-auth.server");
      const authHeader = await getAuthorizationHeader();
      if (authHeader?.startsWith("Bearer ")) {
        const token = authHeader.slice(7);
        const { data: u } = await supabaseAdmin.auth.getUser(token);
        if (u.user) {
          createdBy = u.user.id;
          const { data: prof } = await supabaseAdmin
            .from("profiles")
            .select("display_name")
            .eq("id", u.user.id)
            .maybeSingle();
          if (prof?.display_name) creatorLabel = prof.display_name;
        }
      }
    } catch (err) {
      console.warn("[SubmitPlantDraft] Auth lookup failed/anon:", err);
    }

    const dbCreatedBy: string | null =
      createdBy && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(createdBy)
        ? createdBy
        : null;

    // Reverse-geocode (if coords supplied).
    let place = "";
    const lat = data.lat ?? null;
    const lng = data.lng ?? null;
    console.log(`[SubmitPlantDraft] Received coords: lat=${lat}, lng=${lng}`);
    if (lat != null && lng != null) {
      place = await reverseGeocode(lat, lng);
      console.log(`[SubmitPlantDraft] Reverse-geocoded to: ${place}`);
    } else {
      console.warn("[SubmitPlantDraft] No coords provided, place will be empty");
    }

    // Build the data URL for the multimodal AI call.
    const dataUrl = `data:${data.photo_mime};base64,${data.photo_base64}`;

    // Upload the user photo to Storage first (drafts/ prefix is anon-writable), then
    // run the shared heavy pipeline (identify → section photos → cards → full HTML).
    const buffer = Buffer.from(data.photo_base64, "base64");
    const ext = data.photo_mime.includes("png")
      ? "png"
      : data.photo_mime.includes("webp")
        ? "webp"
        : "jpg";
    const path = `drafts/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
    const { error: upErr } = await supabaseAdmin.storage
      .from("plant-images")
      .upload(path, buffer, { contentType: data.photo_mime, upsert: false });
    if (upErr)
      throw new AiError(
        "STORAGE_UPLOAD_FAILED",
        `照片上传失败（STORAGE_UPLOAD_FAILED）：无法把照片存入云端存储。原因：${upErr.message}。请检查网络后重试。`,
      );
    const photoUrl = supabaseAdmin.storage.from("plant-images").getPublicUrl(path).data.publicUrl;

    const { meta, usedModel, usedProvider, usage, html, isInvasive, gbifTaxonKey } =
      await buildDraftContent({ dataUrl, photoUrl, place, lat, lng });

    // glm-5v-turbo etc. sometimes return a partial JSON missing `title` (a NOT NULL
    // column). Fall back so a meaningful name always persists — and the usage log shows
    // that name instead of the bare draft UUID — for an editor to curate.
    const safeTitle = draftTitleFor(meta);

    // Persist draft row.
    const { data: row, error: insErr } = await supabaseAdmin
      .from("plant_drafts")
      .insert({
        created_by: dbCreatedBy,
        creator_label: creatorLabel,
        photo_url: photoUrl,
        capture_lat: lat,
        capture_lng: lng,
        capture_place: place,
        ai_model: usedModel,
        ai_payload: JSON.parse(JSON.stringify(meta)),
        title: safeTitle,
        scientific_name: meta.scientific_name || null,
        common_name_en: meta.common_name_en || null,
        common_names_zh: meta.common_names_zh || null,
        family: meta.family || null,
        genus: meta.genus || null,
        summary: (meta.summary_zh || meta.summary_en || "").toString().slice(0, 600),
        tags: meta.tags ?? [],
        iucn_status: meta.iucn_status || null,
        html_content: html,
      })
      .select("id")
      .single();
    if (insErr)
      throw new AiError(
        "DRAFT_INSERT_FAILED",
        `保存草稿失败（DRAFT_INSERT_FAILED）：识别已完成，但写入数据库时出错。原因：${insErr.message}。`,
      );

    // Log token usage. MUST be awaited: on Cloudflare Workers the isolate can be
    // torn down once the response is returned, so a fire-and-forget insert may never
    // flush — leaving ai_usage_logs empty. Wrapped so a logging failure still can't
    // break the main identify flow.
    try {
      const { error: usageErr } = await (supabaseAdmin as any).from("ai_usage_logs").insert({
        user_id: dbCreatedBy,
        user_label: creatorLabel,
        provider: usedProvider,
        model: usedModel,
        prompt_tokens: usage.prompt_tokens,
        completion_tokens: usage.completion_tokens,
        total_tokens: usage.total_tokens,
        capture_place: place || null,
        capture_lat: lat,
        capture_lng: lng,
        draft_id: row.id,
        draft_title: safeTitle,
        task_type: "enrich_draft", // Full draft generation with complete content
      });
      if (usageErr) console.warn("[UsageLog] Failed to insert ai_usage_logs:", usageErr.message);
    } catch (e) {
      console.warn("[UsageLog] Unexpected error inserting ai_usage_logs:", e);
    }

    // Persist the invasive flag + GBIF taxon key for the /explore map's danger
    // triangles. Best-effort + separate from the main insert: requires the
    // 20260703 migration, so a pre-migration run still saves the draft fine.
    if (gbifTaxonKey != null || isInvasive) {
      try {
        const { error: invErr } = await (supabaseAdmin as any)
          .from("plant_drafts")
          .update({ is_invasive: isInvasive, gbif_taxon_key: gbifTaxonKey })
          .eq("id", row.id);
        if (invErr)
          console.warn(
            "[SubmitPlantDraft] invasive flag update skipped (migration?):",
            invErr.message,
          );
      } catch (e) {
        console.warn("[SubmitPlantDraft] invasive flag update failed:", e);
      }
    }

    return { draftId: row.id as string, place, isInvasive };
  });

// Resolve the (optional) authed creator from the Bearer header → {id, label}.
// Shared by the two-phase identify handlers; anon is allowed (label 访客).
async function resolveCreator(
  creatorLabelInput?: string,
  loggedInUserId?: string,
): Promise<{ dbCreatedBy: string | null; creatorLabel: string }> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  let createdBy: string | null = null;
  let creatorLabel = creatorLabelInput?.trim() || "访客";

  // 优先：前端传的 logged_in_user_id（已登录用户从浏览器 session 读到的自己的 ID）
  if (loggedInUserId) {
    try {
      const { data: prof } = await supabaseAdmin
        .from("profiles")
        .select("display_name")
        .eq("id", loggedInUserId)
        .maybeSingle();
      if (prof?.display_name) {
        createdBy = loggedInUserId;
        creatorLabel = prof.display_name;
      }
    } catch (err) {
      console.warn("[resolveCreator] Profile lookup via logged_in_user_id failed:", err);
    }
  }

  // 兜底：尝试从 Authorization header 读（服务端渲染或其他调用路径）
  if (!createdBy) {
    try {
      // 经 `.server.ts` 边界拿 —— 直接 import 会把服务端专用模块泄进客户端依赖图
      // （2026-07-29 抽 runQuickIdentifyCore 时踩过：dev 500 而 build 照过，极具迷惑性）。
      const { getAuthorizationHeader } = await import("./request-auth.server");
      const authHeader = await getAuthorizationHeader();
      if (authHeader?.startsWith("Bearer ")) {
        const token = authHeader.slice(7);
        const { data: u } = await supabaseAdmin.auth.getUser(token);
        if (u.user) {
          createdBy = u.user.id;
          const { data: prof } = await supabaseAdmin
            .from("profiles")
            .select("display_name")
            .eq("id", u.user.id)
            .maybeSingle();
          if (prof?.display_name) creatorLabel = prof.display_name;
        }
      }
    } catch (err) {
      console.warn("[resolveCreator] Auth lookup failed/anon:", err);
    }
  }

  const dbCreatedBy =
    createdBy && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(createdBy)
      ? createdBy
      : null;
  return { dbCreatedBy, creatorLabel };
}

const htmlEsc = (s: string) =>
  s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] ?? c);

// ── Phase 1: fast identify → lightweight "summary card" draft ─────────────────
// Uploads the user photo, runs the FAST identify (species + short summary +
// confidence), and persists a lite draft (ai_payload._enriched=false) so the user
// sees a card immediately. The heavy multi-image draft is generated later, on
// demand, by enrichDraft. If the fast path is unavailable it falls back to the
// full pipeline so this never hard-fails.
/**
 * 同步识别的入口 —— **保留它**，因为两种情形仍然需要：
 * ① 队列绑定不可用时（本地 vite dev 没有 workerd）的退路；
 * ② 匿名用户（不进动态流，也就没有轮询的必要）。
 * 登录用户的正路是 `startQuickIdentifyFn`（走队列，可切后台）。
 */
export const quickIdentifyDraft = createServerFn({ method: "POST" })
  .inputValidator((input) => SubmitInput.parse(input))
  .handler(async ({ data }) => runQuickIdentifyCore(data));

/**
 * 识别的**正路**：先把照片传上云端，再把任务交给队列，立刻返回 jobId。
 *
 * 为什么必须这样（用户 2026-07-29 的需求，也是 07-26 那个「假失败」的根治）：
 * 整条识别串着 Pl@ntNet + 一线视觉模型 + 疑似复核 + 出卡，挂在一个 HTTP 请求上
 * 必然撞 Cloudflare 边缘 **100 秒**上限 —— 用户实测等到 101 秒报「Load failed」，
 * 而服务端其实已经把草稿写完了。搬进队列后消费者有 15 分钟，用户可以锁屏、
 * 切后台、去识别下一株。
 *
 * ⚠️ **payload 里绝不能塞 base64**：`pruneExpiredJobs` 每次建任务都会把所有 job 行的
 * value 全量拉回来解析，塞进一张 8MB 的图会把它撑爆。所以照片**先传存储**，
 * payload 只带地址；消费者用地址把字节取回来。
 *
 * 仅限登录用户。匿名识别继续走同步的 `quickIdentifyDraft` —— 他们没有动态流、
 * 也没有跨设备接回任务的需求（用户明确表示重点照顾注册用户与编辑）。
 */
export const startQuickIdentifyFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => SubmitInput.parse(input))
  .handler(async ({ data, context }) => {
    const { userId } = context as { userId: string };
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { createJob, pruneExpiredJobs } = await import("./background-jobs");
    const { keepAlive } = await import("./worker-ctx");
    const { enqueueJob } = await import("./job-queue");

    const extOf = (mime: string) =>
      mime.includes("png") ? "png" : mime.includes("webp") ? "webp" : "jpg";
    const rnd = () => Math.random().toString(36).slice(2, 8);

    // 主图：传不上去就没法往下走（消费者要靠地址取字节），当场报错而不是排队后再失败。
    const mainPath = `drafts/${Date.now()}-${rnd()}.${extOf(data.photo_mime)}`;
    const { error: upErr } = await supabaseAdmin.storage
      .from("plant-images")
      .upload(mainPath, Buffer.from(data.photo_base64, "base64"), {
        contentType: data.photo_mime,
        upsert: false,
      });
    if (upErr)
      throw new AiError(
        "STORAGE_UPLOAD_FAILED",
        `照片上传失败（STORAGE_UPLOAD_FAILED）：无法把照片存入云端存储。原因：${upErr.message}。请检查网络后重试。`,
      );
    const photoUrl = supabaseAdmin.storage.from("plant-images").getPublicUrl(mainPath)
      .data.publicUrl;

    // 额外角度照：失败**不致命**（同 runQuickIdentifyCore 的口径），少一个视角而已。
    const extraUrls: string[] = [];
    for (const ph of (data.extra_photos ?? []).slice(0, 2)) {
      const p2 = `drafts/${Date.now()}-${rnd()}.${extOf(ph.mime)}`;
      const { error } = await supabaseAdmin.storage
        .from("plant-images")
        .upload(p2, Buffer.from(ph.base64, "base64"), { contentType: ph.mime, upsert: false });
      if (error) {
        console.warn("[StartIdentify] 额外角度照上传失败（忽略）:", error.message);
        continue;
      }
      extraUrls.push(supabaseAdmin.storage.from("plant-images").getPublicUrl(p2).data.publicUrl);
    }

    void pruneExpiredJobs();
    const job = await createJob({
      kind: "quick_identify",
      userId,
      // 新建识别还没有草稿；合并补拍才有。draftId 是 JobRecord 的必填字段，
      // 空串表示「跑完才会有」—— 动态流那一路改按 jobId 认身份（见 upsertTaskFeed）。
      draftId: data.merge_draft_id ?? "",
      phase: "已排队，正在启动…",
      payload: { identify: { ...data, photo_base64: "", extra_photos: [] }, photoUrl, extraUrls },
    });

    // 一入队就进动态流，绿色进度条立刻可见 —— 用户点完识别就会切走去拍下一株，
    // 等第一个 onPhase 才落地会留一段「点了没反应」的空窗（冷启动可达几十秒）。
    // 缩略图直接用刚传上去的那张原图，不必等草稿建好。
    await feedStart(userId, "identify", data.merge_draft_id ?? null, job.id, {
      title: "正在识别…",
      thumbUrl: photoUrl,
    });

    if (!(await enqueueJob(job.id))) keepAlive(runQueuedJob(job.id));

    return { jobId: job.id, photoUrl };
  });

/** quickIdentify 的入参形状。队列消费者重放时要按同一形状把 data 拼回来。 */
type QuickIdentifyData = z.infer<typeof SubmitInput>;

/** 阶段回调。同步调用时是空函数，走队列时把文案写进 job 行与动态流。 */
type PhaseFn = (phase: string, progress: number) => void;

/**
 * 一次快速识别的**全部实际工作**。
 *
 * 2026-07-29 从 `quickIdentifyDraft` 的 handler 里原样抽出来，一行逻辑没改 ——
 * 目的是让它既能被同步 server fn 直接调用，也能被队列消费者重放。
 *
 * **为什么必须能重放**：整条识别串着 Pl@ntNet + 一线视觉模型 + 疑似复核 + 出卡，
 * 挂在一个 HTTP 请求上就必然撞 Cloudflare 边缘 100 秒上限（用户实测等到 101 秒
 * 报 Load failed，而服务端其实已经把草稿写进库了）。搬进队列后消费者有 15 分钟，
 * 用户也可以切后台、去识别下一株。
 *
 * `opts.photoUrl` 是**已经传好的主图地址**：走队列时图片在入队前就传上去了
 * （payload 里绝不能塞 base64，见 background-jobs 的 pruneExpiredJobs），
 * 传了就跳过内部那次上传，避免同一张图存两份。
 */
async function runQuickIdentifyCore(
  data: QuickIdentifyData,
  onPhase: PhaseFn = () => {},
  opts: { photoUrl?: string; extraUrls?: string[] } = {},
) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { dbCreatedBy, creatorLabel } = await resolveCreator(
    data.creator_label,
    data.logged_in_user_id,
  );

  const lat = data.lat ?? null;
  const lng = data.lng ?? null;
  const dataUrl = `data:${data.photo_mime};base64,${data.photo_base64}`;

  // 阶段文案：同步路径下 onPhase 是空函数，走队列时它会写进 job 行 + 动态流，
  // 让相框里的进度、以及小P蛙上的绿色进度条都有东西可显示。
  onPhase("正在读取照片与拍摄位置…", 8);

  // ── 出卡速度：地名反查 + 原图上传 都不该串在识别前面 ────────────────────────
  // 识别只吃 base64（dataUrl），既不需要 photoUrl 也不真的需要地名。以前这三步是串行的
  // （geocode → upload → identify），用户就得连等三个网络往返。现在前两步**并行启动**，
  // 识别期间它们在后台跑完，关键路径只剩识别本身。
  const geoP: Promise<string> =
    lat != null && lng != null
      ? reverseGeocode(lat, lng).catch((e) => {
          console.warn("[QuickIdentify] reverseGeocode failed:", e);
          return "";
        })
      : Promise.resolve("");

  const buffer = Buffer.from(data.photo_base64, "base64");
  const ext = data.photo_mime.includes("png")
    ? "png"
    : data.photo_mime.includes("webp")
      ? "webp"
      : "jpg";
  const path = `drafts/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
  // 走队列时主图在**入队前**就传好了（payload 只带地址、绝不带 base64），
  // 这里直接跳过，免得同一张图在存储里躺两份。
  const preUploaded = !!opts.photoUrl;
  // `.then(ok, err)` 就地接住 rejection —— 这个 promise 要等到识别之后才 await，
  // 中途若失败又没有 handler，Node 会报 unhandled rejection 把整个请求带崩。
  const uploadP = preUploaded
    ? Promise.resolve({ error: null as { message?: string } | null })
    : supabaseAdmin.storage
        .from("plant-images")
        .upload(path, buffer, { contentType: data.photo_mime, upsert: false })
        .then(
          (r) => r as { error: { message?: string } | null },
          (e) => ({ error: { message: e instanceof Error ? e.message : String(e) } }),
        );

  onPhase("正在比对专业定种引擎与视觉模型…", 25);

  // ── 本轮同时上传的额外角度照（补拍最多 2 张）────────────────────────────────
  // 与主图**并行**上传，理由同上：识别只吃 base64，不必等任何一张传完。
  // 与主图的关键差别是**失败不致命** —— 主图传不上去整次识别就没有封面、必须报错；
  // 额外角度照只是多一个视角，传失败就当这一张没有（识别仍照常用它的 base64，因为模型
  // 吃的是内存里的字节、根本不经过存储）。绝不能让第 2 张的存储抖动毁掉整次识别。
  const extras = (data.extra_photos ?? []).slice(0, 2);
  const extraDataUrls = extras.map((ph) => `data:${ph.mime};base64,${ph.base64}`);
  // 走队列时这些图也已经传好了（地址在 opts.extraUrls 里），只喂模型、不再重传。
  const extraUploads = (preUploaded ? [] : extras).map((ph) => {
    const ex = ph.mime.includes("png") ? "png" : ph.mime.includes("webp") ? "webp" : "jpg";
    const p = `drafts/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ex}`;
    return {
      path: p,
      p: supabaseAdmin.storage
        .from("plant-images")
        .upload(p, Buffer.from(ph.base64, "base64"), { contentType: ph.mime, upsert: false })
        .then(
          (r) => r as { error: { message?: string } | null },
          (e) => ({ error: { message: e instanceof Error ? e.message : String(e) } }),
        ),
    };
  });

  let meta: AiMeta;
  let usedModel: string;
  let usedProvider: string;
  let usage: AiTokenUsage;
  let html: string;
  let enriched: boolean;
  const isInvasive = false;
  const gbifTaxonKey: number | null = null;
  // 二次复核的留痕（仅当复核真的改变了结论时非 null），写进 ai_payload 供复盘。
  let secondOpinion: {
    by: string;
    model: string;
    action: string;
    from: string;
    to: string;
    plantnet: string;
  } | null = null;

  // ── 全链路识别痕迹 ────────────────────────────────────────────────────────
  // 与 secondOpinion 的区别：那个只在「复核改变了结论」时才有，这个**每次识别都记**，
  // 包括复核压根没跑（限流/超时/没配模型）的情况。
  // 起因：用户发现「出现疑似时用量表只有 plantnet+gemini-quick，补拍后才出现 review-adopted」，
  // 追下来是 secondOpinionIdentify 在 429 限流/30s 超时时**静默返回 null**，用户被直接推去补拍，
  // 完全无从知道「说好的自动复核」到底跑没跑。痕迹渲染进简介卡后，这件事永久透明。
  const trace: {
    primaryEngine: string;
    primaryLabel: string;
    primaryPct: number | null;
    phase1Model: string;
    phase1Confidence: string;
    review:
      | { ran: false; reason: string }
      | { ran: true; model: string; confidence: string; action: string; adopted: boolean };
    retakeCount: number;
  } = {
    primaryEngine: "none",
    primaryLabel: "",
    primaryPct: null,
    phase1Model: "",
    phase1Confidence: "",
    review: { ran: false, reason: "未触发（结果不是疑似）" },
    retakeCount: 0,
  };

  const retakeCount = data.retake_count ?? 0;
  const speciesHint =
    data.species_hint_title || data.species_hint_sci
      ? { title: data.species_hint_title, sci: data.species_hint_sci }
      : null;

  // Merge mode (补拍): load the existing draft's prior user photos so the new shot
  // appends to the gallery, and so the share card can use the resolving shot as its
  // cover. The NEW photo goes FIRST (it's the clearest / most recent, and the one
  // that resolved the identification when we finally 升出 low).
  let priorPhotos: string[] = [];
  if (data.merge_draft_id) {
    try {
      const { data: prev } = await (supabaseAdmin as any)
        .from("plant_drafts")
        .select("user_photos, photo_url")
        .eq("id", data.merge_draft_id)
        .maybeSingle();
      if (prev) {
        const up = Array.isArray(prev.user_photos)
          ? (prev.user_photos as string[]).filter(Boolean)
          : [];
        priorPhotos = up.length ? up : prev.photo_url ? [prev.photo_url as string] : [];
      }
    } catch (e) {
      console.warn("[QuickIdentify] prior user_photos load failed (migration pending?):", e);
    }
  }
  // 地名只是识别的辅助提示，最多等它 4s —— Nominatim 偶发很慢/无响应，不该拖住出卡。
  // 写库前会再取一次完整结果（那时通常早已 resolve），所以 capture_place 不会因此丢。
  let place = await Promise.race([geoP, new Promise<string>((r) => setTimeout(() => r(""), 4000))]);

  // On 补拍, load the earlier shots as inline images so the model can judge from
  // ALL angles at once. Best-effort: a fetch failure just falls back to single-image.
  let priorInline: InlineImage[] = [];
  if (priorPhotos.length > 0) {
    try {
      priorInline = await fetchInlineImages(priorPhotos.slice(0, 4));
    } catch (e) {
      console.warn(
        "[QuickIdentify] prior photo inline fetch failed:",
        e instanceof Error ? e.message : e,
      );
    }
  }
  // 本轮同时拍的额外角度照**排在历史补拍照前面**：下游一律 slice 取前几张，谁排前面谁
  // 真正进模型。这一轮的照片是用户刚刚按提示补拍的同一株植物，比几轮以前的旧照片更该被看见。
  // 它们的字节已经在内存里（就是请求体），不必像历史照片那样再从存储 fetch 回来。
  if (extras.length) {
    priorInline = [
      ...extras.map((ph) => ({ mimeType: ph.mime, base64: ph.base64 })),
      ...priorInline,
    ];
  }

  // ── Stage 0（phase-1）：专业识别引擎作为一线信号 ────────────────────────────
  // 先做一次专业定种，判定作为「定种基准」提示喂给 Gemini —— Gemini 的置信度因此吸收了
  // 这个信号（低分或与照片明显不符 → 倾向标「疑似」→ 触发下方二次复核），无需再单独维护
  // 一个脆弱的分数阈值门。此前这条链路只在 callAiIdentify（重路径）里跑，而拍照走的是本
  // 快路径，等于专业识别一直没参与常规识别 —— 这里把它接回一线。
  //
  // 一线引擎降级链：
  //   Pl@ntNet（免费额度 500 次/天）
  //     → 额度用尽 / 未配 key / 请求失败 → 二次复核模型视觉顶替
  //       → 二次复核模型也不可用 → 退回纯 Gemini（旧行为）
  // 额度耗尽（HTTP 429）会被持久标记进 site_config.plantnet_quota_state，之后的请求直接
  // 跳过 Pl@ntNet，不用每次都撞一发必定 429 的往返；1 小时后自动重试，额度一重置就切回。
  let plantNetHint: string | undefined;
  // Pl@ntNet 的判定留一份：两条出卡链路都失败时用它兜底出摘要卡，避免「待鉴定植物」。
  let primaryFallback: { sci: string; family: string; genus: string; pct: number } | null = null;
  let primaryLabel = "none";
  let primaryEngine: "plantnet" | "vision" | "none" = "none";
  let secondPrimary: { usage: AiTokenUsage; model: string } | null = null;
  const plantNetKey = await loadPlantNetKey();
  const quotaKnownExhausted = plantNetKey ? await isPlantNetQuotaExhausted() : false;

  if (plantNetKey && !quotaKnownExhausted) {
    const pnRes = await plantNetIdentify(dataUrl, plantNetKey, extraDataUrls).catch((e) => {
      console.warn("[Pl@ntNet] quick-path identify failed; falling back:", e);
      return { verdict: null, quotaExhausted: false, status: 0, body: "" };
    });
    if (pnRes.quotaExhausted) await markPlantNetQuotaExhausted();
    const pn = pnRes.verdict;
    if (pn && pn.scientific_name) {
      const pct = Math.round((pn.score ?? 0) * 100);
      primaryEngine = "plantnet";
      primaryLabel = `${pn.scientific_name}@${pct}%`;
      // 痕迹：Pl@ntNet 的 score 是引擎给的真实置信分，是整条链路上唯一「非模型自评」的
      // 客观数字，最终可信度%就以它为锚（见 computeIdentifyConfidence）。
      trace.primaryEngine = "plantnet";
      trace.primaryLabel = pn.scientific_name;
      trace.primaryPct = pct;
      // 出卡链路全挂时用它兜底出摘要卡（见下方 else 分支）——有 Pl@ntNet 的学名，
      // 就绝不该把草稿命名成「待鉴定植物」。
      primaryFallback = {
        sci: pn.scientific_name,
        family: (pn.family || "").toString(),
        genus: (pn.genus || "").toString(),
        pct,
      };
      plantNetHint =
        `【专业识别引擎 Pl@ntNet 判定】最可能物种：${pn.scientific_name}` +
        `${pn.family ? `（科 ${pn.family}${pn.genus ? ` / 属 ${pn.genus}` : ""}）` : ""}` +
        `，置信度 ${pct}%。备选：${pn.candidates.join("、")}。` +
        `请以此专业判定为基准核对照片；若置信度偏低（低于 30%）或与照片明显不符，` +
        `请在 summary_zh 开头标注「疑似」并简述分歧依据。`;
    }
  }

  // Pl@ntNet 没能给出判定（额度用尽 / 未配 key / 请求失败）→ 二次复核模型顶上一线专业定种。
  if (!plantNetHint) {
    const dv = await secondOpinionPrimaryVerdict(dataUrl, priorInline);
    if (dv) {
      primaryEngine = "vision";
      primaryLabel = `${dv.label}（二次复核模型顶替）`;
      plantNetHint = dv.hint;
      secondPrimary = { usage: dv.usage, model: dv.model };
      // 顶替模式没有 Pl@ntNet 那种客观分数，只有模型自评 → primaryPct 保持 null，
      // 可信度%改由 phase-1/复核的置信档决定，卡片上也会如实写「Pl@ntNet 未参与」。
      trace.primaryEngine = "vision";
      trace.primaryLabel = dv.label;
    }
  }
  console.log(
    `[Phase1] 一线引擎=${primaryEngine}（${primaryLabel}）` +
      (quotaKnownExhausted ? " · Pl@ntNet 额度已标记用尽，本次跳过" : ""),
  );

  let quick = await identifyQuick(dataUrl, place, {
    speciesHint,
    retakeCount,
    forceResult: retakeCount >= 3, // 补拍满 3 次必须出结论（哪怕疑似）
    priorPhotos: priorInline,
    plantNetHint,
  });

  // identifyQuick 是 **Gemini 专用**链路，「出卡AI」序列里没有 Gemini 项时它返回 null
  // （管理员配的是 Kimi / 自建 custom 就属于这种）。这时改用序列本身再识别一次 ——
  // 关键是**仍然只出摘要卡**。
  //
  // 这里以前是直接掉进下面的 `else` 跑完整 buildDraftContent 并把草稿标成
  // enriched=true，于是换成非 Gemini 模型后，用户根本没点「进一步生成草稿」，
  // 草稿却已经被完整生成了 —— 既莫名其妙，也白烧一次长文的钱。
  if (!quick) {
    quick = await callAiIdentify(
      dataUrl,
      place,
      speciesHint ? { title: speciesHint.title, scientificName: speciesHint.sci } : null,
      undefined,
      "card",
    ).catch((e) => {
      // 失败不在这里报错：下面的 `else` 还有一条完整流水线兜底。
      console.warn("[Phase1] 出卡AI 序列识别失败，回退完整流水线：", e);
      return null;
    });
  }

  // 识别已出结果 —— 到这一步才真正需要 photoUrl（建卡 / 写库）。上传是和地名反查、
  // Pl@ntNet、识别**并行**跑的，此刻通常早已完成，这个 await 基本不耗时。
  onPhase("正在整理识别结果并生成简介卡…", 72);

  const { error: upErr } = await uploadP;
  if (upErr)
    throw new AiError(
      "STORAGE_UPLOAD_FAILED",
      `照片上传失败（STORAGE_UPLOAD_FAILED）：无法把照片存入云端存储。原因：${upErr.message}。请检查网络后重试。`,
    );
  // 走队列时地址在入队前就定好了；同步路径才现拼。
  const photoUrl =
    opts.photoUrl || supabaseAdmin.storage.from("plant-images").getPublicUrl(path).data.publicUrl;
  // 本轮同时上传的额外角度照：**传成功的才进相册**。失败的那张识别照样用过（模型吃的是内存里
  // 的字节），只是存储里没有它——把一个不存在的 URL 写进 user_photos 只会在草稿页显示裂图。
  const extraUrls: string[] = [...(opts.extraUrls ?? [])];
  for (const u of extraUploads) {
    const { error } = await u.p;
    if (error) {
      console.warn("[QuickIdentify] 额外角度照上传失败（忽略，不影响本次识别）:", error.message);
      continue;
    }
    extraUrls.push(supabaseAdmin.storage.from("plant-images").getPublicUrl(u.path).data.publicUrl);
  }
  const allPhotos = [photoUrl, ...extraUrls, ...priorPhotos].filter(Boolean).slice(0, 12);
  // 补回完整地名（上面为了不拖慢识别只等了 4s；此刻反查早已结束）。
  place = (await geoP) || place;

  if (quick) {
    meta = quick.meta;
    // 模型有时**什么名字都不给**（title 与 scientific_name 双空）。以前这种情况会一路走到
    // draftTitleFor 的最后一档，草稿被命名成「待鉴定植物」——用户明确不接受这个结果。
    // 手上既然有 Pl@ntNet 的学名，就用它回填：宁可写「疑似 X」，也不要一个没有信息量的名字。
    if (
      primaryFallback &&
      !(meta.title || "").toString().trim() &&
      !(meta.scientific_name || "").toString().trim()
    ) {
      console.warn(`[Phase1] 出卡模型未给出任何名称，用 Pl@ntNet 学名回填：${primaryFallback.sci}`);
      meta.title = primaryFallback.sci;
      meta.scientific_name = primaryFallback.sci;
      if (!(meta.family || "").toString().trim()) meta.family = primaryFallback.family;
      if (!(meta.genus || "").toString().trim()) meta.genus = primaryFallback.genus;
      // 模型自己都没定出名字 → 一律按疑似，交给补拍/复核去坐实。
      meta.identification_confidence = "low";
    }
    usedModel = quick.model;
    usedProvider = quick.provider;
    usage = quick.usage;
    enriched = false;
    // 一线引擎必须体现在 provider 里 —— 否则用量表永远只显示 "gemini-quick"，管理员
    // 根本无从判断专业识别到底参与了没有（这正是上线后第一时间被问到的问题）。
    // 注意：Pl@ntNet 不消耗 token，所以它只体现在 provider 名里、不会有独立的 token
    // 记录，这是正常现象，不代表它没工作。
    if (primaryEngine === "plantnet") {
      usedProvider = `plantnet+${usedProvider}`;
    } else if (secondPrimary) {
      usage = addUsage(usage, secondPrimary.usage);
      usedProvider = `vision-primary+${usedProvider}`;
      usedModel = `${secondPrimary.model}+${usedModel}`;
    }
    // 统一疑似信号：名称/正文/补拍横幅三者一致（详见 normalizeIdentification）。
    normalizeIdentification(meta);
    // 痕迹要记 normalize **之后**的档位：模型常不写 confidence 而把「疑似」写进正文，
    // normalize 会把这种情况回填成 low，复核闸门读的也是这个回填后的值。
    trace.phase1Model = usedModel;
    trace.phase1Confidence = (meta.identification_confidence || "").toString();
    trace.retakeCount = retakeCount;

    // ── 二次复核视觉模型 ──────────────────────────────────
    // 仅在 phase-1 判为「疑似」且仍有补拍名额时，才咨询第二个视觉模型：它有把握 → 整卡
    // 采纳（确认或纠正物种）→ 直接出确诊卡、跳过补拍；它同样没把握 → 维持疑似 → 照常进
    // 补拍。补拍满 3 次不再复核（那已是强制出终局结论的关卡）。未配置二次复核模型 / 请求失败 →
    // secondOpinionIdentify 返回 null → 行为与改动前完全一致。
    // primaryEngine==="vision" 时跳过：一线已经是二次复核模型看过这张图了，同一个模型再看一遍
    // 基本不会得出不同结论，白花一次调用 —— 直接照常进补拍。
    if (meta.identification_confidence === "low" && retakeCount < 3 && primaryEngine !== "vision") {
      const candidate = [meta.title, meta.scientific_name]
        .map((s) => (s || "").toString().trim())
        .filter(Boolean)
        .join(" ");
      const second = await secondOpinionIdentify(dataUrl, priorInline, place, {
        candidate,
        plantNetHint,
      });
      if (!second) {
        // **这就是用户那个疑问的真凶**：复核该跑、也确实被调用了，但 429 限流 / 30s 超时 /
        // 没配二次复核模型都会让 secondOpinionIdentify 静默返回 null，于是用量表上只有
        // plantnet+gemini-quick、用户被直接推去补拍，看不出「说好的自动复核」跑没跑。
        // 现在如实记进痕迹并渲染到简介卡上（具体是哪种失败在服务端日志 [SecondOpinion] 里）。
        console.warn(
          `[SecondOpinion] 复核未能完成（限流/超时/未配置），维持疑似 → 进补拍。primary=${primaryEngine}(${primaryLabel})`,
        );
        // 报**真实**原因，不再拿「限流/超时/未配置」三选一去猜（见 noteFailure 注释）。
        const why = takeSecondOpinionFailures();
        trace.review = {
          ran: false,
          reason: why || "复核未能完成（未拿到具体原因）",
        };
      } else {
        // 无论结论是否被采纳，这次复核的 token 都已经花掉了 —— 必须计入用量，
        // 否则被否决的复核会变成一笔查不到的隐形开销。
        usage = addUsage(usage, second.usage);
        normalizeIdentification(second.meta);
        const resolved = second.meta.identification_confidence !== "low";
        const beforeKey = speciesKey((meta.scientific_name || "").toString());
        const afterKey = speciesKey((second.meta.scientific_name || "").toString());
        const action = beforeKey && afterKey && beforeKey === afterKey ? "confirm" : "override";
        // 决策日志：线上调参用（谁给了什么、最终怎么裁定）。只进服务端日志，不入库。
        console.log(
          `[SecondOpinion] primary=${primaryEngine}(${primaryLabel}) gemini=low(${candidate || "?"}) ` +
            `review=${second.meta.identification_confidence}(${(second.meta.title || "").toString().trim()} / ${(second.meta.scientific_name || "").toString().trim()}) ` +
            `→ ${resolved ? `RESOLVED(${action})，跳过补拍` : "仍疑似 → 照常补拍"}`,
        );
        if (resolved) {
          // 透明留痕：写进 ai_payload._second_opinion（不渲染进卡片，避免污染 150–260 字
          // 导语），配合 ai_usage_logs 里的 provider/model 供管理员复盘与调参。
          secondOpinion = {
            by: "second-opinion",
            model: second.model,
            action,
            from: (meta.scientific_name || "").toString().trim(),
            to: (second.meta.scientific_name || "").toString().trim(),
            plantnet: `${primaryEngine}:${primaryLabel}`,
          };
          meta = second.meta;
          usedProvider = `${usedProvider}+review-adopted`;
          usedModel = `${usedModel}+${second.model}`;
        } else {
          // 复核跑了但维持疑似 —— 同样要留痕，否则用量表上这笔开销没有出处。
          usedProvider = `${usedProvider}+review-declined`;
          usedModel = `${usedModel}+${second.model}`;
        }
        trace.review = {
          ran: true,
          model: second.model,
          confidence: (second.meta.identification_confidence || "").toString(),
          action,
          adopted: resolved,
        };
      }
    } else if (meta.identification_confidence === "low") {
      // 确实是疑似，但被闸门另外两个条件挡下了 —— 同样要说清为什么没复核，
      // 否则用户又会遇到「疑似了却没见复核」的同一个困惑。
      trace.review = {
        ran: false,
        reason:
          retakeCount >= 3
            ? "已补拍 3 次，进入终局裁定，不再复核"
            : "一线定种已由复核模型顶替，同一模型不重复复核",
      };
    }

    // 补拍满 3 次必须收口 —— 代码层硬保证，不依赖模型听话。
    // Gemini 链路本来是靠 prompt 里那段「最终裁定（硬性）」做到的，但那有两个漏洞：
    // ① 模型可以不照做；② 非 Gemini 的兜底链路（callAiIdentify）根本没有那段 prompt。
    // 补拍建议一旦非空，草稿页的补拍关卡就会继续拦人，用户会被困在补拍循环里出不来。
    if (retakeCount >= 3) {
      meta.needs_more_photos_zh = "";
      meta.needs_more_photos_en = "";
    }

    // Summary-card HTML with the full gallery of the user's own shots (newest first).
    html = buildSummaryCardHtml({
      photos: allPhotos,
      title: meta.title || "",
      sci: meta.scientific_name || "",
      summaryZh: meta.summary_zh || "",
      family: meta.family,
      genus: meta.genus,
      tentative: isTentative(meta), // 与标题、正文用同一套判据
      chips: await lookupRegistryChips(meta.scientific_name, meta.family),
      // 识别过程写进简介卡（分享卡不含 —— 分享出去只要结论，不要过程）。
      trace,
      finalConfidence: (meta.identification_confidence || "").toString(),
    });
  } else {
    // ── 两条出卡链路都失败的兜底 ────────────────────────────────────────────
    // **绝不再自动跑完整流水线（buildDraftContent）**。以前这里那么干，一次性造成三个
    // 线上问题（2026-07-21 实测同时出现）：
    //   ① 标 enriched=true → 用户根本没点「生成进一步介绍草稿」，整篇草稿却已经生成，
    //      白烧一次长文的钱，也让「银叶换草稿」这层设计形同虚设；
    //   ② 不走 buildSummaryCardHtml → 简介卡上没有识别过程 / 综合可信度；
    //   ③ 配图走 section photos，抓不到时页面上是一堆重复的用户原图。
    // 改为：用 Pl@ntNet 的专业判定兜底出一张**摘要卡**，enriched=false —— 生成正文这件事
    // 永远由用户自己按按钮决定。
    if (!primaryFallback) {
      // 连 Pl@ntNet 都没有判定 → 手上真的什么都没有。此时**宁可如实报错**，也不要造一张
      // 叫「待鉴定植物」的空卡骗用户（那正是用户明确不接受的那种结果）。
      throw new AiError(
        "IDENTIFY_FAILED",
        "识别失败（IDENTIFY_FAILED）：出卡模型序列与专业识别引擎都没能给出结果。请稍后重试；若反复出现，请在管理后台检查「出卡AI」序列与 Pl@ntNet 额度。",
      );
    }
    console.warn(
      `[Phase1] 出卡链路全部失败，用 Pl@ntNet 判定兜底出摘要卡：${primaryFallback.sci}（${primaryFallback.pct}%）`,
    );
    meta = {
      title: primaryFallback.sci,
      scientific_name: primaryFallback.sci,
      family: primaryFallback.family,
      genus: primaryFallback.genus,
      // 只有专业引擎的判定、没有模型复核过 → 一律按疑似处理，让用户走补拍把它坐实。
      identification_confidence: "low",
      summary_zh: `由专业识别引擎 Pl@ntNet 判定为 ${primaryFallback.sci}（置信度 ${primaryFallback.pct}%）。本次出卡模型未能返回结果，因此暂不做进一步描述——建议补拍关键部位以确认到种。`,
    } as AiMeta;
    normalizeIdentification(meta);
    // Pl@ntNet 不消耗 token，所以这一趟的用量是 0 —— 用量表上出现 provider=plantnet-fallback
    // 且 token 为 0 的记录，就代表「出卡模型全挂、靠专业引擎兜底出的卡」。
    usedProvider = "plantnet-fallback";
    usedModel = `plantnet(${primaryFallback.sci})`;
    usage = ZERO_USAGE;
    trace.phase1Model = "（出卡模型未返回，Pl@ntNet 兜底）";
    trace.phase1Confidence = "low";
    trace.review = { ran: false, reason: "出卡模型未返回结果，无可复核的候选" };
    html = buildSummaryCardHtml({
      photos: allPhotos,
      title: meta.title || "",
      sci: meta.scientific_name || "",
      summaryZh: meta.summary_zh || "",
      family: meta.family,
      genus: meta.genus,
      tentative: true,
      chips: await lookupRegistryChips(meta.scientific_name, meta.family),
      trace,
      finalConfidence: "low",
    });
    enriched = false;
  }

  const safeTitle = draftTitleFor(meta);
  const aiPayload = JSON.parse(
    JSON.stringify({
      ...meta,
      _enriched: enriched,
      ...(secondOpinion ? { _second_opinion: secondOpinion } : {}),
      // 全链路痕迹：简介卡渲染它，管理员复盘也读它（复核到底跑没跑、为什么没跑）。
      _identify_trace: trace,
      // 照片指纹：下次同一张图再传上来，识别前就能提示「这张已经识别过」。
      ...(data.photo_sha256 ? { _photo_sha256: data.photo_sha256 } : {}),
    }),
  );

  let draftId: string;
  if (data.merge_draft_id) {
    // ── 补拍合并：更新既有草稿，不新建。照片追加进 user_photos（新图在首、作封面）、
    //    覆盖摘要卡、刷新置信度与补拍建议。合并后 submitted_for_review 保持不变
    //    （用户之前提交过就还在队列/地图上；没提交就仍是私有草稿）。 ──
    const { error: mergeErr } = await (supabaseAdmin as any)
      .from("plant_drafts")
      .update({
        photo_url: photoUrl, // cover = the resolving shot
        capture_lat: lat,
        capture_lng: lng,
        capture_place: place,
        ai_model: usedModel,
        ai_payload: aiPayload,
        title: safeTitle,
        scientific_name: meta.scientific_name || null,
        common_name_en: meta.common_name_en || null,
        common_names_zh: meta.common_names_zh || null,
        family: meta.family || null,
        genus: meta.genus || null,
        summary: (meta.summary_zh || meta.summary_en || "").toString().slice(0, 600),
        tags: meta.tags ?? [],
        iucn_status: meta.iucn_status || null,
        html_content: html,
      })
      .eq("id", data.merge_draft_id)
      .neq("status", "approved"); // never rewrite an already-published draft
    if (mergeErr)
      throw new AiError(
        "DRAFT_UPDATE_FAILED",
        `合并补拍失败（DRAFT_UPDATE_FAILED）：识别已完成，但更新草稿时出错。原因：${mergeErr.message}。`,
      );
    draftId = data.merge_draft_id;
    // Best-effort: persist retake_count + the accumulated photo gallery (graceful if
    // the migration hasn't been applied — these two updates just no-op then).
    try {
      await (supabaseAdmin as any)
        .from("plant_drafts")
        .update({ retake_count: retakeCount })
        .eq("id", draftId);
    } catch (e) {
      console.warn("[QuickIdentify] retake_count update failed (migration pending?):", e);
    }
    try {
      await (supabaseAdmin as any)
        .from("plant_drafts")
        .update({ user_photos: allPhotos })
        .eq("id", draftId);
    } catch (e) {
      console.warn("[QuickIdentify] user_photos update failed (migration pending?):", e);
    }
  } else {
    onPhase("正在写入云端…", 90);
    const { data: row, error: insErr } = await supabaseAdmin
      .from("plant_drafts")
      .insert({
        created_by: dbCreatedBy,
        creator_label: creatorLabel,
        photo_url: photoUrl,
        capture_lat: lat,
        capture_lng: lng,
        capture_place: place,
        ai_model: usedModel,
        ai_payload: aiPayload,
        title: safeTitle,
        scientific_name: meta.scientific_name || null,
        common_name_en: meta.common_name_en || null,
        common_names_zh: meta.common_names_zh || null,
        family: meta.family || null,
        genus: meta.genus || null,
        summary: (meta.summary_zh || meta.summary_en || "").toString().slice(0, 600),
        tags: meta.tags ?? [],
        iucn_status: meta.iucn_status || null,
        html_content: html,
      })
      .select("id")
      .single();
    if (insErr)
      throw new AiError(
        "DRAFT_INSERT_FAILED",
        `保存草稿失败（DRAFT_INSERT_FAILED）：识别已完成，但写入数据库时出错。原因：${insErr.message}。`,
      );
    draftId = row.id as string;

    // Store retake_count + the initial user_photos in SEPARATE best-effort updates so
    // the INSERT stays safe if this deploy landed before the migration (an unknown
    // column would 400 the insert and break identification).
    if (retakeCount > 0) {
      try {
        await (supabaseAdmin as any)
          .from("plant_drafts")
          .update({ retake_count: retakeCount })
          .eq("id", draftId);
      } catch (e) {
        console.warn("[QuickIdentify] retake_count update failed (migration pending?):", e);
      }
    }
    try {
      await (supabaseAdmin as any)
        .from("plant_drafts")
        .update({ user_photos: allPhotos })
        .eq("id", draftId);
    } catch (e) {
      console.warn("[QuickIdentify] user_photos update failed (migration pending?):", e);
    }
  }

  try {
    await (supabaseAdmin as any).from("ai_usage_logs").insert({
      user_id: dbCreatedBy,
      user_label: creatorLabel,
      provider: usedProvider,
      model: usedModel,
      prompt_tokens: usage.prompt_tokens,
      completion_tokens: usage.completion_tokens,
      total_tokens: usage.total_tokens,
      capture_place: place || null,
      capture_lat: lat,
      capture_lng: lng,
      draft_id: draftId,
      draft_title: safeTitle,
      task_type: "quick_identify", // Quick summary card generation
    });
  } catch (e) {
    console.warn("[QuickIdentify] usage log failed:", e);
  }

  if (enriched && (gbifTaxonKey != null || isInvasive)) {
    try {
      await (supabaseAdmin as any)
        .from("plant_drafts")
        .update({ is_invasive: isInvasive, gbif_taxon_key: gbifTaxonKey })
        .eq("id", draftId);
    } catch (e) {
      console.warn("[QuickIdentify] invasive flag update failed:", e);
    }
  }

  return {
    draftId,
    enriched,
    place,
    identification_confidence: (meta.identification_confidence as string) ?? null,
    needs_more_photos_zh: (meta.needs_more_photos_zh as string) ?? "",
    title: safeTitle,
  };
}

// ── Submit a draft into the review queue ──────────────────────────────────────
// A freshly-identified draft is PRIVATE (submitted_for_review=false): it doesn't
// appear in the AI review queue or on the 身边物种地图 while the user is still
// refining it (retaking, enriching). Tapping「保存为待审批草稿」flips this flag,
// which is the moment the species资料 becomes public. Graceful if the migration
// hasn't been applied (column missing → the update silently no-ops).
const SubmitReviewInput = z.object({ draft_id: z.string().uuid() });

export const submitDraftForReviewFn = createServerFn({ method: "POST" })
  .inputValidator((input) => SubmitReviewInput.parse(input))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    try {
      const { error } = await (supabaseAdmin as any)
        .from("plant_drafts")
        .update({ submitted_for_review: true })
        .eq("id", data.draft_id);
      if (error) throw error;
      return { ok: true };
    } catch (e) {
      // Column missing (migration pending) → treat as success: without the column
      // everything is already visible, so the button's intent is satisfied.
      console.warn("[submitDraftForReview] update failed (migration pending?):", e);
      return { ok: true, degraded: true };
    }
  });

// ── Phase 2: enrich a lite draft into the full multi-image draft ──────────────
// Loads the lite draft, re-fetches its stored photo, runs the heavy pipeline and
// UPDATEs the row in place. Idempotent-ish: refuses to re-run once enriched, and
// won't touch an already-approved (收录) entry.
const EnrichInput = z.object({ draft_id: z.string().uuid() });

/** enrichDraft 的返回值形状（后台任务完成后原样存进 job.result）。 */
export type EnrichResult = {
  draftId: string;
  alreadyEnriched?: boolean;
  isInvasive?: boolean;
  silverCharged?: boolean;
  silverRemaining?: number | null;
};

/**
 * 「进一步生成草稿」的**快速前置校验**：草稿在不在、是否已收录、有没有原图、银叶够不够。
 * 全是几十毫秒的库查询，所以放在前台请求里同步做 —— 用户点下去立刻知道能不能干，
 * 而不是等一个后台任务两秒后失败。真正的重活在 runEnrichCore 里。
 */
async function enrichPreflight(draftId: string, userId: string, email: string | null) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  const { data: draftRow, error: loadErr } = await supabaseAdmin
    .from("plant_drafts")
    .select(
      "id, photo_url, capture_lat, capture_lng, capture_place, ai_payload, status, title, scientific_name, common_name_en, common_names_zh, family, genus",
    )
    .eq("id", draftId)
    .maybeSingle();
  const draft = draftRow as any;
  if (loadErr || !draft)
    throw new AiError(
      "DRAFT_NOT_FOUND",
      "生成失败（DRAFT_NOT_FOUND）：找不到这份草稿，可能已被删除。",
    );
  if (draft.status === "approved")
    throw new AiError(
      "DRAFT_ALREADY_APPROVED",
      "生成失败（DRAFT_ALREADY_APPROVED）：这份草稿已通过审核并收录，不能再重新生成内容。",
    );
  if (draft.ai_payload?._enriched)
    return { alreadyEnriched: true as const, draft, leaves: null, silverExempt: false };

  // 进一步草稿消耗 1 枚银叶（owner 无限）。先校验余额；真正扣叶放在生成成功之后，
  // 避免生成失败仍扣叶。银叶来自贡献积分，因此该步骤要求登录。
  // 已通过申请的编辑（editor/admin 角色）免银叶——他们是审稿人，生成属工作职责。
  const leaves = await serverLeafBalance(userId, email);
  const { data: roleRows } = await supabaseAdmin
    .from("user_roles")
    .select("role")
    .eq("user_id", userId);
  const isEditorUser = (roleRows ?? []).some(
    (r: { role: string }) => r.role === "editor" || r.role === "admin",
  );
  const silverExempt = leaves.isOwner || isEditorUser;
  if (!silverExempt && leaves.silverAvailable < 1) {
    throw new AiError(
      "SILVER_INSUFFICIENT",
      `生成失败（SILVER_INSUFFICIENT）：生成进一步草稿需消耗 1 枚银叶，你当前可用银叶为 0（已获得 ${leaves.silver} 枚，已用 ${leaves.silverUsed} 枚）。每 10 枚铜叶兑 1 枚银叶——多识别、多修文换图即可累积。（通过申请成为编辑后，此操作免银叶。）`,
    );
  }

  if (!draft.photo_url)
    throw new AiError(
      "DRAFT_NO_PHOTO",
      "生成失败（DRAFT_NO_PHOTO）：这份草稿没有原图，无法重新送 AI 生成。请重新拍照识别。",
    );

  return { alreadyEnriched: false as const, draft, leaves, silverExempt };
}

type EnrichPreflight = Awaited<ReturnType<typeof enrichPreflight>>;

/**
 * 「进一步生成草稿」的重活：取原图 → 联网调研 → 长文生成 → 写回 → 记账 → 扣叶。
 * 几十秒到几分钟，**必须在后台跑**（见 lib/background-jobs.ts 顶部注释）。
 * `onPhase` 把阶段文案写进任务行，前端轮询时显示「正在联网调研…」这类提示。
 */
async function runEnrichCore(
  pre: Extract<EnrichPreflight, { alreadyEnriched: false }>,
  userId: string,
  email: string | null,
  onPhase: (phase: string, progress: number) => void,
): Promise<EnrichResult> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { draft, leaves, silverExempt } = pre;

  // Re-fetch the stored user photo → data URL for the multimodal call.
  onPhase("正在读取原图…", 5);
  const photoUrl = draft.photo_url as string;
  const r = await fetch(photoUrl);
  if (!r.ok)
    throw new AiError(
      "PHOTO_FETCH_FAILED",
      `生成失败（PHOTO_FETCH_FAILED）：无法从云端存储读取这张原图（HTTP ${r.status}）。可能是图片已被删除或存储服务暂时不可用，请稍后重试。`,
    );
  const ct = r.headers.get("content-type") || "image/jpeg";
  const ab = await r.arrayBuffer();
  const dataUrl = `data:${ct};base64,${Buffer.from(ab).toString("base64")}`;

  const place = (draft.capture_place as string) || "";
  const lat = (draft.capture_lat as number | null) ?? null;
  const lng = (draft.capture_lng as number | null) ?? null;

  // 【联网调研 step】在生成完整草稿前，先联网查询该物种的最新研究成果、保护状态、
  // 分布更新等权威信息，提升内容的准确性和时效性（仅 Gemini 可用，其他 provider 跳过）。
  let webResearch: { digest: string; sources: { title: string; uri: string }[] } | null = null;
  const speciesName = draft.title || draft.scientific_name || "";
  if (speciesName) {
    onPhase("正在联网调研该物种的权威资料…", 20);
    const query = `${speciesName}（${draft.scientific_name || ""}）植物的最新研究进展、保护状态、分布范围、生态作用、栽培技术的权威资料（优先中国植物志、GBIF、IUCN、学术期刊）`;
    webResearch = await xiaopGroundedSearch(query, null);
    if (webResearch) {
      console.log(
        `[EnrichDraft] Web research for "${speciesName}": ${webResearch.sources.length} sources, ${webResearch.digest.length} chars`,
      );
    }
  }

  // Pin the phase-1 species so the enriched draft can't be renamed to a different
  // plant than the summary card the user already saw.
  onPhase("正在撰写完整草稿正文（中英双语，含配图）…", 45);
  const { meta, usedModel, usedProvider, usage, html, isInvasive, gbifTaxonKey } =
    await buildDraftContent({
      dataUrl,
      photoUrl,
      place,
      lat,
      lng,
      speciesHint: {
        title: draft.title || undefined,
        scientificName: draft.scientific_name || undefined,
      },
      webResearch: webResearch || undefined, // 传递联网调研结果给内容生成函数
      queueKind: "enrich", // 「进一步生成草稿」走它自己的模型序列
      // 用户实拍进配图候选池（补拍累积的额外角度照往往正是外部图缺的那个器官特写）。
      userPhotos: (draft as { user_photos?: unknown }).user_photos,
      photographer: (draft as { creator_label?: string | null }).creator_label ?? null,
    });

  // Identity is LOCKED to phase-1 (with meta as fallback for anything phase-1 left
  // blank). Guarantees card ↔ draft name consistency even if the model drifts.
  const lockTitle = (draft.title || meta.title || meta.scientific_name || "待鉴定植物")
    .toString()
    .slice(0, 200);
  const lockSci = draft.scientific_name || meta.scientific_name || null;
  const lockFamily = draft.family || meta.family || null;
  const lockGenus = draft.genus || meta.genus || null;
  const lockEn = draft.common_name_en || meta.common_name_en || null;
  const lockZh = draft.common_names_zh || meta.common_names_zh || null;
  const aiPayload = JSON.parse(
    JSON.stringify({
      ...(draft.ai_payload || {}),
      ...meta,
      title: lockTitle,
      scientific_name: lockSci ?? "",
      family: lockFamily ?? "",
      genus: lockGenus ?? "",
      common_name_en: lockEn ?? "",
      common_names_zh: lockZh ?? "",
      _enriched: true,
    }),
  );

  // 【质量闸门】落库、存资料包、扣叶之前先验收。不合格就抛 —— 三件事都在下面，
  // 抛出去等于「用户没拿到东西，也没被扣钱」。在此之前只要 JSON 能 parse 就照收不误。
  {
    const gate = checkDraftQuality(aiPayload);
    console.log(`[QualityGate] enrich draft ${draft.id}: ${describeIssues(gate)}`);
    if (!gate.ok) throw new AiError("DRAFT_QUALITY_FAILED", gate.summary);
  }

  onPhase("正在保存草稿…", 88);
  const { error: updErr } = await (supabaseAdmin as any)
    .from("plant_drafts")
    .update({
      ai_model: usedModel,
      ai_payload: aiPayload,
      title: lockTitle,
      scientific_name: lockSci,
      common_name_en: lockEn,
      common_names_zh: lockZh,
      family: lockFamily,
      genus: lockGenus,
      summary: (meta.summary_zh || meta.summary_en || "").toString().slice(0, 600),
      tags: meta.tags ?? [],
      iucn_status: meta.iucn_status || null,
      html_content: html,
      // 生成完整草稿 = 正式提交审核。UI 一直承诺「自动进入待审批草稿库」，但在此之前
      // 只有「保存为待审批草稿」按钮会翻这个字段，而那个按钮 enrich 后就消失了 ——
      // 于是 enrich 过的草稿永远进不了队列，用户白花 1 枚银叶还以为交了。
      // （fetchPendingDrafts 按 submitted_for_review=true 筛，见 drafts.ts。）
      submitted_for_review: true,
    })
    .eq("id", draft.id);
  if (updErr)
    throw new AiError(
      "DRAFT_UPDATE_FAILED",
      `生成失败（DRAFT_UPDATE_FAILED）：内容已生成，但写回数据库时出错。原因：${updErr.message}。`,
    );

  // 把这次的成果沉淀成**物种资料包**，下一个拍到同种植物的人就不用再等 3–10 分钟。
  // 完全非致命：内容已经生成好、也已经存进草稿了，缓存没存上不该让用户白等一场。
  // curated（人工校订过）的资料包不会被覆盖 —— 保护逻辑在 upsertDossier 里。
  // **放在写库之后**：dossier 的查询/写入也算子请求，摆在草稿写回之后，能保证「保存草稿」
  // 这步先拿到 Cloudflare 免费版那 50 个子请求的配额（fire-and-forget，失败也无害）。
  void upsertDossier({
    scientificName: lockSci || "",
    title: lockTitle,
    commonNameEn: lockEn,
    commonNamesZh: lockZh,
    family: lockFamily,
    genus: lockGenus,
    gbifTaxonKey: gbifTaxonKey ?? null,
    body: toDossierBody(aiPayload),
    research: webResearch,
    aiModel: usedModel,
    sourceDraftId: draft.id as string,
  });

  // Record the ACTUAL enriching user (this fn requires auth), not a hardcoded
  // "enrich" label — the usage table was showing 👻 enrich for everyone.
  let enricherLabel = email?.split("@")[0] || "编辑";
  try {
    const { data: prof } = await (supabaseAdmin as any)
      .from("profiles")
      .select("display_name")
      .eq("id", userId)
      .maybeSingle();
    if (prof?.display_name) enricherLabel = prof.display_name;
  } catch {
    /* fall back to email prefix */
  }
  try {
    await (supabaseAdmin as any).from("ai_usage_logs").insert({
      user_id: userId,
      user_label: `${enricherLabel}（进一步草稿）`,
      provider: usedProvider,
      model: usedModel,
      prompt_tokens: usage.prompt_tokens,
      completion_tokens: usage.completion_tokens,
      total_tokens: usage.total_tokens,
      capture_place: place || null,
      capture_lat: lat,
      capture_lng: lng,
      draft_id: draft.id,
      draft_title: lockTitle,
      task_type: "enrich_draft", // Silver leaf full draft enrichment
    });
  } catch (e) {
    console.warn("[EnrichDraft] usage log failed:", e);
  }

  if (gbifTaxonKey != null || isInvasive) {
    try {
      await (supabaseAdmin as any)
        .from("plant_drafts")
        .update({ is_invasive: isInvasive, gbif_taxon_key: gbifTaxonKey })
        .eq("id", draft.id);
    } catch (e) {
      console.warn("[EnrichDraft] invasive flag update failed:", e);
    }
  }

  // Charge the silver leaf LAST (content already exists) and only for non-owners.
  // Marks the draft so a later 驳回 can refund it exactly once. Non-fatal: if the
  // columns aren't migrated yet, enrich still succeeds (just uncharged) — logged.
  let silverCharged = false;
  if (!silverExempt) {
    try {
      const { data: spent } = await (supabaseAdmin as any)
        .from("profiles")
        .update({ silver_used: leaves.silverUsed + 1 })
        .eq("id", userId)
        .eq("silver_used", leaves.silverUsed) // optimistic-concurrency: no double spend
        .select("id");
      if (spent?.length) {
        silverCharged = true;
        await (supabaseAdmin as any)
          .from("plant_drafts")
          .update({ enrich_silver_spent: true })
          .eq("id", draft.id);
      } else {
        console.warn(
          `[EnrichDraft] silver not charged (concurrent update?) user ${userId} draft ${draft.id}`,
        );
      }
    } catch (e) {
      console.warn(
        "[EnrichDraft] silver charge skipped (migration not applied?):",
        e instanceof Error ? e.message : e,
      );
    }
  }

  return {
    draftId: draft.id as string,
    isInvasive,
    silverCharged,
    silverRemaining: silverExempt
      ? null
      : Math.max(0, leaves.silverAvailable - (silverCharged ? 1 : 0)),
  };
}

/**
 * 启动「进一步生成草稿」的后台任务。**立刻返回**（只做前置校验 + 建任务行），
 * 重活交给 keepAlive/waitUntil 在响应之后跑 —— 这就是绕开 Cloudflare 边缘 100s
 * 响应上限的整个办法。前端拿 jobId 去 pollJobFn 轮询。
 *
 * 草稿早已 enrich 过时不建任务，直接返回 `alreadyEnriched`，省掉一次无谓的轮询。
 */
export const startEnrichDraftFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => EnrichInput.parse(input))
  .handler(async ({ data, context }) => {
    const { userId } = context;
    const email = (context.claims as { email?: string } | undefined)?.email ?? null;
    const { createJob, pruneExpiredJobs } = await import("./background-jobs");
    const { keepAlive } = await import("./worker-ctx");
    const { enqueueJob } = await import("./job-queue");

    // 这里先跑一次前置校验，是为了让「叶子不够」「已经生成过」这类问题**当场**报给用户，
    // 而不是排进队列、三十秒后才在轮询里冒出来。消费者会再跑一次（见 runQueuedJob）。
    const pre = await enrichPreflight(data.draft_id, userId, email);
    if (pre.alreadyEnriched) {
      return { alreadyEnriched: true as const, jobId: null, draftId: data.draft_id };
    }

    void pruneExpiredJobs();
    const job = await createJob({
      kind: "enrich_draft",
      userId,
      draftId: data.draft_id,
      phase: "已排队，正在启动…",
      // 队列消息里只放 jobId，真实入参存这儿（见 job-queue.ts 的说明）。
      payload: { email },
    });

    // 一入队就进动态流 —— 用户点完就可以切走，小P蛙上立刻能看到这条在跑。
    // 等第一个 onPhase 才落地会留一段「点了没反应」的空窗（冷启动可达几十秒）。
    await feedStart(userId, "enrich_draft", data.draft_id, job.id);

    // 正路：交给 Queues（消费者有 15 分钟）。绑定不可用时（本地 dev / 队列没建）
    // 才退回 waitUntil —— 那条路只有约 26 秒，冷启动多半跑不完，但总比什么都不做强。
    if (!(await enqueueJob(job.id))) keepAlive(runQueuedJob(job.id));

    return { alreadyEnriched: false as const, jobId: job.id, draftId: data.draft_id };
  });

/**
 * 执行一个已建好的后台任务 —— **队列消费者和 waitUntil 退路共用的唯一入口**。
 *
 * 为什么要重跑一次 preflight（server fn 里刚跑过）：
 * 队列消息里只有 jobId，拿不到那个 `pre` 对象；而且重跑本身是好事 —— 消息可能延迟
 * 投递或重投，草稿状态、叶子余额在这期间都可能变了，用陈旧快照去扣费才是真的危险。
 *
 * **幂等**：Queues 允许重复投递（重试、至少一次语义）。任务已经不是 running 就直接
 * 返回，绝不重跑 —— 否则一次重投会让用户被扣两次叶子、库里多出一个重复页面。
 */
/**
 * 任务一入队就在动态流里立一条「排队中」。
 *
 * 顺手把草稿的标题/封面读进来 —— 卡片在**跑的过程中**就该能认出是哪一株，
 * 而不是等跑完才显示名字。
 */
async function feedStart(
  userId: string,
  kind: TaskKind,
  /** 新建识别这一路是 null —— 草稿要跑完才诞生，那时动态按 jobId 认身份。 */
  draftId: string | null,
  jobId: string,
  /** 没有草稿可读时（新建识别）由调用方直接给标题和缩略图。 */
  fallback: { title?: string | null; thumbUrl?: string | null } = {},
): Promise<void> {
  const { upsertTaskFeed } = await import("./task-feed.functions");
  let title: string | null = fallback.title ?? null;
  let thumbUrl: string | null = fallback.thumbUrl ?? null;
  if (draftId) {
    try {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const { data } = await (supabaseAdmin as any)
        .from("plant_drafts")
        .select("title, photo_url")
        .eq("id", draftId)
        .maybeSingle();
      if (data) {
        title = data.title ?? title;
        thumbUrl = data.photo_url ?? thumbUrl;
      }
    } catch {
      /* 读不到就先不显示名字，跑完 feedFinish 会补上 */
    }
  }
  await upsertTaskFeed({
    userId,
    kind,
    draftId,
    jobId,
    status: "running",
    phase: "已排队，正在启动…",
    progress: 1,
    title,
    thumbUrl,
    error: null,
    // 重跑时把上一轮的「已读」清掉：内容要变了，就该重新算作没看过。
    markUnread: true,
  });
}

/**
 * 任务跑完后，把摘要卡要显示的字段补进动态流，并重新标为未读。
 *
 * 从 `plant_drafts` 读而不是从任务的返回值里翻：enrich / gold 两条链路的 result 形状
 * 完全不同（一个是 {draftId}、一个还带 slug/html 路径），而草稿行里这三个字段的口径
 * 是统一的。多一次读换来一处逻辑，值。
 */
async function feedFinish(
  draftId: string,
  userId: string,
  kind: TaskKind,
  jobId: string,
): Promise<void> {
  const { upsertTaskFeed } = await import("./task-feed.functions");
  let title: string | null = null;
  let thumbUrl: string | null = null;
  let summary: string | null = null;
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data } = await (supabaseAdmin as any)
      .from("plant_drafts")
      .select("title, photo_url, summary_zh")
      .eq("id", draftId)
      .maybeSingle();
    if (data) {
      title = data.title ?? null;
      thumbUrl = data.photo_url ?? null;
      summary = (data.summary_zh ?? "").toString().slice(0, 200) || null;
    }
  } catch {
    // 读不到就只更状态 —— 卡片少几个字，总好过整条动态不落地。
  }
  await upsertTaskFeed({
    userId,
    kind,
    draftId,
    jobId,
    status: "done",
    phase: "已完成",
    progress: 100,
    title,
    thumbUrl,
    summary,
    markUnread: true,
  });
}

export async function runQueuedJob(jobId: string): Promise<void> {
  const { readJob, bindJobUpdates } = await import("./background-jobs");

  const job = await readJob(jobId);
  if (!job) {
    console.warn(`[job-runner] 任务 ${jobId} 不存在（可能已过期被清），跳过`);
    return;
  }
  if (job.status !== "running") {
    console.log(`[job-runner] 任务 ${jobId} 已是 ${job.status}，跳过（队列重投的幂等保护）`);
    return;
  }

  // 所有进度/心跳/收尾更新都绑定到内存里的这份 job，每次只做一次 blind upsert
  // （不再先 read 后 write）—— 这是把整趟生成的子请求数压到 Cloudflare 免费版 50 上限
  // 以下的关键一步，见 background-jobs.ts 的 bindJobUpdates 说明。
  const jobs = bindJobUpdates(job);

  const payload = (job.payload ?? {}) as { email?: string | null; userModel?: unknown };
  const email = payload.email ?? null;

  // ── 动态流镜像（小P蛙通知中心）──────────────────────────────────────────────
  // job 行是执行状态的权威（6 小时后被清），task_feed 是长期动态流 + 已读状态。
  // 两边都写是刻意的：动态流写挂了不影响任务本身（upsertTaskFeed 全程吞异常）。
  // **只在阶段推进时镜像，不跟心跳** —— 心跳 15 秒一次，跟着写会白白翻倍子请求，
  // 而进度条根本不需要那个精度。
  const { upsertTaskFeed } = await import("./task-feed.functions");
  const feedKind =
    job.kind === "quick_identify"
      ? ("identify" as const)
      : job.kind === "enrich_draft"
        ? ("enrich_draft" as const)
        : ("gold_page" as const);
  // 快速识别**新建**时草稿是跑完才写出来的，入队时 draftId 还是空串 ——
  // 这一路的动态因此按 **jobId** 认身份（upsertTaskFeed 里有专门的分支），
  // 等草稿诞生再 adoptFeedDraft 认领过去。
  // ⚠️ 曾经这里是「draftId 为空就整趟不写动态」，结果就是用户 2026-07-29 报的
  // 「识别在跑，可小P蛙下面没有绿色进度条」—— 那时整趟识别在流里一条记录都没有。
  let feedDraftId = job.draftId || null;
  /** 归属三件事（谁的、哪类、哪份草稿）由 job 决定，调用方只管传变化的部分。 */
  type FeedPatch = Omit<Parameters<typeof upsertTaskFeed>[0], "userId" | "kind" | "draftId">;
  const feed = (patch: FeedPatch) =>
    void upsertTaskFeed({ userId: job.userId, kind: feedKind, draftId: feedDraftId, ...patch });

  const onPhase = (phase: string, progress: number) => {
    // 不 await：进度写库不该拖慢生成，写失败也已在 flush 里吞掉。
    void jobs.phase(phase, progress);
    feed({ jobId, status: "running", phase, progress });
  };

  // 心跳独立于阶段推进：撰稿是一整个 await，慢模型能跑五分钟以上，
  // 光靠阶段更新推 updatedAt 会让前端把还在干活的任务判成「已中断」。
  const stopHeartbeat = jobs.startHeartbeat();
  try {
    let result: unknown;
    if (job.kind === "quick_identify") {
      // 照片在入队前就传上云了，payload 里只有地址。把字节取回来重建 base64 ——
      // runQuickIdentifyCore 的入参形状与同步路径**完全一致**，一行逻辑都不用分叉。
      const qp = (job.payload ?? {}) as {
        identify?: QuickIdentifyData;
        photoUrl?: string;
        extraUrls?: string[];
      };
      if (!qp.identify || !qp.photoUrl) throw new Error("识别任务的入参已丢失，请重新识别。");
      const r = await fetch(qp.photoUrl);
      if (!r.ok) throw new Error(`取回照片失败（HTTP ${r.status}），请重新识别。`);
      const b64 = Buffer.from(await r.arrayBuffer()).toString("base64");
      const ident = await runQuickIdentifyCore({ ...qp.identify, photo_base64: b64 }, onPhase, {
        photoUrl: qp.photoUrl,
        extraUrls: qp.extraUrls ?? [],
      });
      // 草稿这时才存在 —— 补上 id，下面 feedFinish 才知道这条动态挂在哪份草稿上。
      // 同时把之前按 jobId 建的那条占位动态认领过去，否则它会变成一条永远 running 的孤儿。
      feedDraftId = ident.draftId;
      if (feedDraftId) {
        const { adoptFeedDraft } = await import("./task-feed.functions");
        await adoptFeedDraft(job.userId, feedKind, jobId, feedDraftId);
      }
      result = ident;
    } else if (job.kind === "enrich_draft") {
      const pre = await enrichPreflight(job.draftId, job.userId, email);
      result = pre.alreadyEnriched
        ? { alreadyEnriched: true as const, draftId: job.draftId }
        : await runEnrichCore(pre, job.userId, email, onPhase);
    } else {
      const pre = await goldPreflight(job.draftId, job.userId, email);
      // 用户自带模型配置来自客户端，重放前**必须重新校验** —— 它在库里存了一段时间，
      // 不能当成已经过 inputValidator 的可信数据直接喂给调用层。
      const userModel = UserModelInput.parse(payload.userModel ?? undefined);
      result = await runGoldCore(pre, job.userId, email, userModel, onPhase);
    }
    stopHeartbeat();
    await jobs.finish(result);
    // 完成时补齐摘要卡要显示的字段，并**重新标为未读** —— 内容刚变，就该重新算作没看过。
    // 读草稿本体（而不是从 result 里翻）：三条链路的返回形状各不相同，从库里读一次最稳。
    if (feedDraftId) await feedFinish(feedDraftId, job.userId, feedKind, jobId);
  } catch (e) {
    stopHeartbeat();
    const msg =
      e instanceof Error && e.message ? e.message : "生成失败（UNKNOWN）：发生了未知错误，请重试。";
    console.error(`[job-runner] 任务 ${jobId}（${job.kind}）失败：`, e);
    await jobs.fail(msg);
    feed({
      jobId,
      status: "error",
      phase: "已失败",
      error: msg.slice(0, 500),
      markUnread: true,
    });
  } finally {
    // 上面两条路都已经停过表；这里兜住「stopHeartbeat 之前就抛了」的漏网情况。
    stopHeartbeat();
  }
}

/**
 * 轮询任务进度。前端每几秒打一次；只读自己的任务。
 * `stale` = 还挂在 running 但很久没更新过阶段（isolate 被回收之类），前端据此
 * 停止无休止的轮询并提示重试，而不是转圈到天荒地老。
 */
export const pollJobFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ jobId: z.string().min(1).max(80) }).parse(input))
  .handler(async ({ data, context }) => {
    const { userId } = context;
    const { readJob, isJobStale } = await import("./background-jobs");
    const rec = await readJob(data.jobId, userId);
    if (!rec) return { found: false as const };
    return {
      found: true as const,
      status: rec.status,
      phase: rec.phase,
      progress: rec.progress,
      kind: rec.kind,
      draftId: rec.draftId || null,
      result: rec.result ?? null,
      error: rec.error ?? null,
      stale: isJobStale(rec),
    };
  });

// ── GBIF China occurrence overlay (design C: server-side proxy, no storage) ───
// The /explore "只显示外来入侵物种分布" view lazy-loads broader China distribution
// points for the invasive species on the map. Runs server-side so the request to
// GBIF isn't reset by the GFW; results are cached only in the client's query
// cache (no permanent storage). Coarse (>1km uncertainty) points are dropped and
// results are thinned to a ~110m grid + capped per species to keep the payload
// and marker count sane.
const GbifOccInput = z.object({
  taxonKeys: z.array(z.number().int().positive()).max(20),
});

// ── 金叶：一键创建物种详细科普页 ───────────────────────────────────────────────
// ccplants-v19 skill 的服务端移植（见 premium-page.ts 顶部注释）。三段式 LLM 生成
// （避免单次输出超长被截断），事实全部来自服务端实查的名录数据。

/** Server-side leaf balance. NEVER trust a client-supplied count. Mirrors the
 *  read-time model in lib/leaves.ts, with the service-role client. The site
 *  owner (arainjazz@gmail.com) has UNLIMITED gold + silver spends — silverAvailable
 *  / goldAvailable come back as Infinity, so every gate passes for them. */
async function serverLeafBalance(
  userId: string,
  email?: string | null,
): Promise<{
  isOwner: boolean;
  bronze: number;
  silver: number;
  silverUsed: number;
  silverAvailable: number;
  gold: number;
  goldUsed: number;
  goldAvailable: number;
}> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { isOwnerEmail } = await import("./leaves");
  const isOwner = isOwnerEmail(email);
  const countRows = async (q: any): Promise<number> => {
    const { count, error } = await q;
    return error ? 0 : (count ?? 0);
  };
  const draftCount = (adopted?: boolean) => {
    let q = (supabaseAdmin as any)
      .from("plant_drafts")
      .select("id", { count: "exact", head: true })
      .eq("created_by", userId);
    if (adopted) q = q.eq("adopted", true);
    return countRows(q);
  };
  // 识别铜叶（变量制，镜像 leaves.ts identifyBronze）：疑似恒 1；否则 1 + 补拍次数，采纳翻倍。
  // retake_count 列缺失时回退到旧计数制（草稿数 + 采纳数），部署早于迁移也不崩。
  const identifyBronze = async (): Promise<number> => {
    const { data, error } = await (supabaseAdmin as any)
      .from("plant_drafts")
      .select("retake_count, adopted, conf:ai_payload->>identification_confidence")
      .eq("created_by", userId);
    if (error || !data) {
      const [t, a] = await Promise.all([draftCount(), draftCount(true)]);
      return t + a;
    }
    let sum = 0;
    for (const row of data as Array<{
      retake_count: number | null;
      adopted: boolean | null;
      conf: string | null;
    }>) {
      if (row.conf === "low") sum += 1;
      else {
        const base = 1 + (row.retake_count ?? 0);
        sum += row.adopted ? base * 2 : base;
      }
    }
    return sum;
  };
  const editCount = (kind: "text" | "image", adopted?: boolean) => {
    let q = (supabaseAdmin as any)
      .from("plant_edits")
      .select("id", { count: "exact", head: true })
      .eq("editor_id", userId)
      .eq("kind", kind)
      .eq("reverted", false);
    if (adopted) q = q.eq("adopted", true);
    return countRows(q);
  };
  const [idBronze, txT, txA, imT, imA, prof] = await Promise.all([
    identifyBronze(),
    editCount("text"),
    editCount("text", true),
    editCount("image"),
    editCount("image", true),
    // silver_used may not exist until the migration is applied — select degrades to
    // null on error, so silverUsed falls back to 0 (no crash pre-migration).
    (supabaseAdmin as any)
      .from("profiles")
      .select("gold_used, silver_used")
      .eq("id", userId)
      .maybeSingle(),
  ]);
  const bronze = idBronze + txT + txA + imT + imA; // adopted edits count double
  const silver = Math.floor(bronze / 10);
  const gold = Math.floor(silver / 10);
  const goldUsed = (prof?.data?.gold_used as number | undefined) ?? 0;
  const silverUsed = (prof?.data?.silver_used as number | undefined) ?? 0;
  return {
    isOwner,
    bronze,
    silver,
    silverUsed,
    silverAvailable: isOwner ? Infinity : Math.max(0, silver - silverUsed),
    gold,
    goldUsed,
    goldAvailable: isOwner ? Infinity : Math.max(0, gold - goldUsed),
  };
}

/** Query the real registries and assemble the ground-truth block + clickable sources. */
async function gatherVerifiedFacts(draft: any): Promise<VerifiedFacts> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const sciFull = (draft.scientific_name || "").trim();
  const sciBinomial = sciFull.split(/\s+/).slice(0, 2).join(" ");

  let conservation: { kind: string; label: string }[] = [];
  let protectedBasis: string | null = null;
  let griisDegree: string | null = null;
  const sources: { name: string; url: string }[] = [];

  try {
    if (sciFull) {
      const listsRes = await supabaseAdmin
        .from("conservation_lists")
        .select("id,kind,name,province,version,source_note,source_url");
      const lists = (listsRes.data ?? []) as any[];
      const taxa: any[] = [];
      for (let from = 0; ; from += 1000) {
        const { data } = await supabaseAdmin
          .from("conservation_taxa")
          .select("list_id,scientific_name,chinese_name,normalized_name,status,rank,excluded_names")
          .range(from, from + 999);
        const rows = data ?? [];
        taxa.push(...rows);
        if (rows.length < 1000) break;
      }
      if (taxa.length) {
        const { buildConservationMatcher, conservationBadges, GRIIS_DEGREES } =
          await import("./conservation");
        const hit = buildConservationMatcher({ lists, taxa })(sciFull, draft.family || null);
        conservation = conservationBadges(hit, lists) ?? [];
        const protectedEntries = [...hit.protectedLists.entries()];
        if (protectedEntries.length) {
          protectedBasis = protectedEntries
            .map(([id, status]) => {
              const l = lists.find((x) => x.id === id);
              if (l?.source_url)
                sources.push({ name: l.name as string, url: l.source_url as string });
              return `${l?.name ?? "重点保护名录"}${l?.version ? `（${l.version}）` : ""}${status ? ` · ${status}` : ""}`;
            })
            .join("；");
        }
        if (hit.griis) {
          const gl = lists.find((l) => l.kind === "griis");
          griisDegree =
            GRIIS_DEGREES.find((d) => d.value === hit.griis)?.label ?? String(hit.griis);
          if (gl?.source_url)
            sources.push({ name: gl.name as string, url: gl.source_url as string });
        }
      }
    }
  } catch (e) {
    console.warn("[GoldPage] conservation lookup failed:", e);
  }

  let isInvasive = false;
  let taxonKey: number | null = null;
  try {
    if (sciBinomial) {
      const chk = await gbifCheckInvasive(sciBinomial);
      if (chk) {
        isInvasive = chk.isInvasive;
        taxonKey = chk.taxonKey;
      }
    }
  } catch (e) {
    console.warn("[GoldPage] GBIF check failed:", e);
  }
  const chinaInvasive = lookupChinaInvasive(sciFull || sciBinomial);
  if (chinaInvasive) isInvasive = true;

  // Clickable, REAL sources only — never model-authored.
  if (taxonKey)
    sources.push({
      name: "GBIF Backbone Taxonomy",
      url: `https://www.gbif.org/species/${taxonKey}`,
    });
  if (sciBinomial) {
    sources.push({
      name: "Plants of the World Online (POWO)",
      url: `https://powo.science.kew.org/results?q=${encodeURIComponent(sciBinomial)}`,
    });
    sources.push({
      name: "iNaturalist 观察记录",
      url: `https://www.inaturalist.org/search?q=${encodeURIComponent(sciBinomial)}`,
    });
    sources.push({
      name: "Wikimedia Commons 图库",
      url: `https://commons.wikimedia.org/w/index.php?search=${encodeURIComponent(sciBinomial)}`,
    });
  }

  const splitName = (s: string | null) => {
    const t = (s || "").trim();
    const m = t.match(/^([^\sA-Za-z]+)?\s*([A-Za-z].*)?$/);
    return { zh: (m?.[1] ?? t).trim(), la: (m?.[2] ?? "").trim() };
  };
  const fam = splitName(draft.family);
  const gen = splitName(draft.genus);

  return {
    title: draft.title || sciFull || "待鉴定植物",
    scientificName: sciFull,
    familyZh: fam.zh,
    familyLa: fam.la,
    genusZh: gen.zh,
    genusLa: gen.la,
    commonNamesZh: draft.common_names_zh || "",
    commonNameEn: draft.common_name_en || "",
    conservation,
    protectedBasis,
    griisDegree,
    isInvasive,
    chinaInvasive,
    iucnStatus: draft.iucn_status || null,
    capturePlace: draft.capture_place || null,
    sources,
  };
}

export type GoldPageResult = {
  plantId: string;
  slug: string;
  goldRemaining: number | null;
};

/** 金叶详页的**快速前置校验**：金叶够不够、草稿在不在、有没有学名。同步做，见 enrichPreflight。 */
async function goldPreflight(draftId: string, userId: string, email: string | null) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  // 1. Gate on a SERVER-computed leaf balance. The owner is unlimited (Infinity).
  const leaves = await serverLeafBalance(userId, email);
  if (leaves.goldAvailable < 1) {
    throw new AiError(
      "GOLD_INSUFFICIENT",
      `创建失败（GOLD_INSUFFICIENT）：你当前没有可用金叶（已获得 ${leaves.gold} 枚，已使用 ${leaves.goldUsed} 枚）。每 100 枚铜叶兑 1 枚金叶。`,
    );
  }

  // 2. Load the draft.
  const { data: draftRow, error: loadErr } = await supabaseAdmin
    .from("plant_drafts")
    .select(
      "id, title, scientific_name, common_name_en, common_names_zh, family, genus, photo_url, capture_place, iucn_status, tags, summary",
    )
    .eq("id", draftId)
    .maybeSingle();
  const draft = draftRow as any;
  if (loadErr || !draft)
    throw new AiError(
      "DRAFT_NOT_FOUND",
      "创建失败（DRAFT_NOT_FOUND）：找不到这份草稿，可能已被删除。",
    );
  if (!draft.scientific_name) {
    throw new AiError(
      "DRAFT_NO_SPECIES",
      "创建失败（DRAFT_NO_SPECIES）：这份草稿还没有确定的学名，无法生成详细科普页。请先确认物种。",
    );
  }

  return { draft, leaves };
}

/**
 * 金叶详页的重活：名录取证 → 配图检索 → **3 次联网调研** → **3 段长文生成** →
 * 渲染上传 → 写库 → 记账 → 扣叶。这是全站最重的一条链路，比 enrich 还慢，
 * 必须在后台跑。以前它只是前端 `void` 掉 Promise，请求仍是同一个前台 HTTP 请求
 * ——所以才有那句「请勿关闭或刷新标签页」。现在真的可以关了。
 */
async function runGoldCore(
  pre: Awaited<ReturnType<typeof goldPreflight>>,
  userId: string,
  email: string | null,
  userModel: z.infer<typeof UserModelInput>,
  onPhase: (phase: string, progress: number) => void,
): Promise<GoldPageResult> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { draft, leaves } = pre;
  /** 正名核对留痕，落库时写进 plants，页面据此渲染别名与「待人工核对」提示。 */
  let goldNameStamp: import("./name-authority.functions").NameAuthorityStamp | null = null;

  // 3. Ground-truth facts from the real registries.
  onPhase("正在核对权威名录（保护级别、入侵名录、GBIF）…", 5);
  const facts = await gatherVerifiedFacts(draft);

  // 【正名核对】金叶详页会**直接落进公开档案 plants**，是全站名字最该准的一处。
  // 在三轮撰稿之前对齐，撰稿 prompt 里的「已核实事实」区块拿到的就是正名与正确的科属；
  // 放到落库前才改，正文里那些「本种隶属 XX 科」就已经按旧名写死了。
  // 草稿在识别时已经核对过一次，这里再核一次是为了两种情况：老草稿（本机制上线前建的）、
  // 以及用户在草稿页手工改过名字。
  {
    const { applyNameAuthority } = await import("./name-authority.functions");
    const named = {
      title: facts.title,
      scientific_name: facts.scientificName,
      family: draft.family,
      genus: draft.genus,
      common_names_zh: draft.common_names_zh,
    };
    const { stamp, changed } = await applyNameAuthority(named);
    if (changed) {
      facts.title = named.title ?? facts.title;
      facts.scientificName = named.scientific_name ?? facts.scientificName;
      draft.family = named.family ?? draft.family;
      draft.genus = named.genus ?? draft.genus;
      draft.common_names_zh = named.common_names_zh ?? draft.common_names_zh;
      if (named.family) {
        const [fz, fl] = named.family.split(" ");
        facts.familyZh = fz || facts.familyZh;
        facts.familyLa = fl || facts.familyLa;
      }
      if (named.genus) {
        const [gz, gl] = named.genus.split(" ");
        facts.genusZh = gz || facts.genusZh;
        facts.genusLa = gl || facts.genusLa;
      }
    }
    goldNameStamp = stamp;
    console.log(
      `[NameAuthority] 金叶「${facts.title}」：${stamp.status}/${stamp.matchedBy}` +
        `${changed ? " · 已按名录改写" : ""}${stamp.note ? " · " + stamp.note.slice(0, 120) : ""}`,
    );
  }

  // 管理员粘贴的创作指导（没配就是 null = 走内置底版）。三轮撰稿共用同一份，
  // 且**在这里读一次就锁定** —— 生成中途管理员换了 skill，也不会让同一个页面
  // 前三节按 v19 写、后两节按 v20 写，页尾署名也才对得上正文。
  const goldSkill = activeGoldSkill(await loadGoldSkill());
  if (goldSkill) {
    console.log(
      `[GoldPage] using skill "${skillSignature(goldSkill) || "(未命名)"}" (${goldSkill.content.length} chars)`,
    );
  }

  // 4. Fill the 9 body image slots (hero stays the user's own photo).
  //    fetchSpeciesPhotos already diversifies by place/season/photographer;
  //    rehostImages compresses (1280px webp) before storing in Supabase.
  onPhase("正在检索并转存配图…", 12);
  let photos: (PhotoCandidate | null)[] = [];
  let photoMissing: string[] = GOLD_SLOTS.map((s) => s.missingNote);
  /** 降级配图的如实说明，与 photos 同下标对齐。 */
  let photoNotes: string[] = GOLD_SLOTS.map(() => "");
  try {
    const term =
      facts.scientificName.split(/\s+/).slice(0, 2).join(" ") || facts.commonNameEn || facts.title;
    // 9 个槽要覆盖 根株/茎/叶/花/果/物候/生境/标本/人文，候选必须给够挑选余地。
    // specimenFloor: 2 —— 金叶的「人文·科学绘图」槽 want 是单元素 ["specimen"]，零降级余地。
    // 不给独立配额，常见种前三级就把 14 张填满，标本/图版级永远不跑，那个槽结构性必空。
    // 多出的 1–2 个子请求在 Workers Paid（上限 1000）下可以忽略。
    const external = await fetchSpeciesPhotos(term, 14, { specimenFloor: 2 });
    // 同银叶：用户实拍排最前，但一样要过器官识别才进得了槽。
    const mine = userPhotoCandidates({
      photoUrl: draft.photo_url,
      userPhotos: (draft as { user_photos?: unknown }).user_photos,
      who: (draft as { creator_label?: string | null }).creator_label,
      place: (draft as { capture_place?: string | null }).capture_place,
    });
    const labelled = await classifyPhotoOrgans([...mine, ...external], term);
    const assigned = assignSlots(labelled, GOLD_SLOTS);
    console.log(
      `[PhotoSlots] 金叶「${term}」：${describeAssignment(assigned)}` +
        `（候选 ${mine.length} 张用户实拍 + ${external.length} 张公开图）`,
    );
    const chosen = assigned.map((a) => a.photo).filter(Boolean) as PhotoCandidate[];
    const finalPhotos = await rehostImagesAligned(chosen, `plants/gold/${draft.id}`);
    let k = 0;
    photos = assigned.map((a) => (a.photo ? (finalPhotos[k++] ?? null) : null));
    photoMissing = assigned.map((a) => (a.photo ? "" : a.spec.missingNote));
    photoNotes = assigned.map((a) => (a.photo ? a.mismatchNote : ""));
  } catch (e) {
    console.warn("[GoldPage] image fetch failed; slots will render as .broken:", e);
  }

  // Resolve model override (needed for web research calls below)
  const overrideSequence = toOverrideSlots(userModel);

  // 【联网调研 step】金叶页面生成前，先联网查询该物种的最新研究、文献、保护动态，
  // 分三个维度准备权威参考资料（形态生境、人文博物、生态演化），提升内容深度。
  let webResearch1: {
    digest: string;
    sources: { title: string; uri: string }[];
    usage: AiTokenUsage;
  } | null = null;
  let webResearch2: {
    digest: string;
    sources: { title: string; uri: string }[];
    usage: AiTokenUsage;
  } | null = null;
  let webResearch3: {
    digest: string;
    sources: { title: string; uri: string }[];
    usage: AiTokenUsage;
  } | null = null;

  // Running token total for this whole gold-page build (3 grounding searches + 3 LLM passes).
  let goldUsage: AiTokenUsage = { ...ZERO_USAGE };

  const speciesFullName = `${facts.title}（${facts.scientificName}）`;

  onPhase("正在联网调研 1/3：形态、生境、近缘种…", 20);
  // Phase 1 调研：形态、生境、近缘种区分
  const query1 = `${speciesFullName} 的形态特征、生境分布、近缘种区分要点、栽培养护的最新权威资料（优先中国植物志、Flora of China、园艺文献）`;
  webResearch1 = await xiaopGroundedSearch(query1, overrideSequence);
  goldUsage = addUsage(goldUsage, webResearch1?.usage);
  if (webResearch1) {
    console.log(`[GoldPage Phase1] Web research: ${webResearch1.sources.length} sources`);
  }

  onPhase("正在联网调研 2/3：人文、民俗、本草…", 28);
  // Phase 2 调研：人文、民俗、文学、药用
  const query2 = `${speciesFullName} 的人文历史、民俗用途、文学记载、本草典籍、食药用价值的权威资料（优先古籍数据库、民族植物学文献）`;
  webResearch2 = await xiaopGroundedSearch(query2, overrideSequence);
  goldUsage = addUsage(goldUsage, webResearch2?.usage);
  if (webResearch2) {
    console.log(`[GoldPage Phase2] Web research: ${webResearch2.sources.length} sources`);
  }

  onPhase("正在联网调研 3/3：生态功能、保护与科研进展…", 36);
  // Phase 3 调研：生态功能、入侵状态、最新科研
  const query3 = `${speciesFullName} 的生态功能、入侵风险、保护管理、近期重要科研进展（优先 IUCN、GBIF、学术期刊）`;
  webResearch3 = await xiaopGroundedSearch(query3, overrideSequence);
  goldUsage = addUsage(goldUsage, webResearch3?.usage);
  if (webResearch3) {
    console.log(`[GoldPage Phase3] Web research: ${webResearch3.sources.length} sources`);
  }

  // 5. Three LLM passes. One mega-call reliably blows the output-token ceiling and
  //    comes back as truncated JSON, so each pass owns a bounded slice of the page.

  // Helper to inject web research into system prompt
  const withWebContext = (basePrompt: string, research: typeof webResearch1) => {
    if (!research || !research.digest) return basePrompt;
    const srcList = research.sources.length
      ? "\n参考来源：\n" +
        research.sources.map((s, i) => `[${i + 1}] ${s.title || s.uri} — ${s.uri}`).join("\n")
      : "";
    return (
      basePrompt +
      `\n\n【联网调研·权威参考资料】以下是该物种的最新权威信息，请据此确保内容准确、时效性强：\n${research.digest}${srcList}\n`
    );
  };

  let goldProvider = "gemini";
  let goldModel = process.env.AI_MODEL || "gemini-3-flash-preview";
  const ask = async (system: string, schema: unknown, label: string) => {
    const {
      text: txt,
      usage,
      provider,
      model,
    } = await xiaopTextCall({
      contents: [
        {
          role: "user",
          parts: [{ text: `请为「${facts.title}（${facts.scientificName}）」生成本轮内容。` }],
        },
      ],
      system,
      schema,
      overrideSequence,
      consoleId: "gold",
    });
    goldUsage = addUsage(goldUsage, usage);
    goldProvider = provider;
    goldModel = model;
    try {
      return JSON.parse(cleanJson(txt));
    } catch {
      throw new AiError(
        `GOLD_BAD_JSON_${label}`,
        `创建失败（GOLD_BAD_JSON_${label}）：模型返回的内容不是完整 JSON，通常是生成被截断。请重试；反复出现可在管理后台的「金叶详页模型」控制台换一个更强的模型。`,
      );
    }
  };

  // 【撰稿看得见图】把本页**实际拿到的配图清单**告诉模型，让它围绕真有的图写，
  // 并且**知道哪些器官没有图**——否则它会写「如图所示的花冠……」，而那个槽是空的。
  // 这是 CP4b 分槽的直接红利：在此之前根本不知道哪张图是什么。
  const imageManifest = (() => {
    const have = GOLD_SLOTS.map((spec, i) => ({ spec, photo: photos[i] })).filter((x) => x.photo);
    const lack = GOLD_SLOTS.filter((_, i) => !photos[i]);
    const lines: string[] = [];
    if (have.length)
      lines.push(`本页**已有**这些配图：${have.map((x) => x.spec.key).join("、")}。`);
    if (lack.length)
      lines.push(
        `本页**没有**以下部位的配图：${lack.map((x) => x.key).join("、")}。` +
          `涉及这些部位时，请正常描述形态，但**不要写「如图」「见下图」「照片中可见」**之类指图的话——` +
          `那些位置是空的，读者看不到你说的图。`,
      );
    return lines.length
      ? `\n\n【本页配图清单】\n${lines.join("\n")}\n有图的部位可以适度呼应画面，但仍以文字自足为准。`
      : "";
  })();

  onPhase("正在撰稿 1/3（正文主体）…", 45);
  const p1 = await ask(
    withWebContext(premiumPrompt1(facts, goldSkill), webResearch1) + imageManifest,
    PREMIUM_SCHEMA_1,
    "1",
  );
  onPhase("正在撰稿 2/3（人文与应用）…", 58);
  const p2 = await ask(
    withWebContext(premiumPrompt2(facts, goldSkill), webResearch2) + imageManifest,
    PREMIUM_SCHEMA_2,
    "2",
  );
  onPhase("正在撰稿 3/3（生态与延伸阅读）…", 70);
  const p3 = await ask(
    withWebContext(premiumPrompt3(facts, goldSkill), webResearch3) + imageManifest,
    PREMIUM_SCHEMA_3,
    "3",
  );
  const fields = { ...p1, ...p2, ...p3 } as PremiumFields;

  // 【质量闸门】比草稿严一档：它要收一枚金叶，且会直接落进公开档案 plants。
  // 放在渲染之前 —— 渲染/上传/入库/扣费全在下面，抛出去就什么都没发生。
  {
    const gate = checkGoldQuality(fields as unknown as Record<string, unknown>);
    console.log(`[QualityGate] gold ${draft.id}: ${describeIssues(gate)}`);
    if (!gate.ok) {
      // 被拦下时把三轮**实际返回的顶层键名**打出来。字段为空最常见的原因不是模型写不动，
      // 而是它用了自己的键名（见 schemaInstruction 的事故说明）—— 有这一行，下次一眼就能
      // 分清是「键名对不上」还是「模型真的写不出内容」，不必再靠猜。
      const keysOf = (o: unknown) =>
        o && typeof o === "object" ? Object.keys(o as object).join(",") : "(非对象)";
      console.error(
        `[QualityGate] gold ${draft.id} 各轮顶层键：p1=[${keysOf(p1)}] p2=[${keysOf(p2)}] ` +
          `p3=[${keysOf(p3)}] · 模型=${goldProvider}/${goldModel}`,
      );
      throw new AiError("GOLD_QUALITY_FAILED", gate.summary);
    }
  }

  onPhase("正在渲染并上传详页…", 82);
  // 6. Render + upload the HTML body.
  const html = renderPremiumHtml(
    fields,
    facts,
    {
      heroUrl: draft.photo_url as string,
      // 署名跟着图走：每张图注渲染「摄影：X · CC BY-NC · iNaturalist」，可点回原始页。
      images: photos.map((c, i) =>
        c
          ? {
              url: c.url,
              credit: creditLine(c),
              sourceUrl: c.sourceUrl,
              // 降级命中时如实交代画面里是什么（见 photo-slots 的 mismatchNote）。
              note: photoNotes[i] || undefined,
            }
          : // 候选池一张图都没有（2026-07-29 起极罕见）→ 如实写明。
            { url: "", missingNote: photoMissing[i] ?? "" },
      ),
    },
    goldSkill,
  );
  const htmlPath = `${userId}/gold-${draft.id}.html`;
  const { error: upErr } = await supabaseAdmin.storage
    .from("plant-html")
    .upload(htmlPath, new Blob([html], { type: "text/html" }), {
      contentType: "text/html",
      upsert: true,
    });
  if (upErr)
    throw new AiError(
      "HTML_UPLOAD_FAILED",
      `创建失败（HTML_UPLOAD_FAILED）：详页 HTML 上传失败。原因：${upErr.message}。`,
    );
  const htmlUrl = supabaseAdmin.storage.from("plant-html").getPublicUrl(htmlPath).data.publicUrl;

  onPhase("正在写入档案…", 90);
  // 7. Unique slug, then insert the plants row.
  let slug = slugify(facts.scientificName || facts.title || "");
  if (!slug || slug.startsWith("p-")) slug = `gold-${draft.id.slice(0, 8)}`;
  for (let i = 0; i < 5; i++) {
    const { data: dup } = await supabaseAdmin
      .from("plants")
      .select("id")
      .eq("slug", slug)
      .maybeSingle();
    if (!dup) break;
    slug = `${slug}-${Math.random().toString(36).slice(2, 5)}`;
  }

  const { data: plant, error: pErr } = await supabaseAdmin
    .from("plants")
    .insert({
      slug,
      title: facts.title,
      scientific_name: facts.scientificName,
      common_name_en: draft.common_name_en,
      common_names_zh: draft.common_names_zh,
      family: draft.family,
      genus: draft.genus,
      summary: (fields.intro_zh || draft.summary || "").toString().slice(0, 600),
      cover_url: draft.photo_url,
      content_type: "html",
      html_url: htmlUrl,
      tags: draft.tags ?? [],
      author_id: userId,
      iucn_status: draft.iucn_status,
      source: "gold_oneclick",
      body_text: visibleBodyText(html),
      name_authority: goldNameStamp ? JSON.parse(JSON.stringify(goldNameStamp)) : null,
    })
    .select("id")
    .single();
  if (pErr)
    throw new AiError(
      "PLANT_INSERT_FAILED",
      `创建失败（PLANT_INSERT_FAILED）：写入档案时出错。原因：${pErr.message}。`,
    );

  // Log token usage for the whole gold-page build (3 grounding + 3 LLM passes).
  // Awaited so the Workers isolate can't tear down before the row flushes; wrapped
  // so a logging failure can't lose the user their (already-created) page.
  try {
    const { data: prof } = await (supabaseAdmin as any)
      .from("profiles")
      .select("display_name")
      .eq("id", userId)
      .maybeSingle();
    const goldLabel = (prof?.display_name || email?.split("@")[0] || "用户") + "（金叶详页）";
    const { error: usageErr } = await (supabaseAdmin as any).from("ai_usage_logs").insert({
      user_id: userId,
      user_label: goldLabel,
      provider: goldProvider,
      model: goldModel,
      prompt_tokens: goldUsage.prompt_tokens,
      completion_tokens: goldUsage.completion_tokens,
      total_tokens: goldUsage.total_tokens,
      capture_place: (draft.capture_place as string) || null,
      draft_id: draft.id,
      draft_title: facts.title,
      task_type: "gold_page", // Full gold detail-page generation
    });
    if (usageErr) console.warn("[UsageLog] gold_page insert failed:", usageErr.message);
  } catch (e) {
    console.warn("[UsageLog] gold_page unexpected error:", e);
  }

  // 8. Spend the leaf — LAST, and only now that the page really exists. The owner
  //    is unlimited, so never debit their account. The `.eq("gold_used", …)` guard
  //    makes this optimistic-concurrency: two tabs racing can't spend twice.
  if (!leaves.isOwner) {
    const { data: spent, error: spendErr } = await (supabaseAdmin as any)
      .from("profiles")
      .update({ gold_used: leaves.goldUsed + 1 })
      .eq("id", userId)
      .eq("gold_used", leaves.goldUsed)
      .select("id");
    if (spendErr || !spent?.length) {
      // The page exists and is valid; only the accounting failed. Don't fail the
      // request (the user would lose the page) — log loudly for reconciliation.
      console.error(
        `[GoldPage] LEAF NOT SPENT for user ${userId}, plant ${plant.id}:`,
        spendErr?.message ?? "concurrent update",
      );
    }
  }

  return {
    plantId: plant.id as string,
    slug,
    // null = unlimited (owner). JSON can't carry Infinity, so the frontend shows ∞.
    goldRemaining: leaves.isOwner ? null : Math.max(0, leaves.goldAvailable - 1),
  };
}

/**
 * 启动「金叶详页」的后台任务，立刻返回 jobId。与 startEnrichDraftFn 同构，
 * 轮询同样走 pollJobFn。
 */
export const startGoldDetailPageFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  // `UserModelInput` is a const declared further down; reference it at REQUEST time
  // (inside the callback) rather than at module-init, where it isn't assigned yet.
  .inputValidator((input) =>
    z.object({ draft_id: z.string().uuid(), userModel: UserModelInput }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { userId } = context;
    const email = (context.claims as { email?: string } | undefined)?.email ?? null;
    const { createJob, pruneExpiredJobs } = await import("./background-jobs");
    const { keepAlive } = await import("./worker-ctx");
    const { enqueueJob } = await import("./job-queue");

    // 同 enrich：当场校验金叶余额等前置条件，失败立刻报错而不是排队后再失败。
    await goldPreflight(data.draft_id, userId, email);

    void pruneExpiredJobs();
    const job = await createJob({
      kind: "gold_page",
      userId,
      draftId: data.draft_id,
      phase: "已排队，正在启动…",
      // userModel 里可能带用户自己的 API Key —— 存 site_config（service-role 才读得到），
      // **不进队列消息**（队列消息在 CF 侧最长留存 24 小时）。
      payload: { email, userModel: data.userModel },
    });

    // 同 enrich：一入队就进动态流，用户点完立刻能切走。
    await feedStart(userId, "gold_page", data.draft_id, job.id);

    if (!(await enqueueJob(job.id))) keepAlive(runQueuedJob(job.id));

    return { jobId: job.id };
  });

export const gbifChinaOccurrencesFn = createServerFn({ method: "POST" })
  .inputValidator((input) => GbifOccInput.parse(input))
  .handler(async ({ data }) => {
    const keys = Array.from(new Set(data.taxonKeys)).slice(0, 12);
    const points: { taxonKey: number; lat: number; lng: number }[] = [];
    for (const key of keys) {
      const j = await timeoutJson(
        "https://api.gbif.org/v1/occurrence/search?" +
          new URLSearchParams({
            taxonKey: String(key),
            country: "CN",
            hasCoordinate: "true",
            hasGeospatialIssue: "false",
            limit: "300",
          }),
        12000,
      );
      const recs: any[] = j?.results ?? [];
      const seen = new Set<string>();
      let kept = 0;
      for (const r of recs) {
        const lat = r?.decimalLatitude;
        const lng = r?.decimalLongitude;
        if (typeof lat !== "number" || typeof lng !== "number") continue;
        const unc = r?.coordinateUncertaintyInMeters;
        if (typeof unc === "number" && unc > 1000) continue; // drop coarse / centroid-grade points
        const gk = `${lat.toFixed(3)},${lng.toFixed(3)}`; // ~110m grid dedup
        if (seen.has(gk)) continue;
        seen.add(gk);
        points.push({ taxonKey: key, lat, lng });
        if (++kept >= 250) break;
      }
    }
    return { points };
  });

// ─── Approve draft → publish into plants + record edit ──────────────────────
// mergeTargetId 为空 = 首次收录：先查同物种是否已有条目，有则返回 conflict（不写库）由前端弹窗；
// 传了 mergeTargetId = 编辑已在弹窗点「确认合并」：把本次拍摄记录并入该条目并加「注」。
const ApproveInput = z.object({
  draftId: z.string().uuid(),
  mergeTargetId: z.string().uuid().optional(),
});

export const approvePlantDraft = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => ApproveInput.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const dbUserId = userId;

    // Check editor or admin
    const { data: roles } = await supabase.from("user_roles").select("role").eq("user_id", userId);
    const isEditor = roles?.some((r) => r.role === "editor" || r.role === "admin") ?? false;
    if (!isEditor) throw new Error("仅审核通过的编辑可以收录草稿");

    const { data: draft, error: dErr } = await supabaseAdmin
      .from("plant_drafts")
      .select("*")
      .eq("id", data.draftId)
      .maybeSingle();
    if (dErr) throw dErr;
    if (!draft) throw new Error("草稿不存在");
    if (draft.status === "approved" && draft.published_plant_id) {
      return { plantId: draft.published_plant_id as string };
    }

    // ── 识别人显示名（访客草稿 created_by 为 null → 用 creator_label）+ 采纳编辑名 ──
    let identifierName = draft.creator_label || "访客";
    if (draft.created_by) {
      const { data: idProf } = await supabaseAdmin
        .from("profiles")
        .select("display_name")
        .eq("id", draft.created_by)
        .maybeSingle();
      if (idProf?.display_name) identifierName = idProf.display_name;
    }
    const { data: editorProf } = await supabaseAdmin
      .from("profiles")
      .select("display_name")
      .eq("id", dbUserId)
      .maybeSingle();
    const editorName = editorProf?.display_name ?? "编辑";

    const esc = (s: string) =>
      String(s)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
    const key = speciesKey(draft.scientific_name);
    const placeStr = draft.capture_place || "未知地点";
    const dateStr = String(draft.created_at || "").slice(0, 10);

    // ═══ 合并分支：编辑在弹窗点了「确认合并」→ 把本次观测并入已有条目 ═══
    if (data.mergeTargetId) {
      const { data: target } = await supabaseAdmin
        .from("plants")
        .select("id, slug, title, html_url, co_author_ids, co_author_names")
        .eq("id", data.mergeTargetId)
        .maybeSingle();
      if (!target) throw new Error("要合并的目标条目不存在");
      if (!target.html_url)
        throw new Error("目标条目非 HTML 页，暂不支持自动合并，请到该页面手动编辑添加");

      // 0) 原子「认领」草稿：pending → approved（条件更新）。认领不到（已被上一次/并发请求处理）→
      //    直接返回，杜绝重复合并把先前的卡片读-改-写冲掉（用户双击「确认合并」曾导致注1丢失）。
      const { data: claimed } = await supabaseAdmin
        .from("plant_drafts")
        .update({ status: "approved", published_plant_id: target.id })
        .eq("id", draft.id)
        .neq("status", "approved")
        .select("id");
      if (!claimed || claimed.length === 0) {
        return {
          plantId: target.id as string,
          slug: target.slug as string,
          merged: true as const,
          alreadyMerged: true as const,
        };
      }

      // 1) 建 merge 修改记录行，拿到 id 作为「注」锚点。
      const { data: maxRow } = await supabaseAdmin
        .from("plant_edits")
        .select("marker_n")
        .eq("plant_id", target.id)
        .order("marker_n", { ascending: false })
        .limit(1)
        .maybeSingle();
      const markerN = (maxRow?.marker_n ?? 0) + 1;
      const { data: editRow, error: eErr } = await supabaseAdmin
        .from("plant_edits")
        .insert({
          plant_id: target.id,
          editor_id: dbUserId,
          editor_name: editorName,
          kind: "merge",
          marker_n: markerN,
          source: "draft_merge",
          summary: `补充观测：由 ${identifierName} 于 ${placeStr}（${dateStr}）识别，经 ${editorName} 采纳并入本条目`,
        })
        .select("id")
        .single();
      if (eErr) throw new Error(`记录合并日志失败：${eErr.message}`);

      // 2) 拉目标 HTML，追加「补充观测」卡片（含指向 editRow.id 的「注 N」上标）。
      //    卡片限宽、图片限高，避免在模板内容列之外被撑满整页；带 data-draft-id 作幂等兜底。
      let targetHtml = "";
      try {
        targetHtml = await (await fetch(target.html_url)).text();
      } catch {
        /* 拉取失败则从空文档追加 */
      }
      const coord =
        draft.capture_lat != null && draft.capture_lng != null
          ? `（${Number(draft.capture_lat).toFixed(5)}, ${Number(draft.capture_lng).toFixed(5)}）`
          : "";
      const photoImg = draft.photo_url
        ? `<figure style="margin:0 0 1rem;max-width:420px"><img src="${esc(draft.photo_url)}" style="display:block;width:auto;max-width:100%;max-height:420px;height:auto;border-radius:4px" alt=""></figure>`
        : "";
      const card = `
<section class="merged-observation" data-draft-id="${draft.id}" style="max-width:680px;margin:2.5rem auto;padding:1.25rem 0;border-top:2px solid #c0392b;">
  <h3 style="font-size:1.15em;color:#c0392b;margin:0 0 .75rem;">补充观测记录<a class="lov-edit-mark" data-edit-id="${editRow.id}" data-edit-n="${markerN}" style="margin-left:6px;display:inline-block;font-size:10px;line-height:1;padding:2px 5px;background:#c0392b;color:#fff;border-radius:3px;cursor:pointer;text-decoration:none;font-weight:600;vertical-align:super;">注</a></h3>
  ${photoImg}
  <p style="margin:0;color:#333;font-size:.95em;">识别人：${esc(identifierName)} · 地点：${esc(placeStr)}${coord} · 时间：${esc(dateStr)}</p>
</section>`;
      // 幂等兜底：目标 HTML 若已含本草稿卡片则不重复追加。
      const mergedHtml = targetHtml.includes(`data-draft-id="${draft.id}"`)
        ? targetHtml
        : /<\/body>/i.test(targetHtml)
          ? targetHtml.replace(/<\/body>/i, `${card}</body>`)
          : targetHtml + card;

      // 3) 上传新 HTML，更新目标 html_url + co-author。
      const mergePath = `${dbUserId}/merge-${target.id}-${Date.now()}.html`;
      const blob = new Blob([mergedHtml], { type: "text/html" });
      const { error: upErr } = await supabaseAdmin.storage
        .from("plant-html")
        .upload(mergePath, blob, { contentType: "text/html", upsert: true });
      if (upErr) throw new Error(`合并 HTML 上传失败：${upErr.message}`);
      const newUrl = supabaseAdmin.storage.from("plant-html").getPublicUrl(mergePath)
        .data.publicUrl;
      const coIds = Array.from(
        new Set([...(target.co_author_ids ?? []), ...(draft.created_by ? [draft.created_by] : [])]),
      );
      const coNames = Array.from(new Set([...(target.co_author_names ?? []), identifierName]));
      await supabaseAdmin
        .from("plants")
        .update({ html_url: newUrl, co_author_ids: coIds, co_author_names: coNames })
        .eq("id", target.id);

      return { plantId: target.id as string, slug: target.slug as string, merged: true as const };
    }

    // ═══ 存在性检查：同物种是否已有条目 → 有则返回 conflict（不写库），由前端弹窗决定 ═══
    if (key) {
      const { data: allPlants } = await supabaseAdmin
        .from("plants")
        .select("id, slug, title, scientific_name, html_url");
      const hit = (allPlants ?? []).find((p) => speciesKey(p.scientific_name) === key);
      if (hit) {
        return {
          conflict: true as const,
          target: {
            id: hit.id,
            slug: hit.slug,
            title: hit.title,
            scientific_name: hit.scientific_name,
          },
          whatsNew: `本次为「${draft.title}」的一次新观测：${placeStr} · ${dateStr}（识别人：${identifierName}）。合并后将作为「补充观测」卡片并入已有条目「${hit.title}」，并在页尾记录溯源。`,
        };
      }
    }

    // Build slug: prefer ASCII slug of scientific name, fall back to id.
    let slug = slugify(draft.scientific_name || draft.title || "");
    if (!slug || slug.startsWith("p-")) slug = `draft-${draft.id.slice(0, 8)}`;

    // Ensure slug uniqueness
    for (let i = 0; i < 5; i++) {
      const { data: dup } = await supabaseAdmin
        .from("plants")
        .select("id")
        .eq("slug", slug)
        .maybeSingle();
      if (!dup) break;
      slug = `${slug}-${Math.random().toString(36).slice(2, 5)}`;
    }

    // Upload the HTML body to plant-html bucket.
    // 发布前顺手清掉「已经换上真图的槽位却还挂着『暂无该物种的…公开照片』」——
    // 老草稿的正文里存着这种自相矛盾的组合，收录时照抄就会带到正式条目页上去。
    const htmlPath = `${dbUserId}/draft-${draft.id}.html`;
    const publishHtml = stripStaleMissingNotes(String(draft.html_content || ""));
    const blob = new Blob([publishHtml], { type: "text/html" });
    const { error: upErr } = await supabaseAdmin.storage
      .from("plant-html")
      .upload(htmlPath, blob, { contentType: "text/html", upsert: true });
    if (upErr) throw new Error(`HTML 上传失败：${upErr.message}`);
    const htmlUrl = supabaseAdmin.storage.from("plant-html").getPublicUrl(htmlPath).data.publicUrl;

    // Insert plants row (admin = bypass RLS so we can set author_id = approver).
    const { data: plant, error: pErr } = await supabaseAdmin
      .from("plants")
      .insert({
        slug,
        title: draft.title,
        scientific_name: draft.scientific_name,
        common_name_en: draft.common_name_en,
        common_names_zh: draft.common_names_zh,
        family: draft.family,
        genus: draft.genus,
        summary: draft.summary,
        cover_url: draft.photo_url,
        content_type: "html",
        html_url: htmlUrl,
        tags: draft.tags ?? [],
        author_id: dbUserId,
        iucn_status: draft.iucn_status,
        source: "ai_identify",
        body_text: visibleBodyText(publishHtml),
      })
      .select("id")
      .single();
    if (pErr) throw new Error(`收录失败：${pErr.message}`);

    // Update draft status.
    await supabaseAdmin
      .from("plant_drafts")
      .update({ status: "approved", published_plant_id: plant.id })
      .eq("id", draft.id);

    // Editor display name
    const { data: prof } = await supabaseAdmin
      .from("profiles")
      .select("display_name")
      .eq("id", dbUserId)
      .maybeSingle();

    // Write edits log entries.
    const source = `ai:${AI_MODEL}@lovable-ai+ai_camera_capture`;
    await supabaseAdmin.from("plant_edits").insert([
      {
        plant_id: plant.id,
        editor_id: dbUserId,
        editor_name: prof?.display_name ?? "编辑",
        kind: "create",
        marker_n: 0,
        summary: `由 AI 草稿收录：${draft.title}（拍摄于 ${draft.capture_place || "未知地点"}）`,
        source,
      },
      {
        plant_id: plant.id,
        editor_id: dbUserId,
        editor_name: prof?.display_name ?? "编辑",
        kind: "draft_approve",
        marker_n: 0,
        summary: `审核通过 AI 草稿 #${draft.id.slice(0, 8)}（提交者：${draft.creator_label}）`,
        source,
      },
    ]);

    return { plantId: plant.id as string, slug };
  });

const RejectInput = z.object({ draftId: z.string().uuid() });
export const rejectPlantDraft = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => RejectInput.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: roles } = await supabase.from("user_roles").select("role").eq("user_id", userId);
    const isEditor = roles?.some((r) => r.role === "editor" || r.role === "admin") ?? false;
    if (!isEditor) throw new Error("仅审核通过的编辑可以驳回草稿");
    await supabaseAdmin.from("plant_drafts").update({ status: "rejected" }).eq("id", data.draftId);
    // Log the rejection so the owner's edit log shows it (with a revert path).
    const { data: d } = await supabaseAdmin
      .from("plant_drafts")
      .select("title, enrich_silver_spent, created_by")
      .eq("id", data.draftId)
      .maybeSingle();

    // Refund the silver leaf if this draft's「进一步草稿」was charged one. Rationale:
    // a rejected draft (图文与实拍不符) shouldn't cost the contributor — and refusing
    // to charge for rejected work discourages submitting mismatched drafts for review.
    // Guarded to refund AT MOST once (flip the flag atomically first). Non-fatal.
    const draftMeta = d as {
      title?: string;
      enrich_silver_spent?: boolean;
      created_by?: string | null;
    } | null;
    if (draftMeta?.enrich_silver_spent && draftMeta.created_by) {
      try {
        const { data: cleared } = await (supabaseAdmin as any)
          .from("plant_drafts")
          .update({ enrich_silver_spent: false })
          .eq("id", data.draftId)
          .eq("enrich_silver_spent", true) // only the winner of this flip refunds
          .select("id");
        if (cleared?.length) {
          const { data: p } = await (supabaseAdmin as any)
            .from("profiles")
            .select("silver_used")
            .eq("id", draftMeta.created_by)
            .maybeSingle();
          const cur = (p?.silver_used as number | undefined) ?? 0;
          await (supabaseAdmin as any)
            .from("profiles")
            .update({ silver_used: Math.max(0, cur - 1) })
            .eq("id", draftMeta.created_by);
          console.log(
            `[RejectDraft] refunded 1 silver leaf to ${draftMeta.created_by} for draft ${data.draftId}`,
          );
        }
      } catch (e) {
        console.warn(
          "[RejectDraft] silver refund skipped (migration not applied?):",
          e instanceof Error ? e.message : e,
        );
      }
    }
    const { data: prof } = await supabaseAdmin
      .from("profiles")
      .select("display_name")
      .eq("id", userId)
      .maybeSingle();
    await supabaseAdmin.from("plant_edits").insert({
      plant_id: null,
      editor_id: userId,
      editor_name: prof?.display_name ?? "编辑",
      kind: "draft_reject",
      marker_n: 0,
      block_path: data.draftId, // target id for revert (re-pending)
      source: "draft_review",
      summary: `驳回 AI 草稿：${d?.title ?? data.draftId.slice(0, 8)}`,
    });
    return { ok: true };
  });

// ─── Replace a draft's photo: persist edited html_content (anon-capable) ─────
// Used by the "click default image → take photo / online search" flow on the
// draft detail page. Open to anyone (incl. anonymous identifiers) per product
// decision; abuse is bounded because drafts stay `pending` until an editor
// reviews and approves them. Uses the admin client to bypass RLS for anon.
const SaveDraftHtmlInput = z.object({
  draftId: z.string().uuid(),
  html: z.string().min(200).max(2_000_000),
});

export const saveDraftHtmlContentFn = createServerFn({ method: "POST" })
  .inputValidator((input) => SaveDraftHtmlInput.parse(input))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    // Basic sanity: must still look like a full HTML document.
    if (!/<\/html>/i.test(data.html)) throw new Error("HTML 内容不合法");
    const { data: draft, error: dErr } = await supabaseAdmin
      .from("plant_drafts")
      .select("id,status")
      .eq("id", data.draftId)
      .maybeSingle();
    if (dErr) throw dErr;
    if (!draft) throw new Error("草稿不存在");
    if (draft.status === "approved") throw new Error("已收录的草稿不可再修改");
    const { error: upErr } = await supabaseAdmin
      .from("plant_drafts")
      .update({ html_content: data.html })
      .eq("id", data.draftId);
    if (upErr) throw new Error(`保存失败：${upErr.message}`);
    return { ok: true };
  });

// ─── 小P 草稿审稿助手 (default Gemini) ───────────────────────────────────────
// A lightweight editorial agent the reviewer can chat with about a pending
// draft. It answers questions / gives revision advice, and when the editor's
// message is an actionable change it flags it so the UI can offer one-click
// apply; applying then asks the model to rewrite the full HTML in place.

/** Read 小P's own model config from site_config (key `xiaop_model_config`).
 *  Independent of the identify-pipeline config; null → fall back to env Gemini. */
async function loadXiaoPConfig(): Promise<AiProviderConfig | null> {
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data } = await (supabaseAdmin as any)
      .from("site_config")
      .select("value")
      .eq("key", "xiaop_model_config")
      .maybeSingle();
    const raw = (data as { value?: unknown } | null)?.value;
    if (!raw) return null;
    const q = readModelQueue(typeof raw === "string" ? JSON.parse(raw) : raw);
    const first = q.sequence[0];
    if (!first) return null;
    return {
      provider: first.provider,
      apiKey: first.apiKey,
      model: first.model,
      baseUrl: first.baseUrl,
    };
  } catch (e) {
    console.warn("[小P Config] load failed:", e);
    return null;
  }
}

type ChatContents = { role: "user" | "model"; parts: { text: string }[] }[];
type InlineImage = { mimeType: string; base64: string };

/** Find the index of the last `user` turn (where images should be attached). */
function lastUserIndex(contents: ChatContents): number {
  for (let i = contents.length - 1; i >= 0; i--) if (contents[i].role === "user") return i;
  return contents.length - 1;
}

/** Download an image URL and return it as inline base64 (so the model can SEE it).
 *  Returns null on any failure or if it's too large (caller proceeds text-only). */
/**
 * 对外抓图/抓页时统一署名的 User-Agent。
 *
 * Wikimedia / Commons 等站点的 API 礼仪要求请求带可识别的 UA，**裸请求会被 403**。
 * 收成一个常量是为了别再出现「有的地方带、有的地方不带」——那种不一致的代价不是
 * 少一张图，而是整条配图链路悄无声息地空掉。
 */
const PLANTSPEDIA_UA = "Plantspedia/1.0 (+https://plantspedia.club)";

async function fetchInlineImage(url: string): Promise<InlineImage | null> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15_000);
    // ⚠️ **必须带 User-Agent**。这曾是全文件唯一一个裸 fetch 的图片请求，而
    // Wikimedia / Commons 对没有 UA 的请求直接回 403（它们的 API 礼仪明文要求署名 UA）。
    // 后果不是「少一张图」而是「整份草稿零配图」—— 见下面 fetchInlineImagesIndexed 的注释。
    // 同文件的 timeoutFetch 与转存下载早就带了 UA，这里是漏网的一处。
    const r = await fetch(url, {
      signal: controller.signal,
      headers: { "User-Agent": PLANTSPEDIA_UA },
    });
    clearTimeout(timer);
    if (!r.ok) return null;
    const ct = (r.headers.get("content-type") || "image/jpeg").split(";")[0];
    if (!ct.startsWith("image/")) return null;
    const buf = Buffer.from(await r.arrayBuffer());
    if (buf.length > 6_000_000) return null;
    return { mimeType: ct, base64: buf.toString("base64") };
  } catch {
    return null;
  }
}

/** Every `<img src>` in an HTML string, in document order, absolutized against
 *  `baseUrl` when possible. */
function allHtmlImageUrls(html: string, baseUrl?: string): string[] {
  const out: string[] = [];
  const re = /<img\b[^>]*\bsrc\s*=\s*["']([^"']+)["']/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    let u = m[1];
    if (baseUrl) {
      try {
        u = new URL(u, baseUrl).href;
      } catch {
        /* keep the raw src if it can't be resolved */
      }
    }
    out.push(u);
  }
  return out;
}

/** The HTML fragment belonging to the section whose heading text equals `scope`
 *  — from that `<h1|h2|h3>` to the next heading of the same-or-higher level.
 *  Returns null when no heading matches (caller then falls back to whole page). */
function sectionHtmlForScope(html: string, scope: string): string | null {
  const re = /<(h[1-3])\b[^>]*>([\s\S]*?)<\/\1>/gi;
  const heads: { start: number; end: number; level: number; text: string }[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const text = m[2]
      .replace(/<[^>]+>/g, "")
      .replace(/\s+/g, " ")
      .trim();
    heads.push({ start: m.index, end: re.lastIndex, level: Number(m[1][1]), text });
  }
  const target = scope.replace(/\s+/g, " ").trim();
  const i = heads.findIndex((h) => h.text === target);
  if (i === -1) return null;
  const lvl = heads[i].level;
  let end = html.length;
  for (let j = i + 1; j < heads.length; j++) {
    if (heads[j].level <= lvl) {
      end = heads[j].start;
      break;
    }
  }
  return html.slice(heads[i].end, end);
}

const MAX_XIAOP_IMAGES = 8;

/** Ordered, deduped, capped image URLs to feed 小P's vision — scope-aware:
 *  a scope → only that section's images; no scope → the whole page (cover first). */
function xiaopVisionUrls(opts: {
  html: string;
  baseUrl?: string;
  scope?: string;
  coverUrl?: string | null;
}): string[] {
  const { html, baseUrl, scope, coverUrl } = opts;
  let urls: string[];
  if (scope) {
    const frag = sectionHtmlForScope(html, scope);
    // Heading not found → don't go blind; fall back to the whole page.
    urls = frag != null ? allHtmlImageUrls(frag, baseUrl) : allHtmlImageUrls(html, baseUrl);
  } else {
    urls = [...(coverUrl ? [coverUrl] : []), ...allHtmlImageUrls(html, baseUrl)];
  }
  const seen = new Set<string>();
  const out: string[] = [];
  for (const u of urls) {
    if (!u || seen.has(u)) continue;
    seen.add(u);
    out.push(u);
    if (out.length >= MAX_XIAOP_IMAGES) break;
  }
  return out;
}

/** Fetch several image URLs into inline base64, skipping any that fail. */
async function fetchInlineImages(urls: string[]): Promise<InlineImage[]> {
  const imgs = await Promise.all(urls.map((u) => fetchInlineImage(u)));
  return imgs.filter((x): x is InlineImage => x != null);
}

/**
 * 同 fetchInlineImages，但**保序**：抓不到的那一张留 `null` 占位，不塌缩。
 *
 * 为什么要多这一个：`fetchInlineImages` 把失败项直接 filter 掉，于是调用方只能看到
 * 「拿到几张」，**对不上是哪几张**。器官分类正是因此写成了「差一张就整批放弃」——
 * 而 fetchInlineImage 有四条静默失败分支（非 2xx / 非 image 类型 / >6MB / 15 秒超时），
 * 8 张里坏 1 张的概率一点都不低。结果就是用户看到的「配图全空」。
 *
 * 保序之后，调用方可以只把拿到的那些送去分类，再把结果映射回原下标。
 */
async function fetchInlineImagesIndexed(urls: string[]): Promise<(InlineImage | null)[]> {
  return await Promise.all(urls.map((u) => fetchInlineImage(u)));
}

/** Gemini chat call (structured output via responseSchema; optional vision). */
async function geminiChat(
  apiKey: string,
  model: string,
  contents: ChatContents,
  system: string,
  schema?: unknown,
  maxRetry = 3,
  images?: InlineImage[],
  /** 报错文案里自称什么。三条传输层都要，理由见 openaiCompatChat 的 `label`。 */
  who = "小P",
): Promise<AiTextResult> {
  const generationConfig: Record<string, unknown> = schema
    ? { responseMimeType: "application/json", responseSchema: schema }
    : {};
  const gContents: { role: string; parts: unknown[] }[] = contents.map((c) => ({
    role: c.role,
    parts: [...c.parts],
  }));
  if (images?.length) {
    const idx = lastUserIndex(contents);
    for (const im of images)
      gContents[idx].parts.push({ inlineData: { mimeType: im.mimeType, data: im.base64 } });
  }

  // Same key pool as identify. This path also backs 入侵卡 / 保护卡 generation, which
  // fire right after the main draft call — exactly the burst that trips the free-tier
  // per-minute limit on a single key. Rotation spreads them across projects.
  // Vision questions can take >1min, hence the 120s per-attempt timeout.
  try {
    const res = await callGeminiWithRotation(splitGeminiKeys(apiKey), {
      model,
      timeoutMs: 120_000,
      label: who,
      body: {
        contents: gContents,
        systemInstruction: { parts: [{ text: system }] },
        generationConfig,
      },
    });
    const txt = res.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!txt) throw new Error(`${who} 未返回有效内容。`);
    const u = res.usageMetadata ?? {};
    return {
      text: txt as string,
      usage: {
        prompt_tokens: u.promptTokenCount ?? 0,
        completion_tokens: u.candidatesTokenCount ?? 0,
        total_tokens: u.totalTokenCount ?? 0,
      },
    };
  } catch (e) {
    if (e instanceof AiError && e.code === "GEMINI_NETWORK" && /abort/i.test(e.message)) {
      throw new Error(
        `${who} 响应超时（等了 2 分钟）：模型思考较慢，带图提问尤其耗时。请重试一次；连续超时可在「${who}」的控制台换更快的视觉模型。`,
      );
    }
    throw e;
  }
}

/** OpenAI-compatible chat (covers provider `openai` and `custom` relays; optional vision). */
/**
 * 把 JSON Schema 写进 system prompt。
 *
 * 只有 Gemini 那条路是真·结构化输出（`generationConfig.responseSchema`）。OpenAI 兼容中转
 * 与 Anthropic 这两条路原先只在 prompt 末尾加一句「只返回一个 JSON 对象」——
 * **字段名从头到尾没有告诉过模型**。于是模型自己造键名（intro / introduction / 开篇导语…），
 * JSON 能 parse、闸门却发现 intro_zh / habitat_zh / eco_function_zh 全是空的，
 * 用户看到的就是「生成的详页不完整（…全是空的）」。
 * （2026-07-23 金叶详页事故。讽刺的是三轮撰稿的 prompt 里白纸黑字写着「严格按给定 JSON
 * 结构返回」，而那个「给定结构」压根没随请求发出去。）
 *
 * **刻意不用** OpenAI 的 `response_format: {type:"json_schema"}`：中转五花八门，不认这个
 * 参数的直接 400，认一半的会返回空串（见 send() 里关于 json_object 的那条注释）。
 * 写进 prompt 是唯一对所有中转都成立的办法，最差也只是模型不听话，不会整条链路挂掉。
 */
function schemaInstruction(schema: unknown): string {
  let text = "";
  try {
    text = JSON.stringify(schema);
  } catch {
    /* 循环引用之类 —— 退回原来那句泛泛的要求 */
  }
  if (!text) return "\n\n只返回一个 JSON 对象，不要 markdown、不要多余文字。";
  return (
    `\n\n【输出格式 · 硬性要求】只返回**一个** JSON 对象，不要 markdown 代码块、不要任何解释文字。\n` +
    `键名必须**逐字照抄**下面这份 JSON Schema（大小写、下划线、_zh / _en 后缀一个字符都不能改），` +
    `required 里列出的键一个都不能少，不要自行增加或包裹外层结构：\n${text}`
  );
}

/**
 * 把「上游网关超时」这类**光看状态码根本读不懂**的失败翻译成人话。
 *
 * 用户 2026-07-29 收到的原文是「小P 调用失败 (HTTP 524)：error code: 524」——
 * 524 是 Cloudflare 的**源站超时**：请求确实发出去了，是中转/厂商那头在规定时间内
 * 没把响应写完。这跟本站的超时预算无关，重试或换个更快的模型才有用，
 * 而原文既没说这些，还把责任指向了错误的控制台。
 */
function upstreamHint(status: number, who: string): string {
  if (status === 524 || status === 504 || status === 522)
    return `\n\n（HTTP ${status} 是**中转/厂商那一端**超时了，不是本站掐断的：请求发出去了，对方没能在它自己的时限内写完响应。多见于推理模型开着思维链又带图。可以重试一次；反复出现就在「${who}」的控制台里换更快的模型，或把它的思维链设成强制关闭。）`;
  if (status === 502 || status === 503)
    return `\n\n（HTTP ${status} 是中转/厂商暂时不可用，与所配模型和本站都无关。稍后重试，或在「${who}」的控制台里换一条中转。）`;
  return "";
}

async function openaiCompatChat(
  apiKey: string,
  baseUrl: string,
  model: string,
  contents: ChatContents,
  system: string,
  schema?: unknown,
  images?: InlineImage[],
  opts: {
    /** 已解析的推理开关；"on" = 不发关思考参数，让模型按自己的默认来。 */
    thinking?: ThinkingMode;
    /**
     * `true` = **禁止**「去掉图重发」那条降级路径（见下方 blind fallback）。
     *
     * 给「图本身就是任务」的链路用：配图器官识别、视觉自检。对它们来说，
     * 一次看不见图的成功调用**比失败更糟** —— 模型会照样返回一串器官标签，
     * 那是纯编造，而且 HTTP 200、日志无异常，谁也发现不了。
     */
    noBlindFallback?: boolean;
    /**
     * 报错文案里自称什么。**这是共享传输层** —— 小P对话、识别、银叶、金叶、
     * 器官识别全走这一个函数。用户 2026-07-29 报的「金叶模型是单独配置的，
     * 怎么会报小P响应超时？」就是因为这里的文案把「小P」写死了：
     * 金叶超时却让人去改小P的模型设置，指到了完全无关的控制台。
     */
    label?: string;
    /**
     * 单次请求的超时。默认 120 秒是给**交互式**调用定的（小P对话挂在 HTTP 请求上，
     * 边缘本身就只有 100 秒，等更久没有意义）。跑在队列里的后台任务有 15 分钟预算，
     * 传更长的值 —— 否则像 kimi-k3 这类先写一大段思维链的推理模型必然卡在 120 秒。
     */
    timeoutMs?: number;
  } = {},
): Promise<AiTextResult> {
  const { thinking, noBlindFallback } = opts;
  const who = opts.label ?? "小P";
  const timeoutMs = opts.timeoutMs ?? 120_000;
  const apiBase = normalizeBaseUrl(baseUrl) || "https://api.openai.com/v1";

  // Build the OpenAI messages. `useImages` attaches the photo(s) to the last user
  // turn as image_url parts — dropped on the text-only retry below.
  const buildMessages = (useImages: boolean): { role: string; content: unknown }[] => {
    const idx = useImages && images?.length ? lastUserIndex(contents) : -1;
    return [
      {
        role: "system",
        content: schema ? `${system}${schemaInstruction(schema)}` : system,
      },
      ...contents.map((c, i) => {
        const text = c.parts.map((p) => p.text).join("\n");
        const role = c.role === "model" ? "assistant" : "user";
        if (i === idx && images?.length) {
          return {
            role,
            content: [
              { type: "text", text },
              ...images.map((im) => ({
                type: "image_url",
                image_url: { url: `data:${im.mimeType};base64,${im.base64}` },
              })),
            ],
          };
        }
        return { role, content: text };
      }),
    ];
  };

  // The console keeps ONE key pool shared across providers, so `apiKey` can be a
  // comma-joined pool that includes OTHER vendors' keys. Sending the joined string
  // as a bearer token is an automatic 401 — split it and rotate (the panel already
  // promises "OpenAI/Anthropic/自定义接口也支持轮换").
  const keyPool = splitKeyPool(apiKey);
  if (!keyPool.length) keyPool.push(apiKey);

  // One request with its own network retry + timeout. Returns the Response, or
  // throws a described network/timeout error.
  const send = async (useImages: boolean, key: string): Promise<Response> => {
    // NOTE: deliberately DO NOT send response_format:json_object — some relays /
    // reasoning models return an EMPTY reply when it's set. We instruct JSON in the
    // system prompt + cleanJson() instead.
    const body: Record<string, unknown> = {
      model,
      messages: buildMessages(useImages),
      max_tokens: 16000,
      // 小P蛙默认关思考：它要么在跟用户对话（要跟手），要么在做配图器官打标签
      // （机械活）。两种都不吃思维链，却都会被它拖到 2 分钟超时那条分支上。
      ...thinkingParams({ thinking }),
    };
    let lastErr: unknown = null;
    for (let attempt = 0; attempt < 2; attempt++) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const r = await fetch(`${apiBase}/chat/completions`, {
          method: "POST",
          signal: controller.signal,
          headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        clearTimeout(timer);
        return r;
      } catch (err) {
        clearTimeout(timer);
        lastErr = err;
        if ((err as Error)?.name === "AbortError") break; // slow model — retry only doubles the wait
        if (attempt === 0) {
          await new Promise((r) => setTimeout(r, 1500));
          continue;
        }
      }
    }
    if ((lastErr as Error)?.name === "AbortError") {
      throw new Error(
        `${who} 响应超时（等了 ${Math.round(timeoutMs / 1000)} 秒）：当前模型思考较慢，带图提问尤其耗时。可以重试一次；` +
          `若连续超时，请在**${who}**自己的控制台里换更快的视觉模型（或关掉它的思维链），并确认所配模型支持看图。`,
      );
    }
    throw new Error(
      `${who} 连接中转失败（${lastErr instanceof Error ? lastErr.message : "网络错误"}）：` +
        `请检查中转地址/网络；整页改写体量较大时该中转可能超时，可把**${who}**的模型切回默认 Gemini 再试。`,
    );
  };

  // 401/403 → that key belongs to another vendor or was revoked; 429 → it is rate
  // limited. Both mean the NEXT key in the pool is worth trying; anything else is a
  // real error we should surface immediately.
  let usedKey = keyPool[0];
  let resp = await send(!!images?.length, usedKey);
  for (let i = 1; i < keyPool.length && !resp.ok && keyRejected(resp.status); i++) {
    usedKey = keyPool[i];
    resp = await send(!!images?.length, usedKey);
  }
  // Text-only models (e.g. DeepSeek deepseek-chat) reject the vision `image_url`
  // part with a 400. Rather than fail the whole chat, retry once WITHOUT images so
  // text conversation still works — the user just can't get image-based answers.
  //
  // ⚠️ **两个前提缺一不可**：①调用方没禁用它；②这条链路里「看不看得见图」不是关键。
  // 对器官识别 / 视觉自检这类**图就是任务**的调用必须禁用 —— 否则模型没看见图却照样
  // 编一串器官标签回来（HTTP 200、日志干净），比直接失败有害得多。
  // 禁用之后 400 会原样抛出，交给 shouldFailOver 的 CAPABILITY_400 顺位给序列 2 ——
  // 这也是「第一个不行第二个顶上」真正生效的前提：盲退级会把 400 吞成 200，顺位就永远不触发。
  if (!resp.ok && images?.length && !noBlindFallback) {
    const t = await resp.clone().text();
    if (
      /image_url|unknown variant|expected\s+`?text`?|does ?n['’]?t support image|not support.*image|multimodal|vision/i.test(
        t,
      )
    ) {
      console.warn(
        `[openaiCompatChat] ${model} 拒收图片，已**去掉图**重发一次 —— 本次回答没有看到任何图片。`,
      );
      resp = await send(false, usedKey);
    }
  }
  if (!resp.ok) {
    const t = await resp.text();
    throw new Error(
      `${who} 调用失败 (HTTP ${resp.status})：${t.slice(0, 200)}${upstreamHint(resp.status, who)}`,
    );
  }
  const res = await resp.json();
  const content = res.choices?.[0]?.message?.content;
  if (!content) throw new Error(`${who} 未返回有效内容。`);
  const u = res.usage ?? {};
  return {
    text: content as string,
    usage: {
      prompt_tokens: u.prompt_tokens ?? 0,
      completion_tokens: u.completion_tokens ?? 0,
      total_tokens: u.total_tokens ?? (u.prompt_tokens ?? 0) + (u.completion_tokens ?? 0),
    },
  };
}

/** Anthropic Messages chat (optional vision). */
async function anthropicChat(
  apiKey: string,
  baseUrl: string,
  model: string,
  contents: ChatContents,
  system: string,
  schema?: unknown,
  images?: InlineImage[],
  /** 报错文案里自称什么。三条传输层都要，理由见 openaiCompatChat 的 `label`。 */
  who = "小P",
): Promise<AiTextResult> {
  const apiBase = normalizeBaseUrl(baseUrl) || "https://api.anthropic.com/v1";
  const idx = images?.length ? lastUserIndex(contents) : -1;
  const messages = contents.map((c, i) => {
    const text = c.parts.map((p) => p.text).join("\n");
    const role = c.role === "model" ? "assistant" : "user";
    if (i === idx && images?.length) {
      return {
        role,
        content: [
          { type: "text", text },
          ...images.map((im) => ({
            type: "image",
            source: { type: "base64", media_type: im.mimeType, data: im.base64 },
          })),
        ],
      };
    }
    return { role, content: text };
  });
  const sys = schema ? `${system}${schemaInstruction(schema)}` : system;
  const resp = await fetch(`${apiBase}/messages`, {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json",
    },
    // 16000 与 OpenAI 兼容路径取齐：金叶详页第一轮要一次写出 6 张特征卡 + 导语 + 株型总览
    // 的中英双语，8000 挡不住，截断后 JSON.parse 直接抛 GOLD_BAD_JSON。
    body: JSON.stringify({ model, system: sys, messages, max_tokens: 16000 }),
  });
  if (!resp.ok) {
    const t = await resp.text();
    throw new Error(
      `${who} 调用失败 (HTTP ${resp.status})：${t.slice(0, 200)}${upstreamHint(resp.status, who)}`,
    );
  }
  const res = await resp.json();
  const txt = res.content?.[0]?.text;
  if (!txt) throw new Error(`${who} 未返回有效内容。`);
  const u = res.usage ?? {};
  return {
    text: txt as string,
    usage: {
      prompt_tokens: u.input_tokens ?? 0,
      completion_tokens: u.output_tokens ?? 0,
      total_tokens: (u.input_tokens ?? 0) + (u.output_tokens ?? 0),
    },
  };
}

/** Shared 小P text call. Routes to whatever model the admin configured for 小P
 *  (gemini / openai / custom / anthropic); default = env GEMINI_API_KEY + AI_MODEL.
 *  `images` (optional) are sent to the model so 小P can judge from the photo. */
async function xiaopTextCall(opts: {
  contents: ChatContents;
  system: string;
  schema?: unknown;
  maxRetry?: number;
  images?: InlineImage[];
  /** Per-user model config (sent from the client) takes priority over the
   *  admin site config; falls back to env Gemini when neither is set. */
  overrideSequence?: ModelSlot[] | null;
  /**
   * 读哪个控制台的序列、以及按谁的推理默认值走。默认 `"xiaop"`（这个函数本来就是
   * 为小P蛙写的）。金叶详页传 `"gold"` —— 它跟交互问答的诉求正相反，不该共用一套配置。
   */
  consoleId?: ConsoleId;
  /**
   * `true` = **图就是任务本身**，看不见图的回答一文不值（器官识别就是这种）。
   *
   * 效果是禁掉「中转拒收图片就去掉图重发」那条降级路径：宁可这一项报 400 被顺位给
   * 序列 2，也不要一个没看过图、却编得有模有样的 200。默认 false —— 小P蛙聊天带图
   * 提问时，退化成纯文本回答仍然对用户有用。
   */
  imagesEssential?: boolean;
}): Promise<AiTextResult & { provider: string; model: string }> {
  const consoleId = opts.consoleId ?? "xiaop";
  // 报错要自称**这条链路自己的**名字。三条传输层里的每一句文案都要拿到它 ——
  // 上一轮只改了超时那两句，结果金叶撞 HTTP 524 时照旧自称「小P 调用失败」。
  const who = consoleId === "xiaop" ? "小P" : CONSOLE_LABELS[consoleId];
  // 每一项序列都是一套完整自洽的配置，所以「换一项重试」就是原样再跑一遍这段。
  const callSlot = async (
    slot: ModelSlot,
  ): Promise<AiTextResult & { provider: string; model: string }> => {
    if (slot.provider === "gemini") {
      const r = await geminiChat(
        slot.apiKey,
        slot.model,
        opts.contents,
        opts.system,
        opts.schema,
        opts.maxRetry ?? 3,
        opts.images,
        who,
      );
      return { ...r, provider: "gemini", model: slot.model };
    }
    if (slot.provider === "anthropic") {
      const r = await anthropicChat(
        slot.apiKey,
        slot.baseUrl,
        slot.model,
        opts.contents,
        opts.system,
        opts.schema,
        opts.images,
        who,
      );
      return { ...r, provider: "anthropic", model: slot.model };
    }
    // openai + custom share the OpenAI-compatible path
    const r = await openaiCompatChat(
      slot.apiKey,
      slot.baseUrl,
      slot.model,
      opts.contents,
      opts.system,
      opts.schema,
      opts.images,
      {
        thinking: thinkingOf(slot, consoleId),
        // 「图就是任务」的链路（器官识别）必须禁掉盲退级，见 openaiCompatChat 的注释。
        noBlindFallback: !!opts.imagesEssential,
        label: who,
        timeoutMs: BACKGROUND_CONSOLES.has(consoleId) ? 300_000 : 120_000,
      },
    );
    return { ...r, provider: slot.provider, model: slot.model };
  };

  // 用户自带配置优先；否则走管理员配的序列；两者都空则退回 .env 的 Gemini。
  // 用户自带序列优先（整条都用，能自己降级）；否则走管理员配的序列。
  let sequence: ModelSlot[] = opts.overrideSequence?.length
    ? opts.overrideSequence
    : (
        await (consoleId === "gold"
          ? loadGoldQueue()
          : consoleId === "organ"
            ? loadOrganQueue()
            : loadXiaoPQueue())
      ).sequence;

  if (!sequence.length) {
    const envKey = process.env.GEMINI_API_KEY;
    if (!envKey) throw new Error("小P 暂不可用：未配置模型，且服务器无 GEMINI_API_KEY。");
    sequence = [
      {
        provider: "gemini",
        apiKey: envKey,
        baseUrl: "",
        model: process.env.AI_MODEL || "gemini-3-flash-preview",
      },
    ];
  }
  // 小P蛙**有时**带图（问某张配图 / 复核详页插图），有时纯问答。只在真带了图这一次
  // 要求视觉 —— 纯文本提问没必要把一个只会写字的好模型排除掉。
  // 报错文案里带的是**这条链路自己的**控制台名 —— 金叶失败时说「给小P蛙换模型」
  // 会把管理员指到完全无关的那个控制台去。
  return runModelQueue(
    sequence,
    callSlot,
    consoleId === "xiaop" ? "小P" : CONSOLE_LABELS[consoleId],
    {
      requireVision: !!opts.images?.length,
    },
  );
}

// ── 小P蛙 联网检索（Google 搜索 grounding，仅 Gemini）───────────────────────────
// Grounding is INCOMPATIBLE with responseSchema (structured output), so we run it as
// a SEPARATE free-text call and inject the digest + sources back into the structured
// answer. Gemini-only; returns null for other providers or on any failure (graceful).

/** Resolve the effective Gemini key/model for 小P (mirrors xiaopTextCall's gemini branch). */
async function resolveXiaoPGemini(
  overrideSequence: ModelSlot[] | null,
): Promise<{ apiKey: string; model: string } | null> {
  // grounding 只有 Gemini 支持 —— 从序列里挑**第一个 Gemini 项**；一个都没有就退回 .env。
  const sequence = overrideSequence?.length ? overrideSequence : (await loadXiaoPQueue()).sequence;
  const gem = sequence.find((s) => s.provider === "gemini" && s.apiKey);
  if (gem) return { apiKey: gem.apiKey, model: gem.model };
  const envKey = process.env.GEMINI_API_KEY;
  if (!envKey) return null;
  return { apiKey: envKey, model: process.env.AI_MODEL || "gemini-3-flash-preview" };
}

async function xiaopGroundedSearch(
  query: string,
  override: ModelSlot[] | null,
): Promise<{
  digest: string;
  sources: { title: string; uri: string }[];
  usage: AiTokenUsage;
} | null> {
  const g = await resolveXiaoPGemini(override);
  if (!g) return null;
  try {
    const data = await callGeminiWithRotation(splitGeminiKeys(g.apiKey), {
      model: g.model,
      timeoutMs: 30_000,
      label: "小P-search",
      body: {
        contents: [
          {
            role: "user",
            parts: [
              {
                text: `请联网检索并用中文汇总与下面问题最相关的最新、可靠信息，给 3–6 条要点（含关键数据/结论/年份）：\n${query}`,
              },
            ],
          },
        ],
        tools: [{ google_search: {} }],
      },
    });
    const cand = data.candidates?.[0];

    const digest = (cand?.content?.parts || [])
      .map((p: any) => p.text)
      .filter(Boolean)
      .join("\n")
      .trim();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const chunks: any[] = cand?.groundingMetadata?.groundingChunks || [];
    const sources = chunks
      .map((c) => ({
        title: String(c?.web?.title || "").trim(),
        uri: String(c?.web?.uri || "").trim(),
      }))
      .filter((s) => s.uri)
      .slice(0, 6);
    if (!digest) return null;
    const u = data.usageMetadata ?? {};
    const usage: AiTokenUsage = {
      prompt_tokens: u.promptTokenCount ?? 0,
      completion_tokens: u.candidatesTokenCount ?? 0,
      total_tokens: u.totalTokenCount ?? 0,
    };
    return { digest, sources, usage };
  } catch (e) {
    console.warn(
      "[xiaopGroundedSearch] failed (grounding maybe unsupported by key/model):",
      e instanceof Error ? e.message : e,
    );
    return null;
  }
}

/**
 * Run a 小P chat turn with OPTIONAL web grounding. First structured pass; if the
 * model set needsWebSearch + webQuery, run a grounded search, then re-answer with the
 * digest + sources injected, and append the source links to `reply`. Returns the
 * final JSON string for the caller's parseAgentReply.
 */
async function xiaopAskWithGrounding(opts: {
  contents: ChatContents;
  system: string;
  schema: unknown;
  images?: InlineImage[];
  overrideSequence: ModelSlot[] | null;
}): Promise<AiTextResult & { provider: string; model: string }> {
  const first = await xiaopTextCall({
    contents: opts.contents,
    system: opts.system,
    schema: opts.schema,
    images: opts.images,
    overrideSequence: opts.overrideSequence,
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let parsed: any;
  try {
    parsed = JSON.parse(cleanJson(first.text));
  } catch {
    return first; // unparseable → let the caller's parser deal with it
  }
  const wants = parsed?.needsWebSearch === true && String(parsed?.webQuery || "").trim();
  if (!wants) return first;

  const search = await xiaopGroundedSearch(String(parsed.webQuery).trim(), opts.overrideSequence);
  if (!search) return first; // grounding unavailable → keep the first answer

  const srcBlock = search.sources.length
    ? "\n参考来源：\n" +
      search.sources.map((s, i) => `[${i + 1}] ${s.title || s.uri} ${s.uri}`).join("\n")
    : "";
  const contents2: ChatContents = [
    ...opts.contents,
    {
      role: "user",
      parts: [
        {
          text: `【✅ 联网检索结果】我已为你完成联网搜索，以下是权威的最新信息。请**直接用这些真实数据更新你的回答**，把 needsWebSearch 设为 false。\n\n${search.digest}${srcBlock}\n\n请据上面的检索结果给出准确、完整的答案。`,
        },
      ],
    },
  ];
  const second = await xiaopTextCall({
    contents: contents2,
    system: opts.system,
    schema: opts.schema,
    images: opts.images,
    overrideSequence: opts.overrideSequence,
  });
  // Total cost of this grounded turn = first pass + grounded search + second pass.
  const usage = addUsage(addUsage(first.usage, search.usage), second.usage);

  // Guarantee the sources are visible even if the model omitted them.
  if (search.sources.length) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const p2: any = JSON.parse(cleanJson(second.text));
      if (!/参考来源|来源[:：]|http/.test(p2.reply || "")) {
        const lines = search.sources
          .map((s, i) => `[${i + 1}] ${s.title || s.uri}：${s.uri}`)
          .join("\n");
        p2.reply = `${p2.reply || ""}\n\n📎 联网检索来源：\n${lines}`;
      }
      return { text: JSON.stringify(p2), usage, provider: second.provider, model: second.model };
    } catch {
      return { ...second, usage };
    }
  }
  return { ...second, usage };
}

// Per-user model config forwarded from the client (stored in their browser).
const UserModelInput = z
  .object({
    provider: z.enum(["gemini", "openai", "anthropic", "custom"]),
    apiKey: z.string().min(1).max(2000),
    model: z.string().min(1).max(200),
    baseUrl: z.string().max(300).optional().or(z.literal("")),
    // 新客户端会带上整个「优先调用序列」；老客户端只有上面的扁平字段（= 序列 1）。
    sequence: z
      .array(
        z.object({
          provider: z.enum(["gemini", "openai", "anthropic", "custom"]),
          apiKey: z.string().min(1).max(2000),
          baseUrl: z.string().max(300).optional().or(z.literal("")),
          model: z.string().min(1).max(200),
        }),
      )
      .max(12)
      .optional(),
  })
  .optional();

/**
 * 把客户端传来的用户模型配置折算成调用序列。
 * 带 sequence 就用它；只有扁平字段（老客户端 / 老 localStorage）则走 readModelQueue，
 * 顺带把历史的逗号 key 池展开成多项。
 */
function toOverrideSlots(um: z.infer<typeof UserModelInput>): ModelSlot[] {
  if (!um || !um.apiKey || !um.model) return [];
  if (um.sequence?.length) {
    return readModelQueue({ sequence: um.sequence }).sequence;
  }
  return readModelQueue({
    provider: um.provider,
    apiKey: um.apiKey,
    model: um.model,
    baseUrl: um.baseUrl ?? "",
  }).sequence;
}

const AskDraftAgentInput = z.object({
  draftId: z.string(),
  question: z.string().min(1).max(2000),
  scope: z.string().max(400).optional(), // annotation: which section to focus on
  history: z
    .array(z.object({ role: z.enum(["user", "assistant"]), text: z.string() }))
    .max(24)
    .optional(),
  userModel: UserModelInput,
});

/** Record one 小P chat turn's token cost as a `chat` row in ai_usage_logs. Awaited
 *  (Workers isolates tear down after the response) and best-effort (a logging failure
 *  must never break the chat reply). draft_id is only set for genuine draft ids. */
async function logChatUsage(
  ans: AiTextResult & { provider: string; model: string },
  meta: { draftId?: string; draftTitle?: string; label: string },
): Promise<void> {
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await (supabaseAdmin as any).from("ai_usage_logs").insert({
      user_id: null,
      user_label: meta.label,
      provider: ans.provider,
      model: ans.model,
      prompt_tokens: ans.usage.prompt_tokens,
      completion_tokens: ans.usage.completion_tokens,
      total_tokens: ans.usage.total_tokens,
      draft_id: meta.draftId ?? null,
      draft_title: meta.draftTitle ?? null,
      task_type: "chat", // 小P conversation turn
    });
    if (error) console.warn("[UsageLog] chat insert failed:", error.message);
  } catch (e) {
    console.warn("[UsageLog] chat unexpected error:", e);
  }
}

/** Chat with 小P about a draft. Returns its reply plus, when relevant, a concrete
 *  edit instruction the editor can choose to apply. */
export const askDraftAgentFn = createServerFn({ method: "POST" })
  .inputValidator((input) => AskDraftAgentInput.parse(input))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: draft } = await supabaseAdmin
      .from("plant_drafts")
      .select(
        "title,scientific_name,html_content,photo_url,user_photos,summary,common_names_zh,common_name_en,family,genus",
      )
      .eq("id", data.draftId)
      .maybeSingle();
    if (!draft) throw new Error("草稿不存在");

    // 简介卡这个 scope 不在 html_content 里（是 plant_drafts 的列），所以图片喂用户自己
    // 拍的那几张（卡上显示的正是它们），文本另外附一份卡面快照。
    const cardScope = data.scope === DRAFT_CARD_SCOPE;
    const cardFields = pickDraftCardFields(draft as Record<string, unknown>);

    // Scope-aware vision: an annotated section → only THAT section's images; the
    // whole draft (no scope) → visitor's uploaded photo + every draft illustration.
    const draftHtml = draft.html_content || "";
    const visionUrls = cardScope
      ? [
          ...(draft.photo_url ? [draft.photo_url] : []),
          ...(((draft as { user_photos?: string[] | null }).user_photos ?? []) as string[]),
        ]
          .filter(Boolean)
          .slice(0, MAX_XIAOP_IMAGES)
      : xiaopVisionUrls({
          html: draftHtml,
          scope: data.scope,
          coverUrl: draft.photo_url,
        });
    const photos = await fetchInlineImages(visionUrls);

    const docText = htmlToText(draftHtml);
    const scopeLine = cardScope
      ? `编辑本轮把讨论范围限定在【${DRAFT_CARD_SCOPE}】—— 就是草稿页顶部那张卡：中文名（标题）、拉丁学名、中文俗名/商品名、英文俗名、科、属、摘要。它不在下面的正文 HTML 里，而是草稿自己的字段。请只围绕这几项回答与建议；提出修改时，说清要改哪一项、改成什么。`
      : data.scope
        ? `编辑本轮把讨论范围限定在草稿的「${data.scope}」部分。请只围绕这一处回答与建议。`
        : "本轮未限定范围，针对整份草稿回答。";
    const system = `你是「小P蛙」，Plantspedia（鄂尔多斯植物百科）的双语审稿助手，性格友好、专业、简洁。
编辑正在审核一份由 AI 生成的植物科普草稿，可能对其中内容有疑问。${scopeLine}你的职责：
- 用【中文】回答编辑关于该草稿的问题，必要时给出基于植物学常识的核对与修改建议；${data.scope ? "范围已限定时，回答与改动只应涉及该部分；" : ""}
- ${photos.length ? `本条消息附带了${data.scope ? `草稿「${data.scope}」这一部分的配图` : "访客上传的原始照片以及草稿全部配图"}，共 ${photos.length} 张。鉴定物种时请【以照片为准】，文本仅作参考；若编辑问「配图对不对/有没有错配」，请逐张把照片与正文描述核对，指出哪一张与所述物种矛盾（叶单叶/复叶、花色花数、果实有无刺等）、疑似为何物种；` : "（本次未能附上照片，仅能依据文本判断，请说明这一点）"}
- 当你不确定物种鉴定或具体数据时，要诚实说明，不要编造；
- 如果编辑的诉求是一处「可以直接落地到草稿里的具体修改」（例如订正学名、改写某段、调整养护数值、修正错别字等），
  把 canEdit 设为 true，并在 editInstruction 里用一句中文精确描述要对草稿做的改动（具体到改哪里、改成什么）。
  **你可以直接落地这些文字改动**——编辑只需点一下「采纳并保存」，就由你改写并保存，不要说"交给技术同事/他人执行"。
- 如果诉求是「更换 / 增补配图」（图片不对、不清晰、需要更合适的照片），把 canEdit 设为 true、imageEdit 设为 true，
  imageQuery 给出一个好的图片搜索词（通常用拉丁学名），editInstruction 说明要替换哪张图。系统会调起站内"在线搜图"
  让编辑挑选图片后自动替换，所以同样不要说交给别人。
- 如果编辑想「看该物种的网络参考照片来比对鉴定」，把 showImages 设为 true，并把要展示的物种放进 imageQueries 数组
  （每个元素一个搜索词，**优先拉丁学名**）。**对比多个物种时，imageQueries 要包含每一个物种**，例如要比对两个种就写
  ["Tribulus terrestris","Tripodion tetraphyllum"]。系统会联网（iNaturalist / GBIF / 维基共享）按每个词分别取若干照片、
  分组显示在对话里。**你具备这个能力，不要说"我无法联网/无法发图"**；reply 里正常说明你将给出参考图即可。
- 如果只是答疑、讨论或信息不足以落地，上述布尔全部设为 false，editInstruction 留空、imageQueries 用空数组。
- 如果准确回答需要【最新网络信息】（如某物种最新的保护级别/最新研究进展/新闻/时效性数据/市场行情等，且你的内置知识可能过时或不确定），把 needsWebSearch 设为 true，并在 webQuery 里给出一个简洁的检索词（可用拉丁学名）；**同时在 reply 中先给出基于你现有知识的初步回答，并明确说明「正在为你联网查询最新信息...」**，系统会自动联网并让你用真实结果更新答案。纯植物学常识不必联网，needsWebSearch 设为 false、webQuery 留空。
回答控制在简明范围内，不要长篇大论。
【输出格式·务必严格】只返回一个 JSON 对象，键名固定为：reply（字符串，你的中文回答）、canEdit（布尔）、editInstruction（字符串）、imageEdit（布尔）、imageQuery（字符串）、showImages（布尔）、imageQueries（字符串数组）、needsWebSearch（布尔）、webQuery（字符串）。不要用 response 等其它键名，不要加 markdown 代码块或多余文字。`;

    const contents: { role: "user" | "model"; parts: { text: string }[] }[] = [
      {
        role: "user",
        parts: [
          {
            text:
              `【待审草稿：${draft.title}${draft.scientific_name ? "（" + draft.scientific_name + "）" : ""}】\n` +
              // 简介卡快照始终附上：即使范围是整页，编辑也常问「卡上的学名对不对」。
              `以下是${DRAFT_CARD_SCOPE}（草稿字段，不在正文 HTML 里）：\n${draftCardToText(cardFields)}\n\n` +
              (cardScope ? "本轮讨论范围就是上面这张卡；下面的正文仅供参考。\n" : "") +
              `以下是草稿正文纯文本：\n${docText}`,
          },
        ],
      },
      { role: "model", parts: [{ text: "好的，我已读完这份草稿。请问哪里需要核对或修改？" }] },
      ...(data.history || []).map((h) => ({
        role: (h.role === "assistant" ? "model" : "user") as "user" | "model",
        parts: [{ text: h.text }],
      })),
      { role: "user", parts: [{ text: data.question }] },
    ];

    const schema = {
      type: "object",
      properties: {
        reply: { type: "string", description: "用中文回答编辑的问题或给出建议" },
        canEdit: { type: "boolean", description: "本轮是否提出了可直接落地到草稿的具体修改" },
        editInstruction: {
          type: "string",
          description: "若 canEdit 为 true，用一句中文精确描述要对草稿做的修改；否则空字符串",
        },
        imageEdit: { type: "boolean", description: "该修改是否为更换/增补配图（需要搜图选图）" },
        imageQuery: {
          type: "string",
          description: "若 imageEdit 为 true，配图搜索词（通常用拉丁学名）；否则空字符串",
        },
        showImages: {
          type: "boolean",
          description: "编辑是否想看该物种（们）的网络参考照片用于比对",
        },
        imageQueries: {
          type: "array",
          items: { type: "string" },
          description:
            "若 showImages 为 true，要展示的每个物种的搜索词（优先拉丁学名）；对比多个物种时含每一个；否则空数组",
        },
        needsWebSearch: {
          type: "boolean",
          description: "回答是否需要最新网络信息（时效性数据/最新研究/新闻等）",
        },
        webQuery: {
          type: "string",
          description: "若 needsWebSearch 为 true，联网检索的搜索词；否则空字符串",
        },
      },
      required: [
        "reply",
        "canEdit",
        "editInstruction",
        "imageEdit",
        "imageQuery",
        "showImages",
        "imageQueries",
        "needsWebSearch",
        "webQuery",
      ],
    };

    const ans = await xiaopAskWithGrounding({
      contents,
      system,
      schema,
      images: photos.length ? photos : undefined,
      overrideSequence: toOverrideSlots(data.userModel),
    });
    await logChatUsage(ans, {
      draftId: data.draftId,
      draftTitle: draft.title,
      label: "小P对话（草稿）",
    });
    return harvestImageIntent(parseAgentReply(ans.text));
  });

const ApplyDraftAgentEditInput = z.object({
  draftId: z.string(),
  instruction: z.string().min(1).max(2000),
  scope: z.string().max(400).optional(),
  userModel: UserModelInput,
});

/** Apply an agreed edit: 小P rewrites the FULL draft HTML in place per the
 *  instruction (structure/style preserved). Auth-gated; returns the new HTML for
 *  the client to persist via saveDraftHtmlContentFn.
 *  scope === DRAFT_CARD_SCOPE 是**另一条路**：简介卡不在 html_content 里，改的是
 *  plant_drafts 的列，所以这里直接写库并返回改动清单（不返回 html）。 */
export const applyDraftAgentEditFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => ApplyDraftAgentEditInput.parse(input))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: draft } = await supabaseAdmin
      .from("plant_drafts")
      .select(
        "status,html_content,title,scientific_name,summary,common_names_zh,common_name_en,family,genus",
      )
      .eq("id", data.draftId)
      .maybeSingle();
    if (!draft) throw new Error("草稿不存在");
    if (draft.status === "approved") throw new Error("已收录的草稿不可再修改");

    // ── 简介卡：改字段，不改 HTML ─────────────────────────────────────────────
    if (data.scope === DRAFT_CARD_SCOPE) {
      const before = pickDraftCardFields(draft as Record<string, unknown>);
      const cardSystem = `你是「小P」，植物百科草稿的字段编辑器。你会收到一张「${DRAFT_CARD_SCOPE}」的当前内容和一条修改指令。
严格遵守：
1. 只改指令要求改的字段，其余字段**原样照抄**（一个字都不要动，包括标点）。
2. 拉丁学名只写「属名 + 种加词」（可含 subsp./var.），不要作者名、不要中文；中文名不要带「疑似」二字。
3. 摘要保持原有语气与长度量级（150–260 字的中文导语），不要改成形态罗列，不要编造事实。
4. 不确定的内容一律保留原值，宁可不改也不要猜。
5. 只返回 JSON 对象，键固定为：title、scientific_name、common_names_zh、common_name_en、family、genus、summary，全部为字符串（无内容用空字符串）。不要 markdown 代码块、不要解释。`;
      const cardSchema = {
        type: "object",
        properties: Object.fromEntries(
          DRAFT_CARD_FIELD_KEYS.map((k) => [
            k,
            { type: "string", description: DRAFT_CARD_FIELD_LABELS[k] },
          ]),
        ),
        required: [...DRAFT_CARD_FIELD_KEYS],
      };
      const { text: cardTxt } = await xiaopTextCall({
        contents: [
          {
            role: "user",
            parts: [
              {
                text: `修改指令：${data.instruction}\n\n当前${DRAFT_CARD_SCOPE}内容：\n${draftCardToText(before)}\n\n请按指令返回修改后的完整 JSON（未涉及的字段原样照抄）。`,
              },
            ],
          },
        ],
        system: cardSystem,
        schema: cardSchema,
        maxRetry: 2,
        overrideSequence: toOverrideSlots(data.userModel),
      });
      let parsed: Record<string, unknown>;
      try {
        parsed = JSON.parse(cleanJson(cardTxt)) as Record<string, unknown>;
      } catch {
        throw new Error("小P 返回的简介卡内容无法解析，请重试或换种说法。");
      }
      // 只接受**字符串**字段：模型漏字段、或给了 null/对象，都按「没提这一项」处理，
      // 用原值补齐 —— 决不能因为模型少说一句就把学名/摘要清空。
      const provided = Object.fromEntries(
        Object.entries(parsed).filter(([, v]) => typeof v === "string"),
      );
      const after = pickDraftCardFields({ ...before, ...provided });
      // 形状闸门：名称字段有过「模型把一整段元话语塞进 title」的先例（见 tentative.ts），
      // 这里按名称/摘要各自的合理量级封顶，清成空则退回原值。
      const capName = (v: string, fallback: string) => sanitizeSpeciesName(v) || fallback;
      after.title = capName(after.title, before.title);
      after.scientific_name = capName(after.scientific_name, before.scientific_name);
      after.common_names_zh = after.common_names_zh.slice(0, 200);
      after.common_name_en = after.common_name_en.slice(0, 200);
      after.family = after.family.slice(0, 60);
      after.genus = after.genus.slice(0, 60);
      after.summary = after.summary.slice(0, 2000);
      const changes = diffDraftCard(before, after);
      if (!changes.length) throw new Error("小P 这次没有改动简介卡的任何字段。");
      const { error: upErr } = await supabaseAdmin
        .from("plant_drafts")
        .update(after)
        .eq("id", data.draftId);
      if (upErr) throw new Error(`简介卡保存失败：${upErr.message}`);
      return { card: { before, after, changes } };
    }

    const original = draft.html_content || "";
    if (!/<\/html>/i.test(original)) throw new Error("草稿 HTML 不完整，无法自动修改。");

    const scopeLine = data.scope
      ? `本次修改只针对草稿的「${data.scope}」部分，其余部分一律原样保留。`
      : "按指令在整份草稿范围内修改，未涉及的内容一律原样保留。";
    const system = `你是「小P」，植物百科页面的 HTML 编辑器。你会收到一份完整的 HTML 文档和一条修改指令。
${scopeLine}
严格遵守：
1. 只按指令修改相关内容，其余所有文字、结构、版式、class、内联样式 (style/CSS)、<script>、图片 src 一律原样保留。
2. 不要改动 <head>、<style>、<script>，不要重排版式，不要新增/删除区块（除非指令明确要求）。
3. 输出必须是【完整且合法】的 HTML 文档：以 <!DOCTYPE html> 或 <html 开头，以 </html> 结尾。
4. 只输出 HTML 本身，不要 markdown 代码块、不要任何解释或前后缀文字。`;

    const contents: { role: "user" | "model"; parts: { text: string }[] }[] = [
      {
        role: "user",
        parts: [
          {
            text: `修改指令：${data.instruction}\n\n以下是完整 HTML 文档，请按指令返回修改后的完整 HTML：\n${original}`,
          },
        ],
      },
    ];

    const { text: txt } = await xiaopTextCall({
      contents,
      system,
      maxRetry: 2,
      overrideSequence: toOverrideSlots(data.userModel),
    });
    let html = txt.trim();
    if (html.startsWith("```")) {
      html = html
        .replace(/^```html\s*/i, "")
        .replace(/^```\s*/, "")
        .replace(/```$/, "")
        .trim();
    }
    if (!/<\/html>/i.test(html)) {
      throw new Error("小P 生成的内容不完整，请重试或换种说法。");
    }
    return { html };
  });

// ─── 小P 已发布详情页助手 (editor-only) ──────────────────────────────────────
// On a published HTML plant page an editor can chat with 小P about the page and,
// when they agree, have it rewrite the page HTML — optionally scoped to a section
// (annotation). The client then uploads the new HTML + writes a detailed
// plant_edits record so the change is auditable / revertable.

async function fetchPlantPageText(plantId: string): Promise<{
  title: string;
  scientific_name: string;
  html: string;
  html_url: string;
  cover_url: string | null;
}> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data: plant } = await supabaseAdmin
    .from("plants")
    .select("title,scientific_name,content_type,html_url,cover_url")
    .eq("id", plantId)
    .maybeSingle();
  if (!plant) throw new Error("条目不存在");
  if (plant.content_type !== "html" || !plant.html_url) {
    throw new Error("该条目不是 HTML 详情页，暂不支持小P改写。");
  }
  const r = await fetch(plant.html_url);
  if (!r.ok) throw new Error(`无法读取页面 HTML：${r.status}`);
  const html = await r.text();
  return {
    title: plant.title ?? "",
    scientific_name: plant.scientific_name ?? "",
    html,
    html_url: plant.html_url,
    cover_url: (plant as { cover_url?: string | null }).cover_url ?? null,
  };
}

// ─── 通用页面对话（全站那只小P蛙）───────────────────────────────────────────
//
// 与 askDraftAgentFn / askPlantAgentFn 的分工：
//   · 那两个从**库里**读正文（草稿行 / 已发布 HTML），因此能改稿、能换图；
//   · 本函数处理的是**任何一个页面**（识别页、名录、探索、博客、个人主页…），
//     库里根本没有对应的「正文」，所以正文由客户端从 DOM 抓一段送上来。
//
// **刻意不给它落地修改的能力**：能改的页面（草稿 / 已发布条目）各自挂着专用面板，
// 那两条路带着 scope 标注、改写、写 plant_edits、可撤销的一整套。让一个拿不到
// 页面数据源的通用通道去「改页面」，只会写出改不到实处、也无法回滚的东西。
// 所以这里 canEdit 恒为 false，并在 system 里明确告诉模型该把用户引到哪儿去改。
const AskPageAgentInput = z.object({
  /** 当前路由，如 /identify、/plants/xxx。给模型判断用户正在看什么。 */
  path: z.string().max(300),
  pageTitle: z.string().max(300).optional(),
  /** 客户端从 DOM 抓的页面可见文本。截断由客户端做，这里只兜一个上限。 */
  pageText: z.string().max(12000),
  question: z.string().min(1).max(2000),
  history: z
    .array(z.object({ role: z.enum(["user", "assistant"]), text: z.string() }))
    .max(24)
    .optional(),
  userModel: UserModelInput,
});

/**
 * 全站小P蛙的对话通道：针对**当前这一页**（以及植物学常识）回答。
 *
 * 登录才可用 —— 与另外两条对话通道一致，避免匿名流量直接烧默认模型的 token。
 */
export const askPageAgentFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => AskPageAgentInput.parse(input))
  .handler(async ({ data }) => {
    const where = data.pageTitle ? `${data.pageTitle}（${data.path}）` : data.path;
    const system = `你是「小P蛙」，Plantspedia（鄂尔多斯植物百科）的双语助手，正在陪用户看站内的一个页面：${where}。
职责：
- 用【中文】回答用户关于**这一页内容**的问题；页面文本没写到的，可以用植物学常识补充，但要说清哪些是页面上的、哪些是你的补充；不确定就如实说，不要编造。
- 用户问的若是「这个网站怎么用 / 这一页是干什么的」，就依据页面文本解释。
- 如果用户想**修改内容**：站内可直接改的只有两种页面 —— 植物条目详情页（/plants/…）和草稿页（/drafts/…）。请告诉他去那一页找小P蛙，那里的我能改写并保存。其余页面（识别页、名录、探索页等）属于站点功能界面，我改不了，别答应做不到的事。
- 如果用户想「看某个物种的网络参考照片」，把 showImages 设为 true，把物种放进 imageQueries 数组（优先拉丁学名，最多 4 个）。**你具备这个能力，不要说"我无法联网/无法发图"**。
- 如果准确回答需要【最新网络信息】（保护级别、新研究、时效性数据等），把 needsWebSearch 设为 true 并在 webQuery 给出简洁检索词；纯常识不必联网，设 false、webQuery 留空。
- canEdit 恒为 false，editInstruction 留空。
回答简明。
【输出格式·务必严格】只返回一个 JSON 对象，键名固定为：reply（字符串）、canEdit（布尔）、editInstruction（字符串）、showImages（布尔）、imageQueries（字符串数组）、needsWebSearch（布尔）、webQuery（字符串）。不要加 markdown 代码块或多余文字。`;

    const pageText = data.pageText.trim();
    const contents: ChatContents = [
      {
        role: "user",
        parts: [
          {
            text: pageText
              ? `【当前页面：${where}】\n以下是页面上的可见文本：\n${pageText}`
              : `【当前页面：${where}】\n（这一页没有可提取的正文，多半是操作界面。请据路径与用户提问作答。）`,
          },
        ],
      },
      { role: "model", parts: [{ text: "好的，我看到这一页了。想问什么？" }] },
      ...(data.history || []).map((h) => ({
        role: (h.role === "assistant" ? "model" : "user") as "user" | "model",
        parts: [{ text: h.text }],
      })),
      { role: "user", parts: [{ text: data.question }] },
    ];

    const schema = {
      type: "object",
      properties: {
        reply: { type: "string" },
        canEdit: { type: "boolean" },
        editInstruction: { type: "string" },
        showImages: { type: "boolean" },
        imageQueries: { type: "array", items: { type: "string" } },
        needsWebSearch: { type: "boolean" },
        webQuery: { type: "string" },
      },
      required: [
        "reply",
        "canEdit",
        "editInstruction",
        "showImages",
        "imageQueries",
        "needsWebSearch",
        "webQuery",
      ],
    };

    const ans = await xiaopAskWithGrounding({
      contents,
      system,
      schema,
      overrideSequence: toOverrideSlots(data.userModel),
    });
    await logChatUsage(ans, { draftTitle: data.pageTitle ?? data.path, label: "小P对话（页面）" });
    // 这条通道落不了地，无论模型怎么说都不给「采纳并保存」按钮。
    const parsed = harvestImageIntent(parseAgentReply(ans.text));
    return { ...parsed, canEdit: false, editInstruction: "", imageEdit: false };
  });

const AskPlantAgentInput = z.object({
  plantId: z.string(),
  question: z.string().min(1).max(2000),
  scope: z.string().max(400).optional(), // annotation: which section/issue to focus on
  history: z
    .array(z.object({ role: z.enum(["user", "assistant"]), text: z.string() }))
    .max(24)
    .optional(),
  userModel: UserModelInput,
});

/** Chat with 小P about a published plant page. */
export const askPlantAgentFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => AskPlantAgentInput.parse(input))
  .handler(async ({ data }) => {
    const { title, scientific_name, html, html_url, cover_url } = await fetchPlantPageText(
      data.plantId,
    );
    const docText = htmlToText(html);
    // Scope-aware vision: when the editor has annotated a section, only feed THAT
    // section's images; on 整页 (no scope) feed every page image (cover first).
    const visionUrls = xiaopVisionUrls({
      html,
      baseUrl: html_url,
      scope: data.scope,
      coverUrl: cover_url,
    });
    const photos = await fetchInlineImages(visionUrls);
    const scopeLine = data.scope
      ? `编辑本轮把讨论范围限定在：「${data.scope}」。请只围绕这一处回答与建议。`
      : "本轮未限定范围，针对整页内容回答。";
    const system = `你是「小P蛙」，Plantspedia（鄂尔多斯植物百科）的双语审稿助手，正在协助编辑校对一份【已发布】的植物详情页。
${scopeLine}
职责：
- 用【中文】回答编辑关于该页面的问题，给出基于植物学常识的核对与修改建议；不确定时如实说明，不要编造；
- ${
      photos.length
        ? `本条消息附带了${data.scope ? `「${data.scope}」这一分区` : "本页"}的实际配图，共 ${photos.length} 张（按页面中出现的先后顺序排列）。涉及物种鉴定、或编辑问「配图对不对/有没有错配」时，请【逐张把照片与正文描述相互核对】：判断每一张是否确为本页所述物种，指出与描述矛盾的可见特征（如叶序单叶/复叶、叶形、花色花数、果实形态、有无刺毛等）；若发现张冠李戴，请明确说是第几张、错在哪、疑似为何物种。文本仅作参考，以图为准；`
        : "（本轮没有可用的配图，仅能依据文本判断，请说明这一点）"
    }
- 如果编辑的诉求是一处「可以直接落地到页面里的具体修改」，把 canEdit 设为 true，并在 editInstruction 里用一句中文精确描述要做的改动（具体到改哪里、改成什么）；范围已限定时，改动只应涉及该范围。
  **你可以直接落地这些文字改动**——编辑点一下「采纳并保存」即由你改写并保存上线，不要说"交给技术同事/他人执行"。
- 如果诉求是「更换 / 增补配图」，把 canEdit 设为 true、imageEdit 设为 true，imageQuery 给出图片搜索词（通常用拉丁学名），
  editInstruction 说明要替换哪张图。系统会调起站内"在线搜图"让编辑挑图后自动替换，同样不要说交给别人。
- 如果编辑想「看该物种的网络参考照片来比对」，把 showImages 设为 true，把要展示的物种放进 imageQueries 数组（优先拉丁学名）；
  **对比多个物种时 imageQueries 要含每一个**（如 ["Tribulus terrestris","Tripodion tetraphyllum"]）。系统会联网按每个词分别取照片分组显示。
  **你具备这个能力，不要说"我无法联网/无法发图"**。
- 否则上述布尔全部设为 false、editInstruction 留空、imageQueries 用空数组。
- 如果准确回答需要【最新网络信息】（如某物种最新的保护级别/最新研究进展/新闻/时效性数据等，且你的内置知识可能过时），把 needsWebSearch 设为 true 并在 webQuery 给出简洁检索词（可用拉丁学名）；纯常识不必联网，设 false、webQuery 留空。
回答简明。
【输出格式·务必严格】只返回一个 JSON 对象，键名固定为：reply（字符串）、canEdit（布尔）、editInstruction（字符串）、imageEdit（布尔）、imageQuery（字符串）、showImages（布尔）、imageQueries（字符串数组）、needsWebSearch（布尔）、webQuery（字符串）。不要用 response 等其它键名，不要加 markdown 代码块或多余文字。`;

    const contents: ChatContents = [
      {
        role: "user",
        parts: [
          {
            text: `【已发布详情页：${title}${scientific_name ? "（" + scientific_name + "）" : ""}】\n以下是页面正文纯文本：\n${docText}`,
          },
        ],
      },
      { role: "model", parts: [{ text: "好的，我已读完这页内容。请问要核对或修改哪里？" }] },
      ...(data.history || []).map((h) => ({
        role: (h.role === "assistant" ? "model" : "user") as "user" | "model",
        parts: [{ text: h.text }],
      })),
      { role: "user", parts: [{ text: data.question }] },
    ];

    const schema = {
      type: "object",
      properties: {
        reply: { type: "string" },
        canEdit: { type: "boolean" },
        editInstruction: { type: "string" },
        imageEdit: { type: "boolean" },
        imageQuery: { type: "string" },
        showImages: { type: "boolean" },
        imageQueries: { type: "array", items: { type: "string" } },
        needsWebSearch: { type: "boolean" },
        webQuery: { type: "string" },
      },
      required: [
        "reply",
        "canEdit",
        "editInstruction",
        "imageEdit",
        "imageQuery",
        "showImages",
        "imageQueries",
        "needsWebSearch",
        "webQuery",
      ],
    };

    const ans = await xiaopAskWithGrounding({
      contents,
      system,
      schema,
      images: photos.length ? photos : undefined,
      overrideSequence: toOverrideSlots(data.userModel),
    });
    await logChatUsage(ans, { draftTitle: title, label: "小P对话（详情页）" });
    return harvestImageIntent(parseAgentReply(ans.text));
  });

const ApplyPlantAgentEditInput = z.object({
  plantId: z.string(),
  instruction: z.string().min(1).max(2000),
  scope: z.string().max(400).optional(),
  userModel: UserModelInput,
});

/** 小P rewrites the full published-page HTML per the instruction (scope optional).
 *  Returns { html, oldHtml } — the client persists it (storage + plants.html_url)
 *  and logs a detailed plant_edits record. Auth-gated. */
export const applyPlantAgentEditFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => ApplyPlantAgentEditInput.parse(input))
  .handler(async ({ data }) => {
    const { html: original } = await fetchPlantPageText(data.plantId);
    if (!/<\/html>/i.test(original)) throw new Error("页面 HTML 不完整，无法自动修改。");

    const scopeLine = data.scope
      ? `本次修改只针对：「${data.scope}」，页面其余部分一律原样保留。`
      : "按指令在整页范围内修改，未涉及的内容一律原样保留。";
    const system = `你是「小P蛙」，植物百科页面的 HTML 编辑器。你会收到一份完整的 HTML 文档和一条修改指令。
${scopeLine}
严格遵守：
1. 只按指令修改相关内容，其余所有文字、结构、版式、class、内联样式 (style/CSS)、<script>、data-* 属性、图片 src 一律原样保留。
2. 不要改动 <head>、<style>、<script>，不要重排版式，不要新增/删除区块（除非指令明确要求），尤其要保留页面里的 data-edit-id / lov-edit-mark 等编辑标记。
3. 输出必须是【完整且合法】的 HTML 文档：以 <!DOCTYPE html> 或 <html 开头，以 </html> 结尾。
4. 只输出 HTML 本身，不要 markdown 代码块、不要任何解释。`;

    const contents: ChatContents = [
      {
        role: "user",
        parts: [
          {
            text: `修改指令：${data.instruction}\n\n以下是完整 HTML 文档，请按指令返回修改后的完整 HTML：\n${original}`,
          },
        ],
      },
    ];

    const { text: txt } = await xiaopTextCall({
      contents,
      system,
      maxRetry: 2,
      overrideSequence: toOverrideSlots(data.userModel),
    });
    let html = txt.trim();
    if (html.startsWith("```")) {
      html = html
        .replace(/^```html\s*/i, "")
        .replace(/^```\s*/, "")
        .replace(/```$/, "")
        .trim();
    }
    if (!/<\/html>/i.test(html)) throw new Error("小P 生成的内容不完整，请重试或换种说法。");
    return { html, oldHtml: original };
  });

// ─── Admin: 小P model config CRUD (key `xiaop_model_config`) ─────────────────

const SaveXiaoPConfigInput = z.object({
  provider: z.enum(["gemini", "openai", "anthropic", "custom"]),
  apiKey: z.string().min(1).max(4000), // may hold a comma/newline separated Gemini key POOL
  model: z.string().min(1).max(200),
  baseUrl: z.string().url().optional().or(z.literal("")),
});

export const saveXiaoPConfigFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => SaveXiaoPConfigInput.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: roles } = await supabase.from("user_roles").select("role").eq("user_id", userId);
    if (!(roles?.some((r) => r.role === "admin") ?? false))
      throw new Error("仅管理员可修改小P配置");

    const configValue = {
      provider: data.provider,
      apiKey: normalizeApiKey(data.provider, data.apiKey),
      model: (data.model ?? "").trim(),
      baseUrl: normalizeBaseUrl(data.baseUrl) || null,
      updatedAt: new Date().toISOString(),
      updatedBy: userId,
    };
    const { error } = await (supabaseAdmin as any)
      .from("site_config")
      .upsert({ key: "xiaop_model_config", value: configValue }, { onConflict: "key" });
    if (error) throw new Error(`保存配置失败：${error.message}`);
    return { ok: true };
  });

// ─── Live model discovery — list the models a key can actually use ───────────
// The console's model dropdown is otherwise a hard-coded preset list, so newer
// models never appear. This queries the provider's own "list models" endpoint
// (server-side to dodge browser CORS) with the entered key.

const ListModelsInput = z.object({
  provider: z.enum(["gemini", "openai", "anthropic", "custom"]),
  apiKey: z.string().min(1).max(2000),
  baseUrl: z.string().max(300).optional().or(z.literal("")),
});

/** Never echo a full key back into an error toast — the panel renders it verbatim. */
function maskKey(k: string): string {
  return k.length <= 10 ? "…" : `${k.slice(0, 4)}…${k.slice(-4)}`;
}

function dedupSortModels(a: string[]): string[] {
  return [...new Set(a.filter(Boolean))].sort((x, y) => x.localeCompare(y));
}

export const listProviderModelsFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => ListModelsInput.parse(input))
  .handler(async ({ data }): Promise<{ models: string[] }> => {
    // The console keeps ONE key pool shared across providers, so the pool routinely
    // holds keys belonging to other vendors (a Gemini "AQ.…" sitting above a Moonshot
    // "sk-…"). Probing only pool[0] then reports that vendor's 401 as if the whole
    // config were broken. Try each key in priority order and take the first that works.
    const keyPool = normalizeApiKey(data.provider, data.apiKey)
      .split(",")
      .map((k) => k.trim())
      .filter(Boolean)
      .slice(0, 6);
    if (!keyPool.length) throw new Error("请先填写 API Key，再拉取可用模型");
    const base = normalizeBaseUrl(data.baseUrl);

    const probe = async (key: string): Promise<string[]> => {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 20_000);
      const fail = async (label: string, r: Response) => {
        throw new Error(
          `${label} 拉取失败（HTTP ${r.status}）：${(await r.text().catch(() => "")).slice(0, 180)}`,
        );
      };
      try {
        if (data.provider === "gemini") {
          const root = base || "https://generativelanguage.googleapis.com/v1beta";
          const r = await fetch(`${root}/models?key=${encodeURIComponent(key)}&pageSize=1000`, {
            signal: ctrl.signal,
          });
          if (!r.ok) await fail("Gemini", r);
          const j: any = await r.json();
          return (j.models || [])
            .filter((m: any) => (m.supportedGenerationMethods || []).includes("generateContent"))
            .map((m: any) => String(m.name || "").replace(/^models\//, ""));
        }
        if (data.provider === "anthropic") {
          const root = base || "https://api.anthropic.com/v1";
          const r = await fetch(`${root}/models?limit=1000`, {
            signal: ctrl.signal,
            headers: { "x-api-key": key, "anthropic-version": "2023-06-01" },
          });
          if (!r.ok) await fail("Anthropic", r);
          const j: any = await r.json();
          return (j.data || []).map((m: any) => String(m.id || ""));
        }
        // openai / custom — the OpenAI-compatible GET /models endpoint.
        const root = base || "https://api.openai.com/v1";
        const r = await fetch(`${root}/models`, {
          signal: ctrl.signal,
          headers: { Authorization: `Bearer ${key}` },
        });
        if (!r.ok) await fail("模型", r);
        const j: any = await r.json();
        const list = Array.isArray(j.data) ? j.data : Array.isArray(j) ? j : [];
        return list.map((m: any) => String(m.id || m.name || ""));
      } catch (e) {
        if ((e as Error)?.name === "AbortError")
          throw new Error("拉取模型超时，请检查网络 / 中转地址（国内可能需挂 VPN）。");
        throw e instanceof Error ? e : new Error("拉取模型失败");
      } finally {
        clearTimeout(timer);
      }
    };

    const errors: string[] = [];
    for (const [i, key] of keyPool.entries()) {
      try {
        return { models: dedupSortModels(await probe(key)) };
      } catch (e) {
        errors.push(
          `Key ${i + 1}（${maskKey(key)}）：${e instanceof Error ? e.message : String(e)}`,
        );
      }
    }
    throw new Error(
      keyPool.length === 1
        ? errors[0]
        : `${keyPool.length} 个 Key 都拉不到模型 —— 这个接口只认它自己的 Key，池子里若混着别家的 Key，那几个报 401 属正常。\n${errors.join("\n")}`,
    );
  });

export const getXiaoPConfigFn = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: roles } = await supabase.from("user_roles").select("role").eq("user_id", userId);
    if (!(roles?.some((r) => r.role === "admin") ?? false))
      throw new Error("仅管理员可查看小P配置");

    const { data } = await (supabaseAdmin as any)
      .from("site_config")
      .select("value")
      .eq("key", "xiaop_model_config")
      .maybeSingle();
    if (!data?.value) return null;
    const cfg = typeof data.value === "string" ? JSON.parse(data.value) : data.value;
    const xkeys = cfg.apiKey ? String(cfg.apiKey).split(",").filter(Boolean) : [];
    const xmask = (k: string) => (k.length <= 10 ? k : `${k.slice(0, 4)}…${k.slice(-4)}`);
    const masked =
      xkeys.length > 1
        ? `${xkeys.map(xmask).join(" · ")}（共 ${xkeys.length} 个 key）`
        : xkeys[0]
          ? xmask(xkeys[0])
          : "";
    return {
      provider: cfg.provider as string,
      model: cfg.model as string,
      baseUrl: cfg.baseUrl as string | null,
      apiKeyMasked: masked,
      // Full keys (admin-only) for the console's drag-reorder UI. Shown in plain text.
      apiKeys: xkeys as string[],
      updatedAt: cfg.updatedAt as string | null,
    };
  });

export const clearXiaoPConfigFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: roles } = await supabase.from("user_roles").select("role").eq("user_id", userId);
    if (!(roles?.some((r) => r.role === "admin") ?? false))
      throw new Error("仅管理员可修改小P配置");
    await (supabaseAdmin as any).from("site_config").delete().eq("key", "xiaop_model_config");
    return { ok: true };
  });

// ─── Public contributor-column stats (server-aggregated, bypasses RLS) ──────
// Homepage visitors are anonymous and can't read user_roles/profiles directly,
// so we aggregate with the admin client and return only the public-facing stats.
export const fetchEditorColumnFn = createServerFn({ method: "GET" }).handler(async () => {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { aggregateEditorColumn } = await import("./editor-stats");
  const [roles, edits, drafts, blogs] = await Promise.all([
    supabaseAdmin.from("user_roles").select("user_id, role").in("role", ["editor", "admin"]),
    supabaseAdmin.from("plant_edits").select("editor_id, kind, reverted"),
    supabaseAdmin.from("plant_drafts").select("created_by, capture_place"),
    supabaseAdmin.from("blog_posts").select("author_id, published"),
  ]);
  const ids = Array.from(new Set((roles.data ?? []).map((r) => r.user_id))).filter(Boolean);
  const profiles = ids.length
    ? ((
        await supabaseAdmin
          .from("profiles")
          .select("id, display_name, avatar_url, created_at")
          .in("id", ids)
      ).data ?? [])
    : [];
  return aggregateEditorColumn({
    roles: roles.data ?? [],
    profiles,
    edits: edits.data ?? [],
    drafts: drafts.data ?? [],
    blogs: blogs.data ?? [],
  });
});

// Public editor page: a contributor's profile header + all their works.
// Admin client so anonymous visitors can read it despite RLS on user data.
const EditorPublicInput = z.object({ editorId: z.string().uuid() });

export const fetchEditorPublicFn = createServerFn({ method: "GET" })
  .inputValidator((input) => EditorPublicInput.parse(input))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { formatActivityAreas } = await import("./editor-stats");
    const id = data.editorId;
    const [prof, plants, blogs, drafts] = await Promise.all([
      supabaseAdmin.from("profiles").select("*").eq("id", id).maybeSingle(),
      supabaseAdmin
        .from("plants")
        .select("id, slug, title, scientific_name, cover_url, created_at")
        .eq("author_id", id)
        .order("created_at", { ascending: false }),
      supabaseAdmin
        .from("blog_posts")
        .select("id, slug, title, subtitle, cover_url, content_html, published_at")
        .eq("author_id", id)
        .eq("published", true)
        .order("published_at", { ascending: false }),
      supabaseAdmin
        .from("plant_drafts")
        .select(
          "id, title, scientific_name, photo_url, status, published_plant_id, capture_place, created_at",
        )
        .eq("created_by", id)
        .order("created_at", { ascending: false }),
    ]);
    const draftRows = drafts.data ?? [];
    const p = prof.data as {
      display_name: string | null;
      avatar_url: string | null;
      created_at: string;
      bio?: string | null;
    } | null;
    return {
      profile: p
        ? {
            display_name: p.display_name,
            avatar_url: p.avatar_url,
            created_at: p.created_at,
            bio: (p as { bio?: string | null }).bio ?? null,
          }
        : null,
      plants: plants.data ?? [],
      // Resolve each blog's cover: explicit cover_url, else the first <img> in the
      // body (matches blogCoverUrl on the blog index). Strip the heavy content_html
      // from the payload — we only need the derived thumbnail.
      blogs: (blogs.data ?? []).map((b: Record<string, unknown>) => {
        const { content_html, ...rest } = b;
        const firstImg =
          typeof content_html === "string"
            ? (content_html.match(/<img\b[^>]*\bsrc\s*=\s*["']([^"']+)["']/i)?.[1] ?? null)
            : null;
        return { ...rest, cover_url: (b.cover_url as string | null) || firstImg };
      }),
      drafts: draftRows,
      areas: formatActivityAreas(draftRows.map((dr) => dr.capture_place)),
    };
  });

// ─── Log a draft edit by a signed-in editor (powers the "blue circle" stat) ──
// Records image/text edits made while reviewing AI drafts. Auth-gated so only a
// real signed-in user is attributed; anonymous draft edits are not counted.
const LogDraftEditInput = z.object({
  draftId: z.string().uuid(),
  kind: z.enum(["draft_image", "draft_text"]),
  // Optional richer log: a human summary + before/after full-HTML snapshots so the
  // bottom-of-page 修改记录 can show detail and the editor can revert this change.
  summary: z.string().max(800).optional(),
  beforeHtml: z.string().optional(),
  afterHtml: z.string().optional(),
  source: z.string().max(40).optional(),
});

export const logDraftEditFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => LogDraftEditInput.parse(input))
  .handler(async ({ data, context }) => {
    const { userId } = context;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: prof } = await supabaseAdmin
      .from("profiles")
      .select("display_name")
      .eq("id", userId)
      .maybeSingle();
    const { data: draft } = await supabaseAdmin
      .from("plant_drafts")
      .select("title")
      .eq("id", data.draftId)
      .maybeSingle();
    const verb = data.kind === "draft_image" ? "更改了草稿配图" : "修改了草稿文字";
    await supabaseAdmin.from("plant_edits").insert({
      plant_id: null,
      // Tag the row to this draft (no schema change needed) so the draft's change
      // log can query it: block_path = `draft:<id>`.
      block_path: `draft:${data.draftId}`,
      editor_id: userId,
      editor_name: prof?.display_name ?? "编辑",
      kind: data.kind,
      marker_n: 0,
      source: data.source ?? "draft_editor",
      summary: data.summary ?? `${verb}：${draft?.title ?? data.draftId.slice(0, 8)}`,
      before_html: data.beforeHtml ?? null,
      after_html: data.afterHtml ?? null,
    });
    return { ok: true };
  });

const RevertDraftEditInput = z.object({ editId: z.string().uuid() });

/** Editor-only: revert a draft change by restoring the draft's html_content to the
 *  edit's `before_html` snapshot, and mark the edit reverted. */
export const revertDraftEditFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => RevertDraftEditInput.parse(input))
  .handler(async ({ data, context }) => {
    const { userId } = context;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: roles } = await supabaseAdmin
      .from("user_roles")
      .select("role")
      .eq("user_id", userId);
    const isEditor = roles?.some((r) => r.role === "editor" || r.role === "admin") ?? false;
    if (!isEditor) throw new Error("仅编辑可撤销修改");

    const { data: edit } = await supabaseAdmin
      .from("plant_edits")
      .select("id,block_path,before_html,reverted")
      .eq("id", data.editId)
      .maybeSingle();
    if (!edit) throw new Error("找不到该修改记录");
    if (edit.reverted) throw new Error("该修改已撤销");
    const bp = edit.block_path ?? "";
    if (!bp.startsWith("draft:")) throw new Error("该记录不属于草稿");
    if (!edit.before_html) throw new Error("缺少修改前快照，无法撤销");
    const draftId = bp.slice("draft:".length);

    const { error: upErr } = await supabaseAdmin
      .from("plant_drafts")
      .update({ html_content: edit.before_html })
      .eq("id", draftId);
    if (upErr) throw new Error(`撤销失败：${upErr.message}`);

    await supabaseAdmin
      .from("plant_edits")
      .update({ reverted: true, reverted_by: userId, reverted_at: new Date().toISOString() })
      .eq("id", data.editId);
    return { ok: true };
  });

const ExtractMetaInput = z.object({
  htmlUrl: z.string().url().optional(),
  html: z.string().optional(),
});

function htmlToText(html: string): string {
  const noHead = html.replace(/<head[\s\S]*?<\/head>/gi, " ");
  const noScripts = noHead
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ");
  const bodyMatch = noScripts.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
  const body = bodyMatch ? bodyMatch[1] : noScripts;
  const text = body
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
  return text.slice(0, 30000);
}

export const extractPlantMetaFn = createServerFn({ method: "POST" })
  .inputValidator((input) => ExtractMetaInput.parse(input))
  .handler(async ({ data }) => {
    let raw = data.html;
    if (!raw && data.htmlUrl) {
      const r = await fetch(data.htmlUrl);
      if (!r.ok) throw new Error(`无法获取 HTML：${r.status}`);
      raw = await r.text();
    }
    if (!raw) throw new Error("缺少 htmlUrl 或 html");

    const text = htmlToText(raw);

    const geminiKey = process.env.GEMINI_API_KEY;
    const openaiKey = process.env.OPENAI_API_KEY;
    const lovableKey = process.env.LOVABLE_API_KEY;

    // Pool = admin-configured Gemini keys (site_config) + the env key, deduped —
    // batch extraction fires many requests, so rely on the rotating pool instead
    // of a single env key that 429s after the first few.
    // 走「优先调用序列」里的所有 Gemini 项（这条链路是 Gemini 专用），再并上 .env 的
    // key 兜底。以前只取 aiCfg（= 序列 1），序列 1 额度用尽这个工具就整个不可用了。
    const { sequence: aiSequence } = await loadAiQueue();
    const geminiPool = Array.from(
      new Set([
        ...aiSequence
          .filter((x) => x.provider === "gemini")
          .flatMap((x) => splitGeminiKeys(x.apiKey)),
        ...splitGeminiKeys(geminiKey),
      ]),
    );

    const systemPrompt = `你是植物信息抽取助手。给定一个植物图鉴页面的纯文本，
严格只通过 JSON 结构返回结果。规则：
- title：植物中文名称。优先取页面 H1/标题/中文名，找不到留空。
- scientific_name：拉丁学名（含命名人，如 "Butomus umbellatus L."）。找不到留空。
- common_name_en：英文俗名 / common name（例如 "Flowering rush"）。优先取页面中明确标注的 common name / English name；
  若同时给出多个，挑选最常用的一个；找不到留空字符串。
- slug：基于「拉丁学名」生成的 URL 友好字符串。**必须只包含 ASCII 小写字母、数字、连字符**，
  绝对禁止出现任何中文、空格或其他 Unicode 字符（例如正确："butomus-umbellatus"；错误："花蔺-butomus"）。
  若无法从拉丁学名生成合法 ASCII slug，则返回空字符串。
- family：**仅科（family）**。中文+拉丁，例如 "花蔺科 Butomaceae"。
  绝对禁止把属写进这个字段。如果原文写成 "花蔺科 Butomaceae 花蔺属 Butomus"，
  本字段只能填 "花蔺科 Butomaceae"，属必须单独写进 genus。
- genus：**仅属（genus）**。中文+拉丁，例如 "花蔺属 Butomus"。
  如果原文里科属写在一起，必须把属拆出来填到这里；
  如果原文没有属，但拉丁学名首词是属名，请补全为 "<中文属名> <属>" 或至少返回 "<属>"。
  绝对不要留空，除非确实无法判断。
- habitat：本字段实际表示「物种入侵 Invasion」信息。
  若页面提及该物种在某些区域构成入侵（invasive / 入侵 / 归化 / 外来入侵 等），写一句简短中文说明：在哪些国家/地区构成入侵；
  若页面没有任何入侵相关记载，必须填写固定字符串 "无记录"。不要写普通的生境/分布。
- tags：标签数组，自动包含可识别到的：年限（一年生/二年生/多年生）、关键生境词（湿地/水生/旱生/草本/木本等）、IUCN 评级（LC/NT/VU/EN/CR/DD）、入侵相关词（invasive/入侵物种 等，若适用）。
- iucn_status：仅当原文明确写出 IUCN 评级时填入对应代码（EX/EW/CR/EN/VU/NT/LC/DD），找不到则返回空字符串。
- summary：植物简介，150-250 字。优先抽取页面"简介/概述/描述/Introduction/Description"段落原文，去除标签；找不到则基于全文摘要。
找不到的字段返回空字符串或空数组（habitat 例外，按上面规则填 "无记录"），不要编造。`;

    if (geminiPool.length > 0) {
      const model =
        aiSequence.find((x) => x.provider === "gemini")?.model ||
        process.env.AI_MODEL ||
        "gemini-3-flash-preview";
      const schema = {
        type: "object",
        properties: {
          title: { type: "string" },
          scientific_name: { type: "string" },
          common_name_en: { type: "string" },
          slug: { type: "string" },
          family: { type: "string" },
          genus: { type: "string" },
          habitat: { type: "string" },
          tags: { type: "array", items: { type: "string" } },
          iucn_status: { type: "string" },
          summary: { type: "string" },
        },
        required: [
          "title",
          "scientific_name",
          "common_name_en",
          "slug",
          "family",
          "genus",
          "habitat",
          "tags",
          "iucn_status",
          "summary",
        ],
      };

      const res = await callGeminiWithRotation(geminiPool, {
        model,
        label: "AI Extract",
        timeoutMs: 30_000,
        body: {
          contents: [{ role: "user", parts: [{ text: `以下是页面正文文本：\n\n${text}` }] }],
          systemInstruction: {
            parts: [{ text: systemPrompt }],
          },
          generationConfig: {
            responseMimeType: "application/json",
            responseSchema: schema,
          },
        },
      });
      const txt = res.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!txt) throw new Error("Gemini 未返回有效文本");
      return JSON.parse(cleanJson(txt));
    }

    if (openaiKey) {
      const apiBase =
        process.env.OPENAI_API_BASE || process.env.AI_API_BASE || "https://api.openai.com/v1";
      const model = process.env.OPENAI_MODEL || process.env.AI_MODEL || "gpt-4o-mini";

      const resp = await fetch(`${apiBase}/chat/completions`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${openaiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model,
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: `以下是页面正文文本：\n\n${text}` },
          ],
          response_format: { type: "json_object" },
        }),
      });

      if (!resp.ok) {
        const t = await resp.text();
        console.error("OpenAI API Error in extractPlantMetaFn:", resp.status, t);
        throw new Error(`OpenAI 提取失败 (HTTP ${resp.status})`);
      }

      const res = await resp.json();
      const content = res.choices?.[0]?.message?.content;
      if (!content) throw new Error("OpenAI 未返回内容");
      return JSON.parse(cleanJson(content));
    }

    if (lovableKey) {
      const resp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${lovableKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "google/gemini-3-flash-preview",
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: `以下是页面正文文本：\n\n${text}` },
          ],
          tools: [
            {
              type: "function",
              function: {
                name: "extract_plant_meta",
                description: "返回从植物页面抽取出的结构化信息",
                parameters: {
                  type: "object",
                  properties: {
                    scientific_name: { type: "string" },
                    title: { type: "string" },
                    common_name_en: { type: "string" },
                    slug: { type: "string" },
                    family: { type: "string" },
                    genus: { type: "string" },
                    habitat: { type: "string" },
                    tags: { type: "array", items: { type: "string" } },
                    iucn_status: { type: "string" },
                    summary: { type: "string" },
                  },
                  required: [
                    "title",
                    "scientific_name",
                    "common_name_en",
                    "slug",
                    "family",
                    "genus",
                    "habitat",
                    "tags",
                    "iucn_status",
                    "summary",
                  ],
                  additionalProperties: false,
                },
              },
            },
          ],
          tool_choice: { type: "function", function: { name: "extract_plant_meta" } },
        }),
      });

      if (!resp.ok) {
        const t = await resp.text();
        console.error("Lovable API Error in extractPlantMetaFn:", resp.status, t);
        throw new Error(`Lovable 提取失败 (HTTP ${resp.status})`);
      }

      const res = await resp.json();
      const call = res.choices?.[0]?.message?.tool_calls?.[0];
      const args = call?.function?.arguments;
      if (!args) throw new Error("AI 未返回结构化结果");
      return typeof args === "string" ? JSON.parse(args) : args;
    }

    throw new Error(
      "AI 提取服务未配置。请在 Cloudflare 后台 Secrets 中设置 GEMINI_API_KEY 或 OPENAI_API_KEY。",
    );
  });

// ─── Skill 条目查重：学名前两词相同 + 正文可见文本相似度（读 DB body_text，零抓取）──
const CheckSkillDupInput = z.object({
  scientificName: z.string(),
  // 新条目正文可见文本，由客户端从上传的 HTML 用 visibleBodyText() 算好传入（避免服务端抓 HTML）。
  newBodyText: z.string(),
  excludePlantId: z.string().uuid().optional(),
});

/**
 * 判定一份待上传的 skill 条目是否与已有条目重复。
 * 门槛：学名前两词相同（speciesKey）。命中候选后用各自库里存的 body_text 做 3-gram Jaccard 相似度，
 * 取最相似者。band：>=60% = high（自动合并/去编辑）；<60% = low（平行存在/自动合并/去编辑）。
 * 全程不抓 HTTP —— 候选文本来自 DB，新条目文本由客户端传入。
 */
export const checkSkillDuplicateFn = createServerFn({ method: "POST" })
  .inputValidator((i) => CheckSkillDupInput.parse(i))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const key = speciesKey(data.scientificName);
    if (!key) return { match: null };

    const { data: plants } = await supabaseAdmin
      .from("plants")
      .select("id, slug, title, scientific_name, body_text, html_url, co_author_names, author_id");
    const candidates = (plants ?? []).filter(
      (p) => p.id !== data.excludePlantId && p.body_text && speciesKey(p.scientific_name) === key,
    );
    if (candidates.length === 0) return { match: null };

    const newSh = textShingles(data.newBodyText);
    type Match = {
      id: string;
      slug: string;
      title: string;
      scientific_name: string | null;
      html_url: string | null;
      co_author_names: string[];
      author_id: string;
    };
    let best: Match | null = null;
    let bestSim = -1;
    for (const c of candidates) {
      const sim = jaccardSimilarity(newSh, textShingles(c.body_text as string));
      if (sim > bestSim) {
        bestSim = sim;
        best = {
          id: c.id,
          slug: c.slug,
          title: c.title,
          scientific_name: c.scientific_name,
          html_url: c.html_url,
          co_author_names: c.co_author_names ?? [],
          author_id: c.author_id,
        };
      }
    }
    if (!best || bestSim < 0) return { match: null };
    return {
      match: best,
      similarity: Math.round(bestSim * 1000) / 1000,
      band: bestSim >= 0.6 ? "high" : "low",
    };
  });

const SavePlantInput = z.object({
  id: z.string().uuid().optional(),
  payload: z.object({
    title: z.string(),
    slug: z.string(),
    scientific_name: z.string().nullable(),
    common_name_en: z.string().nullable(),
    common_names_zh: z.string().nullable().optional(),
    family: z.string().nullable(),
    genus: z.string().nullable(),
    iucn_status: z.string().nullable(),
    habitat: z.string().nullable(),
    summary: z.string().nullable(),
    cover_url: z.string().nullable(),
    content_type: z.enum(["rich", "html"]),
    rich_content: z.string().nullable(),
    html_url: z.string().nullable(),
    tags: z.array(z.string()),
    is_featured: z.boolean(),
    author_id: z.string(),
    parent_id: z.string().uuid().nullable().optional(),
    // 正文可见文本，由客户端从上传的 HTML 用 visibleBodyText() 算好传入，供 skill 查重。
    body_text: z.string().nullable().optional(),
  }),
  editorName: z.string(),
  editSummary: z.string().optional(),
  tagIdsToAdd: z.array(z.string()).optional(),
  tagIdsToRemove: z.array(z.string()).optional(),
});

export const savePlantFn = createServerFn({ method: "POST" })
  .inputValidator((input) => SavePlantInput.parse(input))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { id, payload, editorName, editSummary, tagIdsToAdd, tagIdsToRemove } = data;

    const dbAuthorId = payload.author_id;

    const plantPayload = {
      title: payload.title,
      slug: payload.slug,
      scientific_name: payload.scientific_name,
      common_name_en: payload.common_name_en,
      common_names_zh: payload.common_names_zh || null,
      family: payload.family,
      genus: payload.genus,
      iucn_status: payload.iucn_status,
      habitat: payload.habitat,
      summary: payload.summary,
      cover_url: payload.cover_url,
      content_type: payload.content_type,
      rich_content: payload.rich_content,
      html_url: payload.html_url,
      tags: payload.tags,
      is_featured: payload.is_featured,
      author_id: dbAuthorId,
      parent_id: payload.parent_id || null,
      // 仅当客户端传了正文文本才写 body_text（纯编辑不带文本时保持原值不动）。
      ...(payload.body_text !== undefined ? { body_text: payload.body_text } : {}),
    };

    let plantId = id;
    if (id) {
      const { error: updErr } = await supabaseAdmin
        .from("plants")
        .update(plantPayload)
        .eq("id", id);
      if (updErr) throw new Error(`更新植物失败: ${updErr.message}`);
    } else {
      const { data: insData, error: insErr } = await supabaseAdmin
        .from("plants")
        .insert(plantPayload)
        .select("id")
        .single();
      if (insErr) throw new Error(`创建植物失败: ${insErr.message}`);
      plantId = insData.id;
    }

    if (plantId) {
      if (!id) {
        await supabaseAdmin.from("plant_edits").insert({
          plant_id: plantId,
          editor_id: dbAuthorId,
          editor_name: editorName,
          kind: "create",
          marker_n: 0,
          source: "plant_editor",
          summary:
            editSummary ||
            `${editorName} 创建了条目「${payload.title}」${payload.content_type === "html" ? "（HTML）" : ""}`,
        });
        if (payload.parent_id) {
          await supabaseAdmin.from("plant_edits").insert({
            plant_id: plantId,
            editor_id: dbAuthorId,
            editor_name: editorName,
            kind: "branch",
            marker_n: 0,
            source: "plant_editor",
            summary: `${editorName} 创建了同名分支条目（保留各自详情页，原条目 id=${payload.parent_id}）`,
          });
        }
        if (payload.content_type === "html") {
          await supabaseAdmin.from("plant_edits").insert({
            plant_id: plantId,
            editor_id: dbAuthorId,
            editor_name: editorName,
            kind: "html_save",
            marker_n: 0,
            source: "plant_editor",
            summary: `${editorName} 保存/上传了 HTML 文件`,
          });
        }
      } else if (editSummary) {
        await supabaseAdmin.from("plant_edits").insert({
          plant_id: plantId,
          editor_id: dbAuthorId,
          editor_name: editorName,
          kind: "text",
          marker_n: 0,
          source: "plant_editor",
          summary: editSummary,
        });
      }
    }

    if (plantId) {
      if (tagIdsToAdd && tagIdsToAdd.length > 0) {
        const rows = tagIdsToAdd.map((tid) => ({
          tag_id: tid,
          plant_id: plantId!,
          added_by: dbAuthorId,
        }));
        await supabaseAdmin.from("plant_tags").upsert(rows, {
          onConflict: "tag_id,plant_id",
          ignoreDuplicates: true,
        });
      }
      if (tagIdsToRemove && tagIdsToRemove.length > 0) {
        await supabaseAdmin
          .from("plant_tags")
          .delete()
          .in("tag_id", tagIdsToRemove)
          .eq("plant_id", plantId);
      }
    }

    return { plantId: plantId! };
  });

const UploadAssetInput = z.object({
  bucket: z.enum(["plant-images", "plant-html"]),
  path: z.string(),
  file_base64: z.string(),
  content_type: z.string().optional(),
});

export const uploadAssetFn = createServerFn({ method: "POST" })
  .inputValidator((input) => UploadAssetInput.parse(input))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const buffer = Buffer.from(data.file_base64, "base64");
    const { error } = await supabaseAdmin.storage.from(data.bucket).upload(data.path, buffer, {
      contentType: data.content_type,
      upsert: true,
    });
    if (error) throw new Error(`上传失败：${error.message}`);
    const publicUrl = supabaseAdmin.storage.from(data.bucket).getPublicUrl(data.path)
      .data.publicUrl;
    return { url: publicUrl };
  });

// ─── Admin: AI Model Config CRUD ─────────────────────────────────────────────

const SaveAiConfigInput = z.object({
  provider: z.enum(["gemini", "openai", "anthropic", "custom"]),
  apiKey: z.string().min(1).max(4000), // may hold a comma/newline separated Gemini key POOL
  model: z.string().min(1).max(200),
  baseUrl: z.string().url().optional().or(z.literal("")),
});

/** Admin-only: save AI model config to site_config table. */
export const saveAiConfigFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => SaveAiConfigInput.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // Verify admin role
    const { data: roles } = await supabase.from("user_roles").select("role").eq("user_id", userId);
    const isAdmin = roles?.some((r) => r.role === "admin") ?? false;
    if (!isAdmin) throw new Error("仅管理员可修改 AI 配置");

    // Sanitize on write so a key pasted with embedded spaces/newlines (a common
    // copy-paste artifact) can't poison the config — that produced a silent
    // "Invalid token" 401 on every identify. Strip ALL whitespace from the key,
    // and trim + drop trailing slashes from the base URL (we append "/chat/completions").
    const cleanKey = normalizeApiKey(data.provider, data.apiKey);
    const cleanBaseUrl = normalizeBaseUrl(data.baseUrl);
    const configValue = {
      provider: data.provider,
      apiKey: cleanKey,
      model: (data.model ?? "").trim(),
      baseUrl: cleanBaseUrl || null,
      updatedAt: new Date().toISOString(),
      updatedBy: userId,
    };

    const { error } = await (supabaseAdmin as any)
      .from("site_config")
      .upsert({ key: "ai_model_config", value: configValue }, { onConflict: "key" });

    if (error) throw new Error(`保存配置失败：${error.message}`);
    console.log(`[AI Config] Admin ${userId} updated AI config: ${data.provider}/${data.model}`);
    return { ok: true };
  });

/** Admin-only: load current AI config (masks the API key for display). */
export const getAiConfigFn = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // Verify admin role
    const { data: roles } = await supabase.from("user_roles").select("role").eq("user_id", userId);
    const isAdmin = roles?.some((r) => r.role === "admin") ?? false;
    if (!isAdmin) throw new Error("仅管理员可查看 AI 配置");

    const { data } = await (supabaseAdmin as any)
      .from("site_config")
      .select("value")
      .eq("key", "ai_model_config")
      .maybeSingle();

    if (!data?.value) return null;
    const cfg = typeof data.value === "string" ? JSON.parse(data.value) : data.value;
    // Mask each key (last 6 chars). A Gemini pool shows every key + the count, so an
    // admin can see at a glance how many independent quota buckets are configured.
    const keys = cfg.apiKey ? String(cfg.apiKey).split(",").filter(Boolean) : [];
    // Short mask: prefix hint + last 4 — a long wall of asterisks wrecked the layout.
    const maskOne = (k: string) => (k.length <= 10 ? k : `${k.slice(0, 4)}…${k.slice(-4)}`);
    const masked =
      keys.length > 1
        ? `${keys.map(maskOne).join(" · ")}（共 ${keys.length} 个 key，429 自动轮换）`
        : keys[0]
          ? maskOne(keys[0])
          : "";
    return {
      provider: cfg.provider as string,
      model: cfg.model as string,
      baseUrl: cfg.baseUrl as string | null,
      apiKeyMasked: masked,
      // Full keys (admin-only endpoint) so the owner can see every configured key
      // and drag-reorder call priority in the console. The panel shows them in plain
      // text with an on-screen "遮挡屏幕分享" warning.
      apiKeys: keys as string[],
      keyCount: keys.length,
      updatedAt: cfg.updatedAt as string | null,
    };
  });

// ─── Admin: 优先调用序列 CRUD（三个控制台共用同一组 server fn）────────────────
// 以前每个控制台一套 get/save/clear，三份几乎一样的代码各自漂移。现在只按
// consoleId 分发到不同的 site_config key。

const ConsoleIdSchema = z.enum([
  "ai",
  "card",
  "enrich",
  "second_opinion",
  "xiaop",
  "gold",
  "organ",
]);

const ModelSlotSchema = z.object({
  provider: z.enum(["gemini", "openai", "anthropic", "custom"]),
  apiKey: z.string().min(1).max(2000),
  baseUrl: z.string().max(300).optional().or(z.literal("")),
  model: z.string().min(1).max(200),
  /** 不传 = 跟随该控制台默认（见 model-queue.ts 的 THINKING_DEFAULTS）。 */
  thinking: z.enum(["on", "off"]).optional(),
});

const SaveQueueInput = z.object({
  consoleId: ConsoleIdSchema,
  // 12 项已经远超任何真实用途，纯粹是防手滑/防脏数据的上限。
  sequence: z.array(ModelSlotSchema).min(1).max(12),
});

/** 管理员编辑界面要能看到并拖动完整 key，所以这里回全量（和旧面板行为一致）。 */
export const getModelQueueFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ consoleId: ConsoleIdSchema }).parse(input))
  .handler(async ({ data, context }): Promise<{ sequence: ModelSlot[]; updatedAt?: string }> => {
    const { supabase, userId } = context;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await assertAdmin(supabase, userId, "查看 AI 配置");
    const q = await loadModelQueue(data.consoleId);
    return { sequence: q.sequence, updatedAt: q.updatedAt };
  });

export const saveModelQueueFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => SaveQueueInput.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await assertAdmin(supabase, userId, "修改 AI 配置");
    const value = writeModelQueue(
      data.sequence.map((s) => ({
        provider: s.provider,
        apiKey: normalizeApiKey(s.provider, s.apiKey),
        baseUrl: s.baseUrl ?? "",
        model: s.model,
        ...(s.thinking ? { thinking: s.thinking } : {}),
      })),
      userId,
    );
    if (!value.sequence.length) throw new Error("序列为空：请至少配置「优先调用序列 1」。");
    const { error } = await (supabaseAdmin as any)
      .from("site_config")
      .upsert({ key: CONSOLE_CONFIG_KEYS[data.consoleId], value }, { onConflict: "key" });
    if (error) throw new Error(`保存失败：${error.message}`);
    return { ok: true, count: value.sequence.length };
  });

export const clearModelQueueFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ consoleId: ConsoleIdSchema }).parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await assertAdmin(supabase, userId, "修改 AI 配置");
    const { error } = await (supabaseAdmin as any)
      .from("site_config")
      .delete()
      .eq("key", CONSOLE_CONFIG_KEYS[data.consoleId]);
    if (error) throw new Error(`清除失败：${error.message}`);
    return { ok: true, label: CONSOLE_LABELS[data.consoleId] };
  });

// ─── Admin: 视觉准入检测（逐项测「这个模型到底看没看见图」）────────────────────
// 背景与判据见 vision-probe.ts 顶部注释。这里只负责：发两次请求（带图 / 不带图）、
// 判卷、把结论写回该序列项。

/** 用给定 slot 跑一次纯文本 / 带图调用，只取文字与 prompt_tokens。 */
async function callSlotForProbe(
  slot: ModelSlot,
  prompt: string,
  images: InlineImage[],
): Promise<{ text: string; promptTokens: number }> {
  const contents: ChatContents = [{ role: "user", parts: [{ text: prompt }] }];
  const system = "你是一个图像识别助手。严格按用户要求作答，不要解释。";
  let r: AiTextResult;
  if (slot.provider === "gemini") {
    r = await geminiChat(slot.apiKey, slot.model, contents, system, undefined, 1, images);
  } else if (slot.provider === "anthropic") {
    r = await anthropicChat(
      slot.apiKey,
      slot.baseUrl,
      slot.model,
      contents,
      system,
      undefined,
      images,
    );
  } else {
    r = await openaiCompatChat(
      slot.apiKey,
      slot.baseUrl,
      slot.model,
      contents,
      system,
      undefined,
      images,
      // 视觉自检的**全部意义**就是「这个模型看不看得见图」。若中转拒图后偷偷去掉图重发，
      // 模型会答错颜色 → 被判 blind，结论**碰巧**是对的，但原因完全错了（真相是中转拒图，
      // 换个中转就好）。禁掉它，让 400 原样呈现成「调用未成功」。
      { noBlindFallback: true },
    );
  }
  return { text: r.text, promptTokens: r.usage?.prompt_tokens ?? 0 };
}

export const probeSlotVisionFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({ consoleId: ConsoleIdSchema, index: z.number().int().min(0).max(11) }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await assertAdmin(supabase, userId, "运行视觉准入检测");

    const queue = await loadModelQueue(data.consoleId);
    const slot = queue.sequence[data.index];
    if (!slot) throw new Error(`序列 ${data.index + 1} 不存在，请先保存配置再检测。`);

    const probeImage: InlineImage = {
      mimeType: VISION_PROBE_MIME,
      base64: VISION_PROBE_PNG_B64,
    };

    let answer = "";
    let promptTokens = 0;
    let callError: string | null = null;
    // 量一下这次自检花了多久。自检本身**测不出真复核要多久**（它发的是 846 字节小图 +
    // 只要四个词的回答），但它是一个下限：连这么小的请求都要十几秒的模型，去跑真复核
    // 必超预算。把这个数字摆出来，管理员才可能自己看出「全绿但复核永远不运行」的原因。
    const probeStart = Date.now();
    try {
      const r = await callSlotForProbe(slot, VISION_PROBE_PROMPT, [probeImage]);
      answer = r.text;
      promptTokens = r.promptTokens;
    } catch (e) {
      callError = e instanceof Error ? e.message.slice(0, 200) : String(e).slice(0, 200);
    }
    const probeMs = Date.now() - probeStart;

    // 对照组：同一段文字、不带图。**失败不致命** —— 拿不到它就只剩内容证据，
    // judgeVisionProbe 会据此把 token 那一项标为"无结论"。
    let textOnlyTokens: number | null = null;
    if (!callError) {
      try {
        const t = await callSlotForProbe(slot, VISION_PROBE_TEXT_ONLY_PROMPT, []);
        textOnlyTokens = t.promptTokens || null;
      } catch (e) {
        console.warn("[VisionProbe] text-only control failed:", e);
      }
    }

    const judged = judgeVisionProbe({
      grade: gradeVisionAnswer(answer),
      promptTokens,
      textOnlyTokens,
      callError,
    });
    const vision: SlotVision = {
      verdict: judged.verdict,
      at: new Date().toISOString(),
      note: `${judged.note}${speedNote(probeMs)}`,
      imageTokenDelta: judged.imageTokenDelta,
      model: slot.model,
    };

    // unknown 不写库：它不是结论，只是「这次没测出来」。写进去只会把上一次的有效结论
    // （可能是 pass）覆盖掉，反而让运行时失去判断依据。
    if (judged.verdict !== "unknown") {
      const next = queue.sequence.map((s, i) => (i === data.index ? { ...s, vision } : s));
      const value = writeModelQueue(next, userId);
      const { error } = await (supabaseAdmin as any)
        .from("site_config")
        .upsert({ key: CONSOLE_CONFIG_KEYS[data.consoleId], value }, { onConflict: "key" });
      if (error) console.warn("[VisionProbe] 结论写回失败:", error.message);
    }

    console.log(
      `[VisionProbe] admin=${userId} ${data.consoleId}#${data.index + 1} ${slot.model} → ${judged.verdict}`,
    );
    return { ...judged, at: vision.at, model: slot.model, index: data.index };
  });

// ─── Admin: 金叶详页创作指导 Skill ───────────────────────────────────────────
// 管理员把一整份 skill markdown 粘进来，它会注入金叶三轮撰稿的 prompt，版本号署在页尾。
// 存 site_config.gold_skill_config，改完**全站立即生效、不需要部署**（与四套模型配置同款）。

const GoldSkillInput = z.object({
  content: z.string().min(1).max(GOLD_SKILL_MAX_CHARS),
  // 留空则由服务端从正文里解析（`name: ccplants-v19` / frontmatter `version:` / 标题里的 v19）。
  name: z.string().max(60).optional(),
  version: z.string().max(40).optional(),
  enabled: z.boolean().optional(),
});

export const getGoldSkillFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    await assertAdmin(supabase, userId, "查看金叶创作指导");
    const skill = await loadGoldSkill();
    return {
      configured: !!skill,
      name: skill?.name ?? "",
      version: skill?.version ?? "",
      content: skill?.content ?? "",
      enabled: skill?.enabled ?? true,
      updatedAt: skill?.updatedAt ?? null,
      signature: skillSignature(skill),
      maxChars: GOLD_SKILL_MAX_CHARS,
    };
  });

export const saveGoldSkillFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => GoldSkillInput.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await assertAdmin(supabase, userId, "修改金叶创作指导");

    // 管理员没填的字段用正文解析结果补上；两者都空就留空 —— **绝不自动编一个版本号**，
    // 页尾那行是给读者看的溯源信息，宁可不显示也不能显示假的。
    const guess = suggestSkillMeta(data.content);
    const name = (data.name ?? "").trim() || guess.name;
    const version = (data.version ?? "").trim() || guess.version;

    const value = {
      name,
      version,
      content: data.content,
      enabled: data.enabled !== false,
      updatedAt: new Date().toISOString(),
      updatedBy: userId,
    };
    const { error } = await (supabaseAdmin as any)
      .from("site_config")
      .upsert({ key: GOLD_SKILL_CONFIG_KEY, value }, { onConflict: "key" });
    if (error) throw new Error(`保存失败：${error.message}`);
    return {
      ok: true,
      name,
      version,
      signature: skillSignature({ name, version }),
      chars: data.content.length,
    };
  });

export const clearGoldSkillFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await assertAdmin(supabase, userId, "修改金叶创作指导");
    const { error } = await (supabaseAdmin as any)
      .from("site_config")
      .delete()
      .eq("key", GOLD_SKILL_CONFIG_KEY);
    if (error) throw new Error(`清除失败：${error.message}`);
    return { ok: true };
  });

// ─── Admin: 各序列项的余额 / 配额 ─────────────────────────────────────────────
// 只有少数厂商公开了「余额查询」接口，多数（Gemini 免费额度、OpenAI、Anthropic）
// 根本查不到。所以这里的原则是：**能查的查真数据，查不到的如实说查不到**，
// 绝不用估算值冒充余额 —— 一个编出来的数字比没有数字更危险。

type SlotBalance = {
  index: number;
  provider: string;
  model: string;
  /** "ok" 查到了；"unsupported" 该厂商没有余额接口；"error" 查了但失败 */
  state: "ok" | "unsupported" | "error";
  /** 人类可读的余额，如 "¥49.59（含赠金 ¥46.59）" */
  text: string;
  /** 余额数值（能拿到才有），用于前端画进度/预警 */
  value?: number;
  currency?: string;
};

/** Moonshot / Kimi：GET {base}/users/me/balance（官方文档有，实测可用）。 */
async function moonshotBalance(baseUrl: string, apiKey: string): Promise<SlotBalance | null> {
  if (!/moonshot|kimi/i.test(baseUrl)) return null;
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 10_000);
    const r = await fetch(`${baseUrl}/users/me/balance`, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: ctrl.signal,
    });
    clearTimeout(timer);
    if (!r.ok)
      return {
        index: -1,
        provider: "",
        model: "",
        state: "error",
        text: `查询失败 HTTP ${r.status}`,
      };
    const j: any = await r.json();
    const d = j?.data ?? {};
    const avail = Number(d.available_balance);
    if (!Number.isFinite(avail))
      return { index: -1, provider: "", model: "", state: "error", text: "返回格式不符" };
    const voucher = Number(d.voucher_balance) || 0;
    return {
      index: -1,
      provider: "",
      model: "",
      state: "ok",
      text:
        voucher > 0
          ? `¥${avail.toFixed(2)}（含赠金 ¥${voucher.toFixed(2)}）`
          : `¥${avail.toFixed(2)}`,
      value: avail,
      currency: "CNY",
    };
  } catch {
    return { index: -1, provider: "", model: "", state: "error", text: "查询超时 / 网络错误" };
  }
}

export const getQueueBalancesFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ consoleId: ConsoleIdSchema }).parse(input))
  .handler(async ({ data, context }): Promise<{ balances: SlotBalance[] }> => {
    const { supabase, userId } = context;
    await assertAdmin(supabase, userId, "查看 AI 配置");
    const q = await loadModelQueue(data.consoleId);
    const balances = await Promise.all(
      q.sequence.map(async (slot, index): Promise<SlotBalance> => {
        const base = { index, provider: slot.provider, model: slot.model };
        if (slot.provider === "custom" || slot.provider === "openai") {
          const b = await moonshotBalance(slot.baseUrl, slot.apiKey);
          if (b) return { ...b, ...base };
        }
        // 其余厂商：说清楚为什么查不到，并给出真正能看到额度的地方。
        const why: Record<string, string> = {
          gemini: "Google 未提供余额接口；免费额度按项目计，请在 AI Studio / Cloud Console 查看",
          anthropic: "Anthropic 未提供余额接口，请在官方控制台查看",
          openai: "该接口未提供余额查询，请在服务商控制台查看",
          custom: "该服务商未提供余额接口，请在其控制台查看",
        };
        return { ...base, state: "unsupported", text: why[slot.provider] ?? "不支持查询" };
      }),
    );
    return { balances };
  });

// ── Editor application approval (server-side, with email auto-confirm) ─────────
// Approving an editor grants the role, marks the application approved, AND confirms
// their email via the Supabase Admin API — so an approved editor can log in right
// away instead of being blocked on "email not confirmed" (a common trap: approval
// ≠ email verification, which normally requires clicking a link that often never
// arrives). Email confirm needs the service role, hence a server function.
const ApproveAppInput = z.object({ applicationId: z.string().uuid(), userId: z.string().uuid() });

async function assertAdmin(supabase: any, adminId: string, action: string) {
  const { data: roles } = await supabase.from("user_roles").select("role").eq("user_id", adminId);
  if (!(roles?.some((r: { role: string }) => r.role === "admin") ?? false))
    throw new Error(`仅管理员可${action}`);
}

export const approveApplicationFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => ApproveAppInput.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId: adminId } = context;
    await assertAdmin(supabase, adminId, "审批编辑申请");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // 1. grant editor role (idempotent)
    const { error: roleErr } = await (supabaseAdmin as any)
      .from("user_roles")
      .insert({ user_id: data.userId, role: "editor" });
    if (roleErr && !String(roleErr.message).toLowerCase().includes("duplicate")) throw roleErr;

    // 2. mark the application approved
    const { error: updErr } = await (supabaseAdmin as any)
      .from("editor_applications")
      .update({
        status: "approved",
        reviewed_by: adminId,
        reviewed_at: new Date().toISOString(),
        reject_reason: null,
      })
      .eq("id", data.applicationId);
    if (updErr) throw updErr;

    // 3. confirm their email so login works immediately (non-fatal if it fails)
    let emailConfirmed = false;
    try {
      const { error: confErr } = await (supabaseAdmin as any).auth.admin.updateUserById(
        data.userId,
        { email_confirm: true },
      );
      if (confErr) throw confErr;
      emailConfirmed = true;
    } catch (e) {
      console.warn("[approveApplication] email confirm failed:", e);
    }
    return { ok: true, emailConfirmed };
  });

/** Admin-only: confirm an (already-approved) editor's email so they can log in. */
const ConfirmEmailInput = z.object({ userId: z.string().uuid() });
export const confirmUserEmailFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => ConfirmEmailInput.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId: adminId } = context;
    await assertAdmin(supabase, adminId, "确认用户邮箱");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await (supabaseAdmin as any).auth.admin.updateUserById(data.userId, {
      email_confirm: true,
    });
    if (error) throw new Error(`确认邮箱失败：${error.message}`);
    return { ok: true };
  });

/** Admin-only: clear AI config and revert to .env defaults. */
export const clearAiConfigFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: roles } = await supabase.from("user_roles").select("role").eq("user_id", userId);
    const isAdmin = roles?.some((r) => r.role === "admin") ?? false;
    if (!isAdmin) throw new Error("仅管理员可修改 AI 配置");

    await (supabaseAdmin as any).from("site_config").delete().eq("key", "ai_model_config");
    console.log(`[AI Config] Admin ${userId} cleared AI config, reverting to .env defaults`);
    return { ok: true };
  });

// ─── Admin: Pl@ntNet professional-ID key (stored in site_config) ─────────────
const SavePlantNetInput = z.object({ apiKey: z.string().min(1).max(1000) });

/** Admin-only: save the Pl@ntNet API key (enables Stage-0 professional ID site-wide). */
export const savePlantNetKeyFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => SavePlantNetInput.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: roles } = await supabase.from("user_roles").select("role").eq("user_id", userId);
    const isAdmin = roles?.some((r) => r.role === "admin") ?? false;
    if (!isAdmin) throw new Error("仅管理员可配置 Pl@ntNet");
    const cleanKey = (data.apiKey ?? "").replace(/\s+/g, "");
    const value = { apiKey: cleanKey, updatedAt: new Date().toISOString(), updatedBy: userId };
    const { error } = await (supabaseAdmin as any)
      .from("site_config")
      .upsert({ key: "plantnet_api_key", value }, { onConflict: "key" });
    if (error) throw new Error(`保存失败：${error.message}`);
    console.log(`[Pl@ntNet] Admin ${userId} updated Pl@ntNet key`);
    return { ok: true };
  });

/** Admin-only: load the current Pl@ntNet key (masked for display). */
export const getPlantNetKeyFn = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: roles } = await supabase.from("user_roles").select("role").eq("user_id", userId);
    const isAdmin = roles?.some((r) => r.role === "admin") ?? false;
    if (!isAdmin) throw new Error("仅管理员可查看 Pl@ntNet 配置");
    const { data } = await (supabaseAdmin as any)
      .from("site_config")
      .select("value")
      .eq("key", "plantnet_api_key")
      .maybeSingle();
    if (!data?.value) return null;
    const cfg = typeof data.value === "string" ? JSON.parse(data.value) : data.value;
    const key: string = typeof cfg === "string" ? cfg : (cfg.apiKey ?? "");
    if (!key) return null;
    const masked = key.length <= 10 ? key : `${key.slice(0, 4)}…${key.slice(-4)}`;
    return {
      apiKeyMasked: masked,
      updatedAt: (typeof cfg === "object" ? cfg.updatedAt : null) ?? null,
    };
  });

/** Admin-only: remove the Pl@ntNet key (reverts identify to LLM-only). */
export const clearPlantNetKeyFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: roles } = await supabase.from("user_roles").select("role").eq("user_id", userId);
    const isAdmin = roles?.some((r) => r.role === "admin") ?? false;
    if (!isAdmin) throw new Error("仅管理员可配置 Pl@ntNet");
    await (supabaseAdmin as any).from("site_config").delete().eq("key", "plantnet_api_key");
    console.log(`[Pl@ntNet] Admin ${userId} cleared Pl@ntNet key`);
    return { ok: true };
  });

// ─── Admin: 二次复核模型 vision 二次复核配置（stored in site_config）─────────────────
// 用的是火山方舟 **ARK API Key**（数据面 Bearer token），不是 IAM 的 AK/SK。
const SaveSecondOpinionInput = z.object({
  apiKey: z.string().min(1).max(2000),
  model: z.string().min(1).max(200),
  baseUrl: z.string().max(300).optional(),
});

/** Admin-only: save the Doubao vision config (enables the 疑似 second-opinion site-wide). */
export const saveSecondOpinionConfigFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => SaveSecondOpinionInput.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: roles } = await supabase.from("user_roles").select("role").eq("user_id", userId);
    const isAdmin = roles?.some((r) => r.role === "admin") ?? false;
    if (!isAdmin) throw new Error("仅管理员可配置二次复核模型");
    const value = {
      apiKey: (data.apiKey ?? "").replace(/\s+/g, ""),
      model: (data.model ?? "").trim(),
      baseUrl: normalizeBaseUrl(data.baseUrl) || SECOND_OPINION_DEFAULT_BASE,
      updatedAt: new Date().toISOString(),
      updatedBy: userId,
    };
    const { error } = await (supabaseAdmin as any)
      .from("site_config")
      .upsert({ key: "second_opinion_config", value }, { onConflict: "key" });
    if (error) throw new Error(`保存失败：${error.message}`);
    console.log(
      `[SecondOpinion] Admin ${userId} updated Doubao vision config (model=${value.model})`,
    );
    return { ok: true };
  });

/** Admin-only: load the current Doubao config (key masked for display). */
export const getSecondOpinionConfigFn = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: roles } = await supabase.from("user_roles").select("role").eq("user_id", userId);
    const isAdmin = roles?.some((r) => r.role === "admin") ?? false;
    if (!isAdmin) throw new Error("仅管理员可查看二次复核配置");
    // 与 loadSecondOpinionConfig 保持同样的新旧 key 回退，否则旧配置在跑、面板却显示「未启用」。
    const { data } = await (supabaseAdmin as any)
      .from("site_config")
      .select("key, value")
      .in("key", ["second_opinion_config", "doubao_vision_config"]);
    const rows: any[] = Array.isArray(data) ? data : [];
    const picked =
      rows.find((r) => r.key === "second_opinion_config") ??
      rows.find((r) => r.key === "doubao_vision_config");
    if (!picked?.value) return null;
    // 必须走 readModelQueue：新界面存的是 sequence 形态，直读 cfg.apiKey 会拿到
    // undefined → 状态条显示「未启用」，可模型其实正在跑。
    const q = readModelQueue(
      typeof picked.value === "string" ? JSON.parse(picked.value) : picked.value,
    );
    const first = q.sequence[0];
    if (!first) return null;
    return {
      apiKeyMasked: maskKey(first.apiKey),
      model: first.model,
      baseUrl: first.baseUrl || SECOND_OPINION_DEFAULT_BASE,
      updatedAt: q.updatedAt ?? null,
      // 序列里还有几个替补 —— 面板可以据此显示「1 主 + N 备」。
      sequenceCount: q.sequence.length,
    };
  });

/** Admin-only: remove the Doubao config (疑似 结果回退为直接进补拍). */
export const clearSecondOpinionConfigFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: roles } = await supabase.from("user_roles").select("role").eq("user_id", userId);
    const isAdmin = roles?.some((r) => r.role === "admin") ?? false;
    if (!isAdmin) throw new Error("仅管理员可配置二次复核模型");
    // 新旧两个 key 都删 —— 只删新的会让旧的 doubao_vision_config 继续被 load 回退命中，
    // 表现成「点了停用却还在跑」。
    await (supabaseAdmin as any)
      .from("site_config")
      .delete()
      .in("key", ["second_opinion_config", "doubao_vision_config"]);
    console.log(`[SecondOpinion] Admin ${userId} cleared Doubao vision config`);
    return { ok: true };
  });

// ─── Admin: 拉取二次复核模型可用模型（免去手填模型 ID 填错）──────────────────────────
const ListVisionModelsInput = z.object({
  apiKey: z.string().max(2000).optional(),
  baseUrl: z.string().max(300).optional(),
});

/** 粗筛可能具备视觉能力的模型，避免对目录里上百个模型全量探测（真正的能力以实际探测为准）。
 *  覆盖各家命名习惯：二次复核模型 vision/seed、通义 qwen-vl、OpenAI gpt-4o/omni、智谱 glm-4v、
 *  Claude、Gemini 等。先按黑名单排除生图/视频/3D/向量/语音/翻译这类做不了植物复核的。 */
function isVisionModelCandidate(id: string): boolean {
  const s = id.toLowerCase();
  if (
    /embedding|rerank|seedream|seedance|seededit|seed3d|hyper3d|hitem3d|t2v|i2v|t2i|flf2v|image-gen|imagen|dall-?e|tts|whisper|audio|speech|asr|translation|pretrain|functioncall/.test(
      s,
    )
  ) {
    return false;
  }
  return (
    /vision|vl\b|-vl-|multimodal|omni/.test(s) || // 通用/通义/多模态命名
    /gpt-4o|gpt-4\.1|gpt-5|o[34]-/.test(s) || // OpenAI 多模态
    /glm-\d+(\.\d+)?v/.test(s) || // 智谱 glm-4v / glm-4.5v
    /claude-\d|claude-(opus|sonnet|haiku)/.test(s) || // Claude 全系多模态
    /gemini/.test(s) || // Gemini 全系多模态
    /seed-\d+-\d+/.test(s) // 二次复核模型 seed 系列原生多模态
  );
}

/** Admin-only: 列出该 ARK Key 下的模型目录，并**逐个实测**哪些真能调用。
 *  必要性：目录里有 ≠ 你的账号已开通 —— 实测过某账号目录 126 个、视觉模型却全部 404。 */
export const listVisionModelsFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => ListVisionModelsInput.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: roles } = await supabase.from("user_roles").select("role").eq("user_id", userId);
    const isAdmin = roles?.some((r) => r.role === "admin") ?? false;
    if (!isAdmin) throw new Error("仅管理员可拉取模型列表");

    const saved = await loadSecondOpinionConfig();
    const apiKey = (data.apiKey || "").replace(/\s+/g, "") || saved?.apiKey || "";
    const baseUrl = normalizeBaseUrl(data.baseUrl) || saved?.baseUrl || SECOND_OPINION_DEFAULT_BASE;
    const empty = {
      ok: false,
      total: 0,
      models: [] as { id: string; callable: boolean; note: string }[],
    };
    if (!apiKey) return { ...empty, hint: "请先填入方舟 ARK API Key（或先保存一次配置）。" };

    const H = { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" };
    let catalog: string[] = [];
    try {
      const r = await fetch(`${baseUrl}/models`, { headers: H });
      if (r.status === 401 || r.status === 403) {
        return {
          ...empty,
          hint: `API Key 无效（HTTP ${r.status}）—— 请确认用的是方舟「API Key」（数据面），不是 IAM 的 Access Key/Secret Key。`,
        };
      }
      if (!r.ok) {
        return {
          ...empty,
          hint: `拉取模型目录失败：HTTP ${r.status} ${(await r.text().catch(() => "")).slice(0, 200)}`,
        };
      }
      const j = await r.json();
      catalog = (Array.isArray(j?.data) ? j.data : [])
        .map((m: any) => String(m?.id ?? ""))
        .filter(Boolean);
    } catch (e) {
      return { ...empty, hint: `拉取模型目录异常：${e instanceof Error ? e.message : String(e)}` };
    }

    const cands = catalog.filter(isVisionModelCandidate).slice(0, 24);
    // 用**一张真图**探测，而不是纯文本 ping —— 纯文本只能测出模型存不存在，测不出它能不能
    // 看图。而本功能的全部意义就是「只列出真有图形能力的模型」。
    const probe = async (id: string) => {
      try {
        const r = await fetch(`${baseUrl}/chat/completions`, {
          method: "POST",
          headers: H,
          body: JSON.stringify({
            model: id,
            messages: [
              {
                role: "user",
                content: [
                  { type: "text", text: "什么颜色？一个词。" },
                  {
                    type: "image_url",
                    image_url: { url: `data:image/jpeg;base64,${VISION_PROBE_JPEG_B64}` },
                  },
                ],
              },
            ],
            max_tokens: 4,
          }),
        });
        if (r.ok) return { id, callable: true, note: "支持图片 ✓ 实测通过" };
        const body = (await r.text().catch(() => "")).slice(0, 200);
        if (r.status === 404) return { id, callable: false, note: "未开通 / 无权限（404）" };
        if (r.status === 401 || r.status === 403)
          return { id, callable: false, note: `鉴权失败（${r.status}）` };
        // 模型存在但拒绝了图片内容 → 多半是纯文本模型，对本任务同样不可用。
        return {
          id,
          callable: false,
          note: `不支持图片输入（HTTP ${r.status}）${body.slice(0, 80)}`,
        };
      } catch (e) {
        return {
          id,
          callable: false,
          note: `探测异常：${e instanceof Error ? e.message.slice(0, 50) : ""}`,
        };
      }
    };
    const models: { id: string; callable: boolean; note: string }[] = [];
    for (let i = 0; i < cands.length; i += 6) {
      models.push(...(await Promise.all(cands.slice(i, i + 6).map(probe))));
    }
    models.sort((a, b) => Number(b.callable) - Number(a.callable) || a.id.localeCompare(b.id));

    const usable = models.filter((m) => m.callable).length;
    const hint = usable
      ? `目录共 ${catalog.length} 个模型，实测其中 ${usable} 个**确实能看图**（下方绿色项，点一下即可选用）。`
      : `目录里有 ${catalog.length} 个模型，探测了 ${cands.length} 个视觉候选，但**没有一个能用**。若清一色 404，说明这个 Key 对应的账号还没开通模型直调权限 —— 火山方舟需到控制台「在线推理」创建**推理接入点**，再把 ep- 开头的 ID 手动填进下面的模型框；其它厂商请确认模型已开通。`;
    console.log(
      `[SecondOpinion] admin=${userId} 模型探测 base=${baseUrl} 目录${catalog.length} 候选${cands.length} 可用${usable}`,
    );
    return { ok: true, total: catalog.length, models, hint };
  });

// ─── Admin: 识别引擎连通性自检 ────────────────────────────────────────────────
// 回答「我配的 key 到底能不能用」。两个引擎都用**站内一张真实植物照片**跑完整链路，
// 而不是只 ping 一下 key —— 纯文本 ping 会让「key 有效但模型不是多模态」这种最常见的
// 配置错误蒙混过关（二次复核模型必须是 vision 模型才能复核照片）。
export const testIdentifyEnginesFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: roles } = await supabase.from("user_roles").select("role").eq("user_id", userId);
    const isAdmin = roles?.some((r) => r.role === "admin") ?? false;
    if (!isAdmin) throw new Error("仅管理员可自检识别引擎");

    const plantnet = { ok: false, detail: "" };
    const review = { ok: false, detail: "" };

    // 取一张站内真实植物照片当测试样本。
    // 注意字段名：plants 用 `cover_url`，plant_drafts 才是 `photo_url` —— 两张表不一样，
    // 写错会 400（column does not exist），而且要把真实错误带出来，别再吞成一句笼统提示。
    let sampleDataUrl = "";
    let sampleNote = "";
    let sampleErr = "";
    const trySample = async (table: string, col: string, label: string) => {
      if (sampleDataUrl) return;
      const { data, error } = await (supabaseAdmin as any)
        .from(table)
        .select(`title, ${col}`)
        .not(col, "is", null)
        .order("created_at", { ascending: false })
        .limit(40);
      if (error) {
        sampleErr += `[${label}] 查询失败：${error.message}；`;
        return;
      }
      const rows: any[] = Array.isArray(data) ? data : [];
      // 样本图**必须是 JPEG/PNG**：Pl@ntNet 不收 WebP，拿 WebP 当样本只会撞上 415，
      // 测不到 key 到底有没有效（站内历史图大多是 WebP，这个坑踩过一次）。
      const hit = rows.find((r) => /\.(jpe?g|png)(\?|$)/i.test(String(r?.[col] ?? "")));
      if (!hit) {
        sampleErr += `[${label}] 最近 ${rows.length} 条里没有 JPEG/PNG 图（历史图多为 WebP）；`;
        return;
      }
      const img = await fetchInlineImage(hit[col]);
      if (!img) {
        sampleErr += `[${label}] 图片下载失败：${String(hit[col]).slice(0, 80)}；`;
        return;
      }
      sampleDataUrl = `data:${img.mimeType};base64,${img.base64}`;
      sampleNote = (hit?.title as string) || label;
    };
    try {
      // 先查草稿：识别链路已改为强制 JPEG，最新的识别图必定是 JPEG，命中率最高。
      await trySample("plant_drafts", "photo_url", "识别草稿");
      await trySample("plants", "cover_url", "已收录植物");
    } catch (e) {
      sampleErr += `异常：${e instanceof Error ? e.message : String(e)}；`;
    }
    if (!sampleDataUrl) {
      const msg = `无法取得 JPEG/PNG 测试样本照片（Pl@ntNet 不收 WebP）—— ${sampleErr || "原因未知"}。请先用相机识别一张照片（新识别图已强制为 JPEG），再回来自检。`;
      console.warn("[EngineTest] sample photo unavailable:", sampleErr);
      return {
        plantnet: { ok: false, detail: msg },
        review: { ok: false, detail: msg },
        plantNetQuotaFlagged: await isPlantNetQuotaExhausted(),
        sample: "",
      };
    }

    // ── Pl@ntNet：没有单纯校验 key 的端点，只能发一次真实识别请求。
    const pkey = await loadPlantNetKey();
    if (!pkey) {
      plantnet.detail = "未配置（site_config.plantnet_api_key 与环境变量都为空）";
    } else {
      try {
        const res = await plantNetIdentify(sampleDataUrl, pkey);
        if (res.quotaExhausted) {
          await markPlantNetQuotaExhausted();
          plantnet.detail =
            "HTTP 429：每日免费额度（500 次/天）已用尽。已记下标记，接下来的识别会自动改由二次复核模型顶一线，额度重置后自动切回。";
        } else if (res.verdict) {
          plantnet.ok = true;
          plantnet.detail = `连通正常 —— 样本判定为 ${res.verdict.scientific_name}（${Math.round((res.verdict.score ?? 0) * 100)}%）`;
        } else if (res.status === 200) {
          // key 有效，只是这张样本图认不出来 —— 对「key 能不能用」而言这就是通过。
          plantnet.ok = true;
          plantnet.detail = "key 有效（HTTP 200），只是这张样本图没match到物种，不影响正常识别";
        } else if (res.status === 401 || res.status === 403) {
          plantnet.detail = `HTTP ${res.status}：key 无效或已停用，请到 my.plantnet.org 重新获取。${res.body.slice(0, 120)}`;
        } else if (res.status === 0) {
          plantnet.detail = "请求未能发出（网络异常 / 超时），详见服务端日志";
        } else {
          plantnet.detail = `HTTP ${res.status}：${res.body.slice(0, 160) || "无响应体"}`;
        }
      } catch (e) {
        plantnet.detail = `请求异常：${e instanceof Error ? e.message : String(e)}`;
      }
    }

    // ── 二次复核模型：跑真实的 vision 定种，一次验证 key + 模型 ID + 多模态能力。
    const dcfg = await loadSecondOpinionConfig();
    if (!dcfg) {
      review.detail = "未配置（site_config.second_opinion_config 与环境变量都为空）";
    } else {
      try {
        const dv = await secondOpinionPrimaryVerdict(sampleDataUrl, []);
        if (dv) {
          review.ok = true;
          review.detail = `连通正常 —— 模型 ${dcfg.model} 对样本判定为 ${dv.label}`;
        } else {
          // 看图失败时再发一次**纯文本** ping，用来把「key/模型根本不通」和「模型通但不支持
          // 视觉」区分开 —— 这两者的修法完全不同，只报「调用失败」等于没说。
          let probeStatus = -1;
          let probeBody = "";
          try {
            const probe = await fetch(`${dcfg.baseUrl}/chat/completions`, {
              method: "POST",
              headers: {
                Authorization: `Bearer ${dcfg.apiKey}`,
                "Content-Type": "application/json",
              },
              body: JSON.stringify({
                model: dcfg.model,
                messages: [{ role: "user", content: "ping" }],
                max_tokens: 4,
              }),
            });
            probeStatus = probe.status;
            probeBody = (await probe.text().catch(() => "")).slice(0, 260);
          } catch (e) {
            probeBody = e instanceof Error ? e.message : String(e);
          }
          if (probeStatus === 200) {
            review.detail = `模型 ${dcfg.model} 的纯文本调用正常，但**看图失败** —— 它很可能不是多模态（视觉）模型。请用「拉取可用模型」挑一个实测支持图片的。`;
          } else {
            review.detail = `调用失败（模型 ${dcfg.model}）：HTTP ${probeStatus === -1 ? "请求未发出" : probeStatus} ${probeBody}。常见原因：模型 ID 写错、该模型未在当前账号/地区开通（火山方舟此时应改填推理接入点 ep-…）、API Key 无效、或 API Base 填错。可先点「拉取可用模型」看看这个 Key 到底能调什么。`;
          }
        }
      } catch (e) {
        review.detail = `请求异常：${e instanceof Error ? e.message : String(e)}`;
      }
    }

    // ── 出卡模型：Pl@ntNet 判定可信时，由它把结论写成简介摘要卡（consoleId="card"）。
    // 这一环以前没测过 —— 于是「Pl@ntNet 通、复核通」全绿，实际却因为出卡模型不通而出不了卡。
    const card = { ok: false, detail: "" };
    try {
      const seq = (await loadModelQueue("card")).sequence;
      if (!seq.length) {
        card.detail = "未配置出卡AI序列（识别会退回兜底「AI 模型控制台」）";
      } else {
        const oks: string[] = [];
        const bads: string[] = [];
        // 逐个测**每一项**，而不是只测第一项：序列的意义就是「第一个挂了还有下一个」，
        // 只测第一项等于没测出冗余到底还在不在。
        for (const [i, s] of seq.entries()) {
          const label = `序列${i + 1}(${s.model || "未填模型"})`;
          if (!s.apiKey?.trim()) {
            bads.push(`${label}: 未填 Key`);
            continue;
          }
          try {
            const r = await fetch(`${s.baseUrl || SECOND_OPINION_DEFAULT_BASE}/chat/completions`, {
              method: "POST",
              headers: {
                Authorization: `Bearer ${s.apiKey}`,
                "Content-Type": "application/json",
              },
              body: JSON.stringify({
                model: s.model,
                messages: [{ role: "user", content: "ping" }],
                max_tokens: 4,
              }),
            });
            if (r.ok) oks.push(label);
            else bads.push(`${label}: HTTP ${r.status}`);
          } catch (e) {
            bads.push(`${label}: ${e instanceof Error ? e.message : String(e)}`);
          }
        }
        card.ok = oks.length > 0;
        card.detail = card.ok
          ? `${oks.length}/${seq.length} 项可用（${oks.join("、")}）` +
            (bads.length ? `；不可用：${bads.join("、")}` : "")
          : `全部 ${seq.length} 项都不可用：${bads.join("、")}`;
      }
    } catch (e) {
      card.detail = `读取出卡AI配置失败：${e instanceof Error ? e.message : String(e)}`;
    }

    console.log(
      `[EngineTest] admin=${userId} plantnet=${plantnet.ok ? "OK" : "FAIL"} review=${review.ok ? "OK" : "FAIL"} card=${card.ok ? "OK" : "FAIL"}`,
    );

    // ── 按**运行时真实链路**组织结论 ────────────────────────────────────────
    // 以前只报「Pl@ntNet / 复核模型」两个孤立的点，管理员看到两个 ✅ 仍然不知道
    // 「拍一张照到底能不能出卡」——因为出卡模型这一环根本没被测。改成三条端到端链路，
    // 每条对应一种真实走法（见 quickIdentify 的分支）。
    const chains = [
      {
        name: "① Pl@ntNet 判定可信 → 出卡AI 写卡",
        ok: plantnet.ok && card.ok,
        steps: [
          { label: "Pl@ntNet", ok: plantnet.ok, detail: plantnet.detail },
          { label: "出卡AI", ok: card.ok, detail: card.detail },
        ],
        note: "最常走的一条：专业引擎给出物种，出卡模型只负责把它写成卡片。",
      },
      {
        name: "② Pl@ntNet 存疑/不可用 → 一线识别模型顶替定种",
        ok: review.ok && card.ok,
        steps: [
          { label: "一线识别（复核模型顶替）", ok: review.ok, detail: review.detail },
          { label: "出卡AI", ok: card.ok, detail: card.detail },
        ],
        note: "Pl@ntNet 额度用尽或没把握时走这条，由视觉模型直接定种。",
      },
      {
        name: "③ 一线仍判疑似 → 二次复核模型再看一遍",
        ok: review.ok,
        steps: [{ label: "二次复核模型", ok: review.ok, detail: review.detail }],
        note: "复核有把握就直接出确诊卡、跳过补拍；它也没把握才让用户补拍。",
      },
    ];

    return {
      plantnet,
      review,
      card,
      chains,
      plantNetQuotaFlagged: await isPlantNetQuotaExhausted(),
      sample: sampleNote,
    };
  });

// ═══ MCP 摄入：外部 agent 自带引擎，本站只负责「统一标准 + 统一表达」 ═══════════
//
// 设计要害：**agent 只能提交「证据」，不能提交「结论」。**
// 它交上来的是 Pl@ntNet 的原始 score 和自己模型的三档自评；**可信度百分比由本站用
// `computeIdentifyConfidence()` 算、卡片由 `buildSummaryCardHtml()` 渲染**，与站内识别
// 走的是同一段代码。这样接入几个不同的 agent 都不会出现格式漂移或口径不一。
//
// 刻意不收：`confidence_pct`（agent 自报的百分比）、`card_html`（agent 自己写的卡片）。
// 一旦收了，标准就回到「靠 agent 自觉」，这个功能的意义也就没了。
//
// ⚠️ 已知局限（用户已确认接受，因为只有 owner 自己用）：本站**无法验证 agent 是否真的
// 调了 Pl@ntNet** —— score 可以伪造。缓解靠 `_identify_trace.source="mcp"` 溯源。

export type McpIdentifyInput = {
  photo_base64: string;
  photo_mime: string;
  lat?: number | null;
  lng?: number | null;
  place?: string | null;
  tags?: string[];
  plantnet?: { scientific_name: string; score: number; family?: string; genus?: string } | null;
  model_verdict: {
    scientific_name: string;
    title?: string;
    common_name_en?: string;
    common_names_zh?: string;
    family?: string;
    genus?: string;
    confidence: "high" | "medium" | "low";
    summary_zh: string;
    model: string;
  };
  photo_sha256?: string;
};

/** 把外部 agent 交来的结构化证据，走**站内同一条流水线**建成一张简介摘要卡草稿。 */
export async function ingestMcpIdentification(input: McpIdentifyInput): Promise<{
  draftId: string;
  title: string;
  confidencePct: number;
  tentative: boolean;
}> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  const buffer = Buffer.from(input.photo_base64, "base64");
  const ext = input.photo_mime.includes("png")
    ? "png"
    : input.photo_mime.includes("webp")
      ? "webp"
      : "jpg";
  const path = `drafts/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
  const { error: upErr } = await supabaseAdmin.storage
    .from("plant-images")
    .upload(path, buffer, { contentType: input.photo_mime, upsert: false });
  if (upErr) throw new Error(`照片上传失败：${upErr.message}`);
  const photoUrl = supabaseAdmin.storage.from("plant-images").getPublicUrl(path).data.publicUrl;

  const v = input.model_verdict;
  const meta = {
    title: v.title || v.scientific_name,
    scientific_name: v.scientific_name,
    common_name_en: v.common_name_en || "",
    common_names_zh: v.common_names_zh || "",
    family: v.family || "",
    genus: v.genus || "",
    identification_confidence: v.confidence,
    summary_zh: v.summary_zh,
  } as AiMeta;
  // 与站内识别用同一个规范化器：疑似信号（标题/正文/补拍横幅）三处一致。
  normalizeIdentification(meta);

  const pnPct =
    input.plantnet && Number.isFinite(input.plantnet.score)
      ? Math.round(input.plantnet.score * 100)
      : null;
  const trace: IdentifyTrace & { source?: string } = {
    primaryEngine: input.plantnet ? "plantnet" : "none",
    primaryLabel: input.plantnet?.scientific_name ?? "",
    primaryPct: pnPct,
    phase1Model: v.model,
    phase1Confidence: (meta.identification_confidence || "").toString(),
    // MCP 链路不跑站内的二次复核（agent 那边自己决定要不要复核），如实写明。
    review: { ran: false, reason: "由外部 agent 经 MCP 提交，未走站内二次复核" },
    retakeCount: 0,
    source: "mcp",
  };

  const conf = computeIdentifyConfidence(
    trace,
    (meta.scientific_name || "").toString(),
    (meta.identification_confidence || "").toString(),
  );

  const html = buildSummaryCardHtml({
    photos: [photoUrl],
    title: meta.title || "",
    sci: meta.scientific_name || "",
    summaryZh: meta.summary_zh || "",
    family: meta.family,
    genus: meta.genus,
    tentative: isTentative(meta),
    chips: await lookupRegistryChips(meta.scientific_name, meta.family),
    trace,
    finalConfidence: (meta.identification_confidence || "").toString(),
  });

  const aiPayload = JSON.parse(
    JSON.stringify({
      ...meta,
      _enriched: false, // 只有简介卡；要正文仍需显式点「生成进一步介绍草稿」
      _identify_trace: trace,
      ...(input.photo_sha256 ? { _photo_sha256: input.photo_sha256 } : {}),
    }),
  );

  const { data: row, error } = await (supabaseAdmin as any)
    .from("plant_drafts")
    .insert({
      photo_url: photoUrl,
      user_photos: [photoUrl],
      capture_lat: input.lat ?? null,
      capture_lng: input.lng ?? null,
      capture_place: input.place ?? "",
      ai_model: v.model,
      ai_payload: aiPayload,
      title: draftTitleFor(meta),
      scientific_name: meta.scientific_name || null,
      common_name_en: meta.common_name_en || null,
      common_names_zh: meta.common_names_zh || null,
      family: meta.family || null,
      genus: meta.genus || null,
      summary: (meta.summary_zh || "").toString().slice(0, 600),
      tags: input.tags ?? [],
      html_content: html,
      creator_label: "MCP 批量",
      status: "pending",
    })
    .select("id")
    .single();
  if (error) throw new Error(`建卡失败：${error.message}`);

  // 用量留痕：Pl@ntNet 与 agent 的模型都不消耗本站 token，但**必须留下记录**，
  // 否则站内会凭空多出一批查不到出处的草稿。
  try {
    await (supabaseAdmin as any).from("ai_usage_logs").insert({
      provider: input.plantnet ? "mcp+plantnet" : "mcp",
      model: v.model,
      prompt_tokens: 0,
      completion_tokens: 0,
      total_tokens: 0,
      draft_id: row.id,
      draft_title: draftTitleFor(meta),
      task_type: "mcp_ingest",
      capture_place: input.place ?? null,
      capture_lat: input.lat ?? null,
      capture_lng: input.lng ?? null,
    });
  } catch {
    /* 留痕失败不影响建卡 */
  }

  return {
    draftId: row.id as string,
    title: draftTitleFor(meta),
    confidencePct: conf.pct,
    tentative: isTentative(meta),
  };
}

// ─── Admin: AI Usage Statistics ───────────────────────────────────────────────

const FetchUsageInput = z.object({
  limit: z.number().int().min(1).max(500).default(100),
  offset: z.number().int().min(0).default(0),
  provider: z.string().nullable().optional(),
});

export const fetchAiUsageFn = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => FetchUsageInput.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: roles } = await supabase.from("user_roles").select("role").eq("user_id", userId);
    const isAdmin = roles?.some((r) => r.role === "admin") ?? false;
    if (!isAdmin) throw new Error("仅管理员可查看用量统计");

    let query = (supabaseAdmin as any)
      .from("ai_usage_logs")
      .select("*", { count: "exact" })
      .order("created_at", { ascending: false })
      .range(data.offset, data.offset + data.limit - 1);

    if (data.provider) query = query.eq("provider", data.provider);

    const { data: rows, count, error } = await query;
    if (error) throw new Error(`查询失败：${error.message}`);

    // 以前只 select total_tokens —— 于是「花在哪」完全看不出来。现在把输入/输出、
    // 任务类型、时间维度都取回来：token 账单的大头通常是**输入**（每次都要塞照片
    // 和长 prompt），只看总数会以为是模型话多。
    const { data: agg } = await (supabaseAdmin as any)
      .from("ai_usage_logs")
      .select(
        "total_tokens, prompt_tokens, completion_tokens, provider, model, task_type, created_at",
      );

    const zero = () => ({ calls: 0, tokens: 0, input: 0, output: 0 });
    const stats = {
      total_calls: agg?.length ?? 0,
      total_tokens: 0,
      total_input: 0,
      total_output: 0,
      /** 最近 24h / 7d / 30d 的用量，用来看趋势而不是只看历史总和 */
      window: { d1: zero(), d7: zero(), d30: zero() },
      by_provider: {} as Record<string, ReturnType<typeof zero>>,
      by_model: {} as Record<string, ReturnType<typeof zero>>,
      /** 按任务类型拆：识别 / 草稿生成 / 小P蛙… 这才看得出钱花在哪个环节 */
      by_task: {} as Record<string, ReturnType<typeof zero>>,
    };

    const now = Date.now();
    const DAY = 86_400_000;
    const add = (b: ReturnType<typeof zero>, r: any) => {
      b.calls++;
      b.tokens += r.total_tokens ?? 0;
      b.input += r.prompt_tokens ?? 0;
      b.output += r.completion_tokens ?? 0;
    };

    for (const r of agg ?? []) {
      stats.total_tokens += r.total_tokens ?? 0;
      stats.total_input += r.prompt_tokens ?? 0;
      stats.total_output += r.completion_tokens ?? 0;

      const p = r.provider ?? "unknown";
      const m = r.model ?? "unknown";
      const t = r.task_type ?? "unknown";
      ((stats.by_provider[p] ??= zero()), add(stats.by_provider[p], r));
      ((stats.by_model[m] ??= zero()), add(stats.by_model[m], r));
      ((stats.by_task[t] ??= zero()), add(stats.by_task[t], r));

      const age = r.created_at ? now - new Date(r.created_at).getTime() : Infinity;
      if (age <= DAY) add(stats.window.d1, r);
      if (age <= 7 * DAY) add(stats.window.d7, r);
      if (age <= 30 * DAY) add(stats.window.d30, r);
    }

    return { rows: rows ?? [], total: count ?? 0, stats };
  });
