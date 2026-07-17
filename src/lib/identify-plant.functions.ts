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
import { lookupChinaInvasive } from "./china-invasive-list";
import { keepVisualAdvice, DEFAULT_VISUAL_ADVICE } from "./retake-advice";
import { slugify, speciesKey, visibleBodyText, textShingles, jaccardSimilarity } from "./plants";

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

/** Map a Gemini HTTP failure onto an actionable Chinese message. */
function describeGeminiError(httpStatus: number, body: string, model: string): AiError {
  const { status, message, quotaId, retryDelaySec } = parseGeminiError(body);
  const tail = status ? ` · ${status}` : "";
  const code = `GEMINI_${httpStatus}${status ? "_" + status : ""}`;
  const detail = message ? ` Google 原始说明：${message.slice(0, 220)}` : "";
  const head = `AI 文案生成失败（HTTP ${httpStatus}${tail}）`;

  if (httpStatus === 429) {
    if (isDailyQuota(quotaId)) {
      return new AiError(
        code,
        `${head}：Gemini 的「每日免费请求额度」已用尽。今天无法再生成，请等待配额重置（太平洋时间次日 0 点），` +
          `或在管理后台更换 API key / 升级为付费配额。${detail}`,
      );
    }
    return new AiError(
      code,
      `${head}：短时间内请求过多，超出 Gemini 的「每分钟请求数」限制。请${retryDelaySec ? ` ${retryDelaySec} 秒` : "稍"}后重试；` +
        `若频繁出现，说明免费额度偏低，建议升级配额或更换模型。${detail}`,
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
};

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
    const cfg = typeof raw === "string" ? JSON.parse(raw) : raw;
    if (cfg?.provider && cfg?.apiKey && cfg?.model) {
      // Defensive sanitization. `apiKey` may hold a POOL (comma/newline separated).
      // splitGeminiKeys() heals a single whitespace-mangled key (old behaviour) while
      // preserving a real multi-key pool; we re-join on "," as the canonical form.
      // Blind `.replace(/\s+/g,"")` would fuse newline-separated keys into garbage.
      cfg.apiKey = normalizeApiKey(cfg.provider, cfg.apiKey);
      if (cfg.baseUrl) cfg.baseUrl = String(cfg.baseUrl).trim().replace(/\/+$/, "");
      return cfg as AiProviderConfig;
    }
    return null;
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

/** Stage 1 of the two-stage pipeline: a quick species ID from an OpenAI-compatible
 *  vision relay (e.g. glm-5v-turbo). A small request the reasoning model handles
 *  reliably; returns just the Chinese + Latin name (or null on any failure, so the
 *  caller falls back to a Gemini-only draft). */
async function quickIdentify(
  photoDataUrl: string,
  cfg: AiProviderConfig,
): Promise<{ title: string; scientific_name: string; usage: AiTokenUsage; model: string } | null> {
  const apiBase = cfg.baseUrl || "https://api.openai.com/v1";
  const resp = await fetch(`${apiBase}/chat/completions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${cfg.apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
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
    }),
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

/** Identify a plant photo via Pl@ntNet. Returns the top species + 2 alternates with
 *  confidence scores, or null on any failure (caller continues with LLM-only). */
async function plantNetIdentify(
  photoDataUrl: string,
  apiKey: string,
): Promise<{
  scientific_name: string;
  family: string;
  genus: string;
  score: number;
  candidates: string[];
} | null> {
  const m = photoDataUrl.match(/^data:([^;]+);base64,(.+)$/);
  const mime = m?.[1] ?? "image/jpeg";
  const b64 = m?.[2] ?? photoDataUrl;
  const ext = mime.includes("png") ? "png" : mime.includes("webp") ? "webp" : "jpg";
  const bytes = Buffer.from(b64, "base64");

  const form = new FormData();
  form.append("images", new Blob([new Uint8Array(bytes)], { type: mime }), `plant.${ext}`);
  form.append("organs", "auto");

  const url = `https://my-api.plantnet.org/v2/identify/all?api-key=${encodeURIComponent(apiKey)}&nb-results=3`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20_000);
  let resp: Response;
  try {
    resp = await fetch(url, { method: "POST", body: form, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
  if (!resp.ok) {
    console.warn("[Pl@ntNet] HTTP", resp.status, (await resp.text().catch(() => "")).slice(0, 200));
    return null;
  }
  const data = await resp.json();
  const results = Array.isArray(data.results) ? data.results : [];
  const top = results[0];
  const sci = top?.species?.scientificNameWithoutAuthor ?? top?.species?.scientificName ?? "";
  if (!sci) return null;
  return {
    scientific_name: sci,
    family: top.species?.family?.scientificNameWithoutAuthor ?? "",
    genus: top.species?.genus?.scientificNameWithoutAuthor ?? "",
    score: typeof top.score === "number" ? top.score : 0,
    candidates: results.slice(0, 3).map((r: any) => {
      const n = r.species?.scientificNameWithoutAuthor ?? r.species?.scientificName ?? "?";
      const s = typeof r.score === "number" ? Math.round(r.score * 100) : 0;
      return `${n}（${s}%）`;
    }),
  };
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

async function callAiIdentify(
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
  // Load admin-configured model from DB (affects ALL users); fall back to env vars
  let dbConfig = await loadAiConfig();

  // ── Two-stage: glm 快速识别 + Gemini 出草稿 ─────────────────────────────────
  // A custom relay (great at a quick vision ID, unreliable on the heavy 21-field draft)
  // identifies the species; then Gemini writes the full schema-enforced draft using that
  // ID as a hint. Needs a saved `custom` config AND an env Gemini key. If the quick ID
  // fails we still fall through to a Gemini-only draft, so identify never breaks.
  let stageModel = "";
  let stageUsage: AiTokenUsage | null = null;
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
    const pn = await plantNetIdentify(photoDataUrl, plantNetKey).catch((e) => {
      console.warn("[Pl@ntNet] identify failed; continuing with LLM-only:", e);
      return null;
    });
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

  if (!pinned && dbConfig?.provider === "custom" && dbConfig.apiKey && process.env.GEMINI_API_KEY) {
    const quick = await quickIdentify(photoDataUrl, dbConfig).catch((e) => {
      console.warn("[Two-stage] quick ID failed; falling back to Gemini-only:", e);
      return null;
    });
    if (quick && (quick.title || quick.scientific_name)) {
      if (!earlySpeciesName && quick.scientific_name) earlySpeciesName = quick.scientific_name;
      idHint += `\n\n【初步识别提示】另一视觉模型已将本图判定为：「${quick.title}」${quick.scientific_name ? `（${quick.scientific_name}）` : ""}。请结合照片核对该判定并据此生成草稿；若你认为该判定有误，请以你的判断为准，并在 summary_zh 中简要说明分歧。`;
      stageModel = stageModel ? `${stageModel}+${quick.model}` : quick.model;
      stageUsage = quick.usage;
    }
    dbConfig = null; // route the heavy draft to the env Gemini path below
  }

  // ── Token-saving branch: if we got a species ID from the cheap stages, try to reuse
  // an existing draft's universal content and only regenerate the photo-specific field_notes.
  // Fully non-fatal: any failure falls through to the normal full-draft generation below.
  if (earlySpeciesName) {
    const existing = await findExistingSpeciesDraft(earlySpeciesName).catch((e) => {
      console.warn("[TokenSave] Query failed:", e);
      return null;
    });
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
        // Success: merge the existing universal content with the new field_notes
        const meta: AiMeta = {
          ...existing,
          field_notes_zh: fieldNotesResult.field_notes_zh,
          field_notes_en: fieldNotesResult.field_notes_en,
        };
        const totalUsage: AiTokenUsage = {
          prompt_tokens: (stageUsage?.prompt_tokens ?? 0) + fieldNotesResult.usage.prompt_tokens,
          completion_tokens:
            (stageUsage?.completion_tokens ?? 0) + fieldNotesResult.usage.completion_tokens,
          total_tokens: (stageUsage?.total_tokens ?? 0) + fieldNotesResult.usage.total_tokens,
        };
        console.log(
          `[TokenSave] Reused existing draft, only regenerated field_notes. Tokens: ${totalUsage.total_tokens}`,
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
- name_origin_zh：220–360 字，分两部分：① 中文名（俗名、古名、地方名）的字源、典籍出处；② 拉丁学名属名 + 种加词的词根含义、命名人/命名年代背景。name_origin_en：80–140 词。
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
      let model =
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
            prompt_tokens: (u.promptTokenCount ?? 0) + (stageUsage?.prompt_tokens ?? 0),
            completion_tokens: (u.candidatesTokenCount ?? 0) + (stageUsage?.completion_tokens ?? 0),
            total_tokens: (u.totalTokenCount ?? 0) + (stageUsage?.total_tokens ?? 0),
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

    const requestBody = JSON.stringify({
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
    });

    // 429 = rate limit, 503 = overloaded — both transient on relay/中转 endpoints
    // (which often have strict per-account rate limits). Retry with backoff so a
    // burst of visitors doesn't fail identify outright.
    let attempts = 0;
    const maxAttempts = 3;
    let resp: Response | null = null;
    while (attempts < maxAttempts) {
      attempts++;
      resp = await fetch(`${apiBase}/chat/completions`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${openaiKey}`,
          "Content-Type": "application/json",
        },
        body: requestBody,
      });
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
      let model = process.env.AI_MODEL || "gemini-3-flash-preview";
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

/** Fetch real, distinct field photos of a species from public biodiversity APIs
 *  (iNaturalist research-grade → GBIF → Wikimedia), for the draft's body sections.
 *  Server-side sibling of the client `searchPlantImages`. Never throws — returns
 *  as many distinct full-size URLs as it can (≤ n), or [] on total failure. */
async function fetchSpeciesPhotos(term: string, n: number): Promise<string[]> {
  const q = (term || "").trim();
  if (!q) return [];
  const timeoutFetch = async (url: string) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    try {
      const r = await fetch(url, {
        signal: controller.signal,
        headers: { "User-Agent": "Plantspedia/1.0" },
      });
      return r.ok ? await r.json() : null;
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
  };

  const urls: string[] = [];
  const seen = new Set<string>();
  const add = (u?: string | null) => {
    const s = (u || "").trim();
    if (s && !seen.has(s)) {
      seen.add(s);
      urls.push(s);
    }
  };

  // Greedy diversity pick: never take two photos that share a place / season /
  // photographer until we're forced to. Without this the top-voted photos of one
  // species are usually the SAME plant shot by the same person on the same day.
  // `part` = which organ the shot shows ("leaf"/"flower"/"fruit"/"plant"/"" general),
  // so the picker can spread the chosen photos across plant parts rather than return
  // five near-identical flower close-ups.
  type Cand = { url: string; place: string; season: string; who: string; part: string };
  const pickDiverse = (cands: Cand[], want: number): string[] => {
    const out: string[] = [];
    const places = new Set<string>();
    const seasons = new Set<string>();
    const whos = new Set<string>();
    const parts = new Set<string>();
    // pass 3 = all axes (incl. plant part) must be new; pass 2 = place must be new; pass 1 = anything.
    for (const strict of [3, 2, 1]) {
      for (const c of cands) {
        if (out.length >= want) return out;
        if (seen.has(c.url)) continue;
        if (
          strict === 3 &&
          ((c.place && places.has(c.place)) ||
            (c.season && seasons.has(c.season)) ||
            (c.who && whos.has(c.who)) ||
            (c.part && parts.has(c.part)))
        )
          continue;
        if (strict === 2 && c.place && places.has(c.place)) continue;
        seen.add(c.url);
        out.push(c.url);
        if (c.place) places.add(c.place);
        if (c.season) seasons.add(c.season);
        if (c.who) whos.add(c.who);
        if (c.part) parts.add(c.part);
      }
    }
    return out;
  };

  /** Take the best candidate from `pool` that doesn't repeat a place/photographer
   *  already used. Used to guarantee one shot per organ before any filler. */
  const takeOne = (
    pool: Cand[],
    places: Set<string>,
    whos: Set<string>,
  ): string | null => {
    for (const relax of [false, true]) {
      for (const c of pool) {
        if (seen.has(c.url)) continue;
        if (!relax && ((c.place && places.has(c.place)) || (c.who && whos.has(c.who)))) continue;
        seen.add(c.url);
        if (c.place) places.add(c.place);
        if (c.who) whos.add(c.who);
        return c.url;
      }
    }
    return null;
  };

  // 1) iNaturalist — best for real, vetted species field photos. Pull a general
  //    votes-sorted pool PLUS organ-annotated pools so the draft's section images span
  //    叶 / 花 / 果 / 植株 / 生境 rather than five near-identical flower close-ups.
  //
  //    Annotation term ids are the live values from /v1/controlled_terms (verified, not
  //    guessed): 36「Leaves」→ 38 Green Leaves; 12「Flowers and Fruits」→ 13 Flowers,
  //    14 Fruits or Seeds, 21 No Flowers or Fruits (= vegetative → whole-plant/habitat).
  //
  //    Reality check that shapes the code below: for the rare Ordos species this site
  //    cares about, the annotated pools are nearly EMPTY (沙冬青 has leaf=1, flower=0,
  //    fruit=0 research-grade observations, but 20 in the general pool). So the organ
  //    pools are treated as a best-effort *bonus* on top of the general pool, never as
  //    the only source — otherwise rare species would come back with no photos at all.
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
      part: string,
      size = "15",
    ): Promise<Cand[]> => {
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
      const out: Cand[] = [];
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
          place: obs?.place_guess || coords.map((c) => Math.round(c)).join(","),
          season: (obs?.observed_on || "").slice(5, 7), // month → different phenology/生境
          who: obs?.user?.login || "",
          part,
        });
      }
      return out;
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
      if (urls.length >= n) break;
      const u = takeOne(pool, usedPlaces, usedWhos);
      if (u) urls.push(u);
    }

    // Pass B — fill the rest from every pool, still spreading across
    // place / season / photographer / organ (`seen` already excludes Pass A picks).
    if (urls.length < n) {
      const cands: Cand[] = [];
      const pools = [fruiting, flowering, leaves, vegetative, general];
      const maxLen = Math.max(...pools.map((p) => p.length));
      for (let i = 0; i < maxLen; i++) for (const p of pools) if (p[i]) cands.push(p[i]);
      for (const u of pickDiverse(cands, n - urls.length)) urls.push(u);
    }
    if (urls.length >= n) return urls;
  } catch {
    /* fall through to next source */
  }

  // 2) GBIF occurrences with media.
  if (urls.length < n) {
    try {
      const m = await timeoutFetch(
        "https://api.gbif.org/v1/species/match?" + new URLSearchParams({ name: q }),
      );
      const key = m?.usageKey ?? null;
      const params = new URLSearchParams({ mediaType: "StillImage", limit: "60" });
      if (key) params.set("taxonKey", String(key));
      else params.set("q", q);
      const j = await timeoutFetch("https://api.gbif.org/v1/occurrence/search?" + params);
      const cands: Cand[] = [];
      for (const occ of j?.results ?? []) {
        const media = occ?.media?.[0]; // one image per occurrence
        if (!media?.identifier) continue;
        cands.push({
          url: String(media.identifier),
          place: occ?.stateProvince || occ?.country || occ?.locality || "",
          season: String(occ?.month ?? ""),
          who: occ?.recordedBy || "",
          part: "",
        });
      }
      for (const u of pickDiverse(cands, n - urls.length)) urls.push(u);
      if (urls.length >= n) return urls;
    } catch {
      /* fall through */
    }
  }

  // 3) Wikimedia Commons live photos.
  const commonsSearch = async (search: string, limit: string) => {
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
          iiprop: "url|mime",
          iiurlwidth: "1200",
        }),
    );
    const pages = j?.query?.pages ?? {};
    for (const k of Object.keys(pages)) {
      const ii = pages[k]?.imageinfo?.[0];
      if (!ii?.url || (ii.mime || "").includes("svg")) continue;
      // `url` is the FULL-SIZE original (often 10–50 MB). `thumburl` is the scaled
      // 1200px render — always prefer it so we store a sane file.
      add(ii.thumburl || ii.url);
      if (urls.length >= n) return true;
    }
    return urls.length >= n;
  };

  if (urls.length < n) {
    try {
      if (await commonsSearch(q + " filetype:bitmap", "30")) return urls;
    } catch {
      /* fall through */
    }
  }

  // 4) LAST RESORT — herbarium specimen sheets + botanical illustrations / line
  //    drawings. Deliberately last: a pressed specimen or a plate teaches far less
  //    about a living plant than a field photo, so these only fill slots that real
  //    photos could not. Rare species (few/no iNat observations) are exactly the case
  //    where this tier saves a draft from shipping with blank image slots.
  if (urls.length < n) {
    try {
      const params = new URLSearchParams({
        mediaType: "StillImage",
        basisOfRecord: "PRESERVED_SPECIMEN",
        limit: "40",
        q,
      });
      const j = await timeoutFetch("https://api.gbif.org/v1/occurrence/search?" + params);
      const cands: Cand[] = [];
      for (const occ of j?.results ?? []) {
        const media = occ?.media?.[0];
        if (!media?.identifier) continue;
        cands.push({
          url: String(media.identifier),
          // Herbarium sheets: spread across collections rather than place/season.
          place: occ?.institutionCode || occ?.collectionCode || "",
          season: "",
          who: occ?.recordedBy || "",
          part: "specimen",
        });
      }
      for (const u of pickDiverse(cands, n - urls.length)) urls.push(u);
      if (urls.length >= n) return urls;
    } catch {
      /* fall through */
    }
  }

  if (urls.length < n) {
    try {
      // Commons hosts the classic plates (Flora of China / Curtis's / BHL scans) and
      // line drawings under these terms.
      for (const term of ["illustration", "botanical illustration", "line drawing"]) {
        if (await commonsSearch(`${q} ${term} filetype:bitmap`, "15")) return urls;
      }
    } catch {
      /* give up gracefully */
    }
  }

  return urls;
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
async function rehostImages(urls: string[], prefix: string): Promise<string[]> {
  const out: string[] = [];
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
        headers: { "User-Agent": "Plantspedia/1.0" },
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

  for (let i = 0; i < urls.length; i++) {
    const src = urls[i];
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
        continue;
      }
      out.push(supabaseAdmin.storage.from("plant-images").getPublicUrl(path).data.publicUrl);
    } catch (e) {
      console.warn(`[RehostImages] failed for ${src}:`, e instanceof Error ? e.message : e);
    }
  }
  return out;
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
      headers: { "User-Agent": "Plantspedia/1.0" },
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
    summary_en: { type: "string", description: "50–90 词" },
    field_notes_zh: {
      type: "string",
      description: "拍摄记录：对本张照片的形态分析 + 定种判断依据",
    },
    field_notes_en: { type: "string" },
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
    "summary_en",
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
  },
): Promise<{ meta: AiMeta; model: string; provider: string; usage: AiTokenUsage } | null> {
  // Prefer the admin-configured Gemini model/key so the quick summary card uses the
  // SAME model as the rest of the site (e.g. gemini-3.5-flash). The quick path is
  // Gemini-only, so a non-Gemini admin config falls back to the env Gemini key.
  const dbConfig = await loadAiConfig();
  const useDbGemini = dbConfig?.provider === "gemini" && !!dbConfig.apiKey;
  const geminiKey = useDbGemini ? dbConfig!.apiKey : process.env.GEMINI_API_KEY;
  if (!geminiKey) return null;
  const model =
    useDbGemini && dbConfig!.model ? dbConfig!.model : process.env.AI_MODEL || "gemini-3-flash-preview";

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

  const system = `你是 Plantspedia 的首席植物学家。请**快速**识别这张实地拍摄的植物照片，并只产出一张"简介摘要卡"所需的少量字段（不要写形态/人文/养护等长篇分区）。${retakeCtx}${forceCtx}
- summary_zh：150–260 字趣味导语（博物学家口吻，讲与生活相关的趣闻/冷知识，勾起好奇心；不要罗列科属学名形态，也不要复述「本次拍摄于…」）。summary_en：50–90 词意译。
- field_notes_zh：120–220 字「拍摄记录」，只针对本张照片的可见诊断特征 + 定种依据；field_notes_en：45–85 词。
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

  try {
    const parts: unknown[] = [
      {
        text: `请识别这${prior.length ? "组" : "张"}植物照片。${multiNote}${hintPlace ? `拍摄地点：${hintPlace}。` : ""}只按指定 JSON 结构返回简介摘要卡字段。`,
      },
      { inlineData: { mimeType, data: base64Data } },
      ...prior.map((im) => ({ inlineData: { mimeType: im.mimeType, data: im.base64 } })),
    ];
    const data = await callGeminiWithRotation(splitGeminiKeys(geminiKey), {
      model,
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
      model,
      provider: "gemini-quick",
      usage: {
        prompt_tokens: u.promptTokenCount ?? 0,
        completion_tokens: u.candidatesTokenCount ?? 0,
        total_tokens: u.totalTokenCount ?? 0,
      },
    };
  } catch (e) {
    // Rotation already tried every key. A hard, described failure (quota exhausted on
    // ALL keys, invalid config…) must reach the user with its explanation rather than
    // silently falling back to the heavy path, which would hit the same wall.
    if (e instanceof AiError) throw e;
    console.warn("[identifyQuick] soft failure, falling back:", e instanceof Error ? e.message : e);
    return null;
  }
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
  } = await callAiIdentify(dataUrl, place, speciesHint, webResearch);

  // Belt-and-suspenders: if a species was pinned, force the rendered name to match
  // it even if the model quietly drifted, so the page title == the card title.
  if (speciesHint?.title) meta.title = speciesHint.title;
  if (speciesHint?.scientificName) meta.scientific_name = speciesHint.scientificName;

  // Find real online field photos of the species for the body sections (the hero
  // keeps the user's own photo). Re-host into our own bucket so the page doesn't
  // hotlink foreign hosts (broken/slow from China). Non-fatal.
  let sectionImages: string[] = [];
  try {
    const sci = (meta.scientific_name || "").trim().split(/\s+/).slice(0, 2).join(" ");
    const term = sci || meta.common_name_en || meta.title || "";
    if (term) {
      const external = await fetchSpeciesPhotos(term, 5);
      const rehosted = await rehostImages(external, "drafts/species/section");
      sectionImages = rehosted.length ? rehosted : external;
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
  const html = renderDraftHtml({
    ...meta,
    photo_url: photoUrl,
    section_images: sectionImages,
    invasive: invasiveCard,
    conservation: conservationBadgesList,
    conservation_card: conservationCardObj,
    capture_place: place || "未知地点",
    capture_lat: lat != null ? lat.toFixed(5) : "",
    capture_lng: lng != null ? lng.toFixed(5) : "",
    capture_date: captureDate,
    ai_model: usedModel,
  });

  return { meta, usedModel, usedProvider, usage, html, isInvasive, gbifTaxonKey };
}

// Lite summary-card HTML for a phase-1 draft. Shows ALL of the user's own shots
// (a gallery, newest first) so retakes visibly accumulate, plus the short summary.
// ── 「疑似」单一信号源 ────────────────────────────────────────────────────────
// 名称、正文、补拍横幅必须一致：要么都疑似，要么都不疑似。模型偶尔会 confidence 写
// medium 却在 summary_zh 里说「疑似」（反之亦然），导致标题不带疑似但正文带、补拍不激活。
// 这里把 meta 就地规范化为唯一真相：任一处露出疑似 → 全部疑似（confidence=low，激活补拍），
// 并保证 summary 带疑似前缀、needs_more_photos_zh 非空（补拍横幅依赖它）。
const TENTATIVE_RE = /^\s*（?\s*疑似\s*）?/;
function stripTentativePrefix(s: string): string {
  return (s || "").replace(TENTATIVE_RE, "").trim();
}

function normalizeIdentification(meta: AiMeta): void {
  const summaryZh = (meta.summary_zh || "").toString();
  const tentative =
    meta.identification_confidence === "low" || TENTATIVE_RE.test(summaryZh.trim().slice(0, 6));
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
function registryChipsHtml(chips: { kind: string; label: string }[]): string {
  if (!chips.length) return "";
  const TONE: Record<string, { fg: string; bd: string }> = {
    protected: { fg: "#1f7a44", bd: "#2e9e5b" },
    cites: { fg: "#5f45a3", bd: "#7a5cc4" },
    gts: { fg: "#8a6a20", bd: "#c79a3a" },
    griis: { fg: "#c8452f", bd: "#c8452f" },
  };
  const pills = chips
    .map((c) => {
      const t = TONE[c.kind] ?? { fg: "#8a6b4a", bd: "#e2ddd1" };
      return (
        `<span style="display:inline-block;border:1.5px solid ${t.bd};color:${t.fg};` +
        `border-radius:999px;padding:2px 10px;font-size:12px;font-weight:600;line-height:1.6">` +
        `${htmlEsc(c.label)}</span>`
      );
    })
    .join("");
  return `<div style="display:flex;flex-wrap:wrap;gap:6px;margin:.5em 0 .2em">${pills}</div>`;
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
});

export const submitPlantDraft = createServerFn({ method: "POST" })
  .inputValidator((input) => SubmitInput.parse(input))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // Try to identify the authenticated user (optional — anon is allowed).
    let createdBy: string | null = null;
    let creatorLabel = data.creator_label?.trim() || "访客";
    try {
      const { getRequestHeader } = await import("@tanstack/react-start/server");
      const authHeader = getRequestHeader("Authorization");
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
    const safeTitle = (meta.title || meta.scientific_name || "待鉴定植物").toString().slice(0, 200);

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
      const { getRequestHeader } = await import("@tanstack/react-start/server");
      const authHeader = getRequestHeader("Authorization");
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
export const quickIdentifyDraft = createServerFn({ method: "POST" })
  .inputValidator((input) => SubmitInput.parse(input))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { dbCreatedBy, creatorLabel } = await resolveCreator(
      data.creator_label,
      data.logged_in_user_id,
    );

    let place = "";
    const lat = data.lat ?? null;
    const lng = data.lng ?? null;
    if (lat != null && lng != null) {
      place = await reverseGeocode(lat, lng);
      console.log(`[QuickIdentify] Reverse-geocoded to: ${place}`);
    }

    const dataUrl = `data:${data.photo_mime};base64,${data.photo_base64}`;

    // Upload the user photo: it's the summary card's hero AND a re-identify source
    // later (user can re-run enrich / re-upload from a better-signal spot).
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

    let meta: AiMeta;
    let usedModel: string;
    let usedProvider: string;
    let usage: AiTokenUsage;
    let html: string;
    let enriched: boolean;
    let isInvasive = false;
    let gbifTaxonKey: number | null = null;

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
    const allPhotos = [photoUrl, ...priorPhotos].filter(Boolean).slice(0, 12);

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

    const quick = await identifyQuick(dataUrl, place, {
      speciesHint,
      retakeCount,
      forceResult: retakeCount >= 3, // 补拍满 3 次必须出结论（哪怕疑似）
      priorPhotos: priorInline,
    });
    if (quick) {
      meta = quick.meta;
      usedModel = quick.model;
      usedProvider = quick.provider;
      usage = quick.usage;
      enriched = false;
      // 统一疑似信号：名称/正文/补拍横幅三者一致（详见 normalizeIdentification）。
      normalizeIdentification(meta);
      // Summary-card HTML with the full gallery of the user's own shots (newest first).
      html = buildSummaryCardHtml({
        photos: allPhotos,
        title: meta.title || "",
        sci: meta.scientific_name || "",
        summaryZh: meta.summary_zh || "",
        family: meta.family,
        genus: meta.genus,
        tentative: meta.identification_confidence === "low",
        chips: await lookupRegistryChips(meta.scientific_name, meta.family),
      });
    } else {
      // Gemini quick path unavailable → full pipeline (slower but robust).
      const full = await buildDraftContent({ dataUrl, photoUrl, place, lat, lng });
      meta = full.meta;
      usedModel = full.usedModel;
      usedProvider = full.usedProvider;
      usage = full.usage;
      html = full.html;
      isInvasive = full.isInvasive;
      gbifTaxonKey = full.gbifTaxonKey;
      enriched = true;
    }

    const safeTitle = (meta.title || meta.scientific_name || "待鉴定植物").toString().slice(0, 200);
    const aiPayload = JSON.parse(JSON.stringify({ ...meta, _enriched: enriched }));

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
  });

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

export const enrichDraft = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => EnrichInput.parse(input))
  .handler(async ({ data, context }) => {
    const { userId } = context;
    const email = (context.claims as { email?: string } | undefined)?.email ?? null;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: draftRow, error: loadErr } = await supabaseAdmin
      .from("plant_drafts")
      .select(
        "id, photo_url, capture_lat, capture_lng, capture_place, ai_payload, status, title, scientific_name, common_name_en, common_names_zh, family, genus",
      )
      .eq("id", data.draft_id)
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
    if (draft.ai_payload?._enriched) return { draftId: draft.id as string, alreadyEnriched: true };

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

    // Re-fetch the stored user photo → data URL for the multimodal call.
    const photoUrl = draft.photo_url as string;
    if (!photoUrl)
      throw new AiError(
        "DRAFT_NO_PHOTO",
        "生成失败（DRAFT_NO_PHOTO）：这份草稿没有原图，无法重新送 AI 生成。请重新拍照识别。",
      );
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
      })
      .eq("id", draft.id);
    if (updErr)
      throw new AiError(
        "DRAFT_UPDATE_FAILED",
        `生成失败（DRAFT_UPDATE_FAILED）：内容已生成，但写回数据库时出错。原因：${updErr.message}。`,
      );

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

export const createGoldDetailPageFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  // `UserModelInput` is a const declared further down; reference it at REQUEST time
  // (inside the callback) rather than at module-init, where it isn't assigned yet.
  .inputValidator((input) =>
    z.object({ draft_id: z.string().uuid(), userModel: UserModelInput }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { userId } = context;
    const email = (context.claims as { email?: string } | undefined)?.email ?? null;
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
      .eq("id", data.draft_id)
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

    // 3. Ground-truth facts from the real registries.
    const facts = await gatherVerifiedFacts(draft);

    // 4. Fill the 9 body image slots (hero stays the user's own photo).
    //    fetchSpeciesPhotos already diversifies by place/season/photographer;
    //    rehostImages compresses (1280px webp) before storing in Supabase.
    let images: string[] = [];
    try {
      const term =
        facts.scientificName.split(/\s+/).slice(0, 2).join(" ") ||
        facts.commonNameEn ||
        facts.title;
      const external = await fetchSpeciesPhotos(term, 9);
      images = await rehostImages(external, `plants/gold/${draft.id}`);
    } catch (e) {
      console.warn("[GoldPage] image fetch failed; slots will render as .broken:", e);
    }

    // Resolve model override (needed for web research calls below)
    const override = toOverride(data.userModel);

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

    // Phase 1 调研：形态、生境、近缘种区分
    const query1 = `${speciesFullName} 的形态特征、生境分布、近缘种区分要点、栽培养护的最新权威资料（优先中国植物志、Flora of China、园艺文献）`;
    webResearch1 = await xiaopGroundedSearch(query1, override);
    goldUsage = addUsage(goldUsage, webResearch1?.usage);
    if (webResearch1) {
      console.log(`[GoldPage Phase1] Web research: ${webResearch1.sources.length} sources`);
    }

    // Phase 2 调研：人文、民俗、文学、药用
    const query2 = `${speciesFullName} 的人文历史、民俗用途、文学记载、本草典籍、食药用价值的权威资料（优先古籍数据库、民族植物学文献）`;
    webResearch2 = await xiaopGroundedSearch(query2, override);
    goldUsage = addUsage(goldUsage, webResearch2?.usage);
    if (webResearch2) {
      console.log(`[GoldPage Phase2] Web research: ${webResearch2.sources.length} sources`);
    }

    // Phase 3 调研：生态功能、入侵状态、最新科研
    const query3 = `${speciesFullName} 的生态功能、入侵风险、保护管理、近期重要科研进展（优先 IUCN、GBIF、学术期刊）`;
    webResearch3 = await xiaopGroundedSearch(query3, override);
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
        override,
      });
      goldUsage = addUsage(goldUsage, usage);
      goldProvider = provider;
      goldModel = model;
      try {
        return JSON.parse(cleanJson(txt));
      } catch {
        throw new AiError(
          `GOLD_BAD_JSON_${label}`,
          `创建失败（GOLD_BAD_JSON_${label}）：模型返回的内容不是完整 JSON，通常是生成被截断。请重试；反复出现可在管理后台给小P蛙换一个更强的模型。`,
        );
      }
    };

    const p1 = await ask(
      withWebContext(premiumPrompt1(facts), webResearch1),
      PREMIUM_SCHEMA_1,
      "1",
    );
    const p2 = await ask(
      withWebContext(premiumPrompt2(facts), webResearch2),
      PREMIUM_SCHEMA_2,
      "2",
    );
    const p3 = await ask(
      withWebContext(premiumPrompt3(facts), webResearch3),
      PREMIUM_SCHEMA_3,
      "3",
    );
    const fields = { ...p1, ...p2, ...p3 } as PremiumFields;

    // 6. Render + upload the HTML body.
    const html = renderPremiumHtml(fields, facts, { heroUrl: draft.photo_url as string, images });
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
    const htmlPath = `${dbUserId}/draft-${draft.id}.html`;
    const blob = new Blob([draft.html_content as string], { type: "text/html" });
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
        body_text: visibleBodyText(String(draft.html_content || "")),
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
    const cfg = typeof raw === "string" ? JSON.parse(raw) : raw;
    if (cfg?.provider && cfg?.apiKey && cfg?.model) {
      cfg.apiKey = normalizeApiKey(cfg.provider, cfg.apiKey);
      if (cfg.baseUrl) cfg.baseUrl = String(cfg.baseUrl).trim().replace(/\/+$/, "");
      return cfg as AiProviderConfig;
    }
    return null;
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
async function fetchInlineImage(url: string): Promise<InlineImage | null> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15_000);
    const r = await fetch(url, { signal: controller.signal });
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

/** Gemini chat call (structured output via responseSchema; optional vision). */
async function geminiChat(
  apiKey: string,
  model: string,
  contents: ChatContents,
  system: string,
  schema?: unknown,
  maxRetry = 3,
  images?: InlineImage[],
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
      label: "小P",
      body: {
        contents: gContents,
        systemInstruction: { parts: [{ text: system }] },
        generationConfig,
      },
    });
    const txt = res.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!txt) throw new Error("小P 未返回有效内容。");
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
        "小P 响应超时（等了 2 分钟）：模型思考较慢，带图提问尤其耗时。请重试一次；连续超时可换更快的视觉模型。",
      );
    }
    throw e;
  }
}

/** OpenAI-compatible chat (covers provider `openai` and `custom` relays; optional vision). */
async function openaiCompatChat(
  apiKey: string,
  baseUrl: string,
  model: string,
  contents: ChatContents,
  system: string,
  schema?: unknown,
  images?: InlineImage[],
): Promise<AiTextResult> {
  const apiBase = (baseUrl || "https://api.openai.com/v1").replace(/\/+$/, "");

  // Build the OpenAI messages. `useImages` attaches the photo(s) to the last user
  // turn as image_url parts — dropped on the text-only retry below.
  const buildMessages = (useImages: boolean): { role: string; content: unknown }[] => {
    const idx = useImages && images?.length ? lastUserIndex(contents) : -1;
    return [
      {
        role: "system",
        content: schema
          ? `${system}\n\n只返回一个 JSON 对象，不要 markdown、不要多余文字。`
          : system,
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

  // One request with its own network retry + timeout. Returns the Response, or
  // throws a described network/timeout error.
  const send = async (useImages: boolean): Promise<Response> => {
    // NOTE: deliberately DO NOT send response_format:json_object — some relays /
    // reasoning models return an EMPTY reply when it's set. We instruct JSON in the
    // system prompt + cleanJson() instead.
    const body: Record<string, unknown> = {
      model,
      messages: buildMessages(useImages),
      max_tokens: 16000,
    };
    let lastErr: unknown = null;
    for (let attempt = 0; attempt < 2; attempt++) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 120_000);
      try {
        const r = await fetch(`${apiBase}/chat/completions`, {
          method: "POST",
          signal: controller.signal,
          headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
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
        "小P 响应超时（等了 2 分钟）：当前模型思考较慢，带图提问尤其耗时。可以重试一次；" +
          "若连续超时，请在「模型设置」换更快的视觉模型，或确认所配模型支持看图。",
      );
    }
    throw new Error(
      `小P 连接中转失败（${lastErr instanceof Error ? lastErr.message : "网络错误"}）：` +
        `请检查中转地址/网络；整页改写体量较大时该中转可能超时，可在 /identify 把小P模型切回默认 Gemini 再试。`,
    );
  };

  let resp = await send(!!images?.length);
  // Text-only models (e.g. DeepSeek deepseek-chat) reject the vision `image_url`
  // part with a 400. Rather than fail the whole chat, retry once WITHOUT images so
  // text conversation still works — the user just can't get image-based answers.
  if (!resp.ok && images?.length) {
    const t = await resp.clone().text();
    if (
      /image_url|unknown variant|expected\s+`?text`?|does ?n['’]?t support image|not support.*image|multimodal|vision/i.test(
        t,
      )
    ) {
      resp = await send(false);
    }
  }
  if (!resp.ok) {
    const t = await resp.text();
    throw new Error(`小P 调用失败 (HTTP ${resp.status})：${t.slice(0, 200)}`);
  }
  const res = await resp.json();
  const content = res.choices?.[0]?.message?.content;
  if (!content) throw new Error("小P 未返回有效内容。");
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
): Promise<AiTextResult> {
  const apiBase = (baseUrl || "https://api.anthropic.com/v1").replace(/\/+$/, "");
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
  const sys = schema ? `${system}\n\n只返回一个 JSON 对象，不要 markdown、不要多余文字。` : system;
  const resp = await fetch(`${apiBase}/messages`, {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ model, system: sys, messages, max_tokens: 8000 }),
  });
  if (!resp.ok) {
    const t = await resp.text();
    throw new Error(`小P 调用失败 (HTTP ${resp.status})：${t.slice(0, 200)}`);
  }
  const res = await resp.json();
  const txt = res.content?.[0]?.text;
  if (!txt) throw new Error("小P 未返回有效内容。");
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
  override?: AiProviderConfig | null;
}): Promise<AiTextResult & { provider: string; model: string }> {
  const cfg = opts.override && opts.override.apiKey ? opts.override : await loadXiaoPConfig();
  const provider = cfg?.provider ?? "gemini";

  if (provider === "gemini") {
    const apiKey =
      cfg?.provider === "gemini" && cfg.apiKey ? cfg.apiKey : process.env.GEMINI_API_KEY;
    if (!apiKey) throw new Error("小P 暂不可用：未配置模型，且服务器无 GEMINI_API_KEY。");
    const model =
      cfg?.provider === "gemini" && cfg.model
        ? cfg.model
        : process.env.AI_MODEL || "gemini-3-flash-preview";
    const r = await geminiChat(
      apiKey,
      model,
      opts.contents,
      opts.system,
      opts.schema,
      opts.maxRetry ?? 3,
      opts.images,
    );
    return { ...r, provider: "gemini", model };
  }
  if (!cfg) throw new Error("小P 暂不可用：模型未配置。");
  if (provider === "anthropic") {
    const r = await anthropicChat(
      cfg.apiKey,
      cfg.baseUrl || "",
      cfg.model,
      opts.contents,
      opts.system,
      opts.schema,
      opts.images,
    );
    return { ...r, provider: "anthropic", model: cfg.model };
  }
  // openai + custom share the OpenAI-compatible path
  const r = await openaiCompatChat(
    cfg.apiKey,
    cfg.baseUrl || "",
    cfg.model,
    opts.contents,
    opts.system,
    opts.schema,
    opts.images,
  );
  return { ...r, provider, model: cfg.model };
}

// ── 小P蛙 联网检索（Google 搜索 grounding，仅 Gemini）───────────────────────────
// Grounding is INCOMPATIBLE with responseSchema (structured output), so we run it as
// a SEPARATE free-text call and inject the digest + sources back into the structured
// answer. Gemini-only; returns null for other providers or on any failure (graceful).

/** Resolve the effective Gemini key/model for 小P (mirrors xiaopTextCall's gemini branch). */
async function resolveXiaoPGemini(
  override: AiProviderConfig | null,
): Promise<{ apiKey: string; model: string } | null> {
  const cfg = override && override.apiKey ? override : await loadXiaoPConfig();
  const provider = cfg?.provider ?? "gemini";
  if (provider !== "gemini") return null; // google_search grounding is Gemini-only
  const apiKey = cfg?.provider === "gemini" && cfg.apiKey ? cfg.apiKey : process.env.GEMINI_API_KEY;
  if (!apiKey) return null;
  const model =
    cfg?.provider === "gemini" && cfg.model
      ? cfg.model
      : process.env.AI_MODEL || "gemini-3-flash-preview";
  return { apiKey, model };
}

async function xiaopGroundedSearch(
  query: string,
  override: AiProviderConfig | null,
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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
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
  override: AiProviderConfig | null;
}): Promise<AiTextResult & { provider: string; model: string }> {
  const first = await xiaopTextCall({
    contents: opts.contents,
    system: opts.system,
    schema: opts.schema,
    images: opts.images,
    override: opts.override,
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

  const search = await xiaopGroundedSearch(String(parsed.webQuery).trim(), opts.override);
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
    override: opts.override,
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
  })
  .optional();

/** Normalize a client-sent user model into an AiProviderConfig (or null). */
function toOverride(um: z.infer<typeof UserModelInput>): AiProviderConfig | null {
  if (!um || !um.apiKey || !um.model) return null;
  return {
    provider: um.provider,
    apiKey: normalizeApiKey(um.provider, um.apiKey),
    model: String(um.model).trim(),
    baseUrl: um.baseUrl ? String(um.baseUrl).trim().replace(/\/+$/, "") : undefined,
  };
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
      .select("title,scientific_name,html_content,photo_url")
      .eq("id", data.draftId)
      .maybeSingle();
    if (!draft) throw new Error("草稿不存在");

    // Scope-aware vision: an annotated section → only THAT section's images; the
    // whole draft (no scope) → visitor's uploaded photo + every draft illustration.
    const draftHtml = draft.html_content || "";
    const visionUrls = xiaopVisionUrls({
      html: draftHtml,
      scope: data.scope,
      coverUrl: draft.photo_url,
    });
    const photos = await fetchInlineImages(visionUrls);

    const docText = htmlToText(draftHtml);
    const scopeLine = data.scope
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
            text: `【待审草稿：${draft.title}${draft.scientific_name ? "（" + draft.scientific_name + "）" : ""}】\n以下是草稿正文纯文本：\n${docText}`,
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
      override: toOverride(data.userModel),
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
 *  the client to persist via saveDraftHtmlContentFn. */
export const applyDraftAgentEditFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => ApplyDraftAgentEditInput.parse(input))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: draft } = await supabaseAdmin
      .from("plant_drafts")
      .select("status,html_content")
      .eq("id", data.draftId)
      .maybeSingle();
    if (!draft) throw new Error("草稿不存在");
    if (draft.status === "approved") throw new Error("已收录的草稿不可再修改");
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
      override: toOverride(data.userModel),
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
      override: toOverride(data.userModel),
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
      override: toOverride(data.userModel),
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
      baseUrl: (data.baseUrl ?? "").trim().replace(/\/+$/, "") || null,
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

function dedupSortModels(a: string[]): string[] {
  return [...new Set(a.filter(Boolean))].sort((x, y) => x.localeCompare(y));
}

export const listProviderModelsFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => ListModelsInput.parse(input))
  .handler(async ({ data }): Promise<{ models: string[] }> => {
    // A Gemini pool can't go in a URL — probe with the first key (they share a model list).
    const key = normalizeApiKey(data.provider, data.apiKey).split(",")[0];
    const base = (data.baseUrl || "").trim().replace(/\/+$/, "");
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
        const models = (j.models || [])
          .filter((m: any) => (m.supportedGenerationMethods || []).includes("generateContent"))
          .map((m: any) => String(m.name || "").replace(/^models\//, ""));
        return { models: dedupSortModels(models) };
      }
      if (data.provider === "anthropic") {
        const root = base || "https://api.anthropic.com/v1";
        const r = await fetch(`${root}/models?limit=1000`, {
          signal: ctrl.signal,
          headers: { "x-api-key": key, "anthropic-version": "2023-06-01" },
        });
        if (!r.ok) await fail("Anthropic", r);
        const j: any = await r.json();
        return { models: dedupSortModels((j.data || []).map((m: any) => String(m.id || ""))) };
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
      return { models: dedupSortModels(list.map((m: any) => String(m.id || m.name || ""))) };
    } catch (e) {
      if ((e as Error)?.name === "AbortError")
        throw new Error("拉取模型超时，请检查网络 / 中转地址（国内可能需挂 VPN）。");
      throw e instanceof Error ? e : new Error("拉取模型失败");
    } finally {
      clearTimeout(timer);
    }
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
    const aiCfg = await loadAiConfig();
    const geminiPool = Array.from(
      new Set([
        ...(aiCfg?.provider === "gemini" ? splitGeminiKeys(aiCfg.apiKey) : []),
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
        (aiCfg?.provider === "gemini" && aiCfg.model) || process.env.AI_MODEL || "gemini-3-flash-preview";
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
    const cleanBaseUrl = (data.baseUrl ?? "").trim().replace(/\/+$/, "");
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

    const { data: agg } = await (supabaseAdmin as any)
      .from("ai_usage_logs")
      .select("total_tokens, provider, model");

    const stats = {
      total_calls: agg?.length ?? 0,
      total_tokens: agg?.reduce((s: number, r: any) => s + (r.total_tokens ?? 0), 0) ?? 0,
      by_provider: {} as Record<string, { calls: number; tokens: number }>,
      by_model: {} as Record<string, { calls: number; tokens: number }>,
    };

    for (const r of agg ?? []) {
      const p = r.provider ?? "unknown";
      const m = r.model ?? "unknown";
      if (!stats.by_provider[p]) stats.by_provider[p] = { calls: 0, tokens: 0 };
      stats.by_provider[p].calls++;
      stats.by_provider[p].tokens += r.total_tokens ?? 0;
      if (!stats.by_model[m]) stats.by_model[m] = { calls: 0, tokens: 0 };
      stats.by_model[m].calls++;
      stats.by_model[m].tokens += r.total_tokens ?? 0;
    }

    return { rows: rows ?? [], total: count ?? 0, stats };
  });
