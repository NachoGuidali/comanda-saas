/**
 * Toda la plata se guarda en centavos (Int). Nunca float: 0.1 + 0.2 no es 0.3
 * y en una caja registradora eso se paga.
 */
export function money(cents: number): string {
  return new Intl.NumberFormat('es-AR', {
    style: 'currency',
    currency: 'ARS',
    minimumFractionDigits: cents % 100 === 0 ? 0 : 2,
  }).format(cents / 100);
}

/**
 * Convierte lo que escribe una persona a centavos. Entiende las dos formas:
 *
 *   "13500"  "13.500"  "13.500,50"  "$ 13.500"   → pesos con miles con punto
 *   "13500.50"  "13500,5"                        → decimales con punto o coma
 *
 * La regla: si hay punto y coma, el último es el decimal. Si hay solo uno de
 * los dos y lo siguen exactamente 3 dígitos ("10.000"), son miles; si lo siguen
 * 1 o 2 ("10.5", "10,50"), son decimales.
 *
 * Antes "13500.00" (que es como el formulario muestra un precio guardado) se
 * leía como 1.350.000: editar un producto sin tocar el precio lo multiplicaba
 * por cien.
 */
export function toCents(value: string | number): number {
  if (typeof value === 'number') return Number.isFinite(value) ? Math.round(value * 100) : 0;

  let limpio = value.trim().replace(/[^\d.,-]/g, '');
  if (!limpio) return 0;
  const negativo = limpio.startsWith('-');
  limpio = limpio.replace(/-/g, '');

  const ultimoPunto = limpio.lastIndexOf('.');
  const ultimaComa = limpio.lastIndexOf(',');
  let entero = limpio;
  let decimales = '';

  if (ultimoPunto >= 0 && ultimaComa >= 0) {
    const sep = Math.max(ultimoPunto, ultimaComa);
    entero = limpio.slice(0, sep);
    decimales = limpio.slice(sep + 1);
  } else if (ultimoPunto >= 0 || ultimaComa >= 0) {
    const sep = Math.max(ultimoPunto, ultimaComa);
    const caracter = limpio[sep];
    const despues = limpio.slice(sep + 1);
    const apariciones = limpio.split(caracter).length - 1;
    if (apariciones === 1 && despues.length > 0 && despues.length <= 2) {
      entero = limpio.slice(0, sep);
      decimales = despues;
    }
  }

  const pesos = parseInt(entero.replace(/[.,]/g, '') || '0', 10);
  const centavos = parseInt((decimales.replace(/[.,]/g, '') + '00').slice(0, 2), 10);
  if (!Number.isFinite(pesos)) return 0;
  const total = pesos * 100 + (Number.isFinite(centavos) ? centavos : 0);
  return negativo ? -total : total;
}

/** Para precargar un campo de formulario: "13500" o "13500,50". Vuelve igual con toCents. */
export function fromCents(cents: number): string {
  const pesos = Math.trunc(cents / 100);
  const resto = Math.abs(cents % 100);
  return resto === 0 ? String(pesos) : `${pesos},${String(resto).padStart(2, '0')}`;
}

/**
 * Los montos de caja y gastos se guardan como BigInt (un Int de la base topea
 * en $21.474.836). Para sumar y mostrar se pasan a number, que es exacto
 * hasta unos 90 mil millones de pesos en centavos.
 */
export function aNumero(v: bigint | number | null | undefined): number {
  return v == null ? 0 : Number(v);
}
