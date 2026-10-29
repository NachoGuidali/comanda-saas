import { db } from '@/lib/db';
import { requireSession } from '@/lib/session';
import GestorProductos from '@/components/admin/GestorProductos';

export const dynamic = 'force-dynamic';

export default async function ProductosPage() {
  const s = await requireSession('carta.ver');

  const [productos, categorias, otras] = await Promise.all([
    db.product.findMany({
      where: { branchId: s.branchId },
      orderBy: [{ categoryId: 'asc' }, { position: 'asc' }, { name: 'asc' }],
      include: {
        variants: { where: { active: true }, orderBy: { position: 'asc' } },
        addons: { orderBy: { position: 'asc' }, include: { options: { orderBy: { position: 'asc' } } } },
      },
    }),
    db.category.findMany({
      where: { branchId: s.branchId },
      orderBy: { position: 'asc' },
      select: { id: true, name: true },
    }),
    db.branch.findMany({
      where: {
        id: { not: s.branchId },
        tenantId: s.tenantId,
        ...(s.esSuperadmin ? {} : { id: { in: s.sucursales.map((x) => x.id) } }),
      },
      select: { id: true, name: true, _count: { select: { products: true } } },
    }),
  ]);

  return (
    <GestorProductos
      productos={JSON.parse(JSON.stringify(productos))}
      categorias={categorias}
      sucursalNombre={s.branchName}
      otrasSucursales={otras.filter((o) => o._count.products > 0).map((o) => ({ id: o.id, name: o.name }))}
      puedeEditar={s.esSuperadmin || s.permisos.includes('carta.editar')}
    />
  );
}
