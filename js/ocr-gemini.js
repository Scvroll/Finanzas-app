/* =========================================================
   Proveedor de OCR con IA: Google Gemini API (nivel GRATUITO).
   - La clave la pone el usuario y se guarda SOLO en este dispositivo
     (localStorage). No se sincroniza con Drive ni va en las copias.
   - API: Interactions API (POST /v1beta/interactions, cabecera x-goog-api-key),
     salida estructurada JSON con esquema. Documentación:
     https://ai.google.dev/gemini-api/docs/interactions
     https://ai.google.dev/gemini-api/docs/structured-output
   - Si no hay clave, no hay conexión o falla, OCR.leer() usa Tesseract.
   - Aviso: en el nivel gratuito Google puede usar lo que envías para
     mejorar sus productos (salvo usuarios del EEE/Suiza/Reino Unido,
     según sus condiciones). Se muestra al usuario en Ajustes.
   ========================================================= */
(function (root) {
  'use strict';
  const KEY = 'finanzas_gemini_key', MODEL_KEY = 'finanzas_gemini_modelo', PREF_KEY = 'finanzas_ocr_proveedor';
  const ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/interactions';
  const MODELOS = {
    'gemini-3.5-flash-lite': 'Gemini 3.5 Flash-Lite (rápido, recomendado)',
    'gemini-3.8-flash': 'Gemini 3.8 Flash (más preciso, más lento)'
  };
  const MODELO_DEFECTO = 'gemini-3.5-flash-lite';
  const ls = () => { try { return root.localStorage; } catch { return null; } };

  const num = d => ({ type: ['number', 'null'], description: d });
  const str = d => ({ type: ['string', 'null'], description: d });
  const ESQUEMA = {
    type: 'object',
    properties: {
      tipo_documento: { type: 'string', enum: ['ticket', 'factura', 'nomina', 'otro'], description: 'Tipo de documento' },
      texto: { type: 'string', description: 'Transcripción literal del texto visible, línea a línea' },
      fecha: str('Fecha del documento en formato AAAA-MM-DD (en nóminas, la fecha de pago o el último día del periodo)'),
      comercio: str('Nombre del comercio o emisor (tickets y facturas)'),
      total: num('Importe total pagado en euros (tickets y facturas)'),
      iva: num('Cuota total de IVA/IGIC en euros, si aparece'),
      conceptos: { type: 'array', maxItems: 30, items: { type: 'object', properties: { descripcion: { type: 'string' }, importe: num('Importe de la línea') }, required: ['descripcion'] } },
      garantia_producto: str('Si es la compra de un producto duradero (electrónica, electrodoméstico, mueble…), su nombre para registrar la garantía; si no, null'),
      garantia_anios: num('Años de garantía si el documento lo indica; si no, null'),
      empresa: str('Nóminas: nombre de la empresa'),
      periodo: str('Nóminas: periodo de liquidación tal como aparece (p. ej. "01/03/2026 - 31/03/2026" o "marzo 2026")'),
      bruto: num('Nóminas: total devengado (bruto) en euros'),
      liquido: num('Nóminas: líquido a percibir en euros'),
      retencion_irpf: num('Nóminas: importe retenido de IRPF en euros'),
      irpf_pct: num('Nóminas: porcentaje de IRPF'),
      seguridad_social: num('Nóminas: total de cotizaciones del trabajador a la Seguridad Social en euros'),
      categoria: str('La categoría más adecuada de la lista dada, o null')
    },
    required: ['tipo_documento', 'texto']
  };

  function aBase64(blob) {
    return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(',')[1] || ''); r.onerror = () => rej(r.error); r.readAsDataURL(blob); });
  }
  /** Extrae el texto de la respuesta (Interactions API; tolera también el formato antiguo generateContent). */
  function textoRespuesta(j) {
    if (!j) return '';
    if (typeof j.output_text === 'string') return j.output_text;
    const partes = [];
    for (const s of j.steps || j.outputs || []) {
      if (s.type && s.type !== 'model_output' && s.type !== 'text') continue;
      if (typeof s.text === 'string') partes.push(s.text);
      for (const c of s.content || []) if (c.type === 'text' && typeof c.text === 'string') partes.push(c.text);
    }
    if (!partes.length) for (const c of j.candidates || []) for (const p of (c.content && c.content.parts) || []) if (p.text) partes.push(p.text);
    return partes.join('');
  }
  function errorAPI(status, j) {
    const m = j && j.error && j.error.message ? j.error.message : '';
    if (status === 400 && /api key/i.test(m)) return 'La clave de Gemini no es válida. Revísala en Ajustes.';
    if (status === 401 || status === 403) return 'La clave de Gemini no es válida o no tiene permiso (' + status + ').';
    if (status === 429) return 'Has alcanzado el límite gratuito de Gemini por ahora. Prueba más tarde.';
    return 'Error de Gemini (' + status + ')' + (m ? ': ' + m : '');
  }
  const n = v => (typeof v === 'number' && isFinite(v) ? Math.round(v * 100) / 100 : null);
  const s = v => (typeof v === 'string' && v.trim() ? v.trim() : null);
  const fechaOK = v => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);

  /** Convierte la respuesta de Gemini a los campos que usa la app (mismo formato que FinanceCore.analizarTexto). */
  function aCampos(d, categorias) {
    const nom = d.tipo_documento === 'nomina';
    const cat = s(d.categoria);
    return {
      tipo: nom ? 'nomina' : 'ticket',
      importe: nom ? n(d.liquido) : n(d.total),
      fecha: fechaOK(d.fecha),
      comercio: nom ? null : s(d.comercio),
      empresa: nom ? s(d.empresa) : null,
      liquido: nom ? n(d.liquido) : null,
      devengado: nom ? n(d.bruto) : null,
      deducciones: null,
      irpf: nom ? n(d.retencion_irpf) : null,
      irpfPct: nom ? n(d.irpf_pct) : null,
      seguridadSocial: nom ? n(d.seguridad_social) : null,
      periodo: nom ? s(d.periodo) : null,
      iva: nom ? null : n(d.iva),
      conceptos: Array.isArray(d.conceptos) ? d.conceptos.filter(c => c && s(c.descripcion)).slice(0, 30).map(c => ({ descripcion: s(c.descripcion), importe: n(c.importe) })) : [],
      garantia: !nom && s(d.garantia_producto) ? { producto: s(d.garantia_producto), anios: n(d.garantia_anios) } : null,
      categoria: cat && (!categorias || categorias.includes(cat)) ? cat : null
    };
  }

  const gemini = {
    id: 'gemini', nombre: 'Google Gemini (IA, nivel gratuito, con tu clave)', gratuito: true, remoto: true,
    MODELOS, MODELO_DEFECTO, ENDPOINT, ESQUEMA, aCampos, textoRespuesta,
    fetchFn: (...a) => root.fetch(...a),
    get clave() { const l = ls(); return (l && l.getItem(KEY)) || ''; },
    set clave(v) { const l = ls(); if (!l) return; v = String(v || '').trim(); if (v) l.setItem(KEY, v); else l.removeItem(KEY); },
    get modelo() { const l = ls(); const m = l && l.getItem(MODEL_KEY); return MODELOS[m] ? m : MODELO_DEFECTO; },
    set modelo(v) { const l = ls(); if (l) l.setItem(MODEL_KEY, MODELOS[v] ? v : MODELO_DEFECTO); },
    disponible() { return !!this.clave && (typeof navigator === 'undefined' || navigator.onLine !== false); },
    admite: mime => /^image\/(jpeg|png|webp|heic|heif)$/.test(mime || '') || mime === 'application/pdf',
    async _llamar(input, esquema) {
      const body = { model: this.modelo, input, store: false };
      if (esquema) body.response_format = { type: 'text', mime_type: 'application/json', schema: esquema };
      let res;
      try { res = await this.fetchFn(ENDPOINT, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': this.clave }, body: JSON.stringify(body) }); }
      catch { throw new Error('No se pudo conectar con Gemini (¿sin conexión?)'); }
      let j = null; try { j = await res.json(); } catch { /* sin cuerpo */ }
      if (!res.ok) { const e = new Error(errorAPI(res.status, j)); e.status = res.status; throw e; }
      const t = textoRespuesta(j);
      if (!esquema) return t;
      try { return JSON.parse(t.replace(/^```(?:json)?\s*|\s*```$/g, '')); } catch { throw new Error('Gemini devolvió una respuesta que no se pudo interpretar'); }
    },
    async reconocer(blob, { onProgress, tipo, categorias } = {}) {
      if (!this.clave) throw new Error('Falta la clave de Gemini');
      onProgress && onProgress({ estado: 'Enviando la imagen a Gemini…', progreso: 0.2 });
      const data = await aBase64(blob);
      const prompt = [
        'Eres un asistente que extrae datos de documentos financieros españoles (tickets, facturas y nóminas). Los importes están en euros con coma decimal.',
        'Devuelve SOLO el JSON del esquema. Usa null cuando un dato no aparezca; no inventes datos.',
        tipo ? `El usuario indica que el documento es: ${tipo}.` : 'Primero identifica el tipo de documento.',
        categorias && categorias.length ? `Categorías posibles para "categoria": ${categorias.join(', ')}.` : ''
      ].filter(Boolean).join('\n');
      const parte = blob.type === 'application/pdf' ? { type: 'document', data, mime_type: 'application/pdf' } : { type: 'image', data, mime_type: blob.type };
      onProgress && onProgress({ estado: 'Gemini está leyendo el documento…', progreso: 0.5 });
      const d = await this._llamar([{ type: 'text', text: prompt }, parte], ESQUEMA);
      onProgress && onProgress({ estado: 'Listo', progreso: 1 });
      return { texto: typeof d.texto === 'string' ? d.texto : '', confianza: null, campos: aCampos(d, categorias), bruto: d };
    },
    /** Sugiere categoría (y si es fijo o variable) para un movimiento. */
    async sugerirCategoria({ tipo, descripcion, importe, cuenta, categorias }) {
      const esq = { type: 'object', properties: { categoria: { type: 'string', enum: categorias }, naturaleza: { type: 'string', enum: ['fijo', 'variable', 'no aplica'] }, motivo: { type: 'string', description: 'Motivo breve en español' } }, required: ['categoria'] };
      const d = await this._llamar([{ type: 'text', text: `Clasifica este ${tipo === 'ingreso' ? 'ingreso' : 'gasto'} personal (España) en UNA de estas categorías: ${categorias.join(', ')}.\nDescripción: "${descripcion}". Importe: ${importe ?? 'desconocido'} €.${cuenta ? ' Cuenta: ' + cuenta + '.' : ''}\nSi es un gasto, indica también si es fijo (se repite cada mes: alquiler, suministros, suscripciones, cuotas) o variable.` }], esq);
      return { categoria: categorias.includes(d.categoria) ? d.categoria : null, naturaleza: d.naturaleza === 'fijo' || d.naturaleza === 'variable' ? d.naturaleza : null, motivo: s(d.motivo), proveedor: 'gemini' };
    },
    /** Comprueba la clave con una petición mínima. */
    async probar() { const t = await this._llamar([{ type: 'text', text: 'Responde solo: OK' }]); return (t || '').trim().slice(0, 40) || 'OK'; }
  };

  const OCR = root.OCR;
  OCR.registrar(gemini);
  // Preferencia del usuario (solo en este dispositivo)
  Object.defineProperty(OCR, 'preferido', {
    get() { const l = ls(); const p = l && l.getItem(PREF_KEY); return p === 'gemini' ? 'gemini' : 'tesseract'; },
    set(v) { const l = ls(); if (l) l.setItem(PREF_KEY, v === 'gemini' ? 'gemini' : 'tesseract'); }
  });
  /** Orden de proveedores a probar: el preferido (si está disponible) y Tesseract como respaldo. */
  OCR.cadena = function () {
    const out = [];
    if (this.preferido === 'gemini' && gemini.disponible()) out.push(gemini);
    out.push(this.proveedores.tesseract);
    return out;
  };
  Object.defineProperty(OCR, 'proveedor', { get() { return this.cadena()[0]; }, configurable: true });
  OCR.admite = function (mime) { return this.cadena().some(p => p.admite(mime)); };
  OCR.leer = async function (blob, { tipo = null, onProgress, categorias } = {}) {
    let aviso = null, ultimoError = null;
    for (const p of this.cadena()) {
      if (!p.admite(blob.type)) continue;
      try {
        const r = await p.reconocer(blob, { onProgress, tipo, categorias });
        const campos = r.campos || root.FinanceCore.analizarTexto(r.texto, tipo);
        return { texto: r.texto, confianza: r.confianza, proveedor: p.id, campos, aviso, fecha: new Date().toISOString() };
      } catch (e) {
        ultimoError = e;
        if (p.remoto) { aviso = e.message + ' Se ha usado el lector del navegador.'; console.info('OCR remoto falló, se usa Tesseract:', e.message); }
        else throw e;
      }
    }
    if (ultimoError && !aviso) throw ultimoError;
    throw new Error(blob.type === 'application/pdf' ? 'Los PDF solo se pueden leer con Gemini (Ajustes). Si no, adjunta una foto o captura del documento.' : (ultimoError ? ultimoError.message : 'Este tipo de archivo no se puede leer'));
  };
  /** Sugerencia de categoría: Gemini si está configurado; si no (o falla), según tus movimientos anteriores. */
  OCR.sugerirCategoria = async function (datos, historial = []) {
    if (this.preferido === 'gemini' && gemini.disponible()) {
      try { const r = await gemini.sugerirCategoria(datos); if (r.categoria) return r; } catch (e) { console.info('Sugerencia con Gemini falló:', e.message); }
    }
    return sugerirLocal(datos, historial);
  };
  const norm = t => String(t || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
  /** Sin IA: busca movimientos anteriores con descripción parecida y usa su categoría más frecuente. */
  function sugerirLocal({ tipo, descripcion, categorias }, historial) {
    const q = norm(descripcion); if (!q) return { categoria: null, proveedor: 'local' };
    const palabras = q.split(' ').filter(w => w.length > 2);
    const votos = {};
    for (const m of historial) {
      if (m.tipo !== tipo || !categorias.includes(m.categoria)) continue;
      const d = norm(m.descripcion); if (!d) continue;
      const peso = d === q ? 5 : palabras.filter(w => d.includes(w)).length;
      if (peso) { const v = votos[m.categoria] || (votos[m.categoria] = { p: 0, fijo: 0, n: 0 }); v.p += peso; v.n++; if (m.naturaleza === 'fijo') v.fijo++; }
    }
    const mejor = Object.entries(votos).sort((a, b) => b[1].p - a[1].p)[0];
    if (!mejor) return { categoria: null, proveedor: 'local' };
    return { categoria: mejor[0], naturaleza: tipo === 'gasto' ? (mejor[1].fijo * 2 > mejor[1].n ? 'fijo' : 'variable') : null, motivo: 'Según tus movimientos anteriores parecidos', proveedor: 'local' };
  }
  OCR.sugerirLocal = sugerirLocal;
  root.OCRGemini = gemini;
})(typeof self !== 'undefined' ? self : globalThis);
