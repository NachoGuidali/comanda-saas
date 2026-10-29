import { db } from '@/lib/db';
import { requireSession, puede, tieneFuncion } from '@/lib/session';
import { claveDia } from '@/lib/tiempo';
import { rangoDelMes, claveMes, resultadoDelPeriodo, diaGuardado } from '@/lib/gastos';
import GestorGastos from '@/components/admin/GestorGastos';

export const dynamic = 'force-dynamic';

export default async function GastosPage({ searchParams }: { searchParams: Promise<{ mes?: string }> }) {
  const s = await requireSession('gastos.ver');
  const sp = await searchParams;

  const mesActual = claveMes();
  const mes = sp.mes && /^\d{4}-(0[1-9]|1[0-2])$/.test(sp.mes) && sp.mes <= mesActual ? sp.mes : mesActual;
  const { desde, hasta } = rangoDelMes(mes);
  const anterior = rangoDelMes(claveMes(new Date(desde.getFullYear(), desde.getMonth() - 1, 1)));

  const [resultado, resultadoAnterior, gastos] = await Promise.all([
    resultadoDelPeriodo(s.branchId, desde, hasta),
    resultadoDelPeriodo(s.branchId, anterior.desde, anterior.hasta),
    db.expense.findMany({
      where: {
        branchId: s.branchId,
        date: { gte: new Date(`${claveDia(desde)}T00:00:00.000Z`), lt: new Date(`${claveDia(hasta)}T00:00:00.000Z`) },
      },
      orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
      include: { createdBy: { select: { name: true } }, voidedBy: { select: { name: true } } },
    }),
  ]);

  // Las ventas y el resultado son números del negocio: los ve quien ve reportes
  const verResultado = puede(s, 'reportes.ver');
  // Lo que cobra cada uno es privado: sin permiso de sueldos, esos pagos no se listan
  const verSueldos = puede(s, 'sueldos.ver') && tieneFuncion(s, 'sueldos');
  const ocultos = verSueldos ? 0 : gastos.filter((g) => g.staffId && !g.voidedAt).length;

  return (
    <GestorGastos
      sucursal={s.branchName}
      mes={mes}
      mesActual={mesActual}
      hoy={claveDia(new Date())}
      resultado={resultado}
      resultadoAnterior={resultadoAnterior}
      verResultado={verResultado}
      puedeCargar={puede(s, 'gastos.cargar')}
      puedeAnular={puede(s, 'gastos.anular')}
      userId={s.userId}
      verSueldos={verSueldos}
      sueldosOcultos={ocultos}
      gastos={gastos.filter((g) => verSueldos || !g.staffId).map((g) => ({
        id: g.id,
        fecha: diaGuardado(g.date),
        category: g.category,
        description: g.description,
        supplier: g.supplier,
        amount: Number(g.amount),
        payment: g.payment,
        cargadoPor: g.createdBy.name,
        createdById: g.createdById,
        cargadoEl: g.createdAt.toISOString(),
        anulado: g.voidedAt
          ? { el: g.voidedAt.toISOString(), por: g.voidedBy?.name ?? '', motivo: g.voidReason ?? '' }
          : null,
      }))}
    />
  );
}
