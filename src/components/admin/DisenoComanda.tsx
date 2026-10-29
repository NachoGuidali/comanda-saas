'use client';

import { useState, useTransition } from 'react';
import { guardarComanda } from '@/actions/config';
import {
  leerConfig, comandaCocina, ticketCliente, pedidoDeEjemplo, llevaTicketCaja, esBebida,
  GRANDE, ENORME, ANCHO, type ConfigComanda, type Letra,
} from '@/lib/comanda';

type Props = {
  guardada: string;
  local: { nombre: string; direccion: string; alias: string };
  categorias: { id: string; name: string }[];
  puedeEditar: boolean;
  onGuardado: () => void;
};

const LETRAS: { id: Letra; label: string }[] = [
  { id: 'normal', label: 'Normal' },
  { id: 'grande', label: 'Grande' },
  { id: 'enorme', label: 'Enorme' },
];

/**
 * Cómo salen las comandas: título, tamaño de letra, copias y qué datos llevan.
 * La vista previa usa las mismas funciones que arman lo que se imprime, así
 * que lo que se ve es lo que sale.
 */
export default function DisenoComanda({ guardada, local, categorias, puedeEditar, onGuardado }: Props) {
  const [cfg, setCfg] = useState<ConfigComanda>(() => leerConfig(guardada));
  const [tipo, setTipo] = useState<'DELIVERY' | 'TAKEAWAY' | 'SALON'>('DELIVERY');
  const [estado, setEstado] = useState<{ ok: boolean; texto: string } | null>(null);
  const [pendiente, startTransition] = useTransition();
  const cambiado = JSON.stringify(cfg) !== JSON.stringify(leerConfig(guardada));

  const cocina = <K extends keyof ConfigComanda['cocina']>(k: K, v: ConfigComanda['cocina'][K]) => {
    setCfg((c) => ({ ...c, cocina: { ...c.cocina, [k]: v } }));
    setEstado(null);
  };
  const caja = <K extends keyof ConfigComanda['caja']>(k: K, v: ConfigComanda['caja'][K]) => {
    setCfg((c) => ({ ...c, caja: { ...c.caja, [k]: v } }));
    setEstado(null);
  };

  // La categoría de bebidas para el ejemplo: la elegida o la que se llame así
  const catBebida = categorias.find((c) => cfg.cocina.categoriasBebida.includes(c.id))
    ?? (cfg.cocina.categoriasBebida.length ? null : categorias.find((c) => /bebida/i.test(c.name)))
    ?? null;
  const ejemplo = pedidoDeEjemplo(tipo, catBebida);
  const textoCocina = comandaCocina(ejemplo, local.nombre, cfg);
  const textoCaja = llevaTicketCaja(tipo, cfg) ? ticketCliente(ejemplo, local, cfg) : null;
  const bebidasDetectadas = categorias.filter((c) => esBebida({ categoryId: c.id, categoryName: c.name }, cfg));

  function guardar() {
    startTransition(async () => {
      try {
        const r = await guardarComanda(cfg);
        setEstado(r.ok ? { ok: true, texto: 'Guardado. Las próximas comandas salen así.' } : { ok: false, texto: 'No se pudo guardar' });
        if (r.ok) onGuardado();
      } catch {
        setEstado({ ok: false, texto: 'No se pudo guardar. Revisá la conexión.' });
      }
    });
  }

  return (
    <div className="panel p-6">
      <h2 className="font-display text-lg">Cómo salen las comandas</h2>
      <p className="mt-1 text-sm text-carbon-500">La vista previa de la derecha es lo que imprime la térmica, con un pedido de ejemplo.</p>

      <div className="mt-5 grid gap-8 xl:grid-cols-[minmax(0,1fr)_auto]">
        <fieldset disabled={!puedeEditar} className="min-w-0 space-y-6">
          <section className="space-y-4">
            <h3 className="font-semibold">Comanda de cocina</h3>
            <div className="grid gap-4 sm:grid-cols-[1fr_auto]">
              <div>
                <label className="label" htmlFor="c-titulo">Título</label>
                <input id="c-titulo" className="input" value={cfg.cocina.titulo} maxLength={30} onChange={(e) => cocina('titulo', e.target.value)} placeholder="COCINA" />
              </div>
              <Copias valor={cfg.cocina.copias} onCambio={(n) => cocina('copias', n)} id="c-copias" />
            </div>
            <Opciones titulo="Tamaño de los productos" valor={cfg.cocina.letra} opciones={LETRAS} onCambio={(v) => cocina('letra', v)} />
            <div className="grid gap-2 sm:grid-cols-2">
              <Tilde label="Tipo de pedido bien grande (ENVÍO, RETIRA, MESA)" valor={cfg.cocina.destacarTipo} onCambio={(v) => cocina('destacarTipo', v)} />
              <Tilde label="Hora del pedido" valor={cfg.cocina.hora} onCambio={(v) => cocina('hora', v)} />
              <Tilde label="Nombre del cliente" valor={cfg.cocina.cliente} onCambio={(v) => cocina('cliente', v)} />
              <Tilde label="Dirección, en los envíos" valor={cfg.cocina.direccion} onCambio={(v) => cocina('direccion', v)} />
              <Tilde label='Cuántas cosas son ("TOTAL: 6 productos")' valor={cfg.cocina.contarProductos} onCambio={(v) => cocina('contarProductos', v)} />
              <Tilde label='"LLEVA BEBIDA" bien grande arriba' valor={cfg.cocina.avisarBebidas} onCambio={(v) => cocina('avisarBebidas', v)} />
            </div>
            <Opciones
              titulo="Las bebidas en la comanda de cocina"
              valor={cfg.cocina.bebidas}
              opciones={[
                { id: 'incluir', label: 'Como un producto más' },
                { id: 'aparte', label: 'Aparte, al final' },
                { id: 'no', label: 'No van a cocina' },
              ]}
              onCambio={(v) => cocina('bebidas', v)}
            />
            <div>
              <p className="label">Qué categorías son bebidas</p>
              <div className="flex flex-wrap gap-2">
                {categorias.map((c) => {
                  const marcada = cfg.cocina.categoriasBebida.includes(c.id);
                  return (
                    <button
                      key={c.id}
                      type="button"
                      aria-pressed={marcada}
                      onClick={() => cocina('categoriasBebida', marcada ? cfg.cocina.categoriasBebida.filter((x) => x !== c.id) : [...cfg.cocina.categoriasBebida, c.id])}
                      className={`chip ${marcada ? 'chip-activo' : ''}`}
                    >
                      {c.name}
                    </button>
                  );
                })}
              </div>
              <p className="mt-1 text-xs text-carbon-500">
                {cfg.cocina.categoriasBebida.length === 0
                  ? `Sin marcar ninguna, se toman las que se llaman "bebida": ${bebidasDetectadas.map((c) => c.name).join(', ') || 'ninguna'}.`
                  : 'Solo las marcadas.'}
              </p>
            </div>
          </section>

          <section className="space-y-4 border-t border-carbon/10 pt-6">
            <h3 className="font-semibold">Ticket de caja</h3>
            <Opciones
              titulo="Cuándo se imprime"
              valor={cfg.caja.imprimir}
              opciones={[
                { id: 'siempre', label: 'Siempre' },
                { id: 'delivery', label: 'Solo envíos' },
                { id: 'nunca', label: 'Nunca' },
              ]}
              onCambio={(v) => caja('imprimir', v)}
            />
            {cfg.caja.imprimir !== 'nunca' && (
              <>
                <div className="grid gap-4 sm:grid-cols-[1fr_auto]">
                  <div>
                    <label className="label" htmlFor="k-titulo">Encabezado</label>
                    <input id="k-titulo" className="input" value={cfg.caja.titulo} maxLength={42} onChange={(e) => caja('titulo', e.target.value)} placeholder={local.nombre} />
                  </div>
                  <Copias valor={cfg.caja.copias} onCambio={(n) => caja('copias', n)} id="k-copias" />
                </div>
                <div>
                  <label className="label" htmlFor="k-pie">Mensaje al pie</label>
                  <input id="k-pie" className="input" value={cfg.caja.pie} maxLength={120} onChange={(e) => caja('pie', e.target.value)} placeholder="Gracias por tu pedido" />
                </div>
                <Opciones titulo="Tamaño del total" valor={cfg.caja.letraTotal} opciones={LETRAS} onCambio={(v) => caja('letraTotal', v)} />
                <Tilde label="El alias, si paga por transferencia" valor={cfg.caja.alias} onCambio={(v) => caja('alias', v)} />
                <p className="text-xs text-carbon-500">&quot;Reimprimir&quot; desde un pedido saca el ticket igual, aunque acá diga que no.</p>
              </>
            )}
          </section>

          {puedeEditar && (
            <div className="flex flex-wrap items-center gap-4 border-t border-carbon/10 pt-4">
              <button type="button" onClick={guardar} disabled={pendiente || !cambiado} className="btn-primario px-6 py-2.5">
                {pendiente ? 'Guardando...' : 'Guardar'}
              </button>
              {cambiado && (
                <button type="button" onClick={() => { setCfg(leerConfig(guardada)); setEstado(null); }} className="text-sm underline">
                  Descartar cambios
                </button>
              )}
              <button type="button" onClick={() => { setCfg(leerConfig('')); setEstado(null); }} className="text-sm underline">
                Volver a como venía
              </button>
              {estado && <span className={`text-sm ${estado.ok ? 'text-verde' : 'text-ladrillo'}`}>{estado.texto}</span>}
            </div>
          )}
        </fieldset>

        <div className="min-w-0">
          <div className="mb-3 flex flex-wrap gap-2" role="group" aria-label="Pedido de ejemplo">
            {([['DELIVERY', 'Envío'], ['TAKEAWAY', 'Retira'], ['SALON', 'Mesa']] as const).map(([id, label]) => (
              <button key={id} type="button" onClick={() => setTipo(id)} aria-pressed={tipo === id} className={`chip ${tipo === id ? 'chip-activo' : ''}`}>
                {label}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap items-start gap-4">
            <Ticket titulo={`Cocina${cfg.cocina.copias > 1 ? ` (×${cfg.cocina.copias})` : ''}`} texto={textoCocina} vacio="No sale: no hay nada para cocina." />
            <Ticket titulo={`Caja${cfg.caja.copias > 1 ? ` (×${cfg.caja.copias})` : ''}`} texto={textoCaja} vacio={cfg.caja.imprimir === 'nunca' ? 'No se imprime.' : 'Solo sale en los envíos.'} />
          </div>
        </div>
      </div>
    </div>
  );
}

/** Dibuja el texto como sale en la térmica: 42 letras de ancho, con los tamaños. */
function Ticket({ titulo, texto, vacio }: { titulo: string; texto: string | null; vacio: string }) {
  return (
    <figure className="max-w-full">
      <figcaption className="mb-1 text-xs font-medium text-carbon-500">{titulo}</figcaption>
      <div className="overflow-hidden rounded-sm bg-white px-4 py-4 font-mono text-[12px] leading-[1.35] text-black shadow-card" style={{ width: `calc(${ANCHO}ch + 2rem)`, maxWidth: '100%' }}>
        {texto === null ? (
          <p className="py-6 text-center font-sans text-sm text-carbon-500">{vacio}</p>
        ) : (
          texto.split('\n').map((r, i) => {
            const enorme = r.includes(ENORME);
            const grande = !enorme && r.includes(GRANDE);
            const limpio = r.replace(/[\x02\x03\x04]/g, '');
            if (enorme) return <pre key={i} className="whitespace-pre font-bold" style={{ fontSize: '24px', lineHeight: 1.2 }}>{limpio || ' '}</pre>;
            if (grande) {
              return (
                <pre key={i} className="whitespace-pre font-semibold" style={{ height: '2.7em' }}>
                  <span style={{ display: 'inline-block', transform: 'scaleY(2)', transformOrigin: 'top' }}>{limpio || ' '}</span>
                </pre>
              );
            }
            return <pre key={i} className="whitespace-pre">{limpio || ' '}</pre>;
          })
        )}
      </div>
    </figure>
  );
}

function Tilde({ label, valor, onCambio }: { label: string; valor: boolean; onCambio: (v: boolean) => void }) {
  return (
    <label className="flex items-start gap-2 text-sm">
      <input type="checkbox" checked={valor} onChange={(e) => onCambio(e.target.checked)} className="mt-0.5 h-4 w-4 accent-marca" />
      {label}
    </label>
  );
}

function Opciones<T extends string>({ titulo, valor, opciones, onCambio }: {
  titulo: string; valor: T; opciones: { id: T; label: string }[]; onCambio: (v: T) => void;
}) {
  return (
    <div>
      <p className="label">{titulo}</p>
      <div className="flex flex-wrap gap-2" role="radiogroup" aria-label={titulo}>
        {opciones.map((o) => (
          <button key={o.id} type="button" role="radio" aria-checked={valor === o.id} onClick={() => onCambio(o.id)} className={`chip ${valor === o.id ? 'chip-activo' : ''}`}>
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function Copias({ valor, onCambio, id }: { valor: number; onCambio: (n: number) => void; id: string }) {
  return (
    <div>
      <label className="label" htmlFor={id}>Copias</label>
      <select id={id} className="input w-24" value={valor} onChange={(e) => onCambio(Number(e.target.value))}>
        {[1, 2, 3].map((n) => <option key={n} value={n}>{n}</option>)}
      </select>
    </div>
  );
}
