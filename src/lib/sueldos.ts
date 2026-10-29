/**
 * Pagos al personal. Cada pago es un gasto de la categoría Sueldos, a nombre
 * de alguien y de un mes, así entra solo en Gastos y en Finanzas. Archivo sin
 * base de datos: lo usan también las pantallas.
 */
export const TIPOS_PAGO_SUELDO = [
  { id: 'SUELDO', label: 'Sueldo', cuenta: true },
  { id: 'ADELANTO', label: 'Adelanto', cuenta: true },
  { id: 'AGUINALDO', label: 'Aguinaldo', cuenta: false },
  { id: 'EXTRA', label: 'Horas extra o premio', cuenta: false },
  { id: 'VACACIONES', label: 'Vacaciones', cuenta: false },
  { id: 'OTRO', label: 'Otro', cuenta: false },
] as const;

export const IDS_PAGO_SUELDO: string[] = TIPOS_PAGO_SUELDO.map((t) => t.id);
export const ETIQUETA_PAGO_SUELDO: Record<string, string> = Object.fromEntries(TIPOS_PAGO_SUELDO.map((t) => [t.id, t.label]));

/** Sueldo y adelantos se descuentan del sueldo acordado del mes; lo demás es aparte. */
export function cuentaParaElSueldo(tipo: string | null | undefined): boolean {
  return TIPOS_PAGO_SUELDO.some((t) => t.id === tipo && t.cuenta);
}

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
/** "2026-10" → "octubre 2026" */
export function nombreDelMes(mes: string): string {
  return `${MESES[Number(mes.slice(5)) - 1] ?? ''} ${mes.slice(0, 4)}`;
}
