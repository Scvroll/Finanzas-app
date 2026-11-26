/* ---------- Arranque ---------- */
Store.onChange(() => { renderAll(); renderSync(); });
(async () => {
  try { await Store.init(); }
  catch (e) { console.warn('Datos corruptos en localStorage; se empieza vacío', e); Store.state = emptyState(); }
  Auth.init();
  Sync.setup();
  applyTheme(); pintarSelectorPeriodo();
  const vista = location.hash.slice(1);
  showView($('#view-' + vista) ? vista : 'resumen');
  renderSync();
  // Vuelta del OAuth por redirección (PWA instalada / popup fallido): el token ya está; completar perfil o sync.
  const rr = Auth.redirectResult;
  if (rr) {
    if (!rr.ok) toast(rr.error || 'No se pudo iniciar sesión con Google');
    else if (rr.kind === 'signin' || (!Auth.user && Auth.tokenValid)) signIn();
    else if (Auth.tokenValid) { toast('Sesión renovada'); Sync.now({ force: true }); }
    Auth.redirectResult = null;
  } else if (Sync.active && Auth.tokenValid) Sync.now();
  notificarGarantias();
  limpiarAdjuntosHuerfanos();
})();
// Al volver a la app (o al cambiar de día) se actualiza la vista; los recurrentes ya no se crean solos (v3.11)
let ultimoDia = todayISO();
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible') return;
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
window.FinanzasApp = { Store, Sync, FileSync, Auth, localCache, normalizeState, Calc, UI, setMes, showView, parseImporte, generarDatosEjemplo, movimientosCSV, AdjUI, OCR, openMovDialog, abrirRegistroRecurrente, openCuadro, openDetalle, planCSV, todayISO, setNomina, setVista, periodo, Sobrante: typeof Sobrante !== 'undefined' ? Sobrante : null, VehiculosCore: typeof VehiculosCore !== 'undefined' ? VehiculosCore : null };
