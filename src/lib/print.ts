import { db } from './db';
import { comandaCocina, ticketCliente, leerConfig, llevaTicketCaja } from './comanda';

/**
 * El navegador no habla ESC/POS. Acá generamos el texto de la comanda y lo
 * dejamos en la tabla PrintJob; el agente que corre en la PC del local lo
 * levanta y lo manda a la impresora. Si no hay impresora, el job queda en cola
 * y no rompe nada.
 */

export type Estacion = 'cocina' | 'caja';

/**
 * Encola las comandas de un pedido. El agente de la PC de ESE local las
 * imprime: cada job lleva la sucursal, así Burzaco no imprime lo de Adrogué.
 *
 * `soloItems` sirve para los agregados a una mesa: sale una comanda de cocina
 * con lo nuevo nada más, para que no se cocine dos veces lo de la primera ronda.
 */
export async function encolarImpresion(
  orderId: string,
  opciones: { estaciones?: Estacion[]; soloItems?: string[]; forzar?: boolean } = {}
) {
  const o = await db.order.findUnique({
    where: { id: orderId },
    include: {
      items: { include: { addons: true, product: { select: { categoryId: true, category: { select: { name: true } } } } } },
      table: true,
      branch: true,
    },
  });
  if (!o) return;

  const cfg = leerConfig(o.branch.comanda);
  const items = o.items.map((i) => ({ ...i, categoryId: i.product?.categoryId ?? null, categoryName: i.product?.category.name ?? null }));
  const pedido = { ...o, guests: o.table?.guests ?? null, items };
  const agregado = !!opciones.soloItems;
  const paraCocina = agregado ? { ...pedido, items: items.filter((i) => opciones.soloItems!.includes(i.id)) } : pedido;

  // La caja respeta "solo envíos" o "nunca", salvo que se pida reimprimir a mano
  const estaciones = (opciones.estaciones ?? ['cocina', 'caja']).filter(
    (e) => e !== 'caja' || opciones.forzar || llevaTicketCaja(o.type, cfg)
  );

  const jobs: { orderId: string; branchId: string; station: string; payload: string }[] = [];
  for (const station of estaciones) {
    const payload = station === 'cocina'
      ? comandaCocina(paraCocina, o.branch.name, cfg, agregado)
      : ticketCliente(pedido, { nombre: o.branch.name, direccion: o.branch.address, alias: o.branch.aliasBancario }, cfg);
    if (!payload) continue;
    const copias = station === 'cocina' ? cfg.cocina.copias : cfg.caja.copias;
    for (let i = 0; i < copias; i++) jobs.push({ orderId, branchId: o.branchId, station, payload });
  }
  if (jobs.length) await db.printJob.createMany({ data: jobs });
  await db.order.update({ where: { id: orderId }, data: { printedAt: new Date() } });
}

/**
 * La cuenta de una mesa: un solo ticket con todo lo que se pidió desde que se
 * sentaron, aunque hayan sido varias rondas (varios pedidos).
 */
export async function encolarCuentaMesa(tableId: string) {
  const mesa = await db.table.findUnique({ where: { id: tableId }, include: { branch: true } });
  if (!mesa) return false;
  const pedidos = await db.order.findMany({
    where: {
      tableId, status: { notIn: ['RECHAZADO', 'CANCELADO'] },
      OR: [{ paymentStatus: 'PENDIENTE' }, ...(mesa.openedAt ? [{ createdAt: { gte: mesa.openedAt } }] : [])],
    },
    orderBy: { createdAt: 'asc' },
    include: { items: { include: { addons: true } } },
  });
  if (pedidos.length === 0) return false;
  const cfg = leerConfig(mesa.branch.comanda);
  const suma = (k: 'subtotal' | 'deliveryFee' | 'discount' | 'total') => pedidos.reduce((t, p) => t + p[k], 0);
  const primero = pedidos[0];
  const payload = ticketCliente(
    {
      ...primero,
      code: pedidos.map((p) => p.code).join(' + '),
      table: { name: mesa.name },
      guests: mesa.guests,
      items: pedidos.flatMap((p) => p.items),
      subtotal: suma('subtotal'), deliveryFee: suma('deliveryFee'), discount: suma('discount'), total: suma('total'),
      paymentStatus: pedidos.every((p) => p.paymentStatus === 'COBRADO') ? 'COBRADO' : 'PENDIENTE',
      cashAmount: null,
      notes: null,
    },
    { nombre: mesa.branch.name, direccion: mesa.branch.address, alias: mesa.branch.aliasBancario },
    cfg
  );
  await db.printJob.create({ data: { orderId: primero.id, branchId: mesa.branchId, station: 'caja', payload } });
  return true;
}
