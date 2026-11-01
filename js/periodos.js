/* =========================================================
   v3.8 · Periodo de nómina: qué hacer con lo que sobra al entrar una nómina nueva.
   - Al guardar una nómina NUEVA que empieza un periodo, se pregunta: traspasar lo que sobró a una cuenta de ahorro
     (traspaso real con fecha de la nómina que cuenta como ahorro del periodo que se cierra), acumularlo al nuevo periodo
     o decidir más tarde (queda un aviso en el Resumen).
   - En la nómina se guarda `sobrante`: 'pendiente' | 'traspasado' | 'acumulado'. Sin ese campo (datos antiguos): no se pregunta.
   ========================================================= */
const Sobrante = {
  /** Datos del sobrante para la nómina `nom` (con la lista de movimientos `movs`). null si no empieza el último periodo. */
  info(nom, movs = Store.getMovimientos()) {
    if (!nom || nom.tipo !== 'ingreso' || nom.tipoIngreso !== 'nomina') return null;
    const hoy = todayISO(), PN = PeriodosCore.periodos(movs, { hoy });
    const i = PN.lista.findIndex(p => p.tipo === 'nomina' && p.nominas[0].id === nom.id);
    if (i < 0 || i !== PN.lista.length - 1) return null;   // no empieza un periodo (o ya hay otro después)
    const dia = FC.addDaysISO(nom.fecha, -1);
    const datos = { ...Calc.datosCuentas(), movimientos: movs };
    const sobra = CuentasCore.saldoDisponibleEn(datos, dia);
    return { nomina: nom, periodo: PN.lista[i], anterior: PN.lista[i - 1] || null, dia, sobra: sobra === null ? null : round2(sobra) };
  },
  /** ¿Hay que preguntar al guardar esta nómina nueva? (se llama antes de guardarla) */
  preguntar(nom) {
    const info = this.info(nom, [...Store.getMovimientos().filter(m => m.id !== nom.id), nom]);
    return !!(info && info.sobra > 0.004);
  },
  /** Nómina pendiente de decidir (para el aviso del Resumen). */
  pendiente() {
    const PN = Calc.periodosNomina(), p = PN.lista[PN.lista.length - 1];
    if (!p || p.tipo !== 'nomina') return null;
    const nom = p.nominas.find(n => n.sobrante === 'pendiente');
    if (!nom || nom.fecha > todayISO()) return null;
    const info = this.info(p.nominas[0]);
    return info && info.sobra > 0.004 ? { ...info, nomina: nom } : null;
  },
  cuentasAhorro() { return Store.list('cuentas').filter(c => c.activa !== false && !CuentasCore.enSaldoMes(c)); },
  cuentasDiaADia() { return Store.list('cuentas').filter(c => c.activa !== false && CuentasCore.enSaldoMes(c)); },
  abrir(info) {
    const f = $('#sobranteForm'), nom = info.nomina, ahorro = this.cuentasAhorro(), liq = this.cuentasDiaADia();
    f.movId.value = nom.id;
    const ant = info.anterior ? `${info.anterior.nombre.toLowerCase()} (${info.anterior.rango})` : 'antes de esta nómina';
    $('#sobranteTitulo').textContent = `Ha entrado la ${info.periodo.nombre.toLowerCase()}`;
    $('#sobranteTexto').innerHTML = `Del periodo anterior, ${esc(ant)}, te sobran <strong id="sobranteImporte">${eur(info.sobra)}</strong> en tus cuentas del día a día. ¿Qué quieres hacer con ellos?`;
    $('#sobDestino').innerHTML = ahorro.map(c => `<option value="${c.id}">${esc(c.nombre)}</option>`).join('');
    $('#sobOrigen').innerHTML = liq.map(c => `<option value="${c.id}">${esc(c.nombre)}</option>`).join('');
    if (nom.cuentaId && liq.some(c => c.id === nom.cuentaId)) $('#sobOrigen').value = nom.cuentaId;
    $('#sobImporte').value = fmtInput(info.sobra);
    const puede = ahorro.length > 0 && liq.length > 0;
    $('#sobTraspasar').disabled = !puede;
    (puede ? $('#sobTraspasar') : $('#sobAcumular')).checked = true;
    this.info_ = info; this.pintar();
    $('#sobranteError').style.display = 'none';
    $('#sobranteDialog').showModal();
  },
  pintar() {
    const acc = ($('#sobranteForm').querySelector('input[name=accion]:checked') || {}).value, info = this.info_;
    $('#sobranteTraspaso').hidden = acc !== 'traspasar';
    const ant = info.anterior ? info.anterior.nombre.toLowerCase() : 'el periodo anterior';
    $('#sobranteAyuda').innerHTML = !this.cuentasAhorro().length
      ? 'No tienes cuentas de ahorro o inversión. Créala en <strong>Cuentas</strong> (tipo Ahorro o Inversión, como MyInvestor) para poder traspasar lo que sobra.'
      : acc === 'traspasar' ? `Se apunta un traspaso real el ${fmtFecha(info.nomina.fecha)} que cuenta como <strong>ahorro de ${esc(ant)}</strong>. Puedes cambiar el importe.`
      : acc === 'acumular' ? 'Lo que sobró se queda en tus cuentas del día a día y pasa al nuevo periodo (no cuenta como ahorro).'
      : 'No se hace nada ahora: verás un aviso en el Resumen para decidirlo cuando quieras.';
    $('#sobranteOk').textContent = acc === 'traspasar' ? 'Traspasar' : acc === 'acumular' ? 'Acumular' : 'Decidir más tarde';
  },
  async guardar() {
    const f = $('#sobranteForm'), acc = (f.querySelector('input[name=accion]:checked') || {}).value, info = this.info_;
    const nom = Store.get('movimientos', f.movId.value) || info.nomina;
    const err = t => { const e = $('#sobranteError'); e.textContent = t; e.style.display = ''; };
    if (acc === 'luego') { $('#sobranteDialog').close(); toast('De acuerdo: te lo recordaré en el Resumen'); return; }
    const cambios = [];
    if (acc === 'traspasar') {
      const importe = parseImporte($('#sobImporte').value), origenId = $('#sobOrigen').value, destinoId = $('#sobDestino').value;
      if (!(importe > 0)) return err('Pon un importe mayor que 0.');
      if (!origenId || !destinoId) return err('Elige la cuenta de origen y la de ahorro.');
      cambios.push({ col: 'traspasos', rec: { id: uid(), fecha: nom.fecha, origenId, destinoId, importe: round2(importe), comision: 0, comisionMovId: null,
        nota: `Sobrante de ${info.anterior ? info.anterior.nombre.toLowerCase() : 'antes de la nómina'}`, cierrePeriodo: true } });
    }
    cambios.push({ col: 'movimientos', rec: { ...nom, sobrante: acc === 'traspasar' ? 'traspasado' : 'acumulado' } });
    await Store.apply(cambios);
    $('#sobranteDialog').close();
    const c = acc === 'traspasar' ? Store.get('cuentas', $('#sobDestino').value) : null;
    toast(acc === 'traspasar' ? `Traspasado a ${c ? c.nombre : 'ahorro'}: cuenta como ahorro del periodo anterior` : 'Lo que sobró pasa al nuevo periodo');
  }
};

/** Aviso del Resumen: nómina con el sobrante sin decidir. */
function renderSobranteAviso() {
  const el = $('#sobranteAviso'); if (!el) return;
  const info = Sobrante.pendiente();
  el.hidden = !info;
  if (!info) return;
  el.innerHTML = `<span>💶 Al entrar la ${esc(info.periodo.nombre.toLowerCase())} (${fmtFecha(info.nomina.fecha)}) te sobraban <strong>${eur(info.sobra)}</strong> del periodo anterior. ¿Los traspasas a ahorro o los acumulas?</span> <button class="btn-sm btn-primary" id="sobranteDecidir">Decidir</button>`;
  $('#sobranteDecidir').addEventListener('click', () => Sobrante.abrir(info));
}

$('#sobranteForm').addEventListener('change', e => { if (e.target.name === 'accion') Sobrante.pintar(); });
$('#sobranteForm').addEventListener('submit', e => { e.preventDefault(); Sobrante.guardar(); });
$('#vistaLink').addEventListener('click', e => { const a = e.target.closest('[data-vista]'); if (a) { e.preventDefault(); setVista(a.dataset.vista); } });
$('#ajVista').addEventListener('change', e => setVista(e.target.value));
