import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getApiSession, puede } from '@/lib/session';
import { aNumero } from '@/lib/money';
import { fechaHora, claveDia } from '@/lib/tiempo';
import { leerPeriodo } from '@/lib/periodo';
import { cobradosEn, diasDelRango } from '@/lib/finanzas';
import { ETIQUETA_CATEGORIA, ETIQUETA_PAGO_GASTO } from '@/lib/gastos-categorias';
import { ETIQUETA_PAGO } from '@/lib/etiquetas';
import { ETIQUETA_TIPO_MERMA, tipoDeMerma } from '@/lib/mermas';
import { UNIDADES, type Unidad } from '@/lib/insumos';
import { ETIQUETA_PAGO_SUELDO } from '@/lib/sueldos';

export const dynamic = 'force-dynamic';

const TIPO: Record<string, string> = { DELIVERY: 'Envío', TAKEAWAY: 'Retiro', SALON: 'Salón' };
const CANAL: Record<string, string> = { WEB: 'Carta web', WHATSAPP: 'WhatsApp', MOSTRADOR: 'Mostrador' };

/** Plata en formato argentino para Excel: 1234,50 */
const pesos = (centavos: number) => (centavos / 100).toFixed(2).replace('.', ',');
const dia = (f: Date) => fechaHora(f, { day: '2-digit', month: '2-digit', year: 'numeric' });
const hora = (f: Date) => fechaHora(f, { hour: '2-digit', minute: '2-digit' });

function csv(filas: (string | number)[][], nombre: string) {
  const texto = filas.map((f) => f.map((c) => `"${String(c ?? '').replace(/"/g, '""')}"`).join(';')).join('\r\n');
  // El BOM hace que Excel abra bien los acentos; el punto y coma, que separe columnas en configuración argentina
  return new NextResponse('﻿' + texto, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${nombre}.csv"`,
      'Cache-Control': 'no-store',
    },
  });
}

/**
 * Descargas de Finanzas, para el contador o una planilla:
 *
 *   libro      Cada cobro y cada gasto en orden, con el saldo. Suma el resultado.
 *   cobros     Los pedidos cobrados, con quién cobró y cómo
 *   gastos     Los gastos, incluidos los anulados (marcados)
 *   productos  Lo vendido por producto
 *   mermas     Lo que se perdió, en unidades
 */
export async function GET(req: Request) {
  const s = await getApiSession();
  if (!s) return NextResponse.json({ error: 'Sin sesión' }, { status: 401 });

  const url = new URL(req.url);
  const tipo = url.searchParams.get('tipo') ?? 'libro';
  const p = leerPeriodo({ desde: url.searchParams.get('desde'), hasta: url.searchParams.get('hasta') });
  // Gastos y mermas los bajan también quienes los cargan (la caja); el resto, el dueño
  const permitido =
    tipo === 'gastos' ? puede(s, 'gastos.ver', 'reportes.ver')
    : tipo === 'mermas' ? puede(s, 'stock.ver', 'reportes.ver')
    : puede(s, 'reportes.ver');
  if (!permitido) return NextResponse.json({ error: 'Sin permiso' }, { status: 403 });

  const sufijo = `${s.branchName.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-')}-${p.desdeTexto}-a-${p.hastaTexto}`;

  if (tipo === 'cobros') {
    const pedidos = await db.order.findMany({
      where: cobradosEn(s.branchId, p.desde, p.hasta),
      orderBy: { paidAt: 'asc' },
      include: { paidBy: { select: { name: true } } },
    });
    return csv([
      ['Fecha', 'Hora', 'Pedido', 'Tipo', 'Canal', 'Cliente', 'Forma de pago', 'Había elegido', 'Subtotal', 'Envío', 'Descuento', 'Total', 'Código de descuento', 'Cobró'],
      ...pedidos.map((o) => {
        const cuando = o.paidAt ?? o.deliveredAt ?? o.createdAt;
        return [
          dia(cuando), hora(cuando), o.code, TIPO[o.type] ?? o.type, CANAL[o.source] ?? o.source, o.customerName,
          ETIQUETA_PAGO[o.paymentMethod] ?? o.paymentMethod, o.metodoOriginal ? ETIQUETA_PAGO[o.metodoOriginal] : '',
          pesos(o.subtotal), pesos(o.deliveryFee), pesos(o.discount), pesos(o.total), o.promoCode ?? '',
          o.paidBy?.name ?? (o.pagoOnline ? 'Pago online' : ''),
        ];
      }),
    ], `cobros-${sufijo}`);
  }

  if (tipo === 'gastos') {
    const gastos = await db.expense.findMany({
      // Lo que cobra cada uno es privado: sin permiso de sueldos, esos pagos no bajan
      where: { branchId: s.branchId, date: diasDelRango(p.desde, p.hasta), ...(puede(s, 'sueldos.ver') ? {} : { staffId: null }) },
      orderBy: [{ date: 'asc' }, { createdAt: 'asc' }],
      include: { createdBy: { select: { name: true } }, voidedBy: { select: { name: true } }, staff: { select: { name: true } } },
    });
    return csv([
      ['Fecha', 'Categoría', 'Descripción', 'Proveedor', 'Empleado', 'Concepto', 'Mes del sueldo', 'Forma de pago', 'Monto', 'Cargó', 'Cargado el', 'Anulado', 'Anuló', 'Motivo de anulación'],
      ...gastos.map((g) => [
        g.date.toISOString().slice(0, 10).split('-').reverse().join('/'),
        ETIQUETA_CATEGORIA[g.category] ?? g.category, g.description, g.supplier ?? '',
        g.staff?.name ?? '', g.payKind ? ETIQUETA_PAGO_SUELDO[g.payKind] ?? g.payKind : '', g.period ? g.period.split('-').reverse().join('/') : '',
        ETIQUETA_PAGO_GASTO[g.payment] ?? g.payment, pesos(aNumero(g.amount)),
        g.createdBy.name, fechaHora(g.createdAt, { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }),
        g.voidedAt ? 'Sí' : 'No', g.voidedBy?.name ?? '', g.voidReason ?? '',
      ]),
    ], `gastos-${sufijo}`);
  }

  if (tipo === 'productos') {
    const items = await db.orderItem.findMany({
      where: { order: cobradosEn(s.branchId, p.desde, p.hasta) },
      select: { name: true, variantName: true, quantity: true, total: true, product: { select: { category: { select: { name: true } } } } },
    });
    const mapa = new Map<string, { categoria: string; unidades: number; facturado: number }>();
    for (const it of items) {
      const k = `${it.name}${it.variantName ? ` · ${it.variantName}` : ''}`;
      const v = mapa.get(k) ?? { categoria: it.product?.category.name ?? '', unidades: 0, facturado: 0 };
      v.unidades += it.quantity;
      v.facturado += it.total;
      mapa.set(k, v);
    }
    return csv([
      ['Producto', 'Categoría', 'Unidades', 'Facturado (precio de carta)'],
      ...[...mapa.entries()].sort((a, b) => b[1].unidades - a[1].unidades).map(([k, v]) => [k, v.categoria, v.unidades, pesos(v.facturado)]),
    ], `ventas-por-producto-${sufijo}`);
  }

  if (tipo === 'mermas') {
    const [movs, deInsumos] = await Promise.all([
      db.stockMovement.findMany({
        where: { product: { branchId: s.branchId }, type: 'MERMA', createdAt: { gte: p.desde, lt: p.hasta } },
        include: { product: { select: { name: true } }, variant: { select: { name: true } }, user: { select: { name: true } } },
      }),
      db.supplyMovement.findMany({
        where: { supply: { branchId: s.branchId }, type: 'MERMA', createdAt: { gte: p.desde, lt: p.hasta } },
        include: { supply: { select: { name: true, unit: true } }, user: { select: { name: true } } },
      }),
    ]);
    // Productos en unidades; insumos en su unidad (kg, l, u), con decimales
    const filas = [
      ...movs.map((m) => ({
        cuando: m.createdAt, nombre: `${m.product.name}${m.variant ? ` · ${m.variant.name}` : ''}`,
        cantidad: String(Math.abs(m.quantity)), unidad: 'u', lossType: m.lossType, reason: m.reason, orderCode: m.orderCode, user: m.user,
      })),
      ...deInsumos.map((m) => ({
        cuando: m.createdAt, nombre: m.supply.name,
        cantidad: (Math.abs(m.quantity) / 1000).toLocaleString('es-AR', { maximumFractionDigits: 3, useGrouping: false }),
        unidad: UNIDADES[m.supply.unit as Unidad]?.label ?? 'u', lossType: m.lossType, reason: m.reason, orderCode: m.orderCode, user: m.user,
      })),
    ].sort((x, y) => x.cuando.getTime() - y.cuando.getTime());
    return csv([
      ['Fecha', 'Hora', 'Producto o insumo', 'Cantidad', 'Unidad', 'Tipo', 'Detalle', 'Pedido', 'Anotó'],
      ...filas.map((m) => [
        dia(m.cuando), hora(m.cuando), m.nombre, m.cantidad, m.unidad,
        ETIQUETA_TIPO_MERMA[tipoDeMerma(m.lossType)], m.reason ?? '', m.orderCode ?? '', m.user?.name ?? '',
      ]),
    ], `mermas-${sufijo}`);
  }

  // Libro: cobros (+), gastos (−) y diferencias de caja (±), en orden. El saldo
  // final es el resultado del período que muestra la pantalla.
  const [cobros, gastos, cierres] = await Promise.all([
    db.order.findMany({ where: cobradosEn(s.branchId, p.desde, p.hasta), include: { paidBy: { select: { name: true } } } }),
    db.expense.findMany({
      where: { branchId: s.branchId, voidedAt: null, date: diasDelRango(p.desde, p.hasta) },
      include: { createdBy: { select: { name: true } } },
    }),
    db.cashSession.findMany({
      where: { branchId: s.branchId, closedAt: { gte: p.desde, lt: p.hasta } },
      include: { closedBy: { select: { name: true } } },
    }),
  ]);

  type Fila = { orden: string; fecha: string; hora: string; tipo: string; concepto: string; medio: string; monto: number; usuario: string };
  const filas: Fila[] = [
    ...cobros.map((o) => {
      const cuando = o.paidAt ?? o.deliveredAt ?? o.createdAt;
      return {
        orden: cuando.toISOString(), fecha: dia(cuando), hora: hora(cuando), tipo: 'Cobro',
        concepto: `Pedido ${o.code} · ${TIPO[o.type] ?? o.type}`, medio: ETIQUETA_PAGO[o.paymentMethod] ?? o.paymentMethod,
        monto: o.total, usuario: o.paidBy?.name ?? (o.pagoOnline ? 'Pago online' : ''),
      };
    }),
    ...gastos.map((g) => {
      const fecha = g.date.toISOString().slice(0, 10);
      return {
        // Los gastos son de un día, sin hora: van después de los cobros de ese día
        orden: `${fecha}T23:59:59.999Z-${g.createdAt.toISOString()}`, fecha: fecha.split('-').reverse().join('/'), hora: '',
        tipo: 'Gasto', concepto: `${ETIQUETA_CATEGORIA[g.category] ?? g.category}: ${g.description}${g.supplier ? ` (${g.supplier})` : ''}`,
        medio: ETIQUETA_PAGO_GASTO[g.payment] ?? g.payment, monto: -aNumero(g.amount), usuario: g.createdBy.name,
      };
    }),
    ...cierres
      .map((c) => ({ c, dif: aNumero(c.countedAmount) - aNumero(c.expectedAmount) }))
      .filter(({ dif }) => dif !== 0)
      .map(({ c, dif }) => ({
        orden: c.closedAt!.toISOString(), fecha: dia(c.closedAt!), hora: hora(c.closedAt!),
        tipo: dif < 0 ? 'Faltante de caja' : 'Sobrante de caja', concepto: `Cierre de caja del ${claveDia(c.openedAt).split('-').reverse().join('/')}`,
        medio: 'Efectivo', monto: dif, usuario: c.closedBy?.name ?? '',
      })),
  ].sort((a, b) => a.orden.localeCompare(b.orden));

  let saldo = 0;
  const cuerpo = filas.map((f) => {
    saldo += f.monto;
    return [f.fecha, f.hora, f.tipo, f.concepto, f.medio, f.monto > 0 ? pesos(f.monto) : '', f.monto < 0 ? pesos(-f.monto) : '', pesos(saldo), f.usuario];
  });
  return csv([
    ['Fecha', 'Hora', 'Movimiento', 'Concepto', 'Medio', 'Entró', 'Salió', 'Saldo', 'Registró'],
    ...cuerpo,
    [],
    ['', '', '', 'Resultado del período', '', '', '', pesos(saldo), ''],
  ], `libro-${sufijo}`);
}
