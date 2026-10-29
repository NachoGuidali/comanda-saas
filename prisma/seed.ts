import { PrismaClient, type Role } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { DEFAULTS } from '../src/lib/permisos';
import { cargarInsumos } from './insumos-demo';

const db = new PrismaClient();

/** Los precios se escriben en pesos y se guardan en centavos. */
const p = (pesos: number) => Math.round(pesos * 100);

const slug = (s: string) =>
  s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

type ProductoSeed = {
  name: string;
  description?: string;
  price?: number;
  variants?: { name: string; price: number }[];
  addons?: { name: string; minPick: number; maxPick: number; esMitad?: boolean; options: { name: string; price: number }[] }[];
  trackStock?: boolean;
  stock?: number;
};

const extrasPizza = {
  name: 'Extras',
  minPick: 0,
  maxPick: 4,
  options: [
    { name: 'Doble muzzarella', price: p(2200) },
    { name: 'Jamón', price: p(1900) },
    { name: 'Huevo', price: p(900) },
    { name: 'Aceitunas', price: p(700) },
    { name: 'Morrón', price: p(800) },
    { name: 'Rúcula', price: p(1100) },
  ],
};

const gustosMitad = ['Muzzarella', 'Napolitana', 'Fugazzeta', 'Calabresa', 'Cuatro quesos'].map((name) => ({ name, price: 0 }));

/** La carta base. Cada sucursal la carga con su propio ajuste de precios. */
function carta(ajuste = 1): { categoria: string; productos: ProductoSeed[] }[] {
  const $ = (n: number) => p(Math.round((n * ajuste) / 100) * 100);

  return [
    {
      categoria: 'Pizzas',
      productos: [
        {
          name: 'Muzzarella',
          description: 'Salsa de tomate, muzzarella, aceitunas y orégano.',
          variants: [{ name: 'Chica', price: $(9500) }, { name: 'Grande', price: $(13500) }],
          addons: [extrasPizza],
        },
        {
          name: 'Napolitana',
          description: 'Muzzarella, rodajas de tomate fresco y ajo.',
          variants: [{ name: 'Chica', price: $(10800) }, { name: 'Grande', price: $(15200) }],
          addons: [extrasPizza],
        },
        {
          name: 'Fugazzeta rellena',
          description: 'Rellena de muzzarella con cebolla dorada arriba.',
          variants: [{ name: 'Chica', price: $(13200) }, { name: 'Grande', price: $(18500) }],
          addons: [extrasPizza],
        },
        {
          name: 'Calabresa',
          description: 'Muzzarella, longaniza calabresa y morrones asados.',
          variants: [{ name: 'Chica', price: $(12400) }, { name: 'Grande', price: $(17200) }],
          addons: [extrasPizza],
        },
        {
          name: 'Cuatro quesos',
          description: 'Muzzarella, roquefort, provolone y parmesano.',
          variants: [{ name: 'Chica', price: $(13800) }, { name: 'Grande', price: $(19200) }],
          addons: [extrasPizza],
        },
        {
          // Los dos gustos son grupos obligatorios de una opción: el cliente no
          // puede olvidarse de elegirlos, y en la comanda salen como
          // "+ Muzzarella  + Calabresa" en vez de perderse en una nota.
          // El precio es el del gusto más caro de la carta.
          name: 'Mitad y mitad',
          description: 'Elegí un gusto para cada mitad.',
          variants: [{ name: 'Chica', price: $(13800) }, { name: 'Grande', price: $(19200) }],
          addons: [
            { name: 'Primera mitad', minPick: 1, maxPick: 1, esMitad: true, options: gustosMitad },
            { name: 'Segunda mitad', minPick: 1, maxPick: 1, esMitad: true, options: gustosMitad },
            extrasPizza,
          ],
        },
      ],
    },
    {
      categoria: 'Empanadas',
      productos: [
        { name: 'Empanada de carne', description: 'Corte a cuchillo, con huevo y aceituna.', price: $(1800) },
        { name: 'Empanada de jamón y queso', price: $(1700) },
        { name: 'Empanada de humita', price: $(1700) },
        { name: 'Empanada de pollo', price: $(1800) },
        { name: 'Docena surtida', description: 'Doce empanadas. Aclarános los gustos al final del pedido.', price: $(19500) },
      ],
    },
    {
      categoria: 'Para compartir',
      productos: [
        { name: 'Fainá', description: 'La porción clásica de garbanzo.', price: $(2400) },
        { name: 'Papas fritas', description: 'Porción grande para dos.', price: $(7800) },
        { name: 'Papas con cheddar y panceta', price: $(11500) },
      ],
    },
    {
      categoria: 'Bebidas',
      productos: [
        {
          name: 'Gaseosa línea Coca-Cola',
          variants: [{ name: '500 ml', price: $(2200) }, { name: '1.5 L', price: $(3800) }],
          trackStock: true, stock: 48,
        },
        { name: 'Agua mineral 500 ml', price: $(1800), trackStock: true, stock: 36 },
        { name: 'Cerveza artesanal pinta', price: $(4200), trackStock: true, stock: 24 },
        { name: 'Vino de la casa', price: $(6500), trackStock: true, stock: 12 },
      ],
    },
    {
      categoria: 'Postres',
      productos: [
        { name: 'Flan casero con dulce de leche', price: $(4500), trackStock: true, stock: 10 },
        { name: 'Helado dos bochas', price: $(3800), trackStock: true, stock: 20 },
      ],
    },
  ];
}

async function cargarCarta(branchId: string, bloques: ReturnType<typeof carta>) {
  for (const [i, bloque] of bloques.entries()) {
    const categoria = await db.category.create({
      data: { branchId, name: bloque.categoria, slug: slug(bloque.categoria), position: i },
    });

    for (const [j, prod] of bloque.productos.entries()) {
      await db.product.create({
        data: {
          branchId,
          categoryId: categoria.id,
          name: prod.name,
          slug: slug(prod.name),
          description: prod.description,
          price: prod.price ?? 0,
          position: j,
          trackStock: prod.trackStock ?? false,
          stock: prod.stock ?? 0,
          prepMinutes: bloque.categoria === 'Pizzas' ? 20 : 10,
          variants: prod.variants
            ? { create: prod.variants.map((v, k) => ({ ...v, position: k, stock: prod.stock ?? 0 })) }
            : undefined,
          addons: prod.addons
            ? {
                create: prod.addons.map((g, k) => ({
                  name: g.name, minPick: g.minPick, maxPick: g.maxPick, position: k, esMitad: g.esMitad ?? null,
                  options: { create: g.options.map((o, l) => ({ ...o, position: l })) },
                })),
              }
            : undefined,
        },
      });
    }
  }
}

async function main() {
  console.log('Cargando datos de Pepperino...');

  // ─────────── El cliente de la demo: Pepperino Pizza ───────────
  // Entra por pepperino.<dominio>. Su marca y sus colores son los de la
  // pizzería: verde #17320B, rojo #AF0A0A, blanco.
  // Planes de ejemplo (los precios se ponen en el panel de la plataforma)
  if ((await db.plan.count()) === 0) {
    await db.plan.createMany({
      data: [
        { name: 'Básico', price: 0, maxBranches: 1, maxUsers: 5, features: [], position: 0 },
        { name: 'Completo', price: 0, maxBranches: 1, maxUsers: 0, features: ['salon', 'insumos', 'sueldos', 'pago_online'], position: 1 },
        { name: 'Cadena', price: 0, maxBranches: 5, maxUsers: 0, features: ['salon', 'insumos', 'sueldos', 'pago_online'], position: 2 },
      ],
    });
  }
  const cadena = await db.plan.findUnique({ where: { name: 'Cadena' } });

  const tenant = await db.tenant.upsert({
    where: { slug: 'pepperino' },
    update: {},
    create: {
      slug: 'pepperino',
      name: 'Pepperino Pizza',
      slogan: 'Como en casa, pero con el toque Pepperino',
      colorPrimary: '#17320B',
      colorAccent: '#AF0A0A',
      colorBackground: '#FFFFFF',
      planId: cadena?.id ?? null,
      // Demo: el pago online muestra la pantalla de prueba, no cobra
      mpMode: 'simulado',
      contactName: 'Pepperino', contactEmail: 'super@pepperino.com',
    },
  });
  const tenantId = tenant.id;

  // ─────────── Permisos por rol ───────────
  for (const [role, permisos] of Object.entries(DEFAULTS)) {
    await db.rolePermisos.upsert({
      where: { tenantId_role: { tenantId, role: role as Role } },
      update: {},
      create: { tenantId, role: role as Role, permisos },
    });
  }

  // ─────────── Sucursales ───────────
  const adrogue = await db.branch.upsert({
    where: { tenantId_slug: { tenantId, slug: 'adrogue' } },
    update: {},
    create: {
      tenantId,
      name: 'Pepperino Adrogué',
      slug: 'adrogue',
      eslogan: 'Como en casa, pero con el toque Pepperino',
      address: 'Av. Hipólito Yrigoyen 1234, Adrogué',
      phone: '11 4294-0000',
      whatsapp: '5491163589975',
      instagram: 'pepperinopizzasok',
      aliasBancario: 'pepperino.adrogue',
      googleResenas: '',
      position: 0,
      active: true,
    },
  });

  const burzaco = await db.branch.upsert({
    where: { tenantId_slug: { tenantId, slug: 'burzaco' } },
    update: {},
    create: {
      tenantId,
      name: 'Pepperino Burzaco',
      slug: 'burzaco',
      eslogan: 'Como en casa, pero con el toque Pepperino',
      address: 'Av. Antártida Argentina 850, Burzaco',
      phone: '11 4238-0000',
      whatsapp: '5491163589975',
      instagram: 'pepperinopizzasok',
      aliasBancario: 'pepperino.burzaco',
      googleResenas: '',
      tiempoDelivery: '45-60',
      position: 1,
      active: true,
    },
  });

  const locales = [adrogue, burzaco];

  // ─────────── Horarios ───────────
  for (const b of locales) {
    for (let d = 0; d < 7; d++) {
      await db.businessHour.upsert({
        where: { branchId_dayOfWeek: { branchId: b.id, dayOfWeek: d } },
        update: {},
        create: {
          branchId: b.id,
          dayOfWeek: d,
          openTime: '19:00',
          closeTime: d === 5 || d === 6 ? '01:00' : '23:59',
          closed: d === 1, // cierra los lunes
        },
      });
    }
  }

  // ─────────── Usuarios ───────────
  const usuarios: {
    name: string; email: string; password: string; role: Role; sucursales: string[];
  }[] = [
    { name: 'Dueño', email: 'super@pepperino.com', password: 'super1234', role: 'SUPERADMIN', sucursales: [] },
    { name: 'Encargado Adrogué', email: 'adrogue@pepperino.com', password: 'admin1234', role: 'ADMIN', sucursales: [adrogue.id] },
    { name: 'Encargado Burzaco', email: 'burzaco@pepperino.com', password: 'admin1234', role: 'ADMIN', sucursales: [burzaco.id] },
    { name: 'Caja Adrogué', email: 'caja@pepperino.com', password: 'caja1234', role: 'CAJERO', sucursales: [adrogue.id] },
    { name: 'Cocina Adrogué', email: 'cocina@pepperino.com', password: 'cocina1234', role: 'COCINA', sucursales: [adrogue.id] },
    { name: 'Moza Adrogué', email: 'mozo@pepperino.com', password: 'mozo1234', role: 'MOZO', sucursales: [adrogue.id] },
    { name: 'Nicolás Reparto', email: 'reparto@pepperino.com', password: 'reparto1234', role: 'REPARTIDOR', sucursales: [adrogue.id, burzaco.id] },
  ];

  for (const u of usuarios) {
    const creado = await db.user.upsert({
      where: { tenantId_email: { tenantId, email: u.email } },
      update: {},
      create: {
        tenantId,
        name: u.name,
        email: u.email,
        passwordHash: await bcrypt.hash(u.password, 10),
        role: u.role,
      },
    });
    for (const branchId of u.sucursales) {
      await db.userBranch.upsert({
        where: { userId_branchId: { userId: creado.id, branchId } },
        update: {},
        create: { userId: creado.id, branchId },
      });
    }
  }

  // ─────────── Zonas de envío, propias de cada local ───────────
  const zonasPorLocal: Record<string, { name: string; fee: number }[]> = {
    [adrogue.id]: [
      { name: 'Adrogué centro', fee: p(900) },
      { name: 'Lomas de Zamora', fee: p(1600) },
      { name: 'Temperley', fee: p(1400) },
    ],
    [burzaco.id]: [
      { name: 'Burzaco centro', fee: p(900) },
      { name: 'Longchamps', fee: p(1400) },
      { name: 'Glew', fee: p(1800) },
    ],
  };

  for (const b of locales) {
    if ((await db.deliveryZone.count({ where: { branchId: b.id } })) > 0) continue;
    await db.deliveryZone.createMany({
      data: zonasPorLocal[b.id].map((z, i) => ({ ...z, branchId: b.id, position: i })),
    });
  }

  // ─────────── Mesas ───────────
  for (const b of locales) {
    if ((await db.table.count({ where: { branchId: b.id } })) > 0) continue;
    const mesas = [
      ...Array.from({ length: 8 }, (_, i) => ({ name: String(i + 1), capacity: 4, zone: 'Salón' })),
      ...Array.from({ length: 3 }, (_, i) => ({ name: String(i + 9), capacity: 6, zone: 'Salón' })),
      { name: '12', capacity: 10, zone: 'Entrepiso' },
      ...Array.from({ length: 4 }, (_, i) => ({ name: `V${i + 1}`, capacity: 2, zone: 'Vereda' })),
    ];
    await db.table.createMany({ data: mesas.map((m) => ({ ...m, branchId: b.id })) });
  }

  // ─────────── Cartas independientes ───────────
  // Burzaco arranca un 5% más barato: son cartas separadas, cada una con lo suyo.
  if ((await db.product.count({ where: { branchId: adrogue.id } })) === 0) {
    await cargarCarta(adrogue.id, carta(1));
  }
  if ((await db.product.count({ where: { branchId: burzaco.id } })) === 0) {
    await cargarCarta(burzaco.id, carta(0.95));
  }

  // ─────────── Insumos y recetas de ejemplo ───────────
  // Las cantidades van en milésimas: 5000 son 5 kg, 400 son 400 g.
  for (const b of locales) {
    if ((await db.supply.count({ where: { branchId: b.id } })) > 0) continue;
    await cargarInsumos(db, b.id);
  }

  // ─────────── Promociones, también por local ───────────
  for (const b of locales) {
    if ((await db.promotion.count({ where: { branchId: b.id } })) > 0) continue;

    const empanadas = await db.product.findMany({
      where: { branchId: b.id, category: { slug: 'empanadas' } },
      select: { id: true },
    });

    const martes = await db.promotion.create({
      data: {
        branchId: b.id,
        title: 'Martes de empanadas',
        description: 'Todas las empanadas con 20% off, sin código ni vueltas.',
        type: 'PRODUCTO_PORCENTAJE',
        value: 20,
        days: [2],
        active: true,
        position: 0,
      },
    });
    await db.promotionProduct.createMany({
      data: empanadas.map((e) => ({ promotionId: martes.id, productId: e.id })),
      skipDuplicates: true,
    });

    const faina = await db.product.findFirst({
      where: { branchId: b.id, slug: 'faina' },
      select: { id: true, price: true },
    });
    if (faina) {
      const promoFaina = await db.promotion.create({
        data: {
          branchId: b.id,
          title: 'Fainá a mitad de precio',
          description: 'Miércoles y jueves, para acompañar la pizza.',
          type: 'PRODUCTO_PRECIO',
          value: Math.round(faina.price / 2),
          days: [3, 4],
          active: true,
          position: 1,
        },
      });
      await db.promotionProduct.create({
        data: { promotionId: promoFaina.id, productId: faina.id },
      });
    }

    await db.promotion.createMany({
      data: [
        {
          branchId: b.id,
          title: 'Envío sin cargo',
          description: 'En pedidos desde $30.000.',
          type: 'ENVIO_GRATIS',
          code: 'ENVIOGRATIS',
          minOrder: p(30000),
          active: true,
          showPopup: true,
          position: 2,
        },
        {
          branchId: b.id,
          title: 'Pizza libre los jueves',
          description: 'Desde las 20 en el salón. Reservá tu mesa así te guardamos lugar.',
          type: 'BANNER',
          active: true,
          position: 3,
        },
      ],
    });
  }

  console.log('Listo.');
  console.log('');
  console.log(`  Cliente: Pepperino Pizza → pepperino.${process.env.SAAS_DOMINIO || 'localhost'}`);
  console.log('  Sucursales: /adrogue y /burzaco · panel en /admin');
  console.log('');
  console.log('  Usuarios:');
  for (const u of usuarios) {
    console.log(`    ${u.role.padEnd(11)} ${u.email.padEnd(26)} ${u.password}`);
  }
  console.log('');
  console.log('  Cambiá estas contraseñas antes de salir a producción.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
