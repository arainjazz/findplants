import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { resolveFieldConflictFn, type ResolveConflictResult } from "@/lib/conflicts.functions";
import type { FieldConflict } from "@/lib/field-conflicts";

/**
 * 合并后互相打架的结构化字段 —— **红框框出来**（用户 2026-08-01）。
 *
 * 为什么读者也看得见、而不是只给编辑看：这一页的科属/学名此刻确实有两种说法，
 * 藏起来等于替读者做了个没有依据的决定。所以框对所有人可见，**「采用这个」按钮只给编辑**。
 *
 * 「采用」= 统一口径：条目和它所有来源草稿的这一字段一起改，并记进修改记录
 * （见 lib/conflicts.functions.ts 里为什么必须一起改）。
 */
export function FieldConflictsPanel({
  plantId,
  conflicts,
  canEdit,
  onResolved,
  className = "",
}: {
  plantId: string;
  conflicts: FieldConflict[];
  canEdit: boolean;
  onResolved: () => void;
  className?: string;
}) {
  const resolve = useServerFn(resolveFieldConflictFn);
  const [busy, setBusy] = useState<string | null>(null);
  if (!conflicts.length) return null;

  const apply = async (c: FieldConflict, value: string) => {
    const tag = `${c.field}:${value}`;
    setBusy(tag);
    try {
      const r = (await resolve({
        data: { plantId, field: c.field, value, was: c.values.map((v) => v.value) },
      })) as ResolveConflictResult;
      if (r.ok) {
        toast.success(`已统一「${c.label}」为「${value}」`);
        onResolved();
      } else {
        toast.error(r.reason);
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "统一口径失败");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className={className}>
      <div className="border-2 border-[#c0392b] rounded-sm bg-[#c0392b]/5 p-3">
        <p className="text-[12px] font-bold text-[#c0392b] mb-1">
          合并后存在矛盾 · {conflicts.length} 处待核对
        </p>
        <p className="text-[11px] text-ink-faint mb-2.5 leading-relaxed">
          本条目由多份来源合并而成，下面这些字段各来源说法不一致。
          {canEdit
            ? "「采用」会把条目和所有来源草稿的该字段统一为选定值，并记入修改记录。"
            : "已通知编辑核对。"}
        </p>
        <ul className="space-y-2.5">
          {conflicts.map((c) => (
            <li key={c.field} className="border-t border-[#c0392b]/25 pt-2">
              <p className="text-[12px] font-semibold text-ink-soft mb-1">{c.label}</p>
              <div className="flex flex-wrap gap-1.5">
                {c.values.map((v) => (
                  <span
                    key={v.value}
                    className="inline-flex items-center gap-1.5 border border-[#c0392b]/40 bg-background px-2 py-1 rounded-sm text-[12px]"
                  >
                    <span className="text-ink font-medium">{v.value}</span>
                    <span className="text-[10px] text-ink-faint">{v.from}</span>
                    {canEdit && (
                      <button
                        type="button"
                        disabled={busy !== null}
                        onClick={() => void apply(c, v.value)}
                        className="text-[10px] border border-[#c0392b]/60 text-[#c0392b] px-1.5 py-0.5 rounded-sm hover:bg-[#c0392b] hover:text-background transition-colors cursor-pointer disabled:opacity-40"
                      >
                        {busy === `${c.field}:${v.value}` ? "处理中…" : "采用"}
                      </button>
                    )}
                  </span>
                ))}
              </div>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
