import Link from 'next/link';
import { db } from '@/lib/db';
import { requirePlataforma } from '@/lib/plataforma';
import { ETIQUETA_ACCION } from '@/lib/auditoria-etiquetas';

export const dynamic = 'force-dynamic';

/** Lo último que pasó en la plataforma y en los locales: ingresos, cambios, pagos, suspensiones. */
export default async function Bitacora({ searchParams }: { searchParams: Promise<{ solo?: string }> }) {
  await requirePlataforma();
  const { solo } = await searchParams;
  const filas = await db.auditLog.findMany({
    where: solo === 'plataforma' ? { tenantId: null } : {},
    orderBy: { createdAt: 'desc' },
    take: 300,
    include: { tenant: { select: { id: true, name: true } } },
  });
  return (
    <div>
      <div className="mb-5 flex flex-wrap items-center gap-2">
        <h1 className="mr-3 font-display text-2xl">Bitácora</h1>
        <Link href="/plataforma/bitacora" className={`chip ${solo ? '' : 'chip-activo'}`}>Todo</Link>
        <Link href="/plataforma/bitacora?solo=plataforma" className={`chip ${solo === 'plataforma' ? 'chip-activo' : ''}`}>Solo la plataforma</Link>
      </div>
      <div className="panel overflow-x-auto">
        <table className="w-full min-w-[800px] text-sm">
          <thead className="border-b border-carbon/10 text-left text-xs text-carbon-500">
            <tr><th className="px-4 py-2.5 font-medium">Cuándo</th><th className="px-4 py-2.5 font-medium">Cliente</th><th className="px-4 py-2.5 font-medium">Quién</th><th className="px-4 py-2.5 font-medium">Qué</th><th className="px-4 py-2.5 font-medium">IP</th></tr>
          </thead>
          <tbody className="divide-y divide-carbon/10">
            {filas.map((a) => (
              <tr key={a.id}>
                <td className="whitespace-nowrap px-4 py-2 text-carbon-500">{a.createdAt.toLocaleString('es-AR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })}</td>
                <td className="px-4 py-2">{a.tenant ? <Link href={`/plataforma/clientes/${a.tenant.id}`} className="hover:underline">{a.tenant.name}</Link> : <span className="text-carbon-500">Plataforma</span>}</td>
                <td className="px-4 py-2">{a.actorName || a.actorType}</td>
                <td className="px-4 py-2"><strong className="font-medium">{ETIQUETA_ACCION[a.action] ?? a.action}</strong>{a.detail ? <span className="block text-xs text-carbon-500">{a.detail}</span> : null}</td>
                <td className="px-4 py-2 font-mono text-xs text-carbon-500">{a.ip}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
