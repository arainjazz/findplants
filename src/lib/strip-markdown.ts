/**
 * 清掉 AI 写进结构化字段的 markdown 残留。
 *
 * 模型经常把学名写成 `*Allium tuberosum*`、属名写成 `葱属 *Allium*` —— 这些字段是当**纯文本**
 * 渲染的（分享卡 canvas、页面 <p>），星号会原样露出来。而正文 html_content 里的 `*Latin*`
 * 本意就是斜体，那里该转成 <em> 而不是删掉。所以分两个函数，别混用。
 *
 * 只针对成对的 markdown 强调符（* _），不碰单独出现的星号（× 杂交号、脚注 * 之类另说）。
 */

/** 结构化文本字段用：去掉成对的 * / _ 强调标记，保留里面的文字。也顺手压掉行首列表符号。 */
export function stripInlineMarkdown(s: string | null | undefined): string {
  if (!s) return "";
  return (
    String(s)
      // **bold** / *italic* / __x__ / _x_ —— 去符号留内容（非贪婪，避免跨整行吞掉）
      .replace(/(\*\*|\*|__|_)(?=\S)(.+?)(?<=\S)\1/g, "$2")
      // 收尾：清掉配不成对、孤零零剩下的 * _ `（例如模型只写了半边）
      .replace(/[*_`]/g, "")
      .trim()
  );
}

/** 一次清洗一个 AiMeta 的所有纯文本字段（就地改，返回同一对象方便链式）。 */
export function stripMetaMarkdown<
  T extends {
    title?: string | null;
    scientific_name?: string | null;
    family?: string | null;
    genus?: string | null;
    common_name_en?: string | null;
    common_names_zh?: string | null;
    summary_zh?: string | null;
    summary_en?: string | null;
  },
>(meta: T): T {
  const clean = (v: string | null | undefined) => (v == null ? v : stripInlineMarkdown(v));
  if (meta.title != null) meta.title = clean(meta.title) as T["title"];
  if (meta.scientific_name != null) meta.scientific_name = clean(meta.scientific_name);
  if (meta.family != null) meta.family = clean(meta.family);
  if (meta.genus != null) meta.genus = clean(meta.genus);
  if (meta.common_name_en != null) meta.common_name_en = clean(meta.common_name_en);
  if (meta.common_names_zh != null) meta.common_names_zh = clean(meta.common_names_zh);
  if (meta.summary_zh != null) meta.summary_zh = clean(meta.summary_zh);
  if (meta.summary_en != null) meta.summary_en = clean(meta.summary_en);
  return meta;
}

/**
 * 正文 HTML 用：把 `*Ficus lyrata*` 这类 markdown 斜体转成 <em>…</em>（拉丁名本就该斜体）。
 * 只转成对的单星号强调，且内容不含 < > *（不跨标签、不吞多段），避免误伤 HTML 结构。
 */
export function markdownEmphasisToHtml(html: string | null | undefined): string {
  if (!html) return "";
  return String(html).replace(/\*(?=\S)([^*<>\n]{1,80}?)(?<=\S)\*/g, "<em>$1</em>");
}
