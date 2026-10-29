'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { money, fromCents } from '@/lib/money';
import { guardarSucursal, guardarHorarios, guardarPrecioMitad } from '@/actions/config';
import { MODOS_MITAD, precioBaseMitad } from '@/lib/mitad';
import DisenoComanda from './DisenoComanda';
import ConectarImpresora from './ConectarImpresora';
import ImpresorasDelLocal, { type Impresora } from './ImpresorasDelLocal';
import CobroOnline, { type DatosCobro } from './CobroOnline';
import { guardarZona, borrarZona } from '@/actions/catalog';
import SubirImagen from './SubirImagen';

type Branch = {
  id: string; name: string; slug: string; eslogan: string; address: string;
  phone: string; whatsapp: string; instagram: string;
  tiempoDelivery: string; tiempoTakeaway: string; mensajeCerrado: string;
  aliasBancario: string; cbu: string; googleResenas: string;
  aceptaPedidos: boolean; imprimirAuto: boolean; heroImageUrl: string | null;
  intervaloReservaMin: number; duracionReservaMin: number;
  precioMitad: string; comanda: string;
};
/** Para mostrar con números reales cómo queda cada forma de cobrar la mitad y mitad */
export type EjemploMitad = {
  producto: string; tamano: string; fijo: number;
  barata: { name: string; price: number }; cara: { name: string; price: number };
} | null;
type Zona = { id: string; name: string; fee: number; active: boolean };
type Horario = { dayOfWeek: number; openTime: string; closeTime: string; closed: boolean };

type Seccion = 'local' | 'horarios' | 'envios' | 'mitad' | 'cobro' | 'impresion';

const DIAS = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];

export default function GestorConfig({
  branch, zonas, horarios, puedeEditar, ejemploMitad, categorias, impresora, impresoras, imprimeCaja, cobro, seccionInicial = 'local',
}: {
  branch: Branch; zonas: Zona[]; horarios: Horario[]; puedeEditar: boolean;
  ejemploMitad: EjemploMitad; categorias: { id: string; name: string }[];
  impresora: { servidor: string; sucursal: string; tieneToken: boolean };
  impresoras: Impresora[];
  imprimeCaja: boolean;
  cobro: DatosCobro;
  seccionInicial?: Seccion;
}) {
  const router = useRouter();
  const [seccion, setSeccion] = useState<Seccion>(seccionInicial);

  return (
    <div>
      <div className="mb-5">
        <h1 className="font-display text-2xl">Configuración · {branch.name}</h1>
        <p className="mt-1 text-sm text-carbon-500">
          Estos datos son de esta sucursal. La otra tiene los suyos: cambiá de local arriba.
          Link público: <span className="font-mono">/{branch.slug}</span>
        </p>
      </div>

      {!puedeEditar && (
        <p className="mb-4 rounded-xl bg-carbon/5 px-4 py-3 text-sm text-carbon-500">
          Podés mirar pero no modificar. Pedile el permiso a quien administre el sistema.
        </p>
      )}

      <div className="mb-6 flex flex-wrap gap-2">
        {([
          ['local', 'Datos del local'],
          ['horarios', 'Horarios'],
          ['envios', 'Zonas de envío'],
          ['mitad', 'Mitad y mitad'],
          ['cobro', 'Cobro online'],
          ['impresion', 'Impresión y comandas'],
        ] as const).map(([id, label]) => (
          <button key={id} onClick={() => setSeccion(id)} className={`chip ${seccion === id ? 'chip-activo' : ''}`}>
            {label}
          </button>
        ))}
      </div>

      {seccion === 'local' && <SeccionLocal branch={branch} puedeEditar={puedeEditar} onGuardado={() => router.refresh()} />}
      {seccion === 'horarios' && <SeccionHorarios horarios={horarios} puedeEditar={puedeEditar} onGuardado={() => router.refresh()} />}
      {seccion === 'envios' && <SeccionZonas zonas={zonas} puedeEditar={puedeEditar} onGuardado={() => router.refresh()} />}
      {seccion === 'cobro' && <CobroOnline datos={cobro} />}
      {seccion === 'mitad' && <SeccionMitad modo={branch.precioMitad} ejemplo={ejemploMitad} puedeEditar={puedeEditar} onGuardado={() => router.refresh()} />}
      {seccion === 'impresion' && (
        <div className="space-y-6">
          <SeccionImpresion branch={branch} puedeEditar={puedeEditar} onGuardado={() => router.refresh()} impresora={impresora} impresoras={impresoras} imprimeCaja={imprimeCaja} />
          <DisenoComanda
            guardada={branch.comanda}
            local={{ nombre: branch.name, direccion: branch.address, alias: branch.aliasBancario }}
            categorias={categorias}
            puedeEditar={puedeEditar}
            onGuardado={() => router.refresh()}
          />
        </div>
      )}
    </div>
  );
}

function SeccionLocal({ branch, puedeEditar, onGuardado }: { branch: Branch; puedeEditar: boolean; onGuardado: () => void }) {
  const [guardado, setGuardado] = useState(false);
  const [error, setError] = useState('');
  const [hero, setHero] = useState(branch.heroImageUrl ?? '');

  async function enviar(fd: FormData) {
    setError('');
    fd.set('heroImageUrl', hero);
    const res = await guardarSucursal(fd);
    if (!res.ok) { setError(res.error); return; }
    setGuardado(true);
    onGuardado();
    setTimeout(() => setGuardado(false), 3000);
  }

  return (
    <form action={enviar} className="panel max-w-2xl space-y-4 p-6">
      <input type="hidden" name="id" value={branch.id} />

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="label" htmlFor="name">Nombre de la sucursal</label>
          <input id="name" name="name" defaultValue={branch.name} disabled={!puedeEditar} className="input" />
        </div>
        <div>
          <label className="label" htmlFor="eslogan">Bajada</label>
          <input id="eslogan" name="eslogan" defaultValue={branch.eslogan} disabled={!puedeEditar} className="input" />
        </div>
      </div>

      <div>
        <label className="label" htmlFor="address">Dirección</label>
        <input id="address" name="address" defaultValue={branch.address} disabled={!puedeEditar} className="input" />
      </div>

      <SubirImagen valor={hero} onCambio={setHero} etiqueta="Foto del local" />

      <div className="grid gap-4 sm:grid-cols-3">
        <div>
          <label className="label" htmlFor="whatsapp">WhatsApp</label>
          <input id="whatsapp" name="whatsapp" defaultValue={branch.whatsapp} disabled={!puedeEditar} className="input" placeholder="5491100000000" />
          <p className="mt-1 text-xs text-carbon-500">Con código de país, sin espacios.</p>
        </div>
        <div>
          <label className="label" htmlFor="phone">Teléfono fijo</label>
          <input id="phone" name="phone" defaultValue={branch.phone} disabled={!puedeEditar} className="input" />
        </div>
        <div>
          <label className="label" htmlFor="instagram">Instagram</label>
          <input id="instagram" name="instagram" defaultValue={branch.instagram} disabled={!puedeEditar} className="input" placeholder="sin arroba" />
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="label" htmlFor="tiempoDelivery">Demora de envío (min)</label>
          <input id="tiempoDelivery" name="tiempoDelivery" defaultValue={branch.tiempoDelivery} disabled={!puedeEditar} className="input" placeholder="40-55" />
        </div>
        <div>
          <label className="label" htmlFor="tiempoTakeaway">Demora de retiro (min)</label>
          <input id="tiempoTakeaway" name="tiempoTakeaway" defaultValue={branch.tiempoTakeaway} disabled={!puedeEditar} className="input" placeholder="20-30" />
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="label" htmlFor="aliasBancario">Alias bancario</label>
          <input id="aliasBancario" name="aliasBancario" defaultValue={branch.aliasBancario} disabled={!puedeEditar} className="input" />
          <p className="mt-1 text-xs text-carbon-500">Se le muestra al cliente si elige transferencia.</p>
        </div>
        <div>
          <label className="label" htmlFor="cbu">CBU</label>
          <input id="cbu" name="cbu" defaultValue={branch.cbu} disabled={!puedeEditar} className="input" />
        </div>
      </div>

      <div>
        <label className="label" htmlFor="googleResenas">Link de reseñas de Google</label>
        <input id="googleResenas" name="googleResenas" defaultValue={branch.googleResenas} disabled={!puedeEditar} className="input" placeholder="https://g.page/r/..." />
        <p className="mt-1 text-xs text-carbon-500">
          Se le ofrece al cliente cuando el pedido se marca entregado. Cada sucursal tiene su propio perfil.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="label" htmlFor="intervaloReservaMin">Franjas de la grilla de mesas</label>
          <select id="intervaloReservaMin" name="intervaloReservaMin" defaultValue={branch.intervaloReservaMin} disabled={!puedeEditar} className="input">
            <option value={15}>Cada 15 minutos</option>
            <option value={30}>Cada 30 minutos</option>
            <option value={60}>Cada hora</option>
          </select>
        </div>
        <div>
          <label className="label" htmlFor="duracionReservaMin">Duración sugerida de una reserva</label>
          <select id="duracionReservaMin" name="duracionReservaMin" defaultValue={branch.duracionReservaMin} disabled={!puedeEditar} className="input">
            <option value={60}>1 hora</option>
            <option value={90}>1 hora y media</option>
            <option value={120}>2 horas</option>
            <option value={180}>3 horas</option>
          </select>
          <p className="mt-1 text-xs text-carbon-500">Se puede cambiar en cada reserva.</p>
        </div>
      </div>

      <div>
        <label className="label" htmlFor="mensajeCerrado">Mensaje cuando está cerrado</label>
        <textarea id="mensajeCerrado" name="mensajeCerrado" rows={2} defaultValue={branch.mensajeCerrado} disabled={!puedeEditar} className="input resize-none" />
      </div>

      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="aceptaPedidos" defaultChecked={branch.aceptaPedidos} disabled={!puedeEditar} className="h-4 w-4 accent-marca" />
        Aceptar pedidos desde la web
      </label>

      <input type="hidden" name="imprimirAuto" value={branch.imprimirAuto ? 'on' : ''} />

      {error && <p className="rounded-xl bg-ladrillo/10 px-4 py-3 text-sm text-ladrillo">{error}</p>}

      {puedeEditar && (
        <div className="flex items-center gap-4 border-t border-carbon/10 pt-4">
          <button className="btn-primario px-6 py-2.5">Guardar cambios</button>
          {guardado && <span className="text-sm text-verde">Guardado</span>}
        </div>
      )}
    </form>
  );
}

function SeccionHorarios({ horarios, puedeEditar, onGuardado }: { horarios: Horario[]; puedeEditar: boolean; onGuardado: () => void }) {
  const [filas, setFilas] = useState<Horario[]>(
    DIAS.map((_, i) => horarios.find((h) => h.dayOfWeek === i) ?? { dayOfWeek: i, openTime: '19:00', closeTime: '23:59', closed: false })
  );
  const [pendiente, startTransition] = useTransition();
  const [guardado, setGuardado] = useState(false);

  function editar(i: number, cambio: Partial<Horario>) {
    setFilas((p) => p.map((f, j) => (j === i ? { ...f, ...cambio } : f)));
  }

  return (
    <div className="panel max-w-2xl p-6">
      <p className="mb-4 text-sm text-carbon-500">
        La carta muestra abierto o cerrado según esto. Si el cierre es después de medianoche,
        poné por ejemplo 19:00 a 01:00 y se interpreta bien.
      </p>

      <div className="space-y-2">
        {filas.map((h, i) => (
          <div key={h.dayOfWeek} className="flex flex-wrap items-center gap-3">
            <span className="w-24 text-sm font-medium">{DIAS[h.dayOfWeek]}</span>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={!h.closed} disabled={!puedeEditar} onChange={(e) => editar(i, { closed: !e.target.checked })} className="h-4 w-4 accent-marca" />
              Abre
            </label>
            <input type="time" value={h.openTime} disabled={h.closed || !puedeEditar} onChange={(e) => editar(i, { openTime: e.target.value })} className="input max-w-[7.5rem] disabled:opacity-40" />
            <span className="text-carbon-500">a</span>
            <input type="time" value={h.closeTime} disabled={h.closed || !puedeEditar} onChange={(e) => editar(i, { closeTime: e.target.value })} className="input max-w-[7.5rem] disabled:opacity-40" />
          </div>
        ))}
      </div>

      {puedeEditar && (
        <div className="mt-5 flex items-center gap-4 border-t border-carbon/10 pt-4">
          <button
            onClick={() => startTransition(async () => {
              await guardarHorarios(filas);
              setGuardado(true);
              onGuardado();
              setTimeout(() => setGuardado(false), 3000);
            })}
            disabled={pendiente}
            className="btn-primario px-6 py-2.5"
          >
            {pendiente ? 'Guardando...' : 'Guardar horarios'}
          </button>
          {guardado && <span className="text-sm text-verde">Guardado</span>}
        </div>
      )}
    </div>
  );
}

function SeccionZonas({ zonas, puedeEditar, onGuardado }: { zonas: Zona[]; puedeEditar: boolean; onGuardado: () => void }) {
  const [error, setError] = useState('');

  async function agregar(fd: FormData) {
    const res = await guardarZona(fd);
    if (!res.ok) { setError(res.error); return; }
    setError('');
    onGuardado();
  }

  return (
    <div className="max-w-2xl">
      <div className="panel divide-y divide-carbon/10">
        {zonas.length === 0 && (
          <p className="p-6 text-center text-sm text-carbon-500">
            Sin zonas cargadas, el envío sale sin cargo para todos.
          </p>
        )}
        {zonas.map((z) => (
          <div key={z.id} className="flex items-center gap-4 p-4">
            <span className="flex-1 font-medium">{z.name}</span>
            <span className="font-semibold">{z.fee === 0 ? 'Sin cargo' : money(z.fee)}</span>
            {puedeEditar && (
              <button
                onClick={async () => {
                  if (!confirm(`¿Quitar la zona "${z.name}"?`)) return;
                  await borrarZona(z.id);
                  onGuardado();
                }}
                className="text-sm text-carbon-500 underline"
              >
                Quitar
              </button>
            )}
          </div>
        ))}
      </div>

      {puedeEditar && (
        <form action={agregar} className="panel mt-4 flex flex-wrap items-end gap-3 p-4">
          <div className="min-w-[12rem] flex-1">
            <label className="label" htmlFor="zonaName">Nombre de la zona</label>
            <input id="zonaName" name="name" required className="input" placeholder="Adrogué centro" />
          </div>
          <div className="w-32">
            <label className="label" htmlFor="zonaFee">Costo</label>
            <input id="zonaFee" name="fee" className="input" inputMode="decimal" placeholder="1500" />
          </div>
          <button className="btn-acento py-2.5">Agregar zona</button>
          {error && <p className="w-full text-sm text-ladrillo">{error}</p>}
        </form>
      )}

      <p className="mt-3 text-sm text-carbon-500">
        Las zonas son de esta sucursal. El cliente elige la suya en el checkout y el costo se suma al total.
      </p>
    </div>
  );
}

function SeccionImpresion({ branch, puedeEditar, onGuardado, impresora, impresoras, imprimeCaja }: {
  branch: Branch; puedeEditar: boolean; onGuardado: () => void;
  impresora: { servidor: string; sucursal: string; tieneToken: boolean };
  impresoras: Impresora[]; imprimeCaja: boolean;
}) {
  const [guardado, setGuardado] = useState(false);

  async function enviar(fd: FormData) {
    // Reenviamos el resto de los datos para no pisarlos con vacíos
    fd.set('id', branch.id);
    fd.set('name', branch.name);
    fd.set('eslogan', branch.eslogan);
    fd.set('address', branch.address);
    fd.set('phone', branch.phone);
    fd.set('whatsapp', branch.whatsapp);
    fd.set('instagram', branch.instagram);
    fd.set('tiempoDelivery', branch.tiempoDelivery);
    fd.set('tiempoTakeaway', branch.tiempoTakeaway);
    fd.set('mensajeCerrado', branch.mensajeCerrado);
    fd.set('aliasBancario', branch.aliasBancario);
    fd.set('cbu', branch.cbu);
    fd.set('googleResenas', branch.googleResenas);
    fd.set('heroImageUrl', branch.heroImageUrl ?? '');
    fd.set('intervaloReservaMin', String(branch.intervaloReservaMin));
    fd.set('duracionReservaMin', String(branch.duracionReservaMin));
    if (branch.aceptaPedidos) fd.set('aceptaPedidos', 'on');

    await guardarSucursal(fd);
    setGuardado(true);
    onGuardado();
    setTimeout(() => setGuardado(false), 3000);
  }

  return (
    <div className="max-w-2xl">
      <form action={enviar} className="panel space-y-4 p-6">
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="imprimirAuto" defaultChecked={branch.imprimirAuto} disabled={!puedeEditar} className="h-4 w-4 accent-marca" />
          Imprimir la comanda al aceptar un pedido
        </label>
        <p className="text-sm text-carbon-500">
          Al aceptar un pedido se generan dos comandas: una para cocina sin precios y otra para
          caja con el detalle y el vuelto. Salen por las impresoras de este local que figuran abajo.
        </p>
        {puedeEditar && (
          <div className="flex items-center gap-4 border-t border-carbon/10 pt-4">
            <button className="btn-primario px-6 py-2.5">Guardar</button>
            {guardado && <span className="text-sm text-verde">Guardado</span>}
          </div>
        )}
      </form>

      <ImpresorasDelLocal impresoras={impresoras} puedeEditar={puedeEditar} imprimeCaja={imprimeCaja} />

      <details className="mt-4">
        <summary className="cursor-pointer text-sm text-carbon-500">Instalación manual (Linux, Raspberry Pi o con archivo .env)</summary>
        <ConectarImpresora {...impresora} puedeEditar={puedeEditar} />
      </details>
    </div>
  );
}

function SeccionMitad({ modo, ejemplo, puedeEditar, onGuardado }: {
  modo: string; ejemplo: EjemploMitad; puedeEditar: boolean; onGuardado: () => void;
}) {
  const [elegido, setElegido] = useState(modo);
  const [estado, setEstado] = useState<{ ok: boolean; texto: string } | null>(null);
  const [pendiente, startTransition] = useTransition();

  return (
    <div className="panel max-w-2xl space-y-5 p-6">
      <div>
        <h2 className="font-display text-lg">¿Cuánto sale una pizza mitad y mitad?</h2>
        <p className="mt-1 text-sm text-carbon-500">
          Vale para la carta online, el mostrador y el mozo. El gusto de cada mitad se busca en la pizza del mismo nombre, en el tamaño elegido.
        </p>
      </div>
      <div className="space-y-2" role="radiogroup" aria-label="Cómo se cobra">
        {MODOS_MITAD.map((m) => {
          const precio = ejemplo
            ? precioBaseMitad(m.id, ejemplo.fijo, [ejemplo.barata.price, ejemplo.cara.price])
            : null;
          return (
            <label key={m.id} className={`flex cursor-pointer items-start gap-3 rounded-xl border p-4 ${elegido === m.id ? 'border-marca bg-marca/5' : 'border-carbon/15 bg-white'}`}>
              <input type="radio" name="precioMitad" checked={elegido === m.id} onChange={() => { setElegido(m.id); setEstado(null); }} disabled={!puedeEditar} className="mt-1 accent-marca" />
              <span className="min-w-0 flex-1">
                <span className="font-semibold">{m.label}</span>
                <span className="block text-sm text-carbon-500">{m.ayuda}</span>
              </span>
              {precio !== null && <span className="shrink-0 font-semibold tabular-nums">{money(precio)}</span>}
            </label>
          );
        })}
      </div>
      {ejemplo && (
        <p className="text-sm text-carbon-500">
          Ejemplo con los precios de hoy: {ejemplo.producto} {ejemplo.tamano.toLowerCase()}, mitad {ejemplo.barata.name.toLowerCase()} ({money(ejemplo.barata.price)}) y mitad {ejemplo.cara.name.toLowerCase()} ({money(ejemplo.cara.price)}). Los extras se suman aparte.
        </p>
      )}
      {!ejemplo && (
        <p className="rounded-lg bg-carbon/5 px-3 py-2 text-sm text-carbon-500">
          No encontramos un producto mitad y mitad en la carta. Tiene que tener grupos de gustos que se llamen &quot;Primera mitad&quot; y &quot;Segunda mitad&quot; (o marcados como gustos de pizza), con opciones que se llamen como las pizzas.
        </p>
      )}
      {puedeEditar && (
        <div className="flex items-center gap-4 border-t border-carbon/10 pt-4">
          <button
            disabled={pendiente || elegido === modo}
            onClick={() => startTransition(async () => {
              const r = await guardarPrecioMitad(elegido);
              setEstado(r.ok ? { ok: true, texto: 'Guardado. Ya se cobra así.' } : { ok: false, texto: r.error });
              if (r.ok) onGuardado();
            })}
            className="btn-primario px-6 py-2.5"
          >
            {pendiente ? 'Guardando...' : 'Guardar'}
          </button>
          {estado && <span className={`text-sm ${estado.ok ? 'text-verde' : 'text-ladrillo'}`}>{estado.texto}</span>}
        </div>
      )}
    </div>
  );
}
