/**
 * Precio de la pizza mitad y mitad. Cada local elige en Configuración:
 *
 *   FIJO      El precio del producto "Mitad y mitad", sea cual sea el gusto.
 *   MAS_CARA  El de la mitad más cara en ese tamaño: mitad muzza y mitad
 *             jamón sale como una entera de jamón.
 *   PROMEDIO  El promedio de las dos mitades, redondeado a $100 para arriba.
 *
 * El gusto de cada mitad es una opción de un grupo "Primera mitad" o
 * "Segunda mitad". Su precio se busca en la pizza del mismo nombre ("Fugazzeta"
 * encuentra "Fugazzeta rellena"), en el tamaño elegido. Si no se encuentra
 * ninguna, se cobra el precio fijo. Sin base de datos: lo usa también la carta.
 */

export const MODOS_MITAD = [
  { id: 'FIJO', label: 'Precio fijo', ayuda: 'Lo que diga el producto "Mitad y mitad", sin importar los gustos.' },
  { id: 'MAS_CARA', label: 'La mitad más cara', ayuda: 'Mitad muzza y mitad jamón sale lo mismo que una entera de jamón.' },
  { id: 'PROMEDIO', label: 'Promedio de las dos', ayuda: 'Se suma la mitad de cada una, redondeado a $100 para arriba.' },
] as const;

export type ModoMitad = (typeof MODOS_MITAD)[number]['id'];
export const IDS_MODO_MITAD: string[] = MODOS_MITAD.map((m) => m.id);

/** Un grupo es de gustos de mitad si se marcó así, o si no se dijo nada y se llama "...mitad...". */
export function esGrupoMitad(g: { esMitad?: boolean | null; name: string }): boolean {
  return g.esMitad ?? /mitad/i.test(g.name);
}

type ProductoCatalogo = { id: string; name: string; price: number; variants: { name: string; price: number }[] };

const normal = (t: string) => t.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();

/** La pizza de ese gusto: mismo nombre, o que empiece con ese nombre ("Fugazzeta" → "Fugazzeta rellena"). */
export function pizzaDelGusto<T extends ProductoCatalogo>(gusto: string, catalogo: T[], excluir?: string): T | null {
  const g = normal(gusto);
  if (!g) return null;
  const candidatos = catalogo.filter((p) => p.id !== excluir);
  return candidatos.find((p) => normal(p.name) === g) ?? candidatos.find((p) => normal(p.name).startsWith(g + ' ')) ?? null;
}

/** Precio de un gusto en un tamaño (por nombre de tamaño: "Grande"). Null si no se encuentra. */
export function precioDelGusto(gusto: string, tamano: string | null, catalogo: ProductoCatalogo[], excluir?: string): number | null {
  const p = pizzaDelGusto(gusto, catalogo, excluir);
  if (!p) return null;
  if (p.variants.length === 0) return p.price;
  if (!tamano) return null;
  return p.variants.find((v) => normal(v.name) === normal(tamano))?.price ?? null;
}

/** El precio base según el modo. `gustos` son los precios de las mitades elegidas que se encontraron. */
export function precioBaseMitad(modo: string, fijo: number, gustos: number[]): number {
  if (modo === 'FIJO' || gustos.length === 0) return fijo;
  if (modo === 'MAS_CARA') return Math.max(...gustos);
  if (modo === 'PROMEDIO') {
    const promedio = gustos.reduce((a, b) => a + b, 0) / gustos.length;
    return Math.ceil(promedio / 10000) * 10000;
  }
  return fijo;
}

/**
 * Para la carta y el mostrador: el precio de cada gusto en cada tamaño del
 * producto mitad y mitad, por id de opción y de tamaño. Vacío si el producto
 * no tiene grupos de mitad.
 */
export function tablaDeGustos(
  producto: { id: string; variants: { id: string; name: string }[]; addons: { esMitad?: boolean | null; name: string; options: { id: string; name: string }[] }[] },
  catalogo: ProductoCatalogo[]
): Record<string, Record<string, number>> {
  const tabla: Record<string, Record<string, number>> = {};
  for (const g of producto.addons) {
    if (!esGrupoMitad(g)) continue;
    for (const o of g.options) {
      const precios: Record<string, number> = {};
      const tamanos = producto.variants.length ? producto.variants : [{ id: '', name: '' }];
      for (const v of tamanos) {
        const precio = precioDelGusto(o.name, v.name || null, catalogo, producto.id);
        if (precio !== null) precios[v.id] = precio;
      }
      if (Object.keys(precios).length) tabla[o.id] = precios;
    }
  }
  return tabla;
}

/** Lo que usan la carta y el mostrador para mostrar el mismo precio que se va a cobrar. */
export type InfoMitad = { modo: string; descuentoPct: number | null; gustos: Record<string, Record<string, number>> };

/** Precio base de una línea en la pantalla (antes de sumar los extras). */
export function precioBaseEnPantalla(info: InfoMitad | null | undefined, fijo: number, varianteId: string | null, opcionesElegidas: string[]): number {
  if (!info || info.modo === 'FIJO') return fijo;
  const gustos = opcionesElegidas.map((id) => info.gustos[id]?.[varianteId ?? '']).filter((x): x is number => typeof x === 'number');
  if (gustos.length === 0) return fijo;
  const base = precioBaseMitad(info.modo, fijo, gustos);
  return info.descuentoPct ? Math.round(base * (1 - info.descuentoPct / 100)) : base;
}

/**
 * Arma la InfoMitad de un producto para la pantalla, o null si no es mitad y
 * mitad o el local cobra precio fijo. `descuento` devuelve el porcentaje de
 * promo vigente del producto (si tiene tamaños solo aplican porcentajes).
 */
export function infoMitad(
  modo: string,
  producto: Parameters<typeof tablaDeGustos>[0],
  catalogo: ProductoCatalogo[],
  descuento: (productId: string) => number | null
): InfoMitad | null {
  if (modo === 'FIJO' || !producto.addons.some(esGrupoMitad)) return null;
  const gustos = tablaDeGustos(producto, catalogo);
  if (Object.keys(gustos).length === 0) return null;
  return { modo, descuentoPct: descuento(producto.id), gustos };
}
