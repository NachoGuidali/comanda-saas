import type { PrismaClient } from '@prisma/client';

/**
 * Insumos y recetas de ejemplo para la demo. Lo usa el seed y, en la demo de
 * Vercel, la preparación de la base (para una base que ya existía).
 * Las cantidades van en milésimas: 5000 son 5 kg, 400 son 400 g.
 */
export async function cargarInsumos(db: PrismaClient, branchId: string) {
  const datos = [
    { name: 'Muzzarella', unit: 'KG', stock: 12000, minimum: 4000 },
    { name: 'Salsa de tomate', unit: 'L', stock: 8000, minimum: 2000 },
    { name: 'Bollo de masa grande', unit: 'U', stock: 40000, minimum: 15000 },
    { name: 'Bollo de masa chica', unit: 'U', stock: 25000, minimum: 10000 },
    { name: 'Jamón cocido', unit: 'KG', stock: 2500, minimum: 1000 },
    { name: 'Tomate', unit: 'KG', stock: 3000, minimum: 1000 },
    { name: 'Cebolla', unit: 'KG', stock: 5000, minimum: 1500 },
    { name: 'Calabresa', unit: 'KG', stock: 1500, minimum: 500 },
    { name: 'Tapas de empanada', unit: 'U', stock: 120000, minimum: 36000 },
    { name: 'Relleno de carne', unit: 'KG', stock: 3000, minimum: 1000 },
  ];
  const ids: Record<string, string> = {};
  for (const [k, d] of datos.entries()) {
    const s = await db.supply.create({ data: { ...d, branchId, position: k } });
    ids[d.name] = s.id;
    await db.supplyMovement.create({
      data: { supplyId: s.id, type: 'AJUSTE', quantity: d.stock, before: 0, after: d.stock, reason: 'Stock inicial' },
    });
  }

  // Por pizza, según el tamaño: [chica, grande]
  const base: [string, number, number][] = [
    ['Salsa de tomate', 120, 180],
    ['Bollo de masa chica', 1000, 0],
    ['Bollo de masa grande', 0, 1000],
  ];
  const recetas: Record<string, [string, number, number][]> = {
    Muzzarella: [...base, ['Muzzarella', 280, 400]],
    Napolitana: [...base, ['Muzzarella', 280, 400], ['Tomate', 100, 150]],
    'Fugazzeta rellena': [...base, ['Muzzarella', 400, 600], ['Cebolla', 200, 300]],
    Calabresa: [...base, ['Muzzarella', 280, 400], ['Calabresa', 80, 120]],
  };
  for (const [nombre, lineas] of Object.entries(recetas)) {
    const prod = await db.product.findFirst({ where: { branchId, name: nombre }, include: { variants: true } });
    if (!prod) continue;
    for (const v of prod.variants) {
      const i = v.name === 'Grande' ? 2 : 1;
      for (const l of lineas) {
        if (!l[i]) continue;
        await db.recipeItem.create({ data: { supplyId: ids[l[0]], productId: prod.id, variantId: v.id, quantity: l[i] } });
      }
    }
    // Los extras de la pizza
    const extras = await db.addonOption.findMany({ where: { group: { productId: prod.id }, name: { in: ['Doble muzzarella', 'Jamón'] } } });
    for (const x of extras) {
      await db.recipeItem.create({
        data: x.name === 'Jamón'
          ? { supplyId: ids['Jamón cocido'], addonOptionId: x.id, quantity: 80 }
          : { supplyId: ids['Muzzarella'], addonOptionId: x.id, quantity: 150 },
      });
    }
  }
  const empanada = await db.product.findFirst({ where: { branchId, name: 'Empanada de carne' } });
  if (empanada) {
    await db.recipeItem.createMany({
      data: [
        { supplyId: ids['Tapas de empanada'], productId: empanada.id, quantity: 1000 },
        { supplyId: ids['Relleno de carne'], productId: empanada.id, quantity: 60 },
      ],
    });
  }
}
