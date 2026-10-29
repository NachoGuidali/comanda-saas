'use server';

import { revalidatePath } from 'next/cache';
import { db } from '@/lib/db';
import { exigir, tieneFuncion } from '@/lib/session';
import { randomBytes } from 'crypto';
import { revisarColores } from '@/lib/tema';
import { limitesDe } from '@/lib/plan';
import { auditar } from '@/lib/auditoria';
import { hashToken } from '@/lib/impresora';
import { DEFAULTS, TODOS_LOS_PERMISOS } from '@/lib/permisos';
import type { Prisma, Role } from '@prisma/client';
import { cifrar } from '@/lib/cifrado';
import { verificarCuenta } from '@/lib/mercadopago';
import { IDS_MODO_MITAD } from '@/lib/mitad';
import { leerConfig } from '@/lib/comanda';

// ─────────── Datos del local ───────────

export async function guardarSucursal(fd: FormData) {
  const s = await exigir('config.editar');
  const id = String(fd.get('id') || s.branchId);

  // s.sucursales ya son solo las del cliente: ni el dueño toca una sucursal de otro
  if (!s.sucursales.some((x) => x.id === id)) {
    return { ok: false as const, error: 'No tenés acceso a esa sucursal' };
  }

  const data = {
    name: String(fd.get('name') || '').trim(),
    eslogan: String(fd.get('eslogan') || ''),
    address: String(fd.get('address') || '').trim(),
    phone: String(fd.get('phone') || ''),
    whatsapp: String(fd.get('whatsapp') || '').replace(/\D/g, ''),
    instagram: String(fd.get('instagram') || '').replace('@', ''),
    tiempoDelivery: String(fd.get('tiempoDelivery') || '40-55'),
    tiempoTakeaway: String(fd.get('tiempoTakeaway') || '20-30'),
    mensajeCerrado: String(fd.get('mensajeCerrado') || ''),
    aliasBancario: String(fd.get('aliasBancario') || ''),
    cbu: String(fd.get('cbu') || ''),
    googleResenas: String(fd.get('googleResenas') || ''),
    heroImageUrl: String(fd.get('heroImageUrl') || '') || null,
    aceptaPedidos: fd.get('aceptaPedidos') === 'on',
    intervaloReservaMin: Math.max(15, Number(fd.get('intervaloReservaMin') || 30)),
    duracionReservaMin: Math.max(30, Number(fd.get('duracionReservaMin') || 120)),
    imprimirAuto: fd.get('imprimirAuto') === 'on',
  };

  if (!data.name) return { ok: false as const, error: 'Poné un nombre para la sucursal' };
  if (!data.address) return { ok: false as const, error: 'Poné la dirección' };

  await db.branch.update({ where: { id }, data });

  revalidatePath('/', 'layout');
  revalidatePath('/admin/config');
  return { ok: true as const };
}

/** Cómo se cobra la mitad y mitad en este local (ver src/lib/mitad.ts). */
export async function guardarPrecioMitad(modo: string) {
  const s = await exigir('config.editar');
  if (!IDS_MODO_MITAD.includes(modo)) return { ok: false as const, error: 'Elegí una opción' };
  await db.branch.update({ where: { id: s.branchId }, data: { precioMitad: modo } });
  revalidatePath('/', 'layout');
  return { ok: true as const };
}

/** Cómo salen las comandas y tickets de este local (ver src/lib/comanda.ts). */
export async function guardarComanda(config: unknown) {
  const s = await exigir('config.editar');
  const cfg = leerConfig(config);
  // Solo categorías de este local
  if (cfg.cocina.categoriasBebida.length) {
    const propias = await db.category.findMany({
      where: { branchId: s.branchId, id: { in: cfg.cocina.categoriasBebida } },
      select: { id: true },
    });
    cfg.cocina.categoriasBebida = propias.map((c) => c.id);
  }
  await db.branch.update({ where: { id: s.branchId }, data: { comanda: JSON.stringify(cfg) } });
  revalidatePath('/admin/config');
  return { ok: true as const };
}

export async function guardarHorarios(
  horarios: { dayOfWeek: number; openTime: string; closeTime: string; closed: boolean }[]
) {
  const s = await exigir('config.editar');

  const hora = /^([01]\d|2[0-3]):[0-5]\d$/;
  for (const h of horarios) {
    if (!Number.isInteger(h.dayOfWeek) || h.dayOfWeek < 0 || h.dayOfWeek > 6) {
      return { ok: false as const, error: 'Día inválido' };
    }
    if (!h.closed && (!hora.test(h.openTime) || !hora.test(h.closeTime))) {
      return { ok: false as const, error: 'Revisá los horarios: tienen que ser del estilo 19:30' };
    }
  }

  for (const h of horarios) {
    await db.businessHour.upsert({
      where: { branchId_dayOfWeek: { branchId: s.branchId, dayOfWeek: h.dayOfWeek } },
      update: { openTime: h.openTime, closeTime: h.closeTime, closed: h.closed },
      create: { branchId: s.branchId, dayOfWeek: h.dayOfWeek, openTime: h.openTime, closeTime: h.closeTime, closed: h.closed },
    });
  }

  revalidatePath('/', 'layout');
  revalidatePath('/admin/config');
  return { ok: true as const };
}

/**
 * La marca del cliente: nombre, eslogan, logo y colores. Rige en la carta, el
 * panel, la cocina y los tickets de todas sus sucursales. La cambia el dueño.
 */
export async function guardarMarca(datos: {
  nombre: string; eslogan: string; logoUrl: string; principal: string; acento: string; fondo: string;
}) {
  const s = await exigir('sucursales.gestionar');
  const nombre = String(datos.nombre ?? '').trim().slice(0, 60);
  if (!nombre) return { ok: false as const, error: 'Poné el nombre del local' };
  const colores = {
    principal: String(datos.principal ?? '').trim().toUpperCase(),
    acento: String(datos.acento ?? '').trim().toUpperCase(),
    fondo: String(datos.fondo ?? '').trim().toUpperCase(),
  };
  const problema = revisarColores(colores);
  if (problema) return { ok: false as const, error: problema };
  const logoUrl = String(datos.logoUrl ?? '').trim();
  if (logoUrl && !logoUrl.startsWith('/api/media/') && !/^https:\/\//.test(logoUrl)) {
    return { ok: false as const, error: 'El logo tiene que ser una imagen subida' };
  }

  await auditar({ tenantId: s.tenantId, actorType: 'usuario', actorId: s.userId, actorName: s.name, action: 'marca', detail: `${nombre} · ${colores.principal} ${colores.acento} ${colores.fondo}` });
  await db.tenant.update({
    where: { id: s.tenantId },
    data: {
      name: nombre,
      slogan: String(datos.eslogan ?? '').trim().slice(0, 120),
      logoUrl,
      colorPrimary: colores.principal,
      colorAccent: colores.acento,
      colorBackground: colores.fondo,
    },
  });
  revalidatePath('/', 'layout');
  return { ok: true as const };
}

/**
 * Token del agente de impresión de este cliente. Se muestra una sola vez: se
 * guarda solo su hash. Generar uno nuevo deja sin acceso al anterior.
 */
export async function generarTokenImpresora() {
  const s = await exigir('config.editar');
  const token = randomBytes(24).toString('base64url');
  await db.tenant.update({ where: { id: s.tenantId }, data: { printTokenHash: hashToken(token) } });
  await auditar({ tenantId: s.tenantId, actorType: 'usuario', actorId: s.userId, actorName: s.name, action: 'impresora' });
  revalidatePath('/admin/config');
  return { ok: true as const, token };
}

// ─────────── Alta y baja de sucursales ───────────

function slugify(texto: string): string {
  return texto
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
}

export async function crearSucursal(fd: FormData) {
  const s = await exigir('sucursales.gestionar');

  const tenant = await db.tenant.findUniqueOrThrow({ where: { id: s.tenantId }, include: { plan: true } });
  const { maxBranches } = limitesDe(tenant);
  const total = await db.branch.count({ where: { tenantId: s.tenantId } });
  if (maxBranches !== null && total >= maxBranches) {
    return {
      ok: false as const,
      error: `Tu plan incluye ${maxBranches} ${maxBranches === 1 ? 'sucursal' : 'sucursales'}. Para sumar otra, escribinos.`,
    };
  }

  const name = String(fd.get('name') || '').trim();
  const address = String(fd.get('address') || '').trim();
  const whatsapp = String(fd.get('whatsapp') || '').replace(/\D/g, '');
  if (!name || !address || !whatsapp) {
    return { ok: false as const, error: 'Faltan el nombre, la dirección o el WhatsApp' };
  }

  let slug = slugify(name);
  let i = 1;
  while (await db.branch.findUnique({ where: { tenantId_slug: { tenantId: s.tenantId, slug } }, select: { id: true } })) {
    slug = `${slugify(name)}-${++i}`;
  }

  const branch = await db.branch.create({
    data: {
      tenantId: s.tenantId,
      name, slug, address, whatsapp,
      phone: String(fd.get('phone') || ''),
      eslogan: String(fd.get('eslogan') || ''),
      position: total,
      // Nace apagada: se prende cuando la carta está cargada
      active: false,
    },
  });

  // Horarios iniciales para que no quede sin definir
  for (let d = 0; d < 7; d++) {
    await db.businessHour.create({
      data: { branchId: branch.id, dayOfWeek: d, openTime: '19:00', closeTime: '23:59', closed: false },
    });
  }

  revalidatePath('/', 'layout');
  revalidatePath('/admin/sucursales');
  return { ok: true as const, id: branch.id, slug };
}

/**
 * Apagar una sucursal la saca de la web pública y del selector, pero no borra
 * nada: los pedidos históricos y los reportes siguen estando.
 */
export async function alternarSucursal(id: string, active: boolean) {
  const s = await exigir('sucursales.gestionar');
  if (!s.sucursales.some((x) => x.id === id)) return { ok: false as const, error: 'Esa sucursal no es tuya' };

  if (!active) {
    const activas = await db.branch.count({ where: { tenantId: s.tenantId, active: true } });
    if (activas <= 1) {
      return { ok: false as const, error: 'No podés apagar la última sucursal activa' };
    }
    const abiertos = await db.order.count({
      where: { branchId: id, status: { in: ['PENDIENTE', 'ACEPTADO', 'EN_PREPARACION', 'LISTO', 'EN_CAMINO'] } },
    });
    if (abiertos > 0) {
      return { ok: false as const, error: `Esa sucursal tiene ${abiertos} pedidos sin cerrar. Terminalos primero.` };
    }
  }

  await db.branch.update({ where: { id }, data: { active } });
  revalidatePath('/', 'layout');
  revalidatePath('/admin/sucursales');
  return { ok: true as const };
}

// ─────────── Permisos por rol ───────────

export async function guardarPermisosRol(role: Role, permisos: string[]) {
  const s = await exigir('roles.gestionar');

  if (role === 'SUPERADMIN') {
    return { ok: false as const, error: 'El superadministrador siempre puede todo. No se edita.' };
  }
  // Nadie se puede dejar afuera a sí mismo
  if (!s.esSuperadmin && role === s.role && !permisos.includes('roles.gestionar')) {
    return { ok: false as const, error: 'No te podés quitar el permiso de gestionar permisos a vos mismo' };
  }

  // Quien no es superadmin no puede repartir lo que él mismo no tiene, ni el
  // permiso de crear sucursales: si no, un admin se lo daba a su propio rol.
  // Lo que ese rol ya tenía y este usuario no puede tocar, se conserva.
  const puedeOtorgar = (p: string) => s.esSuperadmin || (s.permisos.includes(p) && p !== 'sucursales.gestionar');
  const actuales = (await db.rolePermisos.findUnique({ where: { tenantId_role: { tenantId: s.tenantId, role } } }))?.permisos ?? DEFAULTS[role] ?? [];
  const validos = [
    ...new Set([
      ...permisos.filter((p) => TODOS_LOS_PERMISOS.includes(p) && puedeOtorgar(p)),
      ...actuales.filter((p) => !puedeOtorgar(p)),
    ]),
  ];

  await auditar({ tenantId: s.tenantId, actorType: 'usuario', actorId: s.userId, actorName: s.name, action: 'permisos', detail: `${role}: ${validos.length} permisos` });
  await db.rolePermisos.upsert({
    where: { tenantId_role: { tenantId: s.tenantId, role } },
    update: { permisos: validos },
    create: { tenantId: s.tenantId, role, permisos: validos },
  });

  revalidatePath('/admin', 'layout');
  return { ok: true as const };
}

export async function restaurarPermisosRol(role: Role) {
  const s = await exigir('roles.gestionar');
  if (role === 'SUPERADMIN') return { ok: false as const, error: 'El superadministrador no se edita' };
  // Restaurar el rol ADMIN le devuelve cosas que quizás el que restaura no tiene
  if (!s.esSuperadmin && DEFAULTS[role].some((p) => !s.permisos.includes(p))) {
    return { ok: false as const, error: 'Solo un superadministrador puede restaurar este rol' };
  }
  await db.rolePermisos.upsert({
    where: { tenantId_role: { tenantId: s.tenantId, role } },
    update: { permisos: DEFAULTS[role] },
    create: { tenantId: s.tenantId, role, permisos: DEFAULTS[role] },
  });
  revalidatePath('/admin', 'layout');
  return { ok: true as const };
}

// ─────────── Cobro online (Mercado Pago del local) ───────────

/**
 * El dueño conecta la cuenta de Mercado Pago de su local: lo que pagan sus
 * clientes online cae ahí. El Access Token se verifica contra Mercado Pago y
 * se guarda cifrado; nunca se vuelve a mostrar entero.
 */
export async function guardarMercadoPago(datos: { modo: string; token?: string; secreto?: string; borrarSecreto?: boolean }) {
  const s = await exigir('sucursales.gestionar');
  if (!tieneFuncion(s, 'pago_online')) return { ok: false as const, error: 'Tu plan no incluye el pago online' };
  const modo = String(datos.modo);
  if (!['apagado', 'simulado', 'real'].includes(modo)) return { ok: false as const, error: 'Elegí una opción' };

  const actual = await db.tenant.findUniqueOrThrow({ where: { id: s.tenantId }, select: { mpAccessToken: true } });
  const data: Prisma.TenantUpdateInput = { mpMode: modo };
  let aviso = '';

  const token = String(datos.token ?? '').trim();
  if (token) {
    if (!/^(APP_USR|TEST)-[\w-]{20,}$/.test(token)) return { ok: false as const, error: 'Ese no parece un Access Token de Mercado Pago (empieza con APP_USR- o TEST-)' };
    try {
      const cuenta = await verificarCuenta(token);
      data.mpAccessToken = cifrar(token);
      data.mpAccount = `${cuenta.nombre} (${cuenta.id})`;
      aviso = `Cuenta conectada: ${cuenta.nombre}.`;
    } catch {
      return { ok: false as const, error: 'Mercado Pago no aceptó ese Access Token. Revisá que sea el de producción de tu cuenta.' };
    }
  } else if (modo === 'real' && !actual.mpAccessToken) {
    return { ok: false as const, error: 'Pegá el Access Token de tu cuenta de Mercado Pago' };
  }
  const secreto = String(datos.secreto ?? '').trim();
  if (secreto) data.mpWebhookSecret = cifrar(secreto);
  if (datos.borrarSecreto) data.mpWebhookSecret = null;

  await db.tenant.update({ where: { id: s.tenantId }, data });
  await auditar({
    tenantId: s.tenantId, actorType: 'usuario', actorId: s.userId, actorName: s.name, action: 'credenciales',
    detail: `Mercado Pago: ${modo}${token ? ', token nuevo' : ''}${secreto ? ', clave secreta nueva' : ''}${datos.borrarSecreto ? ', sin clave secreta' : ''}`,
  });
  revalidatePath('/admin/config');
  revalidatePath('/', 'layout');
  return { ok: true as const, aviso };
}
