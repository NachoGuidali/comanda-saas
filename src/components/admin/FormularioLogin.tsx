'use client';

import { useState } from 'react';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { login } from '@/actions/operacion';
import { PRODUCTO } from '@/lib/producto';

/** El ingreso del equipo de un local, con la marca del local. */
export default function FormularioLogin({ nombre, logoUrl, aviso }: { nombre: string; logoUrl: string; aviso?: string }) {
  const router = useRouter();
  const [error, setError] = useState(aviso ?? '');
  const [cargando, setCargando] = useState(false);

  async function entrar(fd: FormData) {
    setError('');
    setCargando(true);
    const res = await login(fd);
    setCargando(false);
    if (!res.ok) { setError(res.error); return; }
    router.push(res.role === 'COCINA' ? '/admin/cocina' : '/admin/pedidos');
    router.refresh();
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-marca px-5">
      <div className="w-full max-w-sm">
        {logoUrl && (
          <div className="relative mx-auto mb-4 h-20 w-20 overflow-hidden rounded-2xl bg-crema">
            <Image src={logoUrl} alt="" fill className="object-contain p-1.5" sizes="80px" />
          </div>
        )}
        <p className="text-center font-display text-4xl text-crema">{nombre}</p>
        <h1 className="mt-2 text-center text-sm text-crema/70">Acceso del personal</h1>
        <form action={entrar} className="mt-8 space-y-4 rounded-2xl bg-crema p-6">
          <div>
            <label className="label" htmlFor="email">Email</label>
            <input id="email" name="email" type="email" required className="input" autoComplete="username" autoFocus />
          </div>
          <div>
            <label className="label" htmlFor="password">Contraseña</label>
            <input id="password" name="password" type="password" required className="input" autoComplete="current-password" />
          </div>
          {error && <p className="rounded-xl bg-ladrillo/10 px-4 py-3 text-sm text-ladrillo">{error}</p>}
          <button disabled={cargando} className="btn-primario w-full py-3">
            {cargando ? 'Entrando...' : 'Entrar'}
          </button>
        </form>
        <p className="mt-6 text-center text-xs text-crema/45">{PRODUCTO.nombre}</p>
      </div>
    </main>
  );
}
