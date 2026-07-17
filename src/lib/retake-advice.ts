/**
 * 补拍建议：只保留「拍得到」的动作。
 *
 * 用户唯一能回传的是照片，所以「摸一摸叶子的质感」「闻闻有没有薄荷味」这类建议是死路 ——
 * 照做了结果也传不过来，只是让人白跑一趟。identify 的 prompt 已经明令禁止，但模型偶尔照旧
 * 会写，且**库里已有的旧草稿仍存着这类文案** → 生成端（normalizeIdentification）和展示端
 * （补拍横幅 / /identify 的建议框）都过一遍这里，两头同源。
 */

/** 命中即视为非视觉建议。
 *  `尝(?!试)`：「尝试换个角度拍」是正当的视觉建议，只有「尝味道」才该丢。
 *  `闻(?!名)` 同理防「闻名」。`feel/texture` 等英文词较泛，只在英文建议里出现，可接受。 */
const NON_VISUAL_RE =
  /摸|闻(?!名)|嗅|尝(?!试)|搓|揉|捏|掐|折断|掰|气味|味道|手感|质感|触感|touch|smell|sniff|scent|odou?r|taste|rub|crush|feel|texture/i;

/** 模型漏填、或建议整批被滤空时的通用引导（全部是拍得到的动作）。 */
export const DEFAULT_VISUAL_ADVICE =
  "① 凑近拍一朵完整的花，正面拍清花瓣数量和形状；② 把叶子翻过来拍背面（看清叶脉和有没有细毛）；③ 退后一步拍整棵植物的样子（看清高矮和分枝）；④ 有果实或种子的话也拍一张。";

/**
 * 把建议按 ①②③ / 换行 拆条，整条丢掉非视觉的那几条，再拼回去。
 * 全被丢掉（或本来就空）→ 返回空串，由调用方决定是补默认文案还是隐藏。
 */
export function keepVisualAdvice(text: string | null | undefined): string {
  const raw = (text || "").toString().trim();
  if (!raw) return "";
  // 拆条时保留 ①②③ 前缀（lookahead 不吃掉分隔符）；条内的分号不算分隔符。
  const items = raw
    .split(/\n+|(?=[①②③④⑤⑥⑦⑧⑨⑩])/)
    .map((s) => s.trim())
    .filter(Boolean);
  // 没编号、写成一整段 → 拆不开，只能整段判：命中才丢，否则原样留。
  if (items.length <= 1) return NON_VISUAL_RE.test(raw) ? "" : raw;
  const kept = items.filter((s) => !NON_VISUAL_RE.test(s));
  // 删掉中间几条后必须重编号：留下「① …；④ …」这种带窟窿的序号，看着像出了 bug。
  return (
    kept
      .map((s, i) => s.replace(/^[①②③④⑤⑥⑦⑧⑨⑩]\s*/, `${CIRCLED[i] ?? "·"} `))
      .join("")
      .trim()
      // 丢掉末条后，前一条的分隔符会孤零零留在结尾（「…拍整株；」）——一并收掉。
      .replace(/[；;、，,]\s*$/, "")
  );
}

const CIRCLED = ["①", "②", "③", "④", "⑤", "⑥", "⑦", "⑧", "⑨", "⑩"];

/** 展示端用：滤完为空就退回通用引导，绝不让补拍横幅因为「建议被滤没了」而消失。 */
export function visualAdviceOrDefault(text: string | null | undefined): string {
  return keepVisualAdvice(text) || DEFAULT_VISUAL_ADVICE;
}
