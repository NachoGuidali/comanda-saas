import { db } from '@/lib/db';
import { requireSession } from '@/lib/session';
import GestorEmpleados from '@/components/admin/GestorEmpleados';

export const dynamic = 'force-dynamic';

export default async function EmpleadosPage() {
  const s = await requireSession('empleados.ver');

  const hoy = new Date();
  hoy.setHours(0, 0, 0, 0);

  const empleados = await db.user.findMany({
    where: s.esSuperadmin
      ? { tenantId: s.tenantId }
      : { tenantId: s.tenantId, OR: [{ branches: { some: { branchId: { in: s.sucursales.map((x) => x.id) } } } }, { role: 'SUPERADMIN' }] },
    orderBy: [{ active: 'desc' }, { name: 'asc' }],
    include: {
      shifts: { where: { date: hoy, branchId: s.branchId }, orderBy: { startedAt: 'desc' } },
      branches: { select: { branchId: true } },
    },
  });

  return (
    <GestorEmpleados
      empleados={JSON.parse(JSON.stringify(empleados))}
      sucursales={s.sucursales}
      sucursalActiva={s.branchId}
      puedeEditar={s.esSuperadmin || s.permisos.includes('empleados.editar')}
      soySuperadmin={s.esSuperadmin}
    />
  );
}
