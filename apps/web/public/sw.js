self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("fetch", () => {
  // Intentionally no caching. The service worker is only used to make the
  // terminal installable without risking stale shell or ttyd assets.
});
