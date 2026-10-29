'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { guardarPersonal, archivarPersonal, pagarSueldo } from '@/actions/sueldos';
import { anularGasto } from '@/actions/gastos';
import { money, fromCents } from '@/lib/money';
import { TIPOS_PAGO_SUELDO, ETIQUETA_PAGO_SUELDO, cuentaParaElSueldo, nombreDelMes } from '@/lib/sueldos';
import { ETIQUETA_PAGO_GASTO } from '@/lib/gastos-categorias';

type Persona = { id: string; name: string; role: string; salary: number | null; userId: string | null; usuario: string | null; active: boolean };
type Pago = {
  id: string; staffId: string; tipo: string; amount: number; fecha: string; description: string; payment: string;
  cargadoPor: string; createdById: string; cargadoEl: string; anulado: boolean;
};
type Props = {
  sucursal: string; mes: string; mesActual: string; hoy: string;
  personal: Persona[]; pagos: Pago[]; usuarios: { id: string; name: string }[];
  pagadoEnElMes: number; formasPago: { id: string; label: string }[];
  puedePagar: boolean; puedeAnular: boolean; userId: string;
};

const moverMes = (mes: string, delta: number) => {
  const d = new Date(Number(mes.slice(0, 4)), Number(mes.slice(5)) - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};
const diaCorto = (f: string) => f.slice(8, 10) + '/' + f.slice(5, 7);

/** Las pestañas de arriba de Gastos: el registro general y los sueldos. */
export function PestanasGastos({ activa }: { activa: 'gastos' | 'sueldos' }) {
  return (
    <nav className="mb-5 flex gap-2" aria-label="Gastos">
      <Link href="/admin/gastos" aria-current={activa === 'gastos' ? 'page' : undefined} className={`chip ${activa === 'gastos' ? 'chip-activo' : ''}`}>Gastos</Link>
      <Link href="/admin/gastos/sueldos" aria-current={activa === 'sueldos' ? 'page' : undefined} className={`chip ${activa === 'sueldos' ? 'chip-activo' : ''}`}>Sueldos</Link>
    </nav>
  );
}

/**
 * Sueldos del mes: cuánto cobra cada uno, qué se le pagó (sueldo, adelantos,
 * aguinaldo...) y cuánto le falta. Cada pago queda como gasto de Sueldos.
 */
export default function GestorSueldos(props: Props) {
  const { mes, personal, pagos, puedePagar } = props;
  const router = useRouter();
  const [dialogo, setDialogo] = useState<{ tipo: 'pagar'; persona: Persona } | { tipo: 'persona'; persona?: Persona } | null>(null);
  const [abierto, setAbierto] = useState<string | null>(null);
  const [aviso, setAviso] = useState('');
  const [error, setError] = useState('');
  const [pendiente, startTransition] = useTransition();
  const esMesActual = mes === props.mesActual;

  const validos = pagos.filter((p) => !p.anulado);
  const resumen = (id: string) => {
    const suyos = validos.filter((p) => p.staffId === id);
    const aCuenta = suyos.filter((p) => cuentaParaElSueldo(p.tipo)).reduce((s, p) => s + p.amount, 0);
    const extras = suyos.filter((p) => !cuentaParaElSueldo(p.tipo)).reduce((s, p) => s + p.amount, 0);
    const persona = personal.find((p) => p.id === id);
    const falta = persona?.salary ? Math.max(0, persona.salary - aCuenta) : null;
    return { aCuenta, extras, falta, cantidad: suyos.length };
  };
  const activos = personal.filter((p) => p.active);
  const acordado = activos.reduce((s, p) => s + (p.salary ?? 0), 0);
  const pagadoDelMes = validos.reduce((s, p) => s + p.amount, 0);
  const falta = activos.reduce((s, p) => s + (resumen(p.id).falta ?? 0), 0);

  function listo(texto: string) {
    setDialogo(null);
    setError('');
    setAviso(texto);
    router.refresh();
  }

  function anular(p: Pago) {
    const motivo = prompt(`¿Por qué se anula "${p.description}" de ${money(p.amount)}?`);
    if (motivo === null) return;
    if (!motivo.trim()) { setError('Contá por qué se anula: queda en el registro'); return; }
    startTransition(async () => {
      const r = await anularGasto(p.id, motivo);
      if (!r.ok) { setError(r.error); return; }
      listo(r.aviso ?? 'Pago anulado. Sigue en el registro, tachado.');
    });
  }

  return (
    <div>
      <PestanasGastos activa="sueldos" />
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl">Sueldos · {props.sucursal}</h1>
          <div className="mt-2 flex items-center gap-2">
            <button onClick={() => router.push(`/admin/gastos/sueldos?mes=${moverMes(mes, -1)}`)} className="rounded-lg border border-carbon/15 bg-white px-2.5 py-1 text-sm" aria-label="Mes anterior">‹</button>
            <span className="min-w-[10rem] text-center font-semibold capitalize">{nombreDelMes(mes)}</span>
            <button onClick={() => router.push(`/admin/gastos/sueldos?mes=${moverMes(mes, 1)}`)} disabled={esMesActual} className="rounded-lg border border-carbon/15 bg-white px-2.5 py-1 text-sm disabled:opacity-30" aria-label="Mes siguiente">›</button>
          </div>
        </div>
        {puedePagar && <button onClick={() => setDialogo({ tipo: 'persona' })} className="btn-fantasma px-4 py-2 text-sm">+ Agregar persona</button>}
      </div>

      <section className="mb-6 grid gap-3 sm:grid-cols-3" aria-label="Resumen del mes">
        <div className="panel p-5">
          <p className="text-sm text-carbon-500">Sueldos acordados</p>
          <p className="mt-1 font-display text-3xl tabular-nums">{money(acordado)}</p>
          <p className="mt-1 text-xs text-carbon-500">{activos.length} {activos.length === 1 ? 'persona' : 'personas'}</p>
        </div>
        <div className="panel p-5">
          <p className="text-sm text-carbon-500">Pagado de {nombreDelMes(mes).split(' ')[0]}</p>
          <p className="mt-1 font-display text-3xl tabular-nums">{money(pagadoDelMes)}</p>
          <p className="mt-1 text-xs text-carbon-500">Con adelantos, aguinaldo y extras</p>
        </div>
        <div className={`panel p-5 ${falta > 0 ? 'border-rojo/30 bg-rojo/5' : ''}`}>
          <p className="text-sm text-carbon-500">Falta pagar</p>
          <p className="mt-1 font-display text-3xl tabular-nums">{money(falta)}</p>
          <p className="mt-1 text-xs text-carbon-500">De los sueldos acordados</p>
        </div>
      </section>
      <p className="mb-5 text-xs text-carbon-500">
        Cada pago queda en Gastos (categoría Sueldos) con la fecha en que se pagó; por eso entra en el resultado del mes en que salió la plata. En {nombreDelMes(mes).split(' ')[0]} salieron {money(props.pagadoEnElMes)} en sueldos, sean del mes que sean.
      </p>

      {aviso && <p role="status" className="mb-4 rounded-lg bg-verde/10 px-3 py-2 text-sm text-verde">{aviso}</p>}
      {error && <p role="alert" className="mb-4 rounded-lg bg-ladrillo/10 px-3 py-2 text-sm text-ladrillo">{error}</p>}

      {personal.length === 0 ? (
        <div className="panel p-6 text-sm text-carbon-500">
          Todavía no hay nadie cargado. {puedePagar && 'Agregá a cada persona del equipo con su sueldo mensual (o sin sueldo, si cobra por día).'}
        </div>
      ) : (
        <div className="panel overflow-hidden">
          <ul className="divide-y divide-carbon/10">
            {personal.map((p) => {
              const r = resumen(p.id);
              const suyos = pagos.filter((x) => x.staffId === p.id);
              return (
                <li key={p.id} className={p.active ? '' : 'opacity-60'}>
                  <div className="flex flex-wrap items-center gap-x-6 gap-y-3 px-5 py-4">
                    <button onClick={() => setAbierto(abierto === p.id ? null : p.id)} aria-expanded={abierto === p.id} className="min-w-[12rem] flex-1 text-left">
                      <p className="font-semibold">{p.name}{!p.active && <span className="ml-2 text-xs font-normal">(ya no trabaja)</span>}</p>
                      <p className="mt-0.5 text-xs text-carbon-500">
                        {[p.role, p.salary ? `${money(p.salary)} por mes` : 'Sin sueldo fijo', p.usuario ? `Usuario: ${p.usuario}` : ''].filter(Boolean).join(' · ')}
                      </p>
                    </button>
                    <dl className="grid grid-cols-3 gap-4 text-sm">
                      <div><dt className="text-xs text-carbon-500">Cobró</dt><dd className="tabular-nums">{money(r.aCuenta)}</dd></div>
                      <div><dt className="text-xs text-carbon-500">Extras</dt><dd className="tabular-nums">{money(r.extras)}</dd></div>
                      <div>
                        <dt className="text-xs text-carbon-500">Falta</dt>
                        <dd className={`font-semibold tabular-nums ${r.falta ? 'text-ladrillo' : ''}`}>{r.falta === null ? '—' : money(r.falta)}</dd>
                      </div>
                    </dl>
                    {puedePagar && (
                      <div className="flex gap-2">
                        {p.active && <button onClick={() => setDialogo({ tipo: 'pagar', persona: p })} className="btn-primario px-4 py-1.5 text-sm">Pagar</button>}
                        <button onClick={() => setDialogo({ tipo: 'persona', persona: p })} className="px-2 py-1.5 text-sm underline">Editar</button>
                      </div>
                    )}
                  </div>
                  {abierto === p.id && (
                    <div className="bg-crema-200/50 px-5 pb-4 pt-1">
                      {suyos.length === 0 ? (
                        <p className="text-sm text-carbon-500">Sin pagos de {nombreDelMes(mes)}.</p>
                      ) : (
                        <ul className="space-y-1.5 text-sm">
                          {suyos.map((x) => {
                            const puedeAnularEste = props.puedeAnular || (x.createdById === props.userId && x.cargadoEl.slice(0, 10) === props.hoy);
                            return (
                              <li key={x.id} className={`flex flex-wrap items-baseline gap-x-3 ${x.anulado ? 'text-carbon-500 line-through' : ''}`}>
                                <span className="w-12 text-xs text-carbon-500">{diaCorto(x.fecha)}</span>
                                <span className="font-medium">{ETIQUETA_PAGO_SUELDO[x.tipo] ?? x.tipo}</span>
                                <span className="tabular-nums">{money(x.amount)}</span>
                                <span className="text-xs text-carbon-500">{ETIQUETA_PAGO_GASTO[x.payment] ?? x.payment} · cargó {x.cargadoPor}</span>
                                {!x.anulado && puedeAnularEste && (
                                  <button onClick={() => anular(x)} disabled={pendiente} className="text-xs underline">Anular</button>
                                )}
                              </li>
                            );
                          })}
                        </ul>
                      )}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {dialogo?.tipo === 'pagar' && (
        <DialogoPago
          persona={dialogo.persona}
          falta={resumen(dialogo.persona.id).falta}
          mes={mes}
          hoy={props.hoy}
          formasPago={props.formasPago}
          onCerrar={() => setDialogo(null)}
          onHecho={listo}
        />
      )}
      {dialogo?.tipo === 'persona' && (
        <DialogoPersona persona={dialogo.persona} usuarios={props.usuarios} onCerrar={() => setDialogo(null)} onHecho={listo} />
      )}
    </div>
  );
}

function Dialogo({ titulo, children, onCerrar }: { titulo: string; children: React.ReactNode; onCerrar: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-carbon/50 sm:items-center sm:p-4" onClick={onCerrar}>
      <div className="max-h-[94vh] w-full overflow-y-auto rounded-t-2xl bg-crema p-6 sm:max-w-md sm:rounded-2xl" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label={titulo}>
        <h3 className="font-display text-xl">{titulo}</h3>
        {children}
      </div>
    </div>
  );
}

function DialogoPago({ persona, falta, mes, hoy, formasPago, onCerrar, onHecho }: {
  persona: Persona; falta: number | null; mes: string; hoy: string; formasPago: Props['formasPago'];
  onCerrar: () => void; onHecho: (t: string) => void;
}) {
  const [tipo, setTipo] = useState('SUELDO');
  const [monto, setMonto] = useState(falta ? fromCents(falta) : '');
  const [fecha, setFecha] = useState(hoy);
  const [periodo, setPeriodo] = useState(mes);
  const [pago, setPago] = useState('EFECTIVO');
  const [nota, setNota] = useState('');
  const [error, setError] = useState('');
  const [pendiente, startTransition] = useTransition();
  const meses = [moverMes(hoy.slice(0, 7), -2), moverMes(hoy.slice(0, 7), -1), hoy.slice(0, 7)];
  if (!meses.includes(mes)) meses.unshift(mes);

  return (
    <Dialogo titulo={`Pagarle a ${persona.name}`} onCerrar={onCerrar}>
      {persona.salary ? (
        <p className="mt-1 text-sm text-carbon-500">Sueldo {money(persona.salary)} · le falta {money(falta ?? 0)} de {nombreDelMes(mes)}</p>
      ) : null}
      <form
        className="mt-4 space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          setError('');
          startTransition(async () => {
            try {
              const r = await pagarSueldo({ staffId: persona.id, tipo, monto, fecha, periodo, pago, nota });
              if (!r.ok) { setError(r.error); return; }
              onHecho([`Anotado: ${ETIQUETA_PAGO_SUELDO[tipo].toLowerCase()} de ${persona.name}. Quedó en Gastos.`, r.aviso].filter(Boolean).join(' '));
            } catch {
              setError('No se pudo guardar. Revisá la conexión.');
            }
          });
        }}
      >
        <div className="grid grid-cols-2 gap-2">
          {TIPOS_PAGO_SUELDO.map((t) => (
            <button
              key={t.id}
              type="button"
              aria-pressed={tipo === t.id}
              onClick={() => { setTipo(t.id); if (t.id === 'SUELDO' && falta) setMonto(fromCents(falta)); }}
              className={`rounded-lg border px-3 py-2 text-left text-sm font-medium ${tipo === t.id ? 'border-marca bg-marca text-crema' : 'border-carbon/15 bg-white'}`}
            >
              {t.label}
            </button>
          ))}
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label" htmlFor="s-monto">Monto</label>
            <input id="s-monto" className="input text-lg" inputMode="decimal" value={monto} onChange={(e) => setMonto(e.target.value)} placeholder="$ 0" autoFocus />
          </div>
          <div>
            <label className="label" htmlFor="s-periodo">De qué mes</label>
            <select id="s-periodo" className="input" value={periodo} onChange={(e) => setPeriodo(e.target.value)}>
              {meses.map((m) => <option key={m} value={m}>{nombreDelMes(m)}</option>)}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="s-fecha">Se pagó el</label>
            <input id="s-fecha" type="date" className="input" value={fecha} max={hoy} onChange={(e) => setFecha(e.target.value)} />
          </div>
          <div>
            <label className="label" htmlFor="s-pago">Cómo</label>
            <select id="s-pago" className="input" value={pago} onChange={(e) => setPago(e.target.value)}>
              {formasPago.map((f) => <option key={f.id} value={f.id}>{f.label}</option>)}
            </select>
          </div>
        </div>
        <div>
          <label className="label" htmlFor="s-nota">Nota <span className="font-normal text-carbon-500">(opcional)</span></label>
          <input id="s-nota" className="input" value={nota} onChange={(e) => setNota(e.target.value)} maxLength={80} placeholder="Primera quincena, 6 horas extra..." />
        </div>
        <p className="text-xs text-carbon-500">Sueldo y adelantos se descuentan de lo que le falta cobrar del mes; lo demás va aparte.</p>
        {error && <p role="alert" className="rounded-lg bg-ladrillo/10 px-3 py-2 text-sm text-ladrillo">{error}</p>}
        <div className="flex gap-3">
          <button type="button" onClick={onCerrar} className="btn-fantasma flex-1 py-2.5">Cancelar</button>
          <button type="submit" disabled={pendiente} className="btn-primario flex-1 py-2.5">{pendiente ? 'Guardando...' : 'Anotar pago'}</button>
        </div>
      </form>
    </Dialogo>
  );
}

function DialogoPersona({ persona, usuarios, onCerrar, onHecho }: {
  persona?: Persona; usuarios: Props['usuarios']; onCerrar: () => void; onHecho: (t: string) => void;
}) {
  const [nombre, setNombre] = useState(persona?.name ?? '');
  const [puesto, setPuesto] = useState(persona?.role ?? '');
  const [sueldo, setSueldo] = useState(persona?.salary ? fromCents(persona.salary) : '');
  const [userId, setUserId] = useState(persona?.userId ?? '');
  const [error, setError] = useState('');
  const [pendiente, startTransition] = useTransition();

  return (
    <Dialogo titulo={persona ? `Editar ${persona.name}` : 'Agregar persona'} onCerrar={onCerrar}>
      <form
        className="mt-4 space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          setError('');
          startTransition(async () => {
            try {
              const r = await guardarPersonal({ id: persona?.id, nombre, puesto, sueldo, userId: userId || null });
              if (!r.ok) { setError(r.error); return; }
              onHecho(persona ? 'Guardado.' : `${nombre.trim()} agregado.`);
            } catch {
              setError('No se pudo guardar. Revisá la conexión.');
            }
          });
        }}
      >
        <div>
          <label className="label" htmlFor="p-nombre">Nombre</label>
          <input id="p-nombre" className="input" value={nombre} onChange={(e) => setNombre(e.target.value)} maxLength={80} autoFocus />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label" htmlFor="p-puesto">Puesto</label>
            <input id="p-puesto" className="input" value={puesto} onChange={(e) => setPuesto(e.target.value)} maxLength={40} placeholder="Pizzero, moza..." />
          </div>
          <div>
            <label className="label" htmlFor="p-sueldo">Sueldo por mes</label>
            <input id="p-sueldo" className="input" inputMode="decimal" value={sueldo} onChange={(e) => setSueldo(e.target.value)} placeholder="Vacío si cobra por día" />
          </div>
        </div>
        <div>
          <label className="label" htmlFor="p-user">Usuario del sistema <span className="font-normal text-carbon-500">(opcional)</span></label>
          <select id="p-user" className="input" value={userId} onChange={(e) => setUserId(e.target.value)}>
            <option value="">No tiene</option>
            {usuarios.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
          </select>
        </div>
        {error && <p role="alert" className="rounded-lg bg-ladrillo/10 px-3 py-2 text-sm text-ladrillo">{error}</p>}
        <div className="flex gap-3">
          <button type="button" onClick={onCerrar} className="btn-fantasma flex-1 py-2.5">Cancelar</button>
          <button type="submit" disabled={pendiente} className="btn-primario flex-1 py-2.5">{pendiente ? 'Guardando...' : 'Guardar'}</button>
        </div>
        {persona && (
          <button
            type="button"
            className="text-sm underline"
            onClick={() => startTransition(async () => {
              const r = await archivarPersonal(persona.id, !persona.active);
              if (r.ok) onHecho(persona.active ? `${persona.name} ya no figura en la lista. Sus pagos quedan.` : 'Volvió a la lista.');
              else setError(r.error);
            })}
          >
            {persona.active ? 'Ya no trabaja acá' : 'Volver a la lista'}
          </button>
        )}
      </form>
    </Dialogo>
  );
}
