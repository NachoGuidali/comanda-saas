/**
 * Fechas de los gastos. La columna `date` es un día de calendario sin hora:
 * Prisma la maneja como medianoche UTC. Estas funciones la convierten desde y
 * hacia el día elegido en el formulario sin que la zona horaria la corra.
 */
export function diaParaGuardar(yyyyMmDd: string): Date {
  return new Date(`${yyyyMmDd}T00:00:00.000Z`);
}

export function diaGuardado(fecha: Date): string {
  return fecha.toISOString().slice(0, 10);
}

/** "2026-10" → primer día del mes y primer día del mes siguiente, en hora local */
export function rangoDelMes(mes: string): { desde: Date; hasta: Date } {
  const [y, m] = mes.split('-').map(Number);
  return { desde: new Date(y, m - 1, 1), hasta: new Date(y, m, 1) };
}

/** El mes de una fecha, como "2026-10" */
export function claveMes(fecha = new Date()): string {
  return `${fecha.getFullYear()}-${String(fecha.getMonth() + 1).padStart(2, '0')}`;
}
