'use server';

import { revalidatePath } from 'next/cache';
import { db } from '@/lib/db';
import { exigir } from '@/lib/session';
import { toCents } from '@/lib/money';
import type { PromoType } from '@prisma/client';

function slugify(texto: string): string {
  return texto
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

/** Los slugs son únicos dentro de cada sucursal: las dos pueden tener su muzzarella. */
async function slugUnico(base: string, branchId: string, tabla: 'product' | 'category', excluirId?: string) {
  let slug = slugify(base) || 'item';
  let i = 1;
  while (true) {
    const existe =
      tabla === 'product'
        ? await db.product.findFirst({ where: { branchId, slug }, select: { id: true } })
        : await db.category.findFirst({ where: { branchId, slug }, select: { id: true } });
    if (!existe || existe.id === excluirId) return slug;
    slug = `${slugify(base)}-${++i}`;
  }
}

function refrescar() {
  revalidatePath('/', 'layout');
  revalidatePath('/admin/productos');
  revalidatePath('/admin/categorias');
}

// ─────────── Categorías ───────────

export async function guardarCategoria(fd: FormData) {
  const s = await exigir('carta.editar');
  const id = String(fd.get('id') || '');
  const name = String(fd.get('name') || '').trim();
  if (!name) return { ok: false as const, error: 'Poné un nombre para la categoría' };

  if (id) {
    const propia = await db.category.findFirst({ where: { id, branchId: s.branchId } });
    if (!propia) return { ok: false as const, error: 'Esa categoría no es de esta sucursal' };
  }

  const data = {
    name,
    slug: await slugUnico(name, s.branchId, 'category', id || undefined),
    description: String(fd.get('description') || '') || null,
    imageUrl: String(fd.get('imageUrl') || '') || null,
    position: Number(fd.get('position') || 0),
    active: fd.get('active') === 'on' || fd.get('active') === 'true',
  };

  if (id) await db.category.update({ where: { id }, data });
  else await db.category.create({ data: { ...data, branchId: s.branchId } });

  refrescar();
  return { ok: true as const };
}

export async function borrarCategoria(id: string) {
  const s = await exigir('carta.editar');
  const cat = await db.category.findFirst({ where: { id, branchId: s.branchId } });
  if (!cat) return { ok: false as const, error: 'Esa categoría no es de esta sucursal' };

  const conProductos = await db.product.count({ where: { categoryId: id } });
  if (conProductos > 0) {
    return { ok: false as const, error: `Esa categoría tiene ${conProductos} productos. Movelos primero.` };
  }
  await db.category.delete({ where: { id } });
  refrescar();
  return { ok: true as const };
}

// ─────────── Productos ───────────

export async function guardarProducto(fd: FormData) {
  const s = await exigir('carta.editar');
  const id = String(fd.get('id') || '');
  const name = String(fd.get('name') || '').trim();
  const categoryId = String(fd.get('categoryId') || '');
  if (!name) return { ok: false as const, error: 'Poné un nombre para el producto' };
  if (!categoryId) return { ok: false as const, error: 'Elegí una categoría' };

  const cat = await db.category.findFirst({ where: { id: categoryId, branchId: s.branchId } });
  if (!cat) return { ok: false as const, error: 'Esa categoría no es de esta sucursal' };

  if (id) {
    const propio = await db.product.findFirst({ where: { id, branchId: s.branchId } });
    if (!propio) return { ok: false as const, error: 'Ese producto no es de esta sucursal' };
  }

  // Tocar precios puede estar restringido aunque se pueda editar la carta
  const puedePrecios = s.esSuperadmin || s.permisos.includes('carta.precios');

  // Tamaños y adicionales vienen como JSON. Se validan ANTES de guardar nada,
  // para no dejar el producto a medio actualizar si algo viene mal.
  type VarianteIn = { id?: string; name: string; price: string };
  type GrupoIn = { id?: string; name: string; minPick: number; maxPick: number; esMitad?: boolean | null; options: { id?: string; name: string; price: string }[] };
  let variantes: VarianteIn[] | null = null;
  let grupos: GrupoIn[] | null = null;
  try {
    const vRaw = String(fd.get('variants') || '');
    if (vRaw) variantes = (JSON.parse(vRaw) as VarianteIn[]).filter((v) => String(v.name ?? '').trim());
    const gRaw = String(fd.get('addons') || '');
    if (gRaw) grupos = (JSON.parse(gRaw) as GrupoIn[]).filter((g) => String(g.name ?? '').trim());
  } catch {
    return { ok: false as const, error: 'Los tamaños o adicionales llegaron mal. Recargá la página y probá de nuevo.' };
  }
  for (const v of variantes ?? []) {
    if (toCents(String(v.price)) <= 0) return { ok: false as const, error: `Poné el precio del tamaño "${v.name}"` };
  }
  for (const g of grupos ?? []) {
    g.minPick = Math.max(0, Math.trunc(Number(g.minPick) || 0));
    g.maxPick = Math.max(0, Math.trunc(Number(g.maxPick) || 0));
    g.options = (g.options ?? []).filter((o) => String(o.name ?? '').trim());
    if (g.options.length === 0) return { ok: false as const, error: `El grupo "${g.name}" no tiene opciones` };
    if (g.maxPick > 0 && g.minPick > g.maxPick) {
      return { ok: false as const, error: `En "${g.name}", el mínimo no puede ser mayor que el máximo` };
    }
    if (g.minPick > g.options.length) {
      return { ok: false as const, error: `En "${g.name}" se piden ${g.minPick} pero hay ${g.options.length} opciones` };
    }
    if (g.options.some((o) => toCents(String(o.price)) < 0)) return { ok: false as const, error: `En "${g.name}" hay un precio negativo` };
  }
  const precioBase = toCents(String(fd.get('price') || '0'));
  const tendraVariantes = variantes ? variantes.length > 0 : id ? (await db.variant.count({ where: { productId: id, active: true } })) > 0 : false;
  if (puedePrecios && !tendraVariantes && precioBase <= 0) {
    return { ok: false as const, error: 'Poné el precio, o agregá tamaños con su precio' };
  }

  const data = {
    name,
    slug: await slugUnico(name, s.branchId, 'product', id || undefined),
    description: String(fd.get('description') || '') || null,
    imageUrl: String(fd.get('imageUrl') || '') || null,
    categoryId,
    active: fd.get('active') === 'on' || fd.get('active') === 'true',
    featured: fd.get('featured') === 'on' || fd.get('featured') === 'true',
    position: Number(fd.get('position') || 0),
    trackStock: fd.get('trackStock') === 'on' || fd.get('trackStock') === 'true',
    lowStock: Math.max(0, Math.trunc(Number(fd.get('lowStock') || 5)) || 0),
    prepMinutes: Math.max(0, Math.trunc(Number(fd.get('prepMinutes') || 15)) || 0),
    ...(puedePrecios ? { price: precioBase } : {}),
  };

  const producto = id
    ? await db.product.update({ where: { id }, data })
    : await db.product.create({
        data: {
          ...data,
          branchId: s.branchId,
          price: puedePrecios ? precioBase : 0,
          stock: Math.max(0, Math.trunc(Number(fd.get('stock') || 0)) || 0),
        },
      });

  // Variantes. Las que se sacan de la lista y ya se vendieron se desactivan
  // en vez de borrarse, para no romper los pedidos viejos que las nombran.
  if (variantes && puedePrecios) {
    const propias = await db.variant.findMany({ where: { productId: producto.id }, select: { id: true } });
    const idsPropios = new Set(propias.map((v) => v.id));
    const quedan = variantes.filter((v) => v.id && idsPropios.has(v.id)).map((v) => v.id!);
    const sacadas = propias.map((v) => v.id).filter((id) => !quedan.includes(id));
    for (const id of sacadas) {
      const usada = (await db.orderItem.count({ where: { variantId: id } })) + (await db.stockMovement.count({ where: { variantId: id } }));
      if (usada > 0) await db.variant.update({ where: { id }, data: { active: false } });
      else await db.variant.delete({ where: { id } });
    }
    for (const [i, v] of variantes.entries()) {
      const payload = { name: v.name.trim().slice(0, 60), price: toCents(v.price), position: i, active: true };
      if (v.id && idsPropios.has(v.id)) await db.variant.update({ where: { id: v.id }, data: payload });
      else await db.variant.create({ data: { ...payload, productId: producto.id, stock: 0 } });
    }
  }

  // Grupos de adicionales. Se actualizan en el lugar en vez de borrarse y
  // recrearse: así los IDs no cambian y un cliente que tenía "doble muzza" en
  // el carrito no lo pierde en silencio porque alguien corrigió un precio.
  if (grupos) {
    const existentes = await db.addonGroup.findMany({ where: { productId: producto.id }, include: { options: true } });
    const porId = new Map(existentes.map((g) => [g.id, g]));
    const gruposQueQuedan = grupos.filter((g) => g.id && porId.has(g.id)).map((g) => g.id!);
    await db.addonGroup.deleteMany({ where: { productId: producto.id, id: { notIn: gruposQueQuedan.length ? gruposQueQuedan : ['-'] } } });

    for (const [i, g] of grupos.entries()) {
      const datosGrupo = {
        name: g.name.trim().slice(0, 60), minPick: g.minPick, maxPick: g.maxPick, position: i,
        esMitad: typeof g.esMitad === 'boolean' ? g.esMitad : null,
      };
      const previo = g.id ? porId.get(g.id) : undefined;
      if (!previo) {
        await db.addonGroup.create({
          data: {
            ...datosGrupo,
            productId: producto.id,
            options: { create: g.options.map((o, j) => ({ name: o.name.trim().slice(0, 60), price: toCents(o.price), position: j })) },
          },
        });
        continue;
      }
      await db.addonGroup.update({ where: { id: previo.id }, data: datosGrupo });
      const idsOpciones = new Set(previo.options.map((o) => o.id));
      const opcionesQueQuedan = g.options.filter((o) => o.id && idsOpciones.has(o.id)).map((o) => o.id!);
      await db.addonOption.deleteMany({ where: { groupId: previo.id, id: { notIn: opcionesQueQuedan.length ? opcionesQueQuedan : ['-'] } } });
      for (const [j, o] of g.options.entries()) {
        const datosOpcion = { name: o.name.trim().slice(0, 60), price: toCents(o.price), position: j };
        if (o.id && idsOpciones.has(o.id)) await db.addonOption.update({ where: { id: o.id }, data: datosOpcion });
        else await db.addonOption.create({ data: { ...datosOpcion, groupId: previo.id } });
      }
    }
  }

  refrescar();
  return { ok: true as const, id: producto.id };
}

export async function borrarProducto(id: string) {
  const s = await exigir('carta.editar');
  const propio = await db.product.findFirst({ where: { id, branchId: s.branchId } });
  if (!propio) return { ok: false as const, error: 'Ese producto no es de esta sucursal' };

  const vendido = await db.orderItem.count({ where: { productId: id } });
  if (vendido > 0) {
    // Nunca borramos algo que aparece en pedidos históricos: lo desactivamos.
    await db.product.update({ where: { id }, data: { active: false } });
    refrescar();
    return { ok: true as const, desactivado: true };
  }
  await db.product.delete({ where: { id } });
  refrescar();
  return { ok: true as const };
}

export async function alternarProducto(id: string, active: boolean) {
  const s = await exigir('carta.editar');
  await db.product.updateMany({ where: { id, branchId: s.branchId }, data: { active } });
  refrescar();
  return { ok: true as const };
}

/** Copia la carta entera de otra sucursal. Útil al abrir un local nuevo. */
export async function copiarCarta(desdeBranchId: string) {
  const s = await exigir('carta.editar');
  if (desdeBranchId === s.branchId) {
    return { ok: false as const, error: 'Es la misma sucursal' };
  }
  if (!s.sucursales.some((x) => x.id === desdeBranchId)) {
    return { ok: false as const, error: 'No tenés acceso a esa sucursal' };
  }
  // Copiar dos veces duplicaba toda la carta
  const yaTiene = await db.product.count({ where: { branchId: s.branchId } });
  if (yaTiene > 0) {
    return { ok: false as const, error: 'Esta sucursal ya tiene productos. La copia es solo para arrancar un local vacío.' };
  }

  const categorias = await db.category.findMany({
    where: { branchId: desdeBranchId },
    include: {
      products: {
        include: { variants: true, addons: { include: { options: true } } },
      },
    },
    orderBy: { position: 'asc' },
  });

  let copiados = 0;
  for (const cat of categorias) {
    const nuevaCat = await db.category.create({
      data: {
        branchId: s.branchId,
        name: cat.name,
        slug: await slugUnico(cat.name, s.branchId, 'category'),
        description: cat.description,
        imageUrl: cat.imageUrl,
        position: cat.position,
        active: cat.active,
      },
    });

    for (const p of cat.products) {
      await db.product.create({
        data: {
          branchId: s.branchId,
          categoryId: nuevaCat.id,
          name: p.name,
          slug: await slugUnico(p.name, s.branchId, 'product'),
          description: p.description,
          imageUrl: p.imageUrl,
          price: p.price,
          active: p.active,
          featured: p.featured,
          position: p.position,
          trackStock: p.trackStock,
          // El stock NO se copia: cada local tiene el suyo
          stock: 0,
          lowStock: p.lowStock,
          prepMinutes: p.prepMinutes,
          variants: { create: p.variants.map((v) => ({ name: v.name, price: v.price, position: v.position, stock: 0 })) },
          addons: {
            create: p.addons.map((g) => ({
              name: g.name, minPick: g.minPick, maxPick: g.maxPick, position: g.position, esMitad: g.esMitad,
              options: { create: g.options.map((o) => ({ name: o.name, price: o.price, position: o.position })) },
            })),
          },
        },
      });
      copiados++;
    }
  }

  refrescar();
  return { ok: true as const, copiados };
}

// ─────────── Promociones ───────────

export async function guardarPromocion(fd: FormData) {
  const s = await exigir('promos.editar');
  const id = String(fd.get('id') || '');
  const title = String(fd.get('title') || '').trim();
  if (!title) return { ok: false as const, error: 'Poné un título para la promo' };

  if (id) {
    const propia = await db.promotion.findFirst({ where: { id, branchId: s.branchId } });
    if (!propia) return { ok: false as const, error: 'Esa promoción no es de esta sucursal' };
  }

  const type = String(fd.get('type') || 'BANNER') as PromoType;
  const codigo = String(fd.get('code') || '').toUpperCase().trim();
  const automatica = type === 'PRODUCTO_PORCENTAJE' || type === 'PRODUCTO_PRECIO';

  // Sin días marcados es "todos los días". Ojo con el vacío: Number('') es 0
  // (domingo), y antes una promo de todos los días quedaba solo los domingos.
  const days = [...new Set(
    String(fd.get('days') || '')
      .split(',')
      .map((d) => d.trim())
      .filter((d) => /^[0-6]$/.test(d))
      .map(Number)
  )];

  const productIds = String(fd.get('productIds') || '')
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean);

  if (automatica && productIds.length === 0) {
    return { ok: false as const, error: 'Elegí al menos un producto para esta promo' };
  }

  if (automatica) {
    const ajenos = await db.product.count({
      where: { id: { in: productIds }, branchId: { not: s.branchId } },
    });
    if (ajenos > 0) return { ok: false as const, error: 'Hay productos de otra sucursal en la selección' };
  }

  // Un precio fijo no se puede aplicar a un producto con varios tamaños
  if (type === 'PRODUCTO_PRECIO' && productIds.length > 0) {
    const conVariantes = await db.product.findMany({
      where: { id: { in: productIds }, variants: { some: {} } },
      select: { name: true },
    });
    if (conVariantes.length > 0) {
      return {
        ok: false as const,
        error: `Estos productos tienen tamaños y no admiten precio fijo: ${conVariantes
          .map((p) => p.name)
          .join(', ')}. Usá descuento por porcentaje.`,
      };
    }
  }

  const TIPOS: PromoType[] = ['PORCENTAJE', 'MONTO_FIJO', 'ENVIO_GRATIS', 'BANNER', 'PRODUCTO_PORCENTAJE', 'PRODUCTO_PRECIO'];
  if (!TIPOS.includes(type)) return { ok: false as const, error: 'Tipo de promoción inválido' };

  const esPorcentaje = type === 'PORCENTAJE' || type === 'PRODUCTO_PORCENTAJE';
  const valor = esPorcentaje
    ? Math.round(Number(String(fd.get('value') || '0').replace(',', '.')))
    : toCents(String(fd.get('value') || '0'));
  if (esPorcentaje && !(valor >= 1 && valor <= 100)) {
    return { ok: false as const, error: 'El porcentaje tiene que estar entre 1 y 100' };
  }
  if ((type === 'MONTO_FIJO' || type === 'PRODUCTO_PRECIO') && valor <= 0) {
    return { ok: false as const, error: 'Poné el monto de la promo' };
  }

  const conCodigo = type === 'PORCENTAJE' || type === 'MONTO_FIJO' || type === 'ENVIO_GRATIS';
  if (conCodigo && !codigo) return { ok: false as const, error: 'Esta promo necesita un código para que el cliente lo escriba' };
  if (codigo) {
    const repetido = await db.promotion.findFirst({
      where: { branchId: s.branchId, code: codigo, ...(id ? { id: { not: id } } : {}) },
      select: { title: true },
    });
    if (repetido) return { ok: false as const, error: `El código ${codigo} ya lo usa la promo "${repetido.title}"` };
  }

  // Las fechas del formulario son días del calendario del local: "desde el 1"
  // arranca a las 00:00 y "hasta el 5" termina a las 23:59 del 5, hora local.
  const dia = (campo: string, finDelDia: boolean) => {
    const v = String(fd.get(campo) || '');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return null;
    return new Date(`${v}T${finDelDia ? '23:59:59.999' : '00:00:00'}`);
  };
  const startsAt = dia('startsAt', false);
  const endsAt = dia('endsAt', true);
  if (startsAt && endsAt && endsAt < startsAt) {
    return { ok: false as const, error: 'La fecha de fin es anterior a la de inicio' };
  }

  const data = {
    title: title.slice(0, 120),
    description: String(fd.get('description') || '') || null,
    imageUrl: String(fd.get('imageUrl') || '') || null,
    type,
    value: valor,
    code: conCodigo ? codigo : null,
    minOrder: toCents(String(fd.get('minOrder') || '0')),
    active: fd.get('active') === 'on' || fd.get('active') === 'true',
    showPopup: fd.get('showPopup') === 'on' || fd.get('showPopup') === 'true',
    startsAt,
    endsAt,
    position: Number(fd.get('position') || 0),
    days,
  };

  const promo = id
    ? await db.promotion.update({ where: { id }, data })
    : await db.promotion.create({ data: { ...data, branchId: s.branchId } });

  await db.promotionProduct.deleteMany({ where: { promotionId: promo.id } });
  if (automatica && productIds.length > 0) {
    await db.promotionProduct.createMany({
      data: productIds.map((productId) => ({ promotionId: promo.id, productId })),
      skipDuplicates: true,
    });
  }

  revalidatePath('/', 'layout');
  revalidatePath('/admin/promociones');
  return { ok: true as const };
}

export async function borrarPromocion(id: string) {
  const s = await exigir('promos.editar');
  await db.promotion.deleteMany({ where: { id, branchId: s.branchId } });
  revalidatePath('/', 'layout');
  revalidatePath('/admin/promociones');
  return { ok: true as const };
}

// ─────────── Zonas de envío ───────────

export async function guardarZona(fd: FormData) {
  const s = await exigir('config.editar');
  const id = String(fd.get('id') || '');
  const name = String(fd.get('name') || '').trim();
  if (!name) return { ok: false as const, error: 'Poné un nombre para la zona' };

  const data = {
    name,
    fee: Math.max(0, toCents(String(fd.get('fee') || '0'))),
    active: fd.get('active') !== 'false',
    position: Number(fd.get('position') || 0),
  };

  if (id) await db.deliveryZone.updateMany({ where: { id, branchId: s.branchId }, data });
  else await db.deliveryZone.create({ data: { ...data, branchId: s.branchId } });

  revalidatePath('/', 'layout');
  revalidatePath('/admin/config');
  return { ok: true as const };
}

export async function borrarZona(id: string) {
  const s = await exigir('config.editar');
  const usada = await db.order.count({ where: { zoneId: id } });
  if (usada > 0) await db.deliveryZone.updateMany({ where: { id, branchId: s.branchId }, data: { active: false } });
  else await db.deliveryZone.deleteMany({ where: { id, branchId: s.branchId } });

  revalidatePath('/', 'layout');
  revalidatePath('/admin/config');
  return { ok: true as const };
}
