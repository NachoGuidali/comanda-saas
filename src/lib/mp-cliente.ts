import type { Plan, Tenant } from '@prisma/client';
import { db } from './db';
import { descifrar } from './cifrado';
import { limitesDe } from './plan';
import { SIN_MP, type CredencialesMP } from './mercadopago';

/**
 * Las credenciales de Mercado Pago de un local, descifradas. Si su plan no
 * incluye el pago online, o la credencial no se puede leer, es como apagado.
 */
export function credencialesDe(t: Tenant & { plan: Plan | null }): CredencialesMP {
  if (!limitesDe(t).funciones.includes('pago_online')) return SIN_MP;
  if (t.mpMode === 'simulado') return { modo: 'simulado', token: null, secreto: null };
  if (t.mpMode === 'real') {
    const token = descifrar(t.mpAccessToken);
    if (!token) return SIN_MP;
    return { modo: 'real', token, secreto: descifrar(t.mpWebhookSecret) };
  }
  return SIN_MP;
}

export async function credencialesDelCliente(tenantId: string): Promise<CredencialesMP> {
  const t = await db.tenant.findUnique({ where: { id: tenantId }, include: { plan: true } });
  return t ? credencialesDe(t) : SIN_MP;
}

/** Las del local de un pedido: el pago va a la cuenta de ese local. */
export async function credencialesDelPedido(orderId: string): Promise<CredencialesMP> {
  const o = await db.order.findUnique({ where: { id: orderId }, select: { branch: { select: { tenantId: true } } } });
  return o ? credencialesDelCliente(o.branch.tenantId) : SIN_MP;
}
