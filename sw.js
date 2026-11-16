"use strict";
const CACHE_NAME = "elgo-lab-v11";

const CORE_ASSETS = [
  "/",
  "/404.html",
  "/manifest.webmanifest",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/assets/mascot/mascot-clay.webp",
  "/assets/mascot/mascot-logo.png",
  "/assets/mascot/mascot-hello.png",
  "/assets/mascot/mascot-study.png",
  "/assets/mascot/mascot-quiz.png",
  "/assets/mascot/mascot-victory.png",
  "/src/styles/tokens.css",
  "/src/styles/app.css",
  "/src/styles/player.css",
  "/src/styles/admin.css",
  "/src/styles/lecture.css",
  "/src/core/content-registry.js",
  "/src/core/content-catalog.js",
  "/src/core/content-library.js",
  "/src/core/content-validator.js",
  "/src/core/explanation-presenter.js",
  "/src/core/import-pipeline.js",
  "/src/core/mistakes-store.js",
  "/src/core/offline-store.js",
  "/src/core/online-client.js",
  "/src/core/presence.js",
  "/src/app/theme.js",
  "/src/app/model.js",
  "/src/app/state.js",
  "/src/app/offline-export.js",
  "/src/app/shell.js",
  "/src/app/hub.js",
  "/src/app/player.js",
  "/src/app/panels.js",
  "/src/app/quick-search.js",
  "/src/app/admin.js",
  "/src/app/main.js",
  "/data/catalog.json",
  "/data/search-index.json"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(CORE_ASSETS.map((u) => new Request(u, { cache: "reload" })))).catch(() => null)
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/")) return;

  if (
    req.mode === "navigate" ||
    url.pathname.startsWith("/src/") ||
    url.pathname.startsWith("/learn/") ||
    url.pathname.startsWith("/data/")
  ) {
    var networkReq = req;
    try {
      networkReq = new Request(req, { cache: "no-cache" });
    } catch (_err) {
      networkReq = req;
    }
    event.respondWith(
      fetch(networkReq)
        .then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(CACHE_NAME).then((c) => c.put(req, copy)).catch(() => {});
          }
          return res;
        })
        .catch(() => caches.match(req).then((m) => m || (req.mode === "navigate" ? caches.match("/") : undefined)))
    );
    return;
  }

  event.respondWith(
    caches.match(req).then((cached) => {
      const network = fetch(req).then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE_NAME).then((c) => c.put(req, copy)).catch(() => {});
        }
        return res;
      }).catch(() => cached);
      return cached || network;
    })
  );
});
