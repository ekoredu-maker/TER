const CACHE_NAME = "travel-expense-v1-2-min";
const ASSETS = ["./","./index.html","./assets/css/style.css","./assets/css/print.css","./assets/js/app.js","./manifest.json","./icons/icon-192.png","./icons/icon-512.png"];
self.addEventListener('install', e => { e.waitUntil(caches.open(CACHE_NAME).then(c=>c.addAll(ASSETS))); self.skipWaiting(); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k=>k!==CACHE_NAME).map(k=>caches.delete(k))))); self.clients.claim(); });
self.addEventListener('fetch', e => { if(e.request.method !== 'GET') return; e.respondWith(caches.match(e.request).then(r => r || fetch(e.request))); });
