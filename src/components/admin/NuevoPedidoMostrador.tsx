'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { money, toCents } from '@/lib/money';
import { ETIQUETA_PAGO, FORMAS_DE_PAGO, type FormaDePago } from '@/lib/etiquetas';
import { crearPedido, agregarAPedido, type ItemCarrito } from '@/actions/orders';
import { precioBaseEnPantalla, type InfoMitad } from '@/lib/mitad';

type Variante = { id: string; name: string; price: number };
type Opcion = { id: string; name: string; price: number };
type Grupo = { id: string; name: string; minPick: number; maxPick: number; options: Opcion[] };
export type ProductoMostrador = {
  id: string; name: string; price: number; variants: Variante[]; addons: Grupo[];
  /** Solo en la mitad y mitad, si el local no la cobra a precio fijo */
  mitad?: InfoMitad | null;
};
export type CategoriaMostrador = { id: string; name: string; products: ProductoMostrador[] };
type Zona = { id: string; name: string; fee: number };
type Mesa = { id: string; name: string };

type Linea = {
  key: string;
  productId: string;
  variantId: string | null;
  nombre: string;
  adicionales: Opcion[];
  nota: string;
  precio: number;
  cantidad: number;
};

type Props = {
  branchId: string;
  categorias: CategoriaMostrador[];
  zonas: Zona[];
  mesas: Mesa[];
  /** Si viene, en vez de crear un pedido se suman productos a este */
  agregarA?: { id: string; code: string };
  /** Para abrir el modal desde afuera (por ejemplo, desde la ficha del pedido) */
  abiertoInicial?: boolean;
  /** Pedido del mozo en una mesa ya abierta: es de salón, de esa mesa, y no pide datos del cliente */
  mesaFija?: { id: string; name: string };
  onCerrar?: () => void;
  /** Se llama solo cuando se guardó (onCerrar se llama también al cancelar) */
  onGuardado?: () => void;
};

/**
 * El pedido que entra por teléfono o mostrador se carga acá y sigue el mismo
 * camino que el de la web: misma cocina, mismo stock, mismos reportes. Como lo
 * carga alguien del local, entra ya aceptado y la comanda sale sola.
 *
 * También sirve para sumar a un pedido abierto: la segunda ronda de una mesa.
 */
export default function NuevoPedidoMostrador({
  branchId, categorias, zonas, mesas, agregarA, abiertoInicial = false, onCerrar, mesaFija, onGuardado,
}: Props) {
  const router = useRouter();
  const [abierto, setAbierto] = useState(abiertoInicial);
  const [lineas, setLineas] = useState<Linea[]>([]);
  const [tipo, setTipo] = useState<'DELIVERY' | 'TAKEAWAY' | 'SALON'>(mesaFija ? 'SALON' : 'TAKEAWAY');
  const [canal, setCanal] = useState<'MOSTRADOR' | 'WHATSAPP'>('MOSTRADOR');
  const [zonaId, setZonaId] = useState(zonas[0]?.id ?? '');
  const [mesaId, setMesaId] = useState(mesaFija?.id ?? '');
  const [pago, setPago] = useState<FormaDePago>('EFECTIVO');
  const [abonaCon, setAbonaCon] = useState('');
  const [busqueda, setBusqueda] = useState('');
  const [eligiendo, setEligiendo] = useState<ProductoMostrador | null>(null);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState('');

  const subtotal = lineas.reduce((s, l) => s + l.precio * l.cantidad, 0);
  const envio = !agregarA && tipo === 'DELIVERY' ? zonas.find((z) => z.id === zonaId)?.fee ?? 0 : 0;
  const total = subtotal + envio;
  const abona = abonaCon ? toCents(abonaCon) : 0;

  const productos = categorias.flatMap((c) => c.products.map((p) => ({ ...p, categoria: c.name })));
  const q = busqueda.trim().toLowerCase();
  const visibles = q ? productos.filter((p) => p.name.toLowerCase().includes(q)) : productos;

  function cerrar() {
    setAbierto(false);
    setError('');
    onCerrar?.();
  }

  function sumarLinea(l: Omit<Linea, 'key'>) {
    const key = [l.productId, l.variantId, ...l.adicionales.map((a) => a.id).sort(), l.nota].join('|');
    setLineas((prev) => {
      const i = prev.findIndex((x) => x.key === key);
      if (i >= 0) {
        const copia = [...prev];
        copia[i] = { ...copia[i], cantidad: copia[i].cantidad + l.cantidad };
        return copia;
      }
      return [...prev, { ...l, key }];
    });
  }

  /** Productos simples van directo; los que tienen tamaños o extras abren el selector. */
  function tocar(p: ProductoMostrador) {
    const conOpciones = p.variants.length > 0 || p.addons.some((g) => g.options.length > 0);
    if (!conOpciones) {
      sumarLinea({ productId: p.id, variantId: null, nombre: p.name, adicionales: [], nota: '', precio: p.price, cantidad: 1 });
      return;
    }
    setEligiendo(p);
  }

  async function guardar(fd: FormData) {
    setError('');
    setGuardando(true);

    const items: ItemCarrito[] = lineas.map((l) => ({
      productId: l.productId,
      variantId: l.variantId,
      quantity: l.cantidad,
      addonIds: l.adicionales.map((a) => a.id),
      notes: l.nota || undefined,
    }));

    try {
      const res = agregarA
        ? await agregarAPedido(agregarA.id, items)
        : await crearPedido(items, {
            branchId,
            type: tipo,
            customerName: String(fd.get('customerName') || ''),
            customerPhone: String(fd.get('customerPhone') || ''),
            address: String(fd.get('address') || ''),
            addressNotes: String(fd.get('addressNotes') || ''),
            zoneId: tipo === 'DELIVERY' ? zonaId : undefined,
            tableId: tipo === 'SALON' ? mesaId || undefined : undefined,
            paymentMethod: pago,
            cashAmount: pago === 'EFECTIVO' && abona ? abona : undefined,
            notes: String(fd.get('notes') || ''),
            source: canal,
            desdePanel: true,
          });

      if (!res.ok) { setError(res.error); return; }

      setLineas([]);
      setAbonaCon('');
      onGuardado?.();
      cerrar();
      router.refresh();
    } catch {
      setError('No se pudo guardar. Revisá la conexión y probá de nuevo.');
    } finally {
      setGuardando(false);
    }
  }

  if (!abierto) {
    return (
      <button onClick={() => setAbierto(true)} className="btn-acento">
        Cargar pedido
      </button>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-carbon/50 p-2 sm:p-4" onClick={cerrar}>
      <div
        className="grid h-[96vh] w-full max-w-4xl grid-rows-[minmax(0,1fr)_minmax(0,1fr)] overflow-hidden rounded-2xl bg-crema md:h-auto md:max-h-[92vh] md:grid-cols-[1fr_360px] md:grid-rows-1"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Catálogo */}
        <div className="flex min-h-0 flex-col border-b border-carbon/10 md:border-b-0 md:border-r">
          <div className="border-b border-carbon/10 p-4">
            <input
              className="input"
              placeholder="Buscar producto"
              value={busqueda}
              onChange={(e) => setBusqueda(e.target.value)}
              autoFocus
            />
          </div>
          <div className="scroll-fino min-h-0 flex-1 overflow-y-auto p-4">
            <div className="grid gap-2 sm:grid-cols-2">
              {visibles.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => tocar(p)}
                  className="rounded-xl border border-carbon/15 bg-white px-3 py-2.5 text-left text-sm hover:border-marca"
                >
                  <span className="block font-medium">{p.name}</span>
                  <span className="text-carbon-500">
                    {p.variants.length > 0
                      ? p.variants.map((v) => `${v.name} ${money(v.price)}`).join(' · ')
                      : money(p.price)}
                  </span>
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Ticket */}
        <form action={guardar} className="scroll-fino flex min-h-0 flex-col overflow-y-auto">
          <div className="flex items-center justify-between border-b border-carbon/10 p-4">
            <h2 className="font-display text-lg font-bold">
              {mesaFija ? `${mesaFija.name} · ` : ''}{agregarA ? `Agregar a ${agregarA.code}` : 'Pedido nuevo'}
            </h2>
            <button type="button" onClick={cerrar} className="text-carbon-500" aria-label="Cerrar">✕</button>
          </div>

          <div className="flex-1 space-y-3 p-4">
            {!agregarA && !mesaFija && (
              <div className="grid grid-cols-3 gap-1.5">
                {(['TAKEAWAY', 'DELIVERY', 'SALON'] as const).map((t) => (
                  <button
                    type="button"
                    key={t}
                    onClick={() => setTipo(t)}
                    className={`rounded-lg border px-2 py-2 text-xs font-medium ${
                      tipo === t ? 'border-marca bg-marca text-crema' : 'border-carbon/15 bg-white'
                    }`}
                  >
                    {t === 'TAKEAWAY' ? 'Retiro' : t === 'DELIVERY' ? 'Envío' : 'Salón'}
                  </button>
                ))}
              </div>
            )}

            {lineas.length === 0 ? (
              <p className="py-6 text-center text-sm text-carbon-500">Tocá productos de la izquierda.</p>
            ) : (
              <ul className="space-y-2 text-sm">
                {lineas.map((l) => (
                  <li key={l.key} className="flex items-start gap-2">
                    <div className="inline-flex items-center rounded border border-carbon/15 bg-white">
                      <button
                        type="button"
                        onClick={() => setLineas((p) => p.map((x) => x.key === l.key ? { ...x, cantidad: x.cantidad - 1 } : x).filter((x) => x.cantidad > 0))}
                        className="px-2"
                        aria-label="Quitar uno"
                      >−</button>
                      <span className="w-5 text-center font-medium">{l.cantidad}</span>
                      <button
                        type="button"
                        onClick={() => setLineas((p) => p.map((x) => x.key === l.key ? { ...x, cantidad: x.cantidad + 1 } : x))}
                        className="px-2"
                        aria-label="Agregar uno"
                      >+</button>
                    </div>
                    <span className="min-w-0 flex-1">
                      {l.nombre}
                      {l.adicionales.length > 0 && (
                        <span className="block text-xs text-carbon-500">+ {l.adicionales.map((a) => a.name).join(', ')}</span>
                      )}
                      {l.nota && <span className="block text-xs italic text-rojo">{l.nota}</span>}
                    </span>
                    <span className="font-medium">{money(l.precio * l.cantidad)}</span>
                  </li>
                ))}
              </ul>
            )}

            {!agregarA && mesaFija && <input name="notes" className="input" placeholder="Aclaraciones para la cocina" />}

            {!agregarA && !mesaFija && (
              <>
                <div className="grid grid-cols-2 gap-1.5">
                  {(['MOSTRADOR', 'WHATSAPP'] as const).map((c) => (
                    <button
                      type="button"
                      key={c}
                      onClick={() => setCanal(c)}
                      className={`rounded-lg border px-2 py-1.5 text-xs ${
                        canal === c ? 'border-marca bg-marca/10 font-semibold' : 'border-carbon/15 bg-white'
                      }`}
                    >
                      {c === 'MOSTRADOR' ? 'Mostrador o teléfono' : 'Llegó por WhatsApp'}
                    </button>
                  ))}
                </div>

                <input name="customerName" className="input" placeholder="Nombre del cliente" />
                <input name="customerPhone" className="input" placeholder="Teléfono" inputMode="tel" />

                {tipo === 'DELIVERY' && (
                  <>
                    <input name="address" className="input" placeholder="Dirección" required />
                    <input name="addressNotes" className="input" placeholder="Piso, depto, entre calles" />
                    {zonas.length > 0 && (
                      <select className="input" value={zonaId} onChange={(e) => setZonaId(e.target.value)}>
                        {zonas.map((z) => <option key={z.id} value={z.id}>{z.name} · {money(z.fee)}</option>)}
                      </select>
                    )}
                  </>
                )}

                {tipo === 'SALON' && (
                  <select className="input" value={mesaId} onChange={(e) => setMesaId(e.target.value)}>
                    <option value="">Sin mesa asignada</option>
                    {mesas.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                  </select>
                )}

                <select className="input" value={pago} onChange={(e) => setPago(e.target.value as FormaDePago)}>
                  {FORMAS_DE_PAGO.map((f) => <option key={f} value={f}>{ETIQUETA_PAGO[f]}</option>)}
                </select>

                {pago === 'EFECTIVO' && tipo === 'DELIVERY' && (
                  <div>
                    <input
                      className="input"
                      inputMode="decimal"
                      placeholder="¿Con cuánto abona? (para el vuelto)"
                      value={abonaCon}
                      onChange={(e) => setAbonaCon(e.target.value)}
                    />
                    {abona > 0 && (
                      <p className={`mt-1 text-xs ${abona < total ? 'text-ladrillo' : 'text-carbon-500'}`}>
                        {abona < total ? `No alcanza: faltan ${money(total - abona)}` : `Vuelto: ${money(abona - total)}`}
                      </p>
                    )}
                  </div>
                )}

                <input name="notes" className="input" placeholder="Aclaraciones del pedido" />
              </>
            )}

            {error && <p className="rounded-lg bg-ladrillo/10 px-3 py-2 text-sm text-ladrillo">{error}</p>}
          </div>

          <div className="border-t border-carbon/10 bg-white p-4">
            <div className="flex justify-between text-sm"><span>Subtotal</span><span>{money(subtotal)}</span></div>
            {envio > 0 && <div className="flex justify-between text-sm"><span>Envío</span><span>{money(envio)}</span></div>}
            <div className="mt-1 flex justify-between font-bold"><span>{agregarA ? 'Se suma' : 'Total'}</span><span>{money(total)}</span></div>
            <button disabled={guardando || lineas.length === 0} className="btn-primario mt-3 w-full py-3">
              {guardando ? 'Guardando...' : agregarA ? 'Agregar al pedido' : 'Crear pedido'}
            </button>
          </div>
        </form>
      </div>

      {eligiendo && (
        <SelectorProducto
          producto={eligiendo}
          onCerrar={() => setEligiendo(null)}
          onAgregar={(l) => { sumarLinea(l); setEligiendo(null); }}
        />
      )}
    </div>
  );
}

/** Tamaño, extras y aclaración de un producto: "grande, doble muzza, sin aceitunas". */
function SelectorProducto({
  producto, onCerrar, onAgregar,
}: {
  producto: ProductoMostrador;
  onCerrar: () => void;
  onAgregar: (l: Omit<Linea, 'key'>) => void;
}) {
  const [variante, setVariante] = useState<Variante | null>(producto.variants[0] ?? null);
  const [elegidos, setElegidos] = useState<Record<string, string[]>>({});
  const [nota, setNota] = useState('');
  const [cantidad, setCantidad] = useState(1);

  const grupos = producto.addons.filter((g) => g.options.length > 0);
  const adicionales = grupos.flatMap((g) => g.options.filter((o) => elegidos[g.id]?.includes(o.id)));
  const faltan = grupos.filter((g) => g.minPick > 0 && (elegidos[g.id]?.length ?? 0) < g.minPick);
  const fijo = variante ? variante.price : producto.price;
  const base = precioBaseEnPantalla(producto.mitad, fijo, variante?.id ?? null, adicionales.map((a) => a.id));
  const precio = base + adicionales.reduce((s, a) => s + a.price, 0);

  function alternar(g: Grupo, id: string) {
    setElegidos((prev) => {
      const actual = prev[g.id] ?? [];
      if (actual.includes(id)) return { ...prev, [g.id]: actual.filter((x) => x !== id) };
      if (g.maxPick === 1) return { ...prev, [g.id]: [id] };
      if (g.maxPick > 0 && actual.length >= g.maxPick) return prev;
      return { ...prev, [g.id]: [...actual, id] };
    });
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-carbon/40 p-4" onClick={(e) => { e.stopPropagation(); onCerrar(); }}>
      <div className="max-h-[88vh] w-full max-w-md overflow-y-auto rounded-2xl bg-crema p-5" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h3 className="font-display text-xl">{producto.name}</h3>
          <button type="button" onClick={onCerrar} className="text-carbon-500" aria-label="Cerrar">✕</button>
        </div>

        {producto.variants.length > 0 && (
          <div className="mt-4 grid grid-cols-2 gap-2">
            {producto.variants.map((v) => (
              <button
                type="button"
                key={v.id}
                onClick={() => setVariante(v)}
                className={`rounded-xl border px-3 py-2 text-sm ${variante?.id === v.id ? 'border-marca bg-marca text-crema' : 'border-carbon/15 bg-white'}`}
              >
                {v.name} · {money(v.price)}
              </button>
            ))}
          </div>
        )}

        {grupos.map((g) => (
          <div key={g.id} className="mt-4">
            <p className="text-sm font-semibold">
              {g.name}{' '}
              <span className="font-normal text-carbon-500">
                {g.minPick > 0 ? `(elegí ${g.minPick})` : g.maxPick > 0 ? `(hasta ${g.maxPick})` : ''}
              </span>
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              {g.options.map((o) => {
                const activo = elegidos[g.id]?.includes(o.id);
                return (
                  <button
                    type="button"
                    key={o.id}
                    onClick={() => alternar(g, o.id)}
                    className={`rounded-full border px-3 py-1 text-sm ${activo ? 'border-marca bg-marca/10 font-semibold' : 'border-carbon/15 bg-white'}`}
                  >
                    {o.name}{o.price > 0 ? ` +${money(o.price)}` : ''}
                  </button>
                );
              })}
            </div>
          </div>
        ))}

        <input
          className="input mt-4"
          placeholder="Aclaración: sin aceitunas, bien cocida, mitad napo..."
          value={nota}
          onChange={(e) => setNota(e.target.value)}
          maxLength={200}
        />

        <div className="mt-4 flex items-center gap-3">
          <div className="inline-flex items-center rounded-lg border border-carbon/15 bg-white">
            <button type="button" onClick={() => setCantidad((c) => Math.max(1, c - 1))} className="px-3 py-2">−</button>
            <span className="w-6 text-center font-medium">{cantidad}</span>
            <button type="button" onClick={() => setCantidad((c) => Math.min(99, c + 1))} className="px-3 py-2">+</button>
          </div>
          <button
            type="button"
            disabled={faltan.length > 0 || (producto.variants.length > 0 && !variante)}
            onClick={() =>
              onAgregar({
                productId: producto.id,
                variantId: variante?.id ?? null,
                nombre: variante ? `${producto.name} · ${variante.name}` : producto.name,
                adicionales,
                nota: nota.trim(),
                precio,
                cantidad,
              })
            }
            className="btn-primario flex-1 py-2.5"
          >
            {faltan.length > 0 ? `Elegí ${faltan[0].name}` : `Agregar · ${money(precio * cantidad)}`}
          </button>
        </div>
      </div>
    </div>
  );
}
