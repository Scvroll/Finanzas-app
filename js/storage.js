/* =========================================================
   Adaptadores de almacenamiento. Interfaz común:
     load()  -> Promise<doc|null>
     save(doc) -> Promise<void>
     clear() -> Promise<void>
   - LocalStorageAdapter: solo este navegador.
   - DriveAdapter: usa localStorage como caché offline y sincroniza
     con un único archivo JSON en la carpeta oculta appDataFolder
     del Google Drive del usuario.
   Sin DOM: se puede probar en Node con un fetch simulado.
   ========================================================= */
(function (root) {
  'use strict';
  const Core = root.SyncCore || (typeof require === 'function' ? require('./sync-core.js') : null);

  /* ---------- Caché local (localStorage o equivalente) ---------- */
  function createLocalCache(storage, key = 'finanzas_v2', metaKey = 'finanzas_sync') {
    return {
      key, metaKey,
      load() { const raw = storage.getItem(key); return raw ? JSON.parse(raw) : null; },
      save(doc) { storage.setItem(key, JSON.stringify(doc)); },
      clear() { storage.removeItem(key); storage.removeItem(metaKey); },
      getMeta() { try { return JSON.parse(storage.getItem(metaKey)) || {}; } catch { return {}; } },
      setMeta(patch) { const m = { ...this.getMeta(), ...patch }; storage.setItem(metaKey, JSON.stringify(m)); return m; },
      resetMeta() { storage.removeItem(metaKey); }
    };
  }

  class LocalStorageAdapter {
    constructor(cache) { this.cache = cache; this.kind = 'local'; }
    async load() { return this.cache.load(); }
    async save(doc) { this.cache.save(doc); }
    async clear() { this.cache.clear(); }
  }

  /* ---------- Cliente mínimo de la API REST de Google Drive v3 ---------- */
  class DriveError extends Error {
    constructor(message, status = 0, code = 'http') { super(message); this.name = 'DriveError'; this.status = status; this.code = code; }
  }

  function createDriveClient({ fetchFn, getToken, fileName = 'finanzas.json' }) {
    const API = 'https://www.googleapis.com/drive/v3';
    const UPLOAD = 'https://www.googleapis.com/upload/drive/v3';
    const FIELDS = 'id,name,createdTime,modifiedTime';
    async function req(url, opts = {}, parse = 'json') {
      const token = await getToken(); // lanza DriveError(code:'auth') si no hay token válido
      let res;
      try { res = await fetchFn(url, { ...opts, headers: { ...(opts.headers || {}), Authorization: 'Bearer ' + token } }); }
      catch (e) { throw new DriveError('Sin conexión con Google Drive', 0, 'network'); }
      if (res.status === 401) throw new DriveError('La sesión de Google ha caducado', 401, 'auth');
      if (!res.ok) {
        let msg = ''; try { msg = (await res.json()).error.message; } catch { /* sin cuerpo */ }
        throw new DriveError(msg || ('Error de Google Drive (' + res.status + ')'), res.status, res.status === 403 ? 'forbidden' : 'http');
      }
      if (parse === 'none' || res.status === 204) return null;
      if (parse === 'blob') return res.blob();
      return parse === 'json' ? res.json() : res.text();
    }
    return {
      async listFiles() {
        const q = encodeURIComponent(`name='${fileName}' and trashed=false`);
        const r = await req(`${API}/files?spaces=appDataFolder&q=${q}&pageSize=10&fields=${encodeURIComponent('files(' + FIELDS + ')')}`);
        return r.files || [];
      },
      async download(id) {
        const text = await req(`${API}/files/${encodeURIComponent(id)}?alt=media`, {}, 'text');
        try { return JSON.parse(text); } catch { throw new DriveError('El archivo de datos en Drive está dañado', 0, 'corrupt'); }
      },
      create(doc) {
        const b = 'finanzas_' + Math.random().toString(36).slice(2);
        const meta = { name: fileName, parents: ['appDataFolder'], mimeType: 'application/json' };
        const body = `--${b}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(meta)}\r\n--${b}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(doc)}\r\n--${b}--`;
        return req(`${UPLOAD}/files?uploadType=multipart&fields=${FIELDS}`, { method: 'POST', headers: { 'Content-Type': `multipart/related; boundary=${b}` }, body });
      },
      update(id, doc) {
        return req(`${UPLOAD}/files/${encodeURIComponent(id)}?uploadType=media&fields=${FIELDS}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json; charset=UTF-8' }, body: JSON.stringify(doc) });
      },
      /* --- Archivos adjuntos: cada uno es un archivo aparte en appDataFolder --- */
      /** Busca un adjunto ya subido por su nombre (para no duplicarlo si se cortó una subida). */
      async findByName(name) {
        const q = encodeURIComponent(`name='${String(name).replace(/'/g, "\\'")}' and trashed=false`);
        const r = await req(`${API}/files?spaces=appDataFolder&q=${q}&pageSize=10&fields=${encodeURIComponent('files(' + FIELDS + ',size)')}`);
        return r.files || [];
      },
      /** Subida binaria (multipart/related) de un Blob. */
      uploadBlob(name, blob, mimeType, appProperties = {}) {
        const b = 'finanzas_' + Math.random().toString(36).slice(2);
        const meta = { name, parents: ['appDataFolder'], mimeType, appProperties };
        const body = new Blob([
          `--${b}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(meta)}\r\n--${b}\r\nContent-Type: ${mimeType}\r\n\r\n`,
          blob, `\r\n--${b}--`]);
        return req(`${UPLOAD}/files?uploadType=multipart&fields=${FIELDS},size`, { method: 'POST', headers: { 'Content-Type': `multipart/related; boundary=${b}` }, body });
      },
      downloadBlob(id) { return req(`${API}/files/${encodeURIComponent(id)}?alt=media`, {}, 'blob'); },
      /* --- Archivos VISIBLES en Drive (copia para análisis; permiso drive.file) --- */
      /** Busca por consulta en el espacio normal de Drive (con drive.file solo ve lo que creó la app). */
      async query(q, fields = FIELDS) {
        const r = await req(`${API}/files?spaces=drive&q=${encodeURIComponent(q)}&pageSize=20&fields=${encodeURIComponent('files(' + fields + ')')}`);
        return r.files || [];
      },
      createFolder(name, description = '') {
        return req(`${API}/files?fields=${FIELDS}`, { method: 'POST', headers: { 'Content-Type': 'application/json; charset=UTF-8' }, body: JSON.stringify({ name, description, mimeType: 'application/vnd.google-apps.folder' }) });
      },
      createText(name, parentId, mimeType, text, description = '') {
        const b = 'finanzas_' + Math.random().toString(36).slice(2);
        const meta = { name, parents: [parentId], mimeType, description };
        const body = `--${b}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(meta)}\r\n--${b}\r\nContent-Type: ${mimeType}; charset=UTF-8\r\n\r\n${text}\r\n--${b}--`;
        return req(`${UPLOAD}/files?uploadType=multipart&fields=${FIELDS}`, { method: 'POST', headers: { 'Content-Type': `multipart/related; boundary=${b}` }, body });
      },
      updateText(id, mimeType, text) {
        return req(`${UPLOAD}/files/${encodeURIComponent(id)}?uploadType=media&fields=${FIELDS}`, { method: 'PATCH', headers: { 'Content-Type': mimeType + '; charset=UTF-8' }, body: text });
      },
      getMeta(id) { return req(`${API}/files/${encodeURIComponent(id)}?fields=${encodeURIComponent(FIELDS + ',trashed')}`); },
      remove(id) { return req(`${API}/files/${encodeURIComponent(id)}`, { method: 'DELETE' }, 'none'); },
      about() { return req(`${API}/about?fields=${encodeURIComponent('user(displayName,emailAddress,photoLink)')}`); }
    };
  }

  /* ---------- Adaptador Drive (con caché offline y cola de cambios) ---------- */
  class DriveAdapter {
    /**
     * @param {object} o
     *  cache: createLocalCache(...)   client: createDriveClient(...)
     *  isOnline(): bool               debounceMs: espera antes de subir
     *  onStatus(status, detail)       onRemoteData(doc): llegan datos nuevos de otro dispositivo
     */
    constructor({ cache, client, isOnline = () => true, debounceMs = 2000, now = () => Date.now(), onStatus = () => {}, onRemoteData = () => {}, onSynced = () => {} }) {
      Object.assign(this, { cache, client, isOnline, debounceMs, now, onStatus, onRemoteData, onSynced });
      this.kind = 'drive'; this.changeSeq = 0; this.timer = null; this.running = null; this.again = false;
      this.status = 'idle'; this.detail = '';
    }
    async load() { return this.cache.load(); }
    async save(doc) {
      this.cache.save(doc); this.changeSeq++;
      this.cache.setMeta({ dirty: true });             // la "cola": hay cambios locales pendientes de subir
      if (!this.isOnline()) this._setStatus('offline');
      else this.schedule();
    }
    async clear() { this.cache.clear(); }
    get pending() { return !!this.cache.getMeta().dirty; }
    schedule(ms = this.debounceMs) {
      clearTimeout(this.timer);
      this.timer = setTimeout(() => this.sync(), ms);
    }
    stop() { clearTimeout(this.timer); this.timer = null; }
    _setStatus(s, detail = '') { this.status = s; this.detail = detail; this.onStatus(s, detail); }

    /** Descarga, fusiona y sube si hace falta. Nunca lanza: devuelve {ok, changed?, error?}. */
    async sync({ force = false } = {}) {
      clearTimeout(this.timer);
      if (this.running) { this.again = true; return this.running; }
      if (!this.isOnline()) { this._setStatus('offline'); return { ok: false, reason: 'offline' }; }
      this.running = this._doSync(force).finally(() => {
        this.running = null;
        if (this.again) { this.again = false; this.schedule(0); }
      });
      return this.running;
    }

    async _doSync(force) {
      this._setStatus('syncing');
      try {
        const meta = this.cache.getMeta();
        const seq = this.changeSeq;
        const files = await this.client.listFiles();
        files.sort((a, b) => (a.createdTime || '').localeCompare(b.createdTime || '') || a.id.localeCompare(b.id));
        const main = files[0];

        // Atajo: nada pendiente en local y el archivo remoto no ha cambiado desde la última vez
        if (!force && !meta.dirty && main && files.length === 1 && main.id === meta.fileId && main.modifiedTime === meta.remoteModified) {
          this.cache.setMeta({ lastSyncAt: this.now() });
          this._setStatus('synced');
          try { this.onSynced(this.cache.load()); } catch (e) { /* nada */ }
          return { ok: true, changed: false, uploaded: false };
        }

        // Descargar (si hubiera varios archivos por un primer login simultáneo, se fusionan todos)
        let remote = null;
        for (const f of files) {
          const d = await this.client.download(f.id);
          remote = remote ? Core.mergeDocs(remote, d, this.now()) : d;
        }
        const local = this.cache.load();
        const merged = Core.mergeDocs(local, remote, this.now()) || Core.mergeDocs({}, null, this.now());

        let info = main, uploaded = false;
        if (!main) { info = await this.client.create(Core.toRemote(merged)); uploaded = true; }
        else if (files.length > 1 || !Core.sameData(merged, remote)) { info = await this.client.update(main.id, Core.toRemote(merged)); uploaded = true; }
        for (const f of files.slice(1)) await this.client.remove(f.id);

        // ¿Ha cambiado algo en local mientras sincronizábamos? Se fusiona y se vuelve a programar.
        let final = merged, stillDirty = false;
        if (this.changeSeq !== seq) { final = Core.mergeDocs(this.cache.load(), merged, this.now()); stillDirty = true; }
        this.cache.save(final);
        this.cache.setMeta({ dirty: stillDirty, fileId: info.id, remoteModified: info.modifiedTime, lastSyncAt: this.now() });
        const changed = !Core.sameData(final, local);
        if (changed) this.onRemoteData(final);
        this._setStatus('synced');
        if (stillDirty) this.schedule();
        try { this.onSynced(final); } catch (e) { /* p. ej. subida de adjuntos: no rompe la sincronización */ }
        return { ok: true, changed, uploaded };
      } catch (e) {
        if (e.code === 'auth') this._setStatus('auth', e.message);
        else if (e.code === 'network' || !this.isOnline()) this._setStatus('offline', e.message);
        else this._setStatus('error', e.message || String(e));
        return { ok: false, error: e };
      }
    }
  }

  const api = { createLocalCache, LocalStorageAdapter, DriveAdapter, DriveError, createDriveClient };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.FinanzasStorage = api;
})(typeof self !== 'undefined' ? self : globalThis);
