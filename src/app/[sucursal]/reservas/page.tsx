import Link from 'next/link';
import { notFound } from 'next/navigation';
import { sucursalPorSlug } from '@/lib/sucursales';
import { requireTenant } from '@/lib/tenant';
import { limitesDe } from '@/lib/plan';
import FormularioReserva from '@/components/tienda/FormularioReserva';

export const dynamic = 'force-dynamic';

export default async function ReservasPage({ params }: { params: Promise<{ sucursal: string }> }) {
  const { sucursal } = await params;
  const tenant = await requireTenant();
  const branch = await sucursalPorSlug(tenant.id, sucursal);
  if (!branch || !limitesDe(tenant).funciones.includes('salon')) notFound();

  return (
    <div className="min-h-screen">
      <header className="bg-marca px-5 py-12 text-crema">
        <div className="mx-auto max-w-2xl">
          <Link href={`/${branch.slug}`} className="text-sm text-crema/70 underline">Volver a la carta</Link>
          <h1 className="mt-5 font-display text-4xl sm:text-5xl">Reservá tu mesa</h1>
          <p className="mt-3 max-w-lg text-crema/75">
            En {branch.name}, para comer acá, festejar un cumpleaños o armar un evento.
            Dejanos los datos y te confirmamos por WhatsApp.
          </p>
        </div>
      </header>

      <main className="mx-auto max-w-2xl px-5 py-10">
        <FormularioReserva branchId={branch.id} branchSlug={branch.slug} whatsapp={branch.whatsapp} />

        <section className="panel mt-8 p-6">
          <h2 className="font-display text-lg">Cómo trabajamos los eventos</h2>
          <p className="mt-3 text-sm leading-relaxed text-carbon-500">
            Para cumpleaños y eventos armamos un presupuesto a medida según la cantidad de gente,
            el horario y si querés menú cerrado o carta libre. Cargá el formulario con la mayor
            cantidad de datos que puedas y te contestamos el mismo día.
          </p>
          <p className="mt-3 text-sm leading-relaxed text-carbon-500">
            Para grupos de más de veinte personas conviene avisar con una semana de anticipación
            para reservar el salón completo.
          </p>
          <a href={`https://wa.me/${branch.whatsapp}`} target="_blank" rel="noreferrer" className="btn-fantasma mt-5">
            Prefiero hablar por WhatsApp
          </a>
        </section>
      </main>
    </div>
  );
}
