import { notFound } from 'next/navigation';
import { db } from '@/lib/db';
import { requireTenant } from '@/lib/tenant';
import { credencialesDelCliente } from '@/lib/mp-cliente';
import { money } from '@/lib/money';
import { modoMP, firmaSimulada } from '@/lib/mercadopago';
import BotonesPagoDemo from '@/components/tienda/BotonesPagoDemo';

export const dynamic = 'force-dynamic';

/**
 * Pantalla de pago de PRUEBA. Existe solo con MP_MODO=simulado y sin
 * credenciales de Mercado Pago: reemplaza al checkout para poder mostrar el
 * circuito completo en una demo. No cobra nada.
 */
export default async function PagoDemo({
  params, searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ f?: string }>;
}) {
  const { id } = await params;
  const { f } = await searchParams;
  const tenant = await requireTenant();
  if (modoMP(await credencialesDelCliente(tenant.id)) !== 'simulado' || f !== firmaSimulada(id)) notFound();

  const pedido = await db.order.findFirst({
    where: { id, branch: { tenantId: tenant.id } },
    include: { branch: { select: { name: true } }, items: true },
  });
  if (!pedido) notFound();

  return (
    <main className="flex min-h-screen items-center justify-center bg-carbon/5 p-4">
      <div className="w-full max-w-md overflow-hidden rounded-2xl bg-white shadow-lg">
        <div className="bg-amber-300 px-5 py-2 text-center text-xs font-bold uppercase tracking-wide text-carbon">
          Pago simulado · demo · no se cobra nada
        </div>
        <div className="p-6">
          <p className="text-sm text-carbon-500">Estás pagando a</p>
          <h1 className="text-xl font-bold">{pedido.branch.name}</h1>
          <p className="mt-1 text-sm text-carbon-500">Pedido {pedido.code}</p>

          <ul className="mt-5 space-y-1.5 border-t border-carbon/10 pt-4 text-sm">
            {pedido.items.map((it) => (
              <li key={it.id} className="flex justify-between gap-3">
                <span>{it.quantity}x {it.name}{it.variantName ? ` · ${it.variantName}` : ''}</span>
                <span>{money(it.total)}</span>
              </li>
            ))}
          </ul>
          <p className="mt-4 flex justify-between border-t border-carbon/10 pt-4 text-lg font-bold">
            <span>Total</span><span>{money(pedido.total)}</span>
          </p>

          {pedido.esperandoPago ? (
            <BotonesPagoDemo orderId={pedido.id} firma={f!} />
          ) : (
            <p className="mt-6 rounded-xl bg-carbon/5 p-4 text-center text-sm">
              Este pedido ya no está esperando un pago.{' '}
              <a href={`/pedido/${pedido.code}`} className="underline">Ver el pedido</a>
            </p>
          )}

          <p className="mt-5 text-center text-xs text-carbon-500">
            En producción, esta pantalla es el checkout de Mercado Pago. Se activa cargando
            las credenciales del local en Configuración → Cobro online.
          </p>
        </div>
      </div>
    </main>
  );
}
