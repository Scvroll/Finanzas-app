/* Planificación (v3.9): presupuestos por categoría e ingresos previstos (pagas extra, productividad, ingresos puntuales).
   Lógica pura (sin DOM), probada con node (tests/plan.test.js y tests/prevision.test.js). Todo se suma en céntimos.
   Registros de la colección sincronizada «previstos»:
   - Presupuesto: { id, tipo: 'presupuesto', categoria, importe (por periodo de nómina o por mes), activo }
       En la Previsión cuenta como un gasto fijo de `importe` en cada periodo (en el actual, solo lo que queda: presupuesto − gastado).
       Los gastos reales de esa categoría (fijos o variables) gastan del presupuesto: no se cuentan dos veces.
   - Ingreso previsto: { id, tipo: 'ingreso', descripcion, categoria, importe, repetir: 'anual' | 'una',
       meses: [6, 12] (si es anual), mes: 'AAAA-MM' (si es una vez), conNomina (llega con la nómina) | dia,
       estimado (importe aproximado), incluir (contar en la Previsión; por defecto sí), desde?, hasta? (AAAA-MM) }
       Se da por COBRADO en un mes cuando hay un ingreso real enlazado (movimiento.previstoId) o, si no hay enlace,
       un ingreso de la misma categoría ese mes (salvo la categoría Nómina, que necesita enlace). Entonces la
       Previsión usa el ingreso real (ya está en el saldo o apuntado) y no el previsto. */
(function (root) {
  'use strict';
  const FC = typeof module !== 'undefined' && module.exports ? require('./finance-core.js') : root.FinanceCore;
  const cent = n => Math.round((Number(n) || 0) * 100 + (Number(n) >= 0 ? 1e-7 : -1e-7));
  const vivo = x => x && !x.deleted;
  const YM = /^\d{4}-\d{2}$/;
  const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

  /** Presupuestos activos: uno por categoría (si hubiera dos, el editado más tarde). */
  function presupuestos(previstos) {
    const m = new Map();
    for (const p of (previstos || []).filter(p => vivo(p) && p.tipo === 'presupuesto' && p.activo !== false && p.categoria && cent(p.importe) > 0)
      .sort((a, b) => (a.updatedAt || 0) - (b.updatedAt || 0))) m.set(p.categoria, p);
    return [...m.values()].sort((a, b) => a.categoria.localeCompare(b.categoria));
  }
  const categoriasConPresupuesto = previstos => new Set(presupuestos(previstos).map(p => p.categoria));
  const ingresos = previstos => (previstos || []).filter(p => vivo(p) && p.tipo === 'ingreso' && cent(p.importe) > 0);

  /** Gastado en una categoría entre dos fechas (incluidas): gastos reales (fijos o variables), sin compras financiadas ni cuotas de deudas. */
  function gastado(movs, categoria, desde, hasta) {
    return (movs || []).filter(m => vivo(m) && m.tipo === 'gasto' && m.categoria === categoria && !m.financiadoPor && !m.deudaId && m.fecha >= desde && m.fecha <= hasta)
      .reduce((s, m) => s + cent(m.importe), 0) / 100;
  }
  /** Estado de un presupuesto en un periodo: cuánto llevas gastado, cuánto queda o cuánto te has pasado. */
  function estado(pres, movs, desde, hasta) {
    const P = cent(pres.importe), G = Math.round(gastado(movs, pres.categoria, desde, hasta) * 100);
    return { id: pres.id, categoria: pres.categoria, presupuesto: P / 100, gastado: G / 100, queda: Math.max(0, P - G) / 100, excedido: Math.max(0, G - P) / 100,
      pct: P ? Math.round(G * 1000 / P) / 10 : 0 };
  }

  /** ¿Toca este ingreso previsto en el mes `ym`? */
  function tocaEn(p, ym) {
    if (!vivo(p) || p.tipo !== 'ingreso') return false;
    if (p.desde && YM.test(p.desde) && ym < p.desde) return false;
    if (p.hasta && YM.test(p.hasta) && ym > p.hasta) return false;
    if (p.repetir === 'una') return p.mes === ym;
    return (p.meses || []).map(Number).includes(+ym.slice(5, 7));
  }
  /** Meses (AAAA-MM) en que toca entre dos meses (incluidos). */
  function ocurrencias(p, desdeYm, hastaYm) { const out = []; for (let ym = desdeYm; ym <= hastaYm; ym = FC.ymAdd(ym, 1)) if (tocaEn(p, ym)) out.push(ym); return out; }

  /** Ingresos reales que cumplen el previsto `p` en el mes `ym` (enlazados o de su misma categoría). `fechaEsperada` amplía el
      enlace a ±31 días (p. ej. la paga de diciembre que llega el 30 de noviembre). */
  function cobrado(p, ym, movs, fechaEsperada = null) {
    const ing = (movs || []).filter(m => vivo(m) && m.tipo === 'ingreso' && FC.isISO(m.fecha));
    const enl = ing.filter(m => m.previstoId === p.id && (m.fecha.slice(0, 7) === ym || (fechaEsperada && Math.abs(FC.diffDays(fechaEsperada, m.fecha)) <= 31)));
    const auto = enl.length || !p.categoria || p.categoria === 'Nómina' ? [] :
      ing.filter(m => !m.previstoId && m.tipoIngreso !== 'nomina' && m.categoria === p.categoria && m.fecha.slice(0, 7) === ym);
    const r = enl.length ? enl : auto;
    return r.length ? { movimientos: r, importe: r.reduce((s, m) => s + cent(m.importe), 0) / 100, enlazado: !!enl.length } : null;
  }

  /** Texto: «junio y diciembre» / «mayo» / «una vez, en marzo de 2027». */
  function textoCuando(p) {
    if (p.repetir === 'una') return YM.test(p.mes || '') ? `una vez, en ${MESES[+p.mes.slice(5, 7) - 1]} de ${p.mes.slice(0, 4)}` : 'una vez';
    const ms = (p.meses || []).map(Number).filter(n => n >= 1 && n <= 12).sort((a, b) => a - b).map(n => MESES[n - 1]);
    const lista = ms.length > 1 ? ms.slice(0, -1).join(', ') + ' y ' + ms[ms.length - 1] : ms[0] || '—';
    return `cada año en ${lista}`;
  }

  const api = { presupuestos, categoriasConPresupuesto, ingresos, gastado, estado, tocaEn, ocurrencias, cobrado, textoCuando, MESES };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.PlanCore = api;
})(typeof self !== 'undefined' ? self : globalThis);
