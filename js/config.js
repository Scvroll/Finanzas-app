/* =====================================================================
   CONFIGURACIÓN  ·  Edita SOLO esta sección
   ---------------------------------------------------------------------
   GOOGLE_CLIENT_ID: pega aquí el "ID de cliente" OAuth de tipo
   "Aplicación web" que creas en Google Cloud (ver SETUP.md).
   Tiene esta forma: 1234567890-abc123def456.apps.googleusercontent.com
   Si lo dejas vacío (''), la app funciona en MODO LOCAL: los datos se
   guardan solo en este navegador y no se sincronizan.
   ===================================================================== */
const GOOGLE_CLIENT_ID = '';

/* --- No hace falta tocar nada debajo de esta línea --- */
window.FINANZAS_CONFIG = {
  GOOGLE_CLIENT_ID: GOOGLE_CLIENT_ID.trim(),
  // Permiso principal: una carpeta oculta y privada de la app en TU Google Drive
  DRIVE_SCOPE: 'https://www.googleapis.com/auth/drive.appdata',
  // Permiso OPCIONAL, solo si activas «Copia para análisis» en Ajustes: acceso únicamente
  // a los archivos que crea la propia app (carpeta visible «Finanzas App - Análisis»)
  APP_VERSION: '3.2.0',
  ANALISIS_SCOPE: 'https://www.googleapis.com/auth/drive.file',
  ANALISIS_CARPETA: 'Finanzas App - Análisis',
  ANALISIS_INTERVALO_MS: 60 * 60 * 1000,   // como mucho una actualización automática por hora
  DRIVE_FILE_NAME: 'finanzas.json',
  SYNC_DEBOUNCE_MS: 2000,          // espera tras el último cambio antes de subir
  SYNC_POLL_MS: 5 * 60 * 1000      // comprobación periódica de cambios de otros dispositivos
};
