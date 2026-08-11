/* ============================================
   DrDer Chess - Service Worker
   ============================================ */

const CACHE_NAME = 'drder-chess-v1';

// لا نقوم بتخزين أي ملفات - النظام يبدأ من جديد دائماً
self.addEventListener('install', function(event) {
    self.skipWaiting();
});

self.addEventListener('activate', function(event) {
    // مسح جميع الكاشات القديمة
    event.waitUntil(
        caches.keys().then(function(cacheNames) {
            return Promise.all(
                cacheNames.map(function(cacheName) {
                    return caches.delete(cacheName);
                })
            );
        }).then(function() {
            return self.clients.claim();
        })
    );
});

// عدم تخزين أي شيء - كل طلب يمر مباشرة
self.addEventListener('fetch', function(event) {
    event.respondWith(fetch(event.request));
});
