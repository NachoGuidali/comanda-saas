'use client';

import { useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import {
  conectarWhatsApp, desconectarWhatsApp, estadoWhatsApp, guardarConfigWhatsApp, type EstadoWhatsApp,
} from '@/actions/whatsapp';
import { leerConfigWhatsApp, rellenar, VARIABLES, type ConfigWhatsApp, type Aviso } from '@/lib/whatsapp/config';
import { mostrarTelefono } from '@/lib/whatsapp/telefono';

export type DatosWhatsApp = {
  /** Evolution configurado en el servidor */
  disponible: boolean;
  /** El plan del cliente incluye WhatsApp */
  incluido: boolean;
  /** Ya se conectó alguna vez (hay configuración para guardar) */
  existe: boolean;
  estado: EstadoWhatsApp;
  config: string;
  /** Para la vista previa de los textos */
  valores: Record<string, string>;
};

const AVISOS: { id: keyof ConfigWhatsApp['avisos']; titulo: string; cuando: string }[] = [
  { id: 'aceptado', titulo: 'Pedido confirmado', cuando: 'Cuando el local acepta el pedido (o lo carga ya aceptado).' },
  { id: 'enCamino', titulo: 'En camino', cuando: 'Cuando sale el repartidor.' },
  { id: 'listo', titulo: 'Listo para retirar', cuando: 'Solo en los pedidos para retirar, cuando la cocina lo marca listo.' },
  { id: 'rechazado', titulo: 'Rechazado o cancelado', cuando: 'Si el pedido no se puede tomar o se cae.' },
];

const EJEMPLO_PEDIDO = { nombre: 'Laura', codigo: 'A-1234', link: 'https://…/pedido/A-1234' };

/**
 * Configuración → WhatsApp. Se conecta el número escaneando un QR desde el
 * celular del local (como WhatsApp Web), y se eligen los avisos automáticos,
 * el bot y las respuestas rápidas de la bandeja.
 */
export default function WhatsAppDelLocal({ datos, puedeEditar }: { datos: DatosWhatsApp; puedeEditar: boolean }) {
  if (!datos.incluido) {
    return (
      <div className="panel p-6">
        <h2 className="font-display text-lg">WhatsApp</h2>
        <p className="mt-2 text-sm text-carbon-500">
          Tu plan no incluye WhatsApp. Con WhatsApp conectado atendés los chats desde el sistema, el cliente
          recibe avisos de su pedido y un bot contesta lo simple. Consultalo para sumarlo.
        </p>
      </div>
    );
  }
  if (!datos.disponible) {
    return (
      <div className="panel p-6">
        <h2 className="font-display text-lg">WhatsApp</h2>
        <p className="mt-2 text-sm text-carbon-500">WhatsApp todavía no está habilitado en este servidor.</p>
      </div>
    );
  }
  return (
    <div className="space-y-6">
      <Conexion inicial={datos.estado} puedeEditar={puedeEditar} />
      {datos.existe && <Ajustes guardada={datos.config} valores={datos.valores} puedeEditar={puedeEditar} />}
    </div>
  );
}

function Conexion({ inicial, puedeEditar }: { inicial: EstadoWhatsApp; puedeEditar: boolean }) {
  const router = useRouter();
  const [estado, setEstado] = useState<EstadoWhatsApp>(inicial);
  const [error, setError] = useState('');
  const [pendiente, startTransition] = useTransition();

  // Mientras se escanea, se pregunta cada 2 segundos: el QR cambia y la conexión entra sola
  useEffect(() => {
    if (estado.status !== 'esperando_qr') return;
    const t = setInterval(async () => {
      try {
        const r = await estadoWhatsApp();
        if (r.ok) {
          setEstado(r);
          if (r.status === 'conectado') router.refresh();
        }
      } catch { /* sin red: sigue intentando */ }
    }, 2000);
    return () => clearInterval(t);
  }, [estado.status, router]);

  function conectar() {
    setError('');
    startTransition(async () => {
      try {
        const r = await conectarWhatsApp();
        if (!r.ok) setError(r.error);
        else { setEstado(r); router.refresh(); }
      } catch {
        setError('No se pudo. Revisá la conexión.');
      }
    });
  }

  /** Sin preguntar: para cancelar una conexión que no se terminó de escanear. */
  function desconectar(preguntar = true) {
    if (preguntar && !confirm('¿Desconectar el WhatsApp de este local? Los chats quedan guardados, pero no entran mensajes nuevos hasta que lo vuelvas a conectar.')) return;
    setError('');
    startTransition(async () => {
      const r = await desconectarWhatsApp();
      if (!r.ok) setError(r.error);
      else { setEstado({ status: 'desconectado', phone: '', profileName: '', qr: null, lastError: null }); router.refresh(); }
    });
  }

  return (
    <div className="panel p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-display text-lg">WhatsApp del local</h2>
        <Estado status={estado.status} />
      </div>

      {estado.status === 'conectado' && (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-4 rounded-xl bg-verde/10 px-4 py-3">
          <div>
            <p className="font-semibold">{mostrarTelefono(estado.phone) || 'Conectado'}</p>
            {estado.profileName && <p className="text-sm text-carbon-500">{estado.profileName}</p>}
          </div>
          {puedeEditar && <button onClick={() => desconectar()} disabled={pendiente} className="btn-fantasma px-4 py-2 text-sm">Desconectar</button>}
        </div>
      )}

      {estado.status === 'desconectado' && (
        <div className="mt-3 space-y-3 text-sm">
          {estado.lastError && <p role="alert" className="rounded-lg bg-ladrillo/10 px-3 py-2 text-ladrillo">{estado.lastError}</p>}
          <p className="text-carbon-500">
            Se conecta como <strong>dispositivo vinculado</strong>, igual que WhatsApp Web: el celular del local sigue
            andando como siempre, y lo que se conteste desde el celular también aparece en el sistema.
          </p>
          <p className="rounded-lg bg-rojo/10 px-3 py-2 text-carbon">
            Usalo para contestar a quien te escribe y avisar el estado de los pedidos. <strong>No mandes mensajes
            masivos ni promociones</strong> a gente que no te escribió: WhatsApp puede bloquear el número.
          </p>
          {puedeEditar
            ? <button onClick={conectar} disabled={pendiente} className="btn-acento px-6 py-2.5">{pendiente ? 'Preparando...' : 'Conectar WhatsApp'}</button>
            : <p className="text-carbon-500">Pedile a quien administre el local que lo conecte.</p>}
        </div>
      )}

      {estado.status === 'esperando_qr' && (
        <div className="mt-4 grid gap-6 md:grid-cols-[auto_1fr] md:items-start">
          <div className="grid h-64 w-64 place-items-center rounded-xl border border-carbon/15 bg-white p-2">
            {estado.qr
              // eslint-disable-next-line @next/next/no-img-element
              ? <img src={estado.qr} alt="Código QR para vincular WhatsApp" className="h-full w-full" />
              : <p className="px-6 text-center text-sm text-carbon-500">Generando el código...</p>}
          </div>
          <div className="space-y-3 text-sm">
            <p className="font-semibold">Escanealo con el celular del local:</p>
            <ol className="list-decimal space-y-1.5 pl-5">
              <li>Abrí WhatsApp en el celular.</li>
              <li>Tocá <strong>⋮</strong> (Android) o <strong>Configuración</strong> (iPhone) → <strong>Dispositivos vinculados</strong>.</li>
              <li>Tocá <strong>Vincular un dispositivo</strong> y apuntá la cámara a este código.</li>
            </ol>
            <p className="text-carbon-500">El código cambia solo cada tanto. Apenas se vincula, esta pantalla lo muestra conectado.</p>
            {puedeEditar && (
              <button onClick={() => desconectar(false)} disabled={pendiente} className="text-sm underline">Cancelar</button>
            )}
          </div>
        </div>
      )}

      {error && <p role="alert" className="mt-3 text-sm text-ladrillo">{error}</p>}
    </div>
  );
}

function Estado({ status }: { status: string }) {
  const [texto, clase] = status === 'conectado'
    ? ['Conectado', 'bg-verde/15 text-verde']
    : status === 'esperando_qr'
      ? ['Esperando que escanees el código', 'bg-rojo/10 text-carbon']
      : ['Desconectado', 'bg-carbon/10 text-carbon-500'];
  return <span className={`rounded-full px-3 py-1 text-xs font-semibold ${clase}`}>{texto}</span>;
}

function Ajustes({ guardada, valores, puedeEditar }: { guardada: string; valores: Record<string, string>; puedeEditar: boolean }) {
  const router = useRouter();
  const [cfg, setCfg] = useState<ConfigWhatsApp>(() => leerConfigWhatsApp(guardada));
  const [estado, setEstado] = useState<{ ok: boolean; texto: string } | null>(null);
  const [pendiente, startTransition] = useTransition();
  const cambiado = JSON.stringify(cfg) !== JSON.stringify(leerConfigWhatsApp(guardada));
  const previa = (t: string, conPedido = false) => rellenar(t, { ...valores, ...(conPedido ? EJEMPLO_PEDIDO : {}) });

  const aviso = (id: keyof ConfigWhatsApp['avisos'], v: Partial<Aviso>) => {
    setCfg((c) => ({ ...c, avisos: { ...c.avisos, [id]: { ...c.avisos[id], ...v } } }));
    setEstado(null);
  };
  const bot = (v: Partial<ConfigWhatsApp['bot']>) => { setCfg((c) => ({ ...c, bot: { ...c.bot, ...v } })); setEstado(null); };
  const respuestas = (r: ConfigWhatsApp['respuestas']) => { setCfg((c) => ({ ...c, respuestas: r })); setEstado(null); };

  function guardar() {
    startTransition(async () => {
      try {
        const r = await guardarConfigWhatsApp(cfg);
        setEstado(r.ok ? { ok: true, texto: 'Guardado.' } : { ok: false, texto: r.error });
        if (r.ok) router.refresh();
      } catch {
        setEstado({ ok: false, texto: 'No se pudo guardar. Revisá la conexión.' });
      }
    });
  }

  return (
    <fieldset disabled={!puedeEditar} className="space-y-6">
      <div className="panel p-6">
        <h2 className="font-display text-lg">Avisos del pedido</h2>
        <p className="mt-1 text-sm text-carbon-500">
          Le llegan al cliente solos, por WhatsApp, cuando cambia el estado de su pedido. Solo a pedidos con teléfono.
        </p>
        <div className="mt-4 space-y-5">
          {AVISOS.map((a) => (
            <div key={a.id} className="border-t border-carbon/10 pt-4 first:border-t-0 first:pt-0">
              <label className="flex items-start gap-2">
                <input type="checkbox" checked={cfg.avisos[a.id].activo} onChange={(e) => aviso(a.id, { activo: e.target.checked })} className="mt-1 h-4 w-4 accent-marca" />
                <span>
                  <span className="font-semibold">{a.titulo}</span>
                  <span className="block text-xs text-carbon-500">{a.cuando}</span>
                </span>
              </label>
              {cfg.avisos[a.id].activo && (
                <Texto valor={cfg.avisos[a.id].texto} onCambio={(t) => aviso(a.id, { texto: t })} previa={previa(cfg.avisos[a.id].texto, true)} filas={2} />
              )}
            </div>
          ))}
        </div>
      </div>

      <div className="panel p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-display text-lg">Bot</h2>
          <label className="flex items-center gap-2 text-sm font-semibold">
            <input type="checkbox" checked={cfg.bot.activo} onChange={(e) => bot({ activo: e.target.checked })} className="h-4 w-4 accent-marca" />
            {cfg.bot.activo ? 'Prendido' : 'Apagado'}
          </label>
        </div>
        <p className="mt-1 text-sm text-carbon-500">
          Contesta lo simple: saluda con el link de la carta, avisa si está cerrado y, si el cliente pregunta por su
          pedido, le dice en qué estado está. Si escribe &quot;persona&quot;, te avisa en la bandeja. En cuanto alguien
          del local contesta en un chat, el bot se calla ahí.
        </p>
        {cfg.bot.activo && (
          <div className="mt-4 space-y-4">
            <div>
              <p className="label">Saludo (local abierto)</p>
              <Texto valor={cfg.bot.saludo} onCambio={(t) => bot({ saludo: t })} previa={previa(cfg.bot.saludo)} />
            </div>
            <div>
              <p className="label">Saludo (local cerrado)</p>
              <Texto valor={cfg.bot.cerrado} onCambio={(t) => bot({ cerrado: t })} previa={previa(cfg.bot.cerrado)} />
            </div>
            <label className="flex items-start gap-2 text-sm">
              <input type="checkbox" checked={cfg.bot.estado} onChange={(e) => bot({ estado: e.target.checked })} className="mt-0.5 h-4 w-4 accent-marca" />
              Contestar &quot;¿dónde está mi pedido?&quot; con el estado real del pedido
            </label>
            <div>
              <label className="label" htmlFor="pausa">Cuando alguien del local contesta, el bot se calla en ese chat por</label>
              <select id="pausa" className="input w-40" value={cfg.bot.pausaHoras} onChange={(e) => bot({ pausaHoras: Number(e.target.value) })}>
                {[1, 3, 6, 12, 24].map((h) => <option key={h} value={h}>{h} {h === 1 ? 'hora' : 'horas'}</option>)}
              </select>
            </div>
          </div>
        )}
      </div>

      <div className="panel p-6">
        <h2 className="font-display text-lg">Respuestas rápidas</h2>
        <p className="mt-1 text-sm text-carbon-500">Botones en la bandeja para mandar en un toque lo que se escribe siempre.</p>
        <ul className="mt-4 space-y-3">
          {cfg.respuestas.map((r, i) => (
            <li key={i} className="grid gap-2 rounded-xl border border-carbon/10 bg-white p-3 sm:grid-cols-[10rem_1fr_auto] sm:items-start">
              <input className="input" value={r.titulo} maxLength={30} placeholder="Título" aria-label="Título"
                onChange={(e) => respuestas(cfg.respuestas.map((x, j) => (j === i ? { ...x, titulo: e.target.value } : x)))} />
              <textarea className="input min-h-[2.75rem]" value={r.texto} maxLength={1000} rows={2} placeholder="Texto" aria-label="Texto"
                onChange={(e) => respuestas(cfg.respuestas.map((x, j) => (j === i ? { ...x, texto: e.target.value } : x)))} />
              <button type="button" onClick={() => respuestas(cfg.respuestas.filter((_, j) => j !== i))} className="text-sm text-ladrillo underline sm:mt-3">Quitar</button>
            </li>
          ))}
        </ul>
        {cfg.respuestas.length < 20 && (
          <button type="button" onClick={() => respuestas([...cfg.respuestas, { titulo: '', texto: '' }])} className="btn-fantasma mt-3 px-4 py-2 text-sm">
            Agregar respuesta
          </button>
        )}
      </div>

      <div className="panel p-4 text-xs text-carbon-500">
        Podés usar en los textos:{' '}
        {VARIABLES.map((v, i) => (
          <span key={v.id}>{i > 0 && ' · '}<code className="font-mono text-carbon">{`{${v.id}}`}</code> {v.ayuda.toLowerCase()}{v.soloAvisos ? ' (solo avisos)' : ''}</span>
        ))}
      </div>

      {puedeEditar && (
        <div className="flex flex-wrap items-center gap-4">
          <button type="button" onClick={guardar} disabled={pendiente || !cambiado} className="btn-primario px-6 py-2.5">
            {pendiente ? 'Guardando...' : 'Guardar'}
          </button>
          {cambiado && <button type="button" onClick={() => { setCfg(leerConfigWhatsApp(guardada)); setEstado(null); }} className="text-sm underline">Descartar cambios</button>}
          {estado && <span role="status" className={`text-sm ${estado.ok ? 'text-verde' : 'text-ladrillo'}`}>{estado.texto}</span>}
        </div>
      )}
    </fieldset>
  );
}

function Texto({ valor, onCambio, previa, filas = 3 }: { valor: string; onCambio: (t: string) => void; previa: string; filas?: number }) {
  return (
    <div className="mt-2 grid gap-2 lg:grid-cols-2">
      <textarea className="input" rows={filas} value={valor} maxLength={1000} onChange={(e) => onCambio(e.target.value)} />
      <p className="whitespace-pre-wrap rounded-xl rounded-tl-sm bg-[#dcf8c6] px-3 py-2 text-sm text-carbon">{previa}</p>
    </div>
  );
}
