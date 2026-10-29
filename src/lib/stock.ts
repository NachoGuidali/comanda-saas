import type { Prisma } from '@prisma/client';
import { devolverInsumos } from './recetas';

/**
 * Devuelve al stock lo que tenía un pedido que se rechazó, se canceló o venció
 * sin pagarse. Va dentro de la transacción que cierra el pedido, así nunca
 * vuelve dos veces. También devuelve los insumos que se descontaron por receta.
 */
export async function devolverStock(tx: Prisma.TransactionClient, orderId: string, code: string, razon: string) {
  const items = await tx.orderItem.findMany({
    where: { orderId, productId: { not: null } },
    include: { product: { select: { trackStock: true } } },
  });
  for (const it of items) {
    if (!it.productId || !it.product?.trackStock) continue;

    if (it.variantId) {
      const v = await tx.variant.update({
        where: { id: it.variantId },
        data: { stock: { increment: it.quantity } },
        select: { stock: true },
      }).catch(() => null);
      if (!v) continue;
      await tx.stockMovement.create({
        data: {
          productId: it.productId, variantId: it.variantId, type: 'DEVOLUCION', quantity: it.quantity,
          before: v.stock - it.quantity, after: v.stock, orderCode: code, reason: razon,
        },
      });
    } else {
      const p = await tx.product.update({
        where: { id: it.productId },
        data: { stock: { increment: it.quantity } },
        select: { stock: true },
      });
      await tx.stockMovement.create({
        data: {
          productId: it.productId, type: 'DEVOLUCION', quantity: it.quantity,
          before: p.stock - it.quantity, after: p.stock, orderCode: code, reason: razon,
        },
      });
    }
  }
  await devolverInsumos(tx, code, razon);
}
