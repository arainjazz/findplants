/**
 * 落库前的**质量闸门**。
 *
 * 起因：在此之前，只要模型返回的 JSON 能 parse 就落库、扣叶、`submitted_for_review=true`。
 * 于是一次退化的生成（模型被截断、字段大面积留空、中英只写了一半）照样收用户一枚叶子，
 * 而用户拿到的是半成品。2026-07-20 的 `deepseek-v4-flash` 事故（看不见图却编出一个物种、
 * HTTP 200）能一路走到发布，正是因为这条链路上没有任何一处在问「这东西对不对」。
 *
 * 本模块只做**廉价的结构性检查**，不调模型：
 *  - 必填字段在不在、够不够长；
 *  - 中英是否成对（我们承诺的是双语页面）；
 *  - 有没有明显的截断痕迹。
 * 它**不判断内容真假** —— 那是反虚构协议和联网调研的职责，这里只拦「明显残次品」。
 *
 * 纯函数、无网络无数据库 —— `scratch/quality-gate.test.mjs` 直接跑本体。
 */

export type GateIssue = {
  field: string;
  /** `fatal` = 不该落库；`warn` = 记日志但放行。 */
  level: "fatal" | "warn";
  message: string;
};

export type GateResult = {
  ok: boolean;
  issues: GateIssue[];
  /** 给用户看的一句话（ok 时为空）。 */
  summary: string;
};

const len = (v: unknown): number => String(v ?? "").trim().length;

/**
 * 截断痕迹：JSON 能 parse 但正文本身被切在半截。
 * 判据保守 —— 只认「结尾没有任何终止标点」这种明显情况，免得误伤正常的短句。
 */
function looksTruncated(v: unknown): boolean {
  const s = String(v ?? "").trim();
  if (s.length < 80) return false; // 太短的字段本来就可能没有句号
  return !/[。！？.!?」』）)\]】…]$/.test(s);
}

type FieldSpec = {
  key: string;
  /** 中文字段的最低字数。低于它就算没写。 */
  min: number;
  label: string;
  /** 对应的英文字段名；给了就一并检查是否成对。 */
  en?: string;
};

/** 草稿正文的必备字段。阈值取「明显偏少」的量级，不是内容标准。 */
const DRAFT_FIELDS: FieldSpec[] = [
  { key: "summary_zh", min: 60, label: "开篇导语", en: "summary_en" },
  { key: "morphology_zh", min: 120, label: "形态描述", en: "morphology_en" },
  { key: "habitat_zh", min: 100, label: "生境与分布", en: "habitat_en" },
  { key: "name_origin_zh", min: 80, label: "名称和分类趣闻", en: "name_origin_en" },
  { key: "culture_zh", min: 120, label: "植物人文", en: "culture_en" },
];

/**
 * 检查一份「进一步生成草稿」的产出能不能落库收费。
 *
 * **判 fatal 的只有两类**：核心正文（形态 / 生境）缺失或过短，以及超过一半的字段不合格。
 * 单个次要字段偏短只记 warn —— 闸门太严会把「稍逊但可用」的草稿也毙掉，
 * 用户重试一次同样要烧 token，反而更糟。
 */
export function checkDraftQuality(meta: Record<string, unknown> | null | undefined): GateResult {
  const issues: GateIssue[] = [];
  if (!meta || typeof meta !== "object") {
    return {
      ok: false,
      issues: [{ field: "*", level: "fatal", message: "模型没有返回任何内容" }],
      summary: "生成失败：模型没有返回任何内容。已取消本次生成，未扣除叶子。",
    };
  }

  for (const f of DRAFT_FIELDS) {
    const n = len(meta[f.key]);
    // 形态与生境是一份物种资料的骨架，缺了就不叫草稿。其余字段偏短只警告。
    const core = f.key === "morphology_zh" || f.key === "habitat_zh";
    if (n === 0) {
      issues.push({
        field: f.key,
        level: core ? "fatal" : "warn",
        message: `${f.label}是空的`,
      });
    } else if (n < f.min) {
      issues.push({
        field: f.key,
        level: core ? "fatal" : "warn",
        message: `${f.label}只有 ${n} 字（至少 ${f.min} 字）`,
      });
    } else if (looksTruncated(meta[f.key])) {
      issues.push({
        field: f.key,
        level: "warn",
        message: `${f.label}结尾没有标点，疑似被截断`,
      });
    }
    // 双语是本站对读者的承诺；中文写了英文没写 = 半成品。
    if (f.en && n > 0 && len(meta[f.en]) === 0) {
      issues.push({ field: f.en, level: "warn", message: `${f.label}缺英文对照` });
    }
  }

  // 单项都不致命、但**大面积偏短**同样是残次品 —— 用总量兜住这种情况。
  const badCount = issues.filter((i) => i.field.endsWith("_zh")).length;
  if (badCount > DRAFT_FIELDS.length / 2) {
    issues.push({
      field: "*",
      level: "fatal",
      message: `${badCount}/${DRAFT_FIELDS.length} 个正文分区不合格，整体像是被截断的生成`,
    });
  }

  const fatal = issues.filter((i) => i.level === "fatal");
  return {
    ok: fatal.length === 0,
    issues,
    summary: fatal.length
      ? `生成的草稿不完整（${fatal.map((i) => i.message).join("；")}）。` +
        `已取消本次生成、**未扣除叶子**，请重试；反复出现请在管理后台换一个更强的草稿生成模型。`
      : "",
  };
}

/** 金叶详页的必备字段（三轮撰稿合并后的结果）。 */
const GOLD_REQUIRED: FieldSpec[] = [
  { key: "intro_zh", min: 120, label: "开篇导语", en: "intro_en" },
  { key: "form_overview_zh", min: 60, label: "株型总览", en: "form_overview_en" },
  { key: "habitat_zh", min: 100, label: "生境正文", en: "habitat_en" },
  { key: "eco_function_zh", min: 80, label: "生态功能", en: "eco_function_en" },
  { key: "distribution_invasion_zh", min: 80, label: "分布与入侵", en: "distribution_invasion_en" },
];

/**
 * Section V 新增的三格（系统发育 / 起源与驯化 / 保护状态）+ 那句总起。
 *
 * **只记 warn，不判 fatal**：它们是 v21 之后才加进 schema 的，为它们把整页毙掉、
 * 让用户白等一轮并重烧一次 token，代价与收益不成比例。缺了页面照样成立
 * （渲染器缺哪格就不画哪格），但日志里必须留下痕迹，否则模型悄悄不写就没人发现。
 */
const GOLD_SECTION_V: FieldSpec[] = [
  { key: "eco_intro_zh", min: 25, label: "演化与生态·总起句", en: "eco_intro_en" },
  { key: "phylogeny_zh", min: 90, label: "系统发育", en: "phylogeny_en" },
  { key: "origin_domestication_zh", min: 80, label: "起源与驯化", en: "origin_domestication_en" },
  { key: "conservation_status_zh", min: 60, label: "保护状态", en: "conservation_status_en" },
];

/**
 * plantstory skill 的五道门里**机器数得出来**的那几道，落到金叶的 Section VI 上。
 *
 * 只记 warn：这些是文风指标，值不值得为它重跑一轮（再烧一次 token、再等五分钟）
 * 应该由人来判断。但**必须报出来** —— 2026-07-30 那次实测直角引号用了 27 个
 * （标准是 <20），闸门一声不吭，是事后人工数出来的。数得出来的事就不该靠人数。
 *
 * 有意不做的两道：
 * · G1 库名原文里那些**中文**库名（「植物智」「央视」）会误伤正常叙事，只查英文原文；
 * · 小标题是不是「说明文栏目名」需要语义判断，词表匹配误杀率太高，交给 prompt 管。
 */
function checkPlantstoryGates(
  curio: { lead_zh?: unknown; driving_question_zh?: unknown } | undefined,
  chapters: unknown[],
): GateIssue[] {
  const out: GateIssue[] = [];
  const narrative = [
    String(curio?.lead_zh ?? ""),
    ...chapters.map((c) => String((c as { body_zh?: unknown })?.body_zh ?? "")),
  ].join("\n");
  if (!narrative.trim()) return out;

  // G2 破折号：预算 2（大标题 1 + 收尾 1）。
  const dashes = (narrative.match(/——/g) ?? []).length;
  if (dashes > 2)
    out.push({
      field: "curio",
      level: "warn",
      message: `博物趣闻用了 ${dashes} 处破折号「——」（预算 ≤2）`,
    });

  // G4 引号密度：直角引号计**对**（成对出现，所以数左引号）。
  const quotes = (narrative.match(/「/g) ?? []).length;
  if (quotes >= 20)
    out.push({
      field: "curio",
      level: "warn",
      message: `博物趣闻用了 ${quotes} 对直角引号「」（标准 <20）`,
    });

  // G3 连续 5+ 英文单词：中文叙事里整句英文是引外文期刊名留下的疤。
  const engRuns = narrative.match(/(?:[A-Za-z][A-Za-z'’-]*(?:\s+|$)){5,}/g) ?? [];
  if (engRuns.length)
    out.push({
      field: "curio",
      level: "warn",
      message: `博物趣闻有 ${engRuns.length} 处连续 5 个以上英文单词（如「${(engRuns[0] ?? "").trim().slice(0, 40)}」）`,
    });

  // G1 来源词：只查**英文原文**的库名/站名，中文表述是允许的。
  const SOURCE_WORDS = [
    "Wikipedia", "PubMed", "PMC", "Frontiers", "MDPI", "ResearchGate", "ScienceDirect",
    "GBIF", "POWO", "Kew", "eFloras", "Flora of China", "USDA", "iNaturalist",
  ];
  const hits = SOURCE_WORDS.filter((w) => narrative.includes(w));
  if (hits.length)
    out.push({
      field: "curio",
      level: "warn",
      message: `博物趣闻叙事里出现了库名原文：${hits.join("、")}（应改用中文表述）`,
    });

  // G5 驱动性问题必须真的是个问句。
  const dq = String(curio?.driving_question_zh ?? "").trim();
  if (dq && !/[?？]$/.test(dq))
    out.push({
      field: "curio.driving_question_zh",
      level: "warn",
      message: "驱动性问题不是问句（结尾没有问号）",
    });

  return out;
}

/**
 * 金叶详页的闸门。比草稿严一档 —— 它要收一枚**金叶**，且会直接落进 `plants` 公开档案。
 * 除了正文字段，还检查两个结构性承诺：恰好 6 张特征卡、博物趣闻有内容。
 */
export function checkGoldQuality(fields: Record<string, unknown> | null | undefined): GateResult {
  const issues: GateIssue[] = [];
  if (!fields || typeof fields !== "object") {
    return {
      ok: false,
      issues: [{ field: "*", level: "fatal", message: "模型没有返回任何内容" }],
      summary: "创建失败：模型没有返回任何内容。已取消本次创建，未扣除金叶。",
    };
  }

  for (const f of GOLD_REQUIRED) {
    const n = len(fields[f.key]);
    if (n === 0) issues.push({ field: f.key, level: "fatal", message: `${f.label}是空的` });
    else if (n < f.min)
      issues.push({
        field: f.key,
        level: "fatal",
        message: `${f.label}只有 ${n} 字（至少 ${f.min} 字）`,
      });
    else if (looksTruncated(fields[f.key]))
      issues.push({ field: f.key, level: "warn", message: `${f.label}疑似被截断` });
    if (f.en && n > 0 && len(fields[f.en]) === 0)
      issues.push({ field: f.en, level: "warn", message: `${f.label}缺英文对照` });
  }

  for (const f of GOLD_SECTION_V) {
    const n = len(fields[f.key]);
    if (n === 0) issues.push({ field: f.key, level: "warn", message: `${f.label}是空的（本格不渲染）` });
    else if (n < f.min)
      issues.push({ field: f.key, level: "warn", message: `${f.label}只有 ${n} 字（建议 ${f.min} 字以上）` });
  }

  // 版面写死了 6 张特征卡的位置，少于 3 张页面会明显残缺。
  const cards = Array.isArray(fields.feature_cards) ? fields.feature_cards : [];
  if (cards.length < 3)
    issues.push({
      field: "feature_cards",
      level: "fatal",
      message: `只生成了 ${cards.length} 张特征卡（应为 6 张）`,
    });
  else if (cards.length < 6)
    issues.push({
      field: "feature_cards",
      level: "warn",
      message: `只生成了 ${cards.length} 张特征卡（应为 6 张）`,
    });

  // 博物趣闻（Section VI）。它自 2026-07-30 起**独占一轮撰稿**，标准是 plantstory 的
  // 长随笔（5 节 × 600–900 字）。这里只拦真正的残次品：整节空掉是 fatal，
  // 章节偏少 / 正文明显偏短是 warn —— 内容深浅是编辑该判断的事，不该由闸门代劳。
  const curio = fields.curio as { chapters?: unknown; lead_zh?: unknown } | undefined;
  const chapters = Array.isArray(curio?.chapters) ? curio.chapters : [];
  if (!chapters.length) {
    issues.push({ field: "curio", level: "fatal", message: "博物趣闻一节是空的" });
  } else {
    if (chapters.length < 5)
      issues.push({
        field: "curio.chapters",
        level: "warn",
        message: `博物趣闻只有 ${chapters.length} 节（应为 5 节）`,
      });
    // 阈值 450 是从实测校准来的：2026-07-30 首次 v21 产出每节 330–375 字，
    // 结构全对但密度只有标准的一半，而当时 300 字的阈值一条都没报 —— 闸门比问题还松，
    // 等于没有。450 卡在「明显偏短」与「合格下限 600」之间，能把这一档捞出来。
    const short = chapters.filter(
      (c) => len((c as { body_zh?: unknown })?.body_zh) < 450,
    ).length;
    if (short)
      issues.push({
        field: "curio.chapters",
        level: "warn",
        message: `博物趣闻有 ${short} 节正文不足 450 字（硬性下限 600、目标 700–900）`,
      });
    if (len(curio?.lead_zh) === 0)
      issues.push({ field: "curio.lead_zh", level: "warn", message: "博物趣闻缺导语" });
    else if (len(curio?.lead_zh) > 350)
      // plantstory 的「钩子过载」判据：导语超过 350 字就是把整篇卖点一次塞满了。
      issues.push({
        field: "curio.lead_zh",
        level: "warn",
        message: `博物趣闻导语 ${len(curio?.lead_zh)} 字（目标 180–280，超过 350 判为钩子过载）`,
      });
    issues.push(...checkPlantstoryGates(curio, chapters));
  }

  const fatal = issues.filter((i) => i.level === "fatal");
  return {
    ok: fatal.length === 0,
    issues,
    summary: fatal.length
      ? `生成的详页不完整（${fatal.map((i) => i.message).join("；")}）。` +
        `已取消本次创建、**未扣除金叶**，请重试；反复出现请在管理后台的「小P蛙模型」控制台` +
        `把序列 1 换成长文能力更强的模型（详页由该控制台驱动）。`
      : "",
  };
}

/** 把 issues 压成一行日志。 */
export function describeIssues(r: GateResult): string {
  if (!r.issues.length) return "全部通过";
  return r.issues.map((i) => `[${i.level}] ${i.field}: ${i.message}`).join(" | ");
}
