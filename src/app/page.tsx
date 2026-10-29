import Link from 'next/link';
import Image from 'next/image';
import { redirect } from 'next/navigation';
import { sucursalesPublicas, marcaDe, estaAbierto } from '@/lib/sucursales';
import { getTenant, dominioBase } from '@/lib/tenant';
import InicioPlataforma from '@/components/plataforma/InicioPlataforma';

export const dynamic = 'force-dynamic';

/**
 * La raíz del dominio. En pepperino.comandasupreg.com es la web de Pepperino:
 * con un local va derecho a la carta, con varios se elige. En
 * comandasupreg.com es la presentación de la plataforma.
 */
export default async function ElegirSucursal() {
  const tenant = await getTenant();
  if (!tenant) return <InicioPlataforma dominio={dominioBase()} />;

  const marca = marcaDe(tenant);
  const sucursales = await sucursalesPublicas(tenant.id);

  // Con un solo local no tiene sentido hacer elegir: va derecho a la carta
  if (sucursales.length === 1) redirect(`/${sucursales[0].slug}`);

  const estados = await Promise.all(sucursales.map((s) => estaAbierto(s.id)));

  return (
    <main className="min-h-screen bg-marca text-crema">
      <div
        className="absolute inset-0 opacity-[0.06]"
        style={{ backgroundImage: 'radial-gradient(circle at 1px 1px, rgb(var(--c-crema)) 1px, transparent 0)', backgroundSize: '22px 22px' }}
        aria-hidden
      />

      <div className="relative mx-auto flex min-h-screen max-w-3xl flex-col justify-center px-5 py-16">
        {marca.logoUrl && (
          <div className="relative mb-6 h-20 w-20 overflow-hidden rounded-2xl bg-crema">
            <Image src={marca.logoUrl} alt={marca.nombre} fill className="object-contain p-1.5" sizes="80px" />
          </div>
        )}
        {marca.eslogan && (
          <p className="w-fit rounded-md bg-rojo px-2.5 py-1 text-sm font-semibold text-sobre-rojo">{marca.eslogan}</p>
        )}
        <h1 className="mt-3 font-display text-5xl leading-none sm:text-7xl">{marca.nombre}</h1>
        <p className="mt-6 text-crema/70">¿De qué local querés pedir?</p>

        <div className="mt-6 grid gap-3">
          {sucursales.map((s, i) => (
            <Link
              key={s.id}
              href={`/${s.slug}`}
              className="group flex items-center gap-4 rounded-2xl bg-crema/[0.07] p-5 ring-1 ring-crema/15 transition-colors hover:bg-crema/[0.14]"
            >
              {s.heroImageUrl && (
                <div className="relative hidden h-16 w-16 shrink-0 overflow-hidden rounded-xl sm:block">
                  <Image src={s.heroImageUrl} alt="" fill className="object-cover" sizes="64px" />
                </div>
              )}
              <div className="min-w-0 flex-1">
                <p className="font-display text-2xl leading-tight">{s.name}</p>
                <p className="mt-1 text-sm text-crema/65">{s.address}</p>
                <p className="mt-1.5 inline-flex items-center gap-2 text-sm">
                  <span className={`h-2 w-2 rounded-full ${estados[i] ? 'bg-rojo' : 'bg-crema/35'}`} />
                  {estados[i] ? `Abierto · envío en ${s.tiempoDelivery} min` : 'Cerrado ahora'}
                </p>
              </div>
              <span className="text-2xl text-crema/40 transition-transform group-hover:translate-x-1" aria-hidden>→</span>
            </Link>
          ))}
        </div>

        {sucursales.length === 0 && (
          <p className="mt-6 rounded-2xl bg-crema/10 p-6 text-sm">
            No hay locales habilitados en este momento.
          </p>
        )}

        <Link href="/admin" className="mt-10 text-sm text-crema/45 underline">Acceso del personal</Link>
      </div>
    </main>
  );
}
