import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { destinoDelHost } from '@/lib/tenant';

export const dynamic = 'force-dynamic';

/**
 * Caddy pregunta acá antes de sacar un certificado HTTPS (on_demand_tls): así
 * cada cliente nuevo tiene su https://cliente.comandasupreg.com sin tocar el
 * servidor, y nadie puede hacernos pedir certificados para dominios ajenos.
 *
 * 200 = es la plataforma, un cliente existente o el dominio propio de uno.
 */
export async function GET(req: Request) {
  const dominio = new URL(req.url).searchParams.get('domain') ?? '';
  const destino = destinoDelHost(dominio);
  let permitido = false;
  if (destino.tipo === 'plataforma') permitido = !!dominio;
  if (destino.tipo === 'subdominio') permitido = !!(await db.tenant.findUnique({ where: { slug: destino.slug }, select: { id: true } }));
  if (destino.tipo === 'dominio') permitido = !!(await db.tenant.findUnique({ where: { customDomain: destino.host }, select: { id: true } }));
  return new NextResponse(permitido ? 'ok' : 'no', { status: permitido ? 200 : 404 });
}
