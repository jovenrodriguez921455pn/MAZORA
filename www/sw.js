const CACHE_NAME = "mazora-app-shell-v3";

const APP_FILES = [
  "./",
  "./index.html",
  "./manifest.webmanifest",
  "./mazora-m-logo.png",
  "./assets/mazora-hero.png",
  "./icons/mazora-192.png",
  "./icons/mazora-512.png",
  "./js/supabase-config.js",
  "./js/mazora-auth.js",
  "./js/mazora-cloud-library.js",
  "./js/mazora-cloud-sync.js",
  "./js/mazora-profile-sync.js",
  "./js/reader/continuous-pdf.js",
  "./js/vendor/epub.min.js",
  "./js/vendor/jszip.min.js",
  "./js/vendor/pdf.min.js",
  "./js/vendor/pdf.worker.min.js",
  "./js/vendor/supabase.min.js"
];

self.addEventListener("install", event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(APP_FILES))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys
          .filter(key =>
            key.startsWith("mazora-app-shell-") &&
            key !== CACHE_NAME
          )
          .map(key => caches.delete(key))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", event => {
  const request = event.request;

  if (request.method !== "GET") return;

  const url = new URL(request.url);

  if (url.origin !== self.location.origin) return;

  event.respondWith(
    caches.match(request).then(cached => {
      if (cached) return cached;

      return fetch(request).then(response => {
        if (response.ok && response.type === "basic") {
          const copy = response.clone();
          caches.open(CACHE_NAME).then(cache =>
            cache.put(request, copy)
          );
        }
        return response;
      }).catch(async () => {
        if (request.mode === "navigate") {
          return await caches.match("./index.html");
        }
        throw new Error("MAZORA resource unavailable offline");
      });
    })
  );
});
