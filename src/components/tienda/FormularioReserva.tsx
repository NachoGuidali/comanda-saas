'use client';

import { useState } from 'react';
import Link from 'next/link';
import { crearReserva } from '@/actions/operacion';
import { claveDia } from '@/lib/tiempo';

const TIPOS = [
  { id: 'MESA', label: 'Mesa', ayuda: 'Para comer en el salón' },
  { id: 'CUMPLEANOS', label: 'Cumpleaños', ayuda: 'Con torta y espacio reservado' },
  { id: 'EVENTO', label: 'Evento', ayuda: 'Salón completo, menú cerrado' },
] as const;

export default function FormularioReserva({
  branchId, branchSlug, whatsapp,
}: {
  branchId: string; branchSlug: string; whatsapp: string;
}) {
  const [tipo, setTipo] = useState<'MESA' | 'CUMPLEANOS' | 'EVENTO'>('MESA');
  const [personas, setPersonas] = useState(4);
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState('');
  const [enviado, setEnviado] = useState(false);
  const [mensajeWa, setMensajeWa] = useState('');

  const esEvento = tipo !== 'MESA';
  const hoy = claveDia(new Date());

  async function enviar(fd: FormData) {
    setError('');
    setEnviando(true);
    fd.set('branchId', branchId);
    fd.set('type', tipo);
    fd.set('people', String(personas));

    const res = await crearReserva(fd);
    setEnviando(false);
    if (!res.ok) { setError(res.error); return; }

    const etiqueta = TIPOS.find((t) => t.id === tipo)!.label;
    const texto = [
      `Hola, acabo de cargar una reserva de *${etiqueta}*.`,
      `Nombre: ${fd.get('customerName')}`,
      `Fecha: ${fd.get('date')} a las ${fd.get('time')}`,
      `Personas: ${personas}`,
      fd.get('notes') ? `Detalle: ${fd.get('notes')}` : '',
    ].filter(Boolean).join('\n');

    setMensajeWa(`https://wa.me/${whatsapp}?text=${encodeURIComponent(texto)}`);
    setEnviado(true);
  }

  if (enviado) {
    return (
      <div className="panel p-7 text-center">
        <h2 className="text-2xl font-bold">Recibimos tu solicitud</h2>
        <p className="mt-2 text-sm text-carbon-500">
          Te confirmamos por WhatsApp apenas la revisemos. Si querés apurarla, mandanos el mensaje directo.
        </p>
        <a href={mensajeWa} target="_blank" rel="noreferrer" className="btn-acento mt-6 w-full py-3">
          Avisar por WhatsApp
        </a>
        <Link href={`/${branchSlug}`} className="mt-3 block py-2 text-sm text-carbon-500 underline">
          Volver a la carta
        </Link>
      </div>
    );
  }

  return (
    <form action={enviar} className="panel space-y-5 p-6">
      <div>
        <span className="label">¿Qué querés reservar?</span>
        <div className="grid gap-2 sm:grid-cols-3">
          {TIPOS.map((t) => (
            <button
              type="button"
              key={t.id}
              onClick={() => setTipo(t.id)}
              className={`rounded-xl border px-4 py-3 text-left ${
                tipo === t.id ? 'border-marca bg-marca text-crema' : 'border-carbon/15 bg-white'
              }`}
            >
              <span className="block text-sm font-semibold">{t.label}</span>
              <span className={`block text-xs ${tipo === t.id ? 'text-crema/70' : 'text-carbon-500'}`}>
                {t.ayuda}
              </span>
            </button>
          ))}
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className="label" htmlFor="customerName">Tu nombre</label>
          <input id="customerName" name="customerName" required className="input" autoComplete="name" />
        </div>
        <div>
          <label className="label" htmlFor="customerPhone">Teléfono</label>
          <input id="customerPhone" name="customerPhone" required type="tel" className="input" autoComplete="tel" />
        </div>
      </div>

      <div>
        <label className="label" htmlFor="email">Email</label>
        <input id="email" name="email" type="email" className="input" placeholder="Opcional" autoComplete="email" />
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className="label" htmlFor="date">Fecha</label>
          <input id="date" name="date" type="date" required min={hoy} className="input" />
        </div>
        <div>
          <label className="label" htmlFor="time">Horario</label>
          <input id="time" name="time" type="time" required defaultValue="21:00" className="input" />
        </div>
      </div>

      <div>
        <label className="label" htmlFor="people">Cuántas personas</label>
        <div className="flex items-center gap-3">
          <div className="inline-flex items-center rounded-xl border border-carbon/15 bg-white">
            <button type="button" onClick={() => setPersonas((p) => Math.max(1, p - 1))} className="px-4 py-2.5" aria-label="Menos personas">−</button>
            <span className="min-w-[3ch] text-center font-semibold">{personas}</span>
            <button type="button" onClick={() => setPersonas((p) => Math.min(200, p + 1))} className="px-4 py-2.5" aria-label="Más personas">+</button>
          </div>
          <input
            id="people"
            type="number"
            min={1}
            max={200}
            value={personas}
            onChange={(e) => setPersonas(Number(e.target.value) || 1)}
            className="input max-w-[7rem]"
          />
        </div>
      </div>

      {esEvento && (
        <div>
          <label className="label" htmlFor="budget">Presupuesto por persona</label>
          <input id="budget" name="budget" className="input" inputMode="decimal" placeholder="Opcional, nos ayuda a armar la propuesta" />
        </div>
      )}

      <div>
        <label className="label" htmlFor="notes">
          {esEvento ? 'Contanos del evento' : 'Alguna preferencia'}
        </label>
        <textarea
          id="notes"
          name="notes"
          rows={3}
          className="input resize-none"
          placeholder={esEvento ? 'Menú cerrado, torta, decoración, horario de corte...' : 'Mesa cerca de la ventana, silla para bebé...'}
        />
      </div>

      {error && <p className="rounded-xl bg-ladrillo/10 px-4 py-3 text-sm text-ladrillo">{error}</p>}

      <button disabled={enviando} className="btn-primario w-full py-3.5 text-base">
        {enviando ? 'Enviando...' : 'Enviar solicitud'}
      </button>
    </form>
  );
}
