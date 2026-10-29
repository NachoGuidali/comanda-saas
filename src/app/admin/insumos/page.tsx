import { redirect } from 'next/navigation';
import { db } from '@/lib/db';
import { requireSession, exigirFuncion, puede } from '@/lib/session';
import { FORMAS_PAGO_GASTO } from '@/lib/gastos';
import GestorInsumos from '@/components/admin/GestorInsumos';

export const dynamic = 'force-dynamic';

const DIA = 24 * 60 * 60_000;

/**
 * Lo que se usa para preparar (muzzarella, salsa, bollos): cuánto hay, lo que
 * entra, y las recetas con las que se descuenta solo con cada venta.
 */
export default async function InsumosPage() {
  const s = await requireSession();
  exigirFuncion(s, 'insumos');
  if (!puede(s, 'insumos.ver', 'recetas.editar')) redirect('/admin?error=sin-permiso');

  const hace30 = new Date(Date.now() - 30 * DIA);
  const hace14 = new Date(Date.now() - 14 * DIA);

  const [insumos, uso30, uso14, productos, movimientos] = await Promise.all([
    db.supply.findMany({
      where: { branchId: s.branchId },
      orderBy: [{ active: 'desc' }, { position: 'asc' }, { name: 'asc' }],
      select: { id: true, name: true, unit: true, stock: true, minimum: true, active: true, _count: { select: { receta: true } } },
    }),
    db.supplyMovement.groupBy({
      by: ['supplyId', 'type'],
      where: { supply: { branchId: s.branchId }, createdAt: { gte: hace30 } },
      _sum: { quantity: true },
    }),
    // Para estimar para cuántos días alcanza: lo vendido (neto de devoluciones) en 14 días
    db.supplyMovement.groupBy({
      by: ['supplyId'],
      where: { supply: { branchId: s.branchId }, type: { in: ['CONSUMO', 'DEVOLUCION'] }, createdAt: { gte: hace14 } },
      _sum: { quantity: true },
    }),
    db.product.findMany({
      where: { branchId: s.branchId, active: true },
      orderBy: [{ category: { position: 'asc' } }, { position: 'asc' }, { name: 'asc' }],
      select: {
        id: true, name: true,
        category: { select: { name: true } },
        variants: { where: { active: true }, orderBy: { position: 'asc' }, select: { id: true, name: true } },
        addons: {
          orderBy: { position: 'asc' },
          select: {
            id: true, name: true,
            options: {
              where: { active: true }, orderBy: { position: 'asc' },
              select: { id: true, name: true, receta: { select: { supplyId: true, quantity: true } } },
            },
          },
        },
        receta: { select: { supplyId: true, variantId: true, quantity: true } },
      },
    }),
    db.supplyMovement.findMany({
      where: { supply: { branchId: s.branchId } },
      orderBy: { createdAt: 'desc' },
      take: 300,
      select: {
        id: true, type: true, quantity: true, after: true, reason: true, lossType: true, orderCode: true, createdAt: true,
        supplyId: true, user: { select: { name: true } }, expense: { select: { amount: true, voidedAt: true } },
      },
    }),
  ]);

  const uso = (id: string, ...tipos: string[]) =>
    uso30.filter((u) => u.supplyId === id && tipos.includes(u.type)).reduce((a, u) => a + (u._sum.quantity ?? 0), 0);

  return (
    <GestorInsumos
      sucursal={s.branchName}
      insumos={insumos.map((i) => {
        const vendido14 = -(uso14.find((u) => u.supplyId === i.id)?._sum.quantity ?? 0);
        const porDia = vendido14 > 0 ? vendido14 / 14 : 0;
        return {
          id: i.id, name: i.name, unit: i.unit, stock: i.stock, minimum: i.minimum, active: i.active,
          enRecetas: i._count.receta,
          entro30: uso(i.id, 'ENTRADA'),
          vendido30: -uso(i.id, 'CONSUMO', 'DEVOLUCION'),
          perdido30: -uso(i.id, 'MERMA'),
          ajuste30: uso(i.id, 'AJUSTE'),
          diasQueAlcanza: porDia > 0 && i.stock > 0 ? Math.floor(i.stock / porDia) : null,
        };
      })}
      productos={productos.map((p) => ({
        id: p.id, name: p.name, categoria: p.category.name, variants: p.variants,
        receta: p.receta,
        extras: p.addons.flatMap((g) => g.options.map((o) => ({ id: o.id, name: o.name, grupo: g.name, receta: o.receta }))),
      }))}
      movimientos={movimientos.map((m) => ({
        id: m.id, type: m.type, quantity: m.quantity, after: m.after, reason: m.reason, lossType: m.lossType,
        orderCode: m.orderCode, createdAt: m.createdAt.toISOString(), supplyId: m.supplyId, user: m.user?.name ?? null,
        gasto: m.expense && !m.expense.voidedAt ? Number(m.expense.amount) : null,
      }))}
      formasPago={FORMAS_PAGO_GASTO.map((f) => ({ id: f.id, label: f.label }))}
      puedeMover={puede(s, 'insumos.mover')}
      puedeAnotarMerma={puede(s, 'insumos.mover', 'mermas.anotar')}
      puedeCargarGasto={puede(s, 'gastos.cargar')}
      puedeEditarRecetas={puede(s, 'recetas.editar')}
    />
  );
}
