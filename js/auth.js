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
   ========================================================= */
(function (root) {
  'use strict';
  const CFG = root.FINANZAS_CONFIG || {};
  const USER_KEY = 'finanzas_auth';        // localStorage: {email, name, photo} de la última cuenta
  const TOKEN_KEY = 'finanzas_token';      // sessionStorage: {access_token, expiresAt}
  const REFRESH_MARGIN_MS = 5 * 60 * 1000;
  const EXTRA_KEY = 'finanzas_scopes_extra'; // localStorage: permisos opcionales que el usuario activó (p. ej. drive.file)

  const listeners = [];
  const Auth = {
    enabled: !!CFG.GOOGLE_CLIENT_ID,
    gisReady: false,
    gisError: null,
    user: null,             // {email, name, photo}
    token: null, expiresAt: 0, granted: '',
    needsReauth: false,
    _client: null, _pending: null, _refreshing: false,

    onChange(fn) { listeners.push(fn); },
    _emit() { listeners.forEach(fn => { try { fn(Auth); } catch (e) { console.error(e); } }); },

    get signedIn() { return !!this.user; },
    get tokenValid() { return !!this.token && Date.now() < this.expiresAt - 30 * 1000; },

    init() {
      try { this.user = JSON.parse(localStorage.getItem(USER_KEY)); } catch { this.user = null; }
      try {
        const t = JSON.parse(sessionStorage.getItem(TOKEN_KEY));
        if (t && t.access_token && Date.now() < t.expiresAt - 30 * 1000) { this.token = t.access_token; this.expiresAt = t.expiresAt; this.granted = t.scope || CFG.DRIVE_SCOPE; }
      } catch { /* nada */ }
      if (!this.enabled) { this.user = null; return; }
      if (this.user && !this.tokenValid) this.needsReauth = true;
      this._loadGis();
      // Renovación oportunista dentro de un gesto del usuario (los navegadores bloquean popups sin gesto)
      document.addEventListener('click', e => {
        if (!this.user || !this.gisReady || this._refreshing || this._pending) return;
        if (e.target.closest && e.target.closest('[data-auth-action]')) return; // los botones de login ya piden token
        if (this.needsReauth || (this.token && this.expiresAt - Date.now() < REFRESH_MARGIN_MS)) this.refreshSilently();
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

    /** Debe llamarse dentro de un clic (abre popup). Pide drive.appdata + permisos opcionales activados. */
    _request(prompt, extraScope) {
      if (!this.gisReady) return Promise.reject(new Error(this.gisError || 'El inicio de sesión de Google aún no está listo'));
      if (this._pending) return this._pending.promise;
      let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; });
      this._pending = { resolve, reject, promise };
      const opts = { prompt, scope: [this._scopeStr, extraScope].filter(Boolean).join(' '), include_granted_scopes: true };
      if (this.user && this.user.email) opts.login_hint = this.user.email;
      this._client.requestAccessToken(opts);
      return promise;
    },

    _onToken(resp) {
      const p = this._pending; this._pending = null;
      if (resp.error) { this.needsReauth = !!this.user; this._emit(); p && p.reject(new Error(resp.error_description || resp.error)); return; }
      if (!google.accounts.oauth2.hasGrantedAllScopes(resp, CFG.DRIVE_SCOPE)) {
        this.needsReauth = !!this.user; this._emit();
        p && p.reject(new Error('Necesitamos el permiso para guardar los datos en tu Google Drive. Vuelve a intentarlo y marca la casilla.'));
        return;
      }
      this.token = resp.access_token;
      this.granted = resp.scope || CFG.DRIVE_SCOPE;
      this.expiresAt = Date.now() + (Number(resp.expires_in) || 3600) * 1000;
      sessionStorage.setItem(TOKEN_KEY, JSON.stringify({ access_token: this.token, expiresAt: this.expiresAt, scope: this.granted }));
      this.needsReauth = false;
      this._emit();
      p && p.resolve(this.token);
    },

    _onTokenError(err) {
      const p = this._pending; this._pending = null;
      const msg = { popup_failed_to_open: 'El navegador bloqueó la ventana de Google. Permite las ventanas emergentes para este sitio.',
        popup_closed: 'Se cerró la ventana de Google antes de terminar.' }[err && err.type] || 'No se pudo iniciar sesión con Google.';
      if (this.user) this.needsReauth = true;
      this._emit();
      p && p.reject(new Error(msg));
    },

    /** Botón «Entrar con Google»: pide consentimiento la primera vez y obtiene el perfil. */
    async signIn(fetchProfile) {
      const token = await this._request(this.user ? '' : 'consent');
      const about = await fetchProfile(token);
      const u = about && about.user ? about.user : {};
      const prev = this.user;
      this.user = { email: u.emailAddress || '', name: u.displayName || '', photo: u.photoLink || '' };
      localStorage.setItem(USER_KEY, JSON.stringify(this.user));
      this._emit();
      return { user: this.user, previous: prev };
    },

    /** Renovación sin pantalla de consentimiento (requiere gesto del usuario). */
    async refreshSilently() {
      if (this._refreshing) return;
      this._refreshing = true;
      try { await this._request(''); return true; }
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
      this._emit();
    }
  };
  root.Auth = Auth;
})(window);
