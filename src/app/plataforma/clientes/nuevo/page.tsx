import { db } from '@/lib/db';
import { requirePlataforma } from '@/lib/plataforma';
import { dominioBase } from '@/lib/tenant';
import AltaCliente from '@/components/plataforma/AltaCliente';

export const dynamic = 'force-dynamic';

export default async function NuevoCliente() {
  await requirePlataforma();
  const planes = await db.plan.findMany({ where: { active: true }, orderBy: { position: 'asc' }, select: { id: true, name: true, price: true } });
  return <AltaCliente planes={planes} dominio={dominioBase()} />;
}
