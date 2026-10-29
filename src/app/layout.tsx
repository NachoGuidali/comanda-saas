import type { Metadata, Viewport } from 'next';
import { Anton, Inter_Tight } from 'next/font/google';
import './globals.css';
import { getTenant } from '@/lib/tenant';
import { variablesCss, COLORES_DEFECTO } from '@/lib/tema';
import { PRODUCTO } from '@/lib/producto';

// Condensada y pesada, como la grafica del local
const display = Anton({
  subsets: ['latin'],
  variable: '--font-display',
  weight: ['400'],
  display: 'swap',
});

const sans = Inter_Tight({
  subsets: ['latin'],
  variable: '--font-sans',
  weight: ['400', '500', '600', '700'],
  display: 'swap',
});

/** comandasupreg.com: la presentación del producto, con los textos de supregsolutions.com/comanda */
const PORTADA: Metadata = {
  title: `${PRODUCTO.nombre} | Tu propio sistema de pedidos, sin comisiones`,
  description: 'Pedidos online y gestión para pizzerías, hamburgueserías y rotiserías. El cliente pide desde la web de tu local y paga con Mercado Pago. Sin comisiones por pedido.',
  icons: { icon: '/marca/supreg-isotipo.png' },
  openGraph: {
    title: `${PRODUCTO.nombre} | Tu propio sistema de pedidos, sin comisiones`,
    description: 'Pedidos online y gestión para pizzerías, hamburgueserías y rotiserías. El cliente pide desde la web de tu local y paga con Mercado Pago. Sin comisiones por pedido.',
    images: ['https://supregsolutions.com/static/imagenes/og-supreg.jpg'],
    locale: 'es_AR',
    type: 'website',
  },
};

/**
 * El título de la web es el del cliente del dominio (Pepperino Pizza · Pedí
 * online); en el dominio de la plataforma, el del producto. Durante el build
 * no hay base de datos.
 */
export async function generateMetadata(): Promise<Metadata> {
  if (process.env.NEXT_PHASE === 'phase-production-build') {
    return { title: PRODUCTO.nombre, description: PRODUCTO.bajada };
  }
  try {
    const t = await getTenant();
    if (!t) return PORTADA;
    return {
      title: `${t.name} · Pedí online`,
      description: t.slogan || undefined,
      ...(t.logoUrl ? { icons: { icon: t.logoUrl } } : {}),
    };
  } catch {
    return { title: PRODUCTO.nombre, description: PRODUCTO.bajada };
  }
}

export async function generateViewport(): Promise<Viewport> {
  let color = COLORES_DEFECTO.principal;
  if (process.env.NEXT_PHASE !== 'phase-production-build') {
    try {
      color = (await getTenant())?.colorPrimary ?? color;
    } catch { /* sin base: el color del producto */ }
  }
  return { themeColor: color, width: 'device-width', initialScale: 1, maximumScale: 5 };
}

/**
 * Cada cliente se ve con sus colores: el layout pone la paleta de su marca
 * como variables CSS y todo el sistema (carta, panel, cocina) las usa.
 * Un cliente suspendido ve un aviso en vez de la carta y el panel.
 */
export default async function RootLayout({ children }: { children: React.ReactNode }) {
  let tenant = null;
  if (process.env.NEXT_PHASE !== 'phase-production-build') {
    try { tenant = await getTenant(); } catch { tenant = null; }
  }
  const css = tenant
    ? variablesCss({ principal: tenant.colorPrimary, acento: tenant.colorAccent, fondo: tenant.colorBackground })
    : variablesCss(COLORES_DEFECTO);

  return (
    <html lang="es-AR" className={`${display.variable} ${sans.variable}`}>
      <head>
        <style dangerouslySetInnerHTML={{ __html: `:root{${css}}` }} />
      </head>
      <body>
        {tenant && !tenant.active ? (
          <main className="flex min-h-screen items-center justify-center bg-marca px-5 text-center text-crema">
            <div className="max-w-md">
              <p className="font-display text-4xl">{tenant.name}</p>
              <p className="mt-4 text-crema/80">
                {tenant.suspendedReason || 'Este local no está tomando pedidos online por ahora.'}
              </p>
            </div>
          </main>
        ) : children}
      </body>
    </html>
  );
}
