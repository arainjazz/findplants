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
 *
 * 📌 2026-07-20 起：上面这份"移植"只是**内置底版**。管理员可以在后台
 * 「金叶详页创作指导」面板里粘贴一份新的 skill 正文（见 gold-skill.ts），它会被注入
 * 三轮撰稿 prompt，并把版本号署在详页页尾。没粘贴时行为与从前逐字相同。
 */

import { skillPromptBlock, skillSignature, type GoldSkill } from "./gold-skill";

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

/** 渲染层需要的一张图：URL + 署名串 + 可点回的原始页。 */
export type RenderPhoto = {
  url: string;
  credit?: string;
  sourceUrl?: string;
  /** url 为空时写在空槽里的说明，如「暂无该物种的花期公开照片」。 */
  missingNote?: string;
  /**
   * 降级配图的**如实说明**，如「图为植株 · 该物种的果实照片暂缺」。
   *
   * 2026-07-29 起金叶不再留空槽（9 个槽的 want 已列全 6 个器官 + 四轮兜底），
   * 于是「果实卡里放的其实是植株照」会成为常态。有图不等于可以不告诉读者图里是什么 ——
   * 这一行就是那句交代，缺了它就变成了本文件 slot() 一直反对的那种误导。
   */
  note?: string;
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
  // ── Section V「演化与生态」的五格，逐格对齐 四合木 页 ──────────────────────
  // 从前这一节只有 c/d 两格（生态功能 + 全球分布），比标准页少了 a/b/e 与那句总起的
  // 导语行 —— 用户 2026-07-30：「section V 演化与生态没有和四合木标准页对齐」。
  /** `.ee-intro-line`：一句话总起（中英同段，用 · 分隔），压在整节最前面。 */
  eco_intro_zh?: string;
  eco_intro_en?: string;
  /** a. 系统发育 · Phylogeny */
  phylogeny_zh?: string;
  phylogeny_en?: string;
  /** b. 起源与驯化 · Origin & Domestication */
  origin_domestication_zh?: string;
  origin_domestication_en?: string;
  /** c. 生态功能 · Ecological Roles */
  eco_function_zh: string;
  eco_function_en: string;
  /** d. 全球分布与入侵 · Global Distribution & Invasion */
  distribution_invasion_zh: string;
  distribution_invasion_en: string;
  /** e. 保护状态 · Conservation Status（徽章由服务端按真实名录渲染，这里只写正文） */
  conservation_status_zh?: string;
  conservation_status_en?: string;
  /**
   * 「最新资讯」卡片。**URL 必须来自服务端喂进 prompt 的联网检索来源清单**，
   * 渲染前还会再过一遍白名单（见 renderPremiumHtml 的 newsHtml）——
   * 模型编出来的链接一律丢弃，宁可整块不渲染。
   */
  news?: {
    summary_zh: string;
    source_url: string;
    source_name: string;
    date: string;
    tag: string;
  }[];
  curio: {
    driving_question_zh: string;
    driving_question_en: string;
    /** 博客导语（`.blog-intro` 左侧色条那一段）。老数据没有，渲染时容错。 */
    lead_zh?: string;
    lead_en?: string;
    chapters: {
      heading_zh: string;
      /** 小标题下的英文副题（`.blog-chapter-en`）。老数据没有，缺了就不渲染那一行。 */
      heading_en?: string;
      /** 正文。**空行分段**，渲染时按空行拆成多个 `<p>`。 */
      body_zh: string;
    }[];
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

/**
 * 三轮撰稿共用的前置块。`skill` = 管理员在后台粘贴的「金叶创作指导」，没配就是 null，
 * 此时输出与本功能上线前逐字相同（零行为变化）。
 *
 * 顺序是刻意的：**已核实事实 → 创作指导 → 反虚构协议 → 写作规则**。
 * 创作指导夹在中间，让反虚构协议拿到最后发言权 —— 详见 gold-skill.ts 的层级说明。
 */
const BASE = (
  f: VerifiedFacts,
  skill?: GoldSkill | null,
) => `你是《鄂尔多斯植物精选百科》(Ordos Plantspedia) 的首席植物学家兼资深图鉴主编，正在撰写一份**精品级**中英双语物种详页。

【已核实事实（ground truth，不得改写）】
${factsBlock(f)}
${skillPromptBlock(skill ?? null) ? `\n${skillPromptBlock(skill ?? null)}\n` : ""}
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
    tagline_en: {
      type: "string",
      description:
        "对应英文题记，6–14 词。**必填** —— 题记在页面上是中英双语并排的，缺了英文那一行就空着。",
    },
    folk_names_zh: {
      type: "string",
      description:
        "拉丁学名下面那一行：**中文俗名 / 商品名 / 异名 / 另名**，顿号分隔。读者很可能是在其中某一个名字下认识它的（花市的商品名、旧植物志的异名、地方另名都算），所以尽量写全。若无可靠记载则留空字符串（**不要编造，也不要把学名的音译当俗名**）。",
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

export const premiumPrompt1 = (f: VerifiedFacts, skill?: GoldSkill | null) => `${BASE(f, skill)}

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

export const premiumPrompt2 = (f: VerifiedFacts, skill?: GoldSkill | null) => `${BASE(f, skill)}

【本次任务】只产出：**恰好 7 条**生境速览、生境与分布正文（中英）、**恰好 5 张**人文卡、以及文学典籍记载。

【文学卡原文规则 · 关键】
当且仅当确有可考的文学记载（古典诗文、本草典籍、民歌、碑刻）提及本种时，才把**原文逐字**放进
literature.original_text，并给出出处与现代汉语释义。**记不清原文就把 has_record 设为 false**——
宁可整块不出现，也绝不允许伪造古籍。

严格按给定 JSON 结构返回，不要 markdown 代码块。`;

// ── Part 3: 演化与生态（五格，对齐 四合木 页的 Section IV）────────────────────
export const PREMIUM_SCHEMA_3 = {
  type: "object",
  properties: {
    eco_intro_zh: {
      type: "string",
      description:
        "整节的一句话总起，40–70 字：把这个种的演化身世与它今天在群落里的位置压成一句。不要罗列小标题。",
    },
    eco_intro_en: { type: "string", description: "对应英文一句，20–35 词" },
    phylogeny_zh: {
      type: "string",
      description:
        "a. 系统发育：180–280 字。科属归属、与姐妹类群的关系、分类学上的争议与现今处理。**分子证据只在你确有把握时才提，且不得写论文标题/期刊名/作者名**；没有把握就只写形态学与分类处理。",
    },
    phylogeny_en: { type: "string", description: "70–110 词" },
    origin_domestication_zh: {
      type: "string",
      description:
        "b. 起源与驯化：160–260 字。起源区与扩散历史；是否被驯化/栽培（没有就明确写「从未被驯化，始终以野生状态存在」）；近缘种的利用情况可作对照，但必须标明是哪个物种。",
    },
    origin_domestication_en: { type: "string", description: "60–100 词" },
    eco_function_zh: {
      type: "string",
      description: "c. 生态功能：260–380 字：传粉 · 种子传播 · 营养级互作 · 群落角色 · 生态系统服务",
    },
    eco_function_en: { type: "string", description: "95–140 词" },
    distribution_invasion_zh: {
      type: "string",
      description:
        "d. 全球分布与入侵：240–360 字：原生分布区 · 归化/栽培范围 · 传播媒介 · 入侵状态。入侵状态**必须严格依据上方已核实事实**：已确认入侵则展开描述其危害与管理；未被记录为入侵则**明确写出「未被 GBIF/GRIIS 中国名录记录为外来入侵物种」**。",
    },
    distribution_invasion_en: { type: "string", description: "90–130 词" },
    conservation_status_zh: {
      type: "string",
      description:
        "e. 保护状态：120–220 字。**只准复述上方「已核实事实」里的名录结论**，并写清当前的主要威胁与保护措施。名录没命中就如实写「未被收录于……」，严禁臆造保护等级或 CITES 附录。",
    },
    conservation_status_en: { type: "string", description: "45–85 词" },
    news: {
      type: "array",
      description:
        "最新资讯（0–4 条）。**只准从下方【可引用的新闻来源】清单里挑**，一条都挑不出来就返回空数组 —— 空着远比编一条链接好。",
      items: {
        type: "object",
        properties: {
          summary_zh: {
            type: "string",
            description: "一句话说清这条报道讲了什么（28–52 字），不要复述标题。",
          },
          source_url: {
            type: "string",
            description:
              "**必须从【可引用的新闻来源】清单里逐字复制**。任何不在清单里的网址都会被服务端丢弃。",
          },
          source_name: {
            type: "string",
            description: "媒体名。清单里看不出来就留空字符串，**不要猜**。",
          },
          date: {
            type: "string",
            description:
              "发布日期 YYYY-MM-DD 或 YYYY-MM。**清单里没写就留空字符串，严禁推测年份。**",
          },
          tag: {
            type: "string",
            description: "分类标签，只能取：媒体报道 / 地方报道 / 科研进展 / 保护动态",
          },
        },
        required: ["summary_zh", "source_url", "source_name", "date", "tag"],
      },
    },
  },
  required: [
    "eco_intro_zh",
    "eco_intro_en",
    "phylogeny_zh",
    "phylogeny_en",
    "origin_domestication_zh",
    "origin_domestication_en",
    "eco_function_zh",
    "eco_function_en",
    "distribution_invasion_zh",
    "distribution_invasion_en",
    "conservation_status_zh",
    "conservation_status_en",
    "news",
  ],
};

export const premiumPrompt3 = (f: VerifiedFacts, skill?: GoldSkill | null) => `${BASE(f, skill)}

【本次任务】产出「演化与生态」整节的五格 + 最新资讯。五格依次是：
a. 系统发育 · b. 起源与驯化 · c. 生态功能 · d. 全球分布与入侵 · e. 保护状态。
这个次序对齐《鄂尔多斯植物精选百科》纸本卷的 四合木 页，不要合并、不要调序。
另外先写一句 40–70 字的总起（eco_intro），压在整节最前面。

【全球分布怎么写】本页会在这一节配一张**由服务端实时生成的 GBIF 记录密度世界地图**
（国界作底、有记录的地理格子染色）。正文要与那张图相互印证：写清原生分布区、归化/栽培
范围、传播媒介。但**不要写「如图所示某国有点」**——你看不到那张图的最终样子；
也不要把「GBIF 没有记录」说成「该地不产」，采集努力的空白不等于物种的缺席。

【保护状态怎么写】这一格下面会由服务端按**真实名录**渲染保护徽章（IUCN / 国家重点保护…），
所以正文只负责解释：为什么是这个等级、当前的主要威胁是什么、有哪些在做的保护措施。
**名录结论以「已核实事实」为准**，不得改写，也不得自行添加一条名录。

【最新资讯怎么写】只能从下方【可引用的新闻来源】清单里挑，**网址逐字复制**。
清单之外的任何网址都会被服务端丢弃（所以编链接毫无意义，只会让这一块变空）。
日期与媒体名在清单里看不出来就留空 —— 空字段会被安静地省掉，猜错则是硬伤。

严格按给定 JSON 结构返回，不要 markdown 代码块。`;

// ── Part 4: 博物趣闻（Section VI，独占一轮）─────────────────────────────────
//
// 为什么单独一轮：这一节按 plantstory 标准要写到 3000–4000 字，与生态/分布挤在同一次
// 调用里必然撞输出上限，回来就是被截断的 JSON（GOLD_BAD_JSON_3 的历史成因）。
// 拆开之后它有一整轮的输出预算，才写得动 四合木 页那种密度的叙事。
export const PREMIUM_SCHEMA_4 = {
  type: "object",
  properties: {
    curio: {
      type: "object",
      description:
        "博物趣闻博客（Section VI）。杂志式叙事长文：驱动性问题大标题 + 导语 + 恰好 5 个小节。",
      properties: {
        driving_question_zh: {
          type: "string",
          description:
            "驱动性问题大标题，24–46 字，形如「一种{反常识描述}，{当代事件/悬念}？」。全篇每一节都要服务于它。",
        },
        driving_question_en: {
          type: "string",
          description: "对应英文副标题，一行，作斜体副题（8–18 词）",
        },
        lead_zh: {
          type: "string",
          description:
            "导语 **180–280 字**（超过 350 字判为「钩子过载」）。🔴 **必须以一个当代事件切入** —— 中毒/管控/判例、入侵或疫情、政策法规、市场与产业事件、新种发现或分类修订，都算；**「近年一篇综述显示……」不算当代事件**。把驱动性问题落到这个事件的具体场景与具体数字上，不要复述标题。一段里最多摆 2 个年份/数据，其余留给后文。",
        },
        lead_en: { type: "string", description: "对应英文，55–90 词" },
        chapters: {
          type: "array",
          description:
            "恰好 5 个小节。每节围绕一个独立主旨，标题之间不得重复、严禁「（续）」这类续接式标题。",
          items: {
            type: "object",
            properties: {
              heading_zh: {
                type: "string",
                description:
                  "6–20 字小标题，要像**故事的章节标题**，推动悬念和转折。✅ 如「能烧的灌木遇上了能烧的石头」「飞不远的种子」「一根被禁的根」；❌ 说明文栏目名一律不合格：形态特征 / 药用价值 / 保护与未来 / 分布与生境 / 当代钩子 / 命名与历史 / 分类学 / 生态价值 / 结语。",
              },
              heading_en: {
                type: "string",
                description: "小标题的英文副题，2–6 词，首字母大写",
              },
              body_zh: {
                type: "string",
                description:
                  "**硬性下限 600 字、目标 700–900 字**（少于 600 字视为不合格），用空行分成 **4–6 个自然段**，每段 150 字上下。每段要有具体场景、具体数字或具体机制；每节至少一处用 <strong> 标出可溯源的关键论断。写够长度靠的是把细节写透（场景、数字、机制、对比、后果），不是把一句话说三遍。",
              },
            },
            required: ["heading_zh", "heading_en", "body_zh"],
          },
        },
      },
      required: ["driving_question_zh", "driving_question_en", "lead_zh", "lead_en", "chapters"],
    },
  },
  required: ["curio"],
};

export const premiumPrompt4 = (f: VerifiedFacts, skill?: GoldSkill | null) => `${BASE(f, skill)}

【本次任务】只产出「博物趣闻博客」（Section VI）这一节。它是全页最长、最见功力的一节，
标准对齐《鄂尔多斯植物精选百科》纸本卷的 四合木 页：**一篇能独立成篇的博物学随笔**，
而不是几段科普摘要。

【结构】驱动性问题大标题 → 导语 → 恰好 5 个小节。

🔴【篇幅是硬指标，不是建议】每个小节 **不得少于 600 字**，目标 700–900 字，
分成 **4–6 个自然段**（段间空一行）。**五节正文合计不少于 3000 字。**
这是本轮唯一的任务，你有充足的输出预算 —— 写短了这一节就退回成「几段科普摘要」，
那正是本次要改掉的东西。写不够长度时，**不要靠重复和形容词凑**，而是继续往下挖：
这件事发生在什么场景里？具体的数字是多少？机制是怎么运作的？和什么形成对比？
后果是什么？读者身边哪里能碰到它？把这些写透，长度自然就有了。

【内容取舍（决定这一节的天花板）】
选材优先级只有一条：**反常识 / 震惊 / 令人困惑 / 重大事件 / 与生活息息相关**。
刻板科普（「具有重要的生态价值」「全株可入药」）一律不要。按可用性排序：
1. 临床 / 中毒 / 管控 / 判例类
2. 入侵 / 疫情 / 气候变化类事件
3. 重大科学事件（基因组测序、分子系统学、**新种发现 / 分类学修订**）——
   「广布种被拆分出新种」「在眼皮底下藏了多年才被辨认出来」这类叙事反常识张力极强
4. 工业 / 食品 / 园艺 / 贸易 / 城市生态（产值、面积、产量这类**产业数字**最好用）
5. 词源 / 本草 / 古籍钩子 —— **只有当命名或分类本身就是反常识点时才写**
   （如「花店里的勿忘我其实是补血草属」「三个种在同一年被并成一个」），
   位置灵活、不必放最后；**绝不可当兜底填充**，更不要以「XX 拉丁词根意为……」开篇。

🔴【导语必须是「当代事件钩子」，这是硬性规则】
lead_zh 是全篇的第一段，也是首屏摘要卡上的那段字。它**必须**从一个当代事件切入：
中毒 / 管控 / 判例、入侵或疫情、政策法规、市场与产业事件、新种发现或分类修订。
- ❌ **「近年一篇综述显示……」不算当代事件**，文献综述不是新闻。
- ❌ 风景描写、古籍、词源、形态描述都**不能**开场，它们只能做后文的背景。
- ✅ 上面的【联网调研·权威参考资料】与【本页可参考的媒体报道】里若有真实事件，优先用它。
- 实在找不到可靠的当代事件时，退而用**形态或生态上的反常识事实**开篇
  （例如「结籽率只有百分之一」），**绝不可编造事件来填这个位置**。

【证据脚手架要下沉，不要摆进叙事】
DOI、论文编号、期刊名、数据库名、媒体名、官网名**都不进正文**。本页另有「名录与数据依据」
与「最新资讯」两栏专门承担出处，叙事里只留**事件、冲突、数字和故事**。
写「一项针对该属的群体基因组研究把三个种并成了一个」，不要写
「据《某某学报》2024 年某文（DOI:…）」。

【写法】
- 叙事，不是词条。有场景、有转折、有具体的数字与机制；避免「具有重要的生态价值」这类空话。
- **本节叙事必须完全原创**：前面几节（简介 / 关键特征 / 生境 / 人文 / 生态）只作为事实来源，
  **不得整段照搬或改写**它们的句子。改写不等于原创。
- 每节至少一处 <strong> 标出的关键论断，且该论断必须是你有把握的既有知识。
- 5 个小标题彼此独立，**不得出现「（续）」「其二」这类续接式标题**。

【五道硬门（对齐 plantstory skill 的 G1–G5，逐条会被检查）】
- **G1 来源词**：叙事里**不得出现**这些名字的原文 ——
  百度百科 / 维基百科 / Wikipedia / 知乎 / 搜狐 / 新浪 / PMC / PubMed / Frontiers / MDPI /
  ResearchGate / ScienceDirect / GBIF / POWO / Kew / eFloras / Flora of China / USDA /
  iNaturalist / 植物智 / 多识植物百科 / 央视。要提就改用中文表述
  （「全球生物多样性信息网络」「英国皇家植物园」「《中国植物志》英文版」）。
- **G2 破折号**：「——」全篇最多 **2** 处（预算：大标题 1、收尾 1），其余改用逗号、分号、冒号或断句。
- **G3 英文行**：**不允许出现连续 5 个以上英文单词**的句子。要提外文期刊就写
  「《某某学报》（英文期刊）」，不要整行英文。
- **G4 引号密度**：直角引号「」全篇**少于 20 个**。古籍原文引用尤其克制。
- **G5 驱动性问题**：driving_question_zh 必须是一个真正的问句，不是名词短语。

【硬约束（与反虚构协议叠加）】
- 不要写具体的论文标题、期刊名、作者名。可以写「近年的分子系统学研究显示……」
  这类不带伪精确引证的表述。
- 年份 + 事件的配对只在你**确有把握**时才写；没把握就用「近年」「二十世纪后期」。
- 严禁出现「某位老中医」「一位日本学者」「当地一位老牧民」「一位王先生」这类假托人物 ——
  这是本站抓到过最多次的一类编造。
- 「日本人会……」「广东人会……」这类**无出处的群体行为断言**同样禁止。

【交稿前自查】
1. 导语是不是从一个**当代事件**切入的？（综述、风景、古籍、词源都不算）
2. 导语 180–280 字了吗？有没有超过 350 字、或一段里堆了 3 个以上年份/机构/数据？
3. 逐节数：够 600 字了吗？分了 4 个自然段以上吗？有具体数字、场景或机制吗？
4. 5 个小标题是不是都像故事章节标题，没有一个是说明文栏目名？
5. 数一遍破折号（≤2）、直角引号（<20）；扫一遍有没有库名原文、有没有整行英文。
任何一条不过，就改完再交。

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
const slot = (photo: RenderPhoto | undefined, label: string, alt: string): string => {
  if (!photo?.url) {
    // 该器官确实没有可用的公开照片时，**如实写明缺什么**，而不是塞一张随机图。
    // 对科普站来说诚实比填满值钱：一张标着「花」的叶子特写比空位有害得多。
    const note = (photo?.missingNote || "").trim();
    // 两种空槽要区分：`no-organ` = 我们**确知**这个器官没有可用公开照片（瘦条 + 虚线，
    // 说明写清楚）；无说明 = 图加载失败的兜底（保持 4:3 占位，提示补图）。
    // 稀有种可能一次缺六个槽，若都按 4:3 撑开会得到六个 548px 的大空洞。
    return note
      ? `<div class="img-slot broken no-organ" data-label="${esc(label)}"><span>${esc(note)}</span></div>`
      : `<div class="img-slot broken" data-label="${esc(label)}"><span>图片待补 · image pending</span></div>`;
  }
  // 署名条：摄影者 / 许可证 / 来源，能点回原始页面。**有图必有署名** ——
  // 这些照片多为 CC BY-NC 等要求署名的许可，不署名就是侵权（见 species-photos.ts）。
  const credit = (photo.credit || "").trim();
  const creditHtml = credit
    ? photo.sourceUrl
      ? `<figcaption class="img-credit"><a href="${esc(photo.sourceUrl)}" target="_blank" rel="noreferrer nofollow">${esc(credit)}</a></figcaption>`
      : `<figcaption class="img-credit">${esc(credit)}</figcaption>`
    : "";
  // 降级说明排在署名之前，且**不进 <a>** —— 它是内容事实，不是版权信息。
  const note = (photo.note || "").trim();
  const noteHtml = note ? `<figcaption class="img-note">${esc(note)}</figcaption>` : "";
  return (
    `<figure class="img-slot" data-label="${esc(label)}">` +
    `<img src="${esc(photo.url)}" alt="${esc(alt)}" loading="lazy" onerror="this.parentElement.classList.add('broken')"/>` +
    `<span>图片待补 · image pending</span>${noteHtml}${creditHtml}</figure>`
  );
};

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
.tagline-en{font-family:"EB Garamond",Georgia,serif;font-style:italic;font-size:12.5px;
letter-spacing:.06em;color:var(--rule-soft);margin-top:.35em}
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
/* margin:0 是必须的：这个元素是 figure，浏览器 UA 样式给它 margin:1em 40px，
   叠上 width:100% 会把整页撑出横向滚动条（实测 scrollWidth 786 > clientWidth 762）。
   注意本块在 TS 模板字符串里，注释中禁止出现反引号。 */
.img-slot{position:relative;width:100%;margin:0;overflow:visible;border:1px solid var(--rule-soft);
background:var(--paper-deep);border-radius:2px}
.img-slot img{width:100%;height:auto;max-height:80vh;object-fit:contain;display:block}
.img-slot>span{display:none;font-size:12px;color:var(--rule-soft);letter-spacing:.08em}
.img-slot.broken{display:flex;align-items:center;justify-content:center;aspect-ratio:4/3}
.img-slot.broken img{display:none}
.img-slot.broken>span{display:block}
.img-slot.no-organ{aspect-ratio:auto;min-height:0;padding:22px 14px;border-style:dashed;
background:transparent}
.img-slot.no-organ>span{font-size:11px;line-height:1.6;letter-spacing:.02em}
/* 署名条 —— 配图多为 CC BY-NC 等要求署名的许可，这一行是合规的一部分，不是装饰。 */
.img-credit{margin:4px 2px 0;font-size:10px;line-height:1.5;color:var(--ink-faint,#8a988f);
letter-spacing:.02em;word-break:break-word}
.img-credit a{color:inherit;text-decoration:none;border-bottom:1px dotted currentColor}
.img-slot.broken .img-credit{display:none}
/* 降级配图的如实说明。斜体 + 略深，读者应该先看到它再看署名。 */
.img-note{margin:5px 2px 0;font-size:10px;line-height:1.5;color:var(--ink-soft,#5a6a5e);
font-style:italic;word-break:break-word}
.img-slot.broken .img-note{display:none}

/* Intro */
.intro{display:grid;grid-template-columns:1fr 1fr;gap:34px;align-items:start}
.intro-img-col{order:-1}

/* 「博物趣闻」摘要卡 —— 开篇配图下面那张，点一下跳到页尾 Section VI。
   跳转本身由宿主页面接管（plants.$slug.tsx 的 wireIframe：详页是 srcdoc iframe，
   直接走 #hash 会把 iframe 导航成一屏源码）。这里只负责把 href 与目标 id 摆对。 */
.vi-card{display:block;margin-top:22px;padding:16px 20px;text-decoration:none;color:inherit;
background:linear-gradient(135deg,rgba(160,96,48,.15) 0%,rgba(160,96,48,.05) 100%);
border:1px solid rgba(160,96,48,.28);border-left:4px solid var(--rule);
transition:background .3s,border-color .3s,transform .3s,box-shadow .3s}
.vi-card:hover{background:linear-gradient(135deg,rgba(160,96,48,.24) 0%,rgba(160,96,48,.1) 100%);
border-color:var(--rule);transform:translateY(-3px);box-shadow:0 8px 20px rgba(160,96,48,.16)}
.vi-card .vi-t{display:flex;justify-content:space-between;align-items:center;gap:10px;
font-size:14px;font-weight:700;letter-spacing:.06em;color:var(--ink);margin-bottom:9px}
.vi-card .vi-t::after{content:"→";color:var(--rule);font-size:15px;transition:transform .3s}
.vi-card:hover .vi-t::after{transform:translateX(4px)}
.vi-card .vi-x{font-size:12.5px;line-height:1.68;color:var(--ink-soft);margin:0 0 6px}
.vi-card .vi-e{font-family:"EB Garamond",Georgia,serif;font-style:italic;font-size:12.5px;
line-height:1.5;color:var(--ink-faint);margin:0}

/* 全球分布图（Section V）—— 服务端生成的 inline SVG，见 distribution-map.ts */
.dist-map{margin:6px 0 0;border:1px solid var(--rule-soft);background:var(--paper-deep);
border-radius:2px;overflow:hidden}
.dist-map svg{display:block;width:100%;height:auto}
.dist-cap{margin:6px 2px 0;font-size:10.5px;line-height:1.6;color:var(--ink-faint);font-style:italic}

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
/* 落单配图：特征卡少于 6 张时才出现（见 renderPremiumHtml 里的 orphans）。
   刻意做得比正式特征卡朴素 —— 它是补充材料，不该抢正文的视觉分量。 */
.feat-orphans{margin:8px 0 34px;padding-top:18px;border-top:1px dashed var(--rule)}
.feat-orphans-note{font-size:13px;color:var(--ink-soft);margin:0 0 14px}
.feat-orphans-note .en{display:block;font-size:11.5px;color:var(--rule);font-style:italic}
.feat-orphan-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:18px}
.feat-orphan-name{font-size:13px;font-weight:600;margin-bottom:6px}
.feat-orphan-name .en{font-weight:400;color:var(--rule);font-style:italic;margin-left:6px}
.feat-card h3{margin:.25em 0 .5em;font-size:20px}
.feat-card h3 .en{display:block;font-size:11px;letter-spacing:.13em;text-transform:uppercase;
color:var(--ink-faint);font-weight:400;font-style:normal}

/* Similar species —— 版式对齐 四合木 页：左 320px 配图列 + 右正文列。
   从前没有配图列，于是「易混近缘种」写着一个物种名却没有一张图可比对
   （用户 2026-07-30：「蕨麻委陵菜（鹅绒委陵菜）没有配图」）——而「易混」这件事
   恰恰是最需要图的：两个名字摆在一起，读者根本无从分辨。 */
.sim-card{display:grid;grid-template-columns:320px 1fr;gap:0;align-items:start;
background:var(--paper-deep);border:1px solid var(--rule-soft);margin-top:36px;position:relative}
.sim-card.no-img{grid-template-columns:1fr}
.sim-img-col{padding:20px;overflow:hidden;align-self:start}
.sim-body{padding:24px;min-width:0}
.sim-card .lbl{font-size:10px;letter-spacing:.18em;text-transform:uppercase;color:var(--rule)}
.sim-card .nm{font-size:18px;font-weight:600;margin-top:.3em}
.sim-card .la{font-style:italic;color:var(--ink-faint);font-size:14px;display:block;margin-bottom:10px}

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

/* Section VI 博物趣闻博客 —— 版式对齐纸本卷 四合木 页的 .blog-post。
   刻意**不用** column-count 多栏流：那种排法下图片会被切断在栏边界上，且长章节
   会在两栏之间来回跳。改成两个 flex 列，每列自己纵向排 —— 章节与配图的从属关系才稳。 */
.blog-post{margin-top:6px}
.blog-meta{display:flex;flex-wrap:wrap;gap:18px;list-style:none;margin:0 0 18px;padding:0 0 10px;
border-bottom:1px solid var(--rule-soft);font-size:11.5px;letter-spacing:.06em;color:var(--rule)}
.blog-title{font-size:27px;line-height:1.42;margin:.1em 0 .18em;letter-spacing:.02em;font-weight:700}
.blog-subtitle{font-family:"EB Garamond",Georgia,serif;font-style:italic;color:var(--ink-faint);
font-size:15.5px;margin:0 0 22px}
.blog-cover{margin-bottom:22px}
.blog-intro{border-left:3px solid var(--rule);padding-left:18px;margin-bottom:32px}
.blog-intro p{margin:0 0 8px;font-size:15.5px;color:var(--ink-soft)}
.blog-intro .en-p{margin-bottom:0}
.blog-grid{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:44px;align-items:start}
.blog-col{display:flex;flex-direction:column;gap:32px;min-width:0}
.blog-chapter h4{font-size:18px;margin:0 0 .2em;padding-bottom:6px;line-height:1.4;
border-bottom:1px solid var(--rule-soft)}
.blog-chapter .ch-en{display:block;font-family:"EB Garamond",Georgia,serif;font-style:italic;
font-size:12px;letter-spacing:.08em;color:var(--rule);margin-bottom:14px}
.blog-chapter p{margin:0 0 13px;text-align:justify}
.blog-chapter p:last-child{margin-bottom:0}

/* Evolution & Ecology（Section V）—— 两栏，左图右文，对齐 四合木 页的 .ee-outer */
.ee-outer{display:grid;grid-template-columns:300px 1fr;gap:36px;align-items:start}
.ee-illu-col{display:flex;flex-direction:column;gap:20px;position:sticky;top:24px}
.ee-content-col{min-width:0}
.ee-intro-line{font-size:16px;line-height:1.7;color:var(--ink-faint);margin:0 0 24px;
border-left:3px solid var(--accent);padding-left:14px}
.ee-content-col h4{font-weight:600;font-size:15px;color:var(--ink);margin:26px 0 8px;
border-bottom:1px solid var(--rule-soft);padding-bottom:4px}
.ee-content-col h4:first-of-type{margin-top:0}
.cons-badges{margin-top:10px}
.conservation-badge{display:inline-flex;align-items:center;gap:8px;border:1px solid var(--rule-soft);
background:var(--chip-bg);padding:6px 14px;margin:8px 8px 0 0}
.conservation-badge .cb-status{font-weight:600;font-size:12px;color:var(--rule)}
.conservation-badge .cb-label{font-size:11px;letter-spacing:.12em;color:var(--ink-faint)}

/* 最新资讯 —— 四合木 页里排在参考文献与 Section VI 之间。
   每张卡都必须是**可点开的真链接**，链接来自服务端联网检索的来源清单并过白名单；
   一条都没有时整块不渲染（空的「最新资讯」比没有更糟）。 */
/* 顶部**不再画横线**：它现在是正式的一节（Section V），分隔由 h2.sec 负责，
   再画一条就成了双线。 */
.news-section{margin-top:6px}
.news-grid{display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-bottom:20px}
.news-card{display:block;padding:16px 18px;border:1px solid var(--rule-soft);background:var(--paper);
text-decoration:none;color:var(--ink);transition:background .15s}
.news-card:hover{background:var(--paper-deep)}
.news-tag{font-size:9px;letter-spacing:.12em;display:inline-block;padding:2px 8px;margin-bottom:8px;
border:1px solid var(--chip-border);color:var(--accent)}
.news-summary{font-size:13px;line-height:1.65;color:var(--ink-soft);display:block;margin-bottom:6px}
.news-source{font-style:italic;font-size:11px;color:var(--ink-faint);display:block}
.news-footer{font-size:10.5px;color:var(--ink-faint);padding:10px 0;border-top:1px solid var(--rule-soft)}

/* References */
.refs{margin-top:16px;border-top:1px solid var(--rule-soft);padding-top:16px}
.refs li{font-size:13px;color:var(--ink-faint);margin-bottom:.5em}
.refs a{color:var(--accent);text-decoration:none;border-bottom:1px solid var(--chip-border)}
.refs a:hover{border-bottom-color:var(--accent)}
.note{font-size:12px;color:var(--ink-faint);background:var(--paper-deep);
border-left:3px solid var(--rule-soft);padding:12px 16px;margin-top:14px}

/* Colophon —— 三格版心（编纂 / 设计 / 创作指导版本），逐格对齐 四合木 页的页尾。
   从前是居中堆三行小字，与纸本卷的版式对不上（用户 2026-07-30 指出）。 */
.colophon{margin-top:64px;border-top:1px solid var(--rule);padding:22px 0 0}
.col-cells{display:flex;justify-content:space-between;align-items:flex-start;gap:20px}
.col-cell{max-width:33%}
.col-cell:nth-child(1){text-align:left}
.col-cell:nth-child(2){text-align:center}
.col-cell:nth-child(3){text-align:right}
.col-label-zh{font-size:11px;letter-spacing:.12em;color:var(--ink-faint);display:block;margin-bottom:1px}
.col-role-en{font-size:10px;letter-spacing:.18em;text-transform:uppercase;color:var(--ink-faint);
display:block;margin-bottom:4px}
.col-divider{border:none;border-top:1px solid var(--rule-soft);margin:5px 0}
.col-name-zh{font-size:15px;letter-spacing:.06em;color:var(--ink-soft);display:block}
.col-name-en{font-family:"EB Garamond",Georgia,serif;font-style:italic;font-size:13px;
color:var(--ink-faint);display:block;margin-top:2px}
.col-bottom-rule{border:none;border-top:1px solid var(--rule-soft);margin-top:22px}
.col-note{margin:14px 0 0;font-size:11px;letter-spacing:.06em;color:var(--rule-soft);
text-align:center;line-height:1.9}

@media(max-width:900px){
  .wrap{padding:20px 16px 56px}
  .masthead{grid-template-columns:1fr;gap:8px}
  .mh-side.right{text-align:left}
  .intro,.feat-card,.sim-card,.hum-outer,.ee-outer{grid-template-columns:1fr}
  .feat-card.rev .feat-img{order:0}
  .hum-illu-col,.ee-illu-col{position:static;flex-direction:row}
  .sim-img-col{padding:16px 16px 0}
  .news-grid{grid-template-columns:1fr}
  .col-cells{flex-direction:column;gap:20px}
  .col-cell{max-width:100%;text-align:left!important}
  .blog-grid{grid-template-columns:1fr;gap:32px}
  .blog-title{font-size:22px}
  h2.sec{font-size:20px;margin:44px 0 18px;flex-wrap:wrap}
}
`.trim();

/** `id` 只在需要被页内锚点跳到时才传（目前只有 Section VI）。
 *  `scroll-margin-top` 是给宿主页面的平滑滚动留出的余量：不留的话标题会正好贴在
 *  视口顶端、被站点导航压住。 */
const secTitle = (num: string, zh: string, en: string, id?: string) =>
  `<h2 class="sec"${id ? ` id="${esc(id)}" style="scroll-margin-top:90px"` : ""}>` +
  `<span class="num">${esc(num)}</span><span>${esc(zh)}</span><span class="en">${esc(en)}</span></h2>`;

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
    secTitle("§", "名录与数据依据", "Sources and References") +
    `<div class="refs"><ul>${items.join("")}</ul>` +
    `<p class="note">本页的保护名录、入侵状态与分类信息由 Plantspedia 服务端实时查询 GBIF、GRIIS 中国名录及国家/省级重点保护名录得出，为可核验的结构化数据；正文叙述由 AI 依据上述事实撰写，仍建议编辑校对后收录。本页不含未经核实的新闻引用。</p></div>`
  );
}

export function renderPremiumHtml(
  f: PremiumFields,
  facts: VerifiedFacts,
  assets: {
    heroUrl: string;
    images: RenderPhoto[];
    /** distribution-map.ts 产出的 inline SVG；查不到 GBIF 记录时传 null，整块不渲染。 */
    distributionSvg?: string | null;
    /**
     * 易混近缘种的配图。**必须按近缘种自己的学名单独检索**——它不在本种的候选池里，
     * 而 similar_species 要等第一轮撰稿返回才知道是谁，所以这张图是后补的。
     * 抓不到就传 null，卡片退回单栏（不塞一张本种的照片冒充，那是最坏的误导）。
     */
    similarPhoto?: RenderPhoto | null;
    /**
     * 「最新资讯」允许出现的网址白名单 —— 服务端联网检索**真实返回过**的来源。
     * 模型给的每条新闻都要在这张表里对得上才渲染，对不上一律丢弃。
     */
    newsAllowedUrls?: string[];
  },
  /** 生成时用的创作指导。传了才会在页尾署版本号；null/不传 = 走内置底版，页尾不署。 */
  skill?: GoldSkill | null,
): string {
  const img = (i: number): RenderPhoto | undefined => assets.images[i];
  // 页尾署上本页所依据的创作指导版本 —— 换了 skill 之后哪些页是老版产出，看页尾就知道，
  // 不必去翻数据库。没配 skill（走内置底版）时整行不渲染。
  const sig = skillSignature(skill ?? null);
  const cards = (f.feature_cards ?? []).slice(0, 6);
  const chips = (f.habitat_chips ?? []).slice(0, 7);
  const tabs = (f.ethno_tabs ?? []).slice(0, 5);
  const chapters = (f.curio?.chapters ?? []).slice(0, 5);

  // ── 特征卡少于 6 张时的「落单配图」──────────────────────────────────────────
  //
  // schema 要求**恰好 6 张**，依次对应 根株/茎/叶/花/果实/物候，所以 assets.images[i]
  // 与 feature_cards[i] 是**语义绑定**的。模型只写了 4 张时，下标 4、5 的图已经抓取、
  // 分类、转存、占了 Supabase 存储，却因为 `cards.map` 只跑 4 轮而被**静默丢弃**。
  //
  // 为什么不把它们挪到前面几张卡里：那就是错标 —— 下标 4 是「果实」，塞进标题写着「叶」
  // 的卡里，正是本文件 slot() 注释里反对的那种伤害。
  // 所以单独给一条「补充图像」带，图注**如实写出它是哪个器官**。正常的 6 张卡页面
  // 完全不受影响（下面 orphans 为空，整段不渲染）。
  const FEATURE_SLOT_NAMES: [string, string][] = [
    ["根与株型", "Habit"],
    ["茎", "Stem"],
    ["叶", "Leaf"],
    ["花", "Flower"],
    ["果实与种子", "Fruit & Seed"],
    ["物候与繁殖", "Phenology"],
  ];
  const orphans = FEATURE_SLOT_NAMES.slice(cards.length, 6)
    .map((name, k) => ({ name, photo: img(cards.length + k) }))
    .filter((x) => x.photo?.url);
  const orphanHtml = orphans.length
    ? `<div class="feat-orphans">` +
      `<p class="feat-orphans-note">补充图像 · Additional images` +
      `<span class="en">本页特征卡少于 6 张，以下配图已检索到但没有对应的正文卡片。</span></p>` +
      `<div class="feat-orphan-grid">` +
      orphans
        .map(
          (x) =>
            `<div class="feat-orphan"><div class="feat-orphan-name">${esc(x.name[0])}` +
            `<span class="en">${esc(x.name[1])}</span></div>` +
            `${slot(x.photo, `feat-extra-${esc(x.name[1])}`, `${facts.title} ${x.name[0]}`)}</div>`,
        )
        .join("") +
      `</div></div>`
    : "";

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
  const simPhoto = assets.similarPhoto?.url ? assets.similarPhoto : null;
  const simHtml = sim
    ? `<div class="sim-card${simPhoto ? "" : " no-img"}">` +
      (simPhoto
        ? `<div class="sim-img-col">${slot(simPhoto, "sim-species", `易混近缘种 ${sim.name_zh} ${sim.name_la}`)}</div>`
        : "") +
      `<div class="sim-body"><div class="lbl">易混近缘种 · Similar species</div>` +
      `<div class="nm">${esc(sim.name_zh)}</div><span class="la">${esc(sim.name_la)}</span>` +
      `<p>${escKeepStrong(sim.how_to_tell_zh)}</p><p class="en-p">${escKeepStrong(sim.how_to_tell_en)}</p>` +
      `</div></div>`
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

  // ── Section VI 博物趣闻博客 ────────────────────────────────────────────────
  //
  // 模型按 schema 用**空行分段**，这里拆回多个 <p>。不拆的话 600–900 字会挤成一大坨，
  // 而 plantstory 标准要的正是「一篇能独立成篇的随笔」的那种呼吸感。
  const paras = (body: string) =>
    String(body ?? "")
      .split(/\n\s*\n|\r\n\s*\r\n/)
      .map((s) => s.trim())
      .filter(Boolean)
      .map((s) => `<p>${escKeepStrong(s)}</p>`)
      .join("") || `<p>${escKeepStrong(body)}</p>`;

  const chapterHtml = (c: (typeof chapters)[number]) =>
    `<div class="blog-chapter"><h4>${esc(c.heading_zh)}</h4>` +
    (c.heading_en?.trim() ? `<span class="ch-en">${esc(c.heading_en)}</span>` : "") +
    paras(c.body_zh) +
    `</div>`;

  // 两列分配：左 3 右 2（四合木页同样是 3+2）。图片插在**列内**章节之间 ——
  // 这样图永远跟着它所属的那一列走，不会像多栏流那样被切断在栏边界上。
  const mid = Math.ceil(chapters.length / 2);
  const colA = chapters.slice(0, mid);
  const colB = chapters.slice(mid);
  const blogImg = (i: number, label: string, alt: string) =>
    assets.images[i]?.url ? `<div>${slot(assets.images[i], label, alt)}</div>` : "";

  const blogGrid = chapters.length
    ? `<div class="blog-grid">` +
      `<div class="blog-col">` +
      colA.map((c, i) => chapterHtml(c) + (i === 0 ? blogImg(10, "blog-fun-fact-1", `${facts.title} 博物趣闻配图一`) : "")).join("") +
      `</div>` +
      `<div class="blog-col">` +
      colB.map((c, i) => chapterHtml(c) + (i === 0 ? blogImg(11, "blog-fun-fact-2", `${facts.title} 博物趣闻配图二`) : "")).join("") +
      `</div></div>`
    : "";

  const dq = f.curio?.driving_question_zh?.trim() ?? "";
  const dqEn = f.curio?.driving_question_en?.trim() ?? "";
  const curioHtml =
    `<article class="blog-post">` +
    `<ul class="blog-meta"><li>📅 ${esc(new Date().toISOString().slice(0, 10))}</li>` +
    `<li>✍️ Plantstory skill</li><li>🏷️ 博物学随笔 · Naturalist Essay</li></ul>` +
    (dq ? `<h3 class="blog-title">${esc(dq)}</h3>` : "") +
    (dqEn ? `<p class="blog-subtitle">${esc(dqEn)}</p>` : "") +
    (assets.images[9]?.url
      ? `<div class="blog-cover">${slot(assets.images[9], "blog-cover", `${facts.title} 博物趣闻主图`)}</div>`
      : "") +
    (f.curio?.lead_zh?.trim()
      ? `<div class="blog-intro"><p>${escKeepStrong(f.curio.lead_zh)}</p>` +
        (f.curio.lead_en?.trim() ? `<p class="en-p">${escKeepStrong(f.curio.lead_en)}</p>` : "") +
        `</div>`
      : "") +
    blogGrid +
    `</article>`;

  // 全球分布图。查不到 GBIF 记录时**整块不渲染**，而不是留一张空白世界地图 ——
  // 空地图会被读成「全球都没有」，那是编造出来的信息（见 distribution-map.ts）。
  // 开篇配图下的「博物趣闻」摘要卡。摘要 = 驱动性问题 + 导语（没有导语就退回第一节正文）
  // 的前 90 字，让读者在页首就知道页尾那篇随笔讲的是什么，值不值得跳过去。
  // 没有 Section VI 内容时整卡不渲染 —— 一张点了什么都没有的卡片比没有卡片糟。
  const viTeaserSrc =
    f.curio?.lead_zh?.trim() || String(chapters[0]?.body_zh ?? "").replace(/\s+/g, " ").trim();
  const viTeaser = viTeaserSrc
    .replace(/<\/?strong>/g, "")
    .replace(/\s+/g, " ")
    .slice(0, 92);
  const viCard =
    dq || viTeaser
      ? `<a class="vi-card" href="#section-vi">` +
        `<span class="vi-t">NATURAL HISTORY · 博物趣闻</span>` +
        `<p class="vi-x">${esc(dq)}${dq && viTeaser ? "：" : ""}${esc(viTeaser)}${viTeaser.length >= 92 ? "…" : ""}</p>` +
        (dqEn ? `<p class="vi-e">${esc(dqEn)}</p>` : "") +
        `</a>`
      : "";

  // ── 拉丁学名下面那一行：中文俗名 / 商品名 / 异名 / 另名 ────────────────────
  //
  // 从前只写「中国各地俗名」，而这一行真正该承担的是**读者可能是在哪个名字下认识它的**：
  // 花市的商品名、旧植物志的异名、地方另名，任何一个都可能是他搜进来的那个词。
  // 两个来源合起来去重：`facts.commonNamesZh` 是草稿/名录带过来的（可核实），
  // `f.folk_names_zh` 是模型补的。合并时以前者优先，逐字去重。
  const altNames = (() => {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const raw of [facts.commonNamesZh, f.folk_names_zh]) {
      for (const n of String(raw ?? "").split(/[,，、;；/｜|]+/)) {
        const t = n.trim();
        if (!t || t === facts.title || seen.has(t)) continue;
        seen.add(t);
        out.push(t);
      }
    }
    return out;
  })();
  const altNamesHtml = altNames.length
    ? `<div class="folk"><b>中文俗名 · 商品名 · 异名 · 另名：</b>${esc(altNames.join("、"))}</div>`
    : "";

  const mapHtml = assets.distributionSvg
    ? `<div class="dist-map">${assets.distributionSvg}</div>` +
      `<p class="dist-cap">上图为该种在全球生物多样性信息网络（GBIF）中<strong>带坐标记录</strong>的密度分布，` +
      `由本站在生成本页时实时查询绘制。染色格子表示该处有过采集或观察记录；` +
      `空白只说明当地没有公开记录，不等于该种不分布。</p>`
    : "";

  // ── Section V：五格 + 保护徽章 ─────────────────────────────────────────────
  // 一格一个 `<h4>`，与 四合木 页的 a./b./c./d./e. 逐格对齐。老数据（v21 之前生成的
  // 那几页）没有 a/b/e 三格，缺哪格就不渲染哪格 —— 不留空标题。
  const eeBlock = (
    label: string,
    zh: string | undefined,
    en: string | undefined,
    extra = "",
  ): string =>
    (zh || "").trim()
      ? `<h4>${esc(label)}</h4>${extra}<p>${escKeepStrong(zh)}</p>` +
        ((en || "").trim() ? `<p class="en-p">${escKeepStrong(en)}</p>` : "")
      : extra;

  // 保护徽章：**只画服务端实查到的名录**（IUCN 评级 + conservation 命中），
  // 模型写的正文一个字也不参与。一条都没命中就不画，而不是摆一个「未评估」的空壳。
  const consBadges = [
    ...(facts.iucnStatus
      ? [
          `<span class="conservation-badge"><span class="cb-status">${esc(facts.iucnStatus)}</span>` +
            `<span class="cb-label">IUCN Red List</span></span>`,
        ]
      : []),
    ...facts.conservation.map(
      (c) =>
        `<span class="conservation-badge"><span class="cb-status">${esc(c.label)}</span>` +
        `<span class="cb-label">${esc(c.kind)}</span></span>`,
    ),
  ].join("");
  const consBadgeHtml = consBadges ? `<div class="cons-badges">${consBadges}</div>` : "";

  // ── 最新资讯：链接必须过白名单 ────────────────────────────────────────────
  //
  // 这一块从前是**刻意不做**的（见本文件开头的说明）：本地模型无法联网核实，
  // 强行让它写新闻卡就是逼它编链接。现在能做，是因为链接不再由模型产生 ——
  // 服务端先真的跑一次联网检索、把返回的来源 URL 交给模型挑，渲染前再对一次白名单。
  // 对不上的一律丢弃；一条都不剩就**整块不渲染**（和分布图同一条规矩）。
  const allowed = new Set((assets.newsAllowedUrls ?? []).map((u) => u.trim()).filter(Boolean));
  const newsItems = (f.news ?? []).filter(
    (n) => n?.source_url && allowed.has(n.source_url.trim()) && (n.summary_zh || "").trim(),
  );
  const NEWS_TAGS = new Set(["媒体报道", "地方报道", "科研进展", "保护动态"]);
  // 「最新资讯」在标准页里就是 **Section V**（植物简介不占编号，所以
  // 关键特征=I、典型生境=II、植物人文=III、演化与生态=IV、最新资讯=V、博物趣闻=VI）。
  // v21.1 把它渲染成了一个无编号小块，编号上仍旧是缺的 —— 这里补成正式一节。
  const newsHtml = newsItems.length
    ? secTitle("V", "最新资讯", "Latest Media Reports") +
      `<div class="news-section">` +
      `<div class="news-grid">` +
      newsItems
        .slice(0, 4)
        .map((n) => {
          const meta = [n.source_name?.trim(), n.date?.trim()].filter(Boolean).join(" · ");
          return (
            `<a class="news-card" href="${esc(n.source_url.trim())}" target="_blank" rel="noopener noreferrer nofollow">` +
            `<span class="news-tag">${esc(NEWS_TAGS.has(n.tag) ? n.tag : "媒体报道")}</span>` +
            `<span class="news-summary">${esc(n.summary_zh)}</span>` +
            (meta ? `<span class="news-source">${esc(meta)}</span>` : "") +
            `</a>`
          );
        })
        .join("") +
      `</div><div class="news-footer">本栏只收录本站在生成本页时**联网检索真实返回过**的报道链接；` +
      `模型给出的、不在检索结果里的网址一律丢弃。论文、数据库与植物志资料统一放在上方「名录与数据依据」。</div></div>`
    : "";

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
  <div class="mh-mid">内测期草木志<br/>Plantspedia Vol.I</div>
  <div class="mh-side right"><span class="lbl">属 · Genus</span><span class="zh">${esc(facts.genusZh)}</span><span class="la">${esc(facts.genusLa)}</span></div>
</div>

<header class="hero">
  <div class="tagline"><span class="orn">✦</span>${esc(f.tagline_zh)}<span class="orn">✦</span></div>
  ${f.tagline_en?.trim() ? `<div class="tagline-en">${esc(f.tagline_en)}</div>` : ""}
  <h1>${esc(facts.title)}</h1>
  <div class="en-name">${esc(facts.commonNameEn || "English vernacular name missing")}</div>
  <div class="latin">${esc(facts.scientificName)}</div>
  ${altNamesHtml}
</header>

${secTitle("Intro", "植物简介", "Introduction")}
<div class="intro">
  <div class="intro-img-col">${slot({ url: assets.heroUrl }, "intro-portrait", `${facts.title} 实拍`)}${viCard}</div>
  <div><p>${escKeepStrong(f.intro_zh)}</p><p class="en-p">${escKeepStrong(f.intro_en)}</p></div>
</div>

${secTitle("I", "关键特征", "Key Features")}
<!-- 形态总览 + 特征词 **属于「关键特征」这一节**，不属于「植物简介」。
     从前它们排在 intro 之后、本标题之前，于是在页面上就成了「摘在博物趣闻摘要卡下面
     的一张无主卡片」（用户 2026-07-30 指出）。四合木 页里 .form-overview 同样是
     Section「关键特征」的第一件东西，这里按它归位。 -->
<div class="form-panel">
  <p style="margin:0">${escKeepStrong(f.form_overview_zh)}</p>
  <p class="en-p" style="margin-bottom:0">${escKeepStrong(f.form_overview_en)}</p>
</div>
<div class="chips">${chipHtml}</div>
${featHtml}
${orphanHtml}
${simHtml}

${secTitle("II", "典型生境", "Typical Habitat")}
${slot(img(6), "hab-panorama", `${facts.title} 生境`)}
<div class="chips" style="margin-top:24px">${habChipHtml}</div>
<p>${escKeepStrong(f.habitat_zh)}</p><p class="en-p">${escKeepStrong(f.habitat_en)}</p>

${secTitle("III", "植物人文", "Plant Humanities")}
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

${secTitle("IV", "演化与生态", "Evolution & Ecology")}
<div class="ee-outer">
  <div class="ee-illu-col">
    ${slot(img(12), "ee-ecology", `${facts.title} 生态与群落`)}
  </div>
  <div class="ee-content-col">
    ${
      (f.eco_intro_zh || "").trim()
        ? `<p class="ee-intro-line">${escKeepStrong(f.eco_intro_zh)}${
            (f.eco_intro_en || "").trim() ? ` · ${escKeepStrong(f.eco_intro_en)}` : ""
          }</p>`
        : ""
    }
    ${eeBlock("a. 系统发育 · Phylogeny", f.phylogeny_zh, f.phylogeny_en)}
    ${eeBlock("b. 起源与驯化 · Origin & Domestication", f.origin_domestication_zh, f.origin_domestication_en)}
    ${eeBlock("c. 生态功能 · Ecological Roles", f.eco_function_zh, f.eco_function_en)}
    ${eeBlock("d. 全球分布与入侵 · Global Distribution & Invasion", f.distribution_invasion_zh, f.distribution_invasion_en, mapHtml)}
    ${eeBlock("e. 保护状态 · Conservation Status", f.conservation_status_zh, f.conservation_status_en, "")}
    ${consBadgeHtml}
  </div>
</div>

${renderReferences(facts)}

${newsHtml}

${secTitle("VI", "博物趣闻博客", "Plant Natural History Fun Facts Blog", "section-vi")}
${curioHtml}

<footer class="colophon">
  <div class="col-cells">
    <div class="col-cell">
      <span class="col-label-zh">编 纂</span><span class="col-role-en">Editor</span>
      <hr class="col-divider"/>
      <span class="col-name-zh">金叶编辑</span><span class="col-name-en">AI Copilot</span>
    </div>
    <div class="col-cell">
      <span class="col-label-zh">出 品</span><span class="col-role-en">Published by</span>
      <hr class="col-divider"/>
      <span class="col-name-zh">鄂尔多斯植物精选百科</span><span class="col-name-en">Ordos Plantspedia</span>
    </div>
    <div class="col-cell">
      <span class="col-label-zh">创作指导</span><span class="col-role-en">Skill Version</span>
      <hr class="col-divider"/>
      <span class="col-name-zh">${sig ? esc(sig) : "内置底版"}</span>
      <span class="col-name-en">${esc(facts.scientificName)}</span>
    </div>
  </div>
  <hr class="col-bottom-rule"/>
  <p class="col-note">内容由 AI 依据已核实名录数据撰写，建议编辑校对后收录</p>
</footer>

</div></body></html>`;
}
