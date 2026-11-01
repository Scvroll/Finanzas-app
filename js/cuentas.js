/* =========================================================
   Cuentas bancarias, efectivo, traspasos y traspasos entre fondos (v3.4)
   - Cuentas: saldo = inicial + ingresos − gastos ± traspasos − compras + ventas ± ajustes
   - Los traspasos entre cuentas NO son gastos ni ingresos (solo su comisión, si la hay)
   - Las compras/ventas de inversión mueven el saldo, pero no son gasto ni ingreso
   ========================================================= */
const CuUI = { sel: null, crearNombre: null };
const TIPOS_FONDO_TRASPASO = ['fondo'];   // en España solo los fondos de inversión admiten traspaso sin tributar

/* ---------- Resumen: tarjeta de patrimonio ---------- */
function renderPatrimonio() {
  const p = Calc.patrimonio(), card = $('#patrimonioCard');
  card.hidden = !p.hayCuentas && !(p.inversiones > 0);
  if (card.hidden) return;
  const filas = p.saldos.lista.filter(x => x.cuenta.activa !== false || Math.abs(x.saldo) > 0.004).sort((a, b) => ordenCuentas(a.cuenta, b.cuenta));
  $('#patrimonioBody').innerHTML = `<div class="patrimonio">
    ${filas.map(x => `<div class="pat-row"><span>${esc(iconoCuenta(x.cuenta))} ${esc(x.cuenta.nombre)}</span><strong class="${x.saldo < 0 ? 'neg' : ''}">${eur(x.saldo)}</strong></div>`).join('')}
    ${p.hayCuentas ? `<div class="pat-row pat-sub" id="patDisponible"><span>💶 Disponible (cuentas del día a día)</span><strong class="${p.disponible < 0 ? 'neg' : ''}">${eur(p.disponible)}</strong></div>${Math.abs(p.apartado) > 0.004 || p.saldos.lista.some(x => !CuentasCore.enSaldoMes(x.cuenta)) ? `<div class="pat-row pat-sub" id="patApartado"><span>🐷 En cuentas de ahorro/inversión</span><strong>${eur(p.apartado)}</strong></div>` : ''}<div class="pat-row pat-sub"><span>Dinero en cuentas (total)</span><strong>${eur(p.cuentas)}</strong></div>` : '<div class="pat-row muted small"><span>Aún no has creado cuentas: el patrimonio solo incluye inversiones y deudas.</span></div>'}
    <div class="pat-row"><span>📈 Inversiones (valor)</span><strong>${eur(p.inversiones)}</strong></div>
    ${p.deudas ? `<div class="pat-row"><span>💳 Deuda pendiente</span><strong class="neg">−${eur(p.deudas)}</strong></div>` : ''}
    <div class="pat-row pat-total"><span>Patrimonio neto</span><strong class="${p.neto < 0 ? 'neg' : 'pos'}">${eur(p.neto)}</strong></div></div>`;
}

/* ---------- Pestaña Cuentas ---------- */
function etiquetaFlujo(f) {
  const t = { ingreso: ['Ingreso', 'ingreso'], gasto: ['Gasto', 'gasto'], 'traspaso-entrada': ['Traspaso', 'traspaso'], 'traspaso-salida': ['Traspaso', 'traspaso'], compra: ['Inversión', 'inversion'], venta: ['Venta inv.', 'inversion'], ajuste: ['Ajuste', 'ajuste'] }[f.tipo] || [f.tipo, ''];
  return `<span class="tag ${t[1]}">${t[0]}</span>`;
}
function botonFlujo(f) {
  if (f.col === 'movimientos') return `<button class="btn-sm" data-cu-mov="${esc(f.ref)}" title="Editar">✏️</button>`;
  if (f.col === 'traspasos') return `<button class="btn-sm" data-tr-edit="${esc(f.ref)}" title="Editar traspaso">✏️</button>`;
  if (f.col === 'regularizaciones') return `<button class="btn-sm" data-aj-edit="${esc(f.ref)}" title="Editar ajuste">✏️</button>`;
  if (f.col === 'operaciones') return `<button class="btn-sm" data-op-edit="${esc(f.ref)}" title="Editar operación">✏️</button>`;
  return '';
}
function renderCuentas() {
  const p = Calc.patrimonio(), S = p.saldos, cuentas = Store.list('cuentas');
  $('#ckTotal').textContent = eur(p.cuentas); $('#ckTotal').className = 'value ' + (p.cuentas < 0 ? 'neg' : '');
  const fut = S.lista.filter(x => x.futuros);
  $('#ckTotalSub').textContent = cuentas.length ? `${S.lista.filter(x => x.cuenta.activa !== false).length} cuenta(s) en uso${fut.length ? ` · con apuntes futuros: ${eur(round2(S.lista.reduce((t, x) => t + (x.cuenta.activa !== false || x.saldoFinal ? x.saldoFinal : 0), 0)))}` : ''}` : 'Crea tu primera cuenta';
  $('#ckInv').textContent = eur(p.inversiones); $('#ckDeuda').textContent = p.deudas ? '−' + eur(p.deudas) : eur(0);
  $('#ckNeto').textContent = eur(p.neto); $('#ckNeto').className = 'value ' + (p.neto < 0 ? 'neg' : 'pos');

  // Aviso para crear cuentas a partir de los nombres escritos a mano
  const sin = CuentasCore.nombresSinCuenta(cuentas, Store.getMovimientos(), Store.list('recurrentes'), Store.list('deudas'));
  const mig = $('#cuentasMigrar');
  mig.hidden = !sin.length && cuentas.length > 0;
  mig.innerHTML = sin.length ? `<div><strong>Has escrito estas cuentas en tus apuntes:</strong> ${sin.map(s => `<button class="btn-sm" data-cu-crear-nombre="${esc(s.nombre)}">＋ ${esc(s.nombre)} <span class="muted">(${s.n})</span></button>`).join(' ')}
      <div class="small muted">Crea la cuenta con el mismo nombre y esos apuntes se le asignan solos. Indica el saldo que tenía en la fecha del primer apunte.</div></div>`
    : `<div>Añade tus cuentas bancarias y el efectivo (👛 cartera) con su saldo de hoy. Después, al apuntar un gasto o ingreso, elige de qué cuenta sale o a cuál entra. Los traspasos entre tus cuentas no cuentan como gasto.</div>`;

  // Tarjetas
  const lista = [...S.lista].sort((a, b) => ordenCuentas(a.cuenta, b.cuenta));
  if (!CuUI.sel || !Store.get('cuentas', CuUI.sel)) CuUI.sel = lista[0]?.cuenta.id || null;
  $('#cuentasGrid').innerHTML = lista.map(x => {
    const c = x.cuenta, sub = [CuentasCore.TIPOS_CUENTA[c.tipo] || 'Cuenta', c.entidad, c.iban ? '····' + c.iban : ''].filter(Boolean).join(' · ');
    return `<div class="card cuenta-card ${c.id === CuUI.sel ? 'sel' : ''} ${c.activa === false ? 'archivada' : ''}" style="--cu-color:${esc(c.color || '#0f766e')}">
      <button class="cuenta-main" data-cu-ver="${c.id}" aria-label="Ver movimientos de ${esc(c.nombre)}">
        <span class="cuenta-ico">${esc(iconoCuenta(c))}</span>
        <span class="cuenta-txt"><strong>${esc(c.nombre)}</strong>${c.activa === false ? ' <span class="badge">archivada</span>' : ''}<small class="muted">${esc(sub)}</small></span>
        <span class="cuenta-saldo ${x.saldo < 0 ? 'neg' : ''}">${eur(x.saldo)}${x.futuros ? `<small class="muted">con futuros ${eur(x.saldoFinal)}</small>` : ''}</span></button>
      <div class="cuenta-actions"><span class="muted small">${x.n} apunte${x.n === 1 ? '' : 's'}${x.traspasosEntrada || x.traspasosSalida ? ` · ⇄ ${eur(round2(x.traspasosEntrada - x.traspasosSalida))}` : ''}${x.compras || x.ventas ? ` · inv. ${eur(round2(x.ventas - x.compras))}` : ''}</span>
        <span><button class="btn-sm" data-cu-ajustar="${c.id}" title="Ajustar saldo al de tu banco">⚖️ Ajustar</button> <button class="btn-sm" data-cu-edit="${c.id}" title="Editar cuenta">✏️</button></span></div>
    </div>`;
  }).join('') + `<button class="card cuenta-card cuenta-nueva" data-cu-nueva>＋ Añadir cuenta o efectivo</button>`;

  renderDetalleCuenta(S);
  // Traspasos
  const tr = Store.list('traspasos').sort((a, b) => b.fecha.localeCompare(a.fecha) || (b.updatedAt || 0) - (a.updatedAt || 0));
  const nom = id => { const c = Store.get('cuentas', id); return c ? esc(iconoCuenta(c) + ' ' + c.nombre) : '<span class="muted">¿borrada?</span>'; };
  $('#traspasosBody').innerHTML = tr.length ? tr.map(t => `<tr><td>${fmtFecha(t.fecha)}</td><td>${nom(t.origenId)} → ${nom(t.destinoId)}${t.nota ? `<div class="muted small">${esc(t.nota)}</div>` : ''}</td><td class="num">${eur(t.importe)}</td><td class="num hide-sm">${t.comision ? eur(t.comision) : '—'}</td>
    <td class="actions"><button class="btn-sm" data-tr-edit="${t.id}" title="Editar">✏️</button> <button class="btn-sm btn-danger" data-tr-del="${t.id}" title="Eliminar">🗑️</button></td></tr>`).join('')
    : `<tr><td colspan="5" class="empty">${cuentas.length < 2 ? 'Crea al menos dos cuentas para hacer traspasos.' : 'Sin traspasos. Ej.: de la cuenta nómina a la de inversión.'}</td></tr>`;
  $('#cuentaDefecto').innerHTML = opcionesCuenta(Store.state.ajustes.cuentaDefecto || '', { vacia: 'La última que usé en este dispositivo' });
}
function renderDetalleCuenta(S) {
  const c = CuUI.sel ? Store.get('cuentas', CuUI.sel) : null;
  $('#cuentaDetalle').hidden = !c; if (!c) return;
  $('#cdFiltro').innerHTML = opcionesCuenta(c.id, { vacia: null });
  [...$('#cdFiltro').options].forEach(o => { if (!o.value) o.remove(); });
  const archivadas = Store.list('cuentas').filter(x => x.activa === false && x.id !== c.id);
  archivadas.forEach(x => $('#cdFiltro').insertAdjacentHTML('beforeend', `<option value="${esc(x.id)}">${esc(iconoCuenta(x) + ' ' + x.nombre)} (archivada)</option>`));
  $('#cdFiltro').value = c.id;
  $('#cdTitulo').textContent = 'Movimientos · ' + c.nombre;
  const h = CuentasCore.historial(c, S.flujos), per = $('#cdPeriodo').value, hoy = todayISO();
  let desde = '0000-00-00', hasta = '9999-12-31';
  if (per === '12') desde = addMonths(monthKey(hoy), -11) + '-01';
  if (per === 'mes') { desde = periodo().desde; hasta = periodo().hasta; }
  if (per === 'anio') { desde = UI.mes.slice(0, 4) + '-01-01'; hasta = UI.mes.slice(0, 4) + '-12-31'; }
  const filas = h.filter(f => f.fecha >= desde && f.fecha <= hasta);
  const ini = `<tr class="muted"><td>${c.fechaSaldo && c.fechaSaldo > '2000-01-01' ? fmtFecha(c.fechaSaldo) : '—'}</td><td>Saldo inicial</td><td class="num"></td><td class="num">${eur(c.saldoInicial)}</td><td></td></tr>`;
  $('#cdBody').innerHTML = filas.slice().reverse().map(f => `<tr class="${f.fecha > hoy ? 'futuro' : ''}"><td>${fmtFecha(f.fecha)}</td><td>${etiquetaFlujo(f)} ${esc(f.concepto || '')}${f.nota ? `<div class="muted small">${esc(f.nota)}</div>` : ''}</td>
    <td class="num ${f.importe < 0 ? 'neg' : 'pos'}">${f.importe > 0 ? '+' : ''}${eur(f.importe)}</td><td class="num">${eur(f.saldo)}</td><td class="actions">${botonFlujo(f)}</td></tr>`).join('')
    + (desde <= (c.fechaSaldo || '2000-01-01') ? ini : '') || `<tr><td colspan="5" class="empty">Sin apuntes en este periodo.</td></tr>`;
  $('#cdNota').textContent = `Saldo inicial ${eur(c.saldoInicial)}${c.fechaSaldo && c.fechaSaldo > '2000-01-01' ? ' al empezar el ' + fmtFecha(c.fechaSaldo) + ' (lo anterior no cuenta)' : ''}. Los traspasos, compras de inversión y ajustes mueven el saldo pero no son gastos ni ingresos.`;
  if (typeof Chart === 'undefined') return;
  // Evolución del saldo (fin de cada mes; en «mes» por días)
  let puntos;
  if (per === 'mes') {
    const dias = [...new Set(filas.map(f => f.fecha))];
    puntos = [{ x: fmtFecha(desde), y: CuentasCore.saldoEn(c, S.flujos, addDaysISO(desde, -1)) }, ...dias.map(d => ({ x: fmtFecha(d), y: CuentasCore.saldoEn(c, S.flujos, d) }))];
  } else {
    let d0 = per === 'todo' ? (h[0]?.fecha || c.fechaSaldo || hoy) : desde;
    if (d0 < '2000-01-02') d0 = h[0]?.fecha || hoy;
    const h1 = per === 'anio' ? hasta.slice(0, 7) : monthKey(hoy);
    puntos = CuentasCore.serieMensual(c, S.flujos, monthKey(d0), h1).map(m => ({ x: monthLabel(m.mes), y: m.saldo }));
  }
  if (UI.charts.cuenta) UI.charts.cuenta.destroy();
  const col = c.color || cssVar('--primary') || '#0f766e', grid = cssVar('--border'), muted = cssVar('--muted');
  UI.charts.cuenta = new Chart($('#chartCuenta'), { type: 'line',
    data: { labels: puntos.map(p => p.x), datasets: [{ label: 'Saldo', data: puntos.map(p => p.y), borderColor: col, backgroundColor: col + '22', fill: true, tension: .2, pointRadius: puntos.length > 40 ? 0 : 3, stepped: per === 'mes' }] },
    options: { maintainAspectRatio: false, plugins: { legend: { display: false }, tooltip: { callbacks: { label: x => 'Saldo: ' + eur(x.parsed.y) } } },
      scales: { x: { grid: { color: grid }, ticks: { color: muted, maxRotation: 0, autoSkip: true } }, y: { grid: { color: grid }, ticks: { color: muted, callback: v => eur(v) } } } } });
}
function addDaysISO(iso, n) { const d = new Date(iso + 'T12:00:00'); d.setDate(d.getDate() + n); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }

/* ---------- Diálogo de cuenta ---------- */
$('#cuTipo').innerHTML = Object.entries(CuentasCore.TIPOS_CUENTA).map(([k, v]) => `<option value="${k}">${CuentasCore.ICONO_TIPO[k]} ${v}</option>`).join('');
function primeraFechaNombre(nombre) {
  const k = CuentasCore.normNombre(nombre);
  const fechas = Store.getMovimientos().filter(m => !m.cuentaId && CuentasCore.normNombre(m.cuenta) === k).map(m => m.fecha).sort();
  return fechas[0] || todayISO();
}
function openCuentaDialog(c, pre = {}) {
  const f = $('#cuentaForm'); f.reset(); $('#cuentaError').style.display = 'none';
  f.id.value = c?.id || ''; f.nombre.value = c?.nombre || pre.nombre || '';
  f.tipo.value = c?.tipo || pre.tipo || 'corriente'; f.entidad.value = c?.entidad || '';
  f.saldoInicial.value = c ? fmtInput(c.saldoInicial) : '';
  f.fechaSaldo.value = c ? (c.fechaSaldo > '2000-01-01' ? c.fechaSaldo : '') : (pre.nombre ? primeraFechaNombre(pre.nombre) : todayISO());
  f.iban.value = c?.iban || ''; f.icono.value = c?.icono || ''; f.color.value = c?.color || '#0f766e';
  f.activa.checked = c ? c.activa !== false : true;
  f.enSaldoMes.checked = c ? CuentasCore.enSaldoMes(c) : CuentasCore.enSaldoPorDefecto(f.tipo.value);
  f.enSaldoMes.dataset.tocado = c && typeof c.enSaldoMes === 'boolean' ? '1' : '';
  $('#cuentaDialogTitle').textContent = c ? 'Editar cuenta' : 'Nueva cuenta';
  $('#cuentaDelete').style.display = c ? '' : 'none';
  $('#cuentaAyuda').textContent = pre.nombre
    ? `Se le asignarán los apuntes que tienen escrita la cuenta «${pre.nombre}». La fecha es la del primero: pon el saldo que había ese día ANTES de él (si no lo sabes, pon 0 y luego usa «Ajustar saldo» con el saldo de hoy).`
    : 'Saldo inicial: el dinero que había en la cuenta al empezar el día de la fecha indicada (lo anterior a esa fecha no cuenta). Para el efectivo, lo que llevas en la cartera.';
  $('#cuentaDialog').showModal();
}
$('#cuEnSaldo').addEventListener('change', e => { e.target.dataset.tocado = '1'; });
$('#cuTipo').addEventListener('change', e => { const ch = $('#cuEnSaldo'); if (!ch.dataset.tocado) ch.checked = CuentasCore.enSaldoPorDefecto(e.target.value); });
$('#cuTipo').addEventListener('change', e => { const ic = $('#cuIcono'); if (!ic.value || Object.values(CuentasCore.ICONO_TIPO).includes(ic.value)) ic.placeholder = CuentasCore.ICONO_TIPO[e.target.value]; });
$('#cuentaForm').addEventListener('submit', async e => {
  e.preventDefault();
  const f = e.target, err = m => { $('#cuentaError').textContent = m; $('#cuentaError').style.display = ''; };
  const nombre = txt(f.nombre.value);
  if (!nombre) return err('Pon un nombre (p. ej. «Nómina BBVA» o «Cartera»).');
  if (Store.list('cuentas').some(c => c.id !== f.id.value && CuentasCore.normNombre(c.nombre) === CuentasCore.normNombre(nombre))) return err('Ya tienes una cuenta con ese nombre.');
  const saldo = f.saldoInicial.value.trim() ? parseImporte(f.saldoInicial.value) : 0;
  if (!isFinite(saldo)) return err('Revisa el saldo inicial (p. ej. 1.250,40 o -30).');
  if (f.fechaSaldo.value && !FC.isISO(f.fechaSaldo.value)) return err('Revisa la fecha del saldo.');
  const iban = f.iban.value.replace(/\D/g, '').slice(-4);
  if (f.iban.value.trim() && iban.length !== 4) return err('Del IBAN pon al menos los 4 últimos dígitos (p. ej. 1234); solo se guardan esos 4.');
  const viejo = Store.get('cuentas', f.id.value);
  const c = { ...(viejo || {}), id: f.id.value || null, nombre, tipo: f.tipo.value, entidad: txt(f.entidad.value), saldoInicial: round2(saldo), fechaSaldo: f.fechaSaldo.value || '2000-01-01',
    iban, icono: txt(f.icono.value), color: f.color.value, activa: f.activa.checked, orden: viejo ? viejo.orden : Store.list('cuentas').length };
  // v3.6: solo se guarda si es distinto de lo normal para su tipo (corriente/efectivo/otra sí; ahorro/inversión no)
  if (f.enSaldoMes.checked !== CuentasCore.enSaldoPorDefecto(c.tipo)) c.enSaldoMes = f.enSaldoMes.checked; else delete c.enSaldoMes;
  const r = await Store.saveCuenta(c);
  CuUI.sel = r?.id || CuUI.sel;
  $('#cuentaDialog').close(); toast(viejo ? 'Cuenta guardada' : 'Cuenta creada');
});
$('#cuentaDelete').addEventListener('click', async () => {
  const id = $('#cuentaForm').id.value, c = Store.get('cuentas', id); if (!c) return;
  const u = CuentasCore.usos(c, { movimientos: Store.getMovimientos(), recurrentes: Store.list('recurrentes'), deudas: Store.list('deudas'), operaciones: Store.list('operaciones'), traspasos: Store.list('traspasos'), regularizaciones: Store.list('regularizaciones'), cuentas: Store.list('cuentas') });
  let msg = `¿Eliminar la cuenta «${c.nombre}»?`;
  if (u.total) {
    const partes = [u.movimientos && `${u.movimientos} gasto(s)/ingreso(s)`, u.recurrentes && `${u.recurrentes} recurrente(s)`, u.deudas && `${u.deudas} deuda(s)`, u.operaciones && `${u.operaciones} operación(es) de inversión`].filter(Boolean);
    msg += `\n\nSe usa en: ${[...partes, u.traspasos && `${u.traspasos} traspaso(s)`, u.regularizaciones && `${u.regularizaciones} ajuste(s)`].filter(Boolean).join(', ')}.`;
    if (partes.length) msg += '\n• Esos apuntes NO se borran: quedan «sin cuenta».';
    if (u.traspasos || u.regularizaciones) msg += '\n• Sus traspasos (y la comisión de cada uno) y sus ajustes de saldo SÍ se borran.';
    msg += '\n\nSi solo quieres que deje de salir en las listas, mejor desmarca «En uso» (archivar).';
  }
  if (!confirm(msg)) return;
  await Store.deleteCuenta(id); $('#cuentaDialog').close(); toast('Cuenta eliminada');
});

/* ---------- Traspaso entre cuentas ---------- */
function openTraspasoDialog(t, pre = {}) {
  const activas = Store.list('cuentas').filter(c => c.activa !== false);
  if (!t && activas.length < 2) { toast('Crea al menos dos cuentas para hacer un traspaso'); return openCuentaDialog(); }
  const f = $('#traspasoForm'); f.reset(); $('#traspasoError').style.display = 'none';
  const o = t?.origenId || pre.origenId || cuentaPorDefecto()?.id || activas[0].id;
  f.origenId.innerHTML = opcionesCuenta(o, { vacia: null }); f.origenId.value = o;
  const d = t?.destinoId || pre.destinoId || (activas.find(c => c.id !== f.origenId.value) || {}).id;
  f.destinoId.innerHTML = opcionesCuenta(d, { vacia: null }); f.destinoId.value = d;
  f.id.value = t?.id || ''; f.importe.value = t ? fmtInput(t.importe) : ''; f.fecha.value = t?.fecha || todayISO();
  f.comision.value = t?.comision ? fmtInput(t.comision) : ''; f.nota.value = t?.nota || '';
  $('#traspasoDialogTitle').textContent = t ? 'Editar traspaso' : 'Traspaso entre cuentas';
  $('#traspasoDelete').style.display = t ? '' : 'none';
  $('#traspasoDialog').showModal();
}
$('#traspasoForm').addEventListener('submit', async e => {
  e.preventDefault();
  const f = e.target, err = m => { $('#traspasoError').textContent = m; $('#traspasoError').style.display = ''; };
  const importe = parseImporte(f.importe.value), com = f.comision.value.trim() ? parseImporte(f.comision.value) : 0;
  if (!f.origenId.value || !f.destinoId.value) return err('Elige la cuenta de origen y la de destino.');
  if (f.origenId.value === f.destinoId.value) return err('El origen y el destino deben ser cuentas distintas.');
  if (!(importe > 0)) return err('Introduce un importe mayor que 0.');
  if (!(com >= 0) || !isFinite(com)) return err('Revisa la comisión (o déjala vacía).');
  if (!FC.isISO(f.fecha.value)) return err('Indica la fecha.');
  const viejo = Store.get('traspasos', f.id.value);
  await Store.saveTraspaso({ ...(viejo || {}), id: f.id.value || null, fecha: f.fecha.value, origenId: f.origenId.value, destinoId: f.destinoId.value, importe: round2(importe), comision: round2(com), nota: txt(f.nota.value) });
  $('#traspasoDialog').close(); toast(viejo ? 'Traspaso actualizado' : 'Traspaso guardado (no cuenta como gasto)');
});
async function borrarTraspaso(id) {
  const t = Store.get('traspasos', id); if (!t) return;
  if (!confirm(`¿Eliminar el traspaso de ${eur(t.importe)} del ${fmtFecha(t.fecha)}?${t.comision ? `\n\nTambién se borra su comisión (${eur(t.comision)}).` : ''}`)) return false;
  await Store.remove('traspasos', id); toast('Traspaso eliminado'); return true;
}
$('#traspasoDelete').addEventListener('click', async () => { if (await borrarTraspaso($('#traspasoForm').id.value)) $('#traspasoDialog').close(); });

/* ---------- Ajuste de saldo ---------- */
function flujosSin(regId) {
  const d = Calc.datosCuentas(); d.regularizaciones = d.regularizaciones.filter(r => r.id !== regId);
  return CuentasCore.flujos(d);
}
function previewAjuste() {
  const f = $('#ajusteForm'), c = Store.get('cuentas', f.cuentaId.value); if (!c) return;
  const fl = flujosSin(f.id.value), fecha = FC.isISO(f.fecha.value) ? f.fecha.value : todayISO();
  const app = CuentasCore.saldoEn(c, fl, fecha), real = parseImporte(f.saldoReal.value);
  if (!f.saldoReal.value.trim() || !isFinite(real)) { $('#ajPreview').innerHTML = `Saldo según la app el ${fmtFecha(fecha)}: <strong>${eur(app)}</strong>`; return; }
  const dif = CuentasCore.diferenciaAjuste(c, fl, fecha, real);
  $('#ajPreview').innerHTML = `Saldo según la app: <strong>${eur(app)}</strong> · real: <strong>${eur(real)}</strong> · ` +
    (Math.abs(dif) < 0.005 ? '<span class="pos">✔ ya cuadra, no hace falta ajuste</span>' : `ajuste de <strong class="${dif < 0 ? 'neg' : 'pos'}">${dif > 0 ? '+' : ''}${eur(dif)}</strong>`);
}
function openAjusteDialog(cuentaId, reg) {
  const c = Store.get('cuentas', cuentaId); if (!c) return;
  const f = $('#ajusteForm'); f.reset(); $('#ajusteError').style.display = 'none';
  f.cuentaId.value = cuentaId; f.id.value = reg?.id || ''; f.fecha.value = reg?.fecha || todayISO();
  f.saldoReal.value = reg ? fmtInput(reg.saldoReal) : ''; f.nota.value = reg?.nota || '';
  $('#ajusteTitulo').textContent = (reg ? 'Editar ajuste · ' : 'Ajustar saldo · ') + c.nombre;
  $('#ajusteDelete').style.display = reg ? '' : 'none';
  previewAjuste(); $('#ajusteDialog').showModal(); setTimeout(() => f.saldoReal.focus(), 30);
}
$('#ajusteForm').addEventListener('input', previewAjuste);
$('#ajusteForm').addEventListener('submit', async e => {
  e.preventDefault();
  const f = e.target, err = m => { $('#ajusteError').textContent = m; $('#ajusteError').style.display = ''; };
  const c = Store.get('cuentas', f.cuentaId.value); if (!c) return;
  if (!FC.isISO(f.fecha.value)) return err('Indica la fecha.');
  if (c.fechaSaldo && f.fecha.value < c.fechaSaldo) return err(`La fecha no puede ser anterior a la del saldo inicial (${fmtFecha(c.fechaSaldo)}). Cambia el saldo inicial de la cuenta.`);
  const real = parseImporte(f.saldoReal.value);
  if (!f.saldoReal.value.trim() || !isFinite(real)) return err('Escribe el saldo real (el que dice tu banco o lo que hay en la cartera).');
  const dif = CuentasCore.diferenciaAjuste(c, flujosSin(f.id.value), f.fecha.value, real);
  if (Math.abs(dif) < 0.005) {
    if (f.id.value) await Store.remove('regularizaciones', f.id.value);
    $('#ajusteDialog').close(); return toast('El saldo ya cuadra: no hace falta ajuste');
  }
  const viejo = Store.get('regularizaciones', f.id.value);
  await Store.put('regularizaciones', { ...(viejo || {}), id: f.id.value || null, cuentaId: c.id, fecha: f.fecha.value, importe: dif, saldoReal: round2(real), nota: txt(f.nota.value) });
  $('#ajusteDialog').close(); toast(`Ajuste de ${dif > 0 ? '+' : ''}${eur(dif)} apuntado (no es ingreso ni gasto)`);
});
$('#ajusteDelete').addEventListener('click', async () => {
  if (!confirm('¿Eliminar este ajuste de saldo?')) return;
  await Store.remove('regularizaciones', $('#ajusteForm').id.value); $('#ajusteDialog').close(); toast('Ajuste eliminado');
});

/* ---------- Traspaso entre fondos ---------- */
const esFondo = a => a && TIPOS_FONDO_TRASPASO.includes(a.tipo);
function opcionesFondos(sel, excluir) {
  return Store.list('activos').filter(a => (esFondo(a) || a.id === sel) && a.id !== excluir).sort((a, b) => a.nombre.localeCompare(b.nombre, LOCALE))
    .map(a => `<option value="${a.id}" ${a.id === sel ? 'selected' : ''}>${esc(a.nombre)}${esFondo(a) ? '' : ' (no es fondo)'}</option>`).join('');
}
function tfRellenarDestino(sel) {
  const f = $('#tfForm'), cur = sel || f.destinoId.value;
  f.destinoId.innerHTML = '<option value="">— Elige el fondo de destino —</option>' + opcionesFondos(cur, f.origenId.value);
  f.destinoId.value = cur && cur !== f.origenId.value && Store.get('activos', cur) ? cur : '';
}
function tfLeer() {
  const f = $('#tfForm'), n = v => v.trim() ? parseImporte(v) : null;
  return { id: f.id.value || null, fecha: f.fecha.value, origenId: f.origenId.value, destinoId: f.destinoId.value, todas: f.todas.checked,
    participaciones: f.todas.checked ? null : n(f.participaciones.value), participacionesDestino: n(f.participacionesDestino.value),
    vlOrigen: n(f.vlOrigen.value), vlDestino: n(f.vlDestino.value), notas: txt(f.notas.value) };
}
function previewTf() {
  const f = $('#tfForm'), t = tfLeer(), out = [];
  f.participaciones.disabled = t.todas;
  if (t.origenId && FC.isISO(t.fecha)) {
    const disp = FC.disponibleActivo(t.origenId, Store.list('operaciones'), Store.list('traspasosFondos'), t.fecha, t.id);
    out.push(`Disponibles en el origen el ${fmtFecha(t.fecha)}: <strong>${fmtPart.format(disp)}</strong> part.`);
    if (t.todas) t.participaciones = disp;
  }
  const c = FC.cuadreTraspasoFondos({ participaciones: t.participaciones, vlOrigen: t.vlOrigen, participacionesDestino: t.participacionesDestino, vlDestino: t.vlDestino });
  if (c.sale !== null) out.push(`Sale ${eur(c.sale)}`);
  if (c.entra !== null) out.push(`entra ${eur(c.entra)}`);
  if (c.diferencia !== null && !c.cuadra) out.push(`<span class="neg">⚠ no cuadra (${eur(c.diferencia)}): revisa participaciones y VL</span>`);
  if (t.participaciones > 0 && t.vlOrigen > 0 && t.vlDestino > 0) f.participacionesDestino.placeholder = 'aprox. ' + fmtPart.format(t.participaciones * t.vlOrigen / t.vlDestino);
  // Coste que se hereda
  if (t.origenId && t.destinoId && t.origenId !== t.destinoId && FC.isISO(t.fecha) && (t.todas || t.participaciones > 0) && t.participacionesDestino > 0) {
    const tfs = Store.list('traspasosFondos').filter(x => x.id !== t.id).concat({ ...t, id: t.id || '_nuevo', participaciones: t.todas ? null : t.participaciones });
    const cf = FC.carteraFIFO(Store.list('operaciones'), tfs), s = (cf.porActivo[t.origenId]?.traspasosSalida || []).find(x => x.traspasoId === (t.id || '_nuevo'));
    if (s) out.push(`El destino hereda un coste de <strong>${eur(s.coste)}</strong> (${s.lotes.length} lote${s.lotes.length === 1 ? '' : 's'} con sus fechas de compra) · sin ganancia ni pérdida`);
  }
  $('#tfPreview').innerHTML = out.join(' · ');
}
function openTfDialog(tf, origenId) {
  const fondos = Store.list('activos').filter(esFondo);
  if (!tf && origenId && !esFondo(Store.get('activos', origenId))) return alert('Los traspasos sin tributar solo existen entre fondos de inversión. Para acciones, ETF o cripto, apunta una venta y una compra.');
  if (!tf && !fondos.length) { toast('Primero crea un activo de tipo «Fondo»'); return openActivoDialog(); }
  const f = $('#tfForm'); f.reset(); $('#tfError').style.display = 'none';
  const o = tf?.origenId || origenId || fondos[0].id;
  f.origenId.innerHTML = opcionesFondos(o); f.origenId.value = o;
  tfRellenarDestino(tf?.destinoId || '');
  f.id.value = tf?.id || ''; f.fecha.value = tf?.fecha || todayISO(); f.todas.checked = !!tf?.todas;
  f.participaciones.value = tf && !tf.todas ? fmtInputN(tf.participaciones) : ''; f.participacionesDestino.value = tf ? fmtInputN(tf.participacionesDestino) : '';
  f.vlOrigen.value = tf?.vlOrigen ? fmtInputN(tf.vlOrigen) : ''; f.vlDestino.value = tf?.vlDestino ? fmtInputN(tf.vlDestino) : ''; f.notas.value = tf?.notas || '';
  f.participacionesDestino.placeholder = '';
  $('#tfTitulo').textContent = tf ? 'Editar traspaso entre fondos' : 'Traspaso entre fondos';
  $('#tfDelete').style.display = tf ? '' : 'none';
  previewTf(); $('#tfDialog').showModal();
}
$('#tfForm').addEventListener('input', previewTf);
$('#tfOrigen').addEventListener('change', () => { tfRellenarDestino(); previewTf(); });
$('#tfNuevoFondo').addEventListener('click', () => { CuUI.tfNuevo = true; openActivoDialog(); $('#aTipo').value = 'fondo'; });
/** Llamado al crear un activo desde el diálogo de traspaso. */
function tfFondoCreado(a) { CuUI.tfNuevo = false; if ($('#tfDialog').open) { tfRellenarDestino(a.id); previewTf(); } }
$('#tfForm').addEventListener('submit', async e => {
  e.preventDefault();
  const f = e.target, err = m => { $('#tfError').textContent = m; $('#tfError').style.display = ''; };
  const t = tfLeer(), o = Store.get('activos', t.origenId), d = Store.get('activos', t.destinoId);
  if (!FC.isISO(t.fecha)) return err('Indica la fecha.');
  if (!o || !d) return err('Elige el fondo de origen y el de destino.');
  if (o.id === d.id) return err('El origen y el destino deben ser fondos distintos.');
  if (!esFondo(o) || !esFondo(d)) return err('Los traspasos sin tributar solo son entre fondos de inversión (tipo «Fondo»). Para acciones, ETF o cripto apunta una venta y una compra.');
  if (!t.todas && !(t.participaciones > 0)) return err('Indica las participaciones que salen (o marca «Todas»).');
  if (!(t.participacionesDestino > 0)) return err('Indica las participaciones recibidas en el fondo de destino.');
  for (const k of ['vlOrigen', 'vlDestino']) if (t[k] !== null && !(t[k] > 0)) return err('Revisa el valor liquidativo (o déjalo vacío).');
  const viejo = Store.get('traspasosFondos', t.id);
  const rec = { ...(viejo || {}), ...t, id: t.id || uid(), creado: viejo?.creado || Date.now() };
  if (rec.todas) rec.participaciones = null;
  const errs = erroresCambioCartera({ tfs: Store.list('traspasosFondos').filter(x => x.id !== rec.id).concat(rec) });
  if (errs.length) return err(errs[0].texto + '. Revisa la fecha y las participaciones.');
  const c = FC.cuadreTraspasoFondos({ participaciones: rec.todas ? FC.disponibleActivo(o.id, Store.list('operaciones'), Store.list('traspasosFondos'), rec.fecha, rec.id) : rec.participaciones, vlOrigen: rec.vlOrigen, participacionesDestino: rec.participacionesDestino, vlDestino: rec.vlDestino });
  if (!c.cuadra && !confirm(`Lo que sale (${eur(c.sale)}) y lo que entra (${eur(c.entra)}) no cuadran (${eur(c.diferencia)}). ¿Guardar igualmente?`)) return;
  await Store.put('traspasosFondos', rec);
  $('#tfDialog').close(); toast('Traspaso entre fondos guardado');
  if ($('#detDialog').open) openDetalle(Det.id);
});
async function borrarTf(id) {
  const t = Store.get('traspasosFondos', id); if (!t) return false;
  if (erroresCambioCartera({ tfs: Store.list('traspasosFondos').filter(x => x.id !== id) }).length)
    { alert('No se puede borrar: hay ventas o traspasos posteriores del fondo de destino que usan esas participaciones. Bórralos o edítalos antes.'); return false; }
  if (!confirm(`¿Eliminar el traspaso del ${fmtFecha(t.fecha)}? Las participaciones volverán al fondo de origen.`)) return false;
  await Store.remove('traspasosFondos', id); toast('Traspaso eliminado');
  if ($('#detDialog').open) openDetalle(Det.id);
  return true;
}
$('#tfDelete').addEventListener('click', async () => { if (await borrarTf($('#tfForm').id.value)) $('#tfDialog').close(); });

/* ---------- Asignar cuenta a operaciones (en bloque) ---------- */
function asCandidatas() {
  const f = $('#asignarForm');
  return Store.list('operaciones').filter(o => o.activoId === f.activoId.value && (!f.desde.value || o.fecha >= f.desde.value) && (f.sobrescribir.checked || !o.cuentaId));
}
function previewAsignar() {
  const f = $('#asignarForm'), l = asCandidatas(), c = Store.get('cuentas', f.cuentaId.value);
  const compras = l.filter(o => o.tipo === 'compra').reduce((s, o) => s + o.participaciones * o.precio + (o.comisiones || 0), 0);
  const ventas = l.filter(o => o.tipo === 'venta').reduce((s, o) => s + o.participaciones * o.precio - (o.comisiones || 0), 0);
  const antesDe = c && c.fechaSaldo ? l.filter(o => o.fecha < c.fechaSaldo).length : 0;
  $('#asPreview').innerHTML = l.length ? `${l.length} operación(es)${c ? `: restarán ${eur(compras)} y sumarán ${eur(ventas)} en «${esc(c.nombre)}»` : ': se quitará su cuenta'}.` +
    (antesDe ? ` <span class="muted">${antesDe} son anteriores a la fecha del saldo inicial de la cuenta (${fmtFecha(c.fechaSaldo)}) y no afectarán a su saldo.</span>` : '') : 'No hay operaciones que cambiar con estos criterios.';
}
function openAsignarDialog(activoId) {
  const a = Store.get('activos', activoId); if (!a) return;
  if (!Store.list('cuentas').length) { toast('Primero crea tus cuentas (pestaña «Cuentas»)'); return; }
  const f = $('#asignarForm'); f.reset(); f.activoId.value = activoId;
  const pre = Store.list('cuentas').find(c => c.tipo === 'inversion' && c.activa !== false) || cuentaPorDefecto();
  f.cuentaId.innerHTML = opcionesCuenta(pre?.id || '', { vacia: '— Ninguna (quitar la cuenta) —' });
  f.desde.value = pre && pre.fechaSaldo > '2000-01-01' ? pre.fechaSaldo : '';
  $('#asignarTitulo').textContent = 'Asignar cuenta · ' + a.nombre;
  previewAsignar(); $('#asignarDialog').showModal();
}
$('#asignarForm').addEventListener('input', previewAsignar);
$('#asCuenta').addEventListener('change', () => { const c = Store.get('cuentas', $('#asCuenta').value); if (c && c.fechaSaldo > '2000-01-01' && !$('#asDesde').value) $('#asDesde').value = c.fechaSaldo; previewAsignar(); });
$('#asignarForm').addEventListener('submit', async e => {
  e.preventDefault();
  const f = e.target, l = asCandidatas(), cid = f.cuentaId.value;
  if (!l.length) return toast('No hay operaciones que cambiar');
  await Store.apply(l.map(o => { const { cuentaId, ...r } = o; return { col: 'operaciones', rec: cid ? { ...r, cuentaId: cid } : r }; }));
  $('#asignarDialog').close(); toast(`${l.length} operación(es) actualizadas`);
  if ($('#detDialog').open) openDetalle(Det.id);
});

/* ---------- Eventos ---------- */
$('#addCuentaBtn').addEventListener('click', () => openCuentaDialog());
$('#addTraspasoBtn').addEventListener('click', () => openTraspasoDialog());
$('#addTraspasoBtn2').addEventListener('click', () => openTraspasoDialog());
$('#addTfBtn').addEventListener('click', () => openTfDialog());
$('#cdFiltro').addEventListener('change', e => { CuUI.sel = e.target.value; renderCuentas(); });
$('#cdPeriodo').addEventListener('change', () => renderCuentas());
$('#cuentaDefecto').addEventListener('change', async e => { await Store.setAjuste('cuentaDefecto', e.target.value || ''); toast('Cuenta por defecto guardada'); });
document.addEventListener('click', async e => {
  const t = e.target.closest('button'); if (!t) return;
  const d = t.dataset;
  if ('irCuentas' in d) showView('cuentas');
  if ('cuNueva' in d) openCuentaDialog();
  if (d.cuCrearNombre) openCuentaDialog(null, { nombre: d.cuCrearNombre });
  if (d.cuVer) { CuUI.sel = d.cuVer; renderCuentas(); $('#cuentaDetalle').scrollIntoView({ behavior: 'smooth', block: 'start' }); }
  if (d.cuEdit) openCuentaDialog(Store.get('cuentas', d.cuEdit));
  if (d.cuAjustar) openAjusteDialog(d.cuAjustar);
  if (d.cuMov) { const m = Store.get('movimientos', d.cuMov); if (m) openMovDialog(m); }
  if (d.trEdit) openTraspasoDialog(Store.get('traspasos', d.trEdit));
  if (d.trDel) borrarTraspaso(d.trDel);
  if (d.ajEdit) { const r = Store.get('regularizaciones', d.ajEdit); if (r) openAjusteDialog(r.cuentaId, r); }
  if (d.tfEdit) openTfDialog(Store.get('traspasosFondos', d.tfEdit));
  if (d.tfDel) borrarTf(d.tfDel);
});
