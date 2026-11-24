import { NextResponse } from 'next/server';
import { readFile } from 'fs/promises';
import { db } from '@/lib/db';
import { getApiSession, puede, tieneFuncion } from '@/lib/session';
import { rutaDeArchivo } from '@/lib/whatsapp/mensajes';

export const dynamic = 'force-dynamic';

const MOSTRABLES = /^(image\/(jpeg|png|webp|gif)|audio\/[a-z0-9.+-]+|video\/(mp4|3gpp|webm))$/;

/** Las fotos, audios y archivos de los chats: solo para quien atiende el WhatsApp de esa sucursal. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const s = await getApiSession();
  if (!s || !puede(s, 'whatsapp.ver') || !tieneFuncion(s, 'whatsapp')) return new NextResponse('Sin acceso', { status: 401 });
  const { id } = await params;

  const m = await db.whatsAppMessage.findFirst({
    where: { id, chat: { branchId: s.branchId, line: { tenantId: s.tenantId } } },
    select: { mediaPath: true, mediaMime: true, mediaName: true, type: true },
  });
  if (!m?.mediaPath) return new NextResponse('No encontrado', { status: 404 });

  try {
    const datos = await readFile(rutaDeArchivo(s.tenantId, m.mediaPath));
    const nombre = (m.mediaName || 'archivo').replace(/["\r\n]/g, '');
    // El tipo lo declara quien manda el archivo: solo se muestran en pantalla
    // fotos, audios y videos. Cualquier otra cosa (un HTML disfrazado de foto)
    // se descarga, para que nunca se ejecute dentro del panel.
    const mime = (m.mediaMime || '').split(';')[0].trim().toLowerCase();
    const seMuestra = m.type !== 'documento' && MOSTRABLES.test(mime);
    return new NextResponse(new Uint8Array(datos), {
      headers: {
        'Content-Type': seMuestra ? mime : 'application/octet-stream',
        'Content-Disposition': `${seMuestra ? 'inline' : 'attachment'}; filename="${encodeURIComponent(nombre)}"`,
        'Content-Security-Policy': "default-src 'none'; sandbox",
        'Cache-Control': 'private, max-age=86400',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch {
    return new NextResponse('No encontrado', { status: 404 });
  }
}
