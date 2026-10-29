'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { money } from '@/lib/money';
import { cambiarEstadoReserva } from '@/actions/operacion';
import { hora } from '@/lib/tiempo';

type Mesa = { id: string; name: string; capacity: number };
type Reserva = {
  id: string; customerName: string; customerPhone: string; email: string | null;
  type: string; status: string; date: string; people: number;
  notes: string | null; budget: number | null; createdAt: string;
  table: { id: string; name: string } | null;
};

const TIPOS: Record<string, string> = { MESA: 'Mesa', CUMPLEANOS: 'Cumpleaños', EVENTO: 'Evento' };

const ESTADOS = [
  { id: 'NUEVA', label: 'Nueva', clase: 'bg-rojo/15 text-rojo-600' },
  { id: 'CONFIRMADA', label: 'Confirmada', clase: 'bg-verde/10 text-verde' },
  { id: 'SENTADA', label: 'Sentada', clase: 'bg-marca text-crema' },
  { id: 'CUMPLIDA', label: 'Cumplida', clase: 'bg-carbon/10 text-carbon-500' },
  { id: 'CANCELADA', label: 'Cancelada', clase: 'bg-ladrillo/10 text-ladrillo' },
  { id: 'NO_SE_PRESENTO', label: 'No se presentó', clase: 'bg-ladrillo/10 text-ladrillo' },
];

export default function GestorReservas({
  reservas, mesas, puedeGestionar,
}: {
  reservas: Reserva[]; mesas: Mesa[]; puedeGestionar: boolean;
}) {
  const router = useRouter();
  const [filtro, setFiltro] = useState<'PENDIENTES' | 'TODAS' | 'EVENTOS'>('PENDIENTES');
  const [pendiente, startTransition] = useTransition();
  const [error, setError] = useState('');

  const visibles = reservas.filter((r) => {
    if (filtro === 'PENDIENTES') return ['NUEVA', 'CONFIRMADA'].includes(r.status);
    if (filtro === 'EVENTOS') return r.type !== 'MESA';
    return true;
  });

  const nuevas = reservas.filter((r) => r.status === 'NUEVA').length;

  function actualizar(id: string, status: string, tableId?: string) {
    setError('');
    startTransition(async () => {
      const res = await cambiarEstadoReserva(id, status as 'CONFIRMADA', tableId);
      if (!res.ok) { setError(res.error); return; }
      router.refresh();
    });
  }

  return (
    <div>
      <div className="mb-5">
        <h1 className="font-display text-2xl font-extrabold">Reservas y eventos</h1>
        <p className="mt-1 text-sm text-carbon-500">
          {nuevas === 0 ? 'Todo respondido.' : `${nuevas} sin responder todavía.`}
        </p>
      </div>

      <div className="mb-4 flex gap-2">
        {([
          ['PENDIENTES', 'Pendientes'],
          ['EVENTOS', 'Cumpleaños y eventos'],
          ['TODAS', 'Todas'],
        ] as const).map(([id, label]) => (
          <button key={id} onClick={() => setFiltro(id)} className={`chip ${filtro === id ? 'chip-activo' : ''}`}>
            {label}
          </button>
        ))}
      </div>

      {error && <p className="mb-4 rounded-xl bg-ladrillo/10 px-4 py-3 text-sm text-ladrillo">{error}</p>}

      <div className="space-y-3">
        {visibles.length === 0 && (
          <p className="panel p-10 text-center text-sm text-carbon-500">
            No hay reservas en esta vista.
          </p>
        )}

        {visibles.map((r) => {
          const estado = ESTADOS.find((e) => e.id === r.status) ?? ESTADOS[0];
          const fecha = new Date(r.date);
          const pasada = fecha < new Date();

          return (
            <article key={r.id} className={`panel p-5 ${r.status === 'NUEVA' ? 'border-rojo/40' : ''}`}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="font-display text-lg font-bold">{r.customerName}</h2>
                    <span className="rounded-full bg-carbon/10 px-2.5 py-0.5 text-xs font-semibold">
                      {TIPOS[r.type] ?? r.type}
                    </span>
                    <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${estado.clase}`}>
                      {estado.label}
                    </span>
                  </div>

                  <p className="mt-1.5 text-sm">
                    <strong>{r.people} personas</strong> ·{' '}
                    {fecha.toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric', month: 'long' })} a las{' '}
                    {hora(fecha)}
                    {pasada && <span className="ml-2 text-carbon-500">(ya pasó)</span>}
                  </p>

                  <p className="mt-1 text-sm text-carbon-500">
                    <a href={`tel:${r.customerPhone}`} className="underline">{r.customerPhone}</a>
                    {r.email && ` · ${r.email}`}
                    {r.budget && ` · presupuesto ${money(r.budget)} por persona`}
                  </p>

                  {r.notes && <p className="mt-2 rounded-lg bg-carbon/5 px-3 py-2 text-sm">{r.notes}</p>}
                  {r.table && <p className="mt-2 text-sm">Asignada a la mesa <strong>{r.table.name}</strong></p>}
                </div>

                <a
                  href={`https://wa.me/${r.customerPhone.replace(/\D/g, '')}`}
                  target="_blank"
                  rel="noreferrer"
                  className="btn-acento shrink-0 text-sm"
                >
                  Responder por WhatsApp
                </a>
              </div>

              {puedeGestionar && (
              <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-carbon/10 pt-4">
                {r.type === 'MESA' && ['NUEVA', 'CONFIRMADA'].includes(r.status) && (
                  <select
                    value={r.table?.id ?? ''}
                    onChange={(e) => actualizar(r.id, 'CONFIRMADA', e.target.value)}
                    disabled={pendiente}
                    className="input max-w-[14rem] py-1.5 text-sm"
                  >
                    <option value="">Asignar mesa</option>
                    {mesas
                      .filter((m) => m.capacity >= r.people)
                      .map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.name} · hasta {m.capacity}
                        </option>
                      ))}
                  </select>
                )}

                {ESTADOS.filter((e) => e.id !== r.status && e.id !== 'NUEVA').map((e) => (
                  <button
                    key={e.id}
                    onClick={() => actualizar(r.id, e.id)}
                    disabled={pendiente}
                    className="btn-fantasma px-3 py-1.5 text-sm"
                  >
                    {e.label}
                  </button>
                ))}
              </div>
              )}
            </article>
          );
        })}
      </div>
    </div>
  );
}
