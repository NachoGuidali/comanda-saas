'use server';

import { revalidatePath } from 'next/cache';
import bcrypt from 'bcryptjs';
import { db } from '@/lib/db';
import { exigir, tieneFuncion, createSession, destroySession, setSucursalActiva, requireSession, puede } from '@/lib/session';
import { toCents } from '@/lib/money';
import { permitir, reiniciar, ipCliente } from '@/lib/limite';
import { TODOS_LOS_PERMISOS } from '@/lib/permisos';
import { IDS_TIPO_MERMA, ETIQUETA_TIPO_MERMA } from '@/lib/mermas';
import { getTenant } from '@/lib/tenant';
import { limitesDe } from '@/lib/plan';
import { auditar } from '@/lib/auditoria';
import type { MovementType, Prisma, Role, ReservationStatus, ReservationType, TableStatus } from '@prisma/client';

const ROLES: Role[] = ['SUPERADMIN', 'ADMIN', 'CAJERO', 'COCINA', 'REPARTIDOR', 'MOZO'];
const TIPOS_RESERVA: ReservationType[] = ['MESA', 'CUMPLEANOS', 'EVENTO'];
const ESTADOS_RESERVA: ReservationStatus[] = ['NUEVA', 'CONFIRMADA', 'SENTADA', 'CUMPLIDA', 'CANCELADA', 'NO_SE_PRESENTO'];
const ESTADOS_MESA: TableStatus[] = ['LIBRE', 'OCUPADA', 'FUERA_DE_SERVICIO'];
const TIPOS_MOVIMIENTO: MovementType[] = ['REPOSICION', 'AJUSTE', 'MERMA'];

/** Fecha y hora escritas en un formulario, interpretadas en la hora del local. */
function fechaLocal(fecha: string, hora: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha) || !/^\d{2}:\d{2}$/.test(hora)) return null;
  const d = new Date(`${fecha}T${hora}:00`);
  return isNaN(d.getTime()) ? null : d;
}

// ─────────── Acceso ───────────

export async function login(fd: FormData) {
  const email = String(fd.get('email') || '').toLowerCase().trim();
  const password = String(fd.get('password') || '');

  // Cada cliente tiene sus propios usuarios: se busca en el del dominio
  const tenant = await getTenant();
  if (!tenant) return { ok: false as const, error: 'Entrá desde la dirección de tu local, por ejemplo tulocal.comandasupreg.com/admin' };
  if (!tenant.active) return { ok: false as const, error: 'Este local está suspendido. Comunicate con Comanda Supreg.' };

  // Contra la fuerza bruta: 8 intentos por cuenta y 30 por conexión cada 15 minutos
  const ip = await ipCliente();
  if (!permitir(`login:${tenant.id}:${email}`, 8, 15 * 60_000) || !permitir(`login-ip:${ip}`, 30, 15 * 60_000)) {
    return { ok: false as const, error: 'Demasiados intentos. Esperá 15 minutos y probá de nuevo.' };
  }

  const user = await db.user.findUnique({
    where: { tenantId_email: { tenantId: tenant.id, email } },
    include: { branches: { select: { branchId: true } } },
  });

  if (!user || !user.active || !(await bcrypt.compare(password, user.passwordHash))) {
    await auditar({ tenantId: tenant.id, actorType: 'usuario', actorId: user?.id, actorName: email, action: 'login_fallido' });
    return { ok: false as const, error: 'Email o contraseña incorrectos' };
  }

  const branchIds = user.branches.map((b) => b.branchId);
  if (user.role !== 'SUPERADMIN' && branchIds.length === 0) {
    return { ok: false as const, error: 'Tu usuario no tiene ninguna sucursal asignada. Avisale al administrador.' };
  }

  reiniciar(`login:${tenant.id}:${email}`);
  await createSession(user.id, user.tokenVersion, tenant.id);
  await auditar({ tenantId: tenant.id, actorType: 'usuario', actorId: user.id, actorName: user.name, action: 'login' });

  return { ok: true as const, role: user.role };
}

export async function logout() {
  await destroySession();
  return { ok: true as const };
}

/** Cambiar de local desde la barra superior. */
export async function cambiarSucursal(branchId: string) {
  const s = await requireSession();
  if (!s.sucursales.some((x) => x.id === branchId)) {
    return { ok: false as const, error: 'No tenés acceso a esa sucursal' };
  }
  await setSucursalActiva(branchId);
  revalidatePath('/admin', 'layout');
  return { ok: true as const };
}

// ─────────── Stock ───────────

/**
 * Todo movimiento queda registrado con el valor anterior y el nuevo. Sin eso,
 * cuando falta mercadería no hay forma de saber dónde se fue.
 */
export async function moverStock(
  productId: string,
  variantId: string | null,
  type: MovementType,
  cantidad: number,
  reason?: string
) {
  const s = await exigir('stock.mover');
  if (!TIPOS_MOVIMIENTO.includes(type)) return { ok: false as const, error: 'Tipo de movimiento inválido' };
  cantidad = Math.trunc(Number(cantidad));
  if (!cantidad || !Number.isFinite(cantidad)) return { ok: false as const, error: 'Poné una cantidad' };
  if (type === 'MERMA') return registrarMerma(productId, variantId, Math.abs(cantidad), 'OTRO', reason ?? '');

  const producto = await db.product.findFirst({ where: { id: productId, branchId: s.branchId } });
  if (!producto) return { ok: false as const, error: 'Ese producto no es de esta sucursal' };

  // Reposición suma, ajuste va con el signo que le pongan
  const delta = type === 'REPOSICION' ? Math.abs(cantidad) : cantidad;

  // Dentro de una transacción y leyendo el valor en ese momento: si entra
  // una venta mientras alguien carga mercadería, no se pisan.
  await db.$transaction(async (tx) => {
    if (variantId) {
      const v = await tx.variant.findFirst({ where: { id: variantId, productId } });
      if (!v) return;
      const after = Math.max(0, v.stock + delta);
      await tx.variant.update({ where: { id: variantId }, data: { stock: after } });
      await tx.stockMovement.create({
        data: { productId, variantId, type, quantity: after - v.stock, before: v.stock, after, reason: reason?.slice(0, 200), userId: s.userId },
      });
    } else {
      const p = await tx.product.findUniqueOrThrow({ where: { id: productId } });
      const after = Math.max(0, p.stock + delta);
      await tx.product.update({ where: { id: productId }, data: { stock: after } });
      await tx.stockMovement.create({
        data: { productId, type, quantity: after - p.stock, before: p.stock, after, reason: reason?.slice(0, 200), userId: s.userId },
      });
    }
  });

  revalidatePath('/admin/stock');
  revalidatePath('/', 'layout');
  return { ok: true as const };
}

/**
 * Anota algo que se fue sin cobrarse: "se rompió 1 Coca", "se quemó una
 * muzza", "le regalamos el postre a la mesa 4".
 *
 * Se registra la cantidad tal cual, sin valorizarla en plata, con su tipo
 * (src/lib/mermas.ts). Si el producto lleva control de stock, además se
 * descuenta (sin bajar de 0); si no lo lleva (una pizza que se hace en el
 * momento), solo queda anotado. Antes, una merma de un producto sin stock
 * quedaba en 0 unidades, porque se guardaba la diferencia de stock.
 */
export async function registrarMerma(
  productId: string,
  variantId: string | null,
  cantidad: number,
  tipo: string,
  detalle: string,
  orderCode?: string
) {
  const s = await requireSession();
  if (!puede(s, 'mermas.anotar', 'stock.mover')) return { ok: false as const, error: 'No tenés permiso para anotar mermas' };
  const n = Math.trunc(Math.abs(Number(cantidad)));
  if (!n || n > 999) return { ok: false as const, error: 'Poné cuántas unidades' };
  if (!IDS_TIPO_MERMA.includes(tipo)) return { ok: false as const, error: 'Elegí qué pasó: se rompió, se venció, regalo...' };
  if (tipo === 'OTRO' && !detalle?.trim()) return { ok: false as const, error: 'Contá qué pasó' };
  const motivo = (detalle?.trim() || ETIQUETA_TIPO_MERMA[tipo]).slice(0, 200);

  const producto = await db.product.findFirst({
    where: { id: productId, branchId: s.branchId },
    include: { variants: { where: { active: true } } },
  });
  if (!producto) return { ok: false as const, error: 'Ese producto no es de esta sucursal' };
  if (producto.variants.length > 0 && !producto.variants.some((v) => v.id === variantId)) {
    return { ok: false as const, error: `Elegí el tamaño de ${producto.name}` };
  }

  await db.$transaction((tx) => aplicarMerma(tx, producto, variantId, n, tipo, motivo, s.userId, orderCode));

  revalidatePath('/admin/mermas');
  revalidatePath('/admin/stock');
  revalidatePath('/admin/finanzas');
  revalidatePath('/', 'layout');
  return { ok: true as const };
}

async function aplicarMerma(
  tx: Prisma.TransactionClient,
  producto: { id: string; trackStock: boolean },
  variantId: string | null,
  n: number,
  tipo: string,
  motivo: string,
  userId: string,
  orderCode?: string
) {
  const fila = variantId
    ? await tx.variant.findUniqueOrThrow({ where: { id: variantId }, select: { stock: true } })
    : await tx.product.findUniqueOrThrow({ where: { id: producto.id }, select: { stock: true } });
  const after = producto.trackStock ? Math.max(0, fila.stock - n) : fila.stock;
  if (producto.trackStock) {
    if (variantId) await tx.variant.update({ where: { id: variantId }, data: { stock: after } });
    else await tx.product.update({ where: { id: producto.id }, data: { stock: after } });
  }
  await tx.stockMovement.create({
    data: {
      productId: producto.id, variantId, type: 'MERMA',
      // Lo que se perdió, aunque el stock no pueda bajar más o no se controle
      quantity: -n,
      before: fila.stock, after,
      lossType: tipo, reason: motivo, orderCode: orderCode ?? null, userId,
    },
  });
}

/**
 * Un pedido que salió mal: la pizza se quemó, se cayó, el cliente la
 * rechazó. Se eligen qué productos del pedido se tiraron y quedan como
 * merma con el código del pedido. El pedido en sí no cambia: si se rehace,
 * se rehace aparte.
 */
export async function registrarMermaPedido(
  orderId: string,
  lineas: { itemId: string; cantidad: number }[],
  motivo: string,
  tipo: string = 'SALIO_MAL'
) {
  const s = await requireSession();
  if (!puede(s, 'mermas.anotar', 'stock.mover')) return { ok: false as const, error: 'No tenés permiso para anotar mermas' };
  if (!IDS_TIPO_MERMA.includes(tipo)) return { ok: false as const, error: 'Elegí qué pasó' };
  if (tipo === 'OTRO' && !motivo?.trim()) return { ok: false as const, error: 'Contá qué pasó con el pedido' };
  const detalle = motivo?.trim() || ETIQUETA_TIPO_MERMA[tipo];
  const o = await db.order.findFirst({
    where: { id: orderId, branchId: s.branchId },
    include: { items: { include: { product: { select: { id: true, trackStock: true } } } } },
  });
  if (!o) return { ok: false as const, error: 'Ese pedido no es de esta sucursal' };

  const elegidas = (lineas ?? [])
    .map((l) => ({ item: o.items.find((i) => i.id === l.itemId), n: Math.trunc(Math.abs(Number(l.cantidad))) }))
    .filter((l) => l.item && l.n > 0);
  if (elegidas.length === 0) return { ok: false as const, error: 'Elegí qué productos se perdieron' };
  for (const l of elegidas) {
    if (l.n > l.item!.quantity) return { ok: false as const, error: `El pedido tiene ${l.item!.quantity} de ${l.item!.name}` };
    if (!l.item!.product) return { ok: false as const, error: `${l.item!.name} ya no existe en la carta` };
  }

  await db.$transaction(async (tx) => {
    for (const l of elegidas) {
      await aplicarMerma(tx, l.item!.product!, l.item!.variantId, l.n, tipo, `Pedido ${o.code}: ${detalle}`.slice(0, 200), s.userId, o.code);
    }
  });

  revalidatePath('/admin/mermas');
  revalidatePath('/admin/stock');
  revalidatePath('/admin/finanzas');
  return { ok: true as const };
}

/** Conteo físico: se carga lo que hay de verdad y el sistema registra la diferencia. */
export async function cerrarInventario(conteos: { productId: string; variantId: string | null; contado: number }[]) {
  const s = await exigir('stock.mover');
  let ajustados = 0;

  const propios = await db.product.findMany({
    where: { id: { in: conteos.map((c) => c.productId) }, branchId: s.branchId },
    select: { id: true, stock: true },
  });
  const porId = new Map(propios.map((p) => [p.id, p]));

  for (const c of conteos) {
    const p = porId.get(c.productId);
    if (!p) continue;
    c.contado = Math.trunc(Number(c.contado));
    if (!Number.isFinite(c.contado) || c.contado < 0) continue;

    if (c.variantId) {
      const v = await db.variant.findFirst({ where: { id: c.variantId, productId: c.productId } });
      if (!v || v.stock === c.contado) continue;
      await db.variant.update({ where: { id: v.id }, data: { stock: c.contado } });
      await db.stockMovement.create({
        data: {
          productId: c.productId, variantId: v.id, type: 'AJUSTE',
          quantity: c.contado - v.stock, before: v.stock, after: c.contado,
          reason: 'Conteo de inventario', userId: s.userId,
        },
      });
      ajustados++;
    } else {
      if (p.stock === c.contado) continue;
      await db.product.update({ where: { id: p.id }, data: { stock: c.contado } });
      await db.stockMovement.create({
        data: {
          productId: p.id, type: 'AJUSTE',
          quantity: c.contado - p.stock, before: p.stock, after: c.contado,
          reason: 'Conteo de inventario', userId: s.userId,
        },
      });
      ajustados++;
    }
  }

  revalidatePath('/admin/stock');
  return { ok: true as const, ajustados };
}

export async function alternarControlStock(productId: string, trackStock: boolean) {
  const s = await exigir('stock.control');
  await db.product.updateMany({ where: { id: productId, branchId: s.branchId }, data: { trackStock } });
  revalidatePath('/admin/stock');
  revalidatePath('/', 'layout');
  return { ok: true as const };
}

// ─────────── Empleados ───────────

export async function guardarEmpleado(fd: FormData) {
  const s = await exigir('empleados.editar');
  const id = String(fd.get('id') || '');
  const name = String(fd.get('name') || '').trim();
  const email = String(fd.get('email') || '').toLowerCase().trim();
  const password = String(fd.get('password') || '');
  const role = String(fd.get('role') || 'CAJERO') as Role;

  if (!ROLES.includes(role)) return { ok: false as const, error: 'Rol inválido' };
  if (!name || !email) return { ok: false as const, error: 'Faltan el nombre y el email' };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { ok: false as const, error: 'Ese email no parece válido' };
  if ((!id || password) && password.length < 8) {
    return { ok: false as const, error: 'La contraseña necesita al menos 8 caracteres' };
  }

  // Solo un superadmin puede crear otro superadmin
  if (role === 'SUPERADMIN' && !s.esSuperadmin) {
    return { ok: false as const, error: 'Solo un superadministrador puede crear otro' };
  }

  const duplicado = await db.user.findUnique({ where: { tenantId_email: { tenantId: s.tenantId, email } } });
  if (duplicado && duplicado.id !== id) return { ok: false as const, error: 'Ya hay alguien con ese email' };

  // Sucursales asignadas: solo de las que ve quien carga (el superadmin ve
  // todas las de su cliente, nunca las de otro)
  const pedidas = String(fd.get('branchIds') || '').split(',').map((x) => x.trim()).filter(Boolean);
  const permitidas = pedidas.filter((b) => s.sucursales.some((x) => x.id === b));

  if (role !== 'SUPERADMIN' && permitidas.length === 0) {
    return { ok: false as const, error: 'Asignale al menos una sucursal' };
  }

  // Permisos extra: solo los que existen, y quien no es superadmin no puede
  // dar lo que él mismo no tiene, ni el de crear sucursales. Si no, un admin
  // podía darse a sí mismo cualquier permiso.
  const extrasPedidos = String(fd.get('permisosExtra') || '').split(',').map((x) => x.trim()).filter(Boolean);
  const puedeOtorgar = (p: string) =>
    TODOS_LOS_PERMISOS.includes(p) && (s.esSuperadmin || (s.permisos.includes(p) && p !== 'sucursales.gestionar'));
  // Los extras que ya tenía y este usuario no puede tocar (se los dio alguien
  // con más permisos) se conservan tal cual
  const extrasPrevios = id
    ? (await db.user.findFirst({ where: { id, tenantId: s.tenantId }, select: { permisosExtra: true } }))?.permisosExtra ?? []
    : [];
  const permisosExtra = [
    ...new Set([...extrasPedidos.filter(puedeOtorgar), ...extrasPrevios.filter((p) => !puedeOtorgar(p))]),
  ];

  const base = {
    name,
    email,
    role,
    phone: String(fd.get('phone') || '') || null,
    active: fd.get('active') !== 'false',
    permisosExtra,
  };

  // Tope de usuarios activos del plan: cuenta al dar de alta o reactivar
  const tenantPlan = await db.tenant.findUniqueOrThrow({ where: { id: s.tenantId }, include: { plan: true } });
  const { maxUsers } = limitesDe(tenantPlan);
  const sumaUno = async () => {
    if (maxUsers === null) return false;
    return (await db.user.count({ where: { tenantId: s.tenantId, active: true } })) >= maxUsers;
  };

  let userId = id;
  if (id) {
    const anterior = await db.user.findFirst({
      where: { id, tenantId: s.tenantId },
      include: { branches: { select: { branchId: true } } },
    });
    if (!anterior) return { ok: false as const, error: 'No encontramos a esa persona' };
    if (!anterior.active && base.active && (await sumaUno())) {
      return { ok: false as const, error: `Tu plan incluye ${maxUsers} usuarios activos. Dá de baja a alguien o escribinos para ampliarlo.` };
    }
    if (anterior.role === 'SUPERADMIN' && !s.esSuperadmin) {
      return { ok: false as const, error: 'No podés editar a un superadministrador' };
    }
    // Un admin de un local no edita (ni le cambia la clave) a gente de otro
    if (!s.esSuperadmin && anterior.branches.length > 0 &&
        !anterior.branches.some((b) => s.sucursales.some((x) => x.id === b.branchId))) {
      return { ok: false as const, error: 'Esa persona no trabaja en tus sucursales' };
    }
    if (id === s.userId && !base.active) {
      return { ok: false as const, error: 'No te podés dar de baja a vos mismo' };
    }
    // Cambiar la clave o dar de baja cierra todas sus sesiones abiertas
    const cortaSesiones = !!password || (anterior.active && !base.active) || anterior.role !== role;
    await db.user.update({
      where: { id },
      data: {
        ...base,
        ...(password ? { passwordHash: await bcrypt.hash(password, 10) } : {}),
        ...(cortaSesiones ? { tokenVersion: { increment: 1 } } : {}),
      },
    });
  } else {
    if (base.active && (await sumaUno())) {
      return { ok: false as const, error: `Tu plan incluye ${maxUsers} usuarios activos. Dá de baja a alguien o escribinos para ampliarlo.` };
    }
    const creado = await db.user.create({
      data: { ...base, tenantId: s.tenantId, passwordHash: await bcrypt.hash(password, 10) },
    });
    userId = creado.id;
  }

  // Reemplazamos el alcance entero, pero sin tocar sucursales que no manejo
  await db.userBranch.deleteMany({
    where: {
      userId,
      ...(s.esSuperadmin ? {} : { branchId: { in: s.sucursales.map((x) => x.id) } }),
    },
  });
  if (permitidas.length > 0) {
    await db.userBranch.createMany({
      data: permitidas.map((branchId) => ({ userId, branchId })),
      skipDuplicates: true,
    });
  }

  await auditar({
    tenantId: s.tenantId, actorType: 'usuario', actorId: s.userId, actorName: s.name, action: 'usuario',
    detail: `${id ? 'Editó' : 'Creó'} a ${name} (${email}), rol ${role}${!base.active ? ', dado de baja' : ''}${password && id ? ', cambió la clave' : ''}`,
  });
  revalidatePath('/admin/empleados');
  return { ok: true as const };
}

export async function ficharTurno(userId: string, role: Role) {
  const s = await exigir('empleados.ver');
  if (!ROLES.includes(role)) return { ok: false as const, error: 'Rol inválido' };
  const trabajaAca = await db.user.findFirst({
    where: { id: userId, tenantId: s.tenantId, active: true, OR: [{ role: 'SUPERADMIN' }, { branches: { some: { branchId: s.branchId } } }] },
    select: { id: true },
  });
  if (!trabajaAca) return { ok: false as const, error: 'Esa persona no trabaja en esta sucursal' };

  const hoy = new Date();
  hoy.setHours(0, 0, 0, 0);

  const abierto = await db.shift.findFirst({
    where: { userId, branchId: s.branchId, date: hoy, endedAt: null },
  });

  if (abierto) {
    await db.shift.update({ where: { id: abierto.id }, data: { endedAt: new Date() } });
  } else {
    await db.shift.create({
      data: { userId, branchId: s.branchId, date: hoy, role, startedAt: new Date() },
    });
  }

  revalidatePath('/admin/empleados');
  return { ok: true as const };
}

// ─────────── Mesas ───────────

export async function guardarMesa(fd: FormData) {
  const s = await exigir('mesas.editar');
  if (!tieneFuncion(s, 'salon')) return { ok: false as const, error: 'Tu plan no incluye Salón y mesas' };
  const id = String(fd.get('id') || '');
  const name = String(fd.get('name') || '').trim();
  if (!name) return { ok: false as const, error: 'Poné un nombre o número de mesa' };

  const data = {
    name,
    capacity: Math.min(50, Math.max(1, Math.trunc(Number(fd.get('capacity') || 4)) || 4)),
    zone: String(fd.get('zone') || '') || null,
    active: fd.get('active') !== 'false',
  };

  if (id) await db.table.updateMany({ where: { id, branchId: s.branchId }, data });
  else await db.table.create({ data: { ...data, branchId: s.branchId } });

  revalidatePath('/admin/mesas');
  return { ok: true as const };
}

export async function cambiarEstadoMesa(id: string, status: TableStatus) {
  const s = await exigir('mesas.editar');
  if (!ESTADOS_MESA.includes(status)) return { ok: false as const, error: 'Estado inválido' };
  if (status === 'LIBRE') {
    const abiertos = await db.order.count({
      where: { tableId: id, branchId: s.branchId, status: { in: ['PENDIENTE', 'ACEPTADO', 'EN_PREPARACION', 'LISTO'] } },
    });
    if (abiertos > 0) {
      return { ok: false as const, error: 'Esa mesa tiene pedidos sin cerrar. Cerrá la cuenta primero.' };
    }
  }
  await db.table.updateMany({
    where: { id, branchId: s.branchId },
    data: { status, ...(status === 'OCUPADA' ? {} : { guests: null, openedAt: null, waiterId: null }) },
  });
  revalidatePath('/admin/mesas');
  revalidatePath('/admin/salon');
  return { ok: true as const };
}

export async function borrarMesa(id: string) {
  const s = await exigir('mesas.editar');
  const usos = await db.order.count({ where: { tableId: id } }) + await db.reservation.count({ where: { tableId: id } });
  if (usos > 0) await db.table.updateMany({ where: { id, branchId: s.branchId }, data: { active: false } });
  else await db.table.deleteMany({ where: { id, branchId: s.branchId } });
  revalidatePath('/admin/mesas');
  return { ok: true as const };
}

// ─────────── Reservas y eventos ───────────

/** Entra desde la web pública: reserva de mesa, cumpleaños o evento. */
export async function crearReserva(fd: FormData) {
  const branchId = String(fd.get('branchId') || '');
  const customerName = String(fd.get('customerName') || '').trim();
  const customerPhone = String(fd.get('customerPhone') || '').trim();
  const fecha = String(fd.get('date') || '');
  const hora = String(fd.get('time') || '20:00');
  const people = Math.trunc(Number(fd.get('people') || 2));
  const type = String(fd.get('type') || 'MESA') as ReservationType;

  if (!customerName || !customerPhone) return { ok: false as const, error: 'Faltan tu nombre y tu teléfono' };
  if (customerPhone.replace(/\D/g, '').length < 8) return { ok: false as const, error: 'Revisá el teléfono, con código de área' };
  if (!fecha) return { ok: false as const, error: 'Elegí una fecha' };
  if (!(people >= 1 && people <= 500)) return { ok: false as const, error: 'Indicá cuántas personas van a ser' };
  if (!TIPOS_RESERVA.includes(type)) return { ok: false as const, error: 'Elegí el tipo de reserva' };

  const ip = await ipCliente();
  if (!permitir(`reserva:${ip}`, 5, 60 * 60_000)) {
    return { ok: false as const, error: 'Ya recibimos varias reservas desde tu conexión. Escribinos por WhatsApp.' };
  }

  const tenant = await getTenant();
  const branch = tenant && await db.branch.findFirst({ where: { id: branchId, tenantId: tenant.id, active: true } });
  if (!branch) return { ok: false as const, error: 'Esa sucursal no está disponible' };
  if (!limitesDe(tenant).funciones.includes('salon')) return { ok: false as const, error: 'Este local no toma reservas online' };

  const date = fechaLocal(fecha, hora);
  if (!date) return { ok: false as const, error: 'Esa fecha no es válida' };
  if (date < new Date()) return { ok: false as const, error: 'Esa fecha ya pasó' };
  if (date.getTime() - Date.now() > 365 * 24 * 60 * 60_000) {
    return { ok: false as const, error: 'Tomamos reservas hasta con un año de anticipación' };
  }

  const reserva = await db.reservation.create({
    data: {
      branchId: branch.id,
      customerName: customerName.slice(0, 80),
      customerPhone: customerPhone.slice(0, 30),
      email: String(fd.get('email') || '').slice(0, 120) || null,
      type,
      date,
      people,
      duracionMin: branch.duracionReservaMin,
      notes: String(fd.get('notes') || '').slice(0, 1000) || null,
      budget: fd.get('budget') ? toCents(String(fd.get('budget'))) : null,
    },
  });

  revalidatePath('/admin/reservas');
  return { ok: true as const, id: reserva.id };
}

export async function cambiarEstadoReserva(id: string, status: ReservationStatus, tableId?: string) {
  const s = await exigir('reservas.gestionar');
  if (!tieneFuncion(s, 'salon')) return { ok: false as const, error: 'Tu plan no incluye Salón y mesas' };
  if (!ESTADOS_RESERVA.includes(status)) return { ok: false as const, error: 'Estado inválido' };
  const propia = await db.reservation.findFirst({ where: { id, branchId: s.branchId } });
  if (!propia) return { ok: false as const, error: 'Esa reserva no es de esta sucursal' };
  if (tableId) {
    const mesa = await db.table.findFirst({ where: { id: tableId, branchId: s.branchId, active: true } });
    if (!mesa) return { ok: false as const, error: 'Esa mesa no es de esta sucursal' };
  }

  // Si le asignan mesa, verificamos que no se pise con otra reserva de ese día
  if (tableId && tableId !== propia.tableId) {
    const choque = await solapa(tableId, propia.date, propia.duracionMin, id);
    if (choque) {
      return {
        ok: false as const,
        error: `Esa mesa ya está tomada a esa hora por ${choque.customerName}.`,
      };
    }
  }

  await db.reservation.update({
    where: { id },
    data: { status, ...(tableId ? { tableId } : {}) },
  });

  // Ojo: NO se marca la mesa como reservada. El estado de la mesa es de AHORA;
  // una reserva para el sábado no puede dejarla bloqueada toda la semana.
  // Cuando la gente llega, se pasa la reserva a SENTADA y ahí sí se ocupa.
  if (status === 'SENTADA' && (tableId ?? propia.tableId)) {
    await db.table.updateMany({
      where: { id: tableId ?? propia.tableId!, branchId: s.branchId },
      // Queda abierta en Salón con la gente de la reserva, lista para anotar
      data: { status: 'OCUPADA', guests: propia.people, openedAt: new Date(), waiterId: null },
    });
  }
  if ((status === 'CUMPLIDA' || status === 'CANCELADA' || status === 'NO_SE_PRESENTO') && propia.tableId) {
    await db.table.updateMany({
      where: { id: propia.tableId, branchId: s.branchId },
      data: { status: 'LIBRE', guests: null, openedAt: null, waiterId: null },
    });
  }

  revalidatePath('/admin/reservas');
  revalidatePath('/admin/mesas');
  return { ok: true as const };
}

/**
 * Reserva una mesa directo desde la grilla, para un día y hora concretos.
 * Ya nace confirmada y asignada: la carga alguien del local.
 */
export async function reservarMesa(fd: FormData) {
  const s = await exigir('reservas.gestionar');
  if (!tieneFuncion(s, 'salon')) return { ok: false as const, error: 'Tu plan no incluye Salón y mesas' };

  const tableId = String(fd.get('tableId') || '');
  const customerName = String(fd.get('customerName') || '').trim();
  const customerPhone = String(fd.get('customerPhone') || '').trim();
  const fecha = String(fd.get('date') || '');
  const hora = String(fd.get('time') || '');
  const people = Math.trunc(Number(fd.get('people') || 2));
  const duracionMin = Math.min(12 * 60, Math.max(15, Math.trunc(Number(fd.get('duracionMin') || 120)) || 120));
  const type = String(fd.get('type') || 'MESA') as ReservationType;

  if (!customerName) return { ok: false as const, error: 'Poné el nombre de quien reserva' };
  if (!fecha || !hora) return { ok: false as const, error: 'Falta la fecha o la hora' };
  if (!TIPOS_RESERVA.includes(type)) return { ok: false as const, error: 'Tipo de reserva inválido' };
  if (!(people >= 1)) return { ok: false as const, error: 'Indicá cuántas personas' };

  const mesa = await db.table.findFirst({ where: { id: tableId, branchId: s.branchId, active: true } });
  if (!mesa) return { ok: false as const, error: 'Esa mesa no es de esta sucursal' };

  const date = fechaLocal(fecha, hora);
  if (!date) return { ok: false as const, error: 'Esa fecha no es válida' };

  if (people > mesa.capacity) {
    return { ok: false as const, error: `La mesa ${mesa.name} es para ${mesa.capacity} personas.` };
  }

  const choque = await solapa(tableId, date, duracionMin);
  if (choque) {
    return {
      ok: false as const,
      error: `La mesa ya está tomada a esa hora por ${choque.customerName}.`,
    };
  }

  await db.reservation.create({
    data: {
      branchId: s.branchId,
      tableId,
      customerName,
      customerPhone: customerPhone || '-',
      type,
      status: 'CONFIRMADA',
      date,
      people,
      duracionMin,
      notes: String(fd.get('notes') || '') || null,
    },
  });

  revalidatePath('/admin/mesas');
  revalidatePath('/admin/reservas');
  return { ok: true as const };
}

/** Mueve una reserva a otra mesa o a otro horario desde la grilla. */
export async function moverReserva(id: string, tableId: string, fechaISO: string) {
  const s = await exigir('reservas.gestionar');
  if (!tieneFuncion(s, 'salon')) return { ok: false as const, error: 'Tu plan no incluye Salón y mesas' };
  const reserva = await db.reservation.findFirst({ where: { id, branchId: s.branchId } });
  if (!reserva) return { ok: false as const, error: 'Esa reserva no es de esta sucursal' };

  const date = new Date(fechaISO);
  if (isNaN(date.getTime())) return { ok: false as const, error: 'Fecha inválida' };

  const mesa = await db.table.findFirst({ where: { id: tableId, branchId: s.branchId, active: true } });
  if (!mesa) return { ok: false as const, error: 'Esa mesa no es de esta sucursal' };

  const choque = await solapa(tableId, date, reserva.duracionMin, id);
  if (choque) {
    return { ok: false as const, error: `Esa mesa ya está tomada por ${choque.customerName}.` };
  }

  await db.reservation.update({ where: { id }, data: { tableId, date } });
  revalidatePath('/admin/mesas');
  return { ok: true as const };
}

/** ¿Hay otra reserva viva que se pise con esta franja en la misma mesa? */
async function solapa(tableId: string, fecha: Date, duracionMin: number, excluirId?: string) {
  // La ventana de búsqueda cubre reservas largas (eventos de hasta 12 horas)
  // que empezaron antes; el cruce exacto se calcula abajo.
  const desde = new Date(fecha.getTime() - 12 * 60 * 60000);
  const hasta = new Date(fecha.getTime() + duracionMin * 60000);

  // Dos reservas se pisan si una arranca antes de que termine la otra.
  // Comparamos la ventana completa, no solo el horario de inicio.
  const candidatas = await db.reservation.findMany({
    where: {
      tableId,
      id: excluirId ? { not: excluirId } : undefined,
      status: { in: ['NUEVA', 'CONFIRMADA', 'SENTADA'] },
      date: { gte: desde, lte: hasta },
    },
    select: { customerName: true, date: true, duracionMin: true },
  });

  const inicio = fecha.getTime();
  const fin = inicio + duracionMin * 60000;

  return (
    candidatas.find((r) => {
      const rInicio = r.date.getTime();
      const rFin = rInicio + r.duracionMin * 60000;
      return rInicio < fin && rFin > inicio;
    }) ?? null
  );
}

/**
 * Mesas disponibles para una fecha y hora concretas.
 *
 * La disponibilidad se calcula por franja, no por un flag en la mesa: una
 * reserva del sábado a las 21 no tiene por qué bloquear el jueves al mediodía.
 */
export async function mesasLibres(fechaISO: string, personas: number, duracionMin = 120) {
  const s = await exigir('reservas.ver');
  const branchId = s.branchId;
  const fecha = new Date(fechaISO);
  if (isNaN(fecha.getTime())) return [];

  const inicio = fecha.getTime();
  const fin = inicio + duracionMin * 60000;

  const candidatas = await db.reservation.findMany({
    where: {
      branchId,
      tableId: { not: null },
      status: { in: ['NUEVA', 'CONFIRMADA', 'SENTADA'] },
      date: { gte: new Date(inicio - 12 * 60 * 60000), lte: new Date(fin) },
    },
    select: { tableId: true, date: true, duracionMin: true },
  });
  const ids = candidatas
    .filter((r) => r.date.getTime() < fin && r.date.getTime() + r.duracionMin * 60000 > inicio)
    .map((r) => r.tableId!)
    .filter(Boolean);

  return db.table.findMany({
    where: {
      branchId,
      active: true,
      status: { not: 'FUERA_DE_SERVICIO' },
      capacity: { gte: personas },
      id: { notIn: ids.length ? ids : ['-'] },
    },
    orderBy: { capacity: 'asc' },
  });
}
