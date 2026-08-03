import { useEffect, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { enhanceDraftHtmlForViewing } from "@/lib/draft-enhance";
import { fetchDraftById } from "@/lib/drafts";
import {
  lookupSpeciesExisting,
  type SpeciesExisting,
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
  const inlineDraftId = items.find(isInlineItem)?.draftId;
  if (!items.length) return null;

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
            const body = (
              <>
                <span>{speciesExistingLabel(item, fallbackTitle)}</span>
                {suffix && <span className="opacity-70">{suffix}</span>}
              </>
            );
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
