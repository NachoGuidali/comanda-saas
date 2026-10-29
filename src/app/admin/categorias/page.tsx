import { db } from '@/lib/db';
import { requireSession } from '@/lib/session';
import GestorCategorias from '@/components/admin/GestorCategorias';

export const dynamic = 'force-dynamic';

export default async function CategoriasPage() {
  const s = await requireSession('carta.ver');

  const categorias = await db.category.findMany({
    where: { branchId: s.branchId },
    orderBy: [{ position: 'asc' }, { name: 'asc' }],
    include: { _count: { select: { products: true } } },
  });

  return <GestorCategorias categorias={categorias} />;
}
