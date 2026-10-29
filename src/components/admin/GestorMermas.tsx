'use client';

import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { registrarMerma } from '@/actions/operacion';
import { mermaInsumo } from '@/actions/insumos';
import { UNIDADES, mostrarCantidad, type Unidad } from '@/lib/insumos';
import { diaHora } from '@/lib/tiempo';
import { TIPOS_MERMA, ETIQUETA_TIPO_MERMA, tipoDeMerma } from '@/lib/mermas';

type Producto = {
  id: string; name: string; trackStock: boolean;
  category: { name: string };
  variants: { id: string; name: string }[];
};
type Insumo = { id: string; name: string; unit: string };
type MermaInsumo = {
  id: string; quantity: number; lossType: string | null; reason: string | null; createdAt: string;
  supply: { name: string; unit: string }; user: { name: string } | null;
};
const enUnidad = (m: number, unit: string) => mostrarCantidad(m, (unit in UNIDADES ? unit : 'U') as Unidad);
type Merma = {
  id: string; quantity: number; lossType: string | null; reason: string | null; orderCode: string | null; createdAt: string;
  product: { name: string } | null; variant: { name: string } | null; user: { name: string } | null;
};

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const nombreMes = (mes: string) => `${MESES[Number(mes.slice(5)) - 1]} ${mes.slice(0, 4)}`;
const moverMes = (mes: string, delta: number) => {
  const d = new Date(Number(mes.slice(0, 4)), Number(mes.slice(5)) - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};
const unidades = (n: number) => `${n} ${n === 1 ? 'unidad' : 'unidades'}`;

/**
 * Lo que se fue sin cobrarse. Pensada para cargar rápido en pleno servicio:
 * se toca qué pasó, se busca el producto, se ajusta la cantidad y listo. El
 * detalle es opcional salvo en "Otro".
 */
export default function GestorMermas({
  sucursal, mes, mesActual, desde, hasta, productos, mermas, insumos, mermasInsumo, puedeAnotar, puedeDescargar,
}: {
  sucursal: string; mes: string; mesActual: string; desde: string; hasta: string;
  productos: Producto[]; mermas: Merma[]; insumos: Insumo[]; mermasInsumo: MermaInsumo[];
  puedeAnotar: boolean; puedeDescargar: boolean;
}) {
  const router = useRouter();
  const [tipo, setTipo] = useState<string>('');
  const [busqueda, setBusqueda] = useState('');
  const [productoId, setProductoId] = useState('');
  const [varianteId, setVarianteId] = useState('');
  const [cantidad, setCantidad] = useState(1);
  const [insumoId, setInsumoId] = useState('');
  const [cantidadInsumo, setCantidadInsumo] = useState('');
  const [detalle, setDetalle] = useState('');
  const [error, setError] = useState('');
  const [aviso, setAviso] = useState('');
  const [filtro, setFiltro] = useState('');
  const [pendiente, startTransition] = useTransition();

  const producto = productos.find((p) => p.id === productoId);
  const insumo = insumos.find((i) => i.id === insumoId);
  const q = busqueda.trim().toLowerCase();
  const encontrados = q ? productos.filter((p) => p.name.toLowerCase().includes(q)).slice(0, 8) : [];
  // Los insumos (muzzarella, harina) también se pierden: se anotan en su unidad
  const insumosEncontrados = q ? insumos.filter((i) => i.name.toLowerCase().includes(q)).slice(0, 5) : [];
  const esMesActual = mes === mesActual;

  const porTipo = useMemo(() => {
    const mapa = new Map<string, number>();
    for (const m of mermas) mapa.set(tipoDeMerma(m.lossType), (mapa.get(tipoDeMerma(m.lossType)) ?? 0) + Math.abs(m.quantity));
    return TIPOS_MERMA.map((t) => ({ ...t, unidades: mapa.get(t.id) ?? 0 })).filter((t) => t.unidades > 0);
  }, [mermas]);
  const maxTipo = Math.max(1, ...porTipo.map((t) => t.unidades));

  const visibles = filtro ? mermas.filter((m) => tipoDeMerma(m.lossType) === filtro) : mermas;
  const porProducto = useMemo(() => {
    const mapa = new Map<string, number>();
    for (const m of visibles) {
      const nombre = `${m.product?.name ?? '?'}${m.variant ? ` · ${m.variant.name}` : ''}`;
      mapa.set(nombre, (mapa.get(nombre) ?? 0) + Math.abs(m.quantity));
    }
    return [...mapa.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);
  }, [visibles]);

  const insumosPorNombre = useMemo(() => {
    const mapa = new Map<string, { nombre: string; unit: string; cantidad: number }>();
    for (const m of mermasInsumo) {
      const x = mapa.get(m.supply.name) ?? { nombre: m.supply.name, unit: m.supply.unit, cantidad: 0 };
      x.cantidad += Math.abs(m.quantity);
      mapa.set(m.supply.name, x);
    }
    return [...mapa.values()];
  }, [mermasInsumo]);

  function elegirInsumo(i: Insumo) {
    setInsumoId(i.id);
    setProductoId('');
    setBusqueda('');
  }

  function elegirProducto(p: Producto) {
    setInsumoId('');
    setProductoId(p.id);
    setVarianteId(p.variants.length === 1 ? p.variants[0].id : '');
    setBusqueda('');
  }

  function anotar() {
    setError('');
    setAviso('');
    if (!tipo) { setError('Elegí qué pasó'); return; }
    if (insumo) {
      startTransition(async () => {
        try {
          const r = await mermaInsumo(insumo.id, cantidadInsumo, tipo, detalle);
          if (!r.ok) { setError(r.error); return; }
          setAviso(`Anotado: ${cantidadInsumo.trim()} de ${insumo.name}, ${ETIQUETA_TIPO_MERMA[tipo].toLowerCase()}. Se descontó de los insumos.`);
          setInsumoId(''); setCantidadInsumo(''); setDetalle('');
          router.refresh();
        } catch {
          setError('No se pudo guardar. Revisá la conexión.');
        }
      });
      return;
    }
    if (!producto) { setError('Elegí el producto'); return; }
    if (producto.variants.length > 0 && !varianteId) { setError(`Elegí el tamaño de ${producto.name}`); return; }
    startTransition(async () => {
      try {
        const r = await registrarMerma(producto.id, varianteId || null, cantidad, tipo, detalle);
        if (!r.ok) { setError(r.error); return; }
        const tam = producto.variants.find((v) => v.id === varianteId)?.name;
        setAviso(`Anotado: ${cantidad} ${producto.name}${tam ? ` ${tam}` : ''}, ${ETIQUETA_TIPO_MERMA[tipo].toLowerCase()}${producto.trackStock ? '. Se descontó del stock.' : '.'}`);
        setProductoId(''); setVarianteId(''); setCantidad(1); setDetalle('');
        router.refresh();
      } catch {
        setError('No se pudo guardar. Revisá la conexión.');
      }
    });
  }

  const ejemplo = TIPOS_MERMA.find((t) => t.id === tipo)?.ejemplo;

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl">Mermas · {sucursal}</h1>
          <p className="mt-1 text-sm text-carbon-500">Lo que se rompe, se vence, sale mal o se regala. Sin plata: en unidades, o en kilos si es un insumo.</p>
        </div>
        {puedeDescargar && mermas.length + mermasInsumo.length > 0 && (
          <a href={`/api/finanzas/exportar?tipo=mermas&desde=${desde}&hasta=${hasta}`} className="btn-fantasma px-4 py-2 text-sm">
            Descargar el mes (Excel)
          </a>
        )}
      </div>

      <div className="grid items-start gap-6 lg:grid-cols-[420px_1fr]">
        {puedeAnotar && (
          <section className="panel space-y-5 p-5" aria-label="Anotar una merma">
            <div>
              <p className="label">¿Qué pasó?</p>
              <div className="grid grid-cols-2 gap-2">
                {TIPOS_MERMA.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => setTipo(t.id)}
                    aria-pressed={tipo === t.id}
                    className={`rounded-xl border px-3 py-2.5 text-left text-sm font-medium ${
                      tipo === t.id ? 'border-marca bg-marca text-crema' : 'border-carbon/15 bg-white hover:border-marca'
                    }`}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="label" htmlFor="m-buscar">Producto o insumo</label>
              {producto || insumo ? (
                <div className="flex items-center justify-between gap-3 rounded-xl border border-marca bg-white px-3 py-2.5">
                  <span className="font-medium">{producto?.name ?? insumo?.name}{insumo && <span className="ml-2 text-xs font-normal text-carbon-500">Insumo</span>}</span>
                  <button type="button" onClick={() => { setProductoId(''); setVarianteId(''); setInsumoId(''); }} className="text-sm underline">Cambiar</button>
                </div>
              ) : (
                <>
                  <input
                    id="m-buscar"
                    className="input"
                    placeholder="Buscar: coca, muzza, flan..."
                    value={busqueda}
                    onChange={(e) => setBusqueda(e.target.value)}
                    autoComplete="off"
                  />
                  {encontrados.length + insumosEncontrados.length > 0 && (
                    <ul className="mt-2 divide-y divide-carbon/10 rounded-xl border border-carbon/15 bg-white">
                      {encontrados.map((p) => (
                        <li key={p.id}>
                          <button type="button" onClick={() => elegirProducto(p)} className="flex w-full justify-between gap-3 px-3 py-2.5 text-left text-sm hover:bg-carbon/5">
                            <span className="font-medium">{p.name}</span>
                            <span className="text-carbon-500">{p.category.name}</span>
                          </button>
                        </li>
                      ))}
                      {insumosEncontrados.map((i) => (
                        <li key={i.id}>
                          <button type="button" onClick={() => elegirInsumo(i)} className="flex w-full justify-between gap-3 px-3 py-2.5 text-left text-sm hover:bg-carbon/5">
                            <span className="font-medium">{i.name}</span>
                            <span className="text-carbon-500">Insumo, en {UNIDADES[(i.unit in UNIDADES ? i.unit : 'U') as Unidad].nombre.toLowerCase()}</span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                  {q && encontrados.length + insumosEncontrados.length === 0 && <p className="mt-2 text-sm text-carbon-500">No hay productos ni insumos con ese nombre.</p>}
                </>
              )}
            </div>

            {producto && producto.variants.length > 1 && (
              <div>
                <p className="label">Tamaño</p>
                <div className="flex flex-wrap gap-2">
                  {producto.variants.map((v) => (
                    <button
                      key={v.id}
                      type="button"
                      onClick={() => setVarianteId(v.id)}
                      aria-pressed={varianteId === v.id}
                      className={`chip ${varianteId === v.id ? 'chip-activo' : ''}`}
                    >
                      {v.name}
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div className="flex items-end gap-4">
              {insumo ? (
                <div className="w-36">
                  <label className="label" htmlFor="m-cant-insumo">Cuánto ({UNIDADES[(insumo.unit in UNIDADES ? insumo.unit : 'U') as Unidad].label})</label>
                  <input
                    id="m-cant-insumo"
                    className="input"
                    inputMode="decimal"
                    value={cantidadInsumo}
                    onChange={(e) => setCantidadInsumo(e.target.value)}
                    placeholder={insumo.unit === 'U' ? '2' : '1 o 300 g'}
                  />
                </div>
              ) : (
              <div>
                <p className="label">Cantidad</p>
                <div className="inline-flex items-center rounded-xl border border-carbon/15 bg-white">
                  <button type="button" onClick={() => setCantidad((c) => Math.max(1, c - 1))} className="px-4 py-2.5 text-lg" aria-label="Una menos">−</button>
                  <span className="w-10 text-center text-lg font-semibold tabular-nums">{cantidad}</span>
                  <button type="button" onClick={() => setCantidad((c) => Math.min(999, c + 1))} className="px-4 py-2.5 text-lg" aria-label="Una más">+</button>
                </div>
              </div>
              )}
              <div className="min-w-0 flex-1">
                <label className="label" htmlFor="m-detalle">Detalle {tipo !== 'OTRO' && <span className="font-normal text-carbon-500">(opcional)</span>}</label>
                <input
                  id="m-detalle"
                  className="input"
                  placeholder={ejemplo ?? 'Qué pasó'}
                  value={detalle}
                  onChange={(e) => setDetalle(e.target.value)}
                  maxLength={150}
                />
              </div>
            </div>

            {error && <p role="alert" className="rounded-lg bg-ladrillo/10 px-3 py-2 text-sm text-ladrillo">{error}</p>}
            {aviso && <p role="status" className="rounded-lg bg-verde/10 px-3 py-2 text-sm text-verde">{aviso}</p>}
            <button onClick={anotar} disabled={pendiente} className="btn-primario w-full py-3">
              {pendiente ? 'Guardando...' : 'Anotar'}
            </button>
            <p className="text-xs text-carbon-500">
              Si el producto lleva control de stock, se descuenta solo. Un insumo (muzzarella, harina) se anota en kilos, litros o unidades. Para un pedido que salió mal, también se puede anotar desde la ficha del pedido.
            </p>
          </section>
        )}

        <div className="min-w-0 space-y-6">
          <div className="flex items-center gap-2">
            <button onClick={() => router.push(`/admin/mermas?mes=${moverMes(mes, -1)}`)} className="rounded-lg border border-carbon/15 bg-white px-2.5 py-1 text-sm" aria-label="Mes anterior">‹</button>
            <span className="min-w-[10rem] text-center font-semibold capitalize">{nombreMes(mes)}</span>
            <button onClick={() => router.push(`/admin/mermas?mes=${moverMes(mes, 1)}`)} disabled={esMesActual} className="rounded-lg border border-carbon/15 bg-white px-2.5 py-1 text-sm disabled:opacity-30" aria-label="Mes siguiente">›</button>
          </div>

          <section className="panel p-5">
            <h2 className="font-display text-lg">Por qué se fue</h2>
            {porTipo.length === 0 ? (
              <p className="mt-3 text-sm text-carbon-500">No se anotaron mermas en {nombreMes(mes)}.</p>
            ) : (
              <ul className="mt-4 space-y-3">
                {porTipo.map((t) => {
                  const activo = filtro === t.id;
                  return (
                    <li key={t.id}>
                      <button
                        onClick={() => setFiltro(activo ? '' : t.id)}
                        aria-pressed={activo}
                        className={`w-full rounded-lg p-1 text-left ${activo ? 'bg-carbon/5' : 'hover:bg-carbon/5'}`}
                      >
                        <div className="flex items-baseline justify-between gap-3 text-sm">
                          <span className="font-medium">{t.label}</span>
                          <span className="tabular-nums">{unidades(t.unidades)}</span>
                        </div>
                        <div className="mt-1.5 h-2 rounded-sm bg-carbon/5">
                          <div className="h-2 rounded-r-[4px] bg-marca" style={{ width: `${Math.max(2, (t.unidades / maxTipo) * 100)}%` }} />
                        </div>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
            {porTipo.length > 0 && <p className="mt-3 text-xs text-carbon-500">Tocá un tipo para ver solo esas mermas.</p>}
          </section>

          {porProducto.length > 0 && (
            <section className="panel p-5">
              <h2 className="font-display text-lg">Qué productos{filtro ? ` · ${ETIQUETA_TIPO_MERMA[filtro]}` : ''}</h2>
              <ul className="mt-3 divide-y divide-carbon/10 text-sm">
                {porProducto.map(([nombre, n]) => (
                  <li key={nombre} className="flex justify-between py-2">
                    <span>{nombre}</span>
                    <strong className="tabular-nums">{unidades(n)}</strong>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {mermasInsumo.length > 0 && (
            <section className="panel p-5">
              <h2 className="font-display text-lg">Insumos perdidos</h2>
              <ul className="mt-3 divide-y divide-carbon/10 text-sm">
                {insumosPorNombre.map((x) => (
                  <li key={x.nombre} className="flex justify-between py-2">
                    <span>{x.nombre}</span>
                    <strong className="tabular-nums">{enUnidad(x.cantidad, x.unit)}</strong>
                  </li>
                ))}
              </ul>
              <ul className="mt-3 space-y-1 border-t border-carbon/10 pt-3 text-xs text-carbon-500">
                {mermasInsumo.map((m) => (
                  <li key={m.id} className="flex justify-between gap-3">
                    <span>
                      {enUnidad(Math.abs(m.quantity), m.supply.unit)} de {m.supply.name}: {ETIQUETA_TIPO_MERMA[tipoDeMerma(m.lossType)].toLowerCase()}
                      {m.reason && m.reason !== ETIQUETA_TIPO_MERMA[tipoDeMerma(m.lossType)] ? `, ${m.reason}` : ''}
                      {m.user ? `. Anotó ${m.user.name}` : ''}
                    </span>
                    <span className="shrink-0">{diaHora(m.createdAt)}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {visibles.length > 0 && (
            <section className="panel p-5">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h2 className="font-display text-lg">Registro</h2>
                {filtro && <button onClick={() => setFiltro('')} className="text-sm underline">Ver todos los tipos</button>}
              </div>
              <ul className="mt-3 divide-y divide-carbon/10 text-sm">
                {visibles.map((m) => (
                  <li key={m.id} className="flex items-baseline gap-4 py-2.5">
                    <div className="min-w-0 flex-1">
                      <p className="font-medium">
                        {Math.abs(m.quantity)} × {m.product?.name}{m.variant ? ` · ${m.variant.name}` : ''}
                      </p>
                      <p className="mt-0.5 text-xs text-carbon-500">
                        <span className="mr-1.5 rounded bg-carbon/5 px-1.5 py-0.5 font-medium text-carbon">{ETIQUETA_TIPO_MERMA[tipoDeMerma(m.lossType)]}</span>
                        {[
                          m.reason && m.reason !== ETIQUETA_TIPO_MERMA[tipoDeMerma(m.lossType)] ? m.reason : '',
                          m.user ? `Anotó ${m.user.name}` : '',
                        ].filter(Boolean).join('. ')}
                      </p>
                    </div>
                    <span className="w-24 shrink-0 text-right text-xs text-carbon-500">{diaHora(m.createdAt)}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}
