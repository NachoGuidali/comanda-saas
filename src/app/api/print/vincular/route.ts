import { NextResponse } from 'next/server';
import { randomBytes } from 'crypto';
import { db } from '@/lib/db';
import { hashToken, normalizarCodigo } from '@/lib/impresora';
import { permitir } from '@/lib/limite';
import { auditar } from '@/lib/auditoria';

export const dynamic = 'force-dynamic';

/**
 * El programa de impresión recién instalado manda acá el código que el dueño
 * generó en el panel. A cambio recibe su clave propia, que solo sirve para esa
 * impresora de esa sucursal. El código es de un solo uso y vence a la media
 * hora; entra por cualquier dominio (el programa no sabe de qué cliente es).
 */
export async function POST(req: Request) {
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || req.headers.get('x-real-ip') || 'sin-ip';
  if (!permitir(`vincular:${ip}`, 10, 15 * 60_000)) {
    return NextResponse.json({ error: 'Demasiados intentos. Esperá 15 minutos y probá de nuevo.' }, { status: 429 });
  }

  let body: { codigo?: string; equipo?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Cuerpo inválido' }, { status: 400 });
  }
  const codigo = normalizarCodigo(body.codigo ?? '');
  if (codigo.length !== 8) return NextResponse.json({ error: 'El código tiene 8 letras y números. Revisalo.' }, { status: 400 });

  const agente = await db.printAgent.findUnique({
    where: { pairCodeHash: hashToken(codigo) },
    include: { tenant: true, branch: { select: { name: true, active: true } } },
  });
  if (!agente || !agente.pairExpires || agente.pairExpires < new Date()) {
    return NextResponse.json({ error: 'Ese código no existe o ya venció. Generá uno nuevo en el panel.' }, { status: 404 });
  }
  if (!agente.tenant.active) return NextResponse.json({ error: 'El servicio de este local está pausado.' }, { status: 403 });

  const token = randomBytes(24).toString('base64url');
  const equipo = String(body.equipo ?? '').slice(0, 80);
  await db.printAgent.update({
    where: { id: agente.id },
    data: { tokenHash: hashToken(token), pairCodeHash: null, pairExpires: null, pairedAt: new Date(), device: equipo, lastError: null },
  });
  await auditar({
    tenantId: agente.tenantId, actorType: 'sistema', action: 'impresora',
    detail: `Se vinculó "${agente.name}" de ${agente.branch.name}${equipo ? ` en ${equipo}` : ''}`,
  });

  return NextResponse.json({
    token,
    cliente: agente.tenant.name,
    sucursal: agente.branch.name,
    nombre: agente.name,
    estaciones: agente.stations,
    abrirCajon: agente.abrirCajon,
  });
}
