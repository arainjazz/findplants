import { BadgeCheck, TriangleAlert, ArrowRightLeft } from "lucide-react";
import type { NameAlias, NameStatus } from "@/lib/name-authority";

// ─── 正名核对结论的展示 ──────────────────────────────────────────────────────
//
// 数据来自核对时写下的留痕（草稿在 `ai_payload._name_authority`，成品页在
// `plants.name_authority`）。这里**只读不算** —— 核对是服务端在内容生成那一刻
// 做完的，页面重算既拿不到名录也会让每次渲染都打一次库。
//
// 展示原则：**改过名的一定要说改了什么**。把「海韭菜」直接显示成结论、
// 却不提模型原本给的是「圆果水麦冬」，等于把一次自动改写藏起来 ——
// 万一匹配错了（fuzzy 那条路是会错的），没人看得出来。

/** 与 `NameAuthorityStamp` 同构，但字段全可选 —— 老内容没有这块留痕。 */
export type NameAuthorityStampLike = {
  status?: NameStatus | string;
  matchedBy?: string;
  aliases?: NameAlias[];
  note?: string;
  was?: { title?: string | null; scientific_name?: string | null } | null;
  source?: string;
};

/** 从任意 JSON 里把留痕挖出来。挖不到返回 null（老内容、或核对服务当时不可用）。 */
export function readNameStamp(raw: unknown): NameAuthorityStampLike | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  if (!o.status && !o.matchedBy) return null;
  return {
    status: typeof o.status === "string" ? o.status : undefined,
    matchedBy: typeof o.matchedBy === "string" ? o.matchedBy : undefined,
    aliases: Array.isArray(o.aliases) ? (o.aliases as NameAlias[]) : [],
    note: typeof o.note === "string" ? o.note : "",
    was: (o.was as NameAuthorityStampLike["was"]) ?? null,
    source: typeof o.source === "string" ? o.source : undefined,
  };
}

/** 要不要拦人工看一眼。与 name-authority.ts 的 needsReview 同口径。 */
export function stampNeedsReview(s: NameAuthorityStampLike): boolean {
  return s.status === "ambiguous" || s.matchedBy === "latin-fuzzy";
}

/** 括号里那串「异名：X；别名：Y」。按类别合并，不出现「（别名：A）（别名：B）」。 */
export function aliasText(aliases: NameAlias[] | undefined, max = 4): string {
  if (!aliases?.length) return "";
  const groups = new Map<string, string[]>();
  for (const a of aliases.slice(0, max)) {
    const g = groups.get(a.kind);
    if (g) g.push(a.name);
    else groups.set(a.kind, [a.name]);
  }
  return [...groups.entries()].map(([k, names]) => `${k}：${names.join("、")}`).join("；");
}

/**
 * 名字下面那一行核对说明。
 *
 * 四种状态各自的意思：
 *   accepted —— 与名录完全一致，只给个不打扰的小对勾
 *   synonym  —— 输入的是**名录认定的异名**，已换成正名（2026 版才有的能力）
 *   renamed  —— 中文名/科名与名录不符，已按名录改写
 *   ambiguous/unmatched —— **没有改名**，要人来定
 */
export function NameAuthorityNote({
  stamp,
  className = "",
}: {
  stamp: NameAuthorityStampLike | null;
  className?: string;
}) {
  if (!stamp?.status) return null;
  const aliases = aliasText(stamp.aliases);
  const review = stampNeedsReview(stamp);

  if (stamp.status === "accepted" && !aliases) {
    return (
      <p className={`flex items-center gap-1 text-xs text-ink-faint ${className}`}>
        <BadgeCheck className="h-3.5 w-3.5 text-green-700" />
        名称与《中国植物物种名录 2026》一致
      </p>
    );
  }

  const tone = review
    ? "border-amber-500/40 bg-amber-500/5 text-amber-800"
    : stamp.status === "synonym"
      ? "border-sky-500/40 bg-sky-500/5 text-sky-900"
      : "border-rule bg-paper-deep/20 text-ink-soft";

  const Icon = review ? TriangleAlert : stamp.status === "synonym" ? ArrowRightLeft : BadgeCheck;

  return (
    <div className={`rounded-md border px-2.5 py-1.5 text-xs leading-relaxed ${tone} ${className}`}>
      <p className="flex items-start gap-1.5">
        <Icon className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        <span>
          {aliases && <span className="font-medium">（{aliases}）</span>}
          {aliases && stamp.note ? " " : ""}
          {stamp.note}
        </span>
      </p>
      {/* 改过名就必须能看到原值 —— 否则一次错误的自动改写没人发现得了。 */}
      {(stamp.status === "renamed" || stamp.status === "synonym") && stamp.was?.scientific_name && (
        <p className="mt-1 pl-5 text-ink-faint">
          原文：{stamp.was.title ? `${stamp.was.title} ` : ""}
          <i>{stamp.was.scientific_name}</i>
        </p>
      )}
    </div>
  );
}
