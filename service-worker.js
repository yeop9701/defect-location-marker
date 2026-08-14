// 결함 위치 도면 마킹 도구 — 오프라인 캐시용 서비스워커.
// 앱이 사용자 데이터를 서버에 전혀 보내지 않고 브라우저 안에서만 동작하므로,
// 캐시 전략은 "앱 셸(정적 파일)만 캐시하고 나머지는 그대로 통과"로 단순하게 유지한다.
const CACHE_NAME = 'defect-marker-cache-v1';
const APP_SHELL = [
  './',
  './index.html',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
  './icon-maskable-512.png',
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// 캐시 우선, 실패 시 네트워크(오프라인에서도 앱 셸이 뜨도록). 새 버전은 백그라운드로 갱신.
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  event.respondWith(
    caches.match(event.request).then(cached => {
      const network = fetch(event.request).then(res => {
        if (res && res.ok) {
          const clone = res.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
        }
        return res;
      }).catch(() => cached);
      return cached || network;
    })
  );
});
