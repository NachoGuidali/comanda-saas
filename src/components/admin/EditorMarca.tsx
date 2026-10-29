'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { guardarMarca } from '@/actions/config';
import { paleta, revisarColores, hexValido, COLORES_DEFECTO } from '@/lib/tema';
import SubirImagen from './SubirImagen';

type Datos = { nombre: string; eslogan: string; logoUrl: string; principal: string; acento: string; fondo: string };

/**
 * Los colores se eligen con tres muestras y se ven al instante en una
 * maqueta de la carta y del panel. Si una combinación no se lee bien, se avisa
 * antes de guardar.
 */
export default function EditorMarca({ inicial, direccion }: { inicial: Datos; direccion: string }) {
  const router = useRouter();
  const [d, setD] = useState<Datos>(inicial);
  const [estado, setEstado] = useState<{ ok: boolean; texto: string } | null>(null);
  const [pendiente, startTransition] = useTransition();
  const cambiar = (k: keyof Datos, v: string) => { setD((x) => ({ ...x, [k]: v })); setEstado(null); };

  const colores = { principal: d.principal, acento: d.acento, fondo: d.fondo };
  const problema = revisarColores(colores);
  const p = paleta(hexValido(d.principal) && hexValido(d.acento) && hexValido(d.fondo) ? colores : COLORES_DEFECTO);
  const cambiado = JSON.stringify(d) !== JSON.stringify(inicial);

  function guardar() {
    startTransition(async () => {
      try {
        const r = await guardarMarca(d);
        setEstado(r.ok ? { ok: true, texto: 'Guardado. La carta y el panel ya se ven así.' } : { ok: false, texto: r.error });
        if (r.ok) router.refresh();
      } catch {
        setEstado({ ok: false, texto: 'No se pudo guardar. Revisá la conexión.' });
      }
    });
  }

  return (
    <div>
      <div className="mb-6">
        <h1 className="font-display text-2xl">Marca</h1>
        <p className="mt-1 text-sm text-carbon-500">
          Cómo se ve tu local en la carta online (<span className="font-mono">{direccion.replace(/^https?:\/\//, '')}</span>), en el panel y en la cocina. Vale para todas las sucursales.
        </p>
      </div>

      <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_420px]">
        <section className="panel space-y-5 p-6">
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="label" htmlFor="m-nombre">Nombre del local</label>
              <input id="m-nombre" className="input" value={d.nombre} maxLength={60} onChange={(e) => cambiar('nombre', e.target.value)} />
            </div>
            <div>
              <label className="label" htmlFor="m-eslogan">Eslogan <span className="font-normal text-carbon-500">(opcional)</span></label>
              <input id="m-eslogan" className="input" value={d.eslogan} maxLength={120} onChange={(e) => cambiar('eslogan', e.target.value)} placeholder="Como en casa, pero mejor" />
            </div>
          </div>

          <SubirImagen valor={d.logoUrl} onCambio={(u) => cambiar('logoUrl', u)} etiqueta="Logo (cuadrado, con fondo)" />

          <div className="grid gap-4 sm:grid-cols-3">
            <Color label="Color principal" ayuda="Barras y botones, con letra blanca encima" valor={d.principal} onCambio={(v) => cambiar('principal', v)} />
            <Color label="Color de acento" ayuda="Botones de acción, ofertas y avisos" valor={d.acento} onCambio={(v) => cambiar('acento', v)} />
            <Color label="Fondo" ayuda="Claro: los textos van en negro" valor={d.fondo} onCambio={(v) => cambiar('fondo', v)} />
          </div>

          {problema && <p role="alert" className="rounded-lg bg-ladrillo/10 px-3 py-2 text-sm text-ladrillo">{problema}</p>}

          <div className="flex flex-wrap items-center gap-4 border-t border-carbon/10 pt-4">
            <button onClick={guardar} disabled={pendiente || !cambiado || !!problema} className="btn-primario px-6 py-2.5">
              {pendiente ? 'Guardando...' : 'Guardar'}
            </button>
            {cambiado && <button onClick={() => { setD(inicial); setEstado(null); }} className="text-sm underline">Descartar cambios</button>}
            {estado && <span role={estado.ok ? 'status' : 'alert'} className={`text-sm ${estado.ok ? 'text-verde' : 'text-ladrillo'}`}>{estado.texto}</span>}
          </div>
        </section>

        {/* Vista previa, pintada con la paleta que se está eligiendo */}
        <section aria-label="Vista previa" className="overflow-hidden rounded-2xl border border-carbon/10 shadow-card" style={{ background: p.crema }}>
          <div className="px-6 py-7" style={{ background: p.marca, color: p.crema }}>
            {d.eslogan && <p className="w-fit rounded-md px-2.5 py-1 text-xs font-semibold" style={{ background: p.rojo, color: p['sobre-rojo'] }}>{d.eslogan}</p>}
            <p className="mt-2 font-display text-4xl leading-none">{d.nombre || 'Tu local'}</p>
            <p className="mt-3 text-sm opacity-75">Abierto · envío en 40-55 min</p>
          </div>
          <div className="space-y-3 p-5" style={{ background: p['crema-200'] }}>
            <div className="flex gap-2">
              <span className="rounded-full px-4 py-1.5 text-sm font-medium" style={{ background: p.marca, color: p.crema }}>Pizzas</span>
              <span className="rounded-full border bg-white px-4 py-1.5 text-sm font-medium" style={{ borderColor: '#0000001f', color: p.carbon }}>Empanadas</span>
            </div>
            <div className="rounded-2xl bg-white p-4" style={{ color: p.carbon }}>
              <p className="font-display text-xl">Muzzarella</p>
              <p className="text-sm opacity-70">Salsa de tomate, muzzarella y orégano.</p>
              <div className="mt-2 flex items-center justify-between">
                <p className="font-semibold">$ 13.500</p>
                <span className="rounded-md px-2 py-0.5 text-xs font-bold" style={{ background: p.rojo, color: p['sobre-rojo'] }}>-20%</span>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <span className="rounded-xl py-2.5 text-center text-sm font-semibold" style={{ background: p.marca, color: p.crema }}>Ver mi pedido</span>
              <span className="rounded-xl py-2.5 text-center text-sm font-semibold" style={{ background: p.rojo, color: p['sobre-rojo'] }}>Cargar pedido</span>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}

function Color({ label, ayuda, valor, onCambio }: { label: string; ayuda: string; valor: string; onCambio: (v: string) => void }) {
  const id = `c-${label}`;
  return (
    <div>
      <label className="label" htmlFor={id}>{label}</label>
      <div className="flex items-center gap-2">
        <input
          type="color"
          aria-label={`${label}: elegir`}
          value={hexValido(valor) ? valor : '#000000'}
          onChange={(e) => onCambio(e.target.value.toUpperCase())}
          className="h-11 w-12 shrink-0 cursor-pointer rounded-lg border border-carbon/15 bg-white p-1"
        />
        <input id={id} className="input font-mono uppercase" value={valor} maxLength={7} onChange={(e) => onCambio(e.target.value.trim())} />
      </div>
      <p className="mt-1 text-xs text-carbon-500">{ayuda}</p>
    </div>
  );
}
