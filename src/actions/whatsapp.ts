'use server';

import { randomBytes } from 'crypto';
import { revalidatePath } from 'next/cache';
import { db } from '@/lib/db';
import { exigir, tieneFuncion, type SessionConSucursal } from '@/lib/session';
import { auditar } from '@/lib/auditoria';
import { leerConfigWhatsApp } from '@/lib/whatsapp/config';
import { cerrarInstancia, ErrorEvolution, evolutionDisponible, prepararInstancia } from '@/lib/whatsapp/evolution';
import { chatConTelefono, encolar, enviarMensaje, guardarArchivo, hashToken } from '@/lib/whatsapp/mensajes';

/**
 * El WhatsApp de cada sucursal: conectar el número (Configuración →
 * WhatsApp) y atender los chats (la bandeja).
 */

type R = { ok: true } | { ok: false; error: string };
type Sesion = SessionConSucursal;

const SIN_FUNCION = 'Tu plan no incluye WhatsApp';
/** Lo que se puede mandar desde el panel (el límite de las acciones del servidor es 8 MB) */
const MAX_ARCHIVO = 7 * 1024 * 1024;

async function sesion(permiso: string): Promise<{ s: Sesion; error?: undefined } | { s?: undefined; error: string }> {
  const s = await exigir(permiso);
  if (!tieneFuncion(s, 'whatsapp')) return { error: SIN_FUNCION };
  return { s };
}

/** Un chat de la sucursal en la que está parado el usuario. */
async function chatDeLaSucursal(s: Sesion, chatId: string) {
  return db.whatsAppChat.findFirst({ where: { id: String(chatId), branchId: s.branchId }, include: { line: true } });
}

// ─────────── Conexión (Configuración → WhatsApp) ───────────

export type EstadoWhatsApp = {
  status: string;
  phone: string;
  profileName: string;
  qr: string | null;
  lastError: string | null;
};

function estadoDe(l: { status: string; phone: string; profileName: string; qr: string | null; qrAt: Date | null; lastError: string | null } | null): EstadoWhatsApp {
  if (!l) return { status: 'desconectado', phone: '', profileName: '', qr: null, lastError: null };
  // Cada QR dura menos de un minuto: uno viejo no sirve para escanear
  const qrVigente = l.status === 'esperando_qr' && l.qr && l.qrAt && Date.now() - l.qrAt.getTime() < 70_000;
  return { status: l.status, phone: l.phone, profileName: l.profileName, qr: qrVigente ? l.qr : null, lastError: l.lastError };
}

/** Empieza a vincular el número: crea la instancia en Evolution y devuelve el QR para escanear. */
export async function conectarWhatsApp(): Promise<({ ok: true } & EstadoWhatsApp) | { ok: false; error: string }> {
  const { s, error } = await sesion('config.editar');
  if (!s) return { ok: false, error };
  if (!evolutionDisponible()) return { ok: false, error: 'WhatsApp no está habilitado en este servidor' };

  let line = await db.whatsAppLine.findUnique({ where: { branchId: s.branchId } });
  if (line?.status === 'conectado') return { ok: true, ...estadoDe(line) };

  // Clave nueva en cada conexión: la que tenga una instancia vieja deja de valer
  const token = randomBytes(24).toString('base64url');
  if (!line) {
    line = await db.whatsAppLine.create({
      data: { tenantId: s.tenantId, branchId: s.branchId, instance: `cs-${s.branchId}`, tokenHash: hashToken(token) },
    });
  } else {
    line = await db.whatsAppLine.update({ where: { id: line.id }, data: { tokenHash: hashToken(token) } });
  }

  try {
    const { qr } = await prepararInstancia(line.instance, token);
    line = await db.whatsAppLine.update({
      where: { id: line.id },
      data: { status: 'esperando_qr', lastError: null, ...(qr ? { qr, qrAt: new Date() } : {}) },
    });
  } catch (e) {
    console.error('WhatsApp: conectar', e);
    return { ok: false, error: e instanceof ErrorEvolution && e.status === 0 ? e.message : 'No se pudo preparar la conexión. Probá de nuevo en un momento.' };
  }
  await auditar({ tenantId: s.tenantId, actorType: 'usuario', actorId: s.userId, actorName: s.name, action: 'whatsapp', detail: `Empezó a conectar el WhatsApp de ${s.branchName}` });
  return { ok: true, ...estadoDe(line) };
}

/** La pantalla pregunta cada par de segundos mientras se escanea el QR. */
export async function estadoWhatsApp(): Promise<({ ok: true } & EstadoWhatsApp) | { ok: false; error: string }> {
  const { s, error } = await sesion('config.ver');
  if (!s) return { ok: false, error };
  const line = await db.whatsAppLine.findUnique({ where: { branchId: s.branchId } });
  return { ok: true, ...estadoDe(line) };
}

/** Desvincula el número. Los chats quedan guardados. */
export async function desconectarWhatsApp(): Promise<R> {
  const { s, error } = await sesion('config.editar');
  if (!s) return { ok: false, error };
  const line = await db.whatsAppLine.findUnique({ where: { branchId: s.branchId } });
  if (!line) return { ok: true };
  // Se marca antes de cerrar: el aviso de cierre que manda Evolution no tiene
  // que leerse como "lo desvincularon desde el celular"
  await db.whatsAppLine.update({ where: { id: line.id }, data: { status: 'desconectado', qr: null, qrAt: null, lastError: null } });
  try {
    await cerrarInstancia(line.instance);
  } catch (e) {
    console.error('WhatsApp: desconectar', e);
    await db.whatsAppLine.update({ where: { id: line.id }, data: { status: line.status } });
    return { ok: false, error: 'No se pudo desconectar. Probá de nuevo, o desvinculalo desde el celular (Dispositivos vinculados).' };
  }
  await db.whatsAppLine.update({ where: { id: line.id }, data: { phone: '', profileName: '', lastError: null } });
  await auditar({ tenantId: s.tenantId, actorType: 'usuario', actorId: s.userId, actorName: s.name, action: 'whatsapp', detail: `Desconectó el WhatsApp de ${s.branchName}${line.phone ? ` (${line.phone})` : ''}` });
  revalidatePath('/admin/config');
  return { ok: true };
}

/** Avisos automáticos, bot y respuestas rápidas. */
export async function guardarConfigWhatsApp(config: unknown): Promise<R> {
  const { s, error } = await sesion('config.editar');
  if (!s) return { ok: false, error };
  const line = await db.whatsAppLine.findUnique({ where: { branchId: s.branchId } });
  if (!line) return { ok: false, error: 'Primero conectá el WhatsApp de este local' };
  await db.whatsAppLine.update({ where: { id: line.id }, data: { config: JSON.stringify(leerConfigWhatsApp(config)) } });
  revalidatePath('/admin/config');
  revalidatePath('/admin/whatsapp');
  return { ok: true };
}

// ─────────── La bandeja ───────────

export async function enviarTextoChat(chatId: string, texto: string): Promise<R> {
  const { s, error } = await sesion('whatsapp.ver');
  if (!s) return { ok: false, error };
  const t = String(texto ?? '').trim();
  if (!t) return { ok: false, error: 'Escribí el mensaje' };
  if (t.length > 4000) return { ok: false, error: 'El mensaje es muy largo' };
  const chat = await chatDeLaSucursal(s, chatId);
  if (!chat) return { ok: false, error: 'No encontramos ese chat' };

  const m = await encolar({ chat, author: 'panel', text: t, userId: s.userId, userName: s.name });
  await pausarBotPorRespuesta(chat.id, chat.line.config);
  return enviarMensaje(m.id);
}

/** Foto, documento o nota de voz grabada en el panel. */
export async function enviarArchivoChat(fd: FormData): Promise<R> {
  const { s, error } = await sesion('whatsapp.ver');
  if (!s) return { ok: false, error };
  const chat = await chatDeLaSucursal(s, String(fd.get('chatId') ?? ''));
  if (!chat) return { ok: false, error: 'No encontramos ese chat' };
  const archivo = fd.get('archivo');
  if (!(archivo instanceof File) || archivo.size === 0) return { ok: false, error: 'Elegí un archivo' };
  if (archivo.size > MAX_ARCHIVO) return { ok: false, error: 'El archivo es muy pesado: hasta 7 MB' };
  const voz = fd.get('voz') === '1';
  const mime = (archivo.type || 'application/octet-stream').split(';')[0];
  if (voz && !mime.startsWith('audio/')) return { ok: false, error: 'La grabación no es un audio' };
  const nombre = (archivo.name || (voz ? 'audio' : 'archivo')).replace(/[\\/]/g, '_').slice(0, 120);
  const caption = String(fd.get('texto') ?? '').trim().slice(0, 1000);

  // Se guarda antes de encolarlo: así el archivo queda en el chat aunque WhatsApp falle
  const ruta = await guardarArchivo(s.tenantId, chat.id, `p${randomBytes(9).toString('hex')}`, Buffer.from(await archivo.arrayBuffer()), mime, nombre);
  const m = await encolar({ chat, author: 'panel', text: voz ? '' : caption, userId: s.userId, userName: s.name, archivo: { ruta, mime, nombre, voz } });
  await pausarBotPorRespuesta(chat.id, chat.line.config);
  return enviarMensaje(m.id);
}

/** Vuelve a intentar un mensaje que no salió. */
export async function reintentarMensaje(id: string): Promise<R> {
  const { s, error } = await sesion('whatsapp.ver');
  if (!s) return { ok: false, error };
  const r = await db.whatsAppMessage.updateMany({
    where: { id: String(id), status: 'error', fromMe: true, chat: { branchId: s.branchId } },
    data: { status: 'pendiente', error: null, nextTryAt: null },
  });
  if (r.count === 0) return { ok: false, error: 'Ese mensaje ya no se puede reintentar' };
  return enviarMensaje(String(id));
}

/** Si alguien del local contesta, el bot se calla en ese chat. */
async function pausarBotPorRespuesta(chatId: string, config: string) {
  const horas = leerConfigWhatsApp(config).bot.pausaHoras;
  await db.whatsAppChat.update({ where: { id: chatId }, data: { botPausedUntil: new Date(Date.now() + horas * 3_600_000) } });
}

export async function marcarLeido(chatId: string): Promise<R> {
  const { s, error } = await sesion('whatsapp.ver');
  if (!s) return { ok: false, error };
  await db.whatsAppChat.updateMany({ where: { id: String(chatId), branchId: s.branchId }, data: { unread: 0 } });
  return { ok: true };
}

/** Prender o apagar el bot en un chat puntual ("lo atiendo yo" / "devolver al bot"). */
export async function botEnChat(chatId: string, activo: boolean): Promise<R> {
  const { s, error } = await sesion('whatsapp.ver');
  if (!s) return { ok: false, error };
  const chat = await chatDeLaSucursal(s, chatId);
  if (!chat) return { ok: false, error: 'No encontramos ese chat' };
  await db.whatsAppChat.update({
    where: { id: chat.id },
    // "Apagado" es por un día; después vuelve solo
    data: { botPausedUntil: activo ? null : new Date(Date.now() + 24 * 3_600_000), ...(activo ? {} : { pideAtencion: false }) },
  });
  return { ok: true };
}

export async function archivarChat(chatId: string, archivar: boolean): Promise<R> {
  const { s, error } = await sesion('whatsapp.ver');
  if (!s) return { ok: false, error };
  const r = await db.whatsAppChat.updateMany({ where: { id: String(chatId), branchId: s.branchId }, data: { archived: !!archivar, ...(archivar ? { unread: 0, pideAtencion: false } : {}) } });
  return r.count ? { ok: true } : { ok: false, error: 'No encontramos ese chat' };
}

/** "Atendido": saca el pedido de atención sin tener que contestar (por ejemplo, se lo llamó por teléfono). */
export async function marcarAtendido(chatId: string): Promise<R> {
  const { s, error } = await sesion('whatsapp.ver');
  if (!s) return { ok: false, error };
  await db.whatsAppChat.updateMany({ where: { id: String(chatId), branchId: s.branchId }, data: { pideAtencion: false } });
  return { ok: true };
}

/** Abre (o encuentra) el chat con un teléfono: para escribirle a un cliente desde su pedido. */
export async function abrirChat(telefono: string): Promise<{ ok: true; chatId: string } | { ok: false; error: string }> {
  const { s, error } = await sesion('whatsapp.ver');
  if (!s) return { ok: false, error };
  const line = await db.whatsAppLine.findUnique({ where: { branchId: s.branchId } });
  if (!line) return { ok: false, error: 'Este local todavía no conectó su WhatsApp' };
  const chat = await chatConTelefono(line, String(telefono ?? ''));
  if (!chat) return { ok: false, error: 'Revisá el número: con característica, por ejemplo 11 2345 6789' };
  if (chat.archived) await db.whatsAppChat.update({ where: { id: chat.id }, data: { archived: false } });
  return { ok: true, chatId: chat.id };
}
