import { requireSession } from '@/lib/session';
import { seccionesVisibles } from '@/lib/permisos';
import { db } from '@/lib/db';
import NavAdmin, { type Seccion } from '@/components/admin/NavAdmin';
import { PRODUCTO } from '@/lib/producto';
import { getTenant } from '@/lib/tenant';
import { SECCIONES_DE_FUNCION } from '@/lib/plan';
import { estadoCobro, diasAviso } from '@/lib/cobros';
import type { Metadata } from 'next';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTenant().catch(() => null);
  return { title: t ? `${t.name} · Panel` : PRODUCTO.nombre };
}

export const dynamic = 'force-dynamic';

/**
 * Las secciones del panel, agrupadas por para qué sirven. El orden de los
 * grupos es el del día: primero lo que se usa en el servicio, al final lo que
 * se toca una vez por mes.
 */
const SECCIONES: Seccion[] = [
  { grupo: 'Día a día', href: '/admin/pedidos', label: 'Pedidos', seccion: 'pedidos' },
  { grupo: 'Día a día', href: '/admin/cocina', label: 'Cocina', seccion: 'cocina' },
  { grupo: 'Día a día', href: '/admin/caja', label: 'Caja', seccion: 'caja' },
  { grupo: 'Día a día', href: '/admin/mermas', label: 'Mermas', seccion: 'stock' },
  { grupo: 'Día a día', href: '/admin/salon', label: 'Salón', seccion: 'mesas' },
  { grupo: 'Día a día', href: '/admin/mesas', label: 'Mesas', seccion: 'mesas' },
  { grupo: 'Día a día', href: '/admin/reservas', label: 'Reservas', seccion: 'mesas' },
  { grupo: 'Plata', href: '/admin/finanzas', label: 'Finanzas', seccion: 'reportes' },
  { grupo: 'Plata', href: '/admin/gastos', label: 'Gastos', seccion: 'gastos' },
  { grupo: 'Plata', href: '/admin/reportes', label: 'Reportes', seccion: 'reportes' },
  { grupo: 'Carta y stock', href: '/admin/productos', label: 'Productos', seccion: 'carta' },
  { grupo: 'Carta y stock', href: '/admin/categorias', label: 'Categorías', seccion: 'carta' },
  { grupo: 'Carta y stock', href: '/admin/promociones', label: 'Promociones', seccion: 'carta' },
  { grupo: 'Carta y stock', href: '/admin/stock', label: 'Stock', seccion: 'stock' },
  { grupo: 'Carta y stock', href: '/admin/insumos', label: 'Insumos y recetas', seccion: 'stock' },
  { grupo: 'El local', href: '/admin/empleados', label: 'Empleados', seccion: 'empleados' },
  { grupo: 'El local', href: '/admin/roles', label: 'Permisos', seccion: 'empleados' },
  { grupo: 'El local', href: '/admin/config', label: 'Configuración', seccion: 'config' },
  { grupo: 'El local', href: '/admin/marca', label: 'Marca', seccion: 'config' },
  { grupo: 'El local', href: '/admin/abono', label: 'Abono', seccion: 'config' },
  { grupo: 'El local', href: '/admin/sucursales', label: 'Sucursales', seccion: 'config' },
];

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const session = await requireSession();
  const tenant = await getTenant();

  const pendientes = session.esSuperadmin || session.permisos.includes('pedidos.ver')
    ? await db.order.count({ where: { branchId: session.branchId, status: 'PENDIENTE', esperandoPago: false } })
    : 0;

  const vistas = seccionesVisibles(session.permisos);

  const visibles = SECCIONES.filter((s) => {
    // Las funciones que el plan del local no incluye no aparecen, ni para el dueño
    const funcion = SECCIONES_DE_FUNCION[s.href];
    if (funcion && !session.funciones.includes(funcion)) return false;
    if (session.esSuperadmin) return true;
    if (s.href === '/admin/roles') return session.permisos.includes('roles.gestionar');
    if (s.href === '/admin/sucursales') return session.permisos.includes('sucursales.gestionar');
    if (s.href === '/admin/marca') return session.permisos.includes('sucursales.gestionar');
    if (s.href === '/admin/abono') return session.permisos.includes('sucursales.gestionar');
    if (s.href === '/admin/reservas') return session.permisos.includes('reservas.ver');
    // Anotar mermas no requiere ver el stock: la cocina y el mozo las cargan
    if (s.href === '/admin/mermas') return vistas.has('stock') || session.permisos.includes('mermas.anotar');
    if (s.href === '/admin/insumos') return session.permisos.includes('insumos.ver') || session.permisos.includes('recetas.editar');
    if (s.href === '/admin/promociones') return session.permisos.includes('promos.editar') || vistas.has('carta');
    return vistas.has(s.seccion);
  });

  // El cartel del abono: solo al dueño, cuando se acerca el vencimiento o ya pasó
  let aviso: { texto: string; urgente: boolean } | null = null;
  if (tenant && (session.esSuperadmin || session.permisos.includes('sucursales.gestionar'))) {
    const e = estadoCobro(tenant);
    const dia = (d: Date) => d.toLocaleDateString('es-AR', { day: 'numeric', month: 'long' });
    if (e.tipo === 'por_vencer') aviso = { texto: `Tu abono vence el ${dia(e.vence)}.`, urgente: false };
    if (e.tipo === 'prueba' && e.dias <= diasAviso()) aviso = { texto: `Tu prueba termina el ${dia(e.vence)}.`, urgente: false };
    if (e.tipo === 'en_gracia') aviso = { texto: `Tu abono venció el ${dia(e.vence)}. Si no se paga antes del ${dia(e.hasta)}, el servicio se pausa.`, urgente: true };
  }

  // Con muchas secciones el menú va al costado (en la computadora); con pocas
  // (cocina, reparto, mozo) alcanza con una barra arriba
  const conMenuLateral = visibles.length > 4;

  return (
    <div className={`min-h-screen bg-crema-200 ${conMenuLateral ? 'lg:flex' : ''}`}>
      <NavAdmin
        secciones={visibles}
        marca={tenant?.name ?? PRODUCTO.nombre}
        nombre={session.name}
        rol={session.role}
        sucursales={session.sucursales}
        sucursalActiva={session.branchId}
        pendientesIniciales={pendientes}
        menuLateral={conMenuLateral}
      />
      <main className={`mx-auto w-full max-w-[1400px] px-4 py-6 sm:px-6 ${conMenuLateral ? 'min-w-0 lg:flex-1' : ''}`}>
        {aviso && (
          <a href="/admin/abono" className={`mb-5 block rounded-xl px-4 py-3 text-sm font-medium ${aviso.urgente ? 'bg-ladrillo text-crema' : 'bg-rojo/10 text-carbon'}`}>
            {aviso.texto} <span className="underline">Ver el abono</span>
          </a>
        )}
        {children}
      </main>
    </div>
  );
}
