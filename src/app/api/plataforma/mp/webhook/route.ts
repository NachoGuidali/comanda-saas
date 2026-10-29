import { NextResponse } from 'next/server';
import { firmaWebhookValida, credencialesPlataforma } from '@/lib/mercadopago';
import { procesarAvisoAbono } from '@/lib/abono-mp';
import { tenantDeRequest } from '@/lib/tenant';

export const dynamic = 'force-dynamic';

/**
 * Avisos de Mercado Pago de la cuenta de la PLATAFORMA: pagos de abonos
 * (links) y cobros de los débitos automáticos. Solo en el dominio de la
 * plataforma. Se consulta a la API: el aviso solo trae el ID.
 */
export async function POST(req: Request) {
  if (await tenantDeRequest(req)) return NextResponse.json({ error: 'No encontrado' }, { status: 404 });
  const url = new URL(req.url);
  let cuerpo: { type?: string; topic?: string; data?: { id?: string | number } } = {};
  try { cuerpo = await req.json(); } catch { /* también por query string */ }
  const tipo = String(cuerpo.type ?? cuerpo.topic ?? url.searchParams.get('type') ?? url.searchParams.get('topic') ?? '');
  const id = String(cuerpo.data?.id ?? url.searchParams.get('data.id') ?? url.searchParams.get('id') ?? '');
  if (!id) return NextResponse.json({ ok: true });
  if (!firmaWebhookValida(credencialesPlataforma().secreto, req.headers, id)) {
    return NextResponse.json({ error: 'Firma inválida' }, { status: 401 });
  }
  try {
    await procesarAvisoAbono(tipo, id);
  } catch (e) {
    // Un pago que no es de esta cuenta (Mercado Pago dice que no existe): no hay
    // nada que reintentar
    if (e instanceof Error && e.message.includes('respondió 404')) return NextResponse.json({ ok: true });
    console.error('Webhook abono', e);
    return NextResponse.json({ error: 'Reintentar' }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
