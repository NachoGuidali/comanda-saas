import { db } from '@/lib/db';
import { requireSession } from '@/lib/session';
import GestorPromociones from '@/components/admin/GestorPromociones';

export const dynamic = 'force-dynamic';

export default async function PromocionesPage() {
  const s = await requireSession('carta.ver');

  const [promos, productos] = await Promise.all([
    db.promotion.findMany({
      where: { branchId: s.branchId },
      orderBy: [{ position: 'asc' }, { createdAt: 'desc' }],
      include: { products: { select: { productId: true } } },
    }),
    db.product.findMany({
      where: { branchId: s.branchId, active: true },
      orderBy: [{ categoryId: 'asc' }, { name: 'asc' }],
      include: { category: { select: { name: true } }, variants: { select: { id: true } } },
    }),
  ]);

  return (
    <GestorPromociones
      promos={JSON.parse(JSON.stringify(promos))}
      productos={productos.map((p) => ({
        id: p.id, name: p.name, categoria: p.category.name, tieneVariantes: p.variants.length > 0,
      }))}
    />
  );
}
