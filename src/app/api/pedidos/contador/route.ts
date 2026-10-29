import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getApiSession, puede } from '@/lib/session';

export const dynamic = 'force-dynamic';

export async function GET() {
  const session = await getApiSession();
  if (!session) return NextResponse.json({ error: 'Sin sesión' }, { status: 401 });
  if (!puede(session, 'pedidos.ver')) return NextResponse.json({ pendientes: 0 });

  const pendientes = await db.order.count({
    where: { branchId: session.branchId, status: 'PENDIENTE', esperandoPago: false },
  });
  return NextResponse.json({ pendientes }, { headers: { 'Cache-Control': 'no-store' } });
}
