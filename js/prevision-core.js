/* Previsión (v3.7): cuánto te sobrará (o faltará) este mes y los siguientes.
   Lógica pura (sin DOM), probada con node (tests/prevision.test.js). Todo se suma en céntimos.
   Mes a mes:  saldo inicial (+ lo que sobró el mes anterior)
             + ingresos previstos (recurrentes de ingreso; nómina: la recurrente o, si no hay, una ESTIMADA con la última)
             − gastos fijos (recurrentes de gasto)
             − cuotas de deudas sin pagar de ese mes (las vencidas sin marcar se suman al mes actual)
             − gasto variable estimado (editable; por defecto, la media de los últimos meses completos)
             = lo que te sobra (o falta) al acabar el mes, que pasa al siguiente.
   En el mes actual solo cuenta lo que queda pendiente (lo ya apuntado o pagado está en el saldo de hoy). */
(function (root) {
  'use strict';
  const FC = typeof module !== 'undefined' && module.exports ? require('./finance-core.js') : root.FinanceCore;
  const cent = n => Math.round((Number(n) || 0) * 100 + (Number(n) >= 0 ? 1e-7 : -1e-7));
  const eurDe = c => c / 100;
  const dim = ym => FC.daysInMonth(+ym.slice(0, 4), +ym.slice(5, 7));
  const vivo = x => x && !x.deleted;

  /** Gasto variable de un mes (gastos «variable» que no son cuotas de deuda ni compras financiadas). */
  const variableDe = (movs, ym) => movs.filter(m => vivo(m) && m.tipo === 'gasto' && m.naturaleza === 'variable' && !m.deudaId && !m.financiadoPor && String(m.fecha).startsWith(ym))
    .reduce((s, m) => s + cent(m.importe), 0);

  /** Media del gasto variable de los últimos `n` meses completos (anteriores al actual) que tienen movimientos. 0 si no hay. */
  function gastoVariableMedio(movimientos, hoy, n = 3) {
    const ym0 = hoy.slice(0, 7), movs = (movimientos || []).filter(vivo);
    const meses = [...new Set(movs.map(m => String(m.fecha).slice(0, 7)))].filter(ym => ym < ym0).sort().slice(-n);
    if (!meses.length) return { importe: 0, meses: [] };
    return { importe: eurDe(Math.round(meses.reduce((s, ym) => s + variableDe(movs, ym), 0) / meses.length)), meses };
  }

  /** Nómina estimada (si no hay una nómina recurrente activa): importe y día de la última nómina apuntada (de los últimos 3 meses). */
  function nominaEstimada(movimientos, recurrentes, hoy) {
    const ym0 = hoy.slice(0, 7);
    const hayRec = (recurrentes || []).some(r => vivo(r) && r.activo !== false && r.tipo === 'ingreso' && r.tipoIngreso === 'nomina' && (!r.hasta || r.hasta >= ym0));
    if (hayRec) return null;
    const noms = (movimientos || []).filter(m => vivo(m) && m.tipo === 'ingreso' && m.tipoIngreso === 'nomina' && m.fecha <= hoy).sort((a, b) => a.fecha.localeCompare(b.fecha));
    const u = noms[noms.length - 1];
    if (!u || u.fecha.slice(0, 7) < FC.ymAdd(ym0, -3)) return null;
    const dia = +u.fecha.slice(8, 10);
    return { importe: FC.round2(u.importe), dia, desde: u.fecha, categoria: u.categoria || 'Nómina', cuentaId: u.cuentaId || null, cuenta: u.cuenta || '', descripcion: u.descripcion || '' };
  }

  /**
   * prevision({ hoy, saldoHoy, movimientos, recurrentes, deudas, meses = 7, gastoVariable = null, esLiquido })
   * - saldoHoy: saldo real de las cuentas del día a día al final de `hoy`.
   * - gastoVariable: € al mes; null = media automática.
   * - esLiquido(m): opcional; si un movimiento apuntado con fecha futura no es de una cuenta del día a día, no cuenta.
   */
  function prevision({ hoy, saldoHoy = 0, movimientos = [], recurrentes = [], deudas = [], meses = 7, gastoVariable = null, esLiquido = null }) {
    const ym0 = hoy.slice(0, 7), movs = movimientos.filter(vivo);
    const auto = gastoVariableMedio(movs, hoy);
    const varMes = gastoVariable === null || gastoVariable === undefined || gastoVariable === '' || !isFinite(Number(gastoVariable)) ? auto.importe : Math.max(0, Number(gastoVariable));
    const nomEst = nominaEstimada(movs, recurrentes, hoy);
    const lista = Array.from({ length: Math.max(1, meses | 0) }, (_, i) => FC.ymAdd(ym0, i));
    const porMes = Object.fromEntries(lista.map(ym => [ym, []]));
    const add = (ym, it) => { if (porMes[ym]) porMes[ym].push({ ...it, c: cent(it.importe), importe: FC.round2(it.importe) }); };
    const enMes = (ym, pred) => movs.some(m => String(m.fecha).startsWith(ym) && pred(m));

    // 1) Recurrentes (ingresos y gastos)
    for (const r of recurrentes) {
      if (!vivo(r) || r.activo === false || !/^\d{4}-\d{2}$/.test(r.desde || '')) continue;
      for (const ym of lista) {
        if (ym < r.desde || (r.hasta && ym > r.hasta)) continue;
        const fecha = FC.fechaCobroEnMes(ym, FC.normalizarDiaCobro(r.dia, null, 1));
        const apuntado = enMes(ym, m => m.id === FC.idRecurrente(r.id, ym) || m.recurrenteId === r.id);
        if (apuntado) continue;            // ya está en el saldo (o, si es futuro, entra abajo como apuntado)
        if (ym === ym0 && fecha < hoy) continue;   // pasó la fecha y no está: lo borraste a propósito
        const esNom = r.tipo === 'ingreso' && r.tipoIngreso === 'nomina';
        add(ym, { fecha, tipo: r.tipo === 'ingreso' ? 'ingreso' : 'fijo', concepto: r.descripcion || r.categoria || (esNom ? 'Nómina' : 'Recurrente'), importe: r.importe, origen: 'recurrente', id: r.id, nomina: esNom });
      }
    }
    // 2) Nómina estimada (sin nómina recurrente)
    if (nomEst) for (const ym of lista) {
      if (enMes(ym, m => m.tipo === 'ingreso' && m.tipoIngreso === 'nomina')) continue;   // ya cobrada (o apuntada) ese mes
      const fecha = FC.fechaEnMes(ym, nomEst.dia);
      if (ym === ym0 && fecha < hoy) continue;
      add(ym, { fecha, tipo: 'ingreso', concepto: 'Nómina (estimada)', importe: nomEst.importe, origen: 'nomina-estimada', estimado: true, nomina: true });
    }
    // 3) Cuotas de deudas sin pagar (las dos formas: cuadro calculado y cuota manual)
    for (const d of deudas) {
      if (!vivo(d)) continue;
      let cuadro; try { cuadro = FC.cuadroAmortizacion(d); } catch { continue; }
      const pagadas = new Set(movs.filter(m => m.deudaId === d.id && m.cuotaN).map(m => Number(m.cuotaN)));
      for (const f of cuadro.filas) {
        if (pagadas.has(f.n) || !f.fecha) continue;
        const ym = f.fecha.slice(0, 7);
        const vencida = ym < ym0 || (ym === ym0 && f.fecha < hoy);
        add(ym < ym0 ? ym0 : ym, { fecha: ym < ym0 ? hoy : f.fecha, tipo: 'cuota', concepto: `${d.nombre || 'Deuda'} · cuota ${f.n}/${cuadro.filas.length}`, importe: f.pago, origen: 'deuda', id: d.id, n: f.n, vencida, fechaCuota: f.fecha });
      }
    }
    // 4) Movimientos ya apuntados con fecha futura (no están aún en el saldo de hoy)
    for (const m of movs) {
      if (!(m.fecha > hoy) || m.financiadoPor || !porMes[m.fecha.slice(0, 7)] || (esLiquido && !esLiquido(m))) continue;
      add(m.fecha.slice(0, 7), { fecha: m.fecha, tipo: m.tipo === 'ingreso' ? 'ingreso' : m.deudaId ? 'cuota' : 'fijo', concepto: (m.descripcion || m.categoria || 'Movimiento') + ' (apuntado)', importe: m.importe, origen: 'apuntado', id: m.id, nomina: m.tipoIngreso === 'nomina' });
    }

    // 5) Mes a mes
    let ini = cent(saldoHoy);
    const out = lista.map(ym => {
      const items = porMes[ym].sort((a, b) => a.fecha.localeCompare(b.fecha) || (a.tipo === 'ingreso') - (b.tipo === 'ingreso'));
      const sum = t => items.filter(x => x.tipo === t).reduce((s, x) => s + x.c, 0);
      const ing = sum('ingreso'), fij = sum('fijo'), cuo = sum('cuota');
      const dias = dim(ym), dia0 = ym === ym0 ? +hoy.slice(8, 10) : 1;
      const yaVar = ym === ym0 ? variableDe(movs.filter(m => m.fecha <= hoy), ym) : 0;
      const va = Math.max(0, cent(varMes) - yaVar);   // en el mes actual, solo lo que falta por gastar
      const fin = ini + ing - fij - cuo - va;
      // ¿Baja de 0 dentro del mes? Gasto variable repartido por igual en los días que quedan.
      // Cada día con movimientos: se mira el saldo antes de nada (con el variable hasta ese día), luego entran los cobros y salen los pagos del día.
      const tramo = dias - dia0 + 1, varHasta = d => Math.round(va * Math.min(tramo, Math.max(0, d - dia0 + 1)) / tramo);
      let s = ini, min = null;
      const mirar = (c, fecha, despues = false) => { if (min === null || c < min.c) min = { c, fecha, despues }; };
      for (const f of [...new Set(items.map(x => x.fecha))].sort()) {
        const d = +f.slice(8, 10), del = items.filter(x => x.fecha === f);
        mirar(s - varHasta(d - 1), f);
        s += del.filter(x => x.tipo === 'ingreso').reduce((a, x) => a + x.c, 0) - del.filter(x => x.tipo !== 'ingreso').reduce((a, x) => a + x.c, 0);
        mirar(s - varHasta(d), f, true);
      }
      mirar(fin, FC.fechaEnMes(ym, dias), true);
      const cobroDespues = min.c < 0 && items.find(x => x.tipo === 'ingreso' && x.fecha >= min.fecha && !(x.fecha === min.fecha && min.despues));
      const r = {
        mes: ym, actual: ym === ym0, saldoInicial: eurDe(ini), ingresos: eurDe(ing), fijos: eurDe(fij), cuotas: eurDe(cuo), variable: eurDe(va), variableYaGastado: eurDe(yaVar),
        sobra: eurDe(fin), falta: fin < 0 ? eurDe(-fin) : 0, items: items.map(({ c, ...x }) => x),
        minimo: eurDe(min.c), fechaMinimo: min.fecha,
        avisoAntesDeCobrar: min.c < 0 && fin >= 0 && cobroDespues ? { fecha: min.fecha, importe: eurDe(min.c), cobro: cobroDespues.fecha, concepto: cobroDespues.concepto } : null,
        avisoDentroMes: min.c < 0 && fin >= 0 && !cobroDespues ? { fecha: min.fecha, importe: eurDe(min.c) } : null,
        nominaEstimada: items.some(x => x.origen === 'nomina-estimada')
      };
      ini = fin;
      return r;
    });
    return { hoy, meses: out, gastoVariable: varMes, gastoVariableAuto: auto, nominaEstimada: nomEst };
  }

  const api = { prevision, gastoVariableMedio, nominaEstimada };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.PrevisionCore = api;
})(typeof self !== 'undefined' ? self : globalThis);
