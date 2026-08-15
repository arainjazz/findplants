// Display-time enhancement for AI draft HTML shown in the draft detail iframe.
//
// Works for BOTH newly generated drafts (whose template already carries the
// responsive CSS and `data-default-img` markers) and older drafts (which don't).
// We inject, at view time:
//   1. a responsive <style> so the body fills small screens, and styles for the
//      "click to replace" affordance;
//   2. a runtime <script> that marks every section illustration (`img.sec-img`)
//      with a stable data-slot index, draws a dashed "default image" hint over
//      the ones still showing the captured photo, and postMessages clicks up to
//      the parent window so React can open the replace dialog.
//
// The iframe must be sandboxed with `allow-scripts` for the injected script to
// run. The replaceable set and ordering here MUST match replaceImageInDraftHtml.

import { IN_PAGE_ANCHOR_CSS, neutralizeInPageAnchors } from "./in-page-anchors";

const REPLACEABLE_SELECTOR = "img.sec-img";

const VIEWER_STYLE = `<style id="pp-viewer-style">
/* 防溢出兜底（真机微信/WKWebView 尤其需要）：iframe 内文档的 viewport=device-width，
   真机上偶尔按设备宽而非 iframe 宽布局，宽图/宽表就横向撑破屏幕。这里强制任何媒体元素
   不超出容器、并禁掉文档级横向滚动。覆盖新旧所有草稿（drafts.$id 渲染都过 enhance）。 */
html,body{max-width:100%;overflow-x:hidden;}
/* iframe 自适应高度的**前提条件**：草稿模板给 body 设了 min-height:100vh
   （plant-html-template.ts，独立成页时是对的）。但在 iframe 里，100vh = 父层刚按上一次
   上报值设定的 iframe 高度 → body 至少这么高 → 再加 margin 报回去 → 每轮又高一点，
   ResizeObserver 持续触发，永不收敛：正文与下方按钮之间裂出越来越大的空白，页面还会
   因高度反复变化而自己滚动（2026-07-21 线上实测两次）。
   这里把高度改回纯内容驱动，测量才收敛。只作用于 iframe 内预览，不影响已发布的详页。 */
html,body{height:auto!important;min-height:0!important;}
body{margin:0!important;}
img,video,iframe,table,pre{max-width:100%!important;height:auto;}
.page-wrap{max-width:100%;overflow-x:hidden;}
@media (max-width:640px){
  .page-wrap{padding:24px 16px 56px;}
  .masthead{padding:20px 0;margin-bottom:26px;}
  .masthead h1{font-size:32px;}
  .masthead .zh-title{font-size:24px;}
  .masthead .latin{font-size:18px;}
  .tax-row{gap:10px;font-size:13px;}
  .hero{margin:28px 0 36px;gap:22px;}
  .sec-rule{margin:32px 0 16px;gap:10px;}
  .sec-rule .sec-num{font-size:28px;width:32px;}
  .sec-rule h2{font-size:20px;}
  .sec-rule .en{display:none;}
  .section-body p{font-size:15px;}
  .name-origin{padding:16px 16px;}
  .name-origin .no-title{letter-spacing:.12em;font-size:11px;}
  /* 入侵警示卡片头部在窄屏换行，避免「入侵等级」徽章被 overflow:hidden 裁掉。 */
  .invasive-card .ic-head{flex-wrap:wrap;gap:8px 12px;padding:14px 16px;}
  .invasive-card .ic-head h2{font-size:19px;}
  .invasive-card .ic-badge{margin-left:0;order:3;flex-basis:100%;white-space:normal;}
  .invasive-card .ic-body{padding:16px;}
  .invasive-card .ic-national,.invasive-card .ic-cite{margin-left:16px;margin-right:16px;}
}
.pp-replaceable{position:relative;display:block;cursor:pointer;}
.pp-replaceable img{cursor:pointer;}
.pp-replaceable.pp-default img{outline:2px dashed #c0392b;outline-offset:-3px;}
.pp-replaceable.pp-default:hover img{outline-color:#e05540;}
${IN_PAGE_ANCHOR_CSS}
.pp-hint{position:absolute;top:8px;left:50%;transform:translateX(-50%);max-width:92%;background:rgba(192,57,43,.92);color:#fff;font-size:11px;font-weight:600;padding:4px 10px;border-radius:3px;pointer-events:none;font-family:'Noto Serif SC',system-ui,sans-serif;white-space:nowrap;box-shadow:0 2px 6px rgba(0,0,0,.22);}
</style>`;

const VIEWER_SCRIPT = `<script>(function(){
  try {
    var imgs = Array.prototype.slice.call(document.querySelectorAll('${REPLACEABLE_SELECTOR}'));
    if (!imgs.length) return;
    var anyMarked = !!document.querySelector('[data-default-img]');
    imgs.forEach(function(img, i){
      img.setAttribute('data-slot', String(i));
      var isDefault = img.hasAttribute('data-default-img') || !anyMarked;
      var wrap = document.createElement('span');
      wrap.className = 'pp-replaceable' + (isDefault ? ' pp-default' : '');
      if (img.parentNode) { img.parentNode.insertBefore(wrap, img); }
      wrap.appendChild(img);
      if (isDefault) {
        var hint = document.createElement('span');
        hint.className = 'pp-hint';
        hint.textContent = '此处为默认配图，可点击替换';
        wrap.appendChild(hint);
      }
      wrap.addEventListener('click', function(e){
        e.preventDefault();
        try {
          window.parent.postMessage({
            type: 'plantspedia:replace-image',
            slot: i,
            src: img.getAttribute('src') || ''
          }, '*');
        } catch (err) {}
      });
    });
  } catch (err) {}

  // Report content height to the parent so it can size the iframe to fit, letting
  // the whole page scroll naturally instead of trapping scroll inside the iframe
  // (which on mobile makes the summary card + footer feel like they "block" the body).
  // **绝不能用 documentElement.scrollHeight**：它不小于视口高，而视口高就是父层刚刚按上一次
  // 上报值设定的 iframe 高度；再叠加 body 的 margin，每轮就把「上一轮高度 + margin」重新报回去，
  // ResizeObserver 又让它持续触发 → iframe 无限变高，正文和下方按钮之间裂出一片越来越大的空白
  // （2026-07-21 线上实测：金叶按钮被越推越远，几乎点不到）。
  // 正确做法：只量 body 自身的内容盒 + 外边距，这个值与视口无关，因此是收敛的。
  var ppLastH = 0;
  function ppPostHeight(){
    try {
      var body = document.body;
      if (!body) return;
      var rect = body.getBoundingClientRect();
      var cs = window.getComputedStyle(body);
      var mt = parseFloat(cs.marginTop) || 0;
      var mb = parseFloat(cs.marginBottom) || 0;
      var h = Math.ceil(rect.height + mt + mb);
      // 再加一道阈值保险：高度没有实质变化就不上报，避免任何残余的回授循环。
      if (h > 0 && Math.abs(h - ppLastH) > 1) {
        ppLastH = h;
        window.parent.postMessage({ type: 'plantspedia:height', height: h }, '*');
      }
    } catch (e) {}
  }
  ppPostHeight();
  window.addEventListener('load', ppPostHeight);
  window.addEventListener('resize', ppPostHeight);
  Array.prototype.forEach.call(document.images || [], function(im){
    if (im && !im.complete) { im.addEventListener('load', ppPostHeight); im.addEventListener('error', ppPostHeight); }
  });
  try { new ResizeObserver(ppPostHeight).observe(document.body); } catch (e) {}
  setTimeout(ppPostHeight, 300);
  setTimeout(ppPostHeight, 1200);
})();</script>`;

/**
 * 摘掉「已经换上真图的槽位」里残留的「暂无该物种的…公开照片」说明。
 *
 * 缺器官照片时，模板给该槽位留一个空 `<img class="sec-img" hidden src="">` + 一行
 * `<p class="img-missing">暂无…</p>`（plant-html-template.ts）。**但 `hidden` 在这里
 * 是不起作用的**：`.sec-img{display:block}` 是作者样式，压得住 UA 的 `[hidden]`；真正
 * 让空槽不显示的是 `img.sec-img[src=""]{display:none}`。于是编辑一旦给这个槽位换上真图
 * （右键换图 / 点击替换 / 小P蛙换图 —— 三条路都能通过 figure 找到那个隐藏的 img），
 * 图片立刻显示出来，而下面那句「暂无…照片」却还在，等于图旁边写着「没有图」
 * （2026-07-26 用户反馈）。
 *
 * 纯字符串实现（不用 DOMParser）：视图层、客户端保存、服务端收录发布三处都要用它，
 * 而服务端（Cloudflare Workers）没有 DOM。判据只有一条：figure 里的 img 有非空 src。
 */
export function stripStaleMissingNotes(html: string): string {
  if (!html || !/img-missing/i.test(html)) return html;
  return html.replace(/<figure\b[^>]*>[\s\S]*?<\/figure>/gi, (fig) => {
    const tag = fig.match(/<img\b[^>]*>/i)?.[0];
    if (!tag) return fig;
    const src = tag.match(/\ssrc\s*=\s*["']([^"']*)["']/i)?.[1]?.trim();
    if (!src) return fig; // 仍是空槽 —— 那句说明是对的，必须留着
    const fixedTag = tag
      .replace(/\sdata-missing-organ\s*=\s*["'][^"']*["']/gi, "")
      .replace(/\shidden(?=[\s/>])/gi, "");
    return fig
      .replace(tag, () => fixedTag)
      .replace(/<p\b[^>]*class\s*=\s*["'][^"']*\bimg-missing\b[^"']*["'][^>]*>[\s\S]*?<\/p>/gi, "");
  });
}

/**
 * 摘要卡页尾那句**只在草稿页上成立**的提示，改写成已收录条目上说得通的话。
 *
 * 起因（2026-07-31 用户实测）：「采纳快速识别简介」会把草稿的 html_content 原样发布成
 * 条目正文，于是条目页上印着「点击『让 AI 生成进一步介绍草稿』可生成含多张配图的完整
 * 科普草稿」—— 可那个按钮长在**草稿页**上，条目页根本没有，读者点无可点。
 * 线上 12 个 `source=ai_identify` 条目里有 3 个是这样。
 *
 * 两处都要用：**发布时**改写（新条目干净），**渲染时**也改写（存量的 3 条不必迁移）。
 * 纯字符串实现 —— 发布那一步跑在 Cloudflare Workers 上，没有 DOM。
 */
export function rewriteDraftOnlyHints(html: string): string {
  if (!html || !html.includes("简介摘要卡")) return html;
  return html.replace(
    /<p[^>]*>\s*—\s*简介摘要卡（点击「让 AI 生成进一步介绍草稿」[^<]*）\s*<\/p>/g,
    '<p style="color:#8a6b4a;font-size:13px">— 简介摘要卡 · 由 AI 快速识别生成，尚未撰写完整正文</p>',
  );
}

// ─── 编辑诊断意见（「疑似」草稿被采纳时必填）─────────────────────────────────
//
// 规则（用户 2026-08-08 定的）：AI 判为「疑似」的草稿进了待审名单之后，编辑**必须**先写
// 一段诊断意见才能采纳；意见要随条目一起发布进正文；发布出来的条目上不再挂「疑似」字样。
//
// 三个函数都是**纯字符串**实现（不用 DOMParser）：采纳发布跑在 Cloudflare Workers 上，
// 那里没有 DOM；而草稿页渲染时也要用同一套，两边必须给出一模一样的结果。

/** 正文里那块诊断意见的锚点。用它做幂等：同一份 HTML 反复处理不会插出第二块。 */
export const EDITOR_DIAGNOSIS_MARK = "data-editor-diagnosis";

const escHtml = (s: string) =>
  String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

/** 「疑似」前缀 / 后缀（与 lib/tentative.ts 同一套判据，这里只作用在 HTML 文本上）。 */
const TENT_PREFIX = /^(\s*)(?:[（(]\s*)?疑似(?:\s*[)）])?\s*/;

/**
 * 把正文里表示**结论**的那几处「疑似」字样摘掉。
 *
 * 只动结论面（`<title>` / `<h1>` / 图片 alt / 开头那段摘要），**不动**下方「识别过程」
 * 那一栏里各模型自评的措辞 —— 那是当时发生过的事实记录，改掉就成了伪造留痕；诊断意见块
 * 里那句「最终定种以本意见为准」已经把两者的关系说清楚了。
 */
export function stripTentativeFromHtml(html: string): string {
  if (!html || !html.includes("疑似")) return html;
  let out = html;
  // ① <title> 与所有 <h1>：标题里的「疑似X」→「X」，顺带摘掉「疑似」专用的红色。
  out = out.replace(/<(title|h1)\b([^>]*)>([\s\S]*?)<\/\1>/gi, (_m, tag, attrs, inner) => {
    const cleanAttrs = String(attrs).replace(/\s*;?\s*color\s*:\s*#c8452f\s*;?/gi, (hit) =>
      hit.trim().endsWith(";") && hit.trim().startsWith(";") ? ";" : "",
    );
    return `<${tag}${cleanAttrs}>${String(inner).replace(TENT_PREFIX, "$1")}</${tag}>`;
  });
  // ② 图片 alt（摘要卡把标题原样写进了每张图的 alt）。
  out = out.replace(/\salt\s*=\s*"([^"]*)"/gi, (m, v) => {
    const cleaned = String(v).replace(TENT_PREFIX, "$1");
    return cleaned === v ? m : ` alt="${cleaned}"`;
  });
  // ③ 开头那段摘要：只处理**第一个**以「疑似」起头的段落 —— 那是本条的结论。
  //    正文里「疑似某某种」这类正常表述不动（那是植物学描述，不是结论）：所以还要挡一道
  //    「疑似」后面紧跟 种/类/物种/近似 的情况 —— 剥掉会把「疑似种的区分要点」写成
  //    「种的区分要点」，把话说坏。挡下的段落不算数，继续往后找真正的结论段。
  let done = false;
  out = out.replace(/<p\b([^>]*)>(\s*(?:[（(]\s*)?疑似[\s\S]*?)<\/p>/gi, (m, attrs, inner) => {
    if (done) return m;
    const stripped = String(inner).replace(TENT_PREFIX, "$1");
    if (/^\s*(?:种|类|物种|近似|同属)/.test(stripped)) return m;
    done = true;
    return `<p${attrs}>${stripped}</p>`;
  });
  return out;
}

/** 诊断意见块本身。独立导出，草稿页预览与服务端发布共用同一份排版。 */
export function editorDiagnosisHtml(d: {
  text: string;
  editorName: string;
  date: string;
}): string {
  const paras = String(d.text || "")
    .split(/\n{1,}/)
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => `<p style="margin:0 0 .5em">${escHtml(s)}</p>`)
    .join("");
  return (
    `\n<section ${EDITOR_DIAGNOSIS_MARK}="1" style="max-width:680px;margin:1.6rem auto 0;padding:1rem 1.1rem;` +
    `border:1px solid #2d6a4f;border-left-width:5px;border-radius:8px;background:#2d6a4f0f;` +
    `font-size:.95em;line-height:1.75;color:#25402f">` +
    `<p style="margin:0 0 .5em;font-weight:700;color:#2d6a4f">编辑诊断意见</p>` +
    paras +
    `<p style="margin:.6em 0 0;font-size:.85em;color:#5d6b60">` +
    `—— ${escHtml(d.editorName)} · ${escHtml(d.date)} 复核采纳。` +
    `本条目的定种以此意见为准；下方「识别过程」栏保留 AI 初判的原始记录。</p>` +
    `</section>`
  );
}

/**
 * 采纳「疑似」草稿时对正文做的全部加工：摘掉结论上的「疑似」+ 把诊断意见插进正文。
 *
 * 插入位置按文档形态择优：整页文档插在 `</body>` 前；摘要卡那种裸 `<div>` 插在最后一个
 * `</div>` 前（这样它落在限宽容器**里**，不会通栏）；都没有就直接接在末尾。
 */
export function applyEditorDiagnosis(
  html: string,
  d: { text: string; editorName: string; date: string },
): string {
  const body = stripTentativeFromHtml(String(html || ""));
  if (!String(d.text || "").trim()) return body;
  if (body.includes(EDITOR_DIAGNOSIS_MARK)) return body; // 幂等：已经插过就不再插
  const block = editorDiagnosisHtml(d);
  if (/<\/body>/i.test(body)) return body.replace(/<\/body>/i, `${block}\n</body>`);
  const lastDiv = body.lastIndexOf("</div>");
  if (lastDiv >= 0) return body.slice(0, lastDiv) + block + body.slice(lastDiv);
  return body + block;
}

/** Inject responsive CSS + the click-to-replace runtime into a draft document. */
export function enhanceDraftHtmlForViewing(html: string): string {
  if (!html) return html;
  // 先清掉「有图却仍写着暂无照片」的旧草稿（库里已经存成这样的那些）——视图层兜底，
  // 保证用户现在就看不到这条自相矛盾的说明，不必等编辑再保存一次。
  let out = stripStaleMissingNotes(html);
  // 页内锚点（`<a href="#…">`）在这里比条目页更危险：草稿预览的 iframe 是
  // `sandbox="allow-scripts allow-popups"`，**没有 allow-same-origin**，父窗口根本读不到
  // contentDocument，也就无从拦截点击。一旦草稿正文里带上锚点（金叶正文并进来就会），
  // 点一下 iframe 就被导航成 about:srcdoc#… 的一屏源码乱码。拆掉 href 让它彻底不导航。
  out = neutralizeInPageAnchors(out);
  out = out.includes("</head>")
    ? out.replace("</head>", () => VIEWER_STYLE + "</head>")
    : VIEWER_STYLE + out;
  out = out.includes("</body>")
    ? out.replace("</body>", () => VIEWER_SCRIPT + "</body>")
    : out + VIEWER_SCRIPT;
  return out;
}

/**
 * DOM 版的「摘掉空槽痕迹」：给某个 img 换上真图后，把它自己的缺图标记与同一个 figure 里
 * 的「暂无…公开照片」说明一起清掉。三条换图路径共用（点击替换 / 编辑器右键 / 小P蛙换图），
 * 判断标准与 stripStaleMissingNotes 完全一致。
 */
export function clearMissingOrganMarkers(img: Element): void {
  try {
    if (!(img.getAttribute("src") || "").trim()) return; // 还是空槽，说明得留着
    img.removeAttribute("data-missing-organ");
    img.removeAttribute("hidden");
    const host = img.closest("figure") ?? img.parentElement;
    host?.querySelectorAll("p.img-missing").forEach((p) => p.remove());
  } catch {
    /* 非致命：清不掉也只是多一行说明，不能因此中断换图 */
  }
}

/**
 * Replace the Nth replaceable section image's src in a draft document and clear
 * its "default" marker. Selector/order must match the viewer script so the slot
 * index lines up. Client-only (uses DOMParser). Returns original html on failure.
 */
export function replaceImageInDraftHtml(html: string, slot: number, newUrl: string): string {
  try {
    const doc = new DOMParser().parseFromString(html, "text/html");
    const imgs = Array.from(doc.querySelectorAll(REPLACEABLE_SELECTOR));
    const img = imgs[slot] as HTMLImageElement | undefined;
    if (!img) return html;
    img.setAttribute("src", newUrl);
    img.removeAttribute("data-default-img");
    // 这个槽位本来可能是「缺器官照片」的空槽：换上真图后，缺图标记和那句
    // 「暂无该物种的…公开照片」必须一并摘掉，否则图旁边写着「没有图」。
    clearMissingOrganMarkers(img);
    return "<!DOCTYPE html>\n" + doc.documentElement.outerHTML;
  } catch {
    return html;
  }
}

/**
 * 这份正文是**完整 HTML 文档**还是一段**片段**？
 *
 * 「快速识别简介卡」那一档的 `plant_drafts.html_content` 是
 * `buildSummaryCardHtml` 吐的一个裸 `<div>`；「采纳快速识别简介」还会把同一段片段
 * 原样发布成条目正文，所以线上的 `plants` 里也躺着这种页面
 * （STATE 2026-07-31：`source=ai_identify` 的 12 条里有 3 条）。
 *
 * 小P蛙的两条改写通道从前在**进出两头**都硬卡 `</html>`：进来报「HTML 不完整，
 * 无法自动修改」，出去报「小P 生成的内容不完整」—— 于是这一类正文根本改不了
 * （2026-08-08 用户实测报的就是前一条）。
 */
export function isFullHtmlDoc(html: string): boolean {
  return /<html[\s>]/i.test(html);
}

/**
 * 收下模型改写后的 HTML：剥掉 markdown 围栏，并按**原文的形态**校验/还原 ——
 * 原文是完整文档就必须还是完整文档；原文是片段，而模型（很常见）好心包了一整篇
 * `<html><body>…`，就把 `<body>` 里的内容取回来，免得片段被塞进正文后嵌套出一个
 * 文档套文档的畸形结构。
 *
 * 形态不对时抛错，**不做静默降级** —— 半截 HTML 存进去比报错糟得多。
 */
export function normalizeRewrittenHtml(raw: string, fullDoc: boolean): string {
  let html = raw.trim();
  if (html.startsWith("```")) {
    html = html
      .replace(/^```html\s*/i, "")
      .replace(/^```\s*/, "")
      .replace(/```$/, "")
      .trim();
  }
  const incomplete = new Error("小P 生成的内容不完整，请重试或换种说法。");
  if (fullDoc) {
    if (!/<\/html>/i.test(html)) throw incomplete;
    return html;
  }
  const body = html.match(/<body\b[^>]*>([\s\S]*?)<\/body>/i);
  html = body ? body[1].trim() : html.replace(/<!DOCTYPE[^>]*>/i, "").trim();
  if (!html.includes("<")) throw incomplete;
  return html;
}
