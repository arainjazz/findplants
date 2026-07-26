/**
 * 「快速识别简介卡」的可编辑字段 —— 客户端与服务端共用的约定。
 *
 * 简介卡（草稿页顶部那张：科属 / 中文名 / 学名 / 俗名 / 摘要）**不在 html_content 里**，
 * 它是 React 直接读 plant_drafts 的列渲染出来的。所以：
 *   · 小P蛙的「讨论范围（标注）」原来只列 html_content 里的小标题，简介卡根本不在选项里；
 *   · 小P蛙的改写走的是「重写整份 HTML」，对简介卡一个字也改不动。
 * 这个模块给这块内容一个显式的 scope 名字和字段清单，让编辑手改、小P蛙改写走同一套列。
 *
 * 依赖必须为零：identify-plant.functions.ts（服务端）与草稿页（客户端）都要 import 它。
 */

/** 小P蛙「讨论范围」里代表简介卡的 scope 值。服务端据此切到「改列」而不是「改 HTML」。 */
export const DRAFT_CARD_SCOPE = "快速识别简介卡";

export type DraftCardFields = {
  title: string;
  scientific_name: string;
  common_names_zh: string;
  common_name_en: string;
  family: string;
  genus: string;
  summary: string;
};

export const DRAFT_CARD_FIELD_LABELS: Record<keyof DraftCardFields, string> = {
  title: "中文名（标题）",
  scientific_name: "拉丁学名",
  common_names_zh: "中文俗名 / 商品名",
  common_name_en: "英文俗名",
  family: "科",
  genus: "属",
  summary: "摘要 · Summary",
};

export const DRAFT_CARD_FIELD_KEYS = Object.keys(DRAFT_CARD_FIELD_LABELS) as (keyof DraftCardFields)[];

/** 摘要是长文本（多行输入框），其余都是单行。 */
export const DRAFT_CARD_LONG_FIELDS: (keyof DraftCardFields)[] = ["summary"];

/** 把一行草稿数据收成简介卡字段（缺列一律空字符串，便于比较与写库）。 */
export function pickDraftCardFields(row: Partial<Record<keyof DraftCardFields, unknown>>): DraftCardFields {
  const s = (v: unknown) => (typeof v === "string" ? v : v == null ? "" : String(v));
  return {
    title: s(row.title),
    scientific_name: s(row.scientific_name),
    common_names_zh: s(row.common_names_zh),
    common_name_en: s(row.common_name_en),
    family: s(row.family),
    genus: s(row.genus),
    summary: s(row.summary),
  };
}

/** 喂给模型的简介卡快照（也用来写「修改记录」的摘要）。 */
export function draftCardToText(f: DraftCardFields): string {
  return DRAFT_CARD_FIELD_KEYS.map((k) => `${DRAFT_CARD_FIELD_LABELS[k]}：${f[k] || "（空）"}`).join(
    "\n",
  );
}

/** 逐字段比对，返回「字段：旧 → 新」的中文清单（无改动则为空数组）。 */
export function diffDraftCard(before: DraftCardFields, after: DraftCardFields): string[] {
  return DRAFT_CARD_FIELD_KEYS.filter((k) => (before[k] || "") !== (after[k] || "")).map(
    (k) => `${DRAFT_CARD_FIELD_LABELS[k]}：「${before[k] || "空"}」→「${after[k] || "空"}」`,
  );
}
