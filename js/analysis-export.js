/* =========================================================
   «Copia para análisis» (OPCIONAL, desactivada por defecto)
   Escribe en una carpeta VISIBLE del Google Drive del usuario
   («Finanzas App - Análisis») una copia legible de sus datos:
     - finanzas-analisis.json  (movimientos, deudas con cuadro, inversiones
                                con resultados FIFO, garantías, resúmenes)
     - movimientos.csv         (coma, punto decimal, fechas ISO)
   Permiso: drive.file (solo archivos creados por la app), pedido de forma
   incremental únicamente cuando el usuario activa la opción.
   Frecuencia: tras sincronizar, como mucho 1 vez por hora; o a demanda.
   La parte de construcción (AnalisisCore) no usa el DOM: se prueba en Node.
   ========================================================= */
(function (root) {
  'use strict';
  const FC = root.FinanceCore || (typeof require === 'function' ? require('./finance-core.js') : null);
  const r2 = n => Math.round((Number(n) || 0) * 100) / 100;
  const vivos = l => (l || []).filter(x => x && !x.deleted);
  const ym = f => String(f || '').slice(0, 7);

  /** Construye el contenido de la copia (objeto JSON + CSV) a partir del estado de la app. */
  function construir(estado, { hoy, ahora = new Date().toISOString(), diasAviso = 30, version = '' } = {}) {
    const movs = vivos(estado.movimientos).slice().sort((a, b) => a.fecha.localeCompare(b.fecha) || String(a.id).localeCompare(String(b.id)));
    const deudasArr = vivos(estado.deudas), activos = vivos(estado.activos), ops = vivos(estado.operaciones), precios = vivos(estado.precios);
    const adj = vivos(estado.adjuntos);
    const nAdj = id => adj.filter(a => a.ownerId === id).length;

    const movimientos = movs.map(m => {
      const o = { id: m.id, fecha: m.fecha, tipo: m.tipo, importe: r2(m.importe), categoria: m.categoria, descripcion: m.descripcion || '', cuenta: m.cuenta || '' };
      if (m.tipo === 'gasto') o.naturaleza = m.naturaleza || 'variable'; else o.tipoIngreso = m.tipoIngreso || 'otro';
      if (m.recurrenteId) o.recurrenteId = m.recurrenteId;
      if (m.deudaId) { o.deudaId = m.deudaId; o.cuotaN = m.cuotaN; if (m.desglose) o.desgloseCuota = m.desglose; }
      if (m.financiadoPor) o.financiadoPor = m.financiadoPor;
      if (m.garantia) o.garantia = { producto: m.garantia.producto || '', anios: m.garantia.anios };
      const n = nAdj(m.id); if (n) o.adjuntos = n;
      return o;
    });

    // Resumen mensual (las compras financiadas no cuentan como gasto: cuentan sus cuotas)
    const meses = {};
    for (const m of movs) {
      const k = ym(m.fecha), r = meses[k] || (meses[k] = { mes: k, ingresos: 0, gastos: 0, gastosFijos: 0, gastosVariables: 0, nomina: 0, ingresosExtra: 0, otrosIngresos: 0, cuotasDeuda: 0, interesesDeuda: 0, compraFinanciada: 0 });
      if (m.tipo === 'ingreso') { r.ingresos += m.importe; if (m.tipoIngreso === 'nomina') r.nomina += m.importe; else if (m.tipoIngreso === 'extra') r.ingresosExtra += m.importe; else r.otrosIngresos += m.importe; }
      else if (m.financiadoPor) r.compraFinanciada += m.importe;
      else { r.gastos += m.importe; if (m.naturaleza === 'fijo') r.gastosFijos += m.importe; else r.gastosVariables += m.importe; if (m.deudaId) { r.cuotasDeuda += m.importe; r.interesesDeuda += (m.desglose && m.desglose.interes) || 0; } }
    }
    const resumenMensual = Object.values(meses).sort((a, b) => a.mes.localeCompare(b.mes)).map(r => {
      for (const k of Object.keys(r)) if (k !== 'mes') r[k] = r2(r[k]);
      r.ahorro = r2(r.ingresos - r.gastos); r.tasaAhorro = r.ingresos > 0 ? Math.round((r.ahorro / r.ingresos) * 10000) / 10000 : null;
      return r;
    });
    const gastosPorCategoria = {};
    for (const m of movs) if (m.tipo === 'gasto' && !m.financiadoPor) { const k = ym(m.fecha); (gastosPorCategoria[k] || (gastosPorCategoria[k] = {}))[m.categoria] = r2(((gastosPorCategoria[k] || {})[m.categoria] || 0) + m.importe); }

    const deudas = deudasArr.map(d => {
      const pagadas = movs.filter(m => m.deudaId === d.id && m.cuotaN).map(m => m.cuotaN);
      const s = FC.resumenDeuda(d, pagadas, hoy);
      return {
        id: d.id, nombre: d.nombre, medio: d.medio, principal: r2(d.principal), tinPct: Number(d.tin) || 0, plazoMeses: d.plazo, fechaPrimeraCuota: d.fechaPrimeraCuota, diaCobro: FC.normalizarDiaCobro(d.diaCobro, d.fechaPrimeraCuota), categoria: d.categoria || '',
        comisionApertura: r2(d.comisionApertura), comisionMensual: r2(d.comisionMensual), taeIntroducidaPct: s.taeIntroducida === null ? null : r2(s.taeIntroducida * 100),
        taeCalculadaPct: isFinite(s.tae) ? Math.round(s.tae * 10000) / 100 : null, cuota: r2(s.cuota), totalIntereses: r2(s.totalIntereses), totalCoste: r2(s.totalCoste), totalPagado: r2(s.totalPagado),
        cuotasPagadas: s.pagadas, cuotasRestantes: s.restantes, capitalPendiente: s.pendiente, interesesPendientes: s.interesesPendientes, interesesPagados: s.interesesPagados,
        cuotasVencidasSinMarcar: s.vencidas.length, terminada: s.terminada, movimientoCompraId: d.movimientoId || null,
        cuadro: s.filas.map(f => ({ n: f.n, fecha: f.fecha, cuota: r2(f.pago), interes: r2(f.interes), amortizacion: r2(f.amortizacion), comision: r2(f.comision), pendiente: r2(f.pendiente), pagada: pagadas.includes(f.n) }))
      };
    });

    const activosOut = activos.map(a => {
      const o = ops.filter(x => x.activoId === a.id), p = precios.filter(x => x.activoId === a.id);
      const m = FC.metricasActivo(o, p);
      return {
        id: a.id, nombre: a.nombre, tipo: a.tipo, isin: a.isin || '', ticker: a.ticker || '',
        participaciones: m.participaciones, costeMedio: Math.round(m.costeMedio * 10000) / 10000, costeRestante: m.costeRestante, aportadoNeto: m.aportadoNeto,
        precio: m.precio, fechaPrecio: m.fechaPrecio, precioDeUltimaOperacion: m.precioDeOperacion, valor: m.valor, gananciaNoRealizada: m.noRealizada,
        gananciaNoRealizadaPct: m.noRealizadaPct === null ? null : Math.round(m.noRealizadaPct * 10000) / 100,
        gananciaRealizada: m.gananciaRealizada, realizadaPorAnio: m.realizadaPorAnio,
        lotesVivos: m.lotes.map(l => ({ compraId: l.opId, fecha: l.fecha, participaciones: l.participaciones, iniciales: l.iniciales, coste: l.coste, costeUnitario: Math.round(l.costeUnitario * 10000) / 10000 })),
        ventas: m.ventas.map(v => ({ ventaId: v.opId, fecha: v.fecha, participaciones: v.participaciones, precio: v.precio, comisiones: v.comisiones, importeNeto: v.importeNeto, costeFIFO: v.coste, ganancia: v.ganancia, lotesConsumidos: v.consumos.map(c => ({ compraId: c.compraId, fechaCompra: c.fecha, participaciones: c.participaciones, coste: c.coste })) })),
        operaciones: FC.ordenarOperaciones(o).map(x => ({ id: x.id, fecha: x.fecha, tipo: x.tipo, participaciones: Number(x.participaciones), precio: Number(x.precio), comisiones: Number(x.comisiones) || 0, notas: x.notas || '' })),
        historialPrecios: p.slice().sort((a2, b) => a2.fecha.localeCompare(b.fecha)).map(x => ({ fecha: x.fecha, precio: x.precio })),
        errores: m.errores
      };
    });
    const tot = activosOut.reduce((t, a) => { t.aportadoNeto += a.aportadoNeto; t.costeRestante += a.costeRestante; t.valor += a.valor; t.gananciaNoRealizada += a.gananciaNoRealizada; t.gananciaRealizada += a.gananciaRealizada; for (const [y, v] of Object.entries(a.realizadaPorAnio)) t.realizadaPorAnio[y] = r2((t.realizadaPorAnio[y] || 0) + v); return t; }, { aportadoNeto: 0, costeRestante: 0, valor: 0, gananciaNoRealizada: 0, gananciaRealizada: 0, realizadaPorAnio: {} });
    for (const k of ['aportadoNeto', 'costeRestante', 'valor', 'gananciaNoRealizada', 'gananciaRealizada']) tot[k] = r2(tot[k]);

    const garantias = movs.filter(m => m.tipo === 'gasto' && m.garantia).map(m => {
      const vence = FC.vencimientoGarantia(m.fecha, m.garantia.anios), e = FC.estadoGarantia(vence, hoy, diasAviso);
      return { movimientoId: m.id, producto: m.garantia.producto || m.descripcion, fechaCompra: m.fecha, importe: r2(m.importe), anios: m.garantia.anios, vence, diasRestantes: e.dias, estado: e.estado };
    }).sort((a, b) => a.vence.localeCompare(b.vence));

    const recurrentes = vivos(estado.recurrentes).map(r => ({ id: r.id, tipo: r.tipo, descripcion: r.descripcion, categoria: r.categoria, importe: r2(r.importe), dia: r.dia, desde: r.desde, hasta: r.hasta || '', activo: r.activo !== false, naturaleza: r.naturaleza, tipoIngreso: r.tipoIngreso }));

    const json = {
      app: 'Finanzas App', formato: 'finanzas-analisis', version: 1, appVersion: version, generadoEn: ahora, fechaReferencia: hoy, moneda: 'EUR',
      leeme: 'Copia de solo lectura generada por la app para que el usuario o su asistente puedan analizar sus finanzas. Se sobrescribe en cada actualización: los cambios hechos aquí se pierden. Importes en euros (punto decimal). Gastos en positivo. Las compras financiadas (financiadoPor) no cuentan como gasto del mes: cuentan sus cuotas (movimientos con deudaId). Ganancias de inversiones calculadas por FIFO (método obligatorio en España para valores homogéneos); precios introducidos a mano por el usuario.',
      categorias: estado.categorias ? { gasto: estado.categorias.gasto || [], ingreso: estado.categorias.ingreso || [] } : null,
      totales: { movimientos: movimientos.length, deudasActivas: deudas.filter(d => !d.terminada).length, capitalPendienteDeudas: r2(deudas.reduce((s, d) => s + d.capitalPendiente, 0)), cartera: tot, garantiasProximas: garantias.filter(g => g.estado === 'proxima').length, garantiasCaducadas: garantias.filter(g => g.estado === 'caducada').length },
      resumenMensual, gastosPorCategoria, movimientos, recurrentes, deudas,
      inversiones: { metodo: 'FIFO', activos: activosOut, totales: tot },
      garantias
    };

    const q = v => { const s = String(v ?? ''); return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
    const cols = ['id', 'fecha', 'tipo', 'importe', 'importe_con_signo', 'categoria', 'descripcion', 'cuenta', 'naturaleza', 'tipo_ingreso', 'recurrente_id', 'deuda_id', 'cuota_n', 'interes_cuota', 'financiado_por', 'garantia_producto', 'garantia_anios'];
    const filas = movimientos.map(m => [m.id, m.fecha, m.tipo, m.importe.toFixed(2), (m.tipo === 'gasto' ? -m.importe : m.importe).toFixed(2), m.categoria, m.descripcion, m.cuenta, m.naturaleza || '', m.tipoIngreso || '', m.recurrenteId || '', m.deudaId || '', m.cuotaN || '', m.desgloseCuota ? r2(m.desgloseCuota.interes).toFixed(2) : '', m.financiadoPor || '', m.garantia ? m.garantia.producto : '', m.garantia ? m.garantia.anios : ''].map(q).join(','));
    const csv = '\ufeff' + [cols.join(','), ...filas].join('\r\n') + '\r\n';
    return { json, csv };
  }
  /** Huella del contenido (sin la fecha de generación) para no subir si nada cambió. */
  function huella({ json, csv }) {
    const s = JSON.stringify({ ...json, generadoEn: null }) + csv;
    let h1 = 0x811c9dc5, h2 = 0x01000193;
    for (let i = 0; i < s.length; i++) { const c = s.charCodeAt(i); h1 = Math.imul(h1 ^ c, 16777619); h2 = Math.imul(h2 ^ c, 2246822519); }
    return (h1 >>> 0).toString(16) + (h2 >>> 0).toString(16) + ':' + s.length;
  }
  const AnalisisCore = { construir, huella, ARCHIVO_JSON: 'finanzas-analisis.json', ARCHIVO_CSV: 'movimientos.csv' };
  root.AnalisisCore = AnalisisCore;
  if (typeof module !== 'undefined' && module.exports) module.exports = AnalisisCore;
  if (typeof document === 'undefined') return;

  /* ------------------------- Parte de la app (DOM) ------------------------- */
  const CFG = root.FINANZAS_CONFIG || {};
  const SCOPE = CFG.ANALISIS_SCOPE || 'https://www.googleapis.com/auth/drive.file';
  const CARPETA = CFG.ANALISIS_CARPETA || 'Finanzas App - Análisis';
  const INTERVALO = CFG.ANALISIS_INTERVALO_MS || 3600000;
  const ACT_KEY = 'finanzas_analisis_activo', ST_KEY = 'finanzas_analisis';
  const $ = s => document.querySelector(s);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const qs = s => s.replace(/\\/g, '\\\\').replace(/'/g, "\\'");

  const Analisis = {
    SCOPE, CARPETA, INTERVALO, ocupado: false, error: '',
    get activo() { return localStorage.getItem(ACT_KEY) === '1'; },
    set activo(v) { if (v) localStorage.setItem(ACT_KEY, '1'); else localStorage.removeItem(ACT_KEY); },
    get st() { try { return JSON.parse(localStorage.getItem(ST_KEY)) || {}; } catch { return {}; } },
    set st(v) { localStorage.setItem(ST_KEY, JSON.stringify(v)); },
    get client() { return root.FinanzasApp && root.FinanzasApp.Sync.client; },
    get posible() { return !!(root.Auth && Auth.enabled && Auth.user && this.client); },

    /** Llamado tras cada sincronización correcta: actualiza si toca (máx. 1/hora). */
    programar() {
      if (!this.activo || !this.posible || this.ocupado || !navigator.onLine) return;
      if (!Auth.tieneScope(SCOPE)) return;                     // sin el permiso, solo a demanda (necesita un clic)
      if (Date.now() - (this.st.ultimoIntento || 0) < INTERVALO) return;
      this.actualizar({ manual: false });
    },

    async actualizar({ manual = true } = {}) {
      if (!this.posible) { if (manual) toastA('Inicia sesión con Google para usar la copia para análisis'); return false; }
      if (this.ocupado) return false;
      this.ocupado = true; this.error = ''; this.render();
      try {
        if (!Auth.tieneScope(SCOPE)) {
          if (!manual) return false;
          await Auth.pedirScope(SCOPE);
        }
        const App = root.FinanzasApp, S = App.Store.state;
        const hoy = App.todayISO ? App.todayISO() : new Date().toISOString().slice(0, 10);
        const datos = construir(S, { hoy, diasAviso: S.ajustes && S.ajustes.avisoGarantiaDias || 30, version: CFG.APP_VERSION || '' });
        const h = huella(datos);
        let st = { ...this.st, ultimoIntento: Date.now() };
        this.st = st;
        if (!manual && st.huella === h && st.jsonId && st.csvId) return true;   // nada nuevo
        const c = this.client;
        const folderId = await this._carpeta(c, st);
        st.folderId = folderId;
        st.jsonId = await this._escribir(c, folderId, st.jsonId, AnalisisCore.ARCHIVO_JSON, 'application/json', JSON.stringify(datos.json, null, 2), 'Copia de Finanzas App para análisis (se sobrescribe).');
        st.csvId = await this._escribir(c, folderId, st.csvId, AnalisisCore.ARCHIVO_CSV, 'text/csv', datos.csv, 'Movimientos de Finanzas App (se sobrescribe).');
        st.huella = h; st.ultima = Date.now(); st.n = datos.json.movimientos.length;
        this.st = st;
        if (manual) toastA('Copia para análisis actualizada en tu Google Drive');
        return true;
      } catch (e) {
        this.error = e.code === 'auth' || e.status === 401 ? 'La sesión de Google ha caducado: pulsa «Actualizar copia ahora».' : (e.status === 403 ? 'Google no ha dado permiso para escribir la copia. Desactiva y vuelve a activar la opción.' : e.message);
        if (manual) toastA('No se pudo actualizar la copia: ' + this.error);
        return false;
      } finally { this.ocupado = false; this.render(); }
    },
    async _carpeta(c, st) {
      if (st.folderId) {
        try { const m = await c.getMeta(st.folderId); if (m && !m.trashed) return st.folderId; } catch (e) { if (e.status !== 404) throw e; }
        st.jsonId = st.csvId = null;
      }
      const l = await c.query(`name='${qs(CARPETA)}' and mimeType='application/vnd.google-apps.folder' and trashed=false`);
      if (l.length) return l[0].id;
      const f = await c.createFolder(CARPETA, 'Copia legible de Finanzas App para análisis. La crea y actualiza la app (permiso drive.file).');
      return f.id;
    },
    async _escribir(c, folderId, id, nombre, mime, texto, desc) {
      if (id) {
        try { await c.updateText(id, mime, texto); return id; } catch (e) { if (e.status !== 404) throw e; }
      }
      const l = await c.query(`name='${qs(nombre)}' and '${qs(folderId)}' in parents and trashed=false`);
      if (l.length) { await c.updateText(l[0].id, mime, texto); return l[0].id; }
      const f = await c.createText(nombre, folderId, mime, texto, desc);
      return f.id;
    },
    async activar() {
      if (!this.posible) { toastA(root.Auth && Auth.enabled ? 'Primero inicia sesión con Google (arriba a la derecha).' : 'La copia para análisis necesita configurar Google Drive (ver SETUP.md).'); this.render(); return; }
      try { await Auth.pedirScope(SCOPE); }
      catch (e) { this.activo = false; this.render(); toastA(e.message); return; }
      this.activo = true; this.render();
      await this.actualizar({ manual: true });
    },
    desactivar() {
      this.activo = false; Auth.quitarScope(SCOPE); this.render();
      toastA('Copia para análisis desactivada. Los archivos que ya hay en Drive no se tocan.');
    },
    async borrar() {
      const st = this.st;
      if (!st.folderId) return;
      if (!confirm(`¿Borrar de tu Google Drive la carpeta «${CARPETA}» y su contenido, y desactivar la copia? Tus datos de la app no se ven afectados.`)) return;
      try {
        if (!Auth.tieneScope(SCOPE)) await Auth.pedirScope(SCOPE);
        await this.client.remove(st.folderId).catch(e => { if (e.status !== 404) throw e; });
        localStorage.removeItem(ST_KEY); this.activo = false; this.error = ''; toastA('Copia borrada de Google Drive y desactivada');
      } catch (e) { toastA('No se pudo borrar: ' + e.message); }
      if (!this.activo) Auth.quitarScope(SCOPE);
      this.render();
    },
    render() {
      const card = $('#analisisCard'); if (!card) return;
      const st = this.st, act = this.activo, pos = this.posible;
      $('#anActivo').checked = act; $('#anActivo').disabled = this.ocupado;
      $('#anAhora').disabled = !act || !pos || this.ocupado;
      $('#anAhora').textContent = this.ocupado ? '⏳ Actualizando…' : '🔄 Actualizar copia ahora';
      const a = $('#anCarpeta'); a.hidden = !st.folderId; if (st.folderId) a.href = 'https://drive.google.com/drive/folders/' + encodeURIComponent(st.folderId);
      $('#anBorrar').hidden = !st.folderId || this.ocupado;
      const fmt = t => new Date(t).toLocaleString('es-ES', { dateStyle: 'short', timeStyle: 'short' });
      let txt = '';
      if (!(root.Auth && Auth.enabled)) txt = 'Disponible cuando la app esté conectada a Google Drive (ver SETUP.md).';
      else if (!Auth.user) txt = 'Inicia sesión con Google para poder activarla.';
      else if (act) txt = st.ultima ? `Última actualización: ${fmt(st.ultima)} · ${st.n ?? 0} movimientos.` : 'Activada: aún no se ha escrito ninguna copia.';
      else txt = 'Desactivada.' + (st.folderId ? ' La última copia sigue en tu Drive.' : '');
      if (act && pos && !Auth.tieneScope(SCOPE)) txt += ' Falta renovar el permiso: pulsa «Actualizar copia ahora».';
      $('#anEstado').innerHTML = esc(txt) + (this.error ? ` <span class="neg">${esc(this.error)}</span>` : '');
    }
  };
  function toastA(m) { if (typeof root.toast === 'function') root.toast(m); else console.info(m); }
  $('#anActivo').addEventListener('change', e => { if (e.target.checked) Analisis.activar(); else Analisis.desactivar(); });
  $('#anAhora').addEventListener('click', () => Analisis.actualizar({ manual: true }));
  $('#anBorrar').addEventListener('click', () => Analisis.borrar());
  if (root.Auth) Auth.onChange(() => Analisis.render());
  root.Analisis = Analisis;
})(typeof self !== 'undefined' ? self : globalThis);
