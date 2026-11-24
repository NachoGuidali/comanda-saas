import { NextResponse } from 'next/server';
import type { Prisma } from '@prisma/client';
import { db } from '@/lib/db';
import { getApiSession, puede, tieneFuncion } from '@/lib/session';
import { pedidosDelTelefono } from '@/lib/whatsapp/mensajes';

export const dynamic = 'force-dynamic';

const POR_PAGINA = 60;

/**
 * La bandeja consulta acá cada pocos segundos: la lista de chats y, del chat
 * abierto, lo que cambió desde la última vez (mensajes nuevos y estados:
 * entregado, leído). Liviano a propósito: devuelve solo lo nuevo.
 *
 *   ?chat=<id>            el chat abierto
 *   ?desde=<fecha ISO>    solo lo que cambió después
 *   ?antes=<fecha ISO>    mensajes más viejos (al subir en la conversación)
 *   ?q=<texto>            buscar por nombre o teléfono
 *   ?filtro=sin_leer|atencion|archivados
 */
export async function GET(req: Request) {
  const s = await getApiSession();
  if (!s) return NextResponse.json({ error: 'Sin sesión' }, { status: 401 });
  if (!puede(s, 'whatsapp.ver') || !tieneFuncion(s, 'whatsapp')) return NextResponse.json({ error: 'Sin permiso' }, { status: 403 });

  const url = new URL(req.url);
  const chatId = url.searchParams.get('chat');
  const fecha = (k: string) => {
    const v = url.searchParams.get(k);
    const d = v ? new Date(v) : null;
    return d && !Number.isNaN(d.getTime()) ? d : null;
  };
  const desde = fecha('desde');
  const antes = fecha('antes');
  const q = (url.searchParams.get('q') ?? '').trim().slice(0, 40);
  const filtro = url.searchParams.get('filtro');
  // Un poco para atrás: lo que se escribe mientras corre esta consulta no se pierde
  const hasta = new Date(Date.now() - 2000);

  const linea = await db.whatsAppLine.findUnique({
    where: { branchId: s.branchId },
    select: { status: true, phone: true, profileName: true, lastError: true, tenantId: true },
  });
  if (!linea || linea.tenantId !== s.tenantId) {
    return NextResponse.json({ linea: null, chats: [], noLeidos: 0, hasta: hasta.toISOString() }, { headers: { 'Cache-Control': 'no-store' } });
  }

  const digitos = q.replace(/\D/g, '');
  const where: Prisma.WhatsAppChatWhereInput = {
    branchId: s.branchId,
    archived: filtro === 'archivados',
    ...(filtro === 'sin_leer' ? { unread: { gt: 0 } } : {}),
    ...(filtro === 'atencion' ? { pideAtencion: true } : {}),
    ...(q ? { OR: [{ name: { contains: q, mode: 'insensitive' } }, ...(digitos.length >= 3 ? [{ phone: { contains: digitos } }] : [])] } : {}),
  };

  const [chats, noLeidos] = await Promise.all([
    db.whatsAppChat.findMany({ where, orderBy: { lastMessageAt: 'desc' }, take: 100 }),
    db.whatsAppChat.count({ where: { branchId: s.branchId, unread: { gt: 0 }, archived: false } }),
  ]);

  let mensajes: unknown[] | undefined;
  let masViejos = false;
  let cliente: unknown;
  let abierto: unknown = null;
  if (chatId) {
    const chat = await db.whatsAppChat.findFirst({ where: { id: chatId, branchId: s.branchId } });
    if (chat) {
      // El chat abierto va aparte: puede no estar en la lista (filtrada o archivado)
      abierto = datosDelChat(chat);
      const filas = await db.whatsAppMessage.findMany({
        where: {
          chatId,
          ...(desde ? { updatedAt: { gt: desde } } : {}),
          ...(antes ? { createdAt: { lt: antes } } : {}),
        },
        // Sin "desde": las últimas de la conversación (de la más nueva para atrás)
        orderBy: { createdAt: desde ? 'asc' : 'desc' },
        take: desde ? 200 : POR_PAGINA,
      });
      if (!desde) {
        masViejos = filas.length === POR_PAGINA;
        filas.reverse();
      }
      const codigos = await pedidosConCodigo(filas.map((m) => m.orderId).filter((x): x is string => !!x));
      mensajes = filas.map((m) => ({
        id: m.id, fromMe: m.fromMe, author: m.author, userName: m.userName, type: m.type, text: m.text,
        archivo: !!m.mediaPath, mediaName: m.mediaName, mediaMime: m.mediaMime, voz: m.voz,
        status: m.status, error: m.error, createdAt: m.createdAt.toISOString(),
        pedido: m.orderId ? codigos.get(m.orderId) ?? null : null,
      }));
      // Al abrir el chat: los pedidos de ese cliente en este local
      if (!desde && !antes && chat.phone) {
        const pedidos = await pedidosDelTelefono(s.branchId, chat.phone, 8);
        cliente = {
          pedidos: pedidos.map((p) => ({
            id: p.id, code: p.code, status: p.status, type: p.type, total: p.total, createdAt: p.createdAt.toISOString(),
            resumen: p.items.map((i) => `${i.quantity} ${i.name}${i.variantName ? ` ${i.variantName}` : ''}`).join(', ').slice(0, 120),
          })),
        };
      }
    }
  }

  return NextResponse.json({
    linea: { status: linea.status, phone: linea.phone, profileName: linea.profileName, lastError: linea.lastError },
    chats: chats.map(datosDelChat),
    chat: abierto,
    noLeidos,
    mensajes,
    masViejos,
    cliente,
    hasta: hasta.toISOString(),
  }, { headers: { 'Cache-Control': 'no-store' } });
}

function datosDelChat(c: { id: string; name: string; phone: string; lastMessageAt: Date; lastPreview: string; unread: number; pideAtencion: boolean; archived: boolean; botPausedUntil: Date | null }) {
  return {
    id: c.id, name: c.name, phone: c.phone, lastMessageAt: c.lastMessageAt.toISOString(), lastPreview: c.lastPreview,
    unread: c.unread, pideAtencion: c.pideAtencion, archived: c.archived,
    botPausado: !!c.botPausedUntil && c.botPausedUntil.getTime() > Date.now(),
  };
}

async function pedidosConCodigo(ids: string[]): Promise<Map<string, string>> {
  if (ids.length === 0) return new Map();
  const filas = await db.order.findMany({ where: { id: { in: [...new Set(ids)] } }, select: { id: true, code: true } });
  return new Map(filas.map((o) => [o.id, o.code]));
}
