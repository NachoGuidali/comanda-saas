import { db } from '@/lib/db';
import { requireSession } from '@/lib/session';
import { estadoCobro, diasGracia } from '@/lib/cobros';
import { limitesDe, precioDe, ETIQUETA_FUNCION } from '@/lib/plan';
import { mpPlataformaDisponible } from '@/lib/abono-mp';
import { money } from '@/lib/money';
import { ESTADO_ABONO, fechaCorta } from '@/lib/etiquetas-cobro';
import { ETIQUETA_METODO_ABONO } from '@/lib/cobros-etiquetas';
import PagarAbono from '@/components/admin/PagarAbono';

export const dynamic = 'force-dynamic';

/** El abono del local, visto por su dueño: plan, vencimiento, pagos y pagar. */
export default async function Abono() {
  const s = await requireSession('sucursales.gestionar');
  const t = await db.tenant.findUniqueOrThrow({
    where: { id: s.tenantId },
    include: {
      plan: true, payments: { where: { voidedAt: null }, orderBy: { createdAt: 'desc' }, take: 24 },
      _count: { select: { branches: true, users: { where: { active: true } } } },
    },
  });
  const e = estadoCobro(t);
  const lim = limitesDe(t);
  const precio = precioDe(t);
  const est = ESTADO_ABONO[e.tipo];

  return (
    <div className="max-w-4xl space-y-6">
      <div>
        <h1 className="font-display text-2xl">Abono</h1>
        <p className="mt-1 text-sm text-carbon-500">Tu plan de Comanda Supreg, hasta cuándo está pago y cómo pagarlo.</p>
      </div>

      <section className="grid gap-3 sm:grid-cols-3">
        <div className="panel p-5">
          <p className="text-sm text-carbon-500">Plan</p>
          <p className="mt-1 font-display text-2xl">{lim.plan ?? 'Completo'}</p>
          <p className="mt-1 text-xs text-carbon-500">{precio ? `${money(precio)} por mes` : 'Sin cargo'}</p>
        </div>
        <div className="panel p-5">
          <p className="text-sm text-carbon-500">Estado</p>
          <p className="mt-2"><span className={`rounded-full px-2.5 py-1 text-sm font-semibold ${est.clase}`}>{est.label}</span></p>
          {'vence' in e && <p className="mt-2 text-xs text-carbon-500">{e.tipo === 'prueba' ? 'La prueba termina' : 'Vence'} el {fechaCorta(e.vence)}</p>}
          {e.tipo === 'en_gracia' && <p className="mt-1 text-xs text-ladrillo">Si no se paga hasta el {fechaCorta(e.hasta)}, el servicio se pausa ({diasGracia()} días de gracia).</p>}
        </div>
        <div className="panel p-5">
          <p className="text-sm text-carbon-500">Uso</p>
          <p className="mt-1 text-sm">Sucursales: <strong>{t._count.branches}{lim.maxBranches !== null ? ` de ${lim.maxBranches}` : ''}</strong></p>
          <p className="text-sm">Usuarios activos: <strong>{t._count.users}{lim.maxUsers !== null ? ` de ${lim.maxUsers}` : ''}</strong></p>
          <p className="mt-1 text-xs text-carbon-500">Incluye: {lim.funciones.map((f) => ETIQUETA_FUNCION[f]).join(', ') || 'lo básico'}</p>
        </div>
      </section>

      {precio > 0 && <PagarAbono disponible={mpPlataformaDisponible()} precio={precio} email={t.contactEmail} debitoActivo={!!t.mpPreapprovalId} />}

      <section className="panel p-5">
        <h2 className="font-display text-lg">Pagos</h2>
        {t.payments.length === 0 ? <p className="mt-2 text-sm text-carbon-500">Todavía no hay pagos registrados.</p> : (
          <ul className="mt-3 divide-y divide-carbon/10 text-sm">
            {t.payments.map((p) => (
              <li key={p.id} className="flex justify-between gap-3 py-2">
                <span>{fechaCorta(p.createdAt)} · {p.months} {p.months === 1 ? 'mes' : 'meses'} · {ETIQUETA_METODO_ABONO[p.method] ?? p.method}</span>
                <span className="tabular-nums"><strong>{money(p.amount)}</strong> · hasta {fechaCorta(p.toDate)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
