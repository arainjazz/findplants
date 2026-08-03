import { PLANT_ENTRY_KIND_META, type PlantEntryKind } from "@/lib/plants";

/**
 * 已收录档案的三色类别标 —— 🟢AI 快速识别 / 🔵银叶科普 / 🟠skill 创建详页。
 *
 * 与草稿页、条目页那一栏「站内已有该物种的内容」**共用同一套颜色**
 * （components/species-existing-links.tsx）。读者在列表里看到的绿/蓝/橙，
 * 点进条目页、再点到同物种的其它成品，一路都是同一个意思，别在任何一处换色。
 *
 * 注意与 `EntryTypeBadge` 的分工：那个是**管理面**的分法（金叶一键 / HTML 详页 /
 * AI 识别简略 / 富文本），给管理页和个人主页看运营口径；这个是**读者面**的三类。
 */
export function PlantKindBadge({
  kind,
  className = "",
}: {
  kind: PlantEntryKind;
  className?: string;
}) {
  const meta = PLANT_ENTRY_KIND_META[kind];
  return (
    <span
      className={`inline-block border px-1.5 py-0.5 text-[10px] rounded-sm whitespace-nowrap ${meta.cls} ${className}`}
    >
      {meta.label}
    </span>
  );
}
