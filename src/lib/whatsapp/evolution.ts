/**
 * Cliente de Evolution API (v2.3), el servicio que mantiene vinculados los
 * WhatsApp de los locales. Corre en el mismo servidor, en la red interna de
 * Docker: EVOLUTION_URL y EVOLUTION_API_KEY en el .env.
 *
 * Cada sucursal es una "instancia" de Evolution. Los mensajes que llegan, el
 * QR y los cambios de conexión vienen por webhook a /api/whatsapp/webhook,
 * firmados con una clave propia de cada instancia.
 */

const EVENTOS = ['QRCODE_UPDATED', 'CONNECTION_UPDATE', 'MESSAGES_UPSERT', 'MESSAGES_UPDATE'];

export class ErrorEvolution extends Error {
  constructor(mensaje: string, public status: number, public detalle?: unknown) {
    super(mensaje);
    this.name = 'ErrorEvolution';
  }
}

function base(): string {
  return (process.env.EVOLUTION_URL || '').replace(/\/+$/, '');
}

/** Si este servidor tiene WhatsApp: sin Evolution configurado, la sección lo explica en vez de fallar. */
export function evolutionDisponible(): boolean {
  return !!(base() && process.env.EVOLUTION_API_KEY);
}

/** Adónde manda Evolution los avisos. Por la red interna de Docker, no por internet. */
export function urlWebhook(): string {
  return process.env.WHATSAPP_WEBHOOK_URL || 'http://app:3000/api/whatsapp/webhook';
}

/** El mensaje legible de un error de Evolution: { response: { message: [...] } } */
function mensajeDe(cuerpo: unknown, status: number): string {
  const r = (cuerpo as { response?: { message?: unknown } } | null)?.response?.message;
  const m = Array.isArray(r) ? r.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(' ') : typeof r === 'string' ? r : '';
  return m || `Evolution respondió ${status}`;
}

async function llamar<T = unknown>(metodo: 'GET' | 'POST' | 'DELETE', ruta: string, cuerpo?: unknown, espera = 15_000): Promise<T> {
  if (!evolutionDisponible()) throw new ErrorEvolution('WhatsApp no está configurado en este servidor', 0);
  let r: Response;
  try {
    r = await fetch(`${base()}${ruta}`, {
      method: metodo,
      headers: { apikey: process.env.EVOLUTION_API_KEY!, ...(cuerpo ? { 'Content-Type': 'application/json' } : {}) },
      body: cuerpo ? JSON.stringify(cuerpo) : undefined,
      signal: AbortSignal.timeout(espera),
      cache: 'no-store',
    });
  } catch {
    throw new ErrorEvolution('No se pudo conectar con el servicio de WhatsApp', 0);
  }
  const texto = await r.text();
  let datos: unknown = null;
  try { datos = texto ? JSON.parse(texto) : null; } catch { datos = texto; }
  if (!r.ok) throw new ErrorEvolution(mensajeDe(datos, r.status), r.status, datos);
  return datos as T;
}

function configWebhook(url: string, token: string) {
  return { url, byEvents: false, base64: true, headers: { 'x-comanda-token': token }, events: EVENTOS };
}

type RespuestaQr = { base64?: string | null; code?: string | null };

/**
 * Crea la instancia (o la reusa si ya existe) con su webhook, y devuelve el
 * primer QR. Si ya estaba conectada, no hay QR.
 */
export async function prepararInstancia(instancia: string, token: string): Promise<{ qr: string | null }> {
  try {
    const r = await llamar<{ qrcode?: RespuestaQr }>('POST', '/instance/create', {
      instanceName: instancia,
      integration: 'WHATSAPP-BAILEYS',
      qrcode: true,
      webhook: configWebhook(urlWebhook(), token),
    }, 30_000);
    return { qr: r.qrcode?.base64 || null };
  } catch (e) {
    // Ya existe (por ejemplo, se desconectó y se vuelve a conectar): se le
    // actualiza el webhook con la clave nueva y se pide el QR
    if (!(e instanceof ErrorEvolution) || e.status !== 403) throw e;
    await llamar('POST', `/webhook/set/${encodeURIComponent(instancia)}`, { webhook: { enabled: true, ...configWebhook(urlWebhook(), token) } });
    return { qr: await pedirQr(instancia) };
  }
}

/** Un QR nuevo (o null si ya está conectada). */
export async function pedirQr(instancia: string): Promise<string | null> {
  const r = await llamar<RespuestaQr>('GET', `/instance/connect/${encodeURIComponent(instancia)}`, undefined, 30_000);
  return r?.base64 || null;
}

export type EstadoInstancia = 'open' | 'connecting' | 'close' | 'no_existe';

export async function estadoInstancia(instancia: string): Promise<EstadoInstancia> {
  try {
    const r = await llamar<{ instance?: { state?: string } }>('GET', `/instance/connectionState/${encodeURIComponent(instancia)}`);
    const s = r.instance?.state;
    return s === 'open' || s === 'connecting' ? s : 'close';
  } catch (e) {
    if (e instanceof ErrorEvolution && e.status === 404) return 'no_existe';
    throw e;
  }
}

/** El número y el nombre del WhatsApp conectado. */
export async function datosInstancia(instancia: string): Promise<{ phone: string; profileName: string }> {
  const r = await llamar<{ ownerJid?: string | null; profileName?: string | null }[]>(
    'GET', `/instance/fetchInstances?instanceName=${encodeURIComponent(instancia)}`,
  );
  const i = Array.isArray(r) ? r[0] : null;
  return { phone: (i?.ownerJid ?? '').split('@')[0].split(':')[0].replace(/\D/g, ''), profileName: i?.profileName ?? '' };
}

/** Desvincula el número y borra la instancia. No falla si ya no estaba. */
export async function cerrarInstancia(instancia: string): Promise<void> {
  const nombre = encodeURIComponent(instancia);
  await llamar('DELETE', `/instance/logout/${nombre}`).catch(() => {});
  await llamar('DELETE', `/instance/delete/${nombre}`).catch((e) => {
    if (!(e instanceof ErrorEvolution) || e.status !== 404) throw e;
  });
}

// ─────────── Mensajes ───────────

type RespuestaEnvio = { key?: { id?: string } };

/** El id del mensaje en WhatsApp, o un error si Evolution no lo mandó. */
function idDe(r: RespuestaEnvio): string {
  const id = r?.key?.id;
  if (!id) throw new ErrorEvolution('WhatsApp no confirmó el envío', 0, r);
  return id;
}

/** `destino`: el teléfono (solo dígitos) o el identificador completo si WhatsApp lo oculta (@lid). */
export async function enviarTexto(instancia: string, destino: string, texto: string): Promise<string> {
  return idDe(await llamar<RespuestaEnvio>('POST', `/message/sendText/${encodeURIComponent(instancia)}`, { number: destino, text: texto }, 30_000));
}

export type TipoArchivo = 'image' | 'video' | 'document' | 'audio';

export function tipoDeArchivo(mime: string): TipoArchivo {
  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('video/')) return 'video';
  if (mime.startsWith('audio/')) return 'audio';
  return 'document';
}

export async function enviarArchivo(
  instancia: string, destino: string,
  a: { mime: string; base64: string; nombre: string; caption?: string },
): Promise<string> {
  return idDe(await llamar<RespuestaEnvio>('POST', `/message/sendMedia/${encodeURIComponent(instancia)}`, {
    number: destino,
    mediatype: tipoDeArchivo(a.mime),
    mimetype: a.mime,
    media: a.base64,
    fileName: a.nombre,
    ...(a.caption ? { caption: a.caption } : {}),
  }, 60_000));
}

/** Nota de voz: Evolution la convierte al formato de WhatsApp (sale como audio grabado, no como archivo). */
export async function enviarNotaDeVoz(instancia: string, destino: string, base64: string): Promise<string> {
  return idDe(await llamar<RespuestaEnvio>('POST', `/message/sendWhatsAppAudio/${encodeURIComponent(instancia)}`, {
    number: destino, audio: base64,
  }, 60_000));
}
