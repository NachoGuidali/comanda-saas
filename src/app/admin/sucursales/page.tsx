import { db } from '@/lib/db';
import { requireSession } from '@/lib/session';
import GestorSucursales from '@/components/admin/GestorSucursales';
import { limitesDe } from '@/lib/plan';

export const dynamic = 'force-dynamic';

export default async function SucursalesPage() {
  const s = await requireSession('sucursales.gestionar');

  const [sucursales, tenant] = await Promise.all([
    db.branch.findMany({
      where: { tenantId: s.tenantId },
      orderBy: { position: 'asc' },
      include: {
        _count: { select: { orders: true, products: true, users: true } },
      },
    }),
    db.tenant.findUniqueOrThrow({ where: { id: s.tenantId }, include: { plan: true } }),
  ]);

  return (
    <GestorSucursales
      sucursales={JSON.parse(JSON.stringify(sucursales))}
      maximo={limitesDe(tenant).maxBranches}
    />
  );
}
