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

  const curio = fields.curio as { chapters?: unknown } | undefined;
  const chapters = Array.isArray(curio?.chapters) ? curio.chapters : [];
  if (!chapters.length)
    issues.push({ field: "curio", level: "warn", message: "博物趣闻一节是空的" });

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
