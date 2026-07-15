import { Link } from "@tanstack/react-router";
import type { PlantDraft } from "@/lib/drafts";
import { displayPlace } from "@/lib/editor-stats";
import { SafeImg } from "@/components/safe-img";

export function DraftCard({ draft: d, showPendingBadge = false }: { draft: PlantDraft; showPendingBadge?: boolean }) {
  return (
    <div className="relative">
      {showPendingBadge && (
        <Link
          to="/drafts/$id"
          params={{ id: d.id }}
          className="absolute top-2 right-2 z-10 bg-vermilion text-background text-[10px] font-semibold uppercase tracking-wider px-2 py-1 rounded-sm shadow hover:bg-ink transition-colors"
          title="点击查看待审详情"
        >
          待审
        </Link>
      )}
      <Link
        to="/drafts/$id"
        params={{ id: d.id }}
        className="group flex gap-3 border border-rule bg-paper-deep/30 hover:border-vermilion transition-colors p-3"
      >
        <div className="w-24 h-24 sm:w-28 sm:h-28 flex-shrink-0 overflow-hidden bg-paper-deep">
          <SafeImg
            src={d.photo_url}
            alt={d.title}
            className="w-full h-full object-cover group-hover:scale-[1.04] transition-transform duration-500"
            fallback={
              <div className="w-full h-full flex items-center justify-center bg-paper-deep">
                <span className="font-display text-3xl text-leaf-deep/40">❦</span>
              </div>
            }
          />
        </div>
        <div className="min-w-0 flex-1">
          <p className="label text-[10px] text-vermilion mb-0.5">草稿 · {d.creator_label}</p>
          <h3 className="font-display text-base font-semibold leading-tight truncate group-hover:text-vermilion transition-colors">{d.title}</h3>
          {d.scientific_name && <p className="italic text-xs text-ink-faint truncate mt-0.5">{d.scientific_name}</p>}
          {d.summary && (
            <p className="text-[12px] text-ink-soft mt-1 line-clamp-3 leading-snug">{d.summary}</p>
          )}
          <p className="text-[11px] text-ink-faint mt-1.5 truncate inline-flex items-center gap-1" title={d.capture_place || undefined}>
            <svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M12 21s-7-6.2-7-11a7 7 0 0 1 14 0c0 4.8-7 11-7 11Z"/>
              <circle cx="12" cy="10" r="2.6"/>
            </svg>
            {displayPlace(d.capture_place) || "未知地点"}
          </p>
        </div>
      </Link>
    </div>
  );
}
