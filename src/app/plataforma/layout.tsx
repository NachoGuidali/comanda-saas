import type { Metadata } from 'next';
import { getSesionPlataforma } from '@/lib/plataforma';
import NavPlataforma from '@/components/plataforma/NavPlataforma';

export const metadata: Metadata = { title: 'Plataforma · Comanda Supreg', robots: { index: false } };
export const dynamic = 'force-dynamic';

export default async function LayoutPlataforma({ children }: { children: React.ReactNode }) {
  const s = await getSesionPlataforma();
  if (!s) return children;
  return (
    <div className="min-h-screen bg-crema-200">
      <NavPlataforma nombre={s.name} />
      <main className="mx-auto w-full max-w-[1300px] px-4 py-6 sm:px-6">{children}</main>
    </div>
  );
}
