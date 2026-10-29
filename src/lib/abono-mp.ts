import { randomBytes } from 'crypto';
import { db } from './db';
import { dominioBase, urlDelCliente } from './tenant';
import { precioDe } from './plan';
import { registrarPagoCliente } from './cobros';
import {
  credencialesPlataforma, crearPreferencia, crearSuscripcion, cancelarSuscripcion, obtenerPago, obtenerCobroSuscripcion,
} from './mercadopago';

/**
 * Cobro del abono de cada cliente con la cuenta de Mercado Pago de la
 * PLATAFORMA (PLATAFORMA_MP_TOKEN), no con la del local:
 *
 *   Link de pago     N meses, un solo pago.
 *   Débito automático  suscripción mensual: Mercado Pago le cobra solo todos los meses.
 *
 * Cada cobro aprobado llega al webhook de la plataforma y se registra solo.
 * La referencia lleva el cliente ("abono:<id>:<meses>"): nunca se confía en el
 * aviso, el pago se consulta a la API y se controla el monto.
 */

export function urlPlataforma(ruta = ''): string {
  const base = dominioBase();
  return base === 'localhost' ? `http://localhost:${process.env.PORT || 3000}${ruta}` : `https://${base}${ruta}`;
}

export function mpPlataformaDisponible(): boolean {
  return credencialesPlataforma().modo === 'real';
}

export async function linkPagoAbono(tenantId: string, meses: number): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
  if (!mpPlataformaDisponible()) return { ok: false, error: 'El cobro con Mercado Pago no está configurado (PLATAFORMA_MP_TOKEN)' };
  const t = await db.tenant.findUnique({ where: { id: tenantId }, include: { plan: true } });
  if (!t) return { ok: false, error: 'No existe el cliente' };
  const precio = precioDe(t);
  if (precio <= 0) return { ok: false, error: 'El cliente no tiene precio: asignale un plan o un precio acordado' };
  const n = Math.max(1, Math.min(12, Math.floor(meses)));
  const url = await crearPreferencia(credencialesPlataforma(), {
    orderId: `abono:${t.id}:${n}:${randomBytes(4).toString('hex')}`,
    titulo: `Comanda Supreg · ${t.name} · ${n} ${n === 1 ? 'mes' : 'meses'}`,
    total: precio * n,
    urlRetorno: urlDelCliente(t, '/admin/abono'),
    urlWebhook: urlPlataforma('/api/plataforma/mp/webhook').startsWith('https://') ? urlPlataforma('/api/plataforma/mp/webhook') : null,
    vence: new Date(Date.now() + 7 * 24 * 60 * 60_000),
  });
  return { ok: true, url };
}

export async function linkSuscripcionAbono(tenantId: string, email: string): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
  if (!mpPlataformaDisponible()) return { ok: false, error: 'El cobro con Mercado Pago no está configurado (PLATAFORMA_MP_TOKEN)' };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { ok: false, error: 'Poné el mail de la cuenta de Mercado Pago que va a pagar' };
  const t = await db.tenant.findUnique({ where: { id: tenantId }, include: { plan: true } });
  if (!t) return { ok: false, error: 'No existe el cliente' };
  const precio = precioDe(t);
  if (precio <= 0) return { ok: false, error: 'El cliente no tiene precio: asignale un plan o un precio acordado' };
  const cred = credencialesPlataforma();
  // Una suscripción vigente por cliente: la anterior se cancela
  if (t.mpPreapprovalId) await cancelarSuscripcion(cred, t.mpPreapprovalId).catch((e) => console.error('Cancelar suscripción', e));
  const s = await crearSuscripcion(cred, {
    motivo: `Comanda Supreg · ${t.name}`, email, montoMensual: precio,
    referencia: `abono:${t.id}`, urlRetorno: urlDelCliente(t, '/admin/abono'),
  });
  await db.tenant.update({ where: { id: t.id }, data: { mpPreapprovalId: s.id } });
  return { ok: true, url: s.init_point };
}

/** El webhook de la plataforma: un pago (link) o un cobro de suscripción. */
export async function procesarAvisoAbono(tipo: string, id: string): Promise<'registrado' | 'ignorado'> {
  const cred = credencialesPlataforma();
  if (cred.modo !== 'real') return 'ignorado';

  if (tipo === 'payment') {
    const p = await obtenerPago(cred, id);
    if (p.status !== 'approved' || p.currency_id !== 'ARS') return 'ignorado';
    const [pref, tenantId, mesesTxt] = (p.external_reference ?? '').split(':');
    if (pref !== 'abono' || !tenantId) return 'ignorado';
    const t = await db.tenant.findUnique({ where: { id: tenantId }, include: { plan: true } });
    if (!t) return 'ignorado';
    const meses = Math.max(1, Math.min(12, Number(mesesTxt) || 1));
    const monto = Math.round(p.transaction_amount * 100);
    // Que lo pagado alcance para lo que se registra
    if (monto < precioDe(t) * meses) {
      console.error(`Abono ${id} de ${t.slug}: pagó ${monto} y corresponden ${precioDe(t) * meses}`);
      return 'ignorado';
    }
    await registrarPagoCliente(t.id, { amount: monto, months: meses, method: 'MERCADO_PAGO', reference: `MP ${id}`, createdBy: 'Mercado Pago', mpPaymentId: String(p.id) });
    return 'registrado';
  }

  if (tipo === 'subscription_authorized_payment') {
    const c = await obtenerCobroSuscripcion(cred, id);
    const pago = c.payment;
    if (!pago || pago.status !== 'approved' || c.currency_id !== 'ARS') return 'ignorado';
    const t = await db.tenant.findUnique({ where: { mpPreapprovalId: c.preapproval_id } });
    if (!t) return 'ignorado';
    await registrarPagoCliente(t.id, {
      amount: Math.round(c.transaction_amount * 100), months: 1, method: 'MERCADO_PAGO',
      reference: `Débito automático ${pago.id}`, createdBy: 'Mercado Pago', mpPaymentId: String(pago.id),
    });
    return 'registrado';
  }
  return 'ignorado';
}
