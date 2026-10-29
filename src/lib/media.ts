import { join } from 'path';

/**
 * Las fotos NO van en /public.
 *
 * Next.js lee esa carpeta al arrancar y la trata como contenido estático
 * congelado: un archivo que aparece después, en tiempo de ejecución, devuelve
 * 404 aunque esté en disco. Además, en el build standalone /public se copia a la
 * imagen, así que cada deploy borraba lo subido.
 *
 * Por eso viven en una carpeta aparte, montada como volumen, y se sirven por
 * /api/media, que las lee del disco en el momento.
 */
export const MEDIA_DIR = process.env.MEDIA_DIR || join(process.cwd(), 'data', 'uploads');

export const MEDIA_URL = '/api/media';

export function urlDeArchivo(nombre: string) {
  return `${MEDIA_URL}/${nombre}`;
}

/** Cada cliente tiene su carpeta: data/uploads/<id del cliente>/ */
export function carpetaDelCliente(tenantId: string) {
  return join(MEDIA_DIR, tenantId.replace(/[^a-zA-Z0-9_-]/g, ''));
}
