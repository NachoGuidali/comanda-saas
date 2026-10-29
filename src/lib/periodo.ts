import { claveDia } from './tiempo';

/**
 * El período que se mira en Finanzas, como viene en la dirección:
 * ?desde=2026-10-01&hasta=2026-10-31 (los dos días incluidos).
 * Sin parámetros, el mes en curso hasta hoy.
 */
export type Periodo = { desde: Date; hasta: Date; desdeTexto: string; hastaTexto: string };

const DIA = /^\d{4}-\d{2}-\d{2}$/;

export function leerPeriodo(params: { desde?: string | null; hasta?: string | null }): Periodo {
  const hoy = new Date();
  let desdeTexto = params.desde && DIA.test(params.desde) ? params.desde : claveDia(new Date(hoy.getFullYear(), hoy.getMonth(), 1));
  let hastaTexto = params.hasta && DIA.test(params.hasta) ? params.hasta : claveDia(hoy);
  if (hastaTexto < desdeTexto) [desdeTexto, hastaTexto] = [hastaTexto, desdeTexto];

  const desde = new Date(`${desdeTexto}T00:00:00`);
  // "Hasta el 31" incluye todo el 31: se corta a la medianoche siguiente
  const hasta = new Date(`${hastaTexto}T00:00:00`);
  hasta.setDate(hasta.getDate() + 1);
  return { desde, hasta, desdeTexto, hastaTexto };
}

/** Atajos de período para los botones de arriba. */
export function atajos(hoy = new Date()) {
  const d = (x: Date) => claveDia(x);
  const y = hoy.getFullYear();
  const m = hoy.getMonth();
  const hace = (n: number) => new Date(y, m, hoy.getDate() - n);
  return [
    { id: 'mes', label: 'Este mes', desde: d(new Date(y, m, 1)), hasta: d(hoy) },
    { id: 'mes-anterior', label: 'Mes anterior', desde: d(new Date(y, m - 1, 1)), hasta: d(new Date(y, m, 0)) },
    { id: 'hoy', label: 'Hoy', desde: d(hoy), hasta: d(hoy) },
    { id: '7dias', label: 'Últimos 7 días', desde: d(hace(6)), hasta: d(hoy) },
    { id: 'anio', label: 'Este año', desde: d(new Date(y, 0, 1)), hasta: d(hoy) },
  ];
}
