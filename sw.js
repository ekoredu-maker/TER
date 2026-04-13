// =============================================
// Service Worker - 개인출장 여비정산 관리 프로그램
// =============================================
const CACHE_NAME = 'yebi-jeongsan-v1';
const ASSETS_TO_CACHE = [
  './',
  './index.html',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png'
];

// ── 설치: 핵심 파일 캐싱 ──
self.addEventListener('install', event => {
  console.log('[SW] Install');
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      return cache.addAll(ASSETS_TO_CACHE);
    }).then(() => self.skipWaiting())
  );
});

// ── 활성화: 이전 캐시 정리 ──
self.addEventListener('activate', event => {
  console.log('[SW] Activate');
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(key => key !== CACHE_NAME)
          .map(key => {
            console.log('[SW] Deleting old cache:', key);
            return caches.delete(key);
          })
      )
    ).then(() => self.clients.claim())
  );
});

// ── Fetch: Cache First 전략 ──
self.addEventListener('fetch', event => {
  // POST 요청 등 캐싱 불가 요청 무시
  if (event.request.method !== 'GET') return;

  event.respondWith(
    caches.match(event.request).then(cachedResponse => {
      if (cachedResponse) {
        // 캐시 히트 → 즉시 반환 & 백그라운드 갱신
        fetchAndCache(event.request);
        return cachedResponse;
      }
      // 캐시 미스 → 네트워크 요청 후 캐싱
      return fetchAndCache(event.request);
    }).catch(() => {
      // 완전 오프라인 → index.html 반환
      return caches.match('./index.html');
    })
  );
});

function fetchAndCache(request) {
  return fetch(request).then(response => {
    if (!response || response.status !== 200 || response.type === 'opaque') {
      return response;
    }
    const responseClone = response.clone();
    caches.open(CACHE_NAME).then(cache => cache.put(request, responseClone));
    return response;
  });
}
