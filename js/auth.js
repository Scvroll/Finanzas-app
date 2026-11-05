/* =========================================================
   Inicio de sesión con Google Identity Services (GIS),
   modelo "token client": todo en el navegador, sin backend.
   - Pide SOLO el permiso drive.appdata.
   - El token de acceso dura ~1 h. Se guarda en sessionStorage
     (se borra al cerrar la pestaña) para no pedirlo en cada recarga.
   - Renovación "silenciosa": cuando el token está a punto de caducar
     (o ha caducado), en el siguiente clic del usuario se pide uno
     nuevo con prompt:'' (sin pantalla de consentimiento; Google abre
     y cierra un popup al instante). Si no se puede, se muestra el
     botón «Reconectar».
   - PWA instalada (standalone) y cuando el popup falla: OAuth 2.0
     implícito por redirección (response_type=token). Los datos de la
     app viven en localStorage y sobreviven a la ida y vuelta.
   ========================================================= */
(function (root) {
  'use strict';
  const CFG = root.FINANZAS_CONFIG || {};
  const USER_KEY = 'finanzas_auth';        // localStorage: {email, name, photo} de la última cuenta
  const TOKEN_KEY = 'finanzas_token';      // sessionStorage: {access_token, expiresAt}
  const EXTRA_KEY = 'finanzas_scopes_extra'; // localStorage: permisos opcionales que el usuario activó (p. ej. drive.file)
  const OAUTH_STATE_KEY = 'finanzas_oauth_state';   // localStorage: state CSRF de la redirección
  const OAUTH_PENDING_KEY = 'finanzas_oauth_pending'; // localStorage: {kind, prompt, extraScope, ts}
  const REFRESH_MARGIN_MS = 5 * 60 * 1000;
  const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';

  const listeners = [];
  const Auth = {
    enabled: !!CFG.GOOGLE_CLIENT_ID,
    gisReady: false,
    gisError: null,
    user: null,             // {email, name, photo}
    token: null, expiresAt: 0, granted: '',
    needsReauth: false,
    /** Resultado de una vuelta por redirección OAuth, o null. {ok, kind, error?} */
    redirectResult: null,
    _client: null, _pending: null, _refreshing: false,

    onChange(fn) { listeners.push(fn); },
    _emit() { listeners.forEach(fn => { try { fn(Auth); } catch (e) { console.error(e); } }); },

    get signedIn() { return !!this.user; },
    get tokenValid() { return !!this.token && Date.now() < this.expiresAt - 30 * 1000; },

    /** PWA instalada (Android/iOS/desktop): el popup de GIS no puede hablar con el opener. */
    isStandalone() {
      try {
        if (root.matchMedia && root.matchMedia('(display-mode: standalone)').matches) return true;
        if (root.matchMedia && root.matchMedia('(display-mode: window-controls-overlay)').matches) return true;
      } catch { /* sin matchMedia */ }
      return !!(root.navigator && root.navigator.standalone);
    },

    /** URI de redirección exacta (debe coincidir con Google Cloud). */
    redirectUri() {
      const path = (root.location && root.location.pathname) || '/';
      if (/\/index\.html$/i.test(path)) return root.location.origin + path.replace(/index\.html$/i, '');
      if (path.endsWith('/')) return root.location.origin + path;
      return root.location.origin + path + '/';
    },

    /** Móvil (Chrome Android incluido): el popup de GIS suele cerrarse sin entregar el token. */
    isMobile() {
      try { return /Android|iPhone|iPad|iPod|Mobile/i.test((root.navigator && root.navigator.userAgent) || ''); }
      catch { return false; }
    },

    /** ¿Usar redirección en lugar del popup? PWA instalada o cualquier móvil. */
    usesRedirect() { return this.isStandalone() || this.isMobile(); },

    init() {
      this.redirectResult = this._consumeRedirectHash(); // antes de que main.js lea location.hash para la vista
      try { this.user = JSON.parse(localStorage.getItem(USER_KEY)); } catch { this.user = null; }
      try {
        const t = JSON.parse(sessionStorage.getItem(TOKEN_KEY));
        if (t && t.access_token && Date.now() < t.expiresAt - 30 * 1000) {
          this.token = t.access_token; this.expiresAt = t.expiresAt; this.granted = t.scope || CFG.DRIVE_SCOPE;
        }
      } catch { /* nada */ }
      if (!this.enabled) { this.user = null; return; }
      if (this.user && !this.tokenValid) this.needsReauth = true;
      this._loadGis();
      // Renovación oportunista dentro de un gesto del usuario (los navegadores bloquean popups sin gesto).
      // En standalone NO redirigimos aquí: interrumpiría la edición; se muestra «Reconectar».
      document.addEventListener('click', e => {
        if (!this.user || this._refreshing || this._pending) return;
        if (e.target.closest && e.target.closest('[data-auth-action]')) return;
        if (!(this.needsReauth || (this.token && this.expiresAt - Date.now() < REFRESH_MARGIN_MS))) return;
        if (this.usesRedirect()) { this.needsReauth = true; this._emit(); return; }
        if (!this.gisReady) return;
        this.refreshSilently();
      }, true);
    },

    _loadGis() {
      if (root.google && root.google.accounts && root.google.accounts.oauth2) return this._initClient();
      const s = document.createElement('script');
      s.src = 'https://accounts.google.com/gsi/client'; s.async = true; s.defer = true;
      s.onload = () => this._initClient();
      s.onerror = () => { this.gisError = 'No se pudo cargar el inicio de sesión de Google (¿sin conexión?)'; this._emit(); };
      document.head.appendChild(s);
    },

    _initClient() {
      try {
        this._client = google.accounts.oauth2.initTokenClient({
          client_id: CFG.GOOGLE_CLIENT_ID,
          scope: CFG.DRIVE_SCOPE,
          callback: resp => this._onToken(resp),
          error_callback: err => this._onTokenError(err)
        });
        this.gisReady = true; this.gisError = null;
      } catch (e) { this.gisError = 'Error al iniciar Google Identity Services: ' + e.message; }
      this._emit();
    },

    /** Permisos opcionales activados en este dispositivo (además de drive.appdata). */
    get scopesExtra() { try { return JSON.parse(localStorage.getItem(EXTRA_KEY)) || []; } catch { return []; } },
    _setScopesExtra(l) { if (l.length) localStorage.setItem(EXTRA_KEY, JSON.stringify(l)); else localStorage.removeItem(EXTRA_KEY); },
    get _scopeStr() { return [CFG.DRIVE_SCOPE, ...this.scopesExtra].join(' '); },
    /** ¿El token actual incluye este permiso? */
    tieneScope(scope) { return this.tokenValid && (' ' + (this.granted || '') + ' ').includes(' ' + scope + ' '); },
    /** Autorización incremental: pide un permiso adicional (debe llamarse dentro de un clic). */
    async pedirScope(scope) {
      if (this.tieneScope(scope)) return true;
      const l = this.scopesExtra; if (!l.includes(scope)) this._setScopesExtra([...l, scope]);
      try {
        await this._request('', scope);
        if (!this.tieneScope(scope)) throw new Error('No se concedió el permiso. Vuelve a intentarlo y marca la casilla.');
        return true;
      } catch (e) { this._setScopesExtra(this.scopesExtra.filter(x => x !== scope)); throw e; }
    },
    /** Deja de pedir un permiso opcional en las próximas renovaciones. */
    quitarScope(scope) { this._setScopesExtra(this.scopesExtra.filter(x => x !== scope)); },

    _randomState() {
      const a = new Uint8Array(16);
      if (root.crypto && root.crypto.getRandomValues) root.crypto.getRandomValues(a);
      else for (let i = 0; i < a.length; i++) a[i] = Math.floor(Math.random() * 256);
      return Array.from(a, b => b.toString(16).padStart(2, '0')).join('');
    },

    _setPending(kind, prompt, extraScope) {
      localStorage.setItem(OAUTH_PENDING_KEY, JSON.stringify({ kind, prompt: prompt || '', extraScope: extraScope || '', ts: Date.now() }));
    },
    _getPending() {
      try {
        const p = JSON.parse(localStorage.getItem(OAUTH_PENDING_KEY));
        if (!p || !p.kind || Date.now() - (p.ts || 0) > 15 * 60 * 1000) return null;
        return p;
      } catch { return null; }
    },
    _clearPending() { localStorage.removeItem(OAUTH_PENDING_KEY); localStorage.removeItem(OAUTH_STATE_KEY); },

    /** Construye la URL de autorización (también para tests). */
    buildAuthUrl({ prompt = '', extraScope = '', state, loginHint, redirectUri } = {}) {
      const st = state || this._randomState();
      const params = new URLSearchParams({
        client_id: CFG.GOOGLE_CLIENT_ID,
        redirect_uri: redirectUri || this.redirectUri(),
        response_type: 'token',
        scope: [this._scopeStr, extraScope].filter(Boolean).join(' '),
        include_granted_scopes: 'true',
        state: st
      });
      if (prompt) params.set('prompt', prompt);
      if (loginHint) params.set('login_hint', loginHint);
      return { url: AUTH_URL + '?' + params.toString(), state: st };
    },

    /** Lee #access_token=… del hash (también para tests). */
    parseHash(hash) {
      const raw = (hash || '').replace(/^#/, '');
      if (!raw) return null;
      const q = new URLSearchParams(raw.includes('=') ? raw : '');
      if (!q.has('access_token') && !q.has('error') && !q.has('state')) return null;
      return {
        access_token: q.get('access_token') || '',
        expires_in: q.get('expires_in') || '',
        scope: q.get('scope') || '',
        state: q.get('state') || '',
        token_type: q.get('token_type') || '',
        error: q.get('error') || '',
        error_description: q.get('error_description') || ''
      };
    },

    _clearHash() {
      try {
        const u = root.location.pathname + root.location.search;
        root.history.replaceState(null, '', u || './');
      } catch { /* nada */ }
    },

    _scopeOk(scopeStr) {
      const s = ' ' + (scopeStr || '') + ' ';
      return s.includes(' ' + CFG.DRIVE_SCOPE + ' ');
    },

    _applyToken(resp) {
      if (resp.error) {
        this.needsReauth = !!this.user;
        this._emit();
        return { ok: false, error: resp.error_description || resp.error };
      }
      if (!this._scopeOk(resp.scope || resp.granted)) {
        this.needsReauth = !!this.user;
        this._emit();
        return { ok: false, error: 'Necesitamos el permiso para guardar los datos en tu Google Drive. Vuelve a intentarlo y marca la casilla.' };
      }
      this.token = resp.access_token;
      this.granted = resp.scope || CFG.DRIVE_SCOPE;
      this.expiresAt = Date.now() + (Number(resp.expires_in) || 3600) * 1000;
      sessionStorage.setItem(TOKEN_KEY, JSON.stringify({ access_token: this.token, expiresAt: this.expiresAt, scope: this.granted }));
      this.needsReauth = false;
      this._emit();
      return { ok: true };
    },

    _consumeRedirectHash() {
      const parsed = this.parseHash(root.location && root.location.hash);
      if (!parsed) return null;
      this._clearHash();
      const pending = this._getPending();
      const expected = localStorage.getItem(OAUTH_STATE_KEY);
      localStorage.removeItem(OAUTH_STATE_KEY);
      const kind = (pending && pending.kind) || 'token';
      this._clearPending();
      if (expected && parsed.state && parsed.state !== expected) {
        return { ok: false, kind, error: 'La sesión de Google no se pudo validar (state). Vuelve a intentarlo.' };
      }
      if (parsed.error) {
        return { ok: false, kind, error: parsed.error_description || parsed.error };
      }
      if (!parsed.access_token) {
        return { ok: false, kind, error: 'Google no devolvió un token. Vuelve a intentarlo.' };
      }
      const applied = this._applyToken({
        access_token: parsed.access_token,
        expires_in: parsed.expires_in,
        scope: (parsed.scope || '').replace(/\+/g, ' ')
      });
      if (!applied.ok) return { ok: false, kind, error: applied.error };
      return { ok: true, kind };
    },

    /** Navega a Google (la página se descarga; no vuelve la Promise). */
    _startRedirect(prompt, extraScope, kind) {
      const k = kind || (this.user ? 'reauth' : 'signin');
      this._setPending(k, prompt, extraScope);
      const { url, state } = this.buildAuthUrl({
        prompt,
        extraScope,
        loginHint: this.user && this.user.email,
        redirectUri: this.redirectUri()
      });
      localStorage.setItem(OAUTH_STATE_KEY, state);
      root.location.assign(url);
    },

    /** Cancela un _request colgado (popup sin callback). Así un reintento no se queda esperando para siempre. */
    _cancelPending(reason) {
      const p = this._pending;
      if (!p) return;
      if (p.timer) try { clearTimeout(p.timer); } catch { /* nada */ }
      this._pending = null;
      this._refreshing = false;
      try { p.reject(new Error(reason || 'Inicio de sesión cancelado. Vuelve a intentarlo.')); } catch { /* nada */ }
    },

    /** Debe llamarse dentro de un clic. Pide drive.appdata + permisos opcionales activados. */
    _request(prompt, extraScope, kind) {
      if (this.usesRedirect()) {
        this._cancelPending('Se pasa a inicio de sesión por redirección.');
        this._startRedirect(prompt, extraScope, kind);
        return new Promise(() => { /* la página navega a Google */ });
      }
      if (!this.gisReady) return Promise.reject(new Error(this.gisError || 'El inicio de sesión de Google aún no está listo'));
      // Si el popup anterior no llamó a callback ni a error_callback, _pending quedaba eterno y
      // Entrar/Reconectar no hacían nada (sin toast). Al reintentar, cancelamos y empezamos de nuevo.
      if (this._pending) this._cancelPending('Se canceló el intento anterior. Reintentando…');
      let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; });
      const entry = { resolve, reject, promise, prompt, extraScope, kind: kind || (this.user ? 'reauth' : 'signin'), timer: null };
      entry.timer = setTimeout(() => {
        if (this._pending !== entry) return;
        this._pending = null;
        this._refreshing = false;
        this.needsReauth = !!this.user;
        this._emit();
        try { reject(new Error('Google no respondió a tiempo. Vuelve a pulsar «Entrar con Google» o «Reconectar».')); } catch { /* nada */ }
      }, 90 * 1000);
      this._pending = entry;
      const opts = { prompt, scope: [this._scopeStr, extraScope].filter(Boolean).join(' '), include_granted_scopes: true };
      if (this.user && this.user.email) opts.login_hint = this.user.email;
      try { this._client.requestAccessToken(opts); }
      catch (e) { this._cancelPending(e.message || 'No se pudo abrir el inicio de sesión de Google.'); }
      return promise;
    },

    _takePending() {
      const p = this._pending; this._pending = null;
      if (p && p.timer) try { clearTimeout(p.timer); } catch { /* nada */ }
      return p;
    },

    _onToken(resp) {
      const p = this._takePending();
      if (resp.error) { this.needsReauth = !!this.user; this._emit(); p && p.reject(new Error(resp.error_description || resp.error)); return; }
      if (root.google && google.accounts && google.accounts.oauth2 && google.accounts.oauth2.hasGrantedAllScopes
          && !google.accounts.oauth2.hasGrantedAllScopes(resp, CFG.DRIVE_SCOPE)) {
        this.needsReauth = !!this.user; this._emit();
        p && p.reject(new Error('Necesitamos el permiso para guardar los datos en tu Google Drive. Vuelve a intentarlo y marca la casilla.'));
        return;
      }
      if (!this._scopeOk(resp.scope)) {
        this.needsReauth = !!this.user; this._emit();
        p && p.reject(new Error('Necesitamos el permiso para guardar los datos en tu Google Drive. Vuelve a intentarlo y marca la casilla.'));
        return;
      }
      const applied = this._applyToken(resp);
      if (!applied.ok) { p && p.reject(new Error(applied.error)); return; }
      p && p.resolve(this.token);
    },

    _onTokenError(err) {
      const p = this._takePending();
      const type = err && err.type;
      if (type === 'popup_closed' || type === 'popup_failed_to_open') {
        // Popup inutilizable (Chrome Android / Custom Tab / COOP): redirección OAuth.
        const prompt = (p && p.prompt) || '';
        const extra = (p && p.extraScope) || '';
        const kind = (p && p.kind) || (this.user ? 'reauth' : 'signin');
        this._startRedirect(prompt, extra, kind);
        return;
      }
      const msg = { popup_failed_to_open: 'El navegador bloqueó la ventana de Google. Permite las ventanas emergentes para este sitio.',
        popup_closed: 'Se cerró la ventana de Google antes de terminar.' }[type] || 'No se pudo iniciar sesión con Google.';
      if (this.user) this.needsReauth = true;
      this._emit();
      p && p.reject(new Error(msg));
    },

    /** Botón «Entrar con Google»: pide consentimiento la primera vez y obtiene el perfil.
     *  Si ya hay token válido (vuelta de una redirección OAuth), solo obtiene el perfil. */
    async signIn(fetchProfile) {
      if (!this.tokenValid) await this._request(this.user ? '' : 'consent', '', 'signin');
      const about = await fetchProfile(this.token);
      const u = about && about.user ? about.user : {};
      const prev = this.user;
      this.user = { email: u.emailAddress || '', name: u.displayName || '', photo: u.photoLink || '' };
      localStorage.setItem(USER_KEY, JSON.stringify(this.user));
      this._emit();
      return { user: this.user, previous: prev };
    },

    /** Renovación sin pantalla de consentimiento (requiere gesto del usuario).
     *  En standalone no redirige: el caller debe mostrar «Reconectar». */
    async refreshSilently() {
      if (this._refreshing) return false;
      if (this.usesRedirect()) { this.needsReauth = true; this._emit(); return false; }
      this._refreshing = true;
      try { await this._request('', '', 'reauth'); return true; }
      catch (e) { console.info('Renovación silenciosa no disponible:', e.message); return false; }
      finally { this._refreshing = false; }
    },

    /** Para la capa de datos: devuelve token válido o lanza error code:'auth'. */
    async getToken() {
      if (this.tokenValid) return this.token;
      this.token = null; this.needsReauth = !!this.user; this._emit();
      const e = new Error('Sesión de Google caducada: pulsa «Reconectar»'); e.code = 'auth'; throw e;
    },

    invalidateToken() {
      this.token = null; this.expiresAt = 0; sessionStorage.removeItem(TOKEN_KEY);
      this.needsReauth = !!this.user; this._emit();
    },

    signOut() {
      if (this.token && root.google && google.accounts && google.accounts.oauth2) {
        try { google.accounts.oauth2.revoke(this.token, () => {}); } catch { /* nada */ }
      }
      this.token = null; this.expiresAt = 0; this.user = null; this.needsReauth = false;
      sessionStorage.removeItem(TOKEN_KEY); localStorage.removeItem(USER_KEY);
      this._clearPending();
      this._emit();
    }
  };
  root.Auth = Auth;
})(window);
