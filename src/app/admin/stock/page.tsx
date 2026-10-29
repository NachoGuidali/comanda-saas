import { db } from '@/lib/db';
import { requireSession } from '@/lib/session';
import GestorStock from '@/components/admin/GestorStock';

export const dynamic = 'force-dynamic';

export default async function StockPage() {
  const s = await requireSession('stock.ver');

  const incluir = {
    category: { select: { name: true } },
    variants: { where: { active: true }, orderBy: { position: 'asc' as const } },
  };

  const [productos, todos, movimientos] = await Promise.all([
    db.product.findMany({
      where: { branchId: s.branchId, trackStock: true },
      orderBy: [{ stock: 'asc' }, { name: 'asc' }],
      include: incluir,
    }),
    db.product.findMany({
      where: { branchId: s.branchId, active: true },
      orderBy: [{ categoryId: 'asc' }, { name: 'asc' }],
      include: incluir,
    }),
    db.stockMovement.findMany({
      where: { product: { branchId: s.branchId } },
      orderBy: { createdAt: 'desc' },
      take: 80,
      include: {
        product: { select: { name: true } },
        variant: { select: { name: true } },
        user: { select: { name: true } },
      },
    }),
  ]);

  return (
    <GestorStock
      productos={JSON.parse(JSON.stringify(productos))}
      todos={JSON.parse(JSON.stringify(todos))}
      movimientos={JSON.parse(JSON.stringify(movimientos))}
      puedeMover={s.esSuperadmin || s.permisos.includes('stock.mover')}
      puedeControlar={s.esSuperadmin || s.permisos.includes('stock.control')}
    />
  );
}
