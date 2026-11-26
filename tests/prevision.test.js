// Tests unitarios v3.7: Previsión (lo que sobrará o faltará cada mes). Ejecutar:  node tests/prevision.test.js
'use strict';
const assert = require('assert');
const PC = require('../js/prevision-core.js');
const CC = require('../js/cuentas-core.js');
const FIX = require('./fixtures/datos-cuentas-recientes.js');
const tests = [];
const test = (name, fn) => tests.push([name, fn]);
const eq = (a, b, msg) => assert.ok(Math.abs(a - b) < 0.005, `${msg || ''} esperado ${b}, obtenido ${a}`);
const rec = (id, tipo, importe, dia, extra = {}) => ({ id, tipo, importe, dia, desde: '2026-01', hasta: '', activo: true, descripcion: id, categoria: 'X', ...extra });
const deudaManual = (id, cuota, plazo, primera, dia = 'ultimo', extra = {}) => ({ id, nombre: id, modo: 'manual', cuotaManual: cuota, plazo, fechaPrimeraCuota: primera, diaCobro: dia, cuotasEditadas: {}, ...extra });

test('Mes actual: solo cuenta lo pendiente (recurrente ya apuntado y cuota ya pagada no cuentan)', () => {
  const recs = [rec('alquiler', 'gasto', 500, 1), rec('luz', 'gasto', 60, 20), rec('gim', 'gasto', 30, 10)];
  const deudas = [deudaManual('coche', 200, 3, '2026-04-05', 5), deudaManual('movil', 25, 3, '2026-04-25', 25)];
  const movs = [
    { id: 'rec_alquiler_2026-04', recurrenteId: 'alquiler', tipo: 'gasto', fecha: '2026-04-01', importe: 500 },
    { id: 'x1', deudaId: 'coche', cuotaN: 1, tipo: 'gasto', fecha: '2026-04-05', importe: 200 }
  ];
  const P = PC.prevision({ hoy: '2026-04-15', saldoHoy: 1000, movimientos: movs, recurrentes: recs, deudas, meses: 2, gastoVariable: 0 });
  const [abr, may] = P.meses;
  assert.strictEqual(abr.actual, true);
  // abril v3.11: luz (20) pendiente; gimnasio (10) ya pasó sin apuntar → sigue pendiente; alquiler apuntado → no; cuota coche pagada → no; móvil (25) pendiente
  eq(abr.fijos, 90); eq(abr.cuotas, 25); eq(abr.sobra, 885);
  assert.deepStrictEqual(abr.items.map(i => i.concepto), ['gim', 'luz', 'movil · cuota 1/3']);
  assert.ok(abr.items.find(i => i.concepto === 'gim').pendiente);
  // mayo: todo
  eq(may.saldoInicial, 885, 'arrastre'); eq(may.fijos, 590); eq(may.cuotas, 225); eq(may.sobra, 70);
});

test('v3.11: un recurrente se da por hecho solo si hay un movimiento vinculado a ese periodo; se usa el importe real', () => {
  const recs = [rec('nom', 'ingreso', 1900, 28, { tipoIngreso: 'nomina' })];
  const P0 = PC.prevision({ hoy: '2026-05-01', saldoHoy: 0, recurrentes: recs, meses: 2, gastoVariable: 0 });
  eq(P0.meses[0].ingresos, 1900); assert.ok(P0.meses[0].items.some(i => i.origen === 'recurrente'));
  const movs = [{ id: 'm1', tipo: 'ingreso', tipoIngreso: 'nomina', fecha: '2026-05-26', importe: 1928.84, recurrenteId: 'nom', recurrentePeriodo: '2026-05' }];
  const P = PC.prevision({ hoy: '2026-05-01', saldoHoy: 0, movimientos: movs, recurrentes: recs, meses: 2, gastoVariable: 0 });
  eq(P.meses[0].ingresos, 1928.84, 'importe real del movimiento vinculado');
  assert.ok(P.meses[0].items.some(i => i.origen === 'apuntado' && Math.abs(i.importe - 1928.84) < 0.005));
  assert.ok(!P.meses[0].items.some(i => i.origen === 'recurrente'));
  eq(P.meses[1].ingresos, 1900, 'junio sigue pendiente con el importe de la plantilla');
  const cobrado = [{ ...movs[0], fecha: '2026-05-01' }];
  const P2 = PC.prevision({ hoy: '2026-05-10', saldoHoy: 1928.84, movimientos: cobrado, recurrentes: recs, meses: 1, gastoVariable: 0 });
  eq(P2.meses[0].ingresos, 0, 'ya cobrado: está en el saldo de hoy');
  eq(P2.meses[0].sobra, 1928.84);
  // migración: id rec_* sin campos explícitos también cuenta como hecho
  const legado = [{ id: 'rec_nom_2026-05', tipo: 'ingreso', tipoIngreso: 'nomina', fecha: '2026-05-28', importe: 1900 }];
  const P3 = PC.prevision({ hoy: '2026-05-30', saldoHoy: 1900, movimientos: legado, recurrentes: recs, meses: 1, gastoVariable: 0 });
  eq(P3.meses[0].ingresos, 0);
});

test('Nómina: estimada con la última si no hay recurrente; con recurrente, no se estima', () => {
  const movs = [{ id: 'n1', tipo: 'ingreso', tipoIngreso: 'nomina', fecha: '2026-03-28', importe: 1500.55, categoria: 'Nómina', cuentaId: 'b' },
                { id: 'n2', tipo: 'ingreso', tipoIngreso: 'nomina', fecha: '2026-04-27', importe: 1600.1, categoria: 'Nómina', cuentaId: 'b' }];
  const ne = PC.nominaEstimada(movs, [], '2026-05-03');
  assert.ok(ne); eq(ne.importe, 1600.1); assert.strictEqual(ne.dia, 27); assert.strictEqual(ne.cuentaId, 'b');
  const P = PC.prevision({ hoy: '2026-05-03', saldoHoy: 0, movimientos: movs, meses: 3, gastoVariable: 0 });
  assert.ok(P.meses.every(m => m.nominaEstimada));
  const it = P.meses[0].items[0];
  assert.strictEqual(it.estimado, true); assert.strictEqual(it.fecha, '2026-05-27'); eq(it.importe, 1600.1);
  eq(P.meses[2].sobra, 4800.3);
  // Febrero: 28 → el día 30 se ajusta al último día
  const P2 = PC.prevision({ hoy: '2027-01-31', movimientos: [{ id: 'n', tipo: 'ingreso', tipoIngreso: 'nomina', fecha: '2027-01-30', importe: 100 }], meses: 2, gastoVariable: 0 });
  assert.strictEqual(P2.meses[1].items[0].fecha, '2027-02-28');
  assert.strictEqual(P2.meses[0].items.length, 0, 'enero ya cobrada');
  // Con nómina recurrente: no se estima y cuenta la recurrente
  const recs = [rec('nom', 'ingreso', 1700, 28, { tipoIngreso: 'nomina' })];
  assert.strictEqual(PC.nominaEstimada(movs, recs, '2026-05-03'), null);
  const P3 = PC.prevision({ hoy: '2026-05-03', movimientos: movs, recurrentes: recs, meses: 2, gastoVariable: 0 });
  assert.strictEqual(P3.nominaEstimada, null); eq(P3.meses[0].ingresos, 1700); assert.ok(!P3.meses[0].nominaEstimada);
  // Nómina muy antigua (más de 3 meses): no se estima
  assert.strictEqual(PC.nominaEstimada(movs, [], '2026-09-01'), null);
});

test('Cuotas vencidas sin marcar se suman al mes actual; ambas formas de deuda', () => {
  const deudas = [deudaManual('man', 100, 4, '2026-02-10', 10, { cuotasEditadas: { 4: 90.5 } }),
    { id: 'cal', nombre: 'cal', principal: 1200, tin: 0, plazo: 12, fechaPrimeraCuota: '2026-05-05', diaCobro: 5, comisionApertura: 0, comisionMensual: 0 }];
  const movs = [{ id: 'p1', deudaId: 'man', cuotaN: 1, tipo: 'gasto', fecha: '2026-02-10', importe: 100 }];
  const P = PC.prevision({ hoy: '2026-04-01', movimientos: movs, deudas, meses: 3, gastoVariable: 0 });
  const [abr, may] = P.meses;
  // cuota 2 (10/03) vencida sin pagar → abril; cuota 3 (10/04) en abril; la 4 (editada, 90,50) en mayo + calculada 100
  eq(abr.cuotas, 200); assert.ok(abr.items.some(i => i.vencida && i.fechaCuota === '2026-03-10' && i.fecha === '2026-04-01'));
  eq(may.cuotas, 190.5); eq(P.meses[2].cuotas, 100);
});

test('Gasto variable: media de los últimos meses completos, override y lo ya gastado este mes', () => {
  const movs = [
    { id: 'a', tipo: 'gasto', naturaleza: 'variable', fecha: '2026-01-10', importe: 999 },      // fuera (solo 3 meses)
    { id: 'b', tipo: 'gasto', naturaleza: 'variable', fecha: '2026-02-10', importe: 300 },
    { id: 'c', tipo: 'gasto', naturaleza: 'variable', fecha: '2026-03-10', importe: 200.01 },
    { id: 'd', tipo: 'gasto', naturaleza: 'variable', fecha: '2026-04-10', importe: 100 },
    { id: 'e', tipo: 'gasto', naturaleza: 'fijo', fecha: '2026-04-11', importe: 5000 },        // fijo: no cuenta
    { id: 'f', tipo: 'gasto', naturaleza: 'variable', fecha: '2026-04-12', importe: 77, deudaId: 'x', cuotaN: 1 }, // cuota: no
    { id: 'g', tipo: 'gasto', naturaleza: 'variable', fecha: '2026-04-13', importe: 66, financiadoPor: 'x' },     // financiado: no
    { id: 'h', tipo: 'gasto', naturaleza: 'variable', fecha: '2026-05-02', importe: 150 }        // este mes
  ];
  const auto = PC.gastoVariableMedio(movs, '2026-05-10');
  assert.deepStrictEqual(auto.meses, ['2026-02', '2026-03', '2026-04']); eq(auto.importe, 200);
  const P = PC.prevision({ hoy: '2026-05-10', saldoHoy: 1000, movimientos: movs, meses: 2 });
  eq(P.gastoVariable, 200); eq(P.meses[0].variable, 50, 'mayo: 200 − 150 ya gastado'); eq(P.meses[0].variableYaGastado, 150); eq(P.meses[1].variable, 200);
  const P2 = PC.prevision({ hoy: '2026-05-10', saldoHoy: 1000, movimientos: movs, meses: 2, gastoVariable: 100 });
  eq(P2.meses[0].variable, 0, 'ya gastó más de lo estimado'); eq(P2.meses[1].variable, 100); eq(P2.meses[1].sobra, 900);
  eq(PC.gastoVariableMedio([], '2026-05-10').importe, 0);
});

test('Te faltarán: el negativo se arrastra al mes siguiente', () => {
  const P = PC.prevision({ hoy: '2026-06-01', saldoHoy: 100, recurrentes: [rec('alq', 'gasto', 400, 5), rec('ing', 'ingreso', 350, 20)], meses: 3, gastoVariable: 0 });
  eq(P.meses[0].sobra, 50); eq(P.meses[1].sobra, 0); eq(P.meses[2].sobra, -50); eq(P.meses[2].falta, 50); eq(P.meses[1].falta, 0);
  assert.ok(P.meses[0].avisoAntesDeCobrar, 'el 5 baja a −300 antes de cobrar el 20');
  eq(P.meses[0].avisoAntesDeCobrar.importe, -300); assert.strictEqual(P.meses[0].avisoAntesDeCobrar.cobro, '2026-06-20');
  assert.strictEqual(P.meses[2].avisoAntesDeCobrar, null, 'si el mes acaba en negativo, el aviso es «te faltarán»');
});

test('Aviso antes de cobrar: cuotas el 30 y nómina el 28 no avisan; con poco saldo y gasto variable, sí', () => {
  const recs = [rec('nom', 'ingreso', 2000, 28, { tipoIngreso: 'nomina' })];
  const deudas = [deudaManual('c', 1500, 6, '2026-07-30', 30)];
  const P = PC.prevision({ hoy: '2026-07-01', saldoHoy: 200, recurrentes: recs, deudas, meses: 2, gastoVariable: 0 });
  assert.strictEqual(P.meses[0].avisoAntesDeCobrar, null); assert.strictEqual(P.meses[0].avisoDentroMes, null); eq(P.meses[0].minimo, 200);
  // Si la cuota cae el 5 (antes de la nómina) → aviso
  const P2 = PC.prevision({ hoy: '2026-07-01', saldoHoy: 200, recurrentes: recs, deudas: [deudaManual('c', 1500, 6, '2026-07-05', 5)], meses: 1, gastoVariable: 0 });
  const a = P2.meses[0].avisoAntesDeCobrar; assert.ok(a); eq(a.importe, -1300); assert.strictEqual(a.fecha, '2026-07-05'); assert.strictEqual(a.cobro, '2026-07-28');
  // Gasto variable repartido: 310 € en julio (10/día); con 200 € y la nómina el 28 → baja de 0 antes del 28
  const P3 = PC.prevision({ hoy: '2026-07-01', saldoHoy: 200, recurrentes: recs, meses: 1, gastoVariable: 310 });
  const b = P3.meses[0].avisoAntesDeCobrar; assert.ok(b); assert.strictEqual(b.fecha, '2026-07-28'); eq(b.importe, -70);
  eq(P3.meses[0].sobra, 1890);
});

test('Movimientos ya apuntados con fecha futura cuentan (salvo financiados o de cuentas que no son del día a día)', () => {
  const movs = [{ id: 'f1', tipo: 'gasto', fecha: '2026-08-20', importe: 120, descripcion: 'Seguro' },
    { id: 'f2', tipo: 'gasto', fecha: '2026-08-21', importe: 999, financiadoPor: 'd' },
    { id: 'f3', tipo: 'gasto', fecha: '2026-09-02', importe: 50, cuentaId: 'inv' },
    { id: 'f4', tipo: 'ingreso', fecha: '2026-09-03', importe: 10 }];
  const P = PC.prevision({ hoy: '2026-08-10', saldoHoy: 500, movimientos: movs, meses: 2, gastoVariable: 0, esLiquido: m => m.cuentaId !== 'inv' });
  eq(P.meses[0].fijos, 120); assert.ok(P.meses[0].items[0].concepto.includes('(apuntado)'));
  eq(P.meses[1].fijos, 0); eq(P.meses[1].ingresos, 10); eq(P.meses[1].sobra, 390);
});

test('Céntimos: muchas cuotas con decimales cuadran exactas', () => {
  const deudas = Array.from({ length: 30 }, (_, i) => deudaManual('d' + i, 0.1 + i * 0.01, 1, '2026-09-15', 15));
  const P = PC.prevision({ hoy: '2026-09-01', saldoHoy: 0.3, deudas, meses: 1, gastoVariable: 0 });
  const esperado = Math.round((0.3 - deudas.reduce((s, d) => s + Math.round(d.cuotaManual * 100), 0) / 100) * 100) / 100;
  assert.strictEqual(P.meses[0].sobra, esperado); assert.strictEqual(String(P.meses[0].cuotas), '7.35');
});

test('Datos sintéticos con la forma del caso real: noviembre 2026 a marzo 2027', () => {
  const D = FIX.datos(), hoy = '2026-11-01';
  const saldo = CC.saldoDisponibleEn(D, hoy); eq(saldo, 902.07, 'saldo de hoy');
  const P = PC.prevision({ hoy, saldoHoy: saldo, movimientos: D.movimientos, recurrentes: D.recurrentes, deudas: D.deudas, meses: 5 });
  eq(P.gastoVariable, 631.54, 'media de octubre'); eq(P.nominaEstimada.importe, 1928.84); assert.strictEqual(P.nominaEstimada.dia, 28);
  const [nov, dic, ene, feb, mar] = P.meses;
  eq(nov.saldoInicial, 902.07); eq(nov.ingresos, 1928.84); eq(nov.fijos, 0, 'los fijos del 1/11 ya están pagados'); eq(nov.cuotas, 1362.98);
  eq(nov.variable, 629.79, '631,54 − 1,75 ya gastado'); eq(nov.sobra, 838.14); assert.strictEqual(nov.avisoAntesDeCobrar, null);
  assert.ok(nov.items.find(i => i.concepto.startsWith('Adelanto') && i.fecha === '2026-11-30'));
  eq(dic.saldoInicial, 838.14); eq(dic.fijos, 495); eq(dic.cuotas, 933.56); eq(dic.sobra, 706.88);
  assert.ok(dic.avisoAntesDeCobrar); eq(dic.avisoAntesDeCobrar.importe, -206.91); assert.strictEqual(dic.avisoAntesDeCobrar.cobro, '2026-12-28');
  eq(ene.cuotas, 679.24); eq(ene.sobra, 829.94); eq(ene.avisoAntesDeCobrar.importe, -338.17);
  eq(feb.cuotas, 438.92); eq(feb.sobra, 1193.32); eq(feb.avisoAntesDeCobrar.importe, -274.05);
  eq(mar.cuotas, 337.29); eq(mar.sobra, 1658.33); assert.strictEqual(mar.avisoAntesDeCobrar, null); eq(mar.minimo, 148.27);
  // Sin gasto variable
  const P0 = PC.prevision({ hoy, saldoHoy: saldo, movimientos: D.movimientos, recurrentes: D.recurrentes, deudas: D.deudas, meses: 5, gastoVariable: 0 });
  eq(P0.meses[0].sobra, 1467.93); assert.ok(P0.meses.every(m => !m.avisoAntesDeCobrar && m.sobra > 0));
});

/* ---------------- v3.9: planificación (presupuestos, ingresos previstos, día especial de la nómina) ---------------- */
const FC = require('../js/finance-core.js');
const PL = require('../js/plan-core.js');
const nomRec = (extra = {}) => rec('nom', 'ingreso', 1900, 27, { tipoIngreso: 'nomina', categoria: 'Nómina', descripcion: 'Nómina', ...extra });
const nomMov = fecha => ({ id: `rec_nom_${fecha.slice(0, 7)}`, recurrenteId: 'nom', tipo: 'ingreso', tipoIngreso: 'nomina', categoria: 'Nómina', fecha, importe: 1900 });
const PAGAS = { id: 'pagas', tipo: 'ingreso', descripcion: 'Paga extra', categoria: 'Paga Extra', importe: 1900, repetir: 'anual', meses: [6, 12], conNomina: true, incluir: true };
const PROD = { id: 'prod', tipo: 'ingreso', descripcion: 'Productividad', categoria: 'Productividad', importe: 1500, repetir: 'anual', meses: [5], conNomina: true, estimado: true, incluir: true };
const COMB = { id: 'pcomb', tipo: 'presupuesto', categoria: 'Combustible', importe: 200, activo: true };
const prev39 = (o = {}) => PC.prevision({ hoy: '2026-11-28', saldoHoy: 1000, movimientos: [nomMov('2026-11-27')], recurrentes: [nomRec({ diasMes: { 12: 22 } })], meses: 13, gastoVariable: 0, porNomina: true, previstos: [PAGAS, PROD, COMB], ...o });

test('v3.9 Día especial: nómina de diciembre el 22 → el periodo de diciembre va del 22 dic al 26 ene (36 días)', () => {
  const P = prev39();
  assert.strictEqual(P.modo, 'nomina');
  const [nov, dic, ene] = P.meses;
  assert.strictEqual(nov.desde, '2026-11-27'); assert.strictEqual(nov.hasta, '2026-12-21');
  assert.strictEqual(dic.desde, '2026-12-22'); assert.strictEqual(dic.hasta, '2027-01-26'); assert.strictEqual(dic.dias, 36);
  assert.strictEqual(ene.desde, '2027-01-27');
  assert.ok(dic.items.some(i => i.nomina && i.fecha === '2026-12-22'), 'nómina el 22');
  // sin el día especial, el periodo de diciembre empieza el 27
  const P2 = prev39({ recurrentes: [nomRec()] });
  assert.strictEqual(P2.meses[1].desde, '2026-12-27');
  // generación de movimientos recurrentes con el día especial
  assert.strictEqual(FC.fechaRecurrenteEn(nomRec({ diasMes: { 12: 22 } }), '2026-12'), '2026-12-22');
  assert.strictEqual(FC.fechaRecurrenteEn(nomRec({ diasMes: { 12: 22 } }), '2027-01'), '2027-01-27');
  const gen = FC.periodosRecurrente(nomRec({ diasMes: { 12: 22 }, desde: '2026-12' }), '2026-12-23');
  assert.deepStrictEqual(gen.map(g => g.fecha), ['2026-12-22']);
  assert.deepStrictEqual(FC.periodosRecurrente(nomRec({ desde: '2026-12' }), '2026-12-23'), []);
});

test('v3.9 Pagas extra (junio y diciembre) con la nómina y productividad (mayo, estimada) entran en la Previsión', () => {
  const P = prev39(), by = d => P.meses.find(m => m.desde <= d && d <= m.hasta);
  const dic = by('2026-12-22'), jun = by('2027-06-27'), may = by('2027-05-27');
  const pagaDic = dic.items.find(i => i.id === 'pagas');
  assert.ok(pagaDic); assert.strictEqual(pagaDic.fecha, '2026-12-22'); eq(pagaDic.importe, 1900); assert.strictEqual(pagaDic.estimado, false);
  eq(dic.ingresos, 3800, 'nómina + paga');
  assert.ok(jun.items.some(i => i.id === 'pagas' && i.fecha === '2027-06-27'));
  const pr = may.items.find(i => i.id === 'prod');
  assert.ok(pr && pr.estimado && pr.fecha === '2027-05-27'); eq(may.ingresos, 3400);
  // en los demás periodos, solo la nómina
  eq(by('2027-02-27').ingresos, 1900);
  // Quitar la productividad (incluir = false): no suma, pero se ve como «no incluida»
  const P2 = prev39({ previstos: [PAGAS, { ...PROD, incluir: false }, COMB] }), may2 = P2.meses.find(m => m.desde <= '2027-05-27' && '2027-05-27' <= m.hasta);
  eq(may2.ingresos, 1900); assert.strictEqual(may2.excluidos.length, 1);
  eq(P.meses[12].sobra - P2.meses[12].sobra, 1500, 'el sobrante final baja exactamente la productividad');
  // Editar el importe previsto: la Previsión usa el nuevo
  const P3 = prev39({ previstos: [{ ...PAGAS, importe: 2000 }, PROD, COMB] });
  eq(P3.meses[1].ingresos, 3900);
});

test('v3.9 Ingreso real enlazado o de la misma categoría sustituye al previsto (sin contarlo dos veces)', () => {
  const base = prev39();
  // Paga de diciembre ya apuntada (fecha futura) con su categoría: cuenta la real (1.950), no la prevista
  const real = { id: 'p1', tipo: 'ingreso', tipoIngreso: 'extra', categoria: 'Paga Extra', fecha: '2026-12-22', importe: 1950 };
  const P = prev39({ movimientos: [nomMov('2026-11-27'), real] });
  const dic = P.meses[1];
  assert.ok(!dic.items.some(i => i.id === 'pagas'), 'el previsto no cuenta');
  assert.ok(dic.items.some(i => i.id === 'p1' && i.origen === 'apuntado'));
  eq(dic.ingresos, 3850); eq(P.meses[12].sobra - base.meses[12].sobra, 50);
  assert.deepStrictEqual(P.cumplidos.map(c => [c.id, c.mes, c.real, c.enlazado]), [['pagas', '2026-12', 1950, false]]);
  // Enlazado (otra categoría, con previstoId), cobrado antes de la nómina (5 dic, ya apuntado)
  const enl = { id: 'p2', tipo: 'ingreso', tipoIngreso: 'extra', categoria: 'Extra', fecha: '2026-12-05', importe: 1890, previstoId: 'pagas' };
  const P2 = prev39({ movimientos: [nomMov('2026-11-27'), enl] });
  assert.ok(!P2.meses[1].items.some(i => i.id === 'pagas')); assert.ok(P2.cumplidos.some(c => c.id === 'pagas' && c.enlazado));
  // enlazado y cobrado a final de noviembre: cumple la paga de diciembre (±31 días)
  const c = PL.cobrado(PAGAS, '2026-12', [{ ...enl, fecha: '2026-11-30' }], '2026-12-22');
  assert.ok(c && c.enlazado); eq(c.importe, 1890);
  // la de junio sigue prevista
  assert.ok(P2.meses.some(m => m.items.some(i => i.id === 'pagas' && i.fecha === '2027-06-27')));
  // Una nómina normal no cumple la paga aunque sea el mismo mes
  assert.strictEqual(PL.cobrado(PAGAS, '2026-12', [nomMov('2026-12-22')], '2026-12-22'), null);
  // Otra categoría sin enlace: no la cumple
  assert.strictEqual(PL.cobrado(PAGAS, '2026-12', [{ ...real, categoria: 'Extra' }], '2026-12-22'), null);
});

test('v3.9 Ingreso puntual previsto (una vez) y pendiente de cobrar en el periodo actual', () => {
  const una = { id: 'u1', tipo: 'ingreso', descripcion: 'Venta coche', categoria: 'Extra', importe: 3000, repetir: 'una', mes: '2027-03', conNomina: false, dia: 15, incluir: true };
  const P = prev39({ previstos: [una] });
  const its = P.meses.flatMap(m => m.items.filter(i => i.id === 'u1'));
  assert.deepStrictEqual(its.map(i => i.fecha), ['2027-03-15']);
  // Tocaba el 27 nov (con la nómina) y no se ha apuntado: se espera hoy, en el periodo actual
  const pend = { id: 'u2', tipo: 'ingreso', descripcion: 'Bonus', categoria: 'Extra', importe: 100, repetir: 'una', mes: '2026-11', conNomina: true, incluir: true };
  const P2 = prev39({ previstos: [pend] });
  const it = P2.meses[0].items.find(i => i.id === 'u2');
  assert.ok(it && it.fecha === '2026-11-28' && /pendiente/.test(it.concepto));
});

test('v3.9 Presupuesto de Combustible: gasto fijo por periodo, en el actual solo lo que queda, sin contarlo dos veces', () => {
  const movs = [nomMov('2026-11-27'),
    { id: 'c0', tipo: 'gasto', categoria: 'Combustible', naturaleza: 'fijo', fecha: '2026-10-20', importe: 116.49 },   // periodo anterior
    { id: 'c1', tipo: 'gasto', categoria: 'Combustible', naturaleza: 'fijo', fecha: '2026-11-27', importe: 50 },
    { id: 'c2', tipo: 'gasto', categoria: 'Combustible', naturaleza: 'variable', fecha: '2026-11-28', importe: 30 },
    { id: 'v1', tipo: 'gasto', categoria: 'Super', naturaleza: 'variable', fecha: '2026-11-28', importe: 40 }];
  // un recurrente de Combustible (fijo) que no debe sumarse aparte
  const recs = [nomRec({ diasMes: { 12: 22 } }), rec('gasoil', 'gasto', 120, 5, { categoria: 'Combustible' }), rec('gim', 'gasto', 45, 1, { categoria: 'Gimnasio' })];
  const P = prev39({ movimientos: movs, recurrentes: recs, gastoVariable: 300 });
  const [nov, dic] = P.meses;
  const e = nov.presupuestosDet[0];
  assert.strictEqual(e.categoria, 'Combustible'); eq(e.gastado, 80); eq(e.queda, 120); eq(nov.presupuestos, 120);
  eq(nov.variableYaGastado, 40, 'el combustible no gasta del variable'); eq(nov.variable, 260);
  eq(dic.presupuestos, 200); eq(dic.fijos, 45, 'solo el gimnasio; el recurrente de combustible lo cubre el presupuesto');
  assert.deepStrictEqual(P.recurrentesEnPresupuesto, ['gasoil']);
  assert.ok(!P.meses.some(m => m.items.some(i => i.id === 'gasoil')));
  eq(nov.sobra, 1000 - 45 - 120 - 260, 'sobrante del periodo actual (gimnasio del 1 dic incluido)');
  eq(dic.sobra, nov.sobra + 1900 + 1900 - 45 - 200 - 300);
  // Pasarse del presupuesto: queda 0 (lo gastado ya está en el saldo), excedido
  const P2 = prev39({ movimientos: [...movs, { id: 'c3', tipo: 'gasto', categoria: 'Combustible', naturaleza: 'fijo', fecha: '2026-11-28', importe: 150 }], recurrentes: recs });
  eq(P2.meses[0].presupuestosDet[0].excedido, 30); eq(P2.meses[0].presupuestos, 0);
  // Un repostaje ya apuntado en el futuro gasta del presupuesto de ese periodo (no se suma dos veces)
  const P3 = prev39({ movimientos: [...movs, { id: 'c4', tipo: 'gasto', categoria: 'Combustible', naturaleza: 'fijo', fecha: '2027-01-05', importe: 70 }], recurrentes: recs, gastoVariable: 300 });
  eq(P3.meses[1].presupuestos, 130); eq(P3.meses[1].fijos, 115); eq(P3.meses[1].sobra, dic.sobra);
  // Media del gasto variable sin las categorías con presupuesto
  const m = PC.gastoVariableMedio([{ tipo: 'gasto', naturaleza: 'variable', categoria: 'Combustible', fecha: '2026-10-03', importe: 90 }, { tipo: 'gasto', naturaleza: 'variable', categoria: 'Super', fecha: '2026-10-04', importe: 10 }], '2026-11-28', 3, new Set(['Combustible']));
  eq(m.importe, 10);
});

test('v3.9 Presupuesto por mes natural (vista por meses) y estado en el Resumen', () => {
  const P = prev39({ porNomina: false });
  assert.strictEqual(P.modo, 'mes'); eq(P.meses[0].presupuestos, 200); eq(P.meses[1].presupuestos, 200);
  const est = PL.estado(COMB, [{ tipo: 'gasto', categoria: 'Combustible', fecha: '2026-11-05', importe: 116.49 }, { tipo: 'gasto', categoria: 'Combustible', fecha: '2026-11-20', importe: 120, financiadoPor: 'x' }], '2026-11-01', '2026-11-30');
  eq(est.gastado, 116.49); eq(est.queda, 83.51); eq(est.excedido, 0);
  const est2 = PL.estado(COMB, [{ tipo: 'gasto', categoria: 'Combustible', fecha: '2026-11-05', importe: 230 }], '2026-11-01', '2026-11-30');
  eq(est2.queda, 0); eq(est2.excedido, 30);
  assert.strictEqual(PL.textoCuando(PAGAS), 'cada año en junio y diciembre');
  assert.deepStrictEqual(PL.ocurrencias(PROD, '2026-11', '2028-06'), ['2027-05', '2028-05']);
  // dos presupuestos de la misma categoría: vale el último editado; los borrados o inactivos no cuentan
  assert.strictEqual(PL.presupuestos([{ ...COMB, id: 'a', importe: 150, updatedAt: 1 }, { ...COMB, id: 'b', updatedAt: 2 }, { ...COMB, id: 'c', deleted: true }]).map(p => p.id).join(), 'b');
});

let ok = 0, ko = 0;
for (const [name, fn] of tests) {
  try { fn(); ok++; console.log('PASS', name); }
  catch (e) { ko++; console.log('FAIL', name, '\n  ', e.message); }
}
console.log(`\n${ok} correctos, ${ko} fallidos`);
if (ko) process.exit(1);
