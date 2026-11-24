import { db } from '../db';
import { estaAbierto } from '../sucursales';
import { urlDelCliente } from '../tenant';
import { leerConfigWhatsApp, rellenar } from './config';
import { encolar, pedidosDelTelefono, procesarCola, valoresDelLocal } from './mensajes';

/**
 * El bot de reglas: saluda con la carta, avisa si está cerrado, contesta
 * "¿dónde está mi pedido?" con el estado real y llama a una persona cuando el
 * cliente la pide. Sin inteligencia artificial: dice solo lo que el local
 * escribió.
 *
 * Se calla solo: en cuanto alguien del local contesta en un chat (desde el
 * sistema o desde el celular), el bot no vuelve a hablar ahí por unas horas.
 */

const PIDE_PERSONA = /\b(persona|humano|alguien|operador|operadora|encargad[oa]|atenci[oó]n al cliente|hablar con)\b/i;
const PREGUNTA_ESTADO = /(d[oó]nde|c[oó]mo|cu[aá]nto)\b.{0,25}\b(pedido|viene|falta|tarda|demora)|estado de(l)? (mi )?pedido|(mi|el) pedido (ya|est[aá]|sali[oó]|viene)|ya sali[oó]|cu[aá]nto falta|cu[aá]nto tarda/i;

/** Un cliente que escribe mucho no recibe una catarata de respuestas automáticas. */
const MAX_RESPUESTAS = 3;
const VENTANA_MS = 30 * 60_000;
/** Un saludo por cliente cada tantas horas */
const SALUDO_CADA_MS = 12 * 3_600_000;

const ABIERTOS = ['PENDIENTE', 'ACEPTADO', 'EN_PREPARACION', 'LISTO', 'EN_CAMINO'];

function textoDelEstado(o: { status: string; type: string; esperandoPago: boolean }): string {
  if (o.esperandoPago) return 'Tu pedido {codigo} está esperando que se acredite el pago.';
  switch (o.status) {
    case 'PENDIENTE': return 'Tu pedido {codigo} está esperando que el local lo confirme. En un ratito te avisamos.';
    case 'ACEPTADO':
    case 'EN_PREPARACION': return 'Tu pedido {codigo} se está preparando 👨‍🍳';
    case 'LISTO': return o.type === 'DELIVERY' ? 'Tu pedido {codigo} ya está listo y sale en un ratito.' : 'Tu pedido {codigo} ya está listo para retirar ✅';
    case 'EN_CAMINO': return 'Tu pedido {codigo} ya está en camino 🛵';
    default: return '';
  }
}

export async function responderBot(lineId: string, chatId: string, texto: string): Promise<void> {
  const line = await db.whatsAppLine.findUnique({
    where: { id: lineId },
    include: { branch: { select: { id: true, name: true, slug: true, aliasBancario: true, tiempoDelivery: true, aceptaPedidos: true, tenant: { select: { slug: true, customDomain: true } } } } },
  });
  if (!line) return;
  const config = leerConfigWhatsApp(line.config);
  if (!config.bot.activo) return;

  const chat = await db.whatsAppChat.findUnique({ where: { id: chatId } });
  if (!chat) return;
  const ahora = Date.now();
  if (chat.botPausedUntil && chat.botPausedUntil.getTime() > ahora) return;

  const recientes = await db.whatsAppMessage.count({ where: { chatId, author: 'bot', createdAt: { gt: new Date(ahora - VENTANA_MS) } } });
  if (recientes >= MAX_RESPUESTAS) return;

  const valores = valoresDelLocal(line.branch.tenant, line.branch);
  const pausa = new Date(ahora + config.bot.pausaHoras * 3_600_000);
  const responder = async (t: string) => {
    await encolar({ chat, author: 'bot', text: rellenar(t, valores) });
    void procesarCola();
  };

  // Pide hablar con alguien: se avisa en la bandeja y el bot se corre
  if (PIDE_PERSONA.test(texto)) {
    await db.whatsAppChat.update({ where: { id: chatId }, data: { pideAtencion: true, botPausedUntil: pausa } });
    await responder('Listo, ya le avisamos a alguien de {local} para que te responda por acá 🙌');
    return;
  }

  // "¿Dónde está mi pedido?" con un pedido abierto de este teléfono
  if (config.bot.estado && PREGUNTA_ESTADO.test(texto) && chat.phone) {
    const [ultimo] = await pedidosDelTelefono(line.branchId, chat.phone, 1);
    if (ultimo && ABIERTOS.includes(ultimo.status) && ultimo.createdAt.getTime() > ahora - SALUDO_CADA_MS) {
      const estado = textoDelEstado(ultimo);
      if (estado) {
        const link = urlDelCliente(line.branch.tenant, `/pedido/${ultimo.code}`);
        await responder(`${estado.replace('{codigo}', ultimo.code)}\nLo seguís acá: ${link}`);
        return;
      }
    }
  }

  // El saludo: una vez cada tantas horas, y no si el local ya estaba hablando con él
  const yaSaludo = chat.greetedAt && chat.greetedAt.getTime() > ahora - SALUDO_CADA_MS;
  const hablo = await db.whatsAppMessage.count({
    where: { chatId, fromMe: true, author: { not: 'bot' }, createdAt: { gt: new Date(ahora - SALUDO_CADA_MS) } },
  });
  if (yaSaludo || hablo > 0) return;

  const abierto = line.branch.aceptaPedidos && (await estaAbierto(line.branchId));
  await db.whatsAppChat.update({ where: { id: chatId }, data: { greetedAt: new Date(ahora) } });
  await responder(abierto ? config.bot.saludo : config.bot.cerrado);
}
