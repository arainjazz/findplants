/**
 * 小P蛙「换图方案」的纯函数层 —— 把一句「用第一张和第六张替换 section II 和 section V
 * 的配图」变成对 HTML 字符串的确定性改写。
 *
 * 为什么不交给大模型重写整页 HTML：改一个 src 让模型吐一整页，既贵又会顺手改坏别处
 * （replace-image-flow.tsx 顶部那段注释是同一个理由）。这里全部用字符串定位 + 定点改写，
 * 零 token、可离线测（见 scratch/xiaop-image-plan.test.mjs）。
 *
 * ⚠️ 线上同时存在**两套模板**，两套都要认（2026-08-08 对着 scratch/_sample_page.html 核过）：
 *
 *   A. ccplants 技能 / 批量录入产出：
 *      `<div class="sec-rule"><span class="sec-num"><i>II</i></span>
 *         <div class="sec-titles"><h2>典型生境</h2><span class="en">…</span></div></div>`
 *      图槽 `<div class="img-slot" data-slot-name="hab-panorama"><img …></div>`
 *
 *   B. premium-page.ts 服务端产出：
 *      `<h2 class="sec"><span class="num">II</span><span>典型生境</span><span class="en">…</span></h2>`
 *      图槽 `<figure class="img-slot" data-label="hab-panorama"><img …></figure>`，
 *      **空槽是 `<div class="img-slot broken">`，里面根本没有 `<img>`**（premium-page.ts:667）
 *      —— 空槽也必须能被表达、被填上，否则「第 II 节没图，帮我补一张」永远做不到。
 */

// ── 类型 ─────────────────────────────────────────────────────────────────────

/** 一个可替换的图槽。`start`/`end` 是它在原 HTML 字符串里的区间（用于定点改写）。 */
export type SectionSlot = {
  /** 章节号，原样保留大小写前的形态："Intro" / "I" / "II" / "§" / ""（页首无章节）。 */
  section: string;
  /** 章节中文标题，如「典型生境」。取不到时为空串。 */
  sectionLabel: string;
  /** 图槽自己的标签（data-label / data-slot-name），如 "hab-panorama"。 */
  label: string;
  /** 当前图片地址；空槽为空串。 */
  src: string;
  /** 全文第几个图槽，0 起。 */
  index: number;
  /** 这一节里的第几个图槽，0 起。 */
  indexInSection: number;
  /** 空槽（`.img-slot.broken` 里没有 `<img>`）。可被填图，不是不可替换。 */
  empty: boolean;
  start: number;
  end: number;
};

/** 模型给出的一条替换意向：把参考图第 `photo` 张（1 起）放进 `section` 这一节。 */
export type ImagePlanItem = {
  /** 参考图序号，**1 起**，按对话里展示的先后顺序数。 */
  photo: number;
  /** 章节标识："II" / "2" / "第二节" / "典型生境" / "hab-panorama" 都认。 */
  section: string;
  /** 该节内第几张图（1 起）。缺省 = 该节里还没被本方案用掉的第一张。 */
  slot?: number;
};

export type PlanPhoto = {
  url: string;
  title?: string;
  /** 摄影者 / 许可证 / 来源。换图必须连署名一起换 —— 见 rewriteSlot 里的说明。 */
  credit?: string;
};

export type PlanChange = {
  section: string;
  sectionLabel: string;
  label: string;
  oldUrl: string;
  newUrl: string;
  /** 全文图槽序号，0 起。 */
  index: number;
  photo: number;
};

export type PlanSkip = { item: ImagePlanItem; reason: string };

// ── HTML 扫描 ────────────────────────────────────────────────────────────────

/** 不需要闭合标签的元素 —— 深度计数时必须跳过，否则一遇到 `<img>` 就永远配不平。 */
const VOID_TAGS = new Set([
  "area",
  "base",
  "br",
  "col",
  "embed",
  "hr",
  "img",
  "input",
  "link",
  "meta",
  "param",
  "source",
  "track",
  "wbr",
]);

/**
 * 属性值匹配。**必须按引号种类配对**，不能图省事写成 `["'][^"']*["']`：
 * 模板里的 `onerror="this.parentElement.classList.add('broken')"` 值内部就带单引号，
 * 那种写法会在第一个 `'` 处截断 —— 摘 onerror 时留下半截 `broken')"` 挂在 <img> 上，
 * 属性表当场坏掉。（2026-08-08 拿 premium-page 真实产出跑出来的，手写 fixture 没照出来。）
 */
const attrPattern = (name: string, flags: string) =>
  new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s"'>]+))`, flags);

const attrOf = (tag: string, name: string): string => {
  const m = tag.match(attrPattern(name, "i"));
  return m ? (m[1] ?? m[2] ?? m[3] ?? "") : "";
};

const stripTags = (s: string): string =>
  s
    .replace(/<[^>]*>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();

/**
 * 从 `openStart`（某个开标签的起点）找到它的配对闭合标签之后的位置。
 * 用一个只数**非空元素**的深度计数器扫，足够应付这两套模板里 figure/div 混嵌的情况；
 * 配不平（HTML 残缺）时退回「到下一个同名闭合标签为止」。
 */
function elementEnd(html: string, openStart: number, tagName: string): number {
  const re = /<(\/?)([a-zA-Z][a-zA-Z0-9-]*)\b([^>]*)>/g;
  re.lastIndex = openStart;
  let depth = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const closing = m[1] === "/";
    const name = m[2].toLowerCase();
    const selfClosing = m[3].trimEnd().endsWith("/");
    if (VOID_TAGS.has(name) || selfClosing) continue;
    if (!closing) {
      depth++;
    } else {
      depth--;
      if (depth <= 0) return m.index + m[0].length;
    }
  }
  // 配不平：至少别把后面整篇文章都吞进这个槽里。
  const fallback = html.indexOf(`</${tagName}>`, openStart);
  return fallback >= 0 ? fallback + tagName.length + 3 : html.length;
}

type Marker = { at: number; section: string; label: string };

/**
 * 从标题文字里读出前缀编号：「II. 典型生境」「2、典型生境」「第二节 典型生境」。
 * **分隔符是必须的** —— 不要求的话 `[IVXLC]` 这个字符集会把 "Livestock" 读成
 * 「第 Liv 节 · estock」，页面上一个正常英文标题就凭空变成一个章节号。
 */
function numFromTitle(title: string): { section: string; label: string } {
  const m = title.match(
    /^\s*(?:第\s*)?([IVXivx]{1,5}|\d{1,2}|[一二三四五六七八九十]{1,3})\s*[.、·:：)）节章]\s*(\S.*)$/,
  );
  if (!m) return { section: "", label: title };
  if (toOrdinal(m[1]) == null) return { section: "", label: title };
  return { section: m[1], label: m[2].trim() };
}

/**
 * 扫出全文的章节标记（两套模板 + 裸标题兜底），按出现顺序。
 *
 * 🔴 **有编号的标记出现过，就只认有编号的**：feat-card / 博物趣闻里满是 `<h3>`，
 * 若把它们也当章节，Section I 底下第三张特征图就会被归到「叶背的绒毛」这种小标题名下，
 * 「换 Section I 的图」当场失灵。整页一个编号都没有（手写页）时才退回按标题分节。
 */
function listMarkers(html: string): Marker[] {
  const out: Marker[] = [];
  const takenHeadings = new Set<number>();

  // 模板 A：`<span class="sec-num"><i>II</i></span>` + 后面不远处的 `<h2>标题</h2>`。
  const secNumRe =
    /<span[^>]*class\s*=\s*["'][^"']*\bsec-num\b[^"']*["'][^>]*>([\s\S]{0,80}?)<\/span>/gi;
  let m: RegExpExecArray | null;
  while ((m = secNumRe.exec(html))) {
    const tail = html.slice(m.index, m.index + 600);
    const hm = tail.match(/<h[1-3][^>]*>([\s\S]*?)<\/h[1-3]>/i);
    if (hm) takenHeadings.add(m.index + hm.index!);
    out.push({ at: m.index, section: stripTags(m[1]), label: hm ? stripTags(hm[1]) : "" });
  }

  // 模板 B + 裸标题：每个 <h1..h3>。
  const hRe = /<(h[1-3])\b[^>]*>([\s\S]*?)<\/\1>/gi;
  while ((m = hRe.exec(html))) {
    if (takenHeadings.has(m.index)) continue; // 模板 A 已经登记过这个标题
    const inner = m[2];
    const numM = inner.match(
      /<span[^>]*class\s*=\s*["'][^"']*\bnum\b[^"']*["'][^>]*>([\s\S]*?)<\/span>/i,
    );
    if (numM) {
      // 模板 B：num 之后的第一个非 `.en` span 是中文标题。
      const rest = inner.slice(numM.index! + numM[0].length);
      const zhM = rest.match(/<span(?![^>]*class\s*=\s*["'][^"']*\ben\b)[^>]*>([\s\S]*?)<\/span>/i);
      out.push({
        at: m.index,
        section: stripTags(numM[1]),
        label: zhM ? stripTags(zhM[1]) : stripTags(rest),
      });
      continue;
    }
    const parsed = numFromTitle(stripTags(inner));
    out.push({ at: m.index, section: parsed.section, label: parsed.label });
  }

  out.sort((a, b) => a.at - b.at);
  const numbered = out.filter((mk) => mk.section);
  return numbered.length ? numbered : out;
}

/**
 * 列出全文可替换的图槽，按章节归位。
 *
 * 找不到任何 `.img-slot` 容器时（手写页 / 别处来的 HTML）退回「每个 `<img>` 算一个槽」，
 * 这样至少还能按章节定位，不会整条功能哑掉。
 */
export function listSectionSlots(html: string): SectionSlot[] {
  if (!html) return [];
  const markers = listMarkers(html);
  const sectionAt = (pos: number): Marker => {
    let cur: Marker = { at: -1, section: "", label: "" };
    for (const mk of markers) {
      if (mk.at < pos) cur = mk;
      else break;
    }
    return cur;
  };

  type Raw = { start: number; end: number; label: string; imgTag: string | null; imgAt: number };
  const raws: Raw[] = [];

  const slotRe = /<(figure|div)\b([^>]*\bclass\s*=\s*["'][^"']*\bimg-slot\b[^"']*["'][^>]*)>/gi;
  let m: RegExpExecArray | null;
  while ((m = slotRe.exec(html))) {
    const start = m.index;
    if (raws.some((r) => start < r.end && start >= r.start)) continue; // 嵌套槽，取外层
    const end = elementEnd(html, start, m[1].toLowerCase());
    const openTag = m[0];
    const inner = html.slice(start + openTag.length, end);
    const imgM = inner.match(/<img\b[^>]*>/i);
    raws.push({
      start,
      end,
      // 槽自己没标签时用图的 alt 兜底 —— 草稿模板的 `<div class="img-slot">` 是光的，
      // 不兜底的话这个槽除了「它在哪一节」之外没有任何可称呼的名字。
      label:
        attrOf(openTag, "data-label") ||
        attrOf(openTag, "data-slot-name") ||
        (imgM ? attrOf(imgM[0], "data-label") || attrOf(imgM[0], "alt") : ""),
      imgTag: imgM ? imgM[0] : null,
      imgAt: imgM ? start + openTag.length + imgM.index! : -1,
    });
    slotRe.lastIndex = end;
  }

  // 不在任何 img-slot 容器里的**裸 `<img>`** 也算槽。
  //
  // 🔴 这一段从前是「一个 img-slot 都没找到才跑」的整体兜底，是错的：草稿模板
  // （drafts.$id 这一半的正文）恰好是**混着**的 —— 访客实拍照裹在一个光 `<div class="img-slot">`
  // 里，而五张分节配图是裸的 `<img class="sec-img">`。于是那一个槽把兜底整个挡掉，
  // 全页 6 张图只认出 1 张（2026-08-08 拿线上蒺藜页实测出来的）。改成**增量**收集。
  const imgRe = /<img\b[^>]*>/gi;
  while ((m = imgRe.exec(html))) {
    const at = m.index;
    if (raws.some((r) => at >= r.start && at < r.end)) continue; // 已被某个槽收走
    const src = attrOf(m[0], "src");
    if (src.startsWith("data:")) continue; // 内联图标之类，不是配图
    // src="" 的**空**图位要留着（草稿模板的「该器官暂无照片」就长这样，
    // hidden + src=""）—— 那正是最该被补图的地方。
    raws.push({
      start: at,
      end: at + m[0].length,
      label: attrOf(m[0], "data-label") || attrOf(m[0], "alt"),
      imgTag: m[0],
      imgAt: at,
    });
  }
  raws.sort((a, b) => a.start - b.start);

  const perSection = new Map<string, number>();
  return raws.map((r, i) => {
    const mk = sectionAt(r.start);
    const key = `${mk.section}|${mk.label}`;
    const n = perSection.get(key) ?? 0;
    perSection.set(key, n + 1);
    const src = r.imgTag ? attrOf(r.imgTag, "src") : "";
    return {
      section: mk.section,
      sectionLabel: mk.label,
      label: r.label,
      src,
      index: i,
      indexInSection: n,
      // 「没有图」而不是「没有 <img> 标签」：草稿模板的空位是有标签、src 为空的。
      empty: !src,
      start: r.start,
      end: r.end,
    };
  });
}

// ── 章节匹配 ─────────────────────────────────────────────────────────────────

const CN_NUM: Record<string, number> = {
  一: 1,
  二: 2,
  三: 3,
  四: 4,
  五: 5,
  六: 6,
  七: 7,
  八: 8,
  九: 9,
  十: 10,
};
const ROMAN: Record<string, number> = {
  I: 1,
  II: 2,
  III: 3,
  IV: 4,
  V: 5,
  VI: 6,
  VII: 7,
  VIII: 8,
  IX: 9,
  X: 10,
  XI: 11,
  XII: 12,
};

/** 把「II」「2」「二」「section ii」「第二节」都归成同一个数字；不是编号则返回 null。 */
function toOrdinal(raw: string): number | null {
  const s = raw
    .replace(/section|sec\.?|chapter|part/gi, "")
    .replace(/[第节章部分.、·:：\s]/g, "")
    .trim()
    .toUpperCase();
  if (!s) return null;
  if (/^\d{1,2}$/.test(s)) return Number(s);
  if (ROMAN[s] != null) return ROMAN[s];
  if (s.length <= 3 && [...s].every((c) => CN_NUM[c] != null)) {
    if (s.length === 1) return CN_NUM[s];
    if (s === "十一") return 11;
    if (s === "十二") return 12;
    return CN_NUM[s[0]] ?? null;
  }
  return null;
}

const norm = (s: string): string => s.replace(/\s+/g, "").toLowerCase();

/** 这个 key 指的是不是这个槽所属的章节。 */
function slotMatches(slot: SectionSlot, key: string): boolean {
  const k = key.trim();
  if (!k) return false;
  const wantN = toOrdinal(k);
  const haveN = toOrdinal(slot.section);
  if (wantN != null && haveN != null && wantN === haveN) return true;
  // "Intro" / "§" 这类非数字章节号：直接比字符串。
  if (norm(k) && norm(k) === norm(slot.section)) return true;
  // 中文标题（「典型生境」）或图槽标签（「hab-panorama」/「蒺藜 拍摄照片」）。
  // 两个字以上才做包含匹配 —— 单字（「叶」）会同时命中一堆槽，宁可判不出来。
  const nk = norm(k);
  if (nk.length >= 2) {
    if (
      slot.sectionLabel &&
      (norm(slot.sectionLabel).includes(nk) || nk.includes(norm(slot.sectionLabel)))
    )
      return true;
    if (slot.label && (norm(slot.label).includes(nk) || nk.includes(norm(slot.label)))) return true;
  }
  return false;
}

/** 该 key 命中的所有图槽（按全文顺序）。 */
export function slotsForSection(slots: SectionSlot[], key: string): SectionSlot[] {
  return slots.filter((s) => slotMatches(s, key));
}

// ── 定点改写 ─────────────────────────────────────────────────────────────────

const escAttr = (s: string): string =>
  String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/"/g, "&quot;");

/** 从一个开标签的 class 里摘掉失败态类；顺带保证它不再被 CSS 藏起来。 */
function unbreakOpenTag(openTag: string): string {
  return openTag.replace(attrPattern("class", "i"), (...args: unknown[]) => {
    const cls = String(args[1] ?? args[2] ?? args[3] ?? "");
    const kept = cls
      .split(/\s+/)
      .filter((c) => c && c !== "broken" && c !== "no-organ")
      .join(" ");
    return ` class="${kept}"`;
  });
}

/**
 * 把一个 `<img>` 标签改指到新地址。
 *
 * 这里逐条对应 html-doc-editor.tsx:349 那三个「提示已替换、画面纹丝不动」的成因：
 * `srcset`/`sizes` 会压过 `src`；模板写死的 `onerror` 会在一次加载失败后把图**永久**藏起来；
 * `loading=lazy` 让新图要滚到才出现。换图之后这三样都没有意义了，一并摘掉。
 */
function rewriteImgTag(tag: string, url: string, alt?: string): string {
  let out = tag;
  for (const name of ["srcset", "sizes", "onerror", "onload", "loading", "width", "height"]) {
    out = out.replace(attrPattern(name, "gi"), "");
  }
  out = out.replace(/\shidden(?=[\s/>])/gi, "");
  const srcRe = attrPattern("src", "i");
  out = srcRe.test(out)
    ? out.replace(srcRe, ` src="${escAttr(url)}"`)
    : out.replace(/^<img\b/i, `<img src="${escAttr(url)}"`);
  if (alt) {
    const altRe = attrPattern("alt", "i");
    out = altRe.test(out)
      ? out.replace(altRe, ` alt="${escAttr(alt)}"`)
      : out.replace(/^<img\b/i, `<img alt="${escAttr(alt)}"`);
  }
  return out;
}

/**
 * 把一个图槽（含空槽）整体改写成指向新图的样子。
 *
 * 🔴 **署名和图注必须跟着一起换**。premium-page.ts 的图槽里带两条 figcaption：
 * `.img-credit`（摄影者/许可证，这些照片多为 CC BY-NC 等要求署名的许可，见 slot() 注释）
 * 和 `.img-note`（「此为近缘种照片」这类关于**这一张**的降级说明）。只换 src 不动它们，
 * 页面就会把新照片明明白白地署到另一个摄影者名下 —— 比不署名更糟。
 * 拿不到新照片的署名时，宁可把旧署名整条摘掉，也不留一条确定错误的。
 */
function rewriteSlot(
  html: string,
  slot: SectionSlot,
  url: string,
  alt?: string,
  credit?: string,
): string {
  const block = html.slice(slot.start, slot.end);
  // 裸 `<img>` 槽（草稿模板的 `<img class="sec-img">`）：整个 block 就是那个标签本身，
  // 没有容器可言。不先分流的话，下面会把它当"开标签"、发现"容器里没有图"，
  // 于是在它**前面**再插一张新图 —— 页面上凭空多出一张，旧图纹丝不动。
  if (/^<img\b/i.test(block)) {
    return html.slice(0, slot.start) + rewriteImgTag(block, url, alt) + html.slice(slot.end);
  }
  const openM = block.match(/^<[a-zA-Z][^>]*>/);
  if (!openM) return html;
  const openTag = openM[0];
  let rest = block.slice(openTag.length);
  // `<picture>` 里任何一个 `<source>` 命中都会让 img 的 src 失效 —— 全部去掉。
  rest = rest.replace(/<source\b[^>]*>/gi, "");
  const imgM = rest.match(/<img\b[^>]*>/i);
  if (imgM) {
    rest =
      rest.slice(0, imgM.index!) +
      rewriteImgTag(imgM[0], url, alt) +
      rest.slice(imgM.index! + imgM[0].length);
  } else {
    // 空槽：premium-page 的 `.img-slot.broken` 里连 `<img>` 都没有，现建一个。
    rest = `<img src="${escAttr(url)}" alt="${escAttr(alt || "配图")}"/>` + rest;
  }
  // 旧图的降级说明说的是旧那一张，留着就是错的。
  rest = rest.replace(
    /<figcaption\b[^>]*class\s*=\s*["'][^"']*\bimg-note\b[^"']*["'][^>]*>[\s\S]*?<\/figcaption>/gi,
    "",
  );
  const creditRe =
    /<figcaption\b[^>]*class\s*=\s*["'][^"']*\bimg-credit\b[^"']*["'][^>]*>[\s\S]*?<\/figcaption>/gi;
  const newCredit = (credit || "").trim();
  if (creditRe.test(rest)) {
    creditRe.lastIndex = 0;
    rest = newCredit
      ? rest.replace(creditRe, `<figcaption class="img-credit">${escAttr(newCredit)}</figcaption>`)
      : rest.replace(creditRe, "");
  } else if (newCredit) {
    rest = rest.replace(
      /<\/(figure|div)>\s*$/i,
      `<figcaption class="img-credit">${escAttr(newCredit)}</figcaption></$1>`,
    );
  }
  return html.slice(0, slot.start) + unbreakOpenTag(openTag) + rest + html.slice(slot.end);
}

/**
 * 执行一份换图方案。**从后往前**改写，这样前面槽的 start/end 不会被前一次改写的
 * 长度变化带偏（先改前面的话，后面所有下标就全错位了）。
 */
export function applyImagePlan(
  html: string,
  plan: ImagePlanItem[],
  photos: PlanPhoto[],
): { html: string; changes: PlanChange[]; skipped: PlanSkip[] } {
  const slots = listSectionSlots(html);
  const changes: PlanChange[] = [];
  const skipped: PlanSkip[] = [];
  const usedSlots = new Set<number>();
  const picked: {
    slot: SectionSlot;
    url: string;
    alt?: string;
    credit?: string;
    photo: number;
  }[] = [];

  for (const item of plan) {
    const photo = photos[item.photo - 1];
    if (!photo?.url) {
      skipped.push({ item, reason: `没有第 ${item.photo} 张参考图` });
      continue;
    }
    const cands = slotsForSection(slots, item.section);
    if (!cands.length) {
      skipped.push({ item, reason: `没找到「${item.section}」这一节的配图位` });
      continue;
    }
    let target: SectionSlot | undefined;
    if (item.slot && item.slot > 0) {
      target = cands[item.slot - 1];
      if (!target) {
        skipped.push({ item, reason: `「${item.section}」这一节没有第 ${item.slot} 张图` });
        continue;
      }
      if (usedSlots.has(target.index)) {
        skipped.push({
          item,
          reason: `「${item.section}」第 ${item.slot} 张图在本方案里被指定了两次`,
        });
        continue;
      }
    } else {
      // 同一节被指了多次时依次往后取，不要两条都砸在第一张上。
      target = cands.find((c) => !usedSlots.has(c.index));
      if (!target) {
        skipped.push({ item, reason: `「${item.section}」这一节的配图位已经用完` });
        continue;
      }
    }
    usedSlots.add(target.index);
    picked.push({
      slot: target,
      url: photo.url,
      alt: photo.title,
      credit: photo.credit,
      photo: item.photo,
    });
  }

  let out = html;
  for (const p of [...picked].sort((a, b) => b.slot.start - a.slot.start)) {
    out = rewriteSlot(out, p.slot, p.url, p.alt, p.credit);
  }
  // changes 按全文顺序回报，读起来才像「从上往下换了这几处」。
  for (const p of [...picked].sort((a, b) => a.slot.start - b.slot.start)) {
    changes.push({
      section: p.slot.section,
      sectionLabel: p.slot.sectionLabel,
      label: p.slot.label,
      oldUrl: p.slot.src,
      newUrl: p.url,
      index: p.slot.index,
      photo: p.photo,
    });
  }
  return { html: out, changes, skipped };
}

/** 人话描述一条方案，给面板上的确认清单用。 */
export function describePlanItem(item: ImagePlanItem, slots: SectionSlot[]): string {
  const cands = slotsForSection(slots, item.section);
  const target = item.slot && item.slot > 0 ? cands[item.slot - 1] : cands[0];
  const where = target
    ? `${target.section ? target.section + " · " : ""}${target.sectionLabel || target.label || "配图"}`
    : item.section;
  const which = cands.length > 1 ? `第 ${item.slot || 1} 张配图` : "配图";
  return `参考图第 ${item.photo} 张 → ${where} 的${which}`;
}

/** 一句话总结改了哪几处，写进修改记录用。 */
export function summarizeChanges(changes: PlanChange[]): string {
  return changes
    .map(
      (c) =>
        `${c.section || "页首"}${c.sectionLabel ? "·" + c.sectionLabel : ""}${c.label ? "(" + c.label + ")" : ""}：${c.oldUrl || "（空槽）"} → ${c.newUrl}`,
    )
    .join("；");
}
