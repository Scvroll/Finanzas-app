/* =========================================================
   Pantallas y diálogos de la fase 3: adjuntos + OCR, recurrentes,
   deudas, garantías e inversiones (FIFO). Usa Store/Calc/UI de app.js.
   ========================================================= */
const fmtPart = new Intl.NumberFormat(LOCALE, { maximumFractionDigits: 6, useGrouping: 'always' });
const fmtPrecio = new Intl.NumberFormat(LOCALE, { minimumFractionDigits: 2, maximumFractionDigits: 4, useGrouping: 'always' });
const eurP = n => n === null || n === undefined ? '—' : fmtPrecio.format(n) + ' €';
const signo = n => (n > 0 ? '+' : '') + eur(n);
const clsNum = n => n > 0 ? 'pos' : n < 0 ? 'neg' : '';
const fmtMB = b => b >= 1048576 ? (b / 1048576).toLocaleString(LOCALE, { maximumFractionDigits: 1 }) + ' MB' : Math.max(1, Math.round(b / 1024)) + ' KB';
document.addEventListener('click', e => { const b = e.target.closest('[data-close]'); if (b) b.closest('dialog').close(); });

/* ---------------- Adjuntos (componente) ---------------- */
const AdjUI = {
  /** inmediato=false: los cambios se guardan al pulsar «Guardar» del diálogo (AdjUI.cambios). */
  abrir(sel, owner, { inmediato = false } = {}) {
    const s = { el: $(sel), owner, inmediato, nuevos: [], borrar: new Set(), cerrada: false };
    s.el._sesion = s;
    if (!s.el._wired) {
      s.el._wired = true;
      s.el.addEventListener('change', e => { if (e.target.matches('input[type=file]')) { const ss = s.el._sesion; this.anadir(ss, [...e.target.files]); e.target.value = ''; } });
      s.el.addEventListener('click', e => {
        const ss = s.el._sesion, del = e.target.closest('[data-adj-del]'), open = e.target.closest('[data-adj-open]');
        if (del) { e.stopPropagation(); this.quitar(ss, del.dataset.adjDel); }
        else if (open) Visor.abrir(this.todos(ss).find(a => a.id === open.dataset.adjOpen), ss);
      });
    }
    this.render(s); return s;
  },
  existentes(s) { return Store.list('adjuntos').filter(a => a.ownerId === s.owner.ownerId && !s.borrar.has(a.id)); },
  todos(s) { return [...this.existentes(s), ...s.nuevos.map(n => n.rec)]; },
  render(s) {
    const items = this.todos(s);
    s.el.innerHTML = `<div class="adj-list">${items.map(a => `
      <figure class="adj" data-adj-open="${a.id}" title="${esc(a.nombre)} · ${fmtMB(a.size)}${a.ocr ? ' · texto leído' : ''}">
        ${a.mini ? `<img src="${a.mini}" alt="">` : `<span class="adj-icon">${a.mime === 'application/pdf' ? '📄' : '🖼️'}</span>`}
        <figcaption>${esc(a.nombre)}</figcaption>
        ${a.ocr ? '<span class="adj-ocr" title="Texto leído">Aa</span>' : ''}
        <button type="button" class="adj-del" data-adj-del="${a.id}" title="Quitar adjunto" aria-label="Quitar adjunto">✕</button>
      </figure>`).join('')}
      <label class="adj-add" title="Fotos (se comprimen) o PDF"><input type="file" accept="image/*,application/pdf" multiple hidden><span>＋ Añadir foto o PDF</span></label>
    </div>`;
  },
  async anadir(s, files) {
    let ultimo = null;
    for (const file of files) {
      try {
        const { rec, blob } = await Adjuntos.prepararArchivo(file, s.owner);
        await Adjuntos.BlobStore.put(rec.id, blob);
        if (s.inmediato) await Store.put('adjuntos', rec); else s.nuevos.push({ rec, blob });
        ultimo = { rec, blob };
      } catch (e) { toast(e.message || 'No se pudo adjuntar el archivo'); }
    }
    this.render(s);
    if (s.inmediato && ultimo) FileSync.run();
    return ultimo;
  },
  async quitar(s, id) {
    const i = s.nuevos.findIndex(n => n.rec.id === id);
    if (i >= 0) { Adjuntos.BlobStore.del(id).catch(() => {}); s.nuevos.splice(i, 1); }
    else if (s.inmediato) { if (!confirm('¿Eliminar este adjunto?')) return; await Store.remove('adjuntos', id); FileSync.run(); }
    else s.borrar.add(id);
    this.render(s);
  },
  cambios(s, ownerId) {
    return [...s.nuevos.map(n => ({ col: 'adjuntos', rec: { ...n.rec, ownerId } })), ...[...s.borrar].map(id => ({ col: 'adjuntos', del: id }))];
  },
  cerrar(s, guardado) {
    if (!s || s.cerrada) return; s.cerrada = true;
    if (!guardado) s.nuevos.forEach(n => Adjuntos.BlobStore.del(n.rec.id).catch(() => {}));
    else if (s.nuevos.length || s.borrar.size) FileSync.run();
  },
  async blob(a, s) { const n = s && s.nuevos.find(x => x.rec.id === a.id); return n ? n.blob : FileSync.obtener(a); },
  async guardarOCR(a, s, ocr) {
    const n = s && s.nuevos.find(x => x.rec.id === a.id);
    if (n) n.rec.ocr = ocr; else { const cur = Store.get('adjuntos', a.id); if (cur) await Store.put('adjuntos', { ...cur, ocr }); }
    if (s) this.render(s);
  }
};

/* ---------------- Visor de adjuntos ---------------- */
const Visor = {
  url: null, a: null, s: null,
  async abrir(a, s) {
    if (!a) return;
    this.a = a; this.s = s;
    const dlg = $('#visorDialog');
    $('#visorTitulo').textContent = a.nombre;
    $('#visorMeta').textContent = `${a.mime === 'application/pdf' ? 'PDF' : 'Imagen'} · ${fmtMB(a.size)}${a.tamOriginal && a.tamOriginal > a.size ? ` (comprimida desde ${fmtMB(a.tamOriginal)})` : ''}${a.driveId ? ' · guardado en tu Google Drive' : Auth.user ? ' · pendiente de subir a Drive' : ' · guardado en este dispositivo'}`;
    $('#visorCuerpo').innerHTML = '<p class="muted">Cargando…</p>';
    $('#visorOcr').innerHTML = this.htmlOCR(a);
    $('#visorLeer').hidden = !OCR.admite(a.mime);
    $('#visorLeer').textContent = a.ocr ? '🔁 Volver a leer el texto' : '🔍 Leer texto (OCR)';
    $('#visorDescargar').removeAttribute('href');
    if (!dlg.open) dlg.showModal();
    try {
      const blob = await AdjUI.blob(a, s);
      if (!blob) { $('#visorCuerpo').innerHTML = `<p class="muted">${a.driveId ? 'No se pudo descargar el archivo de Google Drive (¿sin conexión o sesión caducada?).' : 'Este archivo aún no está disponible en este dispositivo: se subió desde otro dispositivo que todavía no lo ha sincronizado.'}</p>`; return; }
      if (this.url) URL.revokeObjectURL(this.url);
      this.url = URL.createObjectURL(blob);
      $('#visorCuerpo').innerHTML = a.mime === 'application/pdf'
        ? `<iframe src="${this.url}" title="${esc(a.nombre)}"></iframe>`
        : `<img src="${this.url}" alt="${esc(a.nombre)}">`;
      const d = $('#visorDescargar'); d.href = this.url; d.download = a.nombre;
    } catch (e) { $('#visorCuerpo').innerHTML = `<p class="neg">No se pudo abrir el archivo: ${esc(e.message)}</p>`; }
  },
  htmlOCR(a) {
    if (!a.ocr) return '';
    return `<details><summary>Texto leído (${esc(a.ocr.proveedor || 'OCR')}, ${fmtFecha((a.ocr.fecha || '').slice(0, 10))}, confianza ${pct(a.ocr.confianza)})</summary><pre class="ocr-text">${esc(a.ocr.texto)}</pre></details>`;
  }
};
$('#visorDialog').addEventListener('close', () => { if (Visor.url) { URL.revokeObjectURL(Visor.url); Visor.url = null; } $('#visorCuerpo').innerHTML = ''; });
$('#visorBorrar').addEventListener('click', async () => {
  const { a, s } = Visor; if (!a) return;
  if (s) { if (s.inmediato || confirm('¿Quitar este adjunto?')) await AdjUI.quitar(s, a.id); }
  $('#visorDialog').close();
});
$('#visorLeer').addEventListener('click', async () => {
  const { a, s } = Visor; if (!a) return;
  const blob = await AdjUI.blob(a, s).catch(() => null); if (!blob) return toast('El archivo no está disponible');
  const enMov = $('#movDialog').open && s === MovDlg.adj;
  $('#visorDialog').close();
  if (enMov) ocrEnMovimiento(blob, a, s);
  else {
    const r = await ejecutarOCR(blob, $('#ocrPanelGlobal'));
    if (r) { $('#ocrPanelGlobal').hidden = true; await AdjUI.guardarOCR(a, s, r); toast('Texto leído y guardado con el adjunto'); Visor.abrir(Store.get('adjuntos', a.id) || a, s); }
  }
});

/* ---------------- OCR ---------------- */
async function ejecutarOCR(blob, panel, tipo = null) {
  panel.hidden = false;
  panel.innerHTML = `<div class="ocr-progress"><div class="ocr-estado">Preparando el lector de texto…</div><progress max="1" value="0"></progress>
    <p class="muted small">${OCR.proveedor.id === 'gemini' ? 'Se envía el documento a Google Gemini con tu clave (nivel gratuito). Si falla, se usará el lector del navegador.' : 'La lectura se hace en tu navegador (gratis, sin enviar la imagen a ningún servidor). La primera vez descarga unos 15 MB.'}</p></div>`;
  try {
    const categorias = [...new Set([...Store.getCategorias('gasto'), ...Store.getCategorias('ingreso')])];
    const r = await OCR.leer(blob, { tipo, categorias, onProgress: p => { const e = panel.querySelector('.ocr-estado'), pr = panel.querySelector('progress'); if (e) e.textContent = p.estado; if (pr) pr.value = p.progreso || 0; } });
    return r;
  } catch (e) {
    panel.innerHTML = `<p class="neg">${esc(e.message || 'No se pudo leer el documento')}</p><button type="button" class="btn-sm" data-ocr-cerrar>Cerrar</button>`;
    return null;
  }
}
function ocrPropuestaHTML(r) {
  const c = r.campos, nom = c.tipo === 'nomina';
  const v = n => n === null || n === undefined ? '' : String(n).replace('.', ',');
  const baja = typeof r.confianza === 'number' && r.confianza < 0.6;
  const prov = r.proveedor === 'gemini' ? 'leído con Gemini' : 'leído en el navegador';
  const cat = c.categoria && [...Store.getCategorias(nom ? 'ingreso' : 'gasto')].includes(c.categoria) ? c.categoria : null;
  const extra = [];
  if (nom) {
    const d = [c.periodo ? 'Periodo: ' + esc(c.periodo) : '', c.devengado != null ? 'Bruto (devengado): ' + eur(c.devengado) : '', c.deducciones != null ? 'Total a deducir: ' + eur(c.deducciones) : '',
      c.irpf != null ? 'Retención IRPF: ' + eur(c.irpf) + (c.irpfPct != null ? ` (${String(c.irpfPct).replace('.', ',')} %)` : '') : '', c.seguridadSocial != null ? 'Seguridad Social: ' + eur(c.seguridadSocial) : ''].filter(Boolean);
    if (d.length) extra.push(`<div class="muted small">${d.join(' · ')}</div>`);
  } else {
    if (c.iva != null) extra.push(`<div class="muted small">IVA/IGIC: ${eur(c.iva)}</div>`);
    if (c.conceptos && c.conceptos.length) extra.push(`<details><summary>Conceptos (${c.conceptos.length})</summary><ul>${c.conceptos.map(x => `<li>${esc(x.descripcion)}${x.importe != null ? ' — ' + eur(x.importe) : ''}</li>`).join('')}</ul></details>`);
    if (c.garantia && c.garantia.producto) extra.push(`<label class="check"><input type="checkbox" name="ocrGar" checked data-producto="${esc(c.garantia.producto)}" data-anios="${c.garantia.anios || ''}"> 🛡️ Registrar la garantía de «${esc(c.garantia.producto)}»${c.garantia.anios ? ` (${String(c.garantia.anios).replace('.', ',')} años)` : ''}</label>`);
  }
  if (cat) extra.push(`<label class="check"><input type="checkbox" name="ocrCat" value="${esc(cat)}" checked> Usar la categoría sugerida: <strong>${esc(cat)}</strong></label>`);
  return `<div class="ocr-result">
    <div class="ocr-head"><strong>Propuesta a partir del documento</strong> <span class="muted small">(${prov}) Revisa y corrige antes de usarla${baja ? ' · <span class="warn-txt">la imagen se ha leído con poca confianza</span>' : ''}</span></div>
    ${r.aviso ? `<p class="warn-txt small ocr-aviso">${esc(r.aviso)}</p>` : ''}
    <div class="form-grid">
      <div><label>Tipo de documento</label><select name="ocrTipo"><option value="ticket" ${!nom ? 'selected' : ''}>Ticket / factura (gasto)</option><option value="nomina" ${nom ? 'selected' : ''}>Nómina (ingreso)</option></select></div>
      <div><label class="ocr-lbl-importe">${nom ? 'Líquido a percibir (€)' : 'Importe total (€)'}</label><input name="ocrImporte" inputmode="decimal" value="${v(nom ? (c.liquido ?? c.importe) : c.importe)}" placeholder="no detectado"></div>
      <div><label>Fecha</label><input name="ocrFecha" type="date" value="${c.fecha || ''}"></div>
      <div><label class="ocr-lbl-quien">${nom ? 'Empresa' : 'Comercio'}</label><input name="ocrQuien" value="${esc((nom ? c.empresa : c.comercio) || '')}" placeholder="no detectado"></div>
    </div>
    ${extra.length ? `<div class="ocr-extra">${extra.join('')}</div>` : ''}
    <details><summary>Ver el texto leído</summary><pre class="ocr-text">${esc(r.texto)}</pre></details>
    <div class="dialog-actions" style="margin-top:8px"><button type="button" data-ocr-cerrar>Descartar</button><button type="button" class="btn-primary" data-ocr-aplicar>Usar estos datos</button></div>
  </div>`;
}
async function ocrEnMovimiento(blob, rec, s) {
  const panel = $('#ocrPanel');
  const r = await ejecutarOCR(blob, panel);
  if (!r) return;
  await AdjUI.guardarOCR(rec, s, r);   // el texto se guarda con el adjunto (al guardar el movimiento)
  panel.innerHTML = ocrPropuestaHTML(r);
}
$('#movOcrBtn').addEventListener('click', () => $('#movOcrFile').click());
$('#movOcrFile').addEventListener('change', async e => {
  const file = e.target.files[0]; e.target.value = ''; if (!file) return;
  const r = await AdjUI.anadir(MovDlg.adj, [file]);
  if (!r) return;
  if (!OCR.admite(r.rec.mime)) { $('#ocrPanel').hidden = false; $('#ocrPanel').innerHTML = '<p class="muted">Archivo adjuntado. Este lector no lee PDF: adjunta una foto o captura, o activa Gemini en Ajustes (lee PDF).</p><button type="button" class="btn-sm" data-ocr-cerrar>Cerrar</button>'; return; }
  ocrEnMovimiento(r.blob, r.rec, MovDlg.adj);
});
document.addEventListener('change', e => {
  if (e.target.name !== 'ocrTipo') return;
  const p = e.target.closest('.ocr-result'), nom = e.target.value === 'nomina';
  p.querySelector('.ocr-lbl-importe').textContent = nom ? 'Líquido a percibir (€)' : 'Importe total (€)';
  p.querySelector('.ocr-lbl-quien').textContent = nom ? 'Empresa' : 'Comercio';
});
document.addEventListener('click', e => {
  const cerrar = e.target.closest('[data-ocr-cerrar]'), aplicar = e.target.closest('[data-ocr-aplicar]');
  if (cerrar) { const p = cerrar.closest('.ocr-panel'); p.hidden = true; p.innerHTML = ''; }
  if (aplicar) {
    const p = aplicar.closest('.ocr-panel'), q = n => p.querySelector(`[name="${n}"]`), f = $('#movForm');
    const nom = q('ocrTipo').value === 'nomina', imp = parseImporte(q('ocrImporte').value || ''), fecha = q('ocrFecha').value, quien = q('ocrQuien').value.trim();
    const tipo = nom ? 'ingreso' : 'gasto';
    if (movTipo() !== tipo) { f.querySelector(`input[name="tipo"][value="${tipo}"]`).checked = true; fillCategoriaSelect(tipo); }
    if (nom) { fillCategoriaSelect('ingreso', Store.getCategorias('ingreso').includes('Nómina') ? 'Nómina' : undefined); f.tipoIngreso.value = 'nomina'; }
    if (isFinite(imp) && imp > 0) f.importe.value = fmtInput(imp);
    if (FC.isISO(fecha)) f.fecha.value = fecha;
    if (quien) f.descripcion.value = nom ? `Nómina ${quien}` : quien;
    else if (nom && !f.descripcion.value) f.descripcion.value = 'Nómina';
    const qc = q('ocrCat');
    if (qc && qc.checked && Store.getCategorias(tipo).includes(qc.value)) { f.categoria.value = qc.value; if (!nom && !f.id.value) f.querySelector(`input[name="naturaleza"][value="${naturalezaPorDefecto(qc.value)}"]`).checked = true; }
    const qg = q('ocrGar');
    if (qg && qg.checked && !nom && !f.esPago.checked) {
      f.esGar.checked = true; f.garProducto.value = qg.dataset.producto;
      if (Number(qg.dataset.anios) > 0) f.garAnios.value = fmtInputN(Number(qg.dataset.anios));
    }
    syncMovOpciones();
    p.hidden = true; p.innerHTML = '';
    toast('Datos aplicados: revísalos y pulsa Guardar');
  }
});

/* ---------------- Movimientos recurrentes ---------------- */
function renderRecurrentes() {
  const list = Store.list('recurrentes').sort((a, b) => (b.activo - a.activo) || a.descripcion.localeCompare(b.descripcion, LOCALE));
  $('#recBody').innerHTML = list.length ? list.map(r => `<tr class="${r.activo ? '' : 'muted'}">
    <td>${esc(r.descripcion || r.categoria)}<div class="badges"><span class="tag ${r.tipo}">${r.tipo === 'gasto' ? 'Gasto' : 'Ingreso'}</span> ${r.tipo === 'gasto' ? `<span class="badge ${r.naturaleza === 'fijo' ? 'b-fijo' : 'b-var'}">${r.naturaleza === 'fijo' ? 'Fijo' : 'Variable'}</span>` : `<span class="badge b-${r.tipoIngreso}">${TIPOS_INGRESO[r.tipoIngreso]}</span>`}</div></td>
    <td class="hide-sm">${esc(r.categoria)}</td>
    <td>${r.dia === FC.DIA_ULTIMO ? 'Último día' : `Día ${r.dia}`}<div class="muted small">desde ${monthLabel(r.desde, true)}${r.hasta ? ' hasta ' + monthLabel(r.hasta, true) : ''}</div></td>
    <td class="num ${r.tipo === 'ingreso' ? 'pos' : 'neg'}">${eur(r.importe)}</td>
    <td>${r.activo ? '<span class="badge b-ok">Activo</span>' : '<span class="badge">En pausa</span>'}</td>
    <td class="actions"><button class="btn-sm" data-rec-toggle="${r.id}" title="${r.activo ? 'Pausar' : 'Reanudar'}">${r.activo ? '⏸️' : '▶️'}</button> <button class="btn-sm" data-rec-edit="${r.id}" title="Editar">✏️</button> <button class="btn-sm btn-danger" data-rec-del="${r.id}" title="Eliminar">🗑️</button></td>
  </tr>`).join('') : '<tr><td colspan="6" class="empty">Sin movimientos recurrentes. Crea uno (p. ej. la nómina o el alquiler) y la app lo añadirá sola cada mes.</td></tr>';
}
function recTipo() { return $('#recForm').querySelector('input[name="tipo"]:checked').value; }
function recSyncTipo(cat) {
  const f = $('#recForm'), t = recTipo(), cats = Store.getCategorias(t), opts = cat && !cats.includes(cat) ? [...cats, cat] : cats;
  f.categoria.innerHTML = opts.map(c => `<option ${c === cat ? 'selected' : ''}>${esc(c)}</option>`).join('');
  $('#recRowNat').hidden = t !== 'gasto'; $('#recRowIng').hidden = t !== 'ingreso';
}
function openRecDialog(r) {
  const f = $('#recForm'); f.reset(); $('#recError').style.display = 'none';
  f.id.value = r?.id || '';
  f.querySelector(`input[name="tipo"][value="${r?.tipo || 'gasto'}"]`).checked = true;
  recSyncTipo(r?.categoria);
  f.importe.value = r ? fmtInput(r.importe) : ''; f.descripcion.value = r?.descripcion || ''; prepararCuenta(f.cuenta, r);
  if (!f.dia.options.length) f.dia.innerHTML = opcionesDiaCobro();
  f.dia.value = String(r?.dia || Number(todayISO().slice(8))); f.desde.value = r?.desde || monthKey(todayISO()); f.hasta.value = r?.hasta || '';
  f.querySelector(`input[name="naturaleza"][value="${r?.naturaleza || 'fijo'}"]`).checked = true; f.tipoIngreso.value = r?.tipoIngreso || 'nomina';
  f.activo.checked = r ? r.activo : true;
  $('#recDialogTitle').textContent = r ? 'Editar movimiento recurrente' : 'Nuevo movimiento recurrente';
  $('#recDialog').showModal();
}
$$('#recForm input[name="tipo"]').forEach(x => x.addEventListener('change', () => recSyncTipo()));
$('#recForm').addEventListener('submit', async e => {
  e.preventDefault();
  const f = e.target, importe = parseImporte(f.importe.value), dia = leerDiaCobro(f.dia.value);
  const err = m => { $('#recError').textContent = m; $('#recError').style.display = ''; };
  if (!(importe > 0)) return err('Introduce un importe mayor que 0.');
  if (dia !== FC.DIA_ULTIMO && !(dia >= 1 && dia <= 31)) return err('El día debe estar entre 1 y 31 o «Último día del mes».');
  if (!/^\d{4}-\d{2}$/.test(f.desde.value)) return err('Indica desde qué mes.');
  if (f.hasta.value && f.hasta.value < f.desde.value) return err('«Hasta» no puede ser anterior a «Desde».');
  const t = recTipo(), viejo = Store.get('recurrentes', f.id.value);
  if (!viejo && f.desde.value < monthKey(todayISO()) && !confirm(`Se crearán también los movimientos de los meses pasados desde ${monthLabel(f.desde.value)}. ¿Continuar?`)) return;
  await Store.put('recurrentes', ponerCuenta({ ...(viejo || {}), id: f.id.value || null, tipo: t, importe, categoria: f.categoria.value, descripcion: f.descripcion.value.trim(), dia, desde: f.desde.value, hasta: f.hasta.value, activo: f.activo.checked, naturaleza: f.querySelector('input[name="naturaleza"]:checked').value, tipoIngreso: f.tipoIngreso.value }, f.cuenta));
  $('#recDialog').close(); toast(viejo ? 'Recurrente actualizado (se aplica a los próximos meses)' : 'Recurrente creado');
});
$('#addRecBtn').addEventListener('click', () => openRecDialog());

/* ---------------- Deudas ---------------- */
function renderDeudas() {
  const ds = Calc.deudas().sort((a, b) => (a.terminada - b.terminada) || (a.proximas[0]?.fecha || '9').localeCompare(b.proximas[0]?.fecha || '9'));
  const activas = ds.filter(d => !d.terminada);
  const pendiente = round2(activas.reduce((s, d) => s + d.pendiente, 0));
  const cuotaMes = round2(activas.reduce((s, d) => s + (d.proximas[0]?.pago || 0), 0));
  const intPend = round2(activas.reduce((s, d) => s + d.interesesPendientes, 0));
  $('#deuPendiente').textContent = eur(pendiente);
  $('#deuCuotas').textContent = eur(cuotaMes);
  $('#deuIntereses').textContent = eur(intPend);
  $('#deuActivas').textContent = String(activas.length);
  $('#deudasList').innerHTML = ds.length ? ds.map(r => {
    const d = r.deuda, prog = r.filas.length ? r.pagadas / r.filas.length : 0;
    return `<div class="card deuda ${r.terminada ? 'terminada' : ''}">
      <div class="deuda-head">
        <div><h3>${esc(d.nombre)} ${r.terminada ? '<span class="badge b-ok">Pagada</span>' : ''}</h3>
          <div class="muted small">${MEDIOS_FIN[d.medio]} · ${eur(d.principal)} a ${d.plazo} meses · TIN ${fmtNum.format(d.tin)} % · TAE ${pct(r.tae)}${r.taeIntroducida !== null ? ` (indicada ${pct(r.taeIntroducida)})` : ''}</div>
          <div class="muted small deu-cobro">📅 Se cobra ${FC.textoDiaCobro(d.diaCobro)}</div></div>
        <div class="actions"><button class="btn-sm" data-deu-cuadro="${d.id}">📋 Cuadro</button> <button class="btn-sm" data-deu-edit="${d.id}" title="Editar">✏️</button> <button class="btn-sm btn-danger" data-deu-del="${d.id}" title="Eliminar">🗑️</button></div>
      </div>
      <div class="progress" title="${r.pagadas} de ${r.filas.length} cuotas pagadas"><span style="width:${(prog * 100).toFixed(1)}%"></span></div>
      <div class="deuda-kpis">
        <div><span>Pendiente</span><strong>${eur(r.pendiente)}</strong></div>
        <div><span>Cuotas restantes</span><strong>${r.restantes} de ${r.filas.length}</strong></div>
        <div><span>Cuota</span><strong>${eur(r.cuota + d.comisionMensual)}</strong></div>
        <div><span>Intereses pendientes</span><strong>${eur(r.interesesPendientes)}</strong></div>
        <div><span>Intereses totales</span><strong>${eur(r.totalIntereses)}</strong></div>
      </div>
      ${r.vencidas.length ? `<div class="notice warn">⏰ ${r.vencidas.length === 1 ? 'Hay 1 cuota vencida' : `Hay ${r.vencidas.length} cuotas vencidas`} sin marcar como pagada. <button class="btn-sm btn-primary" data-deu-pagar-hasta="${d.id}">Marcar pagadas hasta hoy</button></div>` : ''}
      ${r.proximas.length ? `<div class="table-wrap"><table class="compact"><thead><tr><th>Próximas cuotas</th><th>Fecha</th><th class="num">Cuota</th><th class="num">Intereses</th><th class="num">Capital</th><th></th></tr></thead><tbody>
        ${r.proximas.map(f => `<tr><td>${f.n}/${r.filas.length}</td><td>${fmtFecha(f.fecha)}${f.fecha <= todayISO() ? ' <span class="badge b-warn">vencida</span>' : ''}</td><td class="num">${eur(f.pago)}</td><td class="num">${eur(f.interes)}</td><td class="num">${eur(f.amortizacion)}</td><td class="actions"><button class="btn-sm" data-deu-pagar="${d.id}" data-n="${f.n}">✔ Pagada</button></td></tr>`).join('')}
      </tbody></table></div>` : ''}
    </div>`;
  }).join('') : '<div class="card empty">No tienes deudas ni compras a plazos. Al añadir un gasto, marca «Compra financiada» o pulsa «＋ Nueva deuda».</div>';
}
function cuotaComoMovimiento(d, f) {
  return { id: `cuota_${d.id}_${f.n}`, tipo: 'gasto', fecha: f.fecha, importe: f.pago, categoria: d.categoria || 'Deudas', cuenta: d.cuenta || '', ...(d.cuentaId ? { cuentaId: d.cuentaId } : {}),
    descripcion: `Cuota ${f.n}/${d.plazo} · ${d.nombre}`, naturaleza: 'fijo', deudaId: d.id, cuotaN: f.n, desglose: { interes: f.interes, amortizacion: f.amortizacion, comision: f.comision } };
}
async function marcarCuotas(deudaId, ns) {
  const d = Store.get('deudas', deudaId); if (!d) return;
  const r = Calc.deuda(d), pagadas = new Set(r.pagos.map(p => p.cuotaN));
  const filas = r.filas.filter(f => ns.includes(f.n) && !pagadas.has(f.n));
  if (!filas.length) return;
  await Store.apply(filas.map(f => ({ col: 'movimientos', rec: cuotaComoMovimiento(d, f) })));
  toast(filas.length === 1 ? `Cuota ${filas[0].n} marcada como pagada (gasto creado)` : `${filas.length} cuotas marcadas como pagadas`);
}
async function desmarcarCuota(deudaId, n) {
  const d = Store.get('deudas', deudaId); const p = Calc.deuda(d).pagos.find(x => x.cuotaN === n);
  if (p && confirm(`¿Desmarcar la cuota ${n}? Se eliminará el gasto «${p.descripcion}».`)) { await Store.deleteMovimiento(p.id); toast('Cuota desmarcada'); }
}
function openCuadro(deudaId) {
  const d = Store.get('deudas', deudaId); if (!d) return;
  const r = Calc.deuda(d), pagadas = new Set(r.pagos.map(p => p.cuotaN)), com = r.totalComisiones > 0;
  $('#cuadroTitulo').textContent = 'Cuadro de amortización · ' + d.nombre;
  $('#cuadroResumen').innerHTML = `<div class="fin-kpis">
    <div><span>Importe financiado</span><strong>${eur(d.principal)}</strong></div><div><span>Cuota</span><strong>${eur(r.cuota + d.comisionMensual)}</strong></div>
    <div><span>Total intereses</span><strong>${eur(r.totalIntereses)}</strong></div><div><span>Comisiones</span><strong>${eur(r.totalComisiones + d.comisionApertura)}</strong></div>
    <div><span>Total a pagar</span><strong>${eur(r.totalPagado + d.comisionApertura)}</strong></div><div><span>TIN / TAE calculada</span><strong>${fmtNum.format(d.tin)} % / ${pct(r.tae)}</strong></div></div>
    ${r.taeIntroducida !== null ? `<p class="small muted">TAE indicada por la entidad: ${pct(r.taeIntroducida)} (diferencia ${(r.diferenciaTAE * 100).toLocaleString(LOCALE, { maximumFractionDigits: 2 })} puntos).</p>` : ''}
    <p class="small muted">Sistema francés: cuota constante; al principio pagas más intereses y al final más capital. Al marcar una cuota como pagada se crea un gasto «pago de deuda» con su desglose.</p>`;
  $('#cuadroBody').innerHTML = r.filas.map(f => `<tr class="${pagadas.has(f.n) ? 'pagada' : f.fecha <= todayISO() ? 'vencida' : ''}">
    <td>${f.n}</td><td>${fmtFecha(f.fecha)}</td><td class="num">${eur(f.pago)}</td><td class="num">${eur(f.interes)}</td><td class="num">${eur(f.amortizacion)}</td>${com ? `<td class="num">${eur(f.comision)}</td>` : ''}<td class="num">${eur(f.pendiente)}</td>
    <td class="actions">${pagadas.has(f.n) ? `<button class="btn-sm" data-deu-despagar="${d.id}" data-n="${f.n}" title="Desmarcar">✔ Pagada</button>` : `<button class="btn-sm" data-deu-pagar="${d.id}" data-n="${f.n}">Marcar pagada</button>`}</td></tr>`).join('');
  $('#cuadroHead').innerHTML = `<tr><th>#</th><th>Fecha</th><th class="num">Cuota</th><th class="num">Intereses</th><th class="num">Capital</th>${com ? '<th class="num">Comisión</th>' : ''}<th class="num">Pendiente</th><th></th></tr>`;
  $('#cuadroFoot').innerHTML = `<tr><td colspan="2"><strong>Total</strong></td><td class="num"><strong>${eur(r.totalPagado)}</strong></td><td class="num"><strong>${eur(r.totalIntereses)}</strong></td><td class="num"><strong>${eur(d.principal)}</strong></td>${com ? `<td class="num">${eur(r.totalComisiones)}</td>` : ''}<td></td><td></td></tr>`;
  $('#cuadroDialog').dataset.deuda = d.id;
  if (!$('#cuadroDialog').open) $('#cuadroDialog').showModal();
}
function openDeudaDialog(d) {
  const f = $('#deudaForm'); f.reset(); $('#deudaError').style.display = 'none';
  f.id.value = d?.id || ''; f.nombre.value = d?.nombre || '';
  const cats = Store.getCategorias('gasto'), cat = d?.categoria || (cats.includes('Deudas') ? 'Deudas' : 'Otros');
  f.categoria.innerHTML = [...new Set([...cats, cat])].map(c => `<option ${c === cat ? 'selected' : ''}>${esc(c)}</option>`).join('');
  prepararCuenta(f.cuenta, d); f.notas.value = d?.notas || '';
  setFinFields('#deudaFin', d || { medio: 'prestamo', tin: '', plazo: 12, fechaPrimeraCuota: FC.addMonthsISO(todayISO(), 1) });
  $('#deudaDialogTitle').textContent = d ? 'Editar deuda' : 'Nueva deuda o préstamo';
  $('#deudaVinculada').hidden = !d?.movimientoId;
  $('#deudaDialog').showModal();
}
$('#deudaForm').addEventListener('submit', async e => {
  e.preventDefault();
  const f = e.target, err = m => { $('#deudaError').textContent = m; $('#deudaError').style.display = ''; };
  if (!f.nombre.value.trim()) return err('Pon un nombre (p. ej. «Préstamo coche»).');
  const fin = leerFinFields('#deudaFin'); if (fin.error) return err(fin.error);
  const viejo = Store.get('deudas', f.id.value);
  if (viejo) {
    const pag = Calc.deuda(viejo).pagos.length;
    const cambiaCuadro = ['principal', 'tin', 'plazo', 'fechaPrimeraCuota', 'diaCobro', 'comisionMensual'].some(k => viejo[k] !== fin[k]);
    if (pag && cambiaCuadro && !confirm('Cambiar las condiciones recalcula el cuadro. Las cuotas ya marcadas como pagadas conservan el importe y el desglose con que se registraron. ¿Continuar?')) return;
  }
  delete fin.error;
  await Store.put('deudas', ponerCuenta({ ...(viejo || {}), ...fin, id: f.id.value || null, nombre: f.nombre.value.trim(), categoria: f.categoria.value, notas: f.notas.value.trim(), fechaInicio: viejo?.fechaInicio || todayISO() }, f.cuenta));
  $('#deudaDialog').close(); toast('Deuda guardada');
});
$('#addDeudaBtn').addEventListener('click', () => openDeudaDialog());

/* ---------------- Garantías ---------------- */
function alertasGarantia() { return Calc.garantias().filter(g => g.estado !== 'vigente' && !g.mov.garantia.oculta); }
function textoDias(g) { return g.dias < 0 ? `caducó hace ${-g.dias} día${g.dias === -1 ? '' : 's'}` : g.dias === 0 ? 'caduca hoy' : `caduca en ${g.dias} día${g.dias === 1 ? '' : 's'}`; }
function renderBannerGarantias() {
  const al = alertasGarantia(), el = $('#garantiaBanner');
  el.hidden = !al.length;
  if (!al.length) return;
  const prox = al.filter(g => g.estado === 'proxima').length, cad = al.length - prox;
  el.innerHTML = `<span>🛡️ <strong>${[prox ? `${prox} garantía${prox > 1 ? 's' : ''} a punto de caducar` : '', cad ? `${cad} garantía${cad > 1 ? 's' : ''} caducada${cad > 1 ? 's' : ''}` : ''].filter(Boolean).join(' y ')}:</strong>
    ${al.slice(0, 3).map(g => `${esc(g.mov.garantia.producto || g.mov.descripcion)} (${textoDias(g)})`).join(', ')}${al.length > 3 ? '…' : ''}</span>
    <span class="row-actions"><button class="btn-sm" data-ver-garantias>Ver garantías</button> <button class="btn-sm" data-ocultar-garantias title="No volver a avisar de estas garantías">Ocultar aviso</button></span>`;
}
function renderGarantias() {
  const gs = Calc.garantias(), dias = Store.state.ajustes.avisoGarantiaDias;
  $('#garAvisoInfo').textContent = `Aviso cuando falten ${dias} días o menos (cámbialo en Ajustes). Plazo legal en España para productos nuevos comprados desde 2022: 3 años.`;
  $('#garBody').innerHTML = gs.length ? gs.map(g => {
    const m = g.mov, prod = m.garantia.producto || m.descripcion || m.categoria;
    const cal = FC.urlGoogleCalendar({ titulo: `Caduca la garantía: ${prod}`, fecha: g.vence, detalles: `Compra del ${fmtFecha(m.fecha)} por ${eur(m.importe)}${m.descripcion ? ' · ' + m.descripcion : ''}. Garantía de ${fmtNum.format(m.garantia.anios).replace(',00', '')} años. (Recordatorio creado desde Mis Finanzas)` });
    const n = Store.list('adjuntos').filter(a => a.ownerId === m.id).length;
    return `<tr class="gar-${g.estado}">
      <td><strong>${esc(prod)}</strong><div class="muted small">${esc(m.categoria)}${n ? ` · 📎 ${n} adjunto${n > 1 ? 's' : ''}` : ''}${m.garantia.oculta ? ' · aviso oculto' : ''}</div></td>
      <td class="hide-sm">${fmtFecha(m.fecha)}</td><td class="num hide-sm">${eur(m.importe)}</td>
      <td>${fmtFecha(g.vence)}</td>
      <td><span class="badge ${g.estado === 'vigente' ? 'b-ok' : g.estado === 'proxima' ? 'b-warn' : 'b-bad'}">${g.estado === 'vigente' ? 'Vigente' : g.estado === 'proxima' ? 'Caduca pronto' : 'Caducada'}</span><div class="muted small">${textoDias(g)}</div></td>
      <td class="actions"><a class="btn btn-sm" href="${esc(cal)}" target="_blank" rel="noopener" title="Añadir recordatorio a Google Calendar">📅</a>
        <button class="btn-sm" data-edit-mov="${m.id}" title="Ver o editar la compra">✏️</button>
        ${g.estado !== 'vigente' ? `<button class="btn-sm" data-gar-ocultar="${m.id}" title="${m.garantia.oculta ? 'Volver a avisar' : 'No avisar más'}">${m.garantia.oculta ? '🔔' : '🔕'}</button>` : ''}</td>
    </tr>`;
  }).join('') : '<tr><td colspan="6" class="empty">No hay garantías. Al añadir un gasto, marca «Garantía» para que la app te avise antes de que caduque.</td></tr>';
}
async function ocultarGarantias(ids, oculta = true) {
  await Store.apply(ids.map(id => { const m = Store.get('movimientos', id); return { col: 'movimientos', rec: { ...m, garantia: { ...m.garantia, oculta } } }; }));
}
async function notificarGarantias() {
  const aj = Store.state.ajustes;
  if (!aj.notificaciones || typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
  const hoy = todayISO(); if (localStorage.getItem('finanzas_notif_dia') === hoy) return;
  const al = alertasGarantia(); if (!al.length) return;
  localStorage.setItem('finanzas_notif_dia', hoy);
  const body = al.slice(0, 4).map(g => `${g.mov.garantia.producto || g.mov.descripcion}: ${textoDias(g)}`).join('\n');
  const opts = { body, icon: 'icons/icon-192.png', tag: 'garantias' };
  try {
    const reg = 'serviceWorker' in navigator ? await navigator.serviceWorker.getRegistration() : null;
    if (reg) await reg.showNotification('Garantías · Mis Finanzas', opts); else new Notification('Garantías · Mis Finanzas', opts);
  } catch (e) { console.info('No se pudo mostrar la notificación', e.message); }
}

/* ---------------- Inversiones (FIFO) ---------------- */
function renderInversiones() {
  const { activos, tot } = Calc.cartera();
  $('#invAportado').textContent = eur(tot.aportadoNeto);
  $('#invAportadoSub').textContent = `Comprado ${eur(tot.comprado)} · coste FIFO vivo ${eur(tot.coste)}`;
  $('#invValor').textContent = eur(tot.valor);
  const r = $('#invRent'); r.textContent = signo(tot.noRealizada); r.className = 'value ' + clsNum(tot.noRealizada);
  $('#invRentPct').textContent = pct(tot.noRealizadaPct) + ' sobre el coste';
  const rr = $('#invRealizada'); rr.textContent = signo(tot.realizada); rr.className = 'value ' + clsNum(tot.realizada);
  const lista = [...activos].sort((a, b) => b.valor - a.valor || a.activo.nombre.localeCompare(b.activo.nombre, LOCALE));
  $('#invBody').innerHTML = lista.length ? lista.map(x => {
    const a = x.activo, cod = [a.isin, a.ticker].filter(Boolean).join(' · '), err = x.errores.length;
    return `<tr>
      <td><button class="link" data-act-det="${a.id}"><strong>${esc(a.nombre)}</strong></button><div class="muted small">${TIPOS_ACTIVO[a.tipo]}${cod ? ' · ' + esc(cod) : ''}${err ? ' · <span class="neg">⚠ revisa las operaciones</span>' : ''}</div></td>
      <td class="num">${fmtPart.format(x.participaciones)}</td>
      <td class="num hide-sm">${x.participaciones > 0 ? eurP(x.costeMedio) : '—'}</td>
      <td class="num">${eur(x.aportadoNeto)}</td>
      <td class="num">${eur(x.valor)}<div class="muted small">${x.precio !== null ? `${eurP(x.precio)} · ${fmtFecha(x.fechaPrecio)}${x.precioDeOperacion ? ' (últ. operación)' : ''}` : ''}</div></td>
      <td class="num ${clsNum(x.noRealizada)}">${x.participaciones > 0 ? signo(x.noRealizada) + `<div class="small">${pct(x.noRealizadaPct)}</div>` : '—'}</td>
      <td class="num ${clsNum(x.gananciaRealizada)} hide-sm">${x.ventas.length ? signo(x.gananciaRealizada) : '—'}</td>
      <td class="actions"><button class="btn-sm" data-op-nueva="${a.id}" title="Añadir compra o venta">＋</button> <button class="btn-sm" data-precio-nuevo="${a.id}" title="Actualizar precio">💲</button> <button class="btn-sm" data-act-det="${a.id}" title="Ver lotes y ventas">🔎</button></td>
    </tr>`;
  }).join('') : '<tr><td colspan="8" class="empty">Aún no tienes inversiones. Añade un activo (fondo, ETF, acción o cripto) y sus compras, o importa un CSV.</td></tr>';
  const anios = Object.entries(tot.porAnio).sort((a, b) => b[0].localeCompare(a[0]));
  $('#realizadasBody').innerHTML = anios.length ? anios.map(([y, v]) => `<tr><td>${y}</td><td class="num ${clsNum(v)}">${signo(v)}</td></tr>`).join('') : '<tr><td colspan="2" class="empty">Sin ventas todavía.</td></tr>';

  if (typeof Chart === 'undefined') return;
  const porTipo = {}; activos.forEach(x => porTipo[TIPOS_ACTIVO[x.activo.tipo]] = round2((porTipo[TIPOS_ACTIVO[x.activo.tipo]] || 0) + x.valor));
  const entries = Object.entries(porTipo).filter(e => e[1] > 0);
  if (UI.charts.inv) UI.charts.inv.destroy();
  UI.charts.inv = new Chart($('#chartInversiones'), { type: 'doughnut',
    data: { labels: entries.map(e => e[0]), datasets: [{ data: entries.map(e => e[1]), backgroundColor: entries.map((_, i) => PALETTE[i % PALETTE.length]), borderColor: cssVar('--card'), borderWidth: 2 }] },
    options: { maintainAspectRatio: false, cutout: '60%', plugins: { legend: { position: 'right', labels: { color: cssVar('--text'), boxWidth: 12 } }, tooltip: { callbacks: { label: ctx => `${ctx.label}: ${eur(ctx.parsed)} (${pct(tot.valor ? ctx.parsed / tot.valor : 0)})` } } } } });
}
const Det = { id: null, adj: null };
function openDetalle(id) {
  const x = Calc.cartera().activos.find(a => a.activo.id === id); if (!x) { if ($('#detDialog').open) $('#detDialog').close(); return; }
  Det.id = id; const a = x.activo, opsById = Object.fromEntries(Store.list('operaciones').map(o => [o.id, o]));
  const nomAct = i => Store.get('activos', i)?.nombre || '(activo borrado)';
  const deTraspaso = o => o ? `<div class="muted small">↪ procedente de traspaso de ${esc(nomAct(o.activoId))} (${fmtFecha(o.fecha)})</div>` : '';
  $('#detTitulo').textContent = a.nombre;
  $('#detSub').textContent = [TIPOS_ACTIVO[a.tipo], a.isin && 'ISIN ' + a.isin, a.ticker && 'Ticker ' + a.ticker].filter(Boolean).join(' · ') + (a.notas ? ' — ' + a.notas : '');
  $('#detKpis').innerHTML = `<div class="fin-kpis">
    <div><span>Participaciones</span><strong>${fmtPart.format(x.participaciones)}</strong></div>
    <div><span>Coste medio (lotes vivos)</span><strong>${x.participaciones > 0 ? eurP(x.costeMedio) : '—'}</strong></div>
    <div><span>Aportado neto</span><strong>${eur(x.aportadoNeto)}</strong></div>
    <div><span>Valor de mercado</span><strong>${eur(x.valor)}</strong><small>${x.precio !== null ? eurP(x.precio) + ' el ' + fmtFecha(x.fechaPrecio) : ''}</small></div>
    <div><span>Ganancia no realizada</span><strong class="${clsNum(x.noRealizada)}">${signo(x.noRealizada)} (${pct(x.noRealizadaPct)})</strong></div>
    <div><span>Ganancia realizada</span><strong class="${clsNum(x.gananciaRealizada)}">${signo(x.gananciaRealizada)}</strong></div></div>
    ${x.errores.length ? `<p class="neg small">⚠ ${x.errores.map(e => esc(e.msg)).join('. ')}</p>` : ''}`;
  $('#detLotes').innerHTML = x.lotes.length ? x.lotes.map(l => `<tr><td>${fmtFecha(l.fecha)}${deTraspaso(l.origen)}</td><td class="num">${fmtPart.format(l.participaciones)}${l.participaciones < l.iniciales ? `<div class="muted small">de ${fmtPart.format(l.iniciales)}</div>` : ''}</td><td class="num">${l.origen ? '—' : eurP(opsById[l.opId]?.precio)}</td><td class="num">${eurP(l.costeUnitario)}</td><td class="num">${eur(l.coste)}</td><td class="num ${x.precio !== null ? clsNum(l.participaciones * x.precio - l.coste) : ''}">${x.precio !== null ? signo(round2(l.participaciones * x.precio - l.coste)) : '—'}</td></tr>`).join('') : '<tr><td colspan="6" class="empty">Sin participaciones vivas.</td></tr>';
  $('#detVentas').innerHTML = x.ventas.length ? x.ventas.slice().reverse().map(v => `<div class="venta">
      <div class="venta-head"><strong>Venta del ${fmtFecha(v.fecha)}</strong>: ${fmtPart.format(v.participaciones)} part. × ${eurP(v.precio)}${v.comisiones ? ` − ${eur(v.comisiones)} comisiones` : ''} = ${eur(v.importeNeto)} · coste FIFO ${eur(v.coste)} · <span class="${clsNum(v.ganancia)}"><strong>${signo(v.ganancia)}</strong></span>${v.incompleta ? ' <span class="neg">(vendes más de lo que tenías)</span>' : ''}</div>
      <table class="compact"><thead><tr><th>Lote consumido (compra)</th><th class="num">Participaciones</th><th class="num">Coste unitario</th><th class="num">Coste</th></tr></thead><tbody>
      ${v.consumos.map(c => `<tr><td>${fmtFecha(c.fecha)}${deTraspaso(c.origen)}</td><td class="num">${fmtPart.format(c.participaciones)}</td><td class="num">${eurP(c.costeUnitario)}</td><td class="num">${eur(c.coste)}</td></tr>`).join('')}</tbody></table></div>`).join('') : '<p class="muted">Sin ventas.</p>';
  // Traspasos entre fondos (entradas y salidas)
  const tfs = Store.list('traspasosFondos').filter(t => t.origenId === id || t.destinoId === id).sort((p, q) => q.fecha.localeCompare(p.fecha));
  const infoTf = Object.fromEntries([...(x.traspasosEntrada || []), ...(x.traspasosSalida || [])].map(t => [t.traspasoId + (t.origenId ? '_in' : '_out'), t]));
  $('#detTraspasos').innerHTML = tfs.length ? `<h4>Traspasos entre fondos</h4><div class="table-wrap"><table class="compact"><thead><tr><th>Fecha</th><th>Traspaso</th><th class="num">Part.</th><th class="num">Coste traspasado</th><th></th></tr></thead><tbody>
    ${tfs.map(t => { const sale = t.origenId === id, i = infoTf[t.id + (sale ? '_out' : '_in')];
      return `<tr><td>${fmtFecha(t.fecha)}</td><td>${sale ? `⇢ a <strong>${esc(nomAct(t.destinoId))}</strong>` : `⇠ desde <strong>${esc(nomAct(t.origenId))}</strong>`}${t.todas ? ' <span class="badge">todas</span>' : ''}${t.notas ? `<div class="muted small">${esc(t.notas)}</div>` : ''}</td>
        <td class="num">${sale ? '−' + fmtPart.format(i ? i.participaciones : t.participaciones) : '+' + fmtPart.format(i ? i.participaciones : t.participacionesDestino)}</td><td class="num">${i ? eur(i.coste) : '—'}</td>
        <td class="actions"><button class="btn-sm" data-tf-edit="${t.id}" title="Editar">✏️</button> <button class="btn-sm btn-danger" data-tf-del="${t.id}" title="Eliminar">🗑️</button></td></tr>`; }).join('')}</tbody></table></div>
    <p class="muted small">Sin ganancia ni pérdida: el fondo de destino hereda el coste y las fechas originales de compra (FIFO).</p>` : '';
  $('#detOps').innerHTML = FC.ordenarOperaciones(x.ops).reverse().map(o => `<tr><td>${fmtFecha(o.fecha)}</td><td><span class="tag ${o.tipo === 'compra' ? 'gasto' : 'ingreso'}">${o.tipo === 'compra' ? 'Compra' : 'Venta'}</span></td><td class="num">${fmtPart.format(o.participaciones)}</td><td class="num">${eurP(o.precio)}</td><td class="num hide-sm">${o.comisiones ? eur(o.comisiones) : '—'}</td><td class="num">${eur(round2(o.participaciones * o.precio + (o.tipo === 'compra' ? o.comisiones : -o.comisiones)))}${o.cuentaId && Store.get('cuentas', o.cuentaId) ? `<div class="muted small">${esc(Store.get('cuentas', o.cuentaId).nombre)}</div>` : ''}</td>
    <td class="actions"><button class="btn-sm" data-op-edit="${o.id}" title="Editar">✏️</button> <button class="btn-sm btn-danger" data-op-del="${o.id}" title="Eliminar">🗑️</button></td></tr>`).join('') || '<tr><td colspan="7" class="empty">Sin operaciones.</td></tr>';
  const precios = x.precios.slice().sort((p, q) => q.fecha.localeCompare(p.fecha));
  $('#detPrecios').innerHTML = precios.length ? precios.map(p => `<tr><td>${fmtFecha(p.fecha)}</td><td class="num">${eurP(p.precio)}</td><td class="actions"><button class="btn-sm btn-danger" data-precio-del="${p.id}" title="Eliminar">🗑️</button></td></tr>`).join('') : '<tr><td colspan="3" class="empty">Sin precios manuales: se usa el de la última operación.</td></tr>';
  Det.adj = AdjUI.abrir('#detAdj', { ownerType: 'activo', ownerId: id }, { inmediato: true });
  if (!$('#detDialog').open) $('#detDialog').showModal();
}
function openActivoDialog(a) {
  const f = $('#activoForm'); f.reset(); $('#activoError').style.display = 'none';
  f.id.value = a?.id || ''; f.nombre.value = a?.nombre || ''; f.tipo.value = a?.tipo || 'fondo'; f.isin.value = a?.isin || ''; f.ticker.value = a?.ticker || ''; f.notas.value = a?.notas || '';
  $('#activoDialogTitle').textContent = a ? 'Editar activo' : 'Nuevo activo';
  $('#activoDelete').style.display = a ? '' : 'none';
  $('#activoDialog').showModal();
}
$('#aTipo').innerHTML = Object.entries(TIPOS_ACTIVO).map(([k, v]) => `<option value="${k}">${v}</option>`).join('');
$('#activoForm').addEventListener('submit', async e => {
  e.preventDefault();
  const f = e.target, err = m => { $('#activoError').textContent = m; $('#activoError').style.display = ''; };
  if (!f.nombre.value.trim()) return err('Pon un nombre (p. ej. «Vanguard Global Stock»).');
  const isin = f.isin.value.trim().toUpperCase();
  if (isin && !/^[A-Z]{2}[A-Z0-9]{9}\d$/.test(isin)) return err('El ISIN tiene 12 caracteres, p. ej. IE00B03HCZ61 (o déjalo vacío).');
  const nuevo = !f.id.value;
  const a = await Store.put('activos', { ...(Store.get('activos', f.id.value) || {}), id: f.id.value || null, nombre: f.nombre.value, tipo: f.tipo.value, isin, ticker: f.ticker.value, notas: f.notas.value.trim() });
  $('#activoDialog').close(); toast('Activo guardado');
  if (nuevo && typeof CuUI !== 'undefined' && CuUI.tfNuevo) tfFondoCreado(a);
  else if (nuevo) openOpDialog(null, a.id); else if ($('#detDialog').open) openDetalle(a.id);
});
$('#activoDelete').addEventListener('click', async () => {
  const id = $('#activoForm').id.value, n = Store.list('operaciones').filter(o => o.activoId === id).length;
  const ntf = Store.list('traspasosFondos').filter(t => t.origenId === id || t.destinoId === id).length;
  if (ntf) return alert(`Este fondo tiene ${ntf} traspaso${ntf === 1 ? '' : 's'} entre fondos. Bórralos antes (en el detalle del fondo) para no descuadrar el coste del otro fondo.`);
  if (!confirm(`¿Eliminar este activo${n ? ` y sus ${n} operaciones` : ''} y su historial de precios?`)) return;
  await Store.deleteActivo(id); $('#activoDialog').close(); if ($('#detDialog').open) $('#detDialog').close(); toast('Activo eliminado');
});
/** v3.4: comprueba un cambio en operaciones o traspasos entre fondos con el motor FIFO de toda la cartera.
    Solo cuentan los errores NUEVOS (los que ya hubiera en los datos no bloquean cambios que no tienen que ver). */
function erroresCambioCartera({ ops = Store.list('operaciones'), tfs = Store.list('traspasosFondos') } = {}) {
  const antes = FC.carteraFIFO(Store.list('operaciones'), Store.list('traspasosFondos')), despues = FC.carteraFIFO(ops, tfs);
  const nombre = id => Store.get('activos', id)?.nombre || 'activo';
  const out = FC.erroresNuevos(antes, despues).map(e => ({ ...e, texto: `${nombre(e.activoId || Object.keys(despues.porActivo).find(k => despues.porActivo[k].errores.includes(e)))}: ${e.msg}` }));
  return out;
}
function opTipo() { return $('#opForm').querySelector('input[name="tipo"]:checked').value; }
function previewOp() {
  const f = $('#opForm'), part = parseImporte(f.participaciones.value || ''), precio = parseImporte(f.precio.value || ''), com = parseImporte(f.comisiones.value || '0') || 0;
  const venta = opTipo() === 'venta';
  let txt = '';
  if (part > 0 && precio >= 0) txt = venta ? `Importe neto de la venta: ${eur(part * precio - com)}` : `Coste de la compra: ${eur(part * precio + com)}`;
  if (venta && f.activoId.value && FC.isISO(f.fecha.value)) {
    const disp = FC.disponibleActivo(f.activoId.value, Store.list('operaciones'), Store.list('traspasosFondos'), f.fecha.value, f.id.value || null);
    txt += `${txt ? ' · ' : ''}Disponibles el ${fmtFecha(f.fecha.value)}: ${fmtPart.format(disp)} participaciones`;
  }
  $('#opPreview').textContent = txt;
}
function openOpDialog(op, activoId, tipo = 'compra') {
  const f = $('#opForm'); f.reset(); $('#opError').style.display = 'none';
  const acts = Store.list('activos').sort((a, b) => a.nombre.localeCompare(b.nombre, LOCALE));
  if (!acts.length) { toast('Primero crea un activo'); return openActivoDialog(); }
  f.activoId.innerHTML = acts.map(a => `<option value="${a.id}">${esc(a.nombre)}</option>`).join('');
  f.id.value = op?.id || ''; f.activoId.value = op?.activoId || activoId || acts[0].id;
  f.querySelector(`input[name="tipo"][value="${op?.tipo || tipo}"]`).checked = true;
  f.fecha.value = op?.fecha || todayISO(); f.participaciones.value = op ? fmtInputN(op.participaciones) : ''; f.precio.value = op ? fmtInputN(op.precio) : '';
  f.comisiones.value = op?.comisiones ? fmtInput(op.comisiones) : ''; f.notas.value = op?.notas || '';
  // v3.4: cuenta desde la que se paga la compra / a la que llega la venta (opcional)
  const hayCuentas = Store.list('cuentas').length > 0;
  let cid = op ? (op.cuentaId || '') : '';
  if (!op) { const ult = Store.list('operaciones').filter(o => o.cuentaId && Store.get('cuentas', o.cuentaId)?.activa !== false).sort((a, b) => (b.creado || 0) - (a.creado || 0) || b.fecha.localeCompare(a.fecha))[0]; cid = ult ? ult.cuentaId : ''; }
  f.cuentaId.innerHTML = opcionesCuenta(cid, { vacia: '— Sin cuenta (no mueve saldos) —' }); f.cuentaId.value = Store.get('cuentas', cid) ? cid : '';
  $('#opCuentaRow').hidden = false; $('#opCuenta').disabled = !hayCuentas;
  $('#opCuentaInfo').textContent = hayCuentas ? 'La compra resta de esta cuenta (participaciones × precio + comisiones); la venta suma lo cobrado. No es gasto ni ingreso.' : 'Crea tus cuentas en la pestaña «Cuentas» para que las compras resten del saldo de tu cuenta de inversión.';
  $('#opDialogTitle').textContent = op ? 'Editar operación' : 'Nueva operación';
  previewOp(); $('#opDialog').showModal();
}
$('#opForm').addEventListener('input', previewOp);
$('#opForm').addEventListener('submit', async e => {
  e.preventDefault();
  const f = e.target, err = m => { $('#opError').textContent = m; $('#opError').style.display = ''; };
  const part = parseImporte(f.participaciones.value || ''), precio = parseImporte(f.precio.value || ''), com = f.comisiones.value.trim() ? parseImporte(f.comisiones.value) : 0;
  if (!FC.isISO(f.fecha.value)) return err('Indica la fecha.');
  if (!(part > 0)) return err('Indica las participaciones (p. ej. 12,345).');
  if (!(precio >= 0) || !isFinite(precio)) return err('Indica el precio por participación.');
  if (!(com >= 0) || !isFinite(com)) return err('Revisa las comisiones.');
  const viejo = Store.get('operaciones', f.id.value);
  const op = { ...(viejo || {}), id: f.id.value || uid(), activoId: f.activoId.value, tipo: opTipo(), fecha: f.fecha.value, participaciones: part, precio, comisiones: com, notas: f.notas.value.trim(), creado: viejo?.creado || Date.now() };
  delete op.cuentaId; if (f.cuentaId.value && Store.get('cuentas', f.cuentaId.value)) op.cuentaId = f.cuentaId.value;
  // Comprueba que todas las ventas (y traspasos entre fondos) siguen cabiendo (FIFO) con este cambio
  const errs = erroresCambioCartera({ ops: Store.list('operaciones').filter(o => o.id !== op.id).concat(op) });
  if (errs.length) return err(errs[0].texto + '. Revisa la fecha y las participaciones.');
  await Store.put('operaciones', op);
  $('#opDialog').close(); toast(op.tipo === 'compra' ? 'Compra guardada' : 'Venta guardada');
  if ($('#detDialog').open) openDetalle(Det.id);
});
function openPrecioDialog(activoId) {
  const f = $('#precioForm'); f.reset(); $('#precioError').style.display = 'none';
  const a = Store.get('activos', activoId); if (!a) return;
  const x = Calc.cartera().activos.find(y => y.activo.id === activoId);
  f.activoId.value = activoId; f.fecha.value = todayISO(); f.precio.value = x && x.precio !== null ? fmtInputN(x.precio) : '';
  $('#precioTitulo').textContent = 'Actualizar precio · ' + a.nombre;
  $('#precioInfo').textContent = x && x.participaciones > 0 ? `Tienes ${fmtPart.format(x.participaciones)} participaciones. Valor = participaciones × precio.` : '';
  $('#precioDialog').showModal(); setTimeout(() => f.precio.select(), 30);
}
$('#precioForm').addEventListener('submit', async e => {
  e.preventDefault();
  const f = e.target, p = parseImporte(f.precio.value || '');
  if (!(p >= 0) || !isFinite(p) || !f.precio.value.trim()) { $('#precioError').textContent = 'Indica el precio (valor liquidativo o cotización) por participación.'; $('#precioError').style.display = ''; return; }
  if (!FC.isISO(f.fecha.value)) { $('#precioError').textContent = 'Indica la fecha.'; $('#precioError').style.display = ''; return; }
  // un precio por activo y día (id determinista: no se duplica entre dispositivos)
  await Store.put('precios', { id: `precio_${f.activoId.value}_${f.fecha.value}`, activoId: f.activoId.value, fecha: f.fecha.value, precio: p });
  $('#precioDialog').close(); toast('Precio actualizado');
  if ($('#detDialog').open) openDetalle(Det.id);
});

/* --- Importación CSV --- */
const CsvImp = { plan: null };
function claveActivo(a) { return a.isin ? 'isin:' + a.isin : a.ticker ? 'tk:' + a.ticker : 'n:' + a.nombre.toLowerCase(); }
function planCSV(text) {
  const { filas, errores } = FC.parseCSVOperaciones(text);
  const existentes = Store.list('activos'), ops = Store.list('operaciones');
  const buscar = f => existentes.find(a => (f.isin && a.isin === f.isin) || (!f.isin && f.ticker && a.ticker === f.ticker) || a.nombre.toLowerCase() === f.activo.toLowerCase());
  const nuevosActivos = new Map(), nuevasOps = [], duplicadas = [];
  for (const f of filas) {
    let a = buscar(f);
    if (!a) {
      const k = claveActivo({ isin: f.isin, ticker: f.ticker, nombre: f.activo });
      if (!nuevosActivos.has(k)) nuevosActivos.set(k, { id: uid(), nombre: f.activo, tipo: f.tipoActivo, isin: f.isin, ticker: f.ticker, notas: '' });
      a = nuevosActivos.get(k);
    }
    const dup = ops.some(o => o.activoId === a.id && o.tipo === f.operacion && o.fecha === f.fecha && Math.abs(o.participaciones - f.participaciones) < 1e-9 && Math.abs(o.precio - f.precio) < 1e-9);
    if (dup) { duplicadas.push(f.linea); continue; }
    nuevasOps.push({ id: uid(), activoId: a.id, tipo: f.operacion, fecha: f.fecha, participaciones: f.participaciones, precio: f.precio, comisiones: f.comisiones, notas: f.notas, creado: Date.now() + f.linea, _f: f, _a: a });
  }
  // Validación FIFO por activo con las operaciones nuevas
  const fifoErr = [];
  const antes = FC.carteraFIFO(ops, Store.list('traspasosFondos')), despues = FC.carteraFIFO([...ops, ...nuevasOps], Store.list('traspasosFondos'));
  for (const e of FC.erroresNuevos(antes, despues)) {
    const id = e.activoId || Object.keys(despues.porActivo).find(k => despues.porActivo[k].errores.includes(e));
    const nombre = (nuevasOps.find(o => o.activoId === id)?._a || Store.get('activos', id) || { nombre: 'activo' }).nombre;
    fifoErr.push(`${nombre}: ${e.msg}`);
  }
  return { filas, errores, nuevosActivos: [...nuevosActivos.values()], nuevasOps, duplicadas, fifoErr };
}
function renderPlanCSV(p) {
  const ok = p.nuevasOps.length && !p.errores.length && !p.fifoErr.length;
  $('#csvPreview').innerHTML = `
    <p><strong>${p.filas.length}</strong> filas válidas · <strong>${p.nuevasOps.length}</strong> operaciones nuevas · <strong>${p.nuevosActivos.length}</strong> activos nuevos${p.duplicadas.length ? ` · ${p.duplicadas.length} ya existían (se omiten: líneas ${p.duplicadas.join(', ')})` : ''}</p>
    ${p.errores.length ? `<div class="notice warn"><div><strong>Corrige estas líneas y vuelve a cargar el archivo:</strong><ul>${p.errores.map(e => `<li>Línea ${e.linea}: ${esc(e.msg)}</li>`).join('')}</ul></div></div>` : ''}
    ${p.fifoErr.length ? `<div class="notice warn"><div><strong>Ventas sin participaciones suficientes:</strong><ul>${p.fifoErr.map(e => `<li>${esc(e)}</li>`).join('')}</ul></div></div>` : ''}
    ${p.nuevasOps.length ? `<div class="table-wrap" style="max-height:260px"><table class="compact"><thead><tr><th>Línea</th><th>Fecha</th><th>Activo</th><th>Operación</th><th class="num">Part.</th><th class="num">Precio</th><th class="num">Comis.</th></tr></thead><tbody>
      ${p.nuevasOps.map(o => `<tr><td>${o._f.linea}</td><td>${fmtFecha(o.fecha)}</td><td>${esc(o._a.nombre)}${p.nuevosActivos.includes(o._a) ? ' <span class="badge b-ok">nuevo</span>' : ''}</td><td>${o.tipo}</td><td class="num">${fmtPart.format(o.participaciones)}</td><td class="num">${eurP(o.precio)}</td><td class="num">${eur(o.comisiones)}</td></tr>`).join('')}</tbody></table></div>` : ''}`;
  $('#csvImportar').disabled = !ok;
}
$('#csvFile').addEventListener('change', async e => {
  const file = e.target.files[0]; if (!file) return;
  let text = await file.text();
  if (text.includes('\ufffd')) { const buf = await file.arrayBuffer(); text = new TextDecoder('windows-1252').decode(buf); } // Excel en Windows
  CsvImp.plan = planCSV(text); renderPlanCSV(CsvImp.plan);
});
$('#csvImportar').addEventListener('click', async () => {
  const p = CsvImp.plan; if (!p) return;
  await Store.apply([...p.nuevosActivos.map(a => ({ col: 'activos', rec: a })), ...p.nuevasOps.map(({ _f, _a, ...o }) => ({ col: 'operaciones', rec: o }))]);
  $('#csvDialog').close(); toast(`${p.nuevasOps.length} operaciones importadas`);
});
function openCsvDialog() { CsvImp.plan = null; $('#csvFile').value = ''; $('#csvPreview').innerHTML = ''; $('#csvImportar').disabled = true; $('#csvDialog').showModal(); }
function descargarPlantillaCSV() { download('inversiones-plantilla.csv', FC.PLANTILLA_CSV, 'text/csv;charset=utf-8'); }

/* ---------------- Eventos de estas pantallas ---------------- */
$('#addActivoBtn').addEventListener('click', () => openActivoDialog());
$('#addOpBtn').addEventListener('click', () => openOpDialog());
$('#csvBtn').addEventListener('click', openCsvDialog);
$$('[data-plantilla-csv]').forEach(b => b.addEventListener('click', descargarPlantillaCSV));
document.addEventListener('click', async e => {
  const t = e.target.closest('button'); if (!t) return;
  const d = t.dataset;
  if (d.recEdit) openRecDialog(Store.get('recurrentes', d.recEdit));
  if (d.recToggle) {
    const r = Store.get('recurrentes', d.recToggle);
    const upd = { ...r, activo: !r.activo };
    if (!r.activo && r.desde < monthKey(todayISO()) && !confirm('¿Crear también los movimientos de los meses en los que estuvo en pausa?\n\nAceptar: sí, crearlos.\nCancelar: empezar desde este mes.')) upd.desde = monthKey(todayISO());
    await Store.put('recurrentes', upd); toast(upd.activo ? 'Recurrente reanudado' : 'Recurrente en pausa');
  }
  if (d.recDel && confirm('¿Eliminar este movimiento recurrente? Los movimientos ya creados se conservan.')) { await Store.remove('recurrentes', d.recDel); toast('Recurrente eliminado'); }
  if (d.deuCuadro) openCuadro(d.deuCuadro);
  if (d.deuEdit) openDeudaDialog(Store.get('deudas', d.deuEdit));
  if (d.deuDel) {
    const r = Calc.deuda(Store.get('deudas', d.deuDel));
    if (confirm(`¿Eliminar «${r.deuda.nombre}»?${r.pagos.length ? `\n\nLas ${r.pagos.length} cuotas pagadas se conservan como gastos.` : ''}`)) { await Store.deleteDeuda(d.deuDel); toast('Deuda eliminada'); }
  }
  if (d.deuPagar) { await marcarCuotas(d.deuPagar, [Number(d.n)]); if ($('#cuadroDialog').open) openCuadro(d.deuPagar); }
  if (d.deuDespagar) { await desmarcarCuota(d.deuDespagar, Number(d.n)); if ($('#cuadroDialog').open) openCuadro(d.deuDespagar); }
  if (d.deuPagarHasta) { const r = Calc.deuda(Store.get('deudas', d.deuPagarHasta)); await marcarCuotas(d.deuPagarHasta, r.vencidas.map(f => f.n)); }
  if ('verGarantias' in d) showView('garantias');
  if ('ocultarGarantias' in d) { await ocultarGarantias(alertasGarantia().map(g => g.mov.id)); toast('Aviso ocultado'); }
  if (d.garOcultar) { const m = Store.get('movimientos', d.garOcultar); await ocultarGarantias([m.id], !m.garantia.oculta); }
  if (d.actDet) openDetalle(d.actDet);
  if (d.opNueva) openOpDialog(null, d.opNueva);
  if (d.precioNuevo) openPrecioDialog(d.precioNuevo);
  if (d.opEdit) openOpDialog(Store.get('operaciones', d.opEdit));
  if (d.opDel) {
    const op = Store.get('operaciones', d.opDel);
    if (erroresCambioCartera({ ops: Store.list('operaciones').filter(o => o.id !== op.id) }).length) return toast('No se puede borrar: dejaría ventas o traspasos sin participaciones. Borra antes la venta o el traspaso.');
    if (confirm('¿Eliminar esta operación?')) { await Store.remove('operaciones', d.opDel); openDetalle(Det.id); toast('Operación eliminada'); }
  }
  if (d.precioDel && confirm('¿Eliminar este precio?')) { await Store.remove('precios', d.precioDel); openDetalle(Det.id); }
});
$('#detEditar').addEventListener('click', () => openActivoDialog(Store.get('activos', Det.id)));
$('#detOp').addEventListener('click', () => openOpDialog(null, Det.id));
$('#detVenta').addEventListener('click', () => openOpDialog(null, Det.id, 'venta'));
$('#detPrecio').addEventListener('click', () => openPrecioDialog(Det.id));
$('#detTraspaso').addEventListener('click', () => openTfDialog(null, Det.id));
$('#detAsignar').addEventListener('click', () => openAsignarDialog(Det.id));

/* Ajustes de garantías / notificaciones / OCR */
$('#ajAvisoDias').addEventListener('change', async e => { const n = Math.max(1, Math.min(365, Math.round(Number(e.target.value) || 30))); e.target.value = n; await Store.setAjuste('avisoGarantiaDias', n); renderBannerGarantias(); toast('Aviso de garantías: ' + n + ' días antes'); });
$('#ajNotif').addEventListener('change', async e => {
  if (e.target.checked) {
    if (typeof Notification === 'undefined') { e.target.checked = false; return toast('Este navegador no admite notificaciones'); }
    const p = Notification.permission === 'granted' ? 'granted' : await Notification.requestPermission();
    if (p !== 'granted') { e.target.checked = false; await Store.setAjuste('notificaciones', false); renderAjustes(); return toast('No se ha dado permiso para notificaciones'); }
    await Store.setAjuste('notificaciones', true); localStorage.removeItem('finanzas_notif_dia'); notificarGarantias(); toast('Te avisaremos al abrir la app');
  } else { await Store.setAjuste('notificaciones', false); }
});
$('#ocrPrecargar').addEventListener('click', async () => {
  const b = $('#ocrPrecargar'); b.disabled = true; b.textContent = 'Descargando…';
  try {
    const c = document.createElement('canvas'); c.width = 200; c.height = 60; const ctx = c.getContext('2d');
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, 200, 60); ctx.fillStyle = '#000'; ctx.font = '28px sans-serif'; ctx.fillText('TOTAL 1,00', 10, 40);
    const blob = await new Promise(r => c.toBlob(r, 'image/png'));
    await OCR.leer(blob, { onProgress: p => { b.textContent = p.estado; } });
    toast('Lector de texto listo (también sin conexión)'); b.textContent = '✔ Lector descargado';
  } catch (e) { toast(e.message); b.textContent = '⬇️ Descargar el lector ahora'; }
  finally { b.disabled = false; }
});

/* ---------------- Sugerir categoría (Gemini o, sin IA, según tu historial) ---------------- */
$('#mSugerir').addEventListener('click', async () => {
  const f = $('#movForm'), tipo = movTipo(), out = $('#mSugerencia');
  const descripcion = f.descripcion.value.trim();
  out.hidden = false;
  if (!descripcion) { out.textContent = 'Escribe primero una descripción (p. ej. «Mercadona» o «Endesa luz»).'; return; }
  const b = $('#mSugerir'); b.disabled = true; out.textContent = 'Pensando…';
  try {
    const imp = parseImporte(f.importe.value || '');
    const r = await OCR.sugerirCategoria({ tipo, descripcion, importe: isFinite(imp) ? imp : null, cuenta: f.cuenta ? f.cuenta.value : '', categorias: Store.getCategorias(tipo) }, Store.getMovimientos());
    if (!r.categoria) { out.textContent = 'No hay una sugerencia clara.' + (r.proveedor === 'local' ? ' (Sin Gemini, la sugerencia se basa en tus movimientos anteriores parecidos.)' : ''); return; }
    f.categoria.value = r.categoria;
    if (tipo === 'gasto' && r.naturaleza) f.querySelector(`input[name="naturaleza"][value="${r.naturaleza}"]`).checked = true;
    out.innerHTML = `Sugerido: <strong>${esc(r.categoria)}</strong>${tipo === 'gasto' && r.naturaleza ? ' · ' + (r.naturaleza === 'fijo' ? 'fijo' : 'variable') : ''}${r.motivo ? ' — ' + esc(r.motivo) : ''} <span class="muted">(${r.proveedor === 'gemini' ? 'Gemini' : 'según tu historial'})</span>`;
  } catch (e) { out.textContent = e.message; }
  finally { b.disabled = false; }
});
$('#movDialog').addEventListener('close', () => { $('#mSugerencia').hidden = true; $('#mSugerencia').textContent = ''; });

/* ---------------- Ajustes: lector OCR (Tesseract / Gemini) ---------------- */
function renderAjustesOCR() {
  const G = window.OCRGemini, pref = OCR.preferido;
  $('#ocrPrefTess').checked = pref !== 'gemini'; $('#ocrPrefGem').checked = pref === 'gemini';
  $('#ocrTessInfo').hidden = pref === 'gemini'; $('#ocrGemInfo').hidden = pref !== 'gemini';
  const sel = $('#gemModelo');
  if (!sel.options.length) sel.innerHTML = Object.entries(G.MODELOS).map(([k, v]) => `<option value="${k}">${esc(v)}</option>`).join('');
  sel.value = G.modelo;
  const k = G.clave;
  $('#gemKey').value = ''; $('#gemKey').placeholder = k ? 'Clave guardada: …' + k.slice(-4) + ' (escribe otra para cambiarla)' : 'AIza…';
  $('#gemBorrar').hidden = !k; $('#gemProbar').disabled = !k;
  const est = $('#gemEstado');
  if (!est.dataset.fijo) est.innerHTML = pref === 'gemini' ? (k ? '✔ Gemini configurado. Se usará al leer documentos.' : '<span class="warn-txt">Falta la clave: mientras tanto se usa el lector del navegador.</span>') : '';
  $('#ocrProveedor').textContent = OCR.proveedor ? OCR.proveedor.nombre : '—';
}
document.querySelectorAll('input[name="ocrPref"]').forEach(r => r.addEventListener('change', e => { OCR.preferido = e.target.value; delete $('#gemEstado').dataset.fijo; renderAjustesOCR(); }));
$('#gemModelo').addEventListener('change', e => { window.OCRGemini.modelo = e.target.value; toast('Modelo de Gemini: ' + e.target.selectedOptions[0].textContent); });
$('#gemGuardar').addEventListener('click', () => {
  const v = $('#gemKey').value.trim();
  if (!v) return toast('Pega la clave en el campo');
  if (!/^[A-Za-z0-9_\-]{20,}$/.test(v)) return toast('Esa clave no parece válida');
  window.OCRGemini.clave = v; delete $('#gemEstado').dataset.fijo; renderAjustesOCR(); toast('Clave guardada solo en este dispositivo');
});
$('#gemBorrar').addEventListener('click', () => { if (!confirm('¿Quitar la clave de Gemini de este dispositivo?')) return; window.OCRGemini.clave = ''; delete $('#gemEstado').dataset.fijo; renderAjustesOCR(); toast('Clave eliminada'); });
$('#gemProbar').addEventListener('click', async () => {
  const b = $('#gemProbar'), est = $('#gemEstado'); b.disabled = true; est.dataset.fijo = '1'; est.textContent = 'Probando…';
  try { await window.OCRGemini.probar(); est.innerHTML = '<span class="pos">✔ La clave funciona.</span>'; }
  catch (e) { est.innerHTML = `<span class="neg">${esc(e.message)}</span>`; }
  finally { b.disabled = false; }
});
