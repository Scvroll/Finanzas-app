# Puesta en marcha: GitHub Pages + Google Drive (coste 0 €)

Esta guía explica, paso a paso, cómo publicar **Mis Finanzas** gratis en GitHub Pages y activar el inicio de sesión con Google para que **cada usuario guarde sus datos en su propio Google Drive**.

> **Coste: 0 €.** GitHub Pages es gratuito para repositorios públicos, y crear un proyecto de Google Cloud, la pantalla de consentimiento OAuth, el ID de cliente y usar la API de Google Drive no cuesta nada (no hace falta activar facturación ni poner tarjeta). Los datos ocupan el espacio de Drive **de cada usuario** (unos pocos KB).

Sin el paso 6 la app funciona igual, pero en **modo local** (los datos solo se guardan en el navegador) y muestra un aviso.

---

## Cómo funciona (en pocas líneas)

- La app es una página estática (HTML + JS). No hay servidor ni base de datos propia.
- Al pulsar **Entrar con Google**, Google pide permiso para un único alcance: `https://www.googleapis.com/auth/drive.appdata`.
- Ese permiso solo da acceso a una **carpeta oculta y privada de la app** dentro del Drive del usuario (*appDataFolder*). La app **no puede ver ni tocar** el resto de archivos del usuario, y el usuario tampoco ve ese archivo en su lista de Drive (sí puede borrarlo desde *Google Drive → Configuración → Gestionar aplicaciones → Opciones → Eliminar datos ocultos de la aplicación*).
- Allí se guardan `finanzas.json` y los archivos adjuntos (fotos de tickets, PDF). El navegador mantiene además una copia local para funcionar sin conexión.
- **Opcional:** si el usuario activa *Copia para análisis*, la app pide además `https://www.googleapis.com/auth/drive.file` para crear una carpeta **visible** «Finanzas App - Análisis» con una copia legible (JSON + CSV). Con ese permiso la app solo ve los archivos que ella misma crea. Ver paso 3.2 y la sección 8.
- **Opcional:** lectura de tickets con la IA de Google (Gemini, nivel gratuito) usando una clave gratuita que cada usuario pega en *Ajustes*. Ver la sección 9.

---

## 1. Cuenta de GitHub, repositorio y GitHub Pages

1. Crea una cuenta gratuita en <https://github.com/signup> (si no la tienes). Tu nombre de usuario será parte de la dirección web: `https://<usuario>.github.io`.
2. Crea un repositorio nuevo: <https://github.com/new>
   - Nombre, por ejemplo: `finanzas`
   - Visibilidad: **Public** (GitHub Pages es gratis en repositorios públicos; el código es público, **los datos no**: viven en el Drive de cada usuario).
3. Sube el contenido de la carpeta `finanzas-app/` a la **raíz** del repositorio (botón *Add file → Upload files*, arrastra todos los archivos y carpetas: `index.html`, `manifest.json`, `sw.js`, `css/`, `js/`, `icons/`…). Pulsa *Commit changes*.
4. Activa Pages: en el repositorio, *Settings → Pages*:
   - *Source*: **Deploy from a branch**
   - *Branch*: `main` y carpeta `/ (root)` → *Save*.
5. En uno o dos minutos la app estará en `https://<usuario>.github.io/finanzas/` (la dirección aparece en esa misma página).

> El **origen** que usaremos en Google es solo `https://<usuario>.github.io` (sin `/finanzas/` ni barra final).

## 2. Proyecto de Google Cloud

1. Entra en <https://console.cloud.google.com/> con tu cuenta de Google y acepta las condiciones si es la primera vez.
2. Arriba, en el selector de proyectos → **Proyecto nuevo**. Nombre: `Mis Finanzas` → **Crear**. No hace falta asociar una cuenta de facturación.
3. Asegúrate de que el proyecto nuevo está seleccionado en el selector de arriba.

## 3. Pantalla de consentimiento OAuth (externa, en modo de prueba)

En la consola actual esta sección se llama **Google Auth Platform** (menú ☰ → *APIs y servicios → Pantalla de consentimiento de OAuth*, o directamente <https://console.cloud.google.com/auth/overview>).

1. Pulsa **Comenzar** (*Get started*):
   - **Información de la app**: nombre `Mis Finanzas` y tu correo como correo de asistencia.
   - **Público** (*Audience*): **Externo** (*External*).
   - **Información de contacto**: tu correo.
   - Acepta la política de datos de usuario → **Crear**.
2. **Acceso a datos** (*Data access*) → **Añadir o quitar permisos** → busca o pega manualmente
   `https://www.googleapis.com/auth/drive.appdata`
   (descripción: *Ver, crear y eliminar sus datos de configuración en su Google Drive*) → **Actualizar** → **Guardar**.
   Google lo clasifica como permiso **no sensible**.
   - **Si vas a usar la *Copia para análisis*** (opcional), añade también
     `https://www.googleapis.com/auth/drive.file`
     (*Ver, editar, crear y eliminar solo los archivos específicos de Google Drive que uses con esta app*). También es **no sensible**. La app no lo pide al entrar: solo cuando alguien activa la copia en *Ajustes* (permiso «incremental»). Si no lo añades aquí, el resto de la app funciona igual, pero al activar la copia Google mostrará un error.
3. **Público** (*Audience*): la app queda en estado **Prueba** (*Testing*). En **Usuarios de prueba** → **Añadir usuarios** y escribe los correos de Google que podrán entrar (el tuyo y los de quien quieras, hasta **100**).

### ¿Hace falta que Google verifique la app? (comprobado en la documentación oficial)

- `drive.appdata` y `drive.file` están en la lista de permisos **recomendados / no sensibles** de la API de Drive.
- Según la ayuda de Google Cloud: *«Si tu app solo usa permisos no sensibles, no es obligatorio que complete el proceso de verificación de la app.»* No hay revisión de seguridad ni auditoría.
- Lo único opcional es la **verificación de marca** (*brand verification*): solo hace falta si quieres que la pantalla de Google muestre el **nombre y el logotipo** de tu app. Para ello se necesita una página principal en un dominio que demuestres que es tuyo (Search Console), enlace a una política de privacidad, etc. Para uso personal o familiar **no es necesaria**.

**Modo Prueba vs. En producción:**

| | Prueba (*Testing*) | En producción (*In production*) |
|---|---|---|
| Quién puede entrar | Solo los **usuarios de prueba** (máx. 100) | Cualquier cuenta de Google |
| Aviso | Google muestra un aviso (la app está en pruebas y no verificada) antes de dar el permiso | Con solo permisos no sensibles, **no** aparece el aviso de «app no verificada» |
| Caducidad | Las autorizaciones de los usuarios de prueba **caducan a los 7 días** del consentimiento: después, Google vuelve a pedir el permiso (la app lo gestiona con el botón *Reconectar*) | Sin esa caducidad de 7 días |
| Verificación | No | No obligatoria (solo permisos no sensibles); verificación de marca opcional |

Recomendación: empieza en **Prueba**. Si más adelante quieres abrirla a cualquiera, en *Público* pulsa **Publicar app** (sigue sin requerir verificación con estos permisos no sensibles).

Fuentes oficiales (consultadas el 30/10/2026): [OAuth App Verification Help Center](https://support.google.com/cloud/answer/13463073) (no sensibles = verificación no obligatoria; verificación de marca para nombre y logo) · [Manage App Audience](https://support.google.com/cloud/answer/15549945) (modo Prueba: 100 usuarios, aviso, caducidad de 7 días; En producción) · [Sensitive scope verification](https://support.google.com/cloud/answer/13464321) · [Permisos de la API de Drive](https://developers.google.com/workspace/drive/api/guides/api-specific-auth) (`drive.appdata` y `drive.file`: recomendados, no sensibles) · [Carpeta de datos de la app](https://developers.google.com/workspace/drive/api/guides/appdata)

## 4. ID de cliente OAuth (tipo «Aplicación web»)

1. En Google Auth Platform → **Clientes** (*Clients*) → **Crear cliente** (o *APIs y servicios → Credenciales → Crear credenciales → ID de cliente de OAuth*).
2. **Tipo de aplicación**: **Aplicación web**. Nombre: `Mis Finanzas web`.
3. **Orígenes de JavaScript autorizados** → *Añadir URI*:
   - `https://<usuario>.github.io` (cambia `<usuario>` por tu usuario de GitHub, sin barra final ni ruta)
   - `http://localhost:8000` (para probar en tu ordenador)
4. **URI de redireccionamiento autorizados**: déjalo **vacío** (el inicio de sesión usa una ventana emergente, no redirecciones).
5. **Crear**. Copia el **ID de cliente** (termina en `.apps.googleusercontent.com`). **No** necesitas el «secreto de cliente»: no lo pongas en ningún sitio.

> Los cambios de orígenes pueden tardar unos minutos (a veces hasta horas) en aplicarse. Si sale `Error 400: origin_mismatch`, revisa que el origen coincide exactamente y espera un poco.

## 5. Habilitar la API de Google Drive

1. Abre <https://console.cloud.google.com/apis/library/drive.googleapis.com> (con el proyecto seleccionado).
2. Pulsa **Habilitar**. Gratis; la cuota por defecto sobra de lejos para este uso.

## 6. Pegar el ID de cliente en la app

1. Edita `js/config.js` (en GitHub: abre el archivo → icono del lápiz).
2. Pon tu ID entre las comillas:
   ```js
   const GOOGLE_CLIENT_ID = '1234567890-abc123def456.apps.googleusercontent.com';
   ```
3. Guarda (*Commit changes*). GitHub Pages se actualiza en 1–2 minutos.

> El ID de cliente **no es secreto**: está pensado para ir en el código de la web. Solo funciona desde los orígenes que autorizaste en el paso 4.

Si cambias archivos de la app más adelante, sube también el número de `VERSION` en `sw.js` para que los navegadores descarguen la versión nueva.

### Actualizar a la v3.5 (deudas: «Calcular cuotas» o «Cuota manual»)

- Sube **todos** los archivos (en `sw.js`, `VERSION = 'finanzas-v3.5.0'`). No hay archivos nuevos ni cambia nada en Google Cloud.
- Las deudas que ya tienes se abren igual, en modo «Calcular cuotas»: no cambia ningún importe ni ninguna fecha.
- Las deudas en «Cuota manual» guardan también un capital y un TIN equivalentes, así que un dispositivo con la v3.4 las sigue mostrando con cuotas casi iguales. Pero **si editas una deuda manual en un dispositivo con la v3.4**, pasa a «Calcular cuotas» y pierde las cuotas editadas una a una. Actualiza todos los dispositivos (abre la app con conexión en cada uno).

### Actualizar a la v3.4 (cuentas, traspasos y traspasos entre fondos)

- Sube **todos** los archivos, incluidos los nuevos `js/cuentas-core.js` y `js/cuentas.js` (ya están en la lista `SHELL` de `sw.js`, con `VERSION = 'finanzas-v3.4.0'`). No cambia nada en Google Cloud: mismos permisos, mismo ID de cliente.
- Los datos que ya tienes en Drive se abren tal cual: la v3.4 solo añade las colecciones `cuentas`, `traspasos`, `regularizaciones` y `traspasosFondos` dentro del mismo `finanzas.json`, y un campo opcional `cuentaId` en movimientos, recurrentes, deudas y operaciones. No cambia ningún importe ni ninguna fecha de lo que ya tenías.
- Haz una **copia JSON** (Ajustes → Exportar copia) antes de actualizar, por si acaso.
- Abre la app en **cada dispositivo** con conexión para que se actualice. Un dispositivo con la v3.3 o anterior **no borra** las cuentas ni los traspasos (los conservan y vuelven a subir los dispositivos con la v3.4), pero no los ve; y si en él editas una operación de inversión, esa operación pierde la cuenta asignada.
- Después, en la pestaña **Cuentas**, crea tus cuentas (la app te ofrece crearlas a partir de los nombres que ya escribías en los movimientos), pon el saldo de cada una y, si quieres, usa **Asignar cuenta** en Inversiones para indicar desde qué cuenta compras.

### Actualizar a la v3.3 (vehículos y combustible)

- Sube **todos** los archivos, incluidos los nuevos `js/fuel-core.js` y `js/vehiculos.js` (ya están en la lista `SHELL` de `sw.js`, con `VERSION = 'finanzas-v3.3.0'`). No cambia nada en Google Cloud: mismos permisos (`drive.appdata`; `drive.file` solo para la copia para análisis), mismo ID de cliente.
- Los datos que ya tienes en Drive se abren tal cual: la v3.3 solo añade las colecciones `vehiculos` y `repostajes` dentro del mismo `finanzas.json`.
- Abre la app en **cada dispositivo** con conexión para que se actualice (si no, recarga la página una vez). Mientras un dispositivo siga con una versión antigua no verá los vehículos ni los repostajes (los conservan los dispositivos con la v3.3 y los vuelven a subir al sincronizar), y si en él cambias el importe de un gasto de combustible, el repostaje no se actualiza.

## 7. Probar

- **En tu ordenador**: en la carpeta de la app ejecuta `python3 -m http.server 8000` y abre <http://localhost:8000>. (Abrir `index.html` con doble clic funciona en modo local, pero Google no permite iniciar sesión desde `file://`.)
- **En la web**: abre `https://<usuario>.github.io/finanzas/` → **Entrar con Google** → elige una cuenta que sea usuario de prueba → acepta el permiso. Verás tu foto y el estado **Sincronizado**.
- **Instalar como app** (opcional): en Chrome/Edge, icono de instalar de la barra de direcciones; en Android, menú ⋮ → *Instalar app*; en iPhone, Safari → Compartir → *Añadir a pantalla de inicio*.

## 8. (Opcional) Copia para análisis en una carpeta visible

Sirve para que un asistente (por ejemplo Grok Bot) u otra herramienta pueda leer tus finanzas desde tu Drive, sin acceso a la app.

1. Asegúrate de haber añadido `drive.file` en el paso 3.2.
2. En la app: **Ajustes → Copia para análisis → Mantener una copia para análisis en mi Google Drive**. Google pedirá el permiso adicional; acéptalo.
3. Se crea la carpeta **«Finanzas App - Análisis»** en *Mi unidad* con `finanzas-analisis.json` y `movimientos.csv`. El botón **Abrir la carpeta en Drive** te lleva a ella; desde Drive puedes compartirla con quien quieras.
4. Se actualiza tras sincronizar, **como mucho una vez por hora**, o con **Actualizar copia ahora**. Se activa en cada dispositivo por separado (basta con uno).
5. Para dejar de usarla: **Borrar la copia de Drive** (borra la carpeta y desactiva la copia). Si además quieres retirar el permiso: <https://myaccount.google.com/connections> → *Mis Finanzas*.

No incluye las fotos ni los PDF adjuntos.

## 9. (Opcional) Lectura de tickets con Gemini (nivel gratuito)

Por defecto la app lee tickets **en el navegador** con Tesseract.js (gratis, sin clave, la imagen no sale del dispositivo). Si quieres más precisión, lectura de PDF, datos de nóminas y sugerencia de categoría, cada usuario puede usar **su propia clave gratuita** de Gemini:

1. Entra en <https://aistudio.google.com/apikey> con tu cuenta de Google y acepta las condiciones. AI Studio crea un proyecto y una clave por defecto (o pulsa **Create API key**). **No actives la facturación**: sin facturación la clave usa solo el **nivel gratuito** y nunca cobra; si pasas el límite, Gemini responde «límite alcanzado» y la app usa Tesseract.
2. Desde el 28/05/2026 las claves nuevas de AI Studio son **claves de autorización** y ya vienen **limitadas a la API de Gemini**. Si tu clave aparece como *Unrestricted* (claves antiguas), en AI Studio pasa el ratón sobre la etiqueta → **Add restrictions → Restrict to Gemini API only** (Google rechaza las claves estándar sin restricciones).
3. Recomendado: limita también **desde qué web** se puede usar. En <https://console.cloud.google.com/apis/credentials> (proyecto de la clave) → abre la clave → *Restricciones de aplicación* → **Sitios web** (*HTTP referrers*) → añade `https://<usuario>.github.io/*` (y `http://localhost:8000/*` si pruebas en local) → **Guardar**.
4. En la app: **Ajustes → Lectura de tickets y nóminas (OCR) → IA de Google (Gemini)** → pega la clave → **Guardar**. Elige el modelo: *Gemini 3.5 Flash-Lite* (por defecto, rápido) o *Gemini 3.8 Flash* (más preciso).

Detalles y privacidad:

- La clave se guarda **solo en ese dispositivo** (`localStorage`). No se sincroniza con Drive, no va en las copias JSON ni en la copia para análisis, y **no debe ponerse nunca en `js/config.js`** ni en el repositorio. Google recomienda no usar claves en webs públicas; aquí es aceptable porque cada usuario pone **su propia** clave en **su** navegador, pero trátala como una contraseña: si crees que se ha filtrado, bórrala en AI Studio y crea otra.
- La app llama directamente a `POST https://generativelanguage.googleapis.com/v1beta/interactions` (API *Interactions*), con la clave en la cabecera `x-goog-api-key`, `store: false` (no guardar la conversación) y respuesta en **JSON estructurado** (esquema fijo: tipo de documento, total, fecha, comercio, IVA, conceptos, garantía, nómina, categoría). Si falla, se usa Tesseract.
- **Uso de datos en el nivel gratuito:** según las condiciones de la API de Gemini, Google puede usar lo que envías en el nivel gratuito para mejorar sus productos, y personas pueden revisarlo. Esto **no aplica a usuarios del Espacio Económico Europeo (incluida España), Suiza y Reino Unido**, a quienes Google da el trato de los servicios de pago. Aun así, no envíes documentos que no quieras compartir con Google. La app muestra este aviso al activar Gemini.
- Los límites del nivel gratuito (peticiones por minuto y por día) los fija Google y cambian; consulta <https://ai.google.dev/gemini-api/docs/rate-limits>.

Fuentes (consultadas el 30/10/2026): [Using Gemini API keys](https://ai.google.dev/gemini-api/docs/api-key) · [Gemini API pricing (nivel gratuito)](https://ai.google.dev/gemini-api/docs/pricing) · [Gemini API Additional Terms](https://ai.google.dev/gemini-api/terms)

## Coste total: 0 €

| Servicio | Precio |
|---|---|
| GitHub (cuenta + repositorio público + Pages) | Gratis |
| Proyecto de Google Cloud, pantalla de consentimiento, ID de cliente | Gratis (sin facturación) |
| API de Google Drive | Gratis |
| Almacenamiento | El del Drive de cada usuario (15 GB gratis por cuenta; la app usa unos KB más las fotos adjuntas, reducidas a ≤ 1600 px) |
| Lectura de tickets en el navegador (Tesseract.js, desde jsDelivr) | Gratis |
| Gemini (opcional, nivel gratuito, clave de cada usuario, sin facturación) | Gratis |

## Problemas frecuentes

- **«Acceso bloqueado: la app no ha completado la verificación» / «access_denied»**: esa cuenta no está en *Usuarios de prueba* (paso 3.3).
- **`origin_mismatch`**: el origen del paso 4 no coincide exactamente (¿`https`? ¿sin barra final? ¿sin `/finanzas`?).
- **La ventana de Google no se abre**: permite las ventanas emergentes para el sitio.
- **Al activar la copia para análisis sale un error de Google**: falta añadir `drive.file` en el paso 3.2.
- **Gemini dice que la clave no es válida** o «API_KEY_HTTP_REFERRER_BLOCKED»: revisa la clave y que la restricción de sitios web incluya tu dirección exacta con `/*` al final.
- **Gemini: «Has alcanzado el límite gratuito»**: espera un rato; mientras tanto la app usa el lector del navegador.
- **Aparece «Reconectar»**: el permiso de acceso caduca cada hora (y en modo Prueba, la autorización cada 7 días). Pulsa *Reconectar*; tus cambios se guardan mientras tanto y se suben después.
