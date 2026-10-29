'use client';

import { useState, useTransition } from 'react';
import { pagarAbono, debitoAutomatico } from '@/actions/abono';
import { money } from '@/lib/money';

/** Pagar el abono con Mercado Pago: unos meses, o el débito automático mensual. */
export default function PagarAbono({ disponible, precio, email, debitoActivo }: { disponible: boolean; precio: number; email: string; debitoActivo: boolean }) {
  const [mail, setMail] = useState(email);
  const [error, setError] = useState('');
  const [pendiente, startTransition] = useTransition();

  if (!disponible) {
    return <section className="panel p-5 text-sm text-carbon-500">Para pagar, escribinos a contacto@supregsolutions.com o al WhatsApp +54 9 11 7822-0245.</section>;
  }
  const ir = (fn: () => Promise<{ ok: true; url: string } | { ok: false; error: string }>) => {
    setError('');
    startTransition(async () => {
      const r = await fn();
      if (r.ok) window.location.href = r.url;
      else setError(r.error);
    });
  };
  return (
    <section className="panel space-y-4 p-5">
      <h2 className="font-display text-lg">Pagar con Mercado Pago</h2>
      <div className="flex flex-wrap gap-2">
        {[1, 3, 6].map((n) => (
          <button key={n} disabled={pendiente} onClick={() => ir(() => pagarAbono(n))} className={n === 1 ? 'btn-primario' : 'btn-fantasma'}>
            {n} {n === 1 ? 'mes' : 'meses'} · {money(precio * n)}
          </button>
        ))}
      </div>
      <div className="border-t border-carbon/10 pt-4">
        <p className="text-sm font-semibold">Débito automático {debitoActivo && <span className="font-normal text-carbon-500">· ya generado</span>}</p>
        <p className="mt-1 text-sm text-carbon-500">Mercado Pago te cobra {money(precio)} todos los meses y no tenés que acordarte. Poné el mail de tu cuenta de Mercado Pago.</p>
        <div className="mt-2 flex gap-2">
          <input className="input" type="email" value={mail} onChange={(e) => setMail(e.target.value)} aria-label="Mail de tu cuenta de Mercado Pago" />
          <button disabled={pendiente} onClick={() => ir(() => debitoAutomatico(mail))} className="btn-fantasma shrink-0">Activar</button>
        </div>
      </div>
      {error && <p role="alert" className="rounded-lg bg-ladrillo/10 px-3 py-2 text-sm text-ladrillo">{error}</p>}
    </section>
  );
}
