// 항상 최신 파일을 먼저 받아옵니다. (수정한 내용이 바로 반영되도록)
const CACHE = "app-v33";
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin) return;
  // 브라우저에 저장된 예전 파일을 쓰지 않고 서버에 새 파일이 있는지 매번 확인합니다.
  e.respondWith(fetch(e.request.url, { cache: "no-cache" })
    .then((res) => { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); return res; })
    .catch(() => caches.match(e.request)));
});
