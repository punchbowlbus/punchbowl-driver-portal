const CACHE = "pbc-v34"; // bump when you deploy changes

const ASSETS = [
  "/",
  "/index.html",
  "/manifest.webmanifest",
  "/icons/icon-192.png",
  "/icons/icon-512.png",

  // app modules (keep this list updated)
  "/js/main.js",
  "/js/ui.js",
  "/js/utils.js",
  "/js/firebase.js",
  "/js/config.js",
  "/js/state.js",
  "/js/db.js",
  "/js/admin.js",
  "/js/driver.js",

  // NEW modules you are using now
  "/js/shifts_ui.js",
  "/js/modals.js",
  "/js/bulk_duty_spans.js",
  "/js/driver_duty_sheet.js",
];

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    try {
      await cache.addAll(ASSETS);
    } catch (e) {
      // ✅ don't fail the install if one file is missing
      // (you might rename modules during development)
      console.log("SW precache warning:", e);
    }
    self.skipWaiting();
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.map((k) => (k === CACHE ? null : caches.delete(k))));
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // Only handle our own domain
  if (url.origin !== location.origin) return;

  const isHTML = req.mode === "navigate" || req.destination === "document";
  const isJS = req.destination === "script";

  // ✅ Network-first for HTML + JS (prevents old code mismatch)
  if (isHTML || isJS) {
    event.respondWith((async () => {
      try {
        const fresh = await fetch(req);
        const cache = await caches.open(CACHE);
        cache.put(req, fresh.clone());
        return fresh;
      } catch {
        return (await caches.match(req)) || (isHTML ? caches.match("/index.html") : Response.error());
      }
    })());
    return;
  }

  // ✅ Cache-first for everything else (icons, manifest, etc.)
  event.respondWith((async () => {
    const cached = await caches.match(req);
    if (cached) return cached;

    const fresh = await fetch(req);
    const cache = await caches.open(CACHE);
    cache.put(req, fresh.clone());
    return fresh;
  })());
});
