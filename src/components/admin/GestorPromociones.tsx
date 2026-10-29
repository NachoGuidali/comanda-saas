'use client';

import { useState } from 'react';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { money, fromCents } from '@/lib/money';
import { claveDia } from '@/lib/tiempo';
import { etiquetaDias, DIAS_CORTOS } from '@/lib/promos';
import { guardarPromocion, borrarPromocion } from '@/actions/catalog';
import SubirImagen from './SubirImagen';

type Promo = {
  id: string; title: string; description: string | null; imageUrl: string | null;
  type: string; value: number; code: string | null; minOrder: number;
  active: boolean; showPopup: boolean; days: number[];
  startsAt: string | null; endsAt: string | null; position: number;
  products: { productId: string }[];
};
type Producto = { id: string; name: string; categoria: string; tieneVariantes: boolean };

const TIPOS = [
  {
    grupo: 'Se aplica sola en la carta',
    items: [
      { id: 'PRODUCTO_PORCENTAJE', label: 'Descuento en productos', ayuda: 'Un % menos en los productos que elijas, los días que elijas' },
      { id: 'PRODUCTO_PRECIO', label: 'Precio promocional', ayuda: 'Precio fijo para esos productos. Solo sirve en productos sin tamaños' },
    ],
  },
  {
    grupo: 'El cliente pone un código',
    items: [
      { id: 'PORCENTAJE', label: 'Porcentaje del total', ayuda: 'Descuenta un % de todo el pedido' },
      { id: 'MONTO_FIJO', label: 'Monto fijo', ayuda: 'Descuenta una cantidad del total' },
      { id: 'ENVIO_GRATIS', label: 'Envío sin cargo', ayuda: 'Anula el costo de envío' },
    ],
  },
  {
    grupo: 'Sin descuento',
    items: [{ id: 'BANNER', label: 'Solo cartel', ayuda: 'Se muestra en la carta pero no cambia ningún precio' }],
  },
];

const ES_AUTOMATICA = (t: string) => t === 'PRODUCTO_PORCENTAJE' || t === 'PRODUCTO_PRECIO';

function etiquetaValor(p: Promo) {
  if (p.type === 'PORCENTAJE' || p.type === 'PRODUCTO_PORCENTAJE') return `${p.value}% off`;
  if (p.type === 'MONTO_FIJO') return `${money(p.value)} off`;
  if (p.type === 'PRODUCTO_PRECIO') return `A ${money(p.value)}`;
  if (p.type === 'ENVIO_GRATIS') return 'Envío sin cargo';
  return 'Cartel';
}

export default function GestorPromociones({
  promos, productos,
}: {
  promos: Promo[]; productos: Producto[];
}) {
  const router = useRouter();
  const [editando, setEditando] = useState<Promo | 'nueva' | null>(null);

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl">Promociones</h1>
          <p className="mt-1 text-sm text-carbon-500">
            Las de producto se aplican solas en la carta los días marcados. Las de código las
            escribe el cliente al confirmar.
          </p>
        </div>
        <button onClick={() => setEditando('nueva')} className="btn-acento">Crear promoción</button>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {promos.length === 0 && (
          <p className="panel col-span-full p-8 text-center text-sm text-carbon-500">
            No hay promociones cargadas.
          </p>
        )}

        {promos.map((p) => {
          const vencida = p.endsAt ? new Date(p.endsAt) < new Date() : false;
          const auto = ES_AUTOMATICA(p.type);
          const nombres = p.products
            .map((x) => productos.find((pr) => pr.id === x.productId)?.name)
            .filter(Boolean);

          return (
            <article key={p.id} className="panel overflow-hidden">
              {p.imageUrl && (
                <div className="relative h-32 w-full bg-carbon/5">
                  <Image src={p.imageUrl} alt="" fill className="object-cover" sizes="400px" />
                </div>
              )}
              <div className="p-4">
                <div className="flex items-start justify-between gap-2">
                  <h2 className="font-display text-lg leading-tight">{p.title}</h2>
                  <span
                    className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                      !p.active || vencida ? 'bg-carbon/10 text-carbon-500' : 'bg-verde/10 text-verde'
                    }`}
                  >
                    {vencida ? 'Vencida' : p.active ? 'Activa' : 'Pausada'}
                  </span>
                </div>

                {p.description && <p className="mt-1 text-sm text-carbon-500">{p.description}</p>}

                <p className="mt-3 font-semibold">{etiquetaValor(p)}</p>

                {auto ? (
                  <>
                    <p className="mt-1 text-sm text-carbon-500">{etiquetaDias(p.days)}</p>
                    <p className="mt-1 text-xs text-carbon-500">
                      {nombres.length === 0
                        ? 'Sin productos asignados'
                        : nombres.length <= 3
                          ? nombres.join(', ')
                          : `${nombres.slice(0, 3).join(', ')} y ${nombres.length - 3} más`}
                    </p>
                  </>
                ) : (
                  p.code && (
                    <p className="mt-1 text-sm">
                      Código <span className="rounded bg-carbon px-2 py-0.5 font-mono text-xs text-crema">{p.code}</span>
                    </p>
                  )
                )}

                {p.minOrder > 0 && <p className="mt-1 text-xs text-carbon-500">Desde {money(p.minOrder)} de compra</p>}
                {p.showPopup && <p className="mt-2 text-xs font-medium text-rojo">Se abre como pop-up</p>}

                <div className="mt-4 flex gap-2">
                  <button onClick={() => setEditando(p)} className="btn-fantasma flex-1 py-1.5 text-sm">Editar</button>
                  <button
                    onClick={async () => {
                      if (!confirm(`¿Borrar "${p.title}"?`)) return;
                      await borrarPromocion(p.id);
                      router.refresh();
                    }}
                    className="px-3 text-sm text-carbon-500 underline"
                  >
                    Borrar
                  </button>
                </div>
              </div>
            </article>
          );
        })}
      </div>

      {editando && (
        <Editor
          promo={editando === 'nueva' ? null : editando}
          productos={productos}
          onCerrar={() => setEditando(null)}
          onGuardado={() => { setEditando(null); router.refresh(); }}
        />
      )}
    </div>
  );
}

function Editor({
  promo, productos, onCerrar, onGuardado,
}: {
  promo: Promo | null; productos: Producto[];
  onCerrar: () => void; onGuardado: () => void;
}) {
  const [imagen, setImagen] = useState(promo?.imageUrl ?? '');
  const [tipo, setTipo] = useState(promo?.type ?? 'PRODUCTO_PORCENTAJE');
  const [dias, setDias] = useState<number[]>(promo?.days ?? []);
  const [elegidos, setElegidos] = useState<string[]>(promo?.products.map((x) => x.productId) ?? []);
  const [busqueda, setBusqueda] = useState('');
  const [error, setError] = useState('');
  const [guardando, setGuardando] = useState(false);

  const auto = ES_AUTOMATICA(tipo);
  const pideValor = tipo !== 'ENVIO_GRATIS' && tipo !== 'BANNER';
  const pideCodigo = !auto && tipo !== 'BANNER';
  const esPorcentaje = tipo === 'PORCENTAJE' || tipo === 'PRODUCTO_PORCENTAJE';

  const visibles = productos.filter(
    (p) => !busqueda || p.name.toLowerCase().includes(busqueda.toLowerCase())
  );

  // Aviso temprano: el precio fijo no funciona en productos con tamaños
  const conflictivos =
    tipo === 'PRODUCTO_PRECIO'
      ? productos.filter((p) => elegidos.includes(p.id) && p.tieneVariantes)
      : [];

  async function enviar(fd: FormData) {
    setError('');
    setGuardando(true);
    fd.set('imageUrl', imagen);
    fd.set('type', tipo);
    fd.set('days', dias.join(','));
    fd.set('productIds', auto ? elegidos.join(',') : '');
    const res = await guardarPromocion(fd);
    setGuardando(false);
    if (!res.ok) { setError(res.error); return; }
    onGuardado();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-carbon/50 p-4" onClick={onCerrar}>
      <div
        className="scroll-fino max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-crema p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="font-display text-xl">{promo ? promo.title : 'Promoción nueva'}</h2>

        <form action={enviar} className="mt-5 space-y-4">
          {promo && <input type="hidden" name="id" value={promo.id} />}

          <div>
            <label className="label" htmlFor="title">Título</label>
            <input id="title" name="title" required defaultValue={promo?.title} className="input" placeholder="Martes de empanadas" />
          </div>

          <div>
            <label className="label" htmlFor="description">Bajada</label>
            <input id="description" name="description" defaultValue={promo?.description ?? ''} className="input" placeholder="Docena surtida con 20% off" />
          </div>

          <SubirImagen valor={imagen} onCambio={setImagen} etiqueta="Imagen" />

          <div>
            <span className="label">Tipo de promoción</span>
            <div className="space-y-4">
              {TIPOS.map((g) => (
                <div key={g.grupo}>
                  <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-carbon-500">{g.grupo}</p>
                  <div className="grid gap-2">
                    {g.items.map((t) => (
                      <label
                        key={t.id}
                        className={`cursor-pointer rounded-xl border px-4 py-2.5 ${
                          tipo === t.id ? 'border-marca bg-marca/5' : 'border-carbon/15 bg-white'
                        }`}
                      >
                        <span className="flex items-center gap-3 text-sm font-medium">
                          <input type="radio" checked={tipo === t.id} onChange={() => setTipo(t.id)} className="accent-marca" />
                          {t.label}
                        </span>
                        <span className="mt-0.5 block pl-7 text-xs text-carbon-500">{t.ayuda}</span>
                      </label>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {pideValor && (
            <div>
              <label className="label" htmlFor="value">
                {esPorcentaje ? 'Porcentaje de descuento' : tipo === 'PRODUCTO_PRECIO' ? 'Precio promocional' : 'Monto a descontar'}
              </label>
              <input
                id="value"
                name="value"
                className="input"
                inputMode="decimal"
                defaultValue={promo ? (esPorcentaje ? promo.value : fromCents(promo.value)) : ''}
                placeholder={esPorcentaje ? '20' : '15000'}
              />
            </div>
          )}

          {auto && (
            <>
              <div>
                <span className="label">¿Qué días corre?</span>
                <div className="flex flex-wrap gap-2">
                  {DIAS_CORTOS.map((d, i) => (
                    <button
                      type="button"
                      key={d}
                      onClick={() => setDias((p) => (p.includes(i) ? p.filter((x) => x !== i) : [...p, i]))}
                      className={`rounded-xl border px-3.5 py-2 text-sm font-medium ${
                        dias.includes(i) ? 'border-marca bg-marca text-crema' : 'border-carbon/15 bg-white'
                      }`}
                    >
                      {d}
                    </button>
                  ))}
                </div>
                <p className="mt-1.5 text-xs text-carbon-500">
                  {dias.length === 0 ? 'Sin días marcados corre todos los días.' : etiquetaDias(dias)}
                </p>
              </div>

              <div>
                <span className="label">
                  ¿Qué productos?
                  {elegidos.length > 0 && <span className="ml-2 font-normal text-carbon-500">{elegidos.length} elegidos</span>}
                </span>
                <input
                  className="input mb-2"
                  placeholder="Buscar producto"
                  value={busqueda}
                  onChange={(e) => setBusqueda(e.target.value)}
                />
                <div className="scroll-fino max-h-56 overflow-y-auto rounded-xl border border-carbon/15 bg-white">
                  {visibles.map((p) => {
                    const marcado = elegidos.includes(p.id);
                    const bloqueado = tipo === 'PRODUCTO_PRECIO' && p.tieneVariantes;
                    return (
                      <label
                        key={p.id}
                        className={`flex cursor-pointer items-center gap-3 border-b border-carbon/10 px-3 py-2 text-sm last:border-0 ${
                          marcado ? 'bg-marca/5' : ''
                        } ${bloqueado ? 'opacity-45' : ''}`}
                      >
                        <input
                          type="checkbox"
                          checked={marcado}
                          disabled={bloqueado}
                          onChange={() =>
                            setElegidos((prev) => (marcado ? prev.filter((x) => x !== p.id) : [...prev, p.id]))
                          }
                          className="h-4 w-4 accent-marca"
                        />
                        <span className="min-w-0 flex-1 truncate">{p.name}</span>
                        <span className="text-xs text-carbon-500">
                          {bloqueado ? 'tiene tamaños' : p.categoria}
                        </span>
                      </label>
                    );
                  })}
                </div>
              </div>

              {conflictivos.length > 0 && (
                <p className="rounded-xl bg-rojo/10 px-4 py-3 text-sm">
                  {conflictivos.map((p) => p.name).join(', ')} {conflictivos.length === 1 ? 'tiene' : 'tienen'} tamaños.
                  Un precio fijo no dice a cuál aplicarlo. Sacalos de la lista o usá descuento por porcentaje.
                </p>
              )}
            </>
          )}

          {pideCodigo && (
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className="label" htmlFor="code">Código</label>
                <input id="code" name="code" defaultValue={promo?.code ?? ''} className="input uppercase" placeholder="MARTES20" />
              </div>
              <div>
                <label className="label" htmlFor="minOrder">Compra mínima</label>
                <input id="minOrder" name="minOrder" className="input" inputMode="decimal" defaultValue={promo ? fromCents(promo.minOrder) : ''} placeholder="0" />
              </div>
            </div>
          )}

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="label" htmlFor="startsAt">Desde</label>
              <input id="startsAt" name="startsAt" type="date" defaultValue={promo?.startsAt ? claveDia(new Date(promo.startsAt)) : ''} className="input" />
            </div>
            <div>
              <label className="label" htmlFor="endsAt">Hasta</label>
              <input id="endsAt" name="endsAt" type="date" defaultValue={promo?.endsAt ? claveDia(new Date(promo.endsAt)) : ''} className="input" />
            </div>
          </div>

          <div className="space-y-2">
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="active" defaultChecked={promo?.active ?? true} className="h-4 w-4 accent-marca" />
              Activa
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="showPopup" defaultChecked={promo?.showPopup ?? false} className="h-4 w-4 accent-marca" />
              Mostrar como pop-up al entrar a la carta
            </label>
          </div>

          {error && <p className="rounded-xl bg-ladrillo/10 px-4 py-3 text-sm text-ladrillo">{error}</p>}

          <div className="flex gap-3 pt-2">
            <button disabled={guardando} className="btn-primario flex-1 py-3">
              {guardando ? 'Guardando...' : 'Guardar'}
            </button>
            <button type="button" onClick={onCerrar} className="btn-fantasma px-5">Cancelar</button>
          </div>
        </form>
      </div>
    </div>
  );
}
