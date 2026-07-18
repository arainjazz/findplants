/**
 * 清掉 AI 写进结构化字段和正文里的 markdown 残留。
 *
 * 模型被要求输出 JSON / HTML，但它habitually 把拉丁名写成 markdown 斜体
 * （`*Allium tuberosum*`）。这些字段随后被当**纯文本**渲染——草稿页标题、物种详情页、
 * 以及画在 canvas 上的识别分享卡——于是星号原样印出去，还会被转发到微信/小红书。
 *
 * 两种处理方式，取决于目标是纯文本还是 HTML：
 *  - 字段（学名/属/科/俗名/摘要）→ `stripNameMarkdown`：直接去掉星号。
 *  - 正文 HTML → `italicizeLatinMarkdown`：转成 <em>，因为拉丁名**本来就该**是斜体。
 *
 * 实测（2026-07-17，43 份草稿 + 236 份物种）：这些字段里唯一的 markdown 字符就是 `*`，
 * 没有 `_` 和反引号；括号必须留着——那是合法的命名人引用（`(L.) G. Don`、`南瓜属 (Cucurbita)`）。
 */

/** 纯文本字段：去掉 markdown 星号，并收掉因此产生的多余空格。 */
export function stripNameMarkdown(s: string | null | undefined): string {
  return (s || "")
    .toString()
    .replace(/\*/g, "")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

/** 对象上就地清洗若干纯文本字段。返回同一个对象，方便链式使用。 */
export function stripNameMarkdownFields<T extends Record<string, unknown>>(
  obj: T,
  fields: readonly string[],
): T {
  for (const f of fields) {
    const v = obj[f];
    if (typeof v === "string" && v.includes("*")) {
      (obj as Record<string, unknown>)[f] = stripNameMarkdown(v);
    }
  }
  return obj;
}

/** AI 会把 markdown 塞进来的那几个纯文本字段（AiMeta 与 plant_drafts 列同名）。 */
export const AI_TEXT_FIELDS = [
  "title",
  "scientific_name",
  "family",
  "genus",
  "common_name_en",
  "common_names_zh",
  "summary_zh",
  "summary_en",
] as const;

/**
 * 正文 HTML：`*Ficus lyrata*` → `<em>Ficus lyrata</em>`。
 *
 * 正则**故意收得很紧**，因为 HTML 里的 `*` 未必都是 markdown——CSS 的通配选择器
 * （`* { box-sizing }`、`*::before`、`*, *::before`）也是星号。所以只认「星号后面紧跟
 * 大写字母开头的拉丁名、且成对闭合」：
 *  - 起首必须是 [A-Z] → 排除 `* {`、`*,`、`*::`（后面是空格/逗号/冒号）。
 *  - 字符类不含 `<` `>` → 不会跨标签吞掉结构。
 *  - 非贪婪 + 长度上限 → 不会把整段正文吞进一个 <em>。
 */
export function italicizeLatinMarkdown(html: string | null | undefined): string {
  return (html || "").toString().replace(/\*([A-Z][A-Za-z.×·\s-]{1,60}?)\*/g, "<em>$1</em>");
}
