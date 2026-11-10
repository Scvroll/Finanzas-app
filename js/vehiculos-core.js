/* =========================================================
   Gastos de vehículo (v3.10), sin DOM.
   Un gasto cuenta para un vehículo si:
     - tiene vehiculoId, o
     - es un repostaje enlazado (movimientoId / repostajeId).
   Los km salen de los repostajes (odómetro y kmTanqueAnterior).
   ========================================================= */
(function (root) {
  'use strict';
  const ROUND2 = n => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
  const TEXT = s => String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');

  /** Palabras que sugieren un gasto de coche (categoría o descripción). */
  const PALABRAS = [
    'seguro coche', 'seguro del coche', 'seguro vehiculo', 'seguro del vehiculo', 'seguro auto',
    'itv', 'taller', 'mecanico', 'neumatico', 'rueda', 'llanta',
    'peaje', 'parking', 'aparcamiento', 'ivtm', 'circulacion', 'impuesto de circulacion',
    'lavado', 'tunel de lavado', 'gasolina', 'gasoil', 'diesel', 'combustible',
    'repostaje', 'aceite motor', 'revision', 'itinerario', 'autopista', 'garaje'
  ];
  // "garaje" es habitualmente plaza, no coche: lo dejamos para descripción explícita junto a otras palabras,
  // pero "parking" y "aparcamiento" sí. Filtramos "garaje" solo si no va acompañado.
  const PALABRAS_SUELTAS_DEBILES = new Set(['garaje', 'revision']);

  function esCategoriaCombustible(cat) {
    const t = TEXT(cat);
    return t === 'combustible' || t === 'carburante' || t === 'gasolina' || t === 'gasoil' || t === 'diesel';
  }

  function pareceDeCoche(mov) {
    if (!mov || mov.tipo !== 'gasto') return false;
    if (esCategoriaCombustible(mov.categoria)) return true;
    const t = TEXT((mov.categoria || '') + ' ' + (mov.descripcion || ''));
    if (!t.trim()) return false;
    return PALABRAS.some(p => {
      if (!t.includes(p)) return false;
      if (PALABRAS_SUELTAS_DEBILES.has(p)) {
        // "garaje" / "revisión" solos no bastan si la categoría no es de coche
        const resto = PALABRAS.filter(x => x !== p);
        return resto.some(x => t.includes(x)) || /coche|vehiculo|auto|moto/.test(t);
      }
      return true;
    });
  }

  /** vehiculoId efectivo de un gasto: el del movimiento o el de su repostaje. */
  function vehiculoDeMov(mov, repostajes) {
    if (!mov || mov.tipo !== 'gasto') return '';
    if (mov.vehiculoId) return String(mov.vehiculoId);
    const reps = repostajes || [];
    const r = reps.find(x => x && !x.deleted && x.movimientoId === mov.id)
      || (mov.repostajeId ? reps.find(x => x && !x.deleted && x.id === mov.repostajeId) : null);
    return r && r.vehiculoId ? String(r.vehiculoId) : '';
  }

  function esRepostaje(mov, repostajes) {
    if (!mov) return false;
    if (mov.repostajeId) return true;
    return !!(repostajes || []).find(x => x && !x.deleted && x.movimientoId === mov.id);
  }

  /** Agrupa un gasto en una etiqueta de desglose. */
  function grupoCategoria(mov, esRep) {
    if (esRep || esCategoriaCombustible(mov.categoria)) return 'Combustible';
    const t = TEXT((mov.categoria || '') + ' ' + (mov.descripcion || ''));
    if (/seguro/.test(t)) return 'Seguro';
    if (/itv/.test(t)) return 'ITV';
    if (/taller|mecanico|neumatic|rueda|llanta|aceite|revision|manten/.test(t)) return 'Mantenimiento';
    if (/impuesto|ivtm|circulacion/.test(t)) return 'Impuestos';
    if (/peaje|autopista/.test(t)) return 'Peajes';
    if (/parking|aparcamiento|estacionamiento/.test(t)) return 'Parking';
    if (/lavado/.test(t)) return 'Lavado';
    if (/financ|cuota|prestamo.*coche|leasing|renting/.test(t)) return 'Financiación';
    return mov.categoria || 'Otros';
  }

  function enRango(fecha, desde, hasta) {
    if (desde && fecha < desde) return false;
    if (hasta && fecha > hasta) return false;
    return true;
  }

  function mesesCubiertos(desde, hasta) {
    if (!desde || !hasta || hasta < desde) return 0;
    const a = desde.slice(0, 7), b = hasta.slice(0, 7);
    const [ay, am] = a.split('-').map(Number), [by, bm] = b.split('-').map(Number);
    return (by - ay) * 12 + (bm - am) + 1;
  }

  /** Km del periodo a partir de los repostajes del vehículo. */
  function kmDelPeriodo(reps, desde, hasta) {
    const lista = (reps || []).filter(r => r && !r.deleted).slice().sort((a, b) =>
      String(a.fecha).localeCompare(String(b.fecha)) || String(a.id || '').localeCompare(String(b.id || '')));
    let km = 0, odoMin = null, odoMax = null;
    for (const r of lista) {
      if (!enRango(r.fecha, desde, hasta)) continue;
      if (Number(r.kmTanqueAnterior) > 0) km += Number(r.kmTanqueAnterior);
      if (Number(r.odometro) > 0) {
        const o = Number(r.odometro);
        if (odoMin === null || o < odoMin) odoMin = o;
        if (odoMax === null || o > odoMax) odoMax = o;
      }
    }
    if (km > 0) return { km: Math.round(km * 10) / 10, fuente: 'tanque' };
    if (odoMin !== null && odoMax !== null && odoMax > odoMin) return { km: odoMax - odoMin, fuente: 'odometro' };
    return { km: 0, fuente: null };
  }

  /**
   * Coste de un vehículo en un periodo.
   * opts: { vehiculoId, movimientos, repostajes, desde, hasta, hoy }
   */
  function costeVehiculo({ vehiculoId, movimientos = [], repostajes = [], desde = null, hasta = null, hoy = null }) {
    const reps = (repostajes || []).filter(r => r && !r.deleted && String(r.vehiculoId) === String(vehiculoId));
    const gastos = [];
    const porGrupo = {};
    for (const m of movimientos || []) {
      if (!m || m.deleted || m.tipo !== 'gasto') continue;
      if (!enRango(m.fecha, desde, hasta)) continue;
      if (vehiculoDeMov(m, repostajes) !== String(vehiculoId)) continue;
      const rep = esRepostaje(m, repostajes);
      const grupo = grupoCategoria(m, rep);
      const item = { id: m.id, fecha: m.fecha, importe: ROUND2(m.importe), categoria: m.categoria || '', descripcion: m.descripcion || '', grupo, esRepostaje: rep };
      gastos.push(item);
      porGrupo[grupo] = ROUND2((porGrupo[grupo] || 0) + item.importe);
    }
    gastos.sort((a, b) => b.fecha.localeCompare(a.fecha) || String(b.id).localeCompare(String(a.id)));
    const total = ROUND2(gastos.reduce((s, g) => s + g.importe, 0));
    const { km, fuente } = kmDelPeriodo(reps, desde, hasta);
    const eurKm = km > 0 ? Math.round((total / km) * 1000) / 1000 : null;
    const h = hoy || hasta;
    const nMeses = mesesCubiertos(desde, h) || (gastos.length ? mesesCubiertos(gastos[gastos.length - 1].fecha, gastos[0].fecha) : 0);
    const mediaMensual = nMeses > 0 ? ROUND2(total / nMeses) : null;
    const noCombustible = gastos.filter(g => !g.esRepostaje);
    return { total, porGrupo, gastos, noCombustible, km, kmFuente: fuente, eurKm, mediaMensual, meses: nMeses };
  }

  /** Lista de gastos sin vehículo que parecen de coche (para asignación masiva). */
  function candidatosSinVehiculo(movimientos, repostajes) {
    return (movimientos || []).filter(m => m && !m.deleted && m.tipo === 'gasto' && !vehiculoDeMov(m, repostajes) && pareceDeCoche(m))
      .slice().sort((a, b) => b.fecha.localeCompare(a.fecha) || String(b.id).localeCompare(String(a.id)));
  }

  /**
   * Sugerencia al abrir un gasto nuevo:
   *  { vehiculoId } si hay uno solo en uso y el texto parece de coche;
   *  { aviso: true } si parece de coche y hay varios;
   *  null si no aplica.
   */
  function sugerirVehiculo(mov, vehiculos) {
    const activos = (vehiculos || []).filter(v => v && !v.deleted && v.activo !== false);
    if (!pareceDeCoche(mov) || !activos.length) return null;
    if (activos.length === 1) return { vehiculoId: activos[0].id };
    return { aviso: true, n: activos.length };
  }

  const api = {
    PALABRAS, pareceDeCoche, vehiculoDeMov, esRepostaje, grupoCategoria,
    costeVehiculo, candidatosSinVehiculo, sugerirVehiculo, esCategoriaCombustible, kmDelPeriodo, mesesCubiertos
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.VehiculosCore = api;
})(typeof self !== 'undefined' ? self : globalThis);
