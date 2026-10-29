import { cache } from 'react';
import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import type { Plan, Tenant as TenantDb } from '@prisma/client';

/** El cliente, con su plan (para saber límites y funciones). */
export type Tenant = TenantDb & { plan: Plan | null };
import { db } from './db';

/**
 * De qué cliente es cada pedido, según el dominio por el que entra:
 *
 *   comandasupreg.com             → la plataforma (sin cliente)
 *   pepperino.comandasupreg.com   → Pepperino
 *   pedidos.pepperino.com.ar      → Pepperino, si lo cargó como dominio propio
 *
 * El dominio base sale de SAAS_DOMINIO (en desarrollo, "localhost": los
 * navegadores resuelven pepperino.localhost a la propia máquina sin tocar nada).
 * TENANT_POR_DEFECTO sirve para una instalación de un solo cliente o para
 * entrar por IP: si el dominio no es de nadie, se usa ese.
 */

const SUBDOMINIOS_RESERVADOS = new Set(['www', 'app', 'api', 'admin', 'panel', 'mail', 'static']);

export function dominioBase(): string {
  return (process.env.SAAS_DOMINIO || 'localhost').toLowerCase().replace(/^\.+|\.+$/g, '');
}

/** "Pepperino.ComandaSupreg.com:443" → "pepperino.comandasupreg.com" */
export function limpiarHost(host: string | null | undefined): string {
  return (host ?? '').split(',')[0].trim().toLowerCase().replace(/:\d+$/, '').replace(/\.$/, '');
}

export type Destino = { tipo: 'plataforma' } | { tipo: 'subdominio'; slug: string } | { tipo: 'dominio'; host: string };

/** Qué pidió el navegador, sin tocar la base. */
export function destinoDelHost(hostCrudo: string | null | undefined): Destino {
  const host = limpiarHost(hostCrudo);
  const base = dominioBase();
  if (!host || host === base || host === `www.${base}`) return { tipo: 'plataforma' };
  if (host.endsWith(`.${base}`)) {
    const sub = host.slice(0, -(base.length + 1));
    if (!sub.includes('.') && !SUBDOMINIOS_RESERVADOS.has(sub)) return { tipo: 'subdominio', slug: sub };
    return { tipo: 'plataforma' };
  }
  return { tipo: 'dominio', host };
}

/** El host del pedido: detrás de Caddy o nginx llega en X-Forwarded-Host. */
export function hostDelPedido(h: Headers): string {
  return h.get('x-forwarded-host') || h.get('host') || '';
}

async function buscar(destino: Destino): Promise<Tenant | null> {
  let tenant: Tenant | null = null;
  const include = { plan: true } as const;
  if (destino.tipo === 'subdominio') tenant = await db.tenant.findUnique({ where: { slug: destino.slug }, include });
  if (destino.tipo === 'dominio') tenant = await db.tenant.findUnique({ where: { customDomain: destino.host }, include });
  if (!tenant && destino.tipo !== 'subdominio' && process.env.TENANT_POR_DEFECTO) {
    tenant = await db.tenant.findUnique({ where: { slug: process.env.TENANT_POR_DEFECTO }, include });
  }
  return tenant;
}

/** El cliente del dominio por el que entró este pedido, o null si es la plataforma (o no existe). */
export const getTenant = cache(async (): Promise<Tenant | null> => {
  const h = await headers();
  return buscar(destinoDelHost(hostDelPedido(h)));
});

/** Para rutas de API, que reciben el Request. */
export async function tenantDeRequest(req: Request): Promise<Tenant | null> {
  return buscar(destinoDelHost(hostDelPedido(req.headers)));
}

/**
 * Exige estar en el dominio de un cliente activo. En el dominio de la
 * plataforma, o en un subdominio que no existe, la página no existe. Un cliente
 * suspendido ve el aviso (lo resuelve el layout raíz), no la carta ni el panel.
 */
export async function requireTenant(): Promise<Tenant> {
  const tenant = await getTenant();
  if (!tenant) notFound();
  return tenant;
}

/** La dirección pública de un cliente: su dominio propio o su subdominio. */
export function urlDelCliente(t: Pick<Tenant, 'slug' | 'customDomain'>, ruta = '/'): string {
  const base = dominioBase();
  const local = base === 'localhost';
  const host = t.customDomain || `${t.slug}.${base}`;
  const puerto = local ? `:${process.env.PORT || 3000}` : '';
  return `${local ? 'http' : 'https'}://${host}${puerto}${ruta}`;
}

/** Slug válido para un subdominio: 3 a 40 letras minúsculas, números o guiones, sin guion en los bordes. */
export function slugValido(slug: string): boolean {
  return /^[a-z0-9](?:[a-z0-9-]{1,38})[a-z0-9]$/.test(slug) && !SUBDOMINIOS_RESERVADOS.has(slug);
}
