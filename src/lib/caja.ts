import { db } from './db';
import { aNumero } from './money';

/**
 * Resumen de un turno de caja: cuánto entró por cada forma de pago, qué se
 * sacó o se puso a mano, y cuánto efectivo tendría que haber en el cajón.
 *
 * Las ventas se cuentan por la fecha de cobro (paidAt), no por la del pedido:
 * un pedido que entró a las 23:50 y se cobró a las 00:10 es del turno en que
 * entró la plata.
 */
export async function resumenCaja(sessionId: string, hastaFijo?: Date) {
  const caja = await db.cashSession.findUniqueOrThrow({
    where: { id: sessionId },
    include: {
      movements: {
        orderBy: { createdAt: 'asc' },
        include: { user: { select: { name: true } }, expense: { select: { category: true, voidedAt: true } } },
      },
      openedBy: { select: { name: true } },
      closedBy: { select: { name: true } },
    },
  });
  const hasta = hastaFijo ?? caja.closedAt ?? new Date();
  const rango = { gte: caja.openedAt, lte: hasta };

  const [cobrados, anulados, sinCobrar, porRepartidor] = await Promise.all([
    db.order.groupBy({
      by: ['paymentMethod'],
      where: {
        branchId: caja.branchId,
        paymentStatus: 'COBRADO',
        paidAt: rango,
        status: { notIn: ['RECHAZADO', 'CANCELADO'] },
      },
      _sum: { total: true },
      _count: true,
    }),
    // Cobrados y después cancelados: la plata se devolvió (o hay que revisarlo)
    db.order.findMany({
      where: { branchId: caja.branchId, paymentStatus: 'COBRADO', paidAt: rango, status: 'CANCELADO' },
      select: { code: true, total: true, paymentMethod: true, cancelReason: true },
    }),
    // Entregados que todavía no figuran cobrados: típicamente transferencias
    // que nadie confirmó. Al cerrar la caja conviene revisarlos uno por uno.
    db.order.findMany({
      where: {
        branchId: caja.branchId,
        status: 'ENTREGADO',
        paymentStatus: 'PENDIENTE',
        deliveredAt: rango,
      },
      select: { id: true, code: true, total: true, paymentMethod: true, customerName: true },
    }),
    // Efectivo que trae cada repartidor: para la rendición al final de la noche
    db.order.groupBy({
      by: ['assignedToId'],
      where: {
        branchId: caja.branchId,
        type: 'DELIVERY',
        paymentMethod: 'EFECTIVO',
        paymentStatus: 'COBRADO',
        paidAt: rango,
        status: 'ENTREGADO',
        assignedToId: { not: null },
      },
      _sum: { total: true },
      _count: true,
    }),
  ]);

  const nombres = await db.user.findMany({
    where: { id: { in: porRepartidor.map((r) => r.assignedToId!).filter(Boolean) } },
    select: { id: true, name: true },
  });

  const ventas = Object.fromEntries(cobrados.map((c) => [c.paymentMethod, { total: c._sum.total ?? 0, pedidos: c._count }]));
  const efectivoVentas = ventas.EFECTIVO?.total ?? 0;
  const ingresos = caja.movements.filter((m) => m.type === 'INGRESO').reduce((s, m) => s + aNumero(m.amount), 0);
  const egresos = caja.movements.filter((m) => m.type === 'EGRESO').reduce((s, m) => s + aNumero(m.amount), 0);
  const esperado = aNumero(caja.openingAmount) + efectivoVentas + ingresos - egresos;

  return {
    // Los montos de la caja se pasan a number: un BigInt no viaja a la pantalla
    caja: {
      ...caja,
      openingAmount: aNumero(caja.openingAmount),
      countedAmount: caja.countedAmount == null ? null : aNumero(caja.countedAmount),
      expectedAmount: caja.expectedAmount == null ? null : aNumero(caja.expectedAmount),
      movements: caja.movements.map((m) => ({ ...m, amount: aNumero(m.amount) })),
    },
    ventas,
    totalVentas: cobrados.reduce((s, c) => s + (c._sum.total ?? 0), 0),
    pedidosCobrados: cobrados.reduce((s, c) => s + c._count, 0),
    ingresos,
    egresos,
    esperado,
    anulados,
    sinCobrar,
    repartidores: porRepartidor.map((r) => ({
      nombre: nombres.find((n) => n.id === r.assignedToId)?.name ?? 'Sin nombre',
      total: r._sum.total ?? 0,
      pedidos: r._count,
    })),
  };
}

export type ResumenCaja = Awaited<ReturnType<typeof resumenCaja>>;
