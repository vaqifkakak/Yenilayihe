const CACHE_NAME = "car-bay-v4";
const PRECACHE_URLS = [
  "index.html",
  "dashboard.html",
  "styles.css",
  "auth.js",
  "app.js",
  "firebase-config.js",
  "manifest.json",
  "assets/icon-192.png",
  "assets/icon-512.png",
  "assets/favicon.ico"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(PRECACHE_URLS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// Firebase (auth/firestore) sorğularını heç vaxt keşləmə — həmişə şəbəkədən get.
self.addEventListener("fetch", (event) => {
  const url = event.request.url;
  if (url.includes("firestore.googleapis.com") || url.includes("identitytoolkit") || url.includes("googleapis.com")) {
    return; // default browser fetch, no SW interception
  }

  event.respondWith(
    caches.match(event.request).then((cached) => {
      const networkFetch = fetch(event.request)
        .then((response) => {
          if (response && response.status === 200 && event.request.method === "GET") {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          }
          return response;
        })
        .catch(() => cached);
      return cached || networkFetch;
    })
  );
});
