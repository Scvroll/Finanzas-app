// Tests de navegador (Playwright + Chrome): modo local, PWA y Google/Drive simulados con dos dispositivos.
// Uso: python3 -m http.server 8765 &  y luego  node tests/browser.test.js  (requiere playwright-core)
const { chromium } = require(process.env.PW_PATH || 'playwright-core');
const fs = require('fs');
const BASE = process.env.BASE_URL || 'http://localhost:8765/'; // servir antes con: python3 -m http.server 8765
let pass = 0, fail = 0;
const path = require('path');
const SHOTS = path.join(__dirname, '..', 'screenshots'); fs.mkdirSync(SHOTS, { recursive: true });
const TICKET = path.join(__dirname, 'fixtures', 'ticket.png'); // python3 tests/fixtures/make_ticket.py
const ok = (c, msg) => { c ? pass++ : fail++; console.log((c ? 'PASS ' : 'FAIL ') + msg); };
const round = n => Math.round(n * 100) / 100;
const sleep = ms => new Promise(r => setTimeout(r, ms));
// Modo local: fuerza GOOGLE_CLIENT_ID vacío (js/config.js ya trae el client ID real)
const modoLocal = ctx => ctx.route('**/js/config.js', async route => {
  const res = await route.fetch(); const body = (await res.text()).replace(/const GOOGLE_CLIENT_ID = '[^']*';/, "const GOOGLE_CLIENT_ID = '';");
  route.fulfill({ response: res, body });
});

function track(page, errors, tag) {
  page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') errors.push(`[${tag}] ${m.type()}: ${m.text()}`); });
  page.on('pageerror', e => { errors.push(`[${tag}] pageerror: ${e.message}`); if (process.env.DEBUG) console.log('PAGEERROR', tag, e.stack); });
  page.on('dialog', d => d.accept());
}

(async () => {
  const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox'] });
  const errors = [];

  /* ============ 1. Modo local (sin client ID) ============ */
  {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: 'es-ES', timezoneId: 'Atlantic/Canary', acceptDownloads: true, serviceWorkers: 'block' });
    await modoLocal(ctx);
    const page = await ctx.newPage(); track(page, errors, 'local');
    // migración v1 -> v2
    await page.goto(BASE + 'index.html');
    await page.evaluate(() => { localStorage.clear(); localStorage.setItem('finanzas_v1', JSON.stringify({ version: 1, movimientos: [{ id: 'old1', tipo: 'gasto', fecha: '2026-09-01', importe: 10, categoria: 'Ocio' }], inversiones: [{ id: 'inv1', nombre: 'Fondo viejo', tipo: 'fondo', aportado: 1000, valorActual: 1100, updatedAt: 1 }], categorias: { gasto: ['Ocio', 'Otros', 'Viejo'], ingreso: ['Otros'] }, ajustes: { tema: 'auto' } })); });
    await page.reload({ waitUntil: 'networkidle' });
    const mig = await page.evaluate(() => ({ n: FinanzasApp.Store.getMovimientos().length, v2: !!localStorage.finanzas_v2, v1: !!localStorage.finanzas_v1, cats: FinanzasApp.Store.getCategorias('gasto'), act: FinanzasApp.Store.list('activos').map(a => a.nombre), ops: FinanzasApp.Store.list('operaciones').map(o => o.precio), pr: FinanzasApp.Store.list('precios').map(p => p.precio) }));
    ok(mig.n === 1 && mig.v2 && mig.v1 && mig.cats.includes('Viejo') && mig.act[0] === 'Fondo viejo' && mig.ops[0] === 1000 && mig.pr[0] === 1100, 'migración v1 -> actual: inversión pasa a activo + compra + precio (v1 se conserva) ' + JSON.stringify(mig));
    ok(await page.isVisible('#localNotice'), 'aviso de modo local visible');
    ok(await page.isHidden('#syncChip') && await page.isHidden('#loginBtn'), 'sin client ID: no hay chip ni botón de Google');
    ok(await page.evaluate(() => !document.querySelector('script[src*="accounts.google.com"]')), 'sin client ID: no se carga el script de Google');
    await page.evaluate(() => localStorage.clear()); await page.reload({ waitUntil: 'networkidle' });

    await page.click('#fabAdd');
    await page.fill('#mImporte', '1.234,56'); await page.fill('#mFecha', '2026-10-05');
    await page.click('label[for=tipoIngreso]'); await page.selectOption('#mCategoria', 'Nómina');
    await page.fill('#mDescripcion', 'Nómina test'); await page.click('#movForm button[type=submit]');
    await page.click('#fabAdd');
    await page.fill('#mImporte', '234,56'); await page.fill('#mFecha', '2026-10-06');
    await page.selectOption('#mCategoria', 'Supermercado'); await page.click('#movForm button[type=submit]');
    await page.evaluate(() => FinanzasApp.setMes('2026-10'));
    const k = await page.evaluate(() => ({ i: kpiIngresos.textContent, b: kpiBalance.textContent }));
    ok(k.i.includes('1.234,56') && k.b.includes('1.000,00'), 'KPIs ' + JSON.stringify(k));
    await page.click('nav.tabs button[data-view=movimientos]');
    const id = await page.evaluate(() => FinanzasApp.Store.getMovimientos().find(m => m.tipo === 'gasto').id);
    await page.click(`[data-edit-mov="${id}"]`); await page.fill('#mImporte', '300'); await page.click('#movForm button[type=submit]');
    let r = await page.evaluate(() => FinanzasApp.Calc.resumenMes(FinanzasApp.Store.getMovimientos(), '2026-10'));
    ok(r.gastos === 300 && r.balance === 934.56, 'editar');
    await page.click(`[data-del-mov="${id}"]`);
    const st = await page.evaluate(id => ({ live: FinanzasApp.Store.getMovimientos().length, tomb: FinanzasApp.Store.state.movimientos.find(m => m.id === id) }), id);
    ok(st.live === 1 && st.tomb && st.tomb.deleted === true && st.tomb.updatedAt > 0, 'borrar deja lápida ' + JSON.stringify(st.tomb));
    ok(await page.locator('#movBody tr').count() === 1, 'la lápida no aparece en la tabla');
    await page.reload({ waitUntil: 'networkidle' });
    ok(await page.evaluate(() => FinanzasApp.Store.getMovimientos().length === 1 && FinanzasApp.Store.getMovimientos()[0].updatedAt > 0), 'persistencia + updatedAt');
    await page.evaluate(async () => { const S = FinanzasApp.Store; const a = await S.put('activos', { nombre: 'ETF test', tipo: 'etf', isin: '', ticker: '', notas: '' }); await S.put('operaciones', { activoId: a.id, tipo: 'compra', fecha: '2026-10-01', participaciones: 10, precio: 100, comisiones: 0, notas: '' }); });
    ok(await page.evaluate(() => FinanzasApp.Store.list('activos').length === 1), 'inversión añadida');
    await page.click('nav.tabs button[data-view=ajustes]');
    ok((await page.textContent('#accountCard')).includes('Modo local'), 'tarjeta de cuenta: modo local');
    await page.fill('#newCatGasto', 'Gimnasio'); await page.click('[data-addcat=gasto]');
    ok(await page.evaluate(() => FinanzasApp.Store.state.categorias.updatedAt > 0 && FinanzasApp.Store.getCategorias('gasto').includes('Gimnasio')), 'categoría añadida (updatedAt)');
    const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#exportJsonBtn')]);
    const p = await dl.path(); const exp = JSON.parse(fs.readFileSync(p, 'utf8'));
    ok(exp.movimientos.length === 1 && exp.movimientos.every(m => !m.deleted), 'exportar JSON sin lápidas');
    await page.click('#resetBtn');
    ok(await page.evaluate(() => FinanzasApp.Store.getMovimientos().length === 0 && FinanzasApp.Store.state.movimientos.every(m => m.deleted)), 'borrar todo -> lápidas');
    await page.setInputFiles('#importFile', p); await sleep(300);
    ok(await page.evaluate(() => FinanzasApp.Store.getMovimientos().length === 1 && FinanzasApp.Store.list('activos').length === 1 && FinanzasApp.Store.list('operaciones').length === 1), 'importar JSON restaura');
    await page.click('#themeBtn'); await page.click('#themeBtn');
    ok(await page.evaluate(() => JSON.parse(localStorage.finanzas_v2).ajustes.tema === 'dark'), 'tema guardado');
    await page.evaluate(() => localStorage.clear());
    await ctx.close();
  }

  /* ============ 1b. Fase 3 en modo local: deudas, recurrentes, garantías, inversiones, adjuntos, OCR, Gemini ============ */
  {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: 'es-ES', timezoneId: 'Atlantic/Canary', serviceWorkers: 'block' });
    await modoLocal(ctx);
    const page = await ctx.newPage(); track(page, errors, 'f3');
    const gem = { calls: [], mode: 'ok' };
    await ctx.route('https://generativelanguage.googleapis.com/**', async route => {
      const req = route.request(); gem.calls.push({ url: req.url(), headers: req.headers(), body: JSON.parse(req.postData() || '{}') });
      const cors = { 'access-control-allow-origin': '*' };
      if (gem.mode === '429') return route.fulfill({ status: 429, contentType: 'application/json', headers: cors, body: JSON.stringify({ error: { code: 429, message: 'Resource exhausted', status: 'RESOURCE_EXHAUSTED' } }) });
      const body = gem.calls[gem.calls.length - 1].body; const prompt = JSON.stringify(body);
      const out = /Clasifica este/.test(prompt) // «Sugerir categoría» o lectura de documento (esquema de js/ocr-gemini.js)
        ? { categoria: 'Hogar', naturaleza: 'variable', motivo: 'Electrodoméstico' }
        : { tipo_documento: 'ticket', texto: 'ELECTRO CANARIAS S.L.\nTOTAL 493,81', comercio: 'Electro Canarias', fecha: '2026-10-12', total: 493.81, iva: 32.31, conceptos: [{ descripcion: 'Lavadora Balay 8kg', importe: 449 }], garantia_producto: 'Lavadora Balay 8kg', garantia_anios: 3, categoria: 'Hogar' };
      route.fulfill({ status: 200, contentType: 'application/json', headers: cors, body: JSON.stringify({ id: 'int_1', status: 'completed', steps: [{ type: 'model_output', content: [{ type: 'text', text: JSON.stringify(out) }] }] }) });
    });
    await page.goto(BASE + 'index.html');
    await page.evaluate(() => localStorage.clear()); await page.reload({ waitUntil: 'networkidle' });
    const S = (fn, arg) => page.evaluate(fn, arg);

    // Compra financiada: gasto + deuda vinculada con cuadro francés
    await page.click('#fabAdd');
    await page.fill('#mImporte', '1.200'); await page.fill('#mFecha', '2026-08-10'); await page.selectOption('#mCategoria', 'Hogar');
    await page.fill('#mDescripcion', 'Sofá a plazos');
    await page.check('#movForm [name=esFin]');
    await page.selectOption('#movFin [name=medio]', { index: 0 }).catch(() => {});
    await page.fill('#movFin [name=principal]', '1.200'); await page.fill('#movFin [name=tin]', '9,5'); await page.fill('#movFin [name=plazo]', '12');
    await page.fill('#movFin [name=fechaPrimeraCuota]', '2026-09-10'); await page.fill('#movFin [name=comisionApertura]', '30');
    await page.dispatchEvent('#movFin [name=plazo]', 'input');
    ok((await page.textContent('#movFin .fin-preview')).includes('TAE calculada'), 'compra financiada: vista previa con cuota y TAE');
    await page.click('#movForm button[type=submit]'); await page.waitForFunction(() => !document.querySelector('#movDialog').open, null, { timeout: 5000 }).catch(() => {});
    const fin = await S(() => { const S = FinanzasApp.Store, d = S.list('deudas')[0], m = S.getMovimientos().find(x => x.descripcion === 'Sofá a plazos'), r = d ? FinanzasApp.Calc.deuda(d) : { filas: [], error: document.querySelector('#movError') && document.querySelector('#movError').textContent }; return { d: !!d, vinc: m && m.financiadoPor === d.id, cuota: r.cuota, tae: r.tae, filas: r.filas.length }; });
    ok(fin.d && fin.vinc && fin.filas === 12 && Math.abs(fin.cuota - 105.22) < 0.02 && fin.tae > 0.099 && fin.tae < 0.16, 'deuda creada y vinculada; cuota 105,22 € y TAE con comisión ' + JSON.stringify(fin));
    await page.click('nav.tabs button[data-view=deudas]');
    ok(await page.isVisible('[data-deu-pagar-hasta]'), 'deudas: aviso de cuotas vencidas con «Marcar pagadas hasta hoy»');
    await page.click('[data-deu-pagar-hasta]'); await sleep(200);
    const pag = await S(() => FinanzasApp.Store.getMovimientos().filter(m => m.deudaId).map(m => [m.cuotaN, m.fecha, m.desglose && m.desglose.interes]));
    const hoy = await S(() => FinanzasApp.todayISO());
    const vencidas = ['2026-09-10', '2026-10-10', '2026-11-10', '2026-12-10'].filter(f => f <= hoy);
    ok(pag.length === vencidas.length && pag[0][1] === '2026-09-10' && pag.every(p => p[2] > 0), 'cuotas vencidas registradas como gastos con interés ' + JSON.stringify({ pag, hoy }));
    const rm = await S(() => FinanzasApp.Calc.resumenMes(FinanzasApp.Store.getMovimientos(), '2026-08'));
    ok(rm.gastos === 0, 'la compra financiada no cuenta como gasto del mes (cuentan las cuotas) ' + JSON.stringify({ g: rm.gastos }));
    await page.screenshot({ path: SHOTS + '/deudas.png' });

    // Día de cobro: préstamo que se cobra el último día del mes (hoy = fecha real del sistema)
    {
      const ref = await S(() => { const t = new Date(); const p = n => String(n).padStart(2, '0'); return `${t.getFullYear()}-${p(t.getMonth() + 1)}-${p(t.getDate())}`; });
      const ym = (iso, k) => { let y = +iso.slice(0, 4), m = +iso.slice(5, 7) - 1 + k; y += Math.floor(m / 12); m = ((m % 12) + 12) % 12; return `${y}-${String(m + 1).padStart(2, '0')}`; };
      const ult = mm => `${mm}-${String(new Date(+mm.slice(0, 4), +mm.slice(5, 7), 0).getDate()).padStart(2, '0')}`;
      const m0 = ym(ref, -3);  // primera cuota hace 3 meses
      await page.click('#addDeudaBtn');
      { const dc = await page.inputValue('#deudaFin [name=diaCobro]'), f1 = await page.inputValue('#deudaFin [name=fechaPrimeraCuota]'); ok(dc === String(+f1.slice(8, 10)), 'nueva deuda: el día de cobro sigue a la fecha de la 1.ª cuota ' + JSON.stringify({ dc, f1 })); }
      await page.fill('#deudaForm [name=nombre]', 'Préstamo fin de mes');
      await page.fill('#deudaFin [name=principal]', '2.400'); await page.fill('#deudaFin [name=tin]', '6'); await page.fill('#deudaFin [name=plazo]', '24');
      await page.fill('#deudaFin [name=fechaPrimeraCuota]', m0 + '-05');
      ok(await page.inputValue('#deudaFin [name=diaCobro]') === '5', 'nueva deuda: al cambiar la fecha, el día de cobro pasa a 5');
      await page.selectOption('#deudaFin [name=diaCobro]', 'ultimo');
      const prev = await page.textContent('#deudaFin .fin-preview');
      ok(prev.includes('último día de cada mes'), 'vista previa: indica «el último día de cada mes» ' + JSON.stringify(prev.slice(0, 120)));
      await page.fill('#deudaFin [name=fechaPrimeraCuota]', m0 + '-12');
      ok(await page.inputValue('#deudaFin [name=diaCobro]') === 'ultimo', 'el día de cobro elegido no se pisa al cambiar la fecha');
      await page.click('#deudaForm button[type=submit]'); await sleep(200);
      const dd = await S(() => { const d = FinanzasApp.Store.list('deudas').find(x => x.nombre === 'Préstamo fin de mes'); const r = FinanzasApp.Calc.deuda(d); return { dc: d.diaCobro, f1: d.fechaPrimeraCuota, fechas: r.filas.slice(0, 6).map(f => f.fecha), venc: r.vencidas.map(f => f.fecha), prox: r.proximas.map(f => f.fecha), cuota: r.cuota }; });
      const esperadas = [0, 1, 2, 3, 4, 5].map(k => ult(ym(m0 + '-01', k)));
      ok(dd.dc === 'ultimo' && dd.f1 === esperadas[0] && JSON.stringify(dd.fechas) === JSON.stringify(esperadas), 'cuadro: cuotas el último día de cada mes ' + JSON.stringify(dd));
      ok(Math.abs(dd.cuota - 106.37) < 0.02, 'el día de cobro no cambia la cuota (106,37 €) ' + dd.cuota);
      const vencEsperadas = esperadas.filter(f => f <= ref);
      ok(JSON.stringify(dd.venc) === JSON.stringify(vencEsperadas), 'vencidas según el día de cobro ' + JSON.stringify(dd.venc));
      const card = page.locator('.card.deuda', { hasText: 'Préstamo fin de mes' });
      ok((await card.textContent()).includes('Se cobra el último día de cada mes'), 'tarjeta: muestra el día de cobro');
      const fmt = iso => iso.slice(8, 10) + '/' + iso.slice(5, 7) + '/' + iso.slice(0, 4);
      const tProx = await card.locator('table').first().textContent();
      ok(tProx.includes(fmt(dd.prox[0])) || tProx.includes(new Date(dd.prox[0] + 'T12:00').toLocaleDateString('es-ES')), 'próximas cuotas con fechas de fin de mes ' + JSON.stringify(dd.prox));
      await card.locator('[data-deu-cuadro]').click(); await sleep(150);
      const tCuadro = await page.textContent('#cuadroBody');
      const enCuadro = esperadas.every(f => tCuadro.includes(fmt(f)) || tCuadro.includes(new Date(f + 'T12:00').toLocaleDateString('es-ES')));
      ok(enCuadro, 'cuadro de amortización (pantalla) con las fechas de fin de mes');
      await page.evaluate(() => document.querySelector('#cuadroDialog').close());
      await card.locator('[data-deu-pagar-hasta]').click(); await sleep(250);
      const gastos = await S(() => { const d = FinanzasApp.Store.list('deudas').find(x => x.nombre === 'Préstamo fin de mes'); return FinanzasApp.Store.getMovimientos().filter(m => m.deudaId === d.id).sort((a, b) => a.cuotaN - b.cuotaN).map(m => m.fecha); });
      ok(JSON.stringify(gastos) === JSON.stringify(vencEsperadas), '«Marcar pagadas hasta hoy»: gastos con fecha de fin de mes ' + JSON.stringify(gastos));
      // Cambiar el día de cobro a principio de mes recalcula las fechas
      await card.locator('[data-deu-edit]').click();
      ok(await page.inputValue('#deudaFin [name=diaCobro]') === 'ultimo', 'editar: conserva «Último día del mes»');
      await page.selectOption('#deudaFin [name=diaCobro]', '1');
      await page.click('#deudaForm button[type=submit]'); await sleep(200);
      const d1 = await S(() => { const d = FinanzasApp.Store.list('deudas').find(x => x.nombre === 'Préstamo fin de mes'); return { dc: d.diaCobro, fechas: FinanzasApp.Calc.deuda(d).filas.slice(0, 3).map(f => f.fecha) }; });
      ok(d1.dc === 1 && JSON.stringify(d1.fechas) === JSON.stringify([0, 1, 2].map(k => ym(m0 + '-01', k) + '-01')), 'día de cobro 1: cuotas a principio de mes ' + JSON.stringify(d1));
      // Migración: una deuda guardada sin diaCobro (versión anterior) toma el día de su 1.ª cuota
      const mig = await S(async () => { const S = FinanzasApp.Store; const d = await S.put('deudas', { nombre: 'Antigua', medio: 'prestamo', principal: 1000, tin: 5, plazo: 6, fechaPrimeraCuota: '2026-01-31' }); const x = S.list('deudas').find(v => v.nombre === 'Antigua'); return { dc: x.diaCobro, fechas: FinanzasApp.Calc.deuda(x).filas.map(f => f.fecha) }; });
      ok(mig.dc === 31 && JSON.stringify(mig.fechas) === JSON.stringify(['2026-01-31', '2026-02-28', '2026-03-31', '2026-04-30', '2026-05-31', '2026-06-30']), 'migración: deuda sin día de cobro conserva sus fechas ' + JSON.stringify(mig));
      await S(() => { const S = FinanzasApp.Store; return S.remove ? S.remove('deudas', S.list('deudas').find(v => v.nombre === 'Antigua').id) : null; }).catch(() => {});
    }

    // Recurrente v3.11: ya no genera movimientos solos
    await page.click('nav.tabs button[data-view=movimientos]'); await page.click('#addRecBtn');
    await page.fill('#recForm [name=importe]', '650'); await page.selectOption('#recForm [name=categoria]', 'Vivienda');
    await page.fill('#recForm [name=descripcion]', 'Alquiler'); await page.selectOption('#recForm [name=dia]', '1'); await page.fill('#recForm [name=desde]', '2026-08');
    await page.click('#recForm button[type=submit]'); await sleep(200);
    const nRec = () => S(() => FinanzasApp.Store.getMovimientos().filter(m => m.recurrenteId).length);
    const nPlant = () => S(() => FinanzasApp.Store.list('recurrentes').filter(r => r.descripcion === 'Alquiler').length);
    ok(await nPlant() === 1, 'recurrente: se guarda la plantilla de Alquiler');
    ok(await nRec() === 0, 'recurrente: no crea movimientos al guardar la plantilla');
    await page.reload({ waitUntil: 'networkidle' });
    await S(() => FinanzasApp.Store.generarRecurrentes());
    ok(await nRec() === 0, 'recurrente: al recargar no se generan movimientos solos');
    // Vincular un movimiento al recurrente y al periodo del mes actual
    const recId = await S(() => FinanzasApp.Store.list('recurrentes').find(r => r.descripcion === 'Alquiler').id);
    await page.click('#fabAdd');
    await page.fill('#mImporte', '650'); await page.fill('#mFecha', new Date().toISOString().slice(0, 10));
    await page.selectOption('#mCategoria', 'Vivienda'); await page.fill('#mDescripcion', 'Alquiler noviembre');
    await page.selectOption('#mRecurrente', recId);
    const per = await page.inputValue('#mRecPeriodo');
    ok(per === new Date().toISOString().slice(0, 7), 'el periodo por defecto es el mes del movimiento ' + per);
    await page.click('#movForm button[type=submit]'); await sleep(200);
    const vin = await S(() => { const m = FinanzasApp.Store.getMovimientos().find(x => x.descripcion === 'Alquiler noviembre'); return m && { id: m.recurrenteId, per: m.recurrentePeriodo, imp: m.importe }; });
    ok(vin && vin.id === recId && vin.per === new Date().toISOString().slice(0, 7) && vin.imp === 650, 'movimiento vinculado al recurrente y al mes ' + JSON.stringify(vin));

    // Garantía que caduca pronto -> banner, enlace a Calendar
    await page.click('#fabAdd');
    await page.fill('#mImporte', '399'); await page.fill('#mFecha', '2023-11-20'); await page.selectOption('#mCategoria', 'Hogar');
    await page.fill('#mDescripcion', 'Frigorífico'); await page.check('#movForm [name=esGar]');
    await page.fill('#movForm [name=garProducto]', 'Frigorífico LG'); await page.fill('#movForm [name=garAnios]', '3');
    await page.click('#movForm button[type=submit]'); await sleep(200);
    ok(await page.isVisible('#garantiaBanner') && (await page.textContent('#garantiaBanner')).includes('Frigorífico LG'), 'banner de garantía próxima a caducar');
    await page.click('nav.tabs button[data-view=garantias]');
    const cal = await page.getAttribute('#garBody a[href*="calendar.google.com"]', 'href');
    ok(cal && cal.includes('dates=20261120') && decodeURIComponent(cal).includes('Frigorífico LG'), 'enlace a Google Calendar con la fecha de caducidad');
    await page.screenshot({ path: SHOTS + '/garantias.png' });

    // Inversiones: alta por formulario + importación CSV + FIFO
    await page.click('nav.tabs button[data-view=inversiones]');
    await page.click('#addActivoBtn'); await page.fill('#activoForm [name=nombre]', 'ETF test'); await page.click('#activoForm button[type=submit]');
    if (!(await page.isVisible('#opDialog'))) await page.click('#addOpBtn'); // al crear un activo se abre directamente su primera compra
    await page.selectOption('#opForm [name=activoId]', { label: 'ETF test' }).catch(() => {});
    await page.fill('#opForm [name=fecha]', '2026-01-10'); await page.fill('#opForm [name=participaciones]', '10'); await page.fill('#opForm [name=precio]', '100'); await page.fill('#opForm [name=comisiones]', '1');
    await page.click('#opForm button[type=submit]');
    ok(await S(() => FinanzasApp.Store.list('activos').length === 1 && FinanzasApp.Store.list('operaciones').length === 1), 'inversión: activo y compra añadidos');
    await page.click('#csvBtn');
    fs.writeFileSync('/tmp/ops.csv', await S(() => FinanceCore.PLANTILLA_CSV));
    await page.setInputFiles('#csvFile', '/tmp/ops.csv'); await sleep(200);
    ok(!(await page.isDisabled('#csvImportar')), 'CSV: vista previa lista para importar');
    await page.click('#csvImportar'); await sleep(200);
    const inv = await S(() => { const S = FinanzasApp.Store; const a = S.list('activos').find(x => x.nombre === 'iShares Core MSCI World'); const ops = S.list('operaciones').filter(o => o.activoId === a.id); return { n: S.list('activos').length, ops: S.list('operaciones').length, fifo: FinanceCore.fifo(ops) }; });
    ok(inv.n === 3 && inv.ops === 5, 'CSV importado: 2 activos y 4 operaciones nuevos ' + JSON.stringify({ n: inv.n, ops: inv.ops }));
    const v = inv.fifo.ventas[0];
    ok(v && Math.abs(v.coste - 885) < 0.01 && Math.abs(v.ganancia - 124.5) < 0.01, 'FIFO: coste de la venta incluye la parte proporcional de comisiones ' + JSON.stringify(v && { coste: v.coste, g: v.ganancia }));
    await page.click('#csvBtn'); await page.setInputFiles('#csvFile', '/tmp/ops.csv'); await sleep(200);
    ok((await page.textContent('#csvPreview')).match(/duplicad|ya exist/i) !== null, 'CSV: reimportar el mismo archivo detecta duplicados');
    await page.keyboard.press('Escape');
    await page.screenshot({ path: SHOTS + '/inversiones.png' });

    // Adjunto + OCR con Tesseract (en el navegador) sobre un ticket generado
    await page.click('nav.tabs button[data-view=movimientos]'); await page.click('#addMovBtn');
    await page.setInputFiles('#movOcrFile', TICKET);
    await page.waitForSelector('#ocrPanel [data-ocr-aplicar]', { timeout: 120000 });
    const ocr = await S(() => ({ imp: document.querySelector('#ocrPanel [name=ocrImporte]').value, fecha: document.querySelector('#ocrPanel [name=ocrFecha]').value, quien: document.querySelector('#ocrPanel [name=ocrQuien]').value, prov: document.querySelector('#ocrPanel .ocr-head').textContent }));
    ok(ocr.imp === '493,81' && ocr.fecha === '2026-10-12' && /navegador/.test(ocr.prov), 'OCR Tesseract: total y fecha del ticket generado ' + JSON.stringify(ocr));
    ok(await S(() => document.querySelectorAll('#movAdj .adj').length === 1), 'el ticket queda adjunto al movimiento');
    await page.screenshot({ path: SHOTS + '/ocr-tesseract.png' });
    await page.click('#ocrPanel [data-ocr-aplicar]');
    ok(await page.inputValue('#mImporte') === '493,81' && await page.inputValue('#mFecha') === '2026-10-12', 'OCR: el usuario confirma y se rellenan importe y fecha');
    await page.fill('#mImporte', '493,81'); await page.selectOption('#mCategoria', 'Hogar');
    await page.click('#movForm button[type=submit]'); await sleep(400);
    const adj = await S(async () => { const a = FinanzasApp.Store.list('adjuntos'); return { n: a.length, ocr: !!(a[0] && a[0].ocr && a[0].ocr.texto), owner: a[0] && !!FinanzasApp.Store.get('movimientos', a[0].ownerId), blob: a[0] && !!(await Adjuntos.BlobStore.get(a[0].id)) }; }).catch(e => ({ err: e.message }));
    ok(adj.n === 1 && adj.ocr && adj.owner && adj.blob, 'adjunto guardado con su texto OCR y vinculado ' + JSON.stringify(adj));

    // Gemini (simulado): clave solo en el dispositivo, JSON estructurado, y caída a Tesseract con 429
    await page.click('nav.tabs button[data-view=ajustes]');
    await page.click('label[for=ocrPrefGem]');
    await page.fill('#gemKey', 'AIzaTEST-clave-falsa'); await page.click('#gemGuardar'); await sleep(200);
    const k = await S(() => ({ ls: Object.keys(localStorage).filter(x => localStorage[x].includes('AIzaTEST')), inState: JSON.stringify(FinanzasApp.Store.state).includes('AIzaTEST') }));
    ok(k.ls.length >= 1 && !k.inState, 'clave de Gemini solo en localStorage, nunca en los datos sincronizados ' + JSON.stringify(k));
    await page.screenshot({ path: SHOTS + '/ajustes-ocr.png', fullPage: true });
    await page.click('nav.tabs button[data-view=movimientos]'); await page.click('#addMovBtn');
    await page.setInputFiles('#movOcrFile', TICKET);
    await page.waitForSelector('#ocrPanel [data-ocr-aplicar]', { timeout: 60000 });
    const g = await S(() => ({ prov: document.querySelector('#ocrPanel .ocr-head').textContent, imp: document.querySelector('#ocrPanel [name=ocrImporte]').value, gar: !!document.querySelector('#ocrPanel [name=ocrGar]') }));
    const c0 = gem.calls[0] || { headers: {}, body: {}, url: '' };
    ok(/Gemini/.test(g.prov) && g.imp === '493,81' && g.gar, 'OCR Gemini: propuesta estructurada (importe y garantía) ' + JSON.stringify(g));
    ok(c0.url.endsWith('/v1beta/interactions') && c0.headers['x-goog-api-key'] === 'AIzaTEST-clave-falsa' && !c0.url.includes('AIza') && c0.body.store === false && /^gemini-/.test(c0.body.model || ''), 'petición a Gemini: endpoint Interactions, clave en cabecera, store:false ' + JSON.stringify({ url: c0.url, model: c0.body.model }));
    await page.screenshot({ path: SHOTS + '/ocr-gemini.png' });
    await page.click('#ocrPanel [data-ocr-cerrar]');
    gem.mode = '429';
    await page.setInputFiles('#movOcrFile', TICKET);
    await page.waitForSelector('#ocrPanel [data-ocr-aplicar]', { timeout: 120000 });
    const fb = await S(() => ({ prov: document.querySelector('#ocrPanel .ocr-head').textContent, aviso: (document.querySelector('#ocrPanel .ocr-aviso') || {}).textContent || '', imp: document.querySelector('#ocrPanel [name=ocrImporte]').value }));
    ok(/navegador/.test(fb.prov) && fb.aviso.length > 0 && fb.imp === '493,81', 'Gemini con 429 -> se usa Tesseract y se avisa ' + JSON.stringify(fb));
    await page.click('#ocrPanel [data-ocr-cerrar]');
    // Sugerir categoría (Gemini simulado)
    gem.mode = 'ok';
    await page.fill('#mDescripcion', 'Lavadora Balay'); await page.click('#mSugerir');
    await page.waitForFunction(() => { const e = document.querySelector('#mSugerencia'); return !e.hidden && !/Pensando/.test(e.textContent); }, null, { timeout: 15000 });
    ok((await page.textContent('#mSugerencia')).includes('Hogar'), 'Sugerir categoría: propone «Hogar» ' + JSON.stringify(await page.textContent('#mSugerencia')));
    await page.keyboard.press('Escape');
    await page.evaluate(() => localStorage.clear());
    await ctx.close();
  }

  /* ============ 1c. Vehículos y combustible (v3.3), en móvil ============ */
  {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, locale: 'es-ES', timezoneId: 'Atlantic/Canary', acceptDownloads: true, serviceWorkers: 'block' });
    await modoLocal(ctx);
    const page = await ctx.newPage(); track(page, errors, 'veh');
    await page.goto(BASE + 'index.html');
    await page.evaluate(() => localStorage.clear()); await page.reload({ waitUntil: 'networkidle' });
    const S = (fn, arg) => page.evaluate(fn, arg);
    const fill = async (sel, v) => { await page.fill(sel, ''); await page.type(sel, v); };   // «type» dispara input como al teclear

    ok(await S(() => FinanzasApp.Store.getCategorias('gasto').includes('Combustible')), 'categoría «Combustible» por defecto');
    await page.click('nav.tabs button[data-view=vehiculos]');
    ok(await page.isVisible('#view-vehiculos') && (await page.textContent('#vehLista')).includes('Aún no tienes vehículos'), 'pestaña Vehículos vacía');
    // «⛽ Repostaje» sin vehículos: primero pide el vehículo (matrícula + litros del depósito)
    await page.click('#addRepBtn');
    ok(await page.isVisible('#vehDialog'), 'sin vehículos, «Repostaje» abre «Nuevo vehículo»');
    await page.fill('#vMatricula', '1234 klm'); await page.fill('#vehForm [name=nombre]', 'Seat León');
    await page.click('#vehForm button[type=submit]');
    ok((await page.textContent('#vehError')).includes('depósito'), 'pide la capacidad del depósito');
    await page.fill('#vCapacidad', '50'); await page.fill('#vKm', '98.500'); await page.click('#vehForm button[type=submit]');
    const v1 = await S(() => FinanzasApp.Store.list('vehiculos')[0]);
    ok(v1 && v1.matricula === '1234KLM' && v1.capacidad === 50 && v1.kmIniciales === 98500 && v1.combustible === 'gasoil' && v1.activo && v1.updatedAt > 0, 'vehículo creado (matrícula normalizada) ' + JSON.stringify(v1));
    ok(await page.isVisible('#movDialog') && await S(() => movForm.esComb.checked && movForm.categoria.value === 'Combustible' && movForm.cVehiculo.value) === v1.id && await page.isVisible('#optCombBody'), 'después abre el gasto con ⛽ marcado, categoría Combustible y el vehículo');
    // precio con coma + litros -> importe calculado
    await page.fill('#mFecha', '2026-09-01');
    await fill('#cPrecio', '1,459'); await fill('#cLitros', '40');
    ok(await page.inputValue('#mImporte') === '58,36', 'importe = litros × precio ' + await page.inputValue('#mImporte'));
    await page.fill('#cOdo', '99.100'); await page.fill('#cGasolinera', 'Repsol');
    await page.click('#movForm button[type=submit]'); await page.waitForFunction(() => !document.querySelector('#movDialog').open, null, { timeout: 5000 }).catch(() => {});
    let st = await S(() => ({ m: FinanzasApp.Store.getMovimientos(), r: FinanzasApp.Store.list('repostajes') }));
    ok(st.m.length === 1 && st.r.length === 1 && st.m[0].importe === 58.36 && st.m[0].categoria === 'Combustible' && st.m[0].repostajeId === st.r[0].id && st.r[0].movimientoId === st.m[0].id
      && st.r[0].precioLitro === 1.459 && st.r[0].litros === 40 && st.r[0].odometro === 99100 && st.r[0].lleno && st.r[0].gasolinera === 'Repsol' && st.m[0].descripcion === 'Combustible 1234KLM · Repsol', 'repostaje enlazado a un gasto normal ' + JSON.stringify(st.r[0]));
    // segundo repostaje desde «＋»: elegir la categoría marca ⛽; importe + precio (con punto) -> litros
    await page.click('nav.tabs button[data-view=movimientos]'); await page.click('#fabAdd'); await page.selectOption('#mCategoria', 'Combustible');
    ok(await S(() => movForm.esComb.checked), 'elegir «Combustible» marca el repostaje');
    await page.fill('#mFecha', '2026-09-15'); await fill('#mImporte', '60'); await fill('#cPrecio', '1.500');
    ok(await page.inputValue('#cLitros') === '40', 'litros = importe ÷ precio ' + await page.inputValue('#cLitros') + ' ' + await S(() => JSON.stringify([movForm.importe.value, movForm.cPrecio.value, movForm.esComb.checked, movForm.tipo && movForm.tipo.value, typeof Comb !== 'undefined' && Comb.orden, document.activeElement && document.activeElement.id])));
    await fill('#cKm', '640');
    ok((await page.textContent('#cInfo')).includes('6,25 L/100 km'), 'vista previa del consumo del tramo: ' + await page.textContent('#cInfo'));
    await page.click('#movForm button[type=submit]'); await page.waitForFunction(() => !document.querySelector('#movDialog').open, null, { timeout: 5000 }).catch(() => {});
    await page.click('nav.tabs button[data-view=vehiculos]'); await page.selectOption('#vehPeriodo', 'todo');
    let k = await S(() => ({ g: vkGasto.textContent, e: vkEurKm.textContent, l: vkL100.textContent, p: vkPrecio.textContent, li: vkLitros.textContent, km: vkKm.textContent, a: vkAuto.textContent, u: vkUltimo.textContent }));
    ok(k.g.includes('118,36') && k.e.includes('0,094') && k.l.includes('6,25') && k.p.includes('1,480') && k.li.includes('80,00') && k.km.includes('640') && k.u.includes('15/09/2026'), 'KPIs: gasto, €/km, L/100 km, €/L ponderado, litros, km ' + JSON.stringify(k));
    ok(await page.isHidden('#chartPrecioLitroEmpty') && await page.isHidden('#chartConsumoEmpty') && await S(() => !!Chart.getChart(chartPrecioLitro) && !!Chart.getChart(chartConsumo)), 'gráficos de €/L y consumo');
    ok(await page.locator('#repBody tr').count() === 2 && (await page.textContent('#vehMesesBody')).includes('118,36') && (await page.textContent('#vehAniosBody')).includes('2026'), 'tablas por mes, por año y lista de repostajes');
    ok(await S(() => document.documentElement.scrollWidth <= innerWidth + 1), 'sin desbordamiento horizontal en móvil');
    // badge en Movimientos
    await S(() => FinanzasApp.setMes('2026-09')); await page.click('nav.tabs button[data-view=movimientos]');
    ok((await page.textContent('#movBody')).includes('⛽ 1234KLM'), 'badge ⛽ con la matrícula en Movimientos');
    // editar el gasto: cambiar litros recalcula el importe y el repostaje se actualiza
    const id2 = await S(() => FinanzasApp.Store.getMovimientos().find(m => m.fecha === '2026-09-15').id);
    await page.click(`[data-edit-mov="${id2}"]`);
    ok(await S(() => movForm.esComb.checked && movForm.cKm.value === '640' && movForm.cPrecio.value === '1,5'), 'al editar, se cargan los datos del repostaje');
    await fill('#cLitros', '38');
    ok(await page.inputValue('#mImporte') === '57', 'editar litros recalcula el importe');
    await page.click('#movForm button[type=submit]');
    st = await S(id => ({ m: FinanzasApp.Store.get('movimientos', id), r: FinanzasApp.Store.list('repostajes').find(r => r.movimientoId === id), n: FinanzasApp.Store.list('repostajes').length }), id2);
    ok(st.m.importe === 57 && st.r.litros === 38 && st.r.importe === 57 && st.n === 2, 'editar mantiene gasto y repostaje sincronizados');
    // importe que no cuadra -> error
    await page.click(`[data-edit-mov="${id2}"]`);
    await S(() => { movForm.importe.value = '99,00'; });
    await page.click('#movForm button[type=submit]');
    ok(await page.isVisible('#movError') && (await page.textContent('#movError')).includes('No cuadra'), 'avisa si litros × precio no cuadra con el importe');
    await page.click('#movDialog [data-close]');
    // matrícula repetida
    await page.click('nav.tabs button[data-view=vehiculos]'); await page.click('#addVehBtn');
    await page.fill('#vMatricula', '1234-KLM'); await page.fill('#vCapacidad', '45'); await page.click('#vehForm button[type=submit]');
    ok((await page.textContent('#vehError')).includes('Ya tienes'), 'matrícula única');
    await page.click('#vehDialog [data-close]');
    // segundo vehículo creado desde el propio diálogo del gasto
    await page.click('[data-veh-rep]');
    await page.click('#cNuevoVeh');
    await page.fill('#vMatricula', '5678hjt'); await page.selectOption('#vCombustible', 'gasolina'); await page.fill('#vCapacidad', '42,5'); await page.click('#vehForm button[type=submit]');
    const v2 = await S(() => FinanzasApp.Store.list('vehiculos').find(v => v.matricula === '5678HJT'));
    ok(v2 && v2.capacidad === 42.5 && v2.combustible === 'gasolina' && await S(() => movForm.cVehiculo.value) === v2.id && await page.isVisible('#movDialog'), '«＋ Vehículo» desde el gasto lo crea y lo selecciona');
    await page.fill('#mFecha', '2026-10-02'); await fill('#cPrecio', '1,6'); await fill('#cLitros', '55');
    ok((await page.textContent('#cInfo')).includes('más litros'), 'aviso: más litros de los que caben');
    await page.click('#movForm button[type=submit]');   // confirm aceptado
    ok(await S(() => FinanzasApp.Store.list('repostajes').length === 3), 'se puede guardar tras confirmar el aviso de capacidad');
    await page.selectOption('#vehFiltro', v2.id);
    ok((await page.textContent('#vkGasto')).includes('88,00') && await page.locator('#repBody tr').count() === 1, 'filtro por vehículo');
    await page.selectOption('#vehFiltro', '');
    // exportar / borrar todo / importar
    await page.click('nav.tabs button[data-view=ajustes]');
    const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#exportJsonBtn')]);
    const p = await dl.path(); const exp = JSON.parse(fs.readFileSync(p, 'utf8'));
    ok(exp.vehiculos.length === 2 && exp.repostajes.length === 3, 'exportar JSON incluye vehículos y repostajes');
    await page.click('#resetBtn');
    ok(await S(() => !FinanzasApp.Store.list('vehiculos').length && !FinanzasApp.Store.list('repostajes').length && FinanzasApp.Store.state.vehiculos.every(v => v.deleted)), 'borrar todo deja lápidas también en vehículos y repostajes');
    await page.setInputFiles('#importFile', p); await sleep(300);
    ok(await S(() => FinanzasApp.Store.list('vehiculos').length === 2 && FinanzasApp.Store.list('repostajes').length === 3 && FinanzasApp.Store.getMovimientos().length === 3), 'importar restaura vehículos y repostajes');
    // quitar ⛽ de un gasto: borra el repostaje y conserva el gasto
    const id1 = await S(() => FinanzasApp.Store.getMovimientos().find(m => m.fecha === '2026-09-01').id);
    await S(() => FinanzasApp.setMes('2026-09')); await page.click('nav.tabs button[data-view=movimientos]');
    await page.click(`[data-edit-mov="${id1}"]`); await page.uncheck('#movForm [name=esComb]'); await page.click('#movForm button[type=submit]');
    st = await S(id => ({ m: FinanzasApp.Store.get('movimientos', id), n: FinanzasApp.Store.list('repostajes').length }), id1);
    ok(st.m && !st.m.repostajeId && st.n === 2, 'desmarcar ⛽ borra solo el repostaje');
    // borrar un repostaje desde la pestaña borra también su gasto
    await page.click('nav.tabs button[data-view=vehiculos]'); await page.selectOption('#vehPeriodo', 'todo');
    const r2 = await S(id => FinanzasApp.Store.list('repostajes').find(r => r.movimientoId === id).id, id2);
    await page.click(`[data-rep-del="${r2}"]`);
    ok(await S(([id, r]) => !FinanzasApp.Store.get('movimientos', id) && !FinanzasApp.Store.get('repostajes', r), [id2, r2]), 'borrar un repostaje borra su gasto');
    // borrar el vehículo: se van sus repostajes, los gastos se quedan
    await page.click(`[data-veh-edit="${v2.id}"]`); await page.click('#vehDelete');
    st = await S(() => ({ v: FinanzasApp.Store.list('vehiculos').length, r: FinanzasApp.Store.list('repostajes').length, m: FinanzasApp.Store.getMovimientos().filter(m => m.categoria === 'Combustible').length }));
    ok(st.v === 1 && st.r === 0 && st.m === 2, 'borrar vehículo conserva los gastos ' + JSON.stringify(st));
    await S(() => FinanzasApp.setMes('2026-10')); await page.click('nav.tabs button[data-view=movimientos]');
    ok(!(await page.textContent('#movBody')).includes('⛽'), 'el gasto queda como gasto normal (sin badge)');
    // datos antiguos (v3.2, sin vehículos) cargan intactos
    await S(() => { localStorage.clear(); localStorage.setItem('finanzas_v2', JSON.stringify({ version: 2, movimientos: [{ id: 'a1', tipo: 'gasto', fecha: '2026-08-03', importe: 45.5, categoria: 'Transporte', descripcion: 'Gasolina', cuenta: 'Banco', naturaleza: 'variable', updatedAt: 5 }], categorias: { gasto: ['Transporte', 'Otros'], ingreso: ['Otros'], updatedAt: 5 }, ajustes: { tema: 'light' } })); });
    await page.reload({ waitUntil: 'networkidle' });
    st = await S(() => ({ m: FinanzasApp.Store.getMovimientos(), c: FinanzasApp.Store.getCategorias('gasto'), v: FinanzasApp.Store.state.vehiculos, r: FinanzasApp.Store.state.repostajes }));
    ok(st.m.length === 1 && st.m[0].importe === 45.5 && st.m[0].updatedAt === 5 && st.m[0].descripcion === 'Gasolina' && st.c.join() === 'Transporte,Otros' && Array.isArray(st.v) && !st.v.length && !st.r.length, 'datos antiguos sin vehículos cargan intactos ' + JSON.stringify(st.c));
    await page.click('nav.tabs button[data-view=vehiculos]');
    ok((await page.textContent('#vehLista')).includes('Aún no tienes vehículos'), 'pestaña Vehículos funciona con datos antiguos');
    await page.evaluate(() => localStorage.clear());
    await ctx.close();
  }

  /* ============ 1c2. Gastos del vehículo (v3.10) ============ */
  {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: 'es-ES', timezoneId: 'Atlantic/Canary', serviceWorkers: 'block' });
    await modoLocal(ctx);
    await ctx.clock.install(); await ctx.clock.setFixedTime(new Date('2026-11-10T12:00:00Z'));
    const page = await ctx.newPage(); track(page, errors, 'veh310');
    await page.goto(BASE + 'index.html', { waitUntil: 'networkidle' });
    await page.evaluate(() => localStorage.clear()); await page.reload({ waitUntil: 'networkidle' });
    const S = (fn, arg) => page.evaluate(fn, arg);
    await S(async () => {
      await FinanzasApp.Store.put('vehiculos', { id: 'v-land', matricula: '7447FCG', nombre: 'Land Cruiser', combustible: 'gasoil', capacidad: 85, activo: true, creado: Date.now() });
    });
    await page.evaluate(() => FinanzasApp.setVista('mes'));
    await page.evaluate(() => FinanzasApp.setMes('2026-10'));
    // Gasto ITV: un solo vehículo en uso → se preselecciona
    await page.click('#fabAdd');
    await page.fill('#mImporte', '45,00'); await page.fill('#mFecha', '2026-10-12');
    await page.selectOption('#mCategoria', 'Impuestos').catch(async () => {
      await page.evaluate(() => { const s = document.querySelector('#mCategoria'); if (![...s.options].some(o => o.value === 'Impuestos')) { const o = document.createElement('option'); o.textContent = 'Impuestos'; s.appendChild(o); } s.value = 'Impuestos'; s.dispatchEvent(new Event('change')); });
    });
    await page.fill('#mDescripcion', 'ITV');
    await page.evaluate(() => { document.querySelector('#mDescripcion').dispatchEvent(new Event('change')); document.querySelector('#mDescripcion').dispatchEvent(new Event('blur')); });
    ok(await page.isVisible('#rowVehiculo'), 'selector Vehículo visible en un gasto');
    ok(await S(() => document.querySelector('#mVehiculo').value === 'v-land'), 'ITV preselecciona el único vehículo');
    ok(await page.isHidden('#mVehiculoAviso'), 'sin aviso si solo hay uno');
    await page.click('#movForm button[type=submit]');
    // Segundo vehículo: no preselecciona y avisa
    await S(async () => { await FinanzasApp.Store.put('vehiculos', { id: 'v-otro', matricula: '1111ABC', nombre: 'Otro', combustible: 'gasolina', capacidad: 50, activo: true, creado: Date.now() }); });
    await page.click('#fabAdd');
    await page.fill('#mImporte', '420'); await page.fill('#mFecha', '2026-10-05');
    await page.evaluate(() => { const s = document.querySelector('#mCategoria'); if (![...s.options].some(o => o.value === 'Seguros')) { const o = document.createElement('option'); o.textContent = 'Seguros'; s.appendChild(o); } s.value = 'Seguros'; s.dispatchEvent(new Event('change')); });
    await page.fill('#mDescripcion', 'Seguro coche Mapfre');
    await page.evaluate(() => { document.querySelector('#mDescripcion').dispatchEvent(new Event('change')); document.querySelector('#mDescripcion').dispatchEvent(new Event('blur')); });
    ok(await S(() => document.querySelector('#mVehiculo').value === ''), 'con varios vehículos no se preselecciona');
    ok(await page.isVisible('#mVehiculoAviso'), 'aviso suave si hay varios');
    await page.selectOption('#mVehiculo', 'v-land');
    await page.click('#movForm button[type=submit]');
    // Taller
    await page.click('#fabAdd');
    await page.fill('#mImporte', '280'); await page.fill('#mFecha', '2026-10-20');
    await page.evaluate(() => { const s = document.querySelector('#mCategoria'); if (![...s.options].some(o => o.value === 'Transporte')) { /* ya está */ } s.value = 'Transporte'; s.dispatchEvent(new Event('change')); });
    await page.fill('#mDescripcion', 'Taller frenos');
    await page.selectOption('#mVehiculo', 'v-land');
    await page.click('#movForm button[type=submit]');
    // Peaje SIN asignar (para el asignador)
    await page.click('#fabAdd');
    await page.fill('#mImporte', '12,50'); await page.fill('#mFecha', '2026-10-22');
    await page.evaluate(() => { document.querySelector('#mCategoria').value = 'Transporte'; document.querySelector('#mCategoria').dispatchEvent(new Event('change')); });
    await page.fill('#mDescripcion', 'Peaje TF-5');
    await page.selectOption('#mVehiculo', ''); // explícitamente ninguno
    await page.click('#movForm button[type=submit]');
    const nAsig = await S(() => FinanzasApp.Store.getMovimientos().filter(m => m.vehiculoId === 'v-land').length);
    ok(nAsig === 3, 'tres gastos asignados al Land Cruiser (ITV, seguro, taller), peaje aún no ' + nAsig);
    // Pestaña: periodo octubre, desglose y lista
    await page.click('nav.tabs button[data-view=vehiculos]');
    await page.selectOption('#vehFiltro', 'v-land');
    await page.selectOption('#vehPeriodo', 'app');
    await page.evaluate(() => FinanzasApp.setMes('2026-10'));
    await sleep(200);
    const kpis = await S(() => ({ total: document.querySelector('#vkTotal').textContent, des: document.querySelector('#vehDesglose').innerText, lista: document.querySelector('#vehGastosBody').innerText }));
    ok(/745,00/.test(kpis.total) || /745/.test(kpis.total), 'coste total 745 € (420+45+280) ' + kpis.total);
    ok(/Seguro/.test(kpis.des) && /ITV/.test(kpis.des) && /Mantenimiento/.test(kpis.des), 'desglose por categoría ' + kpis.des);
    ok(/Seguro coche/.test(kpis.lista) && /ITV/.test(kpis.lista) && /Taller frenos/.test(kpis.lista), 'lista de gastos no combustible');
    // Editar desde la lista
    const idItv = await S(() => FinanzasApp.Store.getMovimientos().find(m => m.descripcion === 'ITV').id);
    await page.click(`[data-veh-mov="${idItv}"]`);
    ok(await page.isVisible('#movDialog') && await S(() => document.querySelector('#mVehiculo').value === 'v-land'), 'editar desde la lista abre el movimiento con el vehículo');
    await page.click('#movDialog [data-close]');
    // Asignar gastos: aparece el peaje
    await page.click('#asigVehBtn');
    ok(await page.isVisible('#asigVehDialog'), 'diálogo Asignar gastos');
    ok((await page.textContent('#asigVehBody')).includes('Peaje TF-5'), 'el peaje sin vehículo sale en el asignador');
    await page.selectOption('#asigVehSel', 'v-land');
    await page.click('#asigVehOk');
    ok(await S(() => FinanzasApp.Store.getMovimientos().find(m => m.descripcion.startsWith('Peaje')).vehiculoId === 'v-land'), 'asignación masiva guarda vehiculoId');
    // normalizeState conserva vehiculoId
    ok(await S(() => {
      const m = FinanzasApp.Store.getMovimientos().find(x => x.descripcion === 'ITV');
      const n = FinanzasApp.normalizeState({ version: 3, movimientos: [m], vehiculos: FinanzasApp.Store.state.vehiculos, categorias: FinanzasApp.Store.state.categorias, ajustes: {} });
      return n.movimientos[0].vehiculoId === 'v-land';
    }), 'normalizeState conserva vehiculoId');
    // borrar vehículo: el gasto se queda, sin asignación
    await page.click('[data-veh-edit="v-land"]');
    await page.click('#vehDelete');
    const after = await S(() => {
      const m = FinanzasApp.Store.getMovimientos().find(x => x.descripcion === 'ITV');
      return { v: !!FinanzasApp.Store.get('vehiculos', 'v-land'), vid: m && m.vehiculoId, imp: m && m.importe };
    });
    ok(!after.v && !after.vid && after.imp === 45, 'borrar vehículo quita la asignación y conserva el gasto ' + JSON.stringify(after));
    await page.evaluate(() => localStorage.clear());
    await ctx.close();
  }

  /* ============ 1d. Cuentas, traspasos y traspasos entre fondos (v3.4), en móvil ============ */
  {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, locale: 'es-ES', timezoneId: 'Atlantic/Canary', acceptDownloads: true, serviceWorkers: 'block' });
    await modoLocal(ctx);
    const page = await ctx.newPage(); track(page, errors, 'cuentas');
    await page.goto(BASE + 'index.html');
    const S = (fn, arg) => page.evaluate(fn, arg);
    const fill = async (sel, v) => { await page.fill(sel, ''); await page.type(sel, v); };
    const saldo = nombre => S(n => { const s = FinanzasApp.Calc.saldos(); const x = s.lista.find(x => x.cuenta.nombre === n); return x ? x.saldo : null; }, nombre);
    // Datos «antiguos» (v3.3): cuenta escrita a mano, 2 fondos con compras, sin colecciones nuevas
    const viejo = { version: 2, movimientos: [
        { id: 'n1', tipo: 'ingreso', fecha: '2026-09-01', importe: 2000, categoria: 'Nómina', descripcion: 'Nómina', cuenta: 'Nómina BBVA', tipoIngreso: 'nomina', updatedAt: 5 },
        { id: 'g1', tipo: 'gasto', fecha: '2026-09-03', importe: 100, categoria: 'Supermercado', descripcion: 'Súper', cuenta: 'Nómina BBVA', naturaleza: 'variable', updatedAt: 5 },
        { id: 'g2', tipo: 'gasto', fecha: '2026-10-02', importe: 30, categoria: 'Ocio', descripcion: 'Cine', cuenta: '', naturaleza: 'variable', updatedAt: 5 }],
      activos: [{ id: 'fA', nombre: 'Fidelity A', tipo: 'fondo', updatedAt: 5 }, { id: 'fB', nombre: 'Fidelity B', tipo: 'fondo', updatedAt: 5 }, { id: 'btc', nombre: 'Bitcoin', tipo: 'cripto', updatedAt: 5 }],
      operaciones: [{ id: 'o1', activoId: 'fA', tipo: 'compra', fecha: '2026-03-10', participaciones: 10, precio: 20, comisiones: 0, creado: 1, updatedAt: 5 },
        { id: 'o2', activoId: 'fA', tipo: 'compra', fecha: '2026-06-10', participaciones: 10, precio: 30, comisiones: 0, creado: 2, updatedAt: 5 }],
      precios: [], categorias: { gasto: ['Supermercado', 'Ocio', 'Otros'], ingreso: ['Nómina', 'Otros'], updatedAt: 5 }, ajustes: { tema: 'light' } };
    await S(v => { localStorage.clear(); localStorage.setItem('finanzas_v2', JSON.stringify(v)); }, viejo);
    await page.reload({ waitUntil: 'networkidle' });
    let st = await S(() => ({ m: FinanzasApp.Store.getMovimientos().map(m => [m.id, m.importe, m.cuenta, m.updatedAt, 'cuentaId' in m]), o: FinanzasApp.Store.list('operaciones').length, c: FinanzasApp.Store.state.cuentas, t: FinanzasApp.Store.state.traspasosFondos }));
    ok(st.m.length === 3 && st.m.every(m => m[3] === 5 && !m[4]) && st.m.find(m => m[0] === 'n1')[2] === 'Nómina BBVA' && st.o === 2 && Array.isArray(st.c) && !st.c.length && Array.isArray(st.t), 'v3.4: datos antiguos cargan intactos (sin cuentaId, colecciones nuevas vacías)');
    await page.click('nav.tabs button[data-view=cuentas]');
    ok(await page.isVisible('#view-cuentas') && await page.isVisible('[data-cu-crear-nombre="Nómina BBVA"]'), 'pestaña Cuentas ofrece crear «Nómina BBVA» desde el texto antiguo');
    // Crear la cuenta desde el nombre antiguo: fecha del saldo = primer apunte
    await page.click('[data-cu-crear-nombre="Nómina BBVA"]');
    ok(await page.inputValue('#cuNombre') === 'Nómina BBVA' && await page.inputValue('#cuFecha') === '2026-09-01', 'diálogo prellenado con nombre y fecha del primer apunte');
    await fill('#cuSaldo', '1.000,00'); await page.selectOption('#cuTipo', 'corriente'); await fill('#cuIban', 'ES12 3456 7890 1234 5678');
    await page.click('#cuentaForm button[type=submit]');
    st = await S(() => FinanzasApp.Store.list('cuentas')[0]);
    ok(st && st.saldoInicial === 1000 && st.iban === '5678' && st.fechaSaldo === '2026-09-01', 'cuenta creada; del IBAN solo se guardan los 4 últimos dígitos ' + JSON.stringify(st && st.iban));
    ok(await saldo('Nómina BBVA') === 2900, 'los apuntes con el texto antiguo se asignan solos: 1000 + 2000 − 100 = 2900');
    // Más cuentas: inversión y efectivo
    const nueva = async (nombre, tipo, saldoIni, fecha) => { await page.click('#addCuentaBtn'); await fill('#cuNombre', nombre); await page.selectOption('#cuTipo', tipo); await fill('#cuSaldo', saldoIni); await page.fill('#cuFecha', fecha); await page.click('#cuentaForm button[type=submit]'); };
    await nueva('Cuenta inversión', 'inversion', '0', '2026-09-01');
    await nueva('Cartera', 'efectivo', '80', '2026-09-01');
    await page.click('#addCuentaBtn'); await fill('#cuNombre', 'nómina bbva'); await page.click('#cuentaForm button[type=submit]');
    ok(await page.isVisible('#cuentaError') && await S(() => FinanzasApp.Store.list('cuentas').length) === 3, 'nombre de cuenta repetido: error');
    await page.click('#cuentaDialog [data-close]');
    ok(await S(() => document.querySelectorAll('#cuentasGrid .cuenta-card[style]').length) === 3, '3 tarjetas de cuenta en la pestaña');
    // Traspaso nómina -> inversión con comisión
    const ids = await S(() => Object.fromEntries(FinanzasApp.Store.list('cuentas').map(c => [c.nombre, c.id])));
    const antes = await S(() => FinanzasApp.Calc.resumenMes(FinanzasApp.Store.getMovimientos(), '2026-10'));
    await page.click('#addTraspasoBtn');
    await page.selectOption('#trOrigen', ids['Nómina BBVA']); await page.selectOption('#trDestino', ids['Cuenta inversión']);
    await fill('#trImporte', '500'); await page.fill('#trFecha', '2026-10-05'); await fill('#trComision', '1,5'); await page.fill('#trNota', 'Para invertir');
    await page.click('#traspasoForm button[type=submit]');
    const despues = await S(() => FinanzasApp.Calc.resumenMes(FinanzasApp.Store.getMovimientos(), '2026-10'));
    ok(await S(() => FinanzasApp.Store.list('traspasos').length) === 1 && await saldo('Nómina BBVA') === 2398.5 && await saldo('Cuenta inversión') === 500, 'traspaso: −500 −1,50 en origen, +500 en destino');
    ok(despues.ingresos === antes.ingresos && round(despues.gastos - antes.gastos) === 1.5, 'el traspaso no es gasto ni ingreso; solo la comisión (1,50 €) es gasto ' + JSON.stringify([antes.gastos, despues.gastos]));
    await page.click('nav.tabs button[data-view=resumen]'); await S(() => FinanzasApp.setMes('2026-10'));
    ok((await page.textContent('#kpiTraspasos')).includes('500') && !(await page.isHidden('#kpiTraspasos')), 'Resumen: aviso de traspasos excluidos');
    ok(await page.isVisible('#patrimonioCard') && (await page.textContent('#patrimonioBody')).includes('Cuenta inversión'), 'Resumen: tarjeta Patrimonio con las cuentas');
    // Gasto desde una cuenta: selector «Cuenta»
    await page.click('#fabAdd');
    ok(await page.isVisible('#movForm select.cuenta-sel') && await page.isHidden('#movForm [name=cuenta]'), 'formulario de gasto: selector de cuenta (texto libre oculto)');
    await fill('#mImporte', '20'); await page.fill('#mFecha', '2026-10-07'); await page.selectOption('#mCategoria', 'Ocio');
    await page.selectOption('#movForm select.cuenta-sel', ids['Cartera']); await page.click('#movForm button[type=submit]');
    st = await S(() => FinanzasApp.Store.getMovimientos().find(m => m.fecha === '2026-10-07'));
    ok(st.cuentaId === ids['Cartera'] && st.cuenta === 'Cartera' && await saldo('Cartera') === 60, 'gasto en efectivo: sale de la cartera (80 − 20 = 60)');
    await page.click('#fabAdd');
    ok(await page.inputValue('#movForm select.cuenta-sel') === ids['Cartera'], 'el siguiente gasto propone la última cuenta usada');
    await page.click('#movDialog [data-close]');
    // Compra de inversión desde la cuenta de inversión: no es gasto
    await S(() => openOpDialog(null, 'fA'));
    ok(await page.isVisible('#opCuentaRow') && !(await page.isDisabled('#opCuenta')), 'operación: selector de cuenta visible');
    await page.fill('#opForm [name=fecha]', '2026-10-10'); await fill('#opForm [name=participaciones]', '10'); await fill('#opForm [name=precio]', '40'); await fill('#opForm [name=comisiones]', '2');
    await page.selectOption('#opCuenta', ids['Cuenta inversión']); await page.click('#opForm button[type=submit]');
    const tras = await S(() => FinanzasApp.Calc.resumenMes(FinanzasApp.Store.getMovimientos(), '2026-10'));
    ok(await saldo('Cuenta inversión') === 98 && tras.gastos === despues.gastos + 20, 'compra de 10 × 40 € + 2 € comisión: −402 € en la cuenta de inversión, sin gasto');
    await page.click('nav.tabs button[data-view=resumen]');
    ok((await page.textContent('#kpiInvertido')).includes('402'), 'Resumen: «dinero invertido» del mes separado del gasto ' + await page.textContent('#kpiInvertido'));
    // Ajustar saldo de la cartera: no es ingreso ni gasto
    await page.click('nav.tabs button[data-view=cuentas]');
    await page.click(`[data-cu-ajustar="${ids['Cartera']}"]`); await page.fill('#ajFecha', '2026-10-20'); await fill('#ajSaldo', '55'); 
    ok((await page.textContent('#ajPreview')).includes('5,00'), 'vista previa del ajuste (−5 €)');
    await page.click('#ajusteForm button[type=submit]');
    const tras2 = await S(() => FinanzasApp.Calc.resumenMes(FinanzasApp.Store.getMovimientos(), '2026-10'));
    ok(await saldo('Cartera') === 55 && tras2.gastos === tras.gastos && await S(() => FinanzasApp.Store.list('regularizaciones')[0].importe) === -5, 'ajuste de saldo: cartera a 55 €, sin tocar gastos');
    // Movimientos de la cuenta
    await page.click(`[data-cu-ver="${ids['Cuenta inversión']}"]`);
    const cd = await page.textContent('#cdBody');
    ok(cd.includes('Para invertir') && cd.includes('Fidelity A') && cd.includes('98,00'), 'lista de movimientos de la cuenta con traspaso, compra y saldo');
    // Asignar cuenta a operaciones antiguas (solo desde una fecha)
    await S(() => FinanzasApp.openDetalle('fA')); await page.click('#detAsignar');
    await page.selectOption('#asCuenta', ids['Cuenta inversión']); await page.fill('#asDesde', '2026-06-01'); await page.dispatchEvent('#asDesde', 'input');
    await page.click('#asignarForm button[type=submit]');
    st = await S(() => FinanzasApp.Store.list('operaciones').map(o => [o.id, o.cuentaId || null]));
    ok(st.find(o => o[0] === 'o1')[1] === null && st.find(o => o[0] === 'o2')[1] === ids['Cuenta inversión'], 'asignar cuenta solo desde la fecha indicada ' + JSON.stringify(st));
    // Traspaso entre fondos: todas las participaciones de A -> B
    await page.click('#detTraspaso');
    ok(await page.isVisible('#tfDialog') && await page.inputValue('#tfOrigen') === 'fA', 'traspaso entre fondos desde la ficha del fondo');
    ok(!(await S(() => [...document.querySelectorAll('#tfDestino option')].some(o => o.value === 'btc'))), 'solo fondos como destino (no cripto)');
    await page.selectOption('#tfDestino', 'fB'); await page.fill('#tfFecha', '2026-10-15'); await page.check('#tfForm [name=todas]');
    await fill('#tfVlO', '42'); await fill('#tfVlD', '210'); await fill('#tfPartD', '6');
    ok((await page.textContent('#tfPreview')).includes('30'), 'vista previa: 30 participaciones disponibles');
    await page.click('#tfForm button[type=submit]');
    const cart = await S(() => { const m = FinanzasApp.Calc.cartera ? null : null; const cf = FinanceCore.carteraFIFO(FinanzasApp.Store.list('operaciones'), FinanzasApp.Store.list('traspasosFondos')); const b = cf.porActivo.fB, a = cf.porActivo.fA; return { bp: b.participaciones, bc: b.costeRestante, lot: b.lotes.map(l => [l.fecha, l.origen && l.origen.activoId]), ap: a.participaciones, g: a.gananciaRealizada + b.gananciaRealizada }; });
    ok(cart.bp === 6 && cart.bc === 902 && cart.ap === 0 && cart.g === 0 && cart.lot.length === 3 && cart.lot[0][0] === '2026-03-10' && cart.lot.every(l => l[1] === 'fA'), 'el fondo destino hereda coste (902 €) y fechas FIFO, sin ganancia ' + JSON.stringify(cart));
    ok(await saldo('Cuenta inversión') === 98, 'el traspaso entre fondos no mueve dinero de ninguna cuenta');
    await S(() => FinanzasApp.openDetalle('fB'));
    ok((await page.textContent('#detDialog')).includes('procedente de traspaso de Fidelity A'), 'lotes del destino: «procedente de traspaso de Fidelity A»');
    // Venta posterior en B que depende del traspaso -> no se puede borrar el traspaso
    await S(() => FinanzasApp.Store.put('operaciones', { id: 'v1', activoId: 'fB', tipo: 'venta', fecha: '2026-10-25', participaciones: 4, precio: 220, comisiones: 0, creado: 9 }));
    await S(() => FinanzasApp.openDetalle('fB'));
    const tfId = await S(() => FinanzasApp.Store.list('traspasosFondos')[0].id);
    await page.click(`#detTraspasos [data-tf-del="${tfId}"]`); await sleep(200);
    ok(await S(() => FinanzasApp.Store.list('traspasosFondos').length) === 1, 'no se borra un traspaso entre fondos si una venta posterior depende de él');
    st = await S(() => FinanceCore.carteraFIFO(FinanzasApp.Store.list('operaciones'), FinanzasApp.Store.list('traspasosFondos')).porActivo.fB.ventas[0]);
    ok(Math.abs(st.coste - (200 + 300)) < 0.02 && st.consumos[0].fecha === '2026-03-10', 'la venta usa el coste y la fecha heredados, por lotes FIFO (2 lotes más antiguos: 200 + 300) ' + JSON.stringify([st.coste, st.consumos[0].fecha]));
    await S(() => document.querySelectorAll('dialog[open]').forEach(d => d.close()));
    // Exportar / borrar todo / importar
    const exp = JSON.parse(await S(() => FinanzasApp.Store.exportJSON()));
    ok(exp.cuentas.length === 3 && exp.traspasos.length === 1 && exp.regularizaciones.length === 1 && exp.traspasosFondos.length === 1, 'exportar JSON incluye cuentas, traspasos, ajustes y traspasos entre fondos');
    const csvMov = await S(() => FinanzasApp.movimientosCSV(FinanzasApp.Store.getMovimientos()));
    ok(csvMov.includes('"Cartera"') && csvMov.includes('"Nómina BBVA"'), 'CSV de movimientos con la cuenta');
    await S(() => FinanzasApp.Store.reset());
    ok(await S(() => !FinanzasApp.Store.list('cuentas').length && !FinanzasApp.Store.list('traspasos').length && !FinanzasApp.Store.list('traspasosFondos').length), 'borrar todo vacía también cuentas y traspasos');
    await S(t => FinanzasApp.Store.importJSON(t), JSON.stringify(exp));
    ok(await saldo('Cartera') === 55 && await saldo('Cuenta inversión') === 98 && await S(() => FinanzasApp.Store.list('traspasosFondos').length) === 1, 'importar restaura cuentas y saldos');
    // Borrar una cuenta usada: los apuntes quedan sin cuenta, sus traspasos se borran (con su comisión)
    await page.click('nav.tabs button[data-view=cuentas]');
    const nIds = await S(() => Object.fromEntries(FinanzasApp.Store.list('cuentas').map(c => [c.nombre, c.id])));
    await page.click(`[data-cu-edit="${nIds['Cuenta inversión']}"]`); await page.click('#cuentaDelete'); await sleep(200);
    st = await S(() => ({ c: FinanzasApp.Store.list('cuentas').length, t: FinanzasApp.Store.list('traspasos').length, com: FinanzasApp.Store.getMovimientos().filter(m => m.traspasoId).length, op: FinanzasApp.Store.list('operaciones').filter(o => o.cuentaId).length }));
    ok(st.c === 2 && st.t === 0 && st.com === 0 && st.op === 0, 'borrar cuenta: desvincula operaciones y borra sus traspasos y comisiones ' + JSON.stringify(st));
    await page.evaluate(() => localStorage.clear());
    await ctx.close();
  }

  /* ============ 1e. Deudas: «Calcular cuotas» y «Cuota manual» (v3.5) ============ */
  {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: 'es-ES', timezoneId: 'Atlantic/Canary', acceptDownloads: true, serviceWorkers: 'block' });
    await modoLocal(ctx);
    const page = await ctx.newPage(); track(page, errors, 'deuda-modos');
    await page.goto(BASE + 'index.html');
    const S = (fn, arg) => page.evaluate(fn, arg);
    const fill = async (sel, v) => { await page.fill(sel, ''); await page.type(sel, v); };
    const visible = sel => page.isVisible(sel);
    // Datos «antiguos» (v3.4): una deuda sin modo y una cuenta
    const viejo = { version: 2, movimientos: [], cuentas: [{ id: 'cBanco', nombre: 'Banco', tipo: 'corriente', saldoInicial: 1000, fechaSaldo: '2026-01-01', updatedAt: 5 }],
      deudas: [{ id: 'dOld', nombre: 'Préstamo viejo', medio: 'prestamo', principal: 3000, tin: 5, plazo: 12, fechaInicio: '2026-01-01', fechaPrimeraCuota: '2026-02-10', diaCobro: 10, comisionApertura: 0, comisionMensual: 0, taeIntroducida: null, movimientoId: null, categoria: 'Deudas', cuenta: '', notas: '', updatedAt: 5 }],
      categorias: { gasto: ['Deudas', 'Electrónica', 'Otros'], ingreso: ['Otros'], updatedAt: 5 }, ajustes: { tema: 'light' } };
    await S(v => { localStorage.clear(); localStorage.setItem('finanzas_v2', JSON.stringify(v)); }, viejo);
    await page.reload({ waitUntil: 'networkidle' });
    let st = await S(() => { const d = FinanzasApp.Store.get('deudas', 'dOld'), r = FinanzasApp.Calc.deuda(d); return { modo: r.modo, cuota: r.cuota, f: FinanceCore.cuotaFrancesa(3000, 5, 12), tieneModo: 'modo' in d, n: r.filas.length }; });
    ok(st.modo === 'calculado' && !st.tieneModo && Math.abs(st.cuota - st.f) < 0.006 && st.n === 12, 'v3.5: una deuda antigua (sin modo) sigue en «Calcular cuotas» con las mismas cuotas ' + JSON.stringify(st));
    await page.click('nav.tabs button[data-view=deudas]');
    await page.click('[data-deu-edit="dOld"]');
    ok(await page.isChecked('#deudaFin-modoCalc') && !(await visible('#deudaFin [name=cuotaManual]')) && await visible('#deudaFin [name=comisionApertura]'), 'editar deuda antigua: abre en «Calcular cuotas» (campos de cuota manual ocultos)');
    await S(() => document.querySelector('#deudaDialog').close());

    // Nueva deuda: por defecto «Calcular cuotas»
    const hoy = await S(() => FinanceCore.addDaysISO(new Date().toISOString().slice(0, 10), 0));
    const FCd = (f, ...a) => S(([f, a]) => FinanceCore[f](...a), [f, a]);
    const primeroManual = await FCd('fechaCuota', await FCd('addMonthsISO', hoy, -3), 1, 10);   // hace 3 meses, día 10
    await page.click('#addDeudaBtn');
    ok(await page.isChecked('#deudaFin-modoCalc') && await visible('#deudaFin [name=tin]') && !(await visible('#deudaFin .fin-cuotas')), 'nueva deuda: modo «Calcular cuotas» por defecto');
    await fill('#deudaForm [name=nombre]', 'Préstamo calc');
    await fill('#deudaFin [name=principal]', '6.000'); await fill('#deudaFin [name=tin]', '7'); await fill('#deudaFin [name=plazo]', '36');
    await page.fill('#deudaFin [name=fechaPrimeraCuota]', await FCd('addMonthsISO', hoy, 1)); await page.dispatchEvent('#deudaFin [name=fechaPrimeraCuota]', 'input');
    ok((await page.textContent('#deudaFin .fin-preview')).includes('TAE calculada'), 'modo calcular: vista previa con cuota y TAE');
    await page.click('#deudaForm button[type=submit]'); await sleep(200);
    st = await S(() => { const d = FinanzasApp.Store.list('deudas').find(x => x.nombre === 'Préstamo calc'); const r = FinanzasApp.Calc.deuda(d); return { modo: d.modo, cuota: r.cuota, f: FinanceCore.cuotaFrancesa(6000, 7, 36) }; });
    ok(!st.modo && Math.abs(st.cuota - st.f) < 0.006, 'modo calcular: deuda guardada con cuota francesa ' + JSON.stringify(st));

    // «Cuota manual» sin capital
    await page.click('#addDeudaBtn');
    await page.click('label[for="deudaFin-modoManual"]');
    ok(await visible('#deudaFin [name=cuotaManual]') && await visible('#deudaFin [name=fechaUltimaCuota]') && !(await visible('#deudaFin [name=comisionApertura]')) && await page.inputValue('#deudaFin [name=tin]') === '', 'modo manual: muestra cuota y fecha de la última cuota; oculta comisiones; TIN vacío (opcional)');
    ok((await page.textContent('#deudaFin')).includes('Nº de cuotas') && (await page.textContent('#deudaFin')).includes('Capital prestado (€, opcional)'), 'modo manual: etiquetas «Nº de cuotas» y «Capital prestado (opcional)»');
    await fill('#deudaForm [name=nombre]', 'Móvil manual');
    await page.click('#deudaForm button[type=submit]');
    ok((await page.textContent('#deudaError')).includes('cuota mensual'), 'modo manual: exige la cuota ' + await page.textContent('#deudaError'));
    await fill('#deudaFin [name=cuotaManual]', '37,50'); await fill('#deudaFin [name=plazo]', '24');
    await page.fill('#deudaFin [name=fechaPrimeraCuota]', primeroManual); await page.dispatchEvent('#deudaFin [name=fechaPrimeraCuota]', 'input');
    const ult24 = await FCd('fechaCuota', primeroManual, 24, 10);
    ok(await page.inputValue('#deudaFin [name=fechaUltimaCuota]') === ult24, 'modo manual: nº de cuotas → fecha de la última cuota ' + ult24);
    await page.fill('#deudaFin [name=fechaUltimaCuota]', await FCd('fechaCuota', primeroManual, 20, 10)); await page.dispatchEvent('#deudaFin [name=fechaUltimaCuota]', 'input');
    ok(await page.inputValue('#deudaFin [name=plazo]') === '20', 'modo manual: fecha de la última cuota → nº de cuotas (20)');
    await fill('#deudaFin [name=plazo]', '24');
    let prev = await page.textContent('#deudaFin .fin-preview');
    ok(prev.includes('Total a pagar') && prev.includes('900,00') && prev.includes('24 cuotas sin pagar'), 'modo manual: vista previa 24 × 37,50 = 900 € y pendiente = cuotas restantes × cuota');
    await page.click('#deudaFin .fin-cuotas summary');
    await page.waitForSelector('#deudaFin [data-cuota-n="24"]', { timeout: 3000 }).catch(() => {});
    ok(await page.locator('#deudaFin [data-cuota-n]').count() === 24, 'editar cuotas una a una: tabla con 24 cuotas');
    await fill('#deudaFin [data-cuota-n="24"]', '12,50');
    prev = await page.textContent('#deudaFin .fin-preview');
    ok(prev.includes('875,00') && prev.includes('1 cuota con otro importe'), 'cuota editada: total 875 € ' + prev.slice(0, 160));
    await page.selectOption('#deudaForm select.cuenta-sel', 'cBanco').catch(() => {});
    await page.click('#deudaForm button[type=submit]'); await sleep(200);
    st = await S(() => { const d = FinanzasApp.Store.list('deudas').find(x => x.nombre === 'Móvil manual'); const r = FinanzasApp.Calc.deuda(d); return { d, pend: r.pendiente, venc: r.vencidas.map(f => f.n), tae: r.tae, ultima: r.filas[23].pago }; });
    ok(st.d.modo === 'manual' && st.d.cuotaManual === 37.5 && JSON.stringify(st.d.cuotasEditadas) === '{"24":12.5}' && st.d.capitalConocido === false && st.d.principal === 875 && st.d.tin === 0 && st.d.plazo === 24 && st.d.cuentaId === 'cBanco',
      'modo manual guardado (con campos de compatibilidad principal 875 / TIN 0 y cuenta) ' + JSON.stringify(st.d));
    ok(st.pend === 875 && st.ultima === 12.5 && st.venc.length >= 3 && (st.tae === null || !isFinite(st.tae)), 'modo manual: pendiente 875 €, cuotas vencidas ' + JSON.stringify(st.venc));
    const card = page.locator('.card.deuda', { hasText: 'Móvil manual' });
    const txt = await card.textContent();
    ok(txt.includes('Cuota manual: 24 cuotas de 37,50') && txt.includes('capital y TIN no indicados'), 'lista: condiciones del modo manual');
    await card.locator('[data-deu-pagar-hasta]').click(); await sleep(250);
    st = await S(() => { const d = FinanzasApp.Store.list('deudas').find(x => x.nombre === 'Móvil manual'); const ms = FinanzasApp.Store.getMovimientos().filter(m => m.deudaId === d.id).sort((a, b) => a.cuotaN - b.cuotaN); const r = FinanzasApp.Calc.deuda(d); return { id: d.id, ids: ms.map(m => m.id), imp: ms.map(m => m.importe), cu: ms.map(m => m.cuentaId), tipo: ms.map(m => m.tipo), pend: r.pendiente, venc: r.vencidas.length, des: ms[0] && ms[0].desglose }; });
    ok(st.ids.length >= 3 && st.ids.every((id, i) => id === `cuota_${st.id}_${i + 1}`) && st.imp.every(x => x === 37.5) && st.cu.every(c => c === 'cBanco') && st.tipo.every(t => t === 'gasto') && st.venc === 0,
      'manual: «Marcar pagadas hasta hoy» crea gastos cuota_<id>_<n> en la cuenta Banco ' + JSON.stringify(st.ids));
    ok(st.pend === round(875 - st.ids.length * 37.5), 'manual: pendiente = cuotas restantes ' + st.pend);
    await card.locator('[data-deu-cuadro]').click(); await sleep(150);
    const cu = await page.textContent('#cuadroDialog');
    ok(cu.includes('No indicado') && cu.includes('Cuota manual') && !cu.includes('Sistema francés'), 'cuadro en modo manual: capital «No indicado» y nota de cuota manual');
    await S(() => document.querySelector('#cuadroDialog').close());
    await card.locator('[data-deu-edit]').click(); await sleep(200);
    prev = await page.textContent('#deudaFin .fin-preview');
    ok(prev.includes(Number(st.pend).toLocaleString('es-ES', { minimumFractionDigits: 2 })) && prev.includes(`${24 - st.ids.length} cuotas sin pagar`), 'editar manual: la vista previa descuenta las cuotas pagadas');
    await page.click('#deudaDialog [data-close]');

    // «Cuota manual» con capital: TIN implícito y validación
    await page.click('#addDeudaBtn'); await page.click('label[for="deudaFin-modoManual"]');
    await fill('#deudaForm [name=nombre]', 'Coche manual');
    await fill('#deudaFin [name=cuotaManual]', '250'); await fill('#deudaFin [name=plazo]', '48');
    await page.fill('#deudaFin [name=fechaPrimeraCuota]', await FCd('addMonthsISO', hoy, 1)); await page.dispatchEvent('#deudaFin [name=fechaPrimeraCuota]', 'input');
    await fill('#deudaFin [name=principal]', '13.000');
    ok((await page.textContent('#deudaFin .fin-preview')).includes('menos que el capital'), 'manual con capital: avisa si las cuotas no devuelven el capital');
    await page.click('#deudaForm button[type=submit]');
    ok(await page.evaluate(() => document.querySelector('#deudaDialog').open) && (await page.textContent('#deudaError')).includes('menos que el capital'), 'manual con capital: no deja guardar si no cuadra');
    await fill('#deudaFin [name=principal]', '10.000');
    prev = await page.textContent('#deudaFin .fin-preview');
    ok(prev.includes('TIN implícito') && prev.includes('9,24') && prev.includes('TAE calculada'), 'manual con capital: TIN implícito 9,24 % y TAE ' + prev.slice(0, 200));
    await page.click('#deudaForm button[type=submit]'); await sleep(200);
    st = await S(() => { const d = FinanzasApp.Store.list('deudas').find(x => x.nombre === 'Coche manual'); const r = FinanzasApp.Calc.deuda(d); return { cc: d.capitalConocido, tc: d.tinConocido, tin: d.tin, p: d.principal, cuota: r.cuota, i1: r.filas[0].interes, tae: r.tae, f: FinanceCore.cuotaFrancesa(d.principal, d.tin, 48) }; });
    ok(st.cc === true && st.tc === false && Math.abs(st.tin - 9.2418) < 0.001 && st.p === 10000 && st.cuota === 250 && st.i1 === 77.01 && Math.abs(st.f - 250) < 0.01, 'manual con capital: guarda TIN implícito (compatible) y desglose ' + JSON.stringify(st));
    const card2 = await page.locator('.card.deuda', { hasText: 'Coche manual' }).textContent();
    ok(card2.includes('TIN implícito 9,24') && card2.includes('capital 10.000,00'), 'lista: muestra capital y TIN implícito');

    // Editar: cambiar de modo (calcular → manual → calcular)
    await page.locator('.card.deuda', { hasText: 'Préstamo calc' }).locator('[data-deu-edit]').click();
    await page.click('label[for="deudaFin-modoManual"]');
    ok(await page.inputValue('#deudaFin [name=principal]') === '6000' && await page.inputValue('#deudaFin [name=tin]') === '7', 'editar: al pasar a manual conserva capital y TIN');
    await fill('#deudaFin [name=cuotaManual]', '190');
    ok((await page.textContent('#deudaFin .fin-preview')).includes('no cuadran'), 'manual: avisa si el TIN indicado no cuadra con capital y cuotas');
    await page.click('#deudaForm button[type=submit]'); await sleep(200);
    st = await S(() => { const d = FinanzasApp.Store.list('deudas').find(x => x.nombre === 'Préstamo calc'); return { modo: d.modo, c: d.cuotaManual, tin: d.tin, tc: d.tinConocido, cuota: FinanzasApp.Calc.deuda(d).cuota }; });
    ok(st.modo === 'manual' && st.c === 190 && st.cuota === 190 && st.tin === 7 && st.tc === true, 'editar: deuda pasada a «Cuota manual» ' + JSON.stringify(st));
    await page.locator('.card.deuda', { hasText: 'Préstamo calc' }).locator('[data-deu-edit]').click();
    ok(await page.isChecked('#deudaFin-modoManual') && await page.inputValue('#deudaFin [name=cuotaManual]') === '190', 'editar: reabre en modo manual con su cuota');
    await page.click('label[for="deudaFin-modoCalc"]');
    await page.click('#deudaForm button[type=submit]'); await sleep(200);
    st = await S(() => { const d = FinanzasApp.Store.list('deudas').find(x => x.nombre === 'Préstamo calc'); return { modo: d.modo, c: d.cuotaManual, ce: d.cuotasEditadas, cuota: FinanzasApp.Calc.deuda(d).cuota, f: FinanceCore.cuotaFrancesa(6000, 7, 36) }; });
    ok(!st.modo && st.c === undefined && st.ce === undefined && Math.abs(st.cuota - st.f) < 0.006, 'editar: vuelta a «Calcular cuotas» (sin campos manuales) ' + JSON.stringify(st));

    // Compra financiada (diálogo de movimiento) en modo manual
    await page.click('nav.tabs button[data-view=movimientos]'); await page.click('#fabAdd');
    await page.fill('#mImporte', '600'); await page.fill('#mDescripcion', 'Tablet a plazos');
    await page.check('#movForm [name=esFin]');
    await page.click('label[for="movFin-modoManual"]');
    await fill('#movFin [name=cuotaManual]', '50'); await fill('#movFin [name=plazo]', '12');
    await page.fill('#movFin [name=fechaPrimeraCuota]', await FCd('addMonthsISO', hoy, 1)); await page.dispatchEvent('#movFin [name=fechaPrimeraCuota]', 'input');
    ok(await page.inputValue('#movFin [name=principal]') === '600' && (await page.textContent('#movFin .fin-preview')).includes('TIN implícito'), 'compra financiada en modo manual: capital = importe y TIN implícito 0 %');
    await page.click('#movForm button[type=submit]'); await page.waitForFunction(() => !document.querySelector('#movDialog').open, null, { timeout: 5000 }).catch(() => {});
    st = await S(() => { const S = FinanzasApp.Store, m = S.getMovimientos().find(x => x.descripcion === 'Tablet a plazos'), d = m && S.get('deudas', m.financiadoPor); return d ? { modo: d.modo, cc: d.capitalConocido, p: d.principal, tin: d.tin, cuota: FinanzasApp.Calc.deuda(d).cuota } : null; });
    ok(st && st.modo === 'manual' && st.cc && st.p === 600 && st.tin === 0 && st.cuota === 50, 'compra financiada en modo manual guardada ' + JSON.stringify(st));

    // Exportar/importar conserva el modo
    const exp = await S(() => FinanzasApp.Store.exportJSON ? FinanzasApp.Store.exportJSON() : null);
    if (exp) {
      await S(() => FinanzasApp.Store.reset()); await S(t => FinanzasApp.Store.importJSON(t), exp);
      st = await S(() => { const d = FinanzasApp.Store.list('deudas').find(x => x.nombre === 'Móvil manual'); return d && { modo: d.modo, ce: d.cuotasEditadas, pend: FinanzasApp.Calc.deuda(d).pendiente }; });
      ok(st && st.modo === 'manual' && st.ce[24] === 12.5, 'exportar/importar conserva el modo manual y las cuotas editadas');
    }
    await page.evaluate(() => localStorage.clear());
    await ctx.close();
  }

  /* ============ 1d. v3.6: saldo del mes con arrastre y vista de año ============ */
  {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: 'es-ES', timezoneId: 'Atlantic/Canary', serviceWorkers: 'block' });
    await modoLocal(ctx);
    const page = await ctx.newPage(); track(page, errors, 'saldo-mes');
    await page.goto(BASE + 'index.html'); await page.evaluate(() => localStorage.clear()); await page.reload({ waitUntil: 'networkidle' });
    await page.evaluate(() => FinanzasApp.setVista('mes'));   // v3.8: estas pruebas son de la vista por mes natural
    const S = (fn, arg) => page.evaluate(fn, arg);
    const fill = async (sel, v) => { await page.fill(sel, ''); await page.type(sel, v); };
    const celda = id => page.textContent(`#saldoMesTabla [data-saldo="${id}"] td.num`).catch(() => null);
    const finalTxt = () => page.textContent('#saldoMesTabla [data-saldo-val="final"]');
    ok(await page.isChecked('#periodoMes') && await page.isHidden('#yearInput') && await page.isVisible('#monthInput'), 'por defecto se ve por mes');
    await S(async () => { const St = FinanzasApp.Store;
      await St.put('movimientos', { id: 'sa1', tipo: 'ingreso', fecha: '2026-08-10', importe: 1000, categoria: 'Nómina' });
      await St.put('movimientos', { id: 'sa2', tipo: 'gasto', fecha: '2026-08-20', importe: 600, categoria: 'Hogar' });
      await St.put('movimientos', { id: 'sa3', tipo: 'gasto', fecha: '2026-09-05', importe: 100, categoria: 'Ocio' });
      await St.put('movimientos', { id: 'sa4', tipo: 'ingreso', fecha: '2026-09-25', importe: 1000, categoria: 'Nómina' });
      FinanzasApp.setMes('2026-09'); });
    ok(await page.isVisible('#saldoMesCard') && (await celda('inicial')).includes('400,00') && (await finalTxt()).includes('1.300,00'), 'sin cuentas: saldo inicial de septiembre = lo que sobró en agosto (400) y final 1.300');
    ok((await page.textContent('#saldoMesModo')).includes('movimientos') && (await page.textContent('#saldoMesNota')).includes('agosto de 2026'), 'sin cuentas: nota «calculado con tus movimientos desde agosto de 2026»');
    ok((await page.textContent('#kpiBalanceLabel')).includes('Resultado del mes') && (await page.textContent('#kpiBalance')).includes('1.300,00'), 'v3.8.1 KPI «Resultado del mes» = arrastre 400 + 1.000 − 100 = 1.300 ' + await page.textContent('#kpiBalance'));
    ok((await page.textContent('#kpiBalanceDesglose')).replace(/\s/g, ' ') === 'Arrastre del mes anterior +400,00 € · Ingresos +1.000,00 € · Gastos −100,00 €', 'v3.8.1 desglose del resultado: ' + await page.textContent('#kpiBalanceDesglose'));
    ok((await page.textContent('#saldoMesTabla [data-saldo-val="resultado"]')).includes('1.300,00'), 'v3.8.1 tarjeta de saldo: «= Resultado» con arrastre (1.300)');
    let c = await S(() => [FinanzasApp.Calc.saldoMes('2026-08'), FinanzasApp.Calc.saldoMes('2026-09'), FinanzasApp.Calc.saldoMes('2026-10')]);
    ok(c[1].saldoInicial === c[0].saldoFinal && c[2].saldoInicial === c[1].saldoFinal, 'arrastre: saldo inicial de cada mes = saldo final del anterior');
    // Editar un mes pasado recalcula
    await S(async () => { const m = FinanzasApp.Store.getMovimientos().find(x => x.id === 'sa2'); await FinanzasApp.Store.put('movimientos', { ...m, importe: 700 }); });
    ok((await celda('inicial')).includes('300,00') && (await finalTxt()).includes('1.200,00'), 'editar agosto (gasto 600 → 700) recalcula septiembre: 300 → 1.200');
    ok(await S(() => FinanzasApp.Store.getMovimientos().length) === 4, 'no se crean apuntes ficticios de arrastre');
    // Cuentas: casilla «del día a día» con valor por defecto según el tipo
    await page.click('nav.tabs button[data-view=cuentas]'); await page.click('#addCuentaBtn');
    ok(await page.isChecked('#cuEnSaldo'), 'cuenta corriente nueva: cuenta en el saldo del mes por defecto');
    await page.selectOption('#cuTipo', 'ahorro'); ok(!(await page.isChecked('#cuEnSaldo')), 'al elegir «ahorro» la casilla se desmarca sola');
    await page.selectOption('#cuTipo', 'corriente');
    await fill('#cuNombre', 'Nómina'); await fill('#cuSaldo', '1000'); await page.fill('#cuFecha', '2026-08-01'); await page.click('#cuentaForm button[type=submit]');
    await page.click('#addCuentaBtn'); await fill('#cuNombre', 'Hucha'); await page.selectOption('#cuTipo', 'ahorro'); await fill('#cuSaldo', '0'); await page.fill('#cuFecha', '2026-08-01'); await page.click('#cuentaForm button[type=submit]');
    const ids = await S(() => Object.fromEntries(FinanzasApp.Store.list('cuentas').map(x => [x.nombre, x])));
    ok(ids['Nómina'] && !('enSaldoMes' in ids['Nómina']) && ids['Hucha'] && !('enSaldoMes' in ids['Hucha']), 'si coincide con lo normal del tipo no se guarda la marca');
    await S(async ids => { const St = FinanzasApp.Store; for (const id of ['sa1', 'sa2', 'sa3', 'sa4']) { const m = St.getMovimientos().find(x => x.id === id); await St.put('movimientos', { ...m, cuentaId: ids.n, cuenta: 'Nómina' }); }
      await St.saveTraspaso({ fecha: '2026-09-15', origenId: ids.n, destinoId: ids.h, importe: 200, comision: 0 }); }, { n: ids['Nómina'].id, h: ids['Hucha'].id });
    await page.click('nav.tabs button[data-view=resumen]');
    ok((await page.textContent('#saldoMesModo')).includes('día a día') && (await celda('inicial')).includes('1.300,00'), 'con cuentas: saldo inicial de septiembre = 1.000 (saldo inicial de la cuenta) + 300 de agosto');
    ok((await celda('traspasos')).includes('200,00') && (await page.textContent('#saldoMesTabla')).includes('Ahorrado') && (await finalTxt()).includes('2.000,00'), 'traspaso a la hucha: «Ahorrado» 200 y saldo final 2.000');
    ok((await page.textContent('#saldoMesNota')).includes('Hucha') && (await page.textContent('#patrimonioBody')).includes('Disponible'), 'nota con las cuentas que cuentan / aparte y «Disponible» en Patrimonio');
    const disp = await S(() => FinanzasApp.Calc.patrimonio()); ok(disp.disponible === 2000 && disp.apartado === 200, 'Patrimonio: disponible 2.000 y 200 en ahorro ' + JSON.stringify([disp.disponible, disp.apartado]));
    // Marcar la hucha como del día a día: el traspaso pasa a ser neutro
    await S(id => openCuentaDialog(FinanzasApp.Store.list('cuentas').find(x => x.id === id)), ids['Hucha'].id);
    ok(!(await page.isChecked('#cuEnSaldo')), 'editar la hucha: casilla desmarcada');
    await page.check('#cuEnSaldo'); await page.click('#cuentaForm button[type=submit]');
    ok(await S(id => FinanzasApp.Store.list('cuentas').find(x => x.id === id).enSaldoMes, ids['Hucha'].id) === true, 'la marca se guarda (enSaldoMes: true)');
    ok((await celda('traspasos')).includes('0,00') && !(await celda('traspasos')).includes('200') && (await finalTxt()).includes('2.200,00'), 'hucha incluida: traspaso entre cuentas incluidas no cambia el saldo (2.200)');
    await S(id => openCuentaDialog(FinanzasApp.Store.list('cuentas').find(x => x.id === id)), ids['Hucha'].id); await page.uncheck('#cuEnSaldo'); await page.click('#cuentaForm button[type=submit]');
    ok(await S(id => 'enSaldoMes' in FinanzasApp.Store.list('cuentas').find(x => x.id === id), ids['Hucha'].id) === false, 'volver a lo normal del tipo borra la marca');
    // Vista de año
    await page.click('label[for=periodoAnio]');
    ok(await page.isVisible('#yearInput') && await page.isHidden('#monthInput') && await page.inputValue('#yearInput') === '2026', 'selector de año visible (2026)');
    ok((await page.textContent('#resumenTitle')) === 'Resumen del año 2026' && (await page.textContent('#kpiBalanceLabel')).includes('Resultado del año'), 'resumen del año 2026');
    const an = await S(() => FinanzasApp.Calc.saldoAnio('2026'));
    ok((await page.textContent('#kpiIngresos')).includes('2.000,00') && (await page.textContent('#kpiGastos')).includes('800,00'), 'totales del año: ingresos 2.000, gastos 800');
    ok((await celda('inicial')).includes('1.000,00') && an.saldoFinal === 2000 && (await finalTxt()).includes('2.000,00') && (await page.textContent('#saldoMesTabla')).includes('01/08/2026'), 'año en que empiezan las cuentas: saldo inicial = apertura (1.000 el 01/08/2026) y saldo final 2.000');
    ok((await page.$$eval('#saldoAnualTabla tr.sin-saldo', t => t.length)) === 7 && (await page.textContent('#saldoAnualTabla tbody tr:first-child')).includes('—'), 'tabla anual: enero-julio sin saldo («—»)');
    const filasAnio = await page.$$eval('#saldoAnualTabla tbody tr', t => t.length);
    ok(filasAnio >= 9 && (await page.textContent('#saldoAnualTabla')).includes('ago'), 'tabla mes a mes del año (' + filasAnio + ' filas)');
    ok((await page.textContent('#chartEvolucionTitle')) === 'Mes a mes en 2026' && (await page.textContent('#ultimosTitle')).includes('del año'), 'gráfico y últimos movimientos del año');
    ok(await S(() => localStorage.getItem('finanzas.periodo')) === 'anio', 'se recuerda el modo año');
    await page.click('nav.tabs button[data-view=movimientos]'); await page.selectOption('#fPeriodo', 'mes');
    ok(await S(() => filtrarMovimientos().length) === 4, 'Movimientos con «periodo de arriba» en modo año: los 4 del año');
    await page.click('#prevMonth'); ok(await page.inputValue('#yearInput') === '2025' && await S(() => filtrarMovimientos().length) === 0, '‹ en modo año: año anterior (2025)');
    await page.click('nav.tabs button[data-view=resumen]');
    ok((await page.textContent('#saldoMesSinSaldo')).includes('Sin saldo: tus cuentas empiezan el 01/08/2026') && !(await page.$('#saldoMesTabla [data-saldo-val="final"]')), '2025 (antes de las cuentas): «Sin saldo», sin saldo inicial/final');
    await page.click('nav.tabs button[data-view=movimientos]');
    await page.selectOption('#yearInput', '2026'); ok(await S(() => FinanzasApp.Store ? UI.mes.slice(0, 4) : '') === '2026', 'elegir año en la lista');
    await page.reload({ waitUntil: 'networkidle' });
    ok(await page.isChecked('#periodoAnio') && await page.isVisible('#yearInput'), 'al recargar sigue en modo año');
    await S(() => FinanzasApp.setMes('2026-09')); await page.click('nav.tabs button[data-view=resumen]');
    await page.click('#saldoAnualTabla a[data-ir-mes="2026-08"]');
    ok(await page.isChecked('#periodoMes') && (await page.textContent('#resumenTitle')).includes('agosto') && await S(() => localStorage.getItem('finanzas.periodo')) === 'mes', 'pulsar un mes de la tabla anual abre ese mes (y vuelve a modo mes)');
    await page.evaluate(() => localStorage.clear());
    await ctx.close();
  }

  /* ============ 1e. v3.6.1: cuentas abiertas tarde + compras de inversión sin cuenta (caso real, datos sintéticos) ============ */
  {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: 'es-ES', timezoneId: 'Atlantic/Canary', serviceWorkers: 'block' });
    await modoLocal(ctx);
    const page = await ctx.newPage(); track(page, errors, 'saldo-cuentas-tarde');
    await page.goto(BASE + 'index.html'); await page.evaluate(() => localStorage.clear()); await page.reload({ waitUntil: 'networkidle' });
    await page.evaluate(() => FinanzasApp.setVista('mes'));   // v3.8: estas pruebas son de la vista por mes natural
    await page.addScriptTag({ path: require('path').join(__dirname, 'fixtures', 'datos-cuentas-recientes.js') });
    await page.evaluate(async () => { const D = DatosCuentasRecientes.datos(), cambios = [];
      for (const col of ['cuentas', 'activos', 'precios', 'operaciones', 'movimientos']) for (const rec of D[col]) cambios.push({ col, rec });
      await FinanzasApp.Store.apply(cambios); FinanzasApp.setMes('2026-09'); });
    const txt = sel => page.textContent(sel).catch(() => '');
    const celda = id => page.textContent(`#saldoMesTabla [data-saldo="${id}"] td.num`).catch(() => null);
    ok(await page.evaluate(() => FinanzasApp.Store.list('operaciones').length) === 46, 'fixture: 46 compras de inversión sin cuenta');
    // Septiembre 2026: antes de las cuentas
    ok((await txt('#saldoMesSinSaldo')).includes('Sin saldo: tus cuentas empiezan el 01/10/2026') && !(await page.$('[data-saldo-val="final"]')) && !(await page.$('[data-saldo="inicial"]')), 'sep 2026: «Sin saldo», sin saldo inicial ni final');
    ok(!(/−\s?[\d.]+,\d\d/.test(await txt('#saldoMesBody'))), 'sep 2026: nada negativo en la tarjeta');
    ok((await txt('#saldoMesNota')).includes('invertiste') && (await txt('#kpiInvertido')).includes('€'), 'sep 2026: se sigue viendo lo invertido');
    ok((await txt('#saldoMesBody [data-saldo-val="resultado"]')).includes('0,00'), 'sep 2026: «Resultado del mes» visible (0)');
    // Octubre 2026: empieza con el saldo real de apertura
    await page.evaluate(() => FinanzasApp.setMes('2026-10'));
    ok((await celda('inicial')).includes('0,00') && (await txt('#saldoMesTabla [data-saldo="inicial"]')).includes('saldo real de tus cuentas el 01/10/2026'), 'oct 2026: saldo inicial = saldo real de apertura (0 €)');
    ok(await celda('apertura') === null && await celda('inversion') === null, 'oct 2026: sin «Apertura» compensando negativos ni inversión');
    ok((await txt('#saldoMesTabla [data-saldo-val="final"]')).includes('1.391,82'), 'oct 2026: saldo final 1.391,82');
    await page.evaluate(() => FinanzasApp.setMes('2026-11'));
    ok((await celda('inicial')).includes('1.391,82') && (await celda('apertura')).includes('7,00') && (await txt('#saldoMesTabla [data-saldo-val="final"]')).includes('902,07'), 'nov 2026: 1.391,82 − 496,75 + 7 (cartera) = 902,07 (sin descuadre de 1 céntimo)');
    // Año 2025 y 2026
    await page.evaluate(() => FinanzasApp.setMes('2025-06')); await page.click('label[for=periodoAnio]');
    ok((await txt('#resumenTitle')) === 'Resumen del año 2025' && (await txt('#saldoMesSinSaldo')).includes('01/10/2026'), 'año 2025: «Sin saldo»');
    ok((await page.$$eval('#saldoAnualTabla tbody tr', t => t.length)) === 12 && (await page.$$eval('#saldoAnualTabla tbody tr.sin-saldo', t => t.length)) === 12 && !(/−\s?[\d.]+,\d\d/.test(await txt('#saldoAnualTabla'))), 'año 2025: tabla con «—» en inicial/final y sin negativos');
    await page.selectOption('#yearInput', '2026');
    ok((await celda('inicial')).includes('0,00') && (await txt('#saldoMesTabla [data-saldo="inicial"]')).includes('01/10/2026') && (await txt('#saldoMesTabla [data-saldo-val="final"]')).includes('902,07'), 'año 2026: saldo inicial desde la apertura (01/10/2026) y final 902,07');
    ok((await page.$$eval('#saldoAnualTabla tbody tr.sin-saldo', t => t.length)) === 9, 'año 2026: enero-septiembre sin saldo');
    const serie = await page.evaluate(() => UI.charts.evo.data.datasets.find(d => d.label === 'Saldo final').data);
    ok(serie.slice(0, 9).every(v => v === null) && serie[9] === 1391.82 && serie[10] === 902.07, 'gráfico: la línea «Saldo final» empieza en octubre ' + JSON.stringify(serie));
    await page.evaluate(() => localStorage.clear());
    await ctx.close();
  }

  /* ============ 1f. v3.7: Previsión (datos sintéticos con la forma del caso real; «hoy» fijado al 01/11/2026) ============ */
  {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: 'es-ES', timezoneId: 'Atlantic/Canary', serviceWorkers: 'block' });
    await ctx.clock.setFixedTime(new Date('2026-11-01T12:00:00Z'));
    await modoLocal(ctx);
    const page = await ctx.newPage(); track(page, errors, 'prevision');
    await page.goto(BASE + 'index.html'); await page.evaluate(() => localStorage.clear()); await page.reload({ waitUntil: 'networkidle' });
    await page.evaluate(() => FinanzasApp.setVista('mes'));   // v3.8: estas pruebas son de la vista por mes natural
    await page.addScriptTag({ path: require('path').join(__dirname, 'fixtures', 'datos-cuentas-recientes.js') });
    await page.evaluate(async () => { const D = DatosCuentasRecientes.datos(), cambios = [];
      for (const col of ['cuentas', 'activos', 'precios', 'operaciones', 'movimientos', 'recurrentes', 'deudas']) for (const rec of D[col]) cambios.push({ col, rec });
      await FinanzasApp.Store.apply(cambios); });
    const txt = sel => page.textContent(sel).catch(() => '');
    ok(await page.$('nav.tabs button[data-view="prevision"]') !== null && (await txt('nav.tabs button[data-view="prevision"]')) === 'Previsión', 'pestaña «Previsión» en el menú');
    await page.click('nav.tabs button[data-view="prevision"]'); await sleep(300);
    ok(await page.isVisible('#view-prevision'), 'la vista Previsión se muestra');
    ok(await page.evaluate(() => FinanzasApp.Store.getMovimientos().filter(m => m.recurrenteId).length) === 4, 'no se duplican los recurrentes ya apuntados el 1/11');
    ok((await txt('#prevSaldoHoy')).includes('902,07'), 'saldo de hoy 902,07 (el real de las cuentas)');
    const meses = await page.$$eval('[data-prev-mes]', els => els.map(e => ({ mes: e.dataset.prevMes, estado: e.querySelector('[data-prev-estado]').textContent, sobra: e.querySelector('[data-prev-sobra]').textContent, aviso: e.querySelector('[data-prev-aviso]')?.textContent || '', abierto: e.querySelector('details').open, items: e.querySelectorAll('.prev-item').length, tabla: e.querySelector('.prev-resumen').textContent })));
    ok(meses.length === 13 && meses[0].mes === '2026-11' && meses[12].mes === '2027-11', 'v3.9 por defecto: este mes + 12 ' + meses.map(m => m.mes).join(','));
    ok(meses[0].estado.includes('Te sobrarán') && meses[0].estado.includes('838,14') && !meses[0].aviso, 'noviembre: «Te sobrarán 838,14 €» sin aviso ' + meses[0].estado);
    ok(meses[0].tabla.includes('1.362,98') && meses[0].tabla.includes('1.928,84') && meses[0].tabla.includes('629,79') && /1,75\s€ ya gastado/.test(meses[0].tabla), 'noviembre: cuotas 1.362,98, nómina 1.928,84, variable 629,79 (1,75 ya gastado)');
    ok(meses[0].abierto && !meses[1].abierto && meses[0].items === 8, 'detalle: abierto en el mes actual (nómina + 7 cuotas) ' + meses[0].items);
    ok(meses[1].sobra.includes('706,88') && meses[1].aviso.includes('Antes de cobrar') && meses[1].aviso.includes('206,91') && meses[1].aviso.includes('28/12/2026'), 'diciembre: sobran 706,88 pero aviso antes de cobrar (−206,91) ' + meses[1].aviso);
    ok(meses[2].sobra.includes('829,94') && meses[3].sobra.includes('1.193,32') && meses[4].sobra.includes('1.658,33') && !meses[4].aviso, 'enero 829,94 · febrero 1.193,32 · marzo 1.658,33 sin aviso');
    ok(await page.isVisible('#prevNomina') && (await txt('#prevNomina')).includes('1.928,84') && (await txt('#prevNomina')).includes('día 28'), 'aviso de nómina estimada (1.928,84 el día 28)');
    ok((await page.$$eval('#prevMesesList .badge', b => b.filter(x => x.textContent === 'Estimada').length)) === 13, 'la nómina estimada está marcada en cada mes');
    ok(await page.evaluate(() => UI.charts.prev && UI.charts.prev.data.datasets[0].data.length === 13 && UI.charts.prev.data.datasets[0].data[0] === 838.14), 'gráfico de la previsión');
    // Gasto variable: se puede cambiar y se guarda
    await page.fill('#prevVariable', '0'); await page.dispatchEvent('#prevVariable', 'change'); await sleep(200);
    ok((await txt('[data-prev-mes="2026-11"] [data-prev-estado]')).includes('1.467,93') && await page.evaluate(() => localStorage.getItem('finanzas.prevision.variable')) === '0', 'gasto variable 0 → noviembre sobran 1.467,93 (guardado)');
    await page.reload({ waitUntil: 'networkidle' }); await sleep(300);
    ok((await page.inputValue('#prevVariable')) === '0' && (await txt('[data-prev-mes="2026-12"] [data-prev-sobra]')).includes('1.968,21'), 'tras recargar se mantiene (diciembre 1.968,21)');
    await page.fill('#prevVariable', '2.500'); await page.dispatchEvent('#prevVariable', 'change'); await sleep(200);
    ok((await page.$$eval('[data-prev-estado]', e => e.filter(x => x.textContent.includes('Te faltarán')).length)) > 0 && await page.$('.prev-mes.mal') !== null, 'con 2.500 €/mes: aparece «⚠ Te faltarán»');
    await page.click('#prevVariableAuto'); await sleep(200);
    ok((await page.inputValue('#prevVariable')) === '' && (await txt('[data-prev-mes="2026-11"] [data-prev-sobra]')).includes('838,14'), '«Usar la media» vuelve a la media');
    await page.selectOption('#prevMeses', '25'); await sleep(200);
    ok((await page.$$('[data-prev-mes]')).length === 25, 'horizonte de 24 meses más');
    await page.selectOption('#prevMeses', '7'); await sleep(200);
    ok((await page.$$('[data-prev-mes]')).length === 7, 'horizonte de 6 meses más');
    // Guardar la nómina como recurrente
    await page.click('#prevNominaRec'); await sleep(200);
    ok(await page.isVisible('#recDialog') && (await page.inputValue('#recForm [name=importe]')) === '1928,84' && (await page.inputValue('#recForm [name=dia]')) === '28' && (await page.inputValue('#recForm [name=desde]')) === '2026-11' && await page.isChecked('#recForm input[name=tipo][value=ingreso]') && (await page.inputValue('#recForm [name=tipoIngreso]')) === 'nomina', 'el botón abre el recurrente rellenado (1.928,84, día 28, desde nov 2026, nómina)');
    await page.click('#recForm button[type=submit]'); await sleep(400);
    const recN = await page.evaluate(() => FinanzasApp.Store.list('recurrentes').filter(r => r.tipoIngreso === 'nomina'));
    ok(recN.length === 1 && recN[0].importe === 1928.84 && recN[0].dia === 28 && recN[0].cuentaId === 'c-banco', 'nómina recurrente creada en su cuenta');
    ok(!(await page.isVisible('#prevNomina')) && (await txt('[data-prev-mes="2026-11"] [data-prev-sobra]')).includes('838,14') && (await page.$$eval('#prevMesesList .badge', b => b.filter(x => x.textContent === 'Estimada').length)) === 0, 'ya no es «estimada» y las cifras no cambian');
    ok(await page.evaluate(() => FinanzasApp.Store.getMovimientos().filter(m => m.tipoIngreso === 'nomina').length) === 1, 'no se apunta ninguna nómina antes de su fecha');
    // Móvil
    await page.setViewportSize({ width: 390, height: 844 }); await sleep(300);
    ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'Previsión en móvil: sin desbordamiento horizontal');
    await page.evaluate(() => localStorage.clear());
    await ctx.close();
  }

  /* ============ 1g. v3.8: periodo de nómina, ahorro = traspasos y qué hacer con lo que sobra ============ */
  {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: 'es-ES', timezoneId: 'Atlantic/Canary', serviceWorkers: 'block' });
    await ctx.clock.setFixedTime(new Date('2026-11-28T12:00:00Z'));
    await modoLocal(ctx);
    const page = await ctx.newPage(); track(page, errors, 'periodo-nomina');
    await page.goto(BASE + 'index.html'); await page.evaluate(() => localStorage.clear()); await page.reload({ waitUntil: 'networkidle' });
    await page.addScriptTag({ path: require('path').join(__dirname, 'fixtures', 'datos-cuentas-recientes.js') });
    await page.evaluate(async () => { const D = DatosCuentasRecientes.datos(), cambios = [];
      for (const col of ['cuentas', 'activos', 'precios', 'operaciones', 'movimientos', 'recurrentes', 'deudas']) for (const rec of D[col]) cambios.push({ col, rec });
      await FinanzasApp.Store.apply(cambios); });
    const txt = sel => page.textContent(sel).catch(() => '');
    const celda = id => page.textContent(`#saldoMesTabla [data-saldo="${id}"] td.num`).catch(() => '');
    ok((await txt('#resumenTitle')).includes('Nómina de octubre (28 oct – 28 nov)') && await page.isVisible('#nominaInput') && !(await page.isVisible('#monthInput')), 'con nóminas, por defecto se ve el periodo de nómina (abierto hasta hoy) ' + await txt('#resumenTitle'));
    ok((await page.$$eval('#nominaInput option', o => o.map(x => x.textContent))).join('|') === 'Nómina de octubre (28 oct – 28 nov) · actual|Antes de la primera nómina (1 oct – 27 oct)', 'selector de periodos: el actual y «antes de la primera nómina»');
    ok((await txt('#vistaLink')).includes('ver por mes natural'), 'enlace para cambiar a mes natural');
    const res0 = await page.evaluate(() => { const r = PeriodosCore.resultado(FinanzasApp.Calc.saldoRango('2026-10-28', '2026-11-28')); return { ...r, f: eur(r.resultado), fa: eur(r.arrastre) }; });
    ok(Math.abs(res0.arrastre - 3031.44) < 0.005 && (await txt('#kpiBalance')) === res0.f && (await txt('#kpiBalanceDesglose')).includes('Arrastre del periodo anterior +3.031,44') && (await txt('#kpiBalanceDesglose')).includes('Ingresos +'), 'v3.8.1 KPI Resultado del periodo = arrastre 3.031,44 + ingresos − gastos ' + [await txt('#kpiBalance'), await txt('#kpiBalanceDesglose')].join(' | '));
    ok((await txt('#kpiBalanceLabel')).includes('lo que te queda') && (await txt('#kpiAhorro')).includes('0,00'), 'KPI «Resultado (lo que te queda)» y «Ahorrado» 0 € (sin traspasos a ahorro) ' + [await txt('#kpiBalanceLabel'), await txt('#kpiAhorro'), await txt('#kpiAhorroSub')].join(' | '));
    const fin0 = await page.evaluate(() => FinanzasApp.Calc.saldoRango('2026-10-28', '2026-11-28').saldoFinal);
    ok(Math.abs(fin0 - 902.07) < 0.005 && (await txt('#saldoMesTabla [data-saldo-val="final"]')).includes('902,07') && (await celda('inicial')).includes('3.031,44'), 'saldo del periodo: inicial 3.031,44 (el día antes de la nómina) y final 902,07');
    // 3 traspasos de 100 € de la cuenta de la nómina a la de ahorro → Ahorrado 300 €
    await page.evaluate(async () => { for (const f of ['2026-11-05', '2026-11-10', '2026-11-20']) await FinanzasApp.Store.saveTraspaso({ fecha: f, origenId: 'c-banco', destinoId: 'c-ahorro', importe: 100, comision: 0 }); });
    await sleep(200);
    ok((await txt('#kpiAhorro')).includes('300,00') && (await txt('#kpiAhorroSub')).includes('15,6'), 'Ahorrado 300 € y tasa 300 / 1.928,84 = 15,6 % ' + await txt('#kpiAhorroSub'));
    ok((await celda('traspasos')).includes('300,00') && (await txt('#saldoMesTabla')).includes('Ahorrado') && (await txt('#saldoMesTabla [data-saldo-val="final"]')).includes('602,07'), 'tarjeta de saldo: «Ahorrado» −300 y final 602,07');
    // Navegar
    await page.click('#prevMonth'); await sleep(200);
    ok((await txt('#resumenTitle')).includes('Antes de la primera nómina') && (await txt('#kpiAhorro')).includes('0,00') && (await page.inputValue('#nominaInput')) === '2026-10-01', 'periodo anterior: «Antes de la primera nómina» (incluye el adelanto como extra)');
    ok((await txt('#kpiIngresos')).includes('3.779,47'), 'el adelanto (3.779,47) es ingreso del periodo previo');
    await page.click('#nextMonth'); await sleep(200);
    ok((await txt('#resumenTitle')).includes('Nómina de octubre'), 'periodo siguiente vuelve al actual');
    // Cambiar a mes natural y volver
    await page.click('#vistaLink [data-vista="mes"]'); await sleep(200);
    ok(await page.isVisible('#monthInput') && !(await page.isVisible('#nominaInput')) && (await txt('#resumenTitle')).includes('noviembre de 2026') && (await txt('#kpiAhorro')).includes('300,00'), 'vista por mes natural: el periodo actual pasa al mes de hoy, noviembre con 300 € ahorrados ' + [await page.isVisible('#monthInput'), await page.isVisible('#nominaInput'), await txt('#resumenTitle'), await txt('#kpiAhorro')].join(' | '));
    ok(await page.evaluate(() => FinanzasApp.Store.state.ajustes.vista) === 'mes', 'la vista se guarda en este dispositivo');
    await page.click('nav.tabs button[data-view=ajustes]');
    ok((await page.inputValue('#ajVista')) === 'mes', 'Ajustes: «Vista por» refleja la elección');
    await page.selectOption('#ajVista', 'auto'); await sleep(200);
    await page.click('nav.tabs button[data-view=resumen]'); await sleep(200);
    ok((await txt('#resumenTitle')).includes('Nómina de octubre'), 'Ajustes → automático: vuelve al periodo de nómina');
    // Previsión por periodos
    await page.click('nav.tabs button[data-view="prevision"]'); await sleep(300);
    const per = await page.$$eval('[data-prev-mes]', els => els.map(e => ({ k: e.dataset.prevMes, t: e.querySelector('h3').textContent, estado: e.querySelector('[data-prev-estado]').textContent, aviso: e.querySelector('[data-prev-aviso]')?.textContent || '' })));
    ok(per.length === 13 && per[0].t.includes('Nómina de octubre') && per[0].t.includes('periodo actual') && per[1].t.includes('Nómina de noviembre'), 'Previsión por periodos: el actual + 12 ' + per.map(p => p.t).slice(0, 2).join(' / '));
    ok(per.some(p => p.aviso.includes('El dinero se acaba hacia el') && p.aviso.includes('antes de la nómina del')), 'aviso rojo cuando el dinero se acaba antes de la siguiente nómina');
    ok((await txt('#prevMesesLbl')) === 'Periodos' && (await txt('#prevChartTitle')).includes('nómina'), 'textos de la Previsión por periodos');
    await page.click('nav.tabs button[data-view=resumen]'); await sleep(200);
    // Nueva nómina → diálogo de lo que sobra
    const sobra = await page.evaluate(() => FinanzasApp.Calc.saldoRango('2026-10-28', '2026-11-27').saldoFinal);
    await page.click('nav.tabs button[data-view=movimientos]'); await page.click('#addMovBtn'); await sleep(200);
    await page.click('label[for=tipoIngreso]'); await page.selectOption('#mTipoIngreso', 'nomina');
    await page.fill('#mImporte', '1928,84'); await page.fill('#mFecha', '2026-11-28'); await page.selectOption('#movForm select[name=cuentaSel]', 'c-banco'); await page.fill('#mDescripcion', 'Nómina noviembre');
    const cat = await page.$$eval('#mCategoria option', o => o.map(x => x.value)); if (cat.includes('Nómina')) await page.selectOption('#mCategoria', 'Nómina');
    await page.click('#movForm button[type=submit]'); await sleep(400);
    ok(await page.isVisible('#sobranteDialog') && (await txt('#sobranteTitulo')).includes('nómina de noviembre') && (await txt('#sobranteImporte')).includes(sobra.toFixed(2).replace('.', ',')), `nómina nueva → pregunta qué hacer con lo que sobra (${sobra})`);
    ok(await page.isChecked('#sobTraspasar') && (await page.inputValue('#sobDestino')) === 'c-ahorro' && (await page.inputValue('#sobOrigen')) === 'c-banco' && (await page.inputValue('#sobImporte')) === sobra.toFixed(2).replace('.', ','), 'opción traspasar: cuenta de ahorro, origen e importe precargados');
    await page.click('label[for=sobLuego]');
    ok(await page.isHidden('#sobranteTraspaso') && (await txt('#sobranteOk')) === 'Decidir más tarde', 'decidir más tarde oculta el traspaso');
    await page.click('#sobranteOk'); await page.click('nav.tabs button[data-view=resumen]'); await sleep(300);
    ok(!(await page.isVisible('#sobranteDialog')) && await page.isVisible('#sobranteAviso') && (await txt('#resumenTitle')).includes('Nómina de noviembre'), 'decidir más tarde: aviso en el Resumen del nuevo periodo');
    const rPend = await page.evaluate(() => { const r = PeriodosCore.resultado(FinanzasApp.Calc.saldoRango('2026-11-28', '2026-11-28')); return { ...r, f: eur(r.resultado), fa: eur(r.arrastre) }; });
    ok(Math.abs(rPend.arrastre - sobra) < 0.005 && (await txt('#kpiBalanceDesglose')).includes('(aún sin decidir) +' + rPend.fa) && (await txt('#kpiBalance')) === rPend.f, 'v3.8.1 sin decidir: lo que sobró se arrastra entero ' + await txt('#kpiBalanceDesglose'));
    await page.click('#sobranteDecidir'); await sleep(200);
    ok(await page.isVisible('#sobranteDialog'), 'el aviso vuelve a abrir el diálogo');
    await page.click('label[for=sobTraspasar]'); await page.fill('#sobImporte', '200'); await page.click('#sobranteOk'); await sleep(400);
    const tr = await page.evaluate(() => FinanzasApp.Store.list('traspasos').filter(t => t.cierrePeriodo));
    ok(tr.length === 1 && tr[0].importe === 200 && tr[0].fecha === '2026-11-28' && tr[0].destinoId === 'c-ahorro', 'traspasar: traspaso real de 200 € con la fecha de la nómina');
    ok(await page.evaluate(() => FinanzasApp.Store.getMovimientos().find(m => m.descripcion === 'Nómina noviembre').sobrante) === 'traspasado' && !(await page.isVisible('#sobranteAviso')), 'la nómina queda «traspasado» y desaparece el aviso');
    ok((await txt('#kpiAhorro')).includes('0,00'), 'el nuevo periodo no cuenta ese traspaso como ahorro');
    const rTra = await page.evaluate(() => { const r = PeriodosCore.resultado(FinanzasApp.Calc.saldoRango('2026-11-28', '2026-11-28')); return { ...r, f: eur(r.resultado), fa: eur(r.arrastre) }; });
    ok(Math.abs(rTra.arrastre - (sobra - 200)) < 0.005 && Math.abs(rTra.resultado - (rPend.resultado - 200)) < 0.005 && (await txt('#kpiBalance')) === rTra.f && (await txt('#kpiBalanceDesglose')).includes('lo pasaste a ahorro'), 'v3.8.1 traspasado: los 200 € pasados a ahorro ya no cuentan en el resultado ' + await txt('#kpiBalanceDesglose'));
    await page.click('#prevMonth'); await sleep(200);
    ok((await txt('#resumenTitle')).includes('Nómina de octubre (28 oct – 27 nov)') && (await txt('#kpiAhorro')).includes('500,00'), 'el periodo cerrado: 300 + 200 = 500 € ahorrados ' + await txt('#kpiAhorro'));
    // Acumular en otra nómina (otra vez el diálogo, ahora con «acumular»)
    await page.evaluate(async () => { const m = FinanzasApp.Store.getMovimientos().find(x => x.descripcion === 'Nómina noviembre'); await FinanzasApp.Store.put('movimientos', { ...m, sobrante: 'pendiente' }); });
    await page.click('#nextMonth'); await sleep(200);
    const pend = await page.isVisible('#sobranteAviso');
    if (pend) { await page.click('#sobranteDecidir'); await page.click('label[for=sobAcumular]'); await page.click('#sobranteOk'); await sleep(300); }
    ok(pend && await page.evaluate(() => FinanzasApp.Store.getMovimientos().find(x => x.descripcion === 'Nómina noviembre').sobrante) === 'acumulado' && !(await page.isVisible('#sobranteAviso')), 'acumular: se guarda y desaparece el aviso, sin traspaso nuevo');
    ok(await page.evaluate(() => FinanzasApp.Store.list('traspasos').filter(t => t.cierrePeriodo).length) === 1, 'acumular no crea traspasos');
    // Móvil
    await page.setViewportSize({ width: 390, height: 844 }); await sleep(300);
    ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'periodo de nómina en móvil: sin desbordamiento horizontal');
    await page.evaluate(() => localStorage.clear());
    await ctx.close();
  }

  /* ============ 1h. v3.9: Planificación (presupuesto de combustible, pagas extra, productividad, día especial de la nómina) ============ */
  {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: 'es-ES', timezoneId: 'Atlantic/Canary', serviceWorkers: 'block' });
    await ctx.clock.setFixedTime(new Date('2026-11-28T12:00:00Z'));
    await modoLocal(ctx);
    const page = await ctx.newPage(); track(page, errors, 'plan-v39');
    await page.goto(BASE + 'index.html'); await page.evaluate(() => localStorage.clear()); await page.reload({ waitUntil: 'networkidle' });
    await page.addScriptTag({ path: require('path').join(__dirname, 'fixtures', 'datos-cuentas-recientes.js') });
    await page.evaluate(async () => { const D = DatosCuentasRecientes.datos(), cambios = [];
      for (const col of ['cuentas', 'activos', 'precios', 'operaciones', 'movimientos', 'recurrentes', 'deudas']) for (const rec of D[col]) cambios.push({ col, rec });
      await FinanzasApp.Store.apply(cambios);
      await FinanzasApp.Store.put('recurrentes', { id: 'r-nom', tipo: 'ingreso', tipoIngreso: 'nomina', importe: 1928.84, dia: 28, desde: '2026-11', hasta: '', activo: true, categoria: 'Nómina', descripcion: 'Nómina', cuentaId: 'c-banco' }); });
    await sleep(300);
    if (await page.isVisible('#sobranteDialog')) { await page.click('label[for=sobLuego]'); await page.click('#sobranteOk'); }
    const txt = sel => page.textContent(sel).catch(() => '');
    const previsto = () => page.evaluate(() => FinanzasApp.Store.list('previstos'));
    // Día especial: diciembre el 22 (desde el diálogo del recurrente)
    await page.evaluate(() => openRecDialog(FinanzasApp.Store.get('recurrentes', 'r-nom')));
    ok(await page.isVisible('#recDiasMesAdd') && (await page.$$('#recDiasMes .rec-diames')).length === 0, 'recurrente: botón «Día distinto en un mes»');
    await page.click('#recDiasMesAdd');
    ok((await page.inputValue('#recDiasMes [data-dm-mes]')) === '12' && (await page.inputValue('#recDiasMes [data-dm-dia]')) === '22', 'la fila nueva propone diciembre, día 22');
    await page.click('#recForm button[type=submit]'); await sleep(300);
    ok(JSON.stringify(await page.evaluate(() => FinanzasApp.Store.get('recurrentes', 'r-nom').diasMes)) === '{"12":22}', 'se guarda diasMes {12: 22}');
    // Previsión: tarjeta Planificación y presets
    await page.click('nav.tabs button[data-view="prevision"]'); await sleep(300);
    ok(await page.isVisible('#planCard') && (await txt('#planBody')).includes('Sin presupuestos'), 'Previsión: tarjeta «Planificación» vacía');
    let per = await page.$$eval('[data-prev-mes]', els => els.map(e => e.dataset.prevMes));
    ok(per.length === 13 && per[0] === '2026-11-28' && per[1] === '2026-12-22' && per[2] === '2027-01-28', 'v3.9 periodos: 28 nov → 22 dic (día especial) → 28 ene · ' + per.slice(0, 3).join(','));
    ok((await txt('[data-prev-mes="2026-12-22"] h3')).includes('37 días') && await page.$('[data-prev-mes="2026-12-22"] [data-prev-largo]') !== null, 'el periodo de diciembre es largo (22 dic – 27 ene, 37 días) ' + await txt('[data-prev-mes="2026-12-22"] h3'));
    // Presupuesto de combustible
    await page.click('[data-plan-preset="combustible"]'); await sleep(200);
    ok(await page.isVisible('#planDialog') && (await page.inputValue('#plImporte')).replace(/,00$/, '') === '200' && (await page.inputValue('#plCategoria')) === 'Combustible' && !(await page.isVisible('#plDesc')), 'preset Combustible: 200 € por periodo');
    await page.click('#planForm button[type=submit]'); await sleep(300);
    let pv = await previsto();
    ok(pv.length === 1 && pv[0].tipo === 'presupuesto' && pv[0].importe === 200 && pv[0].categoria === 'Combustible', 'presupuesto guardado en «previstos»');
    ok((await txt('#planBody')).includes('Combustible') && (await txt('[data-prev-mes="2026-12-22"] .prev-resumen')).includes('Presupuestos'), 'Previsión: fila «Presupuestos (gasto fijo)»');
    // otro presupuesto de la misma categoría: no
    await page.click('#planAddPres'); await page.selectOption('#plCategoria', 'Combustible'); await page.fill('#plImporte', '150'); await page.click('#planForm button[type=submit]'); await sleep(200);
    ok(await page.isVisible('#planError') && (await txt('#planError')).includes('Ya hay un presupuesto'), 'no deja dos presupuestos para la misma categoría');
    await page.click('#planDialog [data-close]');
    // Pagas extra y productividad
    await page.click('[data-plan-preset="pagas"]'); await sleep(200);
    ok(await page.isChecked('#plMeses input[value="6"]') && await page.isChecked('#plMeses input[value="12"]') && await page.isChecked('#planForm [name=conNomina]'), 'preset pagas: junio y diciembre, con la nómina');
    await page.fill('#plImporte', '1900'); await page.click('#planForm button[type=submit]'); await sleep(300);
    await page.click('[data-plan-preset="productividad"]'); await sleep(200);
    ok(await page.isChecked('#plMeses input[value="5"]') && await page.isChecked('#planForm [name=estimado]'), 'preset productividad: mayo, estimada');
    await page.fill('#plImporte', '1500'); await page.click('#planForm button[type=submit]'); await sleep(300);
    pv = await previsto();
    ok(pv.length === 3 && pv.some(p => p.descripcion === 'Productividad' && p.estimado && p.incluir && JSON.stringify(p.meses) === '[5]') && pv.some(p => p.descripcion === 'Paga extra' && JSON.stringify(p.meses) === '[6,12]'), 'pagas y productividad guardadas');
    ok(await page.evaluate(() => FinanzasApp.Store.getCategorias('ingreso').includes('Productividad')), 'la categoría «Productividad» se crea para poder apuntar el ingreso real');
    const dic = await txt('[data-prev-mes="2026-12-22"]');
    ok(dic.includes('Paga extra') && dic.includes('1.900,00') && dic.includes('22/12'), 'diciembre: paga extra el 22/12 con la nómina');
    const mayK = await page.$$eval('[data-prev-mes]', els => els.map(e => e.dataset.prevMes).find(k => k.startsWith('2027-05')));
    const may = await txt(`[data-prev-mes="${mayK}"]`);
    ok(may.includes('Productividad') && may.includes('Estimado') && may.includes('1.500,00'), 'mayo: productividad estimada ' + mayK);
    const sobraFin = () => page.$eval('[data-prev-mes]:last-child [data-prev-sobra]', e => e.textContent).catch(() => '');
    const finCon = await sobraFin();
    // Quitar la productividad (toggle)
    const prodId = pv.find(p => p.descripcion === 'Productividad').id;
    await page.uncheck(`[data-plan-incluir="${prodId}"]`); await sleep(300);
    ok((await previsto()).find(p => p.id === prodId).incluir === false && !(await txt(`[data-prev-mes="${mayK}"]`)).includes('+1.500,00') && (await txt(`[data-prev-mes="${mayK}"]`)).includes('No incluido'), 'sin productividad: no suma y se ve «No incluido»');
    ok(finCon !== await sobraFin(), 'el sobrante final cambia al quitarla');
    await page.check(`[data-plan-incluir="${prodId}"]`); await sleep(300);
    ok(finCon === await sobraFin(), 'al volver a marcarla, vuelve el mismo sobrante');
    // Editar el importe previsto
    const pagId = pv.find(p => p.descripcion === 'Paga extra').id;
    await page.click(`[data-plan-editar="${pagId}"]`); await sleep(200);
    ok((await txt('#planDialogTitle')).includes('Editar') && await page.isVisible('#planDelete'), 'editar ingreso previsto');
    await page.fill('#plImporte', '2000'); await page.click('#planForm button[type=submit]'); await sleep(300);
    ok((await txt('[data-prev-mes="2026-12-22"]')).includes('2.000,00'), 'la Previsión usa el importe editado');
    // Resumen: presupuesto de combustible
    await page.evaluate(() => FinanzasApp.Store.put('movimientos', { tipo: 'gasto', fecha: '2026-11-28', importe: 50, categoria: 'Combustible', naturaleza: 'fijo', descripcion: 'Gasolina', cuentaId: 'c-banco' }));
    await page.click('nav.tabs button[data-view=resumen]'); await sleep(300);
    ok(await page.isVisible('#presupuestosCard') && (await txt('#presupuestosCard [data-presu-estado]')).includes('Te quedan 150,00') && /50,00\s€ de 200,00/.test(await txt('#presupuestosCard')), 'Resumen: «Te quedan 150 € este periodo» ' + await txt('#presupuestosCard [data-presu-estado]'));
    await page.evaluate(() => FinanzasApp.Store.put('movimientos', { tipo: 'gasto', fecha: '2026-11-28', importe: 180, categoria: 'Combustible', naturaleza: 'variable', descripcion: 'Gasoil', cuentaId: 'c-banco' }));
    await sleep(300);
    ok((await txt('#presupuestosCard [data-presu-estado]')).includes('Te has pasado 30,00') && await page.$('#presupuestosCard .presu-bar.mal') !== null, 'Resumen: «⚠ Te has pasado 30 €»');
    await page.click('#presupuestosCard [data-ir-plan]'); await sleep(300);
    ok(await page.isVisible('#view-prevision') && await page.isVisible('#planCard'), 'el botón del Resumen lleva a la Planificación');
    // Ingreso real enlazado al previsto: sustituye al previsto
    await page.click('nav.tabs button[data-view=movimientos]'); await page.click('#addMovBtn'); await sleep(200);
    ok(!(await page.isVisible('#rowPrevisto')), 'gasto: sin «Corresponde al ingreso previsto»');
    await page.click('label[for=tipoIngreso]'); await sleep(100);
    ok(await page.isVisible('#rowPrevisto') && (await page.$$eval('#mPrevisto option', o => o.length)) === 3, 'ingreso: selector de ingreso previsto');
    await page.fill('#mImporte', '1950'); await page.fill('#mFecha', '2026-12-22'); await page.fill('#mDescripcion', 'Paga diciembre');
    await page.selectOption('#mCategoria', 'Extra').catch(() => {}); await page.selectOption('#mPrevisto', pagId);
    await page.click('#movForm button[type=submit]'); await sleep(400);
    if (await page.isVisible('#sobranteDialog')) { await page.click('label[for=sobLuego]'); await page.click('#sobranteOk'); }
    ok(await page.evaluate(id => FinanzasApp.Store.getMovimientos().find(m => m.descripcion === 'Paga diciembre')?.previstoId === id, pagId), 'el movimiento guarda previstoId');
    await page.click('nav.tabs button[data-view="prevision"]'); await sleep(300);
    const dic2 = await txt('[data-prev-mes="2026-12-22"]');
    ok(dic2.includes('1.950,00') && !dic2.includes('2.000,00') && (await txt('#planBody')).includes('cobrado 1.950,00'), 'cobrada: la Previsión usa el real (1.950) y no el previsto (2.000)');
    // Borrar un previsto
    await page.click(`[data-plan-editar="${prodId}"]`); await page.click('#planDelete'); await sleep(300);
    ok(!(await previsto()).some(p => p.id === prodId) && await page.$(`[data-plan-id="${prodId}"]`) === null, 'eliminar un ingreso previsto');
    // Móvil
    await page.setViewportSize({ width: 390, height: 844 }); await sleep(300);
    ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'Planificación en móvil: sin desbordamiento horizontal');
    await page.click('[data-plan-preset="productividad"]'); await sleep(200);
    ok(await page.evaluate(() => { const d = document.querySelector('#planDialog'); return d.open && d.scrollWidth <= d.clientWidth + 1; }), 'diálogo en móvil sin desbordamiento');
    await page.click('#planDialog [data-close]');
    await page.evaluate(() => localStorage.clear());
    await ctx.close();
  }

  /* ============ 2. PWA: manifest, service worker, sin conexión ============ */
  {
    fs.rmSync('/tmp/pwt-profile', { recursive: true, force: true });
    const ctx = await chromium.launchPersistentContext('/tmp/pwt-profile', { executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox'], locale: 'es-ES' });
    await ctx.route('https://accounts.google.com/**', r => r.fulfill({ contentType: 'text/javascript', body: '' }));   // sin depender de la red (config.js trae el client ID real)
    const page = ctx.pages()[0] || await ctx.newPage(); track(page, errors, 'pwa');
    await page.goto(BASE, { waitUntil: 'networkidle' });
    await page.evaluate(() => navigator.serviceWorker.ready);
    const cdp = await ctx.newCDPSession(page);
    const man = await cdp.send('Page.getAppManifest');
    ok(man.errors.length === 0, 'manifest sin errores ' + JSON.stringify(man.errors));
    const parsed = man.data ? JSON.parse(man.data) : {};
    ok(parsed.name === 'Mis Finanzas' && parsed.icons.length === 3, 'manifest leído: ' + parsed.name);
    await sleep(500);
    const inst = await cdp.send('Page.getInstallabilityErrors');
    ok(inst.installabilityErrors.length === 0, 'instalable (sin errores de instalabilidad) ' + JSON.stringify(inst.installabilityErrors));
    ok(await page.evaluate(async () => !!(await navigator.serviceWorker.getRegistration())), 'service worker registrado');
    await page.reload({ waitUntil: 'networkidle' }); // ahora controlado por el SW
    ok(await page.evaluate(() => !!navigator.serviceWorker.controller), 'página controlada por el SW');
    const cached = await page.evaluate(async () => { const out = []; for (const k of await caches.keys()) out.push(...(await (await caches.open(k)).keys()).map(r => r.url)); return out; });
    ok(cached.some(u => u.includes('chart.umd')) && cached.some(u => u.endsWith('/js/app.js')), 'caché con app y Chart.js (' + cached.length + ' entradas)');
    await ctx.setOffline(true);
    await page.reload({ waitUntil: 'load' });
    await sleep(500);
    const off = await page.evaluate(() => ({ chart: typeof Chart, app: typeof FinanzasApp, title: document.title }));
    ok(off.chart === 'function' && off.app === 'object', 'funciona sin conexión ' + JSON.stringify(off));
    await ctx.setOffline(false);
    await ctx.close();
  }

  /* ============ 3. E2E con Google simulado (dos dispositivos) ============ */
  {
    const drive = { files: new Map(), seq: 0, calls: [], expired: new Set(), uploads: [], patches: [], sinPermiso: 0 };
    const avatar = fs.readFileSync(require('path').join(__dirname, '..', 'icons', 'icon-192.png'));
    const FAKE_GIS = `window.google={accounts:{oauth2:{
      initTokenClient(cfg){ return { requestAccessToken(opts){ (window.__gis=window.__gis||[]).push(opts); setTimeout(()=>cfg.callback({access_token:'tok-'+(((opts&&opts.scope)||cfg.scope).includes('drive.file')?'df-':'')+Math.random().toString(36).slice(2), expires_in: window.__expiresIn||3600, scope: (opts&&opts.scope)||cfg.scope}), 30); } }; },
      hasGrantedAllScopes(r,s){ return (r.scope||'').split(' ').includes(s); },
      revoke(t,cb){ cb&&cb(); } }}};`;
    async function setupDevice(tag) {
      const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: 'es-ES', timezoneId: 'Atlantic/Canary', serviceWorkers: 'block' });
      await ctx.route('**/js/config.js', async route => {
        const res = await route.fetch(); let body = await res.text();
        body = body.replace(/const GOOGLE_CLIENT_ID = '[^']*';/, "const GOOGLE_CLIENT_ID = 'test-client.apps.googleusercontent.com';");
        route.fulfill({ response: res, body });
      });
      await ctx.route('https://accounts.google.com/gsi/client', route => route.fulfill({ contentType: 'text/javascript', body: FAKE_GIS }));
      await ctx.route('https://lh3.googleusercontent.com/**', route => route.fulfill({ contentType: 'image/png', body: avatar }));
      await ctx.route('https://www.googleapis.com/**', async route => {
        const req = route.request(), url = new URL(req.url()), m = req.method();
        const auth = req.headers()['authorization'] || '';
        drive.calls.push(`${tag} ${m} ${url.pathname}`);
        const json = (o, s = 200) => route.fulfill({ status: s, contentType: 'application/json', body: JSON.stringify(o), headers: { 'access-control-allow-origin': '*' } });
        if (!auth.startsWith('Bearer tok-') || drive.expired.has(auth.slice(7))) return json({ error: { code: 401, message: 'Invalid Credentials' } }, 401);
        const stamp = () => new Date(Date.now() + (++drive.seq)).toISOString();
        if (url.pathname === '/drive/v3/about') return json({ user: { displayName: 'Emilio Prueba', emailAddress: 'emilio.prueba@gmail.com', photoLink: 'https://lh3.googleusercontent.com/a/avatar' } });
        const tok = auth.slice(7), visible = f => !(f.parents || []).includes('appDataFolder');
        const needDF = () => { if (!tok.startsWith('tok-df-')) { drive.sinPermiso++; json({ error: { code: 403, message: 'Insufficient Permission' } }, 403); return true; } return false; };
        const meta = f => ({ id: f.id, name: f.name, mimeType: f.mimeType, parents: f.parents, createdTime: f.createdTime, modifiedTime: f.modifiedTime, size: String(f.content ? f.content.length : 0), trashed: false });
        if (url.pathname === '/drive/v3/files' && m === 'GET') {
          const sp = url.searchParams.get('spaces'), q = url.searchParams.get('q') || '';
          if (sp !== 'appDataFolder' && sp !== 'drive') ok(false, 'espacio desconocido ' + sp);
          if (sp === 'drive' && needDF()) return;
          const name = (q.match(/name='((?:[^'\\]|\\.)*)'/) || [])[1], mime = (q.match(/mimeType='([^']+)'/) || [])[1], par = (q.match(/'([^']+)' in parents/) || [])[1];
          const files = [...drive.files.values()].filter(f => (sp === 'appDataFolder') !== visible(f))
            .filter(f => !name || f.name === name.replace(/\\'/g, "'")).filter(f => !mime || f.mimeType === mime).filter(f => !par || (f.parents || []).includes(par));
          return json({ files: files.map(meta) });
        }
        if (url.pathname === '/drive/v3/files' && m === 'POST') { // carpeta (solo metadatos)
          if (needDF()) return;
          const md = JSON.parse(req.postData()); const id = 'f' + (++drive.seq), t = stamp();
          drive.files.set(id, { id, name: md.name, mimeType: md.mimeType, parents: md.parents || ['root'], createdTime: t, modifiedTime: t, content: null });
          return json(meta(drive.files.get(id)));
        }
        let mm = url.pathname.match(/^\/drive\/v3\/files\/([^/]+)$/);
        if (mm && m === 'GET') {
          const f = drive.files.get(mm[1]); if (!f) return json({ error: { code: 404, message: 'File not found' } }, 404);
          if (visible(f) && needDF()) return;
          if (url.searchParams.get('alt') === 'media') return route.fulfill({ status: 200, contentType: f.mimeType || 'application/octet-stream', body: f.content, headers: { 'access-control-allow-origin': '*' } });
          return json(meta(f));
        }
        if (mm && m === 'DELETE') {
          const f = drive.files.get(mm[1]); if (f && visible(f) && needDF()) return;
          drive.files.delete(mm[1]); for (const [k, x] of drive.files) if ((x.parents || []).includes(mm[1])) drive.files.delete(k); // como Drive: borra los hijos
          return route.fulfill({ status: 204, body: '', headers: { 'access-control-allow-origin': '*' } });
        }
        if (url.pathname === '/upload/drive/v3/files' && m === 'POST') {
          const buf = req.postDataBuffer(), bnd = (req.headers()['content-type'].match(/boundary=([^;]+)/) || [])[1];
          const sep = Buffer.from('--' + bnd), i1 = buf.indexOf(sep), i2 = buf.indexOf(sep, i1 + sep.length), i3 = buf.lastIndexOf(Buffer.from('\r\n--' + bnd + '--'));
          const part = (a, z) => { const h = buf.indexOf(Buffer.from('\r\n\r\n'), a) + 4; return buf.subarray(h, z); };
          const md = JSON.parse(part(i1, i2 - 2).toString('utf8')); const content = Buffer.from(part(i2, i3));
          if (!(md.parents || []).includes('appDataFolder') && needDF()) return;
          const id = 'f' + (++drive.seq); const t = stamp();
          drive.files.set(id, { id, name: md.name, mimeType: md.mimeType, parents: md.parents, appProperties: md.appProperties, createdTime: t, modifiedTime: t, content });
          drive.uploads.push(md.name);
          return json(meta(drive.files.get(id)));
        }
        mm = url.pathname.match(/^\/upload\/drive\/v3\/files\/([^/]+)$/);
        if (mm && m === 'PATCH') {
          const f = drive.files.get(mm[1]); if (!f) return json({ error: { code: 404, message: 'File not found' } }, 404);
          if (visible(f) && needDF()) return;
          f.content = req.postDataBuffer(); f.modifiedTime = stamp(); if (/^(finanzas-analisis\.json|movimientos\.csv)$/.test(f.name)) drive.patches.push(f.name); return json(meta(f));
        }
        return json({ error: { message: 'unhandled ' + m + ' ' + url.pathname } }, 400);
      });
      const page = await ctx.newPage(); track(page, errors, tag);
      return { ctx, page };
    }
    const mainFiles = () => [...drive.files.values()].filter(f => f.name === 'finanzas.json' && f.parents.includes('appDataFolder'));
    const remote = () => { const f = mainFiles(); return f.length ? JSON.parse(f[0].content.toString('utf8')) : null; };
    const chip = page => page.evaluate(() => document.querySelector('#syncChip').dataset.status + '|' + document.querySelector('#syncChip .txt').textContent);
    const waitStatus = async (page, s, ms = 6000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if ((await chip(page)).startsWith(s + '|')) return true; await sleep(100); } return false; };

    // Dispositivo A: tiene datos locales antes de entrar -> se suben
    const A = await setupDevice('A');
    await A.page.goto(BASE + 'index.html', { waitUntil: 'networkidle' });
    ok(await A.page.isHidden('#localNotice'), 'con client ID: no aparece el aviso de modo local');
    ok(await A.page.isVisible('#loginBtn') && (await chip(A.page)).startsWith('local|'), 'botón «Entrar con Google» y estado «Solo local»');
    await A.page.evaluate(() => FinanzasApp.Store.upsertMovimiento({ tipo: 'gasto', fecha: '2026-10-01', importe: 50, categoria: 'Ocio', descripcion: 'cine' }));
    await A.page.click('#loginBtn');
    ok(await waitStatus(A.page, 'synced'), 'A: tras entrar -> Sincronizado');
    ok(await A.page.evaluate(() => window.__gis[0].prompt.includes('consent')), 'primer login pide consentimiento');
    ok(await A.page.isVisible('#avatarImg') && (await A.page.getAttribute('#avatarImg', 'referrerpolicy')) === 'no-referrer', 'avatar visible');
    await A.page.click('#avatarBtn');
    ok((await A.page.textContent('#userEmail')) === 'emilio.prueba@gmail.com' && await A.page.isVisible('#userPop'), 'email en el menú de cuenta');
    await A.page.keyboard.press('Escape');
    ok(mainFiles().length === 1 && remote().movimientos.length === 1 && remote().movimientos[0].descripcion === 'cine', 'datos locales subidos a Drive (appDataFolder/finanzas.json)');
    ok(drive.files.size === 1 && mainFiles()[0].parents[0] === 'appDataFolder', 'archivo en appDataFolder');
    ok(!('ajustes' in remote()), 'el tema no se sube a Drive');

    // Dispositivo B: datos propios -> se fusionan
    const B = await setupDevice('B');
    await B.page.goto(BASE + 'index.html', { waitUntil: 'networkidle' });
    await B.page.evaluate(async () => { const S = FinanzasApp.Store; const a = await S.put('activos', { nombre: 'Fondo B', tipo: 'fondo', isin: '', ticker: '', notas: '' }); await S.put('operaciones', { activoId: a.id, tipo: 'compra', fecha: '2026-10-01', participaciones: 1, precio: 100, comisiones: 0, notas: '' }); });
    await B.page.click('#loginBtn');
    ok(await waitStatus(B.page, 'synced'), 'B: login -> Sincronizado');
    ok(await B.page.evaluate(() => FinanzasApp.Store.getMovimientos().length === 1 && FinanzasApp.Store.list('activos').length === 1), 'B: tiene lo de A y lo suyo (fusión)');
    ok(mainFiles().length === 1 && remote().activos.length === 1 && remote().operaciones.length === 1, 'Drive: un solo archivo con todo');

    // Cambios en B se ven en A al sincronizar
    const movId = await B.page.evaluate(() => FinanzasApp.Store.getMovimientos()[0].id);
    await B.page.evaluate(id => FinanzasApp.Store.deleteMovimiento(id), movId);
    await B.page.evaluate(() => FinanzasApp.Store.upsertMovimiento({ tipo: 'ingreso', fecha: '2026-10-02', importe: 900, categoria: 'Nómina', descripcion: 'nómina B' }));
    ok(remote().movimientos.filter(m => !m.deleted).length === 1, 'B: la subida espera ~2 s (debounce), aún no se ha enviado');
    await sleep(2600); ok(await waitStatus(B.page, 'synced'), 'B: cambios subidos');
    await A.page.click('#syncChip'); // «Sincronizar ahora»
    await sleep(800);
    const a1 = await A.page.evaluate(() => FinanzasApp.Store.getMovimientos().map(m => m.descripcion));
    ok(a1.length === 1 && a1[0] === 'nómina B', 'A: recibe borrado y alta de B, sin resucitar ' + JSON.stringify(a1));
    ok(await A.page.evaluate(() => FinanzasApp.Store.list('activos').length === 1), 'A: recibe inversión de B');
    // A tenía una copia vieja del movimiento borrado: no vuelve
    await A.page.evaluate(() => FinanzasApp.Sync.now({ force: true })); await sleep(300);
    ok(remote().movimientos.filter(m => !m.deleted).length === 1, 'Drive: el borrado se mantiene');

    // Sin conexión en A: cola y subida al volver
    await A.ctx.setOffline(true);
    await A.page.evaluate(() => window.dispatchEvent(new Event('offline')));
    await A.page.evaluate(() => FinanzasApp.Store.upsertMovimiento({ tipo: 'gasto', fecha: '2026-10-03', importe: 20, categoria: 'Ocio', descripcion: 'offline' }));
    ok(await waitStatus(A.page, 'offline', 2000), 'A: sin conexión -> estado «Sin conexión»');
    ok((await chip(A.page)).includes('pendientes'), 'A: indica cambios pendientes');
    ok(await A.page.evaluate(() => JSON.parse(localStorage.finanzas_sync).dirty === true), 'A: cola persistida (dirty)');
    await A.ctx.setOffline(false);
    await A.page.evaluate(() => window.dispatchEvent(new Event('online')));
    ok(await waitStatus(A.page, 'synced'), 'A: vuelve la conexión -> Sincronizado');
    ok(remote().movimientos.some(m => m.descripcion === 'offline'), 'Drive: recibió el cambio hecho sin conexión');

    // Token caducado: Drive devuelve 401 -> «Reconectar»; clic -> renovación sin consentimiento
    const tokA = await A.page.evaluate(() => FinanzasApp.Auth.token); drive.expired.add(tokA);
    await A.page.evaluate(() => FinanzasApp.Store.upsertMovimiento({ tipo: 'gasto', fecha: '2026-10-04', importe: 5, categoria: 'Ocio', descripcion: 'tras caducar' }));
    ok(await waitStatus(A.page, 'auth', 5000), 'A: token caducado -> «Reconectar» ' + await chip(A.page));
    await A.page.click('#syncChip');
    ok(await waitStatus(A.page, 'synced'), 'A: reconectado y sincronizado');
    ok(await A.page.evaluate(() => window.__gis[window.__gis.length - 1].prompt === '' && window.__gis[window.__gis.length - 1].login_hint === 'emilio.prueba@gmail.com'), 'renovación con prompt vacío y login_hint');
    ok(remote().movimientos.some(m => m.descripcion === 'tras caducar'), 'Drive: cambio pendiente subido tras reconectar');

    // Nueva pestaña sin token (sessionStorage vacío): primer clic renueva en silencio
    const A2 = await A.ctx.newPage(); track(A2, errors, 'A2');
    await A2.goto(BASE + 'index.html', { waitUntil: 'networkidle' });
    ok((await chip(A2)).startsWith('auth|'), 'nueva pestaña: pide reconectar (sin token)');
    await A2.click('nav.tabs button[data-view=movimientos]'); // cualquier clic
    ok(await waitStatus(A2, 'synced'), 'nueva pestaña: renovación silenciosa en el primer clic');
    await A2.close();

    // Cerrar sesión borrando la copia local
    await A.page.click('#avatarBtn'); await A.page.click('#userPop [data-auth-action=logout]');
    await sleep(300);
    const so = await A.page.evaluate(() => ({ user: FinanzasApp.Auth.user, n: FinanzasApp.Store.getMovimientos().length, chip: document.querySelector('#syncChip').dataset.status }));
    ok(!so.user && so.n === 0 && so.chip === 'local' && await A.page.isVisible('#loginBtn'), 'cerrar sesión: vuelve a «Solo local» y borra copia ' + JSON.stringify(so));
    ok(remote().movimientos.filter(m => !m.deleted).length === 3, 'Drive conserva los datos tras cerrar sesión');
    await A.page.setViewportSize({ width: 1280, height: 900 });
    await B.page.evaluate(() => FinanzasApp.Sync.now({ force: true })); await sleep(300);
    await B.page.screenshot({ path: SHOTS + '/resumen-sincronizado.png' });
    await B.page.click('#avatarBtn'); await sleep(200);
    await B.page.screenshot({ path: SHOTS + '/menu-cuenta.png' });
    await B.page.keyboard.press('Escape');
    await B.page.setViewportSize({ width: 390, height: 844 }); await sleep(300);
    await B.page.screenshot({ path: SHOTS + '/movil.png' });
    await B.page.setViewportSize({ width: 1280, height: 900 });

    // Adjuntos: se suben como archivos aparte a appDataFolder y no se vuelven a subir
    await B.page.click('#fabAdd');
    await B.page.fill('#mImporte', '493,81'); await B.page.fill('#mFecha', '2026-10-12'); await B.page.fill('#mDescripcion', 'Lavadora');
    await B.page.setInputFiles('#movAdj input[type=file]', TICKET); await sleep(500);
    await B.page.click('#movForm button[type=submit]'); await sleep(300);
    await B.page.evaluate(() => FinanzasApp.Sync.now({ force: true })); await sleep(1500);
    const adjFiles = [...drive.files.values()].filter(f => f.parents.includes('appDataFolder') && f.name !== 'finanzas.json');
    const head = adjFiles[0] ? adjFiles[0].content.subarray(0, 4).toString('hex') : '';
    ok(adjFiles.length === 1 && adjFiles[0].content.length > 1000 && (head.startsWith('ffd8') || head === '89504e47'), 'adjunto subido a appDataFolder como binario (' + (adjFiles[0] ? adjFiles[0].content.length : 0) + ' bytes, ' + head + ')');
    const up1 = drive.uploads.length;
    await B.page.evaluate(() => FinanzasApp.Sync.now({ force: true })); await sleep(1200);
    ok(drive.uploads.length === up1 && remote().adjuntos.some(a => a.driveId === adjFiles[0].id), 'adjunto no se resube y Drive guarda su referencia');

    // Copia para análisis (drive.file): desactivada por defecto; al activarla se pide el permiso extra
    ok(drive.sinPermiso === 0 && ![...drive.files.values()].some(f => !f.parents.includes('appDataFolder')), 'sin la copia activada: nada fuera de appDataFolder');
    await B.page.click('nav.tabs button[data-view=ajustes]');
    ok(!(await B.page.isChecked('#anActivo')), 'copia para análisis: desactivada por defecto');
    await B.page.check('#anActivo');
    const t0 = Date.now(); while (Date.now() - t0 < 8000 && ![...drive.files.values()].some(f => f.name === 'movimientos.csv')) await sleep(150);
    const lastGis = await B.page.evaluate(() => window.__gis[window.__gis.length - 1]);
    ok(lastGis.scope.includes('drive.appdata') && lastGis.scope.includes('drive.file') && lastGis.include_granted_scopes === true, 'activar pide drive.file de forma incremental ' + JSON.stringify(lastGis));
    const folder = [...drive.files.values()].find(f => f.mimeType === 'application/vnd.google-apps.folder');
    const kids = folder ? [...drive.files.values()].filter(f => f.parents.includes(folder.id)) : [];
    ok(folder && folder.name === 'Finanzas App - Análisis' && !folder.parents.includes('appDataFolder'), 'carpeta visible «Finanzas App - Análisis» creada');
    ok(kids.map(f => f.name).sort().join() === 'finanzas-analisis.json,movimientos.csv', 'dentro: finanzas-analisis.json y movimientos.csv ' + JSON.stringify(kids.map(f => f.name)));
    const aj = kids.find(f => f.name.endsWith('.json')), acsv = kids.find(f => f.name.endsWith('.csv'));
    const AJ = aj ? JSON.parse(aj.content.toString('utf8')) : {};
    const nLive = await B.page.evaluate(() => FinanzasApp.Store.getMovimientos().length);
    ok(AJ.formato === 'finanzas-analisis' && AJ.movimientos.length === nLive && AJ.inversiones.metodo === 'FIFO' && Array.isArray(AJ.deudas) && Array.isArray(AJ.garantias) && !JSON.stringify(AJ).includes('driveId'), 'JSON de análisis: movimientos, deudas, inversiones FIFO y garantías, sin archivos');
    ok(acsv && acsv.content.toString('utf8').startsWith('\ufeffid,fecha,tipo,importe'), 'CSV de movimientos con BOM y cabecera');
    ok((await B.page.getAttribute('#anCarpeta', 'href')) === 'https://drive.google.com/drive/folders/' + (folder && folder.id), 'enlace «Abrir carpeta» a Drive');
    await B.page.screenshot({ path: SHOTS + '/ajustes-analisis.png', fullPage: true });
    // Manual: «Actualizar copia ahora» -> actualiza los mismos archivos (PATCH), no crea otros
    await B.page.evaluate(() => FinanzasApp.Store.upsertMovimiento({ tipo: 'gasto', fecha: '2026-10-20', importe: 12, categoria: 'Ocio', descripcion: 'para análisis' }));
    const p0 = drive.patches.length;
    await B.page.click('#anAhora'); const t1 = Date.now(); while (Date.now() - t1 < 5000 && drive.patches.length < p0 + 2) await sleep(100);
    const aj2 = JSON.parse([...drive.files.values()].find(f => f.name === 'finanzas-analisis.json').content.toString('utf8'));
    ok(drive.patches.length >= p0 + 2 && aj2.movimientos.some(m => m.descripcion === 'para análisis') && [...drive.files.values()].filter(f => f.name === 'finanzas-analisis.json').length === 1, '«Actualizar copia ahora» reescribe los mismos archivos');
    // Automática: como mucho cada hora, después de sincronizar
    const p1 = drive.patches.length;
    await B.page.evaluate(() => FinanzasApp.Sync.now({ force: true })); await sleep(1000);
    ok(drive.patches.length === p1, 'auto: no se repite antes de una hora');
    await B.page.evaluate(() => { const st = JSON.parse(localStorage.finanzas_analisis); st.ultimoIntento = Date.now() - 3700000; localStorage.finanzas_analisis = JSON.stringify(st); });
    await B.page.evaluate(() => FinanzasApp.Store.upsertMovimiento({ tipo: 'gasto', fecha: '2026-10-21', importe: 7, categoria: 'Ocio', descripcion: 'auto' }));
    const t2 = Date.now(); while (Date.now() - t2 < 8000 && drive.patches.length === p1) await sleep(150);
    ok(drive.patches.length > p1, 'auto: pasada la hora, se actualiza tras la sincronización');
    ok(drive.sinPermiso === 0, 'nunca se tocó Drive visible sin el permiso drive.file');
    await B.page.waitForFunction(() => !Analisis.ocupado);
    await B.page.click('#anBorrar'); await sleep(800);
    ok(![...drive.files.values()].some(f => !f.parents.includes('appDataFolder')) && !(await B.page.isChecked('#anActivo')), '«Borrar copia» elimina la carpeta y desactiva');
    ok(mainFiles().length === 1, 'los datos de la app siguen en appDataFolder');
    await A.ctx.close(); await B.ctx.close();
    // v3.9.1: OAuth por redirección (PWA standalone) y renovación que no redirige sola
    {
      const C = await setupDevice('R');
      await C.page.addInitScript(() => {
        const orig = window.matchMedia.bind(window);
        window.matchMedia = q => {
          if (String(q).includes('display-mode: standalone')) return { matches: true, media: q, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, onchange: null, dispatchEvent: () => false };
          return orig(q);
        };
      });
      await C.page.goto(BASE + 'index.html', { waitUntil: 'networkidle' });
      ok(await C.page.evaluate(() => FinanzasApp.Auth.usesRedirect() === true), 'standalone: usesRedirect');
      ok(await C.page.evaluate(() => FinanzasApp.Auth.redirectUri().endsWith('/')), 'redirectUri termina en /');
      // Login inicia redirección a Google (interceptamos para no salir de la app en el test)
      await C.page.route('https://accounts.google.com/o/oauth2/**', route => route.fulfill({ status: 200, contentType: 'text/plain', body: 'oauth-intercept' }));
      const seen = C.page.waitForRequest(r => r.url().startsWith('https://accounts.google.com/o/oauth2/v2/auth'), { timeout: 5000 }).catch(() => null);
      await C.page.click('#loginBtn');
      const req = await seen;
      ok(!!req, 'standalone: login navega a accounts.google.com/o/oauth2/v2/auth');
      if (req) {
        const u = new URL(req.url());
        ok(u.searchParams.get('response_type') === 'token', 'response_type=token');
        ok(u.searchParams.get('include_granted_scopes') === 'true', 'include_granted_scopes');
        ok((u.searchParams.get('redirect_uri') || '').endsWith('/'), 'redirect_uri con barra final: ' + u.searchParams.get('redirect_uri'));
        ok(!!u.searchParams.get('state'), 'lleva state');
        ok((u.searchParams.get('scope') || '').includes('drive.appdata'), 'scope appdata');
      }
      await C.page.goto(BASE + 'index.html', { waitUntil: 'networkidle' }); // volver limpio tras la navegación interceptada
      // Simular la vuelta: hash + state/pending en localStorage (datos locales intactos)
      await C.page.evaluate(() => {
        localStorage.setItem('finanzas_v2', JSON.stringify({ version: 2, movimientos: [{ id: 'keep', tipo: 'gasto', fecha: '2026-11-01', importe: 7, categoria: 'Ocio', descripcion: 'siete', deleted: false, updatedAt: '2026-11-01T00:00:00.000Z' }], cuentas: [], recurrentes: [], deudas: [], activos: [], operaciones: [], traspasos: [], ajustesSaldo: [], adjuntos: [], vehiculos: [], previstos: [] }));
        const st = 'teststate391';
        localStorage.setItem('finanzas_oauth_state', st);
        localStorage.setItem('finanzas_oauth_pending', JSON.stringify({ kind: 'signin', prompt: 'consent', ts: Date.now() }));
        const scope = encodeURIComponent('https://www.googleapis.com/auth/drive.appdata');
        location.hash = '#access_token=tok-redir-391&token_type=Bearer&expires_in=3600&scope=' + scope + '&state=' + st;
      });
      await C.page.reload({ waitUntil: 'networkidle' });
      ok(await waitStatus(C.page, 'synced', 8000), 'vuelta OAuth: perfil + sync');
      ok(await C.page.evaluate(() => FinanzasApp.Auth.token === 'tok-redir-391' && !location.hash.includes('access_token')), 'token aplicado y hash limpio');
      ok(await C.page.evaluate(() => (JSON.parse(localStorage.finanzas_v2).movimientos || []).some(m => m.descripcion === 'siete')), 'localStorage finanzas_v2 sobrevive a la redirección');
      // Renovación silenciosa en standalone: NO navega; pasa a needsReauth
      await C.page.evaluate(() => { FinanzasApp.Auth.expiresAt = Date.now() + 60 * 1000; FinanzasApp.Auth.needsReauth = false; });
      const navigated = await C.page.evaluate(async () => {
        let went = false;
        const orig = location.assign.bind(location);
        location.assign = u => { went = true; };
        const r = await FinanzasApp.Auth.refreshSilently();
        location.assign = orig;
        return { r, went, needs: FinanzasApp.Auth.needsReauth };
      });
      ok(navigated.r === false && navigated.went === false && navigated.needs === true, 'standalone: refreshSilently no redirige ' + JSON.stringify(navigated));
      await C.ctx.close();
    }

    console.log('Llamadas a Drive:', drive.calls.length);
  }

  // Ruido esperado del propio test: SW bloqueado a propósito en los contextos de prueba de Drive,
  // y el 401 que el Drive simulado devuelve adrede al probar el token caducado.
  const real = errors.filter(e => !/Service Worker registration blocked by Playwright/.test(e) && !/^\[A\] error: Failed to load resource: .*401/.test(e)
    && !/^\[f3\] error: Failed to load resource: .*429/.test(e)); // 429 simulado de Gemini (prueba de la caída a Tesseract)
  console.log('Avisos esperados filtrados:', errors.length - real.length);
  ok(real.length === 0, 'sin errores ni avisos en consola' + (real.length ? ': ' + JSON.stringify(real, null, 1) : ''));
  console.log(`\n${pass} correctos, ${fail} fallidos`);
  await browser.close();
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
