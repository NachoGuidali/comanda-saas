'use client';

import { useRef, useState } from 'react';
import Image from 'next/image';

export default function SubirImagen({
  valor, onCambio, etiqueta = 'Foto',
}: {
  valor: string; onCambio: (url: string) => void; etiqueta?: string;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [subiendo, setSubiendo] = useState(false);
  const [error, setError] = useState('');

  async function subir(archivo: File) {
    setError('');
    setSubiendo(true);
    const fd = new FormData();
    fd.append('file', archivo);
    try {
      const r = await fetch('/api/upload', { method: 'POST', body: fd });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error ?? 'No se pudo subir');
      onCambio(data.url);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo subir');
    } finally {
      setSubiendo(false);
    }
  }

  return (
    <div>
      <span className="label">{etiqueta}</span>
      <div className="flex items-start gap-3">
        <div className="relative h-24 w-24 shrink-0 overflow-hidden rounded-xl border border-carbon/15 bg-carbon/5">
          {valor ? (
            <Image src={valor} alt="" fill className="object-cover" sizes="96px" />
          ) : (
            <span className="flex h-full items-center justify-center text-xs text-carbon-500">Sin foto</span>
          )}
        </div>

        <div className="flex-1">
          <input
            ref={input}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) subir(f);
            }}
          />
          <div className="flex gap-2">
            <button type="button" onClick={() => input.current?.click()} disabled={subiendo} className="btn-fantasma text-sm">
              {subiendo ? 'Subiendo...' : valor ? 'Cambiar' : 'Subir foto'}
            </button>
            {valor && (
              <button type="button" onClick={() => onCambio('')} className="btn text-sm text-carbon-500 underline">
                Quitar
              </button>
            )}
          </div>
          <p className="mt-2 text-xs text-carbon-500">
            JPG, PNG o WebP hasta 8 MB. La recortamos y optimizamos sola.
          </p>
          {error && <p className="mt-1 text-xs text-ladrillo">{error}</p>}
        </div>
      </div>
    </div>
  );
}
