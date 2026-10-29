import Link from 'next/link';
import { db } from '@/lib/db';
import { requirePlataforma } from '@/lib/plataforma';
import { money } from '@/lib/money';
import { fechaCorta } from '@/lib/etiquetas-cobro';
import { ETIQUETA_METODO_ABONO } from '@/lib/cobros-etiquetas';

export const dynamic = 'force-dynamic';

/** Lo cobrado en el mes, por medio de pago. */
export default async function Pagos({ searchParams }: { searchParams: Promise<{ mes?: string }> }) {
  await requirePlataforma();
  const { mes } = await searchParams;
  const hoy = new Date();
  const [y, m] = mes && /^\d{4}-\d{2}$/.test(mes) ? mes.split('-').map(Number) : [hoy.getFullYear(), hoy.getMonth() + 1];
  const desde = new Date(y, m - 1, 1);
  const hasta = new Date(y, m, 1);
  const pagos = await db.tenantPayment.findMany({
    where: { createdAt: { gte: desde, lt: hasta } },
    orderBy: { createdAt: 'desc' },
    include: { tenant: { select: { id: true, name: true } } },
  });
  const validos = pagos.filter((p) => !p.voidedAt);
  const porMedio = new Map<string, number>();
  for (const p of validos) porMedio.set(p.method, (porMedio.get(p.method) ?? 0) + p.amount);
  const clave = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-center gap-3">
        <h1 className="font-display text-2xl">Pagos</h1>
        <Link href={`/plataforma/pagos?mes=${clave(new Date(y, m - 2, 1))}`} className="rounded-lg border border-carbon/15 bg-white px-2.5 py-1 text-sm" aria-label="Mes anterior">‹</Link>
        <span className="font-semibold capitalize">{desde.toLocaleDateString('es-AR', { month: 'long', year: 'numeric' })}</span>
        <Link href={`/plataforma/pagos?mes=${clave(new Date(y, m, 1))}`} className="rounded-lg border border-carbon/15 bg-white px-2.5 py-1 text-sm" aria-label="Mes siguiente">›</Link>
      </div>
      <section className="mb-6 grid gap-3 sm:grid-cols-4">
        <div className="panel p-4"><p className="text-sm text-carbon-500">Total</p><p className="mt-1 font-display text-2xl tabular-nums">{money(validos.reduce((s, p) => s + p.amount, 0))}</p></div>
        {[...porMedio.entries()].map(([k, v]) => (
          <div key={k} className="panel p-4"><p className="text-sm text-carbon-500">{ETIQUETA_METODO_ABONO[k] ?? k}</p><p className="mt-1 font-display text-2xl tabular-nums">{money(v)}</p></div>
        ))}
      </section>
      <div className="panel overflow-hidden">
        <ul className="divide-y divide-carbon/10 text-sm">
          {pagos.length === 0 && <li className="px-5 py-6 text-carbon-500">No hubo pagos en el mes.</li>}
          {pagos.map((p) => (
            <li key={p.id} className={`flex flex-wrap items-baseline justify-between gap-2 px-5 py-3 ${p.voidedAt ? 'text-carbon-500 line-through' : ''}`}>
              <span><Link href={`/plataforma/clientes/${p.tenant.id}`} className="font-semibold hover:underline">{p.tenant.name}</Link> · {p.months} {p.months === 1 ? 'mes' : 'meses'} · {ETIQUETA_METODO_ABONO[p.method] ?? p.method}{p.reference ? ` · ${p.reference}` : ''}</span>
              <span className="tabular-nums">{fechaCorta(p.createdAt)} · <strong>{money(p.amount)}</strong></span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
