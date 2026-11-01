/* =========================================================
   Previsión (v3.7): ¿cuánto me sobrará (o faltará) este mes y los próximos?
   El cálculo está en js/prevision-core.js; aquí solo se pinta.
   El gasto variable estimado y el número de meses se guardan en este navegador (no son datos tuyos de Drive).
   ========================================================= */
const PREV_KEY_VAR = 'finanzas.prevision.variable', PREV_KEY_MESES = 'finanzas.prevision.meses';
const prevLS = (k, v) => { try { if (v === undefined) return localStorage.getItem(k); if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch { /* sin almacenamiento */ } return null; };

function calcPrevision() {
  const hoy = todayISO(), datos = Calc.datosCuentas(), hayCuentas = datos.cuentas.length > 0;
  const saldo = CuentasCore.saldoDisponibleEn(datos, hoy);
  const v = prevLS(PREV_KEY_VAR);
  const esLiquido = m => { if (!hayCuentas) return true; const c = cuentaDeRegistro(m); return !c || CuentasCore.enSaldoMes(c); };
  const P = PrevisionCore.prevision({ hoy, saldoHoy: saldo === null ? 0 : saldo, movimientos: Store.getMovimientos(), recurrentes: Store.list('recurrentes'), deudas: Store.list('deudas'),
    meses: Number(prevLS(PREV_KEY_MESES)) || 7, gastoVariable: v === null || v === '' ? null : Number(v), esLiquido });
  return { ...P, saldoHoy: saldo === null ? 0 : saldo, saldoNulo: saldo === null, hayCuentas };
}

function renderPrevision() {
  const P = calcPrevision();
  $('#prevSaldoHoy').textContent = eur(P.saldoHoy);
  $('#prevSaldoHoyNota').textContent = P.saldoNulo ? 'Tus cuentas empiezan más adelante: se parte de 0 €.' : P.hayCuentas ? `a ${fmtFecha(P.hoy)} · como el «Saldo del mes»` : `a ${fmtFecha(P.hoy)} · sin cuentas creadas: lo acumulado de ingresos − gastos`;
  $('#prevMeses').value = String(P.meses.length);
  const vGuardado = prevLS(PREV_KEY_VAR), inp = $('#prevVariable');
  if (document.activeElement !== inp) inp.value = vGuardado === null || vGuardado === '' ? '' : fmtInput(Number(vGuardado));
  inp.placeholder = fmtInput(P.gastoVariableAuto.importe) + ' (media)';
  $('#prevVariableAuto').hidden = vGuardado === null || vGuardado === '';
  const a = P.gastoVariableAuto;
  $('#prevVariableNota').textContent = (vGuardado === null || vGuardado === ''
    ? (a.meses.length ? `Gasto variable: ${eur(a.importe)} al mes, la media de ${a.meses.map(m => monthLabel(m)).join(', ')} (gastos marcados como «variable»).` : 'Aún no hay meses completos con gastos variables: se cuenta 0 €. Escribe una estimación si quieres.')
    : `Gasto variable: ${eur(P.gastoVariable)} al mes (lo has escrito tú; la media sería ${eur(a.importe)}).`) + ' En el mes actual solo se resta lo que falta por gastar.';
  // Nómina estimada
  const nb = $('#prevNomina'), ne = P.nominaEstimada;
  nb.hidden = !ne;
  if (ne) nb.innerHTML = `<span>💼 No tienes la nómina como movimiento recurrente: se <strong>estima ${eur(ne.importe)} el día ${ne.dia}</strong> de cada mes (como la última, del ${fmtFecha(ne.desde)}).</span> <button class="btn-sm btn-primary" id="prevNominaRec" type="button">Guardar como nómina recurrente</button>`;

  $('#prevMesesList').innerHTML = P.meses.map((m, i) => {
    const ok = m.sobra >= 0, aviso = m.avisoAntesDeCobrar || m.avisoDentroMes;
    const fila = (lbl, v, signo, cls = '') => `<tr class="${cls}"><td>${lbl}</td><td class="num ${signo === '+' ? 'pos' : signo === '−' && v ? 'neg' : ''}">${signo && v ? signo : ''}${eur(v)}</td></tr>`;
    const items = m.items.length ? m.items.map(it => `<tr class="prev-item${it.vencida ? ' vencida' : ''}"><td class="nowrap">${fmtFecha(it.fecha).slice(0, 5)}</td><td>${esc(it.concepto)}${it.estimado ? ' <span class="badge b-var">Estimada</span>' : ''}${it.vencida ? ` <span class="badge b-warn">Vencida el ${fmtFecha(it.fechaCuota)} sin marcar</span>` : ''}<div class="muted small">${it.tipo === 'ingreso' ? 'Ingreso' : it.tipo === 'cuota' ? 'Cuota de deuda' : 'Gasto fijo'}</div></td><td class="num ${it.tipo === 'ingreso' ? 'pos' : 'neg'}">${it.tipo === 'ingreso' ? '+' : '−'}${eur(it.importe)}</td></tr>`).join('')
      : '<tr><td colspan="3" class="empty">Nada previsto este mes.</td></tr>';
    return `<div class="card prev-mes ${ok ? 'ok' : 'mal'}" data-prev-mes="${m.mes}">
      <div class="card-head"><h3 style="margin:0">${monthLabel(m.mes)}${m.actual ? ' <span class="muted small">(este mes, desde hoy)</span>' : ''}</h3>
        <span class="prev-estado ${ok ? 'ok' : 'mal'}" data-prev-estado>${ok ? `Te sobrarán ${eur(m.sobra)}` : `⚠ Te faltarán ${eur(m.falta)}`}</span></div>
      ${aviso ? `<p class="prev-aviso" data-prev-aviso>⚠ ${m.avisoAntesDeCobrar
        ? (a => `Antes de cobrar ${a.concepto.startsWith('Nómina') ? 'la nómina' : `«${esc(a.concepto)}»`} el ${fmtFecha(a.cobro)} tu saldo podría bajar a <strong>${eur(a.importe)}</strong>${a.fecha !== a.cobro ? ` (hacia el ${fmtFecha(a.fecha)})` : ''}.`)(m.avisoAntesDeCobrar)
        : `Dentro del mes tu saldo podría bajar a <strong>${eur(m.avisoDentroMes.importe)}</strong> (hacia el ${fmtFecha(m.avisoDentroMes.fecha)}), aunque a final de mes se recupere.`} <span class="muted small">Contando el gasto variable repartido por igual cada día.</span></p>` : ''}
      <table class="prev-resumen"><tbody>
        ${fila(m.actual ? 'Saldo de hoy' : `Saldo inicial (lo que sobra de ${monthLabel(P.meses[i - 1].mes)})`, m.saldoInicial, '', 'prev-ini')}
        ${fila('Ingresos previstos' + (m.nominaEstimada ? ' (nómina estimada)' : ''), m.ingresos, '+')}
        ${fila('Gastos fijos', m.fijos, '−')}
        ${fila('Cuotas de deudas', m.cuotas, '−')}
        ${fila(m.actual ? `Gasto variable que falta (${eur(m.variableYaGastado)} ya gastado)` : 'Gasto variable estimado', m.variable, '−')}
        <tr class="total"><td>${ok ? 'Previsto que sobra' : 'Previsto que falta'}</td><td class="num ${ok ? 'pos' : 'neg'}" data-prev-sobra>${eur(m.sobra)}</td></tr>
      </tbody></table>
      <details ${i === 0 ? 'open' : ''}><summary>Detalle: ${m.items.length} movimiento${m.items.length === 1 ? '' : 's'} previsto${m.items.length === 1 ? '' : 's'}</summary>
        <div class="table-wrap"><table class="prev-items"><tbody>${items}</tbody></table></div></details>
    </div>`;
  }).join('');

  // Gráfico
  if (UI.charts.prev) UI.charts.prev.destroy();
  if (typeof Chart === 'undefined') return;
  const okC = cssVar('--ok') || '#16a34a', badC = cssVar('--danger') || '#dc2626', grid = cssVar('--border'), muted = cssVar('--muted'), text = cssVar('--text');
  UI.charts.prev = new Chart($('#chartPrevision'), {
    data: { labels: P.meses.map(m => monthLabel(m.mes, true)), datasets: [
      { type: 'bar', label: 'Saldo a fin de mes', data: P.meses.map(m => m.sobra), backgroundColor: P.meses.map(m => (m.sobra >= 0 ? okC : badC) + 'cc'), borderRadius: 4, order: 2 },
      { type: 'line', label: 'Mínimo dentro del mes', data: P.meses.map(m => m.minimo), borderColor: cssVar('--warn') || '#d97706', backgroundColor: 'transparent', borderDash: [5, 4], pointRadius: 3, tension: .2, order: 1 }] },
    options: { maintainAspectRatio: false, animation: false, plugins: { legend: { position: 'bottom', labels: { color: text, boxWidth: 12 } }, tooltip: { callbacks: { label: x => `${x.dataset.label}: ${eur(x.parsed.y)}` } } },
      scales: { x: { grid: { color: grid }, ticks: { color: muted } }, y: { grid: { color: c => c.tick.value === 0 ? muted : grid }, ticks: { color: muted, callback: v => eur(v) } } } }
  });
}

$('#prevMeses').addEventListener('change', e => { prevLS(PREV_KEY_MESES, e.target.value); renderPrevision(); });
$('#prevVariable').addEventListener('change', e => {
  const t = e.target.value.trim();
  if (!t) { prevLS(PREV_KEY_VAR, null); renderPrevision(); return; }
  const v = parseImporte(t);
  if (!(v >= 0)) { toast('Escribe un importe (p. ej. 400 o 400,50)'); return; }
  prevLS(PREV_KEY_VAR, String(FC.round2(v))); renderPrevision();
});
$('#prevVariableAuto').addEventListener('click', () => { prevLS(PREV_KEY_VAR, null); $('#prevVariable').value = ''; renderPrevision(); });
$('#prevNomina').addEventListener('click', e => {
  if (!e.target.closest('#prevNominaRec')) return;
  const ne = PrevisionCore.nominaEstimada(Store.getMovimientos(), Store.list('recurrentes'), todayISO()); if (!ne) return;
  const ym0 = monthKey(todayISO()), cobradaEsteMes = Store.getMovimientos().some(m => m.tipo === 'ingreso' && m.tipoIngreso === 'nomina' && m.fecha.startsWith(ym0));
  // Desde el mes que viene si este mes ya la cobraste (así no se duplica); si no, desde este mes (se apuntará sola el día de cobro)
  openRecDialog({ tipo: 'ingreso', tipoIngreso: 'nomina', importe: ne.importe, dia: ne.dia, categoria: ne.categoria, descripcion: ne.descripcion || 'Nómina', cuentaId: ne.cuentaId, cuenta: ne.cuenta,
    desde: cobradaEsteMes || FC.fechaEnMes(ym0, ne.dia) < todayISO() ? FC.ymAdd(ym0, 1) : ym0, hasta: '', activo: true });
  $('#recDialogTitle').textContent = 'Nómina recurrente (revisa el importe y el día)';
});
