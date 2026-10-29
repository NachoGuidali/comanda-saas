'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ingresarPlataforma } from '@/actions/plataforma';
import { PRODUCTO } from '@/lib/producto';

export default function IngresoPlataforma() {
  const router = useRouter();
  const [error, setError] = useState('');
  const [cargando, setCargando] = useState(false);
  return (
    <main className="flex min-h-screen items-center justify-center bg-marca px-5">
      <div className="w-full max-w-sm">
        <p className="text-center font-display text-4xl text-crema">{PRODUCTO.nombre}</p>
        <h1 className="mt-2 text-center text-sm text-crema/70">Administración de la plataforma</h1>
        <form
          action={async (fd) => {
            setError(''); setCargando(true);
            const r = await ingresarPlataforma(fd);
            setCargando(false);
            if (!r.ok) { setError(r.error); return; }
            router.push('/plataforma'); router.refresh();
          }}
          className="mt-8 space-y-4 rounded-2xl bg-crema p-6"
        >
          <div>
            <label className="label" htmlFor="email">Email</label>
            <input id="email" name="email" type="email" required className="input" autoComplete="username" autoFocus />
          </div>
          <div>
            <label className="label" htmlFor="password">Contraseña</label>
            <input id="password" name="password" type="password" required className="input" autoComplete="current-password" />
          </div>
          {error && <p className="rounded-xl bg-ladrillo/10 px-4 py-3 text-sm text-ladrillo">{error}</p>}
          <button disabled={cargando} className="btn-primario w-full py-3">{cargando ? 'Entrando...' : 'Entrar'}</button>
        </form>
      </div>
    </main>
  );
}
