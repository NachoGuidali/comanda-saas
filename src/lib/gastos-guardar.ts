import type { ExpensePayment, Prisma } from '@prisma/client';
import { ETIQUETA_CATEGORIA, diaParaGuardar } from './gastos';

/**
 * Guarda un gasto ya validado, dentro de una transacción. Lo usan la carga de
 * gastos y la entrada de insumos con lo que se pagó.
 *
 * Si se pagó con el efectivo de la caja y hay un turno abierto, además sale
 * como egreso de la caja. Devuelve el gasto y, si no había caja abierta, un
 * aviso para mostrar.
 */
export async function guardarGasto(
  tx: Prisma.TransactionClient,
  datos: {
    branchId: string; userId: string; fecha: string; category: string; description: string;
    supplier: string | null; amount: number; payment: ExpensePayment;
    /** Solo en sueldos */
    staffId?: string; payKind?: string; period?: string;
  }
): Promise<{ id: string; aviso?: string }> {
  let cashMovementId: string | null = null;
  let aviso: string | undefined;

  if (datos.payment === 'EFECTIVO_CAJA') {
    const caja = await tx.cashSession.findFirst({ where: { branchId: datos.branchId, closedAt: null } });
    if (caja) {
      const mov = await tx.cashMovement.create({
        data: {
          sessionId: caja.id,
          type: 'EGRESO',
          amount: datos.amount,
          reason: `${ETIQUETA_CATEGORIA[datos.category]}: ${datos.description}`.slice(0, 200),
          userId: datos.userId,
        },
      });
      cashMovementId = mov.id;
    } else {
      aviso = 'No había una caja abierta, así que no se descontó de ningún turno. El gasto quedó registrado igual.';
    }
  }

  const g = await tx.expense.create({
    data: {
      branchId: datos.branchId,
      date: diaParaGuardar(datos.fecha),
      category: datos.category,
      description: datos.description,
      supplier: datos.supplier,
      amount: datos.amount,
      payment: datos.payment,
      createdById: datos.userId,
      cashMovementId,
      staffId: datos.staffId ?? null,
      payKind: datos.payKind ?? null,
      period: datos.period ?? null,
    },
    select: { id: true },
  });
  return { id: g.id, aviso };
}
