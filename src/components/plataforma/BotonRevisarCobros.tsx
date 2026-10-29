'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { revisarCobrosAhora } from '@/actions/plataforma';

/** La revisión de vencimientos corre sola cada hora; esto la corre ya. */
export default function BotonRevisarCobros() {
  const router = useRouter();
  const [aviso, setAviso] = useState('');
  const [pendiente, startTransition] = useTransition();
  return (
    <div className="flex items-center gap-3">
      {aviso && <span className="text-sm text-carbon-500">{aviso}</span>}
      <button
        disabled={pendiente}
        onClick={() => startTransition(async () => { const r = await revisarCobrosAhora(); setAviso(r.ok ? r.aviso ?? '' : r.error); router.refresh(); })}
        className="btn-fantasma"
      >
        {pendiente ? 'Revisando...' : 'Revisar vencimientos'}
      </button>
    </div>
  );
}
