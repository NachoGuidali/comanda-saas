import { db } from '@/lib/db';
import { requirePlataforma } from '@/lib/plataforma';
import EditorPlanes from '@/components/plataforma/EditorPlanes';

export const dynamic = 'force-dynamic';

export default async function Planes() {
  await requirePlataforma();
  const planes = await db.plan.findMany({ orderBy: { position: 'asc' }, include: { _count: { select: { tenants: true } } } });
  return <EditorPlanes planes={planes.map((p) => ({ id: p.id, name: p.name, price: p.price, maxBranches: p.maxBranches, maxUsers: p.maxUsers, features: p.features, active: p.active, clientes: p._count.tenants }))} />;
}
