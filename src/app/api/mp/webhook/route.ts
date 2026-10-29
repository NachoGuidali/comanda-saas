import { NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import { firmaWebhookValida, modoMP } from '@/lib/mercadopago';
import { sincronizarPago } from '@/lib/pagos';
import { tenantDeRequest } from '@/lib/tenant';
import { credencialesDelCliente } from '@/lib/mp-cliente';

export const dynamic = 'force-dynamic';

/**
 * Mercado Pago avisa acá cada vez que cambia un pago de un local. El aviso
 * llega al dominio del local (pepperino.comandasupreg.com/api/mp/webhook), así
 * que se consulta con las credenciales de ese local y solo se aplica a sus
 * pedidos. El aviso trae solo el ID: el estado real se consulta a la API, así
 * que una notificación falsa no puede marcar nada como pagado.
 *
 * Siempre se responde 200 rápido, salvo error de firma; si respondemos con
 * error, Mercado Pago reintenta durante horas.
 */
export async function POST(req: Request) {
  const tenant = await tenantDeRequest(req);
  if (!tenant) return NextResponse.json({ ok: true });
  const cred = await credencialesDelCliente(tenant.id);
  if (modoMP(cred) !== 'real') return NextResponse.json({ ok: true });

  const url = new URL(req.url);
  let cuerpo: { type?: string; topic?: string; data?: { id?: string | number } } = {};
  try {
    cuerpo = await req.json();
  } catch { /* algunos avisos vienen solo por query string */ }

  const tipo = cuerpo.type ?? cuerpo.topic ?? url.searchParams.get('type') ?? url.searchParams.get('topic');
  const id = String(cuerpo.data?.id ?? url.searchParams.get('data.id') ?? url.searchParams.get('id') ?? '');
  if (tipo !== 'payment' || !id) return NextResponse.json({ ok: true });

  if (!firmaWebhookValida(cred.secreto, req.headers, id)) {
    return NextResponse.json({ error: 'Firma inválida' }, { status: 401 });
  }

  try {
    await sincronizarPago(tenant.id, id);
    revalidatePath('/admin/pedidos');
  } catch (e) {
    // Un pago que no es de esta cuenta (Mercado Pago dice que no existe): no hay
    // nada que reintentar
    if (e instanceof Error && e.message.includes('respondió 404')) return NextResponse.json({ ok: true });
    // Si la API de Mercado Pago falla, pedimos que reintente
    console.error('Webhook MP', e);
    return NextResponse.json({ error: 'Reintentar' }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
