// Tests unitarios v3.4: cuentas y saldos, traspasos entre cuentas, inversiones desde una cuenta,
// traspasos entre fondos (herencia de lotes FIFO) y compatibilidad de sincronización.
// Ejecutar:  node tests/cuentas.test.js
'use strict';
const assert = require('assert');
const path = require('path');
const fs = require('fs');
const FC = require('../js/finance-core.js');
const CC = require('../js/cuentas-core.js');
const Core = require('../js/sync-core.js');
const tests = [];
const test = (name, fn) => tests.push([name, fn]);
const near = (a, b, eps, msg) => assert.ok(Math.abs(a - b) <= eps, `${msg || ''} esperado ${b}, obtenido ${a}`);

const cuentas = [
  { id: 'nom', nombre: 'Nómina BBVA', tipo: 'corriente', saldoInicial: 1000, fechaSaldo: '2026-01-01', activa: true },
  { id: 'inv', nombre: 'MyInvestor', tipo: 'inversion', saldoInicial: 0, fechaSaldo: '2026-01-01', activa: true },
  { id: 'efe', nombre: 'Efectivo', tipo: 'efectivo', saldoInicial: 50, fechaSaldo: '2026-02-01', activa: true }
];
const movimientos = [
  { id: 'm1', tipo: 'ingreso', fecha: '2026-01-28', importe: 2000, categoria: 'Nómina', cuentaId: 'nom', cuenta: 'Nómina BBVA' },
  { id: 'm2', tipo: 'gasto', fecha: '2026-01-05', importe: 300, categoria: 'Hogar', cuenta: 'nomina bbva' },             // sin id: por nombre (sin acentos ni mayúsculas)
  { id: 'm3', tipo: 'gasto', fecha: '2026-01-20', importe: 120, categoria: 'Deudas', cuentaId: 'nom', deudaId: 'd1', cuotaN: 1 }, // cuota de deuda
  { id: 'm4', tipo: 'gasto', fecha: '2026-01-21', importe: 60, categoria: 'Combustible', cuentaId: 'nom', repostajeId: 'r1' },    // repostaje
  { id: 'm5', tipo: 'gasto', fecha: '2026-01-22', importe: 900, categoria: 'Tecnología', cuentaId: 'nom', financiadoPor: 'd1' },  // compra financiada: no mueve dinero
  { id: 'm6', tipo: 'gasto', fecha: '2026-01-15', importe: 20, categoria: 'Ocio', cuenta: 'Efectivo' },                         // anterior a la fecha del saldo de Efectivo
  { id: 'm7', tipo: 'gasto', fecha: '2026-02-03', importe: 15, categoria: 'Ocio', cuenta: 'Efectivo' },
  { id: 'm8', tipo: 'gasto', fecha: '2026-02-04', importe: 10, categoria: 'Ocio', cuenta: 'Tarjeta vieja' }                      // nombre sin cuenta
];
const traspasos = [{ id: 't1', fecha: '2026-01-29', origenId: 'nom', destinoId: 'inv', importe: 1500, comision: 2 }];
// La comisión del traspaso es un gasto real (movimiento aparte, vinculado al traspaso por su id)
const movsConComision = [...movimientos, { id: 'com_t1', tipo: 'gasto', fecha: '2026-01-29', importe: 2, categoria: 'Comisiones', cuentaId: 'nom' }];
const operaciones = [
  { id: 'o1', activoId: 'f1', tipo: 'compra', fecha: '2026-02-02', participaciones: 10, precio: 100, comisiones: 1, cuentaId: 'inv' },
  { id: 'o2', activoId: 'f1', tipo: 'venta', fecha: '2026-03-02', participaciones: 4, precio: 110, comisiones: 1, cuentaId: 'inv' },
  { id: 'o3', activoId: 'f1', tipo: 'compra', fecha: '2025-06-01', participaciones: 5, precio: 90, comisiones: 0 }   // antigua, sin cuenta: no toca saldos
];
const datos = { cuentas, movimientos: movsConComision, traspasos, regularizaciones: [], operaciones, activos: [{ id: 'f1', nombre: 'Fondo A' }] };

test('Saldo = inicial + ingresos − gastos (cuotas y repostajes incluidos) ± traspasos', () => {
  const s = CC.saldos(datos, '2026-12-31'), nom = s.lista.find(x => x.cuenta.id === 'nom');
  // 1000 + 2000 − 300 − 120 − 60 − 1500 − 2 (comisión) = 1018 ; la compra financiada no cuenta
  assert.strictEqual(nom.saldo, 1018);
  assert.strictEqual(nom.ingresos, 2000); assert.strictEqual(nom.gastos, 482); assert.strictEqual(nom.traspasosSalida, 1500);
});
test('Compras de inversión restan de la cuenta y las ventas suman (netas de comisiones)', () => {
  const s = CC.saldos(datos, '2026-12-31'), inv = s.lista.find(x => x.cuenta.id === 'inv');
  // 0 + 1500 (traspaso) − (10×100+1) + (4×110−1) = 938
  assert.strictEqual(inv.saldo, 938);
  assert.strictEqual(inv.compras, 1001); assert.strictEqual(inv.ventas, 439);
});
test('Lo anterior a la fecha del saldo inicial no cuenta; los nombres escritos a mano se enlazan', () => {
  const s = CC.saldos(datos, '2026-12-31'), efe = s.lista.find(x => x.cuenta.id === 'efe');
  assert.strictEqual(efe.saldo, 35); // 50 − 15 (el gasto del 15/01 es anterior)
  assert.deepStrictEqual(CC.nombresSinCuenta(cuentas, movimientos).map(x => x.nombre), ['Tarjeta vieja']);
  assert.strictEqual(s.total, round(1018 + 938 + 35));
});
function round(n) { return Math.round(n * 100) / 100; }
test('Saldo a hoy frente a apuntes futuros', () => {
  const s = CC.saldos(datos, '2026-02-15'), inv = s.lista.find(x => x.cuenta.id === 'inv');
  assert.strictEqual(inv.saldo, 499); assert.strictEqual(inv.saldoFinal, 938); assert.strictEqual(inv.futuros, 1);
});
test('Los traspasos entre cuentas no son ingresos ni gastos: no cambian el resumen ni el patrimonio', () => {
  const sin = CC.saldos({ ...datos, traspasos: [], movimientos: movimientos }, '2026-12-31');
  const con = CC.saldos({ ...datos, traspasos: [{ ...traspasos[0], comision: 0 }], movimientos: movimientos }, '2026-12-31');
  assert.strictEqual(con.total, sin.total, 'el total en cuentas no cambia con un traspaso');
  const tp = CC.traspasosPeriodo(traspasos, '2026-01');
  assert.deepStrictEqual(tp, { n: 1, importe: 1500 });
  const fl = CC.flujos(datos).filter(f => f.col === 'traspasos');
  assert.ok(fl.every(f => f.tipo.startsWith('traspaso')) && fl.reduce((s, f) => s + f.importe, 0) === 0, 'los dos lados se compensan');
});
test('Historial y serie mensual de una cuenta', () => {
  const fl = CC.flujos(datos), h = CC.historial(cuentas[0], fl);
  assert.strictEqual(h[h.length - 1].saldo, 1018);
  assert.strictEqual(h[0].ref, 'm2');
  const serie = CC.serieMensual(cuentas[1], fl, '2026-01', '2026-03');
  assert.deepStrictEqual(serie.map(x => x.saldo), [1500, 499, 938]);
});
test('Ajustar saldo: la diferencia cuadra la cuenta y no es ingreso ni gasto', () => {
  const fl = CC.flujos(datos), dif = CC.diferenciaAjuste(cuentas[0], fl, '2026-01-31', 1010.5);
  assert.strictEqual(dif, -7.5);
  const d2 = { ...datos, regularizaciones: [{ id: 'a1', cuentaId: 'nom', fecha: '2026-01-31', importe: dif, saldoReal: 1010.5 }] };
  const s = CC.saldos(d2, '2026-12-31'), nom = s.lista.find(x => x.cuenta.id === 'nom');
  assert.strictEqual(nom.saldo, 1010.5); assert.strictEqual(nom.gastos, 482); assert.strictEqual(nom.ajustes, -7.5);
});
test('Dinero invertido del periodo = compras con comisiones − ventas netas', () => {
  assert.deepStrictEqual(CC.invertidoPeriodo(operaciones, '2026-02'), { compras: 1001, ventas: 0, neto: 1001, n: 1 });
  assert.deepStrictEqual(CC.invertidoPeriodo(operaciones, '2026'), { compras: 1001, ventas: 439, neto: 562, n: 2 });
});
test('Usos de una cuenta (para no borrar una cuenta con datos)', () => {
  const u = CC.usos(cuentas[1], { ...datos });
  assert.strictEqual(u.operaciones, 2); assert.strictEqual(u.traspasos, 1); assert.strictEqual(u.movimientos, 0);
  assert.strictEqual(CC.usos(cuentas[0], datos).movimientos, 6);
});

/* ---------------- Traspasos entre fondos ---------------- */
const opsF = [
  { id: 'c1', activoId: 'A', tipo: 'compra', fecha: '2020-01-10', participaciones: 10, precio: 10, comisiones: 0 },   // coste 100
  { id: 'c2', activoId: 'A', tipo: 'compra', fecha: '2021-01-10', participaciones: 10, precio: 20, comisiones: 0 },   // coste 200
  { id: 'c3', activoId: 'B', tipo: 'compra', fecha: '2020-06-01', participaciones: 5, precio: 30, comisiones: 0 }     // coste 150, entre los dos lotes de A
];
test('Traspaso parcial: el destino hereda coste y fechas originales (FIFO), sin ganancia', () => {
  // Se traspasan 15 part. de A (10 del lote 2020 + 5 del lote 2021) y se reciben 30 de B
  const tf = { id: 'tf1', fecha: '2024-05-01', origenId: 'A', destinoId: 'B', participaciones: 15, participacionesDestino: 30, vlOrigen: 30, vlDestino: 15 };
  const r = FC.carteraFIFO(opsF, [tf]), A = r.porActivo.A, B = r.porActivo.B;
  assert.strictEqual(A.participaciones, 5); assert.strictEqual(A.costeRestante, 100); // quedan 5 del lote de 2021 (20 €/part.)
  assert.strictEqual(A.gananciaRealizada, 0); assert.strictEqual(A.ventas.length, 0);
  assert.strictEqual(B.participaciones, 35); assert.strictEqual(B.costeRestante, 150 + 100 + 100);
  assert.deepStrictEqual(B.lotes.map(l => [l.fecha, l.participaciones, l.coste]), [['2020-01-10', 20, 100], ['2020-06-01', 5, 150], ['2021-01-10', 10, 100]]);
  assert.ok(B.lotes[0].origen && B.lotes[0].origen.activoId === 'A' && B.lotes[0].origen.traspasoId === 'tf1');
  assert.ok(!B.lotes[1].origen, 'el lote propio de B no viene de traspaso');
  assert.strictEqual(A.aportadoNeto + B.aportadoNeto, 450, 'el aportado total de la cartera no cambia');
  assert.strictEqual(B.traspasosEntrada[0].coste, 200); assert.strictEqual(A.traspasosSalida[0].participaciones, 15);
});
test('Venta posterior en el destino: FIFO con el coste y la fecha originales', () => {
  const tf = { id: 'tf1', fecha: '2024-05-01', origenId: 'A', destinoId: 'B', participaciones: 15, participacionesDestino: 30 };
  const venta = { id: 'v1', activoId: 'B', tipo: 'venta', fecha: '2025-01-01', participaciones: 22, precio: 16, comisiones: 2 };
  const r = FC.carteraFIFO([...opsF, venta], [tf]), B = r.porActivo.B, v = B.ventas[0];
  // Consume 20 part. heredadas de 2020-01-10 (coste 100) y 2 del lote propio de 2020-06-01 (2 × 30 = 60)
  assert.deepStrictEqual(v.consumos.map(c => [c.fecha, c.participaciones, c.coste]), [['2020-01-10', 20, 100], ['2020-06-01', 2, 60]]);
  assert.strictEqual(v.ganancia, round(22 * 16 - 2 - 160));
  assert.strictEqual(v.consumos[0].origen.activoId, 'A');
  assert.strictEqual(B.realizadaPorAnio['2025'], 190);
});
test('Traspaso de «todas» las participaciones y traspaso en cadena', () => {
  const t1 = { id: 'x1', fecha: '2024-01-01', origenId: 'A', destinoId: 'B', todas: true, participaciones: 999, participacionesDestino: 40 };
  const t2 = { id: 'x2', fecha: '2024-06-01', origenId: 'B', destinoId: 'C', todas: true, participacionesDestino: 9 };
  const r = FC.carteraFIFO(opsF, [t1, t2]);
  assert.strictEqual(r.porActivo.A.participaciones, 0);
  assert.strictEqual(r.porActivo.B.participaciones, 0);
  assert.strictEqual(r.porActivo.C.participaciones, 9); assert.strictEqual(r.porActivo.C.costeRestante, 450);
  assert.deepStrictEqual(r.porActivo.C.lotes.map(l => l.fecha), ['2020-01-10', '2020-06-01', '2021-01-10']);
  assert.ok(!r.erroresTraspaso.length);
});
test('Errores: traspasar más de lo que hay; borrar un traspaso del que dependen ventas', () => {
  const tf = { id: 'tf1', fecha: '2024-05-01', origenId: 'A', destinoId: 'B', participaciones: 25, participacionesDestino: 50 };
  assert.ok(FC.carteraFIFO(opsF, [tf]).erroresTraspaso.length === 1);
  const ok = { ...tf, participaciones: 20, participacionesDestino: 40 };
  const venta = { id: 'v1', activoId: 'B', tipo: 'venta', fecha: '2025-01-01', participaciones: 30, precio: 16, comisiones: 0 };
  const antes = FC.carteraFIFO([...opsF, venta], [ok]);
  assert.strictEqual(FC.erroresNuevos(antes, antes).length, 0);
  const sinTraspaso = FC.carteraFIFO([...opsF, venta], []);
  assert.strictEqual(FC.erroresNuevos(antes, sinTraspaso).length, 1, 'sin el traspaso la venta de B se queda sin participaciones');
});
test('Mismo día: compra, luego traspaso, luego venta; fifo() de un activo no cambia', () => {
  const ops = [{ id: 'c', activoId: 'A', tipo: 'compra', fecha: '2024-01-01', participaciones: 2, precio: 10 }, { id: 'v', activoId: 'B', tipo: 'venta', fecha: '2024-01-01', participaciones: 4, precio: 6 }];
  const r = FC.carteraFIFO(ops, [{ id: 't', fecha: '2024-01-01', origenId: 'A', destinoId: 'B', todas: true, participacionesDestino: 4 }]);
  assert.strictEqual(r.porActivo.B.ventas[0].ganancia, 4); assert.ok(!r.porActivo.B.errores.length);
  const solo = FC.fifo(opsF.filter(o => o.activoId === 'A'));
  assert.strictEqual(solo.participaciones, 20); assert.strictEqual(solo.costeRestante, 300); assert.ok(!('traspasosEntrada' in solo));
});
test('Cuadre de un traspaso (VL × participaciones) y participaciones disponibles a una fecha', () => {
  assert.ok(FC.cuadreTraspasoFondos({ participaciones: 15, vlOrigen: 30, participacionesDestino: 30, vlDestino: 15 }).cuadra);
  assert.ok(!FC.cuadreTraspasoFondos({ participaciones: 15, vlOrigen: 30, participacionesDestino: 20, vlDestino: 15 }).cuadra);
  const tf = { id: 'tf1', fecha: '2024-05-01', origenId: 'A', destinoId: 'B', participaciones: 15, participacionesDestino: 30 };
  assert.strictEqual(FC.disponibleActivo('B', opsF, [tf], '2024-04-30'), 5);
  assert.strictEqual(FC.disponibleActivo('B', opsF, [tf], '2024-05-01'), 35);
  assert.strictEqual(FC.disponibleActivo('B', opsF, [tf], '2024-05-01', 'tf1'), 5);
  const m = FC.metricasCartera([{ id: 'B' }], opsF, [], [{ ...tf, vlDestino: 15 }])[0];
  assert.strictEqual(m.precio, 15, 'sin precios apuntados se usa el VL del traspaso si es lo más reciente');
});

/* ---------------- Recurrentes y sincronización ---------------- */
test('Los periodos de un recurrente conservan id determinista; generarRecurrentes ya no crea movimientos', () => {
  const rec = { id: 'r', tipo: 'gasto', importe: 10, categoria: 'X', cuenta: 'Nómina BBVA', cuentaId: 'nom', dia: 1, desde: '2026-01', activo: true };
  const p = FC.periodosRecurrente(rec, '2026-02-10');
  assert.ok(p.length === 2 && p.every(x => x.id.startsWith('rec_r_')));
  assert.strictEqual(FC.generarRecurrentes([rec], [], '2026-02-10').length, 0);
});
test('Sincronización: empate de versión → gana la copia con todos los campos (no la recortada por una app antigua)', () => {
  const full = { id: 'm1', tipo: 'gasto', importe: 5, cuenta: 'X', cuentaId: 'c1', updatedAt: 7 };
  const { cuentaId, ...recortada } = full;
  assert.strictEqual(Core.pickWinner(full, recortada), full); assert.strictEqual(Core.pickWinner(recortada, full), full);
  assert.ok(Core.COLLECTIONS.includes('cuentas') && Core.COLLECTIONS.includes('traspasosFondos'));
});
test('Una versión antigua (v3.3) no destruye las colecciones nuevas: el siguiente dispositivo v3.4 las restaura', () => {
  const vieja = path.join(__dirname, '..', '..', 'finanzas-app-backup-3.3.0', 'js', 'sync-core.js');
  if (!fs.existsSync(vieja)) return console.log('   (sin copia de la v3.3: se omite)');
  const Old = require(vieja);
  const nuevo = { version: 3, movimientos: [{ id: 'm1', importe: 1, cuenta: 'X', cuentaId: 'c1', updatedAt: 5 }], cuentas: [{ id: 'c1', nombre: 'X', updatedAt: 5 }], traspasos: [], regularizaciones: [], traspasosFondos: [{ id: 'f', updatedAt: 6 }], categorias: null };
  // El dispositivo antiguo sube su versión (sin las colecciones nuevas y con el movimiento recortado)
  const deViejo = Old.toRemote(Old.mergeDocs({ movimientos: [{ id: 'm1', importe: 1, cuenta: 'X', updatedAt: 5 }] }, nuevo, 10));
  assert.ok(!('cuentas' in deViejo));
  const fusion = Core.mergeDocs(nuevo, deViejo, 10);
  assert.strictEqual(fusion.cuentas.length, 1); assert.strictEqual(fusion.traspasosFondos.length, 1);
  assert.strictEqual(fusion.movimientos[0].cuentaId, 'c1');
});

test('Copia para análisis: cuentas con saldo, traspasos fuera de gasto/ingreso y traspaso entre fondos con coste heredado', () => {
  const AC = require('../js/analysis-export.js');
  const e = {
    cuentas: [{ id: 'b', nombre: 'Banco', tipo: 'corriente', saldoInicial: 1000, fechaSaldo: '2026-01-01', activa: true }, { id: 'i', nombre: 'Bróker', tipo: 'inversion', saldoInicial: 0, fechaSaldo: '2026-01-01', activa: true }],
    movimientos: [{ id: 'n', tipo: 'ingreso', fecha: '2026-09-01', importe: 2000, categoria: 'Nómina', cuenta: 'Banco' },
      { id: 'g', tipo: 'gasto', fecha: '2026-09-03', importe: 100, categoria: 'Super', cuentaId: 'b', cuenta: 'Banco' },
      { id: 'com_t1', tipo: 'gasto', fecha: '2026-09-05', importe: 2, categoria: 'Comisiones', cuentaId: 'b', cuenta: 'Banco', traspasoId: 't1' }],
    traspasos: [{ id: 't1', fecha: '2026-09-05', origenId: 'b', destinoId: 'i', importe: 500, comision: 2, comisionMovId: 'com_t1' }],
    regularizaciones: [],
    activos: [{ id: 'f1', nombre: 'Fondo A', tipo: 'fondo' }, { id: 'f2', nombre: 'Fondo B', tipo: 'fondo' }],
    operaciones: [{ id: 'o1', activoId: 'f1', tipo: 'compra', fecha: '2026-09-10', participaciones: 10, precio: 40, comisiones: 0, cuentaId: 'i' }],
    precios: [], traspasosFondos: [{ id: 'tf', fecha: '2026-10-01', origenId: 'f1', destinoId: 'f2', todas: true, participaciones: null, participacionesDestino: 2, vlOrigen: 42, vlDestino: 210 }]
  };
  const { json, csv } = AC.construir(e, { hoy: '2026-10-30', ahora: '2026-10-30T10:00:00Z' });
  const banco = json.cuentas.find(c => c.id === 'b'), bro = json.cuentas.find(c => c.id === 'i');
  assert.strictEqual(banco.saldoHoy, 1000 + 2000 - 100 - 2 - 500); assert.strictEqual(bro.saldoHoy, 100);
  const sep = json.resumenMensual.find(r => r.mes === '2026-09');
  assert.strictEqual(sep.gastos, 102); assert.strictEqual(sep.ingresos, 2000); assert.strictEqual(sep.dineroInvertidoNeto, 400); assert.strictEqual(sep.importeTraspasado, 500);
  assert.strictEqual(json.movimientos.find(m => m.id === 'n').cuentaId, 'b', 'texto antiguo resuelto por nombre');
  const f2 = json.inversiones.activos.find(a => a.id === 'f2');
  assert.strictEqual(f2.participaciones, 2); assert.strictEqual(f2.costeRestante, 400); assert.strictEqual(f2.lotesVivos[0].procedenteDe, 'f1'); assert.strictEqual(f2.lotesVivos[0].fecha, '2026-09-10');
  assert.strictEqual(json.inversiones.activos.find(a => a.id === 'f1').gananciaRealizada, 0);
  assert.strictEqual(json.inversiones.traspasosEntreFondos[0].costeTraspasado, 400);
  assert.strictEqual(json.totales.dineroEnCuentas, 2498);
  assert.ok(csv.split('\r\n')[0].includes(',cuenta,cuenta_id,traspaso_id,'));
  // Estado antiguo (sin colecciones v3.4) sigue funcionando
  const viejo = AC.construir({ movimientos: e.movimientos.slice(0, 2), activos: [], operaciones: [], precios: [] }, { hoy: '2026-10-30' }).json;
  assert.strictEqual(viejo.cuentas.length, 0); assert.strictEqual(viejo.totales.dineroEnCuentas, 0);
});

(async () => {
  let pass = 0, fail = 0;
  for (const [name, fn] of tests) {
    try { await fn(); pass++; console.log('PASS ' + name); }
    catch (e) { fail++; console.log('FAIL ' + name + '\n   ' + e.message); }
  }
  console.log(`\n${pass} correctos, ${fail} fallidos`);
  process.exit(fail ? 1 : 0);
})();
