'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { simularPago } from '@/actions/orders';

/** "Aprobar" o "Rechazar" el pago de prueba, como haría Mercado Pago. */
export default function BotonesPagoDemo({ orderId, firma }: { orderId: string; firma: string }) {
  const router = useRouter();
  const [pendiente, startTransition] = useTransition();
  const [error, setError] = useState('');

  function resolver(aprobar: boolean) {
    setError('');
    startTransition(async () => {
      try {
        const r = await simularPago(orderId, firma, aprobar);
        if (!r.ok) { setError(r.error); return; }
        router.push(`/pedido/${r.code}?status=${aprobar ? 'approved' : 'rejected'}`);
      } catch {
        setError('No se pudo. Probá de nuevo.');
      }
    });
  }

  return (
    <div className="mt-6 space-y-2">
      {error && <p role="alert" className="rounded-lg bg-ladrillo/10 px-3 py-2 text-sm text-ladrillo">{error}</p>}
      <button
        disabled={pendiente}
        onClick={() => resolver(true)}
        className="w-full rounded-xl bg-sky-500 py-3.5 font-bold text-white hover:bg-sky-600 disabled:opacity-60"
      >
        Pagar (aprobar)
      </button>
      <button
        disabled={pendiente}
        onClick={() => resolver(false)}
        className="w-full rounded-xl border border-carbon/20 py-3 text-sm font-medium disabled:opacity-60"
      >
        Simular tarjeta rechazada
      </button>
    </div>
  );
}
