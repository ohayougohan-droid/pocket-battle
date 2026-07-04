// ポケットバトル CHAMPIONS - オフラインキャッシュ
// HTML/JSはネット優先（常に最新版）、スプライト等はキャッシュ優先（オフライン対応）
const CACHE = "pocketbattle-v15";
const CORE = ["./index.html", "./manifest.json"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(CORE).catch(() => {})).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

const cachePut = (req, res) => {
  if (res && res.ok && req.url.startsWith(self.location.origin)) {
    const clone = res.clone();
    caches.open(CACHE).then((c) => c.put(req, clone));
  }
  return res;
};

self.addEventListener("fetch", (e) => {
  if (e.request.method !== "GET") return;
  const isPage = e.request.mode === "navigate" ||
    e.request.url.endsWith(".html") || e.request.url.endsWith(".js") || e.request.url.endsWith("manifest.json");
  if (isPage) {
    // ネット優先: 最新版を取得、オフライン時のみキャッシュ
    e.respondWith(
      fetch(e.request).then((res) => cachePut(e.request, res))
        .catch(() => caches.match(e.request, { ignoreSearch: true }))
    );
  } else {
    // スプライト等: キャッシュ優先
    e.respondWith(
      caches.match(e.request, { ignoreSearch: true }).then((hit) =>
        hit || fetch(e.request).then((res) => cachePut(e.request, res)))
    );
  }
});
