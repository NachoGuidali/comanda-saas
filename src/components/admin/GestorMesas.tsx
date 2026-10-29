'use client';

import { useMemo, useState, useTransition } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { guardarMesa, cambiarEstadoMesa, borrarMesa, reservarMesa, cambiarEstadoReserva } from '@/actions/operacion';
import { claveDia } from '@/lib/tiempo';
import { hora } from '@/lib/tiempo';

type Mesa = {
  id: string; name: string; capacity: number; zone: string | null;
  status: string; active: boolean;
};
type Reserva = {
  id: string; tableId: string | null; customerName: string; customerPhone: string;
  date: string; people: number; duracionMin: number; status: string; type: string; notes: string | null;
};
type Horario = { openTime: string; closeTime: string; closed: boolean } | null;

const ESTADOS_MESA = [
  { id: 'LIBRE', label: 'En servicio' },
  { id: 'OCUPADA', label: 'Ocupada ahora' },
  { id: 'FUERA_DE_SERVICIO', label: 'Fuera de servicio' },
];

function aMinutos(hhmm: string) {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

function aTexto(min: number) {
  const h = Math.floor(min / 60) % 24;
  const m = min % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/**
 * Grilla de mesas por día.
 *
 * Elegís fecha y franja horaria, y cada mesa se pinta según ESE momento. Una
 * mesa reservada a las 21 está disponible a las 13: el bloqueo es por ventana,
 * no por día completo. La barra de cada mesa muestra el día entero para ver de
 * un vistazo cómo se va llenando el salón.
 */
export default function GestorMesas({
  fecha, esHoy, mesas, reservas, horario, intervalo, duracionDefault, puedeEditar, puedeReservar,
}: {
  fecha: string; esHoy: boolean; mesas: Mesa[]; reservas: Reserva[];
  horario: Horario; intervalo: number; duracionDefault: number;
  puedeEditar: boolean; puedeReservar: boolean;
}) {
  const router = useRouter();
  const params = useSearchParams();
  const [pendiente, startTransition] = useTransition();
  const [editando, setEditando] = useState<Mesa | 'nueva' | null>(null);
  const [reservando, setReservando] = useState<{ mesa: Mesa; minuto: number } | null>(null);
  const [verReserva, setVerReserva] = useState<Reserva | null>(null);
  const [error, setError] = useState('');

  // La grilla cubre el horario de apertura de ese día. Si está cerrado,
  // mostramos igual una franja amplia por si toman algo excepcional.
  const apertura = horario && !horario.closed ? aMinutos(horario.openTime) : 11 * 60;
  let cierre = horario && !horario.closed ? aMinutos(horario.closeTime) : 24 * 60;
  if (cierre <= apertura) cierre += 24 * 60;

  const franjas = useMemo(() => {
    const out: number[] = [];
    for (let m = apertura; m < cierre; m += intervalo) out.push(m);
    return out;
  }, [apertura, cierre, intervalo]);

  // Franja elegida: la de la URL, o la más cercana a ahora si es hoy
  const franjaUrl = params.get('hora');
  const ahoraMin = new Date().getHours() * 60 + new Date().getMinutes();
  const franjaInicial = franjaUrl
    ? aMinutos(franjaUrl)
    : esHoy
      ? franjas.find((f) => f + intervalo > ahoraMin) ?? franjas[0] ?? apertura
      : franjas[Math.floor(franjas.length / 2)] ?? apertura;

  const [franja, setFranja] = useState(franjaInicial);

  function cambiarFecha(nueva: string) {
    const p = new URLSearchParams(params.toString());
    p.set('fecha', nueva);
    p.delete('hora');
    router.push(`/admin/mesas?${p.toString()}`);
  }

  /** Reservas de una mesa que tocan la franja elegida. */
  function ocupadaEn(mesaId: string, minuto: number) {
    return reservas.find((r) => {
      if (r.tableId !== mesaId) return false;
      const d = new Date(r.date);
      const inicio = d.getHours() * 60 + d.getMinutes();
      const fin = inicio + r.duracionMin;
      return inicio <= minuto && fin > minuto;
    });
  }

  function reservasDe(mesaId: string) {
    return reservas
      .filter((r) => r.tableId === mesaId)
      .sort((a, b) => a.date.localeCompare(b.date));
  }

  const sinMesa = reservas.filter((r) => !r.tableId);
  const zonas = [...new Set(mesas.map((m) => m.zone ?? 'Salón'))];
  const activas = mesas.filter((m) => m.active);
  const libresAhora = activas.filter((m) => !ocupadaEn(m.id, franja) && m.status !== 'FUERA_DE_SERVICIO').length;

  const fechaLarga = new Date(`${fecha}T12:00:00`).toLocaleDateString('es-AR', {
    weekday: 'long', day: 'numeric', month: 'long',
  });

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl">Mesas</h1>
          <p className="mt-1 text-sm text-carbon-500">
            {fechaLarga} a las {aTexto(franja)} · {libresAhora} de {activas.length} libres ·{' '}
            {reservas.length} {reservas.length === 1 ? 'reserva' : 'reservas'} ese día
          </p>
        </div>
        {puedeEditar && (
          <button onClick={() => setEditando('nueva')} className="btn-acento">Agregar mesa</button>
        )}
      </div>

      {/* Fecha y franja */}
      <div className="panel mb-5 p-4">
        <div className="flex flex-wrap items-center gap-3">
          <input
            type="date"
            value={fecha}
            onChange={(e) => cambiarFecha(e.target.value)}
            className="input max-w-[11rem]"
          />
          <button
            onClick={() => cambiarFecha(claveDia(new Date()))}
            className="btn-fantasma py-2 text-sm"
          >
            Hoy
          </button>
          {horario?.closed && (
            <span className="rounded-lg bg-rojo/10 px-3 py-1.5 text-sm">El local cierra este día</span>
          )}
        </div>

        <div className="scroll-fino mt-3 flex gap-1.5 overflow-x-auto pb-1">
          {franjas.map((m) => {
            const ocupadas = activas.filter((t) => ocupadaEn(t.id, m)).length;
            return (
              <button
                key={m}
                onClick={() => setFranja(m)}
                className={`shrink-0 rounded-lg border px-3 py-2 text-sm transition-colors ${
                  franja === m ? 'border-marca bg-marca text-crema' : 'border-carbon/15 bg-white'
                }`}
              >
                <span className="block font-medium tabular-nums">{aTexto(m)}</span>
                <span className={`block text-[11px] ${franja === m ? 'text-crema/65' : 'text-carbon-500'}`}>
                  {ocupadas === 0 ? 'libre' : `${ocupadas} tomada${ocupadas > 1 ? 's' : ''}`}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {error && <p className="mb-4 rounded-xl bg-ladrillo/10 px-4 py-3 text-sm text-ladrillo">{error}</p>}

      {sinMesa.length > 0 && (
        <div className="mb-5 rounded-xl bg-rojo/10 px-4 py-3 text-sm">
          <strong>{sinMesa.length}</strong>{' '}
          {sinMesa.length === 1 ? 'reserva de este día está' : 'reservas de este día están'} sin mesa asignada:{' '}
          {sinMesa.map((r) => {
            const d = new Date(r.date);
            return `${r.customerName} ${aTexto(d.getHours() * 60 + d.getMinutes())} (${r.people}p)`;
          }).join(' · ')}
        </div>
      )}

      {mesas.length === 0 ? (
        <p className="panel p-10 text-center text-sm text-carbon-500">
          Todavía no cargaste mesas. Agregá las del salón para poder tomar reservas.
        </p>
      ) : (
        zonas.map((zona) => (
          <section key={zona} className="mb-8">
            <h2 className="mb-3 font-display text-lg">{zona}</h2>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {mesas
                .filter((m) => (m.zone ?? 'Salón') === zona)
                .map((m) => {
                  const reserva = ocupadaEn(m.id, franja);
                  const fuera = m.status === 'FUERA_DE_SERVICIO' || !m.active;
                  const ocupadaAhora = esHoy && m.status === 'OCUPADA';
                  const delDia = reservasDe(m.id);

                  const clase = fuera
                    ? 'border-carbon/20 bg-carbon/10 opacity-60'
                    : reserva
                      ? 'border-rojo bg-rojo/10'
                      : ocupadaAhora
                        ? 'border-ambar bg-carbon/5'
                        : 'border-carbon/15 bg-white';

                  return (
                    <div key={m.id} className={`rounded-2xl border-2 p-4 ${clase}`}>
                      <div className="flex items-baseline justify-between">
                        <p className="font-display text-xl">{m.name}</p>
                        <span className="text-sm text-carbon-500">{m.capacity} personas</span>
                      </div>

                      <p className="mt-1 text-sm font-medium">
                        {fuera
                          ? 'Fuera de servicio'
                          : reserva
                            ? `Reservada · ${reserva.customerName}`
                            : ocupadaAhora
                              ? 'Ocupada ahora'
                              : 'Libre a las ' + aTexto(franja)}
                      </p>

                      {reserva && (
                        <p className="mt-0.5 text-xs text-carbon-500">
                          {reserva.people} personas · {reserva.duracionMin} min
                        </p>
                      )}

                      {/* Cómo se ve el día completo de esta mesa */}
                      {!fuera && (
                        <div className="mt-3">
                          <div className="relative h-2.5 overflow-hidden rounded-full bg-carbon/10">
                            {delDia.map((r) => {
                              const d = new Date(r.date);
                              const ini = d.getHours() * 60 + d.getMinutes();
                              const izq = ((ini - apertura) / (cierre - apertura)) * 100;
                              const ancho = (r.duracionMin / (cierre - apertura)) * 100;
                              if (izq > 100 || izq + ancho < 0) return null;
                              return (
                                <span
                                  key={r.id}
                                  className="absolute inset-y-0 rounded-full bg-rojo"
                                  style={{
                                    left: `${Math.max(0, izq)}%`,
                                    width: `${Math.min(100 - Math.max(0, izq), ancho)}%`,
                                  }}
                                  title={`${r.customerName} · ${aTexto(ini)}`}
                                />
                              );
                            })}
                            {/* Dónde estoy parado */}
                            <span
                              className="absolute inset-y-0 w-0.5 bg-marca"
                              style={{ left: `${((franja - apertura) / (cierre - apertura)) * 100}%` }}
                            />
                          </div>
                          <div className="mt-1 flex justify-between text-[10px] text-carbon-500">
                            <span>{aTexto(apertura)}</span>
                            <span>{aTexto(cierre % (24 * 60))}</span>
                          </div>
                        </div>
                      )}

                      {delDia.length > 0 && (
                        <ul className="mt-2 space-y-0.5">
                          {delDia.map((r) => {
                            const d = new Date(r.date);
                            const ini = d.getHours() * 60 + d.getMinutes();
                            return (
                              <li key={r.id}>
                                <button
                                  onClick={() => setVerReserva(r)}
                                  className="text-left text-xs hover:underline"
                                >
                                  <span className="font-semibold tabular-nums">{aTexto(ini)}</span>{' '}
                                  {r.customerName}
                                  <span className="text-carbon-500"> · {r.people}p</span>
                                </button>
                              </li>
                            );
                          })}
                        </ul>
                      )}

                      <div className="mt-3 flex gap-2">
                        {puedeReservar && !reserva && !fuera && (
                          <button
                            onClick={() => setReservando({ mesa: m, minuto: franja })}
                            className="btn-primario flex-1 py-1.5 text-sm"
                          >
                            Reservar {aTexto(franja)}
                          </button>
                        )}
                        {puedeEditar && (
                          <button onClick={() => setEditando(m)} className="btn-fantasma px-3 py-1.5 text-sm">
                            Editar
                          </button>
                        )}
                      </div>

                      {puedeEditar && esHoy && (
                        <select
                          value={m.status}
                          onChange={(e) =>
                            startTransition(async () => {
                              const r = await cambiarEstadoMesa(m.id, e.target.value as 'LIBRE');
                              setError(r.ok ? '' : r.error);
                              router.refresh();
                            })
                          }
                          disabled={pendiente}
                          className="input mt-2 py-1.5 text-xs"
                        >
                          {ESTADOS_MESA.map((e) => (
                            <option key={e.id} value={e.id}>{e.label}</option>
                          ))}
                        </select>
                      )}
                    </div>
                  );
                })}
            </div>
          </section>
        ))
      )}

      {reservando && (
        <DialogoReserva
          mesa={reservando.mesa}
          fecha={fecha}
          hora={aTexto(reservando.minuto)}
          duracionDefault={duracionDefault}
          onCerrar={() => setReservando(null)}
          onHecho={() => { setReservando(null); setError(''); router.refresh(); }}
          onError={setError}
        />
      )}

      {verReserva && (
        <DialogoVerReserva
          reserva={verReserva}
          onCerrar={() => setVerReserva(null)}
          onHecho={() => { setVerReserva(null); router.refresh(); }}
        />
      )}

      {editando && (
        <EditorMesa
          mesa={editando === 'nueva' ? null : editando}
          onCerrar={() => setEditando(null)}
          onGuardado={() => { setEditando(null); router.refresh(); }}
        />
      )}
    </div>
  );
}

// ─────────── Reservar desde la mesa ───────────

function DialogoReserva({
  mesa, fecha, hora, duracionDefault, onCerrar, onHecho, onError,
}: {
  mesa: Mesa; fecha: string; hora: string; duracionDefault: number;
  onCerrar: () => void; onHecho: () => void; onError: (e: string) => void;
}) {
  const [personas, setPersonas] = useState(Math.min(mesa.capacity, 2));
  const [guardando, setGuardando] = useState(false);
  const [local, setLocal] = useState('');

  async function enviar(fd: FormData) {
    setLocal('');
    setGuardando(true);
    fd.set('tableId', mesa.id);
    fd.set('date', fecha);
    fd.set('people', String(personas));
    const res = await reservarMesa(fd);
    setGuardando(false);
    if (!res.ok) { setLocal(res.error); onError(res.error); return; }
    onHecho();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-carbon/50 p-4" onClick={onCerrar}>
      <div className="w-full max-w-sm rounded-2xl bg-crema p-6" onClick={(e) => e.stopPropagation()}>
        <h2 className="font-display text-xl">Mesa {mesa.name}</h2>
        <p className="mt-1 text-sm text-carbon-500">
          {new Date(`${fecha}T12:00:00`).toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric', month: 'long' })}
          {' · '}hasta {mesa.capacity} personas
        </p>

        <form action={enviar} className="mt-5 space-y-4">
          <div>
            <label className="label" htmlFor="customerName">Nombre</label>
            <input id="customerName" name="customerName" required className="input" autoFocus />
          </div>

          <div>
            <label className="label" htmlFor="customerPhone">Teléfono</label>
            <input id="customerPhone" name="customerPhone" className="input" placeholder="Opcional" />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label" htmlFor="time">Hora</label>
              <input id="time" name="time" type="time" defaultValue={hora} required className="input" />
            </div>
            <div>
              <label className="label" htmlFor="people">Personas</label>
              <input
                id="people" type="number" min={1} max={mesa.capacity}
                value={personas} onChange={(e) => setPersonas(Number(e.target.value) || 1)}
                className="input"
              />
            </div>
          </div>

          <div>
            <label className="label" htmlFor="duracionMin">Cuánto ocupa la mesa</label>
            <select id="duracionMin" name="duracionMin" defaultValue={duracionDefault} className="input">
              <option value={60}>1 hora</option>
              <option value={90}>1 hora y media</option>
              <option value={120}>2 horas</option>
              <option value={180}>3 horas</option>
              <option value={240}>4 horas</option>
            </select>
            <p className="mt-1 text-xs text-carbon-500">
              Durante ese rato la mesa no aparece disponible. Fuera de ese rango, sí.
            </p>
          </div>

          <div>
            <label className="label" htmlFor="type">Tipo</label>
            <select id="type" name="type" defaultValue="MESA" className="input">
              <option value="MESA">Mesa común</option>
              <option value="CUMPLEANOS">Cumpleaños</option>
              <option value="EVENTO">Evento</option>
            </select>
          </div>

          <div>
            <label className="label" htmlFor="notes">Nota</label>
            <input id="notes" name="notes" className="input" placeholder="Opcional" />
          </div>

          {local && <p className="rounded-xl bg-ladrillo/10 px-4 py-3 text-sm text-ladrillo">{local}</p>}

          <div className="flex gap-3 pt-1">
            <button disabled={guardando} className="btn-primario flex-1 py-3">
              {guardando ? 'Guardando...' : 'Reservar'}
            </button>
            <button type="button" onClick={onCerrar} className="btn-fantasma px-5">Cancelar</button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─────────── Ver una reserva ───────────

function DialogoVerReserva({
  reserva, onCerrar, onHecho,
}: {
  reserva: Reserva; onCerrar: () => void; onHecho: () => void;
}) {
  const [pendiente, startTransition] = useTransition();
  const [error, setError] = useState('');
  const d = new Date(reserva.date);

  function cambiar(status: string) {
    setError('');
    startTransition(async () => {
      const r = await cambiarEstadoReserva(reserva.id, status as 'SENTADA');
      if (!r.ok) { setError(r.error); return; }
      onHecho();
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-carbon/50 p-4" onClick={onCerrar}>
      <div className="w-full max-w-sm rounded-2xl bg-crema p-6" onClick={(e) => e.stopPropagation()}>
        <h2 className="font-display text-xl">{reserva.customerName}</h2>
        {error && <p role="alert" className="mt-2 rounded-lg bg-ladrillo/10 px-3 py-2 text-sm text-ladrillo">{error}</p>}
        <p className="mt-1 text-sm text-carbon-500">
          {d.toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric', month: 'long' })} a las{' '}
          {hora(d)}
        </p>
        <p className="mt-2 text-sm">
          {reserva.people} personas · {reserva.duracionMin} minutos · {reserva.status.toLowerCase()}
        </p>
        {reserva.customerPhone && reserva.customerPhone !== '-' && (
          <p className="mt-1 text-sm">
            <a href={`tel:${reserva.customerPhone}`} className="underline">{reserva.customerPhone}</a>
            {' · '}
            <a
              href={`https://wa.me/${reserva.customerPhone.replace(/\D/g, '')}`}
              target="_blank"
              rel="noreferrer"
              className="text-verde underline"
            >
              WhatsApp
            </a>
          </p>
        )}
        {reserva.notes && <p className="mt-3 rounded-lg bg-carbon/5 px-3 py-2 text-sm">{reserva.notes}</p>}

        <div className="mt-5 grid grid-cols-2 gap-2">
          <button onClick={() => cambiar('SENTADA')} disabled={pendiente} className="btn-primario py-2.5 text-sm">
            Llegaron
          </button>
          <button onClick={() => cambiar('CUMPLIDA')} disabled={pendiente} className="btn-fantasma py-2.5 text-sm">
            Se fueron
          </button>
          <button onClick={() => cambiar('NO_SE_PRESENTO')} disabled={pendiente} className="btn-fantasma py-2.5 text-sm">
            No vinieron
          </button>
          <button onClick={() => cambiar('CANCELADA')} disabled={pendiente} className="btn-peligro py-2.5 text-sm">
            Cancelar
          </button>
        </div>

        <button onClick={onCerrar} className="mt-3 w-full py-2 text-sm text-carbon-500 underline">Cerrar</button>
      </div>
    </div>
  );
}

// ─────────── Alta y edición de mesas ───────────

function EditorMesa({
  mesa, onCerrar, onGuardado,
}: {
  mesa: Mesa | null; onCerrar: () => void; onGuardado: () => void;
}) {
  const [error, setError] = useState('');

  async function enviar(fd: FormData) {
    const res = await guardarMesa(fd);
    if (!res.ok) { setError(res.error); return; }
    onGuardado();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-carbon/50 p-4" onClick={onCerrar}>
      <div className="w-full max-w-sm rounded-2xl bg-crema p-6" onClick={(e) => e.stopPropagation()}>
        <h2 className="font-display text-xl">{mesa ? `Mesa ${mesa.name}` : 'Mesa nueva'}</h2>

        <form action={enviar} className="mt-5 space-y-4">
          {mesa && <input type="hidden" name="id" value={mesa.id} />}

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="label" htmlFor="name">Número o nombre</label>
              <input id="name" name="name" required defaultValue={mesa?.name} className="input" placeholder="12" />
            </div>
            <div>
              <label className="label" htmlFor="capacity">Capacidad</label>
              <input id="capacity" name="capacity" type="number" min={1} defaultValue={mesa?.capacity ?? 4} className="input" />
            </div>
          </div>

          <div>
            <label className="label" htmlFor="zone">Zona</label>
            <input id="zone" name="zone" defaultValue={mesa?.zone ?? ''} className="input" placeholder="Salón, vereda, entrepiso" />
          </div>

          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="active" value="true" defaultChecked={mesa?.active ?? true} className="h-4 w-4 accent-marca" />
            En servicio
          </label>

          {error && <p className="rounded-xl bg-ladrillo/10 px-4 py-3 text-sm text-ladrillo">{error}</p>}

          <div className="flex gap-3 pt-2">
            <button className="btn-primario flex-1 py-3">Guardar</button>
            {mesa && (
              <button
                type="button"
                onClick={async () => {
                  if (!confirm(`¿Sacar la mesa ${mesa.name}?`)) return;
                  await borrarMesa(mesa.id);
                  onGuardado();
                }}
                className="btn-peligro px-4"
              >
                Quitar
              </button>
            )}
          </div>
        </form>
      </div>
    </div>
  );
}
