/* =========================================================
   Lógica pura de sincronización (sin DOM ni red).
   Se usa en el navegador y en los tests de Node.
   Modelo:
   - Cada registro de cada colección (movimientos, recurrentes, deudas,
     adjuntos, activos, operaciones, precios, vehiculos, repostajes…) tiene id y updatedAt (ms).
   - Borrar = "lápida" (tombstone): {id, deleted:true, updatedAt}.
     Así otro dispositivo no "resucita" lo borrado.
   - Fusión por id: gana la versión con updatedAt más reciente
     (last-write-wins por registro). Empate: gana la lápida; si no, la copia
     con más campos (la que no ha pasado por una versión antigua); si no, orden fijo.
   - Las listas de categorías se tratan como un único registro LWW.
   - Los ajustes (tema) son del dispositivo y no se sincronizan.
   ========================================================= */
(function (root) {
  'use strict';
  const DOC_VERSION = 3;
  // Colecciones sincronizadas registro a registro. «inversiones» es la de la v2: se conserva
  // solo para que sus lápidas (tras migrar a activos/operaciones) lleguen a todos los dispositivos.
  // v3.4 añade cuentas, traspasos (entre cuentas), regularizaciones («Ajustar saldo») y traspasosFondos.
  const COLLECTIONS = ['movimientos', 'inversiones', 'recurrentes', 'deudas', 'adjuntos', 'activos', 'operaciones', 'precios', 'vehiculos', 'repostajes',
    'cuentas', 'traspasos', 'regularizaciones', 'traspasosFondos'];
  // Lápidas que no se purgan nunca: los movimientos generados por plantillas recurrentes tienen id
  // determinista y se volverían a generar si su lápida desapareciera.
  const NO_PURGAR = /^rec_/;
  const TOMBSTONE_TTL_MS = 180 * 24 * 3600 * 1000; // las lápidas se purgan a los 180 días

  const clone = o => JSON.parse(JSON.stringify(o));

  function stableStringify(v) {
    if (Array.isArray(v)) return '[' + v.map(stableStringify).join(',') + ']';
    if (v && typeof v === 'object') return '{' + Object.keys(v).sort().map(k => JSON.stringify(k) + ':' + stableStringify(v[k])).join(',') + '}';
    return JSON.stringify(v);
  }

  function pickWinner(a, b) {
    const ta = a.updatedAt || 0, tb = b.updatedAt || 0;
    if (ta !== tb) return ta > tb ? a : b;
    if (!!a.deleted !== !!b.deleted) return a.deleted ? a : b;
    // Misma versión, pero una copia tiene campos de más: es la original y la otra viene de una
    // versión antigua de la app que quitó los campos que no conoce (p. ej. cuentaId) sin cambiar
    // updatedAt. Gana la que conserva todos los campos.
    const ka = Object.keys(a), kb = Object.keys(b);
    if (ka.length !== kb.length) {
      const [mayor, menor, km] = ka.length > kb.length ? [a, b, kb] : [b, a, ka];
      if (km.every(k => k in mayor)) return mayor;
    }
    return stableStringify(a) >= stableStringify(b) ? a : b; // desempate determinista
  }

  function mergeCollections(a, b) {
    const map = new Map();
    for (const r of [...(a || []), ...(b || [])]) {
      if (!r || !r.id) continue;
      const cur = map.get(r.id);
      map.set(r.id, cur ? pickWinner(cur, r) : r);
    }
    return [...map.values()].sort((x, y) => (x.id < y.id ? -1 : x.id > y.id ? 1 : 0));
  }

  function purgeTombstones(list, now) {
    return list.filter(r => !(r.deleted && !NO_PURGAR.test(r.id) && (now - (r.updatedAt || 0)) > TOMBSTONE_TTL_MS));
  }

  function pickCategorias(a, b) {
    if (!a) return b; if (!b) return a;
    const ta = a.updatedAt || 0, tb = b.updatedAt || 0;
    if (ta !== tb) return ta > tb ? a : b;
    return stableStringify(a) >= stableStringify(b) ? a : b;
  }

  /** Fusiona dos documentos. `local` aporta los ajustes del dispositivo. */
  function mergeDocs(local, remote, now = Date.now()) {
    if (!local && !remote) return null;
    const L = local || {}, R = remote || {};
    const out = { version: DOC_VERSION };
    for (const c of COLLECTIONS) out[c] = purgeTombstones(mergeCollections(L[c], R[c]), now);
    out.categorias = clone(pickCategorias(L.categorias, R.categorias) || null);
    out.ajustes = clone(L.ajustes || R.ajustes || {});
    return out;
  }

  /** Lo que se sube a Drive (sin ajustes del dispositivo). */
  function toRemote(doc) {
    const out = { app: 'finanzas', version: DOC_VERSION, savedAt: new Date().toISOString() };
    for (const c of COLLECTIONS) out[c] = doc[c] || [];
    out.categorias = doc.categorias || null;
    return out;
  }

  /** ¿Tienen los dos documentos los mismos datos sincronizables? */
  function sameData(a, b) {
    if (!a || !b) return a === b;
    const pick = d => { const o = { c: d.categorias || null }; for (const c of COLLECTIONS) o[c] = mergeCollections(d[c], []); return o; };
    return stableStringify(pick(a)) === stableStringify(pick(b));
  }

  const hasData = d => !!d && (COLLECTIONS.some(c => (d[c] || []).length > 0) || !!(d.categorias && d.categorias.updatedAt > 0));

  const api = { DOC_VERSION, COLLECTIONS, TOMBSTONE_TTL_MS, mergeDocs, mergeCollections, pickWinner, toRemote, sameData, stableStringify, hasData };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.SyncCore = api;
})(typeof self !== 'undefined' ? self : globalThis);
