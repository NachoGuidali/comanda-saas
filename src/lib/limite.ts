import { headers } from 'next/headers';

/**
 * Límite de intentos en memoria. Alcanza porque el sistema corre en un solo
 * proceso; si algún día se escala a varios, esto pasa a Redis o a la base.
 *
 * Frena tres cosas: fuerza bruta en el login, alguien que carga veinte pedidos
 * falsos para vaciar el stock, y spam de reservas.
 */
const ventanas = new Map<string, number[]>();

/** true si todavía está dentro del límite. Registra el intento. */
export function permitir(clave: string, maximo: number, ventanaMs: number): boolean {
  const ahora = Date.now();
  const previos = (ventanas.get(clave) ?? []).filter((t) => ahora - t < ventanaMs);
  if (previos.length >= maximo) {
    ventanas.set(clave, previos);
    return false;
  }
  previos.push(ahora);
  ventanas.set(clave, previos);

  // Limpieza ocasional para que el mapa no crezca sin fin
  if (ventanas.size > 5000) {
    for (const [k, v] of ventanas) if (!v.some((t) => ahora - t < ventanaMs)) ventanas.delete(k);
  }
  return true;
}

/** Borra los intentos de una clave: por ejemplo, después de un login correcto. */
export function reiniciar(clave: string) {
  ventanas.delete(clave);
}

/** IP del cliente. Caddy la pasa en X-Forwarded-For. */
export async function ipCliente(): Promise<string> {
  const h = await headers();
  return h.get('x-forwarded-for')?.split(',')[0].trim() || h.get('x-real-ip') || 'desconocida';
}
