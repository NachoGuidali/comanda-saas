'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import {
  Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import { money } from '@/lib/money';

type Resumen = {
  ingresos: number; subtotal: number; envios: number; descuentos: number;
  pedidos: number; ticketPromedio: number; cancelados: number; pagoOnlineNoCompletado: number;
};
type Ranking = { name: string; unidades: number; facturado: number }[];
type Serie = { fecha: string; ingresos: number; pedidos: number }[];
type Horas = { hora: number; pedidos: number; ingresos: number }[];
type Cortes = {
  porTipo: { type: string; _count: number; _sum: { total: number | null } }[];
  porCanal: { source: string; _count: number; _sum: { total: number | null } }[];
  porPago: { paymentMethod: string; _count: number; _sum: { total: number | null } }[];
};
type Tiempos = { aceptacion: number; cocina: number; reparto: number; total: number; muestras: number };
type Cliente = { telefono: string; nombre: string; pedidos: number; gastado: number; ultimo: string }[];

const RANGOS = [
  ['hoy', 'Hoy'], ['ayer', 'Ayer'], ['7dias', '7 días'],
  ['30dias', '30 días'], ['mes', 'Este mes'], ['anio', 'Este año'],
  ['personalizado', 'Elegir fechas'],
] as const;

const ETIQUETAS: Record<string, string> = {
  DELIVERY: 'Envío', TAKEAWAY: 'Retiro', SALON: 'Salón',
  WEB: 'Carta web', WHATSAPP: 'WhatsApp', MOSTRADOR: 'Mostrador o teléfono',
  EFECTIVO: 'Efectivo', TRANSFERENCIA: 'Transferencia', TARJETA_ENTREGA: 'Tarjeta', MERCADO_PAGO: 'Mercado Pago',
};

export default function PanelReportes(props: {
  sucursal: string;
  preset: string; desde: string; hasta: string; tipo: string; canal: string;
  resumen: Resumen; ranking: Ranking; serie: Serie; horas: Horas;
  cortes: Cortes; tiempos: Tiempos; mermas: { unidades: number; registros: number };
  clientes: Cliente; criticos: number;
  resultado: { gastos: number; resultado: number; margen: number | null } | null;
}) {
  const router = useRouter();
  const params = useSearchParams();

  function actualizar(cambios: Record<string, string>) {
    const p = new URLSearchParams(params.toString());
    Object.entries(cambios).forEach(([k, v]) => (v ? p.set(k, v) : p.delete(k)));
    router.push(`/admin/reportes?${p.toString()}`);
  }

  const { resumen: r, tiempos: t } = props;
  const maxRanking = Math.max(1, ...props.ranking.map((x) => x.unidades));

  return (
    <div>
      <div className="mb-5">
        <h1 className="font-display text-2xl font-extrabold">Reportes</h1>
        <p className="mt-1 text-sm text-carbon-500">
          Cómo funciona el local: pedidos entregados, horarios y tiempos. La plata que entró, los gastos y la ganancia están en{' '}
          <a href="/admin/finanzas" className="underline">Finanzas</a>.
        </p>
      </div>

      {/* Parámetros */}
      <div className="panel mb-6 p-4">
        <div className="scroll-fino flex gap-2 overflow-x-auto">
          {RANGOS.map(([id, label]) => (
            <button
              key={id}
              onClick={() => actualizar({ rango: id })}
              className={`chip ${props.preset === id ? 'chip-activo' : ''}`}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="mt-3 flex flex-wrap gap-3">
          {props.preset === 'personalizado' && (
            <>
              <input
                type="date"
                className="input max-w-[11rem]"
                defaultValue={props.desde}
                onChange={(e) => actualizar({ rango: 'personalizado', desde: e.target.value })}
              />
              <input
                type="date"
                className="input max-w-[11rem]"
                defaultValue={props.hasta}
                onChange={(e) => actualizar({ rango: 'personalizado', hasta: e.target.value })}
              />
            </>
          )}
          <select className="input max-w-[11rem]" value={props.tipo} onChange={(e) => actualizar({ tipo: e.target.value })}>
            <option value="TODOS">Todos los tipos</option>
            <option value="DELIVERY">Solo envíos</option>
            <option value="TAKEAWAY">Solo retiros</option>
            <option value="SALON">Solo salón</option>
          </select>
          <select className="input max-w-[13rem]" value={props.canal} onChange={(e) => actualizar({ canal: e.target.value })}>
            <option value="TODOS">Todos los canales</option>
            <option value="WEB">Carta web</option>
            <option value="MOSTRADOR">Mostrador o teléfono</option>
            <option value="WHATSAPP">WhatsApp</option>
          </select>
        </div>
      </div>

      {/* Números principales */}
      <div className="mb-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Tarjeta titulo="Vendido" valor={money(r.ingresos)} pie={`${r.pedidos} pedidos entregados`} />
        <Tarjeta titulo="Ticket promedio" valor={money(r.ticketPromedio)} pie={`Envíos: ${money(r.envios)}`} />
        <Tarjeta
          titulo="Descuentos aplicados"
          valor={money(r.descuentos)}
          pie={`${r.cancelados} cancelados o rechazados${r.pagoOnlineNoCompletado ? ` · ${r.pagoOnlineNoCompletado} sin pagar online` : ''}`}
        />
        <Tarjeta
          titulo="Mermas"
          valor={`${props.mermas.unidades} ${props.mermas.unidades === 1 ? 'unidad' : 'unidades'}`}
          pie={props.criticos > 0 ? `${props.criticos} productos con stock bajo` : 'Stock sin alertas'}
          alerta={props.criticos > 0}
        />
      </div>

      {/* Lo vendido contra lo gastado */}
      {props.resultado ? (
        <div className="mb-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <Tarjeta
            titulo="Gastos cargados"
            valor={money(props.resultado.gastos)}
            pie="Mercadería, sueldos, servicios y demás"
          />
          <Tarjeta
            titulo={props.resultado.resultado < 0 ? 'Pérdida' : 'Ganancia'}
            valor={`${props.resultado.resultado < 0 ? '−' : ''}${money(Math.abs(props.resultado.resultado))}`}
            pie={
              props.resultado.margen === null
                ? 'Sin ventas en el período'
                : props.resultado.resultado < 0
                  ? 'Se gastó más de lo que se vendió'
                  : `Queda el ${props.resultado.margen.toLocaleString('es-AR')}% de lo vendido`
            }
            alerta={props.resultado.resultado < 0}
          />
          <a href="/admin/finanzas" className="panel flex items-center p-5 text-sm text-carbon-500 underline sm:col-span-2">
            Lo cobrado menos los gastos cargados, con las diferencias de caja. El detalle está en Finanzas.
          </a>
        </div>
      ) : (
        <p className="mb-6 text-sm text-carbon-500">
          La ganancia se calcula con todas las ventas: sacá el filtro de tipo y canal para verla.
        </p>
      )}

      {/* Evolución */}
      <section className="panel mb-6 p-5">
        <h2 className="font-display text-lg font-bold">Evolución diaria</h2>
        <div className="mt-4 h-64">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={props.serie}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(23,22,20,.08)" />
              <XAxis
                dataKey="fecha"
                tick={{ fontSize: 11 }}
                tickFormatter={(v: string) => v.slice(8) + '/' + v.slice(5, 7)}
              />
              <YAxis tick={{ fontSize: 11 }} tickFormatter={(v: number) => String(Math.round(v / 100))} width={45} />
              <Tooltip
                formatter={(v: number) => money(v)}
                labelFormatter={(v: string) => new Date(v + 'T12:00').toLocaleDateString('es-AR')}
                contentStyle={{ borderRadius: 12, border: '1px solid rgba(23,22,20,.1)', fontSize: 13 }}
              />
              <Line type="monotone" dataKey="ingresos" stroke="#131313" strokeWidth={2} dot={false} name="Ingresos" />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </section>

      <div className="mb-6 grid gap-6 lg:grid-cols-2">
        {/* Horarios */}
        <section className="panel p-5">
          <h2 className="font-display text-lg font-bold">Cuándo entran los pedidos</h2>
          <p className="mt-1 text-sm text-carbon-500">Sirve para decidir cuánta gente poner en cada turno.</p>
          <div className="mt-4 h-56">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={props.horas}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(23,22,20,.08)" />
                <XAxis dataKey="hora" tick={{ fontSize: 11 }} tickFormatter={(h: number) => `${h}h`} />
                <YAxis tick={{ fontSize: 11 }} width={30} allowDecimals={false} />
                <Tooltip
                  formatter={(v: number) => [`${v} pedidos`, '']}
                  labelFormatter={(h: number) => `${h}:00 a ${h}:59`}
                  contentStyle={{ borderRadius: 12, border: '1px solid rgba(23,22,20,.1)', fontSize: 13 }}
                />
                <Bar dataKey="pedidos" fill="#D0202B" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </section>

        {/* Tiempos */}
        <section className="panel p-5">
          <h2 className="font-display text-lg font-bold">Tiempos de operación</h2>
          <p className="mt-1 text-sm text-carbon-500">
            Promedio sobre {t.muestras} pedidos entregados en el período.
          </p>
          <dl className="mt-4 space-y-3">
            {[
              ['Tardan en aceptarlo', t.aceptacion],
              ['Tarda la cocina', t.cocina],
              ['Tarda el reparto', t.reparto],
              ['Total de punta a punta', t.total],
            ].map(([label, valor]) => (
              <div key={label as string}>
                <div className="flex justify-between text-sm">
                  <dt>{label}</dt>
                  <dd className="font-semibold tabular-nums">{valor} min</dd>
                </div>
                <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-carbon/10">
                  <div
                    className="h-full rounded-full bg-marca"
                    style={{ width: `${Math.min(100, ((valor as number) / Math.max(1, t.total)) * 100)}%` }}
                  />
                </div>
              </div>
            ))}
          </dl>
        </section>
      </div>

      {/* Ranking */}
      <section className="panel mb-6 p-5">
        <h2 className="font-display text-lg font-bold">Lo que más se vende</h2>
        {props.ranking.length === 0 ? (
          <p className="mt-4 text-sm text-carbon-500">No hay ventas en este período.</p>
        ) : (
          <ol className="mt-4 space-y-2.5">
            {props.ranking.map((p, i) => (
              <li key={p.name} className="flex items-center gap-3 text-sm">
                <span className="w-5 text-right font-semibold text-carbon-500">{i + 1}</span>
                <span className="min-w-0 flex-1 truncate">{p.name}</span>
                <div className="hidden h-2 w-32 overflow-hidden rounded-full bg-carbon/10 sm:block">
                  <div className="h-full rounded-full bg-marca" style={{ width: `${(p.unidades / maxRanking) * 100}%` }} />
                </div>
                <span className="w-16 text-right font-semibold tabular-nums">{p.unidades}</span>
                <span className="w-24 text-right text-carbon-500 tabular-nums">{money(p.facturado)}</span>
              </li>
            ))}
          </ol>
        )}
      </section>

      {/* Cortes */}
      <div className="mb-6 grid gap-6 lg:grid-cols-3">
        {([
          ['Por tipo de pedido', props.cortes.porTipo.map((x) => ({ k: x.type, c: x._count, s: x._sum.total ?? 0 }))],
          ['Por canal', props.cortes.porCanal.map((x) => ({ k: x.source, c: x._count, s: x._sum.total ?? 0 }))],
          ['Por forma de pago', props.cortes.porPago.map((x) => ({ k: x.paymentMethod, c: x._count, s: x._sum.total ?? 0 }))],
        ] as const).map(([titulo, filas]) => {
          const total = filas.reduce((s, f) => s + f.s, 0) || 1;
          return (
            <section key={titulo} className="panel p-5">
              <h2 className="font-display text-base font-bold">{titulo}</h2>
              {filas.length === 0 ? (
                <p className="mt-3 text-sm text-carbon-500">Sin datos.</p>
              ) : (
                <ul className="mt-3 space-y-2.5 text-sm">
                  {filas.map((f) => (
                    <li key={f.k}>
                      <div className="flex justify-between">
                        <span>{ETIQUETAS[f.k] ?? f.k}</span>
                        <span className="font-semibold">{money(f.s)}</span>
                      </div>
                      <div className="mt-1 flex items-center gap-2">
                        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-carbon/10">
                          <div className="h-full rounded-full bg-rojo" style={{ width: `${(f.s / total) * 100}%` }} />
                        </div>
                        <span className="text-xs text-carbon-500">{f.c}</span>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          );
        })}
      </div>

      {/* Clientes */}
      <section className="panel p-5">
        <h2 className="font-display text-lg font-bold">Clientes que más gastaron</h2>
        <p className="mt-1 text-sm text-carbon-500">Para pensar promociones dirigidas o recuperar a los que dejaron de pedir.</p>
        {props.clientes.length === 0 ? (
          <p className="mt-4 text-sm text-carbon-500">Sin datos en este período.</p>
        ) : (
          <div className="scroll-fino mt-4 overflow-x-auto">
            <table className="w-full min-w-[520px] text-sm">
              <thead className="border-b border-carbon/10 text-left">
                <tr>
                  <th className="py-2 font-semibold">Cliente</th>
                  <th className="py-2 font-semibold">Teléfono</th>
                  <th className="py-2 text-right font-semibold">Pedidos</th>
                  <th className="py-2 text-right font-semibold">Gastado</th>
                  <th className="py-2 text-right font-semibold">Último</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-carbon/10">
                {props.clientes.map((c) => (
                  <tr key={c.telefono}>
                    <td className="py-2">{c.nombre}</td>
                    <td className="py-2 text-carbon-500">{c.telefono}</td>
                    <td className="py-2 text-right tabular-nums">{c.pedidos}</td>
                    <td className="py-2 text-right font-semibold tabular-nums">{money(c.gastado)}</td>
                    <td className="py-2 text-right text-carbon-500">
                      {new Date(c.ultimo).toLocaleDateString('es-AR')}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

function Tarjeta({ titulo, valor, pie, alerta }: { titulo: string; valor: string; pie: string; alerta?: boolean }) {
  return (
    <div className={`panel p-5 ${alerta ? 'border-ladrillo/30' : ''}`}>
      <p className="text-sm text-carbon-500">{titulo}</p>
      <p className="mt-1 font-display text-2xl font-extrabold">{valor}</p>
      <p className={`mt-1 text-xs ${alerta ? 'text-ladrillo' : 'text-carbon-500'}`}>{pie}</p>
    </div>
  );
}
