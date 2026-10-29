'use client';

import { useState } from 'react';
import { PRODUCTO } from '@/lib/producto';

/**
 * En el dominio de la plataforma no hay usuarios: cada local tiene los suyos
 * en su dirección. Acá se escribe el nombre del local y se va a su ingreso.
 */
export default function IngresarALocal({ dominio }: { dominio: string }) {
  const [local, setLocal] = useState('');
  const [error, setError] = useState('');

  function ir(e: React.FormEvent) {
    e.preventDefault();
    const slug = local.trim().toLowerCase().replace(/^https?:\/\//, '').split('.')[0];
    if (!/^[a-z0-9-]{2,40}$/.test(slug)) { setError('Escribí la dirección de tu local, por ejemplo pepperino'); return; }
    const { protocol, port } = window.location;
    window.location.href = `${protocol}//${slug}.${dominio}${port ? `:${port}` : ''}/admin`;
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-marca px-5">
      <div className="w-full max-w-sm">
        <p className="text-center font-display text-4xl text-crema">{PRODUCTO.nombre}</p>
        <h1 className="mt-2 text-center text-sm text-crema/70">Ingresá a tu local</h1>
        <form onSubmit={ir} className="mt-8 space-y-4 rounded-2xl bg-crema p-6">
          <div>
            <label className="label" htmlFor="local">La dirección de tu local</label>
            <div className="flex items-center rounded-xl border border-carbon/15 bg-white focus-within:border-marca">
              <input
                id="local"
                className="min-w-0 flex-1 rounded-l-xl bg-transparent px-3.5 py-2.5 text-sm outline-none"
                value={local}
                onChange={(e) => setLocal(e.target.value)}
                placeholder="tulocal"
                autoCapitalize="none"
                autoCorrect="off"
                autoFocus
              />
              <span className="pr-3.5 text-sm text-carbon-500">.{dominio}</span>
            </div>
          </div>
          {error && <p className="rounded-xl bg-ladrillo/10 px-4 py-3 text-sm text-ladrillo">{error}</p>}
          <button className="btn-primario w-full py-3">Seguir</button>
        </form>
      </div>
    </main>
  );
}
