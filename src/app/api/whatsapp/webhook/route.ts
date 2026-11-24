import { NextResponse } from 'next/server';
import { procesarWebhook } from '@/lib/whatsapp/mensajes';

export const dynamic = 'force-dynamic';

/**
 * Evolution avisa acá los mensajes que llegan, el QR y los cambios de
 * conexión de cada número. Llega por la red interna de Docker; igual, cada
 * instancia firma con su propia clave (x-comanda-token), así que desde afuera
 * no se puede inyectar un mensaje.
 */
export async function POST(req: Request) {
  let cuerpo: unknown;
  try {
    cuerpo = await req.json();
  } catch {
    return NextResponse.json({ error: 'JSON inválido' }, { status: 400 });
  }
  try {
    const status = await procesarWebhook(cuerpo, req.headers.get('x-comanda-token'));
    return NextResponse.json({ ok: status === 200 }, { status });
  } catch (e) {
    // Un error nuestro no tiene que hacer que Evolution reintente para siempre
    console.error('WhatsApp webhook', e);
    return NextResponse.json({ ok: false }, { status: 200 });
  }
}
