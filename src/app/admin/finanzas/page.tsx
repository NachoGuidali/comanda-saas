import { db } from '@/lib/db';
import { requireSession } from '@/lib/session';
import { aNumero } from '@/lib/money';
import { leerPeriodo, atajos } from '@/lib/periodo';
import { tableroFinanzas, cobradosEn, diasDelRango } from '@/lib/finanzas';
import PanelFinanzas from '@/components/admin/PanelFinanzas';

export const dynamic = 'force-dynamic';

/**
 * El tablero del dueño: cuánta plata entró, por dónde, qué se vendió, en
 * qué se gastó y qué se perdió. Todo del mismo período y descargable.
 */
export default async function FinanzasPage({ searchParams }: { searchParams: Promise<{ desde?: string; hasta?: string }> }) {
  const s = await requireSession('reportes.ver');
  const p = leerPeriodo(await searchParams);

  const [tablero, ultimosCobros, ultimosGastos] = await Promise.all([
    tableroFinanzas(s.branchId, p.desde, p.hasta),
    db.order.findMany({
      where: cobradosEn(s.branchId, p.desde, p.hasta),
      orderBy: { paidAt: 'desc' },
      take: 12,
      select: {
        id: true, code: true, total: true, paymentMethod: true, metodoOriginal: true, pagoOnline: true,
        paidAt: true, deliveredAt: true, paidBy: { select: { name: true } },
      },
    }),
    db.expense.findMany({
      where: { branchId: s.branchId, voidedAt: null, date: diasDelRango(p.desde, p.hasta) },
      orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
      take: 12,
      select: { id: true, date: true, description: true, category: true, amount: true, createdBy: { select: { name: true } } },
    }),
  ]);

  return (
    <PanelFinanzas
      sucursal={s.branchName}
      desde={p.desdeTexto}
      hasta={p.hastaTexto}
      atajos={atajos()}
      t={tablero}
      cobros={ultimosCobros.map((o) => ({
        id: o.id, code: o.code, total: o.total, medio: o.paymentMethod, original: o.metodoOriginal,
        cuando: (o.paidAt ?? o.deliveredAt)?.toISOString() ?? null,
        quien: o.paidBy?.name ?? (o.pagoOnline ? 'Pago online' : ''),
      }))}
      gastos={ultimosGastos.map((g) => ({
        id: g.id, fecha: g.date.toISOString().slice(0, 10), descripcion: g.description,
        categoria: g.category, monto: aNumero(g.amount), quien: g.createdBy.name,
      }))}
    />
  );
}
