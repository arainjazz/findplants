import { Link } from "@tanstack/react-router";
import type { RegistryChip, RegistryChipKind } from "@/lib/conservation";

/**
 * The registry chip row: one chip per registry a plant matched (国家/省级重点保护 ·
 * CITES · GTS · GRIIS · 地区植物名录 · tag 标签). Rendered on the draft page and the
 * published detail page; the 简介摘要卡 (server HTML) and the 分享卡 (canvas) draw the
 * same chips through their own renderers, so a species reads identically everywhere.
 */

/**
 * Per-registry colour（配色由用户指定，一名录一色系）：
 *  - 手动主题标签 tag_manual：绿，**加粗描边**（border-2 + 全实色 + 加粗字），一眼看出是人特意挂的；
 *  - 国家重点保护 protected_national：粉；
 *  - 省级/地区重点保护 protected_regional：黄；
 *  - CITES 贸易管制 cites：紫；
 *  - GTS 全球树木红色名录 gts：蓝；
 *  - GRIIS 外来入侵 griis：橙（警示）；
 *  - 地区植物名录 catalog：中性；
 *  - 自动识别特征词 tag：无底色、最弱。
 */
/**
 * 手动主题标签的绿色系（一标签一绿，见 conservation.ts 的 manualTagTone）。都保持
 * border-2 + 底色 + 加粗字，所以「这是人挂的」这层信息不因绿号不同而变弱；变的只是色相，
 * 用来把不同专题分开。**必须写成完整的静态类名**：Tailwind 是扫源码文本生成 CSS 的，
 * 拼接出来的 `bg-[${x}]` 不会被扫到，上线就成了没底色的裸卡签。
 */
const MANUAL_TONES = [
  "border-2 border-[#2d6a4f] bg-[#2d6a4f]/12 text-[#245a42] font-semibold", // 墨绿
  "border-2 border-[#17726b] bg-[#17726b]/12 text-[#125e58] font-semibold", // 青绿
  "border-2 border-[#5b7c2a] bg-[#5b7c2a]/12 text-[#496523] font-semibold", // 苔绿
  "border-2 border-[#3f8f5a] bg-[#3f8f5a]/12 text-[#2f7548] font-semibold", // 松绿
];

const TONE: Record<RegistryChipKind, string> = {
  tag_manual: MANUAL_TONES[0],
  protected_national: "border-[#c85a8a]/60 bg-[#c85a8a]/12 text-[#a63a6b]",
  protected_regional: "border-[#c99a2e]/65 bg-[#c99a2e]/15 text-[#8a6410]",
  cites: "border-[#7a5cc4]/50 bg-[#7a5cc4]/10 text-[#5f45a3]",
  gts: "border-[#3f74b8]/55 bg-[#3f74b8]/10 text-[#2c5488]",
  griis: "border-[#dd8324]/60 bg-[#dd8324]/12 text-[#b3600f]",
  catalog: "border-rule bg-paper-deep/40 text-ink-soft",
  tag: "border-rule bg-transparent text-ink-faint",
};

export function RegistryChips({
  chips,
  className,
  /** Tag chips link to /tags/<name> when true (detail page); plain text otherwise. */
  linkTags = false,
}: {
  chips: RegistryChip[];
  className?: string;
  linkTags?: boolean;
}) {
  if (!chips.length) return null;
  return (
    <div className={`flex flex-wrap items-center gap-1.5 ${className ?? ""}`}>
      {chips.map((c, i) => {
        const tone =
          c.kind === "tag_manual"
            ? MANUAL_TONES[(c.tone ?? 0) % MANUAL_TONES.length]
            : TONE[c.kind];
        const cls = `inline-flex items-center border px-2 py-0.5 text-[11px] leading-tight rounded-sm ${tone}`;
        // 手动挂的主题标签**永远**可点进专题页（它本来就是从 tags 表里挑的，专题页一定
        // 存在，而且 slug 是从库里带过来的真值）。自动填的特征词只在详情页可点，且沿用
        // 原有的「拿 label 当 slug」——那条路本来就只对纯 ASCII 标签有效，不在本次改动范围内。
        const linkSlug = c.kind === "tag_manual" ? c.slug : c.kind === "tag" && linkTags ? c.label : null;
        if (linkSlug) {
          return (
            <Link
              key={`${c.kind}-${c.label}-${i}`}
              to="/tags/$slug"
              params={{ slug: linkSlug }}
              title={c.title}
              className={`${cls} hover:border-ink hover:text-ink transition-colors`}
            >
              {c.label}
            </Link>
          );
        }
        return (
          <span key={`${c.kind}-${c.label}-${i}`} title={c.title} className={cls}>
            {c.label}
          </span>
        );
      })}
    </div>
  );
}
