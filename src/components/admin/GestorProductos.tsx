'use client';

import { useState } from 'react';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { money, fromCents } from '@/lib/money';
import { guardarProducto, borrarProducto, alternarProducto, copiarCarta } from '@/actions/catalog';
import SubirImagen from './SubirImagen';

type Variante = { id?: string; name: string; price: string; stock?: number };
// El id viaja para que el servidor actualice en el lugar en vez de recrear
type OpcionEdit = { id?: string; name: string; price: string };
type GrupoEdit = { id?: string; name: string; minPick: number; maxPick: number; esMitad?: boolean | null; options: OpcionEdit[] };

type Producto = {
  id: string; name: string; description: string | null; imageUrl: string | null;
  categoryId: string; price: number; active: boolean; featured: boolean;
  trackStock: boolean; stock: number; lowStock: number; prepMinutes: number;
  variants: { id: string; name: string; price: number; stock: number }[];
  addons: { id: string; name: string; minPick: number; maxPick: number; esMitad?: boolean | null; options: { id: string; name: string; price: number }[] }[];
};
type Categoria = { id: string; name: string };

export default function GestorProductos({
  productos, categorias, sucursalNombre, otrasSucursales, puedeEditar,
}: {
  productos: Producto[]; categorias: Categoria[];
  sucursalNombre: string;
  otrasSucursales: { id: string; name: string }[];
  puedeEditar: boolean;
}) {
  const router = useRouter();
  const [editando, setEditando] = useState<Producto | 'nuevo' | null>(null);
  const [copiando, setCopiando] = useState(false);
  const [aviso, setAviso] = useState('');
  const [filtro, setFiltro] = useState('');
  const [categoria, setCategoria] = useState('');

  const visibles = productos.filter(
    (p) =>
      (!filtro || p.name.toLowerCase().includes(filtro.toLowerCase())) &&
      (!categoria || p.categoryId === categoria)
  );

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-extrabold">Productos</h1>
          <p className="mt-1 text-sm text-carbon-500">{productos.length} cargados en la carta</p>
        </div>
        <button onClick={() => setEditando('nuevo')} className="btn-acento">Agregar producto</button>
      </div>

      {puedeEditar && productos.length === 0 && otrasSucursales.length > 0 && (
        <div className="panel mb-5 p-5">
          <h2 className="font-display text-lg">Esta sucursal no tiene carta todavía</h2>
          <p className="mt-1 text-sm text-carbon-500">
            Podés copiar la de otro local y después ajustar precios y diferencias. Se copian
            categorías, productos, tamaños y adicionales. El stock no, porque es propio de cada local.
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            {otrasSucursales.map((o) => (
              <button
                key={o.id}
                disabled={copiando}
                onClick={async () => {
                  if (!confirm(`¿Copiar la carta de ${o.name} a ${sucursalNombre}?`)) return;
                  setCopiando(true);
                  const res = await copiarCarta(o.id);
                  setCopiando(false);
                  if (res.ok) { setAviso(`Copiamos ${res.copiados} productos.`); router.refresh(); }
                  else setAviso(res.error);
                }}
                className="btn-fantasma text-sm"
              >
                {copiando ? 'Copiando...' : `Copiar carta de ${o.name}`}
              </button>
            ))}
          </div>
          {aviso && <p className="mt-3 text-sm text-verde">{aviso}</p>}
        </div>
      )}

      <div className="mb-4 flex flex-wrap gap-2">
        <input className="input sm:max-w-xs" placeholder="Buscar" value={filtro} onChange={(e) => setFiltro(e.target.value)} />
        <select className="input sm:max-w-xs" value={categoria} onChange={(e) => setCategoria(e.target.value)}>
          <option value="">Todas las categorías</option>
          {categorias.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </div>

      <div className="panel divide-y divide-carbon/10">
        {visibles.length === 0 && (
          <p className="p-8 text-center text-sm text-carbon-500">
            No hay productos que coincidan. Cambiá el filtro o agregá uno nuevo.
          </p>
        )}

        {visibles.map((p) => {
          const desde = p.variants.length ? Math.min(...p.variants.map((v) => v.price)) : p.price;
          const stockTotal = p.variants.length ? p.variants.reduce((s, v) => s + v.stock, 0) : p.stock;
          const bajo = p.trackStock && stockTotal <= p.lowStock;

          return (
            <div key={p.id} className="flex items-center gap-4 p-4">
              <div className="relative h-14 w-14 shrink-0 overflow-hidden rounded-lg bg-carbon/5">
                {p.imageUrl && <Image src={p.imageUrl} alt="" fill className="object-cover" sizes="56px" />}
              </div>

              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">{p.name}</p>
                <p className="text-sm text-carbon-500">
                  {categorias.find((c) => c.id === p.categoryId)?.name}
                  {p.variants.length > 0 && ` · ${p.variants.length} tamaños`}
                  {p.trackStock && (
                    <span className={bajo ? 'text-ladrillo' : ''}> · {stockTotal} en stock</span>
                  )}
                </p>
              </div>

              <span className="hidden text-sm font-semibold sm:block">{money(desde)}</span>

              <button
                onClick={async () => { await alternarProducto(p.id, !p.active); router.refresh(); }}
                className={`rounded-full px-3 py-1 text-xs font-semibold ${
                  p.active ? 'bg-verde/10 text-verde' : 'bg-carbon/10 text-carbon-500'
                }`}
              >
                {p.active ? 'En la carta' : 'Oculto'}
              </button>

              <button onClick={() => setEditando(p)} className="btn-fantasma px-3 py-1.5 text-sm">
                {puedeEditar ? 'Editar' : 'Ver'}
              </button>
            </div>
          );
        })}
      </div>

      {editando && (
        <EditorProducto
          producto={editando === 'nuevo' ? null : editando}
          categorias={categorias}
          onCerrar={() => setEditando(null)}
          onGuardado={() => { setEditando(null); router.refresh(); }}
        />
      )}
    </div>
  );
}

function EditorProducto({
  producto, categorias, onCerrar, onGuardado,
}: {
  producto: Producto | null;
  categorias: Categoria[];
  onCerrar: () => void;
  onGuardado: () => void;
}) {
  const [imagen, setImagen] = useState(producto?.imageUrl ?? '');
  const [conStock, setConStock] = useState(producto?.trackStock ?? false);
  const [variantes, setVariantes] = useState<Variante[]>(
    producto?.variants.map((v) => ({ id: v.id, name: v.name, price: fromCents(v.price), stock: v.stock })) ?? []
  );
  const [grupos, setGrupos] = useState<GrupoEdit[]>(
    producto?.addons.map((g) => ({
      id: g.id, name: g.name, minPick: g.minPick, maxPick: g.maxPick, esMitad: g.esMitad ?? null,
      options: g.options.map((o) => ({ id: o.id, name: o.name, price: fromCents(o.price) })),
    })) ?? []
  );
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState('');

  async function enviar(fd: FormData) {
    setError('');
    setGuardando(true);
    fd.set('imageUrl', imagen);
    fd.set('variants', JSON.stringify(variantes.filter((v) => v.name.trim())));
    fd.set('addons', JSON.stringify(grupos.filter((g) => g.name.trim() && g.options.length > 0)));
    try {
      const res = await guardarProducto(fd);
      if (!res.ok) { setError(res.error); return; }
      onGuardado();
    } catch {
      setError('No se pudo guardar. Revisá la conexión o tus permisos.');
    } finally {
      setGuardando(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-carbon/50 p-4" onClick={onCerrar}>
      <div
        className="scroll-fino max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-2xl bg-crema"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 flex items-center justify-between border-b border-carbon/10 bg-crema px-6 py-4">
          <h2 className="font-display text-xl font-bold">
            {producto ? producto.name : 'Producto nuevo'}
          </h2>
          <button onClick={onCerrar} className="text-carbon-500" aria-label="Cerrar">✕</button>
        </div>

        <form action={enviar} className="space-y-5 p-6">
          {producto && <input type="hidden" name="id" value={producto.id} />}

          <SubirImagen valor={imagen} onCambio={setImagen} />

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="label" htmlFor="name">Nombre</label>
              <input id="name" name="name" required defaultValue={producto?.name} className="input" />
            </div>
            <div>
              <label className="label" htmlFor="categoryId">Categoría</label>
              <select id="categoryId" name="categoryId" required defaultValue={producto?.categoryId} className="input">
                <option value="">Elegir</option>
                {categorias.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
          </div>

          <div>
            <label className="label" htmlFor="description">Descripción</label>
            <textarea
              id="description"
              name="description"
              rows={2}
              defaultValue={producto?.description ?? ''}
              className="input resize-none"
              placeholder="Los ingredientes, tal como los lee el cliente en la carta"
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            <div>
              <label className="label" htmlFor="price">Precio</label>
              <input
                id="price"
                name="price"
                defaultValue={producto ? fromCents(producto.price) : ''}
                className="input"
                inputMode="decimal"
                placeholder="0"
              />
              <p className="mt-1 text-xs text-carbon-500">Se ignora si cargás tamaños.</p>
            </div>
            <div>
              <label className="label" htmlFor="prepMinutes">Minutos de preparación</label>
              <input id="prepMinutes" name="prepMinutes" type="number" min={1} defaultValue={producto?.prepMinutes ?? 15} className="input" />
            </div>
            <div>
              <label className="label" htmlFor="position">Orden en la carta</label>
              <input id="position" name="position" type="number" defaultValue={0} className="input" />
            </div>
          </div>

          {/* Tamaños */}
          <fieldset className="rounded-xl border border-carbon/15 bg-white p-4">
            <legend className="px-2 text-sm font-semibold">Tamaños</legend>
            <p className="mb-3 text-xs text-carbon-500">
              Chica, grande, al metro. Si cargás tamaños, el cliente elige uno y se usa ese precio.
            </p>
            <div className="space-y-2">
              {variantes.map((v, i) => (
                <div key={i} className="flex gap-2">
                  <input
                    className="input flex-1"
                    placeholder="Chica"
                    value={v.name}
                    onChange={(e) => setVariantes((p) => p.map((x, j) => j === i ? { ...x, name: e.target.value } : x))}
                  />
                  <input
                    className="input w-28"
                    inputMode="decimal"
                    placeholder="0"
                    value={v.price}
                    onChange={(e) => setVariantes((p) => p.map((x, j) => j === i ? { ...x, price: e.target.value } : x))}
                  />
                  <button
                    type="button"
                    onClick={() => setVariantes((p) => p.filter((_, j) => j !== i))}
                    className="btn-fantasma px-3"
                    aria-label="Quitar tamaño"
                  >✕</button>
                </div>
              ))}
            </div>
            <button
              type="button"
              onClick={() => setVariantes((p) => [...p, { name: '', price: '' }])}
              className="btn-fantasma mt-3 text-sm"
            >
              Agregar tamaño
            </button>
          </fieldset>

          {/* Adicionales */}
          <fieldset className="rounded-xl border border-carbon/15 bg-white p-4">
            <legend className="px-2 text-sm font-semibold">Adicionales</legend>
            <p className="mb-3 text-xs text-carbon-500">
              Grupos de opciones: extras con recargo, elección de bebida, punto de cocción.
            </p>

            <div className="space-y-4">
              {grupos.map((g, gi) => (
                <div key={gi} className="rounded-lg border border-carbon/10 p-3">
                  <div className="flex gap-2">
                    <input
                      className="input flex-1"
                      placeholder="Extras"
                      value={g.name}
                      onChange={(e) => setGrupos((p) => p.map((x, j) => j === gi ? { ...x, name: e.target.value } : x))}
                    />
                    <input
                      className="input w-20"
                      type="number"
                      min={0}
                      title="Mínimo a elegir"
                      value={g.minPick}
                      onChange={(e) => setGrupos((p) => p.map((x, j) => j === gi ? { ...x, minPick: Number(e.target.value) } : x))}
                    />
                    <input
                      className="input w-20"
                      type="number"
                      min={1}
                      title="Máximo a elegir"
                      value={g.maxPick}
                      onChange={(e) => setGrupos((p) => p.map((x, j) => j === gi ? { ...x, maxPick: Number(e.target.value) } : x))}
                    />
                    <button
                      type="button"
                      onClick={() => setGrupos((p) => p.filter((_, j) => j !== gi))}
                      className="btn-fantasma px-3"
                      aria-label="Quitar grupo"
                    >✕</button>
                  </div>

                  <label className="mt-2 flex items-center gap-2 pl-4 text-xs text-carbon-500">
                    <input
                      type="checkbox"
                      className="h-3.5 w-3.5 accent-marca"
                      checked={g.esMitad ?? /mitad/i.test(g.name)}
                      onChange={(e) => setGrupos((p) => p.map((x, j) => j === gi ? { ...x, esMitad: e.target.checked } : x))}
                    />
                    Son gustos de pizza (mitad y mitad): cada opción vale lo que la pizza de ese nombre
                  </label>
                  <div className="mt-2 space-y-1.5 pl-4">
                    {g.options.map((o, oi) => (
                      <div key={oi} className="flex gap-2">
                        <input
                          className="input flex-1 py-1.5 text-sm"
                          placeholder="Doble queso"
                          value={o.name}
                          onChange={(e) =>
                            setGrupos((p) => p.map((x, j) => j === gi
                              ? { ...x, options: x.options.map((y, k) => k === oi ? { ...y, name: e.target.value } : y) }
                              : x))
                          }
                        />
                        <input
                          className="input w-24 py-1.5 text-sm"
                          inputMode="decimal"
                          placeholder="0"
                          value={o.price}
                          onChange={(e) =>
                            setGrupos((p) => p.map((x, j) => j === gi
                              ? { ...x, options: x.options.map((y, k) => k === oi ? { ...y, price: e.target.value } : y) }
                              : x))
                          }
                        />
                        <button
                          type="button"
                          onClick={() => setGrupos((p) => p.map((x, j) => j === gi ? { ...x, options: x.options.filter((_, k) => k !== oi) } : x))}
                          className="px-2 text-carbon-500"
                          aria-label="Quitar opción"
                        >✕</button>
                      </div>
                    ))}
                    <button
                      type="button"
                      onClick={() => setGrupos((p) => p.map((x, j) => j === gi ? { ...x, options: [...x.options, { name: '', price: '' }] } : x))}
                      className="text-sm text-marca underline"
                    >
                      Agregar opción
                    </button>
                  </div>
                </div>
              ))}
            </div>

            <button
              type="button"
              onClick={() => setGrupos((p) => [...p, { name: '', minPick: 0, maxPick: 3, options: [] }])}
              className="btn-fantasma mt-3 text-sm"
            >
              Agregar grupo
            </button>
          </fieldset>

          {/* Stock */}
          <fieldset className="rounded-xl border border-carbon/15 bg-white p-4">
            <legend className="px-2 text-sm font-semibold">Stock</legend>
            <label className="flex items-center gap-3 text-sm">
              <input
                type="checkbox"
                name="trackStock"
                checked={conStock}
                onChange={(e) => setConStock(e.target.checked)}
                className="h-4 w-4 accent-marca"
              />
              Descontar stock cuando se vende
            </label>
            <p className="mt-1.5 text-xs text-carbon-500">
              Conviene activarlo en bebidas y postres. En pizzas suele no usarse porque se hacen al momento.
            </p>

            {conStock && (
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                {!producto && (
                  <div>
                    <label className="label" htmlFor="stock">Stock inicial</label>
                    <input id="stock" name="stock" type="number" min={0} defaultValue={0} className="input" />
                  </div>
                )}
                <div>
                  <label className="label" htmlFor="lowStock">Avisar cuando queden</label>
                  <input id="lowStock" name="lowStock" type="number" min={0} defaultValue={producto?.lowStock ?? 5} className="input" />
                </div>
              </div>
            )}
          </fieldset>

          <div className="flex flex-wrap gap-5">
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="active" defaultChecked={producto?.active ?? true} className="h-4 w-4 accent-marca" />
              Visible en la carta
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="featured" defaultChecked={producto?.featured ?? false} className="h-4 w-4 accent-marca" />
              Destacado
            </label>
          </div>

          {error && <p className="rounded-xl bg-ladrillo/10 px-4 py-3 text-sm text-ladrillo">{error}</p>}

          <div className="flex gap-3 border-t border-carbon/10 pt-4">
            <button disabled={guardando} className="btn-primario flex-1 py-3">
              {guardando ? 'Guardando...' : 'Guardar producto'}
            </button>
            {producto && (
              <button
                type="button"
                onClick={async () => {
                  if (!confirm(`¿Sacar "${producto.name}" de la carta?`)) return;
                  await borrarProducto(producto.id);
                  onGuardado();
                }}
                className="btn-peligro px-5"
              >
                Eliminar
              </button>
            )}
          </div>
        </form>
      </div>
    </div>
  );
}
