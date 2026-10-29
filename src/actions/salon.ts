'use server';

import { revalidatePath } from 'next/cache';
import type { OrderStatus, PaymentMethod } from '@prisma/client';
import { db } from '@/lib/db';
import { requireSession, puede, tieneFuncion } from '@/lib/session';
import { money } from '@/lib/money';
import { nombreMesa } from '@/lib/etiquetas';
import { cambiarEstado, marcarCobrado } from './orders';
import { encolarCuentaMesa } from '@/lib/print';

type Resultado = { ok: true; aviso?: string } | { ok: false; error: string };

const ABIERTOS: OrderStatus[] = ['PENDIENTE', 'ACEPTADO', 'EN_PREPARACION', 'LISTO', 'EN_CAMINO'];
const PAGOS: PaymentMethod[] = ['EFECTIVO', 'TRANSFERENCIA', 'TARJETA_ENTREGA', 'MERCADO_PAGO'];

function refrescar() {
  revalidatePath('/admin/salon');
  revalidatePath('/admin/mesas');
  revalidatePath('/admin/pedidos');
}

/** Atender mesas: quien carga pedidos o maneja las mesas (mozo, caja, encargado). */
function atiende(s: Awaited<ReturnType<typeof requireSession>>) {
  return tieneFuncion(s, 'salon') && puede(s, 'mesas.ver') && puede(s, 'pedidos.crear', 'mesas.editar');
}

/** Se sienta gente: la mesa 11 queda ocupada con 3 personas, a cargo de quien la abre. */
export async function abrirMesa(id: string, personas: number): Promise<Resultado> {
  const s = await requireSession();
  if (!atiende(s)) return { ok: false, error: 'No tenés permiso para atender mesas' };
  const n = Math.floor(Number(personas));
  if (!Number.isFinite(n) || n < 1 || n > 99) return { ok: false, error: '¿Cuántos son?' };

  const mesa = await db.table.findFirst({ where: { id, branchId: s.branchId, active: true } });
  if (!mesa) return { ok: false, error: 'Esa mesa no es de este local' };
  if (mesa.status === 'FUERA_DE_SERVICIO') return { ok: false, error: `${nombreMesa(mesa.name)} está fuera de servicio` };
  // Dos mozos tocando la misma mesa libre a la vez: entra el primero
  const r = await db.table.updateMany({
    where: { id, branchId: s.branchId, guests: null },
    data: { status: 'OCUPADA', guests: n, openedAt: mesa.openedAt ?? new Date(), waiterId: s.userId },
  });
  if (r.count === 0) return { ok: false, error: `${nombreMesa(mesa.name)} ya la abrió otro` };
  refrescar();
  return { ok: true };
}

/** Llegó uno más, o se fue alguien. */
export async function cambiarPersonas(id: string, personas: number): Promise<Resultado> {
  const s = await requireSession();
  if (!atiende(s)) return { ok: false, error: 'No tenés permiso para atender mesas' };
  const n = Math.floor(Number(personas));
  if (!Number.isFinite(n) || n < 1 || n > 99) return { ok: false, error: '¿Cuántos son?' };
  const r = await db.table.updateMany({ where: { id, branchId: s.branchId, status: 'OCUPADA' }, data: { guests: n } });
  if (r.count === 0) return { ok: false, error: 'Esa mesa no está ocupada' };
  refrescar();
  return { ok: true };
}

/** "Esta la atiendo yo": pasa la mesa a quien toca el botón. */
export async function tomarMesa(id: string): Promise<Resultado> {
  const s = await requireSession();
  if (!atiende(s)) return { ok: false, error: 'No tenés permiso para atender mesas' };
  const r = await db.table.updateMany({ where: { id, branchId: s.branchId, status: 'OCUPADA' }, data: { waiterId: s.userId } });
  if (r.count === 0) return { ok: false, error: 'Esa mesa no está ocupada' };
  refrescar();
  return { ok: true };
}

/**
 * Se fueron: la mesa queda libre. Antes, lo servido se marca entregado y, si
 * quien cierra puede cobrar y elige cómo pagaron, se cobra lo pendiente. Si la
 * cocina todavía tiene algo, o queda plata sin cobrar, no se cierra.
 */
export async function cerrarMesa(id: string, cobrarCon?: PaymentMethod | null): Promise<Resultado> {
  const s = await requireSession();
  if (!atiende(s)) return { ok: false, error: 'No tenés permiso para atender mesas' };
  const mesa = await db.table.findFirst({ where: { id, branchId: s.branchId } });
  if (!mesa) return { ok: false, error: 'Esa mesa no es de este local' };
  if (cobrarCon && !PAGOS.includes(cobrarCon)) return { ok: false, error: 'Forma de pago inválida' };

  const pedidos = await db.order.findMany({
    where: {
      tableId: id, branchId: s.branchId, status: { notIn: ['RECHAZADO', 'CANCELADO'] },
      OR: [{ status: { in: ABIERTOS } }, { paymentStatus: 'PENDIENTE' }, ...(mesa.openedAt ? [{ createdAt: { gte: mesa.openedAt } }] : [])],
    },
    select: { id: true, code: true, status: true, paymentStatus: true, total: true },
  });

  const enCocina = pedidos.filter((p) => ['PENDIENTE', 'ACEPTADO', 'EN_PREPARACION'].includes(p.status));
  if (enCocina.length) {
    return { ok: false, error: `La cocina todavía tiene ${enCocina.map((p) => p.code).join(', ')}. Cuando esté listo, se puede cerrar.` };
  }
  const sinCobrar = pedidos.filter((p) => p.paymentStatus === 'PENDIENTE');
  const deuda = sinCobrar.reduce((t, p) => t + p.total, 0);
  if (sinCobrar.length && !cobrarCon) {
    return {
      ok: false,
      error: puede(s, 'pedidos.cobrar')
        ? `Quedan ${money(deuda)} sin cobrar. Elegí cómo pagaron.`
        : `Quedan ${money(deuda)} sin cobrar. Que la caja cobre la mesa y la cierre.`,
    };
  }

  // Lo que estaba listo ya se sirvió
  for (const p of pedidos.filter((x) => x.status === 'LISTO' || x.status === 'EN_CAMINO')) {
    const r = await cambiarEstado(p.id, 'ENTREGADO');
    if (!r.ok) return { ok: false, error: r.error };
  }
  for (const p of sinCobrar) {
    const r = await marcarCobrado(p.id, cobrarCon!);
    if (!r.ok) return { ok: false, error: `${p.code}: ${r.error}` };
  }

  await db.table.update({ where: { id }, data: { status: 'LIBRE', guests: null, openedAt: null, waiterId: null } });
  refrescar();
  return { ok: true, aviso: sinCobrar.length ? `Cobrado ${money(deuda)}. ${nombreMesa(mesa.name)} libre.` : `${nombreMesa(mesa.name)} libre.` };
}

/** Imprime la cuenta de la mesa en la caja: todas las rondas en un ticket. */
export async function imprimirCuenta(id: string): Promise<Resultado> {
  const s = await requireSession();
  if (!atiende(s) || !puede(s, 'pedidos.imprimir', 'pedidos.cobrar', 'mesas.editar')) {
    return { ok: false, error: 'No tenés permiso para imprimir' };
  }
  const mesa = await db.table.findFirst({ where: { id, branchId: s.branchId }, select: { id: true } });
  if (!mesa) return { ok: false, error: 'Esa mesa no es de este local' };
  const ok = await encolarCuentaMesa(id);
  if (!ok) return { ok: false, error: 'La mesa no tiene nada pedido' };
  return { ok: true, aviso: 'La cuenta sale por la impresora de la caja.' };
}
