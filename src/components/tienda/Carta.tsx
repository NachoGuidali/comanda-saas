'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { money, toCents } from '@/lib/money';
import { crearPedido, validarCodigo, type ItemCarrito } from '@/actions/orders';
import PromoPopup from './PromoPopup';
import WidgetWhatsApp from './WidgetWhatsApp';
import { PRODUCTO } from '@/lib/producto';
import { precioBaseEnPantalla, type InfoMitad } from '@/lib/mitad';

type Opcion = { id: string; name: string; price: number };
type Grupo = { id: string; name: string; minPick: number; maxPick: number; options: Opcion[] };
type Variante = { id: string; name: string; price: number; stock: number; precioOriginal?: number | null };
type Producto = {
  id: string; name: string; description: string | null; imageUrl: string | null;
  price: number; featured: boolean; trackStock: boolean; stock: number;
  variants: Variante[]; addons: Grupo[];
  precioOriginal?: number | null; promoTitulo?: string | null;
  /** Solo en la mitad y mitad, si el local no la cobra a precio fijo */
  mitad?: InfoMitad | null;
};

/** El "desde" de la mitad y mitad que se cobra según los gustos: el gusto más barato. */
function desdeMitad(p: Producto): number | null {
  if (!p.mitad) return null;
  const precios = Object.values(p.mitad.gustos).flatMap((t) => Object.values(t));
  if (!precios.length) return null;
  const min = Math.min(...precios);
  return p.mitad.descuentoPct ? Math.round(min * (1 - p.mitad.descuentoPct / 100)) : min;
}
type Categoria = { id: string; name: string; slug: string; products: Producto[] };
type Promo = {
  id: string; title: string; description: string | null; imageUrl: string | null;
  type: string; value: number; code: string | null; showPopup: boolean;
};
type Zona = { id: string; name: string; fee: number };

type LineaCarrito = {
  key: string;
  productId: string;
  variantId: string | null;
  nombre: string;
  variante: string | null;
  imagen: string | null;
  precioUnitario: number;
  cantidad: number;
  adicionales: Opcion[];
  nota: string;
};

export type Sucursal = {
  id: string; slug: string; name: string; eslogan: string; address: string;
  phone: string; whatsapp: string; instagram: string;
  tiempoDelivery: string; tiempoTakeaway: string; mensajeCerrado: string;
  aliasBancario: string; aceptaPedidos: boolean;
};

type Props = {
  branch: Sucursal;
  otrasSucursales: { slug: string; name: string }[];
  categorias: Categoria[];
  promos: Promo[];
  zonas: Zona[];
  abierto: boolean;
  /** Mercado Pago online habilitado (real o simulado) */
  pagoOnline: boolean;
  /** Si el plan del local incluye reservas online */
  reservas?: boolean;
};

const TIPOS = [
  { id: 'DELIVERY', label: 'Envío' },
  { id: 'TAKEAWAY', label: 'Retiro' },
] as const;

export default function Carta({ branch, otrasSucursales, categorias, promos, zonas, abierto, pagoOnline, reservas = true }: Props) {
  const [carrito, setCarrito] = useState<LineaCarrito[]>([]);
  const [activa, setActiva] = useState(categorias[0]?.slug ?? '');
  const [detalle, setDetalle] = useState<Producto | null>(null);
  const [checkout, setCheckout] = useState(false);
  const [busqueda, setBusqueda] = useState('');
  const secciones = useRef<Record<string, HTMLElement | null>>({});

  const subtotal = carrito.reduce((s, l) => s + l.precioUnitario * l.cantidad, 0);
  const unidades = carrito.reduce((s, l) => s + l.cantidad, 0);

  // El carrito sobrevive a una recarga o a salir a WhatsApp y volver. Al
  // recuperarlo se revalida contra la carta de hoy: lo que ya no existe o
  // cambió de precio se descarta o se actualiza, para no mostrar un total falso.
  const claveCarrito = `carrito:${branch.id}`;
  const recuperado = useRef(false);
  useEffect(() => {
    try {
      const guardado = JSON.parse(localStorage.getItem(claveCarrito) || '[]') as LineaCarrito[];
      const productos = new Map(categorias.flatMap((c) => c.products).map((p) => [p.id, p]));
      const validas = guardado.flatMap((l) => {
        const p = productos.get(l.productId);
        if (!p || (p.trackStock && p.variants.length === 0 && p.stock <= 0)) return [];
        const v = l.variantId ? p.variants.find((x) => x.id === l.variantId) : null;
        if (l.variantId ? !v : p.variants.length > 0) return [];
        const opciones = p.addons.flatMap((g) => g.options);
        const adicionales = l.adicionales.map((a) => opciones.find((o) => o.id === a.id));
        if (adicionales.some((a) => !a)) return [];
        const base = precioBaseEnPantalla(p.mitad, v ? v.price : p.price, v?.id ?? null, l.adicionales.map((a) => a.id));
        const precioUnitario = base + adicionales.reduce((s, a) => s + (a?.price ?? 0), 0);
        return [{ ...l, precioUnitario, adicionales: adicionales as Opcion[] }];
      });
      if (validas.length) setCarrito(validas);
    } catch { /* sin almacenamiento disponible: el carrito arranca vacío */ }
    recuperado.current = true;
  }, [claveCarrito, categorias]);

  useEffect(() => {
    if (!recuperado.current) return;
    try {
      if (carrito.length) localStorage.setItem(claveCarrito, JSON.stringify(carrito));
      else localStorage.removeItem(claveCarrito);
    } catch { /* modo privado o sin espacio: no pasa nada */ }
  }, [carrito, claveCarrito]);

  // Resalta la categoría que se está mirando mientras se hace scroll
  useEffect(() => {
    const obs = new IntersectionObserver(
      (entradas) => {
        const visible = entradas
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
        if (visible) setActiva(visible.target.id);
      },
      { rootMargin: '-140px 0px -65% 0px' }
    );
    Object.values(secciones.current).forEach((el) => el && obs.observe(el));
    return () => obs.disconnect();
  }, [categorias]);

  function agregar(linea: Omit<LineaCarrito, 'key'>) {
    const key = [linea.productId, linea.variantId, ...linea.adicionales.map((a) => a.id).sort(), linea.nota]
      .join('|');
    setCarrito((prev) => {
      const i = prev.findIndex((l) => l.key === key);
      if (i >= 0) {
        const copia = [...prev];
        copia[i] = { ...copia[i], cantidad: copia[i].cantidad + linea.cantidad };
        return copia;
      }
      return [...prev, { ...linea, key }];
    });
    setDetalle(null);
  }

  function cambiarCantidad(key: string, delta: number) {
    setCarrito((prev) =>
      prev
        .map((l) => (l.key === key ? { ...l, cantidad: l.cantidad + delta } : l))
        .filter((l) => l.cantidad > 0)
    );
  }

  const filtradas = useMemo(() => {
    if (!busqueda.trim()) return categorias;
    const q = busqueda.toLowerCase();
    return categorias
      .map((c) => ({ ...c, products: c.products.filter((p) => p.name.toLowerCase().includes(q) || (p.description ?? '').toLowerCase().includes(q)) }))
      .filter((c) => c.products.length > 0);
  }, [categorias, busqueda]);

  const banners = promos.filter((p) => !p.showPopup);
  const popup = promos.find((p) => p.showPopup);

  return (
    <div className="min-h-screen pb-32 lg:pb-0">
      {popup && <PromoPopup promo={popup} />}

      {/* Portada */}
      <header className="relative overflow-hidden bg-marca text-crema">
        <div
          className="absolute inset-0 opacity-[0.07]"
          style={{
            backgroundImage:
              'radial-gradient(circle at 1px 1px, rgb(var(--c-crema)) 1px, transparent 0)',
            backgroundSize: '22px 22px',
          }}
          aria-hidden
        />
        <div className="relative mx-auto max-w-6xl px-5 pb-10 pt-12 sm:pt-16">
          {branch.eslogan && <p className="w-fit rounded-md bg-rojo px-2.5 py-1 text-sm font-semibold text-sobre-rojo">{branch.eslogan}</p>}
          <h1 className="mt-2 text-5xl font-extrabold leading-[0.95] sm:text-7xl">{branch.name}</h1>

          <div className="mt-6 flex flex-wrap items-center gap-x-5 gap-y-2 text-sm text-crema/80">
            <span className="inline-flex items-center gap-2">
              <span className={`h-2 w-2 rounded-full ${abierto ? 'bg-rojo' : 'bg-crema/40'}`} />
              {abierto ? 'Abierto ahora' : 'Cerrado'}
            </span>
            <span>Envío en {branch.tiempoDelivery} min</span>
            <span>Retiro en {branch.tiempoTakeaway} min</span>
            <span>{branch.address}</span>
          </div>

          {!abierto && (
            <p className="mt-5 max-w-xl rounded-xl bg-crema/10 px-4 py-3 text-sm">
              {branch.mensajeCerrado}
            </p>
          )}

          <div className="mt-7 flex flex-wrap gap-3">
            {reservas && (
              <Link href={`/${branch.slug}/reservas`} className="btn bg-crema/12 text-crema ring-1 ring-crema/25 hover:bg-crema/20">
                Reservar mesa o evento
              </Link>
            )}
            <a
              href={`https://wa.me/${branch.whatsapp}`}
              target="_blank"
              rel="noreferrer"
              className="btn text-crema/80 hover:text-crema"
            >
              Escribirnos por WhatsApp
            </a>
          </div>
        </div>
      </header>

      {banners.length > 0 && (
        <div className="mx-auto max-w-6xl px-5 pt-6">
          <div className="scroll-fino flex gap-3 overflow-x-auto pb-2">
            {banners.map((p) => (
              <div
                key={p.id}
                className="min-w-[280px] flex-1 rounded-2xl border border-rojo/40 bg-rojo/10 px-5 py-4"
              >
                <p className="font-display text-lg font-bold">{p.title}</p>
                {p.description && <p className="mt-1 text-sm text-carbon-500">{p.description}</p>}
                {p.code && (
                  <p className="mt-2 text-sm">
                    Código <span className="rounded bg-carbon px-2 py-0.5 font-mono text-crema">{p.code}</span>
                  </p>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Navegación de categorías */}
      <nav className="sticky top-0 z-30 border-b border-carbon/10 bg-crema/95 backdrop-blur">
        <div className="mx-auto max-w-6xl px-5 py-3">
          <input
            className="input mb-3 sm:max-w-xs"
            placeholder="Buscar en la carta"
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
          />
          <div className="scroll-fino flex gap-2 overflow-x-auto">
            {filtradas.map((c) => (
              <button
                key={c.id}
                onClick={() => secciones.current[c.slug]?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
                className={`chip ${activa === c.slug ? 'chip-activo' : ''}`}
              >
                {c.name}
              </button>
            ))}
          </div>
        </div>
      </nav>

      <div className="mx-auto grid max-w-6xl gap-10 px-5 py-8 lg:grid-cols-[1fr_340px]">
        <main>
          {filtradas.length === 0 && (
            <p className="py-16 text-center text-carbon-500">
              {categorias.length === 0
                ? 'Estamos armando la carta. Volvé pronto.'
                : 'No encontramos nada con esa búsqueda. Probá con otra palabra.'}
            </p>
          )}

          {filtradas.map((cat) => (
            <section
              key={cat.id}
              id={cat.slug}
              ref={(el) => { secciones.current[cat.slug] = el; }}
              className="scroll-mt-40 pb-10"
            >
              <h2 className="mb-4 text-2xl font-bold">{cat.name}</h2>
              <div className="space-y-3">
                {cat.products.map((p) => {
                  const desde = desdeMitad(p) ?? (p.variants.length ? Math.min(...p.variants.map((v) => v.price)) : p.price);
                  const desdeOriginal = p.variants.length
                    ? p.mitad ? null : (p.variants[0].precioOriginal ?? null) && Math.min(...p.variants.map((v) => v.precioOriginal ?? v.price))
                    : p.precioOriginal ?? null;
                  const agotado = p.trackStock && (p.variants.length
                    ? p.variants.every((v) => v.stock <= 0)
                    : p.stock <= 0);

                  return (
                    <button
                      key={p.id}
                      onClick={() => !agotado && setDetalle(p)}
                      disabled={agotado}
                      className="panel flex w-full items-stretch gap-4 p-4 text-left transition-shadow hover:shadow-lg disabled:opacity-55"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="font-display text-lg font-bold leading-tight">{p.name}</p>
                        {p.description && (
                          <p className="mt-1 line-clamp-2 text-sm text-carbon-500">{p.description}</p>
                        )}
                        <p className="mt-2 font-semibold">
                          {p.variants.length > 0 && <span className="text-carbon-500">desde </span>}
                          {money(desde)}
                          {desdeOriginal !== null && desdeOriginal > desde && (
                            <span className="ml-2 font-normal text-carbon-500 line-through">
                              {money(desdeOriginal)}
                            </span>
                          )}
                        </p>
                        {p.promoTitulo && (
                          <span className="mt-1.5 inline-block rounded-md bg-rojo px-2 py-0.5 text-xs font-bold text-sobre-rojo">
                            {p.promoTitulo}
                          </span>
                        )}
                        {agotado && <p className="mt-1 text-sm text-ladrillo">Se nos terminó por hoy</p>}
                      </div>
                      {p.imageUrl && (
                        <div className="relative h-24 w-24 shrink-0 overflow-hidden rounded-xl bg-carbon/5 sm:h-28 sm:w-28">
                          <Image src={p.imageUrl} alt="" fill className="object-cover" sizes="112px" />
                        </div>
                      )}
                    </button>
                  );
                })}
              </div>
            </section>
          ))}
        </main>

        {/* Carrito de escritorio */}
        <aside className="hidden lg:block">
          <div className="sticky top-32">
            <ResumenCarrito
              carrito={carrito}
              subtotal={subtotal}
              onCambiar={cambiarCantidad}
              onPedir={() => setCheckout(true)}
              abierto={abierto}
            />
          </div>
        </aside>
      </div>

      {/* Barra de carrito en celular */}
      {unidades > 0 && (
        <div className="fixed inset-x-0 bottom-0 z-40 border-t border-carbon/10 bg-crema/95 p-4 backdrop-blur lg:hidden">
          <button onClick={() => setCheckout(true)} className="btn-primario w-full py-3.5 text-base">
            <span>Ver el pedido ({unidades})</span>
            <span className="ml-auto">{money(subtotal)}</span>
          </button>
        </div>
      )}

      <WidgetWhatsApp numero={branch.whatsapp} local={branch.name} hayCarrito={unidades > 0} />

      {detalle && <DetalleProducto producto={detalle} onCerrar={() => setDetalle(null)} onAgregar={agregar} />}

      {checkout && (
        <Checkout
          carrito={carrito}
          subtotal={subtotal}
          zonas={zonas}
          branch={branch}
          pagoOnline={pagoOnline}
          onCerrar={() => setCheckout(false)}
          onCambiar={cambiarCantidad}
          onVaciar={() => setCarrito([])}
        />
      )}

      <footer className="border-t border-carbon/10 bg-white py-10">
        <div className="mx-auto max-w-6xl px-5 text-sm text-carbon-500">
          <p className="font-display text-lg font-bold text-carbon">{branch.name}</p>
          <p className="mt-1">{branch.address} · {branch.phone}</p>
          <div className="mt-4 flex gap-4">
            {reservas && <Link href={`/${branch.slug}/reservas`} className="underline">Reservas y eventos</Link>}
            <a href={`https://instagram.com/${branch.instagram}`} target="_blank" rel="noreferrer" className="underline">
              Instagram
            </a>
            <Link href="/admin" className="underline">Acceso del personal</Link>
          </div>
          <p className="mt-6 text-xs text-carbon-500/70">Pedidos online con {PRODUCTO.nombre}</p>
          {otrasSucursales.length > 0 && (
            <p className="mt-4">
              También estamos en{' '}
              {otrasSucursales.map((o, i) => (
                <span key={o.slug}>
                  {i > 0 && ' · '}
                  <Link href={`/${o.slug}`} className="font-medium underline">{o.name}</Link>
                </span>
              ))}
            </p>
          )}
          <div className="hidden">
          </div>
        </div>
      </footer>
    </div>
  );
}

// ─────────── Resumen lateral ───────────

function ResumenCarrito({
  carrito, subtotal, onCambiar, onPedir, abierto,
}: {
  carrito: LineaCarrito[]; subtotal: number;
  onCambiar: (key: string, delta: number) => void;
  onPedir: () => void; abierto: boolean;
}) {
  if (carrito.length === 0) {
    return (
      <div className="panel p-6 text-center">
        <p className="font-display text-lg font-bold">Tu pedido</p>
        <p className="mt-2 text-sm text-carbon-500">
          Tocá un producto de la carta para empezar a armarlo.
        </p>
      </div>
    );
  }

  return (
    <div className="panel p-5">
      <p className="font-display text-lg font-bold">Tu pedido</p>
      <ul className="mt-4 space-y-3">
        {carrito.map((l) => (
          <li key={l.key} className="flex gap-3 text-sm">
            <div className="min-w-0 flex-1">
              <p className="font-medium">{l.nombre}{l.variante ? ` · ${l.variante}` : ''}</p>
              {l.adicionales.length > 0 && (
                <p className="text-xs text-carbon-500">{l.adicionales.map((a) => a.name).join(', ')}</p>
              )}
              {l.nota && <p className="text-xs italic text-carbon-500">{l.nota}</p>}
              <div className="mt-1.5 inline-flex items-center gap-2 rounded-lg border border-carbon/15">
                <button onClick={() => onCambiar(l.key, -1)} className="px-2.5 py-1 text-carbon-500" aria-label="Quitar uno">−</button>
                <span className="min-w-[1.5ch] text-center font-medium">{l.cantidad}</span>
                <button onClick={() => onCambiar(l.key, 1)} className="px-2.5 py-1 text-carbon-500" aria-label="Agregar uno">+</button>
              </div>
            </div>
            <span className="font-semibold">{money(l.precioUnitario * l.cantidad)}</span>
          </li>
        ))}
      </ul>
      <div className="mt-5 flex justify-between border-t border-carbon/10 pt-4 font-semibold">
        <span>Subtotal</span>
        <span>{money(subtotal)}</span>
      </div>
      <button onClick={onPedir} className="btn-primario mt-4 w-full py-3">
        {abierto ? 'Continuar' : 'Dejar el pedido igual'}
      </button>
    </div>
  );
}

// ─────────── Detalle y personalización ───────────

function DetalleProducto({
  producto, onCerrar, onAgregar,
}: {
  producto: Producto;
  onCerrar: () => void;
  onAgregar: (l: Omit<LineaCarrito, 'key'>) => void;
}) {
  const disponibles = producto.variants.filter((v) => !producto.trackStock || v.stock > 0);
  const [variante, setVariante] = useState<Variante | null>(disponibles[0] ?? null);
  const [elegidos, setElegidos] = useState<Record<string, string[]>>({});
  const [cantidad, setCantidad] = useState(1);
  const [nota, setNota] = useState('');

  const adicionales = producto.addons.flatMap((g) =>
    (elegidos[g.id] ?? []).map((id) => g.options.find((o) => o.id === id)!).filter(Boolean)
  );

  const base = precioBaseEnPantalla(producto.mitad, variante ? variante.price : producto.price, variante?.id ?? null, adicionales.map((a) => a.id));
  const unitario = base + adicionales.reduce((s, a) => s + a.price, 0);

  const faltanObligatorios = producto.addons.some(
    (g) => g.minPick > 0 && (elegidos[g.id]?.length ?? 0) < g.minPick
  );

  function alternar(g: Grupo, id: string) {
    setElegidos((prev) => {
      const actual = prev[g.id] ?? [];
      if (actual.includes(id)) return { ...prev, [g.id]: actual.filter((x) => x !== id) };
      if (g.maxPick === 1) return { ...prev, [g.id]: [id] };
      if (actual.length >= g.maxPick) return prev;
      return { ...prev, [g.id]: [...actual, id] };
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-carbon/50 sm:items-center" onClick={onCerrar}>
      <div
        className="max-h-[92vh] w-full overflow-y-auto rounded-t-2xl bg-crema sm:max-w-lg sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {producto.imageUrl && (
          <div className="relative h-48 w-full bg-carbon/5 sm:h-56">
            <Image src={producto.imageUrl} alt="" fill className="object-cover sm:rounded-t-2xl" sizes="512px" />
          </div>
        )}

        <div className="p-5">
          <h3 className="text-2xl font-bold">{producto.name}</h3>
          {producto.description && <p className="mt-1.5 text-sm text-carbon-500">{producto.description}</p>}

          {disponibles.length > 0 && (
            <fieldset className="mt-6">
              <legend className="label">Tamaño</legend>
              <div className="grid gap-2">
                {disponibles.map((v) => (
                  <label
                    key={v.id}
                    className={`flex cursor-pointer items-center justify-between rounded-xl border px-4 py-3 text-sm ${
                      variante?.id === v.id ? 'border-marca bg-marca/5' : 'border-carbon/15 bg-white'
                    }`}
                  >
                    <span className="flex items-center gap-3">
                      <input
                        type="radio"
                        name="variante"
                        checked={variante?.id === v.id}
                        onChange={() => setVariante(v)}
                        className="accent-marca"
                      />
                      {v.name}
                    </span>
                    <span className="font-semibold">
                      {producto.mitad ? <span className="text-sm font-normal text-carbon-500">Según los gustos</span> : money(v.price)}
                      {!producto.mitad && v.precioOriginal && v.precioOriginal > v.price && (
                        <span className="ml-2 font-normal text-carbon-500 line-through">{money(v.precioOriginal)}</span>
                      )}
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>
          )}

          {producto.addons.map((g) => (
            <fieldset key={g.id} className="mt-6">
              <legend className="label">
                {g.name}
                <span className="ml-2 font-normal text-carbon-500">
                  {g.minPick > 0 ? `elegí ${g.minPick}` : `hasta ${g.maxPick}`}
                </span>
              </legend>
              <div className="grid gap-2">
                {g.options.map((o) => {
                  const marcado = (elegidos[g.id] ?? []).includes(o.id);
                  return (
                    <label
                      key={o.id}
                      className={`flex cursor-pointer items-center justify-between rounded-xl border px-4 py-2.5 text-sm ${
                        marcado ? 'border-marca bg-marca/5' : 'border-carbon/15 bg-white'
                      }`}
                    >
                      <span className="flex items-center gap-3">
                        <input
                          type={g.maxPick === 1 ? 'radio' : 'checkbox'}
                          name={g.id}
                          checked={marcado}
                          onChange={() => alternar(g, o.id)}
                          className="accent-marca"
                        />
                        {o.name}
                      </span>
                      {o.price > 0 && <span className="text-carbon-500">+{money(o.price)}</span>}
                    </label>
                  );
                })}
              </div>
            </fieldset>
          ))}

          <div className="mt-6">
            <label className="label" htmlFor="nota">Aclaraciones para la cocina</label>
            <input
              id="nota"
              className="input"
              placeholder="Sin cebolla, bien cocida..."
              value={nota}
              onChange={(e) => setNota(e.target.value)}
            />
          </div>

          <div className="mt-6 flex items-center gap-3">
            <div className="inline-flex items-center rounded-xl border border-carbon/15 bg-white">
              <button onClick={() => setCantidad((c) => Math.max(1, c - 1))} className="px-4 py-3" aria-label="Quitar uno">−</button>
              <span className="min-w-[2ch] text-center font-semibold">{cantidad}</span>
              <button onClick={() => setCantidad((c) => Math.min(20, c + 1))} className="px-4 py-3" aria-label="Agregar uno">+</button>
            </div>
            <button
              disabled={faltanObligatorios}
              onClick={() =>
                onAgregar({
                  productId: producto.id,
                  variantId: variante?.id ?? null,
                  nombre: producto.name,
                  variante: variante?.name ?? null,
                  imagen: producto.imageUrl,
                  precioUnitario: unitario,
                  cantidad,
                  adicionales,
                  nota,
                })
              }
              className="btn-primario flex-1 py-3.5 text-base"
            >
              Agregar {money(unitario * cantidad)}
            </button>
          </div>

          <button onClick={onCerrar} className="mt-3 w-full py-2 text-sm text-carbon-500 underline">
            Volver a la carta
          </button>
        </div>
      </div>
    </div>
  );
}
// ─────────── Checkout ───────────

function Checkout({
  carrito, subtotal, zonas, branch, pagoOnline, onCerrar, onCambiar, onVaciar,
}: {
  carrito: LineaCarrito[]; subtotal: number; zonas: Zona[];
  branch: Sucursal;
  pagoOnline: boolean;
  onCerrar: () => void;
  onCambiar: (key: string, delta: number) => void;
  onVaciar: () => void;
}) {
  const [tipo, setTipo] = useState<'DELIVERY' | 'TAKEAWAY'>('DELIVERY');
  const [zonaId, setZonaId] = useState(zonas[0]?.id ?? '');
  const [pago, setPago] = useState<'EFECTIVO' | 'TRANSFERENCIA' | 'TARJETA_ENTREGA' | 'MERCADO_PAGO'>('EFECTIVO');
  const [abonaCon, setAbonaCon] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState('');
  const [listo, setListo] = useState<{ code: string } | null>(null);
  const [codigo, setCodigo] = useState('');
  const [descuento, setDescuento] = useState<{ codigo: string; monto: number; titulo: string } | null>(null);
  const [errorCodigo, setErrorCodigo] = useState('');
  const [validando, setValidando] = useState(false);

  const zona = zonas.find((z) => z.id === zonaId);
  const envio = tipo === 'DELIVERY' ? zona?.fee ?? 0 : 0;
  const total = Math.max(0, subtotal + envio - (descuento?.monto ?? 0));
  // "10.000", "10000" y "10.000,50" son todos diez mil: así escribe la gente acá
  const abona = abonaCon.trim() ? toCents(abonaCon) : 0;

  async function aplicarCodigo(texto = codigo) {
    if (!texto.trim()) { setDescuento(null); setErrorCodigo(''); return; }
    setValidando(true);
    try {
      const r = await validarCodigo(branch.id, texto, subtotal, envio);
      if (r.ok) {
        setDescuento({ codigo: r.codigo, monto: r.discount, titulo: r.titulo });
        setErrorCodigo('');
      } else {
        setDescuento(null);
        setErrorCodigo(r.error);
      }
    } catch {
      setErrorCodigo('No pudimos verificar el código. Probá de nuevo.');
    } finally {
      setValidando(false);
    }
  }

  // Si cambia el carrito o el envío, el descuento se recalcula
  useEffect(() => {
    if (descuento) void aplicarCodigo(descuento.codigo);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subtotal, envio]);

  /**
   * Un solo paso: el pedido entra a la cocina y se abre WhatsApp con el mensaje.
   *
   * La ventana se abre ANTES de llamar al servidor porque el navegador solo
   * permite abrir pestañas como consecuencia directa de un clic; si se hace
   * después del await, la bloquea. Si el pedido falla, la cerramos.
   */
  async function enviar(fd: FormData) {
    setError('');

    if (codigo.trim() && !descuento) {
      setError('Tocá "Aplicar" para validar el código de descuento, o borralo.');
      return;
    }
    if (pago === 'EFECTIVO' && tipo === 'DELIVERY' && abona > 0 && abona < total) {
      setError(`Con ${money(abona)} no llega al total de ${money(total)}. Revisá el monto.`);
      return;
    }

    setEnviando(true);
    // Con Mercado Pago no se abre WhatsApp: el cliente va a pagar, y el
    // aviso al local es el pedido que entra al tablero cuando se acredita
    const conMP = pago === 'MERCADO_PAGO';
    const ventana = conMP ? null : window.open('', '_blank');

    const items: ItemCarrito[] = carrito.map((l) => ({
      productId: l.productId,
      variantId: l.variantId,
      quantity: l.cantidad,
      addonIds: l.adicionales.map((a) => a.id),
      notes: l.nota,
    }));

    const res = await crearPedido(items, {
      branchId: branch.id,
      type: tipo,
      customerName: String(fd.get('customerName') || ''),
      customerPhone: String(fd.get('customerPhone') || ''),
      address: String(fd.get('address') || ''),
      addressNotes: String(fd.get('addressNotes') || ''),
      zoneId: tipo === 'DELIVERY' ? zonaId : undefined,
      paymentMethod: pago,
      cashAmount: pago === 'EFECTIVO' && tipo === 'DELIVERY' && abona > 0 ? abona : undefined,
      promoCode: descuento?.codigo,
      notes: String(fd.get('notes') || ''),
      source: 'WEB',
    });

    if (!res.ok) {
      setEnviando(false);
      ventana?.close();
      setError(res.error);
      return;
    }

    if (res.pagoUrl) {
      onVaciar();
      window.location.href = res.pagoUrl;
      return;
    }
    setEnviando(false);

    if (ventana && !ventana.closed) ventana.location.href = res.whatsappUrl;
    onVaciar();
    setListo({ code: res.code });
  }

  if (listo) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-carbon/50 p-4">
        <div className="w-full max-w-md rounded-2xl bg-crema p-7 text-center">
          <h3 className="font-display text-2xl">Pedido {listo.code}</h3>
          <p className="mt-2 text-sm text-carbon-500">
            Ya entró a la cocina y te abrimos WhatsApp con el detalle. Guardá el código
            por si necesitás consultarlo.
          </p>

          <Link href={`/pedido/${listo.code}`} className="btn-primario mt-6 w-full py-3">
            Seguir el pedido
          </Link>

          <button onClick={onCerrar} className="mt-3 w-full py-2 text-sm text-carbon-500 underline">
            Volver a la carta
          </button>
        </div>
      </div>
    );
  }
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-carbon/50 sm:items-center" onClick={onCerrar}>
      <div
        className="max-h-[94vh] w-full overflow-y-auto rounded-t-2xl bg-crema sm:max-w-lg sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 flex items-center justify-between border-b border-carbon/10 bg-crema px-5 py-4">
          <h3 className="text-xl font-bold">Confirmar pedido</h3>
          <button onClick={onCerrar} className="text-carbon-500" aria-label="Cerrar">✕</button>
        </div>

        <div className="p-5">
          <ul className="space-y-2.5">
            {carrito.map((l) => (
              <li key={l.key} className="flex items-center gap-3 text-sm">
                <div className="inline-flex items-center rounded-lg border border-carbon/15 bg-white">
                  <button onClick={() => onCambiar(l.key, -1)} className="px-2 py-0.5" aria-label="Quitar uno">−</button>
                  <span className="min-w-[1.5ch] text-center">{l.cantidad}</span>
                  <button onClick={() => onCambiar(l.key, 1)} className="px-2 py-0.5" aria-label="Agregar uno">+</button>
                </div>
                <span className="min-w-0 flex-1">
                  {l.nombre}{l.variante ? ` · ${l.variante}` : ''}
                  {l.adicionales.length > 0 && (
                    <span className="block text-xs text-carbon-500">{l.adicionales.map((a) => a.name).join(', ')}</span>
                  )}
                </span>
                <span className="font-medium">{money(l.precioUnitario * l.cantidad)}</span>
              </li>
            ))}
          </ul>

          <form action={enviar} className="mt-6 space-y-4">
            <div className="grid grid-cols-2 gap-2">
              {TIPOS.map((t) => (
                <button
                  type="button"
                  key={t.id}
                  onClick={() => { setTipo(t.id); if (t.id !== 'DELIVERY') setAbonaCon(''); }}
                  className={`rounded-xl border px-4 py-3 text-sm font-medium ${
                    tipo === t.id ? 'border-marca bg-marca text-crema' : 'border-carbon/15 bg-white'
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className="label" htmlFor="customerName">Tu nombre</label>
                <input id="customerName" name="customerName" required className="input" autoComplete="name" />
              </div>
              <div>
                <label className="label" htmlFor="customerPhone">Teléfono</label>
                <input id="customerPhone" name="customerPhone" required type="tel" className="input" autoComplete="tel" />
              </div>
            </div>

            {tipo === 'DELIVERY' && (
              <>
                <div>
                  <label className="label" htmlFor="address">Dirección</label>
                  <input id="address" name="address" required className="input" placeholder="Calle, número, piso" autoComplete="street-address" />
                </div>
                <div>
                  <label className="label" htmlFor="addressNotes">Entre calles o referencia</label>
                  <input id="addressNotes" name="addressNotes" className="input" placeholder="Portón marca, timbre B" />
                </div>
                {zonas.length > 0 && (
                  <div>
                    <label className="label" htmlFor="zona">Zona de envío</label>
                    <select id="zona" className="input" value={zonaId} onChange={(e) => setZonaId(e.target.value)}>
                      {zonas.map((z) => (
                        <option key={z.id} value={z.id}>
                          {z.name} · {z.fee === 0 ? 'sin cargo' : money(z.fee)}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
              </>
            )}

            <div>
              <span className="label">Cómo abona</span>
              <div className={`grid gap-2 ${pagoOnline ? 'grid-cols-2' : 'grid-cols-3'}`}>
                {([
                  ...(pagoOnline ? [['MERCADO_PAGO', 'Mercado Pago (pagás ahora)']] as const : []),
                  ['EFECTIVO', 'Efectivo'],
                  ['TRANSFERENCIA', 'Transferencia'],
                  ['TARJETA_ENTREGA', 'Tarjeta'],
                ] as const).map(([id, label]) => (
                  <button
                    type="button"
                    key={id}
                    onClick={() => setPago(id)}
                    className={`rounded-xl border px-2 py-2.5 text-sm ${
                      pago === id ? 'border-marca bg-marca text-crema' : 'border-carbon/15 bg-white'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            {pago === 'EFECTIVO' && tipo === 'DELIVERY' && (
              <div>
                <label className="label" htmlFor="abonaCon">¿Con cuánto abonás? Así te llevamos el vuelto</label>
                <input
                  id="abonaCon"
                  className="input"
                  inputMode="decimal"
                  placeholder={`Por ejemplo ${Math.ceil(total / 100 / 1000) * 1000}`}
                  value={abonaCon}
                  onChange={(e) => setAbonaCon(e.target.value)}
                />
                {abona > 0 && (
                  <p className={`mt-1 text-sm ${abona < total ? 'text-ladrillo' : 'text-carbon-500'}`}>
                    {abona < total ? `No alcanza: faltan ${money(total - abona)}` : `Te llevamos ${money(abona - total)} de vuelto`}
                  </p>
                )}
              </div>
            )}

            {pago === 'TRANSFERENCIA' && branch.aliasBancario && (
              <p className="rounded-xl bg-white p-3 text-sm">
                Alias <strong>{branch.aliasBancario}</strong>. Mandanos el comprobante por WhatsApp.
              </p>
            )}

            <div>
              <label className="label" htmlFor="notes">Aclaraciones</label>
              <input id="notes" name="notes" className="input" placeholder="Opcional" />
            </div>

            <div>
              <label className="label" htmlFor="promoCode">¿Tenés un código de descuento?</label>
              <div className="flex gap-2">
                <input
                  id="promoCode"
                  className="input uppercase"
                  placeholder="Opcional"
                  value={codigo}
                  onChange={(e) => { setCodigo(e.target.value); setDescuento(null); setErrorCodigo(''); }}
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void aplicarCodigo(); } }}
                />
                <button
                  type="button"
                  onClick={() => aplicarCodigo()}
                  disabled={validando || !codigo.trim()}
                  className="btn-fantasma shrink-0 px-4"
                >
                  {validando ? '...' : 'Aplicar'}
                </button>
              </div>
              {descuento && <p className="mt-1 text-sm text-verde">✓ {descuento.titulo}: -{money(descuento.monto)}</p>}
              {errorCodigo && <p className="mt-1 text-sm text-ladrillo">{errorCodigo}</p>}
            </div>

            <dl className="space-y-1.5 rounded-xl bg-white p-4 text-sm">
              <div className="flex justify-between"><dt>Subtotal</dt><dd>{money(subtotal)}</dd></div>
              {tipo === 'DELIVERY' && (
                <div className="flex justify-between">
                  <dt>Envío</dt>
                  <dd>{envio === 0 ? 'Sin cargo' : money(envio)}</dd>
                </div>
              )}
              {descuento && (
                <div className="flex justify-between text-verde">
                  <dt>Descuento · {descuento.codigo}</dt>
                  <dd>-{money(descuento.monto)}</dd>
                </div>
              )}
              <div className="flex justify-between border-t border-carbon/10 pt-1.5 text-base font-bold">
                <dt>Total</dt><dd>{money(total)}</dd>
              </div>
            </dl>

            {error && <p className="rounded-xl bg-ladrillo/10 px-4 py-3 text-sm text-ladrillo">{error}</p>}

            <button disabled={enviando} className="btn-primario w-full py-3.5 text-base">
              {enviando
                ? pago === 'MERCADO_PAGO' ? 'Abriendo Mercado Pago...' : 'Enviando...'
                : pago === 'MERCADO_PAGO' ? `Pagar ${money(total)} con Mercado Pago` : `Hacer el pedido · ${money(total)}`}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
