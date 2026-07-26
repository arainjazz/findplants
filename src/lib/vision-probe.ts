/**
 * 视觉准入检测 —— 回答一个而且只有一个问题：**这个模型到底看没看见图？**
 *
 * 为什么必须有它（2026-07-20 的真实事故）：给「出卡AI」配的备胎 `deepseek-v4-flash`
 * 带图调用**返回 HTTP 200、prompt_tokens 只有 26**（图片零 token），模型自述「您没有提供
 * 图片」，然后**照样编了一个物种出来，还不报错**。Gemini 一 429 顶到它，用户就会拿到一张
 * 凭空捏造的识别卡。纯文本 ping 完全测不出这种静默失败。
 *
 * 与既有「三重奏 · 引擎自检」的区别（两者互补，别互相替代）：
 * - 引擎自检问的是「这个模型**认不认得出**这株植物」——它只测当前生效的那一项，
 *   而且判据是「有没有给出定种结论」。**一个凭空编造的结论会让它判 PASS**，
 *   正好对这类事故失灵。
 * - 本检测问的是「这个模型**读不读得到像素**」，逐项测整条序列，判据是客观的两条证据。
 *
 * 两条独立证据，都过才算 PASS：
 *  1. **内容证据**：给一张四象限纯色图，要求按左上/右上/左下/右下报颜色。瞎猜四个颜色
 *     还要顺序全对，概率极低。
 *  2. **Token 证据**：同一段提示词再发一次**不带图**的，比较 prompt_tokens。真读图的模型
 *     会多出成百上千个 token；`deepseek-v4-flash` 那种差值≈0。
 *
 * 这个文件只放**纯函数 + 常量**（不发请求），所以 `scratch/vision-probe.test.mjs` 能直接
 * 跑本体。发请求的部分在 identify-plant.functions.ts 的 `probeSlotVisionFn`。
 */

/**
 * 检测用图：256×256，四象限纯色 —— 左上红、右上蓝、左下黄、右下绿。
 * 846 字节，内联进 prompt 的成本可以忽略。
 *
 * 为什么用**自制图**而不是站内植物照：植物照的"正确答案"依赖模型的植物学知识，
 * 而我们要测的是像素通道，两者必须解耦。四个色相相距最远的颜色，任何真读到图的
 * 模型都不该答错，任何没读到图的模型也不可能蒙对顺序。
 * 生成脚本见 STATE.md 续17（zlib + CRC32 手搓 PNG，无外部依赖）。
 */
export const VISION_PROBE_PNG_B64 =
  "iVBORw0KGgoAAAANSUhEUgAAAQAAAAEACAIAAADTED8xAAADFUlEQVR42u3TMRHAIAAEQUyQLiVemNhAWuxggjoOUiHjKXbmJNyWdXcFa+NTsGJBAAAQAAAIAAAEAAACAAABAIAAAEAAACAAABAAAAgAAAQAAAIAAAEAgAAAQAAAIAAAEAAACAAABAAAAgAAAQCAAABAAAAgAAAQAAAAIAAAEAAACAAABAAAAgAAAQCAAABAAAAgAAAQAAAIAAAEAAACAAABAIAAAEAAACAAABAAAAgAAAQAAAIAAAEAgAAAQAAAIAAAAMCFAAAgAAAQAAAIAAAEAAACAAABAIAAAEAAACAAABAAAAgAAAQAAAIAAAEAgAAAQAAAIAAAEAAACAAABAAAAgAAAQCAAABAAAAAgAsBAEAAACAAABAAAAgAAAQAAAIAAAEAgAAAQAAAIAAAEAAACAAABAAAAgAAAQCAAABAAAAgAAAQAAAIAAAEAAACAAABAIAAAEAAAACAAABAAAAgAAAQAAAIAAAEAAACAAABAIAAAEAAACAAABAAAAgAAAQAAAIAAAEAgAAAQAAAIAAAEAAACAAABAAAAuAgAP+sCna9j4IBAAAAAgAAAQCAAABAAAAgAAAQAAAIAAAEAAACAAABAIAAAEAAACAAABAAAAgAAAQAAAIAAAEAgAAAQAAAIAAAEAAACAAABAAAAgAAAAQAAAIAAAEAgAAAQAAAIAAAEAAACAAABAAAAgAAAQCAAABAAAAgAAAQAAAIAAAEAAACAAABAIAAAEAAACAAABAAAAgAAAQAAAC4EAAABAAAAgAAAQCAAABAAAAgAAAQAAAIAAAEAAACAAABAIAAAEAAACAAABAAAAgAAAQAAAIAAAEAgAAAQAAAIAAAEAAACAAAZEEAABAAAAgAAAQAAAIAAAEAgAAAQAAAIAAAEAAACAAABAAAAgAAAQCAAABAAAAgAAAQAAAIAAAEAAACAAABAIAAAEAAACAAABAAAAAgAAAQAAAIAAAEAAACAAABAIAAAEAAACAAABAAAAgAAAQAAAIAAAEAgAAAQAAAIAAAEAAACAAABAAAAgAAAQCAADioDV7V1OxQ4KffAAAAAElFTkSuQmCC";

export const VISION_PROBE_MIME = "image/png";

/** 提问。刻意要求「只回答四个词」，把回答压到最短，token 成本可忽略。 */
export const VISION_PROBE_PROMPT =
  "这张图被平均分成四个纯色方块。请按 左上、右上、左下、右下 的顺序，" +
  "各用一个中文颜色词回答，用逗号分隔，只输出这四个词，不要任何其它文字。";

/** 不带图的对照组用同一段文字 —— 两次 prompt_tokens 的差值才等于「图占了多少 token」。 */
export const VISION_PROBE_TEXT_ONLY_PROMPT = VISION_PROBE_PROMPT;

/** 正确答案，按象限顺序。每项列出可接受的同义写法。 */
const EXPECTED: { name: string; accept: RegExp }[] = [
  { name: "红", accept: /红|玫瑰|洋红|绯|red|crimson|rose/i },
  { name: "蓝", accept: /蓝|靛|blue/i },
  { name: "黄", accept: /黄|金|yellow|gold|amber/i },
  { name: "绿", accept: /绿|青绿|green/i },
];

export type VisionGrade = {
  /** 四个颜色是否**按顺序**全部答对。 */
  answerOk: boolean;
  /** 答对了几个（顺序无关），用于把「完全没读到图」和「读到了但描述偏差」区分开。 */
  hits: number;
  /** 给管理员看的一句话。 */
  note: string;
};

/**
 * 判卷。要求四个颜色**依次**出现在回答里 —— 只统计出现次数会让「红蓝黄绿」四个字
 * 随便乱序也算过，那就退化成了考词汇量而不是考读图。
 */
export function gradeVisionAnswer(raw: string): VisionGrade {
  const text = String(raw ?? "");
  if (!text.trim()) return { answerOk: false, hits: 0, note: "模型没有返回任何文字。" };

  // 顺序判定：依次从上一个匹配位置之后继续找，找不到就断链。
  let cursor = 0;
  let inOrder = 0;
  for (const e of EXPECTED) {
    const rest = text.slice(cursor);
    const m = e.accept.exec(rest);
    if (!m) break;
    inOrder++;
    cursor += m.index + m[0].length;
  }
  // 顺序无关的命中数，只用于写说明。
  const hits = EXPECTED.filter((e) => e.accept.test(text)).length;

  const answerOk = inOrder === EXPECTED.length;
  if (answerOk) return { answerOk, hits, note: "四个方块的颜色与顺序全部答对。" };
  if (hits === 0)
    return {
      answerOk,
      hits,
      note: `一个颜色都没答对。模型回答：「${text.trim().slice(0, 60)}」`,
    };
  return {
    answerOk,
    hits,
    note: `只对了 ${hits}/4（或顺序不对）。模型回答：「${text.trim().slice(0, 60)}」`,
  };
}

/** 图片至少该多占这么多 prompt token，才算「像素真的进了模型」。 */
export const MIN_IMAGE_TOKEN_DELTA = 30;

export type VisionVerdict = "pass" | "blind" | "unknown";

export type VisionProbeResult = {
  verdict: VisionVerdict;
  /** 带图调用的 prompt_tokens。 */
  promptTokens: number;
  /** 不带图对照组的 prompt_tokens；对照组没跑成时为 null。 */
  textOnlyTokens: number | null;
  /** 两者之差 = 图片占的 token；无法计算时为 null。 */
  imageTokenDelta: number | null;
  answerOk: boolean;
  /** 面板上展示的完整说明。 */
  note: string;
  /** 检测时间，ISO 串。 */
  at: string;
};

/**
 * 综合两条证据下结论。
 *
 * **`unknown` 是一等公民，不是失败的同义词。** 429 / 网络错误 / 厂商不回 usage 都只能给
 * unknown —— 把它们记成 `blind` 会让运行时永久跳过一个其实好好的序列项，比不检测更糟。
 * 只有「拿到了完整回答、但客观证据表明没读到图」才判 blind。
 */
export function judgeVisionProbe(input: {
  grade: VisionGrade;
  promptTokens: number;
  textOnlyTokens: number | null;
  /** 调用本身失败时传原因，直接出 unknown。 */
  callError?: string | null;
}): Omit<VisionProbeResult, "at"> {
  const { grade, promptTokens, textOnlyTokens, callError } = input;
  const delta = textOnlyTokens == null ? null : promptTokens - textOnlyTokens;

  if (callError) {
    return {
      verdict: "unknown",
      promptTokens,
      textOnlyTokens,
      imageTokenDelta: delta,
      answerOk: false,
      note: `无法判定（调用未成功）：${callError}。这**不代表**模型不读图，请排除额度/网络问题后重测。`,
    };
  }

  const tokenSaysBlind = delta != null && delta < MIN_IMAGE_TOKEN_DELTA;
  const tokenNote =
    delta == null
      ? "厂商未返回可比对的 token 用量，本项无结论。"
      : `图片占 ${delta} 个 prompt token（带图 ${promptTokens} / 纯文本 ${textOnlyTokens}）。`;

  // 两条证据一致 → 干脆利落。
  if (grade.answerOk && !tokenSaysBlind)
    return {
      verdict: "pass",
      promptTokens,
      textOnlyTokens,
      imageTokenDelta: delta,
      answerOk: true,
      note: `✅ 确认读图。${grade.note} ${tokenNote}`,
    };

  if (!grade.answerOk && tokenSaysBlind)
    return {
      verdict: "blind",
      promptTokens,
      textOnlyTokens,
      imageTokenDelta: delta,
      answerOk: false,
      note: `❌ 该模型看不见图片（两项证据一致）。${grade.note} ${tokenNote}这类模型接在视觉链路上会**凭空编造物种且不报错**，请勿用于出卡 / 疑似复核。`,
    };

  // 两条证据打架 → 保守起见判 blind（宁可少用一个模型，也不能让编造的识别卡发出去），
  // 但说明里必须写清是哪一条不认账，方便管理员复核。
  if (!grade.answerOk && !tokenSaysBlind)
    return {
      verdict: "blind",
      promptTokens,
      textOnlyTokens,
      imageTokenDelta: delta,
      answerOk: false,
      note: `⚠️ 判定为不可用于视觉链路：token 显示图片已送达，但模型答不出图里的颜色。${grade.note} ${tokenNote}可能是模型把图丢了或视觉能力极弱 —— 无论哪种，都不该让它去识别植物。`,
    };

  return {
    verdict: "blind",
    promptTokens,
    textOnlyTokens,
    imageTokenDelta: delta,
    answerOk: true,
    note: `⚠️ 颜色答对了，但 token 显示图片几乎没占用量（${tokenNote}）——**很可能是猜中的**。判定为不可用于视觉链路；若你确信该模型支持视觉，请重测一次再判断。`,
  };
}

/**
 * 自检耗时该怎么说给管理员听。
 *
 * 起因（2026-07-24 用户实测）：「自检三条链路全过，二次复核照样报未运行」。
 * 症结在于**自检和真复核根本不是一个量级的请求**：自检发 846 字节小图 + 只要四个词的
 * 回答；真复核发整张实拍照片（外加补拍照）+ 要一段 150–260 字导语。自检回答的是
 * 「key 能用吗、模型看得见图吗」，从来**不回答「它够不够快」**。
 *
 * 所以耗时只能当**下限**来读：连自检都慢的模型，跑真复核必然超预算；自检快也**不保证**
 * 真复核不超时。措辞必须把这层不确定性讲明白，不能让人以为「自检 2 秒 = 复核没问题」。
 */
export function speedNote(ms: number): string {
  const s = (ms / 1000).toFixed(1);
  if (ms >= 12_000)
    return (
      ` ⏱ 本次自检耗时 ${s} 秒 —— **这么小的一个请求都要这么久，真复核（整张实拍照 + 一段导语）` +
      `几乎必然超时**。二次复核链路请换更快的模型，或把它排到序列后面。`
    );
  if (ms >= 5_000)
    return (
      ` ⏱ 本次自检耗时 ${s} 秒，偏慢。自检只是一张几百字节的小图，真复核要重得多 —— ` +
      `若前台一直报「二次复核未运行」，先怀疑这一项。`
    );
  return ` ⏱ 本次自检耗时 ${s} 秒。注意：自检**测不出**真复核要多久（那是整张实拍照 + 一段 150–260 字导语），快不等于复核不会超时。`;
}

/** 面板上的短标签。 */
export function visionBadge(verdict: VisionVerdict | null | undefined): {
  text: string;
  tone: "ok" | "bad" | "muted";
} {
  if (verdict === "pass") return { text: "✅ 已验证读图", tone: "ok" };
  if (verdict === "blind") return { text: "❌ 不读图", tone: "bad" };
  if (verdict === "unknown") return { text: "？未测出", tone: "muted" };
  return { text: "未检测", tone: "muted" };
}
