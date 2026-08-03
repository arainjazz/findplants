import { useEffect, useState } from "react";
import { TASK_KIND_META, type TaskKind } from "@/lib/task-feed";

/**
 * 后台生成任务的**常驻**进度面板。
 *
 * 为什么不用 toast：银叶草稿要跑几分钟、金叶详页更久，而 toast 会自动消失、又挤在角落，
 * 用户等着等着就「不知道它还在不在跑」（线上连续两轮实测反馈：等待时间太长、没有任何
 * 实时反馈）。这里改成占位的常驻块，把**当前阶段 + 进度条 + 已用时**一直摆在页面上。
 *
 * 已用时是刻意加的：长任务里「还在动」比「进度百分比」更能安抚人——阶段文案十几秒才换
 * 一次，中间那段静默期只有秒表能证明它没死。
 *
 * ⚠️ **颜色必须跟着任务类型走**（绿=识别 / 蓝=银叶 / 橙=金叶，与小P蛙动态流同一套
 * `TASK_KIND_META`）。2026-07-30 用户实测：三类任务共用同一块深绿面板，谁在跑全靠标题
 * 那行字分辨，一旦串台（那次是路由组件跨草稿复用）就完全看不出来 ——「补拍识别」和
 * 「银叶草稿」都被读成了「金叶创建排队」。颜色 + 类型徽章 + 是哪一株，三样一起摆出来，
 * 才是**看一眼就能证伪**的，不必先读完标题再去回想自己刚点了什么。
 */
export function JobProgressPanel({
  kind,
  title,
  subject,
  phase,
  progress,
  startedAt,
}: {
  /** 哪一类任务 —— 决定整块的颜色与徽章。 */
  kind: TaskKind;
  title: string;
  /** 跑在哪一株上（草稿标题）。串台时这是最先能戳破的那条线索，所以摆在标题行里。 */
  subject?: string | null;
  phase: string;
  progress: number;
  /** 任务开始的时间戳（Date.now()），用于显示已用时。 */
  startedAt: number;
}) {
  const meta = TASK_KIND_META[kind];
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const secs = Math.max(0, Math.floor((now - startedAt) / 1000));
  const mm = String(Math.floor(secs / 60)).padStart(2, "0");
  const ss = String(secs % 60).padStart(2, "0");
  const pct = Math.max(0, Math.min(100, Math.round(progress)));
  const who = (subject || "").trim();

  return (
    <div className={`border-2 rounded-lg p-4 ${meta.panel}`}>
      <div className="flex items-baseline justify-between gap-3 mb-2">
        <p className="text-sm font-bold flex items-baseline gap-2 flex-wrap min-w-0">
          <span
            className={`shrink-0 text-[10px] font-bold px-1.5 py-0.5 rounded-sm tracking-wide ${meta.chip}`}
          >
            {meta.label}
          </span>
          <span className={meta.text}>{title}</span>
          {who && <span className="text-ink-faint font-medium text-xs truncate">· {who}</span>}
        </p>
        <p className="text-xs text-ink-faint tabular-nums shrink-0">
          已用时 {mm}:{ss}
        </p>
      </div>
      {/* 进度条：aria 属性齐全，读屏用户也能听到百分比。颜色即任务类型，别在这里写死。 */}
      <div
        className="h-2 w-full bg-rule/40 rounded-full overflow-hidden"
        role="progressbar"
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={`${meta.label}${who ? ` · ${who}` : ""}：${title}`}
      >
        <div
          className={`h-full transition-[width] duration-500 ease-out ${meta.bar}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <p className="text-[13px] text-ink-soft mt-2 leading-relaxed">
        <span className="tabular-nums font-semibold">{pct}%</span> · {phase || "正在准备…"}
      </p>
      <p className="text-[11px] text-ink-faint mt-1.5 leading-relaxed">
        生成在服务端后台进行，<strong>可以关掉这个页面或刷新</strong>，回来会自动接着显示进度。
      </p>
    </div>
  );
}
