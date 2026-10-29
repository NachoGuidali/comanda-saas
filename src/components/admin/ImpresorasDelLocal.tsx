'use client';

import { useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { agregarImpresora, codigoImpresora, guardarImpresora, quitarImpresora, probarImpresora } from '@/actions/impresoras';

export type Impresora = {
  id: string;
  name: string;
  stations: string;
  abrirCajon: boolean;
  vinculada: boolean;
  lastSeenAt: string | null;
  lastError: string | null;
  printer: string;
  device: string;
  version: string;
};

const QUE_IMPRIME: { id: string; label: string; ayuda: string }[] = [
  { id: 'todo', label: 'Todo', ayuda: 'Comanda de cocina y ticket de caja. Para el local con una sola impresora.' },
  { id: 'caja', label: 'Solo caja', ayuda: 'El ticket con precios y la cuenta de las mesas.' },
  { id: 'cocina', label: 'Solo cocina', ayuda: 'La comanda sin precios.' },
];

export const DESCARGA = '/descargas/ComandaSupreg-Impresora.exe';
const CONECTADA_MS = 60_000;

function hace(fecha: string): string {
  const seg = Math.max(0, Math.round((Date.now() - new Date(fecha).getTime()) / 1000));
  if (seg < 60) return 'recién';
  const min = Math.round(seg / 60);
  if (min < 60) return `hace ${min} min`;
  const h = Math.round(min / 60);
  if (h < 48) return `hace ${h} h`;
  return `hace ${Math.round(h / 24)} días`;
}

/**
 * Las impresoras de este local. Cada una es el programa instalado en una PC
 * del local: se agrega acá, se instala con el código y desde acá se ve si
 * está andando, sin ir al local.
 */
export default function ImpresorasDelLocal({ impresoras, puedeEditar, imprimeCaja }: {
  impresoras: Impresora[]; puedeEditar: boolean; imprimeCaja: boolean;
}) {
  const router = useRouter();
  const [codigo, setCodigo] = useState<{ id: string; codigo: string } | null>(null);
  const [agregando, setAgregando] = useState(impresoras.length === 0);
  const [error, setError] = useState('');
  const [aviso, setAviso] = useState('');
  const [pendiente, startTransition] = useTransition();

  // El estado de cada impresora se actualiza solo: sirve para ayudar a un local por teléfono
  useEffect(() => {
    const t = setInterval(() => router.refresh(), 10_000);
    return () => clearInterval(t);
  }, [router]);

  function correr(fn: () => Promise<{ ok: boolean; error?: string } & Record<string, unknown>>, ok?: string) {
    setError('');
    setAviso('');
    startTransition(async () => {
      try {
        const r = await fn();
        if (!r.ok) setError(r.error ?? 'No se pudo');
        else if (ok) setAviso(ok);
        router.refresh();
      } catch {
        setError('No se pudo. Revisá la conexión.');
      }
    });
  }

  const vinculadas = impresoras.filter((i) => i.vinculada);
  const cubre = (e: string) => vinculadas.some((i) => i.stations === 'todo' || i.stations === e);
  const faltaCocina = vinculadas.length > 0 && !cubre('cocina');
  const faltaCaja = vinculadas.length > 0 && imprimeCaja && !cubre('caja');

  return (
    <div className="panel mt-4 p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-display text-lg">Impresoras de este local</h2>
        {puedeEditar && !agregando && (
          <button onClick={() => { setAgregando(true); setCodigo(null); }} className="btn-fantasma px-4 py-2 text-sm">
            Agregar impresora
          </button>
        )}
      </div>
      <p className="mt-1 text-sm text-carbon-500">
        ¿Una sola impresora en la caja? Agregala con <strong>Todo</strong>: salen la comanda y el ticket, uno
        atrás del otro. ¿Una en cocina y otra en caja? Agregá las dos.
      </p>

      {(faltaCocina || faltaCaja) && (
        <p role="alert" className="mt-3 rounded-lg bg-ladrillo/10 px-3 py-2 text-sm text-ladrillo">
          Ninguna impresora recibe {faltaCocina && faltaCaja ? 'las comandas ni los tickets' : faltaCocina ? 'las comandas de cocina' : 'los tickets de caja'}:
          {' '}cambiá lo que imprime alguna a <strong>Todo</strong>
          {faltaCaja && !faltaCocina ? ', o poné "Ticket de caja: nunca" en el diseño de abajo' : ''}.
        </p>
      )}

      {agregando && puedeEditar && (
        <FormularioNueva
          pendiente={pendiente}
          onCancelar={impresoras.length ? () => setAgregando(false) : undefined}
          onAgregar={(nombre, estaciones) => correr(async () => {
            const r = await agregarImpresora({ nombre, estaciones });
            if (r.ok) { setCodigo({ id: r.id, codigo: r.codigo }); setAgregando(false); }
            return r;
          })}
        />
      )}

      <ul className="mt-4 space-y-3">
        {impresoras.map((i) => (
          <Fila
            key={i.id}
            i={i}
            puedeEditar={puedeEditar}
            pendiente={pendiente}
            codigo={codigo?.id === i.id ? codigo.codigo : null}
            onCodigo={() => correr(async () => {
              const r = await codigoImpresora(i.id);
              if (r.ok) setCodigo({ id: i.id, codigo: r.codigo });
              return r;
            })}
            onGuardar={(d) => correr(() => guardarImpresora(i.id, d), 'Guardado')}
            onProbar={() => correr(() => probarImpresora(i.id), `Mandamos una prueba a "${i.name}": tiene que salir en unos segundos.`)}
            onQuitar={() => {
              if (confirm(`¿Quitar "${i.name}"? Esa PC deja de imprimir.`)) correr(() => quitarImpresora(i.id));
            }}
          />
        ))}
      </ul>

      {aviso && <p role="status" className="mt-3 text-sm text-verde">{aviso}</p>}
      {error && <p role="alert" className="mt-3 text-sm text-ladrillo">{error}</p>}
    </div>
  );
}

function FormularioNueva({ pendiente, onAgregar, onCancelar }: {
  pendiente: boolean; onAgregar: (nombre: string, estaciones: string) => void; onCancelar?: () => void;
}) {
  const [nombre, setNombre] = useState('Caja');
  const [estaciones, setEstaciones] = useState('todo');
  return (
    <form
      onSubmit={(e) => { e.preventDefault(); onAgregar(nombre, estaciones); }}
      className="mt-4 space-y-3 rounded-xl border border-carbon/10 p-4"
    >
      <div>
        <label htmlFor="imp-nombre" className="text-sm font-medium">Nombre</label>
        <input id="imp-nombre" className="input mt-1" value={nombre} onChange={(e) => setNombre(e.target.value)} maxLength={40} placeholder="Caja, Cocina, Mostrador" />
      </div>
      <fieldset>
        <legend className="text-sm font-medium">Qué imprime</legend>
        <div className="mt-1 space-y-2">
          {QUE_IMPRIME.map((q) => (
            <label key={q.id} className="flex items-start gap-2 text-sm">
              <input type="radio" name="imp-que" checked={estaciones === q.id} onChange={() => setEstaciones(q.id)} className="mt-1 accent-marca" />
              <span><strong>{q.label}</strong> <span className="text-carbon-500">· {q.ayuda}</span></span>
            </label>
          ))}
        </div>
      </fieldset>
      <div className="flex gap-3">
        <button disabled={pendiente} className="btn-primario px-5 py-2 text-sm">{pendiente ? 'Agregando...' : 'Agregar y ver el código'}</button>
        {onCancelar && <button type="button" onClick={onCancelar} className="btn-fantasma px-4 py-2 text-sm">Cancelar</button>}
      </div>
    </form>
  );
}

function Fila({ i, puedeEditar, pendiente, codigo, onCodigo, onGuardar, onProbar, onQuitar }: {
  i: Impresora; puedeEditar: boolean; pendiente: boolean; codigo: string | null;
  onCodigo: () => void; onGuardar: (d: { nombre: string; estaciones: string; abrirCajon: boolean }) => void;
  onProbar: () => void; onQuitar: () => void;
}) {
  const [editando, setEditando] = useState(false);
  const [nombre, setNombre] = useState(i.name);
  const [estaciones, setEstaciones] = useState(i.stations);
  const [cajon, setCajon] = useState(i.abrirCajon);

  const conectada = i.lastSeenAt && Date.now() - new Date(i.lastSeenAt).getTime() < CONECTADA_MS;
  const estado = !i.vinculada
    ? { color: 'bg-carbon/30', texto: 'Falta instalar el programa en la PC' }
    : !conectada
      ? { color: 'bg-ladrillo', texto: i.lastSeenAt ? `Sin conexión · última vez ${hace(i.lastSeenAt)}` : 'Vinculada, todavía no se conectó' }
      : i.lastError
        ? { color: 'bg-amber-500', texto: `Conectada, pero la impresora falla: ${i.lastError}` }
        : { color: 'bg-verde', texto: 'Andando' };
  const que = QUE_IMPRIME.find((q) => q.id === i.stations)?.label ?? i.stations;

  return (
    <li className="rounded-xl border border-carbon/10 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-medium">{i.name} <span className="text-sm font-normal text-carbon-500">· {que}{i.abrirCajon ? ' · abre el cajón' : ''}</span></p>
          <p className="mt-1 flex items-center gap-2 text-sm">
            <span className={`inline-block h-2.5 w-2.5 shrink-0 rounded-full ${estado.color}`} aria-hidden />
            <span>{estado.texto}</span>
          </p>
          {i.vinculada && (i.printer || i.device) && (
            <p className="mt-1 text-xs text-carbon-500">
              {[i.printer && `Impresora: ${i.printer}`, i.device && `PC: ${i.device}`, i.version && `v${i.version}`].filter(Boolean).join(' · ')}
            </p>
          )}
        </div>
        {puedeEditar && (
          <div className="flex flex-wrap gap-2">
            {i.vinculada && <button onClick={onProbar} disabled={pendiente} className="btn-fantasma px-3 py-1.5 text-sm">Imprimir prueba</button>}
            <button onClick={() => setEditando((e) => !e)} className="btn-fantasma px-3 py-1.5 text-sm">{editando ? 'Cerrar' : 'Cambiar'}</button>
          </div>
        )}
      </div>

      {codigo && <Instrucciones codigo={codigo} />}

      {!i.vinculada && !codigo && puedeEditar && (
        <button onClick={onCodigo} disabled={pendiente} className="btn-primario mt-3 px-4 py-2 text-sm">Ver el código para instalarla</button>
      )}

      {editando && puedeEditar && (
        <div className="mt-4 space-y-3 border-t border-carbon/10 pt-4">
          <input className="input" value={nombre} onChange={(e) => setNombre(e.target.value)} maxLength={40} aria-label="Nombre" />
          <div className="flex flex-wrap gap-2">
            {QUE_IMPRIME.map((q) => (
              <button key={q.id} type="button" onClick={() => setEstaciones(q.id)} className={`chip ${estaciones === q.id ? 'chip-activo' : ''}`}>{q.label}</button>
            ))}
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={cajon} onChange={(e) => setCajon(e.target.checked)} className="h-4 w-4 accent-marca" />
            Abrir el cajón de dinero con el ticket de caja (si está conectado a esta impresora)
          </label>
          <div className="flex flex-wrap gap-2">
            <button onClick={() => { onGuardar({ nombre, estaciones, abrirCajon: cajon }); setEditando(false); }} disabled={pendiente} className="btn-primario px-4 py-2 text-sm">Guardar</button>
            {i.vinculada && <button onClick={onCodigo} disabled={pendiente} className="btn-fantasma px-4 py-2 text-sm">Pasarla a otra PC</button>}
            <button onClick={onQuitar} disabled={pendiente} className="btn-fantasma px-4 py-2 text-sm text-ladrillo">Quitar</button>
          </div>
        </div>
      )}
    </li>
  );
}

function Instrucciones({ codigo }: { codigo: string }) {
  return (
    <div className="mt-3 rounded-xl bg-carbon/5 p-4 text-sm">
      <p className="text-carbon-500">Código para instalarla (sirve una vez, durante 30 minutos):</p>
      <p className="mt-1 select-all font-mono text-3xl font-bold tracking-widest">{codigo}</p>
      <ol className="mt-3 space-y-1.5">
        <li>1. En la PC del local, descargá <a href={DESCARGA} download className="font-medium text-marca underline">el programa de impresión</a> y abrilo.</li>
        <li>2. Si Windows avisa "Windows protegió su PC", tocá <em>Más información</em> y <em>Ejecutar de todas formas</em>.</li>
        <li>3. Escribí este código, elegí la impresora de la lista y tocá <em>Imprimir prueba</em>.</li>
      </ol>
      <p className="mt-3 text-carbon-500">Listo: queda andando solo, también cuando se reinicia la PC. Acá vas a ver el punto en verde.</p>
    </div>
  );
}
