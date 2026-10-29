'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { guardarMercadoPago } from '@/actions/config';

export type DatosCobro = {
  incluido: boolean; modo: string; cuenta: string | null; token: string; tieneSecreto: boolean; webhook: string; puedeEditar: boolean;
};

const MODOS = [
  { id: 'apagado', label: 'Apagado', ayuda: 'La carta no ofrece pagar online: efectivo, transferencia o tarjeta al recibir.' },
  { id: 'real', label: 'Mercado Pago', ayuda: 'El cliente paga con tarjeta o dinero en cuenta y la plata cae en tu cuenta de Mercado Pago.' },
  { id: 'simulado', label: 'Demo', ayuda: 'Una pantalla de pago de prueba con "Aprobar" y "Rechazar". No cobra nada: solo para mostrar.' },
];

/** El dueño conecta la cuenta de Mercado Pago de su local. */
export default function CobroOnline({ datos }: { datos: DatosCobro }) {
  const router = useRouter();
  const [modo, setModo] = useState(datos.modo);
  const [token, setToken] = useState('');
  const [secreto, setSecreto] = useState('');
  const [estado, setEstado] = useState<{ ok: boolean; texto: string } | null>(null);
  const [pendiente, startTransition] = useTransition();

  if (!datos.incluido) {
    return (
      <div className="panel max-w-2xl p-6">
        <h2 className="font-display text-lg">Cobro online</h2>
        <p className="mt-2 text-sm text-carbon-500">Tu plan no incluye el pago online con Mercado Pago. Escribinos para sumarlo.</p>
      </div>
    );
  }

  function guardar(extra: { borrarSecreto?: boolean } = {}) {
    setEstado(null);
    startTransition(async () => {
      try {
        const r = await guardarMercadoPago({ modo, token, secreto, ...extra });
        setEstado(r.ok ? { ok: true, texto: r.aviso || 'Guardado.' } : { ok: false, texto: r.error });
        if (r.ok) { setToken(''); setSecreto(''); router.refresh(); }
      } catch {
        setEstado({ ok: false, texto: 'No se pudo guardar. Revisá la conexión.' });
      }
    });
  }

  return (
    <div className="panel max-w-2xl space-y-5 p-6">
      <div>
        <h2 className="font-display text-lg">Cobro online</h2>
        <p className="mt-1 text-sm text-carbon-500">Lo que tus clientes pagan online desde la carta cae directo en tu cuenta de Mercado Pago.</p>
      </div>

      <fieldset disabled={!datos.puedeEditar} className="space-y-2" aria-label="Modo">
        {MODOS.map((m) => (
          <label key={m.id} className={`flex cursor-pointer items-start gap-3 rounded-xl border p-4 ${modo === m.id ? 'border-marca bg-marca/5' : 'border-carbon/15 bg-white'}`}>
            <input type="radio" name="modo-mp" checked={modo === m.id} onChange={() => { setModo(m.id); setEstado(null); }} className="mt-1 accent-marca" />
            <span>
              <span className="font-semibold">{m.label}</span>
              <span className="block text-sm text-carbon-500">{m.ayuda}</span>
            </span>
          </label>
        ))}
      </fieldset>

      {modo === 'real' && (
        <div className="space-y-4 rounded-xl border border-carbon/10 bg-white p-4">
          {datos.cuenta && <p className="text-sm">Cuenta conectada: <strong>{datos.cuenta}</strong> <span className="font-mono text-xs text-carbon-500">{datos.token}</span></p>}
          <div>
            <label className="label" htmlFor="mp-token">{datos.cuenta ? 'Cambiar el Access Token' : 'Access Token de producción'}</label>
            <input id="mp-token" className="input font-mono" value={token} onChange={(e) => setToken(e.target.value.trim())} placeholder="APP_USR-..." autoComplete="off" disabled={!datos.puedeEditar} />
            <p className="mt-1 text-xs text-carbon-500">
              En mercadopago.com.ar/developers → Tus integraciones → tu aplicación → Credenciales de producción. Se guarda cifrado.
            </p>
          </div>
          <div>
            <label className="label" htmlFor="mp-secreto">Clave secreta de webhooks <span className="font-normal text-carbon-500">(recomendada)</span></label>
            <input id="mp-secreto" className="input font-mono" value={secreto} onChange={(e) => setSecreto(e.target.value.trim())} placeholder={datos.tieneSecreto ? 'Cargada. Pegá otra para cambiarla.' : ''} autoComplete="off" disabled={!datos.puedeEditar} />
            <p className="mt-1 text-xs text-carbon-500">
              En tu aplicación → Webhooks: URL <span className="font-mono">{datos.webhook}</span>, evento <strong>Pagos</strong>. Copiá la clave secreta acá.
            </p>
            {datos.tieneSecreto && datos.puedeEditar && (
              <button type="button" onClick={() => guardar({ borrarSecreto: true })} className="mt-1 text-xs underline">Quitar la clave secreta</button>
            )}
          </div>
        </div>
      )}

      {estado && <p role={estado.ok ? 'status' : 'alert'} className={`rounded-lg px-3 py-2 text-sm ${estado.ok ? 'bg-verde/10 text-verde' : 'bg-ladrillo/10 text-ladrillo'}`}>{estado.texto}</p>}
      {datos.puedeEditar && (
        <button onClick={() => guardar()} disabled={pendiente} className="btn-primario px-6 py-2.5">
          {pendiente ? (token ? 'Verificando con Mercado Pago...' : 'Guardando...') : 'Guardar'}
        </button>
      )}
    </div>
  );
}
