import type { Role } from '@prisma/client';

/**
 * Los permisos viven en la base y se editan desde el panel. Este archivo define
 * el catálogo (qué permisos existen y cómo se llaman en castellano) y los
 * valores con los que arranca cada rol.
 *
 * El superadmin no consulta nada de esto: puede todo, siempre. Es a propósito,
 * para que nadie se deje afuera del sistema editando permisos.
 */

export type Permiso = {
  id: string;
  label: string;
  ayuda: string;
};

export type GrupoPermisos = {
  grupo: string;
  /// Sección del menú que se habilita con estos permisos
  seccion: string;
  permisos: Permiso[];
};

export const CATALOGO: GrupoPermisos[] = [
  {
    grupo: 'Pedidos',
    seccion: 'pedidos',
    permisos: [
      { id: 'pedidos.ver', label: 'Ver el tablero', ayuda: 'Entrar a la pantalla de pedidos' },
      { id: 'pedidos.avanzar', label: 'Aceptar y avanzar', ayuda: 'Mover un pedido al estado siguiente' },
      { id: 'pedidos.crear', label: 'Cargar pedidos', ayuda: 'Tomar pedidos por teléfono o mostrador' },
      { id: 'pedidos.cancelar', label: 'Rechazar y cancelar', ayuda: 'Dar de baja un pedido' },
      { id: 'pedidos.cobrar', label: 'Marcar cobrado', ayuda: 'Registrar que entró la plata' },
      { id: 'pedidos.imprimir', label: 'Imprimir comandas', ayuda: 'Mandar o reimprimir tickets' },
      { id: 'pedidos.asignar', label: 'Asignar repartidor', ayuda: 'Elegir quién lleva el pedido' },
      {
        id: 'pedidos.repartir',
        label: 'Repartir',
        ayuda: 'Salir con los pedidos asignados y marcarlos entregados. Sin "Aceptar y avanzar", solo ve los suyos',
      },
    ],
  },
  {
    grupo: 'Cocina',
    seccion: 'cocina',
    permisos: [
      { id: 'cocina.ver', label: 'Pantalla de cocina', ayuda: 'La vista grande de preparación' },
      { id: 'cocina.avanzar', label: 'Empezar y terminar', ayuda: 'Pasar un pedido a preparación y a listo, nada más' },
    ],
  },
  {
    grupo: 'Caja',
    seccion: 'caja',
    permisos: [
      { id: 'caja.ver', label: 'Ver la caja', ayuda: 'El turno de caja abierto y los cierres anteriores' },
      { id: 'caja.operar', label: 'Abrir y cerrar caja', ayuda: 'Abrir con fondo, registrar ingresos y egresos, hacer el arqueo' },
    ],
  },
  {
    grupo: 'Salón',
    seccion: 'mesas',
    permisos: [
      { id: 'mesas.ver', label: 'Ver mesas', ayuda: 'El mapa del salón' },
      { id: 'mesas.editar', label: 'Editar mesas', ayuda: 'Agregar, quitar y cambiar estados' },
      { id: 'reservas.ver', label: 'Ver reservas', ayuda: 'Reservas, cumpleaños y eventos' },
      { id: 'reservas.gestionar', label: 'Gestionar reservas', ayuda: 'Confirmar, asignar mesa y cancelar' },
    ],
  },
  {
    grupo: 'Gastos',
    seccion: 'gastos',
    permisos: [
      { id: 'gastos.ver', label: 'Ver gastos', ayuda: 'El registro de gastos y el resultado del mes' },
      { id: 'gastos.cargar', label: 'Cargar gastos', ayuda: 'Anotar compras y pagos: mercadería, sueldos, servicios' },
      { id: 'gastos.anular', label: 'Anular gastos', ayuda: 'Dar de baja un gasto cargado por error. Queda registrado quién lo anuló' },
      { id: 'sueldos.ver', label: 'Ver sueldos', ayuda: 'Cuánto cobra y cuánto se le pagó a cada uno. Sin este permiso, los pagos de sueldos no aparecen en Gastos' },
      { id: 'sueldos.pagar', label: 'Pagar sueldos', ayuda: 'Anotar sueldos, adelantos y aguinaldos, y dar de alta al personal' },
    ],
  },
  {
    grupo: 'Carta',
    seccion: 'carta',
    permisos: [
      { id: 'carta.ver', label: 'Ver la carta', ayuda: 'Productos y categorías' },
      { id: 'carta.editar', label: 'Editar la carta', ayuda: 'Crear y modificar productos' },
      { id: 'carta.precios', label: 'Cambiar precios', ayuda: 'Tocar los valores de venta' },
      { id: 'promos.editar', label: 'Gestionar promociones', ayuda: 'Crear y editar promos' },
    ],
  },
  {
    grupo: 'Stock',
    seccion: 'stock',
    permisos: [
      { id: 'stock.ver', label: 'Ver stock', ayuda: 'Niveles e historial' },
      { id: 'stock.mover', label: 'Mover stock', ayuda: 'Entradas, mermas y ajustes' },
      { id: 'insumos.ver', label: 'Ver insumos', ayuda: 'Muzzarella, harina, salsa: cuánto hay y cuánto se usó' },
      { id: 'insumos.mover', label: 'Cargar insumos', ayuda: 'Anotar lo que entra, lo que se pierde y los conteos' },
      { id: 'recetas.editar', label: 'Editar recetas', ayuda: 'Cuánto de cada insumo usa cada producto' },
      {
        id: 'mermas.anotar',
        label: 'Anotar mermas',
        ayuda: 'Lo que se rompe, se vence, sale mal o se regala. No permite tocar el resto del stock',
      },
      { id: 'stock.control', label: 'Activar control', ayuda: 'Prender o apagar el seguimiento por producto' },
    ],
  },
  {
    grupo: 'Reportes',
    seccion: 'reportes',
    permisos: [
      { id: 'reportes.ver', label: 'Ver reportes', ayuda: 'Ingresos, ranking y tiempos' },
    ],
  },
  {
    grupo: 'Equipo',
    seccion: 'empleados',
    permisos: [
      { id: 'empleados.ver', label: 'Ver empleados', ayuda: 'Listado y turnos del día' },
      { id: 'empleados.editar', label: 'Editar empleados', ayuda: 'Altas, bajas y contraseñas' },
      { id: 'roles.gestionar', label: 'Gestionar permisos', ayuda: 'Definir qué puede hacer cada rol' },
    ],
  },
  {
    grupo: 'Configuración',
    seccion: 'config',
    permisos: [
      { id: 'config.ver', label: 'Ver configuración', ayuda: 'Datos del local, horarios y zonas' },
      { id: 'config.editar', label: 'Editar configuración', ayuda: 'Modificar esos datos' },
      { id: 'sucursales.gestionar', label: 'Gestionar sucursales', ayuda: 'Crear, activar y desactivar locales' },
    ],
  },
];

export const TODOS_LOS_PERMISOS = CATALOGO.flatMap((g) => g.permisos.map((p) => p.id));

/** Qué permiso habilita cada sección del menú. */
export const SECCION_DE_PERMISO: Record<string, string> = Object.fromEntries(
  CATALOGO.flatMap((g) => g.permisos.map((p) => [p.id, g.seccion]))
);

/** Con qué arranca cada rol cuando se crea la base. */
export const DEFAULTS: Record<Role, string[]> = {
  SUPERADMIN: TODOS_LOS_PERMISOS,
  ADMIN: TODOS_LOS_PERMISOS.filter((p) => p !== 'sucursales.gestionar'),
  CAJERO: [
    'pedidos.ver', 'pedidos.avanzar', 'pedidos.crear', 'pedidos.cancelar',
    'pedidos.cobrar', 'pedidos.imprimir', 'pedidos.asignar',
    'cocina.ver', 'cocina.avanzar',
    'caja.ver', 'caja.operar',
    'gastos.ver', 'gastos.cargar',
    'mesas.ver', 'mesas.editar', 'reservas.ver', 'reservas.gestionar',
    'carta.ver', 'stock.ver', 'stock.mover', 'mermas.anotar',
    'insumos.ver', 'insumos.mover',
  ],
  // Cocina no acepta pedidos ni los marca entregados: eso es plata y es de caja
  // La cocina anota lo que se quema o sale mal
  COCINA: ['cocina.ver', 'cocina.avanzar', 'stock.ver', 'mermas.anotar', 'insumos.ver'],
  // El repartidor ve y cierra solo lo que le asignaron
  REPARTIDOR: ['pedidos.ver', 'pedidos.repartir', 'pedidos.cobrar'],
  MOZO: [
    'pedidos.ver', 'pedidos.crear', 'pedidos.avanzar',
    'mesas.ver', 'mesas.editar', 'reservas.ver', 'reservas.gestionar',
    // El mozo anota lo que regala (el postre a la mesa de siempre)
    'mermas.anotar',
  ],
};

export const ETIQUETA_ROL: Record<Role, string> = {
  SUPERADMIN: 'Superadministrador',
  ADMIN: 'Administrador',
  CAJERO: 'Cajero',
  COCINA: 'Cocina',
  REPARTIDOR: 'Repartidor',
  MOZO: 'Mozo',
};

export const AYUDA_ROL: Record<Role, string> = {
  SUPERADMIN: 'Puede todo en todas las sucursales. No se le pueden quitar permisos.',
  ADMIN: 'Maneja su sucursal completa, menos crear locales nuevos.',
  CAJERO: 'El día a día del mostrador: pedidos, mesas y stock.',
  COCINA: 'Solo la pantalla de preparación.',
  REPARTIDOR: 'Los pedidos que tiene que llevar.',
  MOZO: 'Mesas, reservas y pedidos del salón.',
};

type CambioPermisos = {
  version: string;
  agregar: Partial<Record<Role, string[]>>;
  quitar?: Partial<Record<Role, string[]>>;
};

/**
 * Permisos que aparecieron (o se sacaron) en cada actualización, con el rol
 * al que le corresponden. `prisma/actualizar-permisos.ts` aplica a los roles
 * guardados en la base los cambios que todavía no se aplicaron, en orden.
 * Para una versión nueva, se agrega un elemento al final; nunca se editan los
 * anteriores.
 */
export const CAMBIOS_PERMISOS: CambioPermisos[] = [
  {
    version: '2026-10-caja-y-reparto',
    agregar: {
      ADMIN: ['pedidos.repartir', 'cocina.avanzar', 'caja.ver', 'caja.operar'],
      CAJERO: ['cocina.avanzar', 'caja.ver', 'caja.operar'],
      COCINA: ['cocina.avanzar'],
      REPARTIDOR: ['pedidos.repartir'],
    },
    quitar: {
      COCINA: ['pedidos.avanzar', 'pedidos.ver'],
      REPARTIDOR: ['pedidos.avanzar'],
    },
  },
  {
    version: '2026-10-gastos',
    agregar: {
      ADMIN: ['gastos.ver', 'gastos.cargar', 'gastos.anular'],
      CAJERO: ['gastos.ver', 'gastos.cargar'],
    },
  },
  {
    version: '2026-10-mermas',
    agregar: {
      ADMIN: ['mermas.anotar'],
      CAJERO: ['mermas.anotar'],
      COCINA: ['mermas.anotar'],
      MOZO: ['mermas.anotar'],
    },
  },
  {
    version: '2026-10-insumos',
    agregar: {
      ADMIN: ['insumos.ver', 'insumos.mover', 'recetas.editar'],
      CAJERO: ['insumos.ver', 'insumos.mover'],
      COCINA: ['insumos.ver'],
    },
  },
  {
    version: '2026-10-sueldos',
    agregar: { ADMIN: ['sueldos.ver', 'sueldos.pagar'] },
  },
];

/** Las secciones del menú que se le muestran a alguien con estos permisos. */
export function seccionesVisibles(permisos: string[]): Set<string> {
  const vistas = new Set<string>();
  for (const p of permisos) {
    const s = SECCION_DE_PERMISO[p];
    // Solo los permisos de "ver" abren la sección; los de acción no alcanzan
    if (s && p.endsWith('.ver')) vistas.add(s);
  }
  return vistas;
}
