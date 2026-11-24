// Pruebas de las partes de WhatsApp que no necesitan base ni servidor:
// teléfonos, lectura de mensajes y textos. Desde la carpeta del proyecto:
//   npx tsx pruebas/whatsapp-unidad.ts
import { normalizarTelefono, claveTelefono, telefonoDeJid, esChatDePersona, mostrarTelefono } from '../src/lib/whatsapp/telefono';
import { leerConfigWhatsApp, rellenar, CONFIG_WHATSAPP_DEFECTO } from '../src/lib/whatsapp/config';
import { leerContenido, vistaPrevia, sinNombre } from '../src/lib/whatsapp/mensajes';

let fallas = 0;
const ok = (c: boolean, msg: string, extra?: unknown) => {
  if (c) console.log('  ✓', msg);
  else { fallas++; console.log('  ✗', msg, extra === undefined ? '' : JSON.stringify(extra)); }
};
const igual = (a: unknown, b: unknown, msg: string) => ok(JSON.stringify(a) === JSON.stringify(b), msg, { obtenido: a, esperado: b });

console.log('\n1. Teléfonos argentinos');
igual(normalizarTelefono('11 2345 6789'), '5491123456789', 'AMBA sin 0 ni 15');
igual(normalizarTelefono('011 15 2345-6789'), '5491123456789', 'Con 0 y 15');
igual(normalizarTelefono('(0221) 15-456-7890'), '5492214567890', 'La Plata con 0 y 15');
igual(normalizarTelefono('+54 9 11 2345 6789'), '5491123456789', 'Internacional con 9');
igual(normalizarTelefono('54 11 2345 6789'), '5491123456789', 'Internacional sin el 9: se agrega');
igual(normalizarTelefono('0351 15 512 3456'), '5493515123456', 'Córdoba con 0 y 15');
igual(normalizarTelefono('598 99 123 456'), '59899123456', 'Otro país: tal cual');
igual(normalizarTelefono('1234'), null, 'Muy corto: no es un teléfono');
igual(normalizarTelefono('-'), null, 'Pedido de mostrador sin teléfono');
igual(claveTelefono('011 15 2345-6789'), claveTelefono('5491123456789'), 'La clave de búsqueda es la misma con y sin 15');
igual(telefonoDeJid('5491123456789@s.whatsapp.net'), '5491123456789', 'Teléfono de un identificador normal');
igual(telefonoDeJid('5491123456789:12@s.whatsapp.net'), '5491123456789', 'Con número de dispositivo');
igual(telefonoDeJid('123456789@lid'), '', 'Identificador oculto: sin teléfono');
ok(esChatDePersona('549@s.whatsapp.net') && esChatDePersona('99@lid'), 'Personas: número e identificador oculto');
ok(!esChatDePersona('1203@g.us') && !esChatDePersona('status@broadcast') && !esChatDePersona('12@newsletter'), 'Grupos, estados y canales no');
igual(mostrarTelefono('5491123456789'), '+54 9 1123456789', 'Para mostrar');

console.log('\n2. Lectura de mensajes');
igual(leerContenido({ conversation: 'hola' }), { type: 'texto', text: 'hola' }, 'Texto simple');
igual(leerContenido({ extendedTextMessage: { text: 'con link' } }), { type: 'texto', text: 'con link' }, 'Texto extendido');
igual(leerContenido({ ephemeralMessage: { message: { conversation: 'temporal' } } }), { type: 'texto', text: 'temporal' }, 'Mensaje temporal (envuelto)');
igual(leerContenido({ imageMessage: { caption: 'mirá', mimetype: 'image/jpeg' }, base64: 'xx' })?.type, 'imagen', 'Foto con texto');
igual(leerContenido({ viewOnceMessageV2: { message: { imageMessage: { mimetype: 'image/jpeg' } } }, base64: 'xx' })?.type, 'imagen', 'Foto de una sola vista');
igual(leerContenido({ audioMessage: { mimetype: 'audio/ogg; codecs=opus', ptt: true } }), { type: 'audio', text: '', mime: 'audio/ogg; codecs=opus', voz: true }, 'Nota de voz');
igual(leerContenido({ documentMessage: { mimetype: 'application/pdf', fileName: 'menu.pdf' } })?.nombre, 'menu.pdf', 'Documento con su nombre');
igual(leerContenido({ locationMessage: { degreesLatitude: -34.8, degreesLongitude: -58.4, name: 'Casa' } })?.text, '-34.8,-58.4\nCasa', 'Ubicación');
igual(leerContenido({ contactMessage: { displayName: 'Juan', vcard: 'BEGIN:VCARD\nTEL;type=CELL:+54 9 11 1234 5678\nEND:VCARD' } })?.text, 'Juan · +54 9 11 1234 5678', 'Contacto');
igual(leerContenido({ reactionMessage: { text: '👍' } }), null, 'Reacción: no se muestra');
igual(leerContenido({ protocolMessage: { type: 0 } }), null, 'Mensaje borrado: no se muestra');
igual(leerContenido({ pollCreationMessage: {} })?.type, 'otro', 'Encuesta: se avisa que no se puede mostrar');
igual(vistaPrevia({ type: 'imagen', text: 'mirá esto' }), '📷 Foto: mirá esto', 'Vista previa de una foto con texto');
igual(vistaPrevia({ type: 'texto', text: 'uno\n  dos' }), 'uno dos', 'Vista previa en un renglón');

console.log('\n3. Textos');
igual(rellenar('Hola {nombre}, pedido {codigo} en {local}', { nombre: 'Laura', codigo: 'A-1', local: 'Adrogué' }), 'Hola Laura, pedido A-1 en Adrogué', 'Variables');
igual(rellenar('Hola {nombr}', { nombre: 'x' }), 'Hola {nombr}', 'Una variable mal escrita queda a la vista');
igual(sinNombre('¡Hola ! Recibimos tu pedido'), '¡Hola! Recibimos tu pedido', 'Sin nombre: "¡Hola !" → "¡Hola!"');
igual(sinNombre(', tu pedido A-1 ya salió'), 'Tu pedido A-1 ya salió', 'Sin nombre: la coma suelta se va');
const c = leerConfigWhatsApp('{"bot":{"activo":true,"pausaHoras":500},"avisos":{"aceptado":{"activo":false,"texto":""}},"respuestas":[{"titulo":"","texto":"x"},{"titulo":"Ok","texto":"y"}]}');
ok(c.bot.activo && c.bot.pausaHoras === 48, 'La pausa del bot se limita a 48 horas', c.bot);
ok(!c.avisos.aceptado.activo && c.avisos.aceptado.texto === CONFIG_WHATSAPP_DEFECTO.avisos.aceptado.texto, 'Un texto vacío vuelve al de siempre', c.avisos.aceptado);
igual(c.respuestas, [{ titulo: 'Ok', texto: 'y' }], 'Las respuestas rápidas sin título se descartan');
igual(leerConfigWhatsApp('no es json'), CONFIG_WHATSAPP_DEFECTO, 'Configuración rota: la de siempre');

console.log(fallas ? `\n${fallas} FALLAS` : '\nTODO OK');
process.exit(fallas ? 1 : 0);
