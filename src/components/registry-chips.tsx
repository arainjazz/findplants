import { Link } from "@tanstack/react-router";
import type { RegistryChip, RegistryChipKind } from "@/lib/conservation";

/**
 * The registry chip row: one chip per registry a plant matched (国家/省级重点保护 ·
 * CITES · GTS · GRIIS · 地区植物名录 · tag 标签). Rendered on the draft page and the
 * published detail page; the 简介摘要卡 (server HTML) and the 分享卡 (canvas) draw the
 * same chips through their own renderers, so a species reads identically everywhere.
 */

/** Per-registry colour. Warnings (入侵) read red, protection reads green, the rest neutral. */
const TONE: Record<RegistryChipKind, string> = {
  protected: "border-leaf-deep/50 bg-leaf-deep/10 text-leaf-deep",
  cites: "border-[#7a5cc4]/50 bg-[#7a5cc4]/10 text-[#5f45a3]",
  gts: "border-[#c79a3a]/60 bg-[#c79a3a]/10 text-[#8a6a20]",
  griis: "border-vermilion/50 bg-vermilion/10 text-vermilion",
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
        const cls = `inline-flex items-center border px-2 py-0.5 text-[11px] leading-tight rounded-sm ${TONE[c.kind]}`;
        if (c.kind === "tag" && linkTags) {
          return (
            <Link
              key={`${c.kind}-${c.label}-${i}`}
              to="/tags/$slug"
              params={{ slug: c.label }}
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
