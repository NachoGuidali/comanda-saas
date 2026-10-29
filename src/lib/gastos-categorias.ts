/**
 * Categorías y formas de pago de los gastos. Archivo aparte porque lo usan
 * también las pantallas del navegador, que no pueden importar la base.
 */
/**
 * Categorías de gasto. Son fijas a propósito: si cada uno escribe la suya
 * ("pollo", "Pollo", "carnicería"), el resumen del mes no sirve para nada.
 * El detalle va en la descripción.
 */
export const CATEGORIAS_GASTO = [
  { id: 'MERCADERIA', label: 'Mercadería e insumos', ejemplo: 'Pollo, harina, queso, verdura' },
  { id: 'BEBIDAS', label: 'Bebidas', ejemplo: 'Gaseosas, cerveza, agua' },
  { id: 'DESCARTABLES', label: 'Descartables y packaging', ejemplo: 'Cajas de pizza, bolsas, servilletas' },
  { id: 'SUELDOS', label: 'Sueldos y adelantos', ejemplo: 'Quincena, adelanto, extras' },
  { id: 'ALQUILER', label: 'Alquiler', ejemplo: 'Alquiler del local' },
  { id: 'SERVICIOS', label: 'Servicios', ejemplo: 'Luz, gas, agua, internet, teléfono' },
  { id: 'MANTENIMIENTO', label: 'Mantenimiento y arreglos', ejemplo: 'Técnico del horno, plomero' },
  { id: 'IMPUESTOS', label: 'Impuestos y tasas', ejemplo: 'Monotributo, ingresos brutos, tasa municipal' },
  { id: 'COMISIONES', label: 'Comisiones', ejemplo: 'Mercado Pago, apps de delivery, banco' },
  { id: 'PUBLICIDAD', label: 'Publicidad', ejemplo: 'Instagram, volantes' },
  { id: 'OTROS', label: 'Otros', ejemplo: 'Lo que no entra en ninguna' },
] as const;

export type CategoriaGasto = (typeof CATEGORIAS_GASTO)[number]['id'];
export const IDS_CATEGORIA: string[] = CATEGORIAS_GASTO.map((c) => c.id);
export const ETIQUETA_CATEGORIA: Record<string, string> = Object.fromEntries(CATEGORIAS_GASTO.map((c) => [c.id, c.label]));

export const FORMAS_PAGO_GASTO = [
  { id: 'EFECTIVO_CAJA', label: 'Efectivo de la caja' },
  { id: 'EFECTIVO', label: 'Efectivo (no sale de la caja)' },
  { id: 'TRANSFERENCIA', label: 'Transferencia' },
  { id: 'TARJETA', label: 'Tarjeta' },
  { id: 'MERCADO_PAGO', label: 'Mercado Pago' },
] as const;
export const ETIQUETA_PAGO_GASTO: Record<string, string> = Object.fromEntries(FORMAS_PAGO_GASTO.map((f) => [f.id, f.label]));
