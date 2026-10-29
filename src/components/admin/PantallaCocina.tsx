'use client';

import { useCallback, useEffect, useRef, useState, useTransition } from 'react';
import { avanzarPedido } from '@/actions/orders';
import type { Pedido } from './TableroPedidos';
import { useAlerta } from './useAlerta';

const TIPO: Record<string, string> = { DELIVERY: 'ENVÍO', TAKEAWAY: 'RETIRO', SALON: 'SALÓN' };

/**
 * Esta pantalla va colgada en la cocina. La lee alguien con las manos sucias,
 * a dos metros de distancia: letra grande, sin precios, sin datos del cliente,
 * y un solo botón por pedido.
 */
export default function PantallaCocina({ inicial, puedeAvanzar }: { inicial: Pedido[]; puedeAvanzar: boolean }) {
  const [pedidos, setPedidos] = useState<Pedido[]>(inicial);
  const [ahora, setAhora] = useState(Date.now());
  const [ocupado, startTransition] = useTransition();
  const [aviso, setAviso] = useState('');
  // Firma de cada pedido: id y cantidad de productos. Si llega un pedido nuevo
  // o una mesa suma algo, suena.
  const conocidos = useRef(new Map(inicial.map((p) => [p.id, p.items.length])));
  const { activo: sonidoActivo, activar, sonar } = useAlerta();

  const refrescar = useCallback(async () => {
    try {
      const r = await fetch('/api/pedidos/feed?vista=cocina', { cache: 'no-store' });
      if (!r.ok) return;
      const { pedidos: nuevos } = (await r.json()) as { pedidos: Pedido[] };
      if (nuevos.some((p) => (conocidos.current.get(p.id) ?? -1) < p.items.length)) sonar('Nuevo en cocina');
      conocidos.current = new Map(nuevos.map((p) => [p.id, p.items.length]));
      setPedidos(nuevos);
    } catch { /* reintenta en el próximo ciclo */ }
  }, [sonar]);

  useEffect(() => {
    const feed = setInterval(refrescar, 5000);
    const reloj = setInterval(() => setAhora(Date.now()), 10000);
    return () => { clearInterval(feed); clearInterval(reloj); };
  }, [refrescar]);

  function avanzar(id: string) {
    startTransition(async () => {
      try {
        const r = await avanzarPedido(id);
        if (!r.ok) setAviso(r.error);
      } catch {
        setAviso('No se pudo. Revisá la conexión.');
      }
      await refrescar();
    });
  }

  useEffect(() => {
    if (!aviso) return;
    const t = setTimeout(() => setAviso(''), 5000);
    return () => clearTimeout(t);
  }, [aviso]);

  const barra = (
    <>
      {!sonidoActivo && (
        <button
          onClick={activar}
          className="mb-4 w-full rounded-xl border-2 border-dashed border-rojo bg-rojo/10 px-4 py-3 text-base font-semibold"
        >
          🔔 Tocá acá para activar el sonido
        </button>
      )}
      {aviso && <p role="alert" className="mb-4 rounded-xl bg-ladrillo px-4 py-3 text-base font-semibold text-crema">{aviso}</p>}
    </>
  );

  if (pedidos.length === 0) {
    return (
      <>
      {barra}
      <div className="flex min-h-[60vh] flex-col items-center justify-center text-center">
        <p className="font-display text-3xl font-extrabold">Cocina al día</p>
        <p className="mt-2 text-carbon-500">No hay nada esperando. Los pedidos nuevos aparecen solos.</p>
      </div>
      </>
    );
  }

  return (
    <>
    {barra}
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
      {pedidos.map((p) => {
        const min = Math.floor((ahora - new Date(p.acceptedAt ?? p.createdAt).getTime()) / 60000);
        const urgente = min >= 20;
        const enMarcha = p.status === 'EN_PREPARACION';

        return (
          <article
            key={p.id}
            className={`flex flex-col rounded-2xl border-2 bg-white p-5 ${
              urgente ? 'border-ladrillo' : enMarcha ? 'border-rojo' : 'border-carbon/15'
            }`}
          >
            <header className="flex items-baseline justify-between">
              <span className="font-display text-3xl font-extrabold">{p.code}</span>
              <span className={`text-2xl font-bold tabular-nums ${urgente ? 'text-ladrillo' : 'text-carbon-500'}`}>
                {min}′
              </span>
            </header>

            <p className="mt-1 text-sm font-semibold tracking-wide text-carbon-500">
              {TIPO[p.type]}{p.table ? ` · ${p.table.name}` : ''}
            </p>

            <ul className="mt-4 flex-1 space-y-3">
              {p.items.map((it) => (
                <li key={it.id} className="border-b border-carbon/10 pb-3 last:border-0">
                  <p className="text-xl font-bold leading-tight">
                    <span className="text-ladrillo">{it.quantity}×</span> {it.name}
                    {it.variantName && <span className="text-carbon-500"> {it.variantName}</span>}
                  </p>
                  {it.addons.length > 0 && (
                    <p className="mt-1 text-base text-carbon-500">
                      {it.addons.map((a) => `+ ${a.name}`).join('  ')}
                    </p>
                  )}
                  {it.notes && (
                    <p className="mt-1 rounded-lg bg-rojo/20 px-2.5 py-1 text-base font-semibold">{it.notes}</p>
                  )}
                </li>
              ))}
            </ul>

            {p.notes && (
              <p className="mt-3 rounded-lg bg-rojo/20 px-3 py-2 text-base font-semibold">{p.notes}</p>
            )}

            {puedeAvanzar && (
              <button
                onClick={() => avanzar(p.id)}
                disabled={ocupado}
                className={`mt-4 w-full rounded-xl py-4 text-lg font-bold disabled:opacity-60 ${
                  enMarcha ? 'bg-marca text-crema' : 'bg-rojo text-sobre-rojo'
                }`}
              >
                {enMarcha ? 'Listo' : 'Empezar'}
              </button>
            )}
          </article>
        );
      })}
    </div>
    </>
  );
}
