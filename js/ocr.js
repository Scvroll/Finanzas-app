/* =========================================================
   OCR (lectura de texto de fotos de tickets y nóminas)
   Interfaz de proveedor (para poder añadir otro en el futuro, p. ej. una IA):
     {
       id: 'tesseract',                    // identificador
       nombre: 'Tesseract.js …',            // texto para el usuario
       gratuito: true,                      // la app solo activa proveedores gratuitos
       admite(mime) -> bool,                // qué archivos sabe leer
       async reconocer(blob, { onProgress, tipo }) -> { texto, confianza (0-1), campos? }
     }
   Si el proveedor devuelve `campos` (importe, fecha, comercio, liquido…) se usan
   tal cual; si no, se extraen del texto con FinanceCore.analizarTexto().
   Nada se guarda sin que el usuario lo confirme.
   ========================================================= */
(function (root) {
  'use strict';
  // Versiones fijadas (las URL no cambian, así el service worker puede guardarlas en caché).
  const TESS = {
    script: 'https://cdn.jsdelivr.net/npm/tesseract.js@7.0.0/dist/tesseract.min.js',
    workerPath: 'https://cdn.jsdelivr.net/npm/tesseract.js@7.0.0/dist/worker.min.js',
    corePath: 'https://cdn.jsdelivr.net/npm/tesseract.js-core@7.0.0',
    langPath: 'https://cdn.jsdelivr.net/npm/@tesseract.js-data/spa/4.0.0_best_int'
  };
  let scriptPromise = null;
  function cargarScript(src) {
    if (root.Tesseract) return Promise.resolve();
    if (!scriptPromise) scriptPromise = new Promise((res, rej) => {
      const s = document.createElement('script'); s.src = src; s.async = true; s.crossOrigin = 'anonymous';
      s.onload = () => res(); s.onerror = () => { scriptPromise = null; rej(new Error('No se pudo descargar el lector de texto (¿sin conexión?)')); };
      document.head.appendChild(s);
    });
    return scriptPromise;
  }

  const ESTADOS = {
    'loading tesseract core': 'Cargando el motor de lectura…', 'initializing tesseract': 'Preparando…',
    'loading language traineddata': 'Descargando el idioma español (solo la primera vez)…', 'loading language traineddata (from cache)': 'Cargando el idioma español…',
    'initializing api': 'Preparando…', 'recognizing text': 'Leyendo el texto…'
  };

  const tesseractProvider = {
    id: 'tesseract', nombre: 'Tesseract.js (gratis, funciona dentro de tu navegador)', gratuito: true,
    worker: null, idleTimer: null,
    admite: mime => /^image\/(jpeg|png|webp|bmp|gif)$/.test(mime || ''),
    async _worker(onProgress) {
      if (this.worker) return this.worker;
      await cargarScript(TESS.script);
      this._progress = onProgress;
      this.worker = await root.Tesseract.createWorker('spa', 1, {
        workerPath: TESS.workerPath, corePath: TESS.corePath, langPath: TESS.langPath,
        logger: m => this._progress && this._progress({ estado: ESTADOS[m.status] || m.status, progreso: m.progress || 0 })
      });
      return this.worker;
    },
    async reconocer(blob, { onProgress } = {}) {
      clearTimeout(this.idleTimer);
      const w = await this._worker(onProgress);
      this._progress = onProgress;
      const { data } = await w.recognize(blob);
      this.idleTimer = setTimeout(() => this.liberar(), 120000); // libera memoria si no se usa
      return { texto: data.text || '', confianza: (data.confidence || 0) / 100 };
    },
    async liberar() { const w = this.worker; this.worker = null; if (w) await w.terminate().catch(() => {}); }
  };

  const OCR = {
    proveedores: {}, actual: 'tesseract', TESS,
    registrar(p) { if (!p.gratuito) throw new Error('Solo se admiten proveedores gratuitos'); this.proveedores[p.id] = p; },
    get proveedor() { return this.proveedores[this.actual]; },
    admite(mime) { return !!this.proveedor && this.proveedor.admite(mime); },
    /** Lee un archivo y propone campos. tipo: 'ticket' | 'nomina' | null (detectar). */
    async leer(blob, { tipo = null, onProgress } = {}) {
      const p = this.proveedor;
      if (!p) throw new Error('No hay lector de texto disponible');
      if (!p.admite(blob.type)) throw new Error(blob.type === 'application/pdf' ? 'Los PDF no se pueden leer automáticamente: adjunta una foto o captura del documento.' : 'Este tipo de archivo no se puede leer');
      const r = await p.reconocer(blob, { onProgress, tipo });
      const campos = r.campos || root.FinanceCore.analizarTexto(r.texto, tipo);
      return { texto: r.texto, confianza: r.confianza, proveedor: p.id, campos, fecha: new Date().toISOString() };
    }
  };
  OCR.registrar(tesseractProvider);
  root.OCR = OCR;
})(typeof self !== 'undefined' ? self : globalThis);
