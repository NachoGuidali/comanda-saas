'use client';

import { useState, useTransition } from 'react';
import { money } from '@/lib/money';
import { pagarPedido } from '@/actions/orders';

/** Vuelve a mandar al cliente a Mercado Pago para pagar un pedido pendiente. */
export default function BotonPagar({ code, total }: { code: string; total: number }) {
  const [pendiente, startTransition] = useTransition();
  const [error, setError] = useState('');

  return (
    <div className="mt-4">
      {error && <p role="alert" className="mb-2 text-sm text-ladrillo">{error}</p>}
      <button
        disabled={pendiente}
        onClick={() =>
          startTransition(async () => {
            setError('');
            try {
              const r = await pagarPedido(code);
              if (!r.ok) { setError(r.error); return; }
              window.location.href = r.url;
            } catch {
              setError('No se pudo. Probá de nuevo.');
            }
          })
        }
        className="w-full rounded-xl bg-sky-500 py-3 font-bold text-white hover:bg-sky-600 disabled:opacity-60"
      >
        {pendiente ? 'Abriendo Mercado Pago...' : `Pagar ${money(total)} con Mercado Pago`}
      </button>
    </div>
  );
}
