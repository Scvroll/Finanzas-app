/* =========================================================
   Planificación (v3.9): presupuestos por categoría (p. ej. Combustible 200 € por nómina) e ingresos previstos
   (pagas extra, productividad, ingresos puntuales). Se guardan en tu Drive (colección «previstos») y se pueden
   editar o borrar cuando quieras. La lógica está en js/plan-core.js y js/prevision-core.js; aquí solo se pinta.
   ========================================================= */
const mesNombre = n => { const s = PlanCore.MESES[n - 1] || ''; return s[0] ? s[0].toUpperCase() + s.slice(1) : s; };
const planIngresos = () => PlanCore.ingresos(Store.list('previstos')).sort((a, b) => (a.repetir === 'una') - (b.repetir === 'una') || (a.descripcion || '').localeCompare(b.descripcion || '', 'es'));

/** Tarjeta «Planificación» de la Previsión. `P` = resultado de la previsión (para el estado del periodo actual y lo ya cobrado). */
function renderPlan(P) {
  const nom = P && P.modo === 'nomina', ud = nom ? 'periodo' : 'mes';
  const pres = PlanCore.presupuestos(Store.list('previstos')), ings = planIngresos(), m0 = P && P.meses[0];
  const filaPres = p => {
    const e = m0 && m0.presupuestosDet.find(x => x.id === p.id);
    return `<tr data-plan-id="${p.id}"><td><strong>${esc(p.categoria)}</strong><div class="muted small">${eur(p.importe)} por ${ud} · cuenta como gasto fijo en la Previsión</div></td>
      <td class="small">${e ? `Este ${ud}: ${eur(e.gastado)} gastado · ${e.excedido ? `<span class="neg">te has pasado ${eur(e.excedido)}</span>` : `<span class="pos">quedan ${eur(e.queda)}</span>`}` : ''}</td>
      <td class="num nowrap"><button class="btn-sm" data-plan-editar="${p.id}">Editar</button></td></tr>`;
  };
  const filaIng = p => {
    const cob = (P?.cumplidos || []).filter(c => c.id === p.id);
    return `<tr data-plan-id="${p.id}"><td><strong>${esc(p.descripcion || p.categoria)}</strong> ${p.estimado ? '<span class="badge b-var">Estimado</span>' : ''}
      <div class="muted small">${eur(p.importe)} · ${esc(PlanCore.textoCuando(p))} · ${p.conNomina ? 'con la nómina' : `día ${p.dia === FC.DIA_ULTIMO ? 'último' : p.dia}`} · ${esc(p.categoria || '')}</div>
      ${cob.map(c => `<div class="small pos">✔ ${monthLabel(c.mes)}: cobrado ${eur(c.real)}${Math.abs(c.real - c.previsto) > 0.004 ? ` (previsto ${eur(c.previsto)})` : ''} · se usa el real</div>`).join('')}</td>
      <td><label class="check small"><input type="checkbox" data-plan-incluir="${p.id}" ${p.incluir !== false ? 'checked' : ''}> Contar en la Previsión</label></td>
      <td class="num nowrap"><button class="btn-sm" data-plan-editar="${p.id}">Editar</button></td></tr>`;
  };
  $('#planBody').innerHTML = `
    <h4 class="plan-h">Presupuestos por ${ud}</h4>
    ${pres.length ? `<div class="table-wrap"><table class="plan-tabla"><tbody>${pres.map(filaPres).join('')}</tbody></table></div>`
      : `<p class="muted small">Sin presupuestos. Por ejemplo: <button class="btn-sm" type="button" data-plan-preset="combustible">⛽ Combustible 200 € por ${ud}</button></p>`}
    ${P?.recurrentesEnPresupuesto?.length ? `<p class="muted small">🔁 ${P.recurrentesEnPresupuesto.length} recurrente${P.recurrentesEnPresupuesto.length === 1 ? '' : 's'} de una categoría con presupuesto: no se suma${P.recurrentesEnPresupuesto.length === 1 ? '' : 'n'} aparte (ya lo cubre el presupuesto).</p>` : ''}
    <h4 class="plan-h">Ingresos previstos</h4>
    ${ings.length ? `<div class="table-wrap"><table class="plan-tabla"><tbody>${ings.map(filaIng).join('')}</tbody></table></div>` : '<p class="muted small">Sin ingresos previstos.</p>'}
    <p class="muted small">Añadir: <button class="btn-sm" type="button" data-plan-preset="pagas">💶 Pagas extra (junio y diciembre)</button> <button class="btn-sm" type="button" data-plan-preset="productividad">🎯 Productividad (mayo, estimada)</button> <button class="btn-sm" type="button" data-plan-preset="una">＋ Ingreso de una sola vez</button></p>`;
}

/* ---------- Diálogo ---------- */
function planSync() {
  const f = $('#planForm'), ing = f.tipo.value === 'ingreso', una = f.querySelector('input[name="repetir"]:checked').value === 'una';
  $$('#planForm .plan-ing').forEach(x => x.hidden = !ing);
  $$('#planForm .plan-pres').forEach(x => x.hidden = ing);
  if (ing) { $$('#planForm .plan-anual').forEach(x => x.hidden = una); $$('#planForm .plan-una').forEach(x => x.hidden = !una); $$('#planForm .plan-dia').forEach(x => x.hidden = f.conNomina.checked); }
}
function openPlanDialog(rec, preset = {}) {
  const f = $('#planForm'); f.reset(); $('#planError').style.display = 'none';
  const r = { ...preset, ...(rec || {}) }, tipo = r.tipo === 'ingreso' ? 'ingreso' : 'presupuesto';
  const nom = vistaNomina(), ud = nom ? 'periodo de nómina' : 'mes';
  f.id.value = rec?.id || ''; f.tipo.value = tipo;
  const cats = Store.getCategorias(tipo === 'ingreso' ? 'ingreso' : 'gasto'), cat = r.categoria || (tipo === 'ingreso' ? 'Paga Extra' : 'Combustible');
  const opts = cats.includes(cat) ? cats : [...cats, cat];
  f.categoria.innerHTML = opts.map(c => `<option ${c === cat ? 'selected' : ''}>${esc(c)}</option>`).join('');
  f.importe.value = r.importe ? fmtInput(r.importe) : '';
  $('#plImporteLbl').textContent = tipo === 'ingreso' ? 'Importe (€)' : `Importe por ${ud} (€)`;
  f.descripcion.value = r.descripcion || '';
  if (!$('#plMeses').children.length) $('#plMeses').innerHTML = Array.from({ length: 12 }, (_, i) => `<label class="check small"><input type="checkbox" name="meses" value="${i + 1}"> ${mesNombre(i + 1).slice(0, 3)}</label>`).join('');
  f.querySelector(`input[name="repetir"][value="${r.repetir === 'una' ? 'una' : 'anual'}"]`).checked = true;
  $$('#plMeses input').forEach(x => { x.checked = (r.meses || []).map(Number).includes(Number(x.value)); });
  f.mes.value = r.mes || monthKey(todayISO());
  f.conNomina.checked = r.conNomina !== false; f.dia.value = r.dia ? String(r.dia === FC.DIA_ULTIMO ? 31 : r.dia) : '';
  f.estimado.checked = !!r.estimado; f.incluir.checked = r.incluir !== false;
  $('#planDialogTitle').textContent = (rec ? 'Editar ' : 'Nuevo ') + (tipo === 'ingreso' ? 'ingreso previsto' : 'presupuesto');
  $('#planDelete').style.display = rec ? '' : 'none';
  planSync(); $('#planDialog').showModal();
}
$('#planForm').addEventListener('change', e => { if (['repetir', 'conNomina'].includes(e.target.name)) planSync(); });
$('#planForm').addEventListener('submit', async e => {
  e.preventDefault();
  const f = e.target, tipo = f.tipo.value, importe = parseImporte(f.importe.value), viejo = f.id.value ? Store.get('previstos', f.id.value) : null;
  const err = m => { $('#planError').textContent = m; $('#planError').style.display = ''; };
  if (!(importe > 0)) return err('Introduce un importe mayor que 0 (p. ej. 200).');
  let rec;
  if (tipo === 'presupuesto') {
    const otro = PlanCore.presupuestos(Store.list('previstos')).find(p => p.categoria === f.categoria.value && p.id !== f.id.value);
    if (otro) return err(`Ya hay un presupuesto para «${f.categoria.value}». Edítalo en vez de crear otro.`);
    rec = { ...(viejo || {}), id: f.id.value || null, tipo, categoria: f.categoria.value, importe, activo: true };
  } else {
    const repetir = f.querySelector('input[name="repetir"]:checked').value, meses = $$('#plMeses input:checked').map(x => Number(x.value));
    if (repetir === 'anual' && !meses.length) return err('Marca al menos un mes (p. ej. junio y diciembre).');
    if (repetir === 'una' && !/^\d{4}-\d{2}$/.test(f.mes.value)) return err('Indica el mes.');
    const dia = Number(f.dia.value);
    if (!f.conNomina.checked && !(dia >= 1 && dia <= 31)) return err('Indica el día del mes (1–31) o marca «Llega con la nómina».');
    rec = { ...(viejo || {}), id: f.id.value || null, tipo, descripcion: f.descripcion.value.trim(), categoria: f.categoria.value, importe, repetir,
      meses: repetir === 'anual' ? meses : undefined, mes: repetir === 'una' ? f.mes.value : undefined, conNomina: f.conNomina.checked, dia: f.conNomina.checked ? undefined : dia,
      estimado: f.estimado.checked, incluir: f.incluir.checked };
  }
  const tc = tipo === 'ingreso' ? 'ingreso' : 'gasto';
  if (rec.categoria && !Store.getCategorias(tc).includes(rec.categoria)) await Store.addCategoria(tc, rec.categoria);   // p. ej. «Productividad»: para poder apuntar el ingreso real con ella
  await Store.put('previstos', rec);
  $('#planDialog').close(); toast(viejo ? 'Guardado: la Previsión ya usa el nuevo importe' : (tipo === 'ingreso' ? 'Ingreso previsto añadido' : 'Presupuesto añadido'));
});
$('#planDelete').addEventListener('click', async () => {
  const id = $('#planForm').id.value, p = id && Store.get('previstos', id); if (!p) return;
  if (!confirm(`¿Eliminar «${p.descripcion || p.categoria}»? Los movimientos reales no se tocan.`)) return;
  await Store.remove('previstos', id); $('#planDialog').close(); toast('Eliminado');
});
$('#planAddPres').addEventListener('click', () => openPlanDialog(null, { tipo: 'presupuesto' }));
$('#planAddIng').addEventListener('click', () => openPlanDialog(null, { tipo: 'ingreso', categoria: 'Paga Extra', descripcion: 'Paga extra', meses: [6, 12] }));
const PLAN_PRESETS = {
  combustible: { tipo: 'presupuesto', categoria: 'Combustible', importe: 200 },
  pagas: { tipo: 'ingreso', descripcion: 'Paga extra', categoria: 'Paga Extra', repetir: 'anual', meses: [6, 12], conNomina: true },
  productividad: { tipo: 'ingreso', descripcion: 'Productividad', categoria: 'Productividad', repetir: 'anual', meses: [5], conNomina: true, estimado: true },
  una: { tipo: 'ingreso', descripcion: '', categoria: 'Extra', repetir: 'una', conNomina: false, dia: 1 }
};
$('#planBody').addEventListener('click', e => {
  const ed = e.target.closest('[data-plan-editar]'); if (ed) { const p = Store.get('previstos', ed.dataset.planEditar); if (p) openPlanDialog(p); return; }
  const pr = e.target.closest('[data-plan-preset]'); if (pr) openPlanDialog(null, PLAN_PRESETS[pr.dataset.planPreset]);
});
$('#planBody').addEventListener('change', async e => {
  const c = e.target.closest('[data-plan-incluir]'); if (!c) return;
  const p = Store.get('previstos', c.dataset.planIncluir); if (!p) return;
  await Store.put('previstos', { ...p, incluir: c.checked });
  toast(c.checked ? `«${p.descripcion || p.categoria}» cuenta en la Previsión` : `«${p.descripcion || p.categoria}» ya no cuenta en la Previsión`);
});
document.addEventListener('click', e => {
  if (!e.target.closest('[data-ir-plan]')) return;
  showView('prevision'); setTimeout(() => $('#planCard').scrollIntoView({ block: 'start' }), 0);
});

/* ---------- Movimiento: «Corresponde al ingreso previsto» ---------- */
function llenarSelectPrevisto(sel = '') {
  const ings = planIngresos(), s = $('#mPrevisto');
  const extra = sel && !ings.some(p => p.id === sel) ? `<option value="${esc(sel)}">(ingreso previsto borrado)</option>` : '';
  s.innerHTML = `<option value="">— Ninguno (automático por categoría)</option>` + ings.map(p => `<option value="${p.id}">${esc(p.descripcion || p.categoria)} · ${esc(PlanCore.textoCuando(p))}</option>`).join('') + extra;
  s.value = sel;
}

/* ---------- Resumen: presupuestos del periodo ---------- */
function renderPresupuestosResumen(P) {
  const card = $('#presupuestosCard'), pres = PlanCore.presupuestos(Store.list('previstos'));
  card.hidden = !pres.length || P.tipo === 'anio';
  if (card.hidden) return;
  const movs = Store.getMovimientos(), ud = P.tipo === 'nomina' ? 'periodo' : 'mes', abierto = P.desde <= todayISO() && todayISO() <= P.hasta;
  $('#presupuestosTitle').textContent = `Presupuestos del ${ud}`;
  $('#presupuestosBody').innerHTML = pres.map(p => {
    const e = PlanCore.estado(p, movs, P.desde, P.hasta), w = Math.min(100, e.pct);
    return `<div class="presu" data-presu="${esc(p.categoria)}">
      <div class="presu-top"><strong>${p.categoria === 'Combustible' ? '⛽ ' : ''}${esc(p.categoria)}</strong><span>${eur(e.gastado)} de ${eur(e.presupuesto)}</span></div>
      <div class="presu-bar ${e.excedido ? 'mal' : e.pct >= 85 ? 'warn' : ''}"><span style="width:${w}%"></span></div>
      <div class="small ${e.excedido ? 'neg' : 'pos'}" data-presu-estado>${e.excedido ? `⚠ Te has pasado ${eur(e.excedido)}` : `${abierto ? 'Te quedan' : 'Sobraron'} ${eur(e.queda)}`}${e.excedido ? '' : abierto ? ' este ' + ud : ' (quedan en el sobrante)'}</div>
    </div>`;
  }).join('') + `<p class="muted small" style="margin:6px 0 0">El resultado del ${ud} usa lo que has gastado de verdad; lo que no gastes del presupuesto queda en lo que te sobra.</p>`;
}
