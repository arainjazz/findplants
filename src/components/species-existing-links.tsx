import { useEffect, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { SafeImg } from "@/components/safe-img";
import { PLACE_COARSENED_EXPLAIN } from "@/lib/protected-coords";
import { enhanceDraftHtmlForViewing } from "@/lib/draft-enhance";
import { fetchDraftById } from "@/lib/drafts";
import {
  lookupSpeciesExisting,
  type SpeciesExisting,
  type SpeciesExistingEntry,
  type SpeciesExistingItem,
  type SpeciesExistingKind,
} from "@/lib/species-existing.functions";

// ─── 「站内已有该物种的内容」──────────────────────────────────────────────────
//
// **草稿页和已收录条目页共用同一个块**（2026-07-31 起）。以前它只长在草稿页上，
// 于是「采纳快速识别简介」之后落成的条目页上什么去向都没有 —— 而那份 HTML 的页尾偏偏
// 还印着「点击『让 AI 生成进一步介绍草稿』」，指向一个那一页上根本不存在的按钮。
//
// 颜色 = 内容的**来源类别**，不是「草稿还是条目」（用户 2026-07-31 定的规矩）：
//   · 🟢 绿框「x 识别的快速简介卡」
//   · 🔵 蓝框「x 创建的银叶科普」
//   · 🟠 橙框「x 创建的金叶 skill 创建详页」（编辑手工上传的 skill 页同色，只是不写「金叶」）
// 之前橙框是「一切 plants 行」的意思，于是银叶草稿采纳成的条目（假连翘）被涂成橙色写作
// 「科普详页」——它其实是银叶科普；分类改判后同一份内容也不会再蓝橙各出现一次。
//
// 点击行为：**未收录的银叶草稿**就地展开、不跳页（这条是用户 2026-07-30 定的，理由是跳过去
// 会让人以为换了一份草稿）；已收录成条目的一律跳详页——那是它的正式家，有评论和修改记录。
//
// 一类有好几份时（2026-08-09）：按钮不再直接把人带去其中某一份，而是**展开成一行一份的列表**。
// 从前每类只给 `entries[0]` 一个入口、后缀却写着「共 2 份」（拂子茅 4 份内容只点得到 2 份），
// 数字与入口对不上。每行带缩略图 + 已收录/草稿 + 作者 + 时间 + 综合可信度 + 拍摄地点
// —— 同物种的几份多半是不同人在不同地点拍的，光有标题分辨不出谁是谁。
// 地点写的是**坐标反查出来的地名**，不摆经纬度数字（用户 2026-08-11）；重点保护名录里的
// 物种例外 —— 那一栏由服务端粗化到区/县/旗，防盗挖，见 lib/protected-coords.ts。

/**
 * 未收录的银叶科普草稿的**就地展开**视图。
 *
 * 为什么不跳到 `/drafts/$id`（用户 2026-07-30 的要求）：那一份草稿讲的是同一株植物，
 * 跳过去会让人以为换了一份草稿，看完还得自己找路回来；而它真正的用处是「顺着往下读」。
 *
 * 「不允许出现莫名其妙的页面空白区」这条同样是要求：iframe 高度**完全由内容决定** ——
 * 草稿正文里注入的 viewer 脚本会 postMessage 一个真实高度上来，量到之前只给一个很矮的
 * 骨架（不是 550px 的占位），量到之后一像素都不多撑。
 */
export function InlineEnrichedDraft({
  draftId,
  onClose,
}: {
  draftId: string;
  onClose: () => void;
}) {
  const frameRef = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState<number | null>(null);
  /** 高度消息迟迟没来（沙箱里脚本被拦、消息丢了…）→ 退成一个可以内部滚动的框。 */
  const [heightTimedOut, setHeightTimedOut] = useState(false);
  const { data, isLoading, isError } = useQuery({
    queryKey: ["draft", draftId],
    queryFn: () => fetchDraftById(draftId),
    staleTime: 5 * 60_000,
  });

  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      const el = frameRef.current;
      if (!el || e.source !== el.contentWindow) return;
      const d = e.data as { type?: string; height?: number };
      if (d?.type === "plantspedia:height" && typeof d.height === "number" && d.height > 0) {
        setHeight(Math.min(Math.ceil(d.height), 200000));
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);
  // 换一份草稿就把量到的高度丢掉，否则新内容会先按旧高度撑一下再跳。
  useEffect(() => {
    setHeight(null);
    setHeightTimedOut(false);
  }, [draftId]);
  // 高度靠 iframe 里的脚本 postMessage 上来（沙箱无 allow-same-origin，父窗口读不到
  // contentDocument，这是唯一的通道）。消息万一没到，**绝不能让那 240px 的骨架把正文
  // 截断** —— 3 秒还没量到就退成可滚动的框：内容一句不少，也不会裂出空白。
  useEffect(() => {
    if (height != null) return;
    const t = setTimeout(() => setHeightTimedOut(true), 3000);
    return () => clearTimeout(t);
  }, [height, draftId]);

  const html = data?.html_content;
  return (
    <div className="mt-2 border border-sky-600/40 rounded-lg overflow-hidden bg-background">
      <div className="flex items-center justify-between gap-3 px-3 py-2 bg-sky-500/10 border-b border-sky-600/25">
        <p className="text-[12px] font-bold text-sky-900 truncate">
          银叶科普 · {data?.title || "加载中…"}
        </p>
        <div className="flex items-center gap-3 shrink-0">
          <Link
            to="/drafts/$id"
            params={{ id: draftId }}
            className="text-[11px] text-sky-800 underline underline-offset-2 hover:text-sky-950"
          >
            单独打开
          </Link>
          <button
            type="button"
            onClick={onClose}
            className="text-[11px] text-ink-faint hover:text-ink cursor-pointer"
          >
            收起
          </button>
        </div>
      </div>
      {isLoading ? (
        <p className="px-3 py-4 text-[12px] text-ink-faint">正在载入这份草稿…</p>
      ) : isError || !html ? (
        <p className="px-3 py-4 text-[12px] text-ink-faint">
          这份草稿暂时读不出来。可以点上面的「单独打开」再试。
        </p>
      ) : (
        <iframe
          ref={frameRef}
          title={data?.title || "银叶科普"}
          srcDoc={enhanceDraftHtmlForViewing(html)}
          sandbox="allow-scripts allow-popups"
          // 量到真高度就随内容长，量不到就让它自己能滚 —— 两种情况都不会截断内容。
          scrolling={height ? "no" : heightTimedOut ? "auto" : "no"}
          className="w-full border-0 block"
          // 量到真高度之前只给 240px 骨架 —— 给 550px 那种占位，内容一旦更矮
          // 就会在下面裂出一片没人解释得了的空白，那正是这次要根除的东西。
          style={
            height
              ? { height: `${height}px` }
              : heightTimedOut
                ? { height: "70vh" }
                : { height: "240px" }
          }
        />
      )}
    </div>
  );
}

/** 每类的配色与说法。三种颜色是用户定死的，改这里就等于改规矩，别顺手换。 */
export const SPECIES_EXISTING_STYLE: Record<
  SpeciesExistingKind,
  { verb: string; noun: string; cls: string }
> = {
  quick: {
    verb: "识别的",
    noun: "快速简介卡",
    cls: "border-leaf/50 bg-leaf/10 text-leaf-deep hover:bg-leaf hover:text-background",
  },
  silver: {
    verb: "创建的",
    noun: "银叶科普",
    cls: "border-sky-600/50 bg-sky-500/10 text-sky-800 hover:bg-sky-600 hover:text-background",
  },
  gold: {
    verb: "创建的",
    noun: "金叶 skill 创建详页",
    cls: "border-amber-600/50 bg-amber-500/10 text-amber-700 hover:bg-amber-600 hover:text-background",
  },
  // 编辑用 skill 做好后手工上传的页：同样橙色，但没花过金叶，不能挂「金叶」两个字。
  skill: {
    verb: "创建的",
    noun: "skill 科普详页",
    cls: "border-amber-600/50 bg-amber-500/10 text-amber-700 hover:bg-amber-600 hover:text-background",
  },
};

/** 「吉木创建的银叶科普：假连翘」。查不到作者名时就只留后半截。 */
export function speciesExistingLabel(item: SpeciesExistingItem, fallbackTitle?: string | null) {
  const s = SPECIES_EXISTING_STYLE[item.kind];
  const who = item.author ? `${item.author}${s.verb}` : "";
  return `${who}${s.noun}：${item.title || fallbackTitle || "同物种内容"}`;
}

/** 「（共 3 份 · 2 位用户）」—— 只有一份时不写，省得每个按钮后面都拖一条废话。 */
export function speciesExistingCountSuffix(item: SpeciesExistingItem) {
  if (item.count <= 1) return "";
  return `（共 ${item.count} 份${item.userCount > 1 ? ` · ${item.userCount} 位用户` : ""}）`;
}

/** 未收录的银叶草稿 = 唯一一个「点了不跳页、就地展开」的去向。 */
function isInlineItem(item: SpeciesExistingItem) {
  return item.kind === "silver" && !!item.draftId;
}

/** 列表里的一行，是不是那种「点了就地展开、不跳页」的银叶草稿。 */
function isInlineEntry(kind: SpeciesExistingKind, entry: SpeciesExistingEntry) {
  return kind === "silver" && !!entry.draftId;
}

/**
 * 显示到「分」（用户 2026-08-11）。同一天同一个人连拍好几份是常事（一次外出、
 * 一株植物补拍两三轮），只写到「日」时那几行连时间都一模一样，分不出先后。
 */
function formatWhen(iso: string | null) {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/**
 * 地点那一行的解释（保护物种才有）。行上只挂一把锁、不写整句话 —— 一行清单塞不下，
 * 而且那句话对读者的用处远不如地名本身；hover / 读屏能拿到完整说明。
 */
const COARSENED_HINT = PLACE_COARSENED_EXPLAIN;

/**
 * 「共 N 份」展开后的一行。
 *
 * 区分信息：缩略图、已收录/未收录草稿、作者+时间、综合可信度（2026-08-09 选的四样，
 * 时间那项 08-11 精确到「分」）＋ 拍摄地点。
 * **分两行摆**：第一行是短的（状态·作者·时间·可信度），第二行让给会很长的地点 ——
 * 挤成一行时地名一长，可信度就被 `truncate` 吃掉了，而那正是用来挑哪一份的关键数字。
 *
 * 🔒 地点是**服务端**给的对外值：保护物种到这里已经粗化过（`placeCoarsened`），
 * 行上挂一把锁 + hover 解释。经纬度这一层压根拿不到，也不该拿到（见 SpeciesExistingEntry）。
 * 缩略图走 SafeImg —— 草稿照片被清理掉的情况真发生过（2026-07-13 那次），不能让列表里
 * 裂出一排碎图标。
 */
function SpeciesExistingEntryRow({
  kind,
  entry,
  fallbackTitle,
  inlineOpen,
  onInline,
}: {
  kind: SpeciesExistingKind;
  entry: SpeciesExistingEntry;
  fallbackTitle?: string | null;
  /** 这一行就是当前就地展开着的那份银叶草稿。 */
  inlineOpen: boolean;
  onInline: (draftId: string) => void;
}) {
  const s = SPECIES_EXISTING_STYLE[kind];
  const meta = [
    entry.published ? "已收录" : "未收录草稿",
    entry.author,
    formatWhen(entry.createdAt),
    // 借不到来源草稿的条目就是 null —— 不显示，绝不编一个数出来。
    entry.confidencePct != null ? `可信度 ${entry.confidencePct}%` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  const base = `text-[12px] border px-2.5 py-2 rounded-sm transition-colors flex items-center gap-2.5 w-full text-left ${s.cls}`;
  const body = (
    <>
      <SafeImg
        src={entry.thumb}
        className="w-9 h-9 object-cover rounded-sm shrink-0"
        loading="lazy"
        fallback={<span className="w-9 h-9 rounded-sm bg-paper-deep/60 shrink-0" />}
      />
      <span className="min-w-0 flex-1">
        <span className="block truncate font-medium">
          {entry.title || fallbackTitle || "同物种内容"}
        </span>
        <span className="block truncate text-[11px] opacity-70">{meta}</span>
        {entry.place && (
          <span
            className="block truncate text-[11px] opacity-60"
            title={entry.placeCoarsened ? COARSENED_HINT : undefined}
          >
            {entry.place}
            {entry.placeCoarsened && <span aria-hidden> 🔒</span>}
          </span>
        )}
      </span>
      {isInlineEntry(kind, entry) && <span aria-hidden>{inlineOpen ? "▲" : "▼"}</span>}
    </>
  );

  if (isInlineEntry(kind, entry)) {
    return (
      <button
        type="button"
        onClick={() => onInline(entry.draftId!)}
        aria-expanded={inlineOpen}
        className={`${base} cursor-pointer`}
      >
        {body}
      </button>
    );
  }
  return entry.draftId ? (
    <Link to="/drafts/$id" params={{ id: entry.draftId }} className={base}>
      {body}
    </Link>
  ) : (
    <Link to="/plants/$slug" params={{ slug: entry.slug! }} className={base}>
      {body}
    </Link>
  );
}

/**
 * 那一块。`existing` 由调用方查好传进来 —— 草稿页本来就在查它（还要给关分享卡时那个
 * 面板用），条目页则自己查一次（见下面的 `useSpeciesExistingForPlant`）。
 *
 * `fallbackTitle`：库里那份草稿没有标题时的兜底显示名，通常传当前页面的物种名。
 */
export function SpeciesExistingLinks({
  existing,
  fallbackTitle,
  className,
  open,
  onOpenChange,
  defaultOpen = false,
}: {
  existing: SpeciesExisting | null | undefined;
  fallbackTitle?: string | null;
  className?: string;
  /** 受控展开态。草稿页要用：关分享卡时弹的那个面板上也有一个「进一步科普页」按钮，
   *  点它要把这里展开。不传就用组件自己的内部状态。 */
  open?: boolean;
  onOpenChange?: (v: boolean) => void;
  /** 🟢 快速识别条目页用：有银叶科普时**默认就展开在下面**，不用再点一下
   *  （用户 2026-08-01）。绿页正文只有一张摘要卡，读者要的下一步就是这份完整科普。 */
  defaultOpen?: boolean;
}) {
  const [selfOpen, setSelfOpen] = useState(defaultOpen);
  // defaultOpen 是**异步**算出来的（要先查到本条目属于哪一类），首渲染时通常还是 false，
  // 所以不能只靠 useState 的初值。变 true 时补开一次；之后用户自己收起就不再强开。
  const autoOpenedRef = useRef(false);
  useEffect(() => {
    if (defaultOpen && !autoOpenedRef.current) {
      autoOpenedRef.current = true;
      setSelfOpen(true);
    }
  }, [defaultOpen]);
  const inlineOpen = open ?? selfOpen;
  const setInlineOpen = (v: boolean) => (onOpenChange ? onOpenChange(v) : setSelfOpen(v));
  const items = existing?.items ?? [];
  // 哪一类的「共 N 份」列表正展开着（一次只开一个，几个列表同时铺开会把正文挤没）。
  const [expandedKind, setExpandedKind] = useState<SpeciesExistingKind | null>(null);
  // 列表里另点了某一份银叶草稿 → 就地展开的换成它；没点过就还是代表那份。
  const [pickedDraftId, setPickedDraftId] = useState<string | null>(null);
  const headInlineDraftId = items.find(isInlineItem)?.draftId ?? null;
  const inlineDraftId = pickedDraftId ?? headInlineDraftId;
  const expandedItem = items.find((it) => it.kind === expandedKind) ?? null;
  if (!items.length) return null;

  /** 列表里点某一份银叶草稿：再点同一份就收起，点另一份就换过去。 */
  const onPickInline = (draftId: string) => {
    if (inlineOpen && inlineDraftId === draftId) {
      setInlineOpen(false);
      return;
    }
    setPickedDraftId(draftId);
    setInlineOpen(true);
  };

  const base =
    "text-[12px] border px-3 py-1.5 rounded-sm transition-colors inline-flex items-center gap-1.5";

  return (
    <div className={className}>
      <div className="border border-rule rounded-lg p-3 bg-paper-deep/25">
        <p className="text-[12px] font-bold text-ink-soft mb-2">站内已有该物种的内容</p>
        <div className="flex flex-wrap gap-2">
          {items.map((item) => {
            const s = SPECIES_EXISTING_STYLE[item.kind];
            const suffix = speciesExistingCountSuffix(item);
            const listOpen = expandedKind === item.kind;
            const body = (
              <>
                <span>{speciesExistingLabel(item, fallbackTitle)}</span>
                {suffix && <span className="opacity-70">{suffix}</span>}
              </>
            );
            // 好几份时按钮**不再替人选一份**，而是把这一类整组摊开让人自己挑。
            // 直接带去 entries[0] 正是「写着共 2 份、只点得到 1 份」的由来。
            if (item.count > 1) {
              return (
                <button
                  key={item.kind}
                  type="button"
                  onClick={() => setExpandedKind(listOpen ? null : item.kind)}
                  aria-expanded={listOpen}
                  className={`${base} ${s.cls} cursor-pointer`}
                >
                  {body}
                  <span aria-hidden>{listOpen ? "▲" : "▼"}</span>
                </button>
              );
            }
            if (isInlineItem(item)) {
              return (
                <button
                  key={item.kind}
                  type="button"
                  onClick={() => setInlineOpen(!inlineOpen)}
                  aria-expanded={inlineOpen}
                  className={`${base} ${s.cls} cursor-pointer`}
                >
                  {body}
                  <span aria-hidden>{inlineOpen ? "▲" : "▼"}</span>
                </button>
              );
            }
            return item.draftId ? (
              <Link
                key={item.kind}
                to="/drafts/$id"
                params={{ id: item.draftId }}
                className={`${base} ${s.cls}`}
              >
                {body}
              </Link>
            ) : (
              <Link
                key={item.kind}
                to="/plants/$slug"
                params={{ slug: item.slug! }}
                className={`${base} ${s.cls}`}
              >
                {body}
              </Link>
            );
          })}
        </div>
        {expandedItem && (
          <div className="mt-2 flex flex-col gap-1.5">
            {expandedItem.entries.map((entry, i) => (
              <SpeciesExistingEntryRow
                key={entry.draftId ?? entry.slug ?? i}
                kind={expandedItem.kind}
                entry={entry}
                fallbackTitle={fallbackTitle}
                inlineOpen={inlineOpen && inlineDraftId === entry.draftId}
                onInline={onPickInline}
              />
            ))}
          </div>
        )}
      </div>
      {inlineOpen && inlineDraftId && (
        <InlineEnrichedDraft draftId={inlineDraftId} onClose={() => setInlineOpen(false)} />
      )}
    </div>
  );
}

/** 已收录条目页用：按学名查同物种的其它成品，并把**本页自己**排除掉。 */
export function useSpeciesExistingForPlant(scientificName: string | null | undefined, slug: string) {
  const lookup = useServerFn(lookupSpeciesExisting);
  return useQuery({
    queryKey: ["species-existing", "plant", scientificName, slug],
    queryFn: () =>
      lookup({
        data: { scientificName: scientificName ?? null, excludePlantSlug: slug },
      }) as Promise<SpeciesExisting>,
    enabled: !!scientificName,
    staleTime: 5 * 60_000,
  });
}
