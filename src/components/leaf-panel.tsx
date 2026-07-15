import { LEVEL_LABEL, type LeafLevel, type LeafStats } from "@/lib/leaves";
import bronzeUrl from "@/assets/leaf-bronze.png";
import silverUrl from "@/assets/leaf-silver.png";
import goldUrl from "@/assets/leaf-gold.png";
import seniorUrl from "@/assets/leaf-senior.png";

type Tier = "bronze" | "silver" | "gold" | "senior";

const TIER_ICON: Record<Tier, string> = {
  bronze: bronzeUrl,
  silver: silverUrl,
  gold: goldUrl,
  senior: seniorUrl,
};

/** Tier badge — the Plantspedia 「P」mark with a copper / silver / gold / green
 *  (senior) leaf. Tiny transparent PNGs (~2.6KB each). Sized by height so the
 *  slightly non-square art never distorts. */
export function LeafIcon({ tier, size = 18 }: { tier: Tier; size?: number }) {
  return (
    <img
      src={TIER_ICON[tier]}
      alt=""
      aria-hidden="true"
      draggable={false}
      className="shrink-0 object-contain"
      style={{ height: size, width: "auto" }}
    />
  );
}

function levelTier(level: LeafLevel): Tier {
  if (level === "senior") return "senior";
  if (level === "gold") return "gold";
  if (level === "silver") return "silver";
  return "bronze";
}

function Row({ tier, label, value }: { tier: Tier; label: string; value: string }) {
  return (
    <li className="flex items-center gap-2">
      <LeafIcon tier={tier} />
      <span className="font-semibold tabular-nums min-w-[2.5rem]">{value}</span>
      <span className="text-ink-soft text-xs">{label}</span>
    </li>
  );
}

/**
 * The points / leaves panel shown at the top-right of 个人主页. Pure display —
 * `stats` comes from computeLeaves().
 */
export function LeafPanel({ stats, name }: { stats: LeafStats; name?: string }) {
  return (
    <aside className="border border-rule bg-paper-deep/30 p-4 rounded-sm w-full sm:w-72 shrink-0">
      <p className="label text-vermilion mb-2">积分 · Leaves</p>

      {/* Level badge */}
      <div className="flex items-center gap-2 mb-3 pb-3 border-b border-rule-soft">
        <LeafIcon tier={levelTier(stats.level)} size={28} />
        <div className="min-w-0">
          <p className="font-display text-lg font-bold leading-none">
            {LEVEL_LABEL[stats.level]}
            {stats.isOwner && <span className="ml-1 text-[10px] align-middle text-ink-faint">· 所有者</span>}
          </p>
          {name && <p className="text-[11px] text-ink-faint mt-1 truncate">{name}</p>}
        </div>
      </div>

      {/* Tallies */}
      <ul className="space-y-1.5 text-sm">
        <Row tier="bronze" label="识别铜叶" value={`×${stats.identify}`} />
        <Row tier="bronze" label="修文铜叶" value={`×${stats.text}`} />
        <Row tier="bronze" label="换图铜叶" value={`×${stats.image}`} />
        <li className="flex items-center gap-2 border-t border-rule-soft pt-1.5 mt-1.5">
          <LeafIcon tier="bronze" />
          <span className="font-bold tabular-nums min-w-[2.5rem]">×{stats.bronze}</span>
          <span className="text-ink-soft text-xs">铜叶合计</span>
        </li>
        <Row tier="silver" label="银叶" value={`×${stats.silver}`} />
        <li className="flex items-center gap-2">
          <LeafIcon tier="gold" />
          <span className="font-semibold tabular-nums min-w-[2.5rem]">{stats.goldUsed}/{stats.gold}</span>
          <span className="text-ink-soft text-xs">金叶（已用/共）</span>
        </li>
      </ul>

      {(stats.gold > 0 || stats.isOwner) && (
        <p className="text-[10px] text-ink-faint mt-2 leading-relaxed">
          可用 {isFinite(stats.goldAvailable) ? stats.goldAvailable : "∞"} 次「一键创建物种科普详页」
          {isFinite(stats.silverAvailable) ? ` · 可用 ${stats.silverAvailable} 次「生成进一步草稿」` : " · 生成草稿无限"}
        </p>
      )}

      {/* Rules */}
      <details className="mt-3">
        <summary className="text-[11px] text-vermilion cursor-pointer select-none">积分规则 ▾</summary>
        <ul className="mt-2 space-y-1 text-[11px] text-ink-soft leading-relaxed list-disc pl-4">
          <li>AI 识别一种植物 → +1 识别铜叶；每补拍一次再确认 → 多 +1（补拍 n 次成功得 1+n 枚）</li>
          <li>补拍满 3 次仍为「疑似」→ 记 1 枚铜叶（疑似结果固定 +1）</li>
          <li>编辑已收录条目的文字 → +1 修文铜叶</li>
          <li>替换已收录条目的图片 → +1 换图铜叶</li>
          <li>以上被资深编辑<b>采纳</b>后，该枚铜叶翻倍（疑似识别除外）</li>
          <li>满 10 枚铜叶自动得 1 枚银叶；满 10 枚银叶自动得 1 枚金叶</li>
          <li>1 枚银叶 = 1 次「让 AI 生成进一步介绍草稿」机会（草稿被驳回则退还）</li>
          <li>1 枚金叶 = 1 次「一键创建物种科普详页」机会</li>
          <li>等级：≥1 铜叶 = 铜叶编辑 · ≥1 银叶 = 银叶编辑 · ≥1 金叶 = 金叶编辑 · ≥10 金叶 = 资深编辑</li>
        </ul>
      </details>
    </aside>
  );
}
