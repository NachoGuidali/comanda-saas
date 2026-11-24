import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getApiSession, puede, tieneFuncion } from '@/lib/session';

export const dynamic = 'force-dynamic';

export async function GET() {
  const session = await getApiSession();
  if (!session) return NextResponse.json({ error: 'Sin sesión' }, { status: 401 });
  const [pendientes, whatsapp] = await Promise.all([
    puede(session, 'pedidos.ver')
      ? db.order.count({ where: { branchId: session.branchId, status: 'PENDIENTE', esperandoPago: false } })
      : 0,
    // Chats de WhatsApp sin leer, para el número al lado de "WhatsApp" en el menú
    puede(session, 'whatsapp.ver') && tieneFuncion(session, 'whatsapp')
      ? db.whatsAppChat.count({ where: { branchId: session.branchId, unread: { gt: 0 }, archived: false } })
      : 0,
  ]);
  return NextResponse.json({ pendientes, whatsapp }, { headers: { 'Cache-Control': 'no-store' } });
}
