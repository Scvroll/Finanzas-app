/* ---------- Arranque ---------- */
Store.onChange(() => { renderAll(); renderSync(); });
(async () => {
  try { await Store.init(); }
  catch (e) { console.warn('Datos corruptos en localStorage; se empieza vacío', e); Store.state = emptyState(); }
  Auth.init();
  Sync.setup();
  applyTheme(); $('#monthInput').value = UI.mes;
  const vista = location.hash.slice(1);
  showView($('#view-' + vista) ? vista : 'resumen');
  renderSync();
  if (Sync.active && Auth.tokenValid) Sync.now();
  notificarGarantias();
  limpiarAdjuntosHuerfanos();
})();
// Al volver a la app (o al cambiar de día) se crean los recurrentes que toquen
let ultimoDia = todayISO();
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible') return;
  if (Store.generarRecurrentes()) toast('Se han añadido los movimientos recurrentes del mes');
  if (ultimoDia !== todayISO()) { ultimoDia = todayISO(); renderAll(); notificarGarantias(); }
});
/** Borra de IndexedDB los archivos que ya no tienen registro (p. ej. adjuntos de un diálogo que se cerró sin guardar). */
async function limpiarAdjuntosHuerfanos() {
  try {
    const vivos = new Set(Store.list('adjuntos').map(a => a.id));
    for (const k of await Adjuntos.BlobStore.keys()) if (!vivos.has(k)) await Adjuntos.BlobStore.del(k);
  } catch { /* IndexedDB no disponible (p. ej. modo privado antiguo) */ }
}

// App instalable / sin conexión (PWA). No funciona abriendo el archivo con file://
if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(err => console.info('Service worker no registrado:', err.message)));
}

// API para pruebas / consola
window.FinanzasApp = { Store, Sync, FileSync, Auth, localCache, normalizeState, Calc, UI, setMes, showView, parseImporte, generarDatosEjemplo, movimientosCSV, AdjUI, OCR, openMovDialog, openCuadro, openDetalle, planCSV, todayISO };
