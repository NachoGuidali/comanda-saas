'use server';

import { revalidatePath } from 'next/cache';
import type { ExpensePayment } from '@prisma/client';
import { db } from '@/lib/db';
import { requireSession, puede } from '@/lib/session';
import { toCents } from '@/lib/money';
import { claveDia } from '@/lib/tiempo';
import { IDS_CATEGORIA, FORMAS_PAGO_GASTO } from '@/lib/gastos';
import { guardarGasto } from '@/lib/gastos-guardar';

type Resultado = { ok: true; aviso?: string } | { ok: false; error: string };

const FORMAS = FORMAS_PAGO_GASTO.map((f) => f.id) as string[];

function refrescar() {
  revalidatePath('/admin/gastos');
  revalidatePath('/admin/caja');
  revalidatePath('/admin/reportes');
}

/**
 * Carga un gasto: "5/10, compra de pollo, $120.000".
 *
 * Si se pagó con el efectivo de la caja y hay un turno abierto, además sale
 * como egreso de la caja: así el arqueo cierra sin cargarlo dos veces.
 */
export async function cargarGasto(fd: FormData): Promise<Resultado> {
  const s = await requireSession();
  if (!puede(s, 'gastos.cargar')) return { ok: false, error: 'No tenés permiso para cargar gastos' };

  const fecha = String(fd.get('date') || '');
  const category = String(fd.get('category') || '');
  const description = String(fd.get('description') || '').trim().slice(0, 200);
  const supplier = String(fd.get('supplier') || '').trim().slice(0, 100) || null;
  const amount = toCents(String(fd.get('amount') || ''));
  const payment = String(fd.get('payment') || 'EFECTIVO') as ExpensePayment;

  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) return { ok: false, error: 'Elegí la fecha del gasto' };
  // Un gasto de mañana es casi siempre un error de tipeo; se admite como mucho un día
  const hoy = claveDia(new Date());
  const manana = claveDia(new Date(Date.now() + 24 * 60 * 60_000));
  if (fecha > manana) return { ok: false, error: `La fecha no puede ser posterior a ${manana.split('-').reverse().join('/')}` };
  if (fecha < '2000-01-01') return { ok: false, error: 'Revisá la fecha' };
  if (!IDS_CATEGORIA.includes(category)) return { ok: false, error: 'Elegí una categoría' };
  if (!description) return { ok: false, error: 'Contá qué se compró o pagó, por ejemplo "Compra de pollo"' };
  if (amount <= 0) return { ok: false, error: 'Poné el monto' };
  if (amount > 100_000_000_00) return { ok: false, error: 'Ese monto parece un error. Revisalo.' };
  if (!FORMAS.includes(payment)) return { ok: false, error: 'Elegí cómo se pagó' };

  let aviso: string | undefined;
  await db.$transaction(async (tx) => {
    const g = await guardarGasto(tx, {
      branchId: s.branchId, userId: s.userId, fecha, category, description, supplier, amount, payment,
    });
    aviso = g.aviso;
  });

  if (fecha < hoy.slice(0, 8) + '01') {
    aviso = [aviso, 'Es de un mes anterior: cambia el resultado de ese mes, no el de este.'].filter(Boolean).join(' ');
  }

  refrescar();
  return { ok: true, aviso };
}

/**
 * Anula un gasto cargado por error. No se borra: queda tachado en el
 * registro con quién lo anuló, cuándo y por qué.
 *
 * Quien carga puede anular lo suyo del mismo día (el error típico: se tipeó
 * mal el monto). Lo demás necesita el permiso de anular.
 */
export async function anularGasto(id: string, motivo: string): Promise<Resultado> {
  const s = await requireSession();
  const g = await db.expense.findFirst({
    where: { id, branchId: s.branchId },
    include: { cashMovement: { include: { session: { select: { closedAt: true } } } } },
  });
  if (!g) return { ok: false, error: 'Ese gasto no es de esta sucursal' };
  if (g.voidedAt) return { ok: false, error: 'Ese gasto ya estaba anulado' };

  const esPropioDeHoy = g.createdById === s.userId && claveDia(g.createdAt) === claveDia(new Date());
  if (!puede(s, 'gastos.anular') && !(puede(s, 'gastos.cargar') && esPropioDeHoy)) {
    return { ok: false, error: 'No tenés permiso para anular este gasto' };
  }
  if (!motivo?.trim()) return { ok: false, error: 'Contá por qué se anula' };

  let aviso: string | undefined;
  await db.$transaction(async (tx) => {
    await tx.expense.update({
      where: { id: g.id },
      data: { voidedAt: new Date(), voidedById: s.userId, voidReason: motivo.trim().slice(0, 200) },
    });
    // Si salió de una caja todavía abierta, se saca también de la caja.
    // Si esa caja ya se cerró, su arqueo queda como estaba: es historia.
    if (g.cashMovement) {
      if (!g.cashMovement.session.closedAt) {
        await tx.cashMovement.delete({ where: { id: g.cashMovement.id } });
      } else {
        aviso = 'Ese gasto salió de una caja ya cerrada: el cierre de ese turno no cambia.';
      }
    }
  });

  refrescar();
  return { ok: true, aviso };
}
