// Capturas v3.11.0: formulario con selector de recurrente y previsión (pendiente / hecho).
// BASE_URL=http://localhost:8766/ PW_PATH=... node tests/capturas-3110.js
const { chromium } = require(process.env.PW_PATH || 'playwright-core');
const path = require('path'), fs = require('fs');
const BASE = process.env.BASE_URL || 'http://localhost:8766/';
const OUT = process.env.OUT_DIR || '/workspace/capturas-3.11.0';
fs.mkdirSync(OUT, { recursive: true });
(async () => {
  const b = await chromium.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome', args: ['--no-sandbox'] });
  const ctx = await b.newContext({ viewport: { width: 1280, height: 900 }, locale: 'es-ES', timezoneId: 'Atlantic/Canary', serviceWorkers: 'block' });
  await ctx.clock.setFixedTime(new Date('2026-11-26T12:00:00Z'));
  await ctx.route('https://accounts.google.com/**', r => r.fulfill({ contentType: 'text/javascript', body: '' }));
  const p = await ctx.newPage(); const errs = [];
  p.on('console', m => { if (['error', 'warning'].includes(m.type()) && !/Service Worker registration blocked/.test(m.text())) errs.push(m.text()); });
  p.on('pageerror', e => errs.push('pageerror ' + e.message));
  p.on('dialog', d => d.accept());
  await p.goto(BASE + 'index.html', { waitUntil: 'networkidle' });
  await p.evaluate(() => localStorage.clear()); await p.reload({ waitUntil: 'networkidle' });
  await p.evaluate(async () => {
    await FinanzasApp.Store.addCategoria('gasto', 'Combustible');
    await FinanzasApp.Store.addMany(FinanzasApp.generarDatosEjemplo());
    // Recurrente de noviembre sin movimiento: debe salir como pendiente
    await FinanzasApp.Store.put('recurrentes', {
      id: 'r-gim-demo', tipo: 'gasto', importe: 45, categoria: 'Salud', descripcion: 'Gimnasio',
      cuenta: 'Banco', dia: 1, desde: '2026-11', hasta: '', activo: true, naturaleza: 'fijo'
    });
    FinanzasApp.setVista('mes');
    FinanzasApp.setMes('2026-11');
  });
  // Comprobaciones: no se ha generado el gimnasio solo; la nómina de ejemplo sí está vinculada
  const chk = await p.evaluate(() => {
    const S = FinanzasApp.Store, FC = FinanceCore;
    const recs = S.list('recurrentes');
    const movs = S.getMovimientos();
    const gim = recs.find(r => r.id === 'r-gim-demo');
    const nom = recs.find(r => r.descripcion === 'Nómina mensual');
    return {
      version: (window.APP_VERSION || (typeof CONFIG !== 'undefined' && CONFIG.APP_VERSION) || document.querySelector('meta') && null),
      app: (typeof APP_VERSION !== 'undefined' ? APP_VERSION : null),
      cfg: (typeof FinanzasConfig !== 'undefined' && FinanzasConfig.APP_VERSION) || (window.FinanzasApp && null),
      nGim: movs.filter(m => m.recurrenteId === 'r-gim-demo').length,
      nomHecho: !!(nom && FC.movimientoDeRecurrente(movs, nom.id, '2026-11')),
      nVinculados: movs.filter(m => m.recurrenteId).length,
      nPeriodo: movs.filter(m => m.recurrentePeriodo).length
    };
  });
  if (chk.nGim !== 0) throw new Error('el gimnasio no debía generarse solo: ' + JSON.stringify(chk));
  if (!chk.nomHecho) throw new Error('la nómina de ejemplo de noviembre debía estar vinculada: ' + JSON.stringify(chk));
  if (chk.nVinculados < 1 || chk.nPeriodo < 1) throw new Error('migración/vínculos de ejemplo ausentes: ' + JSON.stringify(chk));

  // Formulario con el selector (escritorio)
  await p.click('#fabAdd');
  await p.waitForSelector('#movDialog[open]');
  await p.waitForTimeout(200);
  // elegir el Gimnasio (gasto pendiente)
  const recVal = await p.evaluate(() => {
    const s = document.querySelector('#mRecurrente');
    const o = [...s.options].find(x => /Gimnasio/i.test(x.textContent));
    return o ? o.value : '';
  });
  if (!recVal) throw new Error('no aparece el Gimnasio en el selector');
  await p.selectOption('#mRecurrente', recVal);
  await p.waitForTimeout(200);
  const formOk = await p.evaluate(() => {
    const row = document.querySelector('#rowRecurrente');
    if (row) row.scrollIntoView({ block: 'center' });
    return {
      rec: document.querySelector('#mRecurrente').value,
      per: document.querySelector('#mRecPeriodo').value,
      perVisible: !document.querySelector('#rowRecPeriodo').hidden,
      label: document.querySelector('label[for=mRecurrente]').textContent,
      importe: document.querySelector('#mImporte').value
    };
  });
  if (!formOk.rec || !formOk.perVisible || formOk.per !== '2026-11' || !formOk.importe) {
    throw new Error('formulario de vínculo incompleto: ' + JSON.stringify(formOk));
  }
  await p.evaluate(() => document.activeElement && document.activeElement.blur());
  await p.screenshot({ path: path.join(OUT, 'v3110-formulario-recurrente.png') });
  await p.setViewportSize({ width: 390, height: 844 });
  await p.evaluate(() => { const d = document.querySelector('#movDialog'); if (d) d.scrollTop = 0; });
  await p.waitForTimeout(200);
  await p.screenshot({ path: path.join(OUT, 'v3110-movil-formulario-recurrente.png') });
  await p.click('#movDialog [data-close]').catch(() => p.evaluate(() => document.querySelector('#movDialog').close()));

  // Previsión: pendiente (Gimnasio + Registrar) y hechos no duplicados
  await p.setViewportSize({ width: 1280, height: 900 });
  await p.click('nav.tabs button[data-view=prevision]');
  await p.waitForTimeout(600);
  await p.evaluate(() => window.scrollTo(0, 0));
  const prevOk = await p.evaluate(() => {
    const items = [...document.querySelectorAll('.prev-item')].map(e => e.innerText);
    const gim = items.find(t => /Gimnasio/.test(t));
    const btn = document.querySelector('[data-reg-rec="r-gim-demo"]');
    return { gim: gim || null, registrar: !!(btn && /Registrar/.test(btn.textContent)), nItems: items.length };
  });
  if (!prevOk.gim || !prevOk.registrar) throw new Error('previsión sin pendiente Gimnasio/Registrar: ' + JSON.stringify(prevOk));
  await p.screenshot({ path: path.join(OUT, 'v3110-prevision-pendientes.png'), fullPage: true });
  await p.setViewportSize({ width: 390, height: 844 });
  await p.evaluate(() => window.scrollTo(0, 0));
  await p.waitForTimeout(300);
  await p.screenshot({ path: path.join(OUT, 'v3110-movil-prevision-pendientes.png'), fullPage: true });

  // Lista de recurrentes con estado del mes y Registrar
  await p.setViewportSize({ width: 1280, height: 900 });
  await p.click('nav.tabs button[data-view=movimientos]');
  await p.waitForTimeout(400);
  await p.evaluate(() => { const el = document.querySelector('#recBody'); if (el) el.scrollIntoView({ block: 'center' }); });
  await p.waitForTimeout(200);
  await p.screenshot({ path: path.join(OUT, 'v3110-recurrentes-estado.png') });
  await p.setViewportSize({ width: 390, height: 844 });
  await p.evaluate(() => { const el = document.querySelector('#recBody'); if (el) el.scrollIntoView({ block: 'center' }); });
  await p.waitForTimeout(200);
  await p.screenshot({ path: path.join(OUT, 'v3110-movil-recurrentes-estado.png') });

  await b.close();
  if (errs.length) { console.error('Errores de consola:\n' + errs.join('\n')); process.exit(1); }
  console.log('Capturas v3.11.0 en', OUT);
  console.log(fs.readdirSync(OUT).join('\n'));
})().catch(e => { console.error(e); process.exit(1); });
