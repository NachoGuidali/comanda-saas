import Link from 'next/link';
import { notFound } from 'next/navigation';
import { db } from '@/lib/db';
import { requireTenant } from '@/lib/tenant';
import { money } from '@/lib/money';

import PopupResena from '@/components/tienda/PopupResena';
import BotonPagar from '@/components/tienda/BotonPagar';
import { diaHora } from '@/lib/tiempo';
import { sincronizarPago, sincronizarPedido, vencerPagosPendientes, MINUTOS_PARA_PAGAR } from '@/lib/pagos';

export const dynamic = 'force-dynamic';

const PASOS = [
  { estado: 'PENDIENTE', titulo: 'Recibimos tu pedido', detalle: 'Lo estamos revisando.' },
  { estado: 'ACEPTADO', titulo: 'Confirmado', detalle: 'Ya pasó a la cocina.' },
  { estado: 'EN_PREPARACION', titulo: 'En preparación', detalle: 'Está en el horno.' },
  { estado: 'LISTO', titulo: 'Listo', detalle: 'Saliendo del horno.' },
  { estado: 'EN_CAMINO', titulo: 'En camino', detalle: 'El repartidor ya salió.' },
  { estado: 'ENTREGADO', titulo: 'Entregado', detalle: 'Que lo disfrutes.' },
];

export default async function SeguimientoPedido({
  params, searchParams,
}: {
  params: Promise<{ code: string }>;
  searchParams: Promise<{ payment_id?: string; collection_id?: string; status?: string; collection_status?: string }>;
}) {
  const { code } = await params;
  const sp = await searchParams;
  // Solo pedidos de este cliente: el código de otro local no se ve acá
  const tenant = await requireTenant();
  const buscar = () => db.order.findFirst({
    where: { code: code.toUpperCase(), branch: { tenantId: tenant.id } },
    include: { items: { include: { addons: true } }, zone: true, branch: true },
  });

  let pedido = await buscar();
  if (!pedido) notFound();

  // Volvió de Mercado Pago, o está esperando un pago: confirmamos con la API
  // ahí mismo, sin depender de que llegue el webhook (en una demo en la PC
  // local el webhook ni siquiera puede llegar).
  if (pedido.esperandoPago) {
    const paymentId = sp.payment_id ?? sp.collection_id;
    try {
      if (paymentId && paymentId !== 'null') await sincronizarPago(tenant.id, paymentId);
      else await sincronizarPedido(pedido.id);
      await vencerPagosPendientes(pedido.branchId);
    } catch (e) {
      console.error('Sincronizar pago', e);
    }
    pedido = (await buscar())!;
  }
  const estadoVuelta = sp.status ?? sp.collection_status;
  const local = pedido.branch;

  const indiceActual = PASOS.findIndex((p) => p.estado === pedido.status);
  const cancelado = pedido.status === 'CANCELADO' || pedido.status === 'RECHAZADO';
  // Los pedidos que el cliente retira no pasan por "en camino"
  const pasos = pedido.type === 'DELIVERY' ? PASOS : PASOS.filter((p) => p.estado !== 'EN_CAMINO');

  return (
    <main className="mx-auto min-h-screen max-w-2xl px-5 py-10">
      {pedido.status === 'ENTREGADO' && (
        <PopupResena code={pedido.code} local={local.name} url={local.googleResenas} />
      )}

      <Link href={`/${local.slug}`} className="text-sm text-carbon-500 underline">Volver a la carta</Link>

      <h1 className="mt-6 text-3xl font-bold">Pedido {pedido.code}</h1>
      <p className="mt-1 text-sm text-carbon-500">
        {diaHora(pedido.createdAt)} ·{' '}
        {pedido.type === 'DELIVERY' ? 'Envío a domicilio' : pedido.type === 'TAKEAWAY' ? 'Retiro en el local' : 'En el salón'}
      </p>

      {pedido.esperandoPago && !cancelado && (
        <div className="panel mt-8 border-sky-400/50 bg-sky-50 p-5">
          <p className="font-semibold">
            {estadoVuelta === 'rejected' || pedido.mpStatus === 'rejected'
              ? 'El pago fue rechazado'
              : estadoVuelta === 'pending' || estadoVuelta === 'in_process'
                ? 'Tu pago se está procesando'
                : 'Falta el pago'}
          </p>
          <p className="mt-1 text-sm text-carbon-500">
            {estadoVuelta === 'pending' || estadoVuelta === 'in_process'
              ? 'Apenas Mercado Pago lo confirme, el pedido pasa a la cocina. Recargá esta página en un rato.'
              : `El pedido está reservado. Pasa a la cocina cuando se acredite el pago. Si no se paga en ${MINUTOS_PARA_PAGAR} minutos, se cancela solo.`}
          </p>
          <BotonPagar code={pedido.code} total={pedido.total} />
        </div>
      )}

      {pedido.pagoOnline && pedido.paymentStatus === 'COBRADO' && (
        <p className="mt-6 rounded-xl bg-verde/10 px-4 py-3 text-sm font-medium text-verde">
          {pedido.mpStatus === 'refunded'
            ? 'Te devolvimos el pago por Mercado Pago.'
            : `Pagado con Mercado Pago · ${money(pedido.total)}`}
        </p>
      )}

      {cancelado ? (
        <div className="panel mt-8 border-ladrillo/30 bg-ladrillo/5 p-5">
          <p className="font-semibold text-ladrillo">
            {pedido.status === 'RECHAZADO' ? 'No pudimos tomar este pedido' : 'Este pedido fue cancelado'}
          </p>
          {pedido.cancelReason && <p className="mt-1 text-sm text-carbon-500">{pedido.cancelReason}</p>}
          <a href={`https://wa.me/${local.whatsapp}`} className="btn-fantasma mt-4">Consultar por WhatsApp</a>
        </div>
      ) : (
        <ol className="panel mt-8 divide-y divide-carbon/10">
          {pasos.map((paso) => {
            const idx = PASOS.findIndex((p) => p.estado === paso.estado);
            const hecho = idx < indiceActual;
            const actual = idx === indiceActual;
            return (
              <li key={paso.estado} className="flex gap-4 p-5">
                <span
                  className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
                    hecho
                      ? 'bg-marca text-crema'
                      : actual
                        ? paso.estado === 'ENTREGADO'
                          ? 'bg-verde text-crema'
                          : 'bg-rojo text-sobre-rojo'
                        : 'bg-carbon/10 text-carbon-500'
                  }`}
                  aria-hidden
                >
                  {hecho || (actual && paso.estado === 'ENTREGADO') ? '✓' : ''}
                </span>
                <div>
                  <p className={`font-semibold ${
                    actual && paso.estado === 'ENTREGADO' ? 'text-verde' : actual ? '' : hecho ? 'text-carbon-500' : 'text-carbon-500/60'
                  }`}>
                    {paso.titulo}
                  </p>
                  {actual && <p className="mt-0.5 text-sm text-carbon-500">{paso.detalle}</p>}
                </div>
              </li>
            );
          })}
        </ol>
      )}

      <section className="panel mt-6 p-5">
        <h2 className="text-lg font-bold">Detalle</h2>
        <ul className="mt-3 space-y-2 text-sm">
          {pedido.items.map((it) => (
            <li key={it.id} className="flex justify-between gap-4">
              <span>
                {it.quantity}x {it.name}{it.variantName ? ` · ${it.variantName}` : ''}
                {it.addons.length > 0 && (
                  <span className="block text-xs text-carbon-500">{it.addons.map((a) => a.name).join(', ')}</span>
                )}
              </span>
              <span className="font-medium">{money(it.total)}</span>
            </li>
          ))}
        </ul>
        <dl className="mt-4 space-y-1 border-t border-carbon/10 pt-4 text-sm">
          <div className="flex justify-between"><dt>Subtotal</dt><dd>{money(pedido.subtotal)}</dd></div>
          {pedido.deliveryFee > 0 && (
            <div className="flex justify-between"><dt>Envío{pedido.zone ? ` · ${pedido.zone.name}` : ''}</dt><dd>{money(pedido.deliveryFee)}</dd></div>
          )}
          {pedido.discount > 0 && (
            <div className="flex justify-between text-marca"><dt>Descuento</dt><dd>-{money(pedido.discount)}</dd></div>
          )}
          <div className="flex justify-between pt-1 text-base font-bold"><dt>Total</dt><dd>{money(pedido.total)}</dd></div>
        </dl>
        {pedido.cashAmount && (
          <p className="mt-3 text-sm text-carbon-500">
            Abonás con {money(pedido.cashAmount)} · vuelto {money(pedido.cashAmount - pedido.total)}
          </p>
        )}
      </section>

      <p className="mt-6 text-center text-sm text-carbon-500">
        Esta página se actualiza sola al recargarla.{' '}
        <a href={`https://wa.me/${local.whatsapp}`} className="underline">Escribinos</a> si necesitás cambiar algo.
      </p>
    </main>
  );
}
