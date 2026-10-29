'use client';

import { useEffect, useState } from 'react';

/**
 * Aparece cuando el pedido pasa a entregado, que es el momento en que el cliente
 * está más contento. Una sola vez por pedido: si molesta, no lo vuelve a usar.
 */
export default function PopupResena({
  code, local, url,
}: {
  code: string; local: string; url: string;
}) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!url) return;
    const clave = `resena_${code}`;
    if (localStorage.getItem(clave)) return;
    const t = setTimeout(() => setVisible(true), 3500);
    return () => clearTimeout(t);
  }, [code, url]);

  useEffect(() => {
    if (!visible) return;
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && cerrar();
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  });

  function cerrar() {
    try { localStorage.setItem(`resena_${code}`, '1'); } catch { /* modo incógnito */ }
    setVisible(false);
  }

  if (!visible) return null;

  return (
    <div
      className="fixed inset-0 z-[60] flex items-end justify-center bg-carbon/60 p-4 sm:items-center"
      onClick={cerrar}
      role="dialog"
      aria-modal="true"
      aria-labelledby="resena-titulo"
    >
      <div
        className="w-full max-w-sm rounded-2xl bg-crema p-7 text-center"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mx-auto flex gap-1 text-2xl text-rojo" aria-hidden>
          <span>★</span><span>★</span><span>★</span><span>★</span><span>★</span>
        </div>

        <h2 id="resena-titulo" className="mt-4 font-display text-2xl">
          ¿Cómo estuvo?
        </h2>
        <p className="mt-2 text-sm text-carbon-500">
          Si te gustó, contalo en Google. Nos toma treinta segundos a vos y a
          nosotros nos cambia el día.
        </p>

        <a
          href={url}
          target="_blank"
          rel="noreferrer"
          onClick={cerrar}
          className="btn-acento mt-6 w-full py-3"
        >
          Puntuarnos en Google
        </a>

        <button onClick={cerrar} className="mt-3 w-full py-2 text-sm text-carbon-500 underline">
          Ahora no
        </button>

        <p className="mt-4 text-xs text-carbon-500/70">{local}</p>
      </div>
    </div>
  );
}
