import { db } from '@/lib/db';
import { requireSession, puede } from '@/lib/session';
import PantallaCocina from '@/components/admin/PantallaCocina';

export const dynamic = 'force-dynamic';

export default async function CocinaPage() {
  const s = await requireSession('cocina.ver');

  const pedidos = await db.order.findMany({
    where: { branchId: s.branchId, status: { in: ['ACEPTADO', 'EN_PREPARACION'] } },
    orderBy: { createdAt: 'asc' },
    include: {
      items: { include: { addons: true }, orderBy: { id: 'asc' } },
      table: { select: { name: true } },
      assignedTo: { select: { id: true, name: true } },
      zone: { select: { name: true } },
    },
  });

  return (
    <div>
      <h1 className="mb-5 font-display text-2xl">Cocina · {s.branchName}</h1>
      <PantallaCocina
        inicial={JSON.parse(JSON.stringify(pedidos))}
        puedeAvanzar={puede(s, 'cocina.avanzar', 'pedidos.avanzar')}
      />
    </div>
  );
}
