'use client';

import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { moverStock, cerrarInventario, alternarControlStock } from '@/actions/operacion';
import { diaHora } from '@/lib/tiempo';

type Variante = { id: string; name: string; stock: number };
type Producto = {
  id: string; name: string; stock: number; lowStock: number; trackStock: boolean;
  category: { name: string };
  variants: Variante[];
};
type Movimiento = {
  id: string; type: string; quantity: number; before: number; after: number;
  reason: string | null; orderCode: string | null; createdAt: string;
  product: { name: string } | null;
  variant: { name: string } | null;
  user: { name: string } | null;
};

type Fila = {
  clave: string;
  producto: Producto;
  variante: Variante | null;
  nombre: string;
  stock: number;
};

const TIPO_MOV: Record<string, { label: string; color: string }> = {
  VENTA: { label: 'Venta', color: 'text-carbon-500' },
  REPOSICION: { label: 'Entrada', color: 'text-verde' },
  AJUSTE: { label: 'Ajuste', color: 'text-rojo' },
  MERMA: { label: 'Merma', color: 'text-ladrillo' },
  DEVOLUCION: { label: 'Devolución', color: 'text-verde' },
};

/**
 * Stock e inventario son la misma información vista de dos maneras, así que
 * van en una sola pantalla.
 *
 * Qué hay ahora: niveles actuales y movimientos sueltos del día a día.
 * Conteo físico: la planilla de fin de mes, cuando alguien recorre la heladera.
 * Historial: qué pasó, cuándo y quién lo hizo.
 * Qué se controla: prender o apagar el seguimiento producto por producto.
 */
export default function GestorStock({
  productos, movimientos, todos, puedeMover, puedeControlar,
}: {
  productos: Producto[]; movimientos: Movimiento[]; todos: Producto[];
  puedeMover: boolean; puedeControlar: boolean;
}) {
  const router = useRouter();
  const [vista, setVista] = useState<'niveles' | 'conteo' | 'historial' | 'control'>('niveles');

  const filas: Fila[] = useMemo(
    () =>
      productos.flatMap<Fila>((p) =>
        p.variants.length
          ? p.variants.map((v) => ({
              clave: `${p.id}|${v.id}`, producto: p, variante: v,
              nombre: `${p.name} · ${v.name}`, stock: v.stock,
            }))
          : [{ clave: `${p.id}|`, producto: p, variante: null, nombre: p.name, stock: p.stock }]
      ),
    [productos]
  );

  const criticos = filas.filter((f) => f.stock <= f.producto.lowStock).length;

  type Vista = 'niveles' | 'conteo' | 'historial' | 'control';
  const pestanas: { id: Vista; label: string }[] = [
    { id: 'niveles', label: 'Qué hay ahora' },
    ...(puedeMover ? [{ id: 'conteo' as Vista, label: 'Conteo físico' }] : []),
    { id: 'historial', label: 'Historial' },
    ...(puedeControlar ? [{ id: 'control' as Vista, label: 'Qué se controla' }] : []),
  ];

  return (
    <div>
      <div className="mb-5">
        <h1 className="font-display text-2xl">Stock</h1>
        <p className="mt-1 text-sm text-carbon-500">
          {productos.length === 0
            ? 'Ningún producto tiene el control de stock activado.'
            : `${productos.length} productos con control activo.`}
          {criticos > 0 && <span className="ml-1 font-medium text-ladrillo">{criticos} por debajo del mínimo.</span>}
        </p>
      </div>

      <div className="mb-5 flex flex-wrap gap-2">
        {pestanas.map(({ id, label }) => (
          <button key={id} onClick={() => setVista(id)} className={`chip ${vista === id ? 'chip-activo' : ''}`}>
            {label}
          </button>
        ))}
      </div>

      {vista === 'niveles' && <Niveles filas={filas} puedeMover={puedeMover} onCambio={() => router.refresh()} />}
      {vista === 'conteo' && <Conteo filas={filas} onCambio={() => router.refresh()} />}
      {vista === 'historial' && <Historial movimientos={movimientos} />}
      {vista === 'control' && <Control productos={todos} onCambio={() => router.refresh()} />}
    </div>
  );
}

// ─────────── Qué hay ahora ───────────

function Niveles({ filas, puedeMover, onCambio }: { filas: Fila[]; puedeMover: boolean; onCambio: () => void }) {
  const [mover, setMover] = useState<Fila | null>(null);
  const [filtro, setFiltro] = useState('');
  const [soloBajos, setSoloBajos] = useState(false);

  const visibles = filas
    .filter((f) => !filtro || f.nombre.toLowerCase().includes(filtro.toLowerCase()))
    .filter((f) => !soloBajos || f.stock <= f.producto.lowStock);

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <input className="input sm:max-w-xs" placeholder="Buscar producto" value={filtro} onChange={(e) => setFiltro(e.target.value)} />
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={soloBajos} onChange={(e) => setSoloBajos(e.target.checked)} className="h-4 w-4 accent-marca" />
          Solo los que están bajos
        </label>
      </div>

      <div className="panel divide-y divide-carbon/10">
        {visibles.length === 0 && (
          <p className="p-8 text-center text-sm text-carbon-500">
            Nada para mostrar. Activá el control en la pestaña de al lado.
          </p>
        )}

        {visibles.map((f) => {
          const bajo = f.stock <= f.producto.lowStock;
          const agotado = f.stock <= 0;
          return (
            <div key={f.clave} className="flex items-center gap-4 p-4">
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">{f.nombre}</p>
                <p className="text-sm text-carbon-500">{f.producto.category.name}</p>
              </div>
              <div className="text-right">
                <p className={`text-xl font-bold tabular-nums ${agotado ? 'text-ladrillo' : bajo ? 'text-rojo' : ''}`}>
                  {f.stock}
                </p>
                <p className="text-xs text-carbon-500">mín. {f.producto.lowStock}</p>
              </div>
              {puedeMover && (
                <button onClick={() => setMover(f)} className="btn-fantasma px-3 py-1.5 text-sm">Mover</button>
              )}
            </div>
          );
        })}
      </div>

      {mover && (
        <DialogoMovimiento fila={mover} onCerrar={() => setMover(null)} onHecho={() => { setMover(null); onCambio(); }} />
      )}
    </div>
  );
}

function DialogoMovimiento({
  fila, onCerrar, onHecho,
}: {
  fila: Fila; onCerrar: () => void; onHecho: () => void;
}) {
  const [tipo, setTipo] = useState<'REPOSICION' | 'MERMA' | 'AJUSTE'>('REPOSICION');
  const [cantidad, setCantidad] = useState('');
  const [motivo, setMotivo] = useState('');
  const [error, setError] = useState('');
  const [pendiente, startTransition] = useTransition();

  const actual = fila.stock;
  const n = parseInt(cantidad || '0', 10);
  const resultado =
    tipo === 'REPOSICION' ? actual + Math.abs(n)
    : tipo === 'MERMA' ? Math.max(0, actual - Math.abs(n))
    : Math.max(0, actual + n);

  function confirmar() {
    if (!n) { setError('Poné una cantidad'); return; }
    if (tipo === 'MERMA' && !motivo.trim()) { setError('Contá por qué se perdió: sirve para el reporte'); return; }
    setError('');
    startTransition(async () => {
      const res = await moverStock(fila.producto.id, fila.variante?.id ?? null, tipo, n, motivo || undefined);
      if (!res.ok) { setError(res.error); return; }
      onHecho();
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-carbon/50 p-4" onClick={onCerrar}>
      <div className="w-full max-w-sm rounded-2xl bg-crema p-6" onClick={(e) => e.stopPropagation()}>
        <h2 className="font-display text-lg">{fila.nombre}</h2>
        <p className="mt-1 text-sm text-carbon-500">Hay {actual} en sistema</p>

        <div className="mt-5 grid grid-cols-3 gap-2">
          {([
            ['REPOSICION', 'Entrada'],
            ['MERMA', 'Merma'],
            ['AJUSTE', 'Ajuste'],
          ] as const).map(([id, label]) => (
            <button
              key={id}
              onClick={() => setTipo(id)}
              className={`rounded-xl border px-2 py-2.5 text-sm font-medium ${
                tipo === id ? 'border-marca bg-marca text-crema' : 'border-carbon/15 bg-white'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        <p className="mt-2 text-xs text-carbon-500">
          {tipo === 'REPOSICION' && 'Llegó mercadería nueva.'}
          {tipo === 'MERMA' && 'Se rompió, se venció o se tiró.'}
          {tipo === 'AJUSTE' && 'Corrección manual. Podés usar números negativos.'}
        </p>

        <div className="mt-4">
          <label className="label" htmlFor="cantidad">Cantidad</label>
          <input
            id="cantidad" className="input" inputMode="numeric" autoFocus
            value={cantidad} onChange={(e) => setCantidad(e.target.value)}
            placeholder={tipo === 'AJUSTE' ? '-3' : '12'}
          />
        </div>

        <div className="mt-3">
          <label className="label" htmlFor="motivo">
            Motivo {tipo === 'MERMA' ? '' : <span className="font-normal text-carbon-500">(opcional)</span>}
          </label>
          <input id="motivo" className="input" value={motivo} onChange={(e) => setMotivo(e.target.value)} />
        </div>

        {n !== 0 && <p className="mt-4 rounded-xl bg-white px-4 py-3 text-sm">Queda en <strong>{resultado}</strong></p>}
        {error && <p className="mt-3 rounded-xl bg-ladrillo/10 px-4 py-3 text-sm text-ladrillo">{error}</p>}

        <div className="mt-5 flex gap-3">
          <button onClick={confirmar} disabled={pendiente} className="btn-primario flex-1 py-3">
            {pendiente ? 'Guardando...' : 'Confirmar'}
          </button>
          <button onClick={onCerrar} className="btn-fantasma px-5">Cancelar</button>
        </div>
      </div>
    </div>
  );
}

// ─────────── Conteo físico ───────────

function Conteo({ filas, onCambio }: { filas: Fila[]; onCambio: () => void }) {
  const [contados, setContados] = useState<Record<string, string>>({});
  const [filtro, setFiltro] = useState('');
  const [pendiente, startTransition] = useTransition();
  const [resultado, setResultado] = useState<string | null>(null);

  const visibles = filas.filter((f) => !filtro || f.nombre.toLowerCase().includes(filtro.toLowerCase()));

  const diferencias = filas.filter((f) => {
    const v = contados[f.clave];
    return v !== undefined && v !== '' && Number(v) !== f.stock;
  });

  function cerrar() {
    const conteos = filas
      .filter((f) => contados[f.clave] !== undefined && contados[f.clave] !== '')
      .map((f) => ({ productId: f.producto.id, variantId: f.variante?.id ?? null, contado: Number(contados[f.clave]) }));

    startTransition(async () => {
      const res = await cerrarInventario(conteos);
      if (res.ok) {
        setResultado(
          res.ajustados === 0
            ? 'Todo coincidía con el sistema. No hubo nada que ajustar.'
            : `Listo. Ajustamos ${res.ajustados} producto${res.ajustados === 1 ? '' : 's'}.`
        );
        setContados({});
        onCambio();
      }
    });
  }

  return (
    <div>
      <p className="mb-4 text-sm text-carbon-500">
        Anotá lo que hay físicamente. Lo que dejes vacío no se toca, y solo se ajusta lo que no
        coincida. Cada diferencia queda registrada en el historial.
      </p>

      {resultado && <p className="mb-4 rounded-xl bg-verde/10 px-4 py-3 text-sm text-verde">{resultado}</p>}

      <input className="input mb-4 sm:max-w-xs" placeholder="Buscar producto" value={filtro} onChange={(e) => setFiltro(e.target.value)} />

      <div className="panel overflow-x-auto">
        <table className="w-full min-w-[480px] text-sm">
          <thead className="border-b border-carbon/10 bg-carbon/[0.03] text-left">
            <tr>
              <th className="px-4 py-3 font-semibold">Producto</th>
              <th className="px-4 py-3 text-right font-semibold">Sistema</th>
              <th className="px-4 py-3 text-right font-semibold">Contado</th>
              <th className="px-4 py-3 text-right font-semibold">Diferencia</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-carbon/10">
            {visibles.map((f) => {
              const valor = contados[f.clave] ?? '';
              const dif = valor === '' ? null : Number(valor) - f.stock;
              return (
                <tr key={f.clave}>
                  <td className="px-4 py-2.5">
                    <p className="font-medium">{f.nombre}</p>
                    <p className="text-xs text-carbon-500">{f.producto.category.name}</p>
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-carbon-500">{f.stock}</td>
                  <td className="px-4 py-2.5 text-right">
                    <input
                      className="input w-20 py-1.5 text-right" inputMode="numeric" placeholder="—"
                      value={valor}
                      onChange={(e) => setContados((p) => ({ ...p, [f.clave]: e.target.value }))}
                    />
                  </td>
                  <td className={`px-4 py-2.5 text-right font-semibold tabular-nums ${
                    dif === null || dif === 0 ? 'text-carbon-500' : dif < 0 ? 'text-ladrillo' : 'text-verde'
                  }`}>
                    {dif === null ? '—' : dif > 0 ? `+${dif}` : dif}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="sticky bottom-0 mt-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-carbon/10 bg-crema/95 p-4 backdrop-blur">
        <p className="text-sm text-carbon-500">
          {diferencias.length === 0
            ? 'Todavía no cargaste ninguna diferencia.'
            : `${diferencias.length} producto${diferencias.length === 1 ? '' : 's'} con diferencia.`}
        </p>
        <button onClick={cerrar} disabled={pendiente || diferencias.length === 0} className="btn-primario px-6 py-2.5">
          {pendiente ? 'Aplicando...' : 'Cerrar conteo y ajustar'}
        </button>
      </div>
    </div>
  );
}

// ─────────── Historial ───────────

function Historial({ movimientos }: { movimientos: Movimiento[] }) {
  return (
    <div className="panel divide-y divide-carbon/10">
      {movimientos.length === 0 && <p className="p-8 text-center text-sm text-carbon-500">Todavía no hubo movimientos.</p>}
      {movimientos.map((m) => {
        const t = TIPO_MOV[m.type] ?? { label: m.type, color: '' };
        return (
          <div key={m.id} className="flex items-baseline gap-4 p-4 text-sm">
            <div className="min-w-0 flex-1">
              <p className="truncate font-medium">
                {m.product?.name}{m.variant ? ` · ${m.variant.name}` : ''}
              </p>
              <p className="mt-0.5 text-xs text-carbon-500">
                <span className={t.color}>{t.label}</span>
                {' · '}{m.before} → {m.after}
                {m.orderCode && ` · pedido ${m.orderCode}`}
                {m.user && ` · ${m.user.name}`}
                {m.reason && ` · ${m.reason}`}
              </p>
            </div>
            <span className={`font-bold tabular-nums ${m.quantity < 0 ? 'text-ladrillo' : 'text-verde'}`}>
              {m.quantity > 0 ? '+' : ''}{m.quantity}
            </span>
            <span className="hidden w-28 text-right text-xs text-carbon-500 sm:block">
              {diaHora(m.createdAt)}
            </span>
          </div>
        );
      })}
    </div>
  );
}

// ─────────── Qué se controla ───────────

function Control({ productos, onCambio }: { productos: Producto[]; onCambio: () => void }) {
  const [filtro, setFiltro] = useState('');
  const [pendiente, startTransition] = useTransition();

  const visibles = productos.filter((p) => !filtro || p.name.toLowerCase().includes(filtro.toLowerCase()));

  return (
    <div>
      <p className="mb-4 max-w-2xl text-sm text-carbon-500">
        Prendé el control solo donde te sirva. En bebidas y postres conviene, porque se cuentan de
        a unidades. En pizzas y empanadas normalmente no, porque se hacen al momento y llevar la
        cuenta da más trabajo que beneficio. Cuando un producto controlado llega a cero, se marca
        agotado solo en la carta.
      </p>

      <input className="input mb-4 sm:max-w-xs" placeholder="Buscar producto" value={filtro} onChange={(e) => setFiltro(e.target.value)} />

      <div className="panel divide-y divide-carbon/10">
        {visibles.map((p) => (
          <div key={p.id} className="flex items-center gap-4 p-4">
            <div className="min-w-0 flex-1">
              <p className="truncate font-medium">{p.name}</p>
              <p className="text-sm text-carbon-500">
                {p.category.name}
                {p.trackStock && ` · ${p.variants.length ? p.variants.reduce((s, v) => s + v.stock, 0) : p.stock} en stock`}
              </p>
            </div>
            <button
              onClick={() => startTransition(async () => { await alternarControlStock(p.id, !p.trackStock); onCambio(); })}
              disabled={pendiente}
              className={`rounded-full px-3.5 py-1.5 text-xs font-semibold ${
                p.trackStock ? 'bg-verde/10 text-verde' : 'bg-carbon/10 text-carbon-500'
              }`}
            >
              {p.trackStock ? 'Controla stock' : 'Sin control'}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
