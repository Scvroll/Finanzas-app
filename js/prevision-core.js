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

  /** Día de la nómina esperado: el de la nómina recurrente activa o, si no hay, el de la estimada. */
  function diaNomina(recurrentes, nomEst, ym0) {
    const r = (recurrentes || []).find(r => vivo(r) && r.activo !== false && r.tipo === 'ingreso' && r.tipoIngreso === 'nomina' && (!r.hasta || r.hasta >= ym0));
    if (r) return { fechaEn: ym => FC.fechaCobroEnMes(ym, FC.normalizarDiaCobro(r.dia, null, 1)) };
    if (nomEst) return { fechaEn: ym => FC.fechaEnMes(ym, nomEst.dia) };
    return null;
  }
  const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
  const MES3 = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
  const corto = iso => `${+iso.slice(8, 10)} ${MES3[+iso.slice(5, 7) - 1]}`;

  /** v3.8: periodos de nómina previstos: el actual (desde la última nómina cobrada) y los siguientes, cada uno desde el día de la nómina. */
  function periodosPrevistos(movs, recurrentes, nomEst, hoy, n) {
    const ym0 = hoy.slice(0, 7), dn = diaNomina(recurrentes, nomEst, ym0);
    if (!dn) return null;
    const noms = movs.filter(m => m.tipo === 'ingreso' && m.tipoIngreso === 'nomina' && FC.isISO(m.fecha) && m.fecha <= hoy).map(m => m.fecha).sort();
    let ultima = noms[noms.length - 1];
    if (ultima && FC.diffDays(ultima, hoy) > 45) ultima = null;   // la última es muy antigua: el periodo actual empieza hoy
    // Siguiente nómina: la primera fecha esperada al menos 15 días después del inicio del periodo anterior
    const siguiente = base => { let ym = base.slice(0, 7); for (let i = 0; i < 4; i++, ym = FC.ymAdd(ym, 1)) { const f = dn.fechaEn(ym); if (FC.diffDays(base, f) >= 15) return f; } return FC.addMonthsISO(base, 1); };
    const lista = []; let desde = ultima || hoy;
    for (let i = 0; i < n; i++) {
      let sig = siguiente(desde); const esperada = sig;
      const retrasada = sig <= hoy;            // tocaba cobrarla y aún no está apuntada: se espera mañana
      if (retrasada) sig = FC.addDaysISO(hoy, 1);
      const hasta = FC.addDaysISO(sig, -1);
      const esNomina = i > 0 || !!ultima;
      lista.push({ clave: desde, desde, hasta, actual: i === 0, mes: desde.slice(0, 7), siguienteNomina: sig, nominaEsperada: esperada, nominaRetrasada: retrasada ? sig : null,
        nombre: esNomina ? `Nómina de ${MESES[+desde.slice(5, 7) - 1]}` : 'Hasta la próxima nómina', rango: `${corto(desde)} – ${corto(hasta)}` });
      desde = sig;
    }
    return lista;
  }

  /**
   * prevision({ hoy, saldoHoy, movimientos, recurrentes, deudas, meses = 7, gastoVariable = null, esLiquido, porNomina = false })
   * - saldoHoy: saldo real de las cuentas del día a día al final de `hoy`.
   * - gastoVariable: € al mes (o por periodo de nómina); null = media automática.
   * - esLiquido(m): opcional; si un movimiento apuntado con fecha futura no es de una cuenta del día a día, no cuenta.
   * - porNomina (v3.8): por periodos de nómina (de nómina a nómina) en vez de meses naturales. Si no hay nómina
   *   (ni recurrente ni una reciente para estimarla), se usan meses naturales (resultado.modo = 'mes').
   */
  function prevision({ hoy, saldoHoy = 0, movimientos = [], recurrentes = [], deudas = [], meses = 7, gastoVariable = null, esLiquido = null, porNomina = false }) {
    const ym0 = hoy.slice(0, 7), movs = movimientos.filter(vivo), n = Math.max(1, meses | 0);
    const auto = gastoVariableMedio(movs, hoy);
    const varMes = gastoVariable === null || gastoVariable === undefined || gastoVariable === '' || !isFinite(Number(gastoVariable)) ? auto.importe : Math.max(0, Number(gastoVariable));
    const nomEst = nominaEstimada(movs, recurrentes, hoy);
    let lista = porNomina ? periodosPrevistos(movs, recurrentes, nomEst, hoy, n) : null;
    const modo = lista ? 'nomina' : 'mes';
    if (!lista) lista = Array.from({ length: n }, (_, i) => { const ym = FC.ymAdd(ym0, i); return { clave: ym, mes: ym, desde: `${ym}-01`, hasta: FC.fechaEnMes(ym, dim(ym)), actual: i === 0 }; });
    const P0 = lista[0], fin0 = lista[lista.length - 1].hasta;
    const mesesGen = []; for (let ym = P0.desde.slice(0, 7); ym <= fin0.slice(0, 7); ym = FC.ymAdd(ym, 1)) mesesGen.push(ym);
    const porP = new Map(lista.map(p => [p.clave, []]));
    const periodoDe = fecha => lista.find(p => p.desde <= fecha && fecha <= p.hasta);
    const add = (fecha, it) => { const p = periodoDe(fecha); if (p) porP.get(p.clave).push({ ...it, fecha, c: cent(it.importe), importe: FC.round2(it.importe) }); };
    const enMes = (ym, pred) => movs.some(m => String(m.fecha).startsWith(ym) && pred(m));
    const retrasada = lista.find(p => p.nominaRetrasada);
    // Nómina cuya fecha ya pasó sin apuntarse, cuando el periodo la espera (se retrasa): cuenta el día que empieza el periodo
    const fechaNomina = fecha => (modo === 'nomina' && retrasada && fecha < hoy && fecha.slice(0, 7) === retrasada.nominaEsperada.slice(0, 7) ? retrasada.nominaRetrasada : fecha);

    // 1) Recurrentes (ingresos y gastos)
    for (const r of recurrentes) {
      if (!vivo(r) || r.activo === false || !/^\d{4}-\d{2}$/.test(r.desde || '')) continue;
      const esNom = r.tipo === 'ingreso' && r.tipoIngreso === 'nomina';
      for (const ym of mesesGen) {
        if (ym < r.desde || (r.hasta && ym > r.hasta)) continue;
        let fecha = FC.fechaCobroEnMes(ym, FC.normalizarDiaCobro(r.dia, null, 1));
        const apuntado = enMes(ym, m => m.id === FC.idRecurrente(r.id, ym) || m.recurrenteId === r.id);
        if (apuntado) continue;            // ya está en el saldo (o, si es futuro, entra abajo como apuntado)
        if (esNom) fecha = fechaNomina(fecha);
        if (fecha < hoy) continue;         // pasó la fecha y no está: lo borraste a propósito
        add(fecha, { tipo: r.tipo === 'ingreso' ? 'ingreso' : 'fijo', concepto: r.descripcion || r.categoria || (esNom ? 'Nómina' : 'Recurrente'), importe: r.importe, origen: 'recurrente', id: r.id, nomina: esNom });
      }
    }
    // 2) Nómina estimada (sin nómina recurrente)
    if (nomEst) for (const ym of mesesGen) {
      if (enMes(ym, m => m.tipo === 'ingreso' && m.tipoIngreso === 'nomina')) continue;   // ya cobrada (o apuntada) ese mes
      const fecha = fechaNomina(FC.fechaEnMes(ym, nomEst.dia));
      if (fecha < hoy) continue;
      add(fecha, { tipo: 'ingreso', concepto: 'Nómina (estimada)', importe: nomEst.importe, origen: 'nomina-estimada', estimado: true, nomina: true });
    }
    // 3) Cuotas de deudas sin pagar (las dos formas: cuadro calculado y cuota manual)
    for (const d of deudas) {
      if (!vivo(d)) continue;
      let cuadro; try { cuadro = FC.cuadroAmortizacion(d); } catch { continue; }
      const pagadas = new Set(movs.filter(m => m.deudaId === d.id && m.cuotaN).map(m => Number(m.cuotaN)));
      for (const f of cuadro.filas) {
        if (pagadas.has(f.n) || !f.fecha || f.fecha > fin0) continue;
        const antes = f.fecha < P0.desde;   // vencida antes del periodo actual: se suma hoy
        add(antes ? hoy : f.fecha, { tipo: 'cuota', concepto: `${d.nombre || 'Deuda'} · cuota ${f.n}/${cuadro.filas.length}`, importe: f.pago, origen: 'deuda', id: d.id, n: f.n, vencida: f.fecha < hoy, fechaCuota: f.fecha });
      }
    }
    // 4) Movimientos ya apuntados con fecha futura (no están aún en el saldo de hoy)
    for (const m of movs) {
      if (!(m.fecha > hoy) || m.financiadoPor || (esLiquido && !esLiquido(m))) continue;
      add(m.fecha, { tipo: m.tipo === 'ingreso' ? 'ingreso' : m.deudaId ? 'cuota' : 'fijo', concepto: (m.descripcion || m.categoria || 'Movimiento') + ' (apuntado)', importe: m.importe, origen: 'apuntado', id: m.id, nomina: m.tipoIngreso === 'nomina' });
    }

    // 5) Periodo a periodo
    let ini = cent(saldoHoy);
    const out = lista.map(p => {
      const items = porP.get(p.clave).sort((a, b) => a.fecha.localeCompare(b.fecha) || (b.tipo === 'ingreso') - (a.tipo === 'ingreso'));
      const sum = t => items.filter(x => x.tipo === t).reduce((s, x) => s + x.c, 0);
      const ing = sum('ingreso'), fij = sum('fijo'), cuo = sum('cuota');
      const inicioTramo = p.actual ? hoy : p.desde;
      const yaVar = p.actual ? variableDe(movs.filter(m => m.fecha <= hoy && m.fecha >= p.desde), '') : 0;
      const va = Math.max(0, cent(varMes) - yaVar);   // en el periodo actual, solo lo que falta por gastar
      const fin = ini + ing - fij - cuo - va;
      // ¿Baja de 0 dentro del periodo? Gasto variable repartido por igual en los días que quedan.
      // Cada día con movimientos: se mira el saldo antes de nada (con el variable hasta ese día), luego entran los cobros y salen los pagos del día.
      const tramo = FC.diffDays(inicioTramo, p.hasta) + 1, idx = f => FC.diffDays(inicioTramo, f) + 1;
      const varHasta = d => Math.round(va * Math.min(tramo, Math.max(0, d)) / tramo);
      let s = ini, min = null, primerNeg = null;
      const mirar = (c, fecha, despues = false) => { if (min === null || c < min.c) min = { c, fecha, despues }; if (c < 0 && !primerNeg) primerNeg = fecha; };
      const fechas = [...new Set(items.map(x => x.fecha < inicioTramo ? inicioTramo : x.fecha))].sort();
      let dPrev = 0;
      for (const f of fechas) {
        const d = idx(f), del = items.filter(x => (x.fecha < inicioTramo ? inicioTramo : x.fecha) === f);
        // primer día en negativo entre movimientos (el variable va bajando el saldo día a día)
        if (!primerNeg) for (let k = dPrev + 1; k < d; k++) if (s - varHasta(k) < 0) { primerNeg = FC.addDaysISO(inicioTramo, k - 1); break; }
        // por nómina, el periodo empieza con la nómina: el saldo «antes» del primer día es el que arrastras del anterior
        if (!(modo === 'nomina' && !p.actual && d === 1)) mirar(s - varHasta(d - 1), f);
        s += del.filter(x => x.tipo === 'ingreso').reduce((a, x) => a + x.c, 0) - del.filter(x => x.tipo !== 'ingreso').reduce((a, x) => a + x.c, 0);
        mirar(s - varHasta(d), f, true); dPrev = d;
      }
      if (!primerNeg) for (let k = dPrev + 1; k <= tramo; k++) if (s - varHasta(k) < 0) { primerNeg = FC.addDaysISO(inicioTramo, k - 1); break; }
      mirar(fin, p.hasta, true);
      const cobroDespues = min.c < 0 && items.find(x => x.tipo === 'ingreso' && x.fecha >= min.fecha && !(x.fecha === min.fecha && min.despues));
      const r = {
        mes: p.mes, clave: p.clave, desde: p.desde, hasta: p.hasta, actual: p.actual, saldoInicial: eurDe(ini), ingresos: eurDe(ing), fijos: eurDe(fij), cuotas: eurDe(cuo), variable: eurDe(va), variableYaGastado: eurDe(yaVar),
        sobra: eurDe(fin), falta: fin < 0 ? eurDe(-fin) : 0, items: items.map(({ c, ...x }) => x),
        minimo: eurDe(min.c), fechaMinimo: min.fecha,
        avisoAntesDeCobrar: min.c < 0 && fin >= 0 && cobroDespues ? { fecha: min.fecha, importe: eurDe(min.c), cobro: cobroDespues.fecha, concepto: cobroDespues.concepto } : null,
        avisoDentroMes: min.c < 0 && fin >= 0 && !cobroDespues ? { fecha: min.fecha, importe: eurDe(min.c) } : null,
        nominaEstimada: items.some(x => x.origen === 'nomina-estimada')
      };
      if (modo === 'nomina') {
        Object.assign(r, { nombre: p.nombre, rango: p.rango, siguienteNomina: p.siguienteNomina, avisoAntesDeCobrar: null, avisoDentroMes: null,
          // v3.8: ¿se acaba el dinero antes de la próxima nómina?
          arrastra: ini < 0 ? eurDe(ini) : 0,
          seAcaba: min.c < 0 ? { fecha: primerNeg || min.fecha, minimo: eurDe(min.c), fechaMinimo: min.fecha, nomina: p.siguienteNomina } : null });
      }
      ini = fin;
      return r;
    });
    return { hoy, modo, meses: out, gastoVariable: varMes, gastoVariableAuto: auto, nominaEstimada: nomEst };
  }

  const api = { prevision, gastoVariableMedio, nominaEstimada, periodosPrevistos };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.PrevisionCore = api;
})(typeof self !== 'undefined' ? self : globalThis);
