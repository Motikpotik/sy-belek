/* ===================================================================
   SY Hotels Belek Review — Service Worker v2
   Изменения:
     - Новая версия кэша v2 → принудительно инвалидирует старый кэш
     - HTML / навигация: network-first (пользователь всегда видит свежую версию)
     - Картинки: stale-while-revalidate (быстро + обновление в фоне)
     - Прочее: network-first с fallback в кэш
   =================================================================== */

const CACHE_VERSION = 'sy-belek-v6';
const STATIC_CACHE  = `${CACHE_VERSION}-static`;
const IMG_CACHE     = `${CACHE_VERSION}-images`;

// Ресурсы, которые кэшируем сразу при установке (app shell)
const APP_SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './robots.txt',
  './sitemap.xml',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png',
  './icons/favicon.svg',
  './icons/favicon-32.png',
  './icons/apple-splash-2048.png',
];

// Домены, с которыми кэшируем картинки
const IMG_HOSTS = [
  'syhotels.com',
  'placehold.co',
  'api.qrserver.com',
];

/* ---------- Install: pre-cache app shell ---------- */
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE)
      .then(cache => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())  // активируем сразу, не ждать закрытия всех вкладок
      .catch(err => console.warn('[SW] install error:', err))
  );
});

/* ---------- Activate: чистим старые кэши ---------- */
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys
          .filter(key => !key.startsWith(CACHE_VERSION))  // удаляем всё, что не v2
          .map(key => {
            console.log('[SW] удаляю старый кэш:', key);
            return caches.delete(key);
          })
      ))
      .then(() => self.clients.claim())  // сразу перехватываем клиентов
  );
  console.log('[SW] activated, version', CACHE_VERSION);
});

/* ---------- Helper: является ли URL картинкой с наших доменов ---------- */
function isCacheableImage(url) {
  if (url.protocol !== 'https:') return false;
  return IMG_HOSTS.some(host => url.hostname.endsWith(host))
    && /\.(jpg|jpeg|png|webp|gif|svg)(\?|$)/i.test(url.pathname);
}

/* ---------- Fetch: маршрутизация ---------- */
self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  let url;
  try { url = new URL(req.url); } catch { return; }

  // 1. Наш HTML / навигация → NETWORK-FIRST (всегда свежая версия!)
  if (url.origin === self.location.origin &&
      (req.mode === 'navigate' ||
       url.pathname === '/' ||
       url.pathname === '/index.html' ||
       url.pathname.endsWith('.html') ||
       url.pathname.endsWith('.webmanifest') ||
       url.pathname.endsWith('.txt') ||
       url.pathname.endsWith('.xml'))) {
    event.respondWith(
      fetch(req).then(resp => {
        if (resp.ok) {
          const clone = resp.clone();
          caches.open(STATIC_CACHE).then(c => c.put(req, clone));
        }
        return resp;
      }).catch(() => caches.match(req).then(cached => cached || caches.match('./index.html')))
    );
    return;
  }

  // 2. Картинки с наших доменов → stale-while-revalidate
  if (isCacheableImage(url)) {
    event.respondWith(
      caches.open(IMG_CACHE).then(cache =>
        cache.match(req).then(cached => {
          const network = fetch(req).then(resp => {
            if (resp.ok) cache.put(req, resp.clone());
            return resp;
          }).catch(() => cached);
          return cached || network;
        })
      )
    );
    return;
  }

  // 3. YouTube / Google Maps → network-first
  if (url.hostname.includes('youtube.com') ||
      url.hostname.includes('youtube-nocookie.com') ||
      url.hostname.includes('google.com/maps') ||
      url.hostname.includes('maps.google')) {
    event.respondWith(
      fetch(req).then(resp => {
        if (resp.ok) {
          const clone = resp.clone();
          caches.open(STATIC_CACHE).then(c => c.put(req, clone));
        }
        return resp;
      }).catch(() => caches.match(req))
    );
    return;
  }

  // 4. Остальные same-origin ресурсы → stale-while-revalidate
  if (url.origin === self.location.origin) {
    event.respondWith(
      caches.match(req).then(cached => {
        const network = fetch(req).then(resp => {
          if (resp.ok) {
            const clone = resp.clone();
            caches.open(STATIC_CACHE).then(c => c.put(req, clone));
          }
          return resp;
        }).catch(() => cached);
        return cached || network;
      })
    );
    return;
  }
});

/* ---------- Управление обновлениями ---------- */
self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
