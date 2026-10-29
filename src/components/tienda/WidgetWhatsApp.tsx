'use client';

import { useEffect, useState } from 'react';

/**
 * Botón flotante de WhatsApp. Aparece después de que la persona hizo un poco de
 * scroll: si salta apenas entra, tapa la carta antes de que la vean.
 * Se corre para arriba cuando hay carrito, para no pisar la barra del pedido.
 */
export default function WidgetWhatsApp({
  numero, local, hayCarrito,
}: {
  numero: string; local: string; hayCarrito: boolean;
}) {
  const [visible, setVisible] = useState(false);
  const [abierto, setAbierto] = useState(false);

  useEffect(() => {
    const alScrollear = () => setVisible(window.scrollY > 240);
    alScrollear();
    window.addEventListener('scroll', alScrollear, { passive: true });
    return () => window.removeEventListener('scroll', alScrollear);
  }, []);

  if (!numero) return null;

  const link = `https://wa.me/${numero.replace(/\D/g, '')}?text=${encodeURIComponent(
    `Hola ${local}, quería hacer una consulta.`
  )}`;

  return (
    <div
      className={`fixed right-4 z-40 flex flex-col items-end gap-3 transition-all duration-300 ${
        visible ? 'opacity-100' : 'pointer-events-none translate-y-3 opacity-0'
      } ${hayCarrito ? 'bottom-24 lg:bottom-6' : 'bottom-6'}`}
    >
      {abierto && (
        <div className="w-64 rounded-2xl border border-carbon/10 bg-white p-4 shadow-card">
          <p className="font-display text-base">¿Necesitás algo?</p>
          <p className="mt-1 text-sm text-carbon-500">
            Escribinos y te respondemos al toque. También podés pedir directo desde la carta.
          </p>
          <a
            href={link}
            target="_blank"
            rel="noreferrer"
            className="btn-acento mt-3 w-full py-2.5 text-sm"
            onClick={() => setAbierto(false)}
          >
            Abrir WhatsApp
          </a>
        </div>
      )}

      <button
        onClick={() => setAbierto((v) => !v)}
        aria-label={abierto ? 'Cerrar chat de WhatsApp' : 'Abrir chat de WhatsApp'}
        aria-expanded={abierto}
        className="flex h-14 w-14 items-center justify-center rounded-full bg-[#25D366] shadow-lg transition-transform active:scale-95"
      >
        {abierto ? (
          <span className="text-2xl font-bold text-white" aria-hidden>✕</span>
        ) : (
          <svg viewBox="0 0 24 24" className="h-8 w-8 fill-white" aria-hidden>
            <path d="M17.47 14.38c-.3-.15-1.75-.86-2.02-.96-.27-.1-.47-.15-.67.15-.2.3-.77.96-.94 1.16-.17.2-.35.22-.64.07-.3-.15-1.25-.46-2.38-1.47-.88-.79-1.47-1.76-1.65-2.05-.17-.3-.02-.46.13-.6.13-.14.3-.35.45-.52.15-.17.2-.3.3-.5.1-.2.05-.37-.02-.52-.08-.15-.67-1.6-.92-2.2-.24-.58-.49-.5-.67-.51h-.57c-.2 0-.52.07-.8.37-.27.3-1.04 1.02-1.04 2.48s1.07 2.88 1.22 3.08c.15.2 2.1 3.2 5.08 4.49.71.3 1.26.49 1.7.63.71.22 1.36.19 1.87.12.57-.09 1.75-.72 2-1.41.25-.7.25-1.29.17-1.41-.07-.13-.27-.2-.57-.35z" />
            <path d="M12.04 2C6.58 2 2.13 6.45 2.13 11.91c0 1.75.46 3.45 1.32 4.95L2 22l5.25-1.38a9.87 9.87 0 0 0 4.79 1.22h.01c5.46 0 9.91-4.45 9.91-9.91 0-2.65-1.03-5.14-2.9-7.01A9.82 9.82 0 0 0 12.04 2zm0 18.13h-.01a8.2 8.2 0 0 1-4.18-1.15l-.3-.18-3.11.82.83-3.04-.2-.31a8.2 8.2 0 0 1-1.26-4.36c0-4.54 3.7-8.24 8.24-8.24 2.2 0 4.27.86 5.82 2.42a8.18 8.18 0 0 1 2.41 5.83c0 4.54-3.7 8.21-8.24 8.21z" />
          </svg>
        )}
      </button>
    </div>
  );
}
