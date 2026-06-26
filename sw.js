/* ===================================================================
   SY Hotels Belek Review — Service Worker
   Кэширует:
     - Приложение (index.html, manifest, CSS inline уже в HTML)
     - Иконки PWA
     - Все фотографии с syhotels.com (для офлайн-просмотра галерей)
     - iframe Google Maps (после первого открытия)
   Стратегия:
     - App shell: cache-first (мгновенный ответ из кэша)
     - Фото: stale-while-revalidate (быстро из кэша + фоновое обновление)
     - Остальное: network-first с fallback в кэш
   =================================================================== */

const CACHE_VERSION = 'sy-belek-v1';
const STATIC_CACHE  = `${CACHE_VERSION}-static`;
const IMG_CACHE     = `${CACHE_VERSION}-images`;

// Ресурсы, которые кэшируем сразу при установке (app shell)
const APP_SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
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
];

/* ---------- Install: pre-cache app shell ---------- */
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE)
      .then(cache => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
      .catch(err => console.warn('[SW] install error:', err))
  );
});

/* ---------- Activate: чистим старые кэши ---------- */
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys
          .filter(key => !key.startsWith(CACHE_VERSION))
          .map(key => caches.delete(key))
      ))
      .then(() => self.clients.claim())
  );
  console.log('[SW] activated, version', CACHE_VERSION);
});

/* ---------- Helper: является ли URL картинкой с наших доменов ---------- */
function isCacheableImage(url) {
  if (url.protocol !== 'https:') return false;
  return IMG_HOSTS.some(host => url.hostname.endsWith(host))
    && /\.(jpg|jpeg|png|webp|gif|svg)(\?|$)/i.test(url.pathname);
}

/* ---------- Fetch: маршрутизация по стратегиям ---------- */
self.addEventListener('fetch', (event) => {
  const req = event.request;

  // Только GET
  if (req.method !== 'GET') return;

  let url;
  try { url = new URL(req.url); } catch { return; }

  // 1. App shell (наш домен) → cache-first
  if (url.origin === self.location.origin) {
    event.respondWith(
      caches.match(req).then(cached => {
        return cached || fetch(req).then(resp => {
          // Кэшируем навигационные запросы как index.html
          const toCache = req.mode === 'navigate' ? './index.html' : req;
          if (resp.ok) {
            const clone = resp.clone();
            caches.open(STATIC_CACHE).then(c => c.put(toCache, clone));
          }
          return resp;
        }).catch(() => caches.match('./index.html'));
      })
    );
    return;
  }

  // 2. Картинки с наших доменов → stale-while-revalidate
  if (isCacheableImage(url)) {
    event.respondWith(
      caches.open(IMG_CACHE).then(cache =>
        cache.match(req).then(cached => {
          // Фоновое обновление
          const network = fetch(req).then(resp => {
            if (resp.ok) {
              cache.put(req, resp.clone());
            }
            return resp;
          }).catch(() => cached); // если оффлайн и нет в кэше — вернём cached (может быть undefined)
          // Сначала из кэша, потом из сети
          return cached || network;
        })
      )
    );
    return;
  }

  // 3. YouTube / Google Maps iframe → network-first, fallback в кэш
  if (url.hostname.includes('youtube.com') ||
      url.hostname.includes('google.com/maps') ||
      url.hostname.includes('youtube-nocookie.com')) {
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

  // 4. Остальное → пробуем сеть, fallback в кэш
  event.respondWith(
    fetch(req).catch(() => caches.match(req))
  );
});

/* ---------- Управление обновлениями: уведомляем клиентов ---------- */
self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
