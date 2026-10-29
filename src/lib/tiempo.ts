import { zonaDelLocal } from './zona';

/**
 * La hora del local, no la del servidor.
 *
 * El VPS corre en UTC: sin esto, a las 21 de Buenos Aires el servidor ya cree
 * que es el día siguiente. Eso corría las promos por día, el "abierto ahora",
 * las reservas, los reportes y la hora de las comandas.
 *
 * La zona se fija una sola vez al arrancar (src/instrumentation.ts y el
 * Dockerfile), así que en el servidor getHours(), getDay() y compañía ya
 * devuelven la hora del local.
 */
export const ZONA_HORARIA = zonaDelLocal();

/** Medianoche del día de la fecha dada, en la hora del local. */
export function inicioDelDia(fecha = new Date()): Date {
  const d = new Date(fecha);
  d.setHours(0, 0, 0, 0);
  return d;
}

/** "2026-09-30" según el calendario del local, no el de UTC. */
export function claveDia(fecha: Date): string {
  const y = fecha.getFullYear();
  const m = String(fecha.getMonth() + 1).padStart(2, '0');
  const d = String(fecha.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * Fecha y hora siempre en la zona del local y en 24 horas. Ojo: 'es-AR' solo
 * formatea en 12 horas y sin "p. m." ("08:39" a las 20:39), que en una
 * comanda o en el tablero es una trampa. Por eso todo pasa por acá.
 */
export function fechaHora(fecha: Date | string, opciones: Intl.DateTimeFormatOptions = {}): string {
  return new Date(fecha).toLocaleString('es-AR', { timeZone: ZONA_HORARIA, hourCycle: 'h23', ...opciones });
}

/** "20:39" */
export function hora(fecha: Date | string): string {
  return new Date(fecha).toLocaleTimeString('es-AR', {
    timeZone: ZONA_HORARIA, hourCycle: 'h23', hour: '2-digit', minute: '2-digit',
  });
}

/** "30/09 20:39" */
export function diaHora(fecha: Date | string): string {
  return fechaHora(fecha, { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}
