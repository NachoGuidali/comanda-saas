import { createHash, randomBytes, timingSafeEqual } from 'crypto';
import type { PrintAgent, Tenant } from '@prisma/client';
import { db } from './db';
import { tenantDeRequest } from './tenant';

/** El token del agente se guarda solo como hash: si alguien lee la base, no puede imprimir. */
export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function iguales(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/**
 * Autenticación del agente de impresión. Es un proceso, no un navegador, así
 * que usa una clave (token).
 *
 * Lo normal es que cada impresora tenga la suya: se vincula desde el panel con
 * un código corto (Configuración → Impresión) y la clave queda atada a esa
 * sucursal, así una pizzería nunca recibe las comandas de otra ni un local las
 * del otro. Esa clave entra por cualquier dominio: el agente vinculado no
 * necesita saber nada más.
 *
 * Quedan dos formas viejas, para agentes configurados a mano con .env: la
 * clave general del cliente (que entra por su dominio y elige la sucursal con
 * ?sucursal=) y PRINT_TOKEN del servidor para un cliente sin clave propia.
 */
export async function clienteDelAgente(req: Request): Promise<{ tenant: Tenant; agente: PrintAgent | null } | null> {
  const recibido = req.headers.get('x-print-token');
  if (!recibido) return null;

  const agente = await db.printAgent.findUnique({ where: { tokenHash: hashToken(recibido) }, include: { tenant: true } });
  if (agente) {
    if (!agente.tenant.active) return null;
    const { tenant, ...resto } = agente;
    return { tenant, agente: resto };
  }

  const tenant = await tenantDeRequest(req);
  if (!tenant || !tenant.active) return null;
  if (tenant.printTokenHash) return iguales(hashToken(recibido), tenant.printTokenHash) ? { tenant, agente: null } : null;
  const global = process.env.PRINT_TOKEN;
  return global && iguales(recibido, global) ? { tenant, agente: null } : null;
}

/**
 * Lo que cuenta el agente en cada consulta (qué impresora usa, si le está
 * fallando), para verlo desde el panel sin ir al local. Se escribe como mucho
 * cada 30 segundos, o enseguida si cambió algo.
 */
export async function anotarEstado(agente: PrintAgent, req: Request) {
  const h = (k: string, max: number) => (req.headers.get(k) ?? '').slice(0, max);
  let estado = h('x-agente-estado', 300);
  try { estado = decodeURIComponent(estado); } catch { /* queda como vino */ }
  let impresora = h('x-agente-impresora', 120);
  try { impresora = decodeURIComponent(impresora); } catch { /* queda como vino */ }
  const datos = {
    lastSeenAt: new Date(),
    lastError: estado && estado !== 'ok' ? estado : null,
    printer: impresora || agente.printer,
    version: h('x-agente-version', 20) || agente.version,
  };
  const cambio = datos.lastError !== agente.lastError || datos.printer !== agente.printer || datos.version !== agente.version;
  if (cambio || !agente.lastSeenAt || Date.now() - agente.lastSeenAt.getTime() > 30_000) {
    await db.printAgent.update({ where: { id: agente.id }, data: datos });
  }
}

/** Qué estaciones imprime un agente: null = todas. */
export function estacionesDe(agente: PrintAgent | null, req: Request): string | null {
  if (agente) return agente.stations === 'todo' ? null : agente.stations;
  return new URL(req.url).searchParams.get('station') || null;
}

/** Hace cuánto tiempo sin noticias de un agente se lo muestra como desconectado. */
export const CONECTADO_MS = 60_000;

/**
 * De qué local es el agente que pregunta. Viene en `?sucursal=adrogue`.
 * Si el cliente tiene un solo local activo se puede omitir; con varios es
 * obligatorio, porque si no el agente de un local imprimiría las del otro.
 */
export async function sucursalDelAgente(req: Request, tenantId: string): Promise<{ id: string } | { error: string }> {
  const slug = new URL(req.url).searchParams.get('sucursal')?.trim();
  if (slug) {
    const b = await db.branch.findUnique({ where: { tenantId_slug: { tenantId, slug } }, select: { id: true } });
    return b ?? { error: `No existe la sucursal "${slug}". Revisá SUCURSAL en el .env del agente.` };
  }
  const activas = await db.branch.findMany({ where: { tenantId, active: true }, select: { id: true } });
  if (activas.length === 1) return activas[0];
  return { error: 'Hay varias sucursales: configurá SUCURSAL en el .env del agente con el slug del local (por ejemplo adrogue).' };
}

/** Pasado este tiempo una comanda ya no sirve: no se imprime un pedido de ayer. */
export const VENCE_EN_MS = 4 * 60 * 60 * 1000;
/** Intentos antes de darla por perdida y dejarla en error. */
export const MAX_INTENTOS = 10;

// ─────────── Vinculación con código ───────────

/** Sin letras que se confunden por teléfono (0/O, 1/I/L). */
const ALFABETO = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
/** Lo que dura el código para vincular una impresora. */
export const CODIGO_DURA_MS = 30 * 60_000;

export function nuevoCodigo(): string {
  const bytes = randomBytes(8);
  const letras = [...bytes].map((b) => ALFABETO[b % ALFABETO.length]).join('');
  return `${letras.slice(0, 4)}-${letras.slice(4)}`;
}

/** "abcd efgh", "ABCD-EFGH" y "abcdefgh" son el mismo código. */
export function normalizarCodigo(texto: string): string {
  return String(texto ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
}
