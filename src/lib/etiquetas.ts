/** Cómo se muestra cada forma de pago. Un solo lugar para todas las pantallas. */
export const ETIQUETA_PAGO: Record<string, string> = {
  EFECTIVO: 'Efectivo',
  TRANSFERENCIA: 'Transferencia',
  TARJETA_ENTREGA: 'Tarjeta',
  MERCADO_PAGO: 'Mercado Pago',
};

export const FORMAS_DE_PAGO = ['EFECTIVO', 'TRANSFERENCIA', 'TARJETA_ENTREGA', 'MERCADO_PAGO'] as const;
export type FormaDePago = (typeof FORMAS_DE_PAGO)[number];

/** "11" → "Mesa 11"; "V2" o "Barra" quedan como están. */
export function nombreMesa(nombre: string): string {
  return /^\d+$/.test(nombre.trim()) ? `Mesa ${nombre.trim()}` : nombre;
}
