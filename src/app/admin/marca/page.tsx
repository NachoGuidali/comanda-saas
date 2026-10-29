import { db } from '@/lib/db';
import { requireSession } from '@/lib/session';
import { urlDelCliente } from '@/lib/tenant';
import EditorMarca from '@/components/admin/EditorMarca';

export const dynamic = 'force-dynamic';

/** La marca del cliente: nombre, eslogan, logo y colores. La cambia el dueño. */
export default async function MarcaPage() {
  const s = await requireSession('sucursales.gestionar');
  const t = await db.tenant.findUniqueOrThrow({ where: { id: s.tenantId } });
  return (
    <EditorMarca
      inicial={{
        nombre: t.name, eslogan: t.slogan, logoUrl: t.logoUrl,
        principal: t.colorPrimary, acento: t.colorAccent, fondo: t.colorBackground,
      }}
      direccion={urlDelCliente(t)}
    />
  );
}
