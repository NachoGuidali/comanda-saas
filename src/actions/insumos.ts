'use server';

import { revalidatePath } from 'next/cache';
import type { ExpensePayment, Prisma } from '@prisma/client';
import { db } from '@/lib/db';
import { requireSession, puede, tieneFuncion } from '@/lib/session';
import { toCents } from '@/lib/money';
import { claveDia } from '@/lib/tiempo';
import { FORMAS_PAGO_GASTO } from '@/lib/gastos';
import { guardarGasto } from '@/lib/gastos-guardar';
import { IDS_UNIDAD, aMilesimas, mostrarCantidad, type Unidad } from '@/lib/insumos';
import { IDS_TIPO_MERMA, ETIQUETA_TIPO_MERMA } from '@/lib/mermas';

type Resultado = { ok: true; aviso?: string } | { ok: false; error: string };

/** Tope de una sola carga: 100.000 kg, litros o unidades */
const TOPE = 100_000_000;

function refrescar() {
  revalidatePath('/admin/insumos');
}

async function insumoDeLaSucursal(id: string, branchId: string) {
  return db.supply.findFirst({ where: { id, branchId } });
}

// ─────────── Alta y edición ───────────

/** Crea o edita un insumo: nombre, unidad y desde cuánto avisa que se acaba. */
export async function guardarInsumo(datos: { id?: string; nombre: string; unidad: string; minimo: string }): Promise<Resultado> {
  const s = await requireSession();
  if (!tieneFuncion(s, 'insumos')) return { ok: false, error: 'Tu plan no incluye Insumos y recetas' };
  if (!puede(s, 'insumos.mover', 'recetas.editar')) return { ok: false, error: 'No tenés permiso para cargar insumos' };

  const nombre = String(datos.nombre ?? '').trim().slice(0, 80);
  const unidad = String(datos.unidad) as Unidad;
  if (!nombre) return { ok: false, error: 'Poné el nombre, por ejemplo "Muzzarella"' };
  if (!IDS_UNIDAD.includes(unidad)) return { ok: false, error: 'Elegí la unidad' };
  const minimo = String(datos.minimo ?? '').trim() ? aMilesimas(String(datos.minimo), unidad) : 0;
  if (minimo === null || minimo < 0 || minimo > TOPE) return { ok: false, error: 'Revisá el mínimo: un número, por ejemplo 2 o 2,5' };

  const repetido = await db.supply.findFirst({
    where: { branchId: s.branchId, name: { equals: nombre, mode: 'insensitive' }, ...(datos.id ? { NOT: { id: datos.id } } : {}) },
  });
  if (repetido) return { ok: false, error: `Ya hay un insumo "${repetido.name}"${repetido.active ? '' : ' archivado'}` };

  if (datos.id) {
    const actual = await insumoDeLaSucursal(datos.id, s.branchId);
    if (!actual) return { ok: false, error: 'Ese insumo no es de esta sucursal' };
    // Cambiar la unidad con stock o recetas cargadas cambiaría el sentido de esos números
    if (actual.unit !== unidad) {
      const usado = actual.stock !== 0 || (await db.recipeItem.count({ where: { supplyId: actual.id } })) > 0;
      if (usado) return { ok: false, error: 'No se puede cambiar la unidad de un insumo con stock o en recetas. Creá uno nuevo.' };
    }
    await db.supply.update({ where: { id: actual.id }, data: { name: nombre, unit: unidad, minimum: minimo } });
  } else {
    const ultimo = await db.supply.aggregate({ where: { branchId: s.branchId }, _max: { position: true } });
    await db.supply.create({
      data: { branchId: s.branchId, name: nombre, unit: unidad, minimum: minimo, position: (ultimo._max.position ?? 0) + 1 },
    });
  }
  refrescar();
  return { ok: true };
}

/** Archiva o vuelve a activar. Archivado deja de descontarse por receta. */
export async function archivarInsumo(id: string, activo: boolean): Promise<Resultado> {
  const s = await requireSession();
  if (!tieneFuncion(s, 'insumos')) return { ok: false, error: 'Tu plan no incluye Insumos y recetas' };
  if (!puede(s, 'insumos.mover', 'recetas.editar')) return { ok: false, error: 'No tenés permiso' };
  const actual = await insumoDeLaSucursal(id, s.branchId);
  if (!actual) return { ok: false, error: 'Ese insumo no es de esta sucursal' };
  await db.$transaction(async (tx) => {
    await tx.supply.update({ where: { id }, data: { active: activo } });
    // Archivado sale de las recetas: si no, se seguiría descontando
    if (!activo) await tx.recipeItem.deleteMany({ where: { supplyId: id } });
  });
  refrescar();
  return { ok: true };
}

// ─────────── Movimientos ───────────

async function mover(
  tx: Prisma.TransactionClient,
  supplyId: string,
  delta: number,
  datos: { type: string; reason?: string | null; lossType?: string | null; userId: string; expenseId?: string | null }
) {
  const s = await tx.supply.update({ where: { id: supplyId }, data: { stock: { increment: delta } }, select: { stock: true } });
  await tx.supplyMovement.create({
    data: {
      supplyId, type: datos.type, quantity: delta, before: s.stock - delta, after: s.stock,
      reason: datos.reason ?? null, lossType: datos.lossType ?? null, userId: datos.userId, expenseId: datos.expenseId ?? null,
    },
  });
}

/**
 * Entró mercadería: "5 kg de muzzarella". Si se pone lo que se pagó, queda
 * también como gasto de Mercadería con la misma fecha y usuario, para no
 * cargarlo dos veces.
 */
export async function entradaInsumo(datos: {
  id: string; cantidad: string; monto?: string; proveedor?: string; pago?: string;
}): Promise<Resultado> {
  const s = await requireSession();
  if (!tieneFuncion(s, 'insumos')) return { ok: false, error: 'Tu plan no incluye Insumos y recetas' };
  if (!puede(s, 'insumos.mover')) return { ok: false, error: 'No tenés permiso para cargar insumos' };
  const insumo = await insumoDeLaSucursal(datos.id, s.branchId);
  if (!insumo) return { ok: false, error: 'Ese insumo no es de esta sucursal' };
  const unidad = insumo.unit as Unidad;

  const cantidad = aMilesimas(String(datos.cantidad ?? ''), unidad);
  if (cantidad === null || cantidad <= 0) return { ok: false, error: 'Poné cuánto entró, por ejemplo 5 o 2,5' };
  if (cantidad > TOPE) return { ok: false, error: 'Esa cantidad parece un error. Revisala.' };

  const conGasto = String(datos.monto ?? '').trim() !== '';
  const amount = conGasto ? toCents(String(datos.monto)) : 0;
  const payment = String(datos.pago || 'EFECTIVO') as ExpensePayment;
  const supplier = String(datos.proveedor ?? '').trim().slice(0, 100) || null;
  if (conGasto) {
    if (!puede(s, 'gastos.cargar')) return { ok: false, error: 'No tenés permiso para cargar gastos. Anotá la entrada sin el monto.' };
    if (amount <= 0) return { ok: false, error: 'Revisá el monto' };
    if (amount > 100_000_000_00) return { ok: false, error: 'Ese monto parece un error. Revisalo.' };
    if (!FORMAS_PAGO_GASTO.some((f) => f.id === payment)) return { ok: false, error: 'Elegí cómo se pagó' };
  }

  const texto = `${mostrarCantidad(cantidad, unidad)} de ${insumo.name}`;
  let aviso: string | undefined;
  await db.$transaction(async (tx) => {
    let expenseId: string | null = null;
    if (conGasto) {
      const g = await guardarGasto(tx, {
        branchId: s.branchId, userId: s.userId, fecha: claveDia(new Date()), category: 'MERCADERIA',
        description: `Compra: ${texto}`.slice(0, 200), supplier, amount, payment,
      });
      expenseId = g.id;
      aviso = g.aviso;
    }
    await mover(tx, insumo.id, cantidad, { type: 'ENTRADA', reason: supplier, userId: s.userId, expenseId });
  });

  refrescar();
  if (conGasto) {
    revalidatePath('/admin/gastos');
    revalidatePath('/admin/caja');
  }
  return { ok: true, aviso };
}

/**
 * Se contó lo que hay de verdad. Corrige el stock a ese número y deja la
 * diferencia anotada: es lo que la receta no explica (porciones más
 * generosas, pérdidas que no se anotaron).
 */
export async function contarInsumo(id: string, hay: string): Promise<Resultado> {
  const s = await requireSession();
  if (!tieneFuncion(s, 'insumos')) return { ok: false, error: 'Tu plan no incluye Insumos y recetas' };
  if (!puede(s, 'insumos.mover')) return { ok: false, error: 'No tenés permiso para cargar insumos' };
  const insumo = await insumoDeLaSucursal(id, s.branchId);
  if (!insumo) return { ok: false, error: 'Ese insumo no es de esta sucursal' };
  const cantidad = aMilesimas(String(hay ?? ''), insumo.unit as Unidad);
  if (cantidad === null || cantidad < 0) return { ok: false, error: 'Poné cuánto hay, por ejemplo 3,2 (o 0 si no queda)' };
  if (cantidad > TOPE) return { ok: false, error: 'Esa cantidad parece un error. Revisala.' };

  await db.$transaction(async (tx) => {
    // Se relee dentro de la transacción: si justo entró una venta, la diferencia es contra lo último
    const actual = await tx.supply.findUniqueOrThrow({ where: { id }, select: { stock: true } });
    const delta = cantidad - actual.stock;
    if (delta !== 0) await mover(tx, id, delta, { type: 'AJUSTE', reason: 'Conteo', userId: s.userId });
    else {
      await tx.supplyMovement.create({
        data: { supplyId: id, type: 'AJUSTE', quantity: 0, before: actual.stock, after: actual.stock, reason: 'Conteo', userId: s.userId },
      });
    }
  });
  refrescar();
  return { ok: true };
}

/** Se perdió: se venció, se cayó, se usó para otra cosa. Mismos tipos que las mermas de productos. */
export async function mermaInsumo(id: string, cantidadTexto: string, tipo: string, detalle: string): Promise<Resultado> {
  const s = await requireSession();
  if (!tieneFuncion(s, 'insumos')) return { ok: false, error: 'Tu plan no incluye Insumos y recetas' };
  if (!puede(s, 'insumos.mover', 'mermas.anotar')) return { ok: false, error: 'No tenés permiso para anotar mermas' };
  const insumo = await insumoDeLaSucursal(id, s.branchId);
  if (!insumo) return { ok: false, error: 'Ese insumo no es de esta sucursal' };
  if (!IDS_TIPO_MERMA.includes(tipo)) return { ok: false, error: 'Elegí qué pasó' };
  const d = String(detalle ?? '').trim().slice(0, 150);
  if (tipo === 'OTRO' && !d) return { ok: false, error: 'Contá qué pasó' };
  const cantidad = aMilesimas(String(cantidadTexto ?? ''), insumo.unit as Unidad);
  if (cantidad === null || cantidad <= 0) return { ok: false, error: 'Poné cuánto se perdió' };
  if (cantidad > TOPE) return { ok: false, error: 'Esa cantidad parece un error. Revisala.' };

  await db.$transaction((tx) =>
    mover(tx, id, -cantidad, { type: 'MERMA', reason: d || ETIQUETA_TIPO_MERMA[tipo], lossType: tipo, userId: s.userId })
  );
  refrescar();
  revalidatePath('/admin/mermas');
  return { ok: true };
}

// ─────────── Recetas ───────────

export type LineaReceta = { supplyId: string; variantId: string | null; cantidad: string };

/**
 * Guarda la receta de un producto o de un extra, reemplazando la anterior.
 * La cantidad se escribe en la unidad chica: gramos, mililitros o unidades.
 * En un producto con tamaños, cada línea es de un tamaño.
 */
export async function guardarReceta(
  destino: { productId: string } | { addonOptionId: string },
  lineas: LineaReceta[]
): Promise<Resultado> {
  const s = await requireSession();
  if (!tieneFuncion(s, 'insumos')) return { ok: false, error: 'Tu plan no incluye Insumos y recetas' };
  if (!puede(s, 'recetas.editar')) return { ok: false, error: 'No tenés permiso para editar recetas' };
  if (!Array.isArray(lineas) || lineas.length > 60) return { ok: false, error: 'Revisá la receta' };

  let productId: string | null = null;
  let addonOptionId: string | null = null;
  let variantes: string[] = [];
  let nombre = '';
  if ('productId' in destino) {
    const p = await db.product.findFirst({
      where: { id: destino.productId, branchId: s.branchId },
      select: { id: true, name: true, variants: { select: { id: true } } },
    });
    if (!p) return { ok: false, error: 'Ese producto no es de esta sucursal' };
    productId = p.id;
    nombre = p.name;
    variantes = p.variants.map((v) => v.id);
  } else {
    const o = await db.addonOption.findFirst({
      where: { id: destino.addonOptionId, group: { product: { branchId: s.branchId } } },
      select: { id: true, name: true },
    });
    if (!o) return { ok: false, error: 'Ese extra no es de esta sucursal' };
    addonOptionId = o.id;
    nombre = o.name;
  }

  const insumos = await db.supply.findMany({
    where: { branchId: s.branchId, active: true, id: { in: lineas.map((l) => String(l.supplyId)) } },
    select: { id: true, name: true, unit: true },
  });

  const datos: Prisma.RecipeItemCreateManyInput[] = [];
  const vistos = new Set<string>();
  for (const l of lineas) {
    const insumo = insumos.find((i) => i.id === String(l.supplyId));
    if (!insumo) return { ok: false, error: 'Un insumo de la receta ya no existe o está archivado' };
    const variantId = productId && variantes.length > 0 ? (l.variantId ? String(l.variantId) : null) : null;
    if (variantId && !variantes.includes(variantId)) return { ok: false, error: `Un tamaño de ${nombre} cambió. Recargá la página.` };
    if (productId && variantes.length > 0 && !variantId) return { ok: false, error: `Elegí el tamaño en cada línea de ${nombre}` };
    const clave = `${insumo.id}|${variantId ?? ''}`;
    if (vistos.has(clave)) return { ok: false, error: `${insumo.name} está dos veces para el mismo tamaño` };
    vistos.add(clave);
    const cantidad = aMilesimas(String(l.cantidad ?? ''), insumo.unit as Unidad, 'chica');
    if (cantidad === null || cantidad <= 0) {
      return { ok: false, error: `Poné cuánto ${insumo.name} lleva${insumo.unit === 'U' ? '' : insumo.unit === 'L' ? ' (en ml)' : ' (en gramos)'}` };
    }
    if (cantidad > 1_000_000) return { ok: false, error: `Revisá la cantidad de ${insumo.name}` };
    datos.push({ supplyId: insumo.id, productId, variantId, addonOptionId, quantity: cantidad });
  }

  await db.$transaction(async (tx) => {
    await tx.recipeItem.deleteMany({ where: productId ? { productId } : { addonOptionId } });
    if (datos.length) await tx.recipeItem.createMany({ data: datos });
  });
  refrescar();
  return { ok: true };
}
