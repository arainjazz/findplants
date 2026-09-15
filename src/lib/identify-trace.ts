import { speciesKey } from "./plants";
import { isTentative, type TentativeResolution } from "./tentative";

// ─── 识别过程痕迹与「综合可信度%」 ────────────────────────────────────────────
// 单独成纯函数模块（与 tentative.ts 同样的理由）：识别链路要模型调用 + 登录才跑得起来，
// 而**服务端出卡**和**草稿页 React 卡片**都要用同一套算法算同一个数字。放在
// identify-plant.functions.ts 里客户端 import 不了（那是 server-only），两边各写一份
// 迟早算出两个不一样的百分比。

/** 每次识别都记，包括复核没跑成的情况（写进 ai_payload._identify_trace）。 */
export type IdentifyTrace = {
  primaryEngine: string;
  primaryLabel: string;
  primaryPct: number | null;
  /**
   * Pl@ntNet **没给出判定**时的真实原因（2026-09-15 加）：未配置 / 额度用尽 / 请求失败（HTTP nnn）/
   * 超时 / 网络错误 / 格式不支持 / 没认出物种。
   * 以前卡片上一律写「额度用尽或未配置」—— 09-15 那次其实是请求失败（当天调用计数 0/500，
   * 同一张照片几小时后重试 4 秒就 200），这句笼统的话把人往错误的方向引。
   * 老痕迹没有这个字段，渲染时沿用旧说法（见 plantNetMissText）。
   */
  primaryNote?: string;
  phase1Model: string;
  phase1Confidence: string;
  review:
    | { ran: false; reason: string }
    | { ran: true; model: string; confidence: string; action: string; adopted: boolean };
  retakeCount: number;
};

const CONF_TIER_BASE: Record<string, number> = { high: 90, medium: 70, low: 45 };

/**
 * Pl@ntNet 分数低于这个值时，**它自己都没把握** —— 这种判定既不算「印证」也不算「分歧」，
 * 直接不计入。
 *
 * 起因（2026-07-22 用户实测）：某次 Pl@ntNet 给出 `Begonia chitoensis 7%`，与模型判定不同种，
 * 旧算法把它当成「分歧证据」扣了 5 分（70→65）。但 7% 意味着 Pl@ntNet 基本在瞎猜，拿它当
 * 反证是过度解读；反过来若它 95% 还指向另一个物种，那是强烈分歧，扣 5 分又远远不够。
 * 结论：**分歧的惩罚必须随 Pl@ntNet 自身置信度缩放**，且低置信度判定应当直接忽略。
 */
const PN_MEANINGFUL_PCT = 30;

/**
 * 编辑用小P蛙**复核并改掉定名**之后给的加分（百分点）。
 *
 * 为什么值这么多：整条链路上除了 Pl@ntNet 那个分数，其余全是模型自评；一个有采纳权的
 * 编辑对着照片把种名重新定过一遍，是这里唯一的**人类证据**，比二次自动复核（+5，同样
 * 是模型）强一个量级。它同时也解除了「疑似」——两件事必须给出同一个数，否则又回到
 * 「页面上不写疑似了、星数却还按疑似压着」的自相矛盾。
 */
const XIAOP_FIX_BONUS = 20;

/**
 * 综合可信度%。**刻意不让模型自己报这个数** —— 模型自评只有 high/medium/low 三档，
 * 直接映射成百分比是假精度。这里只用两个真实信号，并把依据一并显示出来：
 *  ① Pl@ntNet 的 score —— 整条链路上**唯一非模型自评**的客观数字；
 *  ② 最终置信档（已由 normalizeIdentification 统一过）。
 *
 * 四种情形（顺序即优先级）：
 *  - **同种印证**：Pl@ntNet 达到有效阈值且与最终判定同种 → 取两者均值；二次复核也确认再 +5。
 *  - **有效分歧**：Pl@ntNet 达到阈值却指向别的物种 → 扣分，**幅度随它自身置信度线性放大**
 *    （刚过阈值几乎不扣，接近 100% 扣满 30）。这是 2026-07-22 修掉的一个真实缺陷：旧版一律
 *    扣 5，导致 7% 的瞎猜和 95% 的强烈反证被同等对待。
 *  - **低分不计**：Pl@ntNet 低于阈值 → 它自己都没把握，既不算印证也不算反证，直接忽略。
 *  - **无客观分**：没跑 Pl@ntNet → 只认档位，并写明缺少客观参照。
 */
export function computeIdentifyConfidence(
  t: IdentifyTrace,
  finalSci: string,
  /**
   * 🔴 **传整份判定 meta，不要只传 confidence 字符串。**
   *
   * 起因（2026-07-30 用户实测）：草稿页判「疑似」用的是 `isTentative()` —— 它认三个
   * 信号（confidence=low / 摘要以「疑似」开头 / 名字带「疑似」）；而这里从前只认
   * `identification_confidence` 一个。于是模型写 `confidence: "high"` 却在正文里说
   * 「疑似……」时，同一张卡上会同时出现「本次结论为**疑似**」和「置信度 9 颗星」。
   * 参数收成对象、并在下面把档位钳到 low，是为了让「疑似」在全站**只有一个判据**。
   */
  final: { identification_confidence?: unknown; summary_zh?: unknown; title?: unknown },
  /**
   * 「疑似」是否已被人签字解除（`tentativeResolution(ai_payload)` 的结果）。
   * 传了 `xiaop_fix` 就**不再按疑似压档**，并在依据里记一条 +20 —— 见 XIAOP_FIX_BONUS。
   * 出卡链路调用时没有这个参数：识别刚跑完，还谈不上复核。
   */
  resolution?: TentativeResolution,
): { pct: number; basis: string } {
  const rawConf = (final.identification_confidence ?? "").toString();
  const xiaopFixed = resolution?.kind === "xiaop_fix";
  // 疑似 = 模型在说「我没把握」。无论它把这句话写在哪个字段里，档位一律按 low 计。
  // 已被小P蛙复核改名的除外：那句「我没把握」已经有人替它拿定主意了。
  const tentative = isTentative(final) && !xiaopFixed;
  const finalConf = tentative ? "low" : rawConf;
  const base = CONF_TIER_BASE[finalConf] ?? 45;
  const tierZh =
    tentative && rawConf !== "low"
      ? `结论为疑似（模型自评写的是${confZh(rawConf)}，但名称/正文标了「疑似」，按疑似计）=${base}`
      : `模型自评${confZh(finalConf)}档=${base}`;
  const pnKey = speciesKey(t.primaryLabel || "");
  const hasPn = t.primaryPct != null;
  const pnUsable = hasPn && (t.primaryPct as number) >= PN_MEANINGFUL_PCT;
  const agree = pnUsable && !!pnKey && pnKey === speciesKey(finalSci || "");
  let pct: number;
  let basis: string;

  if (agree) {
    pct = Math.round(((t.primaryPct as number) + base) / 2);
    basis = `${tierZh}，Pl@ntNet ${t.primaryPct}% 判为同一物种、互相印证，取均值`;
    if (t.review.ran && t.review.adopted) {
      pct += 5;
      basis += "；二次复核确认 +5";
    }
  } else if (pnUsable) {
    // 分歧惩罚随 Pl@ntNet 自身置信度线性放大：刚过阈值几乎不扣，接近 100% 时扣满 30。
    const penalty = Math.round((((t.primaryPct as number) - PN_MEANINGFUL_PCT) / (100 - PN_MEANINGFUL_PCT)) * 30);
    pct = base - penalty;
    basis = `${tierZh}，但 Pl@ntNet 以 ${t.primaryPct}% 指向另一物种 ${t.primaryLabel}，按其置信度扣 ${penalty}`;
  } else if (hasPn) {
    // 低分判定＝Pl@ntNet 自己也没把握，既不算印证也不算反证，直接不计入。
    pct = base;
    basis = `${tierZh}；Pl@ntNet 仅 ${t.primaryPct}%（低于 ${PN_MEANINGFUL_PCT}% 有效阈值，视为未能判定）不计入`;
  } else {
    pct = base;
    basis = `${tierZh}；本次无 Pl@ntNet 客观分可参照`;
  }

  // 人复核过的那一笔加在最后：它与 Pl@ntNet 那几种情形是独立的两件事，摞在一起才说得清
  // 「机器算到这里，人又在这上面签了个字」。
  if (xiaopFixed) {
    pct += XIAOP_FIX_BONUS;
    basis +=
      `；编辑已用小P蛙复核定名${resolution?.byName ? `（${resolution.byName}）` : ""}` +
      `、「疑似」已解除 +${XIAOP_FIX_BONUS}`;
  }
  return { pct: Math.max(5, Math.min(99, pct)), basis };
}

/** 星级总数。10 颗 = 每颗 10%。 */
export const CONFIDENCE_STARS_TOTAL = 10;

/**
 * 综合可信度% → 几颗星（1–10）。
 *
 * 为什么要有星：百分比对普通用户是个抽象数字（「45% 到底算高还是低」），而十颗星是
 * 一眼可比的。两者并存、不互相替代 —— 星给感觉，百分比给精度，依据那行给理由。
 *
 * 用 `ceil` 而不是 `round`：computeIdentifyConfidence 的下限是 5%，四舍五入会得到 0 颗星，
 * 而「0 颗星」在视觉上等于「没识别出来」，与「识别出来了但把握很低」不是一回事。
 * ceil 保证任何有效结果至少 1 颗星；上限 99% 落在第 10 颗（满星只可能来自 100%，
 * 而 computeIdentifyConfidence 永不返回 100 —— 满星是刻意留白的）。
 */
export function confidenceStars(pct: number): number {
  const p = Math.max(0, Math.min(100, Math.round(pct)));
  if (p <= 0) return 0;
  return Math.max(1, Math.min(CONFIDENCE_STARS_TOTAL, Math.ceil(p / 10)));
}

export function confZh(c: string): string {
  return c === "high" ? "确诊" : c === "medium" ? "较有把握" : c === "low" ? "疑似" : c || "—";
}

/** Pl@ntNet 那一行「未参与」的写法：有真实原因就写原因；老痕迹没有，就用调用方给的旧说法。 */
export function plantNetMissText(t: Pick<IdentifyTrace, "primaryNote">, legacy: string): string {
  return t.primaryNote ? `未参与：${t.primaryNote}` : legacy;
}

/**
 * 把 plantNetIdentify 的失败返回翻译成一句人话，写进 `trace.primaryNote`。
 * `status: 0` = 我们这边压根没拿到响应：`body === "__TIMEOUT__"` 是自己的 20 秒超时，否则 body 是网络错误原文。
 */
export function describePlantNetMiss(r: {
  status: number;
  body?: string;
  quotaExhausted?: boolean;
}): string {
  const body = (r.body ?? "").toString();
  if (r.quotaExhausted || r.status === 429) return "今日免费额度已用尽（HTTP 429）";
  if (r.status === 0)
    return body === "__TIMEOUT__"
      ? "请求超时（20 秒没有返回）"
      : `网络请求失败${body ? `（${body.slice(0, 60)}）` : ""}`;
  if (r.status === 200) return "返回了结果，但没有识别出任何物种";
  if (r.status === 401 || r.status === 403) return `API Key 无效或已停用（HTTP ${r.status}）`;
  if (r.status === 404) return "没有识别出任何物种（HTTP 404）";
  if (r.status === 415) return "照片格式不受支持（只收 JPEG / PNG）";
  return `请求失败（HTTP ${r.status}）`;
}

/** 把痕迹摊成「① 专业引擎 → ② 一线模型 → ③ 二次复核」三行，供 UI 逐条渲染。 */
export function traceSteps(t: IdentifyTrace): { label: string; value: string }[] {
  const out: { label: string; value: string }[] = [];
  if (t.primaryEngine === "plantnet") {
    const pct = t.primaryPct ?? 0;
    out.push({
      label: "专业引擎 Pl@ntNet",
      value:
        `${t.primaryLabel} —— 引擎置信度 ${pct}%` +
        (pct < PN_MEANINGFUL_PCT ? `（低于 ${PN_MEANINGFUL_PCT}%，视为未能判定、不计入可信度）` : ""),
    });
  } else if (t.primaryEngine === "vision") {
    out.push({
      label: "专业引擎 Pl@ntNet",
      value: `${plantNetMissText(t, "未参与（额度用尽或未配置）")} → 由复核模型顶替定种：${t.primaryLabel}`,
    });
  } else {
    out.push({ label: "专业引擎 Pl@ntNet", value: plantNetMissText(t, "未参与") });
  }
  out.push({
    // 🔴 **不写具体模型名**（用户 2026-07-31）。模型换得很勤，写在读者面前的那一行迟早是
    // 错的；真实的模型名只出现在管理员控制台和用量表里（那里是配置必需）。
    // `t.phase1Model` 仍照常写进 trace 存库，只是不渲染给读者。
    label: "一线识别模型",
    // 明确写出「只给档位、不给分数」：用户看到 Pl@ntNet 有 7% 这样的数字、这里却没有，
    // 会以为是漏显示了。视觉大模型输出的就是 high/medium/low 三档自评，没有可信的连续分数
    // ——真让它报一个百分比，那也是它编的，不比档位更可靠。
    value: `${confZh(t.phase1Confidence)}（模型只给档位，不给百分比）`,
  });
  if (t.review.ran) {
    out.push({
      label: "二次自动复核",
      value:
        `${confZh(t.review.confidence)} · ${t.review.action === "confirm" ? "确认原判" : "纠正物种"}` +
        ` → ${t.review.adopted ? "已采纳，跳过补拍" : "未采纳，维持疑似"}`,
    });
  } else {
    out.push({ label: "二次自动复核", value: `未运行 —— ${t.review.reason}` });
  }
  if (t.retakeCount > 0) {
    out.push({ label: "补拍", value: `这是第 ${t.retakeCount} 次补拍后的结果` });
  }
  return out;
}
