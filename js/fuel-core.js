/* =========================================================
   Combustible y vehículos: cálculos puros (sin DOM ni red).
   Se usa en el navegador (window.FuelCore) y en los tests de Node.

   Datos de cada repostaje: fecha, litros, precio por litro, importe,
   «km hechos con el depósito anterior» (kmTanqueAnterior, opcional),
   odómetro (opcional) y si se llenó el depósito (lleno).

   MÉTODO DE CONSUMO (L/100 km, km/L, €/km)
   1) Lleno a lleno (el más fiable). Al llenar el depósito, los litros que
      entran son justo lo que el coche gastó desde el lleno anterior. Un
      «tramo» va de un repostaje lleno al siguiente lleno; sus litros y su
      coste son la suma de los repostajes posteriores al primer lleno hasta
      el segundo, ambos incluidos (así los parciales intermedios se suman),
      y sus km son la suma de los km anotados en esos repostajes (o, si falta
      alguno, la diferencia de odómetro entre los dos llenos).
      Los parciales del final, sin un lleno posterior, aún no cuentan.
   2) Aproximado (solo si el vehículo no tiene ningún tramo lleno a lleno,
      p. ej. quien siempre echa «20 €» al encender la reserva): para cada
      repostaje con km anotados, consumo = litros del repostaje ANTERIOR /
      km hechos con ese depósito. Se marca como «aprox.».
   Km de un repostaje: el dato «km con el depósito anterior»; si falta y hay
   odómetro en este repostaje y en el anterior, su diferencia.
   Precio medio €/L ponderado = Σ importe / Σ litros.
   ========================================================= */
(function (root) {
  'use strict';
  const r2 = n => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
  const r3 = n => Math.round((Number(n) + Number.EPSILON) * 1000) / 1000;
  const pos = v => { const n = Number(v); return isFinite(n) && n > 0 ? n : null; };
  const COMBUSTIBLES = { gasoil: 'Gasoil (diésel)', gasolina: 'Gasolina', otro: 'Otro' };
  const CATEGORIA = 'Combustible';
  const esCategoriaCombustible = c => /combustible|gasoil|gas[oó]leo|gasolina|di[eé]sel|carburante|repostaje/i.test(String(c || ''));

  /** «1234-abc », «1234 ABC» → «1234ABC» (mayúsculas, sin espacios, guiones ni puntos). */
  const normalizarMatricula = s => String(s || '').toUpperCase().replace(/[\s\-.·_/]/g, '');

  /** Importe/litros/precio coherentes: calcula el que falta (o el indicado en «calcular»). */
  function cuadrar({ precioLitro, litros, importe }, calcular) {
    const p = pos(precioLitro), l = pos(litros), i = pos(importe);
    const falta = calcular || (i === null ? 'importe' : l === null ? 'litros' : p === null ? 'precioLitro' : null);
    const o = { precioLitro: p, litros: l, importe: i };
    if (falta === 'importe' && p && l) o.importe = r2(p * l);
    else if (falta === 'litros' && p && i) o.litros = r2(i / p);
    else if (falta === 'precioLitro' && l && i) o.precioLitro = r3(i / l);
    return o;
  }
  /** ¿Cuadran precio × litros e importe? Tolerancia: 1 % o 0,10 € (redondeos del surtidor). */
  function cuadra(precioLitro, litros, importe) {
    const esperado = Number(precioLitro) * Number(litros), dif = Math.abs(esperado - Number(importe));
    return { ok: dif <= Math.max(0.10, Math.abs(esperado) * 0.01), esperado: r2(esperado), diferencia: r2(Number(importe) - esperado) };
  }

  const ordenarRepostajes = l => (l || []).slice().sort((a, b) =>
    String(a.fecha).localeCompare(String(b.fecha)) ||
    ((a.odometro || 0) && (b.odometro || 0) ? a.odometro - b.odometro : 0) ||
    (Number(a.creado) || 0) - (Number(b.creado) || 0) || String(a.id).localeCompare(String(b.id)));

  /** Repostajes de un vehículo ordenados y con los km de su intervalo resueltos (km, kmFuente). */
  function filas(repostajes) {
    const out = [];
    let prev = null;
    for (const r of ordenarRepostajes(repostajes)) {
      let km = pos(r.kmTanqueAnterior), kmFuente = km ? 'dato' : null;
      if (!km && prev && pos(r.odometro) && pos(prev.odometro) && r.odometro > prev.odometro) { km = r.odometro - prev.odometro; kmFuente = 'odometro'; }
      const litros = Number(r.litros) || 0, importe = Number(r.importe) || 0;
      out.push({ ...r, litros, importe, precioLitro: Number(r.precioLitro) || (litros ? importe / litros : 0), km, kmFuente, lleno: r.lleno !== false });
      prev = r;
    }
    return out;
  }

  const tramo = (o) => ({ ...o, litros: r2(o.litros), coste: r2(o.coste), km: Math.round(o.km * 10) / 10,
    l100: r2(o.litros / o.km * 100), kmL: r2(o.km / o.litros), eurKm: Math.round(o.coste / o.km * 1000) / 1000 });

  /** Tramos de consumo de un vehículo (ver método arriba). */
  function tramos(repostajes) {
    const f = Array.isArray(repostajes) && repostajes.length && 'kmFuente' in repostajes[0] ? repostajes : filas(repostajes);
    const out = [];
    let ini = -1;
    for (let i = 0; i < f.length; i++) {
      if (!f[i].lleno) continue;
      if (ini >= 0) {
        const parte = f.slice(ini + 1, i + 1);
        let km = parte.every(x => x.km) ? parte.reduce((s, x) => s + x.km, 0) : null;
        if (!km && pos(f[ini].odometro) && pos(f[i].odometro) && f[i].odometro > f[ini].odometro) km = f[i].odometro - f[ini].odometro;
        const litros = parte.reduce((s, x) => s + x.litros, 0), coste = parte.reduce((s, x) => s + x.importe, 0);
        if (km > 0 && litros > 0) out.push(tramo({ desde: f[ini].fecha, hasta: f[i].fecha, hastaId: f[i].id, repostajes: parte.length, litros, coste, km, metodo: 'lleno' }));
      }
      ini = i;
    }
    if (out.length) return out;
    for (let i = 1; i < f.length; i++) {
      if (!f[i].km || !(f[i - 1].litros > 0)) continue;
      out.push(tramo({ desde: f[i - 1].fecha, hasta: f[i].fecha, hastaId: f[i].id, repostajes: 1, litros: f[i - 1].litros, coste: f[i - 1].importe, km: f[i].km, metodo: 'aprox' }));
    }
    return out;
  }

  const enPeriodo = (fecha, desde, hasta) => (!desde || fecha >= desde) && (!hasta || fecha <= hasta);
  /** Agrega repostajes y tramos (ya filtrados) en las métricas que muestra la app. */
  function agregar(reps, segs) {
    const gasto = reps.reduce((s, r) => s + r.importe, 0), litros = reps.reduce((s, r) => s + r.litros, 0);
    const kmAnotados = reps.reduce((s, r) => s + (r.km || 0), 0);
    const kmT = segs.reduce((s, t) => s + t.km, 0), lT = segs.reduce((s, t) => s + t.litros, 0), cT = segs.reduce((s, t) => s + t.coste, 0);
    const precios = reps.map(r => r.precioLitro).filter(p => p > 0);
    return {
      repostajes: reps.length, gasto: r2(gasto), litros: r2(litros),
      precioMedio: litros > 0 ? r3(gasto / litros) : null,
      precioMin: precios.length ? r3(Math.min(...precios)) : null, precioMax: precios.length ? r3(Math.max(...precios)) : null,
      km: Math.round(kmAnotados * 10) / 10,
      kmConsumo: Math.round(kmT * 10) / 10, litrosConsumo: r2(lT), costeConsumo: r2(cT),
      l100: kmT > 0 ? r2(lT / kmT * 100) : null, kmL: lT > 0 ? r2(kmT / lT) : null, eurKm: kmT > 0 ? Math.round(cT / kmT * 1000) / 1000 : null,
      aproximado: segs.length > 0 && segs.every(t => t.metodo === 'aprox'),
      tramos: segs.length
    };
  }

  /** Métricas de un vehículo (opcionalmente en un periodo [desde, hasta] de fechas ISO). */
  function metricasVehiculo(vehiculo, repostajes, { desde = null, hasta = null } = {}) {
    const f = filas((repostajes || []).filter(r => !vehiculo || r.vehiculoId === vehiculo.id));
    const segs = tramos(f);
    const reps = f.filter(r => enPeriodo(r.fecha, desde, hasta));
    const segsP = segs.filter(t => enPeriodo(t.hasta, desde, hasta));
    const m = agregar(reps, segsP);
    const global = agregar(f, segs); // autonomía con todo el historial
    const ultimo = f.length ? f[f.length - 1] : null;
    const cap = vehiculo ? pos(vehiculo.capacidad) : null;
    let odo = vehiculo && Number(vehiculo.kmIniciales) >= 0 && vehiculo.kmIniciales !== null && vehiculo.kmIniciales !== '' ? Number(vehiculo.kmIniciales) : null;
    for (const r of f) { if (pos(r.odometro)) odo = r.odometro; else if (odo !== null && r.km) odo += r.km; }
    return {
      ...m, ultimo, filas: f, tramosLista: segs,
      capacidad: cap, autonomia: cap && global.kmL ? Math.round(cap * global.kmL) : null,
      costeLleno: cap && ultimo && ultimo.precioLitro ? r2(cap * ultimo.precioLitro) : null,
      odometroEstimado: odo === null ? null : Math.round(odo),
      excedeCapacidad: cap ? f.filter(r => r.litros > cap * 1.05).map(r => r.id) : []
    };
  }

  /** Totales mensuales (YYYY-MM) de un conjunto de vehículos: gasto, litros, km, €/L, L/100 km. */
  function porMes(vehiculos, repostajes, { desde = null, hasta = null } = {}) {
    const acc = {};
    for (const v of vehiculos) {
      const f = filas(repostajes.filter(r => r.vehiculoId === v.id)), segs = tramos(f);
      for (const r of f) if (enPeriodo(r.fecha, desde, hasta)) { const k = r.fecha.slice(0, 7), a = acc[k] || (acc[k] = { reps: [], segs: [] }); a.reps.push(r); }
      for (const t of segs) if (enPeriodo(t.hasta, desde, hasta)) { const k = t.hasta.slice(0, 7), a = acc[k] || (acc[k] = { reps: [], segs: [] }); a.segs.push(t); }
    }
    return Object.keys(acc).sort().map(mes => ({ mes, ...agregar(acc[mes].reps, acc[mes].segs) }));
  }
  /** Igual que porMes pero por año (YYYY). */
  function porAnio(vehiculos, repostajes) {
    const acc = {};
    for (const v of vehiculos) {
      const f = filas(repostajes.filter(r => r.vehiculoId === v.id)), segs = tramos(f);
      for (const r of f) (acc[r.fecha.slice(0, 4)] || (acc[r.fecha.slice(0, 4)] = { reps: [], segs: [] })).reps.push(r);
      for (const t of segs) (acc[t.hasta.slice(0, 4)] || (acc[t.hasta.slice(0, 4)] = { reps: [], segs: [] })).segs.push(t);
    }
    return Object.keys(acc).sort().map(anio => ({ anio, ...agregar(acc[anio].reps, acc[anio].segs) }));
  }

  /** Resumen de todos los vehículos: métricas de cada uno y totales (€/km y L/100 km ponderados por km). */
  function resumen(vehiculos, repostajes, periodo = {}) {
    const lista = vehiculos.map(v => ({ vehiculo: v, m: metricasVehiculo(v, repostajes, periodo) }));
    const reps = [], segs = [];
    for (const { m } of lista) { reps.push(...m.filas.filter(r => enPeriodo(r.fecha, periodo.desde, periodo.hasta))); segs.push(...m.tramosLista.filter(t => enPeriodo(t.hasta, periodo.desde, periodo.hasta))); }
    const total = agregar(reps, segs);
    total.ultimo = reps.length ? ordenarRepostajes(reps).pop() : null;
    return { vehiculos: lista, total };
  }

  const api = { COMBUSTIBLES, CATEGORIA, esCategoriaCombustible, normalizarMatricula, cuadrar, cuadra, ordenarRepostajes, filas, tramos, metricasVehiculo, porMes, porAnio, resumen };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.FuelCore = api;
})(typeof self !== 'undefined' ? self : globalThis);
