'use client';

import { useCallback, useEffect, useRef, useState, useTransition } from 'react';
import { money } from '@/lib/money';
import { ETIQUETA_PAGO } from '@/lib/etiquetas';
import { avanzarPedido, cambiarEstado, asignarRepartidor, marcarCobrado, reimprimir } from '@/actions/orders';
import DetallePedido from './DetallePedido';
import { useAlerta } from './useAlerta';
import type { CategoriaMostrador } from './NuevoPedidoMostrador';
import { hora } from '@/lib/tiempo';

type Addon = { id: string; name: string; price: number };
type Item = {
  id: string; name: string; variantName: string | null; quantity: number;
  total: number; notes: string | null; addons: Addon[];
};
export type Pedido = {
  id: string; code: string; status: string; type: string; source: string;
  customerName: string; customerPhone: string; address: string | null; addressNotes: string | null;
  subtotal: number; deliveryFee: number; discount: number; total: number;
  paymentMethod: string; paymentStatus: string; cashAmount: number | null;
  pagoOnline: boolean; esperandoPago: boolean; mpStatus: string | null;
  notes: string | null; cancelReason: string | null; promoCode: string | null;
  createdAt: string; acceptedAt: string | null;
  readyAt: string | null; dispatchedAt: string | null; deliveredAt: string | null;
  items: Item[];
  table: { name: string } | null;
  assignedTo: { id: string; name: string } | null;
  zone: { name: string } | null;
};
type Repartidor = { id: string; name: string };

export type PermisosTablero = {
  avanzar: boolean; crear: boolean; cancelar: boolean; cobrar: boolean;
  imprimir: boolean; asignar: boolean; repartir: boolean; cocina: boolean;
  /** Puede anotar que algo del pedido se perdió (salió mal, se quemó) */
  mermas: boolean;
  userId: string;
};

const COLUMNAS = [
  { estado: 'PENDIENTE', titulo: 'Nuevos' },
  { estado: 'ACEPTADO', titulo: 'Aceptados' },
  { estado: 'EN_PREPARACION', titulo: 'En preparación' },
  { estado: 'LISTO', titulo: 'Listos' },
  { estado: 'EN_CAMINO', titulo: 'En camino' },
  { estado: 'ENTREGADO', titulo: 'Entregados' },
  // Rechazado y cancelado se guardan distinto para los reportes, pero en el
  // tablero conviene verlos juntos: para el que atiende son lo mismo.
  { estado: 'RECHAZADO', titulo: 'Rechazados', incluye: ['RECHAZADO', 'CANCELADO'] },
];

const TIPO: Record<string, string> = { DELIVERY: 'Envío', TAKEAWAY: 'Retiro', SALON: 'Salón' };
const ABIERTOS = ['PENDIENTE', 'ACEPTADO', 'EN_PREPARACION', 'LISTO', 'EN_CAMINO'];

function minutosDesde(iso: string) {
  return Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
}

/**
 * Qué botón principal le corresponde a esta persona para este pedido, o null.
 * Tiene que coincidir con las reglas del servidor (autorizado en orders.ts):
 * si no, aparece un botón que después dice "no tenés permiso".
 */
export function accionPrincipal(p: Pedido, perm: PermisosTablero): string | null {
  const esMio = !p.assignedTo || p.assignedTo.id === perm.userId;
  // Hasta que Mercado Pago no lo acredite, no se acepta
  if (p.esperandoPago) return null;
  switch (p.status) {
    case 'PENDIENTE':
      return perm.avanzar ? 'Aceptar' : null;
    case 'ACEPTADO':
      return perm.avanzar || perm.cocina ? 'Mandar a cocina' : null;
    case 'EN_PREPARACION':
      return perm.avanzar || perm.cocina ? 'Marcar listo' : null;
    case 'LISTO':
      if (p.type === 'DELIVERY') return perm.avanzar || (perm.repartir && esMio) ? 'Despachar' : null;
      return perm.avanzar ? 'Entregado' : null;
    case 'EN_CAMINO':
      return perm.avanzar || (perm.repartir && esMio) ? 'Entregado' : null;
    default:
      return null;
  }
}

export default function TableroPedidos({
  inicial, repartidores, permisos, branchId, catalogo, zonas, mesas,
}: {
  inicial: Pedido[];
  repartidores: Repartidor[];
  permisos: PermisosTablero;
  branchId: string;
  catalogo: CategoriaMostrador[];
  zonas: { id: string; name: string; fee: number }[];
  mesas: { id: string; name: string }[];
}) {
  const [pedidos, setPedidos] = useState<Pedido[]>(inicial);
  const [abierto, setAbierto] = useState<string | null>(null);
  const [detalle, setDetalle] = useState<string | null>(null);
  const [aviso, setAviso] = useState('');
  // En celular no entran siete columnas: se muestra una por vez
  const [columnaMovil, setColumnaMovil] = useState('PENDIENTE');
  const [ocupado, startTransition] = useTransition();
  const conocidos = useRef(new Set(inicial.filter((p) => p.status === 'PENDIENTE' && !p.esperandoPago).map((p) => p.id)));
  const { activo: sonidoActivo, activar, sonar } = useAlerta();

  const refrescar = useCallback(async () => {
    try {
      const r = await fetch('/api/pedidos/feed?vista=tablero', { cache: 'no-store' });
      if (!r.ok) return;
      const { pedidos: nuevos } = (await r.json()) as { pedidos: Pedido[] };

      // Suena por cada pedido nuevo que no habíamos visto, no por la cantidad:
      // si entra uno y se acepta otro en el mismo ciclo, igual tiene que sonar.
      // Los que esperan el pago online no suenan: suenan cuando se acreditan
      const pendientes = nuevos.filter((x) => x.status === 'PENDIENTE' && !x.esperandoPago);
      if (pendientes.some((x) => !conocidos.current.has(x.id))) sonar();
      conocidos.current = new Set(pendientes.map((x) => x.id));

      setPedidos(nuevos);
    } catch { /* red intermitente: reintentamos en el proximo ciclo */ }
  }, [sonar]);

  useEffect(() => {
    const id = setInterval(refrescar, 5000);
    return () => clearInterval(id);
  }, [refrescar]);

  useEffect(() => {
    if (!aviso) return;
    const t = setTimeout(() => setAviso(''), 6000);
    return () => clearTimeout(t);
  }, [aviso]);

  function accion(fn: () => Promise<{ ok: boolean; error?: string; aviso?: string }>) {
    startTransition(async () => {
      try {
        const r = (await fn()) as { ok: boolean; error?: string; aviso?: string };
        if (!r.ok && r.error) setAviso(r.error);
        else if (r.aviso) setAviso(r.aviso);
      } catch {
        setAviso('No se pudo completar la acción. Revisá la conexión.');
      }
      await refrescar();
    });
  }

  function pedirMotivo(ped: Pedido) {
    const esNuevo = ped.status === 'PENDIENTE';
    const motivo = prompt(
      esNuevo ? '¿Por qué no lo pueden tomar? Ejemplo: sin stock, fuera de zona, ya cerrando' : '¿Por qué se cancela?'
    );
    if (motivo === null) return;
    if (!motivo.trim()) { setAviso('Poné un motivo: sirve para los reportes'); return; }
    accion(() => cambiarEstado(ped.id, esNuevo ? 'RECHAZADO' : 'CANCELADO', motivo));
  }

  const estadosDe = (col: { estado: string; incluye?: string[] }) => col.incluye ?? [col.estado];
  const contar = (col: { estado: string; incluye?: string[] }) =>
    pedidos.filter((x) => estadosDe(col).includes(x.status)).length;

  return (
    <div>
      {!sonidoActivo && (
        <button
          onClick={activar}
          className="mb-4 w-full rounded-xl border-2 border-dashed border-rojo bg-rojo/10 px-4 py-3 text-sm font-semibold"
        >
          🔔 Tocá acá para activar el sonido de pedidos nuevos
        </button>
      )}

      {aviso && (
        <div role="alert" className="fixed left-1/2 top-20 z-[70] w-[min(92vw,480px)] -translate-x-1/2 rounded-xl bg-ladrillo px-4 py-3 text-sm font-medium text-crema shadow-lg">
          {aviso}
        </div>
      )}

      {/* En celular se elige la columna; en escritorio se ven todas */}
      <div className="scroll-fino -mx-4 mb-4 flex gap-2 overflow-x-auto px-4 lg:hidden">
        {COLUMNAS.map((c) => (
          <button
            key={c.estado}
            onClick={() => setColumnaMovil(c.estado)}
            className={`chip ${columnaMovil === c.estado ? 'chip-activo' : ''}`}
          >
            {c.titulo}
            {contar(c) > 0 && <span className="ml-1.5 font-bold">{contar(c)}</span>}
          </button>
        ))}
      </div>

      <div className="scroll-fino flex flex-col gap-4 lg:flex-row lg:overflow-x-auto lg:pb-4">
        {COLUMNAS.map((col) => {
          const lista = pedidos.filter((x) => estadosDe(col).includes(x.status));
          const cerrada = col.estado === 'ENTREGADO' || col.estado === 'RECHAZADO';

          return (
            <section
              key={col.estado}
              className={`w-full lg:w-[320px] lg:shrink-0 ${columnaMovil === col.estado ? '' : 'hidden lg:block'}`}
            >
              <header className="mb-3 hidden items-center justify-between lg:flex">
                <h2 className="font-display text-base">{col.titulo}</h2>
                <span className="rounded-full bg-carbon/10 px-2 py-0.5 text-xs font-semibold">{lista.length}</span>
              </header>

              <div className="space-y-3">
                {lista.length === 0 && (
                  <p className="rounded-xl border border-dashed border-carbon/15 px-4 py-6 text-center text-sm text-carbon-500">
                    Nada por acá
                  </p>
                )}

                {lista.map((ped) => {
                  const espera = minutosDesde(ped.createdAt);
                  const demorado = ped.status === 'PENDIENTE' && espera > 5;
                  const expandido = abierto === ped.id;
                  const principal = accionPrincipal(ped, permisos);
                  const puedeCobrar =
                    !ped.esperandoPago && permisos.cobrar && (permisos.avanzar || ped.assignedTo?.id === permisos.userId);

                  return (
                    <article
                      key={ped.id}
                      onClick={() => setDetalle(ped.id)}
                      className={`panel cursor-pointer overflow-hidden p-4 transition-shadow hover:shadow-lg ${
                        demorado ? 'late border-rojo/50' : ''
                      } ${cerrada ? 'opacity-80' : ''}`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <p className="font-display text-lg leading-none">{ped.code}</p>
                          <p className="mt-1 text-sm text-carbon-500">
                            {TIPO[ped.type]}{ped.table ? ` · ${ped.table.name}` : ''}{ped.zone ? ` · ${ped.zone.name}` : ''}
                          </p>
                        </div>
                        {!cerrada && (
                          <span className={`text-xs font-semibold ${espera > 30 ? 'text-rojo' : 'text-carbon-500'}`}>
                            {espera} min
                          </span>
                        )}
                      </div>

                      <p className="mt-2 text-sm font-medium">{ped.customerName}</p>
                      {ped.customerPhone !== '-' && (
                        <a href={`tel:${ped.customerPhone}`} onClick={(e) => e.stopPropagation()} className="text-sm text-carbon-500 underline">
                          {ped.customerPhone}
                        </a>
                      )}
                      {ped.address && <p className="mt-1 text-sm text-carbon-500">{ped.address}</p>}

                      <button
                        onClick={(e) => { e.stopPropagation(); setAbierto(expandido ? null : ped.id); }}
                        className="mt-3 w-full rounded-lg bg-carbon/5 px-3 py-1.5 text-left text-xs font-medium"
                      >
                        {expandido ? 'Ocultar' : `Ver ${ped.items.length} producto${ped.items.length > 1 ? 's' : ''}`}
                      </button>

                      {expandido && (
                        <ul className="mt-2 space-y-1.5 text-sm">
                          {ped.items.map((it) => (
                            <li key={it.id}>
                              <span className="font-medium">{it.quantity}x</span>{' '}
                              {it.name}{it.variantName ? ` · ${it.variantName}` : ''}
                              {it.addons.length > 0 && (
                                <span className="block pl-5 text-xs text-carbon-500">
                                  {it.addons.map((a) => a.name).join(', ')}
                                </span>
                              )}
                              {it.notes && <span className="block pl-5 text-xs italic text-rojo">{it.notes}</span>}
                            </li>
                          ))}
                        </ul>
                      )}

                      {ped.esperandoPago && (
                        <p className="mt-2 rounded-lg bg-sky-100 px-3 py-2 text-xs font-medium text-sky-900">
                          Esperando el pago por Mercado Pago{ped.mpStatus === 'rejected' ? ' · le rechazaron la tarjeta' : ''}.
                          Entra solo cuando se acredite.
                        </p>
                      )}

                      {ped.notes && <p className="mt-2 rounded-lg bg-rojo/10 px-3 py-2 text-xs">{ped.notes}</p>}

                      {(ped.status === 'RECHAZADO' || ped.status === 'CANCELADO') && (
                        <p className="mt-2 rounded-lg bg-ladrillo/10 px-3 py-2 text-xs text-ladrillo">
                          <strong>{ped.status === 'RECHAZADO' ? 'Rechazado' : 'Cancelado'}</strong>
                          {ped.cancelReason ? ` · ${ped.cancelReason}` : ''}
                        </p>
                      )}

                      <div className="mt-3 flex items-center justify-between border-t border-carbon/10 pt-3">
                        <span className="text-sm">
                          <span className="font-bold">{money(ped.total)}</span>
                          <span className="ml-2 text-carbon-500">{ETIQUETA_PAGO[ped.paymentMethod] ?? ped.paymentMethod}</span>
                        </span>
                        {cerrada && ped.status !== 'ENTREGADO' ? null : ped.paymentStatus === 'PENDIENTE' ? (
                          puedeCobrar ? (
                            <button
                              disabled={ocupado}
                              onClick={(e) => { e.stopPropagation(); accion(() => marcarCobrado(ped.id)); }}
                              className="text-xs text-carbon-500 underline"
                            >
                              Marcar cobrado
                            </button>
                          ) : (
                            <span className="text-xs font-medium text-rojo">Sin cobrar</span>
                          )
                        ) : (
                          <span className="text-xs font-medium text-verde">
                            {ped.pagoOnline ? (ped.mpStatus === 'refunded' ? 'Devuelto' : 'Pagado online') : 'Cobrado'}
                          </span>
                        )}
                      </div>

                      {ped.cashAmount && !cerrada && (
                        <p className="mt-1 text-xs text-carbon-500">
                          Abona con {money(ped.cashAmount)} · vuelto {money(ped.cashAmount - ped.total)}
                        </p>
                      )}

                      {permisos.asignar && ABIERTOS.includes(ped.status) && ped.status !== 'PENDIENTE' && ped.type === 'DELIVERY' && ped.status !== 'EN_CAMINO' && (
                        <select
                          value={ped.assignedTo?.id ?? ''}
                          disabled={ocupado}
                          onClick={(e) => e.stopPropagation()}
                          onChange={(e) => accion(() => asignarRepartidor(ped.id, e.target.value || null))}
                          className="input mt-3 py-1.5 text-sm"
                        >
                          <option value="">Sin repartidor asignado</option>
                          {repartidores.map((r) => (
                            <option key={r.id} value={r.id}>{r.name}</option>
                          ))}
                        </select>
                      )}

                      {ped.assignedTo && (ped.status === 'EN_CAMINO' || ped.status === 'ENTREGADO') && (
                        <p className="mt-2 text-xs text-carbon-500">
                          {ped.status === 'EN_CAMINO' ? 'Lo lleva' : 'Llevó'} {ped.assignedTo.name}
                        </p>
                      )}

                      {ped.status === 'ENTREGADO' && ped.deliveredAt && (
                        <p className="mt-2 text-xs text-verde">
                          Entregado a las{' '}
                          {hora(ped.deliveredAt)}
                        </p>
                      )}

                      {!cerrada && (principal || permisos.imprimir) && (
                        <div className="mt-3 flex gap-2">
                          {principal && (
                            <button
                              disabled={ocupado}
                              onClick={(e) => { e.stopPropagation(); accion(() => avanzarPedido(ped.id)); }}
                              className="btn-primario flex-1 py-2 text-sm"
                            >
                              {principal}
                            </button>
                          )}
                          {permisos.imprimir && (
                            <button
                              disabled={ocupado}
                              onClick={(e) => { e.stopPropagation(); accion(() => reimprimir(ped.id)); }}
                              className="btn-fantasma px-3 py-2 text-sm"
                              title="Volver a imprimir la comanda"
                            >
                              Imprimir
                            </button>
                          )}
                        </div>
                      )}

                      {!cerrada && permisos.cancelar && (
                        <button
                          disabled={ocupado}
                          onClick={(e) => { e.stopPropagation(); pedirMotivo(ped); }}
                          className="mt-2 w-full py-1 text-xs text-carbon-500 underline"
                        >
                          {ped.status === 'PENDIENTE' ? 'Rechazar pedido' : 'Cancelar pedido'}
                        </button>
                      )}

                      {ped.status === 'ENTREGADO' && permisos.imprimir && (
                        <button
                          disabled={ocupado}
                          onClick={(e) => { e.stopPropagation(); accion(() => reimprimir(ped.id)); }}
                          className="btn-fantasma mt-3 w-full py-2 text-sm"
                        >
                          Reimprimir ticket
                        </button>
                      )}
                    </article>
                  );
                })}
              </div>
            </section>
          );
        })}
      </div>

      {detalle && (() => {
        const p = pedidos.find((x) => x.id === detalle);
        if (!p) return null;
        return (
          <DetallePedido
            pedido={p}
            repartidores={repartidores}
            permisos={permisos}
            branchId={branchId}
            catalogo={catalogo}
            zonas={zonas}
            mesas={mesas}
            onCerrar={() => setDetalle(null)}
            onCambio={() => { refrescar(); }}
          />
        );
      })()}
    </div>
  );
}
