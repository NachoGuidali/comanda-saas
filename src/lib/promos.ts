/**
 * Promociones automáticas: descuentos que se aplican solos a ciertos productos
 * en ciertos días, sin que el cliente tenga que poner ningún código.
 *
 * El mismo cálculo se usa en la carta (para mostrar el precio tachado) y al
 * crear el pedido (para cobrar). Tiene que vivir en un solo lugar, porque si
 * la carta muestra un precio y el pedido cobra otro, el cliente se enoja con
 * razón.
 */

export type PromoAplicable = {
  id: string;
  title: string;
  type: string;
  value: number;
  days: number[];
  startsAt: Date | string | null;
  endsAt: Date | string | null;
  productIds: string[];
};

/** ¿Esta promo corre hoy? Mira el rango de fechas y el día de la semana. */
export function promoVigente(promo: PromoAplicable, ahora = new Date()): boolean {
  if (promo.startsAt && new Date(promo.startsAt) > ahora) return false;
  if (promo.endsAt && new Date(promo.endsAt) < ahora) return false;
  // Sin días marcados significa todos los días
  if (promo.days.length > 0 && !promo.days.includes(ahora.getDay())) return false;
  return true;
}

export type PrecioCalculado = {
  precio: number;
  precioOriginal: number | null;
  promoTitulo: string | null;
};

/**
 * Devuelve el precio que corresponde hoy. Si hay varias promos que alcanzan al
 * producto, gana la que deje el precio más bajo: el cliente nunca paga de más
 * por una promo que se pisó con otra.
 */
export function precioConPromo(
  productId: string,
  precioBase: number,
  tieneVariantes: boolean,
  promos: PromoAplicable[],
  ahora = new Date()
): PrecioCalculado {
  let mejor = precioBase;
  let titulo: string | null = null;

  for (const promo of promos) {
    if (!promo.productIds.includes(productId)) continue;
    if (!promoVigente(promo, ahora)) continue;

    let candidato: number | null = null;

    if (promo.type === 'PRODUCTO_PORCENTAJE') {
      candidato = Math.round(precioBase * (1 - promo.value / 100));
    } else if (promo.type === 'PRODUCTO_PRECIO' && !tieneVariantes) {
      // Un precio fijo no tiene sentido en un producto con tamaños: no se sabe
      // a cuál de los tres aplicarlo. Esos se descuentan por porcentaje.
      candidato = promo.value;
    }

    if (candidato !== null && candidato < mejor) {
      mejor = Math.max(0, candidato);
      titulo = promo.title;
    }
  }

  return {
    precio: mejor,
    precioOriginal: titulo ? precioBase : null,
    promoTitulo: titulo,
  };
}

const DIAS_CORTOS = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
const DIAS_LARGOS = ['domingos', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábados'];

export function etiquetaDias(days: number[]): string {
  if (days.length === 0) return 'Todos los días';
  if (days.length === 7) return 'Todos los días';
  if (days.length === 1) return `Los ${DIAS_LARGOS[days[0]]}`;
  return days
    .slice()
    .sort((a, b) => a - b)
    .map((d) => DIAS_CORTOS[d])
    .join(', ');
}

export { DIAS_CORTOS, DIAS_LARGOS };
