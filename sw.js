/* Service worker de Mis Finanzas
   - Guarda la "carcasa" de la app para que abra sin conexión.
   - Archivos propios: primero red (para recibir actualizaciones), si falla, caché.
   - CDN (jsdelivr, siempre con versión fija en la URL): primero caché. Incluye Chart.js
     y el lector de texto Tesseract.js (se descarga solo cuando se usa por primera vez).
   - Nunca guarda nada de Google (inicio de sesión ni datos de Drive).
   Al cambiar archivos de la app, sube VERSION para forzar la actualización. */
const VERSION = 'finanzas-v3.2.1';
const CDN_CACHE = 'finanzas-cdn-v1'; // aparte: no se vacía al actualizar la app (las URL llevan versión)
const CHART_URL = 'https://cdn.jsdelivr.net/npm/chart.js@4.4.4/dist/chart.umd.min.js';
const SHELL = [
  './', './index.html', './manifest.json', './css/styles.css',
  './js/config.js', './js/sync-core.js', './js/storage.js', './js/auth.js',
  './js/finance-core.js', './js/attachments.js', './js/ocr.js', './js/ocr-gemini.js', './js/app.js', './js/app-extra.js', './js/analysis-export.js', './js/main.js',
  './plantillas/inversiones-plantilla.csv',
  './icons/icon-192.png', './icons/icon-512.png', './icons/icon-maskable-512.png', './icons/apple-touch-icon.png'
];

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(VERSION);
    await cache.addAll(SHELL);
    try { const cdn = await caches.open(CDN_CACHE); if (!(await cdn.match(CHART_URL))) await cdn.add(new Request(CHART_URL, { mode: 'cors' })); } catch (e) { /* se guardará en el primer uso */ }
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    for (const k of await caches.keys()) if (k !== VERSION && k !== CDN_CACHE) await caches.delete(k);
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (/(^|\.)googleapis\.com$|(^|\.)google\.com$|(^|\.)googleusercontent\.com$|(^|\.)gstatic\.com$/.test(url.hostname)) return; // Google: siempre red

  if (url.hostname === 'cdn.jsdelivr.net' && /@\d|\/\d+\.\d+\.\d+[_/]/.test(url.pathname)) {   // CDN con versión fija: primero caché
    event.respondWith((async () => {
      const cache = await caches.open(CDN_CACHE);
      const hit = await cache.match(req);
      if (hit) return hit;
      const res = await fetch(req);
      if (res.ok || res.type === 'opaque') cache.put(req, res.clone()); // opaque: importScripts del worker
      return res;
    })());
    return;
  }

  if (url.origin !== self.location.origin) return;
  event.respondWith((async () => {   // propios: primero red, si no hay conexión, caché
    const cache = await caches.open(VERSION);
    try {
      const res = await fetch(req);
      if (res.ok && url.search === '') cache.put(req, res.clone());
      return res;
    } catch (e) {
      const hit = await cache.match(req, { ignoreSearch: true });
      if (hit) return hit;
      if (req.mode === 'navigate') return (await cache.match('./index.html')) || (await cache.match('./'));
      throw e;
    }
  })());
});
