import { db } from '@/lib/db';
import { requireSession, exigirFuncion } from '@/lib/session';
import GestorReservas from '@/components/admin/GestorReservas';

export const dynamic = 'force-dynamic';

export default async function ReservasAdminPage() {
  const s = await requireSession('reservas.ver');
  exigirFuncion(s, 'salon');

  const [reservas, mesas] = await Promise.all([
    db.reservation.findMany({
      where: { branchId: s.branchId },
      orderBy: [{ date: 'asc' }],
      take: 200,
      include: { table: { select: { id: true, name: true } } },
    }),
    db.table.findMany({
      where: { branchId: s.branchId, active: true, status: { not: 'FUERA_DE_SERVICIO' } },
      orderBy: { capacity: 'asc' },
      select: { id: true, name: true, capacity: true },
    }),
  ]);

  return (
    <GestorReservas
      reservas={JSON.parse(JSON.stringify(reservas))}
      mesas={mesas}
      puedeGestionar={s.esSuperadmin || s.permisos.includes('reservas.gestionar')}
    />
  );
}
