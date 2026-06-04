/**
 * Detect common video URLs and produce an embeddable iframe / video element.
 * Returns null if the URL isn't recognized as a video.
 */
export function videoEmbedHtml(rawUrl: string): string | null {
  const url = rawUrl.trim();
  if (!url) return null;
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  const host = u.hostname.replace(/^www\./, "").toLowerCase();
  const wrap = (src: string, allow = "autoplay; encrypted-media; picture-in-picture; fullscreen") =>
    `<div style="position:relative;padding-top:56.25%;margin:.8em 0;background:#000;">
      <iframe src="${escapeAttr(src)}" allow="${allow}" allowfullscreen
        style="position:absolute;inset:0;width:100%;height:100%;border:0;"
        loading="lazy" referrerpolicy="no-referrer-when-downgrade"></iframe>
    </div>`;

  // YouTube
  if (host === "youtu.be") {
    const id = u.pathname.slice(1).split("/")[0];
    if (id) return wrap(`https://www.youtube.com/embed/${id}`);
  }
  if (host.endsWith("youtube.com") || host.endsWith("youtube-nocookie.com")) {
    let id = u.searchParams.get("v") ?? "";
    if (!id) {
      const m = u.pathname.match(/\/(?:embed|shorts|v)\/([\w-]{6,})/);
      if (m) id = m[1];
    }
    if (id) return wrap(`https://www.youtube.com/embed/${id}`);
  }
  // Vimeo
  if (host.endsWith("vimeo.com")) {
    const m = u.pathname.match(/\/(\d+)/);
    if (m) return wrap(`https://player.vimeo.com/video/${m[1]}`);
  }
  // Bilibili
  if (host.endsWith("bilibili.com")) {
    const m = u.pathname.match(/\/(BV[\w]+|av\d+)/i);
    if (m) {
      const v = m[1];
      const q = v.startsWith("BV") ? `bvid=${v}` : `aid=${v.slice(2)}`;
      return wrap(`https://player.bilibili.com/player.html?${q}&autoplay=0&high_quality=1`);
    }
  }
  // Direct video file
  if (/\.(mp4|webm|ogg|mov|m4v)(\?|$)/i.test(u.pathname)) {
    return `<video src="${escapeAttr(url)}" controls playsinline preload="metadata"
      style="max-width:100%;width:100%;display:block;margin:.8em 0;background:#000;"></video>`;
  }
  return null;
}

function escapeAttr(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/**
 * Walk an HTML string and replace recognized video URLs (in <a href> and bare
 * text URLs) with inline players. Operates browser-side via DOMParser.
 */
export function embedVideosInHtml(html: string): string {
  if (typeof window === "undefined" || !html) return html;
  const doc = new DOMParser().parseFromString(`<div id="__root">${html}</div>`, "text/html");
  const root = doc.getElementById("__root");
  if (!root) return html;

  // 1. Replace <a href="...video..."> when its text is the URL itself (or matches).
  root.querySelectorAll("a[href]").forEach((a) => {
    const href = a.getAttribute("href") || "";
    const embed = videoEmbedHtml(href);
    if (!embed) return;
    const text = (a.textContent || "").trim();
    // Only auto-embed when the link looks like a "raw" pasted URL
    if (text && text !== href && !/^https?:\/\//.test(text)) return;
    const tmp = doc.createElement("div");
    tmp.innerHTML = embed;
    a.replaceWith(...Array.from(tmp.childNodes));
  });

  // 2. Replace bare text URLs sitting alone in a paragraph / inline node.
  const URL_RE = /https?:\/\/[^\s<>"]+/g;
  const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
  const pending: Text[] = [];
  let node = walker.nextNode() as Text | null;
  while (node) {
    if (node.nodeValue && URL_RE.test(node.nodeValue)) pending.push(node);
    URL_RE.lastIndex = 0;
    node = walker.nextNode() as Text | null;
  }
  for (const t of pending) {
    const text = t.nodeValue ?? "";
    URL_RE.lastIndex = 0;
    const matches = [...text.matchAll(URL_RE)];
    if (matches.length === 0) continue;
    const frag = doc.createDocumentFragment();
    let cursor = 0;
    let touched = false;
    for (const m of matches) {
      const url = m[0];
      const idx = m.index ?? 0;
      const embed = videoEmbedHtml(url);
      if (!embed) continue;
      if (idx > cursor) frag.appendChild(doc.createTextNode(text.slice(cursor, idx)));
      const tmp = doc.createElement("div");
      tmp.innerHTML = embed;
      while (tmp.firstChild) frag.appendChild(tmp.firstChild);
      cursor = idx + url.length;
      touched = true;
    }
    if (!touched) continue;
    if (cursor < text.length) frag.appendChild(doc.createTextNode(text.slice(cursor)));
    t.parentNode?.replaceChild(frag, t);
  }

  return root.innerHTML;
}
