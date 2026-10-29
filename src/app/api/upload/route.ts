import { NextResponse } from 'next/server';
import { writeFile, mkdir } from 'fs/promises';
import { join } from 'path';
import sharp from 'sharp';
import { getSession, puede } from '@/lib/session';
import { carpetaDelCliente, urlDeArchivo } from '@/lib/media';

export const dynamic = 'force-dynamic';

const MAX_BYTES = 8 * 1024 * 1024;
const PERMITIDOS = ['image/jpeg', 'image/png', 'image/webp', 'image/avif'];

/**
 * El dueño va a subir fotos de 8MB sacadas con el celular. Las convertimos a
 * webp de 1200px: la carta carga rápido y el disco no explota.
 */
export async function POST(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Sin sesión' }, { status: 401 });
  // Suben fotos quienes arman la carta, las promos o los datos del local
  if (!puede(session, 'carta.editar', 'promos.editar', 'config.editar')) {
    return NextResponse.json({ error: 'No tenés permiso para subir imágenes' }, { status: 403 });
  }

  const form = await req.formData();
  const archivo = form.get('file');

  if (!(archivo instanceof File)) {
    return NextResponse.json({ error: 'No llegó ninguna imagen' }, { status: 400 });
  }
  if (archivo.size > MAX_BYTES) {
    return NextResponse.json({ error: 'La imagen supera los 8 MB' }, { status: 400 });
  }
  if (!PERMITIDOS.includes(archivo.type)) {
    return NextResponse.json({ error: 'Formato no soportado. Usá JPG, PNG o WebP.' }, { status: 400 });
  }

  const buffer = Buffer.from(await archivo.arrayBuffer());

  let optimizada: Buffer;
  try {
    optimizada = await sharp(buffer)
      .rotate()
      .resize(1200, 1200, { fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 82 })
      .toBuffer();
  } catch {
    return NextResponse.json({ error: 'No pudimos procesar esa imagen' }, { status: 400 });
  }

  const nombre = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.webp`;

  try {
    const carpeta = carpetaDelCliente(session.tenantId);
    await mkdir(carpeta, { recursive: true });
    await writeFile(join(carpeta, nombre), optimizada);
  } catch {
    return NextResponse.json({ error: 'No pudimos guardar la imagen en el servidor' }, { status: 500 });
  }

  return NextResponse.json({ url: urlDeArchivo(nombre) });
}
