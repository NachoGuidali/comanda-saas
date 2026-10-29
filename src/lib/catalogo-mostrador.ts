import { db } from './db';
import { precioConPromo, type PromoAplicable } from './promos';
import { infoMitad } from './mitad';
import type { CategoriaMostrador } from '@/components/admin/NuevoPedidoMostrador';

/**
 * La carta para cargar pedidos desde el local (mostrador, teléfono, mozo).
 * Los precios son los que se van a cobrar: con las promos del día y, en la
 * mitad y mitad, según cómo la cobre el local.
 */
export async function catalogoMostrador(branchId: string): Promise<CategoriaMostrador[]> {
  const [categorias, promos, branch] = await Promise.all([
    db.category.findMany({
      where: { branchId, active: true },
      orderBy: { position: 'asc' },
      include: {
        products: {
          where: { active: true },
          orderBy: { position: 'asc' },
          include: {
            variants: { where: { active: true }, orderBy: { position: 'asc' } },
            addons: {
              orderBy: { position: 'asc' },
              include: { options: { where: { active: true }, orderBy: { position: 'asc' } } },
            },
          },
        },
      },
    }),
    db.promotion.findMany({
      where: { branchId, active: true, type: { in: ['PRODUCTO_PORCENTAJE', 'PRODUCTO_PRECIO'] } },
      include: { products: { select: { productId: true } } },
    }),
    db.branch.findUnique({ where: { id: branchId }, select: { precioMitad: true } }),
  ]);

  const promosAuto: PromoAplicable[] = promos.map((p) => ({
    id: p.id, title: p.title, type: p.type, value: p.value, days: p.days,
    startsAt: p.startsAt, endsAt: p.endsAt, productIds: p.products.map((x) => x.productId),
  }));
  return armarCatalogo(categorias, promosAuto, branch?.precioMitad ?? 'FIJO');
}

/** Porcentaje de promo vigente de un producto con tamaños, o null. */
export function descuentoVigente(productId: string, promos: PromoAplicable[]): number | null {
  const r = precioConPromo(productId, 1_000_000, true, promos).precio;
  return r < 1_000_000 ? (1_000_000 - r) / 10_000 : null;
}

type CategoriaDb = {
  id: string; name: string;
  products: {
    id: string; name: string; price: number;
    variants: { id: string; name: string; price: number }[];
    addons: { id: string; name: string; minPick: number; maxPick: number; esMitad: boolean | null; options: { id: string; name: string; price: number }[] }[];
  }[];
};

export function armarCatalogo(categorias: CategoriaDb[], promosAuto: PromoAplicable[], modoMitad: string): CategoriaMostrador[] {
  const plano = categorias.flatMap((c) => c.products);
  return categorias
    .filter((c) => c.products.length > 0)
    .map((c) => ({
      id: c.id,
      name: c.name,
      products: c.products.map((p) => {
        const conVariantes = p.variants.length > 0;
        return {
          id: p.id,
          name: p.name,
          price: precioConPromo(p.id, p.price, conVariantes, promosAuto).precio,
          variants: p.variants.map((v) => ({
            id: v.id, name: v.name, price: precioConPromo(p.id, v.price, conVariantes, promosAuto).precio,
          })),
          addons: p.addons.map((g) => ({
            id: g.id, name: g.name, minPick: g.minPick, maxPick: g.maxPick,
            options: g.options.map((o) => ({ id: o.id, name: o.name, price: o.price })),
          })),
          mitad: infoMitad(modoMitad, p, plano, (id) => descuentoVigente(id, promosAuto)),
        };
      }),
    }));
}
