import { cache } from 'react';
import { cookies } from 'next/headers';
import { redirect, notFound } from 'next/navigation';
import { SignJWT, jwtVerify } from 'jose';
import { db } from './db';
import { getTenant } from './tenant';

/**
 * Sesión de quien administra la plataforma (vos): una cookie aparte de la de
 * los locales, que solo vale en el dominio de la plataforma
 * (comandasupreg.com/plataforma). Un empleado de un local nunca llega acá, y
 * un administrador de la plataforma no entra al panel de un local con esta
 * sesión: si necesita ver algo, lo ve desde la ficha del cliente.
 */
const COOKIE = 'cs_plataforma';

function secreto(): Uint8Array {
  const valor = process.env.AUTH_SECRET;
  if (!valor && process.env.NODE_ENV === 'production') throw new Error('Falta AUTH_SECRET en el .env');
  return new TextEncoder().encode(`plataforma:${valor || 'cambiar-este-secreto-en-produccion-por-favor'}`);
}

export type SesionPlataforma = { id: string; name: string; email: string };

export async function crearSesionPlataforma(id: string, version: number) {
  const token = await new SignJWT({ pid: id, v: version })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('8h')
    .sign(secreto());
  (await cookies()).set(COOKIE, token, {
    httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'strict', path: '/', maxAge: 60 * 60 * 8,
  });
}

export async function cerrarSesionPlataforma() {
  (await cookies()).delete(COOKIE);
}

export const getSesionPlataforma = cache(async (): Promise<SesionPlataforma | null> => {
  if (await getTenant()) return null;
  const token = (await cookies()).get(COOKIE)?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secreto());
    if (typeof payload.pid !== 'string' || typeof payload.v !== 'number') return null;
    const a = await db.platformAdmin.findUnique({ where: { id: payload.pid } });
    if (!a || !a.active || a.tokenVersion !== payload.v) return null;
    return { id: a.id, name: a.name, email: a.email };
  } catch {
    return null;
  }
});

/** Para las pantallas de la plataforma: en el dominio de un local no existen. */
export async function requirePlataforma(): Promise<SesionPlataforma> {
  if (await getTenant()) notFound();
  const s = await getSesionPlataforma();
  if (!s) redirect('/plataforma/ingresar');
  return s;
}

/** Para acciones: tira error en vez de redirigir. */
export async function exigirPlataforma(): Promise<SesionPlataforma> {
  const s = await getSesionPlataforma();
  if (!s) throw new Error('Sin sesión de plataforma');
  return s;
}
