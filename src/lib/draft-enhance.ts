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
  function ppPostHeight(){
    try {
      var h = Math.max(
        document.documentElement ? document.documentElement.scrollHeight : 0,
        document.body ? document.body.scrollHeight : 0
      );
      if (h > 0) window.parent.postMessage({ type: 'plantspedia:height', height: h }, '*');
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

/** Inject responsive CSS + the click-to-replace runtime into a draft document. */
export function enhanceDraftHtmlForViewing(html: string): string {
  if (!html) return html;
  let out = html;
  out = out.includes("</head>")
    ? out.replace("</head>", () => VIEWER_STYLE + "</head>")
    : VIEWER_STYLE + out;
  out = out.includes("</body>")
    ? out.replace("</body>", () => VIEWER_SCRIPT + "</body>")
    : out + VIEWER_SCRIPT;
  return out;
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
    return "<!DOCTYPE html>\n" + doc.documentElement.outerHTML;
  } catch {
    return html;
  }
}
