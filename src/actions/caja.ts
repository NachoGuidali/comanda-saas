'use server';

import { revalidatePath } from 'next/cache';
import { db } from '@/lib/db';
import { requireSession, puede } from '@/lib/session';
import { toCents } from '@/lib/money';
import { resumenCaja } from '@/lib/caja';
import { claveDia } from '@/lib/tiempo';
import { IDS_CATEGORIA, diaParaGuardar } from '@/lib/gastos';

async function operador() {
  const s = await requireSession();
  return puede(s, 'caja.operar') ? s : null;
}

/** Abre el turno de caja con el fondo que hay en el cajón. Uno por local. */
export async function abrirCaja(fd: FormData) {
  const s = await operador();
  if (!s) return { ok: false as const, error: 'No tenés permiso para operar la caja' };

  const fondo = toCents(String(fd.get('fondo') || '0'));
  if (fondo < 0) return { ok: false as const, error: 'El fondo no puede ser negativo' };

  const abierta = await db.cashSession.findFirst({ where: { branchId: s.branchId, closedAt: null } });
  if (abierta) return { ok: false as const, error: 'Ya hay una caja abierta en este local' };

  await db.cashSession.create({
    data: { branchId: s.branchId, openedById: s.userId, openingAmount: fondo },
  });
  revalidatePath('/admin/caja');
  return { ok: true as const };
}

/** Plata que entra o sale del cajón y no es una venta. */
export async function registrarMovimiento(fd: FormData) {
  const s = await operador();
  if (!s) return { ok: false as const, error: 'No tenés permiso para operar la caja' };

  const type = String(fd.get('type')) === 'INGRESO' ? 'INGRESO' : 'EGRESO';
  const amount = toCents(String(fd.get('amount') || '0'));
  const reason = String(fd.get('reason') || '').trim().slice(0, 200);
  if (amount <= 0) return { ok: false as const, error: 'Poné el monto' };
  if (!reason) return { ok: false as const, error: 'Anotá el motivo: pago a proveedor, retiro, cambio...' };

  const caja = await db.cashSession.findFirst({ where: { branchId: s.branchId, closedAt: null } });
  if (!caja) return { ok: false as const, error: 'No hay una caja abierta' };

  // Una salida puede ser un gasto del local (la compra de pollo) o no (un
  // retiro del dueño, cambio que se llevó al banco). Si es gasto, queda
  // también en el registro de gastos, con su categoría, sin cargarlo dos veces.
  const categoria = String(fd.get('categoria') || '');
  const esGasto = type === 'EGRESO' && categoria !== '';
  if (esGasto) {
    if (!IDS_CATEGORIA.includes(categoria)) return { ok: false as const, error: 'Categoría de gasto inválida' };
    if (!puede(s, 'gastos.cargar')) return { ok: false as const, error: 'No tenés permiso para cargar gastos' };
  }

  await db.$transaction(async (tx) => {
    const mov = await tx.cashMovement.create({ data: { sessionId: caja.id, type, amount, reason, userId: s.userId } });
    if (esGasto) {
      await tx.expense.create({
        data: {
          branchId: s.branchId,
          date: diaParaGuardar(claveDia(new Date())),
          category: categoria,
          description: reason,
          amount,
          payment: 'EFECTIVO_CAJA',
          createdById: s.userId,
          cashMovementId: mov.id,
        },
      });
    }
  });
  revalidatePath('/admin/caja');
  revalidatePath('/admin/gastos');
  return { ok: true as const };
}

/**
 * Cierre con arqueo: se cuenta el efectivo y el sistema registra la
 * diferencia contra lo esperado. El esperado queda congelado al cerrar, así
 * el número del cierre no cambia si mañana alguien toca un pedido de hoy.
 */
export async function cerrarCaja(fd: FormData) {
  const s = await operador();
  if (!s) return { ok: false as const, error: 'No tenés permiso para operar la caja' };

  const contadoTexto = String(fd.get('contado') || '').trim();
  if (!contadoTexto) return { ok: false as const, error: 'Contá el efectivo y poné cuánto hay' };
  const contado = toCents(contadoTexto);
  if (contado < 0) return { ok: false as const, error: 'El monto contado no puede ser negativo' };

  const caja = await db.cashSession.findFirst({ where: { branchId: s.branchId, closedAt: null } });
  if (!caja) return { ok: false as const, error: 'No hay una caja abierta' };

  // El esperado y el cierre corresponden al mismo instante
  const ahora = new Date();
  const resumen = await resumenCaja(caja.id, ahora);

  const r = await db.cashSession.updateMany({
    where: { id: caja.id, closedAt: null },
    data: {
      closedAt: ahora,
      closedById: s.userId,
      countedAmount: contado,
      expectedAmount: resumen.esperado,
      notes: String(fd.get('notes') || '').trim().slice(0, 500) || null,
    },
  });

  if (r.count === 0) return { ok: false as const, error: 'Otra persona ya cerró esta caja' };

  revalidatePath('/admin/caja');
  return { ok: true as const, diferencia: contado - resumen.esperado };
}
