/* =========================================================
   Vehículos y combustible (v3.3)
   - Colección «vehiculos»: matrícula (única), nombre, combustible,
     capacidad del depósito, cuentakilómetros inicial, en uso.
   - Colección «repostajes»: cada uno enlazado a un gasto normal
     (movimientoId) que cuenta en los totales del mes. Se crean y editan
     desde el diálogo de movimiento (opción ⛽) y se ven en la pestaña
     «Vehículos». Cálculos en js/fuel-core.js (FuelCore).
   ========================================================= */
const fmtL = new Intl.NumberFormat(LOCALE, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtP3 = new Intl.NumberFormat(LOCALE, { minimumFractionDigits: 3, maximumFractionDigits: 3 });
const fmtInt = new Intl.NumberFormat(LOCALE, { maximumFractionDigits: 0, useGrouping: 'always' });
const fmtLitros = n => n === null || n === undefined ? '—' : fmtL.format(n) + ' L';
const fmtPrecioL = n => n === null || n === undefined ? '—' : fmtP3.format(n) + ' €/L';
const fmtKm = n => n === null || n === undefined ? '—' : fmtInt.format(n) + ' km';
const fmtL100 = n => n === null || n === undefined ? '—' : fmtL.format(n) + ' L/100 km';
const fmtEurKm = n => n === null || n === undefined ? '—' : fmtP3.format(n) + ' €/km';
const parseDec = s => { const t = String(s ?? '').trim().replace(/\s|€|L/gi, '').replace(',', '.'); return t ? Number(t) : NaN; }; // 1,459 o 1.459 → 1.459
const nombreVeh = v => v ? (v.nombre ? `${v.matricula} · ${v.nombre}` : v.matricula) : '(vehículo borrado)';

/** Repostaje enlazado a un movimiento (o null). */
function repostajeDeMov(m) {
  if (!m || m.tipo !== 'gasto') return null;
  return Store.list('repostajes').find(r => r.movimientoId === m.id) || (m.repostajeId ? Store.get('repostajes', m.repostajeId) : null);
}
const vehiculosOrdenados = () => Store.list('vehiculos').slice().sort((a, b) => (b.activo - a.activo) || a.matricula.localeCompare(b.matricula));
function categoriaCombustible() { return Store.getCategorias('gasto').find(c => FuelCore.esCategoriaCombustible(c)) || FuelCore.CATEGORIA; }

/* ---------------- Diálogo de vehículo ---------------- */
const VehDlg = { v: null, alGuardar: null };
function openVehDialog(v, alGuardar = null) {
  const f = $('#vehForm'); f.reset(); $('#vehError').style.display = 'none';
  VehDlg.v = v || null; VehDlg.alGuardar = alGuardar;
  f.combustible.innerHTML = Object.entries(FuelCore.COMBUSTIBLES).map(([k, t]) => `<option value="${k}">${t}</option>`).join('');
  f.id.value = v?.id || ''; f.matricula.value = v?.matricula || ''; f.nombre.value = v?.nombre || '';
  f.combustible.value = v?.combustible || 'gasoil'; f.capacidad.value = fmtInputN(v?.capacidad ?? '');
  f.kmIniciales.value = v?.kmIniciales ?? ''; f.activo.checked = v ? v.activo : true; f.notas.value = v?.notas || '';
  $('#vehDialogTitle').textContent = v ? 'Editar vehículo' : 'Nuevo vehículo';
  $('#vehDelete').style.display = v ? '' : 'none';
  $('#vehDialog').showModal(); setTimeout(() => f.matricula.focus(), 30);
}
$('#vehForm').addEventListener('submit', async e => {
  e.preventDefault();
  const f = e.target, err = m => { const p = $('#vehError'); p.textContent = m; p.style.display = ''; };
  const matricula = FuelCore.normalizarMatricula(f.matricula.value);
  if (!matricula) return err('Escribe la matrícula.');
  if (Store.list('vehiculos').some(v => v.matricula === matricula && v.id !== f.id.value)) return err(`Ya tienes un vehículo con la matrícula ${matricula}.`);
  const capacidad = parseDec(f.capacidad.value);
  if (!(capacidad > 0 && capacidad <= 2000)) return err('Indica cuántos litros caben en el depósito (p. ej. 50).');
  const kmTxt = f.kmIniciales.value.trim(), km = kmTxt ? parseImporte(kmTxt) : null;
  if (kmTxt && !(km >= 0)) return err('El cuentakilómetros debe ser un número (p. ej. 98500).');
  const v = { ...(VehDlg.v || {}), id: f.id.value || uid(), matricula, nombre: f.nombre.value.trim(), combustible: f.combustible.value, capacidad,
    kmIniciales: km, activo: f.activo.checked, notas: f.notas.value.trim(), creado: VehDlg.v?.creado || Date.now() };
  await Store.put('vehiculos', v);
  $('#vehDialog').close(); toast(VehDlg.v ? 'Vehículo actualizado' : `Vehículo ${matricula} añadido`);
  if (VehDlg.alGuardar) VehDlg.alGuardar(v);
});
$('#vehDelete').addEventListener('click', async () => {
  const v = VehDlg.v; if (!v) return;
  const n = Store.list('repostajes').filter(r => r.vehiculoId === v.id).length;
  if (!confirm(`¿Eliminar el vehículo ${v.matricula}?${n ? `\n\nSe borrarán los datos de sus ${n} repostajes (litros, km y consumos), pero los gastos se conservan en Movimientos.` : ''}\n\nSi lo has vendido, mejor desmarca «En uso» y conservarás sus estadísticas.`)) return;
  await Store.remove('vehiculos', v.id);
  if (Veh.filtro === v.id) Veh.filtro = '';
  $('#vehDialog').close(); toast('Vehículo eliminado');
});

/* ---------------- Opción ⛽ del diálogo de movimiento ---------------- */
const Comb = { orden: ['precio', 'litros', 'importe'] };
function llenarSelectVehiculos(sel) {
  const f = $('#movForm'), lista = vehiculosOrdenados().filter(v => v.activo || v.id === sel);
  f.cVehiculo.innerHTML = lista.length ? lista.map(v => `<option value="${v.id}" ${v.id === sel ? 'selected' : ''}>${esc(nombreVeh(v))}</option>`).join('') : '<option value="">Añade primero un vehículo →</option>';
  if (sel && lista.some(v => v.id === sel)) f.cVehiculo.value = sel;
}
function ultimoVehiculoUsado() {
  const r = FuelCore.ordenarRepostajes(Store.list('repostajes')).pop();
  const v = r && Store.get('vehiculos', r.vehiculoId);
  return v && v.activo ? v.id : (vehiculosOrdenados().find(x => x.activo) || {}).id;
}
/** Se llama desde openMovDialog. preset: { repostaje: true, vehiculoId } o { rep: repostaje sin gasto }. */
function combAbrir(mov, preset = {}) {
  const f = $('#movForm');
  const r = mov ? repostajeDeMov(mov) : (preset.rep || null);
  MovDlg.rep = r; Comb.orden = ['precio', 'litros', 'importe'];
  f.esComb.checked = !!r || !!preset.repostaje;
  llenarSelectVehiculos(r?.vehiculoId || preset.vehiculoId || ultimoVehiculoUsado());
  f.cPrecio.value = r ? fmtInputN(r.precioLitro) : ''; f.cLitros.value = r ? fmtInputN(r.litros) : '';
  f.cKm.value = r?.kmTanqueAnterior ? fmtInputN(r.kmTanqueAnterior) : ''; f.cOdo.value = r?.odometro || '';
  f.cGasolinera.value = r?.gasolinera || ''; f.cLleno.checked = r ? r.lleno : true;
  $('#gasolinerasList').innerHTML = [...new Set(Store.list('repostajes').map(x => x.gasolinera).filter(Boolean))].map(g => `<option value="${esc(g)}">`).join('');
  if (!mov && (preset.repostaje || preset.rep)) {
    fillCategoriaSelect('gasto', categoriaCombustible());
    f.querySelector('input[name="naturaleza"][value="variable"]').checked = true;
    if (preset.rep) { f.importe.value = fmtInput(preset.rep.importe); f.fecha.value = preset.rep.fecha; }
  }
}
function combValores() {
  const f = $('#movForm');
  return { precio: parseDec(f.cPrecio.value), litros: parseDec(f.cLitros.value), importe: parseImporte(f.importe.value) };
}
/** Precio, litros e importe: al cambiar uno, se recalcula el que lleva más tiempo sin tocar. */
function combTrio(campo) {
  const f = $('#movForm'); if (!f.esComb.checked || movTipo() !== 'gasto') return;
  Comb.orden = [campo, ...Comb.orden.filter(x => x !== campo)];
  const v = combValores(), [a, b, obj] = Comb.orden;
  if (v[a] > 0 && v[b] > 0) {
    const r = FuelCore.cuadrar({ precioLitro: v.precio, litros: v.litros, importe: v.importe }, { precio: 'precioLitro', litros: 'litros', importe: 'importe' }[obj]);
    if (obj === 'importe') f.importe.value = fmtInput(r.importe);
    if (obj === 'litros') f.cLitros.value = fmtInputN(r.litros);
    if (obj === 'precio') f.cPrecio.value = fmtInputN(r.precioLitro);
  }
  combSync();
}
/** Repostaje que resultaría del formulario (sin validar) para previsualizar el consumo. */
function combBorrador() {
  const f = $('#movForm'), v = combValores();
  const km = parseImporte(f.cKm.value), odo = parseImporte(f.cOdo.value);
  return { id: MovDlg.rep?.id || '__nuevo', vehiculoId: f.cVehiculo.value, fecha: f.fecha.value, litros: v.litros, precioLitro: v.precio, importe: v.importe,
    kmTanqueAnterior: km > 0 ? km : null, odometro: odo > 0 ? odo : null, lleno: f.cLleno.checked, creado: MovDlg.rep?.creado || Date.now() };
}
function combSync() {
  const f = $('#movForm'), visible = movTipo() === 'gasto' && f.esComb.checked;
  $('#optCombBody').hidden = !visible;
  if (!visible) return;
  const veh = Store.get('vehiculos', f.cVehiculo.value), info = [];
  if (!veh) { $('#cInfo').innerHTML = '<span class="c-aviso">Añade un vehículo con «＋ Vehículo» (te pedirá la matrícula y los litros del depósito).</span>'; return; }
  const b = combBorrador();
  if (b.precioLitro > 0 && b.litros > 0) {
    const c = FuelCore.cuadra(b.precioLitro, b.litros, b.importe);
    info.push(c.ok ? `${fmtLitros(b.litros)} × ${fmtPrecioL(b.precioLitro)} = <strong>${eur(c.esperado)}</strong>` : `<span class="c-aviso">⚠️ ${fmtLitros(b.litros)} × ${fmtPrecioL(b.precioLitro)} = ${eur(c.esperado)}, pero el importe es ${eur(b.importe)}.</span>`);
  }
  if (veh.capacidad && b.litros > veh.capacidad * 1.05) info.push(`<span class="c-aviso">⚠️ Son más litros de los que caben en el depósito (${fmtLitros(veh.capacidad)}).</span>`);
  const otros = Store.list('repostajes').filter(r => r.vehiculoId === veh.id && r.id !== b.id);
  const filas = FuelCore.filas(b.litros > 0 && FC.isISO(b.fecha) ? [...otros, b] : otros);
  const i = filas.findIndex(r => r.id === b.id), prev = i > 0 ? filas[i - 1] : (i < 0 ? filas[filas.length - 1] : null);
  if (prev) info.push(`Repostaje anterior: ${fmtFecha(prev.fecha)} · ${fmtLitros(prev.litros)}${prev.lleno ? ' (lleno)' : ' (parcial)'}${prev.odometro ? ' · ' + fmtKm(prev.odometro) : ''}`);
  else info.push('Es el primer repostaje de este vehículo: los km con el depósito anterior son opcionales.');
  if (prev && prev.odometro && b.odometro > prev.odometro) f.cKm.placeholder = `≈ ${fmtInt.format(b.odometro - prev.odometro)} (por el cuentakilómetros)`; else f.cKm.placeholder = 'p. ej. 650';
  if (i >= 0) {
    const t = FuelCore.tramos(filas).find(x => x.hastaId === b.id);
    if (t) info.push(`Consumo de este tramo: <strong>${fmtL100(t.l100)}</strong> · ${fmtL.format(t.kmL)} km/L · <strong>${fmtEurKm(t.eurKm)}</strong>${t.metodo === 'aprox' ? ' (aprox.)' : ''}`);
    else if (!b.lleno) info.push('Repostaje parcial: el consumo se calculará cuando vuelvas a llenar el depósito.');
  }
  $('#cInfo').innerHTML = info.join('<br>');
}
/** Valida y construye el repostaje del gasto «mov». Devuelve { rep, descripcion, confirmar } o { error }. */
function combLeer(mov, importe) {
  const f = $('#movForm'), veh = Store.get('vehiculos', f.cVehiculo.value);
  if (!veh) return { error: 'Elige el vehículo (o créalo con «＋ Vehículo»).' };
  const v = combValores();
  const c = FuelCore.cuadrar({ precioLitro: v.precio, litros: v.litros, importe });
  if (!(c.litros > 0)) return { error: 'Indica los litros que has puesto (o el precio por litro para calcularlos).' };
  if (!(c.precioLitro > 0)) return { error: 'Indica el precio por litro (p. ej. 1,459).' };
  if (c.precioLitro > 20) return { error: 'El precio por litro parece demasiado alto. Escríbelo en euros, p. ej. 1,459.' };
  const k = FuelCore.cuadra(c.precioLitro, c.litros, importe);
  if (!k.ok) return { error: `No cuadra: ${fmtLitros(c.litros)} × ${fmtPrecioL(c.precioLitro)} = ${eur(k.esperado)}, pero el importe es ${eur(importe)}. Corrige uno de los tres.` };
  const kmTxt = f.cKm.value.trim(), odoTxt = f.cOdo.value.trim();
  const km = kmTxt ? parseImporte(kmTxt) : null, odo = odoTxt ? parseImporte(odoTxt) : null;
  if (kmTxt && !(km > 0)) return { error: 'Los km con el depósito anterior deben ser un número mayor que 0.' };
  if (odoTxt && !(odo > 0)) return { error: 'El cuentakilómetros debe ser un número (p. ej. 125400).' };
  const rep = { ...(MovDlg.rep || {}), id: MovDlg.rep?.id || uid(), vehiculoId: veh.id, movimientoId: mov.id, fecha: mov.fecha,
    precioLitro: c.precioLitro, litros: c.litros, importe, kmTanqueAnterior: km, odometro: odo, lleno: f.cLleno.checked,
    gasolinera: f.cGasolinera.value.trim(), creado: MovDlg.rep?.creado || Date.now() };
  const avisos = [];
  if (veh.capacidad && c.litros > veh.capacidad * 1.05) avisos.push(`Has puesto ${fmtLitros(c.litros)} y en el depósito de ${veh.matricula} caben ${fmtLitros(veh.capacidad)}.`);
  if (km && km > 3000) avisos.push(`${fmtKm(km)} con un solo depósito es mucho.`);
  return { rep, descripcion: `Combustible ${veh.matricula}${rep.gasolinera ? ' · ' + rep.gasolinera : ''}`, confirmar: avisos.length ? avisos.join('\n') + '\n\n¿Guardar de todos modos?' : null };
}
{
  const f = $('#movForm');
  f.esComb.addEventListener('change', () => {
    if (f.esComb.checked && !FuelCore.esCategoriaCombustible(f.categoria.value)) { fillCategoriaSelect('gasto', categoriaCombustible()); f.querySelector('input[name="naturaleza"][value="variable"]').checked = true; }
    syncMovOpciones();
  });
  f.cPrecio.addEventListener('input', () => combTrio('precio'));
  f.cLitros.addEventListener('input', () => combTrio('litros'));
  f.importe.addEventListener('input', () => combTrio('importe'));
  ['cKm', 'cOdo', 'cVehiculo', 'cLleno', 'fecha'].forEach(n => f[n].addEventListener(n === 'cVehiculo' || n === 'cLleno' || n === 'fecha' ? 'change' : 'input', combSync));
  $('#cNuevoVeh').addEventListener('click', () => openVehDialog(null, v => { llenarSelectVehiculos(v.id); combSync(); }));
}

/* ---------------- Pestaña Vehículos ---------------- */
const Veh = { filtro: '', periodo: '12m', todos: false };
function periodoVeh() {
  const hoy = todayISO();
  if (Veh.periodo === '12m') return { desde: FC.addDaysISO(FC.addMonthsISO(hoy, -12), 1), hasta: hoy, texto: 'últimos 12 meses' };
  if (/^\d{4}$/.test(Veh.periodo)) return { desde: Veh.periodo + '-01-01', hasta: Veh.periodo + '-12-31', texto: Veh.periodo };
  return { desde: null, hasta: null, texto: 'todo el historial' };
}
function renderVehiculos() {
  const vehs = vehiculosOrdenados(), reps = Store.list('repostajes');
  if (Veh.filtro && !vehs.some(v => v.id === Veh.filtro)) Veh.filtro = '';
  $('#vehFiltro').innerHTML = `<option value="">Todos los vehículos</option>` + vehs.map(v => `<option value="${v.id}">${esc(nombreVeh(v))}${v.activo ? '' : ' (no en uso)'}</option>`).join('');
  $('#vehFiltro').value = Veh.filtro;
  const anios = [...new Set(reps.map(r => r.fecha.slice(0, 4)))].sort().reverse();
  if (/^\d{4}$/.test(Veh.periodo) && !anios.includes(Veh.periodo)) Veh.periodo = '12m';
  $('#vehPeriodo').innerHTML = `<option value="12m">Últimos 12 meses</option>${anios.map(a => `<option value="${a}">${a}</option>`).join('')}<option value="todo">Todo</option>`;
  $('#vehPeriodo').value = Veh.periodo;
  const sel = Veh.filtro ? vehs.filter(v => v.id === Veh.filtro) : vehs, per = periodoVeh();
  const res = FuelCore.resumen(sel, reps, per), t = res.total;

  // KPIs
  $('#vkGasto').textContent = eur(t.gasto); $('#vkGastoSub').textContent = `${t.repostajes} repostaje${t.repostajes === 1 ? '' : 's'} · ${per.texto}`;
  $('#vkEurKm').textContent = t.eurKm === null ? '—' : fmtEurKm(t.eurKm);
  $('#vkEurKmSub').textContent = t.eurKm === null ? 'Anota los km al repostar' : `Solo combustible · ${fmtInt.format(t.kmConsumo)} km medidos`;
  $('#vkL100').textContent = fmtL100(t.l100); $('#vkL100Sub').textContent = t.kmL === null ? 'Necesita km y depósitos llenos' : `${fmtL.format(t.kmL)} km/L${t.aproximado ? ' · aprox.' : ''}`;
  $('#vkPrecio').textContent = fmtPrecioL(t.precioMedio); $('#vkPrecioSub').textContent = t.precioMin === null ? 'Ponderado por litros' : `Mín. ${fmtP3.format(t.precioMin)} · máx. ${fmtP3.format(t.precioMax)}`;
  $('#vkLitros').textContent = fmtLitros(t.litros); $('#vkLitrosSub').textContent = per.texto;
  $('#vkKm').textContent = fmtKm(t.km);
  const uno = sel.length === 1 ? res.vehiculos[0] : null;
  if (uno) { $('#vkAuto').textContent = uno.m.autonomia ? fmtKm(uno.m.autonomia) : '—'; $('#vkAutoSub').textContent = uno.m.capacidad ? `Depósito de ${fmtLitros(uno.m.capacidad)}${uno.m.costeLleno ? ' · llenarlo ≈ ' + eur(uno.m.costeLleno) : ''}` : ''; }
  else { const n = res.vehiculos.filter(x => x.vehiculo.activo).length; $('#vkAuto').textContent = '—'; $('#vkAutoSub').textContent = vehs.length ? `Elige un vehículo · ${n} en uso` : 'Añade un vehículo'; }
  const u = t.ultimo;
  $('#vkUltimo').textContent = u ? fmtFecha(u.fecha) : '—';
  $('#vkUltimoSub').textContent = u ? `${sel.length > 1 ? (Store.get('vehiculos', u.vehiculoId) || {}).matricula + ' · ' : ''}${fmtLitros(u.litros)} · ${fmtPrecioL(u.precioLitro)}` : '';

  // Tarjetas de vehículos (siempre todos; con todo el historial)
  $('#vehLista').innerHTML = vehs.length ? `<div class="veh-list">${vehs.map(v => {
    const m = FuelCore.metricasVehiculo(v, reps);
    return `<div class="veh${v.activo ? '' : ' inactivo'}${v.id === Veh.filtro ? ' sel' : ''}">
      <div class="veh-top"><div><span class="mat">${esc(v.matricula)}</span> ${v.nombre ? `<strong>${esc(v.nombre)}</strong>` : ''}
        <div class="muted small">${FuelCore.COMBUSTIBLES[v.combustible]} · depósito ${v.capacidad ? fmtLitros(v.capacidad) : '¿?'}${v.activo ? '' : ' · no en uso'}</div></div></div>
      <div class="veh-stats">
        <div><span>€/km</span><strong>${m.eurKm === null ? '—' : fmtP3.format(m.eurKm)}</strong></div>
        <div><span>L/100 km</span><strong>${m.l100 === null ? '—' : fmtL.format(m.l100)}${m.aproximado ? '*' : ''}</strong></div>
        <div><span>€/L medio</span><strong>${m.precioMedio === null ? '—' : fmtP3.format(m.precioMedio)}</strong></div>
        <div><span>Gasto total</span><strong>${eur(m.gasto)}</strong></div>
        <div><span>Autonomía</span><strong>${m.autonomia ? fmtKm(m.autonomia) : '—'}</strong></div>
        <div><span>Cuentakm</span><strong>${m.odometroEstimado === null ? '—' : fmtInt.format(m.odometroEstimado)}</strong></div>
      </div>
      <div class="veh-acts"><button class="btn-sm btn-primary" data-veh-rep="${v.id}">⛽ Repostar</button><button class="btn-sm" data-veh-ver="${v.id}">📊 Ver</button><button class="btn-sm" data-veh-edit="${v.id}">✏️ Editar</button></div>
    </div>`; }).join('')}</div>${vehs.some(v => FuelCore.metricasVehiculo(v, reps).aproximado) ? '<p class="muted small" style="margin-bottom:0">* Consumo aproximado: no hay dos depósitos llenos seguidos.</p>' : ''}`
    : '<p class="empty">Aún no tienes vehículos. Pulsa «＋ Vehículo»: te pedirá la matrícula y cuántos litros caben en el depósito.</p>';

  // Tablas por mes y por año
  const fila = (k, x) => `<tr><td class="nowrap">${k}</td><td class="num hide-sm">${x.repostajes}</td><td class="num hide-sm">${fmtL.format(x.litros)}</td><td class="num">${eur(x.gasto)}</td><td class="num">${x.precioMedio === null ? '—' : fmtP3.format(x.precioMedio)}</td><td class="num hide-sm">${x.km ? fmtInt.format(x.km) : '—'}</td><td class="num">${x.l100 === null ? '—' : fmtL.format(x.l100)}</td><td class="num">${x.eurKm === null ? '—' : fmtP3.format(x.eurKm)}</td></tr>`;
  const meses = FuelCore.porMes(sel, reps, per).reverse();
  $('#vehMesesTitulo').textContent = 'Por mes · ' + per.texto;
  $('#vehMesesBody').innerHTML = meses.length ? meses.map(x => fila(monthLabel(x.mes, true), x)).join('') : '<tr><td colspan="8" class="empty">Sin repostajes en este periodo.</td></tr>';
  const anios2 = FuelCore.porAnio(sel, reps).reverse();
  $('#vehAniosBody').innerHTML = anios2.length ? anios2.map(x => fila(x.anio, x)).join('') : '<tr><td colspan="8" class="empty">Sin repostajes.</td></tr>';

  // Lista de repostajes (del periodo, más recientes primero)
  const tramoDe = {}; for (const x of res.vehiculos) for (const tr of x.m.tramosLista) tramoDe[tr.hastaId] = tr;
  const lista = res.vehiculos.flatMap(x => x.m.filas).filter(r => (!per.desde || r.fecha >= per.desde) && (!per.hasta || r.fecha <= per.hasta));
  const ord = FuelCore.ordenarRepostajes(lista).reverse();
  const MAX = 25, mostrar = Veh.todos ? ord : ord.slice(0, MAX);
  $('#repBody').innerHTML = ord.length ? mostrar.map(r => {
    const v = Store.get('vehiculos', r.vehiculoId), tr = tramoDe[r.id], sinGasto = !r.movimientoId || !Store.get('movimientos', r.movimientoId);
    return `<tr><td><strong class="nowrap">${fmtFecha(r.fecha)}</strong><div class="muted small"><span class="mono">${esc(v ? v.matricula : '—')}</span>${r.gasolinera ? ' · ' + esc(r.gasolinera) : ''}</div>
      ${r.lleno && !sinGasto ? '' : `<div class="badges">${r.lleno ? '' : '<span class="badge">Parcial</span>'}${sinGasto ? '<span class="badge b-fin" title="El gasto se borró en un dispositivo con una versión antigua. Edítalo para crearlo de nuevo.">Sin gasto</span>' : ''}</div>`}</td>
      <td class="num">${fmtL.format(r.litros)}</td><td class="num hide-sm">${fmtP3.format(r.precioLitro)}</td><td class="num neg">${eur(r.importe)}</td>
      <td class="num hide-sm">${r.km ? fmtInt.format(r.km) + (r.kmFuente === 'odometro' ? '*' : '') : '—'}</td>
      <td class="num">${tr ? fmtL.format(tr.l100) + (tr.metodo === 'aprox' ? '*' : '') : '—'}</td>
      <td class="actions"><button class="btn-sm" data-rep-edit="${r.id}" title="Editar">✏️</button> <button class="btn-sm btn-danger" data-rep-del="${r.id}" title="Eliminar">🗑️</button></td></tr>`;
  }).join('') : `<tr><td colspan="7" class="empty">${vehs.length ? 'No hay repostajes en este periodo. Pulsa «⛽ Repostaje».' : 'Añade primero un vehículo.'}</td></tr>`;
  $('#repMas').innerHTML = ord.length > MAX ? `<button class="btn-sm" id="repMasBtn" style="margin-top:8px">${Veh.todos ? 'Ver solo los últimos ' + MAX : `Ver los ${ord.length - MAX} anteriores`}</button>` : '';

  renderGraficosVeh(res, per);
}
function renderGraficosVeh(res, per) {
  const text = cssVar('--text'), grid = cssVar('--border'), muted = cssVar('--muted');
  const colores = [cssVar('--primary'), cssVar('--warn'), cssVar('--danger'), cssVar('--ok'), '#6366f1', '#ec4899'];
  const enP = f => (!per.desde || f >= per.desde) && (!per.hasta || f <= per.hasta);
  const dibujar = (clave, canvas, vacio, puntos, fmt) => {
    const fechas = [...new Set(puntos.flatMap(p => p.datos.map(d => d.fecha)))].sort();
    const hay = fechas.length > 0;
    $('#' + vacio).style.display = hay ? 'none' : 'flex';
    if (UI.charts[clave]) { UI.charts[clave].destroy(); delete UI.charts[clave]; }
    if (!hay) return;
    const datasets = puntos.filter(p => p.datos.length).map((p, i) => {
      const m = new Map(p.datos.map(d => [d.fecha, d.y]));
      return { label: p.label, data: fechas.map(f => m.has(f) ? m.get(f) : null), borderColor: colores[i % colores.length], backgroundColor: colores[i % colores.length], tension: .25, pointRadius: 3, spanGaps: true };
    });
    UI.charts[clave] = new Chart($('#' + canvas), { type: 'line', data: { labels: fechas.map(f => fmtFecha(f).slice(0, 5) + '/' + f.slice(2, 4)), datasets },
      options: { maintainAspectRatio: false, interaction: { mode: 'index', intersect: false },
        scales: { x: { grid: { color: grid }, ticks: { color: muted, maxRotation: 0, autoSkip: true } }, y: { grid: { color: grid }, ticks: { color: muted, callback: v => fmt(v) } } },
        plugins: { legend: { display: datasets.length > 1, labels: { color: text, boxWidth: 12 } }, tooltip: { callbacks: { label: c => `${c.dataset.label}: ${fmt(c.parsed.y)}` } } } } });
  };
  const fmt3 = v => fmtP3.format(v), fmt2 = v => fmtL.format(v);
  dibujar('precioL', 'chartPrecioLitro', 'chartPrecioLitroEmpty', res.vehiculos.map(x => ({ label: x.vehiculo.matricula, datos: x.m.filas.filter(r => enP(r.fecha)).map(r => ({ fecha: r.fecha, y: r.precioLitro })) })), fmt3);
  dibujar('consumo', 'chartConsumo', 'chartConsumoEmpty', res.vehiculos.map(x => ({ label: x.vehiculo.matricula, datos: x.m.tramosLista.filter(t => enP(t.hasta)).map(t => ({ fecha: t.hasta, y: t.l100 })) })), fmt2);
}

/** Abre el diálogo de movimiento listo para un repostaje (si no hay vehículos, primero pide uno). */
function nuevoRepostaje(vehiculoId) {
  if (!Store.list('vehiculos').length) return openVehDialog(null, v => openMovDialog(null, { tipo: 'gasto', repostaje: true, vehiculoId: v.id }));
  openMovDialog(null, { tipo: 'gasto', repostaje: true, vehiculoId });
}
$('#addVehBtn').addEventListener('click', () => openVehDialog());
$('#addRepBtn').addEventListener('click', () => nuevoRepostaje(Veh.filtro || undefined));
$('#vehFiltro').addEventListener('change', e => { Veh.filtro = e.target.value; renderVehiculos(); });
$('#vehPeriodo').addEventListener('change', e => { Veh.periodo = e.target.value; renderVehiculos(); });
document.addEventListener('click', async e => {
  const t = e.target.closest('button'); if (!t) return;
  const d = t.dataset;
  if (d.vehEdit) openVehDialog(Store.get('vehiculos', d.vehEdit));
  if (d.vehRep) nuevoRepostaje(d.vehRep);
  if (t.id === 'repMasBtn') { Veh.todos = !Veh.todos; renderVehiculos(); }
  if (d.vehVer) { Veh.filtro = Veh.filtro === d.vehVer ? '' : d.vehVer; renderVehiculos(); }
  if (d.repEdit) {
    const r = Store.get('repostajes', d.repEdit); if (!r) return;
    const m = r.movimientoId && Store.get('movimientos', r.movimientoId);
    if (m) openMovDialog(m); else openMovDialog(null, { tipo: 'gasto', rep: r });
  }
  if (d.repDel) {
    const r = Store.get('repostajes', d.repDel); if (!r) return;
    const m = r.movimientoId && Store.get('movimientos', r.movimientoId);
    if (!confirm(`¿Eliminar el repostaje del ${fmtFecha(r.fecha)} (${fmtLitros(r.litros)}, ${eur(r.importe)})?${m ? '\n\nSe borrará también su gasto en Movimientos.' : ''}`)) return;
    await Store.apply(m ? [{ col: 'movimientos', del: m.id }] : [{ col: 'repostajes', del: r.id }]);   // borrar el gasto borra su repostaje
    toast('Repostaje eliminado');
  }
});
