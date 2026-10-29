import { cache } from 'react';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { SignJWT, jwtVerify } from 'jose';
import type { Role } from '@prisma/client';
import { db } from './db';
import { DEFAULTS } from './permisos';
import { getTenant } from './tenant';
import { limitesDe, type Funcion } from './plan';

const COOKIE = 'pz_session';
const COOKIE_SUCURSAL = 'pz_sucursal';
const SECRETO_DE_EJEMPLO = 'cambiar-este-secreto-en-produccion-por-favor';

/**
 * El secreto se lee recién al usarlo, no al importar el archivo: durante el
 * build no hay .env y no tiene que fallar. En producción, sin secreto propio,
 * el sistema se niega a firmar sesiones: con el de ejemplo cualquiera que lea
 * este código podría fabricarse una sesión de superadministrador.
 */
function secreto(): Uint8Array {
  const valor = process.env.AUTH_SECRET;
  if (!valor || valor === SECRETO_DE_EJEMPLO) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('Falta AUTH_SECRET en el .env. Generalo con: openssl rand -base64 48');
    }
    return new TextEncoder().encode(SECRETO_DE_EJEMPLO);
  }
  return new TextEncoder().encode(valor);
}

export type Session = {
  userId: string;
  /// El cliente (la pizzería) al que pertenece: siempre el del dominio por el que entró
  tenantId: string;
  /// Funciones opcionales que incluye el plan del cliente (salón, insumos...)
  funciones: Funcion[];
  name: string;
  role: Role;
  /// Sucursales a las que entra. Para el superadmin queda vacío: entra a todas.
  branchIds: string[];
  permisos: string[];
};

export type SessionConSucursal = Session & {
  /// La sucursal en la que está parado ahora
  branchId: string;
  branchName: string;
  sucursales: { id: string; name: string; slug: string }[];
  esSuperadmin: boolean;
};

/**
 * La cookie guarda solo quién es y la versión de su clave. El rol, los
 * permisos y las sucursales se leen de la base en cada pedido: si el dueño le
 * saca un permiso a alguien o lo da de baja, rige en el acto, no a las 12 horas
 * cuando vence la cookie.
 */
export async function createSession(userId: string, tokenVersion: number, tenantId: string) {
  const token = await new SignJWT({ userId, v: tokenVersion, t: tenantId })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('12h')
    .sign(secreto());

  (await cookies()).set(COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 12,
  });
}

export async function destroySession() {
  const c = await cookies();
  c.delete(COOKIE);
  c.delete(COOKIE_SUCURSAL);
}

/** Arma los permisos efectivos: los del rol (en ese cliente) más los extras del usuario. */
export async function permisosDe(tenantId: string, role: Role, extras: string[]): Promise<string[]> {
  const fila = await db.rolePermisos.findUnique({ where: { tenantId_role: { tenantId, role } } });
  const base = fila?.permisos ?? DEFAULTS[role] ?? [];
  return [...new Set([...base, ...extras])];
}

/**
 * Sesión del usuario que hace el pedido, o null. Se memoriza por request, así
 * que llamarla varias veces en la misma pantalla consulta la base una sola vez.
 *
 * Una cookie de una versión anterior del sistema (sin versión de clave) se
 * descarta y la persona vuelve al login, en vez de quedar trabada.
 *
 * La sesión vale solo en el dominio de su cliente: un usuario de Pepperino no
 * entra al panel de otro cliente aunque copie su cookie. Con el cliente
 * suspendido, nadie de ese cliente entra.
 */
export const getSession = cache(async (): Promise<Session | null> => {
  const token = (await cookies()).get(COOKIE)?.value;
  if (!token) return null;

  const tenant = await getTenant();
  if (!tenant || !tenant.active) return null;

  let userId: string;
  let version: number;
  try {
    const { payload } = await jwtVerify(token, secreto());
    if (typeof payload.userId !== 'string' || typeof payload.v !== 'number') return null;
    if (payload.t !== tenant.id) return null;
    userId = payload.userId;
    version = payload.v;
  } catch {
    return null;
  }

  const user = await db.user.findUnique({
    where: { id: userId },
    select: {
      id: true, tenantId: true, name: true, role: true, active: true, tokenVersion: true, permisosExtra: true,
      branches: { select: { branchId: true } },
    },
  });
  if (!user || !user.active || user.tokenVersion !== version || user.tenantId !== tenant.id) return null;

  return {
    userId: user.id,
    tenantId: tenant.id,
    funciones: limitesDe(tenant).funciones,
    name: user.name,
    role: user.role,
    branchIds: user.branches.map((b) => b.branchId),
    permisos: await permisosDe(tenant.id, user.role, user.permisosExtra),
  };
});

async function sucursalesDe(session: Session) {
  const esSuperadmin = session.role === 'SUPERADMIN';
  const sucursales = await db.branch.findMany({
    where: esSuperadmin
      ? { tenantId: session.tenantId }
      : { tenantId: session.tenantId, id: { in: session.branchIds }, active: true },
    orderBy: { position: 'asc' },
    select: { id: true, name: true, slug: true },
  });
  const pedida = (await cookies()).get(COOKIE_SUCURSAL)?.value;
  const activa = sucursales.find((s) => s.id === pedida) ?? sucursales[0];
  return { esSuperadmin, sucursales, activa };
}

/**
 * Sesión para rutas de API. No redirige, porque en un endpoint no hay pantalla
 * a la que mandar a nadie: devuelve null y el que llama responde 401.
 */
export async function getApiSession(): Promise<SessionConSucursal | null> {
  const session = await getSession();
  if (!session) return null;
  const { esSuperadmin, sucursales, activa } = await sucursalesDe(session);
  if (!activa) return null;
  return { ...session, branchId: activa.id, branchName: activa.name, sucursales, esSuperadmin };
}

export async function setSucursalActiva(branchId: string) {
  (await cookies()).set(COOKIE_SUCURSAL, branchId, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 24 * 30,
  });
}

/**
 * Exige sesión y devuelve también en qué sucursal está parado el usuario.
 *
 * El superadmin (el dueño del cliente) ve todas las de su cliente. El resto
 * solo las que le asignaron; si la cookie
 * apunta a una que no le corresponde, se la manda a la primera suya. Eso evita
 * que alguien cambie la cookie a mano y vea el otro local.
 */
export async function requireSession(permiso?: string): Promise<SessionConSucursal> {
  const session = await getSession();
  if (!session) redirect('/login');

  const { esSuperadmin, sucursales, activa } = await sucursalesDe(session);
  if (!activa) redirect('/login?error=sin-sucursal');

  if (permiso && !esSuperadmin && !session.permisos.includes(permiso)) {
    redirect('/admin?error=sin-permiso');
  }

  return {
    ...session,
    branchId: activa.id,
    branchName: activa.name,
    sucursales,
    esSuperadmin,
  };
}

/** Para chequear permisos dentro de una acción sin redirigir. */
export function puede(session: Session, ...permisos: string[]): boolean {
  return session.role === 'SUPERADMIN' || permisos.some((p) => session.permisos.includes(p));
}

/** Error de permiso que las pantallas muestran tal cual al usuario. */
export class SinPermiso extends Error {
  constructor() {
    super('No tenés permiso para hacer eso');
    this.name = 'SinPermiso';
  }
}

/** Exige un permiso dentro de una server action. Devuelve la sesión ya validada. */
export async function exigir(permiso: string): Promise<SessionConSucursal> {
  const session = await requireSession();
  if (!session.esSuperadmin && !session.permisos.includes(permiso)) {
    throw new SinPermiso();
  }
  return session;
}

/** Verifica que la sucursal pedida sea una a la que el usuario entra. */
export function alcanza(session: SessionConSucursal, branchId: string): boolean {
  // Las sucursales de la sesión ya son solo las del cliente (todas, para el dueño)
  return session.sucursales.some((s) => s.id === branchId);
}

/** Si el plan del cliente incluye una función opcional (salón, insumos, sueldos, pago online). */
export function tieneFuncion(session: Session, f: Funcion): boolean {
  return session.funciones.includes(f);
}

/** Para pantallas de funciones opcionales: si el plan no la incluye, vuelve al panel. */
export function exigirFuncion(session: Session, f: Funcion) {
  if (!tieneFuncion(session, f)) redirect('/admin?error=sin-funcion');
}
