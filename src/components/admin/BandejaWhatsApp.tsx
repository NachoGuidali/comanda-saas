'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState, useTransition } from 'react';
import {
  abrirChat, archivarChat, botEnChat, enviarArchivoChat, enviarTextoChat, marcarAtendido, marcarLeido, reintentarMensaje,
} from '@/actions/whatsapp';
import { money } from '@/lib/money';
import { mostrarTelefono } from '@/lib/whatsapp/telefono';
import { useAlerta } from './useAlerta';
import NuevoPedidoMostrador, { type CategoriaMostrador } from './NuevoPedidoMostrador';

type Chat = {
  id: string; name: string; phone: string; lastMessageAt: string; lastPreview: string;
  unread: number; pideAtencion: boolean; archived: boolean; botPausado: boolean;
};
type Mensaje = {
  id: string; fromMe: boolean; author: string; userName: string; type: string; text: string;
  archivo: boolean; mediaName: string | null; mediaMime: string | null; voz: boolean;
  status: string; error: string | null; createdAt: string; pedido: string | null;
};
type PedidoCliente = { id: string; code: string; status: string; type: string; total: number; createdAt: string; resumen: string };
type Linea = { status: string; phone: string; profileName: string; lastError: string | null };
type Respuesta = {
  linea: Linea | null; chats: Chat[]; chat?: Chat | null; noLeidos: number; mensajes?: Mensaje[]; masViejos?: boolean;
  cliente?: { pedidos: PedidoCliente[] }; hasta: string;
};
type Filtro = 'todos' | 'sin_leer' | 'atencion' | 'archivados';

const ESTADO_PEDIDO: Record<string, string> = {
  PENDIENTE: 'Nuevo', ACEPTADO: 'Aceptado', EN_PREPARACION: 'En preparación', LISTO: 'Listo',
  EN_CAMINO: 'En camino', ENTREGADO: 'Entregado', RECHAZADO: 'Rechazado', CANCELADO: 'Cancelado',
};
const CADA_MS = 3000;

function horaCorta(iso: string): string {
  const d = new Date(iso);
  const hoy = new Date();
  if (d.toDateString() === hoy.toDateString()) return d.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' });
  const ayer = new Date(hoy); ayer.setDate(hoy.getDate() - 1);
  if (d.toDateString() === ayer.toDateString()) return 'ayer';
  return d.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit' });
}

const nombreDe = (c: Pick<Chat, 'name' | 'phone'>) => c.name || mostrarTelefono(c.phone) || 'Sin nombre';

/** Une los mensajes que llegan con los que ya están (por id: un "leído" pisa al "enviado"). */
function unir(actuales: Mensaje[], nuevos: Mensaje[]): Mensaje[] {
  if (nuevos.length === 0) return actuales;
  const porId = new Map(actuales.map((m) => [m.id, m]));
  for (const m of nuevos) porId.set(m.id, m);
  return [...porId.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export default function BandejaWhatsApp({
  conectado, existe, puedeConfigurar, respuestas, pedidos, telefonoInicial, chatInicial,
}: {
  conectado: boolean;
  existe: boolean;
  puedeConfigurar: boolean;
  respuestas: { titulo: string; texto: string }[];
  /** Para cargar un pedido desde el chat; null si no tiene permiso */
  pedidos: { branchId: string; categorias: CategoriaMostrador[]; zonas: { id: string; name: string; fee: number }[]; mesas: { id: string; name: string }[] } | null;
  telefonoInicial: string | null;
  chatInicial: string | null;
}) {
  const [linea, setLinea] = useState<Linea | null>(existe ? { status: conectado ? 'conectado' : 'desconectado', phone: '', profileName: '', lastError: null } : null);
  const [chats, setChats] = useState<Chat[]>([]);
  const [noLeidos, setNoLeidos] = useState(0);
  const [filtro, setFiltro] = useState<Filtro>('todos');
  const [busqueda, setBusqueda] = useState('');
  const [abierto, setAbierto] = useState<string | null>(chatInicial);
  const [chat, setChat] = useState<Chat | null>(null);
  const [mensajes, setMensajes] = useState<Mensaje[]>([]);
  const [masViejos, setMasViejos] = useState(false);
  const [cliente, setCliente] = useState<PedidoCliente[] | null>(null);
  const [error, setError] = useState('');
  const [cargarPedido, setCargarPedido] = useState(false);
  const [nuevoChat, setNuevoChat] = useState(false);
  const [, startTransition] = useTransition();
  const { activo: sonidoActivo, activar, sonar } = useAlerta();

  // Lo que hace falta entre una consulta y la siguiente, sin volver a armar el intervalo
  const hasta = useRef<string | null>(null);
  const chatConsultado = useRef<string | null>(null);
  const atencionPrevia = useRef<number | null>(null);
  const noLeidosPrevios = useRef<number | null>(null);
  const fondo = useRef<HTMLDivElement>(null);
  const pegadoAbajo = useRef(true);
  const abiertoAhora = useRef(abierto);
  abiertoAhora.current = abierto;

  const consultar = useCallback(async () => {
    const p = new URLSearchParams();
    if (filtro !== 'todos') p.set('filtro', filtro);
    if (busqueda.trim()) p.set('q', busqueda.trim());
    const chatId = abierto;
    if (chatId) {
      p.set('chat', chatId);
      // Mismo chat que la vuelta anterior: solo lo que cambió desde entonces
      if (chatConsultado.current === chatId && hasta.current) p.set('desde', hasta.current);
    }
    try {
      const r = await fetch(`/api/whatsapp/bandeja?${p}`, { cache: 'no-store' });
      if (!r.ok) return;
      const d: Respuesta = await r.json();
      setLinea(d.linea);
      setChats(d.chats);
      setNoLeidos(d.noLeidos);

      // Suena si entró algo nuevo (o alguien pidió una persona)
      const atencion = d.chats.filter((c) => c.pideAtencion).length;
      if ((noLeidosPrevios.current !== null && d.noLeidos > noLeidosPrevios.current) || (atencionPrevia.current !== null && atencion > atencionPrevia.current)) {
        sonar('Mensaje nuevo');
      }
      noLeidosPrevios.current = d.noLeidos;
      atencionPrevia.current = atencion;

      // Si mientras tanto se cambió de chat, esta respuesta ya no corresponde
      if (chatId !== abiertoAhora.current) return;
      if (chatId) setChat(d.chat ?? null);
      if (chatId && d.mensajes) {
        if (chatConsultado.current === chatId && p.has('desde')) {
          setMensajes((m) => unir(m, d.mensajes!));
          // Lo que llega con el chat abierto ya está leído
          if (d.mensajes.some((m) => !m.fromMe)) void marcarLeido(chatId);
        } else {
          setMensajes(d.mensajes);
          setMasViejos(!!d.masViejos);
          setCliente(d.cliente?.pedidos ?? null);
          pegadoAbajo.current = true;
          void marcarLeido(chatId);
        }
        chatConsultado.current = chatId;
        hasta.current = d.hasta;
      }
    } catch { /* sin red: la próxima vuelta */ }
  }, [abierto, filtro, busqueda, sonar]);

  useEffect(() => {
    void consultar();
    const t = setInterval(() => void consultar(), CADA_MS);
    return () => clearInterval(t);
  }, [consultar]);

  // Abrir el chat de un teléfono que viene en la dirección (desde un pedido)
  useEffect(() => {
    if (!telefonoInicial) return;
    void abrirChat(telefonoInicial).then((r) => {
      if (r.ok) setAbierto(r.chatId);
      else setError(r.error);
    });
  }, [telefonoInicial]);

  // La conversación arranca abajo, y baja sola si llega algo y ya se estaba abajo de todo
  useEffect(() => {
    const el = fondo.current;
    if (el && pegadoAbajo.current) el.scrollTop = el.scrollHeight;
  }, [mensajes]);

  function elegir(id: string) {
    if (id === abierto) return;
    setAbierto(id);
    setChat(chats.find((c) => c.id === id) ?? null);
    setMensajes([]);
    setCliente(null);
    setError('');
    chatConsultado.current = null;
    hasta.current = null;
  }

  async function verAnteriores() {
    if (!abierto || mensajes.length === 0) return;
    const el = fondo.current;
    const alto = el?.scrollHeight ?? 0;
    const r = await fetch(`/api/whatsapp/bandeja?chat=${abierto}&antes=${encodeURIComponent(mensajes[0].createdAt)}`, { cache: 'no-store' });
    if (!r.ok) return;
    const d: Respuesta = await r.json();
    pegadoAbajo.current = false;
    setMensajes((m) => unir(m, d.mensajes ?? []));
    setMasViejos(!!d.masViejos);
    // Que la pantalla no salte: se queda mirando el mismo mensaje
    requestAnimationFrame(() => { if (el) el.scrollTop = el.scrollHeight - alto; });
  }

  /** Corre una acción del chat y refresca. */
  function correr(fn: () => Promise<{ ok: boolean; error?: string }>) {
    setError('');
    startTransition(async () => {
      try {
        const r = await fn();
        if (!r.ok && r.error) setError(r.error);
      } catch {
        setError('No se pudo. Revisá la conexión.');
      }
      await consultar();
    });
  }

  const atencion = chats.filter((c) => c.pideAtencion).length;

  if (!linea) {
    return (
      <div className="panel mx-auto max-w-xl p-8 text-center">
        <h1 className="font-display text-2xl">WhatsApp</h1>
        <p className="mt-3 text-carbon-500">Este local todavía no conectó su WhatsApp.</p>
        {puedeConfigurar
          ? <Link href="/admin/config?seccion=whatsapp" className="btn-acento mt-5 inline-block px-6 py-2.5">Conectarlo</Link>
          : <p className="mt-3 text-sm text-carbon-500">Pedile a quien administre el local que lo conecte en Configuración → WhatsApp.</p>}
      </div>
    );
  }

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-display text-2xl">WhatsApp{noLeidos > 0 && <span className="ml-2 rounded-full bg-rojo px-2 py-0.5 align-middle text-sm text-sobre-rojo">{noLeidos}</span>}</h1>
        {linea.status === 'conectado' && linea.phone && <span className="text-sm text-carbon-500">{mostrarTelefono(linea.phone)}</span>}
      </div>

      {linea.status !== 'conectado' && (
        <p role="alert" className="mb-4 rounded-xl bg-ladrillo/10 px-4 py-3 text-sm text-ladrillo">
          El WhatsApp del local está desconectado: no entran ni salen mensajes.{' '}
          {linea.lastError && `${linea.lastError} `}
          {puedeConfigurar && <Link href="/admin/config?seccion=whatsapp" className="font-semibold underline">Reconectarlo</Link>}
        </p>
      )}
      {!sonidoActivo && (
        <button onClick={() => void activar()} className="mb-4 w-full rounded-xl border-2 border-dashed border-rojo/40 bg-rojo/5 px-4 py-2.5 text-sm font-medium">
          🔔 Tocá acá para que suene cuando entra un mensaje
        </button>
      )}

      <div className="panel grid h-[calc(100dvh-15rem)] min-h-[420px] grid-cols-1 overflow-hidden md:h-[calc(100vh-11rem)] md:grid-cols-[19rem_minmax(0,1fr)] xl:grid-cols-[19rem_minmax(0,1fr)_17rem]">
        {/* ── Lista de chats ── */}
        <aside className={`min-h-0 min-w-0 flex-col border-r border-carbon/10 ${abierto ? 'hidden md:flex' : 'flex'}`}>
          <div className="space-y-2 border-b border-carbon/10 p-3">
            <div className="flex gap-2">
              <input className="input py-2 text-sm" placeholder="Buscar nombre o teléfono" value={busqueda} onChange={(e) => setBusqueda(e.target.value)} />
              <button onClick={() => setNuevoChat((v) => !v)} className="btn-fantasma shrink-0 px-3 text-sm" title="Escribirle a un número">Nuevo</button>
            </div>
            {nuevoChat && (
              <form
                className="flex gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  const tel = String(new FormData(e.currentTarget).get('tel') ?? '');
                  correr(async () => {
                    const r = await abrirChat(tel);
                    if (r.ok) { elegir(r.chatId); setNuevoChat(false); }
                    return r;
                  });
                }}
              >
                <input name="tel" className="input py-2 text-sm" placeholder="11 2345 6789" inputMode="tel" autoFocus />
                <button className="btn-primario shrink-0 px-3 text-sm">Abrir</button>
              </form>
            )}
            <div className="scroll-fino -mx-3 flex gap-1.5 overflow-x-auto px-3">
              {([['todos', 'Todos'], ['sin_leer', 'Sin leer'], ['atencion', `Piden atención${atencion ? ` (${atencion})` : ''}`], ['archivados', 'Archivados']] as const).map(([id, label]) => (
                <button key={id} onClick={() => setFiltro(id)} className={`chip shrink-0 whitespace-nowrap px-3 py-1 text-xs ${filtro === id ? 'chip-activo' : ''}`}>{label}</button>
              ))}
            </div>
          </div>
          <ul className="scroll-fino min-h-0 flex-1 overflow-y-auto">
            {chats.length === 0 && <li className="p-6 text-center text-sm text-carbon-500">{busqueda || filtro !== 'todos' ? 'No hay chats así.' : 'Todavía no hay chats. Cuando alguien escriba, aparece acá.'}</li>}
            {chats.map((c) => (
              <li key={c.id}>
                <button
                  onClick={() => elegir(c.id)}
                  className={`flex w-full items-start gap-3 border-b border-carbon/5 px-3 py-3 text-left hover:bg-crema-200/60 ${c.id === abierto ? 'bg-crema-200' : ''} ${c.pideAtencion ? 'border-l-4 border-l-rojo' : ''}`}
                >
                  <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-marca/10 font-semibold text-marca">{nombreDe(c).replace(/^\+/, '').charAt(0).toUpperCase()}</span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-baseline justify-between gap-2">
                      <span className={`truncate ${c.unread ? 'font-bold' : 'font-medium'}`}>{nombreDe(c)}</span>
                      <span className="shrink-0 text-[11px] text-carbon-500">{horaCorta(c.lastMessageAt)}</span>
                    </span>
                    <span className="flex items-center justify-between gap-2">
                      <span className={`truncate text-sm ${c.unread ? 'text-carbon' : 'text-carbon-500'}`}>
                        {c.pideAtencion && <span className="font-semibold text-rojo">Pide una persona · </span>}{c.lastPreview}
                      </span>
                      {c.unread > 0 && <span className="shrink-0 rounded-full bg-verde px-1.5 py-0.5 text-[11px] font-bold leading-none text-white">{c.unread}</span>}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </aside>

        {/* ── Conversación ── */}
        <section className={`min-h-0 min-w-0 flex-col ${abierto ? 'flex' : 'hidden md:flex'}`}>
          {!abierto || !chat ? (
            <div className="grid flex-1 place-items-center p-8 text-center text-sm text-carbon-500">
              {abierto ? 'Cargando...' : 'Elegí un chat de la izquierda.'}
            </div>
          ) : (
            <>
              <header className="flex flex-wrap items-center gap-2 border-b border-carbon/10 px-3 py-2.5">
                <button onClick={() => setAbierto(null)} className="px-1 text-xl md:hidden" aria-label="Volver a los chats">←</button>
                {/* En el celular el nombre ocupa su renglón y los botones bajan al siguiente */}
                <div className="min-w-[9rem] flex-1">
                  <p className="truncate font-semibold">{nombreDe(chat)}</p>
                  <p className="whitespace-nowrap text-xs text-carbon-500">{chat.phone ? mostrarTelefono(chat.phone) : 'Número oculto por WhatsApp'}</p>
                </div>
                {chat.pideAtencion && <button onClick={() => correr(() => marcarAtendido(chat.id))} className="chip px-3 py-1 text-xs">Ya lo atendí</button>}
                <button onClick={() => correr(() => botEnChat(chat.id, chat.botPausado))} className="chip px-3 py-1 text-xs" title="El bot no contesta en este chat mientras está pausado">
                  {chat.botPausado ? 'Bot pausado · reactivar' : 'Pausar bot'}
                </button>
                <button onClick={() => correr(async () => { const r = await archivarChat(chat.id, !chat.archived); if (r.ok) setAbierto(null); return r; })} className="chip px-3 py-1 text-xs">
                  {chat.archived ? 'Desarchivar' : 'Archivar'}
                </button>
                {pedidos && <button onClick={() => setCargarPedido(true)} className="btn-acento px-3 py-1.5 text-xs">Cargar pedido</button>}
              </header>

              <div
                ref={fondo}
                onScroll={(e) => { const el = e.currentTarget; pegadoAbajo.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60; }}
                className="scroll-fino min-h-0 flex-1 space-y-2 overflow-y-auto bg-[#efeae2] px-3 py-4"
              >
                {masViejos && (
                  <div className="text-center"><button onClick={() => void verAnteriores()} className="chip bg-white px-3 py-1 text-xs">Ver mensajes anteriores</button></div>
                )}
                {mensajes.map((m) => <Burbuja key={m.id} m={m} onReintentar={() => correr(() => reintentarMensaje(m.id))} />)}
              </div>

              {error && <p role="alert" className="border-t border-ladrillo/20 bg-ladrillo/10 px-3 py-2 text-sm text-ladrillo">{error}</p>}
              <Redactor
                chatId={chat.id}
                respuestas={respuestas}
                desactivado={linea.status !== 'conectado'}
                onEnviado={() => { pegadoAbajo.current = true; void consultar(); }}
                onError={setError}
              />
            </>
          )}
        </section>

        {/* ── El cliente ── */}
        <aside className="hidden min-h-0 overflow-y-auto border-l border-carbon/10 p-4 xl:block">
          {chat ? (
            <>
              <h2 className="font-semibold">{nombreDe(chat)}</h2>
              {chat.phone && <p className="text-sm text-carbon-500">{mostrarTelefono(chat.phone)}</p>}
              <h3 className="mt-5 text-xs font-semibold uppercase tracking-wide text-carbon-500">Pedidos en este local</h3>
              {cliente === null || cliente.length === 0 ? (
                <p className="mt-2 text-sm text-carbon-500">{chat.phone ? 'Todavía no hizo pedidos con este número.' : 'Sin número no se pueden buscar sus pedidos.'}</p>
              ) : (
                <>
                  <p className="mt-1 text-sm">{cliente.length === 8 ? 'Más de 7' : cliente.length} {cliente.length === 1 ? 'pedido' : 'pedidos'} · último {horaCorta(cliente[0].createdAt)}</p>
                  <ul className="mt-3 space-y-2">
                    {cliente.map((p) => (
                      <li key={p.id} className="rounded-xl border border-carbon/10 p-2.5 text-sm">
                        <div className="flex items-baseline justify-between gap-2">
                          <a href={`/pedido/${p.code}`} target="_blank" rel="noreferrer" className="font-semibold underline">{p.code}</a>
                          <span className="text-xs text-carbon-500">{horaCorta(p.createdAt)}</span>
                        </div>
                        <p className="text-xs text-carbon-500">{ESTADO_PEDIDO[p.status] ?? p.status} · {money(p.total)}</p>
                        <p className="mt-1 line-clamp-2 text-xs">{p.resumen}</p>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </>
          ) : (
            <p className="text-sm text-carbon-500">Acá ves los pedidos del cliente del chat abierto.</p>
          )}
        </aside>
      </div>

      {cargarPedido && pedidos && chat && (
        <NuevoPedidoMostrador
          branchId={pedidos.branchId}
          categorias={pedidos.categorias}
          zonas={pedidos.zonas}
          mesas={pedidos.mesas}
          abiertoInicial
          clienteInicial={{ nombre: chat.name, telefono: chat.phone ? mostrarTelefono(chat.phone) : '' }}
          onCerrar={() => setCargarPedido(false)}
          onGuardado={() => void consultar()}
        />
      )}
    </div>
  );
}

const QUIEN: Record<string, string> = { celular: 'Desde el celular', aviso: 'Aviso automático', bot: 'Bot' };

function Burbuja({ m, onReintentar }: { m: Mensaje; onReintentar: () => void }) {
  const src = `/api/whatsapp/media/${m.id}`;
  const quien = m.fromMe ? (m.author === 'panel' ? m.userName : QUIEN[m.author] ?? '') : '';
  return (
    <div className={`flex ${m.fromMe ? 'justify-end' : 'justify-start'}`}>
      <div className={`max-w-[85%] rounded-xl px-3 py-2 text-sm shadow-sm sm:max-w-[70%] ${m.fromMe ? 'rounded-tr-sm bg-[#d9fdd3]' : 'rounded-tl-sm bg-white'}`}>
        {quien && <p className="mb-0.5 text-[11px] font-semibold text-verde">{quien}{m.pedido ? ` · ${m.pedido}` : ''}</p>}
        <Contenido m={m} src={src} />
        <p className="mt-1 flex items-center justify-end gap-1 text-[11px] text-carbon-500">
          {horaCorta(m.createdAt)}
          {m.fromMe && <Tilde status={m.status} />}
        </p>
        {m.status === 'error' && (
          <p className="mt-1 text-xs text-ladrillo">
            No salió{m.error ? `: ${m.error}` : ''}.{' '}
            <button onClick={onReintentar} className="font-semibold underline">Reintentar</button>
          </p>
        )}
      </div>
    </div>
  );
}

function Contenido({ m, src }: { m: Mensaje; src: string }) {
  const texto = m.text && <p className="whitespace-pre-wrap break-words">{m.text}</p>;
  if (!m.archivo && m.type !== 'texto' && m.type !== 'ubicacion' && m.type !== 'contacto' && m.type !== 'otro') {
    return <>{texto ?? <p className="italic text-carbon-500">Archivo no disponible</p>}</>;
  }
  switch (m.type) {
    case 'imagen':
      return (
        <>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <a href={src} target="_blank" rel="noreferrer"><img src={src} alt="Foto" className="max-h-72 rounded-lg" loading="lazy" /></a>
          {texto}
        </>
      );
    case 'sticker':
      // eslint-disable-next-line @next/next/no-img-element
      return <img src={src} alt="Sticker" className="h-28 w-28 object-contain" loading="lazy" />;
    case 'audio':
      return <audio controls preload="none" src={src} className="max-w-full" />;
    case 'video':
      return <><video controls preload="metadata" src={src} className="max-h-72 max-w-full rounded-lg" />{texto}</>;
    case 'documento':
      return <><a href={src} className="flex items-center gap-2 rounded-lg bg-carbon/5 px-3 py-2 underline">📄 {m.mediaName || 'Documento'}</a>{texto}</>;
    case 'ubicacion': {
      const [coords, ...lugar] = m.text.split('\n');
      return <a href={`https://maps.google.com/?q=${encodeURIComponent(coords)}`} target="_blank" rel="noreferrer" className="underline">📍 {lugar.join(' ') || 'Ver ubicación en el mapa'}</a>;
    }
    case 'contacto':
      return <p>👤 {m.text}</p>;
    case 'otro':
      return <p className="italic text-carbon-500">{m.text}</p>;
    default:
      return <>{texto}</>;
  }
}

function Tilde({ status }: { status: string }) {
  if (status === 'pendiente' || status === 'enviando') return <span title="Mandando">🕓</span>;
  if (status === 'error') return <span title="No salió" className="text-ladrillo">⚠</span>;
  if (status === 'leido') return <span title="Leído" className="font-bold text-[#53bdeb]">✓✓</span>;
  if (status === 'entregado') return <span title="Entregado">✓✓</span>;
  return <span title="Enviado">✓</span>;
}

/** El cuadro de abajo: texto, respuestas rápidas, archivos y nota de voz. */
function Redactor({ chatId, respuestas, desactivado, onEnviado, onError }: {
  chatId: string; respuestas: { titulo: string; texto: string }[]; desactivado: boolean;
  onEnviado: () => void; onError: (e: string) => void;
}) {
  const [texto, setTexto] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [rapidas, setRapidas] = useState(false);
  const [grabando, setGrabando] = useState(false);
  const grabador = useRef<MediaRecorder | null>(null);
  const partes = useRef<Blob[]>([]);
  const archivo = useRef<HTMLInputElement>(null);

  // Cambiar de chat no se lleva lo escrito a otra persona
  useEffect(() => { setTexto(''); setRapidas(false); }, [chatId]);

  async function mandar(fn: () => Promise<{ ok: boolean; error?: string }>, limpiar = true) {
    onError('');
    setEnviando(true);
    try {
      const r = await fn();
      if (!r.ok && r.error) onError(r.error);
      if (limpiar) setTexto('');
      onEnviado();
    } catch {
      onError('No se pudo mandar. Revisá la conexión.');
    } finally {
      setEnviando(false);
    }
  }

  function enviarTexto() {
    const t = texto.trim();
    if (!t || enviando) return;
    void mandar(() => enviarTextoChat(chatId, t));
  }

  function enviarArchivo(f: File, voz = false) {
    const fd = new FormData();
    fd.set('chatId', chatId);
    fd.set('archivo', f);
    if (voz) fd.set('voz', '1');
    else if (texto.trim()) fd.set('texto', texto.trim());
    void mandar(() => enviarArchivoChat(fd), !voz);
  }

  async function grabar() {
    if (grabando) { grabador.current?.stop(); return; }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const tipo = ['audio/ogg;codecs=opus', 'audio/webm;codecs=opus', 'audio/mp4'].find((t) => MediaRecorder.isTypeSupported(t)) ?? '';
      const rec = new MediaRecorder(stream, tipo ? { mimeType: tipo } : undefined);
      partes.current = [];
      rec.ondataavailable = (e) => { if (e.data.size) partes.current.push(e.data); };
      rec.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        setGrabando(false);
        const mime = (rec.mimeType || 'audio/webm').split(';')[0];
        const blob = new Blob(partes.current, { type: mime });
        if (blob.size > 0) enviarArchivo(new File([blob], `audio.${mime.split('/')[1] ?? 'webm'}`, { type: mime }), true);
      };
      grabador.current = rec;
      rec.start();
      setGrabando(true);
    } catch {
      onError('No se pudo usar el micrófono. Revisá el permiso del navegador.');
    }
  }

  if (desactivado) {
    return <p className="border-t border-carbon/10 p-3 text-center text-sm text-carbon-500">Con el WhatsApp desconectado no se pueden mandar mensajes.</p>;
  }

  return (
    <div className="border-t border-carbon/10 bg-white p-2">
      {rapidas && respuestas.length > 0 && (
        <div className="scroll-fino mb-2 flex gap-1.5 overflow-x-auto pb-1">
          {respuestas.map((r) => (
            <button key={r.titulo} onClick={() => { setTexto(r.texto); setRapidas(false); }} className="chip shrink-0 whitespace-nowrap px-3 py-1 text-xs" title={r.texto}>{r.titulo}</button>
          ))}
        </div>
      )}
      <div className="flex items-end gap-1.5">
        {respuestas.length > 0 && (
          <button onClick={() => setRapidas((v) => !v)} className="rounded-lg px-2 py-2 text-lg hover:bg-carbon/5" title="Respuestas rápidas" aria-label="Respuestas rápidas">⚡</button>
        )}
        <button onClick={() => archivo.current?.click()} disabled={enviando} className="rounded-lg px-2 py-2 text-lg hover:bg-carbon/5" title="Mandar foto o archivo" aria-label="Mandar foto o archivo">📎</button>
        <input
          ref={archivo}
          type="file"
          className="hidden"
          accept="image/*,video/mp4,audio/*,application/pdf,.doc,.docx,.xls,.xlsx"
          onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) enviarArchivo(f); }}
        />
        <textarea
          className="input max-h-40 min-h-[2.6rem] flex-1 resize-none py-2"
          rows={1}
          placeholder={grabando ? 'Grabando… tocá ⏹ para mandar' : 'Escribí un mensaje'}
          value={texto}
          disabled={grabando}
          onChange={(e) => setTexto(e.target.value)}
          onKeyDown={(e) => {
            // Enter manda; Shift+Enter baja de renglón
            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); enviarTexto(); }
          }}
        />
        {texto.trim() ? (
          <button onClick={enviarTexto} disabled={enviando} className="btn-primario px-4 py-2.5 text-sm">{enviando ? '...' : 'Enviar'}</button>
        ) : (
          <button onClick={() => void grabar()} disabled={enviando} className={`rounded-lg px-3 py-2 text-lg ${grabando ? 'bg-ladrillo text-white' : 'hover:bg-carbon/5'}`} title={grabando ? 'Terminar y mandar' : 'Grabar nota de voz'} aria-label={grabando ? 'Terminar y mandar' : 'Grabar nota de voz'}>
            {grabando ? '⏹' : '🎤'}
          </button>
        )}
      </div>
    </div>
  );
}
