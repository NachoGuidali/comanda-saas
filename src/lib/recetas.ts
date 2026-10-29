import type { Prisma } from '@prisma/client';

/**
 * Descuento automático de insumos por receta.
 *
 * Con cada venta se suma lo que usa cada línea: la receta del producto (la de
 * su tamaño, si tiene) más la de cada extra o gusto elegido, por la cantidad.
 * Una muzza grande con doble muzzarella = 400 g + 150 g de muzzarella.
 *
 * Nunca frena una venta: si un insumo queda negativo, es que la receta o el
 * conteo no coinciden con la realidad, y eso se corrige con el conteo. El
 * pedido entra igual.
 */

export type LineaConsumo = {
  productId: string;
  variantId: string | null;
  addonIds: string[];
  quantity: number;
};

/** Cuánto de cada insumo usan estas líneas, en milésimas. */
export async function consumoDeLineas(tx: Prisma.TransactionClient, lineas: LineaConsumo[]): Promise<Map<string, number>> {
  const consumo = new Map<string, number>();
  if (lineas.length === 0) return consumo;

  const productIds = [...new Set(lineas.map((l) => l.productId))];
  const addonIds = [...new Set(lineas.flatMap((l) => l.addonIds))];
  const items = await tx.recipeItem.findMany({
    where: {
      OR: [
        { productId: { in: productIds } },
        ...(addonIds.length ? [{ addonOptionId: { in: addonIds } }] : []),
      ],
    },
    select: { productId: true, variantId: true, addonOptionId: true, supplyId: true, quantity: true },
  });
  if (items.length === 0) return consumo;

  const sumar = (supplyId: string, cantidad: number) => consumo.set(supplyId, (consumo.get(supplyId) ?? 0) + cantidad);

  for (const l of lineas) {
    for (const it of items) {
      // La del producto: sin tamaño (vale para el producto sin tamaños) o la de su tamaño
      if (it.productId === l.productId && (it.variantId === null || it.variantId === l.variantId)) {
        sumar(it.supplyId, it.quantity * l.quantity);
      }
      if (it.addonOptionId && l.addonIds.includes(it.addonOptionId)) {
        sumar(it.supplyId, it.quantity * l.quantity);
      }
    }
  }
  return consumo;
}

/**
 * Descuenta lo consumido y deja un movimiento por insumo.
 * `tipo` CONSUMO para una venta; MERMA para algo que se preparó y se perdió.
 */
export async function descontarInsumos(
  tx: Prisma.TransactionClient,
  consumo: Map<string, number>,
  datos: { tipo: 'CONSUMO' | 'MERMA'; orderCode?: string | null; reason?: string | null; lossType?: string | null; userId?: string | null }
) {
  for (const [supplyId, cantidad] of consumo) {
    if (cantidad <= 0) continue;
    const s = await tx.supply.update({
      where: { id: supplyId },
      data: { stock: { decrement: cantidad } },
      select: { stock: true },
    });
    await tx.supplyMovement.create({
      data: {
        supplyId, type: datos.tipo, quantity: -cantidad,
        before: s.stock + cantidad, after: s.stock,
        orderCode: datos.orderCode ?? null, reason: datos.reason ?? null,
        lossType: datos.lossType ?? null, userId: datos.userId ?? null,
      },
    });
  }
}

/**
 * Devuelve los insumos de un pedido rechazado o cancelado. Se basa en lo que
 * se descontó de verdad (los movimientos con su código), no en la receta de
 * hoy, que pudo haber cambiado. Si ya se devolvió, no hace nada.
 */
export async function devolverInsumos(tx: Prisma.TransactionClient, orderCode: string, razon: string) {
  const movimientos = await tx.supplyMovement.groupBy({
    by: ['supplyId'],
    where: { orderCode, type: { in: ['CONSUMO', 'DEVOLUCION'] } },
    _sum: { quantity: true },
  });
  for (const m of movimientos) {
    const pendiente = -(m._sum.quantity ?? 0);
    if (pendiente <= 0) continue;
    const s = await tx.supply.update({
      where: { id: m.supplyId },
      data: { stock: { increment: pendiente } },
      select: { stock: true },
    });
    await tx.supplyMovement.create({
      data: {
        supplyId: m.supplyId, type: 'DEVOLUCION', quantity: pendiente,
        before: s.stock - pendiente, after: s.stock, orderCode, reason: razon,
      },
    });
  }
}
