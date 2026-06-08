// sw.js - Service Worker para Soporte Offline en BiciLog

const CACHE_NAME = 'bicilog-v1';
const ASSETS_TO_CACHE = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './storage.js',
  './bluetooth.js',
  './gps.js',
  './charts.js',
  './manifest.json'
];

// Instalar el Service Worker y cachear recursos
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log('Cache abierto, cargando assets...');
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

// Estrategia Cache-First (Offline) con caída en Red
self.addEventListener('fetch', (event) => {
  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      if (cachedResponse) {
        return cachedResponse;
      }
      return fetch(event.request).then((networkResponse) => {
        // Guardar nuevas solicitudes dinámicamente si es necesario
        return networkResponse;
      });
    }).catch(() => {
      // Retorno en caso de error completo de red
      if (event.request.mode === 'navigate') {
        return caches.match('./index.html');
      }
    })
  );
});
