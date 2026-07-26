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

/** Inject responsive CSS + the click-to-replace runtime into a draft document. */
export function enhanceDraftHtmlForViewing(html: string): string {
  if (!html) return html;
  // 先清掉「有图却仍写着暂无照片」的旧草稿（库里已经存成这样的那些）——视图层兜底，
  // 保证用户现在就看不到这条自相矛盾的说明，不必等编辑再保存一次。
  let out = stripStaleMissingNotes(html);
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
