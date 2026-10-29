# Modo SaaS (multi-cliente)

Una sola instalación atiende a todos los clientes. Cada cliente (una pizzería,
una hamburguesería…) tiene **su subdominio**, **su marca** y **sus sucursales**, y
todo lo demás (carta, pedidos, caja, stock, empleados, gastos) cuelga de esas
sucursales. Los datos de un cliente nunca se ven desde otro.

```
comandasupreg.com                    → la plataforma (portada, "Ingresar a mi local")
pepperino.comandasupreg.com          → la carta de Pepperino (o el selector, si tiene varios locales)
pepperino.comandasupreg.com/admin    → el ingreso y el panel de Pepperino
pedidos.pepperino.com.ar             → lo mismo, si se carga como dominio propio (Tenant.customDomain)
```

## Cómo se separan los datos

Una sola base de Postgres, con el cliente (`Tenant`) arriba de las sucursales.
No se usa un schema por cliente (como en el CRM con django-tenants) porque
Prisma no lo maneja bien: haría falta una conexión por cliente y migrar uno por
uno. Acá casi todo ya estaba separado por sucursal; alcanzó con agregar un nivel.

| Pieza | Cómo se separa |
|---|---|
| Cliente del pedido | Se lee del dominio (`src/lib/tenant.ts`). Detrás de Caddy, del host original. |
| Sucursales | `Branch.tenantId`. El slug (`/adrogue`) es único dentro del cliente. |
| Usuarios | `User.tenantId`. El mail es único dentro del cliente: el mismo mail puede ser empleado de dos clientes, con claves distintas. |
| Sesión | El token lleva el cliente y solo vale en su dominio. Con el cliente suspendido no entra nadie. El "superadministrador" es el dueño de **su** cliente: ve todas sus sucursales, nunca las de otro. |
| Permisos por rol | `RolePermisos` por cliente: cada dueño ajusta los suyos. |
| Carta, pedidos, caja, stock… | Por sucursal, como siempre. Cada acción valida que la sucursal sea de la sesión. |
| Acciones públicas | Crear pedido, reservar, validar un código, pagar: la sucursal tiene que ser del cliente del dominio. El seguimiento `/pedido/CODIGO` solo muestra pedidos del cliente del dominio. |
| Fotos | `data/uploads/<id del cliente>/`, servidas solo desde su dominio. |
| Impresora | Cada impresora se agrega por sucursal y se vincula con un código de un solo uso; recibe su propia clave (se guarda solo el hash) atada a esa sucursal, y entra por cualquier dominio. La clave general del cliente (para `.env`) entra solo por su dominio. |
| Marca | Nombre, eslogan, logo y tres colores en `Tenant`. El layout los pone como variables CSS y todo el sistema (carta, panel, cocina) se pinta con eso. |

La prueba de punta a punta del aislamiento (dos clientes, ~70 controles: dominios,
sesiones cruzadas, pedidos, empleados, fotos, impresora, marca, suspensión) es
la que hay que correr antes de cada versión.

## La marca de cada cliente

Panel → El local → **Marca** (solo el dueño): nombre, eslogan, logo y tres
colores, con una vista previa de la carta y los botones.

- **Principal**: barras y botones, con letra clara encima. Tiene que ser oscuro
  (contraste 4.5 con el fondo); si no, no deja guardar.
- **Acento**: botones de acción, ofertas, avisos. La letra encima (blanca u
  oscura) se elige sola según el color.
- **Fondo**: claro.

Los tonos intermedios (hover, bordes, fondos suaves) salen de esos tres
(`src/lib/tema.ts`). Los colores de peligro, confirmación y texto son fijos.

## Certificados y servidor

- DNS: `comandasupreg.com` y `*.comandasupreg.com` → IP del servidor.
- Caddy saca un certificado por dirección la primera vez que alguien entra
  ("on demand"). Antes pregunta a `/api/tls/permitido` si esa dirección es de
  un cliente real, así no se le pueden hacer pedir certificados para cualquier
  dominio. No hace falta un certificado comodín ni tocar el Caddyfile al dar de
  alta un cliente.
- Variables: `SAAS_DOMINIO` (obligatoria). `TENANT_POR_DEFECTO` solo para una
  instalación de un solo local o para entrar por IP.

## Panel de la plataforma

`https://comandasupreg.com/plataforma` (solo en el dominio de la plataforma). Tiene
su propio ingreso y sus propios usuarios: ningún empleado de un local llega acá,
y esta sesión no abre el panel de ningún local.

El primer administrador lo crea `deploy.sh` con `PLATAFORMA_EMAIL` y
`PLATAFORMA_PASSWORD` del `.env`, o a mano:

```bash
docker compose run --rm tools npx tsx prisma/plataforma.ts --email vos@supregsolutions.com --password "clave-larga"
```

| Pantalla | Qué hace |
|---|---|
| **Clientes** | La lista, primero los que hay que mirar (vencidos, por vencer). Ingreso mensual, cobrado en el mes, filtros y búsqueda. "Revisar vencimientos" corre la revisión al momento. |
| **Nuevo cliente** | Dirección (subdominio), dueño, primera sucursal, plan, días de prueba y colores. Queda andando al instante. |
| **Ficha del cliente** | Plan, límites y funciones extra, precio acordado, vencimiento, prueba, suspensión automática, contacto, dominio propio, notas. Registrar o anular pagos, links de Mercado Pago, suspender o reactivar, uso (sucursales, usuarios, pedidos del mes) y su bitácora. |
| **Planes** | Precio, sucursales, usuarios y funciones de cada plan. Cambiar un plan rige al momento para todos sus clientes. |
| **Pagos** | Lo cobrado en cada mes, por medio de pago. |
| **Bitácora** | Ingresos, cambios, pagos, suspensiones y credenciales, de la plataforma y de todos los locales. |

## Planes y funciones

Lo básico lo tiene todo el mundo: carta online, pedidos, cocina, caja, stock,
mermas, gastos, finanzas y reportes. Las funciones opcionales
(`src/lib/plan.ts`) se prenden por plan, o a un cliente puntual desde su ficha
(se suman a las del plan):

| Función | Qué incluye |
|---|---|
| `salon` | Salón para el mozo, mesas y reservas (también la reserva online desde la carta) |
| `insumos` | Insumos y recetas |
| `sueldos` | Personal, sueldos y adelantos |
| `pago_online` | Cobro con Mercado Pago desde la carta, en la cuenta del local |

Lo que no está en su plan desaparece del menú y de la carta, y sus pantallas y
acciones se niegan. Los límites (sucursales, usuarios activos) se controlan al
crear una sucursal o dar de alta o reactivar un empleado. Un cliente **sin plan**
tiene todo y no tiene límites (cortesía, o un cliente viejo).

Para sumar una función nueva y cobrarla aparte: agregarla a `FUNCIONES`, envolver
sus pantallas con `exigirFuncion(s, 'id')`, sus acciones con
`tieneFuncion(s, 'id')`, y su entrada del menú en `SECCIONES_DE_FUNCION`. No
envolver algo que los clientes ya usan: se les apagaría.

## Cobros del abono

Cada cliente tiene **pagado hasta** y un **precio** (el de su plan o uno
acordado). La revisión corre sola cada hora (`src/instrumentation.ts`) y es
idempotente:

| Situación | Qué pasa |
|---|---|
| Vence en `SAAS_DIAS_AVISO` días (5) | Cartel al dueño en su panel ("Tu abono vence el…") y una línea en la bitácora |
| Vencido hace hasta `SAAS_DIAS_GRACIA` días (5) | Sigue andando, con cartel rojo |
| Vencido hace más | Se suspende **por falta de pago**: la carta y el panel muestran el aviso. Se reactiva solo al registrar el pago |
| Prueba vencida sin pago | Igual que un vencido |

Cada pago corre el vencimiento N meses desde el vencimiento anterior (se
mantiene el ciclo aunque pague unos días tarde); si vuelve después de más de 30
días, arranca el día del pago. Un pago anulado hace retroceder el vencimiento.
Por cliente se puede apagar la suspensión automática; con
`SAAS_SUSPENDER_VENCIDOS=false`, nadie se suspende solo.

**Cobro manual**: ficha del cliente → Registrar pago (monto, meses, medio, nº de operación).

**Mercado Pago de la plataforma** (`PLATAFORMA_MP_TOKEN`, la cuenta de Supreg, no
la de los locales):

- **Link de pago**: N meses, un solo pago. Desde la ficha, o el dueño solo desde
  su panel (Abono → Pagar con Mercado Pago).
- **Débito automático**: suscripción mensual. El cliente autoriza su tarjeta y
  Mercado Pago le cobra todos los meses. El mail tiene que ser el de su cuenta de
  Mercado Pago.
- Webhook en Mercado Pago: `https://comandasupreg.com/api/plataforma/mp/webhook`,
  eventos **Pagos** y **Planes y suscripciones**, con su clave secreta en
  `PLATAFORMA_MP_WEBHOOK_SECRET`. Cada cobro aprobado se registra solo, una vez
  aunque llegue dos veces, y solo si el monto alcanza.

El dueño de cada local ve su abono en **El local → Abono**: plan, qué incluye,
uso, vencimiento, sus pagos y los botones para pagar.

## Mercado Pago de cada local

El pago online de la carta cae en la cuenta **de cada local**. El dueño la
conecta en **Configuración → Cobro online**: pega el Access Token de producción
(se verifica contra Mercado Pago y se guarda cifrado con AES-256-GCM,
`src/lib/cifrado.ts`), y opcionalmente la clave secreta de webhooks. La pantalla
le muestra la URL del webhook de su local
(`https://pepperino.comandasupreg.com/api/mp/webhook`).

Cada aviso se consulta con las credenciales del local del dominio y solo puede
cobrar pedidos de ese local: un pago de otra cuenta, o un aviso mandado al local
equivocado, se ignora. El modo **Demo** muestra una pantalla de pago de prueba
sin cobrar nada.

## Bitácora

`AuditLog`: solo se agregan filas. Se anotan los ingresos (y los fallidos),
cambios de usuarios, permisos, marca, credenciales (sin el valor), la clave de
la impresora, y todo lo que se hace desde la plataforma (altas, cambios, pagos,
anulaciones, suspensiones, reactivaciones, avisos de vencimiento), con la IP.

## Alta de un cliente

Desde el panel (Clientes → Nuevo cliente) o por consola:

```bash
docker compose run --rm tools npx tsx prisma/crear-cliente.ts --slug lapizzeria \
  --nombre "La Pizzería" --email dueno@lapizzeria.com --password "una-clave-larga" --plan Completo --prueba 14
```

Crea el cliente, sus permisos por rol, una sucursal con horarios y el usuario
del dueño. La carta arranca vacía.

## Pruebas

En `pruebas/` hay dos pruebas de punta a punta, que se corren cada una sobre una
base limpia (cómo, al principio de cada archivo):

- `e2e-saas.mjs`: aislamiento entre dos clientes (~70 controles).
- `e2e-plataforma.mjs` con `mp-falso.mjs` (un Mercado Pago de mentira que, como
  el real, no deja ver pagos de otra cuenta): planes y funciones, Mercado Pago
  de cada local, panel de la plataforma, abonos, suspensión y bitácora (~75 controles).

## Pendiente

- Factura electrónica (ARCA) de cada abono.
- Alta autogestionada (que el cliente se registre y pruebe sin intervención).
- Mails: hoy los avisos de vencimiento se ven en el panel del local y en la
  bitácora; falta mandarlos por mail.
- Dominio propio desde el panel del local (hoy lo carga la plataforma en la ficha).
