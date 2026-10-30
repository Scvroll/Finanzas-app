# 💶 Mis Finanzas (v3)

App web personal para controlar **gastos, ingresos, deudas, garantías e inversiones** en euros. Es una web **estática** (HTML + CSS + JavaScript, sin compilación ni servidor propio), gratuita y en español.

- **Entrar con Google** y guardar los datos en **tu propio Google Drive** (carpeta privada de la app, permiso `drive.appdata`), para usarlos en varios dispositivos.
- **Funciona sin conexión** y se puede **instalar como app** (PWA) en el móvil o el ordenador.
- Si no se configura Google, sigue funcionando en **modo local** (solo en este navegador).

👉 Para publicarla en GitHub Pages, activar Google Drive y (opcional) la lectura con Gemini, sigue **[SETUP.md](SETUP.md)** (coste 0 €).

![Resumen con datos de ejemplo](screenshots/ejemplo-resumen.png)

Más capturas en [`screenshots/`](screenshots/) (movimientos, deudas, inversiones, garantías, ajustes, lectura de tickets, móvil).

## Cómo abrirla en tu ordenador

```bash
cd finanzas-app
python3 -m http.server 8000
```

y abre <http://localhost:8000>. (Con doble clic en `index.html` solo funciona el modo local: Google no permite iniciar sesión desde `file://`, y la app no se puede instalar.)

¿Quieres probarla con datos? **Ajustes → Cargar datos de ejemplo**.

## Funciones

### Resumen y movimientos
- **Resumen mensual:** ingresos, gastos, balance, tasa de ahorro, gastos fijos/variables, gráfico por categoría, evolución de 12 meses, top de categorías y últimos movimientos.
- **Movimientos:** gastos e ingresos con importes en formato español (`12,50`, `1.234,56`), búsqueda y filtros.
  - Gastos **fijos o variables** (se propone según la categoría; p. ej. Vivienda y Suministros = fijo).
  - Ingresos de tipo **Nómina, Extra u Otro**.
  - Marca de **pago de una cuota de deuda** (con su desglose de amortización e intereses).
- **Movimientos recurrentes mensuales** (alquiler, nómina, suscripciones…): día del mes (fijo, o «Último día del mes»), mes de inicio, mes de fin opcional y pausa. La app crea sola cada movimiento cuando llega su fecha, también los meses atrasados (hasta 36 meses). No se duplican aunque abras la app en varios dispositivos (cada movimiento generado tiene un identificador fijo).

### Deudas y compras financiadas
- Al apuntar un gasto puedes marcar **«Compra financiada»** (tarjeta, financiación de tienda, préstamo): importe, **TIN**, número de cuotas, comisión de apertura y fecha de la primera cuota.
- **Día de cobro** de cada deuda: un **día fijo del mes** (1 a 31) o **«Último día del mes»** (hay cosas que se cobran a final de mes y otras a principio). Con un día fijo, si el mes es más corto se usa su último día (día 31 → 28 o 29 de febrero, 30 de abril; al mes siguiente vuelve al 31). La 1.ª cuota vence en el mes que indiques, en ese día. El día de cobro se usa en el cuadro de amortización, las próximas cuotas, los avisos de cuotas vencidas, «Marcar pagadas hasta hoy» y la fecha de los gastos «pago de deuda» que se crean. Los intereses se calculan por meses (TIN/12), así que el día de cobro solo cambia las fechas, no los importes. Las deudas creadas con versiones anteriores toman como día de cobro el día de su primera cuota (las fechas no cambian).
- La app calcula la **cuota (sistema francés)**, el **cuadro de amortización**, el total de intereses y la **TAE** (incluye la comisión).
- **Cómo cuenta en el resumen:** la compra financiada **no** suma como gasto del mes (no salió ese dinero); lo que cuenta son las **cuotas** a medida que las pagas. Botón **«Marcar pagadas hasta hoy»** para crear de golpe los movimientos de las cuotas vencidas (cada uno con su desglose de intereses).
- También puedes crear deudas sueltas (préstamo, coche…) con **＋ Nueva deuda**, sin ligarlas a una compra.

### Adjuntos y lectura de tickets/nóminas (OCR)
- Adjunta **fotos o PDF** (ticket, factura, nómina, garantía) a cualquier movimiento. Las fotos se reducen antes de guardarse. Los adjuntos se guardan en el dispositivo y, si usas Google Drive, también en la carpeta privada de la app (se suben una sola vez).
- **«Leer ticket o nómina»**: la app propone importe, fecha, comercio, IVA/IGIC, conceptos, garantía y (con Gemini) la categoría. **Tú revisas y confirmas** antes de que se rellene nada.
  - **En el navegador (Tesseract.js)**, por defecto: gratis, la imagen no sale del dispositivo; la primera vez descarga unos 15 MB (después funciona sin conexión). Solo lee imágenes, no PDF.
  - **IA de Google (Gemini, nivel gratuito)**, opcional: más precisa, lee fotos y PDF, entiende nóminas (bruto, IRPF, Seguridad Social, periodo) y tiene el botón **✨ Sugerir** categoría. Necesita una clave gratuita propia (ver SETUP.md). La clave se guarda **solo en ese dispositivo** (no se sincroniza ni va en las copias). Si no hay clave, no hay conexión o Gemini falla (p. ej. por el límite gratuito), se usa Tesseract automáticamente y se avisa.
  - ⚠️ Con el nivel gratuito de Gemini, según las condiciones de Google, lo que envías puede usarse para mejorar sus productos y ser revisado por personas, salvo para usuarios del Espacio Económico Europeo, Suiza y Reino Unido (a quienes aplica el trato de los servicios de pago). La app lo explica en Ajustes.

### Garantías
- Al apuntar una compra puedes marcar **«Tiene garantía»** (producto y años; 3 por defecto, lo habitual en España para compras nuevas desde 2022).
- Pestaña **Garantías**: vigentes, a punto de caducar y caducadas, con el ticket adjunto a mano.
- **Aviso** en la parte de arriba cuando una garantía caduca en los próximos N días (configurable), enlace **«Añadir a Google Calendar»** para crear un recordatorio, y **notificación del navegador** opcional (solo cuando abres la app).

### Inversiones
- **Activos** (fondo, ETF, acción, cripto, depósito…) con ISIN/ticker, y **operaciones** de compra y venta (participaciones, precio, comisión).
- **Método FIFO** (el que usa Hacienda en España): coste medio, aportado neto, ganancia **realizada** por venta y por año, y **no realizada**.
- **Valor de mercado** con el último precio que apuntes (botón 💲, con historial de precios). No es en tiempo real, a propósito: no hace falta ningún servicio de cotizaciones.
- **Importar CSV** de operaciones (plantilla en [`plantillas/inversiones-plantilla.csv`](plantillas/inversiones-plantilla.csv)): detecta columnas, crea los activos que falten y avisa de operaciones repetidas.
- Las inversiones de la v2 (aportado y valor actual) se migran solas a un activo con una compra y un precio.

### Copia para análisis (opcional, desactivada por defecto)
- En **Ajustes → Copia para análisis** puedes pedir que la app guarde en tu Drive, en una carpeta **visible** llamada **«Finanzas App - Análisis»**, una copia legible: `finanzas-analisis.json` (movimientos, deudas con cuadro, inversiones con resultados FIFO, garantías) y `movimientos.csv`. Sirve para que tu asistente (u otra herramienta a la que des acceso a esa carpeta) pueda analizar tus finanzas.
- Al activarla, Google pide un permiso adicional, `drive.file` (*«ver, editar, crear y eliminar solo los archivos de Google Drive que uses con esta app»*): la app **no** puede ver el resto de tu Drive.
- Se actualiza tras sincronizar, **como mucho una vez por hora**, o al pulsar **«Actualizar copia ahora»**. Se activa **en cada dispositivo** por separado. No incluye las fotos ni los PDF adjuntos.
- **«Borrar la copia de Drive»** elimina la carpeta y desactiva la copia (para que no se vuelva a crear sola). Tus datos de la app no se tocan.

### Otros
- **Categorías editables**, **tema claro/oscuro/automático**, diseño para móvil.
- **Copias:** exportar/importar JSON (sin los archivos adjuntos) y exportar CSV para Excel.
- **Cuenta y sincronización:** *Entrar con Google*, tu foto y correo, indicador de estado y *Sincronizar ahora*.

## Sincronización con Google Drive (cómo funciona)

- Permiso básico: solo `drive.appdata`. La app guarda `finanzas.json` y los adjuntos en una carpeta oculta de tu Drive que solo ella puede ver. **No puede ver el resto de tus archivos.** No hay ningún servidor intermedio: el navegador habla directamente con Google. (El permiso `drive.file` solo se pide si activas la copia para análisis.)
- Siempre hay una **copia local** en el navegador. Todo cambio se guarda primero ahí y, unos 2 segundos después, se sube a Drive.
- **Sin conexión** puedes seguir usando la app: los cambios quedan pendientes y se suben solos cuando vuelve la conexión.
- La app comprueba Drive al abrirla, al volver a la pestaña y cada 5 minutos.
- **Conflictos:** cada elemento (movimiento, recurrente, deuda, adjunto, activo, operación, precio y la lista de categorías) lleva la hora de su último cambio; si se cambió en dos dispositivos, gana el más reciente. Lo borrado se recuerda como «borrado» 180 días para que no reaparezca (los movimientos generados por recurrentes, siempre, para que no se vuelvan a crear).
- **Estado** (arriba a la derecha): *Solo local*, *Sincronizado*, *Sincronizando…*, *Sin conexión*, *Error* o *Reconectar*. Al pulsarlo se sincroniza.
- El permiso de Google dura 1 hora; la app lo renueva sola (puede verse un parpadeo de una ventana de Google). Si no puede, aparece *Reconectar*.
- El tema, los avisos de garantía, la clave de Gemini y la copia para análisis son ajustes **de cada dispositivo** y no se sincronizan.

## Archivos

| Archivo | Para qué sirve |
|---|---|
| `index.html` | Página de la app |
| `css/styles.css` | Estilos |
| `js/config.js` | **Configuración: aquí va tu `GOOGLE_CLIENT_ID`**; versión y nombre de la carpeta de análisis |
| `js/finance-core.js` | Cálculos sin dependencias: cuota francesa, TAE, FIFO, recurrentes, garantías, CSV (probado con tests) |
| `js/sync-core.js` | Lógica de fusión (sin dependencias, probada con tests) |
| `js/storage.js` | Caché local, cliente de la API de Drive y adaptadores `LocalStorageAdapter` / `DriveAdapter` |
| `js/auth.js` | Inicio de sesión con Google Identity Services (y permiso adicional `drive.file`) |
| `js/attachments.js` | Adjuntos: IndexedDB en el dispositivo y subida a Drive |
| `js/ocr.js` | Lectura de documentos: interfaz de proveedores, Tesseract.js y extracción de importes/fechas |
| `js/ocr-gemini.js` | Proveedor opcional Gemini (respuesta JSON estructurada) y sugerencia de categoría |
| `js/analysis-export.js` | Copia para análisis en una carpeta visible de Drive |
| `js/app.js`, `js/app-extra.js`, `js/main.js` | Interfaz, `Store` y pantallas |
| `manifest.json`, `sw.js`, `icons/` | App instalable y funcionamiento sin conexión |
| `plantillas/inversiones-plantilla.csv` | Plantilla para importar operaciones |
| `tests/` | Tests (ver abajo) |
| `screenshots/` | Capturas generadas por los tests |
| `SETUP.md` | Guía de publicación y configuración de Google |

## Datos en el navegador

- `finanzas_v2`: copia local de los datos (esquema versión 3). `finanzas_sync`: estado de la sincronización. `finanzas_auth`: correo, nombre y foto de la cuenta (sin contraseñas ni token).
- Adjuntos: base de datos IndexedDB `finanzas_adjuntos`.
- `finanzas_ocr_proveedor`, `finanzas_gemini_key`, `finanzas_gemini_modelo`: lector elegido y clave de Gemini (**solo en este dispositivo**).
- `finanzas_analisis_activo`, `finanzas_analisis`: copia para análisis activada y estado (IDs de la carpeta y archivos, última actualización).
- El token de acceso de Google se guarda solo en la memoria de la pestaña (`sessionStorage`) y caduca en 1 hora.
- Los datos de la v1/v2 se migran automáticamente.

Esquema (versión 3, resumido):

```js
{
  version: 3,
  movimientos: [{ id, tipo: 'gasto'|'ingreso', fecha, importe, categoria, descripcion, cuenta,
                  naturaleza: 'fijo'|'variable', tipoIngreso, recurrenteId, deudaId, financiadoPor,
                  cuotaN, desglose: { interes, amortizacion, comision }, garantia: { producto, anios }, updatedAt }],
  recurrentes: [{ id, tipo, importe, categoria, dia: 1..31|'ultimo', desde: 'AAAA-MM', hasta, activo, ... }],
  deudas:      [{ id, nombre, categoria, fechaPrimeraCuota, diaCobro: 1..31|'ultimo', ... }],   // + importe financiado, TIN, plazo, comisión
  adjuntos:    [{ id, nombre, driveId, ocr, ... }],   // metadatos; el archivo va aparte (IndexedDB / Drive)
  activos:     [{ id, nombre, tipo, isin, ticker, ... }],
  operaciones: [...],                     // compras y ventas de cada activo
  precios:     [...],                     // historial de precios apuntados a mano
  inversiones: [],                        // v2: solo quedan borrados tras la migración
  categorias:  { gasto: [...], ingreso: [...], updatedAt },
  ajustes:     { tema, avisoGarantiaDias, notificaciones }   // solo local
}
// Cada elemento borrado queda como { id, deleted: true, updatedAt }.
```

## Copias de seguridad

**Ajustes → Exportar copia (JSON)** descarga tus datos (sin los archivos adjuntos). **Importar** una copia sustituye todos los datos, y con Drive activado ese cambio llega también a tus otros dispositivos. **Exportar CSV** abre los movimientos en Excel o Google Sheets.

## Cerrar sesión

Menú de tu foto → **Cerrar sesión**. La app pregunta si quieres borrar también la copia guardada en ese dispositivo (recomendado si es compartido). Tus datos siguen en tu Drive.

## Limitaciones conocidas

- La lectura de tickets **no es perfecta** (sobre todo Tesseract con fotos torcidas, arrugadas o con poca luz): revisa siempre la propuesta. Tesseract no lee PDF (Gemini sí).
- La TAE se calcula con la TIR mensual de los pagos (incluida la comisión de apertura); puede diferir unas décimas de la que dé el banco (seguros, otras comisiones, redondeos).
- Inversiones: no contempla traspasos entre fondos, dividendos, splits ni la regla de los 2 meses; es orientativo para la declaración. Los precios se apuntan a mano.
- Las notificaciones de garantía solo salen cuando la app está abierta (no hay servidor que las envíe).
- La copia para análisis se actualiza como mucho una vez por hora y solo desde los dispositivos donde está activada; si el permiso de Google ha caducado, espera a que vuelvas a entrar o pulses *Actualizar copia ahora*.

## Para desarrolladores

- Sin compilación: edita los archivos y recarga. **Al publicar cambios, sube `VERSION` en `sw.js`** (y `APP_VERSION` en `js/config.js`).
- `Store` habla con un *adapter* (`load/save/clear`). `LocalStorageAdapter` = modo local; `DriveAdapter` = Drive + caché + cola sin conexión.
- El OCR usa una interfaz de proveedores (`OCR.registrar({ id, nombre, disponible(), leer(archivo) })`): Tesseract y Gemini son dos implementaciones.
- Consola: `FinanzasApp.Store`, `FinanzasApp.Sync`, `FinanzasApp.Auth`.

### Tests

```bash
node tests/finance.test.js          # cálculos: cuota, TAE, FIFO, recurrentes, garantías, CSV, migración
node tests/sync.test.js             # sincronización con Drive simulado (dos dispositivos, sin conexión)

# Tests de navegador (necesitan Google Chrome y playwright-core: npm i playwright-core)
python3 -m http.server 8765 &       # desde la carpeta finanzas-app
PW_PATH=/ruta/a/node_modules/playwright-core node tests/browser.test.js
PW_PATH=/ruta/a/node_modules/playwright-core node tests/screenshots.js   # capturas con datos de ejemplo

python3 tests/fixtures/make_ticket.py   # regenera el ticket de prueba (necesita Pillow)
```

Los tests de navegador usan un Google y un Drive **simulados** (no hace falta cuenta) y simulan Gemini; Tesseract sí se ejecuta de verdad (descarga el modelo de español desde jsDelivr la primera vez). Fallan si aparece cualquier error en la consola.
