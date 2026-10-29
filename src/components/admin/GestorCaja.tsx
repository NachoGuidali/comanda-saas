'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { money, toCents } from '@/lib/money';
import { ETIQUETA_PAGO, FORMAS_DE_PAGO } from '@/lib/etiquetas';
import { abrirCaja, registrarMovimiento, cerrarCaja } from '@/actions/caja';
import { marcarCobrado } from '@/actions/orders';
import { diaHora } from '@/lib/tiempo';
import { CATEGORIAS_GASTO, ETIQUETA_CATEGORIA } from '@/lib/gastos-categorias';

type Movimiento = {
  id: string; type: 'INGRESO' | 'EGRESO'; amount: number; reason: string; createdAt: string;
  user: { name: string }; expense: { category: string } | null;
};
type Resumen = {
  caja: {
    id: string; openedAt: string; openingAmount: number;
    openedBy: { name: string }; movements: Movimiento[];
  };
  ventas: Record<string, { total: number; pedidos: number }>;
  totalVentas: number;
  pedidosCobrados: number;
  ingresos: number;
  egresos: number;
  esperado: number;
  anulados: { code: string; total: number; paymentMethod: string; cancelReason: string | null }[];
  sinCobrar: { id: string; code: string; total: number; paymentMethod: string; customerName: string }[];
  repartidores: { nombre: string; total: number; pedidos: number }[];
};
type Anterior = {
  id: string; openedAt: string; closedAt: string; openingAmount: number;
  countedAmount: number | null; expectedAmount: number | null; notes: string | null;
  openedBy: { name: string }; closedBy: { name: string } | null;
};

const hora = diaHora;

/**
 * El turno de caja del cajero: abre con el fondo, registra lo que entra y
 * sale que no es venta, y al cerrar cuenta la plata. El sistema dice cuánto
 * efectivo tendría que haber y la diferencia queda registrada.
 */
export default function GestorCaja({
  resumen, anteriores, puedeOperar, puedeCobrar, puedeCargarGastos,
}: {
  resumen: Resumen | null; anteriores: Anterior[]; puedeOperar: boolean; puedeCobrar: boolean; puedeCargarGastos: boolean;
}) {
  const router = useRouter();
  const [pendiente, startTransition] = useTransition();
  const [error, setError] = useState('');
  const [contado, setContado] = useState('');
  const [cerrado, setCerrado] = useState<number | null>(null);
  const [tipoMov, setTipoMov] = useState<'EGRESO' | 'INGRESO'>('EGRESO');

  function ejecutar(fn: () => Promise<{ ok: boolean; error?: string; diferencia?: number }>, alTerminar?: (r: { diferencia?: number }) => void) {
    setError('');
    startTransition(async () => {
      try {
        const r = await fn();
        if (!r.ok) { setError(r.error ?? 'No se pudo'); return; }
        alTerminar?.(r);
        router.refresh();
      } catch {
        setError('No se pudo completar. Revisá la conexión.');
      }
    });
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
      <div className="space-y-5">
        {error && <p role="alert" className="rounded-xl bg-ladrillo/10 px-4 py-3 text-sm text-ladrillo">{error}</p>}

        {cerrado !== null && (
          <div className={`panel p-5 ${cerrado === 0 ? 'border-verde/40' : 'border-ladrillo/40'}`}>
            <p className="font-display text-xl">Caja cerrada</p>
            <p className="mt-1 text-sm">
              {cerrado === 0
                ? 'El efectivo coincide exacto con lo esperado.'
                : cerrado > 0
                  ? `Sobran ${money(cerrado)} respecto de lo esperado.`
                  : `Faltan ${money(-cerrado)} respecto de lo esperado.`}
            </p>
          </div>
        )}

        {!resumen ? (
          <section className="panel p-6">
            <h2 className="font-display text-xl">No hay caja abierta</h2>
            <p className="mt-1 text-sm text-carbon-500">
              Al arrancar el turno, contá el cambio que hay en el cajón y abrí la caja con ese monto.
            </p>
            {puedeOperar && (
              <form action={(fd) => ejecutar(() => abrirCaja(fd), () => setCerrado(null))} className="mt-4 flex flex-wrap gap-2">
                <input name="fondo" className="input max-w-[220px]" inputMode="decimal" placeholder="Fondo de caja, ej. 20.000" required />
                <button disabled={pendiente} className="btn-primario px-5">Abrir caja</button>
              </form>
            )}
          </section>
        ) : (
          <>
            <section className="panel p-5">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h2 className="font-display text-xl">Caja abierta</h2>
                <p className="text-sm text-carbon-500">
                  Desde {hora(resumen.caja.openedAt)} · abrió {resumen.caja.openedBy.name}
                </p>
              </div>

              <dl className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                {FORMAS_DE_PAGO.map((f) => (
                  <div key={f} className="rounded-xl bg-carbon/5 p-3">
                    <dt className="text-xs text-carbon-500">{ETIQUETA_PAGO[f]}</dt>
                    <dd className="mt-1 text-lg font-bold tabular-nums">{money(resumen.ventas[f]?.total ?? 0)}</dd>
                    <dd className="text-xs text-carbon-500">{resumen.ventas[f]?.pedidos ?? 0} pedidos</dd>
                  </div>
                ))}
              </dl>
              <p className="mt-3 text-sm">
                Total cobrado: <strong>{money(resumen.totalVentas)}</strong> en {resumen.pedidosCobrados} pedidos
              </p>
            </section>

            <section className="panel p-5">
              <h3 className="text-sm font-semibold uppercase tracking-wide text-carbon-500">Efectivo en el cajón</h3>
              <dl className="mt-3 space-y-1.5 text-sm">
                <div className="flex justify-between"><dt>Fondo inicial</dt><dd className="tabular-nums">{money(resumen.caja.openingAmount)}</dd></div>
                <div className="flex justify-between"><dt>Ventas en efectivo</dt><dd className="tabular-nums">+{money(resumen.ventas.EFECTIVO?.total ?? 0)}</dd></div>
                <div className="flex justify-between"><dt>Ingresos</dt><dd className="tabular-nums">+{money(resumen.ingresos)}</dd></div>
                <div className="flex justify-between"><dt>Egresos</dt><dd className="tabular-nums">-{money(resumen.egresos)}</dd></div>
                <div className="flex justify-between border-t border-carbon/10 pt-1.5 text-base font-bold">
                  <dt>Tendría que haber</dt><dd className="tabular-nums">{money(resumen.esperado)}</dd>
                </div>
              </dl>
            </section>

            {resumen.repartidores.length > 0 && (
              <section className="panel p-5">
                <h3 className="text-sm font-semibold uppercase tracking-wide text-carbon-500">Rendición de repartidores</h3>
                <p className="mt-1 text-xs text-carbon-500">Efectivo cobrado en la puerta, que cada uno tiene que entregar.</p>
                <ul className="mt-3 divide-y divide-carbon/10 text-sm">
                  {resumen.repartidores.map((r) => (
                    <li key={r.nombre} className="flex justify-between py-2">
                      <span>{r.nombre} · {r.pedidos} pedidos</span>
                      <strong className="tabular-nums">{money(r.total)}</strong>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {resumen.sinCobrar.length > 0 && (
              <section className="panel border-rojo/40 p-5">
                <h3 className="text-sm font-semibold uppercase tracking-wide text-rojo">Entregados sin cobrar</h3>
                <p className="mt-1 text-xs text-carbon-500">
                  Casi siempre son transferencias que nadie confirmó. Revisá el home banking antes de cerrar.
                </p>
                <ul className="mt-3 divide-y divide-carbon/10 text-sm">
                  {resumen.sinCobrar.map((o) => (
                    <li key={o.id} className="flex items-center justify-between gap-3 py-2">
                      <span>{o.code} · {o.customerName} · {ETIQUETA_PAGO[o.paymentMethod]}</span>
                      <span className="flex items-center gap-3">
                        <strong className="tabular-nums">{money(o.total)}</strong>
                        {puedeCobrar && (
                          <button
                            disabled={pendiente}
                            onClick={() => ejecutar(() => marcarCobrado(o.id))}
                            className="text-xs underline"
                          >
                            Entró
                          </button>
                        )}
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {resumen.anulados.length > 0 && (
              <section className="panel p-5">
                <h3 className="text-sm font-semibold uppercase tracking-wide text-carbon-500">Cobrados y después cancelados</h3>
                <p className="mt-1 text-xs text-carbon-500">No suman a la caja: se asume que la plata se devolvió.</p>
                <ul className="mt-3 divide-y divide-carbon/10 text-sm">
                  {resumen.anulados.map((o) => (
                    <li key={o.code} className="flex justify-between py-2">
                      <span>{o.code} · {ETIQUETA_PAGO[o.paymentMethod]}{o.cancelReason ? ` · ${o.cancelReason}` : ''}</span>
                      <span className="tabular-nums">{money(o.total)}</span>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {puedeOperar && (
              <section className="panel p-5">
                <h3 className="font-display text-lg">Cerrar caja</h3>
                <p className="mt-1 text-sm text-carbon-500">Contá el efectivo del cajón, incluido el fondo, y anotalo.</p>
                <form
                  action={(fd) => {
                    if (!confirm('¿Cerrar la caja? Después no se puede reabrir.')) return;
                    ejecutar(() => cerrarCaja(fd), (r) => { setCerrado(r.diferencia ?? 0); setContado(''); });
                  }}
                  className="mt-4 space-y-3"
                >
                  <input
                    name="contado"
                    className="input"
                    inputMode="decimal"
                    placeholder="Efectivo contado"
                    value={contado}
                    onChange={(e) => setContado(e.target.value)}
                    required
                  />
                  {contado.trim() && (
                    <p className="text-sm">
                      {(() => {
                        const d = toCents(contado) - resumen.esperado;
                        if (d === 0) return <span className="text-verde">Coincide exacto</span>;
                        return d > 0
                          ? <span>Sobran <strong>{money(d)}</strong></span>
                          : <span className="text-ladrillo">Faltan <strong>{money(-d)}</strong></span>;
                      })()}
                    </p>
                  )}
                  <input name="notes" className="input" placeholder="Observaciones (opcional)" />
                  <button disabled={pendiente} className="btn-primario w-full py-3">Cerrar caja</button>
                </form>
              </section>
            )}
          </>
        )}
      </div>

      <aside className="space-y-5">
        {resumen && (
          <section className="panel p-5">
            <h3 className="font-display text-lg">Ingresos y egresos</h3>
            {puedeOperar && (
              <form
                action={(fd) => ejecutar(() => registrarMovimiento(fd))}
                className="mt-3 space-y-2"
              >
                <select name="type" className="input" value={tipoMov} onChange={(e) => setTipoMov(e.target.value as 'EGRESO')}>
                  <option value="EGRESO">Sale plata (pago a proveedor, retiro)</option>
                  <option value="INGRESO">Entra plata (cambio, aporte)</option>
                </select>
                <input name="amount" className="input" inputMode="decimal" placeholder="Monto" required />
                <input name="reason" className="input" placeholder="Motivo, ej. compra de pollo" required maxLength={200} />
                {tipoMov === 'EGRESO' && puedeCargarGastos && (
                  <select name="categoria" className="input" defaultValue="">
                    <option value="">No es un gasto (retiro, cambio)</option>
                    {CATEGORIAS_GASTO.map((c) => (
                      <option key={c.id} value={c.id}>Gasto: {c.label}</option>
                    ))}
                  </select>
                )}
                <button disabled={pendiente} className="btn-fantasma w-full py-2">Registrar</button>
              </form>
            )}
            <ul className="mt-4 divide-y divide-carbon/10 text-sm">
              {resumen.caja.movements.length === 0 && <li className="py-2 text-carbon-500">Todavía nada.</li>}
              {resumen.caja.movements.map((m) => (
                <li key={m.id} className="py-2">
                  <div className="flex justify-between">
                    <span>
                      {m.reason}
                      {m.expense && (
                        <span className="ml-1.5 rounded bg-carbon/5 px-1.5 py-0.5 text-[11px] text-carbon-500">
                          {ETIQUETA_CATEGORIA[m.expense.category]}
                        </span>
                      )}
                    </span>
                    <strong className={m.type === 'INGRESO' ? 'text-verde' : 'text-ladrillo'}>
                      {m.type === 'INGRESO' ? '+' : '-'}{money(m.amount)}
                    </strong>
                  </div>
                  <p className="text-xs text-carbon-500">{hora(m.createdAt)} · {m.user.name}</p>
                </li>
              ))}
            </ul>
          </section>
        )}

        <section className="panel p-5">
          <h3 className="font-display text-lg">Cierres anteriores</h3>
          <ul className="mt-3 divide-y divide-carbon/10 text-sm">
            {anteriores.length === 0 && <li className="py-2 text-carbon-500">Todavía no hay cierres.</li>}
            {anteriores.map((c) => {
              const dif = (c.countedAmount ?? 0) - (c.expectedAmount ?? 0);
              return (
                <li key={c.id} className="py-2">
                  <div className="flex justify-between">
                    <span>{hora(c.openedAt)} → {hora(c.closedAt)}</span>
                    <strong className={dif === 0 ? 'text-verde' : dif < 0 ? 'text-ladrillo' : ''}>
                      {dif === 0 ? 'OK' : `${dif > 0 ? '+' : '-'}${money(Math.abs(dif))}`}
                    </strong>
                  </div>
                  <p className="text-xs text-carbon-500">
                    Esperado {money(c.expectedAmount ?? 0)} · contado {money(c.countedAmount ?? 0)} · cerró {c.closedBy?.name ?? '-'}
                  </p>
                  {c.notes && <p className="text-xs italic text-carbon-500">{c.notes}</p>}
                </li>
              );
            })}
          </ul>
        </section>
      </aside>
    </div>
  );
}
