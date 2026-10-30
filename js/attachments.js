/* =========================================================
   Adjuntos (fotos de tickets, nóminas, PDF…)
   - Los metadatos (nombre, tipo, tamaño, hash, miniatura, texto OCR, id del
     archivo en Drive) viajan en el JSON sincronizado (colección «adjuntos»).
   - El archivo en sí NUNCA va en el JSON ni en localStorage:
       · en este dispositivo se guarda en IndexedDB (también sirve de caché);
       · con sesión de Google se sube UNA vez como archivo aparte a la carpeta
         oculta appDataFolder ("adj_<id>") y se referencia por su driveId.
   - Un adjunto no se modifica nunca (si cambias la foto, es otro adjunto), así
     que un adjunto con driveId no se vuelve a subir jamás.
   ========================================================= */
(function (root) {
  'use strict';
  const DB_NAME = 'finanzas_adjuntos', STORE = 'blobs';
  const MAX_IMAGEN = 25 * 1024 * 1024, MAX_PDF = 10 * 1024 * 1024;
  const LADO_MAX = 1600, CALIDAD = 0.82, LADO_MINI = 160;

  /* ---------- IndexedDB (archivos locales) ---------- */
  let dbp = null;
  function db() {
    if (!dbp) dbp = new Promise((res, rej) => {
      const r = indexedDB.open(DB_NAME, 1);
      r.onupgradeneeded = () => r.result.createObjectStore(STORE);
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
    return dbp;
  }
  async function tx(mode, fn) {
    const d = await db();
    return new Promise((res, rej) => {
      const t = d.transaction(STORE, mode), st = t.objectStore(STORE);
      const r = fn(st);
      t.oncomplete = () => res(r && 'result' in r ? r.result : undefined);
      t.onerror = () => rej(t.error); t.onabort = () => rej(t.error);
    });
  }
  const BlobStore = {
    get: id => tx('readonly', st => st.get(id)).then(v => v || null),
    put: (id, blob) => tx('readwrite', st => st.put(blob, id)),
    del: id => tx('readwrite', st => st.delete(id)),
    keys: () => tx('readonly', st => st.getAllKeys()),
    clear: () => tx('readwrite', st => st.clear()),
    async usage() { const ks = await this.keys(); let bytes = 0; for (const k of ks) { const b = await this.get(k); bytes += b ? b.size : 0; } return { n: ks.length, bytes }; }
  };

  /* ---------- Preparación del archivo ---------- */
  async function sha256(blob) {
    const buf = await blob.arrayBuffer();
    const h = await crypto.subtle.digest('SHA-256', buf);
    return [...new Uint8Array(h)].map(b => b.toString(16).padStart(2, '0')).join('');
  }
  async function decodificar(blob) {
    if (typeof createImageBitmap === 'function') { try { return await createImageBitmap(blob); } catch { /* sigue */ } }
    const url = URL.createObjectURL(blob);
    try {
      const img = new Image(); img.src = url; await img.decode(); return img;
    } finally { setTimeout(() => URL.revokeObjectURL(url), 1000); }
  }
  function aCanvas(img, lado) {
    const w = img.width, h = img.height, k = Math.min(1, lado / Math.max(w, h));
    const c = document.createElement('canvas'); c.width = Math.max(1, Math.round(w * k)); c.height = Math.max(1, Math.round(h * k));
    const ctx = c.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height); ctx.drawImage(img, 0, 0, c.width, c.height);
    return c;
  }
  const toBlob = (c, q) => new Promise(r => c.toBlob(r, 'image/jpeg', q));
  /** Comprime la imagen en el navegador: lado mayor ≤ 1600 px, JPEG ~82 %. Si no mejora, deja el original. */
  async function comprimirImagen(file) {
    const img = await decodificar(file);
    const c = aCanvas(img, LADO_MAX);
    const out = await toBlob(c, CALIDAD);
    const mini = aCanvas(img, LADO_MINI).toDataURL('image/jpeg', 0.6);
    if (img.close) img.close();
    if (!out || (out.size >= file.size && /jpe?g/.test(file.type))) return { blob: file, mime: file.type || 'image/jpeg', mini };
    return { blob: out, mime: 'image/jpeg', mini };
  }
  /** Devuelve el registro (sin guardar) y el blob listo para guardar. Lanza Error con texto en español. */
  async function prepararArchivo(file, owner) {
    const esPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name || '');
    const esImg = /^image\//.test(file.type);
    if (!esPdf && !esImg) throw new Error('Solo se pueden adjuntar imágenes o PDF');
    if (esPdf && file.size > MAX_PDF) throw new Error('El PDF supera 10 MB');
    if (esImg && file.size > MAX_IMAGEN) throw new Error('La imagen supera 25 MB');
    let blob = file, mime = esPdf ? 'application/pdf' : file.type, mini = null;
    if (esImg) {
      try { ({ blob, mime, mini } = await comprimirImagen(file)); }
      catch { if (file.size > MAX_PDF) throw new Error('No se pudo leer la imagen (formato no compatible con este navegador)'); }
    }
    const hash = await sha256(blob);
    let nombre = (file.name || (esPdf ? 'documento.pdf' : 'foto.jpg')).replace(/[\\/:*?"<>|]+/g, '_');
    if (mime === 'image/jpeg' && !/\.jpe?g$/i.test(nombre)) nombre = nombre.replace(/\.[a-z0-9]+$/i, '') + '.jpg';
    const rec = {
      id: (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2)),
      ownerType: owner.ownerType, ownerId: owner.ownerId, nombre, mime, size: blob.size, tamOriginal: file.size, hash,
      mini, driveId: null, ocr: null, creado: Date.now()
    };
    return { rec, blob };
  }

  /* ---------- Sincronización de archivos con Drive ---------- */
  /**
   * @param o.client     cliente Drive (uploadBlob, findByName, downloadBlob, remove)
   * @param o.listar()   -> todos los registros de adjuntos (incluidas lápidas)
   * @param o.setDriveId(id, driveId) -> guarda el driveId en el registro (y se sincroniza el JSON)
   * @param o.activo()   -> ¿hay sesión de Drive?
   * @param o.storage    localStorage (para recordar qué archivos borrados ya se eliminaron de Drive)
   */
  function createFileSync({ client, listar, setDriveId, activo, storage, onChange = () => {} }) {
    const KEY = 'finanzas_adj_borrados';
    const hechos = () => { try { return new Set(JSON.parse(storage.getItem(KEY)) || []); } catch { return new Set(); } };
    let running = null, again = false;
    const stats = { subidos: 0, borrados: 0, descargados: 0, errores: 0, ultimoError: '' };
    async function run() {
      if (!activo()) return stats;
      if (running) { again = true; return running; }
      running = (async () => {
        const todos = listar();
        // 1) Subir los que aún no están en Drive (solo los tiene este dispositivo)
        for (const a of todos) {
          if (a.deleted || a.driveId) continue;
          const blob = await BlobStore.get(a.id);
          if (!blob) continue;
          try {
            const name = 'adj_' + a.id;
            const ya = await client.findByName(name);
            const info = ya[0] || await client.uploadBlob(name, blob, a.mime || blob.type || 'application/octet-stream', { adjuntoId: a.id, sha256: a.hash || '' });
            await setDriveId(a.id, info.id); stats.subidos++; onChange();
          } catch (e) { stats.errores++; stats.ultimoError = e.message; if (e.code === 'auth' || e.code === 'network') break; }
        }
        // 2) Borrar de Drive (y de este dispositivo) los adjuntos eliminados
        const done = hechos();
        for (const a of todos) {
          if (!a.deleted) continue;
          if (a.driveId && !done.has(a.id)) {
            try { await client.remove(a.driveId); stats.borrados++; done.add(a.id); }
            catch (e) { if (e.status === 404) done.add(a.id); else { stats.errores++; if (e.code === 'auth' || e.code === 'network') break; } }
          }
          await BlobStore.del(a.id).catch(() => {});
        }
        storage.setItem(KEY, JSON.stringify([...done].slice(-2000)));
        return stats;
      })().finally(() => { running = null; if (again) { again = false; setTimeout(run, 0); } });
      return running;
    }
    /** Archivo de un adjunto: de IndexedDB o, si no está, de Drive (y se guarda en caché). */
    async function obtener(a) {
      const local = await BlobStore.get(a.id);
      if (local) return local;
      if (a.driveId && activo()) {
        const b = await client.downloadBlob(a.driveId);
        const blob = b.type ? b : new Blob([b], { type: a.mime });
        await BlobStore.put(a.id, blob); stats.descargados++;
        return blob;
      }
      return null;
    }
    return { run, obtener, stats };
  }

  const api = { BlobStore, prepararArchivo, comprimirImagen, sha256, createFileSync, LADO_MAX };
  root.Adjuntos = api;
})(typeof self !== 'undefined' ? self : globalThis);
