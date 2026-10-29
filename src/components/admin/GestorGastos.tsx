'use client';

import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { money } from '@/lib/money';
import { diaHora, claveDia } from '@/lib/tiempo';
import { cargarGasto, anularGasto } from '@/actions/gastos';
import { PestanasGastos } from './GestorSueldos';
import {
  CATEGORIAS_GASTO, FORMAS_PAGO_GASTO, ETIQUETA_CATEGORIA, ETIQUETA_PAGO_GASTO,
} from '@/lib/gastos-categorias';

type Gasto = {
  id: string; fecha: string; category: string; description: string; supplier: string | null;
  amount: number; payment: string; cargadoPor: string; createdById: string; cargadoEl: string;
  anulado: { el: string; por: string; motivo: string } | null;
};
type Resultado = {
  ventas: number; pedidos: number; gastos: number; cantidadGastos: number;
  resultado: number; margen: number | null; diferenciasCaja: number;
  porCategoria: { categoria: string; total: number; cantidad: number }[];
};

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

function nombreMes(mes: string) {
  const [y, m] = mes.split('-').map(Number);
  return `${MESES[m - 1]} ${y}`;
}
function moverMes(mes: string, delta: number) {
  const [y, m] = mes.split('-').map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}
/** "2026-10-05" → "05/10" */
function diaCorto(fecha: string) {
  const [, m, d] = fecha.split('-');
  return `${d}/${m}`;
}

/** Diferencia contra el mes anterior, en palabras: "$ 12.000 más que septiembre" */
function comparacion(actual: number, anterior: number, mesAnterior: string) {
  if (anterior === 0 && actual === 0) return null;
  const dif = actual - anterior;
  if (dif === 0) return `Igual que ${mesAnterior}`;
  return `${money(Math.abs(dif))} ${dif > 0 ? 'más' : 'menos'} que ${mesAnterior}`;
}

/**
 * Gastos del local: se cargan acá (o desde la caja, si salen del cajón), se
 * ven por mes y se comparan con lo vendido. El resultado es ventas menos
 * gastos cargados: si no se anota la mercadería, la ganancia sale inflada.
 */
export default function GestorGastos(props: {
  sucursal: string; mes: string; mesActual: string; hoy: string;
  resultado: Resultado; resultadoAnterior: Resultado; verResultado: boolean;
  puedeCargar: boolean; puedeAnular: boolean; userId: string;
  /** Si ve la pestaña de sueldos; si no, cuántos pagos de sueldos no se le muestran */
  verSueldos: boolean; sueldosOcultos: number;
  gastos: Gasto[];
}) {
  const { resultado: r, resultadoAnterior: ra, mes, gastos } = props;
  const router = useRouter();
  const [pendiente, startTransition] = useTransition();
  const [error, setError] = useState('');
  const [aviso, setAviso] = useState('');
  const [filtro, setFiltro] = useState<string>('');
  const [verAnulados, setVerAnulados] = useState(false);
  const [categoria, setCategoria] = useState<string>(CATEGORIAS_GASTO[0].id);
  const [formKey, setFormKey] = useState(0);

  const mesAnterior = nombreMes(moverMes(mes, -1)).split(' ')[0];
  const esMesActual = mes === props.mesActual;

  const visibles = useMemo(
    () => gastos.filter((g) => (verAnulados || !g.anulado) && (!filtro || g.category === filtro)),
    [gastos, filtro, verAnulados]
  );
  const totalVisible = visibles.filter((g) => !g.anulado).reduce((s, g) => s + g.amount, 0);
  const anulados = gastos.filter((g) => g.anulado).length;
  const maxCategoria = Math.max(1, ...r.porCategoria.map((c) => c.total));

  function cargar(fd: FormData) {
    setError('');
    setAviso('');
    startTransition(async () => {
      try {
        const res = await cargarGasto(fd);
        if (!res.ok) { setError(res.error); return; }
        setAviso(res.aviso ?? 'Gasto cargado.');
        setFormKey((k) => k + 1);
        router.refresh();
      } catch {
        setError('No se pudo guardar. Revisá la conexión.');
      }
    });
  }

  function anular(g: Gasto) {
    const motivo = prompt(`¿Por qué se anula "${g.description}" de ${money(g.amount)}?`);
    if (motivo === null) return;
    if (!motivo.trim()) { setError('Contá por qué se anula: queda en el registro'); return; }
    setError('');
    setAviso('');
    startTransition(async () => {
      try {
        const res = await anularGasto(g.id, motivo);
        if (!res.ok) { setError(res.error); return; }
        setAviso(res.aviso ?? 'Gasto anulado. Sigue en el registro, tachado.');
        router.refresh();
      } catch {
        setError('No se pudo anular. Revisá la conexión.');
      }
    });
  }

  /** El registro del mes en CSV, para el contador o una planilla */
  function exportar() {
    const filas = [
      ['Fecha', 'Categoría', 'Descripción', 'Proveedor', 'Forma de pago', 'Monto', 'Cargó', 'Anulado', 'Motivo de anulación'],
      ...gastos.map((g) => [
        g.fecha.split('-').reverse().join('/'),
        ETIQUETA_CATEGORIA[g.category] ?? g.category,
        g.description,
        g.supplier ?? '',
        ETIQUETA_PAGO_GASTO[g.payment] ?? g.payment,
        (g.amount / 100).toFixed(2).replace('.', ','),
        g.cargadoPor,
        g.anulado ? 'Sí' : 'No',
        g.anulado?.motivo ?? '',
      ]),
    ];
    const csv = filas.map((f) => f.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(';')).join('\r\n');
    // BOM para que Excel abra bien los acentos
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `gastos-${props.sucursal.toLowerCase().replace(/\s+/g, '-')}-${mes}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const ejemplo = CATEGORIAS_GASTO.find((c) => c.id === categoria)?.ejemplo;

  return (
    <div>
      {props.verSueldos && <PestanasGastos activa="gastos" />}
      {/* Encabezado con el mes */}
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl">Gastos · {props.sucursal}</h1>
          <div className="mt-2 flex items-center gap-2">
            <button
              onClick={() => router.push(`/admin/gastos?mes=${moverMes(mes, -1)}`)}
              className="rounded-lg border border-carbon/15 bg-white px-2.5 py-1 text-sm"
              aria-label="Mes anterior"
            >‹</button>
            <span className="min-w-[10rem] text-center font-semibold capitalize">{nombreMes(mes)}</span>
            <button
              onClick={() => router.push(`/admin/gastos?mes=${moverMes(mes, 1)}`)}
              disabled={esMesActual}
              className="rounded-lg border border-carbon/15 bg-white px-2.5 py-1 text-sm disabled:opacity-30"
              aria-label="Mes siguiente"
            >›</button>
            {!esMesActual && (
              <button onClick={() => router.push('/admin/gastos')} className="text-sm underline">Volver a este mes</button>
            )}
          </div>
        </div>
        <button onClick={exportar} disabled={gastos.length === 0} className="btn-fantasma px-4 py-2 text-sm">
          Descargar el registro (Excel)
        </button>
      </div>

      {/* El resultado del mes */}
      <section className={`grid gap-3 ${props.verResultado ? 'sm:grid-cols-3' : 'sm:grid-cols-1 sm:max-w-sm'}`} aria-label="Resultado del mes">
        {props.verResultado && (
          <div className="panel p-5">
            <p className="text-sm text-carbon-500">Entró</p>
            <p className="mt-1 font-display text-3xl tabular-nums">{money(r.ventas)}</p>
            <p className="mt-1 text-xs text-carbon-500">{r.pedidos} pedidos cobrados</p>
          </div>
        )}
        <div className="panel p-5">
          <p className="text-sm text-carbon-500">Gastos</p>
          <p className="mt-1 font-display text-3xl tabular-nums">{money(r.gastos)}</p>
          <p className="mt-1 text-xs text-carbon-500">
            {comparacion(r.gastos, ra.gastos, mesAnterior) ?? `${r.cantidadGastos} gastos cargados`}
          </p>
        </div>
        {props.verResultado && (
          <div className={`panel p-5 ${r.resultado < 0 ? 'border-ladrillo/40 bg-ladrillo/5' : 'border-verde/30 bg-verde/5'}`}>
            <p className="text-sm text-carbon-500">{r.resultado < 0 ? 'Pérdida' : 'Ganancia'}</p>
            <p className={`mt-1 font-display text-3xl tabular-nums ${r.resultado < 0 ? 'text-ladrillo' : 'text-verde'}`}>
              {r.resultado < 0 ? '−' : ''}{money(Math.abs(r.resultado))}
            </p>
            <p className="mt-1 text-xs text-carbon-500">
              {r.margen === null
                ? 'Sin ventas en el mes'
                : r.resultado < 0
                  ? 'Se gastó más de lo que se vendió'
                  : `Queda el ${r.margen.toLocaleString('es-AR')}% de lo vendido`}
              {comparacion(r.resultado, ra.resultado, mesAnterior) ? ` · ${comparacion(r.resultado, ra.resultado, mesAnterior)}` : ''}
            </p>
          </div>
        )}
      </section>
      {props.verResultado && (
        <p className="mt-2 text-xs text-carbon-500">
          Lo cobrado menos los gastos cargados
          {r.diferenciasCaja !== 0 && `, ${r.diferenciasCaja < 0 ? 'menos' : 'más'} ${money(Math.abs(r.diferenciasCaja))} de ${r.diferenciasCaja < 0 ? 'faltantes' : 'sobrantes'} de caja`}.
          Si falta cargar algún gasto (la mercadería, los sueldos), la ganancia sale más alta de lo que es. El tablero completo está en{' '}
          <a href="/admin/finanzas" className="underline">Finanzas</a>.
        </p>
      )}

      <div className="mt-6 grid gap-6 lg:grid-cols-[380px_1fr]">
        {/* Columna izquierda: cargar y por categoría */}
        <div className="space-y-6">
          {props.puedeCargar && (
            <section className="panel p-5">
              <h2 className="font-display text-lg">Cargar un gasto</h2>
              <form key={formKey} action={cargar} className="mt-3 space-y-3">
                <div className="grid grid-cols-[1fr_1.3fr] gap-2">
                  <div>
                    <label className="label" htmlFor="g-date">Fecha</label>
                    <input id="g-date" name="date" type="date" className="input" defaultValue={props.hoy} max={props.hoy} required />
                  </div>
                  <div>
                    <label className="label" htmlFor="g-amount">Monto</label>
                    <input id="g-amount" name="amount" className="input" inputMode="decimal" placeholder="120.000" required />
                  </div>
                </div>
                <div>
                  <label className="label" htmlFor="g-desc">Qué se compró o pagó</label>
                  <input id="g-desc" name="description" className="input" placeholder="Compra de pollo" required maxLength={200} />
                </div>
                <div>
                  <label className="label" htmlFor="g-cat">Categoría</label>
                  <select id="g-cat" name="category" className="input" value={categoria} onChange={(e) => setCategoria(e.target.value)}>
                    {CATEGORIAS_GASTO.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
                  </select>
                  {ejemplo && <p className="mt-1 text-xs text-carbon-500">Por ejemplo: {ejemplo}</p>}
                  {categoria === 'SUELDOS' && props.verSueldos && (
                    <p className="mt-1 text-xs text-carbon-500">Para pagarle a alguien del equipo, mejor desde la pestaña Sueldos: queda a su nombre y se ve cuánto le falta.</p>
                  )}
                </div>
                <div className="grid gap-3">
                  <div>
                    <label className="label" htmlFor="g-pago">Cómo se pagó</label>
                    <select id="g-pago" name="payment" className="input" defaultValue="EFECTIVO_CAJA">
                      {FORMAS_PAGO_GASTO.map((f) => <option key={f.id} value={f.id}>{f.label}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="label" htmlFor="g-prov">Proveedor</label>
                    <input id="g-prov" name="supplier" className="input" placeholder="Opcional" maxLength={100} />
                  </div>
                </div>
                <p className="text-xs text-carbon-500">
                  Si sale del efectivo de la caja y hay un turno abierto, también se descuenta de la caja.
                </p>
                {error && <p role="alert" className="rounded-lg bg-ladrillo/10 px-3 py-2 text-sm text-ladrillo">{error}</p>}
                {aviso && <p role="status" className="rounded-lg bg-verde/10 px-3 py-2 text-sm text-verde">{aviso}</p>}
                <button disabled={pendiente} className="btn-primario w-full py-2.5">
                  {pendiente ? 'Guardando...' : 'Cargar gasto'}
                </button>
              </form>
            </section>
          )}

          <section className="panel p-5">
            <h2 className="font-display text-lg">En qué se gastó</h2>
            {r.porCategoria.length === 0 ? (
              <p className="mt-3 text-sm text-carbon-500">Todavía no hay gastos cargados en {nombreMes(mes)}.</p>
            ) : (
              <ul className="mt-4 space-y-3">
                {r.porCategoria.map((c) => {
                  const porcentaje = r.gastos > 0 ? Math.round((c.total / r.gastos) * 100) : 0;
                  const activo = filtro === c.categoria;
                  return (
                    <li key={c.categoria}>
                      <button
                        onClick={() => setFiltro(activo ? '' : c.categoria)}
                        className={`group w-full rounded-lg p-1 text-left ${activo ? 'bg-carbon/5' : 'hover:bg-carbon/5'}`}
                        aria-pressed={activo}
                        title={`${ETIQUETA_CATEGORIA[c.categoria] ?? c.categoria}: ${money(c.total)} en ${c.cantidad} ${c.cantidad === 1 ? 'gasto' : 'gastos'} (${porcentaje}% del total)`}
                      >
                        <div className="flex items-baseline justify-between gap-3 text-sm">
                          <span className="font-medium">{ETIQUETA_CATEGORIA[c.categoria] ?? c.categoria}</span>
                          <span className="tabular-nums">
                            {money(c.total)} <span className="text-carbon-500">· {porcentaje}%</span>
                          </span>
                        </div>
                        <div className="mt-1.5 h-2 rounded-sm bg-carbon/5">
                          <div
                            className="h-2 rounded-r-[4px] bg-marca transition-[width]"
                            style={{ width: `${Math.max(2, (c.total / maxCategoria) * 100)}%` }}
                          />
                        </div>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
            {r.porCategoria.length > 0 && (
              <p className="mt-3 text-xs text-carbon-500">Tocá una categoría para ver solo esos gastos.</p>
            )}
          </section>
        </div>

        {/* El registro */}
        <section className="panel min-w-0 p-5">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="font-display text-lg">
              Registro{filtro ? ` · ${ETIQUETA_CATEGORIA[filtro]}` : ''}
            </h2>
            <div className="flex items-center gap-4 text-sm">
              {filtro && <button onClick={() => setFiltro('')} className="underline">Ver todas las categorías</button>}
              {anulados > 0 && (
                <label className="flex items-center gap-1.5">
                  <input type="checkbox" checked={verAnulados} onChange={(e) => setVerAnulados(e.target.checked)} />
                  Mostrar anulados ({anulados})
                </label>
              )}
            </div>
          </div>

          {props.sueldosOcultos > 0 && (
            <p className="mt-3 text-xs text-carbon-500">
              {props.sueldosOcultos} {props.sueldosOcultos === 1 ? 'pago de sueldo no se muestra' : 'pagos de sueldos no se muestran'}: los ve solo quien tiene permiso de sueldos. Sí suman en los totales.
            </p>
          )}
          {visibles.length === 0 ? (
            <p className="mt-6 text-sm text-carbon-500">
              {gastos.length === 0
                ? `No hay gastos en ${nombreMes(mes)}. ${props.puedeCargar ? 'Cargá el primero con el formulario.' : ''}`
                : 'No hay gastos con ese filtro.'}
            </p>
          ) : (
            <>
              <table className="mt-4 w-full text-sm">
                <thead className="hidden text-left text-xs text-carbon-500 md:table-header-group">
                  <tr className="border-b border-carbon/10">
                    <th className="py-2 pr-3 font-medium">Fecha</th>
                    <th className="py-2 pr-3 font-medium">Detalle</th>
                    <th className="py-2 pr-3 font-medium">Pago</th>
                    <th className="py-2 pr-3 text-right font-medium">Monto</th>
                    <th className="py-2"><span className="sr-only">Acciones</span></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-carbon/10">
                  {visibles.map((g) => {
                    const propioDeHoy = g.createdById === props.userId && claveDia(new Date(g.cargadoEl)) === props.hoy;
                    const puedeAnularEste = !g.anulado && (props.puedeAnular || (props.puedeCargar && propioDeHoy));
                    return (
                      <tr key={g.id} className={`grid grid-cols-[auto_1fr_auto] gap-x-3 py-3 md:table-row ${g.anulado ? 'text-carbon-500' : ''}`}>
                        <td className="whitespace-nowrap align-top tabular-nums md:py-3 md:pr-3">{diaCorto(g.fecha)}</td>
                        <td className="min-w-0 align-top md:py-3 md:pr-3">
                          <p className={`font-medium ${g.anulado ? 'line-through' : ''}`}>{g.description}</p>
                          <p className="text-xs text-carbon-500">
                            {ETIQUETA_CATEGORIA[g.category] ?? g.category}
                            {g.supplier ? `, ${g.supplier}` : ''}. Cargó {g.cargadoPor}
                          </p>
                          {g.anulado && (
                            <p className="mt-1 text-xs text-ladrillo">
                              Anulado por {g.anulado.por} el {diaHora(g.anulado.el)}: {g.anulado.motivo}
                            </p>
                          )}
                        </td>
                        <td className="col-start-2 align-top text-xs text-carbon-500 md:col-auto md:py-3 md:pr-3 md:text-sm">
                          {ETIQUETA_PAGO_GASTO[g.payment] ?? g.payment}
                        </td>
                        <td className={`col-start-3 row-start-1 whitespace-nowrap text-right align-top font-semibold tabular-nums md:py-3 md:pr-3 ${g.anulado ? 'line-through' : ''}`}>
                          {money(g.amount)}
                        </td>
                        <td className="col-start-3 text-right align-top md:py-3">
                          {puedeAnularEste && (
                            <button disabled={pendiente} onClick={() => anular(g)} className="text-xs text-carbon-500 underline">
                              Anular
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <p className="mt-4 flex justify-between border-t border-carbon/10 pt-3 text-sm font-semibold">
                <span>Total{filtro ? ` en ${ETIQUETA_CATEGORIA[filtro]}` : ''}</span>
                <span className="tabular-nums">{money(totalVisible)}</span>
              </p>
            </>
          )}
        </section>
      </div>
    </div>
  );
}
