const CACHE = "pbc-v55"; // Refresh cached assets after Workshop updates

const ASSETS = [
  "/",
  "/index.html",
  "/customers.html",
  "/enquiries.html",
  "/enquiry_inbox.html",
  "/styles.css",
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
  "/js/admin_v2.js",
  "/js/driver.js",

  // NEW modules you are using now
  "/js/shifts_ui.js",
  "/js/modals.js",
  "/js/bulk_duty_spans.js",
  "/js/driver_duty_sheet.js",
  "/js/customers.js",
  "/js/enquiries.js",
  "/js/enquiry_inbox.js",
  "/js/charter_bookings.js",
  "/js/incident_reports.js",
  "/js/customer_search.js",
];

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    try {
      await cache.addAll(ASSETS);
    } catch (e) {
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

  if (url.origin !== location.origin) return;

  const isHTML = req.mode === "navigate" || req.destination === "document";
  const isJS = req.destination === "script";
  const isCSS = req.destination === "style";

  // Network-first for HTML, JS and CSS so Workshop updates appear without
  // requiring Ctrl+F5 after every deploy.
  if (isHTML || isJS || isCSS) {
    event.respondWith((async () => {
      try {
        const fresh = await fetch(req, { cache: "no-store" });
        const cache = await caches.open(CACHE);
        cache.put(req, fresh.clone());
        return fresh;
      } catch {
        return (await caches.match(req)) || (isHTML ? caches.match("/index.html") : Response.error());
      }
    })());
    return;
  }

  event.respondWith((async () => {
    const cached = await caches.match(req);
    if (cached) return cached;

    const fresh = await fetch(req);
    const cache = await caches.open(CACHE);
    cache.put(req, fresh.clone());
    return fresh;
  })());
});
