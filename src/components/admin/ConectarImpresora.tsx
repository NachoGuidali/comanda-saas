'use client';

import { useState, useTransition } from 'react';
import { generarTokenImpresora } from '@/actions/config';

/**
 * El agente de impresión de este local: la clave (token) se genera acá y se
 * muestra una sola vez, junto con el .env listo para copiar en la PC del local.
 */
export default function ConectarImpresora({
  servidor, sucursal, tieneToken, puedeEditar,
}: { servidor: string; sucursal: string; tieneToken: boolean; puedeEditar: boolean }) {
  const [token, setToken] = useState('');
  const [error, setError] = useState('');
  const [pendiente, startTransition] = useTransition();

  function generar() {
    if (tieneToken && !confirm('El agente que ya está andando deja de imprimir hasta que le cargues la clave nueva. ¿Seguir?')) return;
    setError('');
    startTransition(async () => {
      try {
        const r = await generarTokenImpresora();
        if (r.ok) setToken(r.token);
      } catch {
        setError('No se pudo generar. Revisá la conexión.');
      }
    });
  }

  const env = `SERVIDOR=${servidor}\nPRINT_TOKEN=${token || '(la clave que generás acá)'}\nSUCURSAL=${sucursal}\nMODO=red\nIMPRESORA_IP=192.168.1.100`;

  return (
    <div className="panel mt-4 p-6">
      <h2 className="font-display text-lg">Conectar la impresora</h2>
      <ol className="mt-3 space-y-2 text-sm text-carbon-500">
        <li>1. Instalá Node.js en la PC del local y copiá la carpeta <code className="rounded bg-carbon/5 px-1">print-agent</code>.</li>
        <li>2. Generá la clave del agente y creá su archivo <code className="rounded bg-carbon/5 px-1">.env</code> con esto (cambiá la IP por la de tu impresora):</li>
      </ol>
      <pre className="mt-3 overflow-x-auto rounded-xl bg-carbon px-4 py-3 font-mono text-xs leading-relaxed text-crema">{env}</pre>
      {token && (
        <p role="status" className="mt-3 rounded-lg bg-verde/10 px-3 py-2 text-sm text-verde">
          Copiá la clave ahora: por seguridad no se vuelve a mostrar. Si la perdés, generás otra.
        </p>
      )}
      {error && <p role="alert" className="mt-3 text-sm text-ladrillo">{error}</p>}
      {puedeEditar && (
        <button onClick={generar} disabled={pendiente} className="btn-fantasma mt-3 px-4 py-2 text-sm">
          {pendiente ? 'Generando...' : tieneToken ? 'Generar una clave nueva' : 'Generar la clave del agente'}
        </button>
      )}
      <ol start={3} className="mt-4 space-y-2 text-sm text-carbon-500">
        <li>3. Ejecutá <code className="rounded bg-carbon/5 px-1">npm install</code> y después <code className="rounded bg-carbon/5 px-1">npm start</code>.</li>
      </ol>
      <p className="mt-3 text-sm text-carbon-500">
        {tieneToken ? 'Este local ya tiene una clave generada. ' : ''}
        La clave es de tu local: con ella el agente solo recibe tus comandas. Cada sucursal necesita su propio agente, porque la impresora está en la red de ese local. Sirve cualquier térmica de 80 o 58mm compatible con ESC/POS (el ancho se elige en "Cómo salen las comandas").
      </p>
    </div>
  );
}
