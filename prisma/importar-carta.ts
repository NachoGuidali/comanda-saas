/**
 * Carga la carta de un cliente desde un archivo JSON (ver prisma/cartas/):
 *
 *   npx tsx prisma/importar-carta.ts --cliente pepperino --archivo prisma/cartas/pepperino.json \
 *     [--sucursal adrogue] [--reemplazar]
 *
 * Sin --sucursal, la carga en todas las sucursales del cliente. Si la sucursal
 * ya tiene productos, hace falta --reemplazar: borra la carta anterior. Los
 * productos que ya tienen pedidos no se borran (los pedidos viejos los
 * necesitan): quedan ocultos.
 *
 * Con Docker: docker compose run --rm tools npx tsx prisma/importar-carta.ts ...
 *
 * Formato del archivo (precios en pesos):
 *   { "categorias": [ { "nombre": "Pizzas", "minutos": 20, "productos": [
 *       { "nombre": "Muzzarella", "descripcion": "...",
 *         "precio": 1000,                                   ← sin tamaños
 *         "tamanos": [{ "nombre": "Grande", "precio": 19000 }],
 *         "opciones": [{ "nombre": "Sabor", "min": 1, "max": 1,
 *                        "opciones": [{ "nombre": "Caprese", "precio": 0 }] }],
 *         "activo": false } ] } ] }                         ← oculto en la carta
 */
import { readFileSync } from 'fs';
import type { Prisma } from '@prisma/client';
import { db } from '../src/lib/db';

type Opcion = { nombre: string; precio: number };
type Producto = {
  nombre: string;
  descripcion?: string;
  precio?: number;
  tamanos?: Opcion[];
  opciones?: { nombre: string; min: number; max: number; opciones: Opcion[] }[];
  activo?: boolean;
};
type Carta = { categorias: { nombre: string; descripcion?: string; minutos?: number; productos: Producto[] }[] };

function argumentos(): Record<string, string> {
  const a = process.argv.slice(2);
  const r: Record<string, string> = {};
  for (let i = 0; i < a.length; i++) {
    if (!a[i].startsWith('--')) continue;
    const siguiente = a[i + 1];
    r[a[i].slice(2)] = siguiente && !siguiente.startsWith('--') ? siguiente : 'si';
  }
  return r;
}

const slugify = (s: string) =>
  s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

/** Pesos a centavos, que es como se guardan. */
const centavos = (pesos: number) => Math.round(pesos * 100);

const precioValido = (n: unknown) => typeof n === 'number' && Number.isFinite(n) && n >= 0;

/** Junta todos los errores del archivo antes de tocar la base. */
function revisar(carta: Carta): string[] {
  const errores: string[] = [];
  if (!Array.isArray(carta?.categorias) || carta.categorias.length === 0) return ['El archivo no tiene categorías'];
  for (const c of carta.categorias) {
    if (!c.nombre?.trim()) errores.push('Hay una categoría sin nombre');
    for (const p of c.productos ?? []) {
      const donde = `${c.nombre} / ${p.nombre ?? '(sin nombre)'}`;
      if (!p.nombre?.trim()) errores.push(`${donde}: falta el nombre`);
      if (p.tamanos?.length) {
        if (p.tamanos.some((t) => !t.nombre?.trim() || !precioValido(t.precio))) errores.push(`${donde}: hay un tamaño sin nombre o sin precio`);
      } else if (!precioValido(p.precio)) {
        errores.push(`${donde}: falta el precio`);
      }
      for (const g of p.opciones ?? []) {
        if (!g.nombre?.trim() || !g.opciones?.length) errores.push(`${donde}: el grupo de opciones "${g.nombre ?? ''}" está vacío`);
        if (g.opciones?.some((o) => !o.nombre?.trim() || !precioValido(o.precio))) errores.push(`${donde}: hay una opción sin nombre o sin precio`);
        if (!(g.min >= 0 && g.max >= Math.max(1, g.min))) errores.push(`${donde}: mínimo y máximo de "${g.nombre}" no cierran`);
      }
    }
  }
  return errores;
}

/** Oculta lo que tiene pedidos y borra lo demás. El slug se libera para la carta nueva. */
async function vaciar(tx: Prisma.TransactionClient, branchId: string) {
  let ocultos = 0;
  let borrados = 0;
  const productos = await tx.product.findMany({ where: { branchId }, select: { id: true, slug: true, _count: { select: { items: true } } } });
  for (const p of productos) {
    if (p._count.items > 0) {
      // Ya oculto por una carga anterior: queda como estaba
      if (p.slug.includes('-anterior-')) continue;
      await tx.product.update({ where: { id: p.id }, data: { active: false, featured: false, slug: `${p.slug}-anterior-${p.id.slice(-6)}` } });
      ocultos++;
    } else {
      await tx.product.delete({ where: { id: p.id } });
      borrados++;
    }
  }
  const categorias = await tx.category.findMany({ where: { branchId }, select: { id: true, slug: true, _count: { select: { products: true } } } });
  for (const c of categorias) {
    if (c._count.products > 0) {
      if (!c.slug.includes('-anterior-')) await tx.category.update({ where: { id: c.id }, data: { active: false, slug: `${c.slug}-anterior-${c.id.slice(-6)}` } });
    } else await tx.category.delete({ where: { id: c.id } });
  }
  return { borrados, ocultos };
}

async function cargar(tx: Prisma.TransactionClient, branchId: string, carta: Carta) {
  const usados = new Set<string>();
  // Dos productos con el mismo nombre en distintas categorías no pueden tener la misma dirección
  const unico = (base: string, categoria: string) => {
    let s = slugify(base) || 'producto';
    if (usados.has(s)) s = `${s}-${slugify(categoria)}`;
    for (let n = 2; usados.has(s); n++) s = `${slugify(base)}-${n}`;
    usados.add(s);
    return s;
  };
  let productos = 0;
  for (const [i, c] of carta.categorias.entries()) {
    const categoria = await tx.category.create({
      data: { branchId, name: c.nombre.trim(), slug: slugify(c.nombre), description: c.descripcion, position: i },
    });
    for (const [j, p] of c.productos.entries()) {
      await tx.product.create({
        data: {
          branchId,
          categoryId: categoria.id,
          name: p.nombre.trim(),
          slug: unico(p.nombre, c.nombre),
          description: p.descripcion?.trim() || null,
          price: p.tamanos?.length ? 0 : centavos(p.precio ?? 0),
          active: p.activo ?? true,
          position: j,
          prepMinutes: c.minutos ?? 15,
          variants: p.tamanos?.length
            ? { create: p.tamanos.map((t, k) => ({ name: t.nombre.trim(), price: centavos(t.precio), position: k })) }
            : undefined,
          addons: p.opciones?.length
            ? {
                create: p.opciones.map((g, k) => ({
                  name: g.nombre.trim(), minPick: g.min, maxPick: g.max, position: k,
                  options: { create: g.opciones.map((o, l) => ({ name: o.nombre.trim(), price: centavos(o.precio), position: l })) },
                })),
              }
            : undefined,
        },
      });
      productos++;
    }
  }
  return productos;
}

async function main() {
  const a = argumentos();
  if (!a.cliente || !a.archivo) {
    console.error('Uso: npx tsx prisma/importar-carta.ts --cliente <slug> --archivo <carta.json> [--sucursal <slug>] [--reemplazar]');
    process.exit(1);
  }

  let carta: Carta;
  try {
    carta = JSON.parse(readFileSync(a.archivo, 'utf8'));
  } catch (e) {
    console.error(`No se pudo leer ${a.archivo}: ${(e as Error).message}`);
    process.exit(1);
  }
  const errores = revisar(carta);
  if (errores.length) {
    console.error('El archivo tiene errores, no se cargó nada:\n  ' + errores.join('\n  '));
    process.exit(1);
  }

  const tenant = await db.tenant.findUnique({ where: { slug: a.cliente } });
  if (!tenant) { console.error(`No existe el cliente "${a.cliente}"`); process.exit(1); }
  const sucursales = await db.branch.findMany({
    where: { tenantId: tenant.id, ...(a.sucursal ? { slug: a.sucursal } : {}) },
    orderBy: { name: 'asc' },
  });
  if (sucursales.length === 0) { console.error(a.sucursal ? `${tenant.name} no tiene la sucursal "${a.sucursal}"` : `${tenant.name} no tiene sucursales`); process.exit(1); }

  // Primero se revisan todas: o se cargan todas, o ninguna
  for (const b of sucursales) {
    const hay = await db.product.count({ where: { branchId: b.id } });
    if (hay > 0 && !a.reemplazar) {
      console.error(`${b.name} ya tiene ${hay} productos. Para cambiar su carta por la del archivo, agregá --reemplazar.`);
      process.exit(1);
    }
  }

  for (const b of sucursales) {
    const r = await db.$transaction(async (tx) => {
      const antes = await vaciar(tx, b.id);
      const cargados = await cargar(tx, b.id, carta);
      return { ...antes, cargados };
    }, { timeout: 120_000 });
    const anterior = r.borrados + r.ocultos > 0
      ? ` (carta anterior: ${r.borrados} borrados${r.ocultos ? `, ${r.ocultos} ocultos porque tienen pedidos` : ''})`
      : '';
    console.log(`${b.name}: ${r.cargados} productos en ${carta.categorias.length} categorías${anterior}`);
  }
  const inactivos = carta.categorias.flatMap((c) => c.productos.filter((p) => p.activo === false).map((p) => p.nombre));
  if (inactivos.length) console.log(`Ocultos hasta que les pongas precio: ${inactivos.join(', ')}`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => db.$disconnect());
