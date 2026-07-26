import { CONFIDENCE_STARS_TOTAL, confidenceStars } from "@/lib/identify-trace";

/**
 * 「置信度：x 颗星」——综合可信度%的十星化表达。
 *
 * 与百分比并存、不替代它：星是**一眼可比**的（普通用户看不出 45% 算高还是低，但看得出
 * 4 颗亮 6 颗灰），百分比给精度，下面那行「可信度依据」给理由。三者各司其职。
 *
 * 星形用内联 SVG 画，不用字体里的 ★ —— 那个字符在不同系统上大小和基线差得很远，
 * 十颗排一行会歪。分享卡（canvas）里另有一份同形状的绘制实现（share-card.ts 的
 * drawStar），两边取整规则共用 confidenceStars()，保证同一次识别在页面和卡上星数一致。
 */
export function ConfidenceStars({
  pct,
  size = 14,
  showLabel = true,
  className,
}: {
  pct: number;
  /** 单颗星的边长（px）。 */
  size?: number;
  /** 是否显示「置信度：x 颗星」这行字。 */
  showLabel?: boolean;
  className?: string;
}) {
  const filled = confidenceStars(pct);
  return (
    <div className={`flex flex-wrap items-center gap-1.5 ${className ?? ""}`}>
      <div
        className="flex items-center gap-0.5"
        role="img"
        aria-label={`置信度 ${filled} 颗星，共 ${CONFIDENCE_STARS_TOTAL} 颗`}
      >
        {Array.from({ length: CONFIDENCE_STARS_TOTAL }, (_, i) => (
          <Star key={i} size={size} on={i < filled} />
        ))}
      </div>
      {showLabel && (
        <span className="text-[11px] text-ink-faint">
          置信度：{filled} 颗星 / {CONFIDENCE_STARS_TOTAL}
        </span>
      )}
    </div>
  );
}

/** 空心星也要画出轮廓 —— 只画亮的那几颗，用户就数不出「满分是多少」。 */
function Star({ size, on }: { size: number; on: boolean }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      aria-hidden="true"
      fill={on ? "#e5a83b" : "none"}
      stroke={on ? "#e5a83b" : "currentColor"}
      strokeWidth={on ? 0 : 1.6}
      strokeLinejoin="round"
      className={on ? "" : "text-rule"}
    >
      <path d="M12 2.6l2.9 5.88 6.49.95-4.7 4.58 1.11 6.46L12 17.42 6.2 20.47l1.11-6.46-4.7-4.58 6.49-.95L12 2.6z" />
    </svg>
  );
}
