'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useRef, useState, useTransition } from 'react';
import { logout, cambiarSucursal } from '@/actions/operacion';
import { ETIQUETA_ROL } from '@/lib/permisos';
import type { Role } from '@prisma/client';

export type Seccion = { href: string; label: string; seccion: string; grupo: string };
type Sucursal = { id: string; name: string; slug: string };

/**
 * El menú del panel.
 *
 * Con muchas secciones (el dueño ve 16) una sola fila no entraba: había que
 * deslizarla a ciegas. Ahora las secciones van agrupadas por tema: en la
 * computadora en un menú lateral fijo, en el celular en un panel que se abre
 * con "Menú". Quien tiene pocas (cocina, reparto, mozo) sigue con una barra
 * simple arriba, para no restarle ancho a la pantalla de cocina.
 */
export default function NavAdmin({
  secciones, marca, nombre, rol, sucursales, sucursalActiva, pendientesIniciales, menuLateral,
}: {
  secciones: Seccion[];
  /** El nombre del local (la marca del cliente), arriba del menú */
  marca: string;
  nombre: string; rol: Role;
  sucursales: Sucursal[]; sucursalActiva: string; pendientesIniciales: number;
  /** Lo decide el layout, que también acomoda el contenido al costado */
  menuLateral: boolean;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [pendientes, setPendientes] = useState(pendientesIniciales);
  const [cambiando, startTransition] = useTransition();
  const [abierto, setAbierto] = useState(false);

  const simple = !menuLateral;
  const actual = secciones.find((s) => pathname === s.href || pathname.startsWith(`${s.href}/`));
  const verPedidos = secciones.some((s) => s.href === '/admin/pedidos');

  // Consulta liviana cada 15 segundos: alcanza para que nadie se pierda un pedido
  useEffect(() => {
    if (!verPedidos) return;
    const id = setInterval(async () => {
      try {
        const r = await fetch('/api/pedidos/contador', { cache: 'no-store' });
        if (r.ok) setPendientes((await r.json()).pendientes);
      } catch { /* si se cae la red, seguimos con el último valor */ }
    }, 15000);
    return () => clearInterval(id);
  }, [verPedidos]);

  useEffect(() => { setPendientes(pendientesIniciales); }, [pendientesIniciales]);

  // Al navegar, el panel del celular se cierra solo
  useEffect(() => { setAbierto(false); }, [pathname]);

  async function salir() {
    await logout();
    router.push('/login');
    router.refresh();
  }

  function elegirSucursal(id: string) {
    startTransition(async () => {
      await cambiarSucursal(id);
      router.refresh();
    });
  }

  const contador = pendientes > 0 && (
    <span className="ml-auto rounded-full bg-rojo px-1.5 py-0.5 text-[11px] font-bold leading-none text-sobre-rojo">
      {pendientes}
    </span>
  );

  const selectorSucursal = () =>
    sucursales.length > 1 ? (
      <select
        value={sucursalActiva}
        disabled={cambiando}
        onChange={(e) => elegirSucursal(e.target.value)}
        className={`w-full rounded-lg border border-crema/25 bg-crema/10 px-2.5 py-1.5 text-sm text-crema
                    [&>option]:bg-marca [&>option]:text-crema`}
        aria-label="Cambiar de sucursal"
      >
        {sucursales.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
      </select>
    ) : (
      <span className="block truncate rounded-lg bg-crema/10 px-2.5 py-1.5 text-sm text-crema/75">
        {sucursales.find((s) => s.id === sucursalActiva)?.name}
      </span>
    );

  // ─────────── Pocas secciones: una barra arriba ───────────
  if (simple) {
    return (
      <header className="sticky top-0 z-40 border-b border-carbon/10 bg-marca text-crema">
        <div className="mx-auto flex max-w-[1400px] flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3 sm:px-6">
          <Link href="/admin" className="whitespace-nowrap font-display text-lg">{marca}</Link>
          <div className="max-w-[12rem]">{selectorSucursal()}</div>
          <nav className="order-last flex w-full gap-1 overflow-x-auto sm:order-none sm:w-auto sm:flex-1" aria-label="Secciones">
            {secciones.map((s) => {
              const activo = actual?.href === s.href;
              return (
                <Link
                  key={s.href}
                  href={s.href}
                  aria-current={activo ? 'page' : undefined}
                  className={`flex items-center gap-1.5 whitespace-nowrap rounded-lg px-3 py-1.5 text-sm ${
                    activo ? 'bg-crema font-semibold text-marca' : 'text-crema/75 hover:bg-crema/10'
                  }`}
                >
                  {s.label}
                  {s.href === '/admin/pedidos' && contador}
                </Link>
              );
            })}
          </nav>
          <div className="ml-auto hidden text-right text-xs leading-tight sm:block">
            <p className="font-medium">{nombre}</p>
            <p className="text-crema/55">{ETIQUETA_ROL[rol]}</p>
          </div>
          <button onClick={salir} className="ml-auto text-sm text-crema/75 underline hover:text-crema sm:ml-0">Salir</button>
        </div>
      </header>
    );
  }

  // ─────────── Muchas secciones: agrupadas ───────────
  const grupos = secciones.reduce<{ grupo: string; items: Seccion[] }[]>((acc, s) => {
    const g = acc.find((x) => x.grupo === s.grupo);
    if (g) g.items.push(s);
    else acc.push({ grupo: s.grupo, items: [s] });
    return acc;
  }, []);

  const menu = (
    <nav aria-label="Secciones" className="space-y-4">
      {grupos.map((g) => (
        <div key={g.grupo}>
          <p className="px-3 pb-1 text-xs font-medium text-crema/45">{g.grupo}</p>
          <ul className="space-y-0.5">
            {g.items.map((s) => {
              const activo = actual?.href === s.href;
              return (
                <li key={s.href}>
                  <Link
                    href={s.href}
                    aria-current={activo ? 'page' : undefined}
                    className={`flex items-center rounded-lg px-3 py-1.5 text-sm transition-colors ${
                      activo ? 'bg-crema font-semibold text-marca' : 'text-crema/80 hover:bg-crema/10 hover:text-crema'
                    }`}
                  >
                    {s.label}
                    {s.href === '/admin/pedidos' && contador}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );

  const usuario = (
    <div className="flex items-center justify-between gap-3 border-t border-crema/10 pt-4">
      <div className="min-w-0 text-xs leading-tight">
        <p className="truncate font-medium">{nombre}</p>
        <p className="text-crema/55">{ETIQUETA_ROL[rol]}</p>
      </div>
      <button onClick={salir} className="text-sm text-crema/75 underline hover:text-crema">Salir</button>
    </div>
  );

  return (
    <>
      {/* Computadora: menú lateral fijo */}
      <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col gap-4 overflow-y-auto bg-marca px-3 py-4 text-crema lg:flex">
        <Link href="/admin" className="px-3 font-display text-xl">{marca}</Link>
        <div className="px-1">{selectorSucursal()}</div>
        <div className="flex-1">{menu}</div>
        <div className="px-1">{usuario}</div>
      </aside>

      {/* Celular y tablet: barra con "Menú" */}
      <header className="sticky top-0 z-40 flex items-center gap-3 bg-marca px-4 py-3 text-crema lg:hidden">
        <button
          onClick={() => setAbierto(true)}
          className="flex items-center gap-2 rounded-lg border border-crema/25 px-3 py-1.5 text-sm font-medium"
          aria-expanded={abierto}
          aria-controls="menu-panel"
        >
          <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" className="h-4 w-4" aria-hidden>
            <path d="M3 5h14M3 10h14M3 15h14" strokeLinecap="round" />
          </svg>
          Menú
        </button>
        <span className="min-w-0 flex-1 truncate font-display text-lg">{actual?.label ?? marca}</span>
        {verPedidos && actual?.href !== '/admin/pedidos' && (
          <Link href="/admin/pedidos" className="flex items-center gap-1.5 rounded-lg bg-crema/10 px-2.5 py-1.5 text-sm">
            Pedidos{contador}
          </Link>
        )}
      </header>

      {abierto && <PanelMovil marca={marca} onCerrar={() => setAbierto(false)} selector={selectorSucursal()} menu={menu} usuario={usuario} />}
    </>
  );
}

/** El menú del celular: un panel desde la izquierda que se cierra con Escape, tocando afuera o al navegar. */
function PanelMovil({
  marca, onCerrar, selector, menu, usuario,
}: {
  marca: string; onCerrar: () => void; selector: React.ReactNode; menu: React.ReactNode; usuario: React.ReactNode;
}) {
  const panel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const previo = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    panel.current?.querySelector<HTMLElement>('a, button, select')?.focus();
    const tecla = (e: KeyboardEvent) => { if (e.key === 'Escape') onCerrar(); };
    window.addEventListener('keydown', tecla);
    return () => {
      document.body.style.overflow = previo;
      window.removeEventListener('keydown', tecla);
    };
  }, [onCerrar]);

  return (
    <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true" aria-label="Menú" id="menu-panel">
      <div className="absolute inset-0 bg-carbon/50" onClick={onCerrar} aria-hidden />
      <div ref={panel} className="absolute inset-y-0 left-0 flex w-[min(20rem,85vw)] flex-col gap-5 overflow-y-auto bg-marca px-3 py-5 text-crema shadow-2xl">
        <div className="flex items-center justify-between px-3">
          <span className="font-display text-xl">{marca}</span>
          <button onClick={onCerrar} className="px-2 text-xl text-crema/75" aria-label="Cerrar menú">✕</button>
        </div>
        <div className="px-1">{selector}</div>
        <div className="flex-1">{menu}</div>
        <div className="px-1">{usuario}</div>
      </div>
    </div>
  );
}
