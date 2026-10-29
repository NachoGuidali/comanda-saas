import { db } from '@/lib/db';
import { requireSession } from '@/lib/session';
import { DEFAULTS } from '@/lib/permisos';
import GestorRoles from '@/components/admin/GestorRoles';
import type { Role } from '@prisma/client';

export const dynamic = 'force-dynamic';

export default async function RolesPage() {
  const session = await requireSession('roles.gestionar');

  const [filas, usuarios] = await Promise.all([
    db.rolePermisos.findMany({ where: { tenantId: session.tenantId } }),
    db.user.groupBy({ by: ['role'], where: { tenantId: session.tenantId, active: true }, _count: true }),
  ]);

  const permisosPorRol: Record<string, string[]> = { ...DEFAULTS };
  for (const f of filas) permisosPorRol[f.role] = f.permisos;

  const conteoUsuarios: Record<string, number> = {};
  for (const u of usuarios) conteoUsuarios[u.role] = u._count;

  return (
    <GestorRoles
      permisosPorRol={permisosPorRol}
      conteoUsuarios={conteoUsuarios}
      miRol={session.role as Role}
      soySuperadmin={session.esSuperadmin}
    />
  );
}
