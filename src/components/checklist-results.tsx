import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { BookMarked, CircleCheck, MapPin } from "lucide-react";
import { searchChecklistFn, type ChecklistHit } from "@/lib/name-authority.functions";

// ─── 「已收录档案检索」里的名录结果 ──────────────────────────────────────────
//
// 本站条目搜完之后，再把《中国植物物种名录 2026》搜一遍。意义有两层：
//   ① **搜旧名也能搜到**。名录含 7.2 万条异名，用户拿老书上的名字来搜，
//      服务端会把异名换成正名再去重（见 searchChecklistFn），不至于一无所获。
//   ② **一眼看出空白**。`in_site` 标出哪些名录里有、本站还没做 ——
//      这正是把一份国家级名录接进检索页的全部意义：它是选题清单。

export function ChecklistResults({ q }: { q: string }) {
  const search = useServerFn(searchChecklistFn);
  const query = q.trim();

  const { data: hits = [], isLoading } = useQuery<ChecklistHit[]>({
    queryKey: ["checklist-search", query],
    // 两个字以下不查：单字会命中几千条，既慢又没用。
    enabled: query.length >= 2,
    queryFn: () => search({ data: { q: query, limit: 40 } }),
    staleTime: 5 * 60_000,
  });

  if (query.length < 2) return null;
  if (isLoading)
    return <p className="py-6 text-center text-xs text-ink-faint">正在检索名录…</p>;
  if (!hits.length) return null;

  const missing = hits.filter((h) => !h.in_site);
  const present = hits.filter((h) => h.in_site);

  return (
    <section className="mt-10 border-t border-rule pt-6">
      <div className="mb-3 flex flex-wrap items-baseline gap-2">
        <h2 className="label flex items-center gap-1.5 text-vermilion">
          <BookMarked className="h-3.5 w-3.5" />
          中国植物物种名录 2026
        </h2>
        <p className="text-xs text-ink-faint">
          命中 {hits.length} 个物种
          {missing.length > 0 && <> · 其中 <b className="text-ink">{missing.length}</b> 个本站尚无条目</>}
        </p>
      </div>

      <ul className="divide-y divide-rule border-y border-rule">
        {[...missing, ...present].map((h) => (
          <li key={h.name_code ?? h.name_key} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 py-2.5">
            <span className="font-medium">{h.chinese_name ?? "（无中文名）"}</span>
            <i className="text-sm text-ink-faint">{h.scientific_name}</i>
            {h.family_zh && (
              <span className="text-xs text-ink-faint">
                {h.family_zh} {h.family_la}
              </span>
            )}
            {h.distribution_zh && (
              <span className="inline-flex items-center gap-1 text-xs text-ink-faint">
                <MapPin className="h-3 w-3" />
                {h.distribution_zh.length > 28 ? h.distribution_zh.slice(0, 28) + "…" : h.distribution_zh}
              </span>
            )}
            <span className="ml-auto shrink-0">
              {h.in_site ? (
                <span className="inline-flex items-center gap-1 text-xs text-green-700">
                  <CircleCheck className="h-3.5 w-3.5" />
                  本站已收录
                </span>
              ) : (
                <span className="rounded-full border border-dashed border-rule px-2 py-0.5 text-xs text-ink-faint">
                  待收录
                </span>
              )}
            </span>
          </li>
        ))}
      </ul>
      <p className="mt-2 text-xs text-ink-faint">
        名录含 47,469 个接受名 + 72,838 条异名；用旧名搜索也会自动折算到正名。
      </p>
    </section>
  );
}
