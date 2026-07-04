import { entryType, type EntrySource } from "@/lib/plants";

const STYLES: Record<EntrySource, string> = {
  ai_identify: "border-emerald-600 text-emerald-700",
  html_upload: "border-ink/40 text-ink-soft",
  gold_oneclick: "border-[#a9821f] text-[#a9821f] bg-[#e3b94e]/10",
  manual: "border-ink/25 text-ink-faint",
};

/** Small pill distinguishing AI识别简略 / HTML详页 / 金叶一键创建 / 富文本. */
export function EntryTypeBadge({
  plant,
  className = "",
}: {
  plant: { source?: string | null; content_type?: string | null };
  className?: string;
}) {
  const { key, label } = entryType(plant);
  return (
    <span
      className={`inline-block border px-2 py-0.5 text-[11px] rounded-sm whitespace-nowrap ${STYLES[key]} ${className}`}
    >
      {label}
    </span>
  );
}
