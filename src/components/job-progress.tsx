import { useEffect, useState } from "react";

/**
 * 后台生成任务的**常驻**进度面板。
 *
 * 为什么不用 toast：银叶草稿要跑几分钟、金叶详页更久，而 toast 会自动消失、又挤在角落，
 * 用户等着等着就「不知道它还在不在跑」（线上连续两轮实测反馈：等待时间太长、没有任何
 * 实时反馈）。这里改成占位的常驻块，把**当前阶段 + 进度条 + 已用时**一直摆在页面上。
 *
 * 已用时是刻意加的：长任务里「还在动」比「进度百分比」更能安抚人——阶段文案十几秒才换
 * 一次，中间那段静默期只有秒表能证明它没死。
 */
export function JobProgressPanel({
  title,
  phase,
  progress,
  startedAt,
}: {
  title: string;
  phase: string;
  progress: number;
  /** 任务开始的时间戳（Date.now()），用于显示已用时。 */
  startedAt: number;
}) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const secs = Math.max(0, Math.floor((now - startedAt) / 1000));
  const mm = String(Math.floor(secs / 60)).padStart(2, "0");
  const ss = String(secs % 60).padStart(2, "0");
  const pct = Math.max(0, Math.min(100, Math.round(progress)));

  return (
    <div className="border-2 border-leaf-deep/40 rounded-lg bg-leaf-deep/5 p-4">
      <div className="flex items-baseline justify-between gap-3 mb-2">
        <p className="text-sm font-bold text-leaf-deep">{title}</p>
        <p className="text-xs text-ink-faint tabular-nums">
          已用时 {mm}:{ss}
        </p>
      </div>
      {/* 进度条：aria 属性齐全，读屏用户也能听到百分比。 */}
      <div
        className="h-2 w-full bg-rule/40 rounded-full overflow-hidden"
        role="progressbar"
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={title}
      >
        <div
          className="h-full bg-leaf-deep transition-[width] duration-500 ease-out"
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
