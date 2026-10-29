'use client';

import { useState, useTransition } from 'react';
import { money } from '@/lib/money';
import { ETIQUETA_PAGO, FORMAS_DE_PAGO, type FormaDePago } from '@/lib/etiquetas';
import { avanzarPedido, cambiarEstado, marcarCobrado, reimprimir, asignarRepartidor } from '@/actions/orders';
import { accionPrincipal, type Pedido, type PermisosTablero } from './TableroPedidos';
import NuevoPedidoMostrador, { type CategoriaMostrador } from './NuevoPedidoMostrador';
import { registrarMermaPedido } from '@/actions/operacion';
import { ETIQUETA_TIPO_MERMA } from '@/lib/mermas';
import { hora as horaLocal } from '@/lib/tiempo';

const TIPO: Record<string, string> = { DELIVERY: 'Envío a domicilio', TAKEAWAY: 'Retira en el local', SALON: 'Come en el salón' };
const CANAL: Record<string, string> = { WEB: 'Carta web', WHATSAPP: 'WhatsApp', MOSTRADOR: 'Mostrador o teléfono' };
const ESTADO: Record<string, string> = {
  PENDIENTE: 'Nuevo', ACEPTADO: 'Aceptado',
  EN_PREPARACION: 'En preparación', LISTO: 'Listo', EN_CAMINO: 'En camino',
  ENTREGADO: 'Entregado', RECHAZADO: 'Rechazado', CANCELADO: 'Cancelado',
};


function hora(iso: string | null) {
  return iso ? horaLocal(iso) : null;
}

function minutosEntre(a: string | null, b: string | null) {
  if (!a || !b) return null;
  return Math.round((new Date(b).getTime() - new Date(a).getTime()) / 60000);
}

/**
 * Ficha completa del pedido. Es lo que abre el que atiende cuando el cliente
 * llama preguntando, así que tiene todo junto: qué pidió, cuánto paga, dónde
 * vive y cuánto tardó cada etapa.
 */
export default function DetallePedido({
  pedido, repartidores, permisos, branchId, catalogo, zonas, mesas, onCerrar, onCambio,
}: {
  pedido: Pedido;
  repartidores: { id: string; name: string }[];
  permisos: PermisosTablero;
  branchId: string;
  catalogo: CategoriaMostrador[];
  zonas: { id: string; name: string; fee: number }[];
  mesas: { id: string; name: string }[];
  onCerrar: () => void;
  onCambio: () => void;
}) {
  const [pendiente, startTransition] = useTransition();
  const [error, setError] = useState('');
  const [formaCobro, setFormaCobro] = useState<FormaDePago>(pedido.paymentMethod as FormaDePago);
  const [agregando, setAgregando] = useState(false);
  const [salioMal, setSalioMal] = useState(false);

  const [aviso, setAviso] = useState('');

  function accion(fn: () => Promise<{ ok: boolean; error?: string; aviso?: string }>) {
    setError('');
    setAviso('');
    startTransition(async () => {
      try {
        const r = (await fn()) as { ok: boolean; error?: string; aviso?: string };
        if (!r.ok && r.error) setError(r.error);
        else if (r.aviso) setAviso(r.aviso);
      } catch {
        setError('No se pudo completar la acción. Revisá la conexión.');
      }
      onCambio();
    });
  }

  const principal = accionPrincipal(pedido, permisos);
  const puedeCobrar = permisos.cobrar && (permisos.avanzar || pedido.assignedTo?.id === permisos.userId);

  const abierto = !['ENTREGADO', 'RECHAZADO', 'CANCELADO'].includes(pedido.status);
  const cerrado = !abierto;

  const etapas = [
    { label: 'Entró', iso: pedido.createdAt },
    { label: 'Aceptado', iso: pedido.acceptedAt },
    { label: 'Listo', iso: pedido.readyAt },
    { label: 'Despachado', iso: pedido.dispatchedAt },
    { label: 'Entregado', iso: pedido.deliveredAt },
  ].filter((e) => e.iso);

  const totalMin = minutosEntre(pedido.createdAt, pedido.deliveredAt);
  const textoWa = `Hola ${pedido.customerName}, te escribimos por tu pedido ${pedido.code}.`;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-carbon/60 sm:items-center sm:p-4" onClick={onCerrar}>
      <div
        className="scroll-fino max-h-[94vh] w-full overflow-y-auto rounded-t-2xl bg-crema sm:max-w-2xl sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="detalle-titulo"
      >
        {/* Encabezado */}
        <div className="sticky top-0 z-10 flex items-start justify-between gap-3 border-b border-carbon/10 bg-crema px-5 py-4">
          <div>
            <h2 id="detalle-titulo" className="font-display text-2xl leading-none">{pedido.code}</h2>
            <p className="mt-1.5 text-sm text-carbon-500">
              {ESTADO[pedido.status]} · {TIPO[pedido.type]}
              {pedido.table ? ` · ${pedido.table.name}` : ''}
            </p>
          </div>
          <button onClick={onCerrar} className="shrink-0 px-2 text-xl text-carbon-500" aria-label="Cerrar">✕</button>
        </div>

        <div className="space-y-5 p-5">
          {/* Cliente */}
          <section className="panel p-4">
            <h3 className="text-sm font-semibold uppercase tracking-wide text-carbon-500">Cliente</h3>
            <p className="mt-2 text-lg font-medium">{pedido.customerName}</p>
            <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
              {pedido.customerPhone !== '-' && <a href={`tel:${pedido.customerPhone}`} className="underline">{pedido.customerPhone}</a>}
              {pedido.customerPhone !== '-' && <a
                href={`https://wa.me/${pedido.customerPhone.replace(/\D/g, '')}?text=${encodeURIComponent(textoWa)}`}
                target="_blank"
                rel="noreferrer"
                className="text-verde underline"
              >
                Escribirle por WhatsApp
              </a>}
            </div>

            {pedido.address && (
              <div className="mt-3 border-t border-carbon/10 pt-3">
                <p className="text-sm">{pedido.address}</p>
                {pedido.addressNotes && <p className="text-sm text-carbon-500">{pedido.addressNotes}</p>}
                {pedido.zone && <p className="mt-1 text-sm text-carbon-500">Zona: {pedido.zone.name}</p>}
                <a
                  href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(pedido.address)}`}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-1.5 inline-block text-sm underline"
                >
                  Ver en el mapa
                </a>
              </div>
            )}

            <p className="mt-3 text-xs text-carbon-500">Entró por {CANAL[pedido.source] ?? pedido.source}</p>
          </section>

          {/* Productos */}
          <section className="panel p-4">
            <h3 className="text-sm font-semibold uppercase tracking-wide text-carbon-500">
              Pedido · {pedido.items.length} {pedido.items.length === 1 ? 'producto' : 'productos'}
            </h3>
            <ul className="mt-3 divide-y divide-carbon/10">
              {pedido.items.map((it) => (
                <li key={it.id} className="flex justify-between gap-4 py-2.5">
                  <div className="min-w-0">
                    <p className="font-medium">
                      <span className="text-rojo">{it.quantity}×</span> {it.name}
                      {it.variantName && <span className="text-carbon-500"> · {it.variantName}</span>}
                    </p>
                    {it.addons.length > 0 && (
                      <p className="mt-0.5 text-sm text-carbon-500">
                        {it.addons.map((a) => `+ ${a.name}`).join('  ')}
                      </p>
                    )}
                    {it.notes && (
                      <p className="mt-1 rounded-lg bg-rojo/10 px-2.5 py-1 text-sm font-medium">{it.notes}</p>
                    )}
                  </div>
                  <span className="shrink-0 font-semibold tabular-nums">{money(it.total)}</span>
                </li>
              ))}
            </ul>

            {pedido.notes && (
              <p className="mt-3 rounded-lg bg-rojo/10 px-3 py-2 text-sm">
                <strong>Aclaración:</strong> {pedido.notes}
              </p>
            )}
          </section>

          {/* Plata */}
          <section className="panel p-4">
            <h3 className="text-sm font-semibold uppercase tracking-wide text-carbon-500">Cobro</h3>
            <dl className="mt-3 space-y-1.5 text-sm">
              <div className="flex justify-between"><dt>Subtotal</dt><dd className="tabular-nums">{money(pedido.subtotal)}</dd></div>
              {pedido.deliveryFee > 0 && (
                <div className="flex justify-between"><dt>Envío</dt><dd className="tabular-nums">{money(pedido.deliveryFee)}</dd></div>
              )}
              {pedido.discount > 0 && (
                <div className="flex justify-between text-verde">
                  <dt>Descuento{pedido.promoCode ? ` · ${pedido.promoCode}` : ''}</dt>
                  <dd className="tabular-nums">-{money(pedido.discount)}</dd>
                </div>
              )}
              <div className="flex justify-between border-t border-carbon/10 pt-1.5 text-base font-bold">
                <dt>Total</dt><dd className="tabular-nums">{money(pedido.total)}</dd>
              </div>
            </dl>

            <p className="mt-3 text-sm">
              {ETIQUETA_PAGO[pedido.paymentMethod] ?? pedido.paymentMethod} ·{' '}
              <span className={pedido.paymentStatus === 'COBRADO' ? 'font-medium text-verde' : 'font-medium text-rojo'}>
                {pedido.paymentStatus === 'COBRADO' ? 'Cobrado' : 'Sin cobrar'}
              </span>
            </p>

            {pedido.pagoOnline && (
              <p className="mt-1.5 rounded-lg bg-sky-50 px-3 py-2 text-sm">
                {pedido.esperandoPago
                  ? `Eligió pagar online con Mercado Pago y todavía no se acreditó${pedido.mpStatus === 'rejected' ? ' (le rechazaron la tarjeta)' : ''}. Si no paga en 30 minutos se cancela solo.`
                  : pedido.mpStatus === 'refunded'
                    ? 'Pagado online y devuelto al cliente.'
                    : pedido.mpStatus === 'reembolso_fallido'
                      ? 'Pagado online. La devolución automática falló: hacela desde Mercado Pago.'
                      : 'Pagado online con Mercado Pago.'}
              </p>
            )}

            {pedido.cashAmount && pedido.cashAmount >= pedido.total && (
              <p className="mt-1.5 rounded-lg bg-carbon/5 px-3 py-2 text-sm">
                Abona con {money(pedido.cashAmount)} · <strong>vuelto {money(pedido.cashAmount - pedido.total)}</strong>
              </p>
            )}

            {pedido.paymentStatus === 'PENDIENTE' && !['RECHAZADO', 'CANCELADO'].includes(pedido.status) && puedeCobrar && (
              <div className="mt-3 flex gap-2">
                {/* El cliente puede terminar pagando distinto de lo que dijo */}
                <select
                  value={formaCobro}
                  onChange={(e) => setFormaCobro(e.target.value as FormaDePago)}
                  className="input flex-1 py-2 text-sm"
                  aria-label="Forma de pago"
                >
                  {FORMAS_DE_PAGO.map((f) => <option key={f} value={f}>{ETIQUETA_PAGO[f]}</option>)}
                </select>
                <button
                  onClick={() => accion(() => marcarCobrado(pedido.id, formaCobro))}
                  disabled={pendiente}
                  className="btn-fantasma px-4 py-2 text-sm"
                >
                  Cobrar {money(pedido.total)}
                </button>
              </div>
            )}
          </section>

          {/* Tiempos */}
          <section className="panel p-4">
            <h3 className="text-sm font-semibold uppercase tracking-wide text-carbon-500">Línea de tiempo</h3>
            <ol className="mt-3 space-y-2">
              {etapas.map((e, i) => {
                const delta = i > 0 ? minutosEntre(etapas[i - 1].iso, e.iso) : null;
                return (
                  <li key={e.label} className="flex items-baseline gap-3 text-sm">
                    <span className="w-16 shrink-0 font-medium tabular-nums">{hora(e.iso)}</span>
                    <span className="flex-1">{e.label}</span>
                    {delta !== null && <span className="text-xs text-carbon-500">+{delta} min</span>}
                  </li>
                );
              })}
            </ol>
            {totalMin !== null && (
              <p className="mt-3 border-t border-carbon/10 pt-3 text-sm">
                De punta a punta: <strong>{totalMin} minutos</strong>
              </p>
            )}
            {pedido.cancelReason && (
              <p className="mt-3 rounded-lg bg-ladrillo/10 px-3 py-2 text-sm text-ladrillo">
                {pedido.status === 'RECHAZADO' ? 'Rechazado' : 'Cancelado'}: {pedido.cancelReason}
              </p>
            )}
          </section>

          {/* Reparto */}
          {pedido.type === 'DELIVERY' && abierto && permisos.asignar && pedido.status !== 'EN_CAMINO' && (
            <section className="panel p-4">
              <h3 className="text-sm font-semibold uppercase tracking-wide text-carbon-500">Reparto</h3>
              <select
                value={pedido.assignedTo?.id ?? ''}
                onChange={(e) => accion(() => asignarRepartidor(pedido.id, e.target.value || null))}
                disabled={pendiente}
                className="input mt-3"
              >
                <option value="">Sin repartidor asignado</option>
                {repartidores.map((r) => (
                  <option key={r.id} value={r.id}>{r.name}</option>
                ))}
              </select>
            </section>
          )}

          {pedido.assignedTo && cerrado && (
            <p className="text-sm text-carbon-500">Lo llevó {pedido.assignedTo.name}</p>
          )}
        </div>

        {/* Acciones */}
        <div className="sticky bottom-0 border-t border-carbon/10 bg-crema p-5">
          {error && <p role="alert" className="mb-3 rounded-lg bg-ladrillo/10 px-3 py-2 text-sm text-ladrillo">{error}</p>}
          {aviso && <p role="status" className="mb-3 rounded-lg bg-verde/10 px-3 py-2 text-sm text-verde">{aviso}</p>}

          <div className="flex gap-2">
            {abierto && principal && (
              <button
                onClick={() => accion(() => avanzarPedido(pedido.id))}
                disabled={pendiente}
                className="btn-primario flex-1 py-3"
              >
                {principal}
              </button>
            )}
            {permisos.imprimir && (
              <button
                onClick={() => accion(() => reimprimir(pedido.id))}
                disabled={pendiente}
                className="btn-fantasma px-4 py-3 text-sm"
              >
                Imprimir
              </button>
            )}
          </div>

          {/* La cuenta de la mesa: la segunda ronda va al mismo pedido */}
          {abierto && permisos.crear && pedido.paymentStatus === 'PENDIENTE' && pedido.status !== 'PENDIENTE' && (
            <button
              onClick={() => setAgregando(true)}
              disabled={pendiente}
              className="btn-fantasma mt-2 w-full py-2.5 text-sm"
            >
              Agregar productos a este pedido
            </button>
          )}

          {/* Se quemó, se cayó, el cliente la devolvió: queda como merma con el código del pedido */}
          {permisos.mermas && pedido.status !== 'PENDIENTE' && pedido.status !== 'RECHAZADO' && (
            <button
              onClick={() => setSalioMal(true)}
              disabled={pendiente}
              className="mt-2 w-full py-2 text-sm text-carbon-500 underline"
            >
              Algo salió mal o se regaló: anotar como merma
            </button>
          )}

          {abierto && permisos.cancelar && (
            <button
              onClick={() => {
                const esNuevo = pedido.status === 'PENDIENTE';
                const motivo = prompt(
                  esNuevo
                    ? '¿Por qué no lo pueden tomar? Ejemplo: sin stock, fuera de zona, ya cerrando'
                    : '¿Por qué se cancela?'
                );
                if (motivo === null) return;
                if (!motivo.trim()) { setError('Poné un motivo: sirve para los reportes'); return; }
                accion(() => cambiarEstado(pedido.id, esNuevo ? 'RECHAZADO' : 'CANCELADO', motivo));
              }}
              disabled={pendiente}
              className="mt-2 w-full py-2 text-sm text-carbon-500 underline"
            >
              {pedido.status === 'PENDIENTE' ? 'Rechazar pedido' : 'Cancelar pedido'}
            </button>
          )}
        </div>
      </div>

      {salioMal && (
        <DialogoSalioMal
          pedido={pedido}
          onCerrar={() => setSalioMal(false)}
          onHecho={(texto) => { setSalioMal(false); setAviso(texto); onCambio(); }}
        />
      )}

      {agregando && (
        <div onClick={(e) => e.stopPropagation()}>
          <NuevoPedidoMostrador
            branchId={branchId}
            categorias={catalogo}
            zonas={zonas}
            mesas={mesas}
            agregarA={{ id: pedido.id, code: pedido.code }}
            abiertoInicial
            onCerrar={() => { setAgregando(false); onCambio(); }}
          />
        </div>
      )}
    </div>
  );
}

/** Qué productos del pedido se perdieron y por qué. Sin plata: solo cantidades. */
function DialogoSalioMal({
  pedido, onCerrar, onHecho,
}: {
  pedido: Pedido; onCerrar: () => void; onHecho: (texto: string) => void;
}) {
  const [cantidades, setCantidades] = useState<Record<string, number>>({});
  const [motivo, setMotivo] = useState('');
  const [tipo, setTipo] = useState<'SALIO_MAL' | 'REGALO' | 'OTRO'>('SALIO_MAL');
  const [error, setError] = useState('');
  const [pendiente, startTransition] = useTransition();

  const total = Object.values(cantidades).reduce((s, n) => s + n, 0);

  function guardar() {
    setError('');
    startTransition(async () => {
      try {
        const r = await registrarMermaPedido(
          pedido.id,
          Object.entries(cantidades).filter(([, n]) => n > 0).map(([itemId, cantidad]) => ({ itemId, cantidad })),
          motivo,
          tipo
        );
        if (!r.ok) { setError(r.error); return; }
        onHecho(`Anotado como ${ETIQUETA_TIPO_MERMA[tipo].toLowerCase()}: ${total} ${total === 1 ? 'producto' : 'productos'} del pedido ${pedido.code}.`);
      } catch {
        setError('No se pudo guardar. Revisá la conexión.');
      }
    });
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-carbon/50 p-4" onClick={(e) => { e.stopPropagation(); onCerrar(); }}>
      <div className="w-full max-w-md rounded-2xl bg-crema p-6" onClick={(e) => e.stopPropagation()}>
        <h3 className="font-display text-xl">Merma del pedido {pedido.code}</h3>
        <p className="mt-1 text-sm text-carbon-500">Queda anotado en Mermas. El pedido no cambia: si se rehace, cargalo aparte.</p>
        <div className="mt-4 grid grid-cols-3 gap-2" role="group" aria-label="Qué pasó">
          {(['SALIO_MAL', 'REGALO', 'OTRO'] as const).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTipo(t)}
              aria-pressed={tipo === t}
              className={`rounded-lg border px-2 py-2 text-sm font-medium ${tipo === t ? 'border-marca bg-marca text-crema' : 'border-carbon/15 bg-white'}`}
            >
              {ETIQUETA_TIPO_MERMA[t]}
            </button>
          ))}
        </div>
        <ul className="mt-4 space-y-2">
          {pedido.items.map((it) => {
            const n = cantidades[it.id] ?? 0;
            return (
              <li key={it.id} className="flex items-center justify-between gap-3 text-sm">
                <span>{it.name}{it.variantName ? ` · ${it.variantName}` : ''} <span className="text-carbon-500">(pidió {it.quantity})</span></span>
                <span className="inline-flex items-center rounded-lg border border-carbon/15 bg-white">
                  <button type="button" className="px-2.5 py-1" aria-label={`Uno menos de ${it.name}`}
                    onClick={() => setCantidades((c) => ({ ...c, [it.id]: Math.max(0, n - 1) }))}>−</button>
                  <span className="w-6 text-center font-medium tabular-nums">{n}</span>
                  <button type="button" className="px-2.5 py-1" aria-label={`Uno más de ${it.name}`}
                    onClick={() => setCantidades((c) => ({ ...c, [it.id]: Math.min(it.quantity, n + 1) }))}>+</button>
                </span>
              </li>
            );
          })}
        </ul>
        <input
          className="input mt-4"
          placeholder={tipo === 'REGALO' ? 'Opcional: a quién o por qué' : tipo === 'OTRO' ? 'Contá qué pasó' : 'Opcional: se quemó, se cayó, lo devolvió...'}
          value={motivo}
          onChange={(e) => setMotivo(e.target.value)}
          maxLength={150}
        />
        {error && <p role="alert" className="mt-3 rounded-lg bg-ladrillo/10 px-3 py-2 text-sm text-ladrillo">{error}</p>}
        <div className="mt-4 flex gap-2">
          <button onClick={onCerrar} className="btn-fantasma flex-1 py-2.5">Cancelar</button>
          <button onClick={guardar} disabled={pendiente || total === 0} className="btn-primario flex-1 py-2.5">
            Anotar {total > 0 ? `${total} ${total === 1 ? 'producto' : 'productos'}` : ''}
          </button>
        </div>
      </div>
    </div>
  );
}
