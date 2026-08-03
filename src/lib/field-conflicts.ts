import { speciesKey } from "./plants";
import type { PlantSourceClaim } from "./edits";

// ─── 合并后的「矛盾」检测 ────────────────────────────────────────────────────
//
// 用户 2026-08-01 选定的方式：**结构化字段比对**，不通读正文、不花 AI token。
// 理由是可复现、误报低 —— 一个天天在正文上误报的红框，编辑三天就学会无视它，
// 那还不如没有。散文正文里的说法（花期几月、有没有毒的细节）这里覆盖不到，
// 日后要覆盖再单独叠一层，别把这一层做糊。
//
// 比的是：**本条目（plants 行）** 与 **每一份来源草稿** 在同名字段上的说法。
// 一株被补拍多次、多人识别再合并进来时，各人填的科属/学名/中文名可能互相打架 ——
// 那正是合并把矛盾藏起来的地方：页面只显示条目自己那一份，另外几种说法悄悄消失了。
//
// 🔴 判定一律**从宽**（宁可漏报不可误报）：
//   · 学名比归一化后的「属+种」（speciesKey），命名人后缀差异不算矛盾；
//   · 科/属/中文名一方包含另一方就不算（「禾本科」vs「禾本科 Poaceae」是同一个意思）；
//   · 俗名是多值列表，天然各写各的 —— 只有两边都非空且**完全没有交集**才算矛盾。

export type ConflictField =
  | "scientific_name"
  | "family"
  | "genus"
  | "title"
  | "common_name_en"
  | "common_names_zh";

export type FieldConflict = {
  field: ConflictField;
  label: string;
  /** 各方说法。第一条永远是本条目自己。 */
  values: { value: string; from: string }[];
};

const LABELS: Record<ConflictField, string> = {
  scientific_name: "学名",
  family: "科",
  genus: "属",
  title: "中文名",
  common_name_en: "英文俗名",
  common_names_zh: "中文俗名",
};

const norm = (s: string | null | undefined) =>
  (s ?? "").replace(/[*_]/g, " ").replace(/\s+/g, " ").trim();

/** 「疑似泽芹」和「泽芹」是同一个说法 —— 疑似只是识别当时的把握程度，不是异议。 */
const stripTentative = (s: string) => s.replace(/^疑似\s*/, "");

const lower = (s: string) => s.toLowerCase();

/** 一方包含另一方就当同一个说法（「禾本科」⊂「禾本科 Poaceae」）。 */
function sameish(a: string, b: string) {
  const x = lower(a);
  const y = lower(b);
  return x === y || x.includes(y) || y.includes(x);
}

/** 多值俗名 → 集合。分隔符中英文逗号、顿号、斜杠都算。 */
function toSet(s: string) {
  return new Set(
    s
      .split(/[,，、/]/)
      .map((t) => lower(norm(t)))
      .filter(Boolean),
  );
}

function disjoint(a: Set<string>, b: Set<string>) {
  for (const x of a) if (b.has(x)) return false;
  return true;
}

/** 两个说法算不算互相打架。空值一律不算（没填 ≠ 有异议）。 */
function conflicts(field: ConflictField, a: string, b: string): boolean {
  if (!a || !b) return false;
  if (field === "scientific_name") {
    const ka = speciesKey(a);
    const kb = speciesKey(b);
    return !!ka && !!kb && ka !== kb;
  }
  if (field === "common_names_zh" || field === "common_name_en") {
    const sa = toSet(a);
    const sb = toSet(b);
    return sa.size > 0 && sb.size > 0 && disjoint(sa, sb);
  }
  if (field === "title") return !sameish(stripTentative(a), stripTentative(b));
  return !sameish(a, b);
}

/**
 * 本条目 vs 各来源草稿。返回的每条矛盾里，`values[0]` 是本条目自己的说法，
 * 后面是与它打架的来源；同一个说法有多个来源时合并成一条，来源用「、」连起来。
 */
export function detectFieldConflicts(
  plant: {
    title?: string | null;
    scientific_name?: string | null;
    family?: string | null;
    genus?: string | null;
    common_name_en?: string | null;
    common_names_zh?: string | null;
  },
  sources: PlantSourceClaim[],
): FieldConflict[] {
  const out: FieldConflict[] = [];
  const fields = Object.keys(LABELS) as ConflictField[];

  for (const field of fields) {
    const mine = norm(plant[field]);
    if (!mine) continue;
    // 说法 → 谁说的（同一个说法多人说就并到一行，别让红框刷屏）。
    const others = new Map<string, string[]>();
    for (const s of sources) {
      const theirs = norm(s[field]);
      if (!conflicts(field, mine, theirs)) continue;
      const prev = others.get(theirs) ?? [];
      prev.push(s.from);
      others.set(theirs, prev);
    }
    if (!others.size) continue;
    out.push({
      field,
      label: LABELS[field],
      values: [
        { value: mine, from: "本条目" },
        ...[...others.entries()].map(([value, froms]) => ({ value, from: froms.join("、") })),
      ],
    });
  }
  return out;
}
