import type { Prisma } from '@prisma/client';
import { db } from './db';
import { aNumero } from './money';
import { claveDia } from './tiempo';
import { diaParaGuardar } from './gastos-fechas';
import { TIPOS_MERMA, tipoDeMerma } from './mermas';

/**
 * Los números de plata del local, todos con la misma definición:
 *
 *   Entró        Lo cobrado en el período, por fecha de cobro. No cuenta lo
 *                que se canceló o se devolvió. Es la plata que efectivamente
 *                entró, no lo que se vendió y todavía se debe.
 *   Gastos       Lo cargado en Gastos con fecha en el período, sin anulados.
 *   Diferencias  Faltantes y sobrantes de los cierres de caja del período.
 *   Resultado    Entró − gastos + diferencias de caja.
 *
 * Finanzas, Gastos y Reportes usan estas mismas funciones, así los números
 * de una pantalla y otra cierran.
 */

/** Pedidos cobrados en el período. Los anteriores a guardar la fecha de cobro usan la de entrega. */
export function cobradosEn(branchId: string, desde: Date, hasta: Date): Prisma.OrderWhereInput {
  return {
    branchId,
    paymentStatus: 'COBRADO',
    status: { notIn: ['CANCELADO', 'RECHAZADO'] },
    OR: [
      { paidAt: { gte: desde, lt: hasta } },
      { paidAt: null, deliveredAt: { gte: desde, lt: hasta } },
    ],
  };
}

/** Rango de días de calendario que cubre [desde, hasta), para comparar con las fechas de gasto. */
export function diasDelRango(desde: Date, hasta: Date) {
  const ultimoDia = new Date(hasta.getTime() - 1);
  return {
    gte: diaParaGuardar(claveDia(desde)),
    lt: new Date(diaParaGuardar(claveDia(ultimoDia)).getTime() + 24 * 60 * 60_000),
  };
}

/** Lo esencial: entró, gastos, diferencias de caja y resultado. */
export async function resultadoDelPeriodo(branchId: string, desde: Date, hasta: Date) {
  const dias = diasDelRango(desde, hasta);
  const [entro, gastos, porCategoria, cierres] = await Promise.all([
    db.order.aggregate({ where: cobradosEn(branchId, desde, hasta), _sum: { total: true }, _count: true }),
    db.expense.aggregate({ where: { branchId, voidedAt: null, date: dias }, _sum: { amount: true }, _count: true }),
    db.expense.groupBy({
      by: ['category'],
      where: { branchId, voidedAt: null, date: dias },
      _sum: { amount: true },
      _count: true,
    }),
    db.cashSession.findMany({
      where: { branchId, closedAt: { gte: desde, lt: hasta } },
      select: { countedAmount: true, expectedAmount: true },
    }),
  ]);

  const totalEntro = entro._sum.total ?? 0;
  const totalGastos = aNumero(gastos._sum.amount);
  const diferenciasCaja = cierres.reduce((s, c) => s + aNumero(c.countedAmount) - aNumero(c.expectedAmount), 0);
  const resultado = totalEntro - totalGastos + diferenciasCaja;

  return {
    /** Lo cobrado en el período (se llama "ventas" por compatibilidad con las pantallas) */
    ventas: totalEntro,
    pedidos: entro._count,
    gastos: totalGastos,
    cantidadGastos: gastos._count,
    diferenciasCaja,
    cierresDeCaja: cierres.length,
    resultado,
    /** Qué parte de lo que entró queda como resultado, en porcentaje */
    margen: totalEntro > 0 ? Math.round((resultado / totalEntro) * 1000) / 10 : null,
    porCategoria: porCategoria
      .map((c) => ({ categoria: c.category, total: aNumero(c._sum.amount), cantidad: c._count }))
      .sort((a, b) => b.total - a.total),
  };
}

export type ResultadoPeriodo = Awaited<ReturnType<typeof resultadoDelPeriodo>>;

/** Todo lo que muestra el tablero de Finanzas para un período. */
export async function tableroFinanzas(branchId: string, desde: Date, hasta: Date) {
  const cobrados = cobradosEn(branchId, desde, hasta);
  const dias = diasDelRango(desde, hasta);

  const [resultado, porMedio, porTipo, porCanal, pedidosCobrados, items, gastos, pendientes, devueltos, mermas, cancelados] =
    await Promise.all([
      resultadoDelPeriodo(branchId, desde, hasta),
      db.order.groupBy({ by: ['paymentMethod'], where: cobrados, _sum: { total: true }, _count: true }),
      db.order.groupBy({ by: ['type'], where: cobrados, _sum: { total: true }, _count: true }),
      db.order.groupBy({ by: ['source'], where: cobrados, _sum: { total: true }, _count: true }),
      db.order.findMany({
        where: cobrados,
        select: { total: true, discount: true, deliveryFee: true, paidAt: true, deliveredAt: true },
      }),
      db.orderItem.findMany({
        where: { order: cobrados },
        select: {
          name: true, variantName: true, quantity: true, total: true, productId: true,
          product: { select: { category: { select: { name: true } } } },
        },
      }),
      db.expense.findMany({
        where: { branchId, voidedAt: null, date: dias },
        select: { date: true, amount: true, supplier: true, staff: { select: { name: true } } },
      }),
      // Entregados que todavía no figuran cobrados: plata en la calle
      db.order.aggregate({
        where: { branchId, status: 'ENTREGADO', paymentStatus: 'PENDIENTE', deliveredAt: { gte: desde, lt: hasta } },
        _sum: { total: true },
        _count: true,
      }),
      // Cobrados y después cancelados: se devolvió la plata
      db.order.aggregate({
        where: { branchId, paymentStatus: 'COBRADO', status: 'CANCELADO', closedAt: { gte: desde, lt: hasta } },
        _sum: { total: true },
        _count: true,
      }),
      db.stockMovement.findMany({
        where: { product: { branchId }, type: 'MERMA', createdAt: { gte: desde, lt: hasta } },
        select: { quantity: true, lossType: true, product: { select: { name: true } }, variant: { select: { name: true } } },
      }),
      db.order.groupBy({
        by: ['status', 'pagoOnline', 'paymentStatus'],
        where: { branchId, status: { in: ['CANCELADO', 'RECHAZADO'] }, closedAt: { gte: desde, lt: hasta } },
        _count: true,
      }),
    ]);

  // Entró y gastó, día por día
  const porDia = new Map<string, { fecha: string; entro: number; gasto: number }>();
  const cursor = new Date(desde);
  cursor.setHours(0, 0, 0, 0);
  while (cursor < hasta) {
    const k = claveDia(cursor);
    porDia.set(k, { fecha: k, entro: 0, gasto: 0 });
    cursor.setDate(cursor.getDate() + 1);
  }
  for (const p of pedidosCobrados) {
    const cuando = p.paidAt ?? p.deliveredAt;
    if (!cuando) continue;
    const d = porDia.get(claveDia(cuando));
    if (d) d.entro += p.total;
  }
  for (const g of gastos) {
    const d = porDia.get(g.date.toISOString().slice(0, 10));
    if (d) d.gasto += aNumero(g.amount);
  }

  // Lo más vendido. "Facturado" es a precio de carta: los códigos de
  // descuento son por pedido, no por producto, y no se reparten.
  const productos = new Map<string, { nombre: string; unidades: number; facturado: number }>();
  const categorias = new Map<string, { nombre: string; unidades: number; facturado: number }>();
  for (const it of items) {
    const nombre = `${it.name}${it.variantName ? ` · ${it.variantName}` : ''}`;
    const p = productos.get(nombre) ?? { nombre, unidades: 0, facturado: 0 };
    p.unidades += it.quantity;
    p.facturado += it.total;
    productos.set(nombre, p);
    const cat = it.product?.category.name ?? 'Sin categoría';
    const c = categorias.get(cat) ?? { nombre: cat, unidades: 0, facturado: 0 };
    c.unidades += it.quantity;
    c.facturado += it.total;
    categorias.set(cat, c);
  }

  const proveedores = new Map<string, number>();
  for (const g of gastos) {
    if (!g.supplier) continue;
    proveedores.set(g.supplier, (proveedores.get(g.supplier) ?? 0) + aNumero(g.amount));
  }

  // Sueldos por persona, por fecha de pago (lo que salió en el período)
  const sueldos = new Map<string, number>();
  for (const g of gastos) {
    if (!g.staff) continue;
    sueldos.set(g.staff.name, (sueldos.get(g.staff.name) ?? 0) + aNumero(g.amount));
  }

  const perdidas = new Map<string, number>();
  const perdidasPorTipo = new Map<string, number>();
  for (const m of mermas) {
    const nombre = `${m.product?.name ?? '?'}${m.variant ? ` · ${m.variant.name}` : ''}`;
    perdidas.set(nombre, (perdidas.get(nombre) ?? 0) + Math.abs(m.quantity));
    const tipo = tipoDeMerma(m.lossType);
    perdidasPorTipo.set(tipo, (perdidasPorTipo.get(tipo) ?? 0) + Math.abs(m.quantity));
  }

  const contar = (f: (c: (typeof cancelados)[number]) => boolean) =>
    cancelados.filter(f).reduce((s, c) => s + c._count, 0);

  return {
    ...resultado,
    ticketPromedio: resultado.pedidos > 0 ? Math.round(resultado.ventas / resultado.pedidos) : 0,
    descuentos: pedidosCobrados.reduce((s, p) => s + p.discount, 0),
    envios: pedidosCobrados.reduce((s, p) => s + p.deliveryFee, 0),
    porMedio: porMedio
      .map((m) => ({ medio: m.paymentMethod as string, total: m._sum.total ?? 0, pedidos: m._count }))
      .sort((a, b) => b.total - a.total),
    porTipo: porTipo.map((t) => ({ tipo: t.type as string, total: t._sum.total ?? 0, pedidos: t._count })),
    porCanal: porCanal.map((c) => ({ canal: c.source as string, total: c._sum.total ?? 0, pedidos: c._count })),
    porDia: [...porDia.values()],
    productos: [...productos.values()].sort((a, b) => b.unidades - a.unidades),
    categorias: [...categorias.values()].sort((a, b) => b.facturado - a.facturado),
    sueldos: [...sueldos.entries()].map(([nombre, total]) => ({ nombre, total })).sort((a, b) => b.total - a.total),
    proveedores: [...proveedores.entries()].map(([nombre, total]) => ({ nombre, total })).sort((a, b) => b.total - a.total),
    pendienteDeCobro: { total: pendientes._sum.total ?? 0, pedidos: pendientes._count },
    devuelto: { total: devueltos._sum.total ?? 0, pedidos: devueltos._count },
    mermas: [...perdidas.entries()].map(([nombre, unidades]) => ({ nombre, unidades })).sort((a, b) => b.unidades - a.unidades),
    /** Mermas por tipo (se rompió, salió mal, regalo...), en el orden de la lista de tipos */
    mermasPorTipo: TIPOS_MERMA
      .map((t) => ({ tipo: t.id as string, label: t.label as string, unidades: perdidasPorTipo.get(t.id) ?? 0 }))
      .filter((t) => t.unidades > 0),
    bajas: {
      rechazados: contar((c) => c.status === 'RECHAZADO' && !(c.pagoOnline && c.paymentStatus === 'PENDIENTE')),
      cancelados: contar((c) => c.status === 'CANCELADO'),
      pagoOnlineNoCompletado: contar((c) => c.status === 'RECHAZADO' && c.pagoOnline && c.paymentStatus === 'PENDIENTE'),
    },
  };
}

export type TableroFinanzas = Awaited<ReturnType<typeof tableroFinanzas>>;
