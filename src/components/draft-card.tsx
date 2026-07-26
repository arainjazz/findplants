import { Link } from "@tanstack/react-router";
import type { PlantDraft } from "@/lib/drafts";
import { displayPlace } from "@/lib/editor-stats";
import { SafeImg } from "@/components/safe-img";

/**
 * 三档产出的判定 —— 用户看到的是同一张卡，但背后可能只跑了第一步，也可能已经跑完三步。
 * 卡片上不标出来，就只能点进去才知道这条到底做到哪了、还能不能再升。
 *
 *   快速简介  识别完就有，免费，只有寥寥几行
 *   银叶草稿  点「进一步生成草稿」产出的完整中英双语草稿（消耗 1 枚银叶）
 *   金叶详页  点「生成金叶详页」产出的三段式物种页（消耗 1 枚金叶，已进入正式收录）
 *
 * 注意：published_plant_id 在「审核通过并收录」时同样会被写上，所以第三档的准确含义是
 * 「已存在正式收录页」，不单指金叶生成 —— 标签用词按这个来，不夸大。
 */
type DraftTier = { label: string; hint: string; cls: string };

function draftTier(d: PlantDraft): DraftTier {
  // 金叶：已生成正式收录的物种详页（金叶 skill 一键落库、或草稿审核通过收录，都会写上
  //   published_plant_id）。注：待审队列里的草稿此值恒为空，这档只在已收录视图出现。
  if (d.published_plant_id)
    return {
      label: "金叶详页",
      hint: "金叶 skill 生成的物种详页 / 已正式收录",
      cls: "bg-amber-500/15 text-amber-700 border-amber-500/40",
    };
  // 银叶：点「生成进一步介绍草稿」跑出的完整中英双语正文。判据必须是 ai_payload._enriched===true。
  //   ⚠️ 绝不能用「html_content 非空」—— 快速识别也会把**简介摘要卡**写进 html_content，
  //   用长度判会把所有快速草稿全错认成银叶（正是列表里三档分不开的老 bug，STATE 2026-07-21 记过）。
  //   老草稿可能没有 _enriched 字段：仅此时才回落到「整页正文远长于摘要卡」的长度启发式。
  const enriched = d.ai_payload?._enriched;
  const looksFullPage = (d.html_content ?? "").length > 4000;
  if (enriched === true || (enriched == null && looksFullPage))
    return {
      label: "银叶草稿",
      hint: "完整中英双语草稿已生成，可再升金叶详页",
      cls: "bg-slate-400/15 text-slate-600 border-slate-400/40",
    };
  // 快速识别：只有识别出的简介摘要卡（_enriched===false，或老草稿且内容短）。
  return {
    label: "快速识别简介",
    hint: "只有识别出的简介摘要卡，尚未生成完整草稿",
    cls: "bg-leaf-deep/10 text-leaf-deep border-leaf-deep/30",
  };
}

export function DraftCard({
  draft: d,
  showPendingBadge = false,
}: {
  draft: PlantDraft;
  showPendingBadge?: boolean;
}) {
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
          <div className="flex items-center gap-1.5 mb-0.5 flex-wrap">
            <p className="label text-[10px] text-vermilion">草稿 · {d.creator_label}</p>
            {(() => {
              const t = draftTier(d);
              return (
                <span
                  title={t.hint}
                  className={`text-[9px] font-semibold px-1.5 py-0.5 rounded-sm border leading-none ${t.cls}`}
                >
                  {t.label}
                </span>
              );
            })()}
          </div>
          <h3 className="font-display text-base font-semibold leading-tight truncate group-hover:text-vermilion transition-colors">
            {d.title}
          </h3>
          {d.scientific_name && (
            <p className="italic text-xs text-ink-faint truncate mt-0.5">{d.scientific_name}</p>
          )}
          {d.summary && (
            <p className="text-[12px] text-ink-soft mt-1 line-clamp-3 leading-snug">{d.summary}</p>
          )}
          <p
            className="text-[11px] text-ink-faint mt-1.5 truncate inline-flex items-center gap-1"
            title={d.capture_place || undefined}
          >
            <svg
              viewBox="0 0 24 24"
              width="11"
              height="11"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M12 21s-7-6.2-7-11a7 7 0 0 1 14 0c0 4.8-7 11-7 11Z" />
              <circle cx="12" cy="10" r="2.6" />
            </svg>
            {displayPlace(d.capture_place) || "未知地点"}
          </p>
        </div>
      </Link>
    </div>
  );
}
