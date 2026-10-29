'use client';

import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import {
  guardarInsumo, archivarInsumo, entradaInsumo, contarInsumo, mermaInsumo, guardarReceta, type LineaReceta,
} from '@/actions/insumos';
import { UNIDADES, IDS_UNIDAD, mostrarCantidad, mostrarEnChica, TIPOS_MOVIMIENTO_INSUMO, type Unidad } from '@/lib/insumos';
import { TIPOS_MERMA, ETIQUETA_TIPO_MERMA } from '@/lib/mermas';
import { money } from '@/lib/money';
import { diaHora } from '@/lib/tiempo';

type Insumo = {
  id: string; name: string; unit: string; stock: number; minimum: number; active: boolean; enRecetas: number;
  entro30: number; vendido30: number; perdido30: number; ajuste30: number; diasQueAlcanza: number | null;
};
type ItemReceta = { supplyId: string; quantity: number; variantId?: string | null };
type Producto = {
  id: string; name: string; categoria: string;
  variants: { id: string; name: string }[];
  receta: ItemReceta[];
  extras: { id: string; name: string; grupo: string; receta: ItemReceta[] }[];
};
type Movimiento = {
  id: string; type: string; quantity: number; after: number; reason: string | null; lossType: string | null;
  orderCode: string | null; createdAt: string; supplyId: string; user: string | null; gasto: number | null;
};
type Props = {
  sucursal: string; insumos: Insumo[]; productos: Producto[]; movimientos: Movimiento[];
  formasPago: { id: string; label: string }[];
  puedeMover: boolean; puedeAnotarMerma: boolean; puedeCargarGasto: boolean; puedeEditarRecetas: boolean;
};

const u = (unit: string) => (unit in UNIDADES ? (unit as Unidad) : 'U');
const cant = (m: number, unit: string) => mostrarCantidad(m, u(unit));

/**
 * Insumos: lo que se usa para preparar. Tres partes: qué hay (con entradas,
 * conteos y pérdidas), las recetas que lo descuentan solo con cada venta, y
 * todos los movimientos.
 */
export default function GestorInsumos(props: Props) {
  const { insumos, puedeEditarRecetas } = props;
  const [vista, setVista] = useState<'hay' | 'recetas' | 'movimientos'>('hay');
  const activos = insumos.filter((i) => i.active);

  return (
    <div>
      <div className="mb-6">
        <h1 className="font-display text-2xl">Insumos y recetas · {props.sucursal}</h1>
        <p className="mt-1 max-w-2xl text-sm text-carbon-500">
          Lo que se usa para preparar: muzzarella, jamón, harina, salsa. Se carga lo que entra y, con las recetas, se descuenta solo con cada venta.
        </p>
      </div>
      <div className="mb-5 flex flex-wrap gap-2">
        {([
          ['hay', 'Qué hay'],
          ['recetas', 'Recetas'],
          ['movimientos', 'Movimientos'],
        ] as const).map(([id, label]) => (
          <button key={id} onClick={() => setVista(id)} className={`chip ${vista === id ? 'chip-activo' : ''}`}>{label}</button>
        ))}
      </div>
      {vista === 'hay' && <QueHay {...props} />}
      {vista === 'recetas' && <Recetas productos={props.productos} insumos={activos} puedeEditar={puedeEditarRecetas} />}
      {vista === 'movimientos' && <Movimientos movimientos={props.movimientos} insumos={insumos} />}
    </div>
  );
}

// ─────────── Qué hay ───────────

type Accion = { tipo: 'entrada' | 'conteo' | 'merma' | 'editar'; insumo: Insumo } | { tipo: 'nuevo' };

function QueHay({ insumos, formasPago, puedeMover, puedeAnotarMerma, puedeCargarGasto }: Props) {
  const router = useRouter();
  const [accion, setAccion] = useState<Accion | null>(null);
  const [aviso, setAviso] = useState('');
  const [verArchivados, setVerArchivados] = useState(false);
  const activos = insumos.filter((i) => i.active);
  const archivados = insumos.filter((i) => !i.active);
  const bajos = activos.filter((i) => i.stock <= i.minimum && (i.minimum > 0 || i.stock < 0));

  function listo(texto: string) {
    setAccion(null);
    setAviso(texto);
    router.refresh();
  }

  return (
    <div className="space-y-5">
      {aviso && <p role="status" className="rounded-lg bg-verde/10 px-3 py-2 text-sm text-verde">{aviso}</p>}

      {bajos.length > 0 && (
        <div className="rounded-xl border border-ladrillo/30 bg-ladrillo/5 px-4 py-3 text-sm">
          <strong className="text-ladrillo">Para comprar:</strong>{' '}
          {bajos.map((i) => `${i.name} (quedan ${cant(i.stock, i.unit)})`).join(', ')}
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-carbon-500">
          {activos.length === 0 ? 'Todavía no hay insumos cargados.' : `${activos.length} insumos. Entró, ventas y perdido son de los últimos 30 días.`}
        </p>
        {puedeMover && <button onClick={() => setAccion({ tipo: 'nuevo' })} className="btn-primario px-4 py-2 text-sm">+ Nuevo insumo</button>}
      </div>

      {activos.length > 0 && (
        <div className="panel overflow-hidden">
          <ul className="divide-y divide-carbon/10">
            {activos.map((i) => {
              const bajo = i.stock <= i.minimum && (i.minimum > 0 || i.stock < 0);
              return (
                <li key={i.id} className="flex flex-wrap items-center gap-x-6 gap-y-3 px-5 py-4">
                  <div className="min-w-[12rem] flex-1">
                    <p className="font-semibold">{i.name}</p>
                    <p className="mt-0.5 text-xs text-carbon-500">
                      {i.enRecetas > 0 ? `En ${i.enRecetas} ${i.enRecetas === 1 ? 'receta' : 'recetas'}` : 'Sin recetas: no se descuenta solo'}
                      {i.minimum > 0 ? ` · Avisa con menos de ${cant(i.minimum, i.unit)}` : ''}
                    </p>
                  </div>
                  <div className="sm:w-32 sm:text-right">
                    <p className={`text-xl font-semibold tabular-nums ${bajo ? 'text-ladrillo' : ''}`}>{cant(i.stock, i.unit)}</p>
                    <p className="text-xs text-carbon-500">
                      {i.diasQueAlcanza !== null
                        ? i.diasQueAlcanza > 60 ? 'Alcanza para más de 2 meses' : `Alcanza para ~${i.diasQueAlcanza} ${i.diasQueAlcanza === 1 ? 'día' : 'días'}`
                        : i.stock < 0 ? 'Contalo: no cierra' : '\u00a0'}
                    </p>
                  </div>
                  <dl className="hidden w-64 grid-cols-3 gap-2 text-xs text-carbon-500 md:grid">
                    <div><dt>Entró</dt><dd className="tabular-nums text-carbon">{cant(i.entro30, i.unit)}</dd></div>
                    <div><dt>Ventas</dt><dd className="tabular-nums text-carbon">{cant(i.vendido30, i.unit)}</dd></div>
                    <div><dt>Perdido</dt><dd className="tabular-nums text-carbon">{cant(i.perdido30, i.unit)}</dd></div>
                  </dl>
                  <div className="flex flex-wrap gap-2">
                    {puedeMover && <button onClick={() => setAccion({ tipo: 'entrada', insumo: i })} className="btn-primario px-3 py-1.5 text-sm">Entró</button>}
                    {puedeMover && <button onClick={() => setAccion({ tipo: 'conteo', insumo: i })} className="btn-fantasma px-3 py-1.5 text-sm">Conté</button>}
                    {puedeAnotarMerma && <button onClick={() => setAccion({ tipo: 'merma', insumo: i })} className="btn-fantasma px-3 py-1.5 text-sm">Se perdió</button>}
                    {puedeMover && <button onClick={() => setAccion({ tipo: 'editar', insumo: i })} className="px-2 py-1.5 text-sm underline">Editar</button>}
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {archivados.length > 0 && (
        <div>
          <button onClick={() => setVerArchivados((v) => !v)} className="text-sm underline">
            {verArchivados ? 'Ocultar' : 'Ver'} archivados ({archivados.length})
          </button>
          {verArchivados && (
            <ul className="mt-2 space-y-1 text-sm">
              {archivados.map((i) => (
                <li key={i.id} className="flex items-center gap-3">
                  <span className="text-carbon-500">{i.name}</span>
                  {puedeMover && <BotonArchivar insumo={i} onHecho={() => listo(`${i.name} volvió a la lista.`)} />}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {accion?.tipo === 'nuevo' && <DialogoInsumo onCerrar={() => setAccion(null)} onHecho={listo} />}
      {accion?.tipo === 'editar' && <DialogoInsumo insumo={accion.insumo} onCerrar={() => setAccion(null)} onHecho={listo} />}
      {accion?.tipo === 'entrada' && (
        <DialogoEntrada insumo={accion.insumo} formasPago={formasPago} puedeCargarGasto={puedeCargarGasto} onCerrar={() => setAccion(null)} onHecho={listo} />
      )}
      {accion?.tipo === 'conteo' && <DialogoConteo insumo={accion.insumo} onCerrar={() => setAccion(null)} onHecho={listo} />}
      {accion?.tipo === 'merma' && <DialogoMerma insumo={accion.insumo} onCerrar={() => setAccion(null)} onHecho={listo} />}
    </div>
  );
}

function Dialogo({ titulo, children, onCerrar }: { titulo: string; children: React.ReactNode; onCerrar: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-carbon/50 sm:items-center sm:p-4" onClick={onCerrar}>
      <div
        className="max-h-[94vh] w-full overflow-y-auto rounded-t-2xl bg-crema p-6 sm:max-w-md sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={titulo}
      >
        <h3 className="font-display text-xl">{titulo}</h3>
        {children}
      </div>
    </div>
  );
}

function useEnvio(onHecho: (t: string) => void) {
  const [error, setError] = useState('');
  const [pendiente, startTransition] = useTransition();
  function enviar(fn: () => Promise<{ ok: true; aviso?: string } | { ok: false; error: string }>, exito: string) {
    setError('');
    startTransition(async () => {
      try {
        const r = await fn();
        if (!r.ok) { setError(r.error); return; }
        onHecho([exito, r.aviso].filter(Boolean).join(' '));
      } catch {
        setError('No se pudo guardar. Revisá la conexión.');
      }
    });
  }
  return { error, pendiente, enviar };
}

function Botones({ pendiente, onCerrar, texto }: { pendiente: boolean; onCerrar: () => void; texto: string }) {
  return (
    <div className="mt-5 flex gap-3">
      <button type="button" onClick={onCerrar} className="btn-fantasma flex-1 py-2.5">Cancelar</button>
      <button type="submit" disabled={pendiente} className="btn-primario flex-1 py-2.5">{pendiente ? 'Guardando...' : texto}</button>
    </div>
  );
}

function MensajeError({ texto }: { texto: string }) {
  return texto ? <p role="alert" className="mt-3 rounded-lg bg-ladrillo/10 px-3 py-2 text-sm text-ladrillo">{texto}</p> : null;
}

function DialogoInsumo({ insumo, onCerrar, onHecho }: { insumo?: Insumo; onCerrar: () => void; onHecho: (t: string) => void }) {
  const [nombre, setNombre] = useState(insumo?.name ?? '');
  const [unidad, setUnidad] = useState<Unidad>(insumo ? u(insumo.unit) : 'KG');
  const [minimo, setMinimo] = useState(insumo && insumo.minimum > 0 ? String(insumo.minimum / 1000).replace('.', ',') : '');
  const { error, pendiente, enviar } = useEnvio(onHecho);
  return (
    <Dialogo titulo={insumo ? `Editar ${insumo.name}` : 'Nuevo insumo'} onCerrar={onCerrar}>
      <form
        className="mt-4 space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          enviar(() => guardarInsumo({ id: insumo?.id, nombre, unidad, minimo }), insumo ? 'Guardado.' : `${nombre.trim()} agregado. Ahora cargá lo que hay con "Entró".`);
        }}
      >
        <div>
          <label className="label" htmlFor="i-nombre">Nombre</label>
          <input id="i-nombre" className="input" value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="Muzzarella, jamón cocido, harina 000..." autoFocus maxLength={80} />
        </div>
        <div>
          <p className="label">Se mide en</p>
          <div className="grid grid-cols-3 gap-2">
            {IDS_UNIDAD.map((id) => (
              <button key={id} type="button" onClick={() => setUnidad(id)} aria-pressed={unidad === id} className={`chip justify-center ${unidad === id ? 'chip-activo' : ''}`}>
                {UNIDADES[id].nombre}
              </button>
            ))}
          </div>
        </div>
        <div>
          <label className="label" htmlFor="i-minimo">Avisar cuando quede menos de <span className="font-normal text-carbon-500">({UNIDADES[unidad].label}, opcional)</span></label>
          <input id="i-minimo" className="input" inputMode="decimal" value={minimo} onChange={(e) => setMinimo(e.target.value)} placeholder={unidad === 'U' ? '20' : '2'} />
        </div>
        <MensajeError texto={error} />
        <Botones pendiente={pendiente} onCerrar={onCerrar} texto="Guardar" />
        {insumo && (
          <div className="border-t border-carbon/10 pt-3 text-sm">
            <BotonArchivar insumo={insumo} onHecho={() => onHecho(`${insumo.name} archivado.`)} />
            <p className="mt-1 text-xs text-carbon-500">Archivarlo lo saca de las recetas: deja de descontarse.</p>
          </div>
        )}
      </form>
    </Dialogo>
  );
}

function BotonArchivar({ insumo, onHecho }: { insumo: Insumo; onHecho: () => void }) {
  const [pendiente, startTransition] = useTransition();
  return (
    <button
      type="button"
      disabled={pendiente}
      onClick={() => {
        if (insumo.active && insumo.enRecetas > 0 && !confirm(`${insumo.name} está en ${insumo.enRecetas} recetas. ¿Archivarlo igual? Se saca de esas recetas.`)) return;
        startTransition(async () => {
          const r = await archivarInsumo(insumo.id, !insumo.active);
          if (r.ok) onHecho();
          else alert(r.error);
        });
      }}
      className="text-sm underline"
    >
      {insumo.active ? 'Archivar' : 'Volver a activar'}
    </button>
  );
}

function DialogoEntrada({
  insumo, formasPago, puedeCargarGasto, onCerrar, onHecho,
}: { insumo: Insumo; formasPago: Props['formasPago']; puedeCargarGasto: boolean; onCerrar: () => void; onHecho: (t: string) => void }) {
  const unidad = u(insumo.unit);
  const [cantidad, setCantidad] = useState('');
  const [conGasto, setConGasto] = useState(false);
  const [monto, setMonto] = useState('');
  const [proveedor, setProveedor] = useState('');
  const [pago, setPago] = useState('EFECTIVO');
  const { error, pendiente, enviar } = useEnvio(onHecho);
  return (
    <Dialogo titulo={`Entró ${insumo.name}`} onCerrar={onCerrar}>
      <p className="mt-1 text-sm text-carbon-500">Hay {cant(insumo.stock, insumo.unit)}.</p>
      <form
        className="mt-4 space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          enviar(
            () => entradaInsumo({ id: insumo.id, cantidad, ...(conGasto ? { monto, proveedor, pago } : {}) }),
            `Anotado: entró ${cantidad.trim()}${/[a-z]$/i.test(cantidad.trim()) ? '' : ` ${UNIDADES[unidad].label}`} de ${insumo.name}${conGasto ? ', y quedó en Gastos.' : '.'}`
          );
        }}
      >
        <div>
          <label className="label" htmlFor="e-cant">Cuánto entró ({UNIDADES[unidad].nombre.toLowerCase()})</label>
          <input id="e-cant" className="input text-lg" inputMode="decimal" value={cantidad} onChange={(e) => setCantidad(e.target.value)} placeholder={unidad === 'U' ? '24' : unidad === 'L' ? '5 o 500 ml' : '5, 2,5 o 500 g'} autoFocus />
        </div>
        {puedeCargarGasto && (
          <label className="flex items-center gap-2 text-sm font-medium">
            <input type="checkbox" checked={conGasto} onChange={(e) => setConGasto(e.target.checked)} className="h-4 w-4" />
            Anotar también lo que se pagó (va a Gastos)
          </label>
        )}
        {conGasto && (
          <div className="space-y-3 rounded-xl border border-carbon/10 bg-white p-4">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label" htmlFor="e-monto">Monto</label>
                <input id="e-monto" className="input" inputMode="decimal" value={monto} onChange={(e) => setMonto(e.target.value)} placeholder="$ 45.000" />
              </div>
              <div>
                <label className="label" htmlFor="e-prov">Proveedor</label>
                <input id="e-prov" className="input" value={proveedor} onChange={(e) => setProveedor(e.target.value)} placeholder="Opcional" maxLength={100} />
              </div>
            </div>
            <div>
              <label className="label" htmlFor="e-pago">Cómo se pagó</label>
              <select id="e-pago" className="input" value={pago} onChange={(e) => setPago(e.target.value)}>
                {formasPago.map((f) => <option key={f.id} value={f.id}>{f.label}</option>)}
              </select>
            </div>
            <p className="text-xs text-carbon-500">Queda como gasto de Mercadería con la fecha de hoy y tu usuario.</p>
          </div>
        )}
        <MensajeError texto={error} />
        <Botones pendiente={pendiente} onCerrar={onCerrar} texto="Anotar entrada" />
      </form>
    </Dialogo>
  );
}

function DialogoConteo({ insumo, onCerrar, onHecho }: { insumo: Insumo; onCerrar: () => void; onHecho: (t: string) => void }) {
  const unidad = u(insumo.unit);
  const [hay, setHay] = useState('');
  const { error, pendiente, enviar } = useEnvio(onHecho);
  return (
    <Dialogo titulo={`Contar ${insumo.name}`} onCerrar={onCerrar}>
      <p className="mt-1 text-sm text-carbon-500">
        El sistema calcula que hay {cant(insumo.stock, insumo.unit)}. Poné lo que hay de verdad: se corrige y la diferencia queda anotada.
      </p>
      <form className="mt-4 space-y-4" onSubmit={(e) => { e.preventDefault(); enviar(() => contarInsumo(insumo.id, hay), `Conteo de ${insumo.name} guardado.`); }}>
        <div>
          <label className="label" htmlFor="c-hay">Hay ({UNIDADES[unidad].nombre.toLowerCase()})</label>
          <input id="c-hay" className="input text-lg" inputMode="decimal" value={hay} onChange={(e) => setHay(e.target.value)} placeholder={unidad === 'U' ? '12' : '3,2 o 800 g'} autoFocus />
        </div>
        <MensajeError texto={error} />
        <Botones pendiente={pendiente} onCerrar={onCerrar} texto="Guardar conteo" />
      </form>
    </Dialogo>
  );
}

function DialogoMerma({ insumo, onCerrar, onHecho }: { insumo: Insumo; onCerrar: () => void; onHecho: (t: string) => void }) {
  const unidad = u(insumo.unit);
  const [cantidad, setCantidad] = useState('');
  const [tipo, setTipo] = useState('VENCIDO');
  const [detalle, setDetalle] = useState('');
  const { error, pendiente, enviar } = useEnvio(onHecho);
  // "Salió mal" y "Regalo" son de lo ya preparado: se anotan en Mermas, por producto
  const tipos = TIPOS_MERMA.filter((t) => ['ROTURA', 'VENCIDO', 'PERSONAL', 'OTRO'].includes(t.id));
  return (
    <Dialogo titulo={`Se perdió ${insumo.name}`} onCerrar={onCerrar}>
      <form
        className="mt-4 space-y-4"
        onSubmit={(e) => { e.preventDefault(); enviar(() => mermaInsumo(insumo.id, cantidad, tipo, detalle), `Anotado como ${ETIQUETA_TIPO_MERMA[tipo].toLowerCase()}.`); }}
      >
        <div className="grid grid-cols-2 gap-2">
          {tipos.map((t) => (
            <button key={t.id} type="button" onClick={() => setTipo(t.id)} aria-pressed={tipo === t.id} className={`rounded-lg border px-3 py-2 text-left text-sm font-medium ${tipo === t.id ? 'border-marca bg-marca text-crema' : 'border-carbon/15 bg-white'}`}>
              {t.label}
            </button>
          ))}
        </div>
        <div>
          <label className="label" htmlFor="m-cant">Cuánto ({UNIDADES[unidad].nombre.toLowerCase()})</label>
          <input id="m-cant" className="input" inputMode="decimal" value={cantidad} onChange={(e) => setCantidad(e.target.value)} placeholder={unidad === 'U' ? '2' : '1 o 300 g'} autoFocus />
        </div>
        <div>
          <label className="label" htmlFor="m-det">Detalle {tipo !== 'OTRO' && <span className="font-normal text-carbon-500">(opcional)</span>}</label>
          <input id="m-det" className="input" value={detalle} onChange={(e) => setDetalle(e.target.value)} maxLength={150} placeholder="Qué pasó" />
        </div>
        <p className="text-xs text-carbon-500">Una pizza que salió mal o se regaló se anota en Mermas, por producto: sus insumos ya se descontaron con la venta.</p>
        <MensajeError texto={error} />
        <Botones pendiente={pendiente} onCerrar={onCerrar} texto="Anotar" />
      </form>
    </Dialogo>
  );
}

// ─────────── Recetas ───────────

type Fila = { clave: string; supplyId: string; cantidad: string };

function Recetas({ productos, insumos, puedeEditar }: { productos: Producto[]; insumos: Insumo[]; puedeEditar: boolean }) {
  const [busqueda, setBusqueda] = useState('');
  const [abierto, setAbierto] = useState<string | null>(null);
  const q = busqueda.trim().toLowerCase();
  const visibles = q ? productos.filter((p) => p.name.toLowerCase().includes(q) || p.categoria.toLowerCase().includes(q)) : productos;
  const conReceta = productos.filter((p) => p.receta.length > 0).length;

  if (insumos.length === 0) {
    return <p className="panel p-5 text-sm text-carbon-500">Primero cargá los insumos en "Qué hay". Después, acá se arma cuánto usa cada producto.</p>;
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-2xl text-sm text-carbon-500">
          Cuánto de cada insumo lleva cada producto, en gramos (o ml, o unidades). Con cada venta se descuenta solo; si el pedido se cancela, vuelve.
          {` ${conReceta} de ${productos.length} productos tienen receta.`}
        </p>
        <input className="input max-w-xs" placeholder="Buscar producto o categoría" value={busqueda} onChange={(e) => setBusqueda(e.target.value)} />
      </div>
      <div className="panel overflow-hidden">
        <ul className="divide-y divide-carbon/10">
          {visibles.map((p) => (
            <li key={p.id}>
              <button onClick={() => setAbierto(abierto === p.id ? null : p.id)} aria-expanded={abierto === p.id} className="flex w-full items-center gap-4 px-5 py-3 text-left hover:bg-carbon/5">
                <span className="min-w-0 flex-1">
                  <span className="font-medium">{p.name}</span>
                  <span className="ml-2 text-xs text-carbon-500">{p.categoria}</span>
                </span>
                <span className={`text-xs ${p.receta.length ? 'text-carbon' : 'text-carbon-500'}`}>
                  {p.receta.length ? resumenReceta(p.receta, insumos) : 'Sin receta'}
                </span>
                <span aria-hidden className="text-carbon-500">{abierto === p.id ? '▴' : '▾'}</span>
              </button>
              {abierto === p.id && <EditorProducto producto={p} insumos={insumos} puedeEditar={puedeEditar} />}
            </li>
          ))}
          {visibles.length === 0 && <li className="px-5 py-4 text-sm text-carbon-500">No hay productos con ese nombre.</li>}
        </ul>
      </div>
    </div>
  );
}

function resumenReceta(receta: ItemReceta[], insumos: Insumo[]) {
  const nombres = [...new Set(receta.map((r) => insumos.find((i) => i.id === r.supplyId)?.name).filter(Boolean))];
  return nombres.length <= 3 ? nombres.join(', ') : `${nombres.slice(0, 3).join(', ')} y ${nombres.length - 3} más`;
}

let contador = 0;
const nuevaClave = () => `f${++contador}`;

/** Filas editables a partir de una receta guardada, en la unidad chica. */
function filasDe(receta: ItemReceta[], insumos: Insumo[]): Fila[] {
  return receta.map((r) => {
    const i = insumos.find((x) => x.id === r.supplyId);
    return { clave: nuevaClave(), supplyId: r.supplyId, cantidad: i ? mostrarEnChica(r.quantity, u(i.unit)).replace(/\./g, '') : '' };
  });
}

function EditorProducto({ producto, insumos, puedeEditar }: { producto: Producto; insumos: Insumo[]; puedeEditar: boolean }) {
  const router = useRouter();
  const conTamanos = producto.variants.length > 0;
  const grupos = conTamanos ? producto.variants : [{ id: '', name: '' }];
  const [filas, setFilas] = useState<Record<string, Fila[]>>(() =>
    Object.fromEntries(grupos.map((v) => [v.id, filasDe(producto.receta.filter((r) => (r.variantId ?? '') === v.id), insumos)]))
  );
  const [mensaje, setMensaje] = useState<{ ok: boolean; texto: string } | null>(null);
  const [pendiente, startTransition] = useTransition();

  function cambiar(vid: string, f: (l: Fila[]) => Fila[]) {
    setFilas((x) => ({ ...x, [vid]: f(x[vid] ?? []) }));
    setMensaje(null);
  }

  /** Copia la receta de un tamaño a los demás: se arma la grande y se ajusta. */
  function copiarATodos(vid: string) {
    const base = filas[vid] ?? [];
    setFilas(Object.fromEntries(grupos.map((v) => [v.id, v.id === vid ? base : base.map((f) => ({ ...f, clave: nuevaClave() }))])));
    setMensaje(null);
  }

  function guardar() {
    const lineas: LineaReceta[] = grupos.flatMap((v) =>
      (filas[v.id] ?? []).filter((f) => f.supplyId).map((f) => ({ supplyId: f.supplyId, variantId: v.id || null, cantidad: f.cantidad }))
    );
    startTransition(async () => {
      try {
        const r = await guardarReceta({ productId: producto.id }, lineas);
        setMensaje(r.ok ? { ok: true, texto: 'Receta guardada. Se descuenta desde la próxima venta.' } : { ok: false, texto: r.error });
        if (r.ok) router.refresh();
      } catch {
        setMensaje({ ok: false, texto: 'No se pudo guardar. Revisá la conexión.' });
      }
    });
  }

  return (
    <div className="space-y-5 bg-crema-200/50 px-5 pb-5 pt-2">
      <div className={`grid gap-4 ${conTamanos && grupos.length > 1 ? 'md:grid-cols-2 xl:grid-cols-3' : ''}`}>
        {grupos.map((v) => (
          <div key={v.id || 'unico'} className="rounded-xl border border-carbon/10 bg-white p-4">
            <div className="mb-3 flex items-baseline justify-between gap-2">
              <p className="font-semibold">{v.name || 'Lleva'}</p>
              {puedeEditar && conTamanos && grupos.length > 1 && (filas[v.id] ?? []).length > 0 && (
                <button type="button" onClick={() => copiarATodos(v.id)} className="text-xs underline">Copiar a los otros tamaños</button>
              )}
            </div>
            <ListaFilas filas={filas[v.id] ?? []} insumos={insumos} puedeEditar={puedeEditar} onCambio={(f) => cambiar(v.id, f)} />
          </div>
        ))}
      </div>

      {producto.extras.length > 0 && (
        <div>
          <p className="mb-2 text-sm font-semibold">Extras y gustos</p>
          <p className="mb-3 text-xs text-carbon-500">Lo que suma cada uno cuando se elige, por ejemplo "Doble muzzarella: 150 g de muzzarella".</p>
          <div className="grid gap-3 md:grid-cols-2">
            {producto.extras.map((x) => <EditorExtra key={x.id} extra={x} insumos={insumos} puedeEditar={puedeEditar} />)}
          </div>
        </div>
      )}

      {puedeEditar && (
        <div className="flex flex-wrap items-center gap-3">
          <button onClick={guardar} disabled={pendiente} className="btn-primario px-5 py-2.5">{pendiente ? 'Guardando...' : `Guardar receta de ${producto.name}`}</button>
          {mensaje && <p role={mensaje.ok ? 'status' : 'alert'} className={`text-sm ${mensaje.ok ? 'text-verde' : 'text-ladrillo'}`}>{mensaje.texto}</p>}
        </div>
      )}
    </div>
  );
}

function EditorExtra({ extra, insumos, puedeEditar }: { extra: Producto['extras'][number]; insumos: Insumo[]; puedeEditar: boolean }) {
  const router = useRouter();
  const [filas, setFilas] = useState<Fila[]>(() => filasDe(extra.receta, insumos));
  const [cambiado, setCambiado] = useState(false);
  const [mensaje, setMensaje] = useState<{ ok: boolean; texto: string } | null>(null);
  const [pendiente, startTransition] = useTransition();
  return (
    <div className="rounded-xl border border-carbon/10 bg-white p-3">
      <p className="mb-2 text-sm"><span className="font-medium">{extra.name}</span> <span className="text-xs text-carbon-500">{extra.grupo}</span></p>
      <ListaFilas filas={filas} insumos={insumos} puedeEditar={puedeEditar} onCambio={(f) => { setFilas(f); setCambiado(true); setMensaje(null); }} />
      {puedeEditar && cambiado && (
        <button
          disabled={pendiente}
          onClick={() =>
            startTransition(async () => {
              const r = await guardarReceta({ addonOptionId: extra.id }, filas.filter((f) => f.supplyId).map((f) => ({ supplyId: f.supplyId, variantId: null, cantidad: f.cantidad })));
              setMensaje(r.ok ? { ok: true, texto: 'Guardado' } : { ok: false, texto: r.error });
              if (r.ok) { setCambiado(false); router.refresh(); }
            })
          }
          className="btn-fantasma mt-2 px-3 py-1.5 text-sm"
        >
          {pendiente ? 'Guardando...' : 'Guardar'}
        </button>
      )}
      {mensaje && <p className={`mt-1 text-xs ${mensaje.ok ? 'text-verde' : 'text-ladrillo'}`}>{mensaje.texto}</p>}
    </div>
  );
}

function ListaFilas({ filas, insumos, puedeEditar, onCambio }: {
  filas: Fila[]; insumos: Insumo[]; puedeEditar: boolean; onCambio: (f: (l: Fila[]) => Fila[]) => void;
}) {
  return (
    <div className="space-y-2">
      {filas.length === 0 && <p className="text-sm text-carbon-500">Nada cargado.</p>}
      {filas.map((f) => {
        const insumo = insumos.find((i) => i.id === f.supplyId);
        const chica = insumo ? (insumo.unit === 'U' ? 'u' : UNIDADES[u(insumo.unit)].chica) : '';
        return (
          <div key={f.clave} className="flex items-center gap-2">
            <select
              aria-label="Insumo"
              className="input min-w-0 flex-1 py-2"
              value={f.supplyId}
              disabled={!puedeEditar}
              onChange={(e) => onCambio((l) => l.map((x) => (x.clave === f.clave ? { ...x, supplyId: e.target.value } : x)))}
            >
              <option value="">Elegí un insumo</option>
              {insumos.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
            </select>
            <div className="relative w-28 shrink-0">
              <input
                aria-label={`Cantidad${chica ? ` en ${chica}` : ''}`}
                className="input py-2 pr-9 text-right"
                inputMode="decimal"
                value={f.cantidad}
                disabled={!puedeEditar}
                onChange={(e) => onCambio((l) => l.map((x) => (x.clave === f.clave ? { ...x, cantidad: e.target.value } : x)))}
                placeholder="0"
              />
              <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-carbon-500">{chica}</span>
            </div>
            {puedeEditar && (
              <button type="button" onClick={() => onCambio((l) => l.filter((x) => x.clave !== f.clave))} className="px-2 text-lg text-carbon-500 hover:text-ladrillo" aria-label="Sacar">×</button>
            )}
          </div>
        );
      })}
      {puedeEditar && (
        <button type="button" onClick={() => onCambio((l) => [...l, { clave: nuevaClave(), supplyId: '', cantidad: '' }])} className="text-sm underline">
          + Agregar insumo
        </button>
      )}
    </div>
  );
}

// ─────────── Movimientos ───────────

function Movimientos({ movimientos, insumos }: { movimientos: Movimiento[]; insumos: Insumo[] }) {
  const [insumoId, setInsumoId] = useState('');
  const [tipo, setTipo] = useState('');
  const porId = useMemo(() => new Map(insumos.map((i) => [i.id, i])), [insumos]);
  const visibles = movimientos.filter((m) => (!insumoId || m.supplyId === insumoId) && (!tipo || m.type === tipo));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-3">
        <select className="input w-auto" value={insumoId} onChange={(e) => setInsumoId(e.target.value)} aria-label="Insumo">
          <option value="">Todos los insumos</option>
          {insumos.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
        </select>
        <select className="input w-auto" value={tipo} onChange={(e) => setTipo(e.target.value)} aria-label="Tipo de movimiento">
          <option value="">Todos los movimientos</option>
          {Object.entries(TIPOS_MOVIMIENTO_INSUMO).map(([id, label]) => <option key={id} value={id}>{label}</option>)}
        </select>
      </div>
      {visibles.length === 0 ? (
        <p className="panel p-5 text-sm text-carbon-500">No hay movimientos.</p>
      ) : (
        <div className="panel overflow-hidden">
          <ul className="divide-y divide-carbon/10 text-sm">
            {visibles.map((m) => {
              const i = porId.get(m.supplyId);
              const unit = i?.unit ?? 'U';
              const detalle = [
                m.type === 'MERMA' && m.lossType ? ETIQUETA_TIPO_MERMA[m.lossType] : '',
                m.reason && m.reason !== (m.lossType ? ETIQUETA_TIPO_MERMA[m.lossType] : '') ? m.reason : '',
                m.orderCode ? `Pedido ${m.orderCode}` : '',
                m.gasto !== null ? `Pagado ${money(m.gasto)}` : '',
                m.user ? `Anotó ${m.user}` : '',
              ].filter(Boolean).join(' · ');
              return (
                <li key={m.id} className="flex flex-wrap items-baseline gap-x-4 gap-y-1 px-5 py-2.5">
                  <span className="w-24 shrink-0 text-xs text-carbon-500">{diaHora(m.createdAt)}</span>
                  <span className="min-w-[8rem] flex-1">
                    <span className="font-medium">{i?.name ?? '?'}</span>{' '}
                    <span className="text-carbon-500">{TIPOS_MOVIMIENTO_INSUMO[m.type] ?? m.type}</span>
                    {detalle && <span className="block text-xs text-carbon-500">{detalle}</span>}
                  </span>
                  <span className={`w-24 text-right font-semibold tabular-nums ${m.quantity < 0 ? 'text-ladrillo' : m.quantity > 0 ? 'text-verde' : ''}`}>
                    {m.quantity > 0 ? '+' : ''}{cant(m.quantity, unit)}
                  </span>
                  <span className="w-24 text-right text-xs tabular-nums text-carbon-500">Quedó {cant(m.after, unit)}</span>
                </li>
              );
            })}
          </ul>
        </div>
      )}
      {movimientos.length >= 300 && <p className="text-xs text-carbon-500">Se muestran los últimos 300 movimientos.</p>}
    </div>
  );
}
