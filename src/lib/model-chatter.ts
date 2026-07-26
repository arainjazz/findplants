// ─── 模型闲聊 / 复读机的字段级消毒 ────────────────────────────────────────────
//
// 起因（2026-07-25 线上）：一次补拍识别的结果里出现了这样的正文——
//   「…。状态：已完成识别与撰写。返回：JSON 格式数据。结束：任务完成。请查收。
//     如有其他需求，请随时告知。祝您生活愉快！再见！。注：以上内容为模拟回复，
//     实际回复请参考JSON块。谢谢！。再见！。祝好！。再见！。祝好！」
//
// 这不是解析出错——JSON **解析成功了**，闲聊是模型写在字符串字段**内部**的。
// 所以 cleanJson 再怎么加固也拦不住，必须在解析之后做字段级消毒。
//
// 两种病症，两种治法：
//   ① **元话语**：模型跳出角色开始播报「任务完成、请查收」。→ 在标记处截断。
//   ② **复读机**：温度 0 的贪心解码陷进循环，同一句话反复吐。→ 检测并截断。
//
// **刻意不做「像不像闲聊」的通用启发式**：误伤一段正常的科普导语，比漏掉一次闲聊更糟
// （前者天天发生，后者偶尔发生）。所以标记词表保持短、且都足够刺眼——正常的植物科普
// 文案里不会出现「以上内容为模拟回复」。

/**
 * 元话语标记。命中即**从该处截断**（连同标记本身一起丢掉）。
 *
 * 选词标准：必须是植物科普正文里**不可能**出现的措辞。像「结果」「说明」这种
 * 日常词一律不收——「结果表明该种耐旱」是完全正常的句子。
 */
const CHATTER_MARKERS = [
  "以上内容为模拟回复",
  "实际回复请参考",
  "请参考JSON",
  "参考JSON块",
  "返回：JSON",
  "返回:JSON",
  "JSON 格式数据",
  "JSON格式数据",
  "状态：已完成",
  "状态:已完成",
  "任务完成",
  "如有其他需求",
  "请随时告知",
  "祝您生活愉快",
  "祝你生活愉快",
  "祝好",
  "请查收",
  "再见！",
  "再见!",
];

/** 句子切分用的终止标点。保留标点本身，便于原样拼回。 */
const SENTENCE_SPLIT = /(?<=[。！？!?\n])/;

/**
 * 砍掉第一个元话语标记及其之后的一切。
 * 没命中任何标记时原样返回。
 */
function cutAtChatterMarker(s: string): string {
  let cut = s.length;
  for (const m of CHATTER_MARKERS) {
    const i = s.indexOf(m);
    if (i >= 0 && i < cut) cut = i;
  }
  return cut === s.length ? s : s.slice(0, cut);
}

/**
 * 复读机检测：同一个短句连续/反复出现 ≥3 次时，从它的**第 2 次**出现处截断。
 *
 * 只对 ≤ 40 字的句子生效。一段 150–260 字的导语里逐字重复三遍同一句，只可能是
 * 贪心解码陷进了循环；而更长的整段雷同更可能是模型在做结构性复述（或本就是引文），
 * 砍掉风险更大，留给人工处理。
 */
function cutAtRepetition(s: string): string {
  const parts = s.split(SENTENCE_SPLIT).filter((p) => p.length > 0);
  const seen = new Map<string, number[]>(); // 归一化句子 → 它每次出现的起始下标
  let offset = 0;
  for (const p of parts) {
    const key = p.trim().replace(/[\s。！？!?、，,]/g, "");
    if (key && key.length <= 40) {
      const hits = seen.get(key) ?? [];
      hits.push(offset);
      seen.set(key, hits);
      // 第 3 次出现 → 认定为复读，回到第 2 次出现的位置切断
      if (hits.length >= 3) return s.slice(0, hits[1]);
    }
    offset += p.length;
  }
  return s;
}

/**
 * 给用户可见的长文本字段消毒。返回**可能为空字符串**——调用方要准备好兜底文案，
 * 因为「整段都是闲聊」是真实会发生的情况。
 */
export function stripModelChatter(s: string | null | undefined): string {
  if (!s) return "";
  return cutAtRepetition(cutAtChatterMarker(String(s)))
    // 截断处常留下半截标点/连接词
    .replace(/[\s，,、；;：:。！？!?]+$/, "")
    .trim();
}

/** 这段文本是不是**整个**都是闲聊（消毒后什么也不剩）。 */
export function isAllChatter(s: string | null | undefined): boolean {
  return !!(s || "").toString().trim() && stripModelChatter(s) === "";
}
