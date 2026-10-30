/* =========================================================
   Utilidades de formato (es-ES, EUR)
   ========================================================= */
const LOCALE = 'es-ES';
const fmtEUR = new Intl.NumberFormat(LOCALE, { style: 'currency', currency: 'EUR', useGrouping: 'always' });
const fmtPct = new Intl.NumberFormat(LOCALE, { style: 'percent', minimumFractionDigits: 1, maximumFractionDigits: 1, useGrouping: 'always' });
const fmtNum = new Intl.NumberFormat(LOCALE, { minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: 'always' });
const eur = n => fmtEUR.format(n || 0);
const pct = n => (n === null || !isFinite(n)) ? '—' : fmtPct.format(n);
const round2 = n => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

function parseImporte(str) {
  if (typeof str === 'number') return str;
  let s = String(str || '').trim().replace(/\s|€/g, '');
  if (!s) return NaN;
  if (s.includes(',') && s.includes('.')) s = s.replace(/\./g, '').replace(',', '.'); // 1.234,56
  else if (s.includes(',')) s = s.replace(',', '.');                                     // 12,5
  else if (/^-?\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, '');                   // 1.500 = mil quinientos
  return Number(s);
}
const pad = n => String(n).padStart(2, '0');
const todayISO = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const monthKey = iso => iso.slice(0, 7);
function fmtFecha(iso) { if (!iso) return ''; const [y, m, d] = iso.split('-'); return `${d}/${m}/${y}`; }
function monthLabel(ym, short = false) {
  const [y, m] = ym.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString(LOCALE, short ? { month: 'short', year: '2-digit' } : { month: 'long', year: 'numeric' });
}
function addMonths(ym, delta) {
  const [y, m] = ym.split('-').map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
}
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const $ = s => document.querySelector(s);
const $$ = s => Array.from(document.querySelectorAll(s));
function toast(msg) { const t = $('#toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.remove('show'), 2200); }

/* =========================================================
   Capa de datos (Store)
   - Toda la interfaz habla solo con `Store`.
   - `Store.adapter` es intercambiable (misma interfaz load/save/clear):
       · LocalStorageAdapter  -> modo local (solo este navegador)
       · DriveAdapter         -> Google Drive del usuario + caché local
     (ver js/storage.js; para otro backend basta con otro adapter).
   - Esquema v3: varias colecciones de registros; cada registro lleva
     updatedAt (ms) y los borrados se guardan como lápidas
     {id, deleted:true, updatedAt} para poder sincronizar.
   ========================================================= */
const FC = window.FinanceCore;
const LEGACY_KEY = 'finanzas_v1';          // datos de la v1 (se migran automáticamente)
const SCHEMA_VERSION = 3;
const COLECCIONES = SyncCore.COLLECTIONS;  // movimientos, inversiones (v2, solo lápidas), recurrentes, deudas, adjuntos, activos, operaciones, precios
const TIPOS_ACTIVO = { fondo: 'Fondo', etf: 'ETF', accion: 'Acción', cripto: 'Cripto', deposito: 'Depósito', otro: 'Otro' };
const MEDIOS_FIN = { tarjeta: 'Tarjeta de crédito', tienda: 'Financiación de tienda', prestamo: 'Préstamo', otro: 'Otro' };
const TIPOS_INGRESO = { nomina: 'Nómina', extra: 'Extra', otro: 'Otro' };
const CATS_FIJAS = ['Vivienda', 'Suministros', 'Telefonía e internet', 'Seguros', 'Suscripciones'];
const DEFAULT_CATEGORIAS = {
  gasto: ['Vivienda', 'Supermercado', 'Restaurantes', 'Transporte', 'Combustible', 'Suministros', 'Telefonía e internet', 'Salud', 'Ocio', 'Ropa', 'Electrónica', 'Hogar', 'Educación', 'Suscripciones', 'Viajes', 'Seguros', 'Impuestos', 'Regalos', 'Mascotas', 'Deudas', 'Otros'],
  ingreso: ['Nómina', 'Freelance', 'Intereses', 'Dividendos', 'Alquiler', 'Reembolsos', 'Regalos', 'Otros']
};
const AJUSTES_DEFECTO = { tema: 'auto', avisoGarantiaDias: 30, notificaciones: false };
const nowTs = () => Date.now();
const emptyState = () => {
  const s = { version: SCHEMA_VERSION };
  for (const c of COLECCIONES) s[c] = [];
  s.categorias = { ...JSON.parse(JSON.stringify(DEFAULT_CATEGORIAS)), updatedAt: 0 };
  s.ajustes = { ...AJUSTES_DEFECTO };   // preferencias del dispositivo (no se sincronizan)
  return s;
};
const tombstone = (id, t = nowTs(), extra = {}) => ({ id, deleted: true, updatedAt: t, ...extra });
const num = (v, d = 0) => { const n = Number(v); return isFinite(n) ? n : d; };
const txt = v => String(v ?? '').trim();
const naturalezaPorDefecto = cat => CATS_FIJAS.includes(cat) ? 'fijo' : 'variable';
const tipoIngresoPorDefecto = cat => cat === 'Nómina' ? 'nomina' : (cat === 'Freelance' ? 'extra' : 'otro');

/* ---------- Normalización de cada tipo de registro (también migra datos antiguos) ---------- */
const NORMALIZAR = {
  movimientos(m) {
    if (!m.fecha || !isFinite(Number(m.importe))) return null;
    const mov = { id: m.id || uid(), tipo: m.tipo === 'ingreso' ? 'ingreso' : 'gasto', fecha: String(m.fecha).slice(0, 10),
      importe: round2(Math.abs(Number(m.importe))), categoria: m.categoria || 'Otros', descripcion: m.descripcion || '', cuenta: m.cuenta || '' };
    if (mov.tipo === 'gasto') {
      mov.naturaleza = m.naturaleza === 'fijo' || m.naturaleza === 'variable' ? m.naturaleza : naturalezaPorDefecto(mov.categoria);
      if (m.deudaId) {   // pago de una cuota de una deuda
        mov.deudaId = String(m.deudaId); mov.cuotaN = Number.isInteger(Number(m.cuotaN)) && Number(m.cuotaN) > 0 ? Number(m.cuotaN) : null;
        const d = m.desglose || {};
        mov.desglose = { interes: round2(num(d.interes)), amortizacion: round2(num(d.amortizacion)), comision: round2(num(d.comision)) };
      }
      if (m.financiadoPor) mov.financiadoPor = String(m.financiadoPor);   // compra financiada (no cuenta como gasto del mes)
      if (m.garantia && num(m.garantia.anios) > 0) mov.garantia = { anios: num(m.garantia.anios), producto: txt(m.garantia.producto), oculta: !!m.garantia.oculta };
    } else {
      mov.tipoIngreso = TIPOS_INGRESO[m.tipoIngreso] ? m.tipoIngreso : tipoIngresoPorDefecto(mov.categoria);
    }
    if (m.recurrenteId) mov.recurrenteId = String(m.recurrenteId);
    if (mov.tipo === 'gasto' && m.repostajeId) mov.repostajeId = String(m.repostajeId);   // gasto de un repostaje (v3.3)
    return mov;
  },
  inversiones(i) { return i.nombre ? { ...i } : null; }, // v2: se migra justo después
  recurrentes(r) {
    if (!/^\d{4}-\d{2}$/.test(r.desde || '') || !(num(r.importe) > 0)) return null;
    const o = { id: r.id || uid(), tipo: r.tipo === 'ingreso' ? 'ingreso' : 'gasto', importe: round2(num(r.importe)), categoria: r.categoria || 'Otros',
      descripcion: r.descripcion || '', cuenta: r.cuenta || '', dia: r.dia === FC.DIA_ULTIMO ? FC.DIA_ULTIMO : Math.min(31, Math.max(1, Math.round(num(r.dia, 1)))), desde: r.desde,
      hasta: /^\d{4}-\d{2}$/.test(r.hasta || '') ? r.hasta : '', activo: r.activo !== false };
    if (o.tipo === 'gasto') o.naturaleza = r.naturaleza === 'variable' ? 'variable' : 'fijo'; else o.tipoIngreso = TIPOS_INGRESO[r.tipoIngreso] ? r.tipoIngreso : 'nomina';
    return o;
  },
  deudas(d) {
    if (!(num(d.principal) > 0) || !(num(d.plazo) >= 1) || !FC.isISO(d.fechaPrimeraCuota)) return null;
    return { id: d.id || uid(), nombre: d.nombre || 'Deuda', medio: MEDIOS_FIN[d.medio] ? d.medio : 'otro', principal: round2(num(d.principal)),
      tin: num(d.tin), plazo: Math.round(num(d.plazo)), fechaInicio: FC.isISO(d.fechaInicio) ? d.fechaInicio : d.fechaPrimeraCuota, fechaPrimeraCuota: d.fechaPrimeraCuota,
      diaCobro: FC.normalizarDiaCobro(d.diaCobro, d.fechaPrimeraCuota),   // migración: sin dato = día de la 1.ª cuota (mismas fechas)
      comisionApertura: round2(num(d.comisionApertura)), comisionMensual: round2(num(d.comisionMensual)),
      taeIntroducida: d.taeIntroducida === null || d.taeIntroducida === '' || d.taeIntroducida === undefined || !isFinite(Number(d.taeIntroducida)) ? null : Number(d.taeIntroducida),
      movimientoId: d.movimientoId || null, categoria: d.categoria || 'Deudas', cuenta: d.cuenta || '', notas: d.notas || '' };
  },
  adjuntos(a) {
    if (!a.ownerId) return null;
    return { id: a.id, ownerType: a.ownerType === 'activo' ? 'activo' : 'movimiento', ownerId: a.ownerId, nombre: a.nombre || 'archivo', mime: a.mime || '',
      size: num(a.size), hash: a.hash || '', mini: a.mini || null, driveId: a.driveId || null, creado: num(a.creado), ocr: a.ocr || null };
  },
  activos(a) {
    if (!txt(a.nombre)) return null;
    return { id: a.id || uid(), nombre: txt(a.nombre), tipo: TIPOS_ACTIVO[a.tipo] ? a.tipo : 'otro', isin: txt(a.isin).toUpperCase(), ticker: txt(a.ticker).toUpperCase(), notas: a.notas || '' };
  },
  operaciones(o) {
    if (!o.activoId || !FC.isISO(o.fecha) || !(num(o.participaciones) > 0)) return null;
    return { id: o.id || uid(), activoId: o.activoId, tipo: o.tipo === 'venta' ? 'venta' : 'compra', fecha: o.fecha, participaciones: num(o.participaciones),
      precio: num(o.precio), comisiones: round2(num(o.comisiones)), notas: o.notas || '', creado: num(o.creado) };
  },
  precios(p) {
    if (!p.activoId || !FC.isISO(p.fecha) || !(num(p.precio) >= 0)) return null;
    return { id: p.id || uid(), activoId: p.activoId, fecha: p.fecha, precio: num(p.precio) };
  },
  // v3.3: vehículos y repostajes (combustible)
  vehiculos(v) {
    const matricula = FuelCore.normalizarMatricula(v.matricula);
    if (!matricula) return null;
    const kmI = v.kmIniciales === null || v.kmIniciales === undefined || v.kmIniciales === '' ? null : num(v.kmIniciales, -1);
    return { id: v.id || uid(), matricula, nombre: txt(v.nombre), combustible: FuelCore.COMBUSTIBLES[v.combustible] ? v.combustible : 'gasoil',
      capacidad: num(v.capacidad) > 0 ? round2(num(v.capacidad)) : null, kmIniciales: kmI !== null && kmI >= 0 ? Math.round(kmI) : null,
      activo: v.activo !== false, notas: txt(v.notas), creado: num(v.creado) };
  },
  repostajes(r) {
    if (!r.vehiculoId || !FC.isISO(r.fecha) || !(num(r.litros) > 0)) return null;
    const litros = Math.round(num(r.litros) * 100) / 100;
    let precioLitro = num(r.precioLitro), importe = num(r.importe);
    if (!(importe > 0) && precioLitro > 0) importe = precioLitro * litros;
    if (!(precioLitro > 0) && importe > 0) precioLitro = importe / litros;
    if (!(importe > 0)) return null;
    const opt = (x, f) => num(x) > 0 ? f(num(x)) : null;
    return { id: r.id || uid(), vehiculoId: String(r.vehiculoId), movimientoId: r.movimientoId ? String(r.movimientoId) : null, fecha: r.fecha,
      litros, precioLitro: Math.round(precioLitro * 1000) / 1000, importe: round2(importe),
      kmTanqueAnterior: opt(r.kmTanqueAnterior, n => Math.round(n * 10) / 10), odometro: opt(r.odometro, Math.round),
      lleno: r.lleno !== false, gasolinera: txt(r.gasolinera), creado: num(r.creado) };
  }
};

/** Normaliza y migra (v1/v2 -> v3). Devuelve el estado; `normalizeState.migrado` indica si hubo que migrar algo. */
function normalizeState(s) {
  normalizeState.migrado = false;
  const base = emptyState();
  if (!s || typeof s !== 'object') return base;
  const ts = r => Number(r.updatedAt) || 0;
  const out = { version: SCHEMA_VERSION };
  for (const c of COLECCIONES) {
    const vistos = new Set();
    out[c] = (Array.isArray(s[c]) ? s[c] : []).filter(r => r && typeof r === 'object').map(r => {
      if (r.deleted) return r.id ? tombstone(r.id, ts(r), r.driveId ? { driveId: r.driveId } : {}) : null;
      const n = NORMALIZAR[c](r);
      return n ? { ...n, updatedAt: ts(r) } : null;
    }).filter(r => r && !vistos.has(r.id) && vistos.add(r.id));
  }
  // Migración de inversiones v2 (aportado/valor) -> activo + 1 compra + 1 precio
  const hoy = todayISO();
  for (const inv of out.inversiones.filter(i => !i.deleted)) {
    const m = FC.migrarInversionV2(inv, hoy);
    const poner = (col, rec) => { const i = out[col].findIndex(x => x.id === rec.id); if (i < 0) out[col].push(rec); else if ((out[col][i].updatedAt || 0) <= rec.updatedAt) out[col][i] = rec; };
    poner('activos', { ...NORMALIZAR.activos(m.activo), updatedAt: m.activo.updatedAt });
    poner('operaciones', { ...NORMALIZAR.operaciones(m.operacion), updatedAt: m.operacion.updatedAt });
    poner('precios', { ...NORMALIZAR.precios(m.precio), updatedAt: m.precio.updatedAt });
    out.inversiones[out.inversiones.indexOf(inv)] = m.lapida;
    normalizeState.migrado = true;
  }
  const c = s.categorias || {};
  out.categorias = {
    gasto: Array.isArray(c.gasto) && c.gasto.length ? [...c.gasto] : base.categorias.gasto,
    ingreso: Array.isArray(c.ingreso) && c.ingreso.length ? [...c.ingreso] : base.categorias.ingreso,
    updatedAt: Number(c.updatedAt) || 0
  };
  out.ajustes = { ...base.ajustes, ...(s.ajustes || {}) };
  return out;
}

const localCache = FinanzasStorage.createLocalCache(localStorage, 'finanzas_v2', 'finanzas_sync');
const localAdapter = new FinanzasStorage.LocalStorageAdapter(localCache);

const Store = {
  adapter: localAdapter,
  state: emptyState(),
  listeners: [],
  setAdapter(a) { this.adapter = a; },
  async init() {
    let raw = await this.adapter.load();
    if (!raw) { // migración desde la v1 (la clave antigua se conserva como copia)
      const legacy = localStorage.getItem(LEGACY_KEY);
      if (legacy) { raw = JSON.parse(legacy); this.state = normalizeState(raw); this.generarRecurrentes(false); await localCache.save(this.state); return; }
    }
    this.state = normalizeState(raw);
    const generados = this.generarRecurrentes(false);
    if (normalizeState.migrado || generados) await this.adapter.save(this.state);
  },
  async persist() { await this.adapter.save(this.state); this._emit(); },
  _emit() { this.listeners.forEach(fn => fn(this.state)); },
  onChange(fn) { this.listeners.push(fn); },
  /** Sustituye el estado con datos que llegan de la sincronización. Solo vuelve a guardar si hubo que migrar o generar algo. */
  replaceState(doc) {
    const aj = this.state.ajustes; this.state = normalizeState(doc); this.state.ajustes = aj;
    const generados = this.generarRecurrentes(false);
    if (normalizeState.migrado || generados) this.adapter.save(this.state);
    this._emit();
  },

  /* --- Genérico para todas las colecciones --- */
  list(col) { return this.state[col].filter(r => !r.deleted); },
  get(col, id) { return this.state[col].find(r => r.id === id && !r.deleted) || null; },
  _put(col, rec, t = nowTs()) {
    const n = NORMALIZAR[col]({ ...rec, id: rec.id || uid() });
    if (!n) throw new Error('Datos no válidos');
    const r = { ...n, updatedAt: t };
    const i = this.state[col].findIndex(x => x.id === r.id);
    if (i >= 0) this.state[col][i] = r; else this.state[col].push(r);
    return r;
  },
  _del(col, id, t = nowTs()) {
    const i = this.state[col].findIndex(x => x.id === id); if (i < 0) return;
    const old = this.state[col][i];
    this.state[col][i] = tombstone(id, t, old.driveId ? { driveId: old.driveId } : {});
    if (col === 'movimientos' || col === 'activos') this.state.adjuntos.filter(a => !a.deleted && a.ownerId === id).forEach(a => this._del('adjuntos', a.id, t));
    // Borrar el gasto de un repostaje borra su repostaje. Borrar un vehículo borra sus repostajes,
    // pero NO sus gastos (siguen contando en los totales del mes).
    if (col === 'movimientos') this.state.repostajes.filter(r => !r.deleted && r.movimientoId === id).forEach(r => this._del('repostajes', r.id, t));
    if (col === 'vehiculos') this.state.repostajes.filter(r => !r.deleted && r.vehiculoId === id).forEach(r => this._del('repostajes', r.id, t));
  },
  /** Aplica varios cambios en una sola escritura: [{col, rec}] o [{col, del: id}] */
  async apply(cambios) {
    const t = nowTs(), out = [];
    for (const c of cambios) out.push(c.del ? this._del(c.col, c.del, t) : this._put(c.col, c.rec, t));
    this.generarRecurrentes(false);
    await this.persist(); return out;
  },
  put(col, rec) { return this.apply([{ col, rec }]).then(r => r[0]); },
  remove(col, id) { return this.apply([{ col, del: id }]); },
  /** Crea los movimientos de las plantillas recurrentes que falten hasta hoy (ids deterministas: sin duplicados). */
  generarRecurrentes(persistir = true) {
    const nuevos = FC.generarRecurrentes(this.state.recurrentes, this.state.movimientos, todayISO());
    if (!nuevos.length) return 0;
    nuevos.forEach(m => this.state.movimientos.push({ ...NORMALIZAR.movimientos(m), updatedAt: m.updatedAt }));
    if (persistir) this.persist();
    return nuevos.length;
  },

  // Movimientos
  getMovimientos() { return this.list('movimientos'); },
  async upsertMovimiento(m) { return this.put('movimientos', { ...m, descripcion: txt(m.descripcion), cuenta: txt(m.cuenta) }); },
  async deleteMovimiento(id) { return this.remove('movimientos', id); },
  // Deudas: al borrar una deuda se borran también sus cuotas pagadas y se desmarca la compra financiada
  async deleteDeuda(id, { borrarPagos = false } = {}) {
    const cambios = [{ col: 'deudas', del: id }];
    for (const m of this.getMovimientos()) {
      if (m.financiadoPor === id) { const { financiadoPor, ...resto } = m; cambios.push({ col: 'movimientos', rec: resto }); }
      if (borrarPagos && m.deudaId === id) cambios.push({ col: 'movimientos', del: m.id });
    }
    return this.apply(cambios);
  },
  // Activos: borrar un activo borra sus operaciones y precios
  async deleteActivo(id) {
    const cambios = [{ col: 'activos', del: id }];
    this.list('operaciones').filter(o => o.activoId === id).forEach(o => cambios.push({ col: 'operaciones', del: o.id }));
    this.list('precios').filter(p => p.activoId === id).forEach(p => cambios.push({ col: 'precios', del: p.id }));
    return this.apply(cambios);
  },
  // Categorías
  getCategorias(tipo) { return this.state.categorias[tipo]; },
  _touchCats() { this.state.categorias.updatedAt = nowTs(); },
  async addCategoria(tipo, nombre) {
    nombre = nombre.trim(); if (!nombre) return false;
    if (this.state.categorias[tipo].some(c => c.toLowerCase() === nombre.toLowerCase())) return false;
    this.state.categorias[tipo].push(nombre); this._touchCats(); await this.persist(); return true;
  },
  async renameCategoria(tipo, viejo, nuevo) {
    nuevo = nuevo.trim(); if (!nuevo || nuevo === viejo) return false;
    const list = this.state.categorias[tipo];
    if (list.some(c => c.toLowerCase() === nuevo.toLowerCase() && c !== viejo)) return false;
    list[list.indexOf(viejo)] = nuevo; this._touchCats();
    const t = nowTs();
    for (const col of ['movimientos', 'recurrentes']) this.state[col].forEach(m => { if (!m.deleted && m.tipo === tipo && m.categoria === viejo) { m.categoria = nuevo; m.updatedAt = t; } });
    if (tipo === 'gasto') this.state.deudas.forEach(d => { if (!d.deleted && d.categoria === viejo) { d.categoria = nuevo; d.updatedAt = t; } });
    await this.persist(); return true;
  },
  async deleteCategoria(tipo, nombre, reasignarA = 'Otros') {
    this.state.categorias[tipo] = this.state.categorias[tipo].filter(c => c !== nombre);
    if (!this.state.categorias[tipo].includes(reasignarA)) this.state.categorias[tipo].push(reasignarA);
    this._touchCats();
    const t = nowTs();
    for (const col of ['movimientos', 'recurrentes']) this.state[col].forEach(m => { if (!m.deleted && m.tipo === tipo && m.categoria === nombre) { m.categoria = reasignarA; m.updatedAt = t; } });
    await this.persist();
  },
  countUsoCategoria(tipo, nombre) { return this.getMovimientos().filter(m => m.tipo === tipo && m.categoria === nombre).length; },
  // Ajustes y global
  async setAjuste(k, v) { this.state.ajustes[k] = v; await this.adapter.cache.save(this.state); }, // solo local, no dispara sincronización
  async addMany(datos) {
    const t = nowTs();
    for (const c of COLECCIONES) for (const r of (datos[c] || [])) {
      const n = NORMALIZAR[c](r); if (n) this.state[c].push({ ...n, updatedAt: r.updatedAt || t });
    }
    this.generarRecurrentes(false);
    await this.persist();
  },
  exportJSON() {
    const out = { app: 'finanzas', version: SCHEMA_VERSION, exportado: new Date().toISOString(),
      nota: 'Los archivos adjuntos (fotos/PDF) no van en esta copia: solo su nombre, miniatura y texto leído.' };
    for (const c of COLECCIONES) if (c !== 'inversiones') out[c] = this.list(c);
    out.categorias = this.state.categorias;
    return JSON.stringify(out, null, 2);
  },
  /** Sustituye todos los datos por los de la copia (también en los demás dispositivos al sincronizar). */
  async importJSON(text) {
    const data = JSON.parse(text);
    if (!data || !COLECCIONES.some(c => Array.isArray(data[c]))) throw new Error('Formato no válido');
    const imp = normalizeState(data), t = nowTs();
    const replace = (actual, nuevos) => {
      const ids = new Set(nuevos.map(r => r.id));
      return [...actual.filter(r => !ids.has(r.id)).map(r => r.deleted ? r : tombstone(r.id, t, r.driveId ? { driveId: r.driveId } : {})), ...nuevos.filter(r => !r.deleted).map(r => ({ ...r, updatedAt: t })), ...nuevos.filter(r => r.deleted && !actual.some(a => a.id === r.id))];
    };
    for (const c of COLECCIONES) this.state[c] = replace(this.state[c], imp[c]);
    this.state.categorias = { ...imp.categorias, updatedAt: t };
    this.generarRecurrentes(false);
    await this.persist();
  },
  /** Borra todo (con lápidas, para que el borrado llegue también a Drive). */
  async reset() {
    const t = nowTs();
    for (const c of COLECCIONES) this.state[c] = this.state[c].map(r => r.deleted ? r : tombstone(r.id, t, r.driveId ? { driveId: r.driveId } : {}));
    this.state.categorias = { ...JSON.parse(JSON.stringify(DEFAULT_CATEGORIAS)), updatedAt: t };
    await this.persist();
  }
};

/* =========================================================
   Cálculos
   ========================================================= */
const Calc = {
  /** Las compras financiadas no cuentan como gasto del mes: cuentan sus cuotas al pagarse. */
  resumenMes(movs, ym) {
    const r = { ingresos: 0, gastos: 0, nI: 0, nG: 0, fijos: 0, variables: 0, deuda: 0, interesesDeuda: 0, nomina: 0, extra: 0, otrosIngresos: 0, financiado: 0 };
    for (const m of movs) {
      if (monthKey(m.fecha) !== ym) continue;
      if (m.tipo === 'ingreso') {
        r.ingresos += m.importe; r.nI++;
        if (m.tipoIngreso === 'nomina') r.nomina += m.importe; else if (m.tipoIngreso === 'extra') r.extra += m.importe; else r.otrosIngresos += m.importe;
      } else if (m.financiadoPor) { r.financiado += m.importe; }
      else {
        r.gastos += m.importe; r.nG++;
        if (m.naturaleza === 'fijo') r.fijos += m.importe; else r.variables += m.importe;
        if (m.deudaId) { r.deuda += m.importe; r.interesesDeuda += (m.desglose && m.desglose.interes) || 0; }
      }
    }
    for (const k of Object.keys(r)) if (k[0] !== 'n') r[k] = round2(r[k]);
    r.balance = round2(r.ingresos - r.gastos);
    r.tasaAhorro = r.ingresos > 0 ? r.balance / r.ingresos : null;
    return r;
  },
  gastosPorCategoria(movs, ym) {
    const map = {};
    for (const m of movs) if (m.tipo === 'gasto' && !m.financiadoPor && monthKey(m.fecha) === ym) map[m.categoria] = round2((map[m.categoria] || 0) + m.importe);
    return Object.entries(map).sort((a, b) => b[1] - a[1]);
  },
  ultimos12(movs, ym) {
    const meses = []; for (let i = 11; i >= 0; i--) meses.push(addMonths(ym, -i));
    return meses.map(k => ({ mes: k, ...this.resumenMes(movs, k) }));
  },
  /** Deuda + su estado (cuotas pagadas = movimientos con deudaId y cuotaN). */
  deuda(d, movs = Store.getMovimientos()) {
    const pagos = movs.filter(m => m.deudaId === d.id && m.cuotaN);
    return { deuda: d, pagos, ...FC.resumenDeuda(d, pagos.map(m => m.cuotaN), todayISO()) };
  },
  deudas() { return Store.list('deudas').map(d => this.deuda(d)); },
  /** Métricas FIFO por activo y totales de la cartera. */
  cartera() {
    const ops = Store.list('operaciones'), precios = Store.list('precios');
    const activos = Store.list('activos').map(a => {
      const o = ops.filter(x => x.activoId === a.id), p = precios.filter(x => x.activoId === a.id);
      return { activo: a, ops: o, precios: p, ...FC.metricasActivo(o, p) };
    });
    const tot = { comprado: 0, aportadoNeto: 0, coste: 0, valor: 0, noRealizada: 0, realizada: 0, porAnio: {} };
    for (const a of activos) {
      tot.comprado += a.comprado; tot.aportadoNeto += a.aportadoNeto; tot.coste += a.costeRestante; tot.valor += a.valor; tot.noRealizada += a.noRealizada; tot.realizada += a.gananciaRealizada;
      for (const [y, v] of Object.entries(a.realizadaPorAnio)) tot.porAnio[y] = round2((tot.porAnio[y] || 0) + v);
    }
    for (const k of ['comprado', 'aportadoNeto', 'coste', 'valor', 'noRealizada', 'realizada']) tot[k] = round2(tot[k]);
    tot.noRealizadaPct = tot.coste > 0 ? tot.noRealizada / tot.coste : null;
    return { activos, tot };
  },
  /** Garantías de los gastos, ordenadas por vencimiento. */
  garantias(dias = Store.state.ajustes.avisoGarantiaDias) {
    const hoy = todayISO();
    return Store.getMovimientos().filter(m => m.tipo === 'gasto' && m.garantia).map(m => {
      const vence = FC.vencimientoGarantia(m.fecha, m.garantia.anios);
      return { mov: m, vence, ...FC.estadoGarantia(vence, hoy, dias) };
    }).sort((a, b) => a.vence.localeCompare(b.vence));
  }
};

/* =========================================================
   UI
   ========================================================= */
const UI = { mes: monthKey(todayISO()), charts: {} };
const PALETTE = ['#0f766e', '#f59e0b', '#3b82f6', '#ef4444', '#8b5cf6', '#10b981', '#ec4899', '#6366f1', '#84cc16', '#f97316', '#06b6d4', '#a855f7', '#64748b', '#eab308', '#14b8a6', '#e11d48', '#0ea5e9'];

function applyTheme() {
  const t = Store.state.ajustes.tema;
  const dark = t === 'dark' || (t === 'auto' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  $('#themeBtn').textContent = t === 'auto' ? '🌓' : (dark ? '🌙' : '☀️');
  $('#themeBtn').title = 'Tema: ' + ({ auto: 'automático', dark: 'oscuro', light: 'claro' }[t]);
}

function cssVar(name) { return getComputedStyle(document.documentElement).getPropertyValue(name).trim(); }

function setMes(ym) { UI.mes = ym; $('#monthInput').value = ym; renderAll(); }

function showView(v) {
  $$('nav.tabs button').forEach(b => b.classList.toggle('active', b.dataset.view === v));
  $$('section.view').forEach(s => s.classList.toggle('active', s.id === 'view-' + v));
  $('#fabAdd').style.display = (v === 'resumen' || v === 'movimientos') ? '' : 'none';
  if (location.hash !== '#' + v) history.replaceState(null, '', '#' + v);
  renderAll();
}

function renderResumen() {
  const movs = Store.getMovimientos();
  const r = Calc.resumenMes(movs, UI.mes);
  $('#resumenTitle').textContent = 'Resumen de ' + monthLabel(UI.mes);
  $('#kpiIngresos').textContent = eur(r.ingresos);
  $('#kpiGastos').textContent = eur(r.gastos);
  $('#kpiIngresosN').textContent = `${r.nI} movimiento${r.nI === 1 ? '' : 's'}`;
  $('#kpiGastosN').textContent = `${r.nG} movimiento${r.nG === 1 ? '' : 's'}`;
  const b = $('#kpiBalance'); b.textContent = eur(r.balance); b.className = 'value ' + (r.balance > 0 ? 'pos' : r.balance < 0 ? 'neg' : '');
  const prev = Calc.resumenMes(movs, addMonths(UI.mes, -1));
  $('#kpiBalanceSub').textContent = 'Mes anterior: ' + eur(prev.balance);
  const a = $('#kpiAhorro'); a.textContent = pct(r.tasaAhorro); a.className = 'value ' + (r.tasaAhorro > 0 ? 'pos' : r.tasaAhorro < 0 ? 'neg' : '');

  // Desglose: fijos / variables y nómina / extra
  const barra = (partes, total) => total > 0 ? `<div class="stack-bar">${partes.filter(p => p[1] > 0).map(p => `<span class="${p[2]}" style="width:${(p[1] / total * 100).toFixed(2)}%" title="${esc(p[0])}: ${eur(p[1])}"></span>`).join('')}</div>` : '<div class="stack-bar empty-bar"></div>';
  const fila = (lbl, v, total, cls, extra = '') => `<tr><td><span class="dot ${cls}"></span>${lbl}${extra}</td><td class="num">${eur(v)}</td><td class="num muted">${pct(total ? v / total : null)}</td></tr>`;
  $('#desgloseBody').innerHTML = `
    <div class="desglose">
      <div><h4>Gastos: fijos y variables</h4>${barra([['Fijos', r.fijos, 'c-fijo'], ['Variables', r.variables, 'c-var']], r.gastos)}
        <table><tbody>${fila('Fijos', r.fijos, r.gastos, 'c-fijo', r.deuda ? `<div class="muted small">incluye ${eur(r.deuda)} de cuotas de deudas (${eur(r.interesesDeuda)} de intereses)</div>` : '')}${fila('Variables', r.variables, r.gastos, 'c-var')}</tbody></table>
        ${r.financiado ? `<p class="muted small">Compras financiadas este mes: ${eur(r.financiado)} (no cuentan aquí; cuentan sus cuotas cuando las pagas).</p>` : ''}</div>
      <div><h4>Ingresos: nómina y extra</h4>${barra([['Nómina', r.nomina, 'c-nom'], ['Extra', r.extra, 'c-extra'], ['Otros', r.otrosIngresos, 'c-otro']], r.ingresos)}
        <table><tbody>${fila('Nómina', r.nomina, r.ingresos, 'c-nom')}${fila('Extra', r.extra, r.ingresos, 'c-extra')}${r.otrosIngresos ? fila('Otros', r.otrosIngresos, r.ingresos, 'c-otro') : ''}</tbody></table></div>
    </div>`;

  const cats = Calc.gastosPorCategoria(movs, UI.mes);
  $('#topCatBody').innerHTML = cats.length ? cats.slice(0, 8).map(([c, v], i) =>
    `<tr><td><span style="display:inline-block;width:10px;height:10px;border-radius:3px;background:${PALETTE[i % PALETTE.length]};margin-right:6px"></span>${esc(c)}</td><td class="num">${eur(v)}</td><td class="num">${pct(r.gastos ? v / r.gastos : 0)}</td></tr>`).join('')
    : '<tr><td colspan="3" class="empty">Sin gastos este mes</td></tr>';

  const ult = movs.filter(m => monthKey(m.fecha) === UI.mes).sort((x, y) => y.fecha.localeCompare(x.fecha)).slice(0, 6);
  $('#ultimosBody').innerHTML = ult.length ? ult.map(m =>
    `<tr><td>${fmtFecha(m.fecha)}</td><td>${esc(m.descripcion || m.categoria)}<div class="muted" style="font-size:.8rem">${esc(m.categoria)} ${badges(m)}</div></td><td class="num ${m.tipo === 'ingreso' ? 'pos' : 'neg'}">${m.tipo === 'ingreso' ? '+' : '−'}${eur(m.importe)}</td></tr>`).join('')
    : '<tr><td class="empty">No hay movimientos este mes. Pulsa «＋ Movimiento» para añadir uno.</td></tr>';

  renderCharts(cats);
}

function renderCharts(cats) {
  if (typeof Chart === 'undefined') return; // sin conexión al CDN: la app sigue funcionando sin gráficos
  const text = cssVar('--text'), grid = cssVar('--border'), muted = cssVar('--muted');
  Chart.defaults.color = muted; Chart.defaults.font.family = getComputedStyle(document.body).fontFamily;
  const tooltipEUR = { callbacks: { label: ctx => `${ctx.dataset.label ? ctx.dataset.label + ': ' : ''}${eur(ctx.parsed.y ?? ctx.parsed)}` } };

  // Doughnut
  const emptyEl = $('#chartCategoriasEmpty');
  emptyEl.style.display = cats.length ? 'none' : 'flex';
  const dData = { labels: cats.map(c => c[0]), datasets: [{ data: cats.map(c => c[1]), backgroundColor: cats.map((_, i) => PALETTE[i % PALETTE.length]), borderColor: cssVar('--card'), borderWidth: 2 }] };
  if (UI.charts.cat) { UI.charts.cat.data = dData; UI.charts.cat.options.plugins.legend.labels.color = text; UI.charts.cat.update(); }
  else UI.charts.cat = new Chart($('#chartCategorias'), { type: 'doughnut', data: dData, options: { maintainAspectRatio: false, cutout: '62%', plugins: { legend: { position: 'bottom', labels: { color: text, boxWidth: 12 } }, tooltip: { callbacks: { label: ctx => `${ctx.label}: ${eur(ctx.parsed)}` } } } } });

  // Barras 12 meses
  const serie = Calc.ultimos12(Store.getMovimientos(), UI.mes);
  const eData = {
    labels: serie.map(s => monthLabel(s.mes, true)),
    datasets: [
      { type: 'bar', label: 'Ingresos', data: serie.map(s => s.ingresos), backgroundColor: cssVar('--ok'), borderRadius: 4 },
      { type: 'bar', label: 'Gastos', data: serie.map(s => s.gastos), backgroundColor: cssVar('--danger'), borderRadius: 4 },
      { type: 'line', label: 'Balance', data: serie.map(s => s.balance), borderColor: cssVar('--primary'), backgroundColor: cssVar('--primary'), tension: .3, pointRadius: 3 }
    ]
  };
  const eOpts = { maintainAspectRatio: false, interaction: { mode: 'index', intersect: false },
    scales: { x: { grid: { color: grid }, ticks: { color: muted } }, y: { grid: { color: grid }, ticks: { color: muted, callback: v => fmtEUR.format(v).replace(/,00/, '') } } },
    plugins: { legend: { labels: { color: text, boxWidth: 12 } }, tooltip: tooltipEUR } };
  if (UI.charts.evo) { UI.charts.evo.destroy(); }
  UI.charts.evo = new Chart($('#chartEvolucion'), { data: eData, options: eOpts });
}

function filtrarMovimientos() {
  const txt = $('#fTexto').value.trim().toLowerCase();
  const per = $('#fPeriodo').value, tipo = $('#fTipo').value, cat = $('#fCategoria').value;
  const anio = UI.mes.slice(0, 4);
  return Store.getMovimientos().filter(m => {
    if (per === 'mes' && monthKey(m.fecha) !== UI.mes) return false;
    if (per === 'anio' && m.fecha.slice(0, 4) !== anio) return false;
    if (tipo && m.tipo !== tipo) return false;
    if (cat && m.categoria !== cat) return false;
    if (txt && !(`${m.descripcion} ${m.categoria} ${m.cuenta} ${fmtNum.format(m.importe)}`.toLowerCase().includes(txt))) return false;
    return true;
  }).sort((a, b) => b.fecha.localeCompare(a.fecha) || 0);
}

function renderFiltroCategorias() {
  const sel = $('#fCategoria'), cur = sel.value, tipo = $('#fTipo').value;
  const cats = tipo ? Store.getCategorias(tipo) : [...new Set([...Store.getCategorias('gasto'), ...Store.getCategorias('ingreso')])].sort((a, b) => a.localeCompare(b, LOCALE));
  sel.innerHTML = '<option value="">Todas</option>' + cats.map(c => `<option>${esc(c)}</option>`).join('');
  if (cats.includes(cur)) sel.value = cur;
}

function badges(m) {
  const out = [];
  if (m.tipo === 'gasto') out.push(`<span class="badge ${m.naturaleza === 'fijo' ? 'b-fijo' : 'b-var'}">${m.naturaleza === 'fijo' ? 'Fijo' : 'Variable'}</span>`);
  else out.push(`<span class="badge b-${m.tipoIngreso}">${TIPOS_INGRESO[m.tipoIngreso]}</span>`);
  if (m.deudaId) out.push(`<span class="badge b-deuda" title="Pago de deuda${m.desglose ? ': intereses ' + eur(m.desglose.interes) + ', capital ' + eur(m.desglose.amortizacion) : ''}">Cuota${m.cuotaN ? ' ' + m.cuotaN : ''}</span>`);
  if (m.financiadoPor) out.push('<span class="badge b-fin" title="Compra a plazos: cuentan las cuotas, no este importe">Financiado</span>');
  if (m.garantia) out.push('<span class="badge b-gar" title="Tiene garantía">🛡️</span>');
  if (m.recurrenteId) out.push('<span class="badge b-rec" title="Generado por un movimiento recurrente">🔁</span>');
  const rp = typeof repostajeDeMov === 'function' ? repostajeDeMov(m) : null;
  if (rp) { const v = Store.get('vehiculos', rp.vehiculoId); out.push(`<span class="badge b-comb" title="Repostaje: ${fmtLitros(rp.litros)} a ${fmtPrecioL(rp.precioLitro)}">⛽ ${esc(v ? v.matricula : '')}</span>`); }
  const n = Store.list('adjuntos').filter(a => a.ownerId === m.id).length;
  if (n) out.push(`<span class="badge b-adj" title="${n} adjunto(s)">📎${n > 1 ? n : ''}</span>`);
  return out.join(' ');
}

function renderMovimientos() {
  renderFiltroCategorias();
  const list = filtrarMovimientos();
  $('#movBody').innerHTML = list.length ? list.map(m => `
    <tr${m.financiadoPor ? ' class="row-fin"' : ''}>
      <td>${fmtFecha(m.fecha)}</td>
      <td><span class="tag ${m.tipo}">${m.tipo === 'gasto' ? 'Gasto' : 'Ingreso'}</span></td>
      <td>${esc(m.categoria)}</td>
      <td>${esc(m.descripcion)} <div class="badges">${badges(m)}</div></td>
      <td class="hide-sm muted">${esc(m.cuenta)}</td>
      <td class="num ${m.financiadoPor ? 'muted' : m.tipo === 'ingreso' ? 'pos' : 'neg'}">${m.tipo === 'ingreso' ? '+' : '−'}${eur(m.importe)}</td>
      <td class="actions"><button class="btn-sm" data-edit-mov="${m.id}" title="Editar">✏️</button> <button class="btn-sm btn-danger" data-del-mov="${m.id}" title="Eliminar">🗑️</button></td>
    </tr>`).join('') : '<tr><td colspan="7" class="empty">No hay movimientos con estos filtros.</td></tr>';
  const neto = round2(list.filter(m => !m.financiadoPor).reduce((s, m) => s + (m.tipo === 'ingreso' ? m.importe : -m.importe), 0));
  $('#movCount').textContent = `${list.length} movimiento${list.length === 1 ? '' : 's'} · neto`;
  const t = $('#movTotal'); t.textContent = eur(neto); t.className = 'num ' + (neto > 0 ? 'pos' : neto < 0 ? 'neg' : '');
  renderRecurrentes();
}

async function renderAjustes() {
  for (const tipo of ['gasto', 'ingreso']) {
    const el = tipo === 'gasto' ? $('#catGasto') : $('#catIngreso');
    el.innerHTML = Store.getCategorias(tipo).map(c => {
      const n = Store.countUsoCategoria(tipo, c);
      return `<li><span>${esc(c)} <small class="muted">${n ? `(${n})` : ''}</small></span>
        <button class="btn-sm" data-rename-cat="${tipo}" data-cat="${esc(c)}" title="Renombrar">✏️</button>
        <button class="btn-sm btn-danger" data-del-cat="${tipo}" data-cat="${esc(c)}" title="Eliminar">🗑️</button></li>`;
    }).join('');
  }
  const aj = Store.state.ajustes;
  $('#ajAvisoDias').value = aj.avisoGarantiaDias;
  $('#ajNotif').checked = !!aj.notificaciones && typeof Notification !== 'undefined' && Notification.permission === 'granted';
  $('#ajNotifInfo').textContent = typeof Notification === 'undefined' ? 'Este navegador no admite notificaciones.' : Notification.permission === 'denied' ? 'Has bloqueado las notificaciones para esta web en el navegador.' : '';
  renderAjustesOCR();
  if (window.Analisis) Analisis.render();
  const bytes = new Blob([localStorage.getItem(localCache.key) || '']).size;
  const nAdj = Store.list('adjuntos').length;
  $('#storageInfo').textContent = `Copia en este navegador: «${localCache.key}» · ${Store.getMovimientos().length} movimientos · ${Store.list('deudas').length} deudas · ${Store.list('activos').length} activos · ${Store.list('operaciones').length} operaciones · ${nAdj} adjuntos · ${(bytes / 1024).toLocaleString(LOCALE, { maximumFractionDigits: 1 })} KB`;
  try { const u = await Adjuntos.BlobStore.usage(); $('#adjInfo').textContent = `Archivos adjuntos guardados en este dispositivo: ${u.n} (${(u.bytes / 1048576).toLocaleString(LOCALE, { maximumFractionDigits: 1 })} MB).`; } catch { $('#adjInfo').textContent = ''; }
}

function renderAll() {
  const active = $('section.view.active').id.replace('view-', '');
  if (active === 'resumen') renderResumen();
  if (active === 'movimientos') renderMovimientos();
  if (active === 'deudas') renderDeudas();
  if (active === 'inversiones') renderInversiones();
  if (active === 'garantias') renderGarantias();
  if (active === 'vehiculos') renderVehiculos();
  if (active === 'ajustes') renderAjustes();
  renderBannerGarantias();
}

/* ---------- Diálogo movimiento ---------- */
function fillCategoriaSelect(tipo, selected) {
  const cats = Store.getCategorias(tipo);
  const opts = [...cats]; if (selected && !opts.includes(selected)) opts.push(selected);
  $('#mCategoria').innerHTML = opts.map(c => `<option ${c === selected ? 'selected' : ''}>${esc(c)}</option>`).join('');
}
const fmtInput = n => n === null || n === undefined || n === '' ? '' : String(round2(n)).replace('.', ',');
const fmtInputN = n => n === null || n === undefined || n === '' ? '' : String(n).replace('.', ',');
const MovDlg = { mov: null, deuda: null, adj: null };
function movTipo() { return $('#movForm').querySelector('input[name="tipo"]:checked').value; }
function syncMovOpciones() {
  const f = $('#movForm'), gasto = movTipo() === 'gasto';
  $('#rowNaturaleza').hidden = !gasto; $('#rowTipoIngreso').hidden = gasto;
  ['#optDeuda', '#optFin', '#optGar', '#optComb'].forEach(s => $(s).hidden = !gasto);
  // un repostaje no es pago de deuda, ni compra financiada, ni recurrente
  const comb = gasto && f.esComb.checked;
  if (comb) { f.esPago.checked = false; f.esFin.checked = false; }
  combSync();
  $('#optDeudaBody').hidden = !(gasto && f.esPago.checked);
  $('#optFinBody').hidden = !(gasto && f.esFin.checked);
  $('#optGarBody').hidden = !(gasto && f.esGar.checked);
  $('#optRecBody').hidden = !f.esRec.checked;
  // pago de deuda y compra financiada son incompatibles
  f.esFin.disabled = f.esPago.checked || comb; f.esPago.disabled = f.esFin.checked || comb; f.esComb.disabled = f.esPago.checked || f.esFin.checked;
  f.esRec.disabled = gasto && (f.esPago.checked || f.esFin.checked || comb); if (f.esRec.disabled) f.esRec.checked = false;
  if (gasto && f.esFin.checked) previewFin('#movFin', parseImporte(f.importe.value));
  if (gasto && f.esGar.checked) actualizarVenceGarantia();
  if (f.esRec.checked) $('#recInfo').textContent = f.fecha.value ? `Se creará automáticamente ${FC.textoDiaCobro(f.recUltimo.checked ? FC.DIA_ULTIMO : Number(f.fecha.value.slice(8)))}, a partir de ${monthLabel(monthKey(f.fecha.value))}.` : '';
}
function actualizarVenceGarantia() {
  const f = $('#movForm'), anios = parseImporte(f.garAnios.value || '0');
  $('#garVence').textContent = f.fecha.value && anios > 0 ? `Vence el ${fmtFecha(FC.vencimientoGarantia(f.fecha.value, anios))}` : '';
}
function llenarSelectDeudas(deudaId, cuotaN) {
  const f = $('#movForm'), ds = Calc.deudas().filter(d => !d.terminada || d.deuda.id === deudaId);
  f.deudaId.innerHTML = ds.length ? ds.map(d => `<option value="${d.deuda.id}" ${d.deuda.id === deudaId ? 'selected' : ''}>${esc(d.deuda.nombre)} · quedan ${d.restantes} cuotas</option>`).join('') : '<option value="">No tienes deudas pendientes</option>';
  llenarSelectCuotas(cuotaN);
}
function llenarSelectCuotas(cuotaN) {
  const f = $('#movForm'), d = Store.get('deudas', f.deudaId.value);
  if (!d) { f.cuotaN.innerHTML = ''; $('#cuotaDesglose').textContent = ''; return; }
  const r = Calc.deuda(d), pagadas = new Set(r.pagos.filter(p => p.id !== f.id.value).map(p => p.cuotaN));
  f.cuotaN.innerHTML = r.filas.filter(x => !pagadas.has(x.n)).map(x => `<option value="${x.n}" ${x.n === cuotaN ? 'selected' : ''}>Cuota ${x.n}/${r.filas.length} · ${fmtFecha(x.fecha)} · ${eur(x.pago)}</option>`).join('');
  mostrarDesgloseCuota();
}
function filaCuota() {
  const f = $('#movForm'), d = Store.get('deudas', f.deudaId.value); if (!d) return null;
  const c = FC.cuadroAmortizacion(d); return { d, c, fila: c.filas.find(x => x.n === Number(f.cuotaN.value)) };
}
function mostrarDesgloseCuota(rellenar = false) {
  const x = filaCuota(), f = $('#movForm');
  if (!x || !x.fila) { $('#cuotaDesglose').textContent = ''; return; }
  $('#cuotaDesglose').innerHTML = `Intereses <strong>${eur(x.fila.interes)}</strong> · capital <strong>${eur(x.fila.amortizacion)}</strong>${x.fila.comision ? ` · comisión ${eur(x.fila.comision)}` : ''} · pendiente después: ${eur(x.fila.pendiente)}`;
  if (rellenar) {
    f.importe.value = fmtInput(x.fila.pago);
    if (!f.id.value) f.fecha.value = x.fila.fecha;
    fillCategoriaSelect('gasto', x.d.categoria); f.cuenta.value = f.cuenta.value || x.d.cuenta;
    f.descripcion.value = `Cuota ${x.fila.n}/${x.c.filas.length} · ${x.d.nombre}`;
    f.querySelector('input[name="naturaleza"][value="fijo"]').checked = true;
  }
}

function openMovDialog(mov, preset = {}) {
  const f = $('#movForm'); f.reset(); $('#movError').style.display = 'none';
  MovDlg.mov = mov || null;
  const tipo = mov?.tipo || preset.tipo || 'gasto';
  f.id.value = mov?.id || '';
  f.querySelector(`input[name="tipo"][value="${tipo}"]`).checked = true;
  f.importe.value = mov ? fmtInput(mov.importe) : '';
  // por defecto: hoy si estamos en el mes actual, si no el día 1 del mes seleccionado
  f.fecha.value = mov?.fecha || (monthKey(todayISO()) === UI.mes ? todayISO() : UI.mes + '-01');
  fillCategoriaSelect(tipo, mov?.categoria);
  f.cuenta.value = mov?.cuenta || ''; f.descripcion.value = mov?.descripcion || '';
  f.querySelector(`input[name="naturaleza"][value="${mov?.naturaleza || naturalezaPorDefecto(f.categoria.value)}"]`).checked = true;
  f.tipoIngreso.value = mov?.tipoIngreso || tipoIngresoPorDefecto(f.categoria.value);
  $('#cuentasList').innerHTML = [...new Set(Store.getMovimientos().map(m => m.cuenta).filter(Boolean))].map(c => `<option value="${esc(c)}">`).join('');
  // pago de deuda
  f.esPago.checked = !!mov?.deudaId; llenarSelectDeudas(mov?.deudaId, mov?.cuotaN);
  // financiación
  MovDlg.deuda = mov?.financiadoPor ? Store.get('deudas', mov.financiadoPor) : null;
  f.esFin.checked = !!MovDlg.deuda;
  setFinFields('#movFin', MovDlg.deuda || { medio: 'tienda', tin: 0, plazo: 12, fechaPrimeraCuota: FC.addMonthsISO(f.fecha.value, 1) });
  // garantía
  f.esGar.checked = !!mov?.garantia;
  f.garProducto.value = mov?.garantia?.producto || ''; f.garAnios.value = fmtInputN(mov?.garantia?.anios || FC.GARANTIA_ANIOS_DEFECTO);
  // recurrente (solo al crear)
  $("#optRec").hidden = !!mov; f.esRec.checked = false; f.recUltimo.checked = false;
  $('#movRecNota').hidden = !mov?.recurrenteId;
  $('#movDialogTitle').textContent = mov ? 'Editar movimiento' : 'Nuevo movimiento';
  $('#movDelete').style.display = mov ? '' : 'none';
  $('#ocrPanel').hidden = true; $('#ocrPanel').innerHTML = '';
  MovDlg.adj = AdjUI.abrir('#movAdj', { ownerType: 'movimiento', ownerId: mov?.id || uid() });
  combAbrir(mov, preset);   // repostaje de combustible (vehiculos.js)
  syncMovOpciones();
  $('#movDialog').showModal(); setTimeout(() => f.importe.focus(), 30);
}
$$('#movForm input[name="tipo"]').forEach(r => r.addEventListener('change', () => { fillCategoriaSelect(r.value); syncMovOpciones(); }));
$('#mCategoria').addEventListener('change', e => { // por defecto según la categoría (se puede cambiar)
  const f = $('#movForm');
  if (movTipo() === 'gasto' && !f.id.value) f.querySelector(`input[name="naturaleza"][value="${naturalezaPorDefecto(e.target.value)}"]`).checked = true;
  if (movTipo() === 'ingreso' && !f.id.value) f.tipoIngreso.value = tipoIngresoPorDefecto(e.target.value);
  if (movTipo() === 'gasto' && !f.esComb.checked && FuelCore.esCategoriaCombustible(e.target.value) && !f.esPago.checked && !f.esFin.checked) { f.esComb.checked = true; syncMovOpciones(); }
});
['esPago', 'esFin', 'esGar', 'esRec'].forEach(n => $('#movForm')[n].addEventListener('change', () => {
  const f = $('#movForm');
  if (n === 'esPago' && f.esPago.checked) mostrarDesgloseCuota(true);
  if (n === 'esFin' && f.esFin.checked) { const p = parseImporte(f.importe.value); const ff = finForm('#movFin'); if (isFinite(p) && p > 0 && !ff.principal.value) ff.principal.value = fmtInput(p); }
  syncMovOpciones();
}));
$('#movForm').deudaId.addEventListener('change', () => { llenarSelectCuotas(); mostrarDesgloseCuota(true); });
$('#movForm').cuotaN.addEventListener('change', () => mostrarDesgloseCuota(true));
$('#movForm').fecha.addEventListener('change', syncMovOpciones);
$('#movForm').recUltimo.addEventListener('change', syncMovOpciones);
$('#movForm').garAnios.addEventListener('input', actualizarVenceGarantia);
$('#movForm').importe.addEventListener('input', () => { if ($('#movForm').esFin.checked) previewFin('#movFin', parseImporte($('#movForm').importe.value)); });
$('#movForm').addEventListener('submit', async e => {
  e.preventDefault();
  const f = e.target, importe = parseImporte(f.importe.value), tipo = movTipo(), gasto = tipo === 'gasto';
  const err = msg => { const p = $('#movError'); p.textContent = msg; p.style.display = ''; };
  if (!isFinite(importe) || importe <= 0) return err('Introduce un importe mayor que 0 (p. ej. 12,50).');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(f.fecha.value)) return err('Introduce una fecha válida.');
  const editando = MovDlg.mov;
  const mov = { ...(editando || {}), id: f.id.value || null, tipo, fecha: f.fecha.value, importe, categoria: f.categoria.value, descripcion: f.descripcion.value.trim(), cuenta: f.cuenta.value.trim() };
  delete mov.deudaId; delete mov.cuotaN; delete mov.desglose; delete mov.financiadoPor; delete mov.garantia; delete mov.naturaleza; delete mov.tipoIngreso;
  if (gasto) mov.naturaleza = f.querySelector('input[name="naturaleza"]:checked').value; else mov.tipoIngreso = f.tipoIngreso.value;
  const cambios = [];
  // Pago de una cuota de deuda
  if (gasto && f.esPago.checked) {
    const x = filaCuota(); if (!x || !x.fila) return err('Elige la deuda y la cuota que pagas.');
    Object.assign(mov, { deudaId: x.d.id, cuotaN: x.fila.n, desglose: { interes: x.fila.interes, amortizacion: x.fila.amortizacion, comision: x.fila.comision } });
    if (!mov.id) mov.id = `cuota_${x.d.id}_${x.fila.n}`;   // id determinista: la misma cuota no se duplica entre dispositivos
    if (Math.abs(importe - x.fila.pago) > 0.005) mov.desglose.comision = round2(x.fila.comision + importe - x.fila.pago); // diferencia (p. ej. recargo) como comisión
  }
  // Garantía
  if (gasto && f.esGar.checked) {
    const anios = parseImporte(f.garAnios.value);
    if (!(anios > 0)) return err('Indica los años de garantía (p. ej. 3).');
    mov.garantia = { anios, producto: f.garProducto.value.trim() || mov.descripcion, oculta: editando?.garantia?.oculta || false };
  }
  // Repetir cada mes -> plantilla recurrente (y este movimiento es el del primer mes)
  if (!editando && f.esRec.checked) {
    const rec = { id: uid(), tipo, importe, categoria: mov.categoria, descripcion: mov.descripcion, cuenta: mov.cuenta, dia: f.recUltimo.checked ? FC.DIA_ULTIMO : Number(mov.fecha.slice(8)), desde: monthKey(mov.fecha), hasta: '', activo: true, naturaleza: mov.naturaleza, tipoIngreso: mov.tipoIngreso };
    mov.id = FC.idRecurrente(rec.id, rec.desde); mov.recurrenteId = rec.id;
    cambios.push({ col: 'recurrentes', rec });
  }
  if (!mov.id) mov.id = MovDlg.adj.owner.ownerId;
  // Repostaje de combustible -> registro en «repostajes» enlazado a este gasto
  delete mov.repostajeId;
  if (gasto && f.esComb.checked) {
    const r = combLeer(mov, importe);
    if (r.error) return err(r.error);
    if (r.confirmar && !confirm(r.confirmar)) return;
    mov.repostajeId = r.rep.id;
    if (!mov.descripcion) mov.descripcion = r.descripcion;
    if (!Store.getCategorias('gasto').includes(mov.categoria)) { Store.state.categorias.gasto.push(mov.categoria); Store._touchCats(); }
    cambios.push({ col: 'repostajes', rec: r.rep });
  } else if (MovDlg.rep) {
    if (!confirm('Has quitado «Repostaje»: se borrarán los datos de litros y km de este gasto (el gasto se conserva). ¿Continuar?')) return;
    cambios.push({ col: 'repostajes', del: MovDlg.rep.id });
  }
  // Compra financiada -> deuda
  if (gasto && f.esFin.checked) {
    const d = leerFinFields('#movFin');
    if (d.error) return err(d.error);
    const deuda = { ...(MovDlg.deuda || {}), ...d, id: MovDlg.deuda?.id || uid(), nombre: mov.descripcion || mov.categoria, fechaInicio: mov.fecha, movimientoId: mov.id, categoria: mov.categoria, cuenta: mov.cuenta };
    mov.financiadoPor = deuda.id;
    cambios.push({ col: 'deudas', rec: deuda });
  } else if (MovDlg.deuda) {
    if (!confirm('Has quitado la financiación: se eliminará el plan de pagos de esta compra (las cuotas ya pagadas se conservan como gastos). ¿Continuar?')) return;
    cambios.push({ col: 'deudas', del: MovDlg.deuda.id });
  }
  cambios.unshift({ col: 'movimientos', rec: mov });
  cambios.push(...AdjUI.cambios(MovDlg.adj, mov.id));
  await Store.apply(cambios);
  AdjUI.cerrar(MovDlg.adj, true);
  $('#movDialog').close(); toast(editando ? 'Movimiento actualizado' : 'Movimiento guardado');
});
$('#movDialog').addEventListener('close', () => { if (MovDlg.adj) AdjUI.cerrar(MovDlg.adj, false); });
$('#movDelete').addEventListener('click', async () => {
  const id = $('#movForm').id.value;
  if (id && await confirmarBorrarMov(id)) { $('#movDialog').close(); toast('Movimiento eliminado'); }
});
async function confirmarBorrarMov(id) {
  const m = Store.get('movimientos', id); if (!m) return false;
  if (m.financiadoPor && Store.get('deudas', m.financiadoPor)) {
    if (!confirm('Esta compra está financiada. Se eliminará también su plan de pagos (las cuotas ya pagadas se conservan como gastos). ¿Eliminar?')) return false;
    await Store.apply([{ col: 'movimientos', del: id }, { col: 'deudas', del: m.financiadoPor }]); return true;
  }
  const rp = repostajeDeMov(m);
  const extra = rp ? '\n\nEs un repostaje: se borrarán también sus datos de litros y km.' : m.recurrenteId ? '\n\nEs un movimiento recurrente: solo se elimina este mes (no se volverá a crear). Para dejar de generarlo, edita la plantilla en «Movimientos recurrentes».' : '';
  if (!confirm('¿Eliminar este movimiento?' + extra)) return false;
  await Store.deleteMovimiento(id); return true;
}

/* ---------- Campos de financiación (compartidos por el diálogo de movimiento y el de deuda) ---------- */
function finFieldsHTML(p) {
  return `<div class="form-grid fin-fields" data-fin="${p}">
    <div><label>Medio</label><select name="medio">${Object.entries(MEDIOS_FIN).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select></div>
    <div><label>Importe financiado (€)</label><input name="principal" inputmode="decimal" placeholder="0,00"></div>
    <div><label>TIN anual (%)</label><input name="tin" inputmode="decimal" placeholder="0 si es «sin intereses»"></div>
    <div><label>Plazo (meses)</label><input name="plazo" type="number" min="1" max="600" step="1"></div>
    <div><label>Fecha primera cuota</label><input name="fechaPrimeraCuota" type="date"></div>
    <div><label>Día de cobro</label><select name="diaCobro">${opcionesDiaCobro()}</select></div>
    <div><label>Comisión de apertura (€, opcional)</label><input name="comisionApertura" inputmode="decimal" placeholder="0,00"></div>
    <div><label>Comisión mensual (€, opcional)</label><input name="comisionMensual" inputmode="decimal" placeholder="0,00"></div>
    <div><label>TAE que te indican (%, opcional)</label><input name="taeIntroducida" inputmode="decimal" placeholder="p. ej. 21,99"></div>
    <div class="full fin-preview" aria-live="polite"></div>
  </div>`;
}
function opcionesDiaCobro() {
  return Array.from({ length: 31 }, (_, i) => `<option value="${i + 1}">Día ${i + 1}</option>`).join('') + `<option value="${FC.DIA_ULTIMO}">Último día del mes</option>`;
}
const leerDiaCobro = v => v === FC.DIA_ULTIMO ? FC.DIA_ULTIMO : Number(v);
function finForm(sel) { const el = $(sel); const q = n => el.querySelector(`[name="${n}"]`); return { el, medio: q('medio'), principal: q('principal'), tin: q('tin'), plazo: q('plazo'), fechaPrimeraCuota: q('fechaPrimeraCuota'), diaCobro: q('diaCobro'), comisionApertura: q('comisionApertura'), comisionMensual: q('comisionMensual'), taeIntroducida: q('taeIntroducida'), preview: el.querySelector('.fin-preview') }; }
function setFinFields(sel, d) {
  const f = finForm(sel);
  f.medio.value = d.medio || 'otro'; f.principal.value = fmtInput(d.principal); f.tin.value = fmtInputN(d.tin ?? 0); f.plazo.value = d.plazo || 12;
  f.fechaPrimeraCuota.value = d.fechaPrimeraCuota || '';
  // Deuda existente: su día de cobro. Nueva: sigue al día de la fecha de la 1.ª cuota hasta que el usuario lo cambie.
  f.diaCobro.value = String(FC.normalizarDiaCobro(d.diaCobro, d.fechaPrimeraCuota || todayISO()));
  f.diaCobro.dataset.auto = d.diaCobro === undefined || d.diaCobro === null ? '1' : '0';
  f.comisionApertura.value = d.comisionApertura ? fmtInput(d.comisionApertura) : '';
  f.comisionMensual.value = d.comisionMensual ? fmtInput(d.comisionMensual) : ''; f.taeIntroducida.value = d.taeIntroducida === null || d.taeIntroducida === undefined ? '' : fmtInputN(d.taeIntroducida);
  previewFin(sel);
}
function leerFinFields(sel) {
  const f = finForm(sel), n = (v, def = 0) => v.trim() === '' ? def : parseImporte(v);
  const d = { medio: f.medio.value, principal: n(f.principal.value, NaN), tin: n(f.tin.value), plazo: Number(f.plazo.value), fechaPrimeraCuota: f.fechaPrimeraCuota.value, diaCobro: leerDiaCobro(f.diaCobro.value),
    comisionApertura: n(f.comisionApertura.value), comisionMensual: n(f.comisionMensual.value), taeIntroducida: f.taeIntroducida.value.trim() === '' ? null : parseImporte(f.taeIntroducida.value) };
  if (!(d.principal > 0)) d.error = 'Indica el importe financiado.';
  else if (!(d.tin >= 0) || d.tin > 100) d.error = 'El TIN debe estar entre 0 y 100 %.';
  else if (!Number.isInteger(d.plazo) || d.plazo < 1 || d.plazo > 600) d.error = 'El plazo debe ser un número de meses (1 a 600).';
  else if (!FC.isISO(d.fechaPrimeraCuota)) d.error = 'Indica la fecha de la primera cuota.';
  else if (d.diaCobro !== FC.DIA_ULTIMO && !(Number.isInteger(d.diaCobro) && d.diaCobro >= 1 && d.diaCobro <= 31)) d.error = 'Elige el día de cobro (1 a 31 o «Último día del mes»).';
  else if (!(d.comisionApertura >= 0) || !(d.comisionMensual >= 0)) d.error = 'Revisa las comisiones.';
  else if (d.taeIntroducida !== null && !isFinite(d.taeIntroducida)) d.error = 'Revisa la TAE (p. ej. 21,99).';
  // La 1.ª cuota vence en el mes indicado, en su día de cobro: se guarda esa fecha real.
  if (!d.error) d.fechaPrimeraCuota = FC.fechaCuota(d.fechaPrimeraCuota, 1, d.diaCobro);
  return d;
}
function previewFin(sel) {
  const f = finForm(sel), d = leerFinFields(sel);
  if (d.error) { f.preview.innerHTML = `<span class="muted small">${d.error === 'Indica la fecha de la primera cuota.' || d.error === 'Indica el importe financiado.' ? 'Rellena importe, TIN, plazo y fecha para ver la cuota y la TAE.' : esc(d.error)}</span>`; return; }
  const r = FC.resumenDeuda(d, [], null);
  const dif = r.diferenciaTAE;
  const f1 = r.filas[0]?.fecha, f2 = r.filas[1]?.fecha;
  f.preview.innerHTML = `<p class="small fin-fechas" style="margin:0 0 6px">📅 1.ª cuota el <strong>${fmtFecha(f1)}</strong>${f2 ? `, después ${FC.textoDiaCobro(d.diaCobro)} (2.ª: ${fmtFecha(f2)})` : ''}.</p>
    <div class="fin-kpis">
      <div><span>Cuota mensual</span><strong>${eur(r.cuota + (d.comisionMensual || 0))}</strong></div>
      <div><span>Total intereses</span><strong>${eur(r.totalIntereses)}</strong></div>
      <div><span>Coste total (intereses + comisiones)</span><strong>${eur(r.totalCoste)}</strong></div>
      <div><span>TAE calculada</span><strong>${pct(r.tae)}</strong></div>
    </div>
    ${r.taeIntroducida !== null ? `<p class="small ${Math.abs(dif) > 0.0025 ? 'warn-txt' : 'muted'}">TAE que te indican: ${pct(r.taeIntroducida)} · diferencia ${dif > 0 ? '+' : ''}${(dif * 100).toLocaleString(LOCALE, { maximumFractionDigits: 2 })} puntos${Math.abs(dif) > 0.0025 ? ' — revisa si hay comisiones o seguros que no hayas incluido.' : '.'}</p>` : ''}
    ${d.tin === 0 && r.totalCoste === 0 ? '<p class="small pos" style="margin:4px 0 0">Financiación sin intereses (TIN 0 % y sin comisiones): TAE 0 %.</p>' : ''}`;
}
['#movFin', '#deudaFin'].forEach(sel => {
  $(sel).innerHTML = finFieldsHTML(sel);
  $(sel).addEventListener('input', e => {
    const f = finForm(sel);
    if (e.target === f.diaCobro) f.diaCobro.dataset.auto = '0';
    else if (e.target === f.fechaPrimeraCuota && f.diaCobro.dataset.auto === '1' && FC.isISO(f.fechaPrimeraCuota.value)) f.diaCobro.value = String(+f.fechaPrimeraCuota.value.slice(8, 10));
    previewFin(sel);
  });
});

/* ---------- Exportar / importar ---------- */
function download(filename, content, mime) {
  const blob = new Blob([content], { type: mime }); const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = filename; document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
}
function movimientosCSV(list) {
  // Formato pensado para Excel en español: separador ";" y coma decimal
  const q = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const rows = [['Fecha', 'Tipo', 'Categoría', 'Descripción', 'Cuenta', 'Importe'].map(q).join(';')];
  [...list].sort((a, b) => a.fecha.localeCompare(b.fecha)).forEach(m => rows.push([fmtFecha(m.fecha), m.tipo, m.categoria, m.descripcion, m.cuenta, (m.tipo === 'gasto' ? -m.importe : m.importe).toFixed(2).replace('.', ',')].map(q).join(';')));
  return '\ufeff' + rows.join('\r\n');
}
$('#exportCsvBtn').addEventListener('click', () => { const l = filtrarMovimientos(); if (!l.length) return toast('No hay movimientos que exportar'); download(`movimientos-${todayISO()}.csv`, movimientosCSV(l), 'text/csv;charset=utf-8'); });
$('#exportCsvAllBtn').addEventListener('click', () => { const l = Store.getMovimientos(); if (!l.length) return toast('No hay movimientos que exportar'); download(`movimientos-${todayISO()}.csv`, movimientosCSV(l), 'text/csv;charset=utf-8'); });
$('#exportJsonBtn').addEventListener('click', () => download(`finanzas-backup-${todayISO()}.json`, Store.exportJSON(), 'application/json'));
$('#importJsonBtn').addEventListener('click', () => $('#importFile').click());
$('#importFile').addEventListener('change', async e => {
  const file = e.target.files[0]; if (!file) return;
  try {
    const text = await file.text();
    if (!confirm('Importar esta copia sustituirá TODOS los datos actuales. ¿Continuar?')) return;
    await Store.importJSON(text); applyTheme(); toast('Copia importada correctamente');
  } catch (err) { alert('No se pudo importar el archivo: ' + err.message); }
  finally { e.target.value = ''; }
});

/* ---------- Datos de ejemplo ---------- */
function generarDatosEjemplo(ym = UI.mes) {
  const hoy = todayISO();
  const movs = []; let seed = 42; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const add = (tipo, fecha, importe, categoria, descripcion, cuenta = 'Banco', extra = {}) => { const m = { id: uid(), tipo, fecha, importe: round2(importe), categoria, descripcion, cuenta, ...extra }; if (fecha <= hoy) movs.push(m); return m; };
  const desde = addMonths(ym, -11);
  // Plantillas recurrentes: la app crea sola la nómina y el alquiler de cada mes
  const recurrentes = [
    { id: uid(), tipo: 'ingreso', importe: 2150, categoria: 'Nómina', descripcion: 'Nómina mensual', cuenta: 'Banco', dia: 1, desde, tipoIngreso: 'nomina', activo: true },
    { id: uid(), tipo: 'gasto', importe: 750, categoria: 'Vivienda', descripcion: 'Alquiler piso', cuenta: 'Banco', dia: 2, desde, naturaleza: 'fijo', activo: true },
    { id: uid(), tipo: 'gasto', importe: 12.99, categoria: 'Suscripciones', descripcion: 'Netflix', cuenta: 'Tarjeta', dia: 12, desde, naturaleza: 'fijo', activo: true }
  ];
  for (let i = 11; i >= 0; i--) {
    const k = addMonths(ym, -i), d = n => `${k}-${pad(n)}`;
    if (rnd() > .5) add('ingreso', d(15), 200 + rnd() * 500, 'Freelance', 'Proyecto web', 'Banco', { tipoIngreso: 'extra' });
    if (i % 3 === 0) add('ingreso', d(20), 35 + rnd() * 30, 'Dividendos', 'Dividendos trimestrales');
    if (i === 6) add('ingreso', d(28), 1075, 'Nómina', 'Paga extra de verano', 'Banco', { tipoIngreso: 'extra' });
    add('gasto', d(5), 45 + rnd() * 25, 'Suministros', 'Luz');
    add('gasto', d(6), 18, 'Suministros', 'Agua');
    add('gasto', d(7), 35, 'Telefonía e internet', 'Fibra + móvil');
    for (let s = 0; s < 4; s++) add('gasto', d(3 + s * 7), 55 + rnd() * 45, 'Supermercado', ['Mercadona', 'HiperDino', 'Lidl', 'Alcampo'][s], s % 2 ? 'Tarjeta' : 'Banco');
    for (let s = 0; s < 3; s++) add('gasto', d(9 + s * 6), 15 + rnd() * 40, 'Restaurantes', ['Guachinche', 'Cena con amigos', 'Terraza'][s], 'Tarjeta');
    rnd();   // (antes: gasolina; ahora van como repostajes, más abajo)
    if (rnd() > .4) add('gasto', d(18), 20 + rnd() * 80, 'Ocio', 'Concierto / cine', 'Tarjeta');
    if (rnd() > .6) add('gasto', d(22), 30 + rnd() * 90, 'Ropa', 'Ropa', 'Tarjeta');
    if (i === 4) add('gasto', d(14), 420, 'Viajes', 'Vuelo a Madrid', 'Tarjeta');
  }
  // Garantías: una vigente, una a punto de caducar y una caducada
  add('gasto', FC.addMonthsISO(hoy, -14), 1099, 'Electrónica', 'Portátil', 'Tarjeta', { garantia: { anios: 3, producto: 'Portátil Lenovo IdeaPad' } });
  add('gasto', FC.addDaysISO(FC.addYearsISO(hoy, -3), 20), 549, 'Hogar', 'Lavadora', 'Banco', { garantia: { anios: 3, producto: 'Lavadora Balay 8 kg' } });
  add('gasto', FC.addDaysISO(FC.addYearsISO(hoy, -2), -12), 89.9, 'Electrónica', 'Auriculares', 'Tarjeta', { garantia: { anios: 2, producto: 'Auriculares Sony' } });
  // Compra financiada en tienda sin intereses (12 meses) y préstamo con intereses
  const deudas = [];
  const pagar = (d, hasta) => { for (const f of FC.cuadroAmortizacion(d).filas) if (f.fecha <= hasta) movs.push({ id: `cuota_${d.id}_${f.n}`, tipo: 'gasto', fecha: f.fecha, importe: f.pago, categoria: d.categoria, descripcion: `Cuota ${f.n}/${d.plazo} · ${d.nombre}`, cuenta: d.cuenta, naturaleza: 'fijo', deudaId: d.id, cuotaN: f.n, desglose: { interes: f.interes, amortizacion: f.amortizacion, comision: f.comision } }); };
  const fTv = FC.addMonthsISO(hoy, -4);
  const tv = add('gasto', fTv, 899, 'Electrónica', 'Televisor 55"', 'Tarjeta', { garantia: { anios: 3, producto: 'TV Samsung 55"' } });
  const dTv = { id: uid(), nombre: 'Televisor 55"', medio: 'tienda', principal: 899, tin: 0, plazo: 12, fechaInicio: fTv, fechaPrimeraCuota: FC.addMonthsISO(fTv, 1), comisionApertura: 0, comisionMensual: 0, taeIntroducida: 0, movimientoId: tv.id, categoria: 'Electrónica', cuenta: 'Tarjeta' };
  tv.financiadoPor = dTv.id; deudas.push(dTv); pagar(dTv, hoy);
  const fCoche = FC.addMonthsISO(hoy, -10);
  const dCoche = { id: uid(), nombre: 'Préstamo coche', medio: 'prestamo', principal: 12000, tin: 6.5, plazo: 60, fechaInicio: fCoche, fechaPrimeraCuota: FC.fechaCuota(FC.addMonthsISO(fCoche, 1), 1, FC.DIA_ULTIMO), diaCobro: FC.DIA_ULTIMO, comisionApertura: 120, comisionMensual: 0, taeIntroducida: 7.12, movimientoId: null, categoria: 'Transporte', cuenta: 'Banco' };
  deudas.push(dCoche); pagar(dCoche, FC.addMonthsISO(hoy, -1));
  // Inversiones: compras periódicas, ventas parciales (FIFO) y precios manuales
  const activos = [], operaciones = [], precios = [];
  const activo = (nombre, tipo, isin, ticker, notas = '') => { const a = { id: uid(), nombre, tipo, isin, ticker, notas }; activos.push(a); return a; };
  const op = (a, tipo, fecha, participaciones, precio, comisiones = 0) => operaciones.push({ id: uid(), activoId: a.id, tipo, fecha, participaciones, precio, comisiones, creado: operaciones.length });
  const precio = (a, fecha, p) => precios.push({ id: uid(), activoId: a.id, fecha, precio: p });
  const fondo = activo('Vanguard Global Stock Index', 'fondo', 'IE00B03HCZ61', '', 'Aportación mensual de 200 €');
  for (let i = 18; i >= 1; i--) { const p = round2(38 + (18 - i) * 0.55 + Math.sin(i) * 1.2); op(fondo, 'compra', FC.addMonthsISO(hoy, -i), round2(200 / p * 10000) / 10000, p); }
  op(fondo, 'venta', FC.addMonthsISO(hoy, -3), 15, 46.1);
  precio(fondo, FC.addMonthsISO(hoy, -1), 47.2); precio(fondo, FC.addDaysISO(hoy, -2), 48.35);
  const etf = activo('iShares Core MSCI World', 'etf', 'IE00B4L5Y983', 'IWDA', '');
  op(etf, 'compra', FC.addMonthsISO(hoy, -20), 20, 72.4, 2); op(etf, 'compra', FC.addMonthsISO(hoy, -12), 15, 80.1, 2); op(etf, 'compra', FC.addMonthsISO(hoy, -5), 10, 92.3, 2);
  op(etf, 'venta', FC.addMonthsISO(hoy, -2), 25, 98.5, 2);
  precio(etf, FC.addDaysISO(hoy, -2), 101.2);
  const btc = activo('Bitcoin', 'cripto', '', 'BTC', 'Exchange');
  op(btc, 'compra', FC.addMonthsISO(hoy, -16), 0.01, 38000, 1.5); op(btc, 'compra', FC.addMonthsISO(hoy, -8), 0.008, 61000, 1.5);
  op(btc, 'venta', FC.addMonthsISO(hoy, -1), 0.012, 89000, 2);
  precio(btc, FC.addDaysISO(hoy, -1), 92500);
  // Vehículos y repostajes (v3.3): cada repostaje lleva su gasto en «Combustible»
  const vehiculos = [
    { id: uid(), matricula: '1234KLM', nombre: 'Seat León', combustible: 'gasoil', capacidad: 50, kmIniciales: 98500, activo: true, notas: '', creado: 1 },
    { id: uid(), matricula: '5678HJT', nombre: 'Toyota Yaris', combustible: 'gasolina', capacidad: 42, kmIniciales: 41200, activo: true, notas: '', creado: 2 }
  ];
  const repostajes = [];
  const repostar = (v, cada, l100, base, gasolineras) => {
    let odo = v.kmIniciales, f = FC.addDaysISO(FC.addMonthsISO(`${desde}-01`, 0), v === vehiculos[0] ? 3 : 8), n = 0;
    while (f <= hoy) {
      const parcial = n % 7 === 5;
      const km = Math.round(cada * (0.8 + rnd() * 0.4) * (parcial ? 0.45 : 1));
      odo += km;
      const precioLitro = Math.round((base + Math.sin(n / 3) * 0.06 + n * 0.002 + rnd() * 0.03) * 1000) / 1000;
      const litros = round2(km * l100 * (0.93 + rnd() * 0.14) / 100);
      const importe = round2(litros * precioLitro), gasolinera = gasolineras[n % gasolineras.length];
      const m = add('gasto', f, importe, 'Combustible', `Combustible ${v.matricula} · ${gasolinera}`, 'Tarjeta', { naturaleza: 'variable' });
      const r = { id: uid(), vehiculoId: v.id, movimientoId: m.id, fecha: f, precioLitro, litros, importe, kmTanqueAnterior: n === 0 ? null : km, odometro: odo, lleno: !parcial, gasolinera, creado: n };
      m.repostajeId = r.id; repostajes.push(r);
      f = FC.addDaysISO(f, parcial ? 6 : Math.round(cada / 45));
      n++;
    }
  };
  repostar(vehiculos[0], 620, 5.4, 1.38, ['Repsol', 'Cepsa', 'Shell']);
  repostar(vehiculos[1], 480, 6.3, 1.49, ['BP', 'Disa']);
  return { movimientos: movs, recurrentes, deudas, activos, operaciones, precios, vehiculos, repostajes };
}
$('#sampleBtn').addEventListener('click', async () => {
  if ((Store.getMovimientos().length || Store.list('activos').length) && !confirm('Se añadirán datos de ejemplo a los que ya tienes. ¿Continuar?')) return;
  if (!Store.getCategorias('gasto').includes('Combustible')) await Store.addCategoria('gasto', 'Combustible');
  await Store.addMany(generarDatosEjemplo()); toast('Datos de ejemplo cargados'); showView('resumen');
});
$('#resetBtn').addEventListener('click', async () => {
  if (!confirm('¿Borrar TODOS los movimientos, deudas, inversiones, adjuntos y categorías personalizadas? Si usas Google Drive, se borrarán también en tus otros dispositivos. Esta acción no se puede deshacer (exporta antes una copia).')) return;
  await Store.reset(); toast('Datos borrados');
});

/* ---------- Eventos generales ---------- */
$$('nav.tabs button').forEach(b => b.addEventListener('click', () => showView(b.dataset.view)));
$('#prevMonth').addEventListener('click', () => setMes(addMonths(UI.mes, -1)));
$('#nextMonth').addEventListener('click', () => setMes(addMonths(UI.mes, 1)));
$('#monthInput').addEventListener('change', e => { if (/^\d{4}-\d{2}$/.test(e.target.value)) setMes(e.target.value); });
$('#themeBtn').addEventListener('click', async () => {
  const order = ['auto', 'light', 'dark'], next = order[(order.indexOf(Store.state.ajustes.tema) + 1) % 3];
  await Store.setAjuste('tema', next); applyTheme(); Object.values(UI.charts).forEach(c => c.destroy()); UI.charts = {}; renderAll(); toast('Tema: ' + ({ auto: 'automático', light: 'claro', dark: 'oscuro' }[next]));
});
window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { if (Store.state.ajustes.tema === 'auto') { applyTheme(); Object.values(UI.charts).forEach(c => c.destroy()); UI.charts = {}; renderAll(); } });
['#fTexto', '#fPeriodo', '#fTipo', '#fCategoria'].forEach(s => $(s).addEventListener('input', renderMovimientos));
$('#addMovBtn').addEventListener('click', () => openMovDialog());
$('#fabAdd').addEventListener('click', () => openMovDialog());
document.addEventListener('click', async e => {
  const t = e.target.closest('button'); if (!t) return;
  if (t.dataset.editMov) openMovDialog(Store.getMovimientos().find(m => m.id === t.dataset.editMov));
  if (t.dataset.delMov && await confirmarBorrarMov(t.dataset.delMov)) toast('Movimiento eliminado');
  if (t.dataset.addcat) {
    const tipo = t.dataset.addcat, input = tipo === 'gasto' ? $('#newCatGasto') : $('#newCatIngreso');
    if (await Store.addCategoria(tipo, input.value)) { input.value = ''; toast('Categoría añadida'); } else toast('Nombre vacío o repetido');
  }
  if (t.dataset.renameCat) {
    const nuevo = prompt('Nuevo nombre para la categoría:', t.dataset.cat);
    if (nuevo !== null) { if (await Store.renameCategoria(t.dataset.renameCat, t.dataset.cat, nuevo)) toast('Categoría renombrada'); else if (nuevo.trim() !== t.dataset.cat) toast('Nombre vacío o repetido'); }
  }
  if (t.dataset.delCat) {
    const tipo = t.dataset.delCat, c = t.dataset.cat, n = Store.countUsoCategoria(tipo, c);
    if (c === 'Otros' && n) return toast('«Otros» está en uso y no se puede eliminar');
    if (confirm(n ? `«${c}» tiene ${n} movimiento(s). Se moverán a «Otros». ¿Eliminar?` : `¿Eliminar la categoría «${c}»?`)) { await Store.deleteCategoria(tipo, c); toast('Categoría eliminada'); }
  }
});
['#newCatGasto', '#newCatIngreso'].forEach(s => $(s).addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); e.target.nextElementSibling.click(); } }));
window.addEventListener('storage', e => { if (e.key === localCache.key && e.newValue) { try { Store.replaceState(JSON.parse(e.newValue)); Store.state.ajustes = normalizeState(JSON.parse(e.newValue)).ajustes; applyTheme(); renderAll(); } catch { /* nada */ } } }); // sincroniza pestañas

/* =========================================================
   Cuenta de Google y sincronización
   ========================================================= */
const CONFIG = window.FINANZAS_CONFIG || {};
const SYNC_TXT = {
  local: ['Solo local', 'Los datos se guardan solo en este navegador.'],
  idle: ['Conectando…', 'Preparando la sincronización con Google Drive.'],
  syncing: ['Sincronizando…', 'Guardando y leyendo tus datos en Google Drive.'],
  synced: ['Sincronizado', 'Tus datos están guardados en tu Google Drive.'],
  offline: ['Sin conexión', 'Sin conexión: los cambios se guardan aquí y se subirán al volver la conexión.'],
  error: ['Error', 'No se pudo sincronizar con Google Drive.'],
  auth: ['Reconectar', 'La sesión de Google ha caducado. Pulsa para reconectar.']
};
/* Archivos adjuntos en Drive (uno por adjunto, aparte del JSON) */
const FileSync = {
  impl: null,
  _get() {
    if (!this.impl) this.impl = Adjuntos.createFileSync({
      client: { // Sync.client se crea en Sync.setup(); solo se usa con sesión iniciada
        findByName: n => Sync.client.findByName(n), uploadBlob: (...a) => Sync.client.uploadBlob(...a),
        downloadBlob: id => Sync.client.downloadBlob(id), remove: id => Sync.client.remove(id)
      },
      listar: () => Store.state.adjuntos,
      activo: () => Sync.active && Auth.tokenValid && navigator.onLine,
      storage: localStorage,
      setDriveId: async (id, driveId) => {
        const a = Store.state.adjuntos.find(x => x.id === id);
        if (a && !a.deleted) await Store.put('adjuntos', { ...a, driveId });
        else if (a) { a.driveId = driveId; await Store.persist(); } // se borró mientras se subía: la lápida lo eliminará de Drive
      }
    });
    return this.impl;
  },
  run() { return this._get().run().catch(e => console.info('Adjuntos: no se pudieron sincronizar', e.message)); },
  obtener(a) { return this._get().obtener(a); },
  get stats() { return this._get().stats; }
};

const Sync = {
  status: 'local', detail: '', drive: null, client: null, pollTimer: null,
  get active() { return !!(Auth.enabled && Auth.user && this.drive); },
  setup() {
    if (!Auth.enabled) return;
    this.client = FinanzasStorage.createDriveClient({
      fetchFn: (url, opts) => fetch(url, opts),
      getToken: () => Auth.getToken(),
      fileName: CONFIG.DRIVE_FILE_NAME || 'finanzas.json'
    });
    this.drive = new FinanzasStorage.DriveAdapter({
      cache: localCache, client: this.client,
      isOnline: () => navigator.onLine,
      debounceMs: CONFIG.SYNC_DEBOUNCE_MS || 2000,
      onStatus: (s, d) => { if (s === 'auth') Auth.invalidateToken(); this.set(s, d); },
      onRemoteData: doc => Store.replaceState(doc),
      onSynced: () => FileSync.run().then(() => { if (window.Analisis) Analisis.programar(); if ($('#view-ajustes').classList.contains('active')) renderAjustes(); })
    });
    if (Auth.user) { Store.setAdapter(this.drive); this.set(Auth.needsReauth ? 'auth' : (navigator.onLine ? 'idle' : 'offline')); }
    window.addEventListener('online', () => this.now());
    window.addEventListener('offline', () => { if (this.active) this.set('offline'); });
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') this.now(); });
    this.pollTimer = setInterval(() => { if (document.visibilityState === 'visible') this.now(); }, CONFIG.SYNC_POLL_MS || 300000);
  },
  set(s, d = '') { this.status = s; this.detail = d; renderSync(); },
  /** Sincroniza si hay sesión y token; si no, deja el estado adecuado. */
  async now({ force = false, manual = false } = {}) {
    if (!this.active) return null;
    if (!Auth.tokenValid) { this.set('auth'); if (manual) await reconnect(); return null; }
    const r = await this.drive.sync({ force });
    if (manual) toast(r.ok ? 'Sincronizado con Google Drive' : (this.status === 'offline' ? 'Sin conexión: se sincronizará más tarde' : 'Error al sincronizar: ' + (r.error && r.error.message || '')));
    return r;
  }
};

async function reconnect() {
  try { await Auth._request(''); toast('Sesión renovada'); await Sync.now({ force: true }); }
  catch (e) { toast(e.message); }
}

async function signIn() {
  try {
    const before = localCache.getMeta();
    const { user } = await Auth.signIn(() => Sync.client.about());
    const local = localCache.load();
    const hayLocal = SyncCore.hasData(local);
    if (before.account && before.account !== user.email && hayLocal) {
      const combinar = confirm(`Los datos de este dispositivo se sincronizaron antes con otra cuenta (${before.account}).\n\nAceptar: combinarlos con ${user.email}.\nCancelar: descartarlos aquí y usar solo los de ${user.email}.`);
      if (!combinar) { localCache.clear(); Store.replaceState(emptyState()); }
    }
    if (before.account !== user.email) localCache.resetMeta();
    localCache.setMeta({ account: user.email, dirty: SyncCore.hasData(localCache.load()) });
    Store.setAdapter(Sync.drive);
    const r = await Sync.now({ force: true });
    if (r && r.ok) toast(hayLocal && (!before.account || before.account === user.email) ? 'Sesión iniciada: tus datos se han guardado en tu Google Drive' : 'Sesión iniciada como ' + user.email);
  } catch (e) {
    toast(e.message || 'No se pudo iniciar sesión');
    renderSync();
  }
}

async function signOut() {
  if (!confirm('¿Cerrar sesión de Google en esta app?')) return;
  if (Sync.drive && Sync.drive.pending && !confirm('Hay cambios que aún no se han subido a Google Drive y se quedarían solo en este dispositivo. ¿Cerrar sesión igualmente?')) return;
  if (Sync.drive) Sync.drive.stop();
  Auth.signOut();
  Store.setAdapter(localAdapter);
  if (confirm('¿Borrar también la copia de los datos guardada en este dispositivo?\n\nTus datos siguen a salvo en tu Google Drive. Recomendado si este dispositivo es compartido.')) {
    localCache.clear(); localStorage.removeItem(LEGACY_KEY); Store.replaceState(emptyState());
  }
  Sync.set('local'); toast('Sesión cerrada');
}

function fmtHora(ts) {
  if (!ts) return 'nunca';
  return new Date(ts).toLocaleString(LOCALE, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

function renderSync() {
  const enabled = Auth.enabled, user = Auth.user;
  let s = !enabled || !user ? 'local' : (Auth.needsReauth ? 'auth' : Sync.status);
  if (s === 'local' && user) s = 'idle';
  const [label, help] = SYNC_TXT[s] || SYNC_TXT.error;
  const meta = localCache.getMeta();
  const pend = Sync.drive && Sync.drive.pending && user;
  const chip = $('#syncChip');
  chip.hidden = !enabled;
  chip.dataset.status = s;
  chip.querySelector('.txt').textContent = label + (pend && s === 'offline' ? ' · cambios pendientes' : '');
  chip.title = help + (Sync.detail && (s === 'error' || s === 'auth') ? '\n' + Sync.detail : '') + (user ? '\nÚltima sincronización: ' + fmtHora(meta.lastSyncAt) : '');
  chip.setAttribute('aria-label', 'Estado de sincronización: ' + label);
  // Botón de entrar / avatar
  $('#loginBtn').hidden = !enabled || !!user;
  $('#loginBtn').disabled = !Auth.gisReady;
  $('#loginBtn').title = Auth.gisError || (Auth.gisReady ? 'Guarda tus datos en tu propio Google Drive' : 'Cargando Google…');
  $('#userMenu').hidden = !user;
  if (user) {
    const img = $('#avatarImg'), ini = $('#avatarInitial');
    if (user.photo) { if (img.getAttribute('src') !== user.photo) img.src = user.photo; img.hidden = false; ini.hidden = true; }
    else { img.hidden = true; ini.hidden = false; ini.textContent = (user.name || user.email || '?').trim()[0].toUpperCase(); }
    $('#avatarBtn').title = user.email;
    $('#userName').textContent = user.name || '';
    $('#userEmail').textContent = user.email;
    $('#lastSync').textContent = label + ' · última sincronización: ' + fmtHora(meta.lastSyncAt);
  }
  // Aviso de modo local
  const notice = $('#localNotice');
  notice.hidden = enabled || localStorage.getItem('finanzas_notice_ok') === '1';
  renderAccountCard(s, label, help, meta);
}

function renderAccountCard(s, label, help, meta) {
  const el = $('#accountCard'); if (!el) return;
  const user = Auth.user;
  let html = '<h3>Cuenta y sincronización</h3>';
  if (!Auth.enabled) {
    html += `<p><span class="sync-dot" data-status="local"></span> <strong>Modo local.</strong> Los datos se guardan solo en este navegador.</p>
      <p class="muted small">Para guardarlos en tu propio Google Drive y usarlos en varios dispositivos, pon tu ID de cliente de Google en <code>js/config.js</code> (<code>GOOGLE_CLIENT_ID</code>). Los pasos están en <code>SETUP.md</code>.</p>`;
  } else if (!user) {
    html += `<p>No has iniciado sesión: los datos se guardan solo en este navegador.</p>
      <p class="muted small">Al entrar con Google, la app guarda un único archivo privado (<code>${esc(CONFIG.DRIVE_FILE_NAME || 'finanzas.json')}</code>) en una carpeta oculta de <strong>tu</strong> Google Drive que solo esta app puede ver. No tiene acceso al resto de tus archivos.</p>
      <button class="btn btn-primary" data-auth-action="login" ${Auth.gisReady ? '' : 'disabled'}>Entrar con Google</button>
      ${Auth.gisError ? `<p class="small" style="color:var(--danger)">${esc(Auth.gisError)}</p>` : ''}`;
  } else {
    html += `<p><span class="sync-dot" data-status="${s}"></span> <strong>${esc(label)}</strong> · ${esc(user.email)}</p>
      <p class="muted small">${esc(help)}${Sync.detail && (s === 'error' || s === 'auth') ? ' (' + esc(Sync.detail) + ')' : ''}<br>Última sincronización: ${esc(fmtHora(meta.lastSyncAt))}${Sync.drive && Sync.drive.pending ? ' · hay cambios pendientes de subir' : ''}</p>
      <div class="row-actions">
        ${s === 'auth' ? '<button class="btn btn-primary" data-auth-action="reconnect">Reconectar</button>' : '<button class="btn" data-auth-action="sync">Sincronizar ahora</button>'}
        <button class="btn btn-danger" data-auth-action="logout">Cerrar sesión</button>
      </div>`;
  }
  if (el.innerHTML !== html) el.innerHTML = html;
}

// Acciones (botones con data-auth-action, chip y menú)
document.addEventListener('click', e => {
  const a = e.target.closest('[data-auth-action]');
  const pop = $('#userPop');
  if (!e.target.closest('#userMenu')) pop.hidden = true;
  if (!a) return;
  const act = a.dataset.authAction;
  if (act === 'login') signIn();                          // sin await previo: el popup debe abrirse dentro del clic
  else if (act === 'reconnect') reconnect();
  else if (act === 'sync') { pop.hidden = true; Sync.now({ force: true, manual: true }); }
  else if (act === 'logout') { pop.hidden = true; signOut(); }
  else if (act === 'menu') pop.hidden = !pop.hidden;
  else if (act === 'chip') {
    if (!Auth.user) { if (Auth.enabled) signIn(); else showView('ajustes'); }
    else if (Auth.needsReauth) reconnect();
    else Sync.now({ force: true, manual: true });
  }
});
document.addEventListener('keydown', e => { if (e.key === 'Escape') $('#userPop').hidden = true; });
$('#localNoticeClose').addEventListener('click', () => { localStorage.setItem('finanzas_notice_ok', '1'); renderSync(); });
Auth.onChange(() => {
  if (Auth.user && Auth.tokenValid && ['auth', 'idle'].includes(Sync.status) && Store.adapter === Sync.drive) Sync.now(); // token renovado: sincronizar lo pendiente
  else renderSync();
});

