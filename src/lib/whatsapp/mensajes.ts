import { createHash, timingSafeEqual } from 'crypto';
import { mkdir, readFile, writeFile } from 'fs/promises';
import { join } from 'path';
import type { OrderStatus, WhatsAppChat, WhatsAppLine, WhatsAppMessage } from '@prisma/client';
import { db } from '../db';
import { carpetaDelCliente } from '../media';
import { limitesDe } from '../plan';
import { urlDelCliente } from '../tenant';
import { leerConfigWhatsApp, rellenar, type ConfigWhatsApp } from './config';
import { claveTelefono, esChatDePersona, jidDeTelefono, normalizarTelefono, telefonoDeJid } from './telefono';
import {
  ErrorEvolution, datosInstancia, enviarArchivo, enviarNotaDeVoz, enviarTexto, estadoInstancia,
} from './evolution';

/**
 * Los mensajes de WhatsApp: lo que llega por el webhook de Evolution, la cola
 * de lo que sale (con reintentos) y los avisos automáticos de los pedidos.
 */

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function iguales(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/** Un aviso o una respuesta del bot que no sale en este tiempo ya no tiene sentido. */
const VENCE_MS = 2 * 60 * 60_000;
const MAX_INTENTOS = 4;

// ─────────── Archivos ───────────

const EXTENSION: Record<string, string> = {
  'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/gif': '.gif',
  'audio/ogg': '.ogg', 'audio/mpeg': '.mp3', 'audio/mp4': '.m4a', 'audio/aac': '.aac', 'audio/webm': '.webm', 'audio/wav': '.wav',
  'video/mp4': '.mp4', 'video/3gpp': '.3gp', 'video/webm': '.webm',
  'application/pdf': '.pdf',
};

function extensionDe(mime: string, nombre?: string | null): string {
  const delNombre = nombre?.match(/\.([a-z0-9]{1,5})$/i)?.[1];
  if (delNombre) return `.${delNombre.toLowerCase()}`;
  return EXTENSION[mime.split(';')[0].trim().toLowerCase()] ?? '.bin';
}

/** Guarda un archivo del chat en la carpeta del cliente. No es público: se sirve con sesión. */
export async function guardarArchivo(tenantId: string, chatId: string, id: string, datos: Buffer, mime: string, nombre?: string | null): Promise<string> {
  const limpio = (t: string) => t.replace(/[^a-zA-Z0-9_-]/g, '');
  const relativa = join('whatsapp', limpio(chatId), `${limpio(id)}${extensionDe(mime, nombre)}`);
  const carpeta = carpetaDelCliente(tenantId);
  await mkdir(join(carpeta, 'whatsapp', limpio(chatId)), { recursive: true });
  await writeFile(join(carpeta, relativa), datos);
  return relativa;
}

export function rutaDeArchivo(tenantId: string, relativa: string): string {
  return join(carpetaDelCliente(tenantId), relativa);
}

// ─────────── Lo que llega de WhatsApp ───────────

type Contenido = {
  type: string;
  text: string;
  mime?: string;
  nombre?: string;
  voz?: boolean;
};

/** "📷 Foto", "🎤 Audio"... para la lista de chats. */
export function vistaPrevia(m: { type: string; text: string; voz?: boolean }): string {
  const iconos: Record<string, string> = {
    imagen: '📷 Foto', audio: '🎤 Audio', video: '🎥 Video', documento: '📄 Documento',
    sticker: 'Sticker', ubicacion: '📍 Ubicación', contacto: '👤 Contacto',
  };
  const base = m.type === 'texto' ? m.text : iconos[m.type] ?? m.text;
  const conTexto = m.type !== 'texto' && m.text && m.type !== 'ubicacion' && m.type !== 'contacto' ? `${base}: ${m.text}` : base;
  return conTexto.replace(/\s+/g, ' ').trim().slice(0, 120);
}

type MensajeWa = Record<string, Record<string, unknown> | string | undefined>;

/** Qué tipo de mensaje es y su texto. Null para lo que no se muestra (reacciones, avisos internos). */
export function leerContenido(mensaje: unknown): Contenido | null {
  if (!mensaje || typeof mensaje !== 'object') return null;
  let m = mensaje as MensajeWa;
  // Mensajes temporales o de una sola vista: el contenido viene envuelto
  for (const envoltorio of ['ephemeralMessage', 'viewOnceMessage', 'viewOnceMessageV2', 'viewOnceMessageV2Extension', 'documentWithCaptionMessage']) {
    const dentro = (m[envoltorio] as { message?: MensajeWa } | undefined)?.message;
    if (dentro) m = { ...dentro, base64: m.base64 };
  }
  const obj = (k: string) => (m[k] && typeof m[k] === 'object' ? (m[k] as Record<string, unknown>) : null);
  const str = (v: unknown) => (typeof v === 'string' ? v : '');

  if (typeof m.conversation === 'string' && m.conversation) return { type: 'texto', text: m.conversation };
  const ext = obj('extendedTextMessage');
  if (ext) return { type: 'texto', text: str(ext.text) };
  const img = obj('imageMessage');
  if (img) return { type: 'imagen', text: str(img.caption), mime: str(img.mimetype) || 'image/jpeg' };
  const vid = obj('videoMessage');
  if (vid) return { type: 'video', text: str(vid.caption), mime: str(vid.mimetype) || 'video/mp4' };
  const aud = obj('audioMessage');
  if (aud) return { type: 'audio', text: '', mime: str(aud.mimetype) || 'audio/ogg', voz: aud.ptt === true };
  const doc = obj('documentMessage');
  if (doc) return { type: 'documento', text: str(doc.caption), mime: str(doc.mimetype) || 'application/octet-stream', nombre: str(doc.fileName) || str(doc.title) || 'archivo' };
  const st = obj('stickerMessage');
  if (st) return { type: 'sticker', text: '', mime: str(st.mimetype) || 'image/webp' };
  const loc = obj('locationMessage') ?? obj('liveLocationMessage');
  if (loc) {
    const lat = Number(loc.degreesLatitude);
    const lng = Number(loc.degreesLongitude);
    const lugar = [str(loc.name), str(loc.address)].filter(Boolean).join(' · ');
    return { type: 'ubicacion', text: `${lat},${lng}${lugar ? `\n${lugar}` : ''}` };
  }
  const contacto = obj('contactMessage');
  if (contacto) {
    const tel = str(contacto.vcard).match(/TEL[^:]*:([+\d\s-]+)/)?.[1]?.trim() ?? '';
    return { type: 'contacto', text: [str(contacto.displayName), tel].filter(Boolean).join(' · ') };
  }
  const contactos = obj('contactsArrayMessage');
  if (contactos) return { type: 'contacto', text: str(contactos.displayName) || 'Contactos' };
  const boton = obj('buttonsResponseMessage') ?? obj('templateButtonReplyMessage');
  if (boton) return { type: 'texto', text: str(boton.selectedDisplayText) };
  const lista = obj('listResponseMessage');
  if (lista) return { type: 'texto', text: str(lista.title) };

  // Reacciones, ediciones, borrados, claves de grupo: no son mensajes para mostrar
  const internos = ['reactionMessage', 'protocolMessage', 'senderKeyDistributionMessage', 'editedMessage', 'pollUpdateMessage', 'keepInChatMessage', 'messageContextInfo'];
  const claves = Object.keys(m).filter((k) => k !== 'base64');
  if (claves.length === 0 || claves.every((k) => internos.includes(k))) return null;
  return { type: 'otro', text: 'Mensaje que el sistema no puede mostrar (miralo en el celular)' };
}

/** Busca el chat de ese identificador o lo crea. */
async function chatDe(line: WhatsAppLine, jid: string, phone: string, name: string): Promise<WhatsAppChat> {
  const actual = await db.whatsAppChat.findUnique({ where: { lineId_jid: { lineId: line.id, jid } } });
  if (actual) {
    if ((phone && !actual.phone) || (name && name !== actual.name)) {
      return db.whatsAppChat.update({ where: { id: actual.id }, data: { ...(phone && !actual.phone ? { phone } : {}), ...(name ? { name } : {}) } });
    }
    return actual;
  }
  // Un chat abierto desde el sistema con el teléfono (antes de que el cliente
  // escriba) puede tener otro identificador: se unen por el teléfono
  if (phone) {
    const porTelefono = await db.whatsAppChat.findFirst({ where: { lineId: line.id, phone } });
    if (porTelefono) {
      return db.whatsAppChat.update({ where: { id: porTelefono.id }, data: { jid, ...(name ? { name } : {}) } });
    }
  }
  return db.whatsAppChat.create({ data: { lineId: line.id, branchId: line.branchId, jid, phone, name } });
}

type DatosMensaje = {
  key?: { remoteJid?: string; remoteJidAlt?: string; senderPn?: string; fromMe?: boolean; id?: string };
  pushName?: string;
  message?: unknown;
  messageTimestamp?: number | string;
};

async function guardarMensaje(line: WhatsAppLine, d: DatosMensaje) {
  const jid = d.key?.remoteJid ?? '';
  const waId = d.key?.id ?? '';
  if (!jid || !waId || !esChatDePersona(jid)) return;
  const contenido = leerContenido(d.message);
  if (!contenido) return;

  const fromMe = d.key?.fromMe === true;
  const phone = telefonoDeJid(jid) || telefonoDeJid(d.key?.remoteJidAlt) || telefonoDeJid(d.key?.senderPn);
  // El nombre que viene en un mensaje propio es el del local, no el del cliente
  const chat = await chatDe(line, jid, phone, fromMe ? '' : (d.pushName ?? '').slice(0, 80));

  if (await db.whatsAppMessage.findUnique({ where: { chatId_waId: { chatId: chat.id, waId } } })) return;

  if (fromMe) {
    // Lo que se mandó desde el sistema vuelve como mensaje propio: si la
    // respuesta de Evolution todavía no llegó, se une acá en vez de duplicarse
    const nuestro = await db.whatsAppMessage.findFirst({
      where: { chatId: chat.id, fromMe: true, waId: null, status: { in: ['enviando', 'pendiente'] }, text: contenido.text, createdAt: { gt: new Date(Date.now() - 5 * 60_000) } },
      orderBy: { createdAt: 'asc' },
    });
    if (nuestro) {
      await db.whatsAppMessage.update({ where: { id: nuestro.id }, data: { waId } });
      return;
    }
  }

  const segundos = Number(d.messageTimestamp);
  const cuando = Number.isFinite(segundos) && segundos > 0 && segundos * 1000 <= Date.now() + 60_000 ? new Date(segundos * 1000) : new Date();

  const msg = await db.whatsAppMessage.create({
    data: {
      chatId: chat.id, waId, fromMe,
      author: fromMe ? 'celular' : 'cliente',
      type: contenido.type, text: contenido.text.slice(0, 4000),
      mediaMime: contenido.mime ?? null, mediaName: contenido.nombre ?? null, voz: contenido.voz ?? false,
      status: fromMe ? 'enviado' : 'recibido',
      createdAt: cuando,
    },
  });

  // El archivo viene adentro del aviso (Evolution con base64 activado)
  const b64 = (d.message as { base64?: unknown })?.base64;
  if (contenido.mime && typeof b64 === 'string' && b64) {
    try {
      const ruta = await guardarArchivo(line.tenantId, chat.id, msg.id, Buffer.from(b64.replace(/^data:[^,]+,/, ''), 'base64'), contenido.mime, contenido.nombre);
      await db.whatsAppMessage.update({ where: { id: msg.id }, data: { mediaPath: ruta } });
    } catch (e) {
      console.error('WhatsApp: no se pudo guardar el archivo', e);
    }
  }

  const config = leerConfigWhatsApp(line.config);
  await db.whatsAppChat.update({
    where: { id: chat.id },
    data: {
      lastMessageAt: cuando,
      lastPreview: vistaPrevia(contenido),
      archived: false,
      ...(fromMe
        // Alguien del local contestó desde el celular: el bot se calla en este chat
        ? { pideAtencion: false, botPausedUntil: new Date(Date.now() + config.bot.pausaHoras * 3_600_000) }
        : { unread: { increment: 1 } }),
    },
  });

  if (!fromMe && contenido.type === 'texto' && contenido.text.trim()) {
    const { responderBot } = await import('./bot');
    await responderBot(line.id, chat.id, contenido.text).catch((e) => console.error('WhatsApp bot', e));
  }
}

const ORDEN_ESTADO = ['pendiente', 'enviando', 'enviado', 'entregado', 'leido'];
const ESTADO_WA: Record<string, string> = { SERVER_ACK: 'enviado', DELIVERY_ACK: 'entregado', READ: 'leido', PLAYED: 'leido' };

async function actualizarEstado(line: WhatsAppLine, d: { keyId?: string; status?: string; fromMe?: boolean }) {
  const estado = ESTADO_WA[String(d.status ?? '').toUpperCase()];
  if (!estado || !d.keyId) return;
  // Solo para adelante: un "entregado" que llega tarde no pisa un "leído"
  const anteriores = ORDEN_ESTADO.slice(0, ORDEN_ESTADO.indexOf(estado));
  await db.whatsAppMessage.updateMany({
    where: { waId: d.keyId, fromMe: true, chat: { lineId: line.id }, status: { in: anteriores } },
    data: { status: estado },
  });
}

/**
 * Lo que manda Evolution al webhook. La instancia viene en el cuerpo y la
 * clave en el encabezado: si no coinciden, se rechaza.
 */
export async function procesarWebhook(cuerpo: unknown, token: string | null): Promise<number> {
  const p = (cuerpo && typeof cuerpo === 'object' ? cuerpo : {}) as { event?: string; instance?: string; data?: Record<string, unknown> };
  const instancia = typeof p.instance === 'string' ? p.instance : '';
  if (!instancia || !token) return 401;
  const line = await db.whatsAppLine.findUnique({ where: { instance: instancia }, include: { tenant: { include: { plan: true } } } });
  if (!line || !iguales(hashToken(token), line.tokenHash)) return 401;

  const evento = String(p.event ?? '').toLowerCase().replace(/_/g, '.');
  const data = (p.data ?? {}) as Record<string, unknown>;
  const ahora = new Date();
  await db.whatsAppLine.update({ where: { id: line.id }, data: { lastEventAt: ahora } });

  if (evento === 'qrcode.updated') {
    const qr = (data.qrcode as { base64?: string } | undefined)?.base64;
    if (qr && line.status !== 'conectado') {
      await db.whatsAppLine.update({ where: { id: line.id }, data: { status: 'esperando_qr', qr, qrAt: ahora, lastError: null } });
    }
    return 200;
  }

  if (evento === 'connection.update') {
    const estado = String(data.state ?? '');
    if (estado === 'open') {
      let datos = { phone: line.phone, profileName: line.profileName };
      try { datos = await datosInstancia(instancia); } catch (e) { console.error('WhatsApp: datos de la instancia', e); }
      await db.whatsAppLine.update({
        where: { id: line.id },
        data: { status: 'conectado', qr: null, qrAt: null, lastError: null, connectedAt: line.status === 'conectado' ? line.connectedAt : ahora, ...datos },
      });
      // Lo que quedó esperando a que vuelva la conexión, sale ahora (sin esperar el próximo reintento)
      await db.whatsAppMessage.updateMany({ where: { status: 'pendiente', chat: { lineId: line.id } }, data: { nextTryAt: null } });
      void procesarCola();
    } else if (estado === 'close' && line.status !== 'desconectado') {
      // (Si ya estaba desconectado, es el aviso de una desconexión pedida desde
      // el panel: no hay nada que explicar.)
      const motivo = Number(data.statusReason);
      const error = motivo === 401
        ? 'Se desvinculó desde el celular (Dispositivos vinculados). Volvé a conectarlo.'
        : line.status === 'esperando_qr'
          ? 'El código QR venció sin escanearse. Tocá Conectar de nuevo.'
          : 'Se cortó la conexión con WhatsApp.';
      // Condicional en la misma escritura: si el panel lo desconectó mientras
      // tanto, este aviso es de esa desconexión y no hay nada que explicar
      await db.whatsAppLine.updateMany({ where: { id: line.id, status: { not: 'desconectado' } }, data: { status: 'desconectado', qr: null, qrAt: null, lastError: error } });
    }
    return 200;
  }

  // Un cliente dado de baja o sin WhatsApp en su plan no recibe nada nuevo
  if (!line.tenant.active || !limitesDe(line.tenant).funciones.includes('whatsapp')) return 200;

  if (evento === 'messages.upsert') {
    // Según la versión, viene un mensaje o una lista
    const lista = Array.isArray(data) ? data : Array.isArray(data.messages) ? data.messages : [data];
    for (const d of lista) await guardarMensaje(line, d as DatosMensaje);
  } else if (evento === 'messages.update') {
    const lista = Array.isArray(data) ? data : [data];
    for (const d of lista) await actualizarEstado(line, d as { keyId?: string; status?: string });
  }
  return 200;
}

// ─────────── Lo que sale ───────────

type Encolar = {
  chat: Pick<WhatsAppChat, 'id'>;
  author: 'panel' | 'aviso' | 'bot';
  text?: string;
  type?: string;
  userId?: string;
  userName?: string;
  orderId?: string;
  archivo?: { ruta: string; mime: string; nombre: string; voz?: boolean };
};

/** Deja un mensaje listo para salir. Lo manda `enviarMensaje` (o la cola). */
export async function encolar(e: Encolar): Promise<WhatsAppMessage> {
  const type = e.type ?? (e.archivo ? (e.archivo.voz ? 'audio' : tipoParaMostrar(e.archivo.mime)) : 'texto');
  const msg = await db.whatsAppMessage.create({
    data: {
      chatId: e.chat.id, fromMe: true, author: e.author, userId: e.userId ?? null, userName: e.userName ?? '',
      type, text: (e.text ?? '').slice(0, 4000),
      mediaPath: e.archivo?.ruta ?? null, mediaMime: e.archivo?.mime ?? null, mediaName: e.archivo?.nombre ?? null, voz: e.archivo?.voz ?? false,
      status: 'pendiente', orderId: e.orderId ?? null,
    },
  });
  await db.whatsAppChat.update({
    where: { id: e.chat.id },
    data: {
      lastMessageAt: msg.createdAt, lastPreview: vistaPrevia(msg), archived: false,
      // Si contesta una persona del local, el pedido de atención queda resuelto
      ...(e.author === 'panel' ? { pideAtencion: false, unread: 0 } : {}),
    },
  });
  return msg;
}

function tipoParaMostrar(mime: string): string {
  if (mime.startsWith('image/')) return 'imagen';
  if (mime.startsWith('video/')) return 'video';
  if (mime.startsWith('audio/')) return 'audio';
  return 'documento';
}

/** El error de Evolution en palabras del local. */
function explicar(e: unknown): string {
  if (e instanceof ErrorEvolution) {
    if (e.status === 400 && /exists["':\s]*false/i.test(JSON.stringify(e.detalle ?? e.message))) return 'Ese número no tiene WhatsApp';
    if (e.status === 0) return e.message;
    return 'WhatsApp no aceptó el mensaje. Probá de nuevo en un rato.';
  }
  return 'No se pudo mandar el mensaje';
}

/**
 * Manda un mensaje que está pendiente. Lo que escribe alguien del local se
 * intenta una vez y, si falla, queda con el error a la vista para
 * reintentarlo. Los avisos y el bot se reintentan solos.
 */
export async function enviarMensaje(id: string): Promise<{ ok: true } | { ok: false; error: string }> {
  // Se reserva: dos vueltas de la cola no pueden mandar el mismo mensaje
  const tomado = await db.whatsAppMessage.updateMany({ where: { id, status: 'pendiente' }, data: { status: 'enviando' } });
  if (tomado.count === 0) return { ok: false, error: 'Ese mensaje ya se estaba mandando' };

  const m = await db.whatsAppMessage.findUniqueOrThrow({ where: { id }, include: { chat: { include: { line: true } } } });
  const line = m.chat.line;
  const manual = m.author === 'panel';

  const fallar = async (error: string, reintentar: boolean) => {
    const intentos = m.attempts + 1;
    if (reintentar && !manual && intentos < MAX_INTENTOS) {
      await db.whatsAppMessage.update({
        where: { id }, data: { status: 'pendiente', attempts: intentos, error, nextTryAt: new Date(Date.now() + 30_000 * 2 ** intentos) },
      });
    } else {
      await db.whatsAppMessage.update({ where: { id }, data: { status: 'error', attempts: intentos, error } });
    }
    return { ok: false as const, error };
  };

  if (line.status !== 'conectado') {
    const error = 'El WhatsApp del local está desconectado. Conectalo en Configuración → WhatsApp.';
    if (manual) return fallar(error, false);
    // Un aviso espera a que vuelva la conexión (hasta que vence), sin gastar intentos
    await db.whatsAppMessage.update({ where: { id }, data: { status: 'pendiente', error, nextTryAt: new Date(Date.now() + 60_000) } });
    return { ok: false, error };
  }

  const destino = m.chat.phone || m.chat.jid;
  try {
    let waId: string;
    if (m.mediaPath && m.mediaMime) {
      const base64 = (await readFile(rutaDeArchivo(line.tenantId, m.mediaPath))).toString('base64');
      waId = m.voz
        ? await enviarNotaDeVoz(line.instance, destino, base64)
        : await enviarArchivo(line.instance, destino, { mime: m.mediaMime, base64, nombre: m.mediaName || 'archivo', caption: m.text || undefined });
    } else {
      waId = await enviarTexto(line.instance, destino, m.text);
    }
    await db.$transaction([
      // Si el aviso de WhatsApp llegó antes que la respuesta, quedó guardado como del celular: se borra ese
      db.whatsAppMessage.deleteMany({ where: { chatId: m.chatId, waId, id: { not: id } } }),
      db.whatsAppMessage.update({ where: { id }, data: { status: 'enviado', waId, error: null, attempts: m.attempts + 1 } }),
    ]);
    return { ok: true };
  } catch (e) {
    if (!(e instanceof ErrorEvolution)) console.error('WhatsApp: envío', e);
    // "Ese número no tiene WhatsApp" no se arregla reintentando
    const error = explicar(e);
    return fallar(error, error !== 'Ese número no tiene WhatsApp');
  }
}

let corriendo = false;
let otraVuelta = false;

/** Manda lo pendiente. Se llama después de encolar y, por las dudas, cada pocos segundos. */
export async function procesarCola(): Promise<void> {
  if (corriendo) { otraVuelta = true; return; }
  corriendo = true;
  try {
    do {
      otraVuelta = false;
      const ahora = new Date();
      await db.whatsAppMessage.updateMany({
        where: { status: 'pendiente', createdAt: { lt: new Date(ahora.getTime() - VENCE_MS) } },
        data: { status: 'error', error: 'No salió a tiempo: el WhatsApp del local estuvo desconectado' },
      });
      const pendientes = await db.whatsAppMessage.findMany({
        where: { status: 'pendiente', OR: [{ nextTryAt: null }, { nextTryAt: { lte: ahora } }] },
        orderBy: { createdAt: 'asc' },
        take: 20,
        select: { id: true },
      });
      for (const p of pendientes) await enviarMensaje(p.id);
    } while (otraVuelta);
  } catch (e) {
    console.error('WhatsApp: cola', e);
  } finally {
    corriendo = false;
  }
}

/** Revisa con Evolution el estado de cada número, por si se perdió algún aviso de conexión. */
export async function sincronizarLineas(): Promise<void> {
  const lineas = await db.whatsAppLine.findMany({ where: { status: { not: 'desconectado' } } });
  for (const l of lineas) {
    try {
      const estado = await estadoInstancia(l.instance);
      if (estado === 'open' && l.status !== 'conectado') {
        const datos = await datosInstancia(l.instance).catch(() => ({}));
        await db.whatsAppLine.update({ where: { id: l.id }, data: { status: 'conectado', qr: null, qrAt: null, lastError: null, connectedAt: new Date(), ...datos } });
      } else if ((estado === 'close' || estado === 'no_existe') && l.status === 'conectado') {
        await db.whatsAppLine.update({ where: { id: l.id }, data: { status: 'desconectado', lastError: 'Se cortó la conexión con WhatsApp.' } });
      }
    } catch { /* Evolution caído: se reintenta en la próxima vuelta */ }
  }
}

// ─────────── Chats y pedidos ───────────

/** El chat con ese teléfono, o uno nuevo si nunca se habló. */
export async function chatConTelefono(line: WhatsAppLine, telefono: string): Promise<WhatsAppChat | null> {
  const phone = normalizarTelefono(telefono);
  if (!phone) return null;
  const existente = await db.whatsAppChat.findFirst({ where: { lineId: line.id, phone } });
  if (existente) return existente;
  return db.whatsAppChat.upsert({
    where: { lineId_jid: { lineId: line.id, jid: jidDeTelefono(phone) } },
    create: { lineId: line.id, branchId: line.branchId, jid: jidDeTelefono(phone), phone },
    update: {},
  });
}

/** Los pedidos de un teléfono en esta sucursal, más nuevos primero. */
export async function pedidosDelTelefono(branchId: string, telefono: string, cuantos = 10) {
  const clave = claveTelefono(telefono);
  if (clave.length < 8) return [];
  const ids = await db.$queryRaw<{ id: string }[]>`
    select id from "Order"
    where "branchId" = ${branchId} and right(regexp_replace("customerPhone", '\\D', '', 'g'), 8) = ${clave}
    order by "createdAt" desc limit ${cuantos}`;
  if (ids.length === 0) return [];
  return db.order.findMany({
    where: { id: { in: ids.map((x) => x.id) } },
    orderBy: { createdAt: 'desc' },
    select: { id: true, code: true, status: true, type: true, total: true, createdAt: true, customerName: true, esperandoPago: true, items: { select: { name: true, variantName: true, quantity: true } } },
  });
}

/** Los valores para rellenar los textos ({local}, {carta}...). */
export function valoresDelLocal(
  tenant: { slug: string; customDomain: string | null },
  branch: { name: string; slug: string; aliasBancario: string; tiempoDelivery: string },
): Record<string, string> {
  return {
    local: branch.name,
    carta: urlDelCliente(tenant, `/${branch.slug}`),
    alias: branch.aliasBancario,
    demora: branch.tiempoDelivery,
  };
}

/** Sin el nombre del cliente: "¡Hola !" → "¡Hola!" y ", tu pedido" → "Tu pedido". */
export function sinNombre(texto: string): string {
  const t = texto.replace(/[ \t]+([!,.?])/g, '$1').replace(/^[\s,]+/, '');
  return t.charAt(0).toUpperCase() + t.slice(1);
}

/** Qué aviso corresponde a cada cambio de estado del pedido. */
function avisoDe(estado: OrderStatus, tipo: string, c: ConfigWhatsApp) {
  if (estado === 'ACEPTADO') return c.avisos.aceptado;
  if (estado === 'EN_CAMINO') return c.avisos.enCamino;
  if (estado === 'LISTO' && tipo === 'TAKEAWAY') return c.avisos.listo;
  if (estado === 'RECHAZADO' || estado === 'CANCELADO') return c.avisos.rechazado;
  return null;
}

/**
 * Aviso automático al cliente cuando su pedido cambia de estado. Nunca hace
 * fallar el cambio de estado: si algo sale mal, el pedido sigue igual.
 */
export async function avisarPedido(orderId: string, estado: OrderStatus): Promise<void> {
  try {
    const o = await db.order.findUnique({
      where: { id: orderId },
      select: {
        id: true, code: true, type: true, customerName: true, customerPhone: true,
        branch: { select: { name: true, slug: true, aliasBancario: true, tiempoDelivery: true, whatsappLine: true, tenant: { include: { plan: true } } } },
      },
    });
    const line = o?.branch.whatsappLine;
    if (!o || !line || o.type === 'SALON') return;
    if (!limitesDe(o.branch.tenant).funciones.includes('whatsapp')) return;
    const aviso = avisoDe(estado, o.type, leerConfigWhatsApp(line.config));
    if (!aviso?.activo) return;

    const chat = await chatConTelefono(line, o.customerPhone);
    if (!chat) return;
    const primero = o.customerName.trim().split(/\s+/)[0] ?? '';
    const nombre = ['Mostrador', 'Salón', '-'].includes(primero) ? '' : primero;
    let texto = rellenar(aviso.texto, {
      ...valoresDelLocal(o.branch.tenant, o.branch),
      nombre,
      codigo: o.code,
      link: urlDelCliente(o.branch.tenant, `/pedido/${o.code}`),
    });
    if (!nombre) texto = sinNombre(texto);
    await encolar({ chat, author: 'aviso', text: texto, orderId: o.id });
    void procesarCola();
  } catch (e) {
    console.error('WhatsApp: aviso del pedido', e);
  }
}
