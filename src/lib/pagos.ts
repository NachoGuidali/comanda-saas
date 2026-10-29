import { headers } from 'next/headers';
import { urlDelCliente, dominioBase } from './tenant';
import { db } from './db';
import { devolverStock } from './stock';
import {
  modoMP, crearPreferencia, obtenerPago, buscarPagos, reembolsar, firmaSimulada, type PagoMP,
} from './mercadopago';
import { credencialesDelCliente, credencialesDelPedido } from './mp-cliente';

/**
 * El circuito del pago online:
 *
 *   1. El cliente elige "Mercado Pago" en la carta. El pedido se crea igual
 *      (reserva el stock) pero queda "esperando pago": caja lo ve, no lo puede
 *      aceptar, y no suena.
 *   2. Se lo manda a pagar a Mercado Pago (o a la pantalla simulada).
 *   3. Cuando el pago se aprueba (por webhook, o al volver a la página del
 *      pedido) el pedido queda cobrado y recién ahí entra al tablero como nuevo.
 *   4. Si en 30 minutos no pagó, se rechaza solo y el stock vuelve.
 *   5. Si un pedido pagado online se cancela, se devuelve la plata.
 */

/** Cuánto se espera a que el cliente pague antes de liberar el stock. */
export const MINUTOS_PARA_PAGAR = 30;

/**
 * Dirección pública del local del pedido, para que Mercado Pago sepa adónde
 * volver: su subdominio (pepperino.comandasupreg.com) o su dominio propio.
 */
async function urlDelLocal(tenant: Parameters<typeof urlDelCliente>[0]): Promise<string> {
  if (process.env.PUBLIC_URL) return process.env.PUBLIC_URL.replace(/\/$/, '');
  // En la PC local se vuelve por el mismo host y puerto por el que se entró
  if (dominioBase() === 'localhost') {
    const h = await headers();
    const host = h.get('x-forwarded-host') ?? h.get('host');
    if (host) return `http://${host}`;
  }
  return urlDelCliente(tenant, '').replace(/\/$/, '');
}

/** Devuelve el link al que hay que mandar al cliente para que pague. */
export async function linkDePago(orderId: string): Promise<string> {
  const o = await db.order.findUniqueOrThrow({
    where: { id: orderId },
    include: { branch: { select: { name: true, tenant: { select: { slug: true, customDomain: true } } } } },
  });
  const base = await urlDelLocal(o.branch.tenant);
  const cred = await credencialesDelPedido(o.id);

  if (modoMP(cred) === 'simulado') {
    return `${base}/pago-demo/${o.id}?f=${firmaSimulada(o.id)}`;
  }

  return crearPreferencia(cred, {
    orderId: o.id,
    titulo: `Pedido ${o.code} · ${o.branch.name}`,
    total: o.total,
    urlRetorno: `${base}/pedido/${o.code}`,
    urlWebhook: base.startsWith('https://') ? `${base}/api/mp/webhook` : null,
    vence: new Date(o.createdAt.getTime() + MINUTOS_PARA_PAGAR * 60_000),
  });
}

/**
 * Aplica lo que informó Mercado Pago sobre un pago. Es idempotente: el mismo
 * pago puede llegar por webhook y por la vuelta del cliente, y no pasa nada.
 */
export async function aplicarPago(pago: PagoMP, tenantId: string): Promise<'aprobado' | 'rechazado' | 'pendiente' | 'ignorado'> {
  const orderId = pago.external_reference;
  if (!orderId) return 'ignorado';
  const o = await db.order.findFirst({ where: { id: orderId, branch: { tenantId } } });
  if (!o || !o.pagoOnline) return 'ignorado';

  const id = String(pago.id);

  if (pago.status === 'approved') {
    // Que lo pagado sea lo que cuesta el pedido, en pesos. Si no, no se acepta.
    if (pago.currency_id !== 'ARS' || Math.round(pago.transaction_amount * 100) !== o.total) {
      console.error(`Pago ${id} no coincide con el pedido ${o.code}: ${pago.transaction_amount} ${pago.currency_id}`);
      await db.order.update({ where: { id: o.id }, data: { mpStatus: 'monto_distinto', mpPaymentId: id } });
      return 'ignorado';
    }

    const r = await db.order.updateMany({
      where: { id: o.id, esperandoPago: true, status: 'PENDIENTE' },
      data: {
        esperandoPago: false,
        paymentStatus: 'COBRADO',
        paidAt: new Date(),
        mpPaymentId: id,
        mpStatus: 'approved',
      },
    });

    // Pagó tarde: el pedido ya se había dado de baja por falta de pago. No
    // se puede revivir (el stock ya se liberó), así que se devuelve la plata.
    if (r.count === 0 && o.status === 'RECHAZADO' && o.mpPaymentId !== id) {
      await db.order.update({ where: { id: o.id }, data: { mpPaymentId: id, mpStatus: 'approved' } });
      await reembolsarPedido(o.id).catch((e) => console.error('Reembolso de pago tardío', e));
    }
    return 'aprobado';
  }

  if (['rejected', 'cancelled'].includes(pago.status)) {
    // El pedido sigue esperando: el cliente puede probar con otra tarjeta
    await db.order.updateMany({ where: { id: o.id, esperandoPago: true }, data: { mpStatus: pago.status } });
    return 'rechazado';
  }

  if (['refunded', 'charged_back'].includes(pago.status)) {
    await db.order.update({ where: { id: o.id }, data: { mpStatus: pago.status } });
    return 'ignorado';
  }

  await db.order.updateMany({ where: { id: o.id, esperandoPago: true }, data: { mpStatus: pago.status } });
  return 'pendiente';
}

/**
 * Consulta un pago puntual (el que viene en la vuelta o en el webhook) con
 * las credenciales del local y lo aplica. El pago tiene que ser de un pedido
 * de ese mismo local: el de otro local se ignora.
 */
export async function sincronizarPago(tenantId: string, paymentId: string) {
  const cred = await credencialesDelCliente(tenantId);
  if (modoMP(cred) !== 'real') return 'ignorado' as const;
  return aplicarPago(await obtenerPago(cred, paymentId), tenantId);
}

/** Busca si hay algún pago aprobado para el pedido. Por si se perdió el webhook. */
export async function sincronizarPedido(orderId: string) {
  const o = await db.order.findUnique({ where: { id: orderId }, select: { branch: { select: { tenantId: true } } } });
  if (!o) return;
  const cred = await credencialesDelCliente(o.branch.tenantId);
  if (modoMP(cred) !== 'real') return;
  const pagos = await buscarPagos(cred, orderId);
  const aprobado = pagos.find((p) => p.status === 'approved');
  if (aprobado) await aplicarPago(aprobado, o.branch.tenantId);
  else if (pagos[0]) await aplicarPago(pagos[0], o.branch.tenantId);
}

const ultimaRevision = new Map<string, number>();

/** Igual que vencerPagosPendientes, pero como mucho una vez por minuto por local. */
export async function revisarPagosVencidos(branchId: string) {
  const ahora = Date.now();
  if (ahora - (ultimaRevision.get(branchId) ?? 0) < 60_000) return;
  ultimaRevision.set(branchId, ahora);
  await vencerPagosPendientes(branchId).catch((e) => console.error('Vencer pagos', e));
}

/**
 * Da de baja los pedidos que esperan pago hace más de 30 minutos y libera su
 * stock. Se llama cada vez que alguien mira el tablero, así no hace falta un
 * proceso aparte.
 */
export async function vencerPagosPendientes(branchId?: string) {
  const limite = new Date(Date.now() - MINUTOS_PARA_PAGAR * 60_000);
  const vencidos = await db.order.findMany({
    where: { esperandoPago: true, status: 'PENDIENTE', createdAt: { lt: limite }, ...(branchId ? { branchId } : {}) },
    select: { id: true, code: true },
    take: 50,
  });

  for (const v of vencidos) {
    // Antes de darlo de baja, una última consulta por si pagó y no nos enteramos
    await sincronizarPedido(v.id).catch((e) => console.error('Sincronizar pago', e));

    await db.$transaction(async (tx) => {
      const r = await tx.order.updateMany({
        where: { id: v.id, esperandoPago: true, status: 'PENDIENTE' },
        data: {
          status: 'RECHAZADO',
          esperandoPago: false,
          closedAt: new Date(),
          cancelReason: 'No se completó el pago online',
        },
      });
      if (r.count > 0) await devolverStock(tx, v.id, v.code, 'Pago online no completado');
    });
  }
}

/**
 * Devuelve la plata de un pedido pagado online. Se usa al cancelar un pedido
 * que ya se había cobrado por Mercado Pago.
 */
export async function reembolsarPedido(orderId: string): Promise<{ ok: boolean; error?: string }> {
  const o = await db.order.findUnique({ where: { id: orderId } });
  if (!o?.pagoOnline || !o.mpPaymentId || o.mpStatus === 'refunded') return { ok: true };

  try {
    const cred = await credencialesDelPedido(o.id);
    if (modoMP(cred) === 'real') await reembolsar(cred, o.mpPaymentId);
    await db.order.update({ where: { id: o.id }, data: { mpStatus: 'refunded' } });
    return { ok: true };
  } catch (e) {
    console.error('Reembolso', e);
    await db.order.update({ where: { id: o.id }, data: { mpStatus: 'reembolso_fallido' } });
    return { ok: false, error: 'No se pudo devolver el pago automáticamente. Hacelo desde la cuenta de Mercado Pago.' };
  }
}

/** Solo para el modo simulado: el botón "Aprobar" o "Rechazar" de la pantalla de prueba. */
export async function resolverPagoSimulado(orderId: string, aprobar: boolean) {
  const o = await db.order.findUniqueOrThrow({ where: { id: orderId }, include: { branch: { select: { tenantId: true } } } });
  return aplicarPago({
    id: `SIM-${Date.now()}`,
    status: aprobar ? 'approved' : 'rejected',
    external_reference: o.id,
    transaction_amount: o.total / 100,
    currency_id: 'ARS',
  }, o.branch.tenantId);
}
