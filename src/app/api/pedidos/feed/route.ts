import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getApiSession, puede } from '@/lib/session';
import { inicioDelDia } from '@/lib/tiempo';
import { revisarPagosVencidos } from '@/lib/pagos';

export const dynamic = 'force-dynamic';

/**
 * Feed que consultan el tablero y la pantalla de cocina.
 * Devuelve una firma corta para que el cliente sepa si algo cambió sin
 * tener que volver a renderizar todo.
 */
export async function GET(req: Request) {
  const session = await getApiSession();
  if (!session) return NextResponse.json({ error: 'Sin sesión' }, { status: 401 });

  const url = new URL(req.url);
  const vista = url.searchParams.get('vista') === 'cocina' ? 'cocina' : 'tablero';

  if (vista === 'cocina' ? !puede(session, 'cocina.ver') : !puede(session, 'pedidos.ver')) {
    return NextResponse.json({ error: 'Sin permiso' }, { status: 403 });
  }

  await revisarPagosVencidos(session.branchId);

  // Los cerrados solo se muestran desde el inicio del dia: el tablero es de hoy,
  // no un historico. Para el historico estan los reportes.
  const inicioHoy = inicioDelDia();

  // El repartidor que no maneja el tablero completo ve solo lo que lleva él
  const soloLosSuyos = vista === 'tablero' && !puede(session, 'pedidos.avanzar') && puede(session, 'pedidos.repartir');

  const where =
    vista === 'cocina'
      ? { branchId: session.branchId, esperandoPago: false, status: { in: ['ACEPTADO' as const, 'EN_PREPARACION' as const] } }
      : {
          branchId: session.branchId,
          ...(soloLosSuyos ? { type: 'DELIVERY' as const } : {}),
          AND: [
            {
              OR: [
                { status: { in: ['PENDIENTE' as const, 'ACEPTADO' as const, 'EN_PREPARACION' as const, 'LISTO' as const, 'EN_CAMINO' as const] } },
                {
                  status: { in: ['ENTREGADO' as const, 'RECHAZADO' as const, 'CANCELADO' as const] },
                  createdAt: { gte: inicioHoy },
                },
              ],
            },
            ...(soloLosSuyos
              ? [{ OR: [{ assignedToId: session.userId }, { assignedToId: null, status: 'LISTO' as const }] }]
              : []),
          ],
        };

  const pedidos = await db.order.findMany({
    where,
    orderBy: { createdAt: 'asc' },
    include: {
      items: { include: { addons: true }, orderBy: { id: 'asc' } },
      table: { select: { name: true } },
      assignedTo: { select: { id: true, name: true } },
      zone: { select: { name: true } },
    },
  });

  const firma = pedidos.map((p) => `${p.id}:${p.status}:${p.items.length}`).join(',');
  return NextResponse.json({ pedidos, firma }, { headers: { 'Cache-Control': 'no-store' } });
}
