/**
 * Por qué se fue algo sin cobrarse. Los tipos son fijos para poder sumar a fin
 * de mes: no es lo mismo perder diez pizzas porque se quemaron que regalar
 * diez empanadas a clientes. El detalle va en el motivo.
 *
 * Archivo sin base de datos: lo usan también las pantallas.
 */
export const TIPOS_MERMA = [
  { id: 'ROTURA', label: 'Se rompió', ejemplo: 'Una botella, un frasco' },
  { id: 'VENCIDO', label: 'Se venció', ejemplo: 'Un postre, un lácteo' },
  { id: 'SALIO_MAL', label: 'Salió mal', ejemplo: 'Se quemó, se cayó, el cliente lo devolvió' },
  { id: 'REGALO', label: 'Regalo o cortesía', ejemplo: 'Al cliente de siempre, por una demora' },
  { id: 'PERSONAL', label: 'Consumo del personal', ejemplo: 'La comida del equipo' },
  { id: 'OTRO', label: 'Otro', ejemplo: 'Contá qué pasó' },
] as const;

export type TipoMerma = (typeof TIPOS_MERMA)[number]['id'];
export const IDS_TIPO_MERMA: string[] = TIPOS_MERMA.map((t) => t.id);
export const ETIQUETA_TIPO_MERMA: Record<string, string> = Object.fromEntries(TIPOS_MERMA.map((t) => [t.id, t.label]));

/** El tipo de una merma, también para las anotadas antes de que existieran los tipos. */
export function tipoDeMerma(lossType: string | null | undefined): string {
  return lossType && IDS_TIPO_MERMA.includes(lossType) ? lossType : 'OTRO';
}
