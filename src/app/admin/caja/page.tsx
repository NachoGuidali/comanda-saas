import { db } from '@/lib/db';
import { requireSession, puede } from '@/lib/session';
import { resumenCaja } from '@/lib/caja';
import GestorCaja from '@/components/admin/GestorCaja';

export const dynamic = 'force-dynamic';

export default async function CajaPage() {
  const s = await requireSession('caja.ver');

  const abierta = await db.cashSession.findFirst({
    where: { branchId: s.branchId, closedAt: null },
    select: { id: true },
  });
  const anteriores = await db.cashSession.findMany({
    where: { branchId: s.branchId, closedAt: { not: null } },
    orderBy: { closedAt: 'desc' },
    take: 15,
    include: { openedBy: { select: { name: true } }, closedBy: { select: { name: true } } },
  });

  const resumen = abierta ? await resumenCaja(abierta.id) : null;

  return (
    <div>
      <h1 className="mb-6 font-display text-2xl">Caja · {s.branchName}</h1>
      <GestorCaja
        resumen={resumen ? JSON.parse(JSON.stringify(resumen)) : null}
        anteriores={anteriores.map((c) => ({
          ...JSON.parse(JSON.stringify({ ...c, openingAmount: 0, countedAmount: 0, expectedAmount: 0 })),
          openingAmount: Number(c.openingAmount),
          countedAmount: c.countedAmount == null ? null : Number(c.countedAmount),
          expectedAmount: c.expectedAmount == null ? null : Number(c.expectedAmount),
        }))}
        puedeOperar={puede(s, 'caja.operar')}
        puedeCobrar={puede(s, 'pedidos.cobrar')}
        puedeCargarGastos={puede(s, 'gastos.cargar')}
      />
    </div>
  );
}
