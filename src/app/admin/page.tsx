import { redirect } from 'next/navigation';
import { requireSession } from '@/lib/session';
import { seccionesVisibles } from '@/lib/permisos';

export default async function AdminIndex() {
  const session = await requireSession();
  if (session.esSuperadmin) redirect('/admin/pedidos');

  const vistas = seccionesVisibles(session.permisos);
  if (session.role === 'COCINA' && vistas.has('cocina')) redirect('/admin/cocina');
  if (vistas.has('pedidos')) redirect('/admin/pedidos');
  if (vistas.has('cocina')) redirect('/admin/cocina');
  if (vistas.has('mesas')) redirect('/admin/mesas');
  redirect('/login?error=sin-permiso');
}
