import Link from 'next/link';
import { db } from '@/lib/db';
import { requirePlataforma } from '@/lib/plataforma';
import { estadoCobro } from '@/lib/cobros';
import { limitesDe, precioDe } from '@/lib/plan';
import { urlDelCliente } from '@/lib/tenant';
import { money } from '@/lib/money';
import { ESTADO_ABONO, fechaCorta } from '@/lib/etiquetas-cobro';
import BotonRevisarCobros from '@/components/plataforma/BotonRevisarCobros';

export const dynamic = 'force-dynamic';

const FILTROS = [
  ['todos', 'Todos'], ['atrasados', 'Vencidos'], ['por_vencer', 'Por vencer'], ['prueba', 'En prueba'], ['suspendidos', 'Suspendidos'],
] as const;

/** Los clientes de la plataforma: primero los que hay que mirar (vencidos, por vencer). */
export default async function Clientes({ searchParams }: { searchParams: Promise<{ f?: string; q?: string }> }) {
  await requirePlataforma();
  const { f = 'todos', q = '' } = await searchParams;
  const ahora = new Date();
  const inicioMes = new Date(ahora.getFullYear(), ahora.getMonth(), 1);

  const [clientes, cobradoMes] = await Promise.all([
    db.tenant.findMany({
      include: { plan: true, _count: { select: { branches: true, users: { where: { active: true } } } } },
      orderBy: { createdAt: 'desc' },
    }),
    db.tenantPayment.aggregate({ where: { voidedAt: null, createdAt: { gte: inicioMes } }, _sum: { amount: true } }),
  ]);

  const filas = clientes.map((t) => {
    const e = estadoCobro(t, ahora);
    const tipo = t.active ? e.tipo : 'suspendido';
    return { t, e, tipo, precio: precioDe(t), limites: limitesDe(t) };
  });
  const orden: Record<string, number> = { vencido: 0, en_gracia: 1, suspendido: 2, por_vencer: 3, prueba: 4, al_dia: 5, sin_vencimiento: 6 };
  filas.sort((a, b) => (orden[a.tipo] ?? 9) - (orden[b.tipo] ?? 9));

  const texto = q.trim().toLowerCase();
  const visibles = filas.filter(({ t, tipo }) => {
    if (texto && !`${t.name} ${t.slug} ${t.contactEmail}`.toLowerCase().includes(texto)) return false;
    if (f === 'atrasados') return tipo === 'vencido' || tipo === 'en_gracia' || (tipo === 'suspendido' && t.suspendedKind === 'PAGO');
    if (f === 'por_vencer') return tipo === 'por_vencer';
    if (f === 'prueba') return tipo === 'prueba';
    if (f === 'suspendidos') return tipo === 'suspendido';
    return true;
  });
  const activos = filas.filter((x) => x.t.active);
  const mensual = activos.filter((x) => x.tipo !== 'prueba').reduce((s, x) => s + x.precio, 0);
  const atrasados = filas.filter((x) => x.tipo === 'vencido' || x.tipo === 'en_gracia').length;

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <h1 className="font-display text-2xl">Clientes</h1>
        <div className="flex gap-2">
          <BotonRevisarCobros />
          <Link href="/plataforma/clientes/nuevo" className="btn-acento">Nuevo cliente</Link>
        </div>
      </div>

      <section className="mb-6 grid gap-3 sm:grid-cols-4" aria-label="Resumen">
        {[
          ['Clientes activos', String(activos.length)],
          ['Ingreso mensual', money(mensual)],
          ['Cobrado este mes', money(cobradoMes._sum.amount ?? 0)],
          ['Vencidos', String(atrasados)],
        ].map(([l, v]) => (
          <div key={l} className="panel p-4">
            <p className="text-sm text-carbon-500">{l}</p>
            <p className="mt-1 font-display text-2xl tabular-nums">{v}</p>
          </div>
        ))}
      </section>

      <form className="mb-4 flex flex-wrap items-center gap-2">
        {FILTROS.map(([id, label]) => (
          <Link key={id} href={`/plataforma?f=${id}${q ? `&q=${encodeURIComponent(q)}` : ''}`} className={`chip ${f === id ? 'chip-activo' : ''}`}>{label}</Link>
        ))}
        <input name="q" defaultValue={q} placeholder="Buscar nombre, dirección o mail" className="input ml-auto w-64" />
        <input type="hidden" name="f" value={f} />
      </form>

      <div className="panel overflow-x-auto">
        <table className="w-full min-w-[900px] text-sm">
          <thead className="border-b border-carbon/10 text-left text-xs text-carbon-500">
            <tr>
              <th className="px-4 py-3 font-medium">Cliente</th>
              <th className="px-4 py-3 font-medium">Plan</th>
              <th className="px-4 py-3 font-medium">Estado</th>
              <th className="px-4 py-3 font-medium">Vence</th>
              <th className="px-4 py-3 text-right font-medium">Precio</th>
              <th className="px-4 py-3 text-right font-medium">Sucursales</th>
              <th className="px-4 py-3 text-right font-medium">Usuarios</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-carbon/10">
            {visibles.map(({ t, e, tipo, precio, limites }) => (
              <tr key={t.id} className="hover:bg-carbon/[0.03]">
                <td className="px-4 py-3">
                  <Link href={`/plataforma/clientes/${t.id}`} className="font-semibold hover:underline">{t.name}</Link>
                  <a href={urlDelCliente(t)} target="_blank" rel="noreferrer" className="block font-mono text-xs text-carbon-500 hover:underline">{urlDelCliente(t).replace(/^https?:\/\//, '')}</a>
                </td>
                <td className="px-4 py-3">{t.plan?.name ?? <span className="text-carbon-500">Sin plan (todo)</span>}</td>
                <td className="px-4 py-3">
                  <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${ESTADO_ABONO[tipo].clase}`}>{ESTADO_ABONO[tipo].label}</span>
                </td>
                <td className="px-4 py-3 tabular-nums">{'vence' in e ? `${fechaCorta(e.vence)} (${e.dias >= 0 ? `en ${e.dias} d` : `hace ${-e.dias} d`})` : '—'}</td>
                <td className="px-4 py-3 text-right tabular-nums">{precio ? money(precio) : '—'}</td>
                <td className="px-4 py-3 text-right tabular-nums">{t._count.branches}{limites.maxBranches !== null ? ` / ${limites.maxBranches}` : ''}</td>
                <td className="px-4 py-3 text-right tabular-nums">{t._count.users}{limites.maxUsers !== null ? ` / ${limites.maxUsers}` : ''}</td>
              </tr>
            ))}
            {visibles.length === 0 && <tr><td colSpan={7} className="px-4 py-8 text-center text-carbon-500">No hay clientes con ese filtro.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
