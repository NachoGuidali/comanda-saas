import { notFound, redirect } from 'next/navigation';
import { getTenant } from '@/lib/tenant';
import { getSesionPlataforma } from '@/lib/plataforma';
import IngresoPlataforma from '@/components/plataforma/IngresoPlataforma';

export default async function IngresarPlataforma() {
  if (await getTenant()) notFound();
  if (await getSesionPlataforma()) redirect('/plataforma');
  return <IngresoPlataforma />;
}
