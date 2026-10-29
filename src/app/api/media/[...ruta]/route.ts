import { NextResponse } from 'next/server';
import { readFile, stat } from 'fs/promises';
import { join, basename, extname } from 'path';
import { carpetaDelCliente } from '@/lib/media';
import { tenantDeRequest } from '@/lib/tenant';

export const dynamic = 'force-dynamic';

const TIPOS: Record<string, string> = {
  '.webp': 'image/webp',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.avif': 'image/avif',
};

export async function GET(req: Request, { params }: { params: Promise<{ ruta: string[] }> }) {
  const { ruta } = await params;

  // basename descarta cualquier "../" antes de tocar el disco
  const nombre = basename(ruta.join('/'));
  const ext = extname(nombre).toLowerCase();

  if (!TIPOS[ext]) return new NextResponse('No encontrado', { status: 404 });

  // Las fotos de un cliente se sirven solo desde su dominio
  const tenant = await tenantDeRequest(req);
  if (!tenant) return new NextResponse('No encontrado', { status: 404 });
  const archivo = join(carpetaDelCliente(tenant.id), nombre);

  try {
    await stat(archivo);
    const datos = await readFile(archivo);
    return new NextResponse(new Uint8Array(datos), {
      headers: {
        'Content-Type': TIPOS[ext],
        // El nombre incluye un hash, así que el archivo nunca cambia de contenido
        'Cache-Control': 'public, max-age=31536000, immutable',
      },
    });
  } catch {
    return new NextResponse('No encontrado', { status: 404 });
  }
}
