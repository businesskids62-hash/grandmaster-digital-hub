/* Grandmaster Academy service worker.
   Academy routes only: the Hub at "/" is never served a cached shell from here.
   Authenticated API responses are never cached: /api/ always goes to the network. */
const CACHE_NAME = "gm-academy-v2";
const ACADEMY_PREFIX = "/academy";
const OFFLINE_URL = "/offline.html";
const SHELL = [ACADEMY_PREFIX, OFFLINE_URL, "/icons/icon-192.png"];

const isAcademyPath = (pathname) =>
  pathname === ACADEMY_PREFIX || pathname.startsWith(`${ACADEMY_PREFIX}/`);

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(SHELL))
      .catch(() => undefined)
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)),
      );

      // An earlier release registered this script at origin scope, where it could
      // answer Hub navigations. That registration cannot be narrowed after the
      // fact, so it removes itself; Academy pages re-register under /academy.
      if (self.registration.scope === `${self.location.origin}/`) {
        await self.registration.unregister();
        return;
      }

      await self.clients.claim();
    })(),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Never cache API traffic, including authenticated responses.
  if (url.pathname.startsWith("/api/")) return;

  if (request.mode === "navigate") {
    // Hub and every other route stay on the network: no cached Academy shell.
    if (!isAcademyPath(url.pathname)) return;

    event.respondWith(
      (async () => {
        try {
          const response = await fetch(request);
          if (response && response.ok) {
            const copy = response.clone();
            caches
              .open(CACHE_NAME)
              .then((cache) => cache.put(request.url, copy))
              .catch(() => undefined);
          }
          return response;
        } catch {
          const cached = await caches.match(request.url);
          if (cached) return cached;
          const offline = await caches.match(OFFLINE_URL);
          if (offline) return offline;
          return Response.error();
        }
      })(),
    );
    return;
  }

  if (url.pathname.startsWith("/assets/") || url.pathname.startsWith("/icons/")) {
    event.respondWith(
      caches.match(request).then((cached) => {
        const network = fetch(request)
          .then((response) => {
            if (response.ok) {
              const copy = response.clone();
              caches.open(CACHE_NAME).then((cache) => cache.put(request, copy)).catch(() => undefined);
            }
            return response;
          })
          .catch(() => cached);
        return cached || network;
      }),
    );
  }
});
