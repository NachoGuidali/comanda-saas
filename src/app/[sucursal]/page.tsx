import { notFound } from 'next/navigation';
import { db } from '@/lib/db';
import { sucursalPorSlug, estaAbierto, sucursalesPublicas } from '@/lib/sucursales';
import { requireTenant } from '@/lib/tenant';
import { limitesDe } from '@/lib/plan';
import { precioConPromo, type PromoAplicable } from '@/lib/promos';
import { infoMitad } from '@/lib/mitad';
import { descuentoVigente } from '@/lib/catalogo-mostrador';
import Carta from '@/components/tienda/Carta';
import { modoMP } from '@/lib/mercadopago';
import { credencialesDelCliente } from '@/lib/mp-cliente';

export const dynamic = 'force-dynamic';

export default async function CartaSucursal({ params }: { params: Promise<{ sucursal: string }> }) {
  const { sucursal } = await params;
  const tenant = await requireTenant();
  const branch = await sucursalPorSlug(tenant.id, sucursal);
  if (!branch) notFound();

  const [categorias, promos, zonas, abierto, otras] = await Promise.all([
    db.category.findMany({
      where: { branchId: branch.id, active: true },
      orderBy: { position: 'asc' },
      include: {
        products: {
          where: { active: true },
          orderBy: [{ position: 'asc' }, { name: 'asc' }],
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
      where: { branchId: branch.id, active: true, OR: [{ endsAt: null }, { endsAt: { gte: new Date() } }] },
      orderBy: { position: 'asc' },
      include: { products: { select: { productId: true } } },
    }),
    db.deliveryZone.findMany({
      where: { branchId: branch.id, active: true },
      orderBy: [{ position: 'asc' }, { fee: 'asc' }],
    }),
    estaAbierto(branch.id),
    sucursalesPublicas(tenant.id),
  ]);

  const promosAuto: PromoAplicable[] = promos
    .filter((p) => p.type === 'PRODUCTO_PORCENTAJE' || p.type === 'PRODUCTO_PRECIO')
    .map((p) => ({
      id: p.id, title: p.title, type: p.type, value: p.value, days: p.days,
      startsAt: p.startsAt, endsAt: p.endsAt,
      productIds: p.products.map((x) => x.productId),
    }));

  const plano = categorias.flatMap((c) => c.products);
  const conProductos = categorias
    .filter((c) => c.products.length > 0)
    .map((c) => ({
      ...c,
      products: c.products.map((prod) => {
        const tieneVariantes = prod.variants.length > 0;
        const base = precioConPromo(prod.id, prod.price, tieneVariantes, promosAuto);
        return {
          ...prod,
          price: base.precio,
          precioOriginal: base.precioOriginal,
          promoTitulo: base.promoTitulo,
          mitad: infoMitad(branch.precioMitad, prod, plano, (id) => descuentoVigente(id, promosAuto)),
          variants: prod.variants.map((v) => {
            const pv = precioConPromo(prod.id, v.price, tieneVariantes, promosAuto);
            return { ...v, price: pv.precio, precioOriginal: pv.precioOriginal };
          }),
        };
      }),
    }));

  return (
    <Carta
      branch={{
        id: branch.id, slug: branch.slug, name: branch.name, eslogan: branch.eslogan,
        address: branch.address, phone: branch.phone, whatsapp: branch.whatsapp,
        instagram: branch.instagram, tiempoDelivery: branch.tiempoDelivery,
        tiempoTakeaway: branch.tiempoTakeaway, mensajeCerrado: branch.mensajeCerrado,
        aliasBancario: branch.aliasBancario, aceptaPedidos: branch.aceptaPedidos,
      }}
      otrasSucursales={otras.filter((o) => o.id !== branch.id).map((o) => ({ slug: o.slug, name: o.name }))}
      categorias={conProductos}
      promos={promos}
      zonas={zonas}
      abierto={abierto}
      pagoOnline={modoMP(await credencialesDelCliente(tenant.id)) !== 'apagado'}
      reservas={limitesDe(tenant).funciones.includes('salon')}
    />
  );
}
