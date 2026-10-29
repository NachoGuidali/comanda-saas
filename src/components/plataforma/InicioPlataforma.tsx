import Link from 'next/link';
import { PRODUCTO } from '@/lib/producto';

const WHATSAPP = '5491178220245';

/** La portada de comandasupreg.com: qué es y cómo entrar a tu local. */
export default function InicioPlataforma({ dominio }: { dominio: string }) {
  const contacto = `https://wa.me/${WHATSAPP}?text=${encodeURIComponent('Hola, quiero saber más de Comanda Supreg')}`;
  return (
    <main className="relative min-h-screen overflow-hidden bg-marca text-crema">
      <div className="relative mx-auto flex min-h-screen max-w-3xl flex-col justify-center px-5 py-16">
        <p className="w-fit rounded-md bg-rojo px-2.5 py-1 text-sm font-semibold text-sobre-rojo">Para gastronomía</p>
        <h1 className="mt-4 font-display text-5xl leading-none sm:text-7xl">{PRODUCTO.nombre}</h1>
        <p className="mt-5 max-w-xl text-lg text-crema/75">
          Tu propio sistema de pedidos, sin comisiones: carta online con tu marca, cocina, salón, caja y la plata del mes.
        </p>
        <div className="mt-10 flex flex-wrap gap-3">
          <Link href="/login" className="btn bg-crema px-6 py-3 text-carbon hover:bg-crema-200">Ingresar a mi local</Link>
          <a href={contacto} target="_blank" rel="noreferrer" className="btn-acento px-6 py-3">Quiero Comanda Supreg</a>
        </div>
        <p className="mt-12 text-sm text-crema/45">
          Cada local tiene su dirección: <span className="font-mono">tulocal.{dominio}</span>
        </p>
      </div>
    </main>
  );
}
