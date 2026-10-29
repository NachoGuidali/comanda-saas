import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { clienteDelAgente, MAX_INTENTOS } from '@/lib/impresora';

export const dynamic = 'force-dynamic';

/**
 * El agente avisa cómo le fue. Si falló, la comanda sigue en cola y se
 * reintenta: antes pasaba a error en el primer fallo y no salía nunca más,
 * aunque se prendiera la impresora.
 */
export async function POST(req: Request) {
  const acceso = await clienteDelAgente(req);
  if (!acceso) return NextResponse.json({ error: 'Sin acceso' }, { status: 401 });

  let body: { id?: string; ok?: boolean; error?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Cuerpo inválido' }, { status: 400 });
  }
  const { id, ok, error } = body;
  if (!id) return NextResponse.json({ error: 'Falta el id' }, { status: 400 });

  // Solo comandas de este cliente (y si es una impresora vinculada, de su local)
  const job = await db.printJob.findFirst({
    where: { id, branch: { tenantId: acceso.tenant.id }, ...(acceso.agente ? { branchId: acceso.agente.branchId } : {}) },
    select: { attempts: true, status: true },
  });
  if (!job) return NextResponse.json({ error: 'No existe' }, { status: 404 });

  if (ok) {
    await db.printJob.update({ where: { id }, data: { status: 'IMPRESO', printedAt: new Date(), error: null } });
  } else {
    const intentos = job.attempts + 1;
    await db.printJob.update({
      where: { id },
      data: {
        attempts: intentos,
        error: String(error ?? 'Error desconocido').slice(0, 300),
        status: intentos >= MAX_INTENTOS ? 'ERROR' : 'EN_COLA',
      },
    });
  }

  return NextResponse.json({ ok: true });
}
