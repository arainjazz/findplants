/**
 * 详页 iframe 里的**页内锚点**（`<a href="#section-vi">`，就是开篇那张「博物趣闻」摘要卡）。
 *
 * 🔴 为什么必须把 href 拆掉，而不是只在父窗口 `preventDefault`：
 * 条目正文是 `srcDoc` + `sandbox` 的 iframe，它的文档地址是 `about:srcdoc`。一旦
 * 页内锚点走到浏览器的默认行为，iframe 就被导航成 `about:srcdoc#…` —— 屏幕上出现的
 * 是**一屏源码乱码**，而且回不来（2026-08-15 用户报「点博物趣闻摘要卡出现乱码」）。
 * 父窗口那道 capture 拦截只在 `iframe.contentDocument` 读得到时才装得上；WebView /
 * 微信内置浏览器、或任何一次 `load` 没赶上的时机，拦截就没有了，而 href 还在。
 *
 * 所以在**送进 srcDoc 之前**就把 `href="#x"` 换成 `data-jump="x"`：没有 href 的 `<a>`
 * 在任何浏览器里都不会导航，剩下的滚动交给父窗口的点击监听（认 `[data-jump]`）。
 * 页面外链（`href="https://…"`、`mailto:`）一概不动。
 *
 * 纯字符串函数、不碰 DOM —— 详页正文是 242 份线上 HTML，整份过一遍 DOMParser 再
 * 序列化的风险远大于收益；这里只改 `<a>` 开标签里的那一个属性。
 */

/** `<a …>` 开标签里的 `href="#…"` / `href='#…'`（含空 `href="#"`）。 */
const A_TAG = /<a\b[^>]*>/gi;
const HASH_HREF = /\shref\s*=\s*(?:"(#[^"]*)"|'(#[^']*)')/i;

/**
 * 把正文里所有页内锚点的 `href="#x"` 改写成 `data-jump="x"`。
 * 外链、锚点以外的属性、以及 `<a>` 的文本内容都原样保留。
 */
export function neutralizeInPageAnchors(html: string): string {
  if (!html) return html;
  return html.replace(A_TAG, (tag) => {
    const m = HASH_HREF.exec(tag);
    if (!m) return tag;
    // 属性值来自 HTML 源码，本身已经是转义过的形式，原样搬进 data-jump 即可。
    const target = (m[1] ?? m[2] ?? "").slice(1);
    return tag.replace(m[0], ` data-jump="${target}"`);
  });
}

/** 改写后的锚点没有 href，浏览器不再给手型光标 —— 补回去，观感与原来一致。 */
export const IN_PAGE_ANCHOR_CSS = `[data-jump]{cursor:pointer;}`;

/**
 * 从一次点击的目标元素上取出「要跳到哪个 id」。
 * 同时认改写后的 `[data-jump]` 与**没来得及改写**的 `a[href^="#"]`（存量缓存、
 * 或将来别处直接塞进来的 HTML），两条路都得拦住。
 */
export function inPageJumpTarget(el: Element | null | undefined): string | null {
  if (!el?.closest) return null;
  const jump = el.closest("[data-jump]");
  if (jump) return jump.getAttribute("data-jump") || null;
  const anchor = el.closest('a[href^="#"]');
  if (anchor) return (anchor.getAttribute("href") || "").slice(1) || null;
  return null;
}
