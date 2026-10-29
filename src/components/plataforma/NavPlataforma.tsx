'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { salirPlataforma } from '@/actions/plataforma';
import { PRODUCTO } from '@/lib/producto';

const SECCIONES = [
  { href: '/plataforma', label: 'Clientes' },
  { href: '/plataforma/planes', label: 'Planes' },
  { href: '/plataforma/pagos', label: 'Pagos' },
  { href: '/plataforma/bitacora', label: 'Bitácora' },
];

export default function NavPlataforma({ nombre }: { nombre: string }) {
  const path = usePathname();
  const router = useRouter();
  return (
    <header className="sticky top-0 z-40 bg-marca text-crema">
      <div className="mx-auto flex max-w-[1300px] flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3 sm:px-6">
        <Link href="/plataforma" className="font-display text-lg">{PRODUCTO.nombre} · Plataforma</Link>
        <nav className="flex flex-wrap gap-1" aria-label="Plataforma">
          {SECCIONES.map((s) => {
            const activo = s.href === '/plataforma' ? path === '/plataforma' || path.startsWith('/plataforma/clientes') : path.startsWith(s.href);
            return (
              <Link key={s.href} href={s.href} aria-current={activo ? 'page' : undefined}
                className={`rounded-lg px-3 py-1.5 text-sm ${activo ? 'bg-crema font-semibold text-marca' : 'text-crema/80 hover:bg-crema/10'}`}>
                {s.label}
              </Link>
            );
          })}
        </nav>
        <div className="ml-auto flex items-center gap-3 text-sm">
          <span className="text-crema/70">{nombre}</span>
          <button onClick={async () => { await salirPlataforma(); router.push('/plataforma/ingresar'); router.refresh(); }} className="underline">Salir</button>
        </div>
      </div>
    </header>
  );
}
