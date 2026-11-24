// Prueba de punta a punta del WhatsApp de los locales: conectar el número,
// mensajes que entran y salen, archivos, avisos del pedido, bot, y que nadie
// vea lo de otro.
//
// Cómo correrla (base limpia con Pepperino y La Esquina, como e2e-saas.mjs):
//   1. node pruebas/evolution-falso.mjs   (Evolution de mentira en el 3998)
//   2. Servidor en 3100 con SAAS_DOMINIO=localhost EVOLUTION_URL=http://localhost:3998
//      EVOLUTION_API_KEY=clave-evo-falsa WHATSAPP_WEBHOOK_URL=http://localhost:3100/api/whatsapp/webhook
//   3. node pruebas/e2e-whatsapp.mjs (desde la carpeta del proyecto)
import { readFileSync } from 'fs';
import { execSync } from 'child_process';
import { createRequire } from 'module';

const { encodeReply } = createRequire(process.cwd() + '/package.json')('next/dist/compiled/react-server-dom-webpack/client.node');
const PUERTO = 3100;
const H = (sub) => `http://${sub ? sub + '.' : ''}localhost:${PUERTO}`;
const PEP = H('pepperino');
const ESQ = H('laesquina');
const EVO = 'http://localhost:3998';
const manifest = JSON.parse(readFileSync(process.cwd() + '/.next/server/server-reference-manifest.json', 'utf8')).node;
const ids = {};
for (const [id, v] of Object.entries(manifest)) ids[v.exportedName] = id;

let fallas = 0;
let ipN = 1;
const ok = (c, msg, extra) => {
  if (c) console.log('  ✓', msg);
  else { fallas++; console.log('  ✗', msg, extra !== undefined ? JSON.stringify(extra).slice(0, 400) : ''); }
};
const sql = (q) => execSync(`docker exec pz-test-db psql -U pizzeria -qtAc ${JSON.stringify(q)}`).toString().trim();
const esperar = (ms) => new Promise((r) => setTimeout(r, ms));
/** Espera a que algo se cumpla (la cola manda en segundo plano). */
async function hasta(fn, ms = 6000) {
  const fin = Date.now() + ms;
  while (Date.now() < fin) { const v = await fn(); if (v) return v; await esperar(150); }
  return fn();
}

function parseRsc(text) {
  const uno = text.split('\n').find((l) => l.startsWith('1:'));
  if (uno) { try { return JSON.parse(uno.slice(2)); } catch { /* sigue */ } }
  return { raw: text.slice(0, 300) };
}
async function accion(base, nombre, args, cookie = '') {
  if (!ids[nombre]) throw new Error(`No existe la acción ${nombre}`);
  const headers = { 'Next-Action': ids[nombre], Accept: 'text/x-component', 'x-forwarded-for': `10.7.0.${ipN++}` };
  if (cookie) headers.Cookie = cookie;
  const body = await encodeReply(args instanceof FormData ? [args] : args);
  if (typeof body === 'string') headers['Content-Type'] = 'text/plain;charset=UTF-8';
  const r = await fetch(`${base}/login`, { method: 'POST', headers, body, redirect: 'manual' });
  return { res: parseRsc(await r.text()), setCookie: r.headers.getSetCookie?.() ?? [] };
}
async function login(base, email, password) {
  const fd = new FormData(); fd.set('email', email); fd.set('password', password);
  const { res, setCookie } = await accion(base, 'login', fd);
  return { res, cookie: setCookie.map((c) => c.split(';')[0]).join('; ') };
}
const evo = async (ruta, body = {}) => (await fetch(`${EVO}/__test/${ruta}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })).json();
const enviados = async () => (await fetch(`${EVO}/__test/enviados`, { method: 'POST' })).json();
const bandeja = async (cookie, params = '', base = PEP) => {
  const r = await fetch(`${base}/api/whatsapp/bandeja${params ? `?${params}` : ''}`, { headers: { Cookie: cookie } });
  return { status: r.status, d: r.status === 200 ? await r.json() : null };
};
const webhook = (cuerpo, token) => fetch(`${H('')}/api/whatsapp/webhook`, {
  method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { 'x-comanda-token': token } : {}) }, body: JSON.stringify(cuerpo),
});

const pepperino = sql("select id from \"Tenant\" where slug='pepperino'");
const adrogue = sql(`select id from "Branch" where slug='adrogue' and "tenantId"='${pepperino}'`);
const INST = `cs-${adrogue}`;
const CLIENTE = '5491122334455';
const JID = `${CLIENTE}@s.whatsapp.net`;

const cPep = (await login(PEP, 'super@pepperino.com', 'super1234')).cookie;
const cCaja = (await login(PEP, 'caja@pepperino.com', 'caja1234')).cookie;
const cCocina = (await login(PEP, 'cocina@pepperino.com', 'cocina1234')).cookie;
const cEsq = (await login(ESQ, 'super@pepperino.com', 'otraclave123')).cookie;
await fetch(`${EVO}/__test/limpiar`, { method: 'POST' });

console.log('\n1. Menú y permisos');
{
  const panel = await (await fetch(`${PEP}/admin`, { headers: { Cookie: cCaja } })).text();
  ok(panel.includes('/admin/whatsapp'), 'La caja ve WhatsApp en el menú');
  const cocina = await (await fetch(`${PEP}/admin`, { headers: { Cookie: cCocina } })).text();
  ok(!cocina.includes('/admin/whatsapp'), 'La cocina no');
  ok((await bandeja(cCocina)).status === 403, 'La cocina no puede leer la bandeja');
  const r = await fetch(`${PEP}/admin/whatsapp`, { headers: { Cookie: cCaja } });
  ok(r.status === 200 && (await r.text()).includes('todavía no conectó'), 'La bandeja antes de conectar explica que falta conectarlo');
}

console.log('\n2. Conectar el número');
let token = '';
{
  ok((await accion(PEP, 'conectarWhatsApp', [], cCaja)).res?.ok !== true, 'La caja (sin permiso de configuración) no puede conectar');
  const r = await accion(PEP, 'conectarWhatsApp', [], cPep);
  ok(r.res.ok === true && r.res.status === 'esperando_qr' && r.res.qr?.startsWith('data:image/png;base64,'), 'El dueño conecta y recibe el QR', r.res);
  const inst = await (await fetch(`${EVO}/__test/instancias`, { method: 'POST' })).json();
  const w = inst[INST]?.webhook;
  token = w?.headers?.['x-comanda-token'] ?? '';
  ok(w?.url === 'http://localhost:3100/api/whatsapp/webhook' && token.length >= 30 && w?.base64 === true, 'La instancia queda con su webhook, su clave y los archivos adentro del aviso', w);
  ok(sql(`select "tokenHash" <> '${token}' and length("tokenHash") = 64 from "WhatsAppLine" where "branchId"='${adrogue}'`) === 't', 'La clave se guarda solo como hash');

  const qr = await evo('qr', { instance: INST });
  ok(qr.status === 200, 'Evolution avisa un QR nuevo');
  const e = await accion(PEP, 'estadoWhatsApp', [], cPep);
  ok(e.res.status === 'esperando_qr' && e.res.qr && e.res.qr !== r.res.qr, 'La pantalla muestra el QR nuevo', e.res);

  // Volver a conectar mientras espera: reusa la instancia y rota la clave
  const otra = await accion(PEP, 'conectarWhatsApp', [], cPep);
  const inst2 = await (await fetch(`${EVO}/__test/instancias`, { method: 'POST' })).json();
  const token2 = inst2[INST]?.webhook?.headers?.['x-comanda-token'];
  ok(otra.res.ok === true && token2 && token2 !== token, 'Reconectar reusa la instancia con una clave nueva');
  ok((await webhook({ event: 'qrcode.updated', instance: INST, data: { qrcode: { base64: 'data:x' } } }, token)).status === 401, 'La clave vieja deja de valer');
  token = token2;

  const c = await evo('conectar', { instance: INST, numero: '5491150000000', nombre: 'Pepperino Adrogué' });
  ok(c.status === 200, 'Se escanea el QR');
  const e2 = await accion(PEP, 'estadoWhatsApp', [], cPep);
  ok(e2.res.status === 'conectado' && e2.res.phone === '5491150000000' && e2.res.qr === null, 'Queda conectado, con el número', e2.res);
}

console.log('\n3. El webhook no acepta cualquier cosa');
{
  ok((await webhook({ event: 'messages.upsert', instance: INST, data: {} })).status === 401, 'Sin clave: rechazado');
  ok((await webhook({ event: 'messages.upsert', instance: INST, data: {} }, 'inventada')).status === 401, 'Con una clave inventada: rechazado');
  ok((await webhook({ event: 'messages.upsert', instance: 'cs-otra', data: {} }, token)).status === 401, 'Con la clave de otra instancia: rechazado');
  ok((await fetch(`${H('')}/api/whatsapp/webhook`, { method: 'POST', body: 'no es json' })).status === 400, 'Basura: 400');
}

console.log('\n4. Mensajes que llegan');
let chatId = '';
{
  await evo('entrante', { instance: INST, jid: JID, id: 'IN1', nombre: 'Laura Gómez', texto: 'Hola, ¿tienen fugazzeta?' });
  const b = await bandeja(cCaja);
  const chat = b.d?.chats?.find((c) => c.phone === CLIENTE);
  chatId = chat?.id;
  ok(chat && chat.name === 'Laura Gómez' && chat.unread === 1 && chat.lastPreview.includes('fugazzeta'), 'Aparece el chat con el nombre, la vista previa y 1 sin leer', b.d?.chats);
  ok(b.d.noLeidos === 1, 'Un chat sin leer');
  const cont = await (await fetch(`${PEP}/api/pedidos/contador`, { headers: { Cookie: cCaja } })).json();
  ok(cont.whatsapp === 1, 'El menú cuenta 1 chat sin leer', cont);

  await evo('entrante', { instance: INST, jid: JID, id: 'IN1', nombre: 'Laura Gómez', texto: 'Hola, ¿tienen fugazzeta?' });
  await evo('entrante', { instance: INST, jid: '120363@g.us', id: 'G1', texto: 'mensaje de grupo' });
  await evo('entrante', { instance: INST, jid: 'status@broadcast', id: 'S1', texto: 'estado' });
  await evo('entrante', { instance: INST, jid: JID, id: 'R1', tipo: 'reaccion' });
  ok(sql(`select count(*) from "WhatsAppMessage" m join "WhatsAppChat" c on c.id = m."chatId" where c."branchId"='${adrogue}'`) === '1', 'Sin duplicados, sin grupos, sin estados y sin reacciones');
  ok(sql(`select count(*) from "WhatsAppChat" where "branchId"='${adrogue}'`) === '1', 'Un solo chat');

  await evo('entrante', { instance: INST, jid: '99887766@lid', id: 'L1', nombre: 'Oculto', texto: 'hola', alt: '5491133334444@s.whatsapp.net' });
  ok(sql(`select phone from "WhatsAppChat" where jid='99887766@lid'`) === '5491133334444', 'Contacto con identificador oculto: se toma el teléfono alternativo');
  await evo('entrante', { instance: INST, jid: JID, id: 'T1', tipo: 'temporal', texto: 'mensaje temporal' });
  ok(sql(`select text from "WhatsAppMessage" where "waId"='T1'`) === 'mensaje temporal', 'Mensaje temporal: se lee el texto');

  const abierto = await bandeja(cCaja, `chat=${chatId}`);
  ok(abierto.d.mensajes?.length === 2 && abierto.d.chat?.id === chatId, 'Al abrirlo trae la conversación', abierto.d.mensajes?.length);
  // La pantalla lo marca leído al abrirlo
  ok((await accion(PEP, 'marcarLeido', [chatId], cCaja)).res.ok === true && sql(`select unread from "WhatsAppChat" where id='${chatId}'`) === '0', 'Al abrirlo queda leído');
}

console.log('\n5. Fotos y archivos que llegan');
{
  const foto = Buffer.from('FOTO-JPEG-DE-PRUEBA').toString('base64');
  await evo('entrante', { instance: INST, jid: JID, id: 'IMG1', tipo: 'imagen', texto: 'el comprobante', base64: foto });
  const id = sql(`select id from "WhatsAppMessage" where "waId"='IMG1'`);
  const r = await fetch(`${PEP}/api/whatsapp/media/${id}`, { headers: { Cookie: cCaja } });
  ok(r.status === 200 && r.headers.get('content-type') === 'image/jpeg' && (await r.text()) === 'FOTO-JPEG-DE-PRUEBA', 'La foto se guarda y se ve en el panel');
  ok((await fetch(`${PEP}/api/whatsapp/media/${id}`)).status === 401, 'Sin sesión no se ve');
  ok((await fetch(`${ESQ}/api/whatsapp/media/${id}`, { headers: { Cookie: cEsq } })).status === 404, 'Otro cliente no la ve');
  ok((await fetch(`${PEP}/api/media/${sql(`select "mediaPath" from "WhatsAppMessage" where id='${id}'`).split('/').pop()}`)).status === 404, 'No se puede ver por la carpeta pública de fotos');

  await evo('entrante', { instance: INST, jid: JID, id: 'IMG2', tipo: 'imagen', mimetype: 'text/html', base64: Buffer.from('<script>alert(1)</script>').toString('base64') });
  const id2 = sql(`select id from "WhatsAppMessage" where "waId"='IMG2'`);
  const r2 = await fetch(`${PEP}/api/whatsapp/media/${id2}`, { headers: { Cookie: cCaja } });
  ok(r2.headers.get('content-type') === 'application/octet-stream' && r2.headers.get('content-disposition')?.startsWith('attachment'), 'Un HTML disfrazado de foto se descarga, no se abre');

  await evo('entrante', { instance: INST, jid: JID, id: 'AUD1', tipo: 'audio', base64: Buffer.from('OGG').toString('base64') });
  ok(sql(`select type || '/' || voz from "WhatsAppMessage" where "waId"='AUD1'`) === 'audio/true', 'Nota de voz');
}

console.log('\n6. Contestar desde el sistema');
{
  await evo('eco', { activo: true });
  const r = await accion(PEP, 'enviarTextoChat', [chatId, 'Sí, ¡la tenemos!'], cCaja);
  ok(r.res.ok === true, 'La caja contesta', r.res);
  const env = await enviados();
  const ultimo = env.at(-1);
  ok(ultimo?.tipo === 'sendText' && ultimo.number === CLIENTE && ultimo.text === 'Sí, ¡la tenemos!', 'Sale por WhatsApp al número del cliente', ultimo);
  await esperar(300);
  ok(sql(`select count(*) || '/' || max(status) || '/' || max(author) || '/' || max("userName") from "WhatsAppMessage" where text='Sí, ¡la tenemos!'`) === '1/enviado/panel/Caja Adrogué', 'Queda una sola vez (aunque WhatsApp lo devuelva), enviado, con quién lo escribió');
  ok(sql(`select "botPausedUntil" > now() from "WhatsAppChat" where id='${chatId}'`) === 't', 'El bot se calla en ese chat');

  const waId = sql(`select "waId" from "WhatsAppMessage" where text='Sí, ¡la tenemos!'`);
  await evo('estado', { instance: INST, keyId: waId, status: 'READ' });
  await evo('estado', { instance: INST, keyId: waId, status: 'DELIVERY_ACK' });
  ok(sql(`select status from "WhatsAppMessage" where "waId"='${waId}'`) === 'leido', 'Queda "leído" (un "entregado" que llega tarde no lo pisa)');

  await evo('entrante', { instance: INST, jid: JID, id: 'CEL1', fromMe: true, texto: 'te lo mando desde el celu' });
  ok(sql(`select author || '/' || status from "WhatsAppMessage" where "waId"='CEL1'`) === 'celular/enviado', 'Lo que se contesta desde el celular también aparece');
  await evo('eco', { activo: false });

  ok((await accion(PEP, 'enviarTextoChat', [chatId, '   '], cCaja)).res.ok === false, 'Un mensaje vacío no sale');
  ok((await accion(PEP, 'enviarTextoChat', [chatId, 'hola'], cCocina)).res?.ok !== true, 'La cocina no puede escribir');
}

console.log('\n7. Archivos y notas de voz desde el sistema');
{
  const fd = new FormData();
  fd.set('chatId', chatId);
  fd.set('archivo', new File([Buffer.from('PNG-DATA')], 'carta.png', { type: 'image/png' }));
  fd.set('texto', 'La carta de hoy');
  const r = await accion(PEP, 'enviarArchivoChat', fd, cCaja);
  const ultimo = (await enviados()).at(-1);
  ok(r.res.ok === true && ultimo?.tipo === 'sendMedia' && ultimo.mediatype === 'image' && ultimo.caption === 'La carta de hoy' && ultimo.fileName === 'carta.png', 'Una foto sale con su texto', { r: r.res, ultimo });

  const voz = new FormData();
  voz.set('chatId', chatId);
  voz.set('archivo', new File([Buffer.from('WEBM-OPUS')], 'audio.webm', { type: 'audio/webm' }));
  voz.set('voz', '1');
  const r2 = await accion(PEP, 'enviarArchivoChat', voz, cCaja);
  ok(r2.res.ok === true && (await enviados()).at(-1)?.tipo === 'sendWhatsAppAudio', 'La nota de voz sale como audio grabado', r2.res);
  const id = sql(`select id from "WhatsAppMessage" where voz and "fromMe" order by "createdAt" desc limit 1`);
  ok((await fetch(`${PEP}/api/whatsapp/media/${id}`, { headers: { Cookie: cCaja } })).status === 200, 'Y queda para escucharla en el chat');

  const grande = new FormData();
  grande.set('chatId', chatId);
  grande.set('archivo', new File([Buffer.alloc(7.5 * 1024 * 1024)], 'enorme.pdf', { type: 'application/pdf' }));
  ok((await accion(PEP, 'enviarArchivoChat', grande, cCaja)).res?.ok !== true, 'Un archivo de más de 7 MB no se acepta');
}

console.log('\n8. Errores al mandar');
{
  const nuevo = await accion(PEP, 'abrirChat', ['11 0000 0000'], cCaja);
  ok(nuevo.res.ok === true, 'Se puede abrir un chat con un número (desde un pedido)', nuevo.res);
  const r = await accion(PEP, 'enviarTextoChat', [nuevo.res.chatId, 'hola'], cCaja);
  ok(r.res.ok === false && r.res.error === 'Ese número no tiene WhatsApp', 'Número sin WhatsApp: se explica', r.res);
  ok(sql(`select status from "WhatsAppMessage" where "chatId"='${nuevo.res.chatId}'`) === 'error', 'El mensaje queda con el error, para reintentarlo');
  ok((await accion(PEP, 'abrirChat', ['123'], cCaja)).res.ok === false, 'Un número inválido no abre chat');
  ok(sql(`select phone from "WhatsAppChat" where id='${(await accion(PEP, 'abrirChat', ['11 2233 4455'], cCaja)).res.chatId}'`) === CLIENTE, 'Abrir con el número de un chat existente lleva a ese chat');
}

console.log('\n9. Avisos del pedido');
let pedidoId = '';
{
  await fetch(`${EVO}/__test/limpiar`, { method: 'POST' });
  const humita = sql(`select id from "Product" where "branchId"='${adrogue}' and name='Empanada de humita'`);
  const zona = sql(`select id from "DeliveryZone" where "branchId"='${adrogue}' and active order by fee limit 1`);
  const p = await accion(PEP, 'crearPedido', [[{ productId: humita, variantId: null, quantity: 6, addonIds: [] }], {
    branchId: adrogue, type: 'DELIVERY', customerName: 'Laura Gómez', customerPhone: '011 15 2233-4455',
    address: 'Espora 1500', zoneId: zona, paymentMethod: 'EFECTIVO', source: 'WHATSAPP', desdePanel: true,
  }], cCaja);
  ok(p.res.ok === true, 'La caja carga el pedido que llegó por WhatsApp', p.res);
  pedidoId = sql(`select id from "Order" where code='${p.res.code}'`);
  const aceptado = await hasta(async () => (await enviados()).find((e) => e.text?.includes(p.res.code)));
  ok(aceptado?.number === CLIENTE && aceptado.text.startsWith('¡Hola Laura! Recibimos tu pedido') && aceptado.text.includes(`/pedido/${p.res.code}`), 'Al cliente le llega "Recibimos tu pedido", con el link (el teléfono con 0 y 15 se normaliza)', aceptado);
  ok(sql(`select count(*) from "WhatsAppMessage" where "orderId"='${pedidoId}' and author='aviso' and "chatId"='${chatId}'`) === '1', 'El aviso queda en el mismo chat, marcado como aviso de ese pedido');

  for (const estado of ['EN_PREPARACION', 'LISTO']) await accion(PEP, 'cambiarEstado', [pedidoId, estado], cPep);
  await esperar(500);
  ok((await enviados()).length === 1, 'En preparación y listo (de un envío) no mandan nada');
  await accion(PEP, 'cambiarEstado', [pedidoId, 'EN_CAMINO'], cPep);
  const camino = await hasta(async () => (await enviados()).find((e) => e.text?.includes('va en camino')));
  ok(!!camino, 'Al salir el repartidor: "va en camino"', await enviados());

  // Un pedido sin teléfono (de mostrador) no manda nada
  const antes = (await enviados()).length;
  const muzza = sql(`select id from "Product" where "branchId"='${adrogue}' and name='Fainá'`);
  await accion(PEP, 'crearPedido', [[{ productId: muzza, variantId: null, quantity: 1, addonIds: [] }], { branchId: adrogue, type: 'TAKEAWAY', customerName: '', customerPhone: '', paymentMethod: 'EFECTIVO', desdePanel: true }], cCaja);
  await esperar(500);
  ok((await enviados()).length === antes, 'Un pedido de mostrador sin teléfono no manda nada');
}

console.log('\n10. Configuración: avisos apagados y desconexión');
{
  const rechazo = await accion(PEP, 'guardarConfigWhatsApp', [{ avisos: { aceptado: { activo: false, texto: 'x' } } }], cCaja);
  ok(rechazo.res?.ok !== true, 'La caja no cambia la configuración');
  ok((await accion(PEP, 'guardarConfigWhatsApp', [{ avisos: { aceptado: { activo: false, texto: 'x' } } }], cPep)).res.ok === true, 'El dueño apaga el aviso de "pedido confirmado"');
  const antes = (await enviados()).length;
  const humita = sql(`select id from "Product" where "branchId"='${adrogue}' and name='Empanada de humita'`);
  await accion(PEP, 'crearPedido', [[{ productId: humita, variantId: null, quantity: 1, addonIds: [] }], { branchId: adrogue, type: 'TAKEAWAY', customerName: 'Pedro', customerPhone: '1144445555', paymentMethod: 'EFECTIVO', desdePanel: true }], cCaja);
  await esperar(500);
  ok((await enviados()).length === antes, 'Con el aviso apagado no sale nada');
  await accion(PEP, 'guardarConfigWhatsApp', [{}], cPep);

  // Se corta la conexión: el aviso espera y sale al volver
  await evo('cerrar', { instance: INST, motivo: 428 });
  ok(sql(`select status from "WhatsAppLine" where "branchId"='${adrogue}'`) === 'desconectado', 'Si se corta, queda desconectado');
  const b = await bandeja(cCaja);
  ok(b.d.linea.status === 'desconectado' && b.d.linea.lastError, 'La bandeja avisa que está desconectado', b.d.linea);
  const r = await accion(PEP, 'enviarTextoChat', [chatId, 'hola?'], cCaja);
  ok(r.res.ok === false && r.res.error.includes('desconectado'), 'Contestar desconectado: se explica', r.res);
  const listo = sql(`select id from "Order" where "branchId"='${adrogue}' and type='TAKEAWAY' and "customerName"='Pedro' order by "createdAt" desc limit 1`);
  for (const estado of ['EN_PREPARACION', 'LISTO']) await accion(PEP, 'cambiarEstado', [listo, estado], cPep);
  await esperar(400);
  ok(sql(`select status from "WhatsAppMessage" where "orderId"='${listo}' and text like '%listo para retirar%'`) === 'pendiente', 'El aviso de "listo para retirar" queda esperando');
  await evo('conectar', { instance: INST, numero: '5491150000000' });
  const salio = await hasta(async () => (await enviados()).find((e) => e.text?.includes('listo para retirar')));
  ok(!!salio, 'Al volver la conexión, sale solo');

  await evo('cerrar', { instance: INST, motivo: 401 });
  ok(sql(`select "lastError" from "WhatsAppLine" where "branchId"='${adrogue}'`).includes('desde el celular'), 'Si lo desvinculan desde el celular, se explica eso');
  await evo('conectar', { instance: INST, numero: '5491150000000' });
}

console.log('\n11. Bot');
{
  ok((await accion(PEP, 'guardarConfigWhatsApp', [{ bot: { activo: true } }], cPep)).res.ok === true, 'El dueño prende el bot');
  await fetch(`${EVO}/__test/limpiar`, { method: 'POST' });
  const NUEVO = '5491177778888@s.whatsapp.net';
  await evo('entrante', { instance: INST, jid: NUEVO, id: 'B1', nombre: 'Martín', texto: 'hola!' });
  const saludo = await hasta(async () => (await enviados()).find((e) => e.number === '5491177778888'));
  ok(saludo && saludo.text.includes('/adrogue') && /Pepperino Adrogué/.test(saludo.text), 'Saluda con el nombre del local y el link de la carta (abierto o cerrado)', saludo);
  await evo('entrante', { instance: INST, jid: NUEVO, id: 'B2', texto: 'quiero hacer un pedido' });
  await esperar(500);
  ok((await enviados()).filter((e) => e.number === '5491177778888').length === 1, 'No saluda dos veces (y "hacer un pedido" no es preguntar por uno)');

  await evo('entrante', { instance: INST, jid: NUEVO, id: 'B3', texto: 'me pasás con una persona?' });
  const persona = await hasta(async () => (await enviados()).find((e) => e.text?.includes('ya le avisamos')));
  ok(!!persona, 'Si pide una persona, le avisa que ya lo atienden');
  const chatNuevo = sql(`select id from "WhatsAppChat" where jid='${NUEVO}'`);
  ok(sql(`select "pideAtencion" and "botPausedUntil" > now() from "WhatsAppChat" where id='${chatNuevo}'`) === 't', 'Y en la bandeja queda marcado "pide una persona", con el bot pausado');
  const b = await bandeja(cCaja, 'filtro=atencion');
  ok(b.d.chats.length === 1 && b.d.chats[0].id === chatNuevo, 'El filtro "Piden atención" lo muestra');
  await evo('entrante', { instance: INST, jid: NUEVO, id: 'B4', texto: 'hola?' });
  await esperar(400);
  ok((await enviados()).filter((e) => e.number === '5491177778888').length === 2, 'Pausado, el bot no contesta más');
  ok((await accion(PEP, 'botEnChat', [chatNuevo, true], cCaja)).res.ok === true, 'Se lo puede reactivar desde la bandeja');

  // ¿Dónde está mi pedido? (Laura tiene un pedido en camino)
  await accion(PEP, 'botEnChat', [chatId, true], cCaja);
  await evo('entrante', { instance: INST, jid: JID, id: 'B5', texto: 'dónde está mi pedido?' });
  const codigo = sql(`select code from "Order" where id='${pedidoId}'`);
  const estado = await hasta(async () => (await enviados()).find((e) => e.number === CLIENTE && e.text?.includes(codigo)));
  ok(estado?.text.includes('en camino'), 'Contesta el estado real del pedido', estado);
  ok(sql(`select author from "WhatsAppMessage" where text like '%${codigo} ya está en camino%' order by "createdAt" desc limit 1`) === 'bot', 'Queda marcado como del bot');

  // Cuando contesta alguien del local, el bot se calla
  await accion(PEP, 'enviarTextoChat', [chatId, 'Ya casi llega Laura'], cCaja);
  const antes = (await enviados()).length;
  await evo('entrante', { instance: INST, jid: JID, id: 'B6', texto: 'cuánto falta?' });
  await esperar(500);
  ok((await enviados()).length === antes, 'Con una persona atendiendo, el bot no se mete');
}

console.log('\n12. Cada uno ve lo suyo');
{
  const b = await bandeja(cEsq, '', ESQ);
  ok(b.status === 200 && b.d.linea === null && b.d.chats.length === 0, 'La Esquina no ve los chats de Pepperino', b);
  const b2 = await bandeja(cEsq, `chat=${chatId}`, ESQ);
  ok(!b2.d.mensajes, 'Ni pidiendo el chat por su id');
  ok((await accion(ESQ, 'enviarTextoChat', [chatId, 'hola'], cEsq)).res.ok === false, 'Ni puede escribir en él');
  ok((await accion(ESQ, 'marcarLeido', [chatId], cEsq)).res.ok === true && sql(`select count(*) from "WhatsAppChat" where id='${chatId}' and "branchId"='${adrogue}'`) === '1', 'Ni tocarlo');
  const burzaco = sql(`select id from "Branch" where slug='burzaco' and "tenantId"='${pepperino}'`);
  ok(sql(`select count(*) from "WhatsAppChat" where "branchId"='${burzaco}'`) === '0', 'Los chats son de la sucursal (Burzaco no tiene)');
}

console.log('\n13. Sin WhatsApp en el plan');
{
  const plan = sql(`select "planId" from "Tenant" where id='${pepperino}'`);
  const basico = sql(`select id from "Plan" where name='Básico'`);
  sql(`update "Tenant" set "planId"='${basico}' where id='${pepperino}'`);
  ok((await bandeja(cCaja)).status === 403, 'La bandeja no se abre');
  const panel = await (await fetch(`${PEP}/admin`, { headers: { Cookie: cPep } })).text();
  ok(!panel.includes('/admin/whatsapp'), 'No aparece en el menú, ni para el dueño');
  const n = sql(`select count(*) from "WhatsAppMessage"`);
  await evo('entrante', { instance: INST, jid: JID, id: 'P1', texto: 'sigo acá' });
  ok(sql(`select count(*) from "WhatsAppMessage"`) === n, 'Los mensajes nuevos no se guardan');
  sql(`update "Tenant" set "planId"='${plan}' where id='${pepperino}'`);
}

console.log('\n14. Desconectar');
{
  ok((await accion(PEP, 'desconectarWhatsApp', [], cCaja)).res?.ok !== true, 'La caja no puede desconectar');
  ok((await accion(PEP, 'desconectarWhatsApp', [], cPep)).res.ok === true, 'El dueño desconecta');
  const inst = await (await fetch(`${EVO}/__test/instancias`, { method: 'POST' })).json();
  ok(!inst[INST], 'La instancia se borra de Evolution');
  ok(sql(`select status || '/' || phone from "WhatsAppLine" where "branchId"='${adrogue}'`) === 'desconectado/', 'Queda desconectado y sin número');
  ok(Number(sql(`select count(*) from "WhatsAppMessage"`)) > 10, 'Los chats quedan guardados');
  ok(Number(sql(`select count(*) from "AuditLog" where action='whatsapp'`)) >= 3, 'Queda en la bitácora');
}

console.log(fallas ? `\n${fallas} FALLAS` : '\nTODO OK');
process.exit(fallas ? 1 : 0);
