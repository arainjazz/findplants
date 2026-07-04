import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { renderDraftHtml, type PlantDraftFields } from "./plant-html-template";
import { slugify } from "./plants";

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
    field_notes_zh: { type: "string", description: "拍摄记录：对本张照片的形态分析 + 定种判断依据" },
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
      description: "养护卡片：酸碱/施肥/光照/基质/浇水/温度/湿度/病害，共 8 张，每张含 category/value/tag/detail",
      items: {
        type: "object",
        properties: {
          category: { type: "string", description: "类别名：酸碱偏好/施肥方案/光照需求/土壤基质/浇水方法/温度区间/空气湿度/病害防治" },
          value: { type: "string", description: "核心数值或范围或名称，如「PH 6.0–6.5」「15000–40000 lux」「18–28℃」「红蜘蛛 / 白粉病」" },
          tag: { type: "string", description: "括号标签，如「中性」「喜阳·散射」「合成：吡虫啉／有机：苦楝油」" },
          detail: { type: "string", description: "该项简介，≤ 50 字" },
        },
        required: ["category", "value", "tag", "detail"],
      },
    },
  },
  required: [
    "title", "scientific_name", "common_name_en", "common_names_zh", "family", "genus",
    "iucn_status", "tags", "summary_zh", "summary_en", "field_notes_zh", "field_notes_en", "name_origin_zh", "name_origin_en",
    "morphology_zh", "morphology_en", "habitat_zh", "habitat_en", "culture_zh", "culture_en",
    "care_tips_zh", "care_tips_en", "care_facts",
  ],
};

function cleanJson(str: string): string {
  let cleaned = str.trim();
  if (cleaned.startsWith("```")) {
    cleaned = cleaned.replace(/^```json\s*/i, "").replace(/```$/, "").trim();
  }
  return cleaned;
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
          showImages: rec.showImages === true || rec.showImages === "true" || rec.show_images === true,
          imageQueries,
        };
      }
    }
  } catch { /* fall through to lenient extraction */ }

  const unesc = (s: string) =>
    s.replace(/\\"/g, '"').replace(/\\n/g, "\n").replace(/\\t/g, "\t").replace(/\\\\/g, "\\");
  const replyM = txt.match(/"(?:reply|response|answer|message|text|content)"\s*:\s*"((?:[^"\\]|\\.)*)"/i);
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
  return { reply: raw.trim(), canEdit: false, editInstruction: "", imageEdit: false, imageQuery: "", showImages: false, imageQueries: [] };
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
  const EDIT_RE = /(修改|订正|更正|改写|调整|修正|替换|更换|更新|补充|删除|去掉|加上|改成|换成|改为|应为|应该是|把.*改)/;
  const replyEditish = EDIT_RE.test(r.reply);
  const userWantsEdit = EDIT_RE.test(question) || /(帮我|请把|帮忙|麻烦你).*(改|换|加|删|订正|更新)/.test(question);
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
      // Defensive sanitization: heal configs saved before write-time cleaning, or
      // ever re-poisoned, so an embedded space in the key can never cause a 401.
      cfg.apiKey = String(cfg.apiKey).replace(/\s+/g, "");
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
            { type: "text", text: '识别这张照片里的植物，只返回一个 JSON 对象（不要 markdown、不要多余文字），格式：{"title":"中文物种名","scientific_name":"拉丁学名（尽量精确到种）"}。若不确定，title 用最可能的中文名并在前面加「疑似」。' },
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
): Promise<{ scientific_name: string; family: string; genus: string; score: number; candidates: string[] } | null> {
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

async function callAiIdentify(
  photoDataUrl: string,
  hintPlace: string,
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

  // ── Stage 0: 专业植物识别引擎 Pl@ntNet（独立于写稿大模型；命中即作为定种基准）──
  // Runs first whenever a key is configured, regardless of which LLM writes the draft.
  // Feeds a ranked species verdict + confidence into the shared system prompt. Failure
  // is non-fatal — we simply continue with LLM-only identification.
  const plantNetKey = await loadPlantNetKey();
  if (plantNetKey) {
    const pn = await plantNetIdentify(photoDataUrl, plantNetKey).catch((e) => {
      console.warn("[Pl@ntNet] identify failed; continuing with LLM-only:", e);
      return null;
    });
    if (pn && pn.scientific_name) {
      const pct = Math.round((pn.score ?? 0) * 100);
      idHint += `\n\n【专业识别引擎 Pl@ntNet 判定】最可能物种：${pn.scientific_name}` +
        `${pn.family ? `（科 ${pn.family}${pn.genus ? ` / 属 ${pn.genus}` : ""}）` : ""}` +
        `，置信度 ${pct}%。备选：${pn.candidates.join("、")}。` +
        `请以此专业判定为基准核对照片并生成草稿；若置信度偏低（低于 30%）或与照片明显不符，` +
        `请在 summary_zh 开头标注「疑似」并简述分歧依据。`;
      stageModel = "plantnet";
    }
  }

  if (dbConfig?.provider === "custom" && dbConfig.apiKey && process.env.GEMINI_API_KEY) {
    const quick = await quickIdentify(photoDataUrl, dbConfig).catch((e) => {
      console.warn("[Two-stage] quick ID failed; falling back to Gemini-only:", e);
      return null;
    });
    if (quick && (quick.title || quick.scientific_name)) {
      idHint += `\n\n【初步识别提示】另一视觉模型已将本图判定为：「${quick.title}」${quick.scientific_name ? `（${quick.scientific_name}）` : ""}。请结合照片核对该判定并据此生成草稿；若你认为该判定有误，请以你的判断为准，并在 summary_zh 中简要说明分歧。`;
      stageModel = stageModel ? `${stageModel}+${quick.model}` : quick.model;
      stageUsage = quick.usage;
    }
    dbConfig = null; // route the heavy draft to the env Gemini path below
  }

  // A saved admin config is AUTHORITATIVE: route EXCLUSIVELY to that provider and
  // ignore every .env provider key. Otherwise a leftover GEMINI_API_KEY in .env
  // keeps the Gemini branch (which runs first) truthy and hijacks a custom/openai/
  // anthropic config — the chosen endpoint is never called, identify fails, and the
  // usage log records the wrong model. Only with NO db config do we use env keys.
  const geminiKey = dbConfig
    ? (dbConfig.provider === "gemini" ? dbConfig.apiKey : "")
    : process.env.GEMINI_API_KEY;
  const openaiKey = dbConfig
    ? (dbConfig.provider === "openai" || dbConfig.provider === "custom" ? dbConfig.apiKey : "")
    : process.env.OPENAI_API_KEY;
  const anthropicKey = dbConfig
    ? (dbConfig.provider === "anthropic" ? dbConfig.apiKey : "")
    : process.env.ANTHROPIC_API_KEY;
  const lovableKey = dbConfig ? "" : process.env.LOVABLE_API_KEY;

  const systemPrompt = `你是 Plantspedia 的首席植物学家与资深图鉴编辑。给定一张实地拍摄的植物照片（如提供了拍摄的经纬度或行政区划信息，请结合该地理背景进行识别），请遵循极其严格的植物学形态学分类标准，识别出精准的物种（拉丁学名需精确到种、变种或亚种），并返回一份完整、信息密度高、辞藻精炼的科普草稿——直接对标已收录的精品条目（如「戈壁天门冬」）。

内容要求（请逐条满足，缺一不可）：
- summary_zh：150–260 字，一段引人入胜的「开篇导语」，以一位博学的博物学家兼科普博主的口吻来写。**主题是这种植物与人们生活相关的趣闻、要闻、冷知识或近期资讯**——例如它奇特的生存智慧、与人类饮食/医药/民俗/生态的意外联系、常被认错的趣事、名字背后的故事、或与之相关的新闻热点等，目的是勾起读者的好奇心。语气生动、有画面感、带一点惊叹与幽默，但严谨不编造。**切勿在此罗列科属、拉丁学名、形态特征或生境概要（这些放到下方各分区），也不要复述「本次拍摄于……」这类拍摄记录**，避免与页面其它部分重复。如不确定物种，开头用「疑似……」并简述判断依据。summary_en：50–90 词，同样是趣味导语式的精炼意译，而非形态总览。
- field_notes_zh：120–220 字，这是「拍摄记录」栏，**主题必须是对用户上传的这一张照片的分析，以及你据此定种的判断依据**，与 summary 内容完全不同、不得重复。具体写：① 照片里实际可见的诊断性特征（例如叶序/叶形/叶缘、花色花瓣数与排列、果实、茎/刺/毛被、拍摄季节物候等——只描述照片中真正能看到的，不要脑补看不见的部位）；② 由这些可见特征如何推导到该物种/属，哪些特征可与易混近缘种相区分；③ 若照片信息不足以确诊，如实说明还需要哪些部位或角度的照片（如花的特写、果实、叶背）才能进一步确定。口吻是植物学家在做实物鉴定，客观、就图论图。field_notes_en：45–85 词，对应意译。
- common_names_zh：包含该植物的所有中文俗名、别名、以及花卉市场常见的商品名/交易名，用半角逗号隔开（例如 "发财树, 瓜栗, 招财树"）。
- name_origin_zh：220–360 字，分两部分：① 中文名（俗名、古名、地方名）的字源、典籍出处；② 拉丁学名属名 + 种加词的词根含义、命名人/命名年代背景。name_origin_en：80–140 词。
- morphology_zh：320–500 字，按 株型/根 → 茎 → 叶 → 花 → 果实/种子 顺序描述，包含具体数值（如高度 cm、叶长 mm、花期月份）。morphology_en：100–160 词。
- habitat_zh：260–400 字，包含：典型生境与海拔/土壤、世界分布范围、中国分布省份、本次拍摄地点的生态记录（必须自然带入「本次拍摄于 ${hintPlace || "（未知地点）"}」一句）。habitat_en：90–140 词。
- culture_zh：360–600 字，本部分的主题是「植物人文」，请尽量分点覆盖以下维度（无相关内容的维度可略写，但严禁编造）：① 文化与民俗；② 植物民族志——世界不同民族/地区对该植物的认知、命名与地方性知识；③ 文学——若有名篇名句或典籍记载，请引用原文片段并注明出处/作者；④ 食用与药用；⑤ 茶饮（若相关）；⑥ 商贸与经济价值；⑦ 博物学史（被发现、引种、命名、栽培传播的历史）。若该物种确无人文记载，则转而详述其生态角色与近缘种的文化对比。culture_en：120–180 词，对应中文要点的精炼意译。
- care_tips_zh：220–320 字，本部分是「养护方案的依据说明」——结合该物种的原生生境、形态适应与生长习性，解释为什么给出下方 8 张养护卡片里的方案（讲清"为什么"，不要简单罗列数值；具体数值一律放进 care_facts 卡片）。care_tips_en：80–120 词。
- care_facts：养护卡片，为对象数组，必须依次输出以下 8 张卡片，每张含 4 个字段 category/value/tag/detail（detail ≤ 50 字，简洁实用）：① category「酸碱偏好」，value=适宜 PH 范围（如「PH 6.0–6.5」），tag=酸/碱/中性 之一，detail 说明酸碱偏好及如何用施肥/有机方式调节；② category「施肥方案」，value=常见肥名称，tag=「合成：…／有机：…」，detail 区分速效与缓释；③ category「光照需求」，value=光照强度范围（如「15000–40000 lux / 全日照」），tag 从 喜阳/喜阴/直照/散射 选填，detail 说明光照需求；④ category「土壤基质」，value=土壤类型或配比（如「腐叶土:珍珠岩=3:1」），tag=砂质/泥质/腐殖质/寄生 之一，detail 给基质调配指南；⑤ category「浇水方法」，value=不同生长期每日需水量（如「生长期见干见湿，休眠期少水」），tag=水生/湿土/怕水多烂根/耐旱 之一，detail 说明浇水频率与方法；⑥ category「温度区间」，value=适宜生长温度范围（如「18–28℃，耐 5℃」），tag=热带/亚热带/温带/寒带 之一，detail 说明温度耐受；⑦ category「空气湿度」，value=适宜湿度范围（如「50%–70%」），tag=喜湿/喜干 之一，detail 说明空气湿度；⑧ category「病害防治」，value=常见害虫或病害类型（如「红蜘蛛 / 白粉病」），tag=「合成：药剂名／有机：方法」，detail 给病害防护指南。
- tags：5–10 个简短中文/英文标签，用于站内检索，如「水生」「禾本科」「多年生」「invasive」「荒漠植物」。
- iucn_status：仅在你**确有把握**时填入 LC/NT/VU/EN/CR/DD 之一，否则留空字符串。
- 所有中文段落采用 Noto Serif SC 风格的正式植物志措辞，避免空话套话；英文段落为对应中文段落的精炼意译，保留拉丁学名斜体（用 *Genus species* 标记）。
- 若识别不确定，仍要给出最可能的物种，并在 summary 标注「疑似」。

【精准识别与校对指南】
1. 形态特征分析清单：仔细观察照片中显现的特征（如单叶/复叶、互生/对生、花瓣数、花冠对称性等）。
2. 地理与生境匹配：如果提供了拍摄地点，优先考虑该生境下可能分布的本土、归化或常见栽培植物，避免识别出地理分布不符的远缘物种。
3. 近缘种与疑似种对比：如果特征不够完整，请在 summary 中说明「疑似某物种，需与同属的类似物种进行区分，区分要点为……」，展现严谨的植物学素养。` + idHint;

  // ── 1. Google Gemini ──────────────────────────────────────────────────────
  if (geminiKey) {
    try {
      let model = (dbConfig?.provider === "gemini" && dbConfig.model)
        ? dbConfig.model
        : (process.env.AI_MODEL || "gemini-2.5-flash");
      console.log(`[AI Identify] Routing to Gemini API using model: ${model}${dbConfig ? " (db config)" : ""}`);
      
      const match = photoDataUrl.match(/^data:([^;]+);base64,(.+)$/);
      const mimeType = match ? match[1] : "image/jpeg";
      const base64Data = match ? match[2] : photoDataUrl;

      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${geminiKey}`;
      
      const schema = AI_META_SCHEMA;

      let attempts = 0;
      const maxAttempts = 3;
      let resp: Response | null = null;

      while (attempts < maxAttempts) {
        attempts++;
        // 55s timeout per attempt — Gemini vision calls can be slow for large images
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 55_000);
        try {
          resp = await fetch(url, {
            method: "POST",
            signal: controller.signal,
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              contents: [
                {
                  role: "user",
                  parts: [
                    {
                      text: `请识别这张植物照片。${hintPlace ? `拍摄地点：${hintPlace}。` : ""}请按照指定的 JSON 结构返回完整的识别信息。`
                    },
                    {
                      inlineData: {
                        mimeType,
                        data: base64Data
                      }
                    }
                  ]
                }
              ],
              systemInstruction: {
                parts: [{ text: systemPrompt }]
              },
              generationConfig: {
                responseMimeType: "application/json",
                responseSchema: schema,
                temperature: 0.0
              }
            })
          });
          clearTimeout(timer);

          // 429 = rate limit, 503 = model overloaded — both are transient, retry with backoff
          if ((resp.status === 429 || resp.status === 503) && attempts < maxAttempts) {
            const delay = attempts * 5000; // 5s, 10s
            console.warn(`[AI Identify] Gemini API returned ${resp.status}. Retrying in ${delay / 1000}s... (Attempt ${attempts}/${maxAttempts})`);
            await new Promise((resolve) => setTimeout(resolve, delay));
            continue;
          }
          break;
        } catch (err) {
          clearTimeout(timer);
          if (attempts < maxAttempts) {
            const delay = attempts * 5000;
            console.warn(`[AI Identify] Fetch error, retrying in ${delay / 1000}s...:`, err);
            await new Promise((resolve) => setTimeout(resolve, delay));
            continue;
          }
          throw err;
        }
      }

      if (!resp || !resp.ok) {
        const status = resp ? resp.status : 500;
        const t = resp ? await resp.text() : "网络请求失败";
        console.error("Gemini API Error:", status, t);
        if (status === 503) throw new Error("Gemini 模型当前过载，已重试 3 次仍失败，请稍后再试");
        throw new Error(`Gemini 识别出错 (HTTP ${status})`);
      }

      const data = await resp.json();
      const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!text) {
        console.error("Gemini invalid response structure:", JSON.stringify(data));
        throw new Error("Gemini 未能返回有效内容");
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
        throw new Error("Gemini 返回的 JSON 格式不完整");
      }
    } catch (err) {
      console.error("[AI Identify] Google Gemini API call failed. Trying OpenAI or Lovable gateway fallbacks:", err);
      if (!openaiKey && !lovableKey) {
        throw err;
      }
    }
  }

  // ── 2. Anthropic Claude ───────────────────────────────────────────────────
  if (anthropicKey) {
    const model = (dbConfig?.provider === "anthropic" && dbConfig.model)
      ? dbConfig.model
      : (process.env.ANTHROPIC_MODEL || "claude-3-5-sonnet-20241022");
    const baseUrl = dbConfig?.baseUrl || "https://api.anthropic.com/v1";
    console.log(`[AI Identify] Routing to Anthropic API using model: ${model}${dbConfig ? " (db config)" : ""}`);

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
      throw new Error(`Anthropic 识别出错 (HTTP ${resp.status})：${t.slice(0, 200)}`);
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
    const apiBase = (dbConfig?.provider === "openai" || dbConfig?.provider === "custom") && dbConfig.baseUrl
      ? dbConfig.baseUrl
      : (process.env.OPENAI_API_BASE || process.env.AI_API_BASE || "https://api.openai.com/v1");
    const model = ((dbConfig?.provider === "openai" || dbConfig?.provider === "custom") && dbConfig.model)
      ? dbConfig.model
      : (process.env.OPENAI_MODEL || process.env.AI_MODEL || "gpt-4o-mini");
    console.log(`[AI Identify] Routing to OpenAI-compatible API: ${apiBase} using model: ${model}${dbConfig ? " (db config)" : ""}`);

    const requestBody = JSON.stringify({
      model,
      messages: [
        { role: "system", content: systemPrompt },
        {
          role: "user",
          content: [
            {
              type: "text",
              text: `请识别这张植物照片。${hintPlace ? `拍摄地点：${hintPlace}。` : ""}请直接调用工具返回完整的结构化 JSON 结果，所有字段都必须按要求填满，且仅返回 JSON 对象本身，不要用 markdown 代码块包裹。`
            },
            {
              type: "image_url",
              image_url: { url: photoDataUrl }
            }
          ]
        }
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
      if ((resp.status === 429 || (resp.status >= 500 && resp.status < 600)) && attempts < maxAttempts) {
        const delay = attempts * 5000; // 5s, 10s
        console.warn(`[AI Identify] OpenAI-compatible API returned ${resp.status}. Retrying in ${delay / 1000}s... (Attempt ${attempts}/${maxAttempts})`);
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
      if (/image_url|unknown variant|expected\s+`?text`?|does ?n['’]?t support image|not support.*image|multimodal|vision/i.test(t)) {
        throw new Error(
          `${tag}的模型「${model}」不支持图片识别（仅接受纯文本）。拍照识别必须用多模态/视觉模型，例如 Gemini、GPT-4o、Claude 3.5 Sonnet、或通义千问 Qwen-VL。`,
        );
      }
      throw new Error(`${tag}识别出错 (HTTP ${status})：${t.slice(0, 200)}`);
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
      const providerTag = (dbConfig?.provider === "custom") ? "custom" : "openai";
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
                field_notes_zh: { type: "string", description: "拍摄记录：对本张照片的形态分析 + 定种判断依据" },
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
                  description: "养护卡片：酸碱/施肥/光照/基质/浇水/温度/湿度/病害，共 8 张，每张含 category/value/tag/detail",
                  items: {
                    type: "object",
                    properties: {
                      category: { type: "string", description: "类别名：酸碱偏好/施肥方案/光照需求/土壤基质/浇水方法/温度区间/空气湿度/病害防治" },
                      value: { type: "string", description: "核心数值或范围或名称，如「PH 6.0–6.5」「15000–40000 lux」「18–28℃」「红蜘蛛 / 白粉病」" },
                      tag: { type: "string", description: "括号标签，如「中性」「喜阳·散射」「合成：吡虫啉／有机：苦楝油」" },
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

  throw new Error("AI 识别服务未配置。请在云端管理后台配置 GEMINI_API_KEY 或 OPENAI_API_KEY。若您在国内使用，推荐申请免费的 Google Gemini API 密鉅，设置简单且免 VPN 使用。");
}

async function reverseGeocode(lat: number, lng: number): Promise<string> {
  // 1) Try OpenStreetMap Nominatim free public geocoding API first to avoid consuming Gemini rate limits
  try {
    const url = `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json&accept-language=zh-CN`;
    const resp = await fetch(url, {
      headers: {
        "User-Agent": "Plantspedia/1.0 (arainjazz@163.com)"
      }
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
      let model = process.env.AI_MODEL || "gemini-2.5-flash";
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
      const apiBase = process.env.OPENAI_API_BASE || process.env.AI_API_BASE || "https://api.openai.com/v1";
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
            { role: "user", content: userPrompt }
          ]
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
      const r = await fetch(url, { signal: controller.signal, headers: { "User-Agent": "Plantspedia/1.0" } });
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

  // 1) iNaturalist — best for real, vetted species field photos.
  try {
    const tx = await timeoutFetch(
      "https://api.inaturalist.org/v1/taxa?" +
        new URLSearchParams({ q, per_page: "1", rank: "species,genus" }),
    );
    const taxonId = tx?.results?.[0]?.id ?? null;
    const params = new URLSearchParams({
      photos: "true",
      per_page: "30",
      order: "desc",
      order_by: "votes",
      quality_grade: "research",
    });
    if (taxonId) params.set("taxon_id", String(taxonId));
    else params.set("q", q);
    const j = await timeoutFetch("https://api.inaturalist.org/v1/observations?" + params);
    for (const obs of j?.results ?? []) {
      for (const ph of obs?.photos ?? []) {
        if (!ph?.url) continue;
        add(String(ph.url).replace(/\/square\./, "/large.").replace(/\/medium\./, "/large."));
        if (urls.length >= n) return urls;
      }
    }
  } catch {
    /* fall through to next source */
  }

  // 2) GBIF occurrences with media.
  if (urls.length < n) {
    try {
      const m = await timeoutFetch("https://api.gbif.org/v1/species/match?" + new URLSearchParams({ name: q }));
      const key = m?.usageKey ?? null;
      const params = new URLSearchParams({ mediaType: "StillImage", limit: "30" });
      if (key) params.set("taxonKey", String(key));
      else params.set("q", q);
      const j = await timeoutFetch("https://api.gbif.org/v1/occurrence/search?" + params);
      for (const occ of j?.results ?? []) {
        for (const media of occ?.media ?? []) {
          add(media?.identifier);
          if (urls.length >= n) return urls;
        }
      }
    } catch {
      /* fall through */
    }
  }

  // 3) Wikimedia Commons photos (last resort).
  if (urls.length < n) {
    try {
      const j = await timeoutFetch(
        "https://commons.wikimedia.org/w/api.php?" +
          new URLSearchParams({
            action: "query",
            format: "json",
            origin: "*",
            generator: "search",
            gsrnamespace: "6",
            gsrsearch: q + " filetype:bitmap",
            gsrlimit: "30",
            prop: "imageinfo",
            iiprop: "url|mime",
            iiurlwidth: "640",
          }),
      );
      const pages = j?.query?.pages ?? {};
      for (const k of Object.keys(pages)) {
        const ii = pages[k]?.imageinfo?.[0];
        if (!ii?.url || (ii.mime || "").includes("svg")) continue;
        add(ii.url);
        if (urls.length >= n) return urls;
      }
    } catch {
      /* give up gracefully */
    }
  }

  return urls;
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
    const r = await fetch(url, { signal: controller.signal, headers: { "User-Agent": "Plantspedia/1.0" } });
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
    const m = await timeoutJson("https://api.gbif.org/v1/species/match?" + new URLSearchParams({ name }));
    const key: number | null = m?.usageKey ?? null;
    if (!key) return { isInvasive: false, taxonKey: null, source: "", establishmentMeans: "" };
    const j = await timeoutJson(`https://api.gbif.org/v1/species/${key}/distributions?limit=1000`);
    if (!j) return null; // could not complete the distributions lookup
    const recs: any[] = j?.results ?? [];
    const cnGriis = recs.find(
      (r) => r?.country === "CN" && typeof r?.source === "string" && r.source.includes(GRIIS_CHINA_SOURCE),
    );
    // Fallback: a CN record explicitly flagged INVASIVE by any checklist.
    const hit =
      cnGriis ||
      recs.find((r) => r?.country === "CN" && String(r?.establishmentMeans || "").toUpperCase() === "INVASIVE");
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
    const txt = await xiaopTextCall({
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

const SubmitInput = z.object({
  photo_base64: z.string().min(100).max(8_000_000),
  photo_mime: z.string().regex(/^image\/(jpeg|jpg|png|webp)$/i).default("image/jpeg"),
  lat: z.number().nullable().optional(),
  lng: z.number().nullable().optional(),
  creator_label: z.string().max(80).optional(),
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
    if (lat != null && lng != null) {
      place = await reverseGeocode(lat, lng);
    }

    // Build the data URL for the multimodal AI call.
    const dataUrl = `data:${data.photo_mime};base64,${data.photo_base64}`;

    // Call AI to identify + generate copy (reads DB config server-side).
    const { meta, model: usedModel, provider: usedProvider, usage } = await callAiIdentify(dataUrl, place);

    // Upload the photo to Storage (drafts/ prefix is anon-writable).
    const buffer = Buffer.from(data.photo_base64, "base64");
    const ext = data.photo_mime.includes("png") ? "png" : data.photo_mime.includes("webp") ? "webp" : "jpg";
    const path = `drafts/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
    const { error: upErr } = await supabaseAdmin.storage
      .from("plant-images")
      .upload(path, buffer, { contentType: data.photo_mime, upsert: false });
    if (upErr) throw new Error(`照片上传失败：${upErr.message}`);
    const photoUrl = supabaseAdmin.storage.from("plant-images").getPublicUrl(path).data.publicUrl;

    // Find real online field photos of the species for the body sections (the
    // hero keeps the user's own photo). Prefer the Latin binomial (genus species)
    // for the best hit rate; fall back to English/Chinese names. Non-fatal.
    let sectionImages: string[] = [];
    try {
      const sci = (meta.scientific_name || "").trim().split(/\s+/).slice(0, 2).join(" ");
      const term = sci || meta.common_name_en || meta.title || "";
      if (term) sectionImages = await fetchSpeciesPhotos(term, 5);
    } catch (e) {
      console.warn("[SubmitPlantDraft] species photo search failed:", e);
    }

    // Invasive-alien-species check (GBIF → GRIIS China). When confirmed invasive,
    // generate a three-part warning card rendered before Section I. Fully
    // non-fatal: any failure just skips the card / flag. taxonKey/flag are also
    // persisted so the /explore map can mark these with danger triangles.
    // ── Conservation registry match (国家/省级重点保护 · CITES · GTS · GRIIS) ──
    // Load the registries ONCE, paginating past PostgREST's 1000-row cap (GRIIS/GTS
    // are seeded last, so they fall past row 1000 and would otherwise never match).
    // The GRIIS hit feeds BOTH the invasive card (degree + precise citation) and the
    // status-badge card. Fully non-fatal — unseeded tables just skip the cards.
    let conservationBadgesList: PlantDraftFields["conservation"] = null;
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
          const { buildConservationMatcher, conservationBadges, GRIIS_DEGREES } = await import("./conservation");
          const hit = buildConservationMatcher({ lists, taxa })(sciFull, meta.family || null);
          const badges = conservationBadges(hit, lists);
          if (badges.length) conservationBadgesList = badges;
          if (hit.griis) {
            const gl = lists.find((l) => l.kind === "griis");
            const deg = GRIIS_DEGREES.find((d) => d.value === hit.griis);
            griisHit = {
              degreeLabel: deg?.label ?? hit.griis,
              source: gl ? `${gl.name}${gl.version ? "（" + gl.version + "）" : ""}` : "GRIIS 全球入侵物种数据库·中国",
              source_url: gl?.source_url ?? null,
            };
          }
        }
      }
    } catch (e) {
      console.warn("[SubmitPlantDraft] conservation match failed:", e);
    }

    // ── Invasive-species warning card ──
    // Invasive if the live GBIF/GRIIS check says so OR the LOCAL GRIIS registry matches
    // (the local list is authoritative for China, and gives the degree + citation).
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
        if (chk?.isInvasive || griisHit) {
          isInvasive = true;
          const card = await generateInvasiveCard(meta.title || sciBinomial, meta.scientific_name || sciBinomial);
          if (card) {
            invasiveCard = {
              ...card,
              degree: griisHit?.degreeLabel ?? null,
              source: griisHit?.source ?? chk?.source ?? "GBIF · GRIIS 中国名录",
              source_url: griisHit?.source_url ?? null,
            };
          }
        }
      }
    } catch (e) {
      console.warn("[SubmitPlantDraft] invasive check failed:", e);
    }

    // Compose HTML.
    const captureDate = new Date().toISOString().slice(0, 10);
    const html = renderDraftHtml({
      ...meta,
      photo_url: photoUrl,
      section_images: sectionImages,
      invasive: invasiveCard,
      conservation: conservationBadgesList,
      capture_place: place || "未知地点",
      capture_lat: lat != null ? lat.toFixed(5) : "",
      capture_lng: lng != null ? lng.toFixed(5) : "",
      capture_date: captureDate,
      ai_model: usedModel,
    });

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
    if (insErr) throw new Error(`保存草稿失败：${insErr.message}`);

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
        if (invErr) console.warn("[SubmitPlantDraft] invasive flag update skipped (migration?):", invErr.message);
      } catch (e) {
        console.warn("[SubmitPlantDraft] invasive flag update failed:", e);
      }
    }

    return { draftId: row.id as string, place, isInvasive };
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
const ApproveInput = z.object({ draftId: z.string().uuid() });

export const approvePlantDraft = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => ApproveInput.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const dbUserId = userId;

    // Check editor or admin
    const { data: roles } = await supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", userId);
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
    const { data: roles } = await supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", userId);
    const isEditor = roles?.some((r) => r.role === "editor" || r.role === "admin") ?? false;
    if (!isEditor) throw new Error("仅审核通过的编辑可以驳回草稿");
    await supabaseAdmin
      .from("plant_drafts")
      .update({ status: "rejected" })
      .eq("id", data.draftId);
    // Log the rejection so the owner's edit log shows it (with a revert path).
    const { data: d } = await supabaseAdmin
      .from("plant_drafts")
      .select("title")
      .eq("id", data.draftId)
      .maybeSingle();
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
      cfg.apiKey = String(cfg.apiKey).replace(/\s+/g, "");
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
    const text = m[2].replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
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
): Promise<string> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
  const generationConfig: Record<string, unknown> = schema
    ? { responseMimeType: "application/json", responseSchema: schema }
    : {};
  const gContents: { role: string; parts: unknown[] }[] = contents.map((c) => ({
    role: c.role,
    parts: [...c.parts],
  }));
  if (images?.length) {
    const idx = lastUserIndex(contents);
    for (const im of images) gContents[idx].parts.push({ inlineData: { mimeType: im.mimeType, data: im.base64 } });
  }
  let attempts = 0;
  let resp: Response | null = null;
  while (attempts < maxRetry) {
    attempts++;
    const controller = new AbortController();
    // Vision questions can take >1min; a short timeout surfaced as a raw
    // "This operation was aborted" in the chat panel.
    const timer = setTimeout(() => controller.abort(), 120_000);
    try {
      resp = await fetch(url, {
        method: "POST",
        signal: controller.signal,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: gContents,
          systemInstruction: { parts: [{ text: system }] },
          generationConfig,
        }),
      });
      clearTimeout(timer);
      if ((resp.status === 429 || resp.status === 503) && attempts < maxRetry) {
        await new Promise((r) => setTimeout(r, attempts * 4000));
        continue;
      }
      break;
    } catch (err) {
      clearTimeout(timer);
      // A timeout means the model is just slow — don't re-queue another 2min wait.
      if ((err as Error)?.name === "AbortError") {
        throw new Error(
          "小P 响应超时（等了 2 分钟）：模型思考较慢，带图提问尤其耗时。请重试一次；连续超时可换更快的视觉模型。",
        );
      }
      if (attempts < maxRetry) {
        await new Promise((r) => setTimeout(r, attempts * 4000));
        continue;
      }
      throw err;
    }
  }
  if (!resp || !resp.ok) {
    const status = resp ? resp.status : 500;
    if (status === 503) throw new Error("小P 模型当前过载，请稍后再试。");
    throw new Error(`小P 调用失败 (HTTP ${status})`);
  }
  const res = await resp.json();
  const txt = res.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!txt) throw new Error("小P 未返回有效内容。");
  return txt as string;
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
): Promise<string> {
  const apiBase = (baseUrl || "https://api.openai.com/v1").replace(/\/+$/, "");
  const idx = images?.length ? lastUserIndex(contents) : -1;
  const messages: { role: string; content: unknown }[] = [
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
  // NOTE: deliberately DO NOT send response_format:json_object — some relays /
  // reasoning models return an EMPTY reply when it's set (a lesson already learned
  // for the identify pipeline). We instruct JSON in the system prompt + cleanJson() instead.
  const body: Record<string, unknown> = { model, messages, max_tokens: 16000 };
  // Network errors (the relay resetting on a large body) surface as a bare
  // "fetch failed"; wrap with a timeout + one retry + a clearer message.
  let resp: Response | null = null;
  let lastErr: unknown = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    const controller = new AbortController();
    // Reasoning / vision models (MiniMax-M3 etc.) routinely think for >1min on
    // photo questions — a short timeout here surfaced as "This operation was aborted".
    const timer = setTimeout(() => controller.abort(), 120_000);
    try {
      resp = await fetch(`${apiBase}/chat/completions`, {
        method: "POST",
        signal: controller.signal,
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      clearTimeout(timer);
      break;
    } catch (err) {
      clearTimeout(timer);
      lastErr = err;
      // A timeout means the model is just slow — retrying only doubles the wait.
      if ((err as Error)?.name === "AbortError") break;
      if (attempt === 0) {
        await new Promise((r) => setTimeout(r, 1500));
        continue;
      }
    }
  }
  if (!resp) {
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
  }
  if (!resp.ok) {
    const t = await resp.text();
    throw new Error(`小P 调用失败 (HTTP ${resp.status})：${t.slice(0, 200)}`);
  }
  const res = await resp.json();
  const content = res.choices?.[0]?.message?.content;
  if (!content) throw new Error("小P 未返回有效内容。");
  return content as string;
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
): Promise<string> {
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
  return txt as string;
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
}): Promise<string> {
  const cfg = opts.override && opts.override.apiKey ? opts.override : await loadXiaoPConfig();
  const provider = cfg?.provider ?? "gemini";

  if (provider === "gemini") {
    const apiKey = cfg?.provider === "gemini" && cfg.apiKey ? cfg.apiKey : process.env.GEMINI_API_KEY;
    if (!apiKey) throw new Error("小P 暂不可用：未配置模型，且服务器无 GEMINI_API_KEY。");
    const model = cfg?.provider === "gemini" && cfg.model ? cfg.model : process.env.AI_MODEL || "gemini-2.5-flash";
    return geminiChat(apiKey, model, opts.contents, opts.system, opts.schema, opts.maxRetry ?? 3, opts.images);
  }
  if (!cfg) throw new Error("小P 暂不可用：模型未配置。");
  if (provider === "anthropic") {
    return anthropicChat(cfg.apiKey, cfg.baseUrl || "", cfg.model, opts.contents, opts.system, opts.schema, opts.images);
  }
  // openai + custom share the OpenAI-compatible path
  return openaiCompatChat(cfg.apiKey, cfg.baseUrl || "", cfg.model, opts.contents, opts.system, opts.schema, opts.images);
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
    apiKey: String(um.apiKey).replace(/\s+/g, ""),
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
    const visionUrls = xiaopVisionUrls({ html: draftHtml, scope: data.scope, coverUrl: draft.photo_url });
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
回答控制在简明范围内，不要长篇大论。
【输出格式·务必严格】只返回一个 JSON 对象，键名固定为：reply（字符串，你的中文回答）、canEdit（布尔）、editInstruction（字符串）、imageEdit（布尔）、imageQuery（字符串）、showImages（布尔）、imageQueries（字符串数组）。不要用 response 等其它键名，不要加 markdown 代码块或多余文字。`;

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
        imageQuery: { type: "string", description: "若 imageEdit 为 true，配图搜索词（通常用拉丁学名）；否则空字符串" },
        showImages: { type: "boolean", description: "编辑是否想看该物种（们）的网络参考照片用于比对" },
        imageQueries: {
          type: "array",
          items: { type: "string" },
          description: "若 showImages 为 true，要展示的每个物种的搜索词（优先拉丁学名）；对比多个物种时含每一个；否则空数组",
        },
      },
      required: ["reply", "canEdit", "editInstruction", "imageEdit", "imageQuery", "showImages", "imageQueries"],
    };

    const txt = await xiaopTextCall({
      contents,
      system,
      schema,
      images: photos.length ? photos : undefined,
      override: toOverride(data.userModel),
    });
    return harvestImageIntent(parseAgentReply(txt));
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
        parts: [{ text: `修改指令：${data.instruction}\n\n以下是完整 HTML 文档，请按指令返回修改后的完整 HTML：\n${original}` }],
      },
    ];

    const txt = await xiaopTextCall({ contents, system, maxRetry: 2, override: toOverride(data.userModel) });
    let html = txt.trim();
    if (html.startsWith("```")) {
      html = html.replace(/^```html\s*/i, "").replace(/^```\s*/, "").replace(/```$/, "").trim();
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
    const { title, scientific_name, html, html_url, cover_url } = await fetchPlantPageText(data.plantId);
    const docText = htmlToText(html);
    // Scope-aware vision: when the editor has annotated a section, only feed THAT
    // section's images; on 整页 (no scope) feed every page image (cover first).
    const visionUrls = xiaopVisionUrls({ html, baseUrl: html_url, scope: data.scope, coverUrl: cover_url });
    const photos = await fetchInlineImages(visionUrls);
    const scopeLine = data.scope
      ? `编辑本轮把讨论范围限定在：「${data.scope}」。请只围绕这一处回答与建议。`
      : "本轮未限定范围，针对整页内容回答。";
    const system = `你是「小P蛙」，Plantspedia（鄂尔多斯植物百科）的双语审稿助手，正在协助编辑校对一份【已发布】的植物详情页。
${scopeLine}
职责：
- 用【中文】回答编辑关于该页面的问题，给出基于植物学常识的核对与修改建议；不确定时如实说明，不要编造；
- ${photos.length
        ? `本条消息附带了${data.scope ? `「${data.scope}」这一分区` : "本页"}的实际配图，共 ${photos.length} 张（按页面中出现的先后顺序排列）。涉及物种鉴定、或编辑问「配图对不对/有没有错配」时，请【逐张把照片与正文描述相互核对】：判断每一张是否确为本页所述物种，指出与描述矛盾的可见特征（如叶序单叶/复叶、叶形、花色花数、果实形态、有无刺毛等）；若发现张冠李戴，请明确说是第几张、错在哪、疑似为何物种。文本仅作参考，以图为准；`
        : "（本轮没有可用的配图，仅能依据文本判断，请说明这一点）"}
- 如果编辑的诉求是一处「可以直接落地到页面里的具体修改」，把 canEdit 设为 true，并在 editInstruction 里用一句中文精确描述要做的改动（具体到改哪里、改成什么）；范围已限定时，改动只应涉及该范围。
  **你可以直接落地这些文字改动**——编辑点一下「采纳并保存」即由你改写并保存上线，不要说"交给技术同事/他人执行"。
- 如果诉求是「更换 / 增补配图」，把 canEdit 设为 true、imageEdit 设为 true，imageQuery 给出图片搜索词（通常用拉丁学名），
  editInstruction 说明要替换哪张图。系统会调起站内"在线搜图"让编辑挑图后自动替换，同样不要说交给别人。
- 如果编辑想「看该物种的网络参考照片来比对」，把 showImages 设为 true，把要展示的物种放进 imageQueries 数组（优先拉丁学名）；
  **对比多个物种时 imageQueries 要含每一个**（如 ["Tribulus terrestris","Tripodion tetraphyllum"]）。系统会联网按每个词分别取照片分组显示。
  **你具备这个能力，不要说"我无法联网/无法发图"**。
- 否则上述布尔全部设为 false、editInstruction 留空、imageQueries 用空数组。
回答简明。
【输出格式·务必严格】只返回一个 JSON 对象，键名固定为：reply（字符串）、canEdit（布尔）、editInstruction（字符串）、imageEdit（布尔）、imageQuery（字符串）、showImages（布尔）、imageQueries（字符串数组）。不要用 response 等其它键名，不要加 markdown 代码块或多余文字。`;

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
      },
      required: ["reply", "canEdit", "editInstruction", "imageEdit", "imageQuery", "showImages", "imageQueries"],
    };

    const txt = await xiaopTextCall({
      contents,
      system,
      schema,
      images: photos.length ? photos : undefined,
      override: toOverride(data.userModel),
    });
    return harvestImageIntent(parseAgentReply(txt));
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
        parts: [{ text: `修改指令：${data.instruction}\n\n以下是完整 HTML 文档，请按指令返回修改后的完整 HTML：\n${original}` }],
      },
    ];

    const txt = await xiaopTextCall({ contents, system, maxRetry: 2, override: toOverride(data.userModel) });
    let html = txt.trim();
    if (html.startsWith("```")) {
      html = html.replace(/^```html\s*/i, "").replace(/^```\s*/, "").replace(/```$/, "").trim();
    }
    if (!/<\/html>/i.test(html)) throw new Error("小P 生成的内容不完整，请重试或换种说法。");
    return { html, oldHtml: original };
  });

// ─── Admin: 小P model config CRUD (key `xiaop_model_config`) ─────────────────

const SaveXiaoPConfigInput = z.object({
  provider: z.enum(["gemini", "openai", "anthropic", "custom"]),
  apiKey: z.string().min(1).max(1000),
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
    if (!(roles?.some((r) => r.role === "admin") ?? false)) throw new Error("仅管理员可修改小P配置");

    const configValue = {
      provider: data.provider,
      apiKey: (data.apiKey ?? "").replace(/\s+/g, ""),
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
    const key = data.apiKey.replace(/\s+/g, "");
    const base = (data.baseUrl || "").trim().replace(/\/+$/, "");
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 20_000);
    const fail = async (label: string, r: Response) => {
      throw new Error(`${label} 拉取失败（HTTP ${r.status}）：${(await r.text().catch(() => "")).slice(0, 180)}`);
    };
    try {
      if (data.provider === "gemini") {
        const root = base || "https://generativelanguage.googleapis.com/v1beta";
        const r = await fetch(`${root}/models?key=${encodeURIComponent(key)}&pageSize=1000`, { signal: ctrl.signal });
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
      const r = await fetch(`${root}/models`, { signal: ctrl.signal, headers: { Authorization: `Bearer ${key}` } });
      if (!r.ok) await fail("模型", r);
      const j: any = await r.json();
      const list = Array.isArray(j.data) ? j.data : Array.isArray(j) ? j : [];
      return { models: dedupSortModels(list.map((m: any) => String(m.id || m.name || ""))) };
    } catch (e) {
      if ((e as Error)?.name === "AbortError") throw new Error("拉取模型超时，请检查网络 / 中转地址（国内可能需挂 VPN）。");
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
    if (!(roles?.some((r) => r.role === "admin") ?? false)) throw new Error("仅管理员可查看小P配置");

    const { data } = await (supabaseAdmin as any)
      .from("site_config")
      .select("value")
      .eq("key", "xiaop_model_config")
      .maybeSingle();
    if (!data?.value) return null;
    const cfg = typeof data.value === "string" ? JSON.parse(data.value) : data.value;
    const masked = cfg.apiKey
      ? `${"*".repeat(Math.max(0, cfg.apiKey.length - 6))}${cfg.apiKey.slice(-6)}`
      : "";
    return {
      provider: cfg.provider as string,
      model: cfg.model as string,
      baseUrl: cfg.baseUrl as string | null,
      apiKeyMasked: masked,
      updatedAt: cfg.updatedAt as string | null,
    };
  });

export const clearXiaoPConfigFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: roles } = await supabase.from("user_roles").select("role").eq("user_id", userId);
    if (!(roles?.some((r) => r.role === "admin") ?? false)) throw new Error("仅管理员可修改小P配置");
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
    ? (await supabaseAdmin
        .from("profiles")
        .select("id, display_name, avatar_url, created_at")
        .in("id", ids)).data ?? []
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
        .select("id, title, scientific_name, photo_url, status, published_plant_id, capture_place, created_at")
        .eq("created_by", id)
        .order("created_at", { ascending: false }),
    ]);
    const draftRows = drafts.data ?? [];
    const p = prof.data as ({ display_name: string | null; avatar_url: string | null; created_at: string; bio?: string | null }) | null;
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
            ? content_html.match(/<img\b[^>]*\bsrc\s*=\s*["']([^"']+)["']/i)?.[1] ?? null
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

    if (geminiKey) {
      let model = process.env.AI_MODEL || "gemini-2.5-flash";
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${geminiKey}`;
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
        ]
      };

      let attempts = 0;
      const maxAttempts = 3;
      let resp: Response | null = null;

      while (attempts < maxAttempts) {
        attempts++;
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 30_000);
        try {
          resp = await fetch(url, {
            method: "POST",
            signal: controller.signal,
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              contents: [
                { role: "user", parts: [{ text: `以下是页面正文文本：\n\n${text}` }] }
              ],
              systemInstruction: {
                parts: [{ text: systemPrompt }]
              },
              generationConfig: {
                responseMimeType: "application/json",
                responseSchema: schema
              }
            })
          });
          clearTimeout(timer);

          // 429 = rate limit, 503 = model overloaded — both transient, retry with backoff
          if ((resp.status === 429 || resp.status === 503) && attempts < maxAttempts) {
            const delay = attempts * 5000;
            console.warn(`[AI Extract] Gemini API returned ${resp.status}. Retrying in ${delay / 1000}s... (Attempt ${attempts}/${maxAttempts})`);
            await new Promise((resolve) => setTimeout(resolve, delay));
            continue;
          }
          break;
        } catch (err) {
          clearTimeout(timer);
          if (attempts < maxAttempts) {
            const delay = attempts * 5000;
            console.warn(`[AI Extract] Fetch error, retrying in ${delay / 1000}s...:`, err);
            await new Promise((resolve) => setTimeout(resolve, delay));
            continue;
          }
          throw err;
        }
      }

      if (!resp || !resp.ok) {
        const status = resp ? resp.status : 500;
        const t = resp ? await resp.text() : "网络请求失败";
        console.error("Gemini API Error in extractPlantMetaFn:", status, t);
        if (status === 503) throw new Error("Gemini 模型当前过载，已重试 3 次仍失败，请稍后再试");
        throw new Error(`Gemini 提取失败 (HTTP ${status})`);
      }

      const res = await resp.json();
      const txt = res.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!txt) throw new Error("Gemini 未返回有效文本");
      return JSON.parse(cleanJson(txt));
    }

    if (openaiKey) {
      const apiBase = process.env.OPENAI_API_BASE || process.env.AI_API_BASE || "https://api.openai.com/v1";
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
            { role: "user", content: `以下是页面正文文本：\n\n${text}` }
          ],
          response_format: { type: "json_object" }
        })
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

    throw new Error("AI 提取服务未配置。请在 Cloudflare 后台 Secrets 中设置 GEMINI_API_KEY 或 OPENAI_API_KEY。");
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
          summary: editSummary || `${editorName} 创建了条目「${payload.title}」${payload.content_type === "html" ? "（HTML）" : ""}`,
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
    const { error } = await supabaseAdmin.storage
      .from(data.bucket)
      .upload(data.path, buffer, {
        contentType: data.content_type,
        upsert: true,
      });
    if (error) throw new Error(`上传失败：${error.message}`);
    const publicUrl = supabaseAdmin.storage.from(data.bucket).getPublicUrl(data.path).data.publicUrl;
    return { url: publicUrl };
  });

// ─── Admin: AI Model Config CRUD ─────────────────────────────────────────────

const SaveAiConfigInput = z.object({
  provider: z.enum(["gemini", "openai", "anthropic", "custom"]),
  apiKey: z.string().min(1).max(1000),
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
    const cleanKey = (data.apiKey ?? "").replace(/\s+/g, "");
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
    // Mask the API key: show only last 6 chars
    const masked = cfg.apiKey
      ? `${"*".repeat(Math.max(0, cfg.apiKey.length - 6))}${cfg.apiKey.slice(-6)}`
      : "";
    return {
      provider: cfg.provider as string,
      model: cfg.model as string,
      baseUrl: cfg.baseUrl as string | null,
      apiKeyMasked: masked,
      updatedAt: cfg.updatedAt as string | null,
    };
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
    const masked = `${"*".repeat(Math.max(0, key.length - 6))}${key.slice(-6)}`;
    return { apiKeyMasked: masked, updatedAt: (typeof cfg === "object" ? cfg.updatedAt : null) ?? null };
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
