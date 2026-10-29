# Comanda Supreg

**Pedidos online y gestión para gastronomía.** Tu propio sistema de pedidos: el
cliente pide desde la web del local, sin pagarle comisión a ninguna app, y el
pedido llega solo a la cocina, la caja y el repartidor.

Sirve para pizzerías, hamburgueserías, rotiserías y cualquier local que tome
pedidos para llevar, delivery o salón.

Tres cosas en un solo proyecto: la carta pública donde el cliente arma el pedido,
el back office donde se carga la carta, y el sistema interno donde se gestionan
los pedidos, la caja, el stock, las mesas y los reportes. Todo sobre la misma
base de datos, así que no hay sincronizaciones ni datos duplicados.

> El nombre del sistema es **Comanda Supreg**. Lo que ve el cliente en la carta
> es la marca de cada local, que se configura desde el panel. Los datos de
> ejemplo usan una pizzería de demo, Pepperino, con dos sucursales.

> **Multi-cliente (SaaS):** una sola instalación atiende a todos los locales.
> Cada cliente entra por su subdominio, con su marca, sus colores, sus usuarios
> y sus datos, sin mezclarse con los demás. Arquitectura y operación:
> [`docs/SAAS.md`](docs/SAAS.md).
>
> ```
> comandasupreg.com                    → la plataforma
> pepperino.comandasupreg.com          → la carta de Pepperino
> pepperino.comandasupreg.com/admin    → el panel de Pepperino (sus empleados)
> ```

---

## Puesta en marcha en un servidor

Sirve cualquier VPS con Docker. Con 2 GB de RAM sobra para varios locales.

### 1. Apuntar el dominio

En el DNS de `comandasupreg.com` van **dos** registros `A` a la IP del servidor:

| Nombre | Tipo | Valor |
|---|---|---|
| `comandasupreg.com` | A | IP del servidor |
| `*.comandasupreg.com` | A | IP del servidor |

El comodín (`*`) cubre a todos los clientes: dar de alta uno no requiere tocar el
DNS. Caddy saca el certificado HTTPS de cada subdominio solo, la primera vez que
alguien entra.

### 2. Subir el proyecto y configurarlo

```bash
git clone <tu-repo> comanda && cd comanda
cp .env.example .env
```

Editá `.env`:

```bash
DB_PASSWORD=                  # una contraseña fuerte para Postgres
AUTH_SECRET=                  # openssl rand -base64 48
SAAS_DOMINIO=comandasupreg.com
PLATAFORMA_EMAIL=             # tu usuario de la plataforma
PLATAFORMA_PASSWORD=          # al menos 10 caracteres
PLATAFORMA_MP_TOKEN=          # opcional: tu cuenta de Mercado Pago, para cobrar los abonos
```

El pago online de cada local no va acá: cada dueño conecta su cuenta de Mercado
Pago desde su panel (ver "Pago online con Mercado Pago").

### 3. Desplegar

```bash
./deploy.sh --con-datos
```

Levanta los contenedores, aplica el esquema y carga un cliente de ejemplo,
**Pepperino Pizza**, con su carta, sus colores y usuarios de prueba. Para un
arranque en blanco, corré `./deploy.sh` sin el flag.

### 4. La plataforma y el primer cliente

Con `PLATAFORMA_EMAIL` y `PLATAFORMA_PASSWORD` en el `.env`, `deploy.sh` crea tu
usuario de la plataforma y los planes de ejemplo. Entrá a
`https://comandasupreg.com/plataforma`: ahí das de alta clientes, ponés los
precios de los planes, cobrás y suspendés. Todo está en
[`docs/SAAS.md`](docs/SAAS.md).

### Usuarios del cliente de ejemplo (Pepperino)

En `https://pepperino.comandasupreg.com/admin`:

| Rol | Email | Contraseña | Sucursales |
|---|---|---|---|
| Dueño (superadministrador) | super@pepperino.com | super1234 | Todas |
| Administrador | adrogue@pepperino.com | admin1234 | Adrogué |
| Administrador | burzaco@pepperino.com | admin1234 | Burzaco |
| Cajero | caja@pepperino.com | caja1234 | Adrogué |
| Cocina | cocina@pepperino.com | cocina1234 | Adrogué |
| Moza | mozo@pepperino.com | mozo1234 | Adrogué |
| Repartidor | reparto@pepperino.com | reparto1234 | Las dos |

**Cambiá estas contraseñas antes de abrir el local.** Se hace desde
Empleados en el panel. Los usuarios son de cada cliente: el mismo mail puede
existir en dos clientes con claves distintas.

---

## Desarrollo local

Necesitás Node 20 o superior y un PostgreSQL corriendo.

```bash
npm install
cp .env.example .env          # DATABASE_URL a tu Postgres local y SAAS_DOMINIO=localhost
npx prisma db push
npm run db:seed
npm run dev
```

Los navegadores llevan `*.localhost` a la propia PC sin configurar nada:

- `http://localhost:3000` → la plataforma
- `http://pepperino.localhost:3000` → la carta de Pepperino
- `http://pepperino.localhost:3000/admin` → su panel

---

## Cómo funciona la operación

### El circuito del pedido

```
Cliente arma el pedido y toca "Hacer el pedido"
        ↓
Entra al tablero (suena), descuenta stock y se abre WhatsApp, todo junto
        ↓
Caja lo acepta → sale la comanda por la impresora
        ↓
Cocina lo ve en su pantalla → Empezar → Listo
        ↓
El repartidor sale con él → En camino → Entregado (y cobrado)
```

Los pedidos que carga alguien del local (mostrador, teléfono, WhatsApp, salón)
**nacen aceptados** y la comanda sale sola: no tiene sentido que el cajero
acepte su propio pedido.

Cada estado solo puede pasar al siguiente que corresponde. Un pedido entregado
no se puede cancelar, uno cancelado no se cancela dos veces (y el stock no vuelve
dos veces), y si dos personas tocan el mismo pedido a la vez, cuenta la primera.
Rechazar y cancelar piden un motivo obligatorio.

### Un solo paso

"Hacer el pedido" hace todo a la vez: crea el pedido, lo manda a cocina,
descuenta el stock y abre WhatsApp con el mensaje armado. No hay confirmación
intermedia ni estado de borrador.

Si el navegador bloquea la ventana de WhatsApp, o la persona no lo tiene
instalado, el pedido entra igual. El pedido es lo importante; el mensaje es el
complemento.

### Rechazado y cancelado no son lo mismo

**Rechazado** es un pedido que entró y el local no pudo tomar: no había stock,
la dirección quedaba fuera de zona, estaban cerrando. Se rechaza antes de
aceptarlo.

**Cancelado** es un pedido que ya se había aceptado y se cayó después.

Los dos devuelven el stock y piden un motivo, pero en el reporte significan
cosas distintas. Mucho rechazo indica que hay que ajustar la carta, las zonas o
los horarios. Mucha cancelación indica un problema operativo.

El tablero muestra siete columnas, incluidas las de entregados y rechazados del
día. En celular se ve una columna por vez, elegida desde los chips de arriba.

El stock se descuenta al crear el pedido, no al entregarlo, para que dos
clientes no compren la última botella al mismo tiempo. El descuento es atómico:
si dos pedidos llegan juntos por la última unidad, uno de los dos recibe "nos
quedan 0" y el stock nunca queda negativo. Si se cancela, vuelve.

Como el stock se descuenta al entrar, la web frena los pedidos de broma: desde
una misma conexión entran hasta 6 pedidos cada media hora, y un mismo teléfono
no puede tener más de 2 esperando confirmación.

### Los dos estados del pedido

Cada pedido lleva un estado operativo (preparación, en camino, entregado) y uno
de cobro (pendiente, cobrado), por separado. Sin esa distinción el reporte de
ingresos del día contaría plata que todavía está en la calle.

Al entregar, lo que se paga en la mano (efectivo, tarjeta, Mercado Pago) queda
cobrado solo. La transferencia no: queda pendiente hasta que alguien confirma
que entró. Al cobrar se puede cambiar la forma de pago, porque el cliente que
dijo "efectivo" a veces termina pagando con tarjeta.

### Quién ve qué

| Rol | Acceso |
|---|---|
| Administrador | Todo, incluidos reportes y configuración |
| Cajero | Pedidos, caja, gastos, cocina, mesas, reservas, stock y carta |
| Cocina | Solo la pantalla de preparación: empezar y marcar listo |
| Repartidor | Solo los envíos que le asignaron o que están listos para salir |
| Mozo | Pedidos, mesas y reservas |

Cocina no puede aceptar pedidos ni marcarlos entregados: eso mueve plata y es
de caja. El repartidor solo sale con pedidos sin asignar o suyos, y solo cobra
los que lleva él.

### Pago online con Mercado Pago

Si está habilitado, la carta ofrece **"Mercado Pago (pagás ahora)"**:

```
El cliente confirma → el pedido se reserva (stock incluido) y va a pagar
        ↓
Paga en Mercado Pago → vuelve a la página de su pedido
        ↓
Se acredita → el pedido entra al tablero como nuevo (y recién ahí suena)
```

- Mientras no paga, caja lo ve con la marca "Esperando el pago", pero no lo
  puede aceptar.
- Si le rechazan la tarjeta, desde la página del pedido puede reintentar.
- Si en **30 minutos** no pagó, el pedido se da de baja solo y el stock vuelve.
- Si se cancela un pedido ya pagado, **se devuelve la plata** automáticamente.
  Si un pago llega después de que el pedido venció, también se devuelve.
- El pago se confirma por el webhook **y** cuando el cliente vuelve a la
  página del pedido. Así funciona aunque el webhook no llegue (por ejemplo, en
  una demo corriendo en una PC sin dominio público).
- Nunca se confía en lo que dice el aviso: el pago se consulta a la API de
  Mercado Pago y se controla que el monto sea el del pedido.
- No se aceptan Rapipago ni Pago Fácil: tardan días y el pedido es para ya.

En el mostrador, "Mercado Pago" sigue siendo el QR del local: se cobra como
cualquier otro medio.

**Cada local cobra en su cuenta.** El dueño elige el modo en **Configuración →
Cobro online** (si su plan incluye el pago online):

| Modo | Para qué |
|---|---|
| Apagado | La carta no ofrece pagar online |
| Demo | Una pantalla de pago de prueba con "Aprobar" y "Rechazar". **No usar con clientes reales.** |
| Mercado Pago | Pega el Access Token de su cuenta (se verifica y se guarda cifrado). Con un token de **prueba** es el sandbox: checkout real, tarjetas de prueba |

Para el sandbox: en el [panel de desarrolladores](https://www.mercadopago.com.ar/developers/panel)
creá una aplicación, copiá el Access Token de prueba y pagá con las
[tarjetas de prueba](https://www.mercadopago.com.ar/developers/es/docs/checkout-pro/additional-content/your-integrations/test/cards)
(titular `APRO` para aprobar, `OTHE` para rechazar). El webhook del local es
`https://<cliente>.comandasupreg.com/api/mp/webhook` (la pantalla lo muestra) y
su clave secreta se pega en la misma pantalla.

### WhatsApp

Al confirmar, el pedido ya entró al sistema y además se ofrece abrir WhatsApp con
el mensaje armado. Es un enlace `wa.me`: no cuesta nada, no requiere aprobación
de Meta y funciona desde el primer día. La contra es que el mensaje lo manda el
cliente, así que no se pueden automatizar avisos de estado. Si más adelante
quieren eso, hay que migrar a la API Cloud de WhatsApp, que necesita Meta
Business verificado, un número dedicado y plantillas aprobadas, y se paga por
conversación.

### Impresión

El navegador no puede hablar ESC/POS y la impresora está en la red del local, no
en el servidor. Por eso hay un programa aparte que corre en la PC del local: cada
dos segundos consulta si hay comandas y las manda a imprimir. Está en
`print-agent/` y se distribuye como `ComandaSupreg-Impresora.exe`
(`public/descargas/`, se descarga desde el panel).

Al aceptar un pedido se generan dos comandas: cocina (sin precios) y caja (con
detalle y vuelto). **Las impresoras se agregan por local** en Configuración →
Impresión y comandas, cada una con un nombre y qué imprime:

- **Todo**: comanda y ticket por la misma impresora. Es el caso del local con una
  sola impresora en la caja.
- **Solo cocina** / **Solo caja**: para el local con dos impresoras.

Al agregarla, el panel da un código de 8 letras (sirve una vez, 30 minutos). En la
PC del local se abre el `.exe`, se escribe el código, se elige la impresora de la
lista (busca las instaladas en Windows y las de red con el puerto 9100), se
imprime una prueba y listo: se copia a `%LOCALAPPDATA%\ComandaSupreg`, queda en
el inicio de sesión de Windows sin ventana y no pide permisos de administrador.
Desde el panel se ve cada impresora en vivo (andando, sin conexión, o conectada
pero con la impresora fallando, con el error), se le manda una prueba, se cambia
qué imprime sin tocar la PC, se pasa a otra PC o se quita. Si en una configuración
nadie recibe la comanda de cocina o el ticket de caja, el panel lo avisa.

Cada impresora tiene su propia clave, atada a su sucursal: no ve comandas de
otro local ni de otro cliente. La forma vieja (archivo `.env` con la clave
general del cliente y `SUCURSAL=`) sigue andando para Linux o Raspberry Pi.

**Rearmar el `.exe`** (después de cambiar algo en `print-agent/`): en
`print-agent/`, `npm install` y `npm run exe` (Node 22.12 o más nuevo; con uno
anterior, `NODE_OPTIONS=--experimental-require-module npm run exe`). Se puede
armar desde Linux. No está firmado: Windows muestra "Windows protegió su PC" la
primera vez (Más información → Ejecutar de todas formas). Para sacar ese cartel
hace falta un certificado de firma de código.

**Cómo salen** se ajusta en Configuración → Impresión y comandas, con una vista
previa de la térmica que se actualiza mientras se cambia:

- Cocina: título ("COCINA", "HORNO"), tamaño de los productos (normal, grande o
  enorme), copias, el tipo de pedido bien grande (">> ENVIO <<", "SALON - Mesa
  11"), hora, cliente, dirección en los envíos, "TOTAL: 6 productos", y qué
  hacer con las bebidas: como un producto más, aparte al final, o que no vayan a
  cocina. Además se puede poner "LLEVA BEBIDA" bien grande arriba. Qué
  categorías son bebidas se elige; si no, las que se llaman "bebida".
- Caja: siempre, solo envíos o nunca; encabezado, mensaje al pie, copias, tamaño
  del total y el alias si paga por transferencia. "Reimprimir" desde un pedido
  saca el ticket igual.

La letra **enorme** (doble alto y ancho, 21 letras por renglón) necesita el
agente de impresión 1.1 o más nuevo. Uno viejo la imprime en letra normal.

Si la impresora está apagada, las comandas quedan en cola y el agente reintenta
hasta que vuelve. Pasadas 4 horas se descartan (no tiene sentido imprimir al
abrir un pedido de anoche); siempre se pueden reimprimir desde la ficha.

### Sonido

El tablero y la pantalla de cocina suenan con cada pedido nuevo. Los navegadores
bloquean el sonido hasta que alguien toca la pantalla: mientras esté bloqueado se
ve un botón "Activar sonido". Si la pestaña está en segundo plano, además el
título parpadea.

### Hora del local

Todo el sistema trabaja con la hora de Argentina, aunque el servidor esté en
UTC: horarios de apertura, promos por día, reservas, reportes por día y por
hora, y la hora de las comandas. Se fija en `TZ` (Dockerfile y compose) y en
`src/instrumentation.ts`.

---

## Sucursales

El sistema maneja hasta tres locales, cada uno con **su propia carta**: categorías,
productos, precios, stock, promociones y zonas de envío son independientes. Los
datos del local (WhatsApp, dirección, horarios, alias bancario, link de reseñas)
también viven en la sucursal, no en una configuración global.

El cliente entra a la raíz del sitio y elige el local. Después navega en
`/adrogue` o `/burzaco`. Si hay un solo local activo, la pantalla de selección se
saltea sola.

En el panel, cada persona ve el selector de sucursal arriba a la izquierda con
los locales que tiene asignados. Todo lo que hace queda acotado a ese local: un
pedido de Adrogué no se puede tocar desde Burzaco ni conociendo el ID.

**Para abrir un local nuevo:** Sucursales → Agregar. Nace apagada y sin carta.
Cambiás a ella con el selector, entrás a Productos y copiás la carta de otro
local con un botón. Se copian categorías, productos, tamaños y adicionales; el
stock no, porque es propio de cada uno. Cuando está lista, la activás y aparece
en la web.

Apagar una sucursal la saca de la web pública pero no borra nada: los pedidos
históricos y los reportes siguen estando. No se puede apagar si tiene pedidos sin
cerrar, ni si es la última activa.

El tope de tres está en `src/lib/sucursales.ts`, en la constante `MAX_SUCURSALES`.

---

## Roles y permisos

Los permisos se editan desde el panel, en la pantalla de Permisos. Hay 24
permisos agrupados en ocho secciones. Los que terminan en "ver" son los que abren
cada pantalla del menú: sin ellos, la sección no aparece.

| Rol | Para qué es |
|---|---|
| Superadministrador | Ve todas las sucursales y es el único que puede crearlas. No se le pueden quitar permisos. |
| Administrador | Maneja su sucursal completa, menos crear locales. |
| Cajero | El día a día del mostrador: pedidos, mesas y stock. |
| Cocina | Solo la pantalla de preparación. |
| Repartidor | Los pedidos que tiene que llevar. |
| Mozo | Mesas, reservas y pedidos del salón. |

Además del rol, cada persona puede tener **permisos extra** sueltos. Sirve para el
cajero de confianza que además carga stock, sin tener que cambiarle los permisos
a todos los cajeros.

Nadie se puede quitar a sí mismo el permiso de gestionar permisos, y solo un
superadministrador puede crear o editar a otro.

---

## La carta: tamaños, adicionales, mitad y mitad, combos

Cada producto puede tener **tamaños** (chica, grande) con su precio y **grupos de
opciones** con mínimo y máximo. Con esas dos piezas se arma casi todo:

| Qué | Cómo se carga |
|---|---|
| Extras con recargo | Grupo "Extras", mínimo 0, máximo 4, cada opción con su precio |
| Mitad y mitad | Dos grupos "Primera mitad" y "Segunda mitad", mínimo 1, máximo 1, con los gustos a $0 y tildado "Son gustos de pizza" |
| Combo hamburguesa | Grupo "Bebida" (mín. 1, máx. 1) y grupo "Guarnición" (mín. 1, máx. 1) |
| Punto de la carne | Grupo "Punto", mínimo 1, máximo 1, opciones a $0 |
| Docena surtida | Con una nota: un grupo no deja elegir el mismo gusto varias veces (6 de carne, 6 de jamón) |

Los grupos obligatorios no se pueden saltear, ni en la web ni en el mostrador, y
en la comanda salen como líneas propias ("+ Napolitana"), no perdidos en una nota.
Así sirve igual para pizzería, hamburguesería o rotisería.

Si el producto tiene tamaños, elegir uno es obligatorio. El precio base se usa
solo en productos sin tamaños.

### Precio de la mitad y mitad

En Configuración → **Mitad y mitad** cada local elige cómo la cobra:

| Opción | Mitad muzza ($13.500) y mitad fugazzeta ($18.500), grande |
|---|---|
| Precio fijo | Lo que diga el producto "Mitad y mitad" (como venía) |
| La mitad más cara | $18.500: lo mismo que una entera de la más cara |
| Promedio de las dos | $16.000 (redondeado a $100 para arriba) |

El gusto de cada mitad se busca en la pizza del mismo nombre y en el mismo
tamaño ("Fugazzeta" encuentra "Fugazzeta rellena"). Si un gusto no tiene pizza
con ese nombre, no cuenta; si ninguno tiene, se cobra el precio fijo. Los extras
se suman aparte y las promos de porcentaje del producto se aplican encima. La
carta online, el mostrador y el mozo muestran el mismo precio que se cobra.

---

## Promociones

Hay dos familias distintas.

**Automáticas por producto.** Se aplican solas en la carta: elegís los productos
y los días de la semana, y el precio aparece tachado con el precio nuevo al
lado. No requieren código ni que el cliente haga nada. Sirven para "los martes
las empanadas al 20%" o "fainá a mitad de precio miércoles y jueves".

Pueden ser un porcentaje, que funciona en cualquier producto, o un precio fijo,
que solo funciona en productos sin tamaños. El motivo: si una pizza tiene chica
y grande, un precio fijo no dice a cuál de las dos aplicarlo. El sistema lo
valida y no te deja guardarlo mal.

**Con código.** El cliente escribe un código al confirmar el pedido y se
descuenta del total: un porcentaje, un monto fijo o el envío. Sirven para
campañas puntuales y para medir de dónde vino la venta.

Cualquiera de las dos puede mostrarse como cartel arriba de la carta o como
pop-up al entrar. Si varias promos alcanzan al mismo producto, gana la que deje
el precio más bajo.

---

## Caja

Pantalla **Caja**. El cajero la abre al empezar el turno con el cambio que hay en
el cajón. Durante el turno registra lo que entra o sale que no es una venta:
pago a un proveedor, un retiro del dueño, cambio que trajo alguien.

La pantalla muestra en todo momento cuánto se cobró por cada forma de pago y
cuánto efectivo **tendría que haber** en el cajón:

```
fondo inicial + ventas en efectivo + ingresos − egresos
```

Al cerrar se cuenta la plata y el sistema registra la diferencia, que queda en
el historial de cierres junto con quién abrió y quién cerró. También muestra:

- **Rendición de repartidores**: el efectivo que cobró cada uno en la puerta.
- **Entregados sin cobrar**: casi siempre transferencias que nadie confirmó.
- **Cobrados y después cancelados**: plata que se devolvió.

Las ventas se cuentan por la hora en que se cobraron, no por la del pedido.

---

## Finanzas: el tablero del dueño

Pantalla **Finanzas** (la ve quien tiene acceso a Reportes). Para cualquier
período (este mes, el anterior, hoy, la semana, el año o fechas a elección):

- **Entró:** la plata cobrada, por fecha de cobro. No cuenta lo que se canceló
  o se devolvió, ni lo entregado que todavía no se cobró.
- **Gastos**, **ganancia o pérdida** y **entregado sin cobrar** (casi siempre
  transferencias que nadie confirmó).
- Descuentos dados, envíos cobrados, devoluciones y **diferencias de caja**:
  un faltante resta de la ganancia, un sobrante suma.
- Entró y gastó, **día por día** (mes por mes si el período es largo).
- **Cómo entró la plata:** por forma de pago, por tipo de pedido y por canal.
- **En qué se gastó:** por categoría y a qué proveedor se le pagó más.
- **Lo que más se vendió**, por unidades o por plata, y por categoría.
- Últimos cobros (con quién cobró y si se cambió la forma de pago), últimos
  gastos (con quién los cargó) y **lo que se perdió**.

**Descargas para Excel** del mismo período:

| Archivo | Qué tiene |
|---|---|
| Libro de movimientos | Cada cobro y cada gasto en orden, con saldo. El saldo final es la ganancia de la pantalla. |
| Cobros | Cada pedido cobrado: forma de pago, la que había elegido el cliente si cambió, y quién cobró |
| Gastos | Con quién cargó y los anulados, con quién los anuló y por qué |
| Ventas por producto | Unidades y plata de cada producto |
| Mermas | Lo que se perdió, con motivo y quién lo anotó |

Una sola definición para todo: Finanzas, Gastos y Reportes calculan la ganancia
con las mismas funciones (`src/lib/finanzas.ts`), así los números cierran entre
pantallas. Reportes muestra además lo **vendido** (entregado) para mirar la
operación: pedidos, horarios y tiempos.

---

## Mermas

Sección **Mermas** del menú, en "Día a día". Se anota todo lo que se va sin
cobrarse, **en unidades, sin plata**, eligiendo qué pasó:

| Tipo | Por ejemplo |
|---|---|
| Se rompió | Una botella, un frasco |
| Se venció | Un postre, un lácteo |
| Salió mal | Se quemó, se cayó, el cliente lo devolvió |
| Regalo o cortesía | Al cliente de siempre, por una demora |
| Consumo del personal | La comida del equipo |
| Otro | Con detalle obligatorio |

Se toca el tipo, se busca el producto, se ajusta la cantidad y listo; el detalle
es opcional (salvo en "Otro"). Si el producto lleva control de stock, además se
descuenta. Queda quién lo anotó y cuándo.

La pantalla muestra el mes: cuánto se fue por cada tipo, qué productos y el
registro completo, descargable para Excel. En Finanzas aparece el mismo resumen.

También se anotan los **insumos** que se pierden (1 kg de muzzarella
vencida), en su unidad: se busca el insumo en el mismo buscador.

Para un pedido que salió mal o se regaló, desde la ficha del pedido: **"Algo
salió mal o se regaló"**. Se eligen los productos y quedan con el código del
pedido. El pedido no cambia: si se rehace, se carga aparte.

**Quién puede anotar:** el permiso "Anotar mermas" lo tienen la caja, la cocina
(lo que se quema) y el mozo (lo que regala). No habilita a tocar el resto del
stock.

---

## Gastos y resultado del mes

Pantalla **Gastos**. Se anota cada compra o pago del local: "5/10, compra de
pollo, $120.000". Cada gasto lleva fecha, categoría, descripción, monto, cómo se
pagó y, si se quiere, el proveedor. Queda quién lo cargó.

Las categorías son fijas (mercadería, bebidas, descartables, sueldos, alquiler,
servicios, mantenimiento, impuestos, comisiones, publicidad, otros) para que el
resumen del mes sirva: si cada uno escribe la suya, no se puede sumar nada.

Por mes se ve:

- **Entró** (lo cobrado), **gastos** y **ganancia o pérdida**, con las diferencias de caja.
- Cuánto se fue en cada categoría, y la comparación con el mes anterior.
- El registro completo, filtrable por categoría y descargable para Excel (para
  el contador).

Lo mismo aparece en **Reportes** para cualquier rango de fechas.

**Con la caja.** Si el gasto se paga con el efectivo del cajón y hay un turno
abierto, sale también como egreso de la caja, sin cargarlo dos veces. Al revés,
desde la caja una salida de plata se puede marcar como gasto con su categoría.
Un retiro del dueño o cambio que se lleva al banco sale de la caja pero no es
un gasto.

**Nada se borra.** Un gasto cargado mal se anula con un motivo y queda tachado
en el registro, con quién y cuándo lo anuló. El cajero puede anular lo que cargó
él ese mismo día; lo demás necesita el permiso "Anular gastos".

Quién ve qué: el cajero carga y ve los gastos; la ganancia del negocio la ve solo
quien tiene acceso a Reportes.

La ganancia es tan buena como lo que se cargue: si no se anota la mercadería o
los sueldos, sale más alta de lo que es.

---

## Sueldos

Gastos → pestaña **Sueldos**. Se carga a cada persona del equipo con su puesto y
su sueldo mensual (o sin sueldo, si cobra por día), y opcionalmente su usuario
del sistema.

**Pagar** anota sueldo, adelanto, aguinaldo, horas extra o premio, vacaciones u
otro, con monto, fecha, de qué mes es y cómo se pagó. Para cada uno se ve cuánto
cobró en el mes, los extras y **cuánto le falta** (sueldo y adelantos se
descuentan del sueldo acordado; lo demás va aparte).

Cada pago es un gasto de la categoría Sueldos, así que entra solo en Gastos, en
el resultado del mes y en **Finanzas**, que además muestra lo pagado a cada
persona. Si se paga con el efectivo de la caja y hay turno abierto, sale de la
caja. Se anula como cualquier gasto.

Lo que cobra cada uno es privado: con "Ver sueldos" (encargado) se ve todo; sin
ese permiso (la caja), Gastos y su Excel no muestran esos pagos, solo avisan
cuántos hay, aunque sí suman en el total.

---

## Stock

Una sola pantalla con cuatro pestañas:

- **Qué hay ahora.** Los niveles actuales y los movimientos sueltos del día:
  llegó mercadería, se rompió algo, corrijo un número.
- **Conteo físico.** La planilla de fin de mes. Alguien recorre la heladera con
  el celular, anota lo que hay de verdad y el sistema registra las diferencias
  como ajustes. Lo que dejás vacío no se toca.
- **Historial.** Cada movimiento con el valor anterior, el nuevo, el motivo y
  quién lo hizo.
- **Qué se controla.** Prendés o apagás el seguimiento producto por producto.

Conviene controlar bebidas y postres, que se cuentan de a unidades. En pizzas y
empanadas normalmente no, porque se hacen al momento. Cuando un producto
controlado llega a cero, se marca agotado solo en la carta.

---

## Insumos y recetas

Menú → Carta y stock → **Insumos y recetas**. El Stock de arriba es de lo que
se vende tal cual (una Coca, un flan). Los **insumos** son lo que se usa para
preparar: muzzarella, jamón, harina, salsa, bollos. Se miden en **kilos,
litros o unidades** y aceptan decimales: "5", "2,5", "500 g", "250 ml".

**Qué hay.** Cada insumo con lo que queda, para cuántos días alcanza (según lo
vendido en las últimas dos semanas) y lo que entró, se vendió y se perdió en 30
días. Arriba, "Para comprar": lo que bajó del mínimo de cada uno. Tres botones:

- **Entró.** Llegó mercadería: "5 kg de muzzarella". Opcionalmente se pone lo
  que se pagó, el proveedor y cómo, y queda también en **Gastos** (categoría
  Mercadería, fecha de hoy, tu usuario). Se carga una sola vez. Si se pagó con
  el efectivo de la caja y hay turno abierto, sale de la caja como cualquier
  gasto.
- **Conté.** Se pone lo que hay de verdad; se corrige y la diferencia queda
  anotada. Es lo que la receta no explica (porciones generosas, pérdidas sin
  anotar).
- **Se perdió.** Se venció, se cayó, lo usó el equipo. Aparece también en
  Mermas. Desde Mermas se puede anotar igual, buscando el insumo.

**Recetas.** Cuánto lleva cada producto, en gramos, ml o unidades. Las pizzas
llevan una receta por tamaño (con "Copiar a los otros tamaños" para armar la
grande y ajustar la chica), y cada extra suma lo suyo ("Doble muzzarella: 150 g
de muzzarella"). Con cada venta se descuenta solo; si el pedido se rechaza o
se cancela, vuelve. Un producto sin receta no descuenta nada.

**Nunca frena una venta.** A diferencia del stock de productos, un insumo puede
quedar en negativo: la receta es una estimación. La pantalla lo marca ("Contalo:
no cierra") y el conteo lo corrige.

Una pizza que salió mal o se regaló se anota en **Mermas**, por producto: sus
insumos ya se descontaron con la venta y no se descuentan dos veces.

**Permisos:** "Ver insumos" (caja y cocina), "Cargar insumos" (caja) y "Editar
recetas" (encargado). Para poner lo que se pagó al anotar una entrada hace falta
además "Cargar gastos".

---

## Reportes

Todos parametrizables por rango de fechas, tipo de pedido y canal:

- Lo vendido (entregado), ticket promedio, descuentos, rechazos y cancelaciones
  (los pagos online que nunca se completaron se cuentan aparte)
- Evolución diaria y en qué franja horaria entran los pedidos
- Ranking de productos por unidades y por facturación
- Cortes por tipo de pedido, canal y forma de pago
- Tiempos promedio de aceptación, cocina, reparto y total
- Mermas, en unidades
- Clientes que más gastaron
- Gastos y ganancia del período, con la misma cuenta que Finanzas

Reportes mira la operación: lo vendido es lo entregado, por fecha del pedido.
La plata que entró (lo cobrado, por fecha de cobro) está en Finanzas.

---

## Mantenimiento

```bash
docker compose logs -f app        # ver qué está pasando
docker compose restart app        # reiniciar
docker compose up -d --build      # desplegar cambios
```

Las migraciones y el seed corren en un contenedor aparte, `tools`, que se
construye desde la etapa de build y sí tiene Prisma adentro. La imagen de
producción es mínima a propósito y no las lleva:

```bash
docker compose run --rm tools npx prisma db push
docker compose run --rm tools npx tsx prisma/seed.ts
docker compose run --rm --service-ports tools npx prisma studio
```

**Backups.** Un contenedor hace `pg_dump` comprimido todos los días en
`./backups/` y borra los de más de 14 días. Copialos a otro lado: un backup en el
mismo servidor no es un backup.

**Restaurar:**

```bash
gunzip -c backups/pizzeria-20260916-0300.sql.gz | \
  docker compose exec -T db psql -U pizzeria pizzeria
```

**Fotos de productos.** Se guardan en `data/uploads`, montado como volumen, y se
sirven por `/api/media`. No van en `public` a propósito: Next.js lee esa carpeta
al arrancar y trata su contenido como estático congelado, así que un archivo
subido después devuelve 404 aunque esté en disco. Se optimizan solas a WebP de
1200px al subirlas.

---

## Estructura

```
prisma/schema.prisma          Modelo de datos completo
prisma/seed.ts                Carta de ejemplo y usuarios

src/lib/
  db.ts                       Cliente de Prisma
  session.ts                  Sesiones y permisos por rol
  permisos.ts                 Catálogo de permisos y valores por rol
  money.ts                    Plata en centavos, nunca float
  tiempo.ts                   Hora del local (Argentina), en 24 horas
  sucursales.ts               Sucursales, marca, horarios y armado del WhatsApp
  print.ts                    Generación de comandas ESC/POS
  impresora.ts                Autenticación y cola del agente de impresión
  caja.ts                     Cálculo del turno de caja
  finanzas.ts                 Entró, gastos y ganancia: la única cuenta, usada en todas las pantallas
  gastos.ts                   Todo lo de gastos en un import
  gastos-categorias.ts        Categorías y formas de pago de los gastos
  gastos-fechas.ts            Fechas de gasto (días de calendario) y meses
  periodo.ts                  Período elegido en Finanzas y sus atajos
  limite.ts                   Límite de intentos (login, pedidos, reservas)
  mercadopago.ts              Cliente de la API de Mercado Pago y sus modos
  pagos.ts                    Circuito del pago online: link, acreditación, vencimiento, reembolso
  stock.ts                    Devolución de stock al cerrar un pedido
  reportes.ts                 Motor de reportes

src/actions/
  orders.ts                   Creación de pedidos, estados, stock y cobro
  caja.ts                     Apertura, movimientos y cierre de caja
  gastos.ts                   Carga y anulación de gastos
  catalog.ts                  Categorías, productos, promos y zonas
  operacion.ts                Acceso, stock, empleados, mesas y reservas
  config.ts                   Ajustes del local, horarios y permisos

src/app/
  page.tsx                    Carta pública
  reservas/                   Reservas, cumpleaños y eventos
  pedido/[code]/              Seguimiento del pedido
  login/                      Acceso del personal
  admin/                      Sistema interno (16 secciones)
  pago-demo/                  Pantalla de pago simulado (locales con el cobro online en modo Demo)
  api/finanzas/exportar       Descargas para Excel de Finanzas
  api/                        Feed de pedidos, fotos, cola de impresión, webhook de Mercado Pago

print-agent/                  Agente de impresión para la PC del local
```

---

## Actualizar desde una versión anterior

```bash
git pull
./deploy.sh
```

`deploy.sh` hace, en orden:

1. Una copia de la base en `backups/antes-de-actualizar-FECHA.sql.gz`.
2. Aplica el esquema **sin** `--accept-data-loss`: si un cambio fuera a borrar
   datos, frena y avisa en vez de borrarlos.
3. Suma a los roles los permisos que aparecieron en la versión nueva (una sola
   vez; ver `prisma/actualizar-permisos.ts`).
4. Levanta todo.

Después de actualizar, todos vuelven a iniciar sesión una vez.

**Agente de impresión:** los agentes con `.env` siguen andando. Para pasar a
la instalación con código, agregá la impresora en el panel y abrí el `.exe` en
la PC del local (ver `print-agent/README.md`).

---

## Cambiar la identidad visual

Los colores están en `tailwind.config.ts` y en `src/app/globals.css`. Cambiando
esos dos archivos cambia toda la aplicación.

La paleta actual es negro, rojo y crema, tomada de la gráfica de Pepperino. La
tipografía de títulos es Anton, condensada y pesada, en línea con los placares
de sus publicaciones. Se define en `src/app/layout.tsx`.

El verde queda reservado solo para confirmaciones: pedido cobrado, stock
repuesto, reserva confirmada. No es un color de marca.

---

## Mesas y reservas

### Salón: el mozo con el celular

Menú → Día a día → **Salón**. Todas las mesas, ocupadas en negro con cuántos son,
hace cuánto, qué mozo, cuánto van y si hay algo "Para servir". Se actualiza solo
cada 20 segundos. "Mis mesas" filtra las propias.

1. Se sientan: se toca la mesa 11, **¿cuántos son?** 3, "Abrir Mesa 11 con 3".
2. **Anotar el pedido**: se elige de la carta ahí mismo, en el celular o la
   tablet. Sale la comanda en cocina con "SALON - Mesa 11" y "3 personas".
3. **Otra ronda**: se suma a la misma cuenta y sale una comanda de AGREGADO.
4. Cuando cocina lo marca listo, la mesa muestra "Para servir"; al llevarlo,
   **Ya lo serví**. Servir no es cobrar: la mesa sigue abierta.
5. **Imprimir la cuenta** saca un solo ticket en la caja con todas las rondas,
   y muestra cuánto es por persona.
6. **Cobrar y liberar**: quien puede cobrar elige cómo pagaron y la mesa queda
   libre. El mozo sin permiso de cobro ve "que la caja cobre la mesa".

Una reserva marcada como llegada abre la mesa en Salón con la gente de la
reserva. "La atiendo yo" pasa la mesa a otro mozo.

### La cuenta de la mesa

El mozo o el cajero carga el pedido del salón con la mesa elegida. Cuando piden
la segunda ronda, desde la ficha del pedido se toca **Agregar productos**: se
suma al mismo pedido y sale una comanda de cocina marcada como AGREGADO, solo
con lo nuevo. Al final se cobra todo junto. Una mesa cargada sin abrirla desde Salón se libera
sola cuando no le queda ningún pedido abierto; una abierta en Salón (con gente
sentada) la libera el mozo o la caja al cerrarla.

### La grilla

La pantalla de Mesas es una grilla por día. Elegís la fecha arriba y una franja
horaria, y cada mesa se pinta según **ese momento**: una mesa reservada a las 21
aparece disponible a las 13.

Cada mesa muestra además una barra con el día completo, donde se ven los bloques
ocupados y una marca de dónde estás parado. Así, de un vistazo, ves cómo se va
llenando el salón.

Desde una mesa libre reservás directo: nombre, hora, personas y cuánto ocupa. La
duración se elige en cada reserva, con un valor sugerido configurable. Si la
franja se pisa con otra reserva, el sistema frena y dice quién tiene la mesa.

Tocando una reserva la marcás como llegada, cumplida, no se presentó o cancelada.

El ancho de las franjas (15, 30 o 60 minutos) y la duración sugerida se
configuran por sucursal, en Configuración → Datos del local.

El estado operativo de la mesa (en servicio, ocupada ahora, fuera de servicio) es
del momento actual y solo se puede cambiar cuando estás parado en el día de hoy.

---

## Qué está preparado pero no activo

- **Turnos de empleados.** Se puede fichar entrada y salida, y los repartidores
  cargados aparecen en el tablero para asignarles pedidos.
- **Automatizaciones de mensajes.** La ficha de pedido y los cambios de estado ya
  están centralizados, así que enganchar un aviso automático por WhatsApp en cada
  columna es agregar una llamada en `cambiarEstado`.
- **Factura electrónica (ARCA/AFIP).** No está. Si el local factura, hay que
  integrar un servicio de facturación o el web service de ARCA con el
  certificado del contribuyente.
# comanda-saas
