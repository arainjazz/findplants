// ─── 「疑似」判定与命名 ────────────────────────────────────────────────────────
// 识别结果分「确诊」和「疑似」两档，这个差别要同时体现在**三个地方**：
// 草稿标题、摘要正文、摘要卡上的大标题。三处一旦各写各的判据就会自相矛盾
// （正文写着「疑似……」、标题却光秃秃一个物种名），所以判据和拼名都收在这里。
//
// 单独成文件是为了能被直接测试：识别链路要模型调用 + 登录才跑得起来，
// 而这几个函数是纯的，抽出来就能脱离整条链路验证。

/** 匹配开头的「疑似」/「（疑似）」前缀。 */
export const TENTATIVE_RE = /^\s*（?\s*疑似\s*）?/;

/**
 * 匹配**结尾**的「（疑似）」/「(疑似)」/「疑似」。
 *
 * 模型标存疑的位置并不统一：prompt 要求写成前缀，但它经常改写在名字后面
 * （「长刚毛草（疑似）」）。只剥前缀的话，`draftTitleFor` 会在前面再加一个，
 * 拼出用户实际看到的「疑似长刚毛草（疑似）」。
 *
 * ⚠️ **只能用在名称类字段上**。正文里「目前只能算疑似」这类句子结尾的「疑似」是正常表达，
 * 剥掉会把话说反 —— 所以 summary 一律只用 `stripTentativePrefix`。
 */
export const TENTATIVE_SUFFIX_RE = /(?:[（(]?\s*疑似\s*[)）]?\s*)+$/;

export function stripTentativePrefix(s: string): string {
  return (s || "").replace(TENTATIVE_RE, "").trim();
}

/**
 * 名称字段专用：把**两端**的「疑似」标记全部剥掉（可能重复出现）。
 * 循环到不再变化为止，「（疑似）疑似X（疑似）」这种也能收干净。
 */
export function stripTentativeMarks(s: string): string {
  let out = (s || "").trim();
  for (;;) {
    const next = out.replace(TENTATIVE_RE, "").replace(TENTATIVE_SUFFIX_RE, "").trim();
    if (next === out) return out;
    out = next;
  }
}

/**
 * 物种名的「形状闸门」。
 *
 * 起因（2026-07-25 线上）：模型退化成复读机，把一整段元话语塞进了 `title` ——
 * 「长刚毛草（疑似）。地点：内蒙古…。状态：已完成识别与撰写。返回：JSON 格式数据。…
 * 祝好！再见！」约 137 字，从原来那个 `.slice(0, 200)` 底下大摇大摆走了过去，
 * 直接落进数据库的 title 列，草稿卡/列表/分享卡全都照着渲染。
 *
 * 闸门逻辑：**一个物种名里不可能出现句末标点**。所以在第一个 `。！？；：` 或换行处截断，
 * 剩下的再按 60 字封顶（够放「中文名 + 学名 + 命名人」，远小于任何一段闲聊）。
 * 这比「检测像不像闲聊」的启发式可靠得多 —— 它不猜模型想说什么，只认「名字不长这样」。
 */
export function sanitizeSpeciesName(s: string): string {
  const cut = (s || "")
    .trim()
    // 句末标点＝这已经不是名字了，从这里砍掉
    .split(/[。！？!?；;：:\n\r]/)[0]
    // 名字两端不该有悬空的标点/括号残骸（截断后常留下半个括号）
    .replace(/^[\s,，、;；·・\-—(（[【]+/, "")
    .replace(/[\s,，、;；·・\-—)）\]】]+$/, "")
    .trim();
  const name = stripTentativeMarks(cut).slice(0, 60);
  return isMetaNoise(name) ? "" : name;
}

/**
 * 截断之后剩下的是不是「元话语的头一个词」而不是物种名。
 *
 * 没有这一步，`sanitizeSpeciesName("状态：已完成识别与撰写。…")` 会得到 `"状态"` ——
 * 非空，于是 `draftTitleFor` 的 `||` 短路就**不会**退回 scientific_name，
 * 库里躺下一个叫「状态」的植物。返回 "" 才能让退回链真正生效。
 *
 * 词表刻意保持极短、且要求**完全等于**：宁可漏掉几种没列进来的闲聊，
 * 也不能误伤真名字（模糊匹配会把「结香」「注氏木」这类正常名字连坐）。
 */
const META_NOISE = new Set([
  "状态", "返回", "结束", "结果", "注", "备注", "说明", "任务", "输出", "回复",
  "答复", "总结", "补充", "提示", "警告", "错误", "完成", "谢谢", "再见", "祝好",
]);

function isMetaNoise(name: string): boolean {
  return META_NOISE.has(name.trim());
}

/**
 * 「疑似」的唯一判据。
 *
 * 判两处而不是只看 confidence：模型经常不设 identification_confidence=low，
 * 而是直接把 summary_zh 写成「疑似……」，两种表达都得认。
 */
export function isTentative(meta: {
  identification_confidence?: unknown;
  summary_zh?: unknown;
  title?: unknown;
}): boolean {
  if (meta.identification_confidence === "low") return true;
  if (TENTATIVE_RE.test((meta.summary_zh ?? "").toString().trim().slice(0, 6))) return true;
  // 第三种表达：标在**名字**上（「长刚毛草（疑似）」）。这同样是模型在说「我没把握」，
  // 必须一并认 —— 否则标题带疑似、正文和补拍横幅却按确诊处理，三处又自相矛盾，
  // 正是本文件开头那条「单一信号源」要根除的情形。
  const t = (meta.title ?? "").toString().trim();
  return !!t && (TENTATIVE_RE.test(t.slice(0, 6)) || TENTATIVE_SUFFIX_RE.test(t));
}

/**
 * 「疑似」被**人**签字解除的留痕。两种，都存在 `plant_drafts.ai_payload` 里：
 *
 *   · `_editor_diagnosis` —— 编辑采纳时写下的诊断意见（approvePlantDraft 写入）；
 *   · `_xiaop_id_fix`     —— 编辑用小P蛙动了这份草稿的**定名**（applyDraftAgentEditFn 写入）。
 *
 * 有其一 = 已经有人对着这张照片重新定过种，全站从此不按疑似渲染（标题、简介卡、
 * 补拍横幅、待审名单上的角标、采纳闸门）。
 *
 * ⚠️ 判据必须收在这里。这三处从前各写各的（草稿页一段内联正则、待审卡一段、服务端闸门
 * 一段），加一种解除方式就要改三处，漏一处就是「页面上没有疑似两个字、点采纳却被拦下来
 * 说这是疑似」——2026-08-09 用户报的正是这一条。
 */
export type TentativeResolution = {
  kind: "diagnosis" | "xiaop_fix";
  at?: string;
  byName?: string;
} | null;

export function tentativeResolution(aiPayload: unknown): TentativeResolution {
  const p = (aiPayload ?? {}) as Record<string, unknown>;
  const pick = (v: unknown) => (v ?? {}) as { at?: unknown; by_name?: unknown };
  if (p._editor_diagnosis) {
    const d = pick(p._editor_diagnosis);
    return { kind: "diagnosis", at: d.at?.toString(), byName: d.by_name?.toString() };
  }
  if (p._xiaop_id_fix) {
    const f = pick(p._xiaop_id_fix);
    return { kind: "xiaop_fix", at: f.at?.toString(), byName: f.by_name?.toString() };
  }
  return null;
}

/**
 * 一份**草稿**到底还算不算疑似 ＝ `isTentative` 的判据 − 已被签字解除的。
 * 摘要按「列优先、payload 兜底」取，与服务端闸门一直以来的口径一致。
 */
export function isDraftTentative(
  aiPayload: unknown,
  row: { title?: unknown; summary?: unknown },
): boolean {
  if (tentativeResolution(aiPayload)) return false;
  const p = (aiPayload ?? {}) as { identification_confidence?: unknown; summary_zh?: unknown };
  return isTentative({
    identification_confidence: p.identification_confidence,
    summary_zh: (row.summary ?? "").toString() || p.summary_zh,
    title: row.title,
  });
}

/**
 * 草稿 / 条目**标题**字段该怎么写。
 *
 * 疑似结果必须显式写成「疑似X」—— 草稿卡、列表、分享卡标题读的都是这个字段，
 * 只把「疑似」标进 summary 是不够的。
 *
 * 模型给的名字本身可能已经带「疑似」（prompt 在不同链路上的约定并不统一：一处要求
 * title 直接带前缀，另一处要求只在 summary 标），所以**先剥再统一加**，
 * 避免拼出「疑似疑似X」。
 *
 * 只有连学名都没有时才退回「待鉴定植物」。以前这里没有加前缀这一步，而模型不确定时
 * 又常常干脆不给 title，于是所有疑似结果清一色变成了「待鉴定植物」。
 */
export function draftTitleFor(meta: {
  title?: unknown;
  scientific_name?: unknown;
  identification_confidence?: unknown;
  summary_zh?: unknown;
}): string {
  // 先过形状闸门再取用：模型偶尔会把一整段闲聊塞进 title，此时它整个不可信，
  // 应当退到 scientific_name（学名极少被污染，它在 schema 里紧挨着 title）。
  const base =
    sanitizeSpeciesName((meta.title ?? "").toString()) ||
    sanitizeSpeciesName((meta.scientific_name ?? "").toString());
  if (!base) return "待鉴定植物";
  return isTentative(meta) ? `疑似${base}` : base;
}
