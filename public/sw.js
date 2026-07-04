const CACHE_NAME = "plantspedia-cache-v5";
const ASSETS_TO_CACHE = [
  "/",
  "/favicon.ico",
  "/explore"
];

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
