import { redirect } from 'next/navigation';
import { db } from '@/lib/db';
import { requireSession, exigirFuncion, puede } from '@/lib/session';
import { claveDia } from '@/lib/tiempo';
import { claveMes, rangoDelMes, diaGuardado, FORMAS_PAGO_GASTO } from '@/lib/gastos';
import { diasDelRango } from '@/lib/finanzas';
import GestorSueldos from '@/components/admin/GestorSueldos';

export const dynamic = 'force-dynamic';

/**
 * Sueldos: quién trabaja en el local, cuánto cobra y qué se le pagó cada mes.
 * Cada pago es un gasto de la categoría Sueldos, así suma en Gastos y Finanzas.
 */
export default async function SueldosPage({ searchParams }: { searchParams: Promise<{ mes?: string }> }) {
  const s = await requireSession();
  exigirFuncion(s, 'sueldos');
  if (!puede(s, 'sueldos.ver')) redirect('/admin/gastos');
  const sp = await searchParams;
  const mesActual = claveMes();
  const mes = sp.mes && /^\d{4}-(0[1-9]|1[0-2])$/.test(sp.mes) && sp.mes <= mesActual ? sp.mes : mesActual;
  const { desde, hasta } = rangoDelMes(mes);

  const [personal, pagos, usuarios, pagadoEnElMes] = await Promise.all([
    db.staff.findMany({
      where: { branchId: s.branchId, OR: [{ active: true }, { pagos: { some: { period: mes } } }] },
      orderBy: [{ active: 'desc' }, { name: 'asc' }],
      include: { user: { select: { name: true } } },
    }),
    db.expense.findMany({
      where: { branchId: s.branchId, staffId: { not: null }, period: mes },
      orderBy: [{ date: 'asc' }, { createdAt: 'asc' }],
      include: { createdBy: { select: { name: true } } },
    }),
    db.user.findMany({
      where: { active: true, branches: { some: { branchId: s.branchId } } },
      orderBy: { name: 'asc' },
      select: { id: true, name: true },
    }),
    // Lo que salió en el mes por fecha de pago (es lo que cuenta Finanzas), sea del mes que sea
    db.expense.aggregate({
      where: { branchId: s.branchId, category: 'SUELDOS', voidedAt: null, date: diasDelRango(desde, hasta) },
      _sum: { amount: true },
    }),
  ]);

  return (
    <GestorSueldos
      sucursal={s.branchName}
      mes={mes}
      mesActual={mesActual}
      hoy={claveDia(new Date())}
      personal={personal.map((p) => ({
        id: p.id, name: p.name, role: p.role, salary: p.salary === null ? null : Number(p.salary),
        userId: p.userId, usuario: p.user?.name ?? null, active: p.active,
      }))}
      pagos={pagos.map((g) => ({
        id: g.id, staffId: g.staffId!, tipo: g.payKind ?? 'OTRO', amount: Number(g.amount), fecha: diaGuardado(g.date),
        description: g.description, payment: g.payment, cargadoPor: g.createdBy.name, createdById: g.createdById,
        cargadoEl: g.createdAt.toISOString(), anulado: !!g.voidedAt,
      }))}
      usuarios={usuarios}
      pagadoEnElMes={Number(pagadoEnElMes._sum.amount ?? 0)}
      formasPago={FORMAS_PAGO_GASTO.map((f) => ({ id: f.id, label: f.label }))}
      puedePagar={puede(s, 'sueldos.pagar')}
      puedeAnular={puede(s, 'gastos.anular')}
      userId={s.userId}
    />
  );
}
