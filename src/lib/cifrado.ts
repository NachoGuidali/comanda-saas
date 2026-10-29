import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'crypto';

/**
 * Cifrado de credenciales guardadas en la base (el Access Token de Mercado
 * Pago de cada local): si alguien se lleva una copia de la base, no se lleva
 * las claves. AES-256-GCM, con la clave derivada de CIFRADO_CLAVE (o, si no
 * está, de AUTH_SECRET). Cambiar esa clave deja ilegibles las credenciales
 * guardadas: hay que volver a cargarlas.
 */
function clave(): Buffer {
  const base = process.env.CIFRADO_CLAVE || process.env.AUTH_SECRET;
  if (!base) {
    if (process.env.NODE_ENV === 'production') throw new Error('Falta AUTH_SECRET (o CIFRADO_CLAVE) para cifrar credenciales');
    return createHash('sha256').update('clave-de-desarrollo').digest();
  }
  return createHash('sha256').update(`comanda:cifrado:${base}`).digest();
}

export function cifrar(texto: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', clave(), iv);
  const datos = Buffer.concat([c.update(texto, 'utf8'), c.final()]);
  return ['v1', iv.toString('base64'), c.getAuthTag().toString('base64'), datos.toString('base64')].join(':');
}

/** Null si no se puede descifrar (otra clave, dato roto). */
export function descifrar(guardado: string | null | undefined): string | null {
  if (!guardado) return null;
  const [v, iv, tag, datos] = guardado.split(':');
  if (v !== 'v1' || !iv || !tag || !datos) return null;
  try {
    const d = createDecipheriv('aes-256-gcm', clave(), Buffer.from(iv, 'base64'));
    d.setAuthTag(Buffer.from(tag, 'base64'));
    return Buffer.concat([d.update(Buffer.from(datos, 'base64')), d.final()]).toString('utf8');
  } catch {
    return null;
  }
}

/** "APP_USR-1234…abcd": para mostrar que hay una credencial cargada sin mostrarla. */
export function enmascarar(valor: string | null): string {
  if (!valor) return '';
  return valor.length <= 12 ? '••••' : `${valor.slice(0, 8)}…${valor.slice(-4)}`;
}
