import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { clienteDelAgente, sucursalDelAgente, anotarEstado, estacionesDe, VENCE_EN_MS, MAX_INTENTOS } from '@/lib/impresora';

export const dynamic = 'force-dynamic';

/**
 * El agente de impresión que corre en la PC del local consulta acá.
 * Solo recibe las comandas de su sucursal, y de esas, las de lo que imprime
 * (todo, solo cocina o solo caja: se elige en el panel).
 */
export async function GET(req: Request) {
  const acceso = await clienteDelAgente(req);
  if (!acceso) return NextResponse.json({ error: 'Sin acceso' }, { status: 401 });
  const { tenant, agente } = acceso;

  const sucursal = agente ? { id: agente.branchId } : await sucursalDelAgente(req, tenant.id);
  if ('error' in sucursal) return NextResponse.json({ error: sucursal.error }, { status: 400 });
  if (agente) await anotarEstado(agente, req);

  const station = estacionesDe(agente, req);
  const limite = new Date(Date.now() - VENCE_EN_MS);

  // Las que quedaron colgadas de hace horas (impresora apagada toda la noche)
  // se marcan vencidas en vez de salir todas juntas al abrir el local.
  await db.printJob.updateMany({
    where: { branchId: sucursal.id, status: 'EN_COLA', createdAt: { lt: limite } },
    data: { status: 'ERROR', error: 'Vencida: no se imprimió a tiempo' },
  });

  const jobs = await db.printJob.findMany({
    where: {
      branchId: sucursal.id,
      status: 'EN_COLA',
      attempts: { lt: MAX_INTENTOS },
      // La prueba de una impresora sale solo por esa
      ...(agente
        ? { OR: [{ agentId: agente.id }, { agentId: null, ...(station ? { station } : {}) }] }
        : { agentId: null, ...(station ? { station } : {}) }),
    },
    orderBy: { createdAt: 'asc' },
    take: 10,
    select: { id: true, station: true, payload: true, orderId: true, order: { select: { code: true } } },
  });

  return NextResponse.json(
    {
      jobs: jobs.map((j) => ({ id: j.id, station: j.station, payload: j.payload, orderId: j.orderId, code: j.order?.code ?? 'prueba' })),
      ...(agente ? { config: { nombre: agente.name, estaciones: agente.stations, abrirCajon: agente.abrirCajon } } : {}),
    },
    { headers: { 'Cache-Control': 'no-store' } }
  );
}
