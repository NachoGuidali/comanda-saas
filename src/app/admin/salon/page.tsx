import { redirect } from 'next/navigation';
import { db } from '@/lib/db';
import { requireSession, exigirFuncion, puede } from '@/lib/session';
import { catalogoMostrador } from '@/lib/catalogo-mostrador';
import GestorSalon from '@/components/admin/GestorSalon';

export const dynamic = 'force-dynamic';

/**
 * El salón en vivo, para el mozo con el celular o la tablet: qué mesas están
 * ocupadas, cuántos son, qué pidieron y cuánto van. Se abre la mesa, se anota
 * el pedido ahí mismo y sale la comanda.
 */
export default async function SalonPage() {
  const s = await requireSession();
  exigirFuncion(s, 'salon');
  if (!puede(s, 'mesas.ver')) redirect('/admin?error=sin-permiso');
  const puedeAnotar = puede(s, 'pedidos.crear');

  const mesas = await db.table.findMany({
    where: { branchId: s.branchId, active: true },
    orderBy: [{ zone: 'asc' }, { name: 'asc' }],
    include: { waiter: { select: { id: true, name: true } } },
  });
  const ocupadas = mesas.filter((m) => m.status === 'OCUPADA');

  const [pedidos, catalogo] = await Promise.all([
    ocupadas.length
      ? db.order.findMany({
          where: {
            branchId: s.branchId,
            tableId: { in: ocupadas.map((m) => m.id) },
            status: { notIn: ['RECHAZADO', 'CANCELADO'] },
            OR: [
              { status: { in: ['PENDIENTE', 'ACEPTADO', 'EN_PREPARACION', 'LISTO', 'EN_CAMINO'] } },
              { paymentStatus: 'PENDIENTE' },
              ...ocupadas.filter((m) => m.openedAt).map((m) => ({ tableId: m.id, createdAt: { gte: m.openedAt! } })),
            ],
          },
          orderBy: { createdAt: 'asc' },
          select: {
            id: true, code: true, tableId: true, status: true, paymentStatus: true, total: true, createdAt: true,
            items: { select: { id: true, name: true, variantName: true, quantity: true, total: true, notes: true, addons: { select: { name: true } } } },
          },
        })
      : Promise.resolve([]),
    puedeAnotar ? catalogoMostrador(s.branchId) : Promise.resolve([]),
  ]);

  return (
    <GestorSalon
      sucursal={s.branchName}
      branchId={s.branchId}
      userId={s.userId}
      ahora={new Date().toISOString()}
      mesas={mesas.map((m) => ({
        id: m.id, name: m.name, zone: m.zone, capacity: m.capacity, status: m.status,
        guests: m.guests, openedAt: m.openedAt?.toISOString() ?? null,
        mozo: m.waiter ? { id: m.waiter.id, name: m.waiter.name } : null,
      }))}
      pedidos={pedidos.map((p) => ({ ...p, createdAt: p.createdAt.toISOString() }))}
      catalogo={catalogo}
      puedeAnotar={puedeAnotar}
      puedeAtender={puede(s, 'pedidos.crear', 'mesas.editar')}
      puedeCobrar={puede(s, 'pedidos.cobrar')}
      puedeServir={puede(s, 'pedidos.avanzar')}
    />
  );
}
