'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { crearSucursal, alternarSucursal } from '@/actions/config';

type Sucursal = {
  id: string; name: string; slug: string; address: string; whatsapp: string;
  active: boolean; aceptaPedidos: boolean;
  _count: { orders: number; products: number; users: number };
};

export default function GestorSucursales({
  sucursales, maximo,
}: {
  /** null = sin límite */
  sucursales: Sucursal[]; maximo: number | null;
}) {
  const router = useRouter();
  const [creando, setCreando] = useState(false);
  const [error, setError] = useState('');
  const [aviso, setAviso] = useState('');
  const [pendiente, startTransition] = useTransition();

  const activas = sucursales.filter((s) => s.active).length;
  const lleno = maximo !== null && sucursales.length >= maximo;

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl">Sucursales</h1>
          <p className="mt-1 text-sm text-carbon-500">
            {maximo !== null ? `${sucursales.length} de ${maximo} cargadas` : `${sucursales.length} cargadas`} · {activas} visibles en la web
          </p>
        </div>
        <button onClick={() => setCreando(true)} disabled={lleno} className="btn-acento">
          Agregar sucursal
        </button>
      </div>

      {lleno && (
        <p className="mb-4 rounded-xl bg-carbon/5 px-4 py-3 text-sm text-carbon-500">
          Tu plan incluye {maximo} {maximo === 1 ? 'local' : 'locales'}. Para sumar otro, escribinos.
        </p>
      )}

      {error && <p className="mb-4 rounded-xl bg-ladrillo/10 px-4 py-3 text-sm text-ladrillo">{error}</p>}
      {aviso && <p className="mb-4 rounded-xl bg-verde/10 px-4 py-3 text-sm text-verde">{aviso}</p>}

      <div className="grid gap-4 lg:grid-cols-2">
        {sucursales.map((s) => (
          <article key={s.id} className={`panel p-5 ${s.active ? '' : 'opacity-70'}`}>
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h2 className="font-display text-xl leading-tight">{s.name}</h2>
                <p className="mt-1 text-sm text-carbon-500">{s.address}</p>
              </div>
              <span
                className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                  s.active ? 'bg-verde/10 text-verde' : 'bg-carbon/10 text-carbon-500'
                }`}
              >
                {s.active ? 'Activa' : 'Apagada'}
              </span>
            </div>

            <dl className="mt-4 grid grid-cols-3 gap-3 border-t border-carbon/10 pt-4 text-center">
              {[
                ['Productos', s._count.products],
                ['Pedidos', s._count.orders],
                ['Usuarios', s._count.users],
              ].map(([label, n]) => (
                <div key={label as string}>
                  <dd className="font-display text-xl">{n}</dd>
                  <dt className="text-xs text-carbon-500">{label}</dt>
                </div>
              ))}
            </dl>

            <p className="mt-3 text-xs text-carbon-500">
              Link público: <span className="font-mono">/{s.slug}</span>
              {!s.aceptaPedidos && ' · no está tomando pedidos'}
            </p>

            <div className="mt-4 flex gap-2">
              {s.active && (
                <Link href={`/${s.slug}`} target="_blank" className="btn-fantasma flex-1 py-2 text-sm">
                  Ver la carta
                </Link>
              )}
              <button
                onClick={() =>
                  startTransition(async () => {
                    setError('');
                    setAviso('');
                    const res = await alternarSucursal(s.id, !s.active);
                    if (!res.ok) setError(res.error);
                    else router.refresh();
                  })
                }
                disabled={pendiente}
                className={s.active ? 'btn-fantasma flex-1 py-2 text-sm' : 'btn-primario flex-1 py-2 text-sm'}
              >
                {s.active ? 'Apagar' : 'Activar'}
              </button>
            </div>

            {s._count.products === 0 && (
              <p className="mt-3 rounded-lg bg-rojo/10 px-3 py-2 text-xs">
                Todavía no tiene carta. Entrá a la sucursal desde el selector de arriba y cargá
                productos, o copiá la carta de otro local desde la pantalla de Productos.
              </p>
            )}
          </article>
        ))}
      </div>

      <p className="mt-8 text-sm text-carbon-500">
        El nombre, el logo y los colores del local se cambian en <Link href="/admin/marca" className="underline">Marca</Link>.
      </p>

      {creando && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-carbon/50 p-4" onClick={() => setCreando(false)}>
          <div className="w-full max-w-md rounded-2xl bg-crema p-6" onClick={(e) => e.stopPropagation()}>
            <h2 className="font-display text-xl">Sucursal nueva</h2>
            <p className="mt-1 text-sm text-carbon-500">
              Nace apagada y sin carta. Cargale los productos y después la activás.
            </p>

            <form
              action={async (fd) => {
                setError('');
                const res = await crearSucursal(fd);
                if (!res.ok) { setError(res.error); return; }
                setCreando(false);
                setAviso('Sucursal creada. Cambiá a ella desde el selector de arriba para cargarle la carta.');
                router.refresh();
              }}
              className="mt-5 space-y-4"
            >
              <div>
                <label className="label" htmlFor="name">Nombre</label>
                <input id="name" name="name" required className="input" placeholder="Pepperino Burzaco" />
              </div>
              <div>
                <label className="label" htmlFor="address">Dirección</label>
                <input id="address" name="address" required className="input" />
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label className="label" htmlFor="whatsapp">WhatsApp</label>
                  <input id="whatsapp" name="whatsapp" required className="input" placeholder="5491100000000" />
                </div>
                <div>
                  <label className="label" htmlFor="phone">Teléfono</label>
                  <input id="phone" name="phone" className="input" />
                </div>
              </div>
              <div>
                <label className="label" htmlFor="eslogan">Bajada</label>
                <input id="eslogan" name="eslogan" className="input" placeholder="Opcional" />
              </div>

              <div className="flex gap-3 pt-2">
                <button className="btn-primario flex-1 py-3">Crear</button>
                <button type="button" onClick={() => setCreando(false)} className="btn-fantasma px-5">Cancelar</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
