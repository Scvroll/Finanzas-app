/* =========================================================
   Cuentas y saldos (lógica pura, sin DOM). Se usa en el navegador y en los tests.
   Saldo de una cuenta = saldo inicial (al empezar el día «fecha del saldo»)
     + ingresos − gastos (también cuotas de deudas y repostajes)
     ± traspasos entre cuentas
     − compras de inversión (participaciones × precio + comisiones)
     + ventas de inversión (participaciones × precio − comisiones)
     ± ajustes de saldo,
   contando solo lo que tiene fecha igual o posterior a la del saldo inicial.
   Las compras financiadas no mueven dinero de la cuenta (lo mueven sus cuotas).
   Los traspasos y los ajustes NO son ingresos ni gastos: no cuentan en ningún resumen.
   ========================================================= */
(function (root) {
  'use strict';
  const round2 = n => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
  const TIPOS_CUENTA = { corriente: 'Cuenta corriente', ahorro: 'Cuenta de ahorro', inversion: 'Inversión / bróker', efectivo: 'Efectivo / cartera', otra: 'Otra' };
  const ICONO_TIPO = { corriente: '🏦', ahorro: '🐷', inversion: '📈', efectivo: '👛', otra: '💼' };
  const normNombre = s => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
  const vivos = l => (l || []).filter(x => x && !x.deleted);

  function indice(cuentas) {
    const byId = new Map(), byName = new Map();
    for (const c of vivos(cuentas)) { byId.set(c.id, c); const k = normNombre(c.nombre); if (k && !byName.has(k)) byName.set(k, c); }
    return { byId, byName };
  }
  /** Cuenta de un registro: primero por cuentaId; si no, por el nombre escrito en «cuenta» (sin mayúsculas ni acentos). */
  function resolver(rec, idx) {
    if (!rec) return null;
    if (rec.cuentaId && idx.byId.has(rec.cuentaId)) return idx.byId.get(rec.cuentaId);
    if (rec.cuentaId) return null; // vinculado a una cuenta borrada
    return rec.cuenta ? idx.byName.get(normNombre(rec.cuenta)) || null : null;
  }
  const ORDEN = { inicial: 0, ingreso: 1, 'traspaso-entrada': 2, venta: 3, gasto: 4, 'traspaso-salida': 5, compra: 6, ajuste: 9 };

  /** Todos los apuntes que mueven dinero de alguna cuenta. */
  function flujos({ cuentas, movimientos = [], traspasos = [], regularizaciones = [], operaciones = [], activos = [] }) {
    const idx = indice(cuentas), out = [];
    const nombreActivo = new Map(vivos(activos).map(a => [a.id, a.nombre]));
    const add = (c, e) => { if (c && e.fecha >= (c.fechaSaldo || '0000-00-00')) out.push({ cuentaId: c.id, ...e, importe: round2(e.importe) }); };
    for (const m of vivos(movimientos)) {
      if (m.financiadoPor) continue;
      const c = resolver(m, idx); if (!c) continue;
      add(c, { fecha: m.fecha, tipo: m.tipo === 'ingreso' ? 'ingreso' : 'gasto', importe: m.tipo === 'ingreso' ? m.importe : -m.importe, col: 'movimientos', ref: m.id, concepto: m.descripcion || m.categoria, categoria: m.categoria });
    }
    for (const t of vivos(traspasos)) {
      const o = idx.byId.get(t.origenId), d = idx.byId.get(t.destinoId);
      add(o, { fecha: t.fecha, tipo: 'traspaso-salida', importe: -t.importe, col: 'traspasos', ref: t.id, concepto: `Traspaso a ${d ? d.nombre : '¿cuenta borrada?'}`, otraId: t.destinoId, nota: t.nota || '' });
      add(d, { fecha: t.fecha, tipo: 'traspaso-entrada', importe: t.importe, col: 'traspasos', ref: t.id, concepto: `Traspaso desde ${o ? o.nombre : '¿cuenta borrada?'}`, otraId: t.origenId, nota: t.nota || '' });
    }
    for (const r of vivos(regularizaciones)) add(idx.byId.get(r.cuentaId), { fecha: r.fecha, tipo: 'ajuste', importe: r.importe, col: 'regularizaciones', ref: r.id, concepto: 'Ajuste de saldo' + (r.nota ? ' · ' + r.nota : ''), saldoReal: r.saldoReal });
    for (const op of vivos(operaciones)) {
      if (!op.cuentaId) continue;
      const c = idx.byId.get(op.cuentaId); if (!c) continue;
      const bruto = Number(op.participaciones) * Number(op.precio), com = Number(op.comisiones) || 0, venta = op.tipo === 'venta';
      add(c, { fecha: op.fecha, tipo: venta ? 'venta' : 'compra', importe: venta ? bruto - com : -(bruto + com), col: 'operaciones', ref: op.id, concepto: `${venta ? 'Venta' : 'Compra'} · ${nombreActivo.get(op.activoId) || 'activo'}`, activoId: op.activoId });
    }
    return out.sort(cmpFlujo);
  }
  const cmpFlujo = (a, b) => (a.fecha < b.fecha ? -1 : a.fecha > b.fecha ? 1 : 0) || (ORDEN[a.tipo] - ORDEN[b.tipo]) || String(a.ref).localeCompare(String(b.ref));

  /** Historial de una cuenta con el saldo tras cada apunte (orden cronológico). */
  function historial(cuenta, fl) {
    let saldo = round2(cuenta.saldoInicial || 0);
    return fl.filter(f => f.cuentaId === cuenta.id).map(f => { saldo = round2(saldo + f.importe); return { ...f, saldo }; });
  }
  /** Saldo al terminar el día `fecha` (incluido). */
  function saldoEn(cuenta, fl, fecha) {
    let s = Number(cuenta.saldoInicial) || 0;
    for (const f of fl) if (f.cuentaId === cuenta.id && f.fecha <= fecha) s += f.importe;
    return round2(s);
  }
  /** Saldos de todas las cuentas a `hoy` (y con lo que tiene fecha futura). */
  function saldos(datos, hoy) {
    const fl = flujos(datos), cuentas = vivos(datos.cuentas);
    const lista = cuentas.map(c => {
      const r = { cuenta: c, saldoInicial: round2(c.saldoInicial || 0), saldo: round2(c.saldoInicial || 0), saldoFinal: round2(c.saldoInicial || 0), ingresos: 0, gastos: 0, traspasosEntrada: 0, traspasosSalida: 0, compras: 0, ventas: 0, ajustes: 0, n: 0, futuros: 0 };
      for (const f of fl) {
        if (f.cuentaId !== c.id) continue;
        r.n++; r.saldoFinal += f.importe;
        if (f.fecha > hoy) { r.futuros++; continue; }
        r.saldo += f.importe;
        const k = { ingreso: 'ingresos', gasto: 'gastos', 'traspaso-entrada': 'traspasosEntrada', 'traspaso-salida': 'traspasosSalida', compra: 'compras', venta: 'ventas', ajuste: 'ajustes' }[f.tipo];
        r[k] += Math.abs(f.importe) * (f.tipo === 'ajuste' ? Math.sign(f.importe) : 1);
      }
      for (const k of ['saldo', 'saldoFinal', 'ingresos', 'gastos', 'traspasosEntrada', 'traspasosSalida', 'compras', 'ventas', 'ajustes']) r[k] = round2(r[k]);
      return r;
    });
    const activas = lista.filter(x => x.cuenta.activa !== false || Math.abs(x.saldo) > 0.004);
    return { lista, flujos: fl, total: round2(activas.reduce((s, x) => s + x.saldo, 0)) };
  }
  /** Saldo a fin de cada mes entre dos meses (YYYY-MM). */
  function serieMensual(cuenta, fl, desdeYm, hastaYm) {
    const out = []; let ym = desdeYm;
    const fin = ym => { const [y, m] = ym.split('-').map(Number); return `${ym}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, '0')}`; };
    const sig = ym => { const [y, m] = ym.split('-').map(Number); return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`; };
    for (let i = 0; i < 600 && ym <= hastaYm; i++, ym = sig(ym)) out.push({ mes: ym, saldo: saldoEn(cuenta, fl, fin(ym)) });
    return out;
  }
  /** Diferencia a apuntar para que el saldo de la cuenta el día `fecha` sea `saldoReal`. */
  function diferenciaAjuste(cuenta, fl, fecha, saldoReal) { return round2(saldoReal - saldoEn(cuenta, fl, fecha)); }

  /** Dinero invertido en un periodo (prefijo de fecha: 'YYYY-MM' o 'YYYY'): compras con comisiones − ventas netas. */
  function invertidoPeriodo(operaciones, prefijo) {
    let compras = 0, ventas = 0, n = 0;
    for (const o of vivos(operaciones)) {
      if (!String(o.fecha).startsWith(prefijo)) continue;
      const bruto = Number(o.participaciones) * Number(o.precio), com = Number(o.comisiones) || 0; n++;
      if (o.tipo === 'venta') ventas += bruto - com; else compras += bruto + com;
    }
    return { compras: round2(compras), ventas: round2(ventas), neto: round2(compras - ventas), n };
  }
  function traspasosPeriodo(traspasos, prefijo) {
    const l = vivos(traspasos).filter(t => String(t.fecha).startsWith(prefijo));
    return { n: l.length, importe: round2(l.reduce((s, t) => s + t.importe, 0)) };
  }
  /** Nombres de cuenta escritos a mano que no corresponden a ninguna cuenta creada (con cuántos registros los usan). */
  function nombresSinCuenta(cuentas, ...colecciones) {
    const idx = indice(cuentas), m = new Map();
    for (const col of colecciones) for (const r of vivos(col)) {
      const n = String(r.cuenta || '').trim(); if (!n || r.cuentaId) continue;
      const k = normNombre(n); if (idx.byName.has(k)) continue;
      const cur = m.get(k) || { nombre: n, n: 0 }; cur.n++; m.set(k, cur);
    }
    return [...m.values()].sort((a, b) => b.n - a.n || a.nombre.localeCompare(b.nombre));
  }
  /** ¿Se usa la cuenta en algún registro? Devuelve el recuento por colección. */
  function usos(cuenta, { movimientos = [], recurrentes = [], deudas = [], operaciones = [], traspasos = [], regularizaciones = [], cuentas = [] }) {
    const idx = indice(cuentas.length ? cuentas : [cuenta]);
    const es = r => { const c = resolver(r, idx); return (c && c.id === cuenta.id) || r.cuentaId === cuenta.id; };
    const u = {
      movimientos: vivos(movimientos).filter(es).length, recurrentes: vivos(recurrentes).filter(es).length, deudas: vivos(deudas).filter(es).length,
      operaciones: vivos(operaciones).filter(o => o.cuentaId === cuenta.id).length,
      traspasos: vivos(traspasos).filter(t => t.origenId === cuenta.id || t.destinoId === cuenta.id).length,
      regularizaciones: vivos(regularizaciones).filter(r => r.cuentaId === cuenta.id).length
    };
    u.total = Object.values(u).reduce((s, n) => s + n, 0);
    return u;
  }

  /* ---------- v3.6: saldo del mes con arrastre (calculado, sin apuntes ficticios) ----------
     Cuentas «del día a día» (cuentan en el saldo del mes): por defecto corriente, efectivo y otra;
     las de ahorro e inversión no (se puede cambiar por cuenta con `enSaldoMes`).
     Saldo final de un mes = saldo inicial (saldo final del mes anterior)
       + ingresos − gastos (resultado del mes, todos los movimientos menos las compras financiadas)
       − ingresos/gastos apuntados en cuentas que no cuentan (ahorro/inversión)
       ± traspasos de/hacia cuentas que no cuentan  ± compras/ventas de inversión pagadas desde cuentas que cuentan
       ± ajustes de saldo de esas cuentas  + apertura de cuentas.
     Apertura: el día de la fecha del saldo inicial de cada cuenta que cuenta, su saldo inicial real sustituye
     a lo calculado antes con sus movimientos; y en la primera fecha de saldo (inicio de las cuentas)
     también se descuenta lo acumulado con movimientos sin cuenta y compras de inversión sin cuenta.
     Sin cuentas que cuenten: arrastre acumulado de ingresos − gastos (− inversión neta sin cuenta) desde el primer mes. */
  const EN_SALDO_POR_TIPO = { corriente: true, efectivo: true, otra: true, ahorro: false, inversion: false };
  const enSaldoPorDefecto = tipo => EN_SALDO_POR_TIPO[tipo] !== false;
  const enSaldoMes = c => !!c && (typeof c.enSaldoMes === 'boolean' ? c.enSaldoMes : enSaldoPorDefecto(c.tipo));
  const finDeMes = ym => { const [y, m] = ym.split('-').map(Number); return `${ym}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, '0')}`; };
  const COMPONENTES = ['resultado', 'ingresos', 'gastos', 'fuera', 'traspasos', 'inversion', 'ajustes', 'apertura'];

  /** Apuntes que mueven el saldo del mes: { fecha, k (componente), importe }. */
  function eventosSaldoMes(datos) {
    const cuentas = vivos(datos.cuentas), idx = indice(cuentas), ev = [];
    const liquidas = cuentas.filter(enSaldoMes), liq = new Set(liquidas.map(c => c.id));
    const conCuentas = liquidas.length > 0;
    const inicio = conCuentas ? liquidas.map(c => c.fechaSaldo || '0000-00-00').sort()[0] : null;
    const previos = new Map(); let sinCuentaAntes = 0, nSinCuenta = 0, primera = null;
    const marca = f => { if (!primera || f < primera) primera = f; };
    const push = (fecha, k, importe) => { if (fecha && importe) ev.push({ fecha, k, importe: round2(importe) }); };
    for (const m of vivos(datos.movimientos)) {
      if (m.financiadoPor || !m.fecha) continue;
      const imp = round2(m.tipo === 'ingreso' ? m.importe : -m.importe); marca(m.fecha);
      push(m.fecha, m.tipo === 'ingreso' ? 'ingresos' : 'gastos', imp);
      const c = resolver(m, idx);
      if (c && !liq.has(c.id)) push(m.fecha, 'fuera', -imp);
      else if (c) { if (m.fecha < (c.fechaSaldo || '0000-00-00')) previos.set(c.id, (previos.get(c.id) || 0) + imp); }
      else if (conCuentas && m.fecha < inicio) sinCuentaAntes += imp;
      else if (conCuentas) nSinCuenta++;
    }
    for (const op of vivos(datos.operaciones)) {
      if (!op.fecha) continue;
      const bruto = Number(op.participaciones) * Number(op.precio), com = Number(op.comisiones) || 0;
      const imp = op.tipo === 'venta' ? bruto - com : -(bruto + com);
      const c = op.cuentaId ? idx.byId.get(op.cuentaId) : null;
      marca(op.fecha);
      if (c) continue;   // con cuenta: va en los flujos de esa cuenta (si cuenta en el saldo)
      push(op.fecha, 'inversion', imp);
      if (conCuentas && op.fecha < inicio) sinCuentaAntes += imp;
    }
    const K = { 'traspaso-entrada': 'traspasos', 'traspaso-salida': 'traspasos', compra: 'inversion', venta: 'inversion', ajuste: 'ajustes' };
    for (const f of flujos(datos)) if (liq.has(f.cuentaId) && K[f.tipo]) push(f.fecha, K[f.tipo], f.importe);
    for (const c of liquidas) push(c.fechaSaldo || '0000-00-00', 'apertura', round2((Number(c.saldoInicial) || 0) - (previos.get(c.id) || 0)));
    if (conCuentas && sinCuentaAntes) push(inicio, 'apertura', -sinCuentaAntes);
    ev.sort((a, b) => a.fecha < b.fecha ? -1 : a.fecha > b.fecha ? 1 : 0);
    return { eventos: ev, conCuentas, inicio, primera, sinCuentaDespues: nSinCuenta, liquidas, noLiquidas: cuentas.filter(c => !liq.has(c.id)) };
  }
  /** Saldo de un periodo [desde, hasta] (fechas ISO) con arrastre: saldo inicial = todo lo anterior a `desde`. */
  function saldoPeriodoEv(E, desde, hasta) {
    const r = { desde, hasta, saldoInicial: 0 };
    for (const k of COMPONENTES) r[k] = 0;
    for (const e of E.eventos) {
      if (e.fecha < desde) r.saldoInicial += e.importe;
      else if (e.fecha <= hasta) r[e.k] += e.importe;
    }
    r.resultado = r.ingresos + r.gastos;
    r.ingresos = round2(r.ingresos); r.gastos = round2(-r.gastos);
    for (const k of ['saldoInicial', 'resultado', 'fuera', 'traspasos', 'inversion', 'ajustes', 'apertura']) r[k] = round2(r[k]);
    r.saldoFinal = round2(r.saldoInicial + r.resultado + r.fuera + r.traspasos + r.inversion + r.ajustes + r.apertura);
    r.modo = E.conCuentas ? 'cuentas' : 'movimientos'; r.primerMes = E.primera ? E.primera.slice(0, 7) : null; r.inicioCuentas = E.inicio; r.sinCuentaDespues = E.sinCuentaDespues;
    return r;
  }
  const saldoPeriodo = (datos, desde, hasta) => saldoPeriodoEv(eventosSaldoMes(datos), desde, hasta);
  /** Saldo del mes con arrastre para cada mes de `meses` (YYYY-MM). */
  function saldosMensuales(datos, meses) {
    const E = eventosSaldoMes(datos);
    return meses.map(ym => ({ mes: ym, ...saldoPeriodoEv(E, `${ym}-01`, finDeMes(ym)) }));
  }
  const saldoMes = (datos, ym) => saldosMensuales(datos, [ym])[0];
  /** Saldo del año (YYYY) con arrastre del año anterior y su detalle mes a mes. */
  function saldoAnio(datos, anio) {
    const E = eventosSaldoMes(datos), y = String(anio);
    const meses = Array.from({ length: 12 }, (_, i) => `${y}-${String(i + 1).padStart(2, '0')}`);
    return { anio: y, ...saldoPeriodoEv(E, `${y}-01-01`, `${y}-12-31`), meses: meses.map(ym => ({ mes: ym, ...saldoPeriodoEv(E, `${ym}-01`, finDeMes(ym)) })) };
  }
  /** Saldo (calculado como el del mes) al terminar el día `fecha`. */
  const saldoDisponibleEn = (datos, fecha) => round2(eventosSaldoMes(datos).eventos.reduce((s, e) => e.fecha <= fecha ? s + e.importe : s, 0));

  const api = { TIPOS_CUENTA, ICONO_TIPO, normNombre, indice, resolver, flujos, historial, saldoEn, saldos, serieMensual, diferenciaAjuste, invertidoPeriodo, traspasosPeriodo, nombresSinCuenta, usos,
    EN_SALDO_POR_TIPO, enSaldoPorDefecto, enSaldoMes, eventosSaldoMes, saldosMensuales, saldoMes, saldoPeriodo, saldoAnio, saldoDisponibleEn, finDeMes };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.CuentasCore = api;
})(typeof self !== 'undefined' ? self : globalThis);
