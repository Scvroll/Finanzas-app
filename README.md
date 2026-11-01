# 💶 Mis Finanzas (v3)

App web personal para controlar **gastos, ingresos, cuentas y efectivo, deudas, garantías, inversiones y combustible de tus vehículos** en euros. Es una web **estática** (HTML + CSS + JavaScript, sin compilación ni servidor propio), gratuita y en español.

- **Entrar con Google** y guardar los datos en **tu propio Google Drive** (carpeta privada de la app, permiso `drive.appdata`), para usarlos en varios dispositivos.
- **Funciona sin conexión** y se puede **instalar como app** (PWA) en el móvil o el ordenador.
- Si no se configura Google, sigue funcionando en **modo local** (solo en este navegador).

👉 Para publicarla en GitHub Pages, activar Google Drive y (opcional) la lectura con Gemini, sigue **[SETUP.md](SETUP.md)** (coste 0 €).

![Resumen con datos de ejemplo](screenshots/ejemplo-resumen.png)

Más capturas en [`screenshots/`](screenshots/) (movimientos, cuentas, traspaso entre fondos, deudas, inversiones, garantías, vehículos, ajustes, lectura de tickets, móvil).

## Cómo abrirla en tu ordenador

```bash
cd finanzas-app
python3 -m http.server 8000
```

y abre <http://localhost:8000>. (Con doble clic en `index.html` solo funciona el modo local: Google no permite iniciar sesión desde `file://`, y la app no se puede instalar.)

¿Quieres probarla con datos? **Ajustes → Cargar datos de ejemplo**.

## Funciones

### Resumen y movimientos
- **Selector de periodo Mes / Año (v3.6):** arriba eliges ver un **mes** (por defecto) o un **año entero**; la app recuerda lo último elegido. En modo año, el resumen, el gráfico, las categorías, los últimos movimientos y los filtros «Periodo de arriba» (Movimientos y Cuentas) usan el año completo; ‹ › saltan de año en año.
- **Saldo del mes con arrastre (v3.6):** el dinero que sobra un mes pasa como **saldo inicial** del siguiente. Tarjeta «Saldo del mes»: saldo inicial (lo que sobró el mes anterior) + ingresos − gastos (= «Resultado del mes», que sigue a la vista) ± lo traspasado a ahorro/inversión ± compras de inversión, ajustes y apertura de cuentas = **saldo final**, que es el saldo inicial del mes siguiente. Es un cálculo: **no se crean apuntes**, así que si cambias un mes pasado se recalculan solos los siguientes.
  - Con cuentas: cuentan las cuentas **del día a día** (por defecto corriente, efectivo y «otra»; las de ahorro e inversión no). Se cambia en cada cuenta con la casilla «Cuenta del día a día». Un traspaso entre dos cuentas del día a día no cambia el saldo; uno a una cuenta de ahorro/inversión sale de él («Traspasado a ahorro/inversión»). Se respetan el saldo inicial y la fecha de cada cuenta («Apertura de cuentas»).
  - Sin cuentas: ingresos − gastos acumulados desde el primer mes con movimientos.
  - En modo año: saldo inicial a 1 de enero (lo que sobró del año anterior), totales del año, saldo final a 31 de diciembre y tabla **mes a mes** (pulsa un mes para abrirlo). El gráfico de evolución añade la línea «Saldo final».
  - **Cuándo empieza el saldo (v3.6.1):** con cuentas, el saldo empieza en la **fecha de apertura más antigua de tus cuentas del día a día** (su saldo inicial real). Los meses y años anteriores no tienen saldo: se ve «Sin saldo: tus cuentas empiezan el 1/10/2026» y «—» en la tabla del año (ingresos, gastos y resultado sí se ven). Las compras de inversión **sin cuenta**, o con fecha anterior a la apertura de su cuenta, nunca restan del saldo (siguen en Inversiones y en «Invertido»). Todo se suma en céntimos.
  - En Patrimonio, «Dinero en cuentas» se separa en **Disponible (cuentas del día a día)** y **En cuentas de ahorro/inversión**.
- **Previsión (v3.7):** pestaña que responde «¿cuánto me sobrará (o faltará)?» este mes y los 6 (o 12) siguientes. Por mes: saldo inicial (hoy, el real de tus cuentas del día a día; después, lo que sobra del mes anterior) + ingresos recurrentes + nómina − gastos fijos recurrentes − cuotas de deudas sin pagar (de los dos modos; las vencidas sin marcar van al mes actual) − gasto variable estimado = lo que sobra.
  - En el mes actual solo cuenta lo **pendiente** (lo ya apuntado o pagado ya está en el saldo de hoy).
  - **Nómina:** si no la tienes como recurrente, se **estima** con la última (importe y día) y se marca «Estimada»; el botón «Guardar como nómina recurrente» la convierte en recurrente.
  - **Gasto variable estimado:** editable (se guarda en este navegador); vacío = media de los últimos meses completos (hasta 3). En el mes actual se resta solo lo que falta por gastar.
  - Aviso verde «Te sobrarán X €» o rojo «⚠ Te faltarán X €», y aviso si el saldo puede **bajar de 0 antes de cobrar** dentro del mes (con el gasto variable repartido por igual cada día). Detalle de cada mes con fecha e importe y gráfico del saldo previsto (barras) y del mínimo dentro del mes (línea).
- **Resumen mensual:** ingresos, gastos, resultado (antes «balance»), tasa de ahorro, gastos fijos/variables, gráfico por categoría, evolución de 12 meses, top de categorías y últimos movimientos.
- **Movimientos:** gastos e ingresos con importes en formato español (`12,50`, `1.234,56`), búsqueda y filtros.
  - Gastos **fijos o variables** (se propone según la categoría; p. ej. Vivienda y Suministros = fijo).
  - Ingresos de tipo **Nómina, Extra u Otro**.
  - Marca de **pago de una cuota de deuda** (con su desglose de amortización e intereses).
- **Movimientos recurrentes mensuales** (alquiler, nómina, suscripciones…): día del mes (fijo, o «Último día del mes»), mes de inicio, mes de fin opcional y pausa. La app crea sola cada movimiento cuando llega su fecha, también los meses atrasados (hasta 36 meses). No se duplican aunque abras la app en varios dispositivos (cada movimiento generado tiene un identificador fijo).

### Cuentas, efectivo y traspasos (v3.4)
- Pestaña **Cuentas**: tus cuentas bancarias, de ahorro, de inversión/bróker, tarjetas y el **efectivo** (cartera), cada una con nombre, tipo, entidad, últimos 4 dígitos del IBAN (opcional; si pegas el IBAN entero solo se guardan esos 4), **saldo inicial y su fecha**, icono y color. Se pueden **editar, archivar** (dejan de salir al elegir cuenta, pero conservan su historia) o **borrar**.
- Si ya escribías el nombre de la cuenta a mano en los movimientos, la pestaña te **ofrece crear la cuenta** a partir de ese texto: los apuntes con ese nombre se le asignan solos y la fecha del saldo es la del primer apunte.
- **Saldo** de cada cuenta = saldo inicial + ingresos − gastos ± traspasos − compras + ventas de inversiones ± ajustes (solo cuenta lo que tenga fecha igual o posterior a la del saldo inicial). Gráfico de **evolución del saldo** por mes y lista de apuntes de la cuenta con el saldo tras cada uno (los futuros se ven atenuados).
- **Ajustar saldo**: escribes el saldo real que te dice el banco y la app apunta la diferencia como *ajuste* (no es gasto ni ingreso).
- **Traspasos entre cuentas** (p. ej. del banco a la cuenta de inversión o retirar efectivo del cajero): mueven dinero de una cuenta a otra y **no cuentan como gasto ni como ingreso**. Si el traspaso tiene **comisión**, esa comisión sí es un gasto real (categoría «Comisiones», en la cuenta de origen).
- **De qué cuenta sale** cada gasto, ingreso, recurrente, cuota de deuda o repostaje: un selector en cada formulario (propone la última cuenta usada en ese dispositivo).
- Las **compras y ventas de inversiones** pueden indicar la cuenta desde la que se pagan/cobran (opcional). **No son gasto**: el Resumen separa **gasto real, ingresos, ahorro y dinero invertido** del mes. Botón **«Asignar cuenta»** para poner una cuenta a muchas operaciones a la vez, *solo desde una fecha*.
- Tarjeta **Patrimonio** en el Resumen: dinero en cuentas + valor de las inversiones − deuda pendiente.

### Deudas y compras financiadas
- Al apuntar un gasto puedes marcar **«Compra financiada»** (tarjeta, financiación de tienda, préstamo): importe, **TIN**, número de cuotas, comisión de apertura y fecha de la primera cuota.
- **Día de cobro** de cada deuda: un **día fijo del mes** (1 a 31) o **«Último día del mes»** (hay cosas que se cobran a final de mes y otras a principio). Con un día fijo, si el mes es más corto se usa su último día (día 31 → 28 o 29 de febrero, 30 de abril; al mes siguiente vuelve al 31). La 1.ª cuota vence en el mes que indiques, en ese día. El día de cobro se usa en el cuadro de amortización, las próximas cuotas, los avisos de cuotas vencidas, «Marcar pagadas hasta hoy» y la fecha de los gastos «pago de deuda» que se crean. Los intereses se calculan por meses (TIN/12), así que el día de cobro solo cambia las fechas, no los importes. Las deudas creadas con versiones anteriores toman como día de cobro el día de su primera cuota (las fechas no cambian).
- **Dos formas de introducir una deuda (v3.5)**, con el selector «¿Cómo quieres introducir la deuda?» (en ＋ Nueva deuda y en la compra financiada):
  - **Calcular cuotas:** indicas importe financiado, **TIN**, plazo y comisiones, y la app calcula la **cuota (sistema francés)**, el **cuadro de amortización**, el total de intereses y la **TAE** (incluye la comisión).
  - **Cuota manual:** indicas la **cuota** que te cobran, la **fecha del primer cobro** y el **día de cobro**, y el **nº de cuotas** o la **fecha de la última cuota** (se rellenan el uno al otro). **Capital prestado, TIN y TAE son opcionales.** Sin capital, lo pendiente es la suma de las cuotas que faltan. Con capital, la app calcula el **TIN implícito** y la **TAE** y desglosa cada cuota en intereses y capital (si el TIN que indicas no cuadra con capital y cuotas, avisa y usa el implícito; si las cuotas suman menos que el capital, no deja guardar). En **«Editar cuotas una a una»** puedes poner otro importe a cuotas concretas (p. ej. la primera o la última).
  - Al editar una deuda puedes cambiar de modo. Las deudas de versiones anteriores siguen en «Calcular cuotas», sin cambios.
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

### Vehículos y combustible (v3.3)
- Pestaña **Vehículos**: alta de cada coche o moto con **matrícula** (única), nombre, combustible (gasóleo/gasolina/otro), **litros que caben en el depósito** (se piden al crearlo) y cuentakilómetros actual (opcional). Se puede marcar como *no en uso* para conservar sus estadísticas.
- **Repostaje** desde *＋ Movimiento* (al elegir la categoría **Combustible** o marcar **⛽ Repostaje**) o con el botón **⛽ Repostaje** de la pestaña: vehículo, **precio del litro**, **litros**, **km hechos con el depósito anterior**, cuentakilómetros (opcional), si has llenado el depósito y gasolinera. Con dos de los tres datos *importe / precio por litro / litros* calcula el tercero (y avisa si no cuadran o si son más litros de los que caben).
- Cada repostaje **es un gasto normal** (categoría «Combustible», etiqueta ⛽ con la matrícula en Movimientos): cuenta en los totales del mes. Editarlo o borrarlo en un sitio lo cambia en el otro.
- **Métricas** por vehículo y en total, por periodo (últimos 12 meses, cada año o todo): gasto, **€/km**, **L/100 km**, **km/L**, **€/L medio** (ponderado por litros, con mínimo y máximo), litros, km, **autonomía** con el depósito lleno, coste de llenarlo, cuentakilómetros estimado y último repostaje; tablas **por mes** y **por año**, y gráficos del **precio del litro** y del **consumo**.
- **Cómo se calcula** (también explicado en la app): método *lleno a lleno*. Entre dos repostajes con el depósito lleno, el consumo son los litros que repones en el segundo (más los de los parciales intermedios) ÷ los km de ese tramo. Los km son los que anotas («km con el depósito anterior»); si no los anotas, la diferencia del cuentakilómetros. Si un vehículo aún no tiene dos llenos seguidos, se usa una **aproximación** (litros del repostaje anterior ÷ km) marcada con *. El €/km solo incluye combustible.
- Borrar un vehículo borra sus repostajes (litros, km), pero **sus gastos se quedan** en Movimientos como gastos normales.

### Inversiones
- **Activos** (fondo, ETF, acción, cripto, depósito…) con ISIN/ticker, y **operaciones** de compra y venta (participaciones, precio, comisión).
- **Método FIFO** (el que usa Hacienda en España): coste medio, aportado neto, ganancia **realizada** por venta y por año, y **no realizada**.
- **Valor de mercado** con el último precio que apuntes (botón 💲, con historial de precios). No es en tiempo real, a propósito: no hace falta ningún servicio de cotizaciones.
- **Importar CSV** de operaciones (plantilla en [`plantillas/inversiones-plantilla.csv`](plantillas/inversiones-plantilla.csv)): detecta columnas, crea los activos que falten y avisa de operaciones repetidas.
- Las inversiones de la v2 (aportado y valor actual) se migran solas a un activo con una compra y un precio.
- **Traspasos entre fondos** (v3.4, solo activos de tipo *fondo*), como los permite Hacienda sin tributar: indicas fondo de origen y destino, participaciones que salen (o *todas*) y las recibidas, y los valores liquidativos. **No hay ganancia ni pérdida** y no se mueve dinero de ninguna cuenta: el fondo de destino **hereda el coste y las fechas de compra** de las participaciones que salen (por orden FIFO, repartidas en proporción), y la ficha del fondo muestra cada lote «procedente de traspaso de …». No se puede borrar un traspaso si una venta posterior depende de él. ETF, acciones y cripto no tienen traspaso: se apunta como venta + compra.

### Copia para análisis (opcional, desactivada por defecto)
- En **Ajustes → Copia para análisis** puedes pedir que la app guarde en tu Drive, en una carpeta **visible** llamada **«Finanzas App - Análisis»**, una copia legible: `finanzas-analisis.json` (movimientos, cuentas con saldos, traspasos y ajustes, deudas con cuadro, inversiones con resultados FIFO y traspasos entre fondos, garantías, vehículos con repostajes y consumos) y `movimientos.csv`. Sirve para que tu asistente (u otra herramienta a la que des acceso a esa carpeta) pueda analizar tus finanzas.
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
- **Conflictos:** cada elemento (movimiento, recurrente, deuda, adjunto, activo, operación, precio, vehículo, repostaje, cuenta, traspaso, ajuste de saldo, traspaso entre fondos y la lista de categorías) lleva la hora de su último cambio; si se cambió en dos dispositivos, gana el más reciente. Lo borrado se recuerda como «borrado» 180 días para que no reaparezca (los movimientos generados por recurrentes, siempre, para que no se vuelvan a crear).
- **Estado** (arriba a la derecha): *Solo local*, *Sincronizado*, *Sincronizando…*, *Sin conexión*, *Error* o *Reconectar*. Al pulsarlo se sincroniza.
- El permiso de Google dura 1 hora; la app lo renueva sola (puede verse un parpadeo de una ventana de Google). Si no puede, aparece *Reconectar*.
- **Actualiza todos tus dispositivos a la v3.4** (basta con abrir la app con conexión). Una versión anterior abre bien los datos, pero no ve las cuentas, traspasos, ajustes ni traspasos entre fondos y no los sube; **no los borra**: el siguiente dispositivo con la v3.4 que sincronice los conserva y los vuelve a subir. Lo único que se pierde: si en una versión anterior **editas una operación de inversión**, se le quita la cuenta asignada (vuelve a asignarla en la v3.4). Los movimientos guardan también el nombre de la cuenta en el campo de texto de siempre, así que las versiones antiguas siguen viéndolo.
- Con una versión anterior a la v3.3 tampoco se ven los vehículos ni los conserva al subir sus cambios (los vuelve a añadir el siguiente dispositivo con la v3.3 que sincronice), y si en ella cambias el importe de un gasto de combustible, el repostaje no se entera (revísalo luego en la v3.3). Si en una versión anterior **borras** un gasto de combustible, su repostaje queda marcado «Sin gasto» en la pestaña Vehículos.
- El tema, los avisos de garantía, la clave de Gemini y la copia para análisis son ajustes **de cada dispositivo** y no se sincronizan.

## Archivos

| Archivo | Para qué sirve |
|---|---|
| `index.html` | Página de la app |
| `css/styles.css` | Estilos |
| `js/config.js` | **Configuración: aquí va tu `GOOGLE_CLIENT_ID`**; versión y nombre de la carpeta de análisis |
| `js/finance-core.js` | Cálculos sin dependencias: cuota francesa, TAE, FIFO, recurrentes, garantías, CSV (probado con tests) |
| `js/fuel-core.js` | Cálculos de combustible sin dependencias: importe/precio/litros, consumo lleno a lleno, €/km, resúmenes por mes y año (probado con tests) |
| `js/sync-core.js` | Lógica de fusión (sin dependencias, probada con tests) |
| `js/storage.js` | Caché local, cliente de la API de Drive y adaptadores `LocalStorageAdapter` / `DriveAdapter` |
| `js/auth.js` | Inicio de sesión con Google Identity Services (y permiso adicional `drive.file`) |
| `js/attachments.js` | Adjuntos: IndexedDB en el dispositivo y subida a Drive |
| `js/ocr.js` | Lectura de documentos: interfaz de proveedores, Tesseract.js y extracción de importes/fechas |
| `js/ocr-gemini.js` | Proveedor opcional Gemini (respuesta JSON estructurada) y sugerencia de categoría |
| `js/analysis-export.js` | Copia para análisis en una carpeta visible de Drive |
| `js/app.js`, `js/app-extra.js`, `js/main.js` | Interfaz, `Store` y pantallas |
| `js/cuentas-core.js` | Cálculos de cuentas sin dependencias: saldos, historial, serie mensual, ajustes, dinero invertido (probado con tests) |
| `js/prevision-core.js` | Cálculo de la Previsión sin dependencias (probado con tests) |
| `js/prevision.js` | Pestaña Previsión |
| `js/cuentas.js` | Pestaña Cuentas, traspasos, ajustes, asignar cuenta y traspasos entre fondos |
| `js/vehiculos.js` | Pestaña Vehículos, diálogo de vehículo y opción ⛽ del diálogo de movimiento |
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
  movimientos: [{ id, tipo: 'gasto'|'ingreso', fecha, importe, categoria, descripcion, cuenta, cuentaId,
                  naturaleza: 'fijo'|'variable', tipoIngreso, recurrenteId, deudaId, financiadoPor,
                  cuotaN, desglose: { interes, amortizacion, comision }, garantia: { producto, anios },
                  repostajeId, traspasoId, updatedAt }],   // repostajeId: gastos de combustible (v3.3); traspasoId: comisión de un traspaso (v3.4)
  recurrentes: [{ id, tipo, importe, categoria, dia: 1..31|'ultimo', desde: 'AAAA-MM', hasta, activo, ... }],
  deudas:      [{ id, nombre, categoria, fechaPrimeraCuota, diaCobro: 1..31|'ultimo', ... }],   // + importe financiado, TIN, plazo, comisión
               // v3.5, solo en «Cuota manual»: modo: 'manual', cuotaManual, cuotasEditadas: { n: importe }, capitalConocido, tinConocido
               // (principal y tin se guardan también, como capital/TIN implícito o total de cuotas con TIN 0, para que la v3.4 las siga abriendo)
  adjuntos:    [{ id, nombre, driveId, ocr, ... }],   // metadatos; el archivo va aparte (IndexedDB / Drive)
  activos:     [{ id, nombre, tipo, isin, ticker, ... }],
  operaciones: [...],                     // compras y ventas de cada activo (+ cuentaId opcional, v3.4)
  precios:     [...],                     // historial de precios apuntados a mano
  vehiculos:   [{ id, matricula, nombre, combustible: 'gasoil'|'gasolina'|'otro', capacidad, kmIniciales, activo, notas, creado }],   // v3.3
  repostajes:  [{ id, vehiculoId, movimientoId, fecha, litros, precioLitro, importe, kmTanqueAnterior, odometro, lleno, gasolinera, creado }],   // v3.3
  cuentas:     [{ id, nombre, tipo: 'corriente'|'ahorro'|'inversion'|'efectivo'|'otra', entidad, iban /* 4 últimos dígitos */, saldoInicial, fechaSaldo, color, icono, activa, orden, notas, enSaldoMes? /* v3.6: solo si difiere de lo normal del tipo */ }],   // v3.4
  traspasos:   [{ id, fecha, origenId, destinoId, importe, comision, nota, comisionMovId }],   // v3.4: entre cuentas; la comisión es el gasto com_<id>
  regularizaciones: [{ id, cuentaId, fecha, importe /* con signo */, saldoReal, nota }],      // v3.4: «Ajustar saldo»
  traspasosFondos:  [{ id, fecha, origenId, destinoId, todas, participaciones, participacionesDestino, vlOrigen, vlDestino, notas, creado }],   // v3.4
  inversiones: [],                        // v2: solo quedan borrados tras la migración
  categorias:  { gasto: [...], ingreso: [...], updatedAt },
  ajustes:     { tema, avisoGarantiaDias, notificaciones }   // solo local
}
// Cada elemento borrado queda como { id, deleted: true, updatedAt }.
// v3.3 añade dos colecciones (vehiculos, repostajes) sin cambiar nada de lo anterior: los datos antiguos se abren tal cual.
// v3.4 añade cuentas, traspasos, regularizaciones y traspasosFondos, y un cuentaId opcional en movimientos, recurrentes, deudas y operaciones
// (los movimientos, recurrentes y deudas guardan también el nombre en «cuenta»). Los datos antiguos se abren tal cual.
// El enlace gasto ↔ repostaje es repostajes[].movimientoId (movimientos[].repostajeId es solo un atajo).
```

## Copias de seguridad

**Ajustes → Exportar copia (JSON)** descarga tus datos (sin los archivos adjuntos; incluye cuentas, traspasos, ajustes y traspasos entre fondos). **Importar** una copia sustituye todos los datos, y con Drive activado ese cambio llega también a tus otros dispositivos. **Exportar CSV** abre los movimientos (con su cuenta) en Excel o Google Sheets.

## Cerrar sesión

Menú de tu foto → **Cerrar sesión**. La app pregunta si quieres borrar también la copia guardada en ese dispositivo (recomendado si es compartido). Tus datos siguen en tu Drive.

## Limitaciones conocidas

- La lectura de tickets **no es perfecta** (sobre todo Tesseract con fotos torcidas, arrugadas o con poca luz): revisa siempre la propuesta. Tesseract no lee PDF (Gemini sí).
- La TAE se calcula con la TIR mensual de los pagos (incluida la comisión de apertura); puede diferir unas décimas de la que dé el banco (seguros, otras comisiones, redondeos).
- Inversiones: no contempla dividendos, splits ni la regla de los 2 meses; es orientativo para la declaración. Los precios se apuntan a mano.
- Cuentas: los saldos son los que tú apuntas (no hay conexión con el banco); usa «Ajustar saldo» para cuadrarlos. Una compra financiada no resta de la cuenta: restan sus cuotas cuando se pagan.
- Combustible: el consumo es exacto solo entre dos depósitos **llenos**; con repostajes parciales y sin km anotados, es una aproximación. El €/km no incluye seguro, mantenimiento ni peajes.
- Las notificaciones de garantía solo salen cuando la app está abierta (no hay servidor que las envíe).
- La copia para análisis se actualiza como mucho una vez por hora y solo desde los dispositivos donde está activada; si el permiso de Google ha caducado, espera a que vuelvas a entrar o pulses *Actualizar copia ahora*.

## Para desarrolladores

- Sin compilación: edita los archivos y recarga. **Al publicar cambios, sube `VERSION` en `sw.js`** (y `APP_VERSION` en `js/config.js`).
- `Store` habla con un *adapter* (`load/save/clear`). `LocalStorageAdapter` = modo local; `DriveAdapter` = Drive + caché + cola sin conexión.
- El OCR usa una interfaz de proveedores (`OCR.registrar({ id, nombre, disponible(), leer(archivo) })`): Tesseract y Gemini son dos implementaciones.
- Consola: `FinanzasApp.Store`, `FinanzasApp.Sync`, `FinanzasApp.Auth`.

### Tests

```bash
node tests/finance.test.js          # cálculos: cuota, TAE, FIFO, recurrentes, garantías, combustible, CSV, migración
node tests/sync.test.js             # sincronización con Drive simulado (dos dispositivos, sin conexión, versiones antiguas)
node tests/cuentas.test.js          # cuentas: saldos, traspasos, ajustes, dinero invertido, traspasos entre fondos, copia para análisis
node tests/saldo-mes.test.js        # v3.6: saldo del mes con arrastre (con y sin cuentas) y vista de año
node tests/prevision.test.js        # v3.7: previsión (pendientes del mes, nómina estimada, cuotas, gasto variable, avisos, céntimos)

# Comprobaciones LOCALES opcionales con tu «copia para análisis» (no se incluyen datos en los tests):
node tests/datos-reales-check.js /ruta/finanzas-analisis.json                       # saldo del mes (v3.6.1)
node tests/prevision-real-check.js /ruta/finanzas-analisis.json [hoy] [meses] [variable]   # previsión (v3.7)

# Tests de navegador (necesitan Google Chrome y playwright-core: npm i playwright-core)
python3 -m http.server 8765 &       # desde la carpeta finanzas-app
PW_PATH=/ruta/a/node_modules/playwright-core node tests/browser.test.js
PW_PATH=/ruta/a/node_modules/playwright-core node tests/screenshots.js   # capturas con datos de ejemplo

python3 tests/fixtures/make_ticket.py   # regenera el ticket de prueba (necesita Pillow)
```

Los tests de navegador usan un Google y un Drive **simulados** (no hace falta cuenta) y simulan Gemini; Tesseract sí se ejecuta de verdad (descarga el modelo de español desde jsDelivr la primera vez). Fallan si aparece cualquier error en la consola.
