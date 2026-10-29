import { db } from '@/lib/db';
import { requireSession, exigirFuncion } from '@/lib/session';
import GestorMesas from '@/components/admin/GestorMesas';
import { claveDia } from '@/lib/tiempo';

export const dynamic = 'force-dynamic';

export default async function MesasPage({
  searchParams,
}: {
  searchParams: Promise<{ fecha?: string }>;
}) {
  const s = await requireSession('mesas.ver');
  exigirFuncion(s, 'salon');
  const sp = await searchParams;

  const hoyISO = claveDia(new Date());
  const fecha = sp.fecha ?? hoyISO;

  // El día elegido, de 00:00 a 23:59
  const desde = new Date(`${fecha}T00:00:00`);
  const hasta = new Date(`${fecha}T23:59:59`);

  const branch = await db.branch.findUnique({
    where: { id: s.branchId },
    select: { intervaloReservaMin: true, duracionReservaMin: true },
  });

  const [mesas, reservas, horario] = await Promise.all([
    db.table.findMany({
      where: { branchId: s.branchId },
      orderBy: [{ zone: 'asc' }, { name: 'asc' }],
    }),
    db.reservation.findMany({
      where: {
        branchId: s.branchId,
        date: { gte: desde, lte: hasta },
        status: { in: ['NUEVA', 'CONFIRMADA', 'SENTADA'] },
      },
      orderBy: { date: 'asc' },
      select: {
        id: true, tableId: true, customerName: true, customerPhone: true,
        date: true, people: true, duracionMin: true, status: true, type: true, notes: true,
      },
    }),
    db.businessHour.findFirst({
      where: { branchId: s.branchId, dayOfWeek: desde.getDay() },
    }),
  ]);

  return (
    <GestorMesas
      fecha={fecha}
      esHoy={fecha === hoyISO}
      mesas={mesas}
      reservas={JSON.parse(JSON.stringify(reservas))}
      horario={horario ? { openTime: horario.openTime, closeTime: horario.closeTime, closed: horario.closed } : null}
      intervalo={branch?.intervaloReservaMin ?? 30}
      duracionDefault={branch?.duracionReservaMin ?? 120}
      puedeEditar={s.esSuperadmin || s.permisos.includes('mesas.editar')}
      puedeReservar={s.esSuperadmin || s.permisos.includes('reservas.gestionar')}
    />
  );
}
