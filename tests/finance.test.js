// Tests unitarios (Node, sin dependencias): cálculos financieros, recurrentes, garantías, OCR,
// CSV, migración, fusión de las colecciones nuevas, Gemini (simulado) y copia para análisis.
// Ejecutar:  node tests/finance.test.js
'use strict';
const assert = require('assert');
const FC = require('../js/finance-core.js');
const Core = require('../js/sync-core.js');
const { createDriveClient } = require('../js/storage.js');
let pass = 0, fail = 0;
const tests = [];
const test = (name, fn) => tests.push([name, fn]);
const near = (a, b, eps, msg) => assert.ok(Math.abs(a - b) <= eps, `${msg || ''} esperado ${b}, obtenido ${a}`);

/* ---------------- Préstamos: cuadro francés y TAE ---------------- */
test('Cuota francesa: 10.000 € al 5 % TIN en 12 meses = 856,07 €', () => {
  const c = FC.cuadroAmortizacion({ principal: 10000, tin: 5, plazo: 12, fechaPrimeraCuota: '2026-01-31' });
  assert.strictEqual(c.cuota, 856.07);
  assert.strictEqual(c.filas.length, 12);
  assert.strictEqual(c.filas[0].interes, 41.67);
  assert.strictEqual(c.filas[11].pendiente, 0);
  near(c.filas.reduce((s, f) => s + f.amortizacion, 0), 10000, 0.001, 'suma de amortizaciones');
  assert.strictEqual(c.filas[1].fecha, '2026-02-28', 'fin de mes ajustado');
  assert.strictEqual(c.filas[2].fecha, '2026-03-31');
});
test('TAE sin comisiones = (1 + TIN/12)^12 − 1', () => {
  const d = { principal: 10000, tin: 5, plazo: 12, fechaPrimeraCuota: '2026-01-01' };
  const r = FC.resumenDeuda(d);
  near(r.tae, Math.pow(1 + 0.05 / 12, 12) - 1, 0.0002, 'TAE');
});
test('TIN 0 % sin comisiones: cuota = principal / plazo y TAE 0', () => {
  const r = FC.resumenDeuda({ principal: 1200, tin: 0, plazo: 12, fechaPrimeraCuota: '2026-01-15' });
  assert.strictEqual(r.cuota, 100); assert.strictEqual(r.totalIntereses, 0);
  near(r.tae, 0, 1e-9);
});
test('TIN 0 % con comisión de apertura: la TAE ya no es 0 («0 % TIN» no es gratis)', () => {
  const r = FC.resumenDeuda({ principal: 1200, tin: 0, plazo: 12, fechaPrimeraCuota: '2026-01-15', comisionApertura: 36 });
  assert.ok(r.tae > 0.05 && r.tae < 0.07, 'TAE ' + r.tae);
  assert.strictEqual(r.totalCoste, 36);
});
test('Comisión mensual: suma al pago y a la TAE', () => {
  const sin = FC.resumenDeuda({ principal: 3000, tin: 6, plazo: 24, fechaPrimeraCuota: '2026-01-01' });
  const con = FC.resumenDeuda({ principal: 3000, tin: 6, plazo: 24, fechaPrimeraCuota: '2026-01-01', comisionMensual: 2 });
  assert.strictEqual(con.filas[0].pago, round2(con.filas[0].cuota + 2));
  assert.ok(con.tae > sin.tae);
});
test('Estado de la deuda según cuotas pagadas y vencidas', () => {
  const d = { principal: 1200, tin: 0, plazo: 12, fechaPrimeraCuota: '2026-01-10' };
  const r = FC.resumenDeuda(d, [1, 2, 3], '2026-05-15');
  assert.strictEqual(r.pagadas, 3); assert.strictEqual(r.restantes, 9);
  assert.strictEqual(r.pendiente, 900);
  assert.deepStrictEqual(r.vencidas.map(f => f.n), [4, 5]);
  assert.strictEqual(r.terminada, false);
  assert.ok(FC.resumenDeuda(d, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]).terminada);
});
test('Datos no válidos en el cuadro lanzan error', () => {
  assert.throws(() => FC.cuadroAmortizacion({ principal: 0, tin: 5, plazo: 12 }));
  assert.throws(() => FC.cuadroAmortizacion({ principal: 100, tin: -1, plazo: 12 }));
});
function round2(n) { return Math.round(n * 100) / 100; }

/* ---------------- Inversiones: FIFO ---------------- */
const ops = [
  { id: 'c1', tipo: 'compra', fecha: '2024-01-10', participaciones: 10, precio: 100, comisiones: 5 },
  { id: 'c2', tipo: 'compra', fecha: '2024-06-10', participaciones: 10, precio: 120, comisiones: 5 },
  { id: 'v1', tipo: 'venta', fecha: '2025-03-01', participaciones: 15, precio: 130, comisiones: 4 }
];
test('FIFO: la venta consume primero el lote más antiguo (con comisiones en el coste)', () => {
  const f = FC.fifo(ops);
  assert.strictEqual(f.ventas.length, 1);
  const v = f.ventas[0];
  assert.strictEqual(v.coste, 1005 + 602.5);                 // lote 1 entero + mitad del lote 2
  assert.strictEqual(v.importeNeto, 1946);                   // 15×130 − 4
  assert.strictEqual(v.ganancia, round2(1946 - 1607.5));
  assert.deepStrictEqual(v.consumos.map(c => [c.compraId, c.participaciones]), [['c1', 10], ['c2', 5]]);
  assert.strictEqual(f.participaciones, 5); assert.strictEqual(f.costeRestante, 602.5);
  assert.deepStrictEqual(f.realizadaPorAnio, { 2025: 338.5 });
});
test('FIFO: métricas con precio manual (no realizada) y sin precio (usa última operación)', () => {
  const m = FC.metricasActivo(ops, [{ fecha: '2025-10-01', precio: 140 }, { fecha: '2025-09-01', precio: 110 }]);
  assert.strictEqual(m.precio, 140); assert.strictEqual(m.valor, 700); assert.strictEqual(m.noRealizada, 97.5);
  const m2 = FC.metricasActivo(ops, []);
  assert.strictEqual(m2.precio, 130); assert.ok(m2.precioDeOperacion);
});
test('FIFO: vender más de lo que hay se marca como error', () => {
  const f = FC.fifo([{ id: 'c', tipo: 'compra', fecha: '2024-01-01', participaciones: 1, precio: 10 }, { id: 'v', tipo: 'venta', fecha: '2024-02-01', participaciones: 2, precio: 10 }]);
  assert.strictEqual(f.errores.length, 1); assert.ok(f.ventas[0].incompleta);
  assert.strictEqual(FC.disponibleEn(ops, '2024-12-31'), 20);
  assert.strictEqual(FC.disponibleEn(ops, '2025-12-31'), 5);
});
test('FIFO: misma fecha -> compras antes que ventas', () => {
  const f = FC.fifo([{ id: 'v', tipo: 'venta', fecha: '2024-01-01', participaciones: 1, precio: 12 }, { id: 'c', tipo: 'compra', fecha: '2024-01-01', participaciones: 1, precio: 10 }]);
  assert.strictEqual(f.errores.length, 0); assert.strictEqual(f.gananciaRealizada, 2);
});

/* ---------------- Día de cobro de las cuotas ---------------- */
test('Día de cobro: normalización y migración (sin dato = día de la 1.ª cuota)', () => {
  assert.strictEqual(FC.normalizarDiaCobro('ultimo'), 'ultimo');
  assert.strictEqual(FC.normalizarDiaCobro(5), 5);
  assert.strictEqual(FC.normalizarDiaCobro('15'), 15);
  assert.strictEqual(FC.normalizarDiaCobro(undefined, '2026-03-17'), 17);
  assert.strictEqual(FC.normalizarDiaCobro(0, '2026-03-17'), 17, 'día inválido -> día de la fecha');
  assert.strictEqual(FC.normalizarDiaCobro(32, '2026-03-17'), 17);
  assert.strictEqual(FC.normalizarDiaCobro(null, null), 1);
  // Una deuda antigua (sin diaCobro) migrada conserva exactamente las mismas fechas e importes.
  for (const f1 of ['2026-01-31', '2026-01-15', '2025-12-30', '2026-02-28']) {
    const vieja = { principal: 5000, tin: 7.5, plazo: 30, fechaPrimeraCuota: f1 };
    const migrada = { ...vieja, diaCobro: FC.normalizarDiaCobro(undefined, f1) };
    assert.deepStrictEqual(FC.cuadroAmortizacion(migrada), FC.cuadroAmortizacion(vieja), 'migración ' + f1);
  }
});
test('Día de cobro: día 31 se ajusta a meses cortos y años bisiestos', () => {
  const c = FC.cuadroAmortizacion({ principal: 1200, tin: 0, plazo: 14, fechaPrimeraCuota: '2027-12-31', diaCobro: 31 });
  assert.deepStrictEqual(c.filas.slice(0, 5).map(f => f.fecha), ['2027-12-31', '2028-01-31', '2028-02-29', '2028-03-31', '2028-04-30']);
  assert.strictEqual(c.filas[13].fecha, '2029-01-31');
  assert.strictEqual(FC.fechaCuota('2026-01-30', 2, 30), '2026-02-28', '30 en febrero no bisiesto');
  assert.strictEqual(FC.fechaCuota('2026-01-30', 3, 30), '2026-03-30', 'vuelve al 30 en marzo (no se arrastra el 28)');
  assert.strictEqual(FC.fechaCuota('2024-01-29', 2, 29), '2024-02-29');
  assert.strictEqual(FC.fechaCuota('2100-01-29', 2, 29), '2100-02-28', '2100 no es bisiesto');
  assert.strictEqual(FC.fechaCuota('2000-01-29', 2, 29), '2000-02-29', '2000 sí es bisiesto');
});
test('Día de cobro: «último día del mes» y principio de mes', () => {
  const ult = FC.cuadroAmortizacion({ principal: 600, tin: 5, plazo: 6, fechaPrimeraCuota: '2028-01-10', diaCobro: 'ultimo' });
  assert.deepStrictEqual(ult.filas.map(f => f.fecha), ['2028-01-31', '2028-02-29', '2028-03-31', '2028-04-30', '2028-05-31', '2028-06-30']);
  assert.strictEqual(FC.fechaCuota('2027-02-01', 1, 'ultimo'), '2027-02-28');
  assert.strictEqual(FC.fechaCobroEnMes('2026-11', 'ultimo'), '2026-11-30');
  const ini = FC.cuadroAmortizacion({ principal: 600, tin: 5, plazo: 3, fechaPrimeraCuota: '2026-01-31', diaCobro: 1 });
  assert.deepStrictEqual(ini.filas.map(f => f.fecha), ['2026-01-01', '2026-02-01', '2026-03-01'], 'el mes de la 1.ª cuota manda');
  // Los intereses son por periodos mensuales: el día de cobro solo cambia las fechas.
  const base = FC.cuadroAmortizacion({ principal: 600, tin: 5, plazo: 6, fechaPrimeraCuota: '2028-01-10' });
  assert.deepStrictEqual(ult.filas.map(({ fecha, ...r }) => r), base.filas.map(({ fecha, ...r }) => r));
  assert.strictEqual(ult.cuota, base.cuota); assert.strictEqual(ult.totalIntereses, base.totalIntereses);
  assert.match(FC.textoDiaCobro('ultimo'), /último día/);
  assert.match(FC.textoDiaCobro(31), /último día si el mes es más corto/);
});
test('Día de cobro: próximas cuotas y vencidas siguen el día de cobro', () => {
  const d = { principal: 3000, tin: 6, plazo: 12, fechaPrimeraCuota: '2026-01-31', diaCobro: 'ultimo' };
  const r = FC.resumenDeuda(d, [1], '2026-03-30');
  assert.deepStrictEqual(r.vencidas.map(f => [f.n, f.fecha]), [[2, '2026-02-28']], 'la de marzo vence el 31, aún no');
  assert.deepStrictEqual(r.proximas.map(f => f.fecha), ['2026-02-28', '2026-03-31', '2026-04-30']);
  const r5 = FC.resumenDeuda({ ...d, diaCobro: 5 }, [], '2026-03-30');
  assert.deepStrictEqual(r5.vencidas.map(f => f.fecha), ['2026-01-05', '2026-02-05', '2026-03-05']);
});
test('Recurrentes: «último día del mes»', () => {
  const rec = { id: 'U', tipo: 'gasto', importe: 50, categoria: 'Servicios', dia: 'ultimo', desde: '2028-01', activo: true };
  const n = FC.periodosRecurrente(rec, '2028-03-30');
  assert.deepStrictEqual(n.map(m => m.fecha), ['2028-01-31', '2028-02-29'], 'marzo aún no (vence el 31)');
  assert.strictEqual(FC.periodosRecurrente(rec, '2028-03-31').length, 3);
});

/* ---------------- Recurrentes ---------------- */
test('Recurrentes: periodos, día 31 en febrero; ya no se generan movimientos solos', () => {
  const rec = { id: 'R', tipo: 'gasto', importe: 700, categoria: 'Vivienda', dia: 31, desde: '2026-01', activo: true };
  const n1 = FC.periodosRecurrente(rec, '2026-03-15');
  assert.deepStrictEqual(n1.map(m => m.id), ['rec_R_2026-01', 'rec_R_2026-02']);
  assert.strictEqual(n1[1].fecha, '2026-02-28');
  assert.strictEqual(FC.periodosRecurrente(rec, '2026-03-31').length, 3, 'llega el día del mes siguiente');
  assert.strictEqual(FC.periodosRecurrente({ ...rec, activo: false }, '2026-03-31').length, 0);
  assert.strictEqual(FC.periodosRecurrente({ ...rec, hasta: '2026-01' }, '2026-12-31').length, 1);
  assert.strictEqual(FC.generarRecurrentes([rec], [], '2026-03-31').length, 0, 'v3.11: no se crean movimientos solos');
  assert.strictEqual(FC.generarRecurrentes([rec], n1, '2026-03-31').length, 0);
});
test('Recurrentes v3.11: se migran los vínculos de ids rec_<plantilla>_<YYYY-MM>', () => {
  const m = { id: 'rec_N_2026-10', tipo: 'ingreso', fecha: '2026-10-28', importe: 2000 };
  const soloId = { id: 'x1', tipo: 'gasto', fecha: '2026-11-01', importe: 70, recurrenteId: 'garaje' };
  const ya = { id: 'y', tipo: 'gasto', fecha: '2026-11-03', importe: 80, recurrenteId: 'otro', recurrentePeriodo: '2026-10' };
  assert.strictEqual(FC.migrarVinculosRecurrentes([m, soloId, ya]), 2);
  assert.strictEqual(m.recurrenteId, 'N'); assert.strictEqual(m.recurrentePeriodo, '2026-10');
  assert.strictEqual(soloId.recurrentePeriodo, '2026-11', 'sin periodo: se toma el mes de la fecha');
  assert.strictEqual(ya.recurrentePeriodo, '2026-10', 'un periodo ya puesto no se pisa');
  assert.deepStrictEqual(FC.parseIdRecurrente('rec_abc-def_2026-08'), { plantillaId: 'abc-def', periodo: '2026-08' });
  assert.strictEqual(FC.parseIdRecurrente('cuota_x_1'), null);
  const movs = [m, { id: 'borrado', deleted: true, recurrenteId: 'N', recurrentePeriodo: '2026-10' }];
  assert.strictEqual(FC.movimientoDeRecurrente(movs, 'N', '2026-10').id, 'rec_N_2026-10');
  assert.strictEqual(FC.movimientoDeRecurrente(movs, 'N', '2026-11'), null);
});

/* ---------------- Garantías ---------------- */
test('Garantías: vencimiento a 3 años (29-feb), estado y URL de Google Calendar', () => {
  assert.strictEqual(FC.GARANTIA_ANIOS_DEFECTO, 3);
  assert.strictEqual(FC.vencimientoGarantia('2024-02-29', 3), '2027-02-28');
  assert.strictEqual(FC.estadoGarantia('2026-11-10', '2026-10-30', 30).estado, 'proxima');
  assert.strictEqual(FC.estadoGarantia('2026-10-29', '2026-10-30').estado, 'caducada');
  assert.strictEqual(FC.estadoGarantia('2027-10-29', '2026-10-30').estado, 'vigente');
  const u = FC.urlGoogleCalendar({ titulo: 'Garantía: Lavadora', fecha: '2027-02-28' });
  assert.ok(u.startsWith('https://calendar.google.com/calendar/render?action=TEMPLATE'));
  assert.ok(u.includes('dates=20270228/20270301') && u.includes('Garant%C3%ADa'));
});

/* ---------------- OCR: análisis del texto ---------------- */
test('OCR ticket: total (no subtotal ni IVA), fecha y comercio', () => {
  const t = 'MERCADONA S.A.\nC/ Mayor 1, Las Palmas\n12/10/2026 18:32\nLECHE 1,15\nPAN 0,90\nSUBTOTAL 18,10\nIGIC 7% 1,27\nTOTAL 19,37\nENTREGADO 20,00\nCAMBIO 0,63';
  const c = FC.analizarTexto(t);
  assert.strictEqual(c.tipo, 'ticket'); assert.strictEqual(c.importe, 19.37); assert.strictEqual(c.fecha, '2026-10-12');
  assert.ok(/MERCADONA/i.test(c.comercio), c.comercio);
});
test('OCR nómina: líquido, devengado, IRPF y empresa', () => {
  const t = 'EMPRESA: ACME CANARIAS S.L.\nPERIODO 01/09/2026 A 30/09/2026\nTOTAL DEVENGADO 2.450,00\nI.R.P.F. 12,00 294,00\nTOTAL A DEDUCIR 449,20\nLIQUIDO A PERCIBIR 2.000,80';
  const c = FC.analizarTexto(t);
  assert.strictEqual(c.tipo, 'nomina'); assert.strictEqual(c.liquido, 2000.8); assert.strictEqual(c.importe, 2000.8);
  assert.strictEqual(c.devengado, 2450); assert.strictEqual(c.deducciones, 449.2);
  assert.ok(/ACME/.test(c.empresa)); assert.strictEqual(c.fecha, '2026-09-30');
});
test('Números en formato español', () => {
  assert.strictEqual(FC.parseNumeroES('1.234,56'), 1234.56);
  assert.strictEqual(FC.parseNumeroES('1234.56'), 1234.56);
  assert.strictEqual(FC.parseNumeroES('12,5'), 12.5);
});

/* ---------------- CSV de inversiones ---------------- */
test('CSV: la plantilla se lee sin errores (ISIN vs ticker, venta, comisiones)', () => {
  const r = FC.parseCSVOperaciones(FC.PLANTILLA_CSV);
  assert.strictEqual(r.errores.length, 0); assert.strictEqual(r.filas.length, 4);
  assert.strictEqual(r.filas[0].isin, 'IE00B03HD191'); assert.strictEqual(r.filas[2].ticker, 'IWDA');
  assert.strictEqual(r.filas[3].operacion, 'venta'); assert.strictEqual(r.filas[2].comisiones, 2.5);
  assert.strictEqual(r.filas[0].participaciones, 10.5234); assert.strictEqual(r.filas[0].fecha, '2024-01-15');
});
test('CSV: errores por línea y separador coma', () => {
  const r = FC.parseCSVOperaciones('fecha,activo,operacion,participaciones,precio\n2024-01-01,X,compra,1,10\n31/02/2024,X,compra,1,10\n2024-01-02,X,regalo,1,10');
  assert.strictEqual(r.filas.length, 1); assert.deepStrictEqual(r.errores.map(e => e.linea), [3, 4]);
  assert.ok(FC.parseCSVOperaciones('a;b\n1;2').errores[0].msg.includes('Faltan columnas'));
});

/* ---------------- Migración v2 -> v3 ---------------- */
test('Migración de inversiones v2: determinista y conserva aportado/valor', () => {
  const inv = { id: 'i1', nombre: 'Fondo', tipo: 'fondo', aportado: 1000, valorActual: 1100, fechaActualizacion: '2026-05-01', updatedAt: 1700000000000 };
  const a = FC.migrarInversionV2(inv, '2026-10-30'), b = FC.migrarInversionV2(inv, '2026-10-30');
  assert.deepStrictEqual(a, b);
  const m = FC.metricasActivo([a.operacion], [a.precio]);
  assert.strictEqual(m.costeRestante, 1000); assert.strictEqual(m.valor, 1100);
  assert.ok(a.lapida.deleted && a.lapida.id === 'i1');
});

/* ---------------- Sincronización de colecciones nuevas ---------------- */
test('Fusión: colecciones nuevas registro a registro (LWW) y lápidas rec_ nunca se purgan', () => {
  const now = Date.parse('2026-10-30T00:00:00Z'), viejo = now - 400 * 86400000;
  const t = now - 1000;
  const L = { deudas: [{ id: 'd1', nombre: 'Coche', updatedAt: t + 10 }], operaciones: [{ id: 'o1', precio: 1, updatedAt: t + 5 }], movimientos: [{ id: 'rec_R_2025-01', deleted: true, updatedAt: viejo }, { id: 'x', deleted: true, updatedAt: viejo }] };
  const R = { deudas: [{ id: 'd1', nombre: 'Coche nuevo', updatedAt: t + 20 }], operaciones: [{ id: 'o1', deleted: true, updatedAt: t + 6 }], adjuntos: [{ id: 'a1', ownerId: 'm', updatedAt: t }], precios: [{ id: 'p', precio: 3, updatedAt: t }] };
  const m = Core.mergeDocs(L, R, now);
  assert.strictEqual(m.deudas[0].nombre, 'Coche nuevo');
  assert.ok(m.operaciones[0].deleted);
  assert.strictEqual(m.adjuntos.length, 1); assert.strictEqual(m.precios.length, 1);
  assert.deepStrictEqual(m.movimientos.map(x => x.id), ['rec_R_2025-01']);
  for (const c of ['recurrentes', 'deudas', 'adjuntos', 'activos', 'operaciones', 'precios']) assert.ok(Core.COLLECTIONS.includes(c));
  assert.strictEqual(Core.DOC_VERSION, 3);
});

/* ---------------- Gemini (sin red: fetch simulado) ---------------- */
const store = new Map();
globalThis.localStorage = { getItem: k => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: k => store.delete(k) };
globalThis.FinanceCore = FC;
const fakeOCR = { proveedores: {}, registrar(p) { if (!p.gratuito) throw new Error('solo gratis'); this.proveedores[p.id] = p; } };
fakeOCR.registrar({ id: 'tesseract', gratuito: true, admite: m => /^image\//.test(m), reconocer: async () => ({ texto: 'TOTAL 12,34\n01/10/2026', confianza: 0.9 }) });
globalThis.OCR = fakeOCR;
require('../js/ocr-gemini.js');
const G = globalThis.OCRGemini;
test('Gemini: modelos y endpoint verificados, solo nivel gratuito', () => {
  assert.strictEqual(G.ENDPOINT, 'https://generativelanguage.googleapis.com/v1beta/interactions');
  assert.deepStrictEqual(Object.keys(G.MODELOS), ['gemini-3.5-flash-lite', 'gemini-3.8-flash']);
  assert.strictEqual(G.modelo, 'gemini-3.5-flash-lite'); assert.ok(G.gratuito);
  G.modelo = 'modelo-de-pago'; assert.strictEqual(G.modelo, 'gemini-3.5-flash-lite', 'modelo desconocido -> defecto');
});
test('Gemini: textoRespuesta entiende Interactions API y el formato antiguo', () => {
  assert.strictEqual(G.textoRespuesta({ steps: [{ type: 'thought', content: [{ type: 'text', text: 'x' }] }, { type: 'model_output', content: [{ type: 'text', text: '{"a":1}' }] }] }), '{"a":1}');
  assert.strictEqual(G.textoRespuesta({ outputs: [{ type: 'text', text: 'hola' }] }), 'hola');
  assert.strictEqual(G.textoRespuesta({ candidates: [{ content: { parts: [{ text: 'viejo' }] } }] }), 'viejo');
  assert.strictEqual(G.textoRespuesta(null), '');
});
test('Gemini: aCampos para ticket (garantía, IVA, categoría válida) y nómina', () => {
  const t = G.aCampos({ tipo_documento: 'ticket', total: 549.004, fecha: '2026-10-12', comercio: ' MediaMarkt ', iva: 95.28, conceptos: [{ descripcion: 'Lavadora', importe: 549 }, { descripcion: '' }], garantia_producto: 'Lavadora Balay', garantia_anios: 3, categoria: 'Hogar' }, ['Hogar', 'Ocio']);
  assert.strictEqual(t.importe, 549); assert.strictEqual(t.comercio, 'MediaMarkt'); assert.strictEqual(t.conceptos.length, 1);
  assert.deepStrictEqual(t.garantia, { producto: 'Lavadora Balay', anios: 3 }); assert.strictEqual(t.categoria, 'Hogar');
  assert.strictEqual(G.aCampos({ tipo_documento: 'ticket', categoria: 'Inventada', fecha: '12/10/2026' }, ['Hogar']).categoria, null);
  assert.strictEqual(G.aCampos({ tipo_documento: 'ticket', fecha: '12/10/2026' }).fecha, null, 'fecha no ISO se descarta');
  const n = G.aCampos({ tipo_documento: 'nomina', bruto: 2450, liquido: 2000.8, retencion_irpf: 294, irpf_pct: 12, seguridad_social: 155.2, empresa: 'ACME', periodo: 'Septiembre 2026' });
  assert.strictEqual(n.tipo, 'nomina'); assert.strictEqual(n.importe, 2000.8); assert.strictEqual(n.devengado, 2450);
  assert.strictEqual(n.irpfPct, 12); assert.strictEqual(n.seguridadSocial, 155.2); assert.strictEqual(n.garantia, null);
});
test('Gemini: petición correcta (clave en cabecera, store:false, esquema) y fallback a Tesseract si falla', async () => {
  globalThis.FileReader = class { readAsDataURL(b) { b.arrayBuffer().then(a => { this.result = 'data:' + b.type + ';base64,' + Buffer.from(a).toString('base64'); this.onload(); }); } };
  const calls = [];
  G.fetchFn = async (url, o) => { calls.push({ url, o }); return { ok: true, status: 200, json: async () => ({ steps: [{ type: 'model_output', content: [{ type: 'text', text: '```json\n{"tipo_documento":"ticket","total":12.5,"fecha":"2026-10-01","texto":"TOTAL 12,50"}\n```' }] }] }) }; };
  G.clave = 'AIzaTESTTESTTESTTESTTEST'; fakeOCR.preferido = 'gemini';
  const blob = new Blob([Buffer.from('fake')], { type: 'image/png' });
  const r = await fakeOCR.leer(blob, { tipo: 'ticket', categorias: ['Hogar'] });
  assert.strictEqual(r.proveedor, 'gemini'); assert.strictEqual(r.campos.importe, 12.5); assert.strictEqual(r.texto, 'TOTAL 12,50');
  const body = JSON.parse(calls[0].o.body);
  assert.strictEqual(calls[0].o.headers['x-goog-api-key'], 'AIzaTESTTESTTESTTESTTEST');
  assert.ok(!calls[0].url.includes('key='), 'la clave no va en la URL');
  assert.strictEqual(body.store, false); assert.strictEqual(body.model, 'gemini-3.5-flash-lite');
  assert.strictEqual(body.response_format.mime_type, 'application/json'); assert.strictEqual(body.input[1].type, 'image');
  // Error 429 -> se usa Tesseract y se avisa
  G.fetchFn = async () => ({ ok: false, status: 429, json: async () => ({ error: { message: 'quota' } }) });
  const r2 = await fakeOCR.leer(blob, { tipo: 'ticket' });
  assert.strictEqual(r2.proveedor, 'tesseract'); assert.strictEqual(r2.campos.importe, 12.34);
  assert.ok(/límite gratuito/.test(r2.aviso) && /lector del navegador/.test(r2.aviso), r2.aviso);
  // PDF sin Gemini -> mensaje claro
  G.clave = '';
  await assert.rejects(fakeOCR.leer(new Blob(['%PDF'], { type: 'application/pdf' })), /Gemini/);
});
test('Sugerir categoría sin IA: vota por movimientos parecidos', async () => {
  const hist = [
    { tipo: 'gasto', descripcion: 'Mercadona Siete Palmas', categoria: 'Supermercado', naturaleza: 'variable' },
    { tipo: 'gasto', descripcion: 'mercadona', categoria: 'Supermercado', naturaleza: 'variable' },
    { tipo: 'gasto', descripcion: 'Netflix', categoria: 'Suscripciones', naturaleza: 'fijo' }];
  const r = fakeOCR.sugerirLocal({ tipo: 'gasto', descripcion: 'MERCADONA', categorias: ['Supermercado', 'Suscripciones'] }, hist);
  assert.strictEqual(r.categoria, 'Supermercado'); assert.strictEqual(r.naturaleza, 'variable');
  assert.strictEqual((await fakeOCR.sugerirCategoria({ tipo: 'gasto', descripcion: 'netflix', categorias: ['Supermercado', 'Suscripciones'] }, hist)).naturaleza, 'fijo');
  assert.strictEqual(fakeOCR.sugerirLocal({ tipo: 'gasto', descripcion: 'zzz', categorias: ['Supermercado'] }, hist).categoria, null);
});
test('La clave de Gemini no entra en los datos sincronizados', () => {
  const doc = Core.toRemote({ movimientos: [], ajustes: { tema: 'dark' } });
  assert.ok(!JSON.stringify(doc).includes('AIza') && !('ajustes' in doc));
});

/* ---------------- Copia para análisis ---------------- */
const AC = require('../js/analysis-export.js');
const estado = {
  movimientos: [
    { id: 'm1', tipo: 'ingreso', fecha: '2026-09-28', importe: 2000, categoria: 'Nómina', tipoIngreso: 'nomina', descripcion: 'Nómina' },
    { id: 'm2', tipo: 'gasto', fecha: '2026-09-05', importe: 1200, categoria: 'Electrónica', naturaleza: 'variable', descripcion: 'Portátil, "gaming"', financiadoPor: 'd1', garantia: { producto: 'Portátil', anios: 3 } },
    { id: 'm3', tipo: 'gasto', fecha: '2026-10-05', importe: 100, categoria: 'Deudas', naturaleza: 'fijo', deudaId: 'd1', cuotaN: 1, desglose: { interes: 0, amortizacion: 100, comision: 0 } },
    { id: 'm4', tipo: 'gasto', fecha: '2026-09-10', importe: 50, categoria: 'Ocio', naturaleza: 'variable', deleted: true }],
  deudas: [{ id: 'd1', nombre: 'Portátil a plazos', medio: 'tienda', principal: 1200, tin: 0, plazo: 12, fechaPrimeraCuota: '2026-10-05', movimientoId: 'm2' }],
  activos: [{ id: 'a1', nombre: 'ETF', tipo: 'etf' }], operaciones: ops.map(o => ({ ...o, activoId: 'a1' })), precios: [{ id: 'p1', activoId: 'a1', fecha: '2026-10-01', precio: 140 }],
  recurrentes: [], adjuntos: [{ id: 'x', ownerId: 'm2', nombre: 'ticket.jpg' }], categorias: { gasto: ['Ocio'], ingreso: ['Nómina'] }
};
test('Copia para análisis: contenido JSON (sin lápidas, deudas con cuadro, FIFO, garantías)', () => {
  const { json } = AC.construir(estado, { hoy: '2026-10-30', ahora: '2026-10-30T10:00:00Z' });
  assert.strictEqual(json.moneda, 'EUR'); assert.strictEqual(json.movimientos.length, 3);
  const sep = json.resumenMensual.find(r => r.mes === '2026-09');
  assert.strictEqual(sep.gastos, 0, 'compra financiada no cuenta como gasto'); assert.strictEqual(sep.compraFinanciada, 1200);
  assert.strictEqual(json.resumenMensual.find(r => r.mes === '2026-10').cuotasDeuda, 100);
  const d = json.deudas[0];
  assert.strictEqual(d.cuadro.length, 12); assert.strictEqual(d.cuotasPagadas, 1); assert.strictEqual(d.capitalPendiente, 1100); assert.ok(d.cuadro[0].pagada);
  const a = json.inversiones.activos[0];
  assert.strictEqual(a.gananciaRealizada, 338.5); assert.strictEqual(a.gananciaNoRealizada, 97.5); assert.strictEqual(a.ventas[0].lotesConsumidos.length, 2);
  assert.strictEqual(json.garantias[0].vence, '2029-09-05'); assert.strictEqual(json.garantias[0].estado, 'vigente');
  assert.strictEqual(json.movimientos.find(m => m.id === 'm2').adjuntos, 1);
  assert.ok(!JSON.stringify(json).includes('ticket.jpg'), 'no incluye archivos ni nombres de adjuntos');
});
test('Copia para análisis: CSV con comillas y huella estable', () => {
  const a = AC.construir(estado, { hoy: '2026-10-30', ahora: '2026-10-30T10:00:00Z' }), b = AC.construir(estado, { hoy: '2026-10-30', ahora: '2026-10-30T11:00:00Z' });
  const lines = a.csv.replace(/^\ufeff/, '').trim().split('\r\n');
  assert.strictEqual(lines.length, 4); assert.ok(lines[0].startsWith('id,fecha,tipo,importe,importe_con_signo'));
  assert.ok(lines.some(l => l.includes('"Portátil, ""gaming"""')));
  assert.ok(lines.some(l => l.startsWith('m2,2026-09-05,gasto,1200.00,-1200.00')));
  assert.strictEqual(AC.huella(a), AC.huella(b), 'solo cambia la hora -> misma huella');
  assert.notStrictEqual(AC.huella(a), AC.huella(AC.construir({ ...estado, movimientos: estado.movimientos.slice(1) }, { hoy: '2026-10-30' })));
});
test('Copia para análisis: vehículos, repostajes y consumos (v3.3)', () => {
  const e = { ...estado,
    movimientos: [...estado.movimientos,
      { id: 'c1', tipo: 'gasto', fecha: '2026-09-01', importe: 58.36, categoria: 'Combustible', naturaleza: 'variable', repostajeId: 'r1' },
      { id: 'c2', tipo: 'gasto', fecha: '2026-09-15', importe: 60, categoria: 'Combustible', naturaleza: 'variable', repostajeId: 'r2' }],
    vehiculos: [{ id: 'v1', matricula: '1234KLM', nombre: 'León', combustible: 'gasoil', capacidad: 50, kmIniciales: 98500, activo: true }, { id: 'v9', matricula: 'X', deleted: true }],
    repostajes: [
      { id: 'r1', vehiculoId: 'v1', movimientoId: 'c1', fecha: '2026-09-01', litros: 40, precioLitro: 1.459, importe: 58.36, kmTanqueAnterior: null, odometro: 99100, lleno: true },
      { id: 'r2', vehiculoId: 'v1', movimientoId: 'c2', fecha: '2026-09-15', litros: 40, precioLitro: 1.5, importe: 60, kmTanqueAnterior: 640, odometro: null, lleno: true }] };
  const { json, csv } = AC.construir(e, { hoy: '2026-10-30', ahora: '2026-10-30T10:00:00Z' });
  assert.strictEqual(json.vehiculos.length, 1); const v = json.vehiculos[0];
  assert.strictEqual(v.matricula, '1234KLM'); assert.strictEqual(v.metricas.litrosPor100km, 6.25); assert.strictEqual(v.metricas.gasto, 118.36);
  assert.strictEqual(v.repostajes[1].tramo.metodo, 'lleno'); assert.strictEqual(v.repostajes[1].km, 640);
  assert.strictEqual(json.combustible.totales.litros, 80); assert.strictEqual(json.totales.gastoCombustible, 118.36);
  assert.strictEqual(json.movimientos.find(m => m.id === 'c2').repostaje.matricula, '1234KLM');
  const lines = csv.replace(/^\ufeff/, '').trim().split('\r\n');
  assert.ok(lines[0].endsWith(',vehiculo,litros,precio_litro,km_tanque_anterior,cuentakm,lleno'));
  assert.ok(lines.some(l => l.startsWith('c2,') && l.endsWith(',1234KLM,40,1.5,640,,si')));
  assert.ok(AC.construir(estado, { hoy: '2026-10-30' }).json.vehiculos.length === 0, 'estado antiguo sin vehículos');
});
test('Cliente Drive: carpeta visible y archivos con padre (drive.file), sin appDataFolder', async () => {
  const calls = [];
  const fetchFn = async (url, o = {}) => { calls.push({ url, o }); return { ok: true, status: 200, json: async () => ({ id: 'id' + calls.length, name: 'n' }), text: async () => '' }; };
  const c = createDriveClient({ fetchFn, getToken: async () => 'tok', fileName: 'finanzas.json' });
  await c.createFolder('Finanzas App - Análisis');
  await c.createText('movimientos.csv', 'FOLDER', 'text/csv', 'a,b');
  await c.updateText('F1', 'application/json', '{}');
  await c.query("name='x'");
  const meta = JSON.parse(calls[0].o.body);
  assert.strictEqual(meta.mimeType, 'application/vnd.google-apps.folder'); assert.ok(!meta.parents);
  assert.ok(calls[1].o.body.includes('"parents":["FOLDER"]') && !calls[1].o.body.includes('appDataFolder'));
  assert.ok(calls[2].url.includes('/upload/drive/v3/files/F1?uploadType=media') && calls[2].o.method === 'PATCH');
  assert.ok(calls[3].url.includes('spaces=drive&'));
});

/* ---------------- Combustible y vehículos ---------------- */

/* ---- v3.5 · Deudas en modo «Cuota manual» ---- */
const manualBase = { modo: 'manual', cuotaManual: 250, plazo: 48, fechaPrimeraCuota: '2026-01-05', diaCobro: 5 };
test('Cuota manual sin capital: calendario con la cuota fija y pendiente = cuotas restantes × cuota', () => {
  const r = FC.resumenDeuda(manualBase, [1, 2], '2026-03-10');
  assert.strictEqual(r.modo, 'manual'); assert.strictEqual(r.capitalConocido, false);
  assert.strictEqual(r.filas.length, 48); assert.ok(r.filas.every(f => f.pago === 250 && f.interes === 0 && f.amortizacion === 250));
  assert.strictEqual(r.filas[1].fecha, '2026-02-05'); assert.strictEqual(r.filas[47].fecha, '2029-12-05');
  assert.strictEqual(r.cuota, 250); assert.strictEqual(r.totalPagado, 12000); assert.strictEqual(r.totalIntereses, 0);
  assert.strictEqual(r.pendiente, 46 * 250); assert.strictEqual(r.restantes, 46);
  assert.deepStrictEqual(r.vencidas.map(f => f.n), [3]); assert.ok(!isFinite(r.tae), 'sin capital no hay TAE');
});
test('Cuota manual: importes editados por cuota y día de cobro «último»', () => {
  const r = FC.resumenDeuda({ ...manualBase, plazo: 4, diaCobro: FC.DIA_ULTIMO, fechaPrimeraCuota: '2026-01-31', cuotasEditadas: { 1: 300, 4: '99.5', 9: 1 } }, [], null);
  assert.deepStrictEqual(r.filas.map(f => f.pago), [300, 250, 250, 99.5]);
  assert.deepStrictEqual(r.filas.map(f => f.fecha), ['2026-01-31', '2026-02-28', '2026-03-31', '2026-04-30']);
  assert.strictEqual(r.totalPagado, 899.5); assert.strictEqual(r.cuotasEditadas, 2); assert.strictEqual(r.pendiente, 899.5);
});
test('Cuota manual con capital: TIN implícito, desglose que cuadra y TAE', () => {
  const pagos = FC.pagosManual({ ...manualBase }); const tin = FC.tinImplicito(10000, pagos);
  assert.ok(Math.abs(tin - 9.2418) < 0.001, 'TIN implícito ' + tin);
  // con ese TIN la cuota francesa es la misma
  assert.ok(Math.abs(FC.cuotaFrancesa(10000, tin, 48) - 250) < 0.005);
  const r = FC.resumenDeuda({ ...manualBase, capitalConocido: true, principal: 10000 }, [1], '2026-01-10');
  assert.ok(r.capitalConocido && r.tinEsImplicito); assert.strictEqual(r.filas[0].interes, 77.01); assert.strictEqual(r.filas[0].amortizacion, 172.99);
  assert.strictEqual(FC.round2(r.filas.reduce((a, f) => a + f.amortizacion, 0)), 10000); assert.strictEqual(r.filas[47].pendiente, 0);
  assert.ok(Math.abs(r.totalIntereses - 2000) < 0.05); assert.strictEqual(r.pendiente, 9827.01);
  assert.ok(Math.abs(r.tae - 0.0964) < 0.001, 'TAE ' + r.tae);
  assert.strictEqual(FC.tinImplicito(1200, [100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100]), 0);
  assert.ok(isNaN(FC.tinImplicito(13000, pagos)), 'cuotas que no devuelven el capital');
});
test('Cuota manual con capital y TIN indicado: se usa si cuadra; si no, el implícito y se avisa', () => {
  const ok = FC.resumenDeuda({ ...manualBase, capitalConocido: true, principal: 10000, tinConocido: true, tin: 9.24 }, [], null);
  assert.strictEqual(ok.tinUsado, 9.24); assert.ok(!ok.tinNoCuadra && !ok.tinEsImplicito);
  const mal = FC.resumenDeuda({ ...manualBase, capitalConocido: true, principal: 10000, tinConocido: true, tin: 5 }, [], null);
  assert.ok(mal.tinNoCuadra && mal.tinEsImplicito && mal.descuadreTIN < -1000); assert.ok(Math.abs(mal.tinUsado - 9.2418) < 0.001);
  const noLlega = FC.resumenDeuda({ ...manualBase, capitalConocido: true, principal: 13000 }, [], null);
  assert.ok(!noLlega.capitalConocido && noLlega.capitalNoCuadra); assert.strictEqual(noLlega.pendiente, 12000);
});
test('Cuota manual: campos de compatibilidad para versiones anteriores (cuota francesa equivalente)', () => {
  const sin = FC.compatManual(manualBase); assert.deepStrictEqual(sin, { principal: 12000, tin: 0 });
  assert.strictEqual(FC.cuotaFrancesa(sin.principal, sin.tin, 48), 250);
  const con = FC.compatManual({ ...manualBase, capitalConocido: true, principal: 10000 });
  assert.strictEqual(con.principal, 10000); assert.ok(Math.abs(FC.cuotaFrancesa(con.principal, con.tin, 48) - 250) < 0.01);
  // Una deuda sin modo sigue siendo «calculada» (sistema francés) como siempre
  const vieja = FC.resumenDeuda({ principal: 1200, tin: 0, plazo: 12, fechaPrimeraCuota: '2026-01-15' });
  assert.strictEqual(vieja.modo, 'calculado'); assert.strictEqual(vieja.cuota, 100);
  assert.throws(() => FC.cuadroAmortizacion({ modo: 'manual', cuotaManual: 0, plazo: 3 }));
});
test('Copia para análisis: deuda en modo manual sin capital', () => {
  const est = { ...estado, deudas: [...estado.deudas, { id: 'd2', nombre: 'Móvil', medio: 'tienda', modo: 'manual', cuotaManual: 30, cuotasEditadas: { 3: 10 }, capitalConocido: false, principal: 70, tin: 0, plazo: 3, fechaPrimeraCuota: '2026-09-10' }] };
  const { json } = AC.construir(est, { hoy: '2026-10-30', ahora: '2026-10-30T10:00:00Z' });
  const d = json.deudas.find(x => x.id === 'd2');
  assert.strictEqual(d.modo, 'manual'); assert.strictEqual(d.principal, null); assert.strictEqual(d.tinPct, null); assert.strictEqual(d.cuotaManual, 30);
  assert.deepStrictEqual(d.cuadro.map(f => f.cuota), [30, 30, 10]); assert.strictEqual(d.totalPagado, 70); assert.strictEqual(d.totalIntereses, null);
  assert.strictEqual(json.deudas.find(x => x.id === 'd1').modo, 'calculado');
});

const Fuel = require('../js/fuel-core.js');
const V = { id: 'v1', matricula: '1234ABC', capacidad: 50, kmIniciales: 100000 };
const rep = (id, fecha, litros, precioLitro, extra = {}) => ({ id, vehiculoId: 'v1', fecha, litros, precioLitro, importe: Math.round(litros * precioLitro * 100) / 100, lleno: true, kmTanqueAnterior: null, odometro: null, ...extra });
test('Combustible: matrícula normalizada y categoría detectada', () => {
  assert.strictEqual(Fuel.normalizarMatricula(' 1234-abc '), '1234ABC');
  assert.strictEqual(Fuel.normalizarMatricula('gc 1234 bf'), 'GC1234BF');
  assert.ok(Fuel.esCategoriaCombustible('Combustible') && Fuel.esCategoriaCombustible('Gasoil coche') && Fuel.esCategoriaCombustible('Diésel'));
  assert.ok(!Fuel.esCategoriaCombustible('Transporte'));
});
test('Combustible: importe = precio × litros, y se puede calcular cualquiera de los tres', () => {
  assert.deepStrictEqual(Fuel.cuadrar({ precioLitro: 1.459, litros: 40 }), { precioLitro: 1.459, litros: 40, importe: 58.36 });
  assert.strictEqual(Fuel.cuadrar({ precioLitro: 1.5, importe: 60 }).litros, 40);
  assert.strictEqual(Fuel.cuadrar({ litros: 40, importe: 58.36 }).precioLitro, 1.459);
  assert.strictEqual(Fuel.cuadrar({ precioLitro: 1.5, litros: 40, importe: 99 }, 'importe').importe, 60, 'recalcula el indicado');
  assert.ok(Fuel.cuadra(1.459, 40.02, 58.39).ok, 'redondeo del surtidor');
  const c = Fuel.cuadra(1.5, 40, 70); assert.ok(!c.ok); assert.strictEqual(c.esperado, 60); assert.strictEqual(c.diferencia, 10);
});
test('Combustible: lleno a lleno → L/100 km, km/L y €/km con los litros del lleno siguiente', () => {
  const reps = [rep('a', '2026-01-01', 45, 1.5), rep('b', '2026-01-20', 40, 1.4, { kmTanqueAnterior: 800 }), rep('c', '2026-02-10', 36, 1.6, { kmTanqueAnterior: 600 })];
  const t = Fuel.tramos(reps);
  assert.strictEqual(t.length, 2);
  assert.strictEqual(t[0].l100, 5); assert.strictEqual(t[0].kmL, 20); assert.strictEqual(t[0].eurKm, 0.07); assert.strictEqual(t[0].metodo, 'lleno');
  assert.strictEqual(t[1].l100, 6); assert.strictEqual(t[1].eurKm, 0.096);
  const m = Fuel.metricasVehiculo(V, reps);
  assert.strictEqual(m.repostajes, 3); assert.strictEqual(m.litros, 121); assert.strictEqual(m.gasto, 67.5 + 56 + 57.6);
  assert.strictEqual(m.precioMedio, Math.round(181.1 / 121 * 1000) / 1000, '€/L ponderado');
  assert.strictEqual(m.km, 1400); assert.strictEqual(m.l100, 5.43); assert.strictEqual(m.eurKm, Math.round((56 + 57.6) / 1400 * 1000) / 1000);
  assert.strictEqual(m.autonomia, Math.round(50 * m.kmL));
  assert.strictEqual(m.costeLleno, 80, '50 L al último precio (1,60)');
  assert.strictEqual(m.odometroEstimado, 101400, 'km iniciales + km anotados');
  assert.strictEqual(m.ultimo.id, 'c');
});
test('Combustible: parciales intermedios se suman al siguiente lleno; parcial final no cuenta', () => {
  const reps = [rep('a', '2026-03-01', 50, 1.5), rep('b', '2026-03-08', 20, 1.5, { lleno: false, kmTanqueAnterior: 300 }), rep('c', '2026-03-15', 25, 1.5, { kmTanqueAnterior: 500 }), rep('d', '2026-03-20', 10, 1.5, { lleno: false, kmTanqueAnterior: 200 })];
  const t = Fuel.tramos(reps);
  assert.strictEqual(t.length, 1);
  assert.strictEqual(t[0].litros, 45); assert.strictEqual(t[0].km, 800); assert.strictEqual(t[0].l100, 5.63); assert.strictEqual(t[0].repostajes, 2);
  const m = Fuel.metricasVehiculo(V, reps);
  assert.strictEqual(m.km, 1000, 'km anotados incluye el parcial final'); assert.strictEqual(m.kmConsumo, 800);
});
test('Combustible: km desde el odómetro si no se anotan; método aproximado sin llenos', () => {
  const reps = [rep('a', '2026-04-01', 40, 1.5, { odometro: 10000 }), rep('b', '2026-04-15', 38, 1.5, { odometro: 10760 })];
  const f = Fuel.filas(reps); assert.strictEqual(f[1].km, 760); assert.strictEqual(f[1].kmFuente, 'odometro');
  assert.strictEqual(Fuel.tramos(reps)[0].l100, 5);
  // Siempre parcial: litros del repostaje ANTERIOR / km hechos con ese depósito
  const parc = [rep('a', '2026-05-01', 20, 1.5, { lleno: false }), rep('b', '2026-05-10', 15, 1.6, { lleno: false, kmTanqueAnterior: 400 }), rep('c', '2026-05-20', 18, 1.5, { lleno: false, kmTanqueAnterior: 250 })];
  const t = Fuel.tramos(parc);
  assert.deepStrictEqual(t.map(x => [x.metodo, x.l100, x.eurKm]), [['aprox', 5, 0.075], ['aprox', 6, 0.096]]);
  assert.ok(Fuel.metricasVehiculo(V, parc).aproximado);
  // Primer repostaje sin datos de km: no hay consumo todavía
  assert.strictEqual(Fuel.metricasVehiculo(V, [rep('a', '2026-05-01', 20, 1.5)]).l100, null);
});
test('Combustible: periodos, meses, años y resumen de varios vehículos', () => {
  const reps = [rep('a', '2025-12-20', 40, 1.5), rep('b', '2026-01-10', 40, 1.5, { kmTanqueAnterior: 800 }), rep('c', '2026-02-10', 30, 1.6, { kmTanqueAnterior: 500 }),
    { ...rep('x', '2026-01-05', 60, 1.4), vehiculoId: 'v2' }, { ...rep('y', '2026-02-05', 50, 1.4, { kmTanqueAnterior: 500 }), vehiculoId: 'v2' }];
  const m26 = Fuel.metricasVehiculo(V, reps, { desde: '2026-01-01', hasta: '2026-12-31' });
  assert.strictEqual(m26.repostajes, 2); assert.strictEqual(m26.litros, 70); assert.strictEqual(m26.l100, 5.38);
  const meses = Fuel.porMes([V], reps);
  assert.deepStrictEqual(meses.map(x => [x.mes, x.litros, x.l100]), [['2025-12', 40, null], ['2026-01', 40, 5], ['2026-02', 30, 6]]);
  assert.deepStrictEqual(Fuel.porAnio([V], reps).map(x => [x.anio, x.gasto]), [['2025', 60], ['2026', 108]]);
  const r = Fuel.resumen([V, { id: 'v2', matricula: 'X', capacidad: 60 }], reps);
  assert.strictEqual(r.total.repostajes, 5); assert.strictEqual(r.total.litros, 220);
  assert.strictEqual(r.total.l100, Math.round((70 + 50) / 1800 * 10000) / 100, 'ponderado por km');
  assert.strictEqual(r.total.ultimo.id, 'c');
  assert.strictEqual(r.vehiculos[1].m.l100, 10);
});
test('Combustible: colecciones nuevas se fusionan con lápidas como las demás', () => {
  assert.ok(Core.COLLECTIONS.includes('vehiculos') && Core.COLLECTIONS.includes('repostajes'));
  const a = Core.emptyDoc ? Core.emptyDoc() : {};
  const loc = { ...a, vehiculos: [{ id: 'v1', matricula: 'A', updatedAt: 5 }], repostajes: [{ id: 'r1', vehiculoId: 'v1', updatedAt: 9, deleted: true }] };
  const rem = { ...a, vehiculos: [{ id: 'v1', matricula: 'B', updatedAt: 3 }, { id: 'v2', matricula: 'C', updatedAt: 1 }], repostajes: [{ id: 'r1', vehiculoId: 'v1', litros: 40, updatedAt: 8 }] };
  const m = Core.mergeDocs(loc, rem, 10);
  assert.deepStrictEqual(m.vehiculos.map(v => v.matricula).sort(), ['A', 'C']);
  assert.ok(m.repostajes[0].deleted, 'la lápida más nueva gana');
});

(async () => {
  for (const [name, fn] of tests) {
    try { await fn(); pass++; console.log('PASS ' + name); }
    catch (e) { fail++; console.log('FAIL ' + name + '\n   ' + e.message); }
  }
  console.log(`\n${pass} correctos, ${fail} fallidos`);
  process.exit(fail ? 1 : 0);
})();
