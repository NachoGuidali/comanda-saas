'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { money } from '@/lib/money';
import { diaHora } from '@/lib/tiempo';
import { ETIQUETA_PAGO } from '@/lib/etiquetas';
import { ETIQUETA_CATEGORIA } from '@/lib/gastos-categorias';
import type { TableroFinanzas } from '@/lib/finanzas';

// Identidad de las dos series en todo el tablero: azul es plata que entra,
// naranja es plata que sale. Par validado para daltonismo contra fondo blanco.
const ENTRO = '#2a78d6';
const GASTO = '#eb6834';

const TIPO: Record<string, string> = { DELIVERY: 'Envío', TAKEAWAY: 'Retiro', SALON: 'Salón' };
const CANAL: Record<string, string> = { WEB: 'Carta web', WHATSAPP: 'WhatsApp', MOSTRADOR: 'Mostrador o teléfono' };
const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

type Cobro = { id: string; code: string; total: number; medio: string; original: string | null; cuando: string | null; quien: string };
type Gasto = { id: string; fecha: string; descripcion: string; categoria: string; monto: number; quien: string };

const fechaCorta = (yyyyMmDd: string) => yyyyMmDd.split('-').reverse().join('/');

export default function PanelFinanzas({
  sucursal, desde, hasta, atajos, t, cobros, gastos,
}: {
  sucursal: string; desde: string; hasta: string;
  atajos: { id: string; label: string; desde: string; hasta: string }[];
  t: TableroFinanzas; cobros: Cobro[]; gastos: Gasto[];
}) {
  const router = useRouter();
  const [verProductos, setVerProductos] = useState<'unidades' | 'facturado'>('unidades');
  const [todosProductos, setTodosProductos] = useState(false);
  const [desdeForm, setDesdeForm] = useState(desde);
  const [hastaForm, setHastaForm] = useState(hasta);

  const activo = atajos.find((a) => a.desde === desde && a.hasta === hasta)?.id;
  const ir = (d: string, h: string) => router.push(`/admin/finanzas?desde=${d}&hasta=${h}`);
  const exportar = (tipo: string) => `/api/finanzas/exportar?tipo=${tipo}&desde=${desde}&hasta=${hasta}`;

  // Con más de dos meses, los días no entran: se agrupa por mes
  const serie = useMemo(() => {
    if (t.porDia.length <= 62) {
      return t.porDia.map((d) => ({ etiqueta: d.fecha.slice(8, 10) + '/' + d.fecha.slice(5, 7), entro: d.entro, gasto: d.gasto }));
    }
    const meses = new Map<string, { etiqueta: string; entro: number; gasto: number }>();
    for (const d of t.porDia) {
      const k = d.fecha.slice(0, 7);
      const m = meses.get(k) ?? { etiqueta: `${MESES[Number(k.slice(5)) - 1]} ${k.slice(2, 4)}`, entro: 0, gasto: 0 };
      m.entro += d.entro;
      m.gasto += d.gasto;
      meses.set(k, m);
    }
    return [...meses.values()];
  }, [t.porDia]);
  const porMes = t.porDia.length > 62;

  const productos = [...t.productos].sort((a, b) => (verProductos === 'unidades' ? b.unidades - a.unidades : b.facturado - a.facturado));
  const productosVisibles = todosProductos ? productos : productos.slice(0, 10);
  const maxProducto = Math.max(1, ...productos.map((p) => (verProductos === 'unidades' ? p.unidades : p.facturado)));
  const maxMedio = Math.max(1, ...t.porMedio.map((m) => m.total));
  const maxCategoria = Math.max(1, ...t.porCategoria.map((c) => c.total));
  const perdida = t.resultado < 0;

  return (
    <div>
      {/* Encabezado y período */}
      <div className="mb-5 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl">Finanzas · {sucursal}</h1>
          <p className="mt-1 text-sm text-carbon-500">
            Del {fechaCorta(desde)} al {fechaCorta(hasta)}. La plata que entró es lo cobrado, por fecha de cobro.
          </p>
        </div>
        <details className="relative">
          <summary className="btn-fantasma cursor-pointer list-none px-4 py-2 text-sm">Descargar para Excel</summary>
          <div className="absolute right-0 z-20 mt-2 w-72 rounded-xl border border-carbon/10 bg-white p-2 text-sm shadow-lg">
            {[
              ['libro', 'Libro de movimientos', 'Cobros y gastos en orden, con saldo'],
              ['cobros', 'Cobros', 'Cada pedido cobrado, cómo y quién'],
              ['gastos', 'Gastos', 'Con quién cargó y los anulados'],
              ['productos', 'Ventas por producto', 'Unidades y facturado'],
              ['mermas', 'Mermas', 'Lo que se perdió o se regaló, en unidades'],
            ].map(([tipo, titulo, ayuda]) => (
              <a key={tipo} href={exportar(tipo)} className="block rounded-lg px-3 py-2 hover:bg-carbon/5">
                <span className="font-medium">{titulo}</span>
                <span className="block text-xs text-carbon-500">{ayuda}</span>
              </a>
            ))}
          </div>
        </details>
      </div>

      <div className="mb-6 flex flex-wrap items-center gap-2">
        {atajos.map((a) => (
          <button key={a.id} onClick={() => ir(a.desde, a.hasta)} className={`chip ${activo === a.id ? 'chip-activo' : ''}`}>
            {a.label}
          </button>
        ))}
        <form
          onSubmit={(e) => { e.preventDefault(); ir(desdeForm, hastaForm); }}
          className="flex flex-wrap items-center gap-2 text-sm"
        >
          <input type="date" value={desdeForm} max={hastaForm} onChange={(e) => setDesdeForm(e.target.value)} className="input w-auto py-1.5" aria-label="Desde" />
          <span className="text-carbon-500">a</span>
          <input type="date" value={hastaForm} min={desdeForm} onChange={(e) => setHastaForm(e.target.value)} className="input w-auto py-1.5" aria-label="Hasta" />
          <button className="btn-fantasma px-3 py-1.5">Ver</button>
        </form>
      </div>

      {/* Los cuatro números */}
      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4" aria-label="Resumen del período">
        <div className="panel p-5">
          <p className="flex items-center gap-2 text-sm text-carbon-500">
            <span className="h-2.5 w-2.5 rounded-sm" style={{ background: ENTRO }} aria-hidden /> Entró
          </p>
          <p className="mt-1 font-display text-3xl tabular-nums">{money(t.ventas)}</p>
          <p className="mt-1 text-xs text-carbon-500">{t.pedidos} pedidos cobrados · ticket promedio {money(t.ticketPromedio)}</p>
        </div>
        <div className="panel p-5">
          <p className="flex items-center gap-2 text-sm text-carbon-500">
            <span className="h-2.5 w-2.5 rounded-sm" style={{ background: GASTO }} aria-hidden /> Gastos
          </p>
          <p className="mt-1 font-display text-3xl tabular-nums">{money(t.gastos)}</p>
          <p className="mt-1 text-xs text-carbon-500">{t.cantidadGastos} gastos cargados</p>
        </div>
        <div className={`panel p-5 ${perdida ? 'border-ladrillo/40 bg-ladrillo/5' : 'border-verde/30 bg-verde/5'}`}>
          <p className="text-sm text-carbon-500">{perdida ? 'Pérdida' : 'Ganancia'}</p>
          <p className={`mt-1 font-display text-3xl tabular-nums ${perdida ? 'text-ladrillo' : 'text-verde'}`}>
            {perdida ? '−' : ''}{money(Math.abs(t.resultado))}
          </p>
          <p className="mt-1 text-xs text-carbon-500">
            {t.margen === null ? 'Sin cobros en el período' : perdida ? 'Se gastó más de lo que entró' : `Queda el ${t.margen.toLocaleString('es-AR')}% de lo que entró`}
          </p>
        </div>
        <div className={`panel p-5 ${t.pendienteDeCobro.total > 0 ? 'border-rojo/40' : ''}`}>
          <p className="text-sm text-carbon-500">Entregado sin cobrar</p>
          <p className="mt-1 font-display text-3xl tabular-nums">{money(t.pendienteDeCobro.total)}</p>
          <p className="mt-1 text-xs text-carbon-500">
            {t.pendienteDeCobro.pedidos > 0
              ? `${t.pendienteDeCobro.pedidos} pedidos: casi siempre transferencias sin confirmar`
              : 'Todo lo entregado está cobrado'}
          </p>
        </div>
      </section>

      <dl className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-sm text-carbon-500">
        <div><dt className="inline">Descuentos dados: </dt><dd className="inline font-medium text-carbon">{money(t.descuentos)}</dd></div>
        <div><dt className="inline">Envíos cobrados: </dt><dd className="inline font-medium text-carbon">{money(t.envios)}</dd></div>
        {t.devuelto.pedidos > 0 && (
          <div><dt className="inline">Devuelto por cancelaciones: </dt><dd className="inline font-medium text-carbon">{money(t.devuelto.total)} ({t.devuelto.pedidos})</dd></div>
        )}
        {t.cierresDeCaja > 0 && (
          <div>
            <dt className="inline">Diferencias de caja: </dt>
            <dd className={`inline font-medium ${t.diferenciasCaja < 0 ? 'text-ladrillo' : 'text-carbon'}`}>
              {t.diferenciasCaja === 0 ? 'ninguna' : `${t.diferenciasCaja < 0 ? 'faltaron' : 'sobraron'} ${money(Math.abs(t.diferenciasCaja))}`} en {t.cierresDeCaja} cierres
            </dd>
          </div>
        )}
      </dl>

      {/* Entró y gastó en el tiempo */}
      <section className="panel mt-6 p-5">
        <h2 className="font-display text-lg">Entró y gastó, {porMes ? 'mes por mes' : 'día por día'}</h2>
        {t.ventas === 0 && t.gastos === 0 ? (
          <p className="mt-3 text-sm text-carbon-500">No hubo cobros ni gastos en este período.</p>
        ) : (
          <div className="mt-4 h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={serie} barGap={2} barCategoryGap="20%">
                <CartesianGrid vertical={false} stroke="rgba(23,22,20,.08)" />
                <XAxis dataKey="etiqueta" tick={{ fontSize: 11, fill: '#4A463E' }} tickLine={false} axisLine={{ stroke: 'rgba(23,22,20,.2)' }} interval="preserveStartEnd" minTickGap={12} />
                <YAxis tick={{ fontSize: 11, fill: '#4A463E' }} tickLine={false} axisLine={false} width={72}
                  tickFormatter={(v: number) => (v >= 100_000_000 ? `$${Math.round(v / 100_000_000)}M` : v >= 100_000 ? `$${Math.round(v / 100_000)}k` : `$${v / 100}`)} />
                <Tooltip
                  cursor={{ fill: 'rgba(23,22,20,.05)' }}
                  formatter={(v: number, nombre: string) => [money(v), nombre]}
                  labelStyle={{ fontWeight: 600 }}
                  contentStyle={{ borderRadius: 10, border: '1px solid rgba(23,22,20,.12)', fontSize: 13 }}
                />
                {/* El color va en el cuadradito; el texto de la leyenda, en color de texto */}
                <Legend wrapperStyle={{ fontSize: 13 }} iconType="square" formatter={(v: string) => <span style={{ color: '#171614' }}>{v}</span>} />
                {/* Sin animación: el dato tiene que estar ahí de entrada, también con "reducir movimiento" */}
                <Bar dataKey="entro" name="Entró" fill={ENTRO} radius={[4, 4, 0, 0]} maxBarSize={28} isAnimationActive={false} />
                <Bar dataKey="gasto" name="Gastos" fill={GASTO} radius={[4, 4, 0, 0]} maxBarSize={28} isAnimationActive={false} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </section>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        {/* En qué entró */}
        <section className="panel p-5">
          <h2 className="font-display text-lg">Cómo entró la plata</h2>
          {t.porMedio.length === 0 ? (
            <p className="mt-3 text-sm text-carbon-500">Sin cobros en el período.</p>
          ) : (
            <ul className="mt-4 space-y-3">
              {t.porMedio.map((m) => (
                <li key={m.medio} title={`${ETIQUETA_PAGO[m.medio] ?? m.medio}: ${money(m.total)} en ${m.pedidos} pedidos`}>
                  <div className="flex items-baseline justify-between gap-3 text-sm">
                    <span className="font-medium">{ETIQUETA_PAGO[m.medio] ?? m.medio}</span>
                    <span className="tabular-nums">
                      {money(m.total)} <span className="text-carbon-500">· {t.ventas > 0 ? Math.round((m.total / t.ventas) * 100) : 0}% · {m.pedidos} ped.</span>
                    </span>
                  </div>
                  <div className="mt-1.5 h-2 rounded-sm bg-carbon/5">
                    <div className="h-2 rounded-r-[4px]" style={{ width: `${Math.max(2, (m.total / maxMedio) * 100)}%`, background: ENTRO }} />
                  </div>
                </li>
              ))}
            </ul>
          )}
          {t.porTipo.length > 0 && (
            <div className="mt-5 grid gap-4 border-t border-carbon/10 pt-4 text-sm sm:grid-cols-2">
              <div>
                <p className="mb-1.5 font-medium">Por tipo de pedido</p>
                {[...t.porTipo].sort((a, b) => b.total - a.total).map((x) => (
                  <p key={x.tipo} className="flex justify-between text-carbon-500">
                    <span>{TIPO[x.tipo] ?? x.tipo}</span><span className="tabular-nums text-carbon">{money(x.total)}</span>
                  </p>
                ))}
              </div>
              <div>
                <p className="mb-1.5 font-medium">Por dónde entró el pedido</p>
                {[...t.porCanal].sort((a, b) => b.total - a.total).map((x) => (
                  <p key={x.canal} className="flex justify-between text-carbon-500">
                    <span>{CANAL[x.canal] ?? x.canal}</span><span className="tabular-nums text-carbon">{money(x.total)}</span>
                  </p>
                ))}
              </div>
            </div>
          )}
        </section>

        {/* En qué se gastó */}
        <section className="panel p-5">
          <div className="flex items-baseline justify-between">
            <h2 className="font-display text-lg">En qué se gastó</h2>
            <a href="/admin/gastos" className="text-sm underline">Cargar o ver gastos</a>
          </div>
          {t.porCategoria.length === 0 ? (
            <p className="mt-3 text-sm text-carbon-500">No hay gastos cargados en el período.</p>
          ) : (
            <ul className="mt-4 space-y-3">
              {t.porCategoria.map((c) => (
                <li key={c.categoria} title={`${ETIQUETA_CATEGORIA[c.categoria] ?? c.categoria}: ${money(c.total)} en ${c.cantidad} gastos`}>
                  <div className="flex items-baseline justify-between gap-3 text-sm">
                    <span className="font-medium">{ETIQUETA_CATEGORIA[c.categoria] ?? c.categoria}</span>
                    <span className="tabular-nums">
                      {money(c.total)} <span className="text-carbon-500">· {t.gastos > 0 ? Math.round((c.total / t.gastos) * 100) : 0}%</span>
                    </span>
                  </div>
                  <div className="mt-1.5 h-2 rounded-sm bg-carbon/5">
                    <div className="h-2 rounded-r-[4px]" style={{ width: `${Math.max(2, (c.total / maxCategoria) * 100)}%`, background: GASTO }} />
                  </div>
                </li>
              ))}
            </ul>
          )}
          {t.sueldos.length > 0 && (
            <div className="mt-5 border-t border-carbon/10 pt-4 text-sm">
              <div className="mb-1.5 flex items-baseline justify-between">
                <p className="font-medium">Sueldos, por persona</p>
                <a href="/admin/gastos/sueldos" className="text-xs underline">Ver sueldos</a>
              </div>
              {t.sueldos.map((p) => (
                <p key={p.nombre} className="flex justify-between text-carbon-500">
                  <span>{p.nombre}</span><span className="tabular-nums text-carbon">{money(p.total)}</span>
                </p>
              ))}
            </div>
          )}
          {t.proveedores.length > 0 && (
            <div className="mt-5 border-t border-carbon/10 pt-4 text-sm">
              <p className="mb-1.5 font-medium">A quién se le pagó más</p>
              {t.proveedores.slice(0, 5).map((p) => (
                <p key={p.nombre} className="flex justify-between text-carbon-500">
                  <span>{p.nombre}</span><span className="tabular-nums text-carbon">{money(p.total)}</span>
                </p>
              ))}
            </div>
          )}
        </section>
      </div>

      {/* Lo más vendido */}
      <section className="panel mt-6 p-5">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <h2 className="font-display text-lg">Lo que más se vendió</h2>
          <div className="flex gap-1.5" role="group" aria-label="Ordenar por">
            {(['unidades', 'facturado'] as const).map((k) => (
              <button key={k} onClick={() => setVerProductos(k)} className={`chip ${verProductos === k ? 'chip-activo' : ''}`} aria-pressed={verProductos === k}>
                {k === 'unidades' ? 'Por unidades' : 'Por plata'}
              </button>
            ))}
          </div>
        </div>
        {productos.length === 0 ? (
          <p className="mt-3 text-sm text-carbon-500">Sin ventas cobradas en el período.</p>
        ) : (
          <div className="mt-4 grid gap-6 lg:grid-cols-[1.6fr_1fr]">
            <div>
              <ol className="space-y-2.5">
                {productosVisibles.map((p, i) => {
                  const valor = verProductos === 'unidades' ? p.unidades : p.facturado;
                  return (
                    <li key={p.nombre} className="grid grid-cols-[1.5rem_1fr] gap-2 text-sm" title={`${p.nombre}: ${p.unidades} unidades, ${money(p.facturado)}`}>
                      <span className="text-right tabular-nums text-carbon-500">{i + 1}</span>
                      <div>
                        <div className="flex items-baseline justify-between gap-3">
                          <span className="font-medium">{p.nombre}</span>
                          <span className="whitespace-nowrap tabular-nums">
                            {verProductos === 'unidades' ? `${p.unidades} u.` : money(p.facturado)}
                            <span className="text-carbon-500"> · {verProductos === 'unidades' ? money(p.facturado) : `${p.unidades} u.`}</span>
                          </span>
                        </div>
                        <div className="mt-1 h-1.5 rounded-sm bg-carbon/5">
                          <div className="h-1.5 rounded-r-[4px]" style={{ width: `${Math.max(2, (valor / maxProducto) * 100)}%`, background: ENTRO }} />
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ol>
              {productos.length > 10 && (
                <button onClick={() => setTodosProductos((v) => !v)} className="mt-3 text-sm underline">
                  {todosProductos ? 'Ver solo los 10 primeros' : `Ver los ${productos.length} productos`}
                </button>
              )}
              <p className="mt-3 text-xs text-carbon-500">A precio de carta: los códigos de descuento son por pedido y no se reparten entre productos.</p>
            </div>
            <div>
              <p className="mb-2 text-sm font-medium">Por categoría</p>
              <table className="w-full text-sm">
                <tbody className="divide-y divide-carbon/10">
                  {t.categorias.map((c) => (
                    <tr key={c.nombre}>
                      <td className="py-1.5">{c.nombre}</td>
                      <td className="py-1.5 text-right tabular-nums text-carbon-500">{c.unidades} u.</td>
                      <td className="py-1.5 text-right tabular-nums">{money(c.facturado)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </section>

      <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_1fr_0.8fr]">
        {/* Últimos cobros */}
        <section className="panel p-5">
          <div className="flex items-baseline justify-between">
            <h2 className="font-display text-lg">Últimos cobros</h2>
            <a href={exportar('cobros')} className="text-sm underline">Descargar todos</a>
          </div>
          {cobros.length === 0 ? <p className="mt-3 text-sm text-carbon-500">Sin cobros en el período.</p> : (
            <ul className="mt-3 divide-y divide-carbon/10 text-sm">
              {cobros.map((c) => (
                <li key={c.id} className="flex justify-between gap-3 py-2">
                  <span className="min-w-0">
                    <span className="font-medium">{c.code}</span>{' '}
                    <span className="text-carbon-500">
                      {ETIQUETA_PAGO[c.medio] ?? c.medio}
                      {c.original && ` (había elegido ${ETIQUETA_PAGO[c.original] ?? c.original})`}
                    </span>
                    <span className="block text-xs text-carbon-500">{c.cuando ? diaHora(c.cuando) : ''}{c.quien ? ` · ${c.quien}` : ''}</span>
                  </span>
                  <span className="whitespace-nowrap font-medium tabular-nums">{money(c.total)}</span>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* Últimos gastos */}
        <section className="panel p-5">
          <div className="flex items-baseline justify-between">
            <h2 className="font-display text-lg">Últimos gastos</h2>
            <a href={exportar('gastos')} className="text-sm underline">Descargar todos</a>
          </div>
          {gastos.length === 0 ? <p className="mt-3 text-sm text-carbon-500">Sin gastos en el período.</p> : (
            <ul className="mt-3 divide-y divide-carbon/10 text-sm">
              {gastos.map((g) => (
                <li key={g.id} className="flex justify-between gap-3 py-2">
                  <span className="min-w-0">
                    <span className="font-medium">{g.descripcion}</span>
                    <span className="block text-xs text-carbon-500">
                      {fechaCorta(g.fecha)} · {ETIQUETA_CATEGORIA[g.categoria] ?? g.categoria} · {g.quien}
                    </span>
                  </span>
                  <span className="whitespace-nowrap font-medium tabular-nums">{money(g.monto)}</span>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* Mermas y bajas */}
        <section className="panel p-5">
          <div className="flex items-baseline justify-between">
            <h2 className="font-display text-lg">Mermas</h2>
            <a href="/admin/mermas" className="text-sm underline">Anotar o ver</a>
          </div>
          {t.mermas.length === 0 ? (
            <p className="mt-3 text-sm text-carbon-500">No se anotaron mermas.</p>
          ) : (
            <>
            <dl className="mt-3 space-y-1 text-sm">
              {t.mermasPorTipo.map((m) => (
                <div key={m.tipo} className="flex justify-between">
                  <dt className="font-medium">{m.label}</dt>
                  <dd className="tabular-nums">{m.unidades} u.</dd>
                </div>
              ))}
            </dl>
            <p className="mt-4 text-xs font-medium text-carbon-500">Qué productos</p>
            <ul className="mt-1 divide-y divide-carbon/10 text-sm">
              {t.mermas.slice(0, 8).map((m) => (
                <li key={m.nombre} className="flex justify-between py-1.5">
                  <span>{m.nombre}</span>
                  <span className="tabular-nums">{m.unidades} u.</span>
                </li>
              ))}
            </ul>
            </>
          )}
          <dl className="mt-4 space-y-1 border-t border-carbon/10 pt-3 text-sm text-carbon-500">
            <div className="flex justify-between"><dt>Pedidos rechazados</dt><dd className="tabular-nums text-carbon">{t.bajas.rechazados}</dd></div>
            <div className="flex justify-between"><dt>Pedidos cancelados</dt><dd className="tabular-nums text-carbon">{t.bajas.cancelados}</dd></div>
            <div className="flex justify-between"><dt>No pagaron online</dt><dd className="tabular-nums text-carbon">{t.bajas.pagoOnlineNoCompletado}</dd></div>
          </dl>
        </section>
      </div>
    </div>
  );
}
