import { db } from './db';
import type { OrderType, OrderSource } from '@prisma/client';
import { claveDia } from './tiempo';

/**
 * Todos los reportes salen de la misma tabla de pedidos entregados.
 * Cualquier corte nuevo que pidan mañana se agrega acá sin tocar el resto.
 */

export type Filtro = {
  /// Todos los reportes son de una sucursal: los números de dos locales
  /// mezclados no le sirven a nadie para tomar decisiones.
  branchId: string;
  desde: Date;
  hasta: Date;
  tipo?: OrderType | 'TODOS';
  canal?: OrderSource | 'TODOS';
  /// Contar solo lo entregado (plata real) o también lo que está en curso
  soloEntregados?: boolean;
};

export function rangoPreset(preset: string): { desde: Date; hasta: Date } {
  const hasta = new Date();
  const desde = new Date();
  desde.setHours(0, 0, 0, 0);

  switch (preset) {
    case 'hoy':
      break;
    case 'ayer':
      desde.setDate(desde.getDate() - 1);
      hasta.setDate(hasta.getDate() - 1);
      hasta.setHours(23, 59, 59, 999);
      break;
    case '7dias':
      desde.setDate(desde.getDate() - 6);
      break;
    case '30dias':
      desde.setDate(desde.getDate() - 29);
      break;
    case 'mes':
      desde.setDate(1);
      break;
    case 'anio':
      desde.setMonth(0, 1);
      break;
    default:
      desde.setDate(desde.getDate() - 6);
  }
  return { desde, hasta };
}

function where(f: Filtro) {
  return {
    branchId: f.branchId,
    createdAt: { gte: f.desde, lte: f.hasta },
    ...(f.soloEntregados !== false ? { status: 'ENTREGADO' as const } : { status: { not: 'CANCELADO' as const } }),
    ...(f.tipo && f.tipo !== 'TODOS' ? { type: f.tipo } : {}),
    ...(f.canal && f.canal !== 'TODOS' ? { source: f.canal } : {}),
  };
}

export async function resumen(f: Filtro) {
  const [agg, cancelados] = await Promise.all([
    db.order.aggregate({
      where: where(f),
      _sum: { total: true, subtotal: true, deliveryFee: true, discount: true },
      _count: true,
      _avg: { total: true },
    }),
    // Un pedido online que nunca se pagó no es una cancelación del local:
    // se cuenta aparte para no confundir un problema de cocina con uno de pago
    db.order.count({
      where: {
        branchId: f.branchId,
        createdAt: { gte: f.desde, lte: f.hasta },
        status: { in: ['CANCELADO', 'RECHAZADO'] },
        NOT: { pagoOnline: true, status: 'RECHAZADO', paymentStatus: 'PENDIENTE' },
      },
    }),
  ]);
  const sinPagar = await db.order.count({
    where: {
      branchId: f.branchId, createdAt: { gte: f.desde, lte: f.hasta },
      pagoOnline: true, status: 'RECHAZADO', paymentStatus: 'PENDIENTE',
    },
  });

  return {
    ingresos: agg._sum.total ?? 0,
    subtotal: agg._sum.subtotal ?? 0,
    envios: agg._sum.deliveryFee ?? 0,
    descuentos: agg._sum.discount ?? 0,
    pedidos: agg._count,
    ticketPromedio: Math.round(agg._avg.total ?? 0),
    cancelados,
    pagoOnlineNoCompletado: sinPagar,
  };
}

/** Ranking de productos. Cuenta unidades reales, no líneas de pedido. */
export async function masVendidos(f: Filtro, limite = 15) {
  const items = await db.orderItem.findMany({
    where: { order: where(f) },
    select: { name: true, variantName: true, quantity: true, total: true, productId: true },
  });

  const mapa = new Map<string, { name: string; unidades: number; facturado: number; productId: string | null }>();
  for (const it of items) {
    const clave = it.productId ?? it.name;
    const actual = mapa.get(clave) ?? { name: it.name, unidades: 0, facturado: 0, productId: it.productId };
    actual.unidades += it.quantity;
    actual.facturado += it.total;
    mapa.set(clave, actual);
  }

  return [...mapa.values()].sort((a, b) => b.unidades - a.unidades).slice(0, limite);
}

/** Serie temporal por día para graficar la evolución. */
export async function porDia(f: Filtro) {
  const ordenes = await db.order.findMany({
    where: where(f),
    select: { createdAt: true, total: true },
    orderBy: { createdAt: 'asc' },
  });

  const mapa = new Map<string, { fecha: string; ingresos: number; pedidos: number }>();

  // Pre-cargamos todos los días del rango para que el gráfico no tenga huecos
  const cursor = new Date(f.desde);
  cursor.setHours(0, 0, 0, 0);
  while (cursor <= f.hasta) {
    const k = claveDia(cursor);
    mapa.set(k, { fecha: k, ingresos: 0, pedidos: 0 });
    cursor.setDate(cursor.getDate() + 1);
  }

  for (const o of ordenes) {
    const k = claveDia(o.createdAt);
    const d = mapa.get(k) ?? { fecha: k, ingresos: 0, pedidos: 0 };
    d.ingresos += o.total;
    d.pedidos += 1;
    mapa.set(k, d);
  }

  return [...mapa.values()].sort((a, b) => a.fecha.localeCompare(b.fecha));
}

/** A qué hora entran los pedidos. Sirve para decidir cuánta gente poner. */
export async function porHora(f: Filtro) {
  const ordenes = await db.order.findMany({ where: where(f), select: { createdAt: true, total: true } });
  const horas = Array.from({ length: 24 }, (_, h) => ({ hora: h, pedidos: 0, ingresos: 0 }));
  for (const o of ordenes) {
    const h = o.createdAt.getHours();
    horas[h].pedidos += 1;
    horas[h].ingresos += o.total;
  }
  // Ordenadas como un día de trabajo, que arranca a la mañana y termina de
  // madrugada: así el pico de las 21 a la 1 queda junto y no partido en dos.
  const INICIO_JORNADA = 6;
  return horas
    .filter((h) => h.pedidos > 0 || (h.hora >= 11 && h.hora <= 23))
    .sort((a, b) => ((a.hora - INICIO_JORNADA + 24) % 24) - ((b.hora - INICIO_JORNADA + 24) % 24));
}

export async function porCanalYTipo(f: Filtro) {
  const base = { branchId: f.branchId, createdAt: { gte: f.desde, lte: f.hasta }, status: 'ENTREGADO' as const };
  const [porTipo, porCanal, porPago] = await Promise.all([
    db.order.groupBy({ by: ['type'], where: base, _count: true, _sum: { total: true } }),
    db.order.groupBy({ by: ['source'], where: base, _count: true, _sum: { total: true } }),
    db.order.groupBy({ by: ['paymentMethod'], where: base, _count: true, _sum: { total: true } }),
  ]);
  return { porTipo, porCanal, porPago };
}

/** Cuánto tarda la cocina y cuánto tarda el reparto, en minutos. */
export async function tiemposOperativos(f: Filtro) {
  const ordenes = await db.order.findMany({
    where: { branchId: f.branchId, createdAt: { gte: f.desde, lte: f.hasta }, status: 'ENTREGADO', acceptedAt: { not: null } },
    select: { createdAt: true, acceptedAt: true, readyAt: true, dispatchedAt: true, deliveredAt: true, type: true },
  });

  const min = (a: Date | null, b: Date | null) =>
    a && b ? Math.max(0, (b.getTime() - a.getTime()) / 60000) : null;

  const acum = { aceptacion: [] as number[], cocina: [] as number[], reparto: [] as number[], total: [] as number[] };
  for (const o of ordenes) {
    const a = min(o.createdAt, o.acceptedAt);
    const c = min(o.acceptedAt, o.readyAt);
    const r = min(o.dispatchedAt, o.deliveredAt);
    const t = min(o.createdAt, o.deliveredAt);
    if (a !== null) acum.aceptacion.push(a);
    if (c !== null) acum.cocina.push(c);
    if (r !== null) acum.reparto.push(r);
    if (t !== null) acum.total.push(t);
  }

  const prom = (xs: number[]) => (xs.length ? Math.round(xs.reduce((s, x) => s + x, 0) / xs.length) : 0);
  return {
    aceptacion: prom(acum.aceptacion),
    cocina: prom(acum.cocina),
    reparto: prom(acum.reparto),
    total: prom(acum.total),
    muestras: ordenes.length,
  };
}

/**
 * Mermas del período, en unidades. No se valorizan en plata: el sistema no
 * conoce el costo de los productos, y valuarlas al precio de venta exageraba
 * la pérdida (una gaseosa rota no cuesta lo que se cobra por ella).
 */
export async function mermas(f: Filtro) {
  const movs = await db.stockMovement.findMany({
    where: { product: { branchId: f.branchId }, createdAt: { gte: f.desde, lte: f.hasta }, type: 'MERMA' },
    select: { quantity: true },
  });
  return { unidades: movs.reduce((s, m) => s + Math.abs(m.quantity), 0), registros: movs.length };
}

export async function stockCritico(branchId: string) {
  const productos = await db.product.findMany({
    where: { branchId, trackStock: true, active: true },
    include: { variants: { where: { active: true } } },
    orderBy: { stock: 'asc' },
  });

  return productos.filter((p) =>
    p.variants.length
      ? p.variants.some((v) => v.stock <= p.lowStock)
      : p.stock <= p.lowStock
  );
}

export async function clientesRecurrentes(f: Filtro, limite = 20) {
  const ordenes = await db.order.findMany({
    where: where(f),
    select: { customerPhone: true, customerName: true, total: true, createdAt: true },
  });

  const mapa = new Map<string, { telefono: string; nombre: string; pedidos: number; gastado: number; ultimo: Date }>();
  for (const o of ordenes) {
    const c = mapa.get(o.customerPhone) ?? {
      telefono: o.customerPhone, nombre: o.customerName, pedidos: 0, gastado: 0, ultimo: o.createdAt,
    };
    c.pedidos += 1;
    c.gastado += o.total;
    if (o.createdAt > c.ultimo) { c.ultimo = o.createdAt; c.nombre = o.customerName; }
    mapa.set(o.customerPhone, c);
  }

  return [...mapa.values()].sort((a, b) => b.gastado - a.gastado).slice(0, limite);
}
