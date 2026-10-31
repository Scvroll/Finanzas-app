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

  const api = { TIPOS_CUENTA, ICONO_TIPO, normNombre, indice, resolver, flujos, historial, saldoEn, saldos, serieMensual, diferenciaAjuste, invertidoPeriodo, traspasosPeriodo, nombresSinCuenta, usos };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.CuentasCore = api;
})(typeof self !== 'undefined' ? self : globalThis);
