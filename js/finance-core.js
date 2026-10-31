/* =========================================================
   Cálculos financieros puros (sin DOM ni red).
   Se usa en el navegador (window.FinanceCore) y en los tests de Node.
   - Fechas como texto ISO 'YYYY-MM-DD' (sin zonas horarias).
   - Préstamos: sistema francés (cuota constante), TIN 0 % incluido.
   - TAE: tasa interna de rentabilidad (TIR) mensual de los flujos reales
     (lo que recibes menos comisiones iniciales, frente a cuotas + comisiones
     periódicas), anualizada: TAE = (1 + i)^12 − 1.
   - Inversiones: FIFO (lo primero que compras es lo primero que vendes).
   - Recurrentes: ids deterministas (rec_<plantilla>_<YYYY-MM>) para que
     varios dispositivos generen exactamente el mismo registro.
   - Garantías, enlace de Google Calendar, lectura de tickets/nóminas (texto OCR)
     y CSV de operaciones.
   ========================================================= */
(function (root) {
  'use strict';
  const round2 = n => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
  const round8 = n => Math.round(Number(n) * 1e8) / 1e8;
  const pad = n => String(n).padStart(2, '0');

  /* ---------------- Fechas ---------------- */
  const isISO = s => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10)));
  const daysInMonth = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate(); // m: 1-12
  function addMonthsISO(iso, n, dia) {
    const y0 = +iso.slice(0, 4), m0 = +iso.slice(5, 7), d0 = dia || +iso.slice(8, 10);
    const t = y0 * 12 + (m0 - 1) + n, y = Math.floor(t / 12), m = t - y * 12 + 1;
    return `${y}-${pad(m)}-${pad(Math.min(d0, daysInMonth(y, m)))}`;
  }
  const addYearsISO = (iso, years) => addMonthsISO(iso, Math.round(Number(years) * 12));
  const toUTC = iso => Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10));
  const diffDays = (a, b) => Math.round((toUTC(b) - toUTC(a)) / 86400000); // b − a en días
  const addDaysISO = (iso, n) => { const d = new Date(toUTC(iso) + n * 86400000); return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`; };
  const ymAdd = (ym, n) => addMonthsISO(ym + '-01', n).slice(0, 7);
  const fechaEnMes = (ym, dia) => `${ym}-${pad(Math.min(Math.max(1, dia | 0), daysInMonth(+ym.slice(0, 4), +ym.slice(5, 7))))}`;

  /* ---------------- Día de cobro (deudas y recurrentes) ----------------
     Un día fijo del mes (1–31; si el mes es más corto, se usa su último día: 31 → 28/29 feb, 30 abr)
     o 'ultimo' = siempre el último día del mes. */
  const DIA_ULTIMO = 'ultimo';
  /** Normaliza el día de cobro. Si falta o no es válido, usa el día de `fechaRef` (AAAA-MM-DD) o `def`. */
  function normalizarDiaCobro(v, fechaRef = null, def = 1) {
    if (v === DIA_ULTIMO) return DIA_ULTIMO;
    const n = Number(v);
    if (v !== null && v !== '' && v !== undefined && Number.isInteger(n) && n >= 1 && n <= 31) return n;
    if (isISO(fechaRef)) return +fechaRef.slice(8, 10);
    return def;
  }
  /** Fecha de cobro en el mes `ym` (AAAA-MM) según el día de cobro. */
  const fechaCobroEnMes = (ym, diaCobro) => diaCobro === DIA_ULTIMO
    ? `${ym}-${pad(daysInMonth(+ym.slice(0, 4), +ym.slice(5, 7)))}`
    : fechaEnMes(ym, normalizarDiaCobro(diaCobro, null, 1));
  /** Vencimiento de la cuota n (1 = primera): el mes de la primera cuota + (n − 1) meses, en su día de cobro.
      Sin día de cobro se usa el día de la primera cuota (comportamiento anterior, mismas fechas). */
  function fechaCuota(fechaPrimeraCuota, n, diaCobro) {
    const dc = normalizarDiaCobro(diaCobro, fechaPrimeraCuota);
    return fechaCobroEnMes(ymAdd(fechaPrimeraCuota.slice(0, 7), n - 1), dc);
  }
  /** Texto en español del día de cobro: «el día 5 de cada mes» / «el último día de cada mes». */
  const textoDiaCobro = dc => dc === DIA_ULTIMO ? 'el último día de cada mes' : `el día ${dc} de cada mes${dc > 28 ? ' (o el último día si el mes es más corto)' : ''}`;

  /* ---------------- Préstamos / compras financiadas ---------------- */
  /** Cuota del sistema francés sin redondear. tin en % anual (p. ej. 6.5). */
  function cuotaFrancesa(principal, tin, plazo) {
    const r = Number(tin) / 1200;
    if (!r) return principal / plazo;
    return principal * r / (1 - Math.pow(1 + r, -plazo));
  }

  /**
   * Cuadro de amortización (francés). Interés del mes = pendiente × TIN/12, redondeado a céntimos;
   * la última cuota ajusta los céntimos para dejar el pendiente exactamente a 0.
   * Los intereses son por periodos mensuales (TIN/12), así que el día de cobro solo cambia las fechas.
   */
  function cuadroAmortizacion({ principal, tin = 0, plazo, fechaPrimeraCuota = null, comisionMensual = 0, diaCobro = null }) {
    principal = Number(principal); plazo = Math.round(Number(plazo)); tin = Number(tin) || 0; comisionMensual = Number(comisionMensual) || 0;
    if (!(principal > 0) || !(plazo >= 1)) throw new Error('Importe y plazo deben ser mayores que 0');
    if (tin < 0) throw new Error('El TIN no puede ser negativo');
    const r = tin / 1200, cuota = round2(cuotaFrancesa(principal, tin, plazo));
    const filas = []; let pend = round2(principal), totI = 0;
    for (let n = 1; n <= plazo; n++) {
      const interes = round2(pend * r);
      let amort = round2(cuota - interes);
      if (n === plazo || amort > pend) amort = pend;
      pend = round2(pend - amort); totI += interes;
      const c = round2(amort + interes);
      filas.push({ n, fecha: isISO(fechaPrimeraCuota) ? fechaCuota(fechaPrimeraCuota, n, diaCobro) : null, cuota: c, interes, amortizacion: amort, comision: round2(comisionMensual), pago: round2(c + comisionMensual), pendiente: pend });
    }
    const totalIntereses = round2(totI), totalComisiones = round2(comisionMensual * plazo);
    return { cuota, filas, totalIntereses, totalComisiones, totalPagado: round2(principal + totalIntereses + totalComisiones) };
  }

  /** TIR por periodo de una serie de flujos (índice = periodo). Bisección robusta. */
  function tir(flujos) {
    const npv = i => flujos.reduce((s, f, k) => s + f / Math.pow(1 + i, k), 0);
    let lo = -0.99, hi = 1, flo = npv(lo), fhi = npv(hi);
    if (Math.abs(npv(0)) < 1e-9) return 0;
    let guard = 0;
    while (flo * fhi > 0 && guard++ < 20) { hi *= 2; fhi = npv(hi); }
    if (flo * fhi > 0) return NaN;
    for (let it = 0; it < 200; it++) {
      const mid = (lo + hi) / 2, fm = npv(mid);
      if (Math.abs(fm) < 1e-10 || (hi - lo) < 1e-14) return mid;
      if (fm * flo < 0) { hi = mid; fhi = fm; } else { lo = mid; flo = fm; }
    }
    return (lo + hi) / 2;
  }

  /** TAE (fracción, 0.0512 = 5,12 %) de un préstamo con comisión inicial y cuadro dado. */
  function calcularTAE({ principal, comisionApertura = 0, filas }) {
    const flujos = [Number(principal) - (Number(comisionApertura) || 0), ...filas.map(f => -f.pago)];
    const i = tir(flujos);
    return isFinite(i) ? Math.pow(1 + i, 12) - 1 : NaN;
  }

  /** Todo lo que la app necesita de una deuda: cuadro, TAE y estado según las cuotas pagadas. */
  function resumenDeuda(deuda, cuotasPagadas = [], hoy = null) {
    const cuadro = cuadroAmortizacion(deuda);
    const tae = calcularTAE({ principal: deuda.principal, comisionApertura: deuda.comisionApertura, filas: cuadro.filas });
    const pagadas = new Set(cuotasPagadas.map(Number));
    const pendientes = cuadro.filas.filter(f => !pagadas.has(f.n));
    const pagadasFilas = cuadro.filas.filter(f => pagadas.has(f.n));
    const pendiente = round2(pendientes.reduce((s, f) => s + f.amortizacion, 0));
    const interesesPendientes = round2(pendientes.reduce((s, f) => s + f.interes, 0));
    const interesesPagados = round2(pagadasFilas.reduce((s, f) => s + f.interes, 0));
    const taeIntro = deuda.taeIntroducida === null || deuda.taeIntroducida === undefined || deuda.taeIntroducida === '' ? null : Number(deuda.taeIntroducida) / 100;
    return {
      ...cuadro, tae, taeIntroducida: taeIntro,
      diferenciaTAE: taeIntro === null || !isFinite(tae) ? null : taeIntro - tae,
      totalCoste: round2(cuadro.totalIntereses + cuadro.totalComisiones + (Number(deuda.comisionApertura) || 0)),
      pagadas: pagadasFilas.length, restantes: pendientes.length, pendiente, interesesPendientes, interesesPagados,
      proximas: pendientes.slice(0, 3),
      vencidas: hoy ? pendientes.filter(f => f.fecha && f.fecha <= hoy) : [],
      terminada: pendientes.length === 0
    };
  }

  /* ---------------- Inversiones: FIFO ---------------- */
  const EPS = 1e-9;
  function ordenarOperaciones(ops) {
    return [...ops].sort((a, b) => (a.fecha < b.fecha ? -1 : a.fecha > b.fecha ? 1 : 0) ||
      ((a.tipo === 'compra' ? 0 : 1) - (b.tipo === 'compra' ? 0 : 1)) || ((a.creado || 0) - (b.creado || 0)) || String(a.id).localeCompare(String(b.id)));
  }
  /**
   * FIFO. Coste de adquisición = participaciones × precio + comisiones de compra.
   * Valor de transmisión = participaciones × precio − comisiones de venta.
   * Una venta parcial de un lote se lleva la parte proporcional de su coste (comisiones incluidas).
   *
   * Traspasos entre fondos (régimen de diferimiento español): no hay ganancia ni pérdida.
   * Las participaciones salen del fondo de origen por FIFO y entran en el de destino
   * conservando el coste y la FECHA de compra originales de cada lote, repartidos en
   * proporción a las participaciones recibidas. Por eso el motor recorre todas las
   * operaciones de todos los activos en orden cronológico. Un mismo día: compras,
   * luego traspasos y luego ventas.
   */
  const ORDEN_EVENTO = { compra: 0, traspaso: 1, venta: 2 };
  function nuevoEstado() { return { lotes: [], ventas: [], errores: [], compras: 0, ventasNetas: 0, costeEntrada: 0, costeSalida: 0, entradas: [], salidas: [] }; }
  /** Saca `cantidad` participaciones por FIFO. Devuelve los trozos y lo que faltó. */
  function sacarFIFO(st, cantidad) {
    let resto = cantidad; const trozos = [];
    while (resto > EPS && st.lotes.length) {
      const l = st.lotes[0], toma = Math.min(resto, l.participaciones), coste = l.costeUnitario * toma;
      trozos.push({ lote: l, toma: round8(toma), coste });
      l.participaciones = round8(l.participaciones - toma); l.coste -= coste; resto = round8(resto - toma);
      if (l.participaciones <= EPS) st.lotes.shift();
    }
    return { trozos, resto };
  }
  function motorFIFO(operaciones, traspasos, clave) {
    const estados = new Map(), erroresTraspaso = [];
    const st = k => { if (!estados.has(k)) estados.set(k, nuevoEstado()); return estados.get(k); };
    const eventos = [
      ...operaciones.map(o => ({ e: o, tipo: o.tipo === 'venta' ? 'venta' : 'compra' })),
      ...traspasos.map(t => ({ e: t, tipo: 'traspaso' }))
    ].sort((a, b) => (a.e.fecha < b.e.fecha ? -1 : a.e.fecha > b.e.fecha ? 1 : 0) || (ORDEN_EVENTO[a.tipo] - ORDEN_EVENTO[b.tipo]) ||
      ((a.e.creado || 0) - (b.e.creado || 0)) || String(a.e.id).localeCompare(String(b.e.id)));
    for (const { e, tipo } of eventos) {
      if (tipo === 'traspaso') { aplicarTraspaso(e, st, erroresTraspaso); continue; }
      const s = st(clave(e)), op = e;
      const part = Number(op.participaciones), precio = Number(op.precio), com = Number(op.comisiones) || 0;
      if (!(part > 0)) { s.errores.push({ opId: op.id, msg: 'Participaciones no válidas' }); continue; }
      if (tipo === 'compra') {
        const coste = part * precio + com; s.compras += coste;
        s.lotes.push({ opId: op.id, fecha: op.fecha, participaciones: part, iniciales: part, coste, costeUnitario: coste / part });
      } else {
        const { trozos, resto } = sacarFIFO(s, part);
        const consumos = trozos.map(t => {
          const c = { compraId: t.lote.opId, fecha: t.lote.fecha, participaciones: t.toma, costeUnitario: t.lote.costeUnitario, coste: round2(t.coste), _c: t.coste };
          if (t.lote.origen) c.origen = t.lote.origen;
          return c;
        });
        if (resto > EPS) s.errores.push({ opId: op.id, msg: `Se venden ${round8(resto)} participaciones más de las que había el ${op.fecha}` });
        const importeNeto = part * precio - com; s.ventasNetas += importeNeto;
        const costeTotal = consumos.reduce((x, c) => x + c._c, 0);
        consumos.forEach(c => delete c._c);
        s.ventas.push({ opId: op.id, fecha: op.fecha, participaciones: part, precio, comisiones: com, importeNeto: round2(importeNeto), coste: round2(costeTotal), ganancia: round2(importeNeto - costeTotal), consumos, incompleta: resto > EPS });
      }
    }
    return { estados, erroresTraspaso };
  }
  function aplicarTraspaso(t, st, erroresTraspaso) {
    const err = msg => { const e = { traspasoId: t.id, activoId: t.origenId, msg }; erroresTraspaso.push(e); st(t.origenId).errores.push(e); };
    if (!t.origenId || !t.destinoId || t.origenId === t.destinoId) return err('El traspaso necesita un fondo de origen y otro de destino distintos');
    const O = st(t.origenId), D = st(t.destinoId);
    const disponibles = round8(O.lotes.reduce((x, l) => x + l.participaciones, 0));
    const X = t.todas ? disponibles : Number(t.participaciones);
    const R = Number(t.participacionesDestino);
    if (!(X > EPS)) return err(`No hay participaciones que traspasar el ${t.fecha}`);
    if (!(R > 0)) return err('Indica las participaciones recibidas en el fondo de destino');
    const { trozos, resto } = sacarFIFO(O, X);
    if (resto > EPS) err(`Se traspasan ${round8(resto)} participaciones más de las que había el ${t.fecha}`);
    const tomado = round8(X - resto), objetivo = round8(R * tomado / X);
    let acumulado = 0, coste = 0;
    const origen = { traspasoId: t.id, activoId: t.origenId, fecha: t.fecha };
    const nuevos = trozos.map((tr, i) => {
      const p = i === trozos.length - 1 ? round8(objetivo - acumulado) : round8(tr.toma * R / X);
      acumulado = round8(acumulado + p); coste += tr.coste;
      return { opId: tr.lote.opId, fecha: tr.lote.fecha, participaciones: p, iniciales: p, coste: tr.coste, costeUnitario: p > 0 ? tr.coste / p : 0, origen };
    });
    // Los lotes heredados se colocan por su fecha de compra original (FIFO del fondo de destino)
    for (const l of nuevos) {
      if (!(l.participaciones > EPS)) continue;
      let i = D.lotes.findIndex(x => x.fecha > l.fecha); if (i < 0) i = D.lotes.length;
      D.lotes.splice(i, 0, l);
    }
    const lotesSalida = trozos.map(tr => ({ compraId: tr.lote.opId, fecha: tr.lote.fecha, participaciones: tr.toma, coste: round2(tr.coste), ...(tr.lote.origen ? { origen: tr.lote.origen } : {}) }));
    O.costeSalida += coste; D.costeEntrada += coste;
    O.salidas.push({ traspasoId: t.id, fecha: t.fecha, destinoId: t.destinoId, participaciones: tomado, recibidas: objetivo, coste: round2(coste), lotes: lotesSalida, incompleta: resto > EPS });
    D.entradas.push({ traspasoId: t.id, fecha: t.fecha, origenId: t.origenId, participaciones: objetivo, entregadas: tomado, coste: round2(coste), lotes: lotesSalida.length });
  }
  function resultadoFIFO(s) {
    const { lotes, ventas, errores } = s;
    const participaciones = round8(lotes.reduce((x, l) => x + l.participaciones, 0));
    const costeRestante = lotes.reduce((x, l) => x + l.coste, 0);
    const porAnio = {};
    ventas.forEach(v => { const y = v.fecha.slice(0, 4); porAnio[y] = round2((porAnio[y] || 0) + v.ganancia); });
    const r = {
      participaciones, costeRestante: round2(costeRestante),
      costeMedio: participaciones > EPS ? costeRestante / participaciones : 0,
      lotes: lotes.map(l => { const o = { opId: l.opId, fecha: l.fecha, participaciones: l.participaciones, iniciales: l.iniciales, coste: round2(l.coste), costeUnitario: l.costeUnitario }; if (l.origen) o.origen = l.origen; return o; }),
      ventas, errores,
      comprado: round2(s.compras), vendidoNeto: round2(s.ventasNetas),
      // Aportado neto del activo: lo que has puesto de tu bolsillo, más/menos el coste que entra/sale por traspasos
      aportadoNeto: round2(s.compras + s.costeEntrada - s.ventasNetas - s.costeSalida),
      gananciaRealizada: round2(ventas.reduce((x, v) => x + v.ganancia, 0)), realizadaPorAnio: porAnio
    };
    if (s.entradas.length || s.salidas.length) Object.assign(r, { traspasosEntrada: s.entradas, traspasosSalida: s.salidas, costeEntrada: round2(s.costeEntrada), costeSalida: round2(s.costeSalida) });
    return r;
  }
  /** FIFO de un solo activo (sin traspasos). */
  function fifo(operaciones) {
    const { estados } = motorFIFO(operaciones, [], () => '_');
    return resultadoFIFO(estados.get('_') || nuevoEstado());
  }
  /** FIFO de toda la cartera con traspasos entre fondos. Devuelve { porActivo: {id: resultado}, erroresTraspaso }. */
  function carteraFIFO(operaciones, traspasosFondos = []) {
    const { estados, erroresTraspaso } = motorFIFO(operaciones, traspasosFondos.filter(t => !t.deleted), o => o.activoId);
    const porActivo = {};
    for (const [k, s] of estados) porActivo[k] = resultadoFIFO(s);
    return { porActivo, erroresTraspaso, vacio: resultadoFIFO(nuevoEstado()) };
  }
  /** Claves de los errores (para saber si un cambio crea errores nuevos). */
  function clavesErrores(cf) {
    const out = new Set();
    for (const [k, r] of Object.entries(cf.porActivo)) r.errores.forEach(e => out.add(k + '|' + (e.opId || e.traspasoId) + '|' + e.msg));
    return out;
  }
  /** Errores que aparecen en `despues` y no estaban en `antes` (resultados de carteraFIFO). */
  function erroresNuevos(antes, despues) {
    const a = clavesErrores(antes), out = [];
    for (const [k, r] of Object.entries(despues.porActivo)) r.errores.forEach(e => { if (!a.has(k + '|' + (e.opId || e.traspasoId) + '|' + e.msg)) out.push(e); });
    return out;
  }
  /** Cuadre de un traspaso entre fondos: importe que sale (part. × VL origen) frente al que entra. */
  function cuadreTraspasoFondos({ participaciones, vlOrigen, participacionesDestino, vlDestino }) {
    const sale = participaciones > 0 && vlOrigen > 0 ? participaciones * vlOrigen : null;
    const entra = participacionesDestino > 0 && vlDestino > 0 ? participacionesDestino * vlDestino : null;
    const diferencia = sale !== null && entra !== null ? round2(entra - sale) : null;
    return { sale: sale === null ? null : round2(sale), entra: entra === null ? null : round2(entra), diferencia, cuadra: diferencia === null || Math.abs(diferencia) <= Math.max(1, 0.005 * sale) };
  }
  /** Último precio por fecha (y, a igualdad, el editado más tarde). */
  function ultimoPrecio(precios) {
    return [...precios].sort((a, b) => (a.fecha < b.fecha ? 1 : a.fecha > b.fecha ? -1 : 0) || (b.updatedAt || 0) - (a.updatedAt || 0))[0] || null;
  }
  /** Métricas de un activo a partir de su resultado FIFO + valor de mercado con el último precio manual. */
  function metricasDe(f, operaciones, precios, extrasPrecio = []) {
    const up = ultimoPrecio(precios);
    let precio = up ? up.precio : null, fechaPrecio = up ? up.fecha : null, precioDeOperacion = false;
    if (precio === null) {
      const cand = [...ordenarOperaciones(operaciones).map(o => ({ fecha: o.fecha, precio: Number(o.precio) })), ...extrasPrecio].filter(c => c.precio >= 0);
      const last = cand.sort((a, b) => (a.fecha < b.fecha ? -1 : a.fecha > b.fecha ? 1 : 0)).pop();
      if (last) { precio = last.precio; fechaPrecio = last.fecha; precioDeOperacion = true; }
    }
    const valor = precio === null ? 0 : round2(f.participaciones * precio);
    const noRealizada = round2(valor - f.costeRestante);
    return { ...f, precio, fechaPrecio, precioDeOperacion, valor, noRealizada, noRealizadaPct: f.costeRestante > 0 ? noRealizada / f.costeRestante : null };
  }
  function metricasActivo(operaciones, precios) { return metricasDe(fifo(operaciones), operaciones, precios); }
  /** Métricas de todos los activos teniendo en cuenta los traspasos entre fondos. */
  function metricasCartera(activos, operaciones, precios, traspasosFondos = []) {
    const cf = carteraFIFO(operaciones, traspasosFondos);
    return activos.map(a => {
      const o = operaciones.filter(x => x.activoId === a.id), p = precios.filter(x => x.activoId === a.id);
      const vl = traspasosFondos.filter(t => !t.deleted && t.destinoId === a.id && t.vlDestino > 0).map(t => ({ fecha: t.fecha, precio: Number(t.vlDestino) }))
        .concat(traspasosFondos.filter(t => !t.deleted && t.origenId === a.id && t.vlOrigen > 0).map(t => ({ fecha: t.fecha, precio: Number(t.vlOrigen) })));
      return { activo: a, ops: o, precios: p, ...metricasDe(cf.porActivo[a.id] || cf.vacio, o, p, vl) };
    });
  }
  /** Comprueba si una venta nueva/editada cabe (participaciones disponibles a esa fecha). */
  function disponibleEn(operaciones, fecha, excluirId = null) {
    const ops = operaciones.filter(o => o.id !== excluirId && o.fecha <= fecha);
    return fifo(ops).participaciones;
  }
  /** Participaciones de un activo a una fecha (incluida), contando traspasos entre fondos. */
  function disponibleActivo(activoId, operaciones, traspasosFondos, fecha, excluirId = null) {
    const cf = carteraFIFO(operaciones.filter(o => o.id !== excluirId && o.fecha <= fecha), traspasosFondos.filter(t => t.id !== excluirId && t.fecha <= fecha));
    return (cf.porActivo[activoId] || cf.vacio).participaciones;
  }

  /* ---------------- Movimientos recurrentes ---------------- */
  const idRecurrente = (plantillaId, ym) => `rec_${plantillaId}_${ym}`;
  /**
   * Meses que tocan para una plantilla, hasta hoy (incluido) y como mucho `maxMeses` hacia atrás.
   * Cada uno lleva su id determinista y un updatedAt determinista (medianoche UTC de su fecha):
   * así dos dispositivos crean el mismo registro, y cualquier edición o borrado del usuario
   * (siempre posterior a esa fecha) gana en la fusión y no se «resucita».
   */
  function periodosRecurrente(rec, hoy, maxMeses = 36) {
    if (!rec || rec.deleted || rec.activo === false || !/^\d{4}-\d{2}$/.test(rec.desde || '')) return [];
    const hoyYm = hoy.slice(0, 7);
    let ym = rec.desde; const minYm = ymAdd(hoyYm, -maxMeses + 1); if (ym < minYm) ym = minYm;
    const fin = rec.hasta && rec.hasta < hoyYm ? rec.hasta : hoyYm;
    const out = [];
    for (; ym <= fin; ym = ymAdd(ym, 1)) {
      const fecha = fechaCobroEnMes(ym, normalizarDiaCobro(rec.dia, null, 1));
      if (fecha > hoy) break;
      out.push({ id: idRecurrente(rec.id, ym), periodo: ym, fecha, updatedAt: toUTC(fecha) });
    }
    return out;
  }
  /** Movimientos que faltan por generar (los ids ya existentes, vivos o borrados, se respetan). */
  function generarRecurrentes(plantillas, movimientos, hoy) {
    const existentes = new Set(movimientos.map(m => m.id));
    const nuevos = [];
    for (const r of plantillas) {
      if (r.deleted) continue;
      for (const p of periodosRecurrente(r, hoy)) {
        if (existentes.has(p.id)) continue;
        const m = { id: p.id, tipo: r.tipo, fecha: p.fecha, importe: round2(r.importe), categoria: r.categoria, descripcion: r.descripcion || '', cuenta: r.cuenta || '', recurrenteId: r.id, updatedAt: p.updatedAt };
        if (r.cuentaId) m.cuentaId = r.cuentaId;
        if (r.tipo === 'gasto') m.naturaleza = r.naturaleza || 'fijo'; else m.tipoIngreso = r.tipoIngreso || 'otro';
        nuevos.push(m); existentes.add(p.id);
      }
    }
    return nuevos;
  }

  /* ---------------- Garantías ---------------- */
  const GARANTIA_ANIOS_DEFECTO = 3; // bienes nuevos en España (RDL 1/2007 tras la reforma de 2022)
  const vencimientoGarantia = (fechaCompra, anios = GARANTIA_ANIOS_DEFECTO) => addYearsISO(fechaCompra, anios);
  function estadoGarantia(vence, hoy, diasAviso = 30) {
    const dias = diffDays(hoy, vence);
    return { dias, estado: dias < 0 ? 'caducada' : dias <= diasAviso ? 'proxima' : 'vigente' };
  }
  /** Enlace a una plantilla de evento de Google Calendar (día completo). No necesita permisos. */
  function urlGoogleCalendar({ titulo, fecha, detalles = '' }) {
    const d = fecha.replace(/-/g, ''), d2 = addDaysISO(fecha, 1).replace(/-/g, '');
    return 'https://calendar.google.com/calendar/render?action=TEMPLATE' +
      '&text=' + encodeURIComponent(titulo) + '&dates=' + d + '/' + d2 + '&details=' + encodeURIComponent(detalles);
  }

  /* ---------------- Números en formato español ---------------- */
  function parseNumeroES(str) {
    if (typeof str === 'number') return str;
    let s = String(str ?? '').trim().replace(/\s|€|EUR/gi, '');
    if (!s) return NaN;
    if (s.includes(',') && s.includes('.')) s = s.lastIndexOf(',') > s.lastIndexOf('.') ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
    else if (s.includes(',')) s = s.replace(/,(?=\d{3}(,|$))(?=.*,)/g, '').replace(',', '.');
    else if (/^-?\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, '');
    return Number(s);
  }

  /* ---------------- Lectura de texto OCR (tickets y nóminas) ---------------- */
  const MESES = { ene: 1, feb: 2, mar: 3, abr: 4, may: 5, jun: 6, jul: 7, ago: 8, sep: 9, set: 9, oct: 10, nov: 11, dic: 12 };
  const RE_IMPORTE = /(?<![\d.,])(-?\d{1,3}(?:[.\s]\d{3})+|-?\d+)\s?[,.]\s?(\d{2})(?![\d])/g;
  function importesEn(linea) {
    const out = []; let m; RE_IMPORTE.lastIndex = 0;
    while ((m = RE_IMPORTE.exec(linea))) out.push(Number(m[1].replace(/[.\s]/g, '') + '.' + m[2]));
    return out;
  }
  function fechasEn(texto) {
    const out = [];
    const re = /(?<!\d)(\d{1,2})\s?[\/\-.]\s?(\d{1,2})\s?[\/\-.]\s?(\d{4}|\d{2})(?!\d)/g; let m;
    while ((m = re.exec(texto))) {
      let [, d, mo, y] = m; d = +d; mo = +mo; y = +y; if (y < 100) y += 2000;
      if (mo >= 1 && mo <= 12 && d >= 1 && d <= daysInMonth(y, mo) && y >= 2000 && y <= 2100) out.push({ iso: `${y}-${pad(mo)}-${pad(d)}`, idx: m.index });
    }
    const re2 = /(?<!\d)(\d{1,2})\s*(?:de\s+)?(ene|feb|mar|abr|may|jun|jul|ago|sep|set|oct|nov|dic)[a-z]*\.?\s*(?:de\s+)?(\d{4})/gi;
    while ((m = re2.exec(texto))) {
      const d = +m[1], mo = MESES[m[2].toLowerCase()], y = +m[3];
      if (d >= 1 && d <= daysInMonth(y, mo)) out.push({ iso: `${y}-${pad(mo)}-${pad(d)}`, idx: m.index });
    }
    return out.sort((a, b) => a.idx - b.idx);
  }
  const RUIDO_CABECERA = /\b(C\.?I\.?F|N\.?I\.?F|NIF|CIF|TEL[EÉ]?F?|TFNO|C\/|CALLE|AVDA|AVENIDA|PLAZA|CTRA|FACTURA|TICKET|FECHA|HORA|CAJA|WWW|HTTP|N[ºO°]\s?\d|C\.?P\.?\s?\d|BIENVENID|GRACIAS)\b|@|\d{5}/i;
  const limpiarNombre = s => s.replace(/^[^A-Za-zÁÉÍÓÚÜÑáéíóúüñ0-9]+|[^A-Za-zÁÉÍÓÚÜÑáéíóúüñ0-9.)]+$/g, '').replace(/\s{2,}/g, ' ').trim();
  function valorEnLinea(lineas, i) {
    const a = importesEn(lineas[i]);
    if (a.length) return a[a.length - 1];
    const b = lineas[i + 1] ? importesEn(lineas[i + 1]) : [];
    return b.length ? b[0] : null;
  }
  function detectarTipoDocumento(texto) {
    return /N[ÓO]MINA|DEVENGOS|DEVENGADO|L[IÍ1]QUIDO\s+A\s+PERCIBIR|RECIBO\s+(INDIVIDUAL\s+)?(JUSTIFICATIVO\s+)?DE\s+SALARIOS/i.test(texto) ? 'nomina' : 'ticket';
  }
  /**
   * Propone campos a partir del texto OCR. Nunca guarda nada: la app lo muestra para que el usuario
   * lo confirme o corrija. Devuelve null en los campos que no encuentra.
   */
  function analizarTexto(texto, tipo = null) {
    texto = String(texto || '').replace(/\r/g, '');
    const lineas = texto.split('\n').map(l => l.trim()).filter(Boolean);
    tipo = tipo || detectarTipoDocumento(texto);
    const fechas = fechasEn(texto);
    const out = { tipo, importe: null, fecha: null, comercio: null, empresa: null, liquido: null, devengado: null, deducciones: null, irpf: null };
    if (tipo === 'nomina') {
      const buscar = re => { for (let i = 0; i < lineas.length; i++) if (re.test(lineas[i])) { const v = valorEnLinea(lineas, i); if (v !== null) return v; } return null; };
      out.liquido = buscar(/L[IÍ1]QUIDO\s+(TOTAL\s+)?A\s+PERCIBIR|NETO\s+A\s+PERCIBIR|TOTAL\s+L[IÍ1]QUIDO|L[IÍ1]QUIDO/i);
      out.devengado = buscar(/TOTAL\s+DEVENGADO|TOTAL\s+DEVENGOS/i);
      out.deducciones = buscar(/TOTAL\s+(A\s+)?DEDUCIR|TOTAL\s+DEDUCCIONES/i);
      out.irpf = buscar(/I\.?\s?R\.?\s?P\.?\s?F/i);
      out.importe = out.liquido;
      for (let i = 0; i < lineas.length && !out.empresa; i++) {
        const m = lineas[i].match(/^EMPRESA\s*[:.]?\s*(.*)$/i);
        if (m) out.empresa = limpiarNombre(m[1]) || (lineas[i + 1] ? limpiarNombre(lineas[i + 1]) : null);
      }
      if (!out.empresa) out.empresa = (lineas.find(l => /\b(S\.?\s?L\.?U?|S\.?\s?A\.?U?)\b\.?$/i.test(l)) || null);
      if (out.empresa) out.empresa = limpiarNombre(out.empresa);
      const per = lineas.findIndex(l => /PERIODO|PER[IÍ]ODO/i.test(l));
      const fper = per >= 0 ? fechasEn(lineas.slice(per, per + 2).join(' ')) : [];
      out.fecha = (fper.length ? fper[fper.length - 1].iso : (fechas[0] && fechas[0].iso)) || null;
      out.comercio = out.empresa;
    } else {
      const excl = /SUB\s*-?\s*TOTAL|BASE\s+IMP|TOTAL\s+I\.?V\.?A|TOTAL\s+IGIC|TOTAL\s+ART|TOTAL\s+UNIDADES|TOTAL\s+AHORRO|TOTAL\s+DTO|DESCUENTO/i;
      const kw = /\bTOTAL\b|IMPORTE\s+TOTAL|A\s+PAGAR|TOTAL\s+COMPRA|IMPORTE\s+A\s+ABONAR/i;
      const cands = [];
      lineas.forEach((l, i) => { if (kw.test(l) && !excl.test(l)) { const v = valorEnLinea(lineas, i); if (v !== null && v > 0) cands.push(v); } });
      if (cands.length) out.importe = Math.max(...cands);
      else {
        const todos = lineas.filter(l => !/ENTREGAD|EFECTIVO|CAMBIO|DEVOLUCI|PUNTOS/i.test(l)).flatMap(importesEn).filter(v => v > 0);
        out.importe = todos.length ? Math.max(...todos) : null;
      }
      out.fecha = fechas.length ? fechas[0].iso : null;
      const cab = lineas.slice(0, 6).find(l => (l.match(/[A-Za-zÁÉÍÓÚÑáéíóúñ]/g) || []).length >= 3 && !RUIDO_CABECERA.test(l) && !importesEn(l).length);
      out.comercio = cab ? limpiarNombre(cab) : null;
    }
    return out;
  }

  /* ---------------- CSV de operaciones de inversión ---------------- */
  const CSV_COLUMNAS = ['fecha', 'activo', 'tipo_activo', 'isin_ticker', 'operacion', 'participaciones', 'precio', 'comisiones', 'notas'];
  const PLANTILLA_CSV = '\ufeff' + CSV_COLUMNAS.join(';') + '\r\n' +
    '15/01/2024;Vanguard Global Stock Index;fondo;IE00B03HD191;compra;10,5234;190,05;0;Aportación de enero\r\n' +
    '15/02/2024;Vanguard Global Stock Index;fondo;IE00B03HD191;compra;10,1200;197,63;0;\r\n' +
    '03/05/2024;iShares Core MSCI World;etf;IWDA;compra;25;88,40;2,50;Broker\r\n' +
    '10/09/2025;iShares Core MSCI World;etf;IWDA;venta;10;101,20;2,50;Venta parcial\r\n';
  function splitCSV(text, sep) {
    const rows = []; let row = [], cur = '', q = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (q) { if (c === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c; }
      else if (c === '"') q = true;
      else if (c === sep) { row.push(cur); cur = ''; }
      else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(cur); rows.push(row); row = []; cur = ''; }
      else cur += c;
    }
    if (cur !== '' || row.length) { row.push(cur); rows.push(row); }
    return rows.filter(r => r.some(c => c.trim() !== ''));
  }
  const sinAcentos = s => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  function parseFechaFlexible(s) {
    s = String(s || '').trim();
    if (isISO(s)) return s;
    const m = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})$/);
    if (m) { const iso = `${m[3]}-${pad(m[2])}-${pad(m[1])}`; return isISO(iso) && +m[2] <= 12 && +m[1] <= daysInMonth(+m[3], +m[2]) ? iso : null; }
    return null;
  }
  const TIPO_ACTIVO_ALIAS = { fondo: 'fondo', fondos: 'fondo', fund: 'fondo', etf: 'etf', accion: 'accion', acciones: 'accion', stock: 'accion', cripto: 'cripto', crypto: 'cripto', criptomoneda: 'cripto', deposito: 'deposito', otro: 'otro' };
  function parseCSVOperaciones(text) {
    text = String(text || '').replace(/^\ufeff/, '');
    const first = text.split(/\r?\n/)[0] || '';
    const sep = first.includes(';') ? ';' : first.includes('\t') ? '\t' : ',';
    const rows = splitCSV(text, sep);
    if (!rows.length) return { filas: [], errores: [{ linea: 1, msg: 'El archivo está vacío' }] };
    const head = rows[0].map(h => sinAcentos(h.trim().toLowerCase()).replace(/[\s/-]+/g, '_'));
    const idx = k => head.indexOf(k);
    const alias = { isin_ticker: ['isin_ticker', 'isin', 'ticker'], operacion: ['operacion', 'tipo_operacion', 'tipo'], tipo_activo: ['tipo_activo', 'clase'] };
    const col = k => { for (const a of (alias[k] || [k])) if (idx(a) >= 0) return idx(a); return -1; };
    const falta = ['fecha', 'activo', 'participaciones', 'precio'].filter(k => col(k) < 0);
    if (falta.length) return { filas: [], errores: [{ linea: 1, msg: 'Faltan columnas: ' + falta.join(', ') + '. Usa la plantilla.' }] };
    const filas = [], errores = [];
    rows.slice(1).forEach((r, k) => {
      const linea = k + 2, get = c => { const i = col(c); return i >= 0 ? (r[i] || '').trim() : ''; };
      const fecha = parseFechaFlexible(get('fecha'));
      const op = sinAcentos(get('operacion').toLowerCase()) || 'compra';
      const operacion = /^(venta|vender|sell|v)$/.test(op) ? 'venta' : /^(compra|comprar|buy|c|suscripcion|aportacion)$/.test(op) ? 'compra' : null;
      const participaciones = parseNumeroES(get('participaciones')), precio = parseNumeroES(get('precio'));
      const comisiones = get('comisiones') ? parseNumeroES(get('comisiones')) : 0;
      const activo = get('activo');
      const e = [];
      if (!activo) e.push('falta el activo');
      if (!fecha) e.push('fecha no válida (usa dd/mm/aaaa)');
      if (!operacion) e.push('operación debe ser «compra» o «venta»');
      if (!(participaciones > 0)) e.push('participaciones no válidas');
      if (!(precio >= 0) || !isFinite(precio)) e.push('precio no válido');
      if (!(comisiones >= 0) || !isFinite(comisiones)) e.push('comisiones no válidas');
      if (e.length) { errores.push({ linea, msg: e.join('; ') }); return; }
      const ta = sinAcentos(get('tipo_activo').toLowerCase());
      const codigo = get('isin_ticker').toUpperCase();
      filas.push({ linea, fecha, activo, tipoActivo: TIPO_ACTIVO_ALIAS[ta] || (ta ? 'otro' : 'fondo'), isin: /^[A-Z]{2}[A-Z0-9]{9}\d$/.test(codigo) ? codigo : '', ticker: /^[A-Z]{2}[A-Z0-9]{9}\d$/.test(codigo) ? '' : codigo, operacion, participaciones, precio, comisiones, notas: get('notas') });
    });
    return { filas, errores };
  }

  /* ---------------- Migración de inversiones v2 -> activos + operaciones (v3) ---------------- */
  const TIPO_V2_A_V3 = { acciones: 'accion', ETF: 'etf', fondo: 'fondo', cripto: 'cripto', 'depósito': 'deposito', otro: 'otro' };
  /**
   * Cada inversión v2 (aportado + valor actual) pasa a ser: un activo con el mismo id, una compra de
   * 1 participación al precio «aportado» y un precio = «valor actual». Ids y updatedAt deterministas:
   * si dos dispositivos migran a la vez, generan exactamente lo mismo. La inversión v2 queda como lápida.
   */
  function migrarInversionV2(inv, hoy) {
    const t = Number(inv.updatedAt) || 0;
    const fecha = isISO(inv.fechaActualizacion) ? inv.fechaActualizacion : (t ? new Date(t).toISOString().slice(0, 10) : hoy);
    return {
      activo: { id: inv.id, nombre: inv.nombre, tipo: TIPO_V2_A_V3[inv.tipo] || 'otro', isin: '', ticker: '', notas: inv.notas || '', updatedAt: t },
      operacion: { id: 'mig_' + inv.id, activoId: inv.id, tipo: 'compra', fecha, participaciones: 1, precio: round2(Number(inv.aportado) || 0), comisiones: 0, notas: 'Migrado de la versión anterior (1 participación = lo aportado). Puedes sustituirlo por tus compras reales.', updatedAt: t },
      precio: { id: 'mig_' + inv.id + '_p', activoId: inv.id, fecha, precio: round2(Number(inv.valorActual) || 0), updatedAt: t },
      lapida: { id: inv.id, deleted: true, updatedAt: t }
    };
  }

  const api = {
    round2, isISO, daysInMonth, addMonthsISO, addYearsISO, addDaysISO, diffDays, ymAdd, fechaEnMes,
    DIA_ULTIMO, normalizarDiaCobro, fechaCobroEnMes, fechaCuota, textoDiaCobro,
    cuotaFrancesa, cuadroAmortizacion, tir, calcularTAE, resumenDeuda,
    fifo, carteraFIFO, erroresNuevos, cuadreTraspasoFondos, ordenarOperaciones, ultimoPrecio, metricasActivo, metricasCartera, disponibleEn, disponibleActivo,
    idRecurrente, periodosRecurrente, generarRecurrentes,
    GARANTIA_ANIOS_DEFECTO, vencimientoGarantia, estadoGarantia, urlGoogleCalendar,
    parseNumeroES, importesEn, fechasEn, detectarTipoDocumento, analizarTexto,
    CSV_COLUMNAS, PLANTILLA_CSV, parseCSVOperaciones, parseFechaFlexible, migrarInversionV2
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.FinanceCore = api;
})(typeof self !== 'undefined' ? self : globalThis);
