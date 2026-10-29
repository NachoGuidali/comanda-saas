'use client';

import { useEffect, useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { money } from '@/lib/money';
import { nombreMesa } from '@/lib/etiquetas';
import { hora } from '@/lib/tiempo';
import { abrirMesa, cambiarPersonas, tomarMesa, cerrarMesa, imprimirCuenta } from '@/actions/salon';
import { cambiarEstado } from '@/actions/orders';
import NuevoPedidoMostrador, { type CategoriaMostrador } from './NuevoPedidoMostrador';

type Mesa = {
  id: string; name: string; zone: string | null; capacity: number; status: string;
  guests: number | null; openedAt: string | null; mozo: { id: string; name: string } | null;
};
type Pedido = {
  id: string; code: string; tableId: string | null; status: string; paymentStatus: string; total: number; createdAt: string;
  items: { id: string; name: string; variantName: string | null; quantity: number; total: number; notes: string | null; addons: { name: string }[] }[];
};
type Props = {
  sucursal: string; branchId: string; userId: string; ahora: string;
  mesas: Mesa[]; pedidos: Pedido[]; catalogo: CategoriaMostrador[];
  puedeAnotar: boolean; puedeAtender: boolean; puedeCobrar: boolean; puedeServir: boolean;
};

const ESTADO: Record<string, { label: string; clase: string }> = {
  PENDIENTE: { label: 'Por aceptar', clase: 'bg-rojo/10 text-rojo' },
  ACEPTADO: { label: 'En cocina', clase: 'bg-carbon/10 text-carbon' },
  EN_PREPARACION: { label: 'En cocina', clase: 'bg-carbon/10 text-carbon' },
  LISTO: { label: 'Listo para servir', clase: 'bg-verde/15 text-verde' },
  EN_CAMINO: { label: 'Listo para servir', clase: 'bg-verde/15 text-verde' },
  ENTREGADO: { label: 'Servido', clase: 'bg-carbon/5 text-carbon-500' },
};
const PAGOS = [
  { id: 'EFECTIVO', label: 'Efectivo' },
  { id: 'TARJETA_ENTREGA', label: 'Tarjeta' },
  { id: 'TRANSFERENCIA', label: 'Transferencia' },
  { id: 'MERCADO_PAGO', label: 'Mercado Pago' },
] as const;

const primerNombre = (n: string) => n.split(' ')[0];
function minutos(desde: string | null, ahora: number) {
  if (!desde) return null;
  const m = Math.max(0, Math.round((ahora - new Date(desde).getTime()) / 60_000));
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')}`;
}

/**
 * El salón en vivo. El mozo toca una mesa libre, dice cuántos son, y anota el
 * pedido ahí mismo desde el celular: sale la comanda y queda en la cuenta de
 * la mesa. Las rondas siguientes se suman a la misma cuenta.
 */
export default function GestorSalon(props: Props) {
  const { mesas, pedidos, userId } = props;
  const router = useRouter();
  const [abierta, setAbierta] = useState<string | null>(null);
  const [soloMias, setSoloMias] = useState(false);
  const [ahora, setAhora] = useState(() => new Date(props.ahora).getTime());
  const [aviso, setAviso] = useState('');

  // Se actualiza solo: lo que sale de cocina y lo que abren otros mozos
  useEffect(() => {
    const t = setInterval(() => { setAhora(Date.now()); if (!document.hidden) router.refresh(); }, 20_000);
    return () => clearInterval(t);
  }, [router]);

  const deMesa = useMemo(() => {
    const m = new Map<string, Pedido[]>();
    for (const p of pedidos) if (p.tableId) m.set(p.tableId, [...(m.get(p.tableId) ?? []), p]);
    return m;
  }, [pedidos]);

  const visibles = soloMias ? mesas.filter((m) => m.mozo?.id === userId) : mesas;
  const zonas = [...new Set(visibles.map((m) => m.zone ?? ''))];
  const ocupadas = mesas.filter((m) => m.status === 'OCUPADA').length;
  const libres = mesas.filter((m) => m.status === 'LIBRE').length;
  const mesa = mesas.find((m) => m.id === abierta) ?? null;

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl">Salón · {props.sucursal}</h1>
          <p className="mt-1 text-sm text-carbon-500">{ocupadas} ocupadas · {libres} libres. Tocá una mesa para abrirla o anotar.</p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => setSoloMias(false)} aria-pressed={!soloMias} className={`chip ${!soloMias ? 'chip-activo' : ''}`}>Todas</button>
          <button onClick={() => setSoloMias(true)} aria-pressed={soloMias} className={`chip ${soloMias ? 'chip-activo' : ''}`}>Mis mesas</button>
        </div>
      </div>
      {aviso && <p role="status" className="mb-4 rounded-lg bg-verde/10 px-3 py-2 text-sm text-verde">{aviso}</p>}

      {mesas.length === 0 && <p className="panel p-6 text-sm text-carbon-500">No hay mesas cargadas. Se agregan en Mesas.</p>}
      {soloMias && visibles.length === 0 && mesas.length > 0 && <p className="panel p-6 text-sm text-carbon-500">No tenés mesas abiertas.</p>}

      {zonas.map((z) => (
        <section key={z || 'sin-zona'} className="mb-6">
          {zonas.length > 1 && <h2 className="mb-2 text-sm font-semibold text-carbon-500">{z || 'Sin zona'}</h2>}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
            {visibles.filter((m) => (m.zone ?? '') === z).map((m) => {
              const suyos = deMesa.get(m.id) ?? [];
              const total = suyos.reduce((t, p) => t + p.total, 0);
              const listo = suyos.some((p) => p.status === 'LISTO' || p.status === 'EN_CAMINO');
              const enCocina = suyos.some((p) => ['PENDIENTE', 'ACEPTADO', 'EN_PREPARACION'].includes(p.status));
              const ocupada = m.status === 'OCUPADA';
              const fuera = m.status === 'FUERA_DE_SERVICIO';
              return (
                <button
                  key={m.id}
                  onClick={() => { setAviso(''); setAbierta(m.id); }}
                  disabled={fuera}
                  className={`relative min-h-[7.5rem] rounded-2xl border p-3 text-left transition-colors ${
                    fuera ? 'border-dashed border-carbon/20 bg-transparent text-carbon-500'
                      : ocupada ? 'border-marca bg-marca text-crema' : 'border-carbon/15 bg-white hover:border-marca'
                  }`}
                >
                  <span className="block font-display text-2xl leading-none">{m.name}</span>
                  {fuera && <span className="mt-2 block text-xs">Fuera de servicio</span>}
                  {!fuera && !ocupada && <span className="mt-2 block text-xs text-carbon-500">Libre · {m.capacity} lugares</span>}
                  {ocupada && (
                    <>
                      <span className="mt-2 block text-sm">
                        {m.guests ? `${m.guests} ${m.guests === 1 ? 'persona' : 'personas'}` : 'Ocupada'}
                        {minutos(m.openedAt, ahora) ? ` · ${minutos(m.openedAt, ahora)}` : ''}
                      </span>
                      <span className="block text-xs opacity-70">{m.mozo ? primerNombre(m.mozo.name) : 'Sin mozo'}</span>
                      <span className="mt-1 block font-semibold tabular-nums">{total > 0 ? money(total) : 'Sin pedir'}</span>
                      {(listo || enCocina) && (
                        <span className={`absolute right-2 top-2 rounded-full px-2 py-0.5 text-[11px] font-semibold ${listo ? 'bg-verde text-crema' : 'bg-crema/20'}`}>
                          {listo ? 'Para servir' : 'En cocina'}
                        </span>
                      )}
                    </>
                  )}
                </button>
              );
            })}
          </div>
        </section>
      ))}

      {mesa && (
        <PanelMesa
          key={mesa.id}
          mesa={mesa}
          pedidos={deMesa.get(mesa.id) ?? []}
          props={props}
          ahora={ahora}
          onCerrar={() => setAbierta(null)}
          onAviso={(t, cerrar) => { setAviso(t); if (cerrar) setAbierta(null); router.refresh(); }}
        />
      )}
    </div>
  );
}

function PanelMesa({ mesa, pedidos, props, ahora, onCerrar, onAviso }: {
  mesa: Mesa; pedidos: Pedido[]; props: Props; ahora: number;
  onCerrar: () => void; onAviso: (t: string, cerrar?: boolean) => void;
}) {
  const [personas, setPersonas] = useState(mesa.guests ?? Math.min(2, mesa.capacity || 2));
  const [anotando, setAnotando] = useState(false);
  const [cobrando, setCobrando] = useState(false);
  const [error, setError] = useState('');
  const [pendiente, startTransition] = useTransition();
  const ocupada = mesa.status === 'OCUPADA';
  const nm = nombreMesa(mesa.name);
  const total = pedidos.reduce((t, p) => t + p.total, 0);
  const sinCobrar = pedidos.filter((p) => p.paymentStatus === 'PENDIENTE').reduce((t, p) => t + p.total, 0);
  // Las rondas nuevas se suman al pedido que sigue abierto; si no hay, se crea otro
  const abierto = [...pedidos].reverse().find((p) => ['PENDIENTE', 'ACEPTADO', 'EN_PREPARACION', 'LISTO'].includes(p.status) && p.paymentStatus === 'PENDIENTE');

  function correr(fn: () => Promise<{ ok: true; aviso?: string } | { ok: false; error: string }>, exito: string, cerrar = false) {
    setError('');
    startTransition(async () => {
      try {
        const r = await fn();
        if (!r.ok) { setError(r.error); return; }
        onAviso(r.aviso ?? exito, cerrar);
      } catch {
        setError('No se pudo guardar. Revisá la conexión.');
      }
    });
  }

  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center bg-carbon/50 sm:items-center sm:p-4" onClick={onCerrar}>
      <div
        className="scroll-fino max-h-[94vh] w-full overflow-y-auto rounded-t-2xl bg-crema p-5 sm:max-w-lg sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={nm}
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="font-display text-3xl leading-none">{nm}</h2>
            <p className="mt-1 text-sm text-carbon-500">
              {ocupada
                ? [mesa.openedAt ? `Desde las ${hora(mesa.openedAt)} (${minutos(mesa.openedAt, ahora)})` : 'Ocupada', mesa.mozo ? `atiende ${primerNombre(mesa.mozo.name)}` : 'sin mozo'].join(' · ')
                : `Libre · ${mesa.capacity} lugares${mesa.zone ? ` · ${mesa.zone}` : ''}`}
            </p>
          </div>
          <button onClick={onCerrar} className="text-xl text-carbon-500" aria-label="Cerrar">✕</button>
        </div>

        {/* Cuántos son */}
        {props.puedeAtender && (
          <div className="mt-5">
            <p className="label">{ocupada ? 'Personas' : '¿Cuántos son?'}</p>
            <div className="grid grid-cols-6 gap-2">
              {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map((n) => (
                <button
                  key={n}
                  type="button"
                  aria-pressed={personas === n}
                  onClick={() => {
                    setPersonas(n);
                    if (ocupada && n !== mesa.guests) correr(() => cambiarPersonas(mesa.id, n), `${nm}: ${n} personas.`);
                  }}
                  className={`rounded-xl border py-2.5 text-lg font-semibold tabular-nums ${personas === n ? 'border-marca bg-marca text-crema' : 'border-carbon/15 bg-white'}`}
                >
                  {n}
                </button>
              ))}
            </div>
          </div>
        )}

        {!ocupada && props.puedeAtender && (
          <button
            disabled={pendiente}
            onClick={() => correr(() => abrirMesa(mesa.id, personas), `${nm} abierta con ${personas} ${personas === 1 ? 'persona' : 'personas'}.`)}
            className="btn-primario mt-5 w-full py-3.5 text-base"
          >
            {pendiente ? 'Abriendo...' : `Abrir ${nm} con ${personas}`}
          </button>
        )}

        {ocupada && (
          <>
            {props.puedeAnotar && (
              <button onClick={() => setAnotando(true)} className="btn-primario mt-5 w-full py-3.5 text-base">
                {pedidos.length ? '+ Anotar otra ronda' : 'Anotar el pedido'}
              </button>
            )}

            <div className="mt-5 space-y-3">
              {pedidos.length === 0 && <p className="text-sm text-carbon-500">Todavía no pidieron nada.</p>}
              {pedidos.map((p) => {
                const e = ESTADO[p.status] ?? { label: p.status, clase: 'bg-carbon/5' };
                return (
                  <div key={p.id} className="rounded-xl border border-carbon/10 bg-white p-3">
                    <div className="flex items-center justify-between gap-2 text-sm">
                      <span className="font-semibold">{p.code} <span className="font-normal text-carbon-500">· {hora(p.createdAt)}</span></span>
                      <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${e.clase}`}>{e.label}</span>
                    </div>
                    <ul className="mt-2 space-y-0.5 text-sm">
                      {p.items.map((it) => (
                        <li key={it.id} className="flex justify-between gap-3">
                          <span>
                            {it.quantity} × {it.name}{it.variantName ? ` ${it.variantName}` : ''}
                            {it.addons.length > 0 && <span className="block text-xs text-carbon-500">+ {it.addons.map((a) => a.name).join(', ')}</span>}
                            {it.notes && <span className="block text-xs italic text-rojo">{it.notes}</span>}
                          </span>
                          <span className="tabular-nums">{money(it.total)}</span>
                        </li>
                      ))}
                    </ul>
                    {props.puedeServir && (p.status === 'LISTO' || p.status === 'EN_CAMINO') && (
                      <button
                        disabled={pendiente}
                        onClick={() => correr(() => cambiarEstado(p.id, 'ENTREGADO'), `${p.code} servido.`)}
                        className="btn-fantasma mt-2 w-full py-2 text-sm"
                      >
                        Ya lo serví
                      </button>
                    )}
                  </div>
                );
              })}
            </div>

            {pedidos.length > 0 && (
              <div className="mt-4 flex items-baseline justify-between border-t border-carbon/10 pt-3">
                <span className="font-semibold">Cuenta</span>
                <span className="text-right">
                  <span className="font-display text-2xl tabular-nums">{money(total)}</span>
                  {sinCobrar > 0 && sinCobrar < total && <span className="block text-xs text-carbon-500">Falta cobrar {money(sinCobrar)}</span>}
                  {mesa.guests && mesa.guests > 1 && total > 0 && <span className="block text-xs text-carbon-500">{money(Math.ceil(total / mesa.guests / 100) * 100)} por persona</span>}
                </span>
              </div>
            )}

            {error && <p role="alert" className="mt-3 rounded-lg bg-ladrillo/10 px-3 py-2 text-sm text-ladrillo">{error}</p>}

            {cobrando ? (
              <div className="mt-4 rounded-xl border border-carbon/10 bg-white p-3">
                <p className="mb-2 text-sm font-semibold">¿Cómo pagaron {money(sinCobrar)}?</p>
                <div className="grid grid-cols-2 gap-2">
                  {PAGOS.map((f) => (
                    <button
                      key={f.id}
                      disabled={pendiente}
                      onClick={() => correr(() => cerrarMesa(mesa.id, f.id), `${nm} libre.`, true)}
                      className="btn-fantasma py-2.5 text-sm"
                    >
                      {f.label}
                    </button>
                  ))}
                </div>
                <button onClick={() => setCobrando(false)} className="mt-2 text-sm underline">Volver</button>
              </div>
            ) : (
              <div className="mt-4 grid grid-cols-2 gap-2">
                {pedidos.length > 0 && (
                  <button disabled={pendiente} onClick={() => correr(() => imprimirCuenta(mesa.id), 'La cuenta sale por la impresora de la caja.')} className="btn-fantasma py-2.5 text-sm">
                    Imprimir la cuenta
                  </button>
                )}
                {props.puedeAtender && (
                  <button
                    disabled={pendiente}
                    onClick={() => {
                      if (sinCobrar > 0 && props.puedeCobrar) { setCobrando(true); return; }
                      correr(() => cerrarMesa(mesa.id), `${nm} libre.`, true);
                    }}
                    className={`btn-fantasma py-2.5 text-sm ${pedidos.length === 0 ? 'col-span-2' : ''}`}
                  >
                    {sinCobrar > 0 && props.puedeCobrar ? 'Cobrar y liberar' : 'Se fueron: liberar'}
                  </button>
                )}
                {props.puedeAtender && mesa.mozo?.id !== props.userId && (
                  <button disabled={pendiente} onClick={() => correr(() => tomarMesa(mesa.id), `Ahora atendés ${nm}.`)} className="col-span-2 py-1.5 text-sm underline">
                    La atiendo yo
                  </button>
                )}
              </div>
            )}
          </>
        )}

        {!ocupada && error && <p role="alert" className="mt-3 rounded-lg bg-ladrillo/10 px-3 py-2 text-sm text-ladrillo">{error}</p>}
      </div>

      {anotando && (
        <div onClick={(e) => e.stopPropagation()}>
          <NuevoPedidoMostrador
            branchId={props.branchId}
            categorias={props.catalogo}
            zonas={[]}
            mesas={[]}
            mesaFija={{ id: mesa.id, name: nm }}
            agregarA={abierto ? { id: abierto.id, code: abierto.code } : undefined}
            abiertoInicial
            onGuardado={() => onAviso(`Anotado en ${nm}. La comanda sale en cocina.`)}
            onCerrar={() => setAnotando(false)}
          />
        </div>
      )}
    </div>
  );
}
