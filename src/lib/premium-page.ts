/**
 * 金叶「一键创建物种详细科普页」生成器。
 *
 * 这是 ccplants-v19 skill（~/.claude/skills/ccplants-v19/SKILL.md）的**服务端移植**。
 *
 * 为什么是"移植"而不是"调用"：该 skill 是写给**带工具的 agent** 的工作流 —— 它要求
 * 联网查 FoC/POWO/GBIF/IUCN/CNKI、用 curl 串行下载 Wikimedia 图片、写文件、跑质量门。
 * 站内小P蛙是跑在 Cloudflare Workers 上的**单次 LLM 调用**，没有 shell、没有文件系统、
 * 不能联网检索。所以这里把 skill 里**可移植的部分**（版面结构 / 写作规则 / 反虚构协议）
 * 固化成 system prompt + HTML 模板，把 skill 里**需要工具的部分**换成站内已有的服务端能力：
 *   - 图片：fetchSpeciesPhotos（已按 地点/季节/拍摄者 三轴做多样性挑选）+ rehostImages
 *     （已用 Cloudflare Image Resizing 压缩为 1280px webp 后再存 Supabase）
 *   - 事实：GBIF / GRIIS / 国家·省级重点保护名录 / CITES（conservation.ts）
 *
 * ⚠️ 刻意省略 v19 的 Section V「最新资讯」：它要求每张新闻卡都带**可点击 URL**，而本地
 * 模型无法联网核实 —— 强行生成只会逼模型编造链接，直接违反反虚构协议。取而代之的是
 * 由服务端真实名录数据程序化渲染的「名录与数据依据」引用区（renderReferences）。
 */

export type VerifiedFacts = {
  title: string;
  scientificName: string;
  familyZh: string;
  familyLa: string;
  genusZh: string;
  genusLa: string;
  commonNamesZh: string;
  commonNameEn: string;
  /** 真实名录命中，作为 prompt 里的 ground truth，禁止模型改写。 */
  conservation: { kind: string; label: string }[];
  protectedBasis: string | null;
  griisDegree: string | null;
  isInvasive: boolean;
  chinaInvasive: { batch: string; date: string; publisher: string; keyManaged: boolean } | null;
  iucnStatus: string | null;
  capturePlace: string | null;
  /** 可点击的真实来源链接（程序化构造，非模型生成）。 */
  sources: { name: string; url: string }[];
};

export type FeatureCard = {
  chip_zh: string;
  chip_en: string;
  title_zh: string;
  title_en: string;
  body_zh: string;
  body_en: string;
};

export type PremiumFields = {
  tagline_zh: string;
  tagline_en: string;
  folk_names_zh: string;
  intro_zh: string;
  intro_en: string;
  form_overview_zh: string;
  form_overview_en: string;
  feature_cards: FeatureCard[];
  similar_species: {
    name_zh: string;
    name_la: string;
    how_to_tell_zh: string;
    how_to_tell_en: string;
  };
  habitat_chips: { label_zh: string; label_en: string; value_zh: string; value_en: string }[];
  habitat_zh: string;
  habitat_en: string;
  ethno_tabs: {
    key: string;
    title_zh: string;
    title_en: string;
    body_zh: string;
    body_en: string;
  }[];
  literature: {
    has_record: boolean;
    original_text: string;
    source_citation: string;
    paraphrase_zh: string;
    translation_en: string;
  };
  eco_function_zh: string;
  eco_function_en: string;
  distribution_invasion_zh: string;
  distribution_invasion_en: string;
  curio: {
    driving_question_zh: string;
    driving_question_en: string;
    chapters: { heading_zh: string; body_zh: string }[];
  };
};

// ── Shared, non-negotiable rules (ported verbatim in spirit from SKILL.md) ─────
const ANTI_FABRICATION = `
【反虚构协议 · 最高优先级硬规则】
- 禁止编造人物、事件、年份、引文。每一条事实都必须是可溯源的。
- 严禁「某位老中医 / 一位日本学者 / 山里的老牧民 / 某先生 / 某德国植物学家」这类假托人物。
- 没有可核实来源时，禁止给出「年份 + 事件」的配对。
- 古籍引文不得假装精确：**找不到原文就不要引用**。
- 不同属之间的同名物种是真实存在的跨文献混淆，落笔前必须核对学名。
- 判准：「如果我无法在 30 秒内给出一个可点击的 URL 或可定位的引证，就删掉它。」
- 你**没有联网检索能力**。因此：凡是你无法凭可靠的既有知识确证的具体数字、地名、年份、
  人名、文献名，一律**不写**，改用限定性表述（如「多见于」「据记载」并省略伪精确数值），
  或直接省略该句。宁可少写，也不可编造。
- 下方「已核实事实」区块中的名录/保护/入侵信息由本站服务端从 GBIF、GRIIS、国家及省级重点
  保护名录等**真实数据库**查得，是 ground truth：**不得改写、不得夸大、不得自行添加名录**。
  若该区块显示未命中任何名录，就**明确写出「未被收录于……」**，不要臆造保护等级。
`.trim();

const WRITING_RULES = `
【写作规则】
- 以中文为主；每个实质性段落都要配一段对应的英文（不是逐字直译，而是精炼意译）。
- 用 <strong> 标注**诊断性特征**（区分本种与近缘种的关键性状）。
- 不得编造俗名、民俗用途、保护状态、入侵记录。
- 引用同属其他物种的数据时，必须标明是哪个物种（congener 标注）。
- 中文使用正式植物志措辞，避免空话套话；拉丁学名在正文中用 *Genus species* 标记斜体。
- 不要输出任何 HTML 标签（<strong> 除外），版面由模板负责。
`.trim();

function factsBlock(f: VerifiedFacts): string {
  const lines: string[] = [];
  lines.push(`物种：${f.title}（${f.scientificName}）`);
  lines.push(`科：${f.familyZh} ${f.familyLa} · 属：${f.genusZh} ${f.genusLa}`);
  if (f.commonNamesZh) lines.push(`已知中文俗名：${f.commonNamesZh}`);
  if (f.commonNameEn) lines.push(`英文俗名：${f.commonNameEn}`);
  lines.push(
    f.conservation.length
      ? `名录命中：${f.conservation.map((c) => c.label).join("、")}`
      : `名录命中：无（未被收录于国家/省级重点保护名录、CITES、GTS）`,
  );
  if (f.protectedBasis) lines.push(`重点保护判定依据：${f.protectedBasis}`);
  lines.push(
    f.isInvasive
      ? `入侵状态：已确认为中国外来入侵物种${f.griisDegree ? `（GRIIS 等级：${f.griisDegree}）` : ""}${
          f.chinaInvasive
            ? `；列入《中国外来入侵物种名单》${f.chinaInvasive.batch}（${f.chinaInvasive.publisher}，${f.chinaInvasive.date}）${
                f.chinaInvasive.keyManaged ? "，且属重点管理名录" : ""
              }`
            : ""
        }`
      : `入侵状态：GBIF/GRIIS 中国名录未将本种记录为外来入侵物种`,
  );
  lines.push(f.iucnStatus ? `IUCN 评级：${f.iucnStatus}` : `IUCN 评级：未确证（不要臆造）`);
  if (f.capturePlace) lines.push(`本次拍摄地点：${f.capturePlace}`);
  else lines.push(`本次拍摄地点：未知（严禁编造或反推任何具体地名）`);
  return lines.map((l) => `- ${l}`).join("\n");
}

const BASE = (
  f: VerifiedFacts,
) => `你是《鄂尔多斯植物精选百科》(Ordos Plantspedia) 的首席植物学家兼资深图鉴主编，正在撰写一份**精品级**中英双语物种详页。

【已核实事实（ground truth，不得改写）】
${factsBlock(f)}

${ANTI_FABRICATION}

${WRITING_RULES}`;

// ── Part 1: 引言 + 形态总览 + 六张特征卡 + 近似种 ──────────────────────────────
export const PREMIUM_SCHEMA_1 = {
  type: "object",
  properties: {
    tagline_zh: {
      type: "string",
      description: "一句 8–18 字的题记，凝练本种最动人的特质，不要出现学名",
    },
    tagline_en: { type: "string", description: "对应英文题记，6–14 词" },
    folk_names_zh: {
      type: "string",
      description: "中国各地俗名，顿号分隔；若无可靠记载则留空字符串（不要编造）",
    },
    intro_zh: {
      type: "string",
      description:
        "220–340 字开篇导语。博物学家口吻，讲反常识/与生活相关的钩子，勾起好奇心。不要罗列科属和形态清单。",
    },
    intro_en: { type: "string", description: "对应英文，80–130 词" },
    form_overview_zh: {
      type: "string",
      description: "120–180 字株型总览：生活型、高度、整体轮廓与质感",
    },
    form_overview_en: { type: "string", description: "45–70 词" },
    feature_cards: {
      type: "array",
      description:
        "恰好 6 张关键特征卡，依次为：根/株型、茎、叶、花、果实与种子、物候与繁殖。每张聚焦一个器官，body_zh 内用 <strong> 包裹诊断性性状。",
      items: {
        type: "object",
        properties: {
          chip_zh: { type: "string", description: "两到四字模块名，如「叶」「花」" },
          chip_en: { type: "string", description: "对应英文，如 Leaf / Flower" },
          title_zh: { type: "string", description: "该器官的一句话要点标题，12 字以内" },
          title_en: { type: "string" },
          body_zh: {
            type: "string",
            description:
              "110–170 字，含具体可测数值（叶长 mm、花期月份等），诊断性性状用 <strong> 标注",
          },
          body_en: { type: "string", description: "45–70 词" },
        },
        required: ["chip_zh", "chip_en", "title_zh", "title_en", "body_zh", "body_en"],
      },
    },
    similar_species: {
      type: "object",
      description:
        "一个真实存在的、最易混淆的近缘种。若确无易混种，name_zh 填「无明显易混种」并在 how_to_tell 中说明。",
      properties: {
        name_zh: { type: "string" },
        name_la: { type: "string" },
        how_to_tell_zh: { type: "string", description: "90–140 字，只讲肉眼可辨的区分要点" },
        how_to_tell_en: { type: "string", description: "35–60 词" },
      },
      required: ["name_zh", "name_la", "how_to_tell_zh", "how_to_tell_en"],
    },
  },
  required: [
    "tagline_zh",
    "tagline_en",
    "intro_zh",
    "intro_en",
    "form_overview_zh",
    "form_overview_en",
    "feature_cards",
    "similar_species",
  ],
};

export const premiumPrompt1 = (f: VerifiedFacts) => `${BASE(f)}

【本次任务】只产出：题记、俗名条、开篇导语（中英）、株型总览（中英）、**恰好 6 张**关键特征卡、以及 1 个近似种对照。
严格按给定 JSON 结构返回，不要 markdown 代码块。`;

// ── Part 2: 典型生境 + 植物人文 ───────────────────────────────────────────────
export const PREMIUM_SCHEMA_2 = {
  type: "object",
  properties: {
    habitat_chips: {
      type: "array",
      description:
        "恰好 7 条生境速览，依次为：生活型 Habit、基质 Substrate、水分 Water、气候 Climate、光照 Light、酸碱度 pH、物候 Phenology",
      items: {
        type: "object",
        properties: {
          label_zh: { type: "string" },
          label_en: { type: "string" },
          value_zh: { type: "string", description: "简短取值，如「多年生草本」" },
          value_en: { type: "string", description: "如 Perennial herb" },
        },
        required: ["label_zh", "label_en", "value_zh", "value_en"],
      },
    },
    habitat_zh: {
      type: "string",
      description:
        "280–420 字：典型生境、海拔与土壤、世界分布范围、中国分布省份。海拔写在正文而非速览条。",
    },
    habitat_en: { type: "string", description: "100–150 词" },
    ethno_tabs: {
      type: "array",
      description:
        "恰好 5 张人文卡，key 依次固定为 global_culture / food / local_knowledge / medicine / literature。无可靠记载的维度要**如实写明「暂无可靠记载」**并转而讨论其生态角色或同属近缘种的对照（须标注是近缘种）。",
      items: {
        type: "object",
        properties: {
          key: {
            type: "string",
            enum: ["global_culture", "food", "local_knowledge", "medicine", "literature"],
          },
          title_zh: { type: "string" },
          title_en: { type: "string" },
          body_zh: { type: "string", description: "130–220 字" },
          body_en: { type: "string", description: "50–80 词" },
        },
        required: ["key", "title_zh", "title_en", "body_zh", "body_en"],
      },
    },
    literature: {
      type: "object",
      description:
        "文学/典籍记载。**只有在你能确凿回忆起原文时** has_record 才为 true；否则 has_record=false 且其余字段留空字符串。严禁伪造古籍原文或出处。",
      properties: {
        has_record: { type: "boolean" },
        original_text: { type: "string", description: "原文逐字引用" },
        source_citation: { type: "string", description: "《书名》·作者·朝代" },
        paraphrase_zh: { type: "string", description: "现代汉语释义" },
        translation_en: { type: "string" },
      },
      required: [
        "has_record",
        "original_text",
        "source_citation",
        "paraphrase_zh",
        "translation_en",
      ],
    },
  },
  required: ["habitat_chips", "habitat_zh", "habitat_en", "ethno_tabs", "literature"],
};

export const premiumPrompt2 = (f: VerifiedFacts) => `${BASE(f)}

【本次任务】只产出：**恰好 7 条**生境速览、生境与分布正文（中英）、**恰好 5 张**人文卡、以及文学典籍记载。

【文学卡原文规则 · 关键】
当且仅当确有可考的文学记载（古典诗文、本草典籍、民歌、碑刻）提及本种时，才把**原文逐字**放进
literature.original_text，并给出出处与现代汉语释义。**记不清原文就把 has_record 设为 false**——
宁可整块不出现，也绝不允许伪造古籍。

严格按给定 JSON 结构返回，不要 markdown 代码块。`;

// ── Part 3: 演化与生态 + 博物趣闻 ─────────────────────────────────────────────
export const PREMIUM_SCHEMA_3 = {
  type: "object",
  properties: {
    eco_function_zh: {
      type: "string",
      description: "260–380 字：传粉 · 种子传播 · 营养级互作 · 群落角色 · 生态系统服务",
    },
    eco_function_en: { type: "string", description: "95–140 词" },
    distribution_invasion_zh: {
      type: "string",
      description:
        "240–360 字：原生分布区 · 归化/栽培范围 · 传播媒介 · 入侵状态。入侵状态**必须严格依据上方已核实事实**：已确认入侵则展开描述其危害与管理；未被记录为入侵则**明确写出「未被 GBIF/GRIIS 中国名录记录为外来入侵物种」**。",
    },
    distribution_invasion_en: { type: "string", description: "90–130 词" },
    curio: {
      type: "object",
      description:
        "博物趣闻，杂志式叙事。开头是一个有张力的驱动性问题，随后 5 个小节推进。优先选取：临床/中毒/管控类 > 入侵/疫情/气候事件 > 重大科学事件（新种发现、分类学修订尤其是极强的钩子）> 产业/园艺/贸易 > 词源与本草。词源只在真正有趣时才写，且不可用作兜底填充，更不要以「XX 拉丁词根意为……」开篇。",
      properties: {
        driving_question_zh: {
          type: "string",
          description: "一个反常识的驱动性问题，20–34 字，不要问号堆砌",
        },
        driving_question_en: { type: "string", description: "对应英文副标，作斜体副题" },
        chapters: {
          type: "array",
          description: "恰好 5 个小节，每节一个有叙事张力的小标题 + 正文。加粗的论断必须可溯源。",
          items: {
            type: "object",
            properties: {
              heading_zh: {
                type: "string",
                description: "6–16 字小标题，要有张力，不要「概述」「简介」这类死标题",
              },
              body_zh: { type: "string", description: "180–280 字" },
            },
            required: ["heading_zh", "body_zh"],
          },
        },
      },
      required: ["driving_question_zh", "driving_question_en", "chapters"],
    },
  },
  required: [
    "eco_function_zh",
    "eco_function_en",
    "distribution_invasion_zh",
    "distribution_invasion_en",
    "curio",
  ],
};

export const premiumPrompt3 = (f: VerifiedFacts) => `${BASE(f)}

【本次任务】只产出：生态功能（中英）、全球分布与入侵（中英）、以及「博物趣闻」叙事区。

【博物趣闻的内容取舍（决定这一节的天花板）】
1. 临床 / 中毒 / 管控 / 判例类
2. 入侵 / 疫情 / 气候变化类事件
3. 重大科学事件（顶刊、基因组测序、临床试验、**新种发现 / 分类学修订**）——
   「广布种被拆分出新种」「在眼皮底下藏了多年才被辨认出来」这类叙事反常识张力极强
4. 工业 / 食品 / 精酿 / 园艺 / 贸易
5. 词源 / 本草 / 古籍钩子（仅在反常识或与生活相关时前置，**不得用作兜底填充**）

再次强调：你无法联网。**不要写具体的论文标题、期刊名、年份或作者**，除非你有十足把握；
可以写「近年的分子系统学研究显示……」这类不带伪精确引证的表述。

严格按给定 JSON 结构返回，不要 markdown 代码块。`;

// ─────────────────────────────────────────────────────────────────────────────
// Renderer
// ─────────────────────────────────────────────────────────────────────────────

const esc = (s: unknown): string =>
  String(s ?? "").replace(
    /[&<>"]/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] ?? c,
  );

/** Allow only <strong> through (the prompt asks for it to mark diagnostic traits). */
const escKeepStrong = (s: unknown): string =>
  esc(s)
    .replace(/&lt;strong&gt;/g, "<strong>")
    .replace(/&lt;\/strong&gt;/g, "</strong>");

/** An image slot. Degrades to a labelled `.broken` state when the URL is missing OR
 *  the image fails to load at view time. The placeholder <span> is ALWAYS emitted
 *  (CSS hides it) — otherwise `onerror` would hide the <img> and leave a silent,
 *  unexplained empty box. */
const slot = (url: string | undefined, label: string, alt: string): string =>
  url
    ? `<div class="img-slot" data-label="${esc(label)}"><img src="${esc(url)}" alt="${esc(alt)}" loading="lazy" onerror="this.parentElement.classList.add('broken')"/><span>图片待补 · image pending</span></div>`
    : `<div class="img-slot broken" data-label="${esc(label)}"><span>图片待补 · image pending</span></div>`;

const CSS = `
:root{--paper:#f5ede4;--paper-deep:#ecddd0;--ink:#1e1008;--ink-soft:#3a2010;--ink-faint:#6e4c28;
--rule:#a06030;--rule-soft:#c89060;--accent:#4080b0;--gold:#7a5010;
--chip-bg:rgba(64,128,176,0.07);--chip-border:rgba(64,128,176,0.24);}
*{box-sizing:border-box}
body{margin:0;background:var(--paper);color:var(--ink);
font-family:"Noto Serif SC","Songti SC",serif;line-height:1.85;font-size:16px}
.wrap{max-width:1100px;margin:0 auto;padding:32px 24px 72px}
em,i{font-style:italic}
strong{font-weight:700;color:var(--ink)}
.en-p{font-family:"EB Garamond","Cormorant Garamond",Georgia,serif;font-style:italic;
color:var(--ink-faint);font-size:.95em;line-height:1.7;margin-top:.5em}

/* Masthead */
.masthead{display:grid;grid-template-columns:1fr auto 1fr;align-items:end;gap:16px;
padding-bottom:14px;border-bottom:1px solid var(--rule)}
.mh-side{font-size:12px;letter-spacing:.08em;color:var(--ink-faint)}
.mh-side .lbl{display:block;font-size:10px;letter-spacing:.18em;text-transform:uppercase;color:var(--rule-soft)}
.mh-side .zh{display:block;color:var(--ink-soft);font-weight:600}
.mh-side .la{display:block;font-style:italic}
.mh-side.right{text-align:right}
.mh-mid{text-align:center;font-size:11px;letter-spacing:.22em;text-transform:uppercase;color:var(--rule)}

/* Hero */
.hero{text-align:center;padding:44px 0 28px}
.tagline{font-size:13px;letter-spacing:.16em;color:var(--rule)}
.tagline .orn{color:var(--rule-soft);margin:0 .6em}
.hero h1{font-size:clamp(34px,5vw,54px);margin:.28em 0 .1em;letter-spacing:.04em;font-weight:700}
.hero .en-name{font-size:15px;color:var(--ink-faint);letter-spacing:.05em}
.hero .latin{font-style:italic;color:var(--ink-soft);margin-top:.35em;font-size:17px}
.folk{margin-top:22px;padding-bottom:14px;border-bottom:1px solid var(--rule-soft);
font-size:13px;color:var(--ink-faint)}
.folk b{color:var(--ink-soft);font-weight:600}

/* Section titles */
h2.sec{display:flex;align-items:center;gap:14px;font-size:23px;margin:60px 0 22px;letter-spacing:.05em}
h2.sec::after{content:"";flex:1;height:1px;background:var(--rule-soft);opacity:.55}
h2.sec .num{font-family:"EB Garamond",Georgia,serif;font-style:italic;color:var(--rule);
font-size:19px;font-weight:400}
h2.sec .en{font-size:12px;letter-spacing:.14em;text-transform:uppercase;color:var(--ink-faint);font-weight:400}

/* Image slots */
/* 图片按原始比例完整显示、不裁剪（仅设最大高度防止超高竖图占满屏）；只有 .broken
   占位框才固定 4:3 尺寸，否则空图会塌成一条线。 */
.img-slot{position:relative;width:100%;overflow:visible;border:1px solid var(--rule-soft);
background:var(--paper-deep);border-radius:2px}
.img-slot img{width:100%;height:auto;max-height:80vh;object-fit:contain;display:block}
.img-slot>span{display:none;font-size:12px;color:var(--rule-soft);letter-spacing:.08em}
.img-slot.broken{display:flex;align-items:center;justify-content:center;aspect-ratio:4/3}
.img-slot.broken img{display:none}
.img-slot.broken>span{display:block}

/* Intro */
.intro{display:grid;grid-template-columns:1fr 1fr;gap:34px;align-items:start}
.intro-img-col{order:-1}

/* Form panel + chips */
.form-panel{background:var(--paper-deep);border-left:3px solid var(--rule);padding:18px 22px;margin-bottom:24px}
.chips{display:flex;flex-wrap:wrap;gap:9px;margin-bottom:26px}
.chip{background:var(--chip-bg);border:1px solid var(--chip-border);border-radius:999px;
padding:5px 13px;font-size:12px;color:var(--ink-soft)}
.chip .en{color:var(--ink-faint);font-style:italic;margin-left:.4em}

/* Feature cards */
.feat-card{display:grid;grid-template-columns:1fr 1fr;gap:30px;align-items:center;margin-bottom:34px}
.feat-card.rev .feat-img{order:2}
.feat-num{font-family:"EB Garamond",Georgia,serif;font-style:italic;color:var(--rule);font-size:15px}
.feat-card h3{margin:.25em 0 .5em;font-size:20px}
.feat-card h3 .en{display:block;font-size:11px;letter-spacing:.13em;text-transform:uppercase;
color:var(--ink-faint);font-weight:400;font-style:normal}

/* Similar species */
.sim-card{display:grid;grid-template-columns:1fr 1fr;gap:26px;background:var(--paper-deep);
border:1px solid var(--rule-soft);padding:22px 24px;margin-top:14px}
.sim-card .lbl{font-size:10px;letter-spacing:.18em;text-transform:uppercase;color:var(--rule)}
.sim-card .nm{font-size:18px;font-weight:600;margin-top:.3em}
.sim-card .la{font-style:italic;color:var(--ink-faint);font-size:14px}

/* Ethnobotany */
.hum-outer{display:grid;grid-template-columns:300px 1fr;gap:32px;align-items:start}
.hum-illu-col{display:flex;flex-direction:column;gap:20px;position:sticky;top:24px}
.hum-tabs{display:flex;flex-wrap:wrap;gap:8px;margin-bottom:20px}
.hum-tab{font-size:12px;letter-spacing:.06em;padding:5px 12px;border:1px solid var(--rule-soft);
color:var(--ink-faint);border-radius:2px}
.hum-card{border-top:1px solid var(--rule-soft);padding:16px 0}
.hum-card h4{margin:0 0 .4em;font-size:16px}
.hum-card h4 .en{font-size:11px;letter-spacing:.12em;text-transform:uppercase;color:var(--ink-faint);
font-weight:400;margin-left:.7em}
.lit-quote{margin:16px 0;padding:16px 20px;background:var(--paper-deep);border-left:3px solid var(--gold)}
.lit-original{font-size:17px;line-height:2.05;color:var(--ink);margin:0}
.lit-source{margin:.6em 0 0;font-size:12px;color:var(--ink-faint);text-align:right}

/* Curio (magazine) */
.curio{margin-top:10px}
.curio .dq{font-size:26px;line-height:1.5;margin:.2em 0 .1em;letter-spacing:.02em}
.curio .dq-en{font-family:"EB Garamond",Georgia,serif;font-style:italic;color:var(--ink-faint);
font-size:15px;margin-bottom:26px}
.curio-cols{column-count:2;column-gap:38px}
.curio-ch{break-inside:avoid;margin-bottom:22px}
.curio-ch h4{font-size:17px;margin:0 0 .35em;color:var(--ink-soft)}

/* References */
.refs{margin-top:16px;border-top:1px solid var(--rule-soft);padding-top:16px}
.refs li{font-size:13px;color:var(--ink-faint);margin-bottom:.5em}
.refs a{color:var(--accent);text-decoration:none;border-bottom:1px solid var(--chip-border)}
.refs a:hover{border-bottom-color:var(--accent)}
.note{font-size:12px;color:var(--ink-faint);background:var(--paper-deep);
border-left:3px solid var(--rule-soft);padding:12px 16px;margin-top:14px}

/* Colophon */
.colophon{margin-top:64px;padding-top:18px;border-top:1px solid var(--rule);
font-size:11px;letter-spacing:.09em;color:var(--rule-soft);text-align:center;line-height:2}

@media(max-width:900px){
  .wrap{padding:20px 16px 56px}
  .masthead{grid-template-columns:1fr;gap:8px}
  .mh-side.right{text-align:left}
  .intro,.feat-card,.sim-card,.hum-outer{grid-template-columns:1fr}
  .feat-card.rev .feat-img{order:0}
  .hum-illu-col{position:static;flex-direction:row}
  .curio-cols{column-count:1}
  h2.sec{font-size:20px;margin:44px 0 18px;flex-wrap:wrap}
}
`.trim();

const secTitle = (num: string, zh: string, en: string) =>
  `<h2 class="sec"><span class="num">${esc(num)}</span><span>${esc(zh)}</span><span class="en">${esc(en)}</span></h2>`;

const ETHNO_LABELS: Record<string, string> = {
  global_culture: "Global Culture",
  food: "Food",
  local_knowledge: "Local Knowledge",
  medicine: "Medicine",
  literature: "Literature",
};

/** Programmatic, non-hallucinated bibliography from the registries we actually queried. */
function renderReferences(f: VerifiedFacts): string {
  const items = f.sources.map(
    (s) =>
      `<li>${esc(s.name)} — <a href="${esc(s.url)}" target="_blank" rel="noreferrer">${esc(s.url)}</a></li>`,
  );
  return (
    secTitle("§", "名录与数据依据", "References & Data Sources") +
    `<div class="refs"><ul>${items.join("")}</ul>` +
    `<p class="note">本页的保护名录、入侵状态与分类信息由 Plantspedia 服务端实时查询 GBIF、GRIIS 中国名录及国家/省级重点保护名录得出，为可核验的结构化数据；正文叙述由 AI 依据上述事实撰写，仍建议编辑校对后收录。本页不含未经核实的新闻引用。</p></div>`
  );
}

export function renderPremiumHtml(
  f: PremiumFields,
  facts: VerifiedFacts,
  assets: { heroUrl: string; images: string[] },
): string {
  const img = (i: number): string | undefined => assets.images[i];
  const cards = (f.feature_cards ?? []).slice(0, 6);
  const chips = (f.habitat_chips ?? []).slice(0, 7);
  const tabs = (f.ethno_tabs ?? []).slice(0, 5);
  const chapters = (f.curio?.chapters ?? []).slice(0, 5);

  const featHtml = cards
    .map((c, i) => {
      const rev = i % 2 === 1 ? " rev" : "";
      return (
        `<div class="feat-card${rev}">` +
        `<div class="feat-img">${slot(img(i), `feat-${i + 1}`, `${facts.title} ${c.chip_zh}`)}</div>` +
        `<div><div class="feat-num">${String(i + 1).padStart(2, "0")}</div>` +
        `<h3>${esc(c.title_zh)}<span class="en">${esc(c.chip_en)} · ${esc(c.title_en)}</span></h3>` +
        `<p>${escKeepStrong(c.body_zh)}</p><p class="en-p">${escKeepStrong(c.body_en)}</p></div></div>`
      );
    })
    .join("");

  const chipHtml = cards
    .map(
      (c) => `<span class="chip">${esc(c.chip_zh)}<span class="en">${esc(c.chip_en)}</span></span>`,
    )
    .join("");

  const habChipHtml = chips
    .map(
      (c) =>
        `<span class="chip">${esc(c.label_zh)} ${esc(c.label_en)}: ${esc(c.value_zh)} <span class="en">${esc(c.value_en)}</span></span>`,
    )
    .join("");

  const sim = f.similar_species;
  const simHtml = sim
    ? `<div class="sim-card"><div><div class="lbl">易混近缘种 · Similar species</div>` +
      `<div class="nm">${esc(sim.name_zh)}</div><div class="la">${esc(sim.name_la)}</div></div>` +
      `<div><p>${escKeepStrong(sim.how_to_tell_zh)}</p><p class="en-p">${escKeepStrong(sim.how_to_tell_en)}</p></div></div>`
    : "";

  const litHtml =
    f.literature?.has_record && f.literature.original_text.trim()
      ? `<blockquote class="lit-quote"><p class="lit-original">【原文】${esc(f.literature.original_text)}</p>` +
        `<p class="lit-source">— 出处：${esc(f.literature.source_citation)}</p></blockquote>` +
        `<p>${esc(f.literature.paraphrase_zh)}</p><p class="en-p">${esc(f.literature.translation_en)}</p>`
      : `<p class="note">未检索到可确证的古典文献原文记载，故不设引文（依反虚构协议，宁缺毋造）。</p>`;

  const tabHtml = tabs
    .map(
      (t) =>
        `<span class="hum-tab">${esc(t.title_zh)} · ${esc(ETHNO_LABELS[t.key] ?? t.title_en)}</span>`,
    )
    .join("");

  const humCards = tabs
    .map(
      (t) =>
        `<div class="hum-card"><h4>${esc(t.title_zh)}<span class="en">${esc(ETHNO_LABELS[t.key] ?? t.title_en)}</span></h4>` +
        `<p>${escKeepStrong(t.body_zh)}</p><p class="en-p">${escKeepStrong(t.body_en)}</p>` +
        (t.key === "literature" ? litHtml : "") +
        `</div>`,
    )
    .join("");

  const curioHtml = chapters
    .map(
      (c) =>
        `<div class="curio-ch"><h4>${esc(c.heading_zh)}</h4><p>${escKeepStrong(c.body_zh)}</p></div>`,
    )
    .join("");

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1.0"/>
<title>${esc(facts.title)} ${esc(facts.scientificName)} · 鄂尔多斯植物精选百科</title>
<link rel="preconnect" href="https://fonts.googleapis.com"/>
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin=""/>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,400;0,600;1,400&family=EB+Garamond:ital@0;1&family=Noto+Serif+SC:wght@300;400;600;700&display=swap"/>
<style>${CSS}</style>
</head>
<body><div class="wrap">

<div class="masthead">
  <div class="mh-side"><span class="lbl">科 · Family</span><span class="zh">${esc(facts.familyZh)}</span><span class="la">${esc(facts.familyLa)}</span></div>
  <div class="mh-mid">Ordos Plantspedia<br/>鄂尔多斯植物精选百科 · Vol. I</div>
  <div class="mh-side right"><span class="lbl">属 · Genus</span><span class="zh">${esc(facts.genusZh)}</span><span class="la">${esc(facts.genusLa)}</span></div>
</div>

<header class="hero">
  <div class="tagline"><span class="orn">✦</span>${esc(f.tagline_zh)}<span class="orn">✦</span></div>
  <h1>${esc(facts.title)}</h1>
  <div class="en-name">${esc(facts.commonNameEn || "English vernacular name missing")}</div>
  <div class="latin">${esc(facts.scientificName)}</div>
  ${f.folk_names_zh?.trim() ? `<div class="folk"><b>中国各地俗名：</b>${esc(f.folk_names_zh)}</div>` : ""}
</header>

${secTitle("I", "植物简介", "Introduction")}
<div class="intro">
  <div class="intro-img-col">${slot(assets.heroUrl, "intro-portrait", `${facts.title} 实拍`)}</div>
  <div><p>${escKeepStrong(f.intro_zh)}</p><p class="en-p">${escKeepStrong(f.intro_en)}</p></div>
</div>
<div class="form-panel" style="margin-top:28px">
  <p style="margin:0">${escKeepStrong(f.form_overview_zh)}</p>
  <p class="en-p" style="margin-bottom:0">${escKeepStrong(f.form_overview_en)}</p>
</div>
<div class="chips">${chipHtml}</div>

${secTitle("II", "关键特征", "Key Features")}
${featHtml}
${simHtml}

${secTitle("III", "典型生境", "Habitat")}
${slot(img(6), "hab-panorama", `${facts.title} 生境`)}
<div class="chips" style="margin-top:24px">${habChipHtml}</div>
<p>${escKeepStrong(f.habitat_zh)}</p><p class="en-p">${escKeepStrong(f.habitat_en)}</p>

${secTitle("IV", "植物人文", "Ethnobotany")}
<div class="hum-outer">
  <div class="hum-illu-col">
    ${slot(img(7), "hum-sci-illus", `${facts.title} 科学绘图`)}
    ${slot(img(8), "hum-art-illus", `${facts.title} 人文图像`)}
  </div>
  <div class="hum-content-col">
    <div class="hum-tabs">${tabHtml}</div>
    ${humCards}
  </div>
</div>

${secTitle("V", "演化与生态", "Evolution & Ecology")}
<h3>生态功能 · Ecological Function</h3>
<p>${escKeepStrong(f.eco_function_zh)}</p><p class="en-p">${escKeepStrong(f.eco_function_en)}</p>
<h3 style="margin-top:28px">全球分布与入侵 · Distribution &amp; Invasion</h3>
<p>${escKeepStrong(f.distribution_invasion_zh)}</p><p class="en-p">${escKeepStrong(f.distribution_invasion_en)}</p>

${secTitle("VI", "博物趣闻", "Natural History")}
<article class="curio">
  <h2 class="dq">${esc(f.curio?.driving_question_zh ?? "")}</h2>
  <div class="dq-en">${esc(f.curio?.driving_question_en ?? "")}</div>
  <div class="curio-cols">${curioHtml}</div>
</article>

${renderReferences(facts)}

<div class="colophon">
  ORDOS PLANTSPEDIA · 鄂尔多斯植物精选百科<br/>
  金叶编辑一键创建 · 内容由 AI 依据已核实名录数据撰写，建议编辑校对后收录<br/>
  ${esc(facts.scientificName)}
</div>

</div></body></html>`;
}
