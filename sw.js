// sw.js - Service Worker para Soporte Offline en BiciLog con CDN Caching

const CACHE_NAME = 'bicilog-v2';
const ASSETS_TO_CACHE = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './storage.js',
  './bluetooth.js',
  './gps.js',
  './gps-worker.js', // Caché para el Web Worker
  './charts.js',
  './manifest.json',
  // Caching externo para Leaflet.js (Permite iniciar mapas offline)
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js'
];

// Instalar el Service Worker y cachear recursos
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log('Cache abierto, cargando assets locales y externos...');
      // Usar force fetch para asegurar almacenamiento de CDNs
      return cache.addAll(ASSETS_TO_CACHE);
    })
  );
});

// Activar y limpiar cachés antiguas
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cache) => {
          if (cache !== CACHE_NAME) {
            console.log('Borrando caché antigua:', cache);
            return caches.delete(cache);
          }
        })
      );
    })
  );
});

// Estrategia Cache-First con caídas en red
self.addEventListener('fetch', (event) => {
  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      if (cachedResponse) {
        return cachedResponse;
      }
      return fetch(event.request).then((networkResponse) => {
        // Caching dinámico para recursos relacionados con mapas tiles si es viable
        if (event.request.url.includes('tile.openstreetmap.org')) {
          const responseClone = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, responseClone);
          });
        }
        return networkResponse;
      });
    }).catch(() => {
      if (event.request.mode === 'navigate') {
        return caches.match('./index.html');
      }
    })
  );
});
