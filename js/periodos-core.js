/* =========================================================
   Periodos de nómina (v3.8). Lógica pura (sin DOM), probada con node (tests/periodos.test.js).
   Un periodo va desde el día que entra una nómina hasta el día antes de la siguiente nómina:
   la nómina de octubre paga los gastos desde que se ingresa hasta que llega la siguiente.
   · El último periodo sigue abierto (como mínimo hasta un mes después de su nómina, y si la siguiente se retrasa, hasta hoy).
   · Antes de la primera nómina: un pseudo-periodo «Antes de la primera nómina».
   · Sin nóminas: no hay periodos (la app usa meses naturales).
   · Dos nóminas a menos de `minDias` días (p. ej. una paga extra marcada como nómina) caen en el mismo periodo.
   AHORRO = lo que pasas (neto) de tus cuentas del día a día a tus cuentas de ahorro/inversión en el periodo.
   ========================================================= */
(function (root) {
  'use strict';
  const FC = typeof module !== 'undefined' && module.exports ? require('./finance-core.js') : root.FinanceCore;
  const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
  const MES3 = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
  const vivo = x => x && !x.deleted;
  const esNomina = m => vivo(m) && m.tipo === 'ingreso' && m.tipoIngreso === 'nomina' && FC.isISO(m.fecha);
  const diaCorto = iso => `${+iso.slice(8, 10)} ${MES3[+iso.slice(5, 7) - 1]}`;
  /** «28 oct – 27 nov» (con el año si el periodo cruza de año). */
  function rango(desde, hasta) {
    const cruza = desde.slice(0, 4) !== hasta.slice(0, 4);
    return `${diaCorto(desde)}${cruza ? ' ' + desde.slice(0, 4) : ''} – ${diaCorto(hasta)}${cruza ? ' ' + hasta.slice(0, 4) : ''}`;
  }
  const nombreNomina = (fecha, conAnio = false) => `Nómina de ${MESES[+fecha.slice(5, 7) - 1]}${conAnio ? ' ' + fecha.slice(0, 4) : ''}`;

  /**
   * periodos(movimientos, { hoy, inicio, minDias = 20 }) → { hayNominas, lista }
   * lista (cronológica): { id, tipo: 'nomina'|'previo', desde, hasta, abierto, nominas: [movs], importeNomina, nombre, nombreLargo, rango, label }
   * inicio: fecha desde la que empieza el pseudo-periodo previo (por defecto, el primer movimiento).
   */
  function periodos(movimientos, { hoy, inicio = null, minDias = 20 } = {}) {
    const movs = (movimientos || []).filter(vivo);
    const noms = movs.filter(esNomina).sort((a, b) => a.fecha.localeCompare(b.fecha) || String(a.id).localeCompare(String(b.id)));
    if (!noms.length) return { hayNominas: false, lista: [] };
    const grupos = [];
    for (const n of noms) {
      const g = grupos[grupos.length - 1];
      if (g && FC.diffDays(g.desde, n.fecha) < minDias) g.nominas.push(n);
      else grupos.push({ desde: n.fecha, nominas: [n] });
    }
    const lista = grupos.map((g, i) => {
      const sig = grupos[i + 1], abierto = !sig;
      let hasta = sig ? FC.addDaysISO(sig.desde, -1) : FC.addDaysISO(FC.addMonthsISO(g.desde, 1), -1);
      if (abierto && hoy && hoy > hasta) hasta = hoy;   // la siguiente nómina se retrasa: sigue abierto hasta hoy
      const importe = FC.round2(g.nominas.reduce((s, n) => s + Number(n.importe || 0), 0));
      const nombre = nombreNomina(g.desde), r = rango(g.desde, hasta);
      return { id: g.desde, tipo: 'nomina', desde: g.desde, hasta, abierto, nominas: g.nominas, importeNomina: importe,
        nombre, nombreLargo: nombreNomina(g.desde, true), rango: r, label: `${nombre} (${r})` };
    });
    const primeraFecha = inicio || movs.map(m => m.fecha).filter(FC.isISO).sort()[0];
    if (primeraFecha && primeraFecha < lista[0].desde) {
      const hasta = FC.addDaysISO(lista[0].desde, -1), r = rango(primeraFecha, hasta);
      lista.unshift({ id: 'previo', tipo: 'previo', desde: primeraFecha, hasta, abierto: false, nominas: [], importeNomina: 0,
        nombre: 'Antes de la primera nómina', nombreLargo: 'Antes de la primera nómina', rango: r, label: `Antes de la primera nómina (${r})` });
    }
    return { hayNominas: true, lista };
  }
  /** Periodo que contiene `fecha` (o null). */
  const periodoEn = (lista, fecha) => (lista || []).find(p => p.desde <= fecha && fecha <= p.hasta) || null;
  /** Periodo para un mes (YYYY-MM): el de la nómina de ese mes; si no hay, el que contiene el día 15. */
  function periodoDeMes(lista, ym, hoy) {
    if (hoy && ym === hoy.slice(0, 7)) { const p = periodoEn(lista, hoy); if (p) return p; }
    const deNomina = (lista || []).filter(p => p.tipo === 'nomina' && p.desde.startsWith(ym)).pop();
    if (deNomina) return deNomina;
    const p = periodoEn(lista, `${ym}-15`);
    if (p) return p;
    if (!lista || !lista.length) return null;
    return `${ym}-15` < lista[0].desde ? lista[0] : lista[lista.length - 1];
  }
  /** Ahorro de un periodo a partir del saldo (CuentasCore.saldoPeriodo): lo traspasado (neto) a ahorro/inversión. */
  function ahorro(saldo, ingresos) {
    const a = saldo ? FC.round2(-(Number(saldo.traspasos) || 0)) : 0;
    const ahorrado = Math.abs(a) < 0.005 ? 0 : a;
    return { ahorrado, tasa: ingresos > 0 ? ahorrado / ingresos : null };
  }

  const api = { periodos, periodoEn, periodoDeMes, ahorro, rango, nombreNomina, esNomina, MESES, MES3 };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.PeriodosCore = api;
})(typeof self !== 'undefined' ? self : globalThis);
