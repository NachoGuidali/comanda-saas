'use client';

import { useEffect, useState } from 'react';
import Image from 'next/image';

type Promo = {
  id: string;
  title: string;
  description: string | null;
  imageUrl: string | null;
  code: string | null;
};

/**
 * Aparece a los dos segundos y solo una vez por sesión: si salta en cada
 * recarga, la gente lo cierra sin leerlo.
 */
export default function PromoPopup({ promo }: { promo: Promo }) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const clave = `promo_vista_${promo.id}`;
    if (sessionStorage.getItem(clave)) return;
    const t = setTimeout(() => {
      setVisible(true);
      sessionStorage.setItem(clave, '1');
    }, 2000);
    return () => clearTimeout(t);
  }, [promo.id]);

  useEffect(() => {
    if (!visible) return;
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setVisible(false);
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [visible]);

  if (!visible) return null;

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-carbon/60 p-4"
      onClick={() => setVisible(false)}
      role="dialog"
      aria-modal="true"
      aria-labelledby="promo-titulo"
    >
      <div
        className="w-full max-w-sm overflow-hidden rounded-2xl bg-crema"
        onClick={(e) => e.stopPropagation()}
      >
        {promo.imageUrl && (
          <div className="relative h-44 w-full bg-carbon/5">
            <Image src={promo.imageUrl} alt="" fill className="object-cover" sizes="384px" />
          </div>
        )}
        <div className="p-6 text-center">
          <h2 id="promo-titulo" className="text-2xl font-bold">{promo.title}</h2>
          {promo.description && <p className="mt-2 text-sm text-carbon-500">{promo.description}</p>}
          {promo.code && (
            <p className="mt-4 text-sm">
              Usá el código{' '}
              <span className="rounded-lg bg-carbon px-2.5 py-1 font-mono font-bold text-crema">{promo.code}</span>
            </p>
          )}
          <button onClick={() => setVisible(false)} className="btn-primario mt-6 w-full py-3">
            Ver la carta
          </button>
        </div>
      </div>
    </div>
  );
}
