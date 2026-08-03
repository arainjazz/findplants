// ⚠️ 改这个版本号会让 activate 把**所有旧缓存整个删掉** —— 这是把线上已经卡住的
// 用户救回来的唯一办法（他们的页面不水合，注册 SW 的那段 React 代码永远跑不到，
// 但浏览器自己会在每次导航时重新拉 sw.js，于是新版本还是能装上）。
// v5 → v6：清掉 2026-08-03 那批「壳是旧的、里面指的 chunk 已 404」的 HTML 缓存。
const CACHE_NAME = "plantspedia-cache-v6";

// 🔴 **预缓存里不放 HTML**。install 时抓的 "/" 会在下一次部署后立刻变成一张
// 指向已删除 chunk（`/assets/index-<旧hash>.js`，现在 404 且返回 HTML）的死壳，
// 而它偏偏是断网兜底时最先被端出来的那一份 —— 页面能画出来、却一个按钮都不响应。
// 离线兜底改由下面 navigate 分支里「成功访问过才写入」的那份承担，它至少是用户
// 真正打开过的版本；壳彻底过期时由页面里的水合看门狗清缓存自救（见 __root.tsx）。
const ASSETS_TO_CACHE = ["/favicon.ico"];

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS_TO_CACHE))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            return caches.delete(key);
          }
        })
      );
    })
  );
  self.clients.claim();
});

self.addEventListener("fetch", (e) => {
  // Only intercept GET requests
  if (e.request.method !== "GET") return;

  const url = new URL(e.request.url);

  // NEVER intercept cross-origin requests (高德/AMap tiles, map fonts, Supabase,
  // unpkg/Google CDNs). Re-fetching a third-party resource through the SW can fail
  // with net::ERR_FAILED (the catch returns an uncached `undefined`). Let the browser
  // load all third-party resources natively. This fixes the 平面 basemap not loading.
  if (url.origin !== self.location.origin) return;

  // Skip Hot-Module-Replacement websocket connection, etc. (same-origin in dev).
  if (
    url.pathname.includes("hot-update") ||
    url.pathname.includes("ws")
  ) {
    return;
  }

  // Network-first for page navigations (the HTML shell). This guarantees a freshly
  // deployed UI shows up on the next load instead of being shadowed by a stale cache
  // hit — the shell always references the latest content-hashed JS/CSS chunks.
  // Falls back to the cache (then "/") only when the network is unavailable (offline).
  if (e.request.mode === "navigate") {
    e.respondWith(
      fetch(e.request)
        .then((networkResponse) => {
          if (networkResponse.status === 200 && url.origin === self.location.origin) {
            const responseClone = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(e.request, responseClone));
          }
          return networkResponse;
        })
        .catch(() =>
          caches.match(e.request).then((cached) => cached || caches.match("/"))
        )
    );
    return;
  }

  // Static, content-hashed assets (JS/CSS/fonts/images) → stale-while-revalidate:
  // safe because their URL changes on every deploy, so the cache is never stale.
  const isStaticAsset =
    /\.(?:js|mjs|css|woff2?|ttf|otf|png|jpe?g|webp|gif|svg|ico|avif)(?:\?|$)/i.test(url.pathname) ||
    url.pathname.startsWith("/assets/");

  if (isStaticAsset) {
    e.respondWith(
      caches.match(e.request).then((cachedResponse) => {
        const networkFetch = fetch(e.request)
          .then((networkResponse) => {
            if (networkResponse.status === 200 && url.origin === self.location.origin) {
              const responseClone = networkResponse.clone();
              caches.open(CACHE_NAME).then((cache) => cache.put(e.request, responseClone));
            }
            return networkResponse;
          })
          .catch(() => cachedResponse);

        return cachedResponse || networkFetch;
      })
    );
    return;
  }

  // Everything else — server-function / data GETs (e.g. an editor's computed
  // 活动于) — must be NETWORK-FIRST, otherwise a stale cached response shadows
  // freshly-deployed data. Cache is kept only as an offline fallback.
  e.respondWith(
    fetch(e.request)
      .then((networkResponse) => {
        if (networkResponse.status === 200 && url.origin === self.location.origin) {
          const responseClone = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(e.request, responseClone));
        }
        return networkResponse;
      })
      .catch(() => caches.match(e.request))
  );
});
