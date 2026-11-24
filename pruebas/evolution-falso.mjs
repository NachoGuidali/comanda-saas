// Evolution API de mentira para las pruebas de WhatsApp: responde como la
// v2.3.7 real (las formas se verificaron contra un Evolution de verdad) y
// manda los webhooks al sistema como lo haría ella. Puerto 3998; el sistema
// apunta con EVOLUTION_URL=http://localhost:3998 EVOLUTION_API_KEY=clave-evo-falsa.
//
// Rutas de control (/__test/...) para simular lo que pasa del lado del
// celular: que se escanee el QR, que llegue un mensaje, que lo lean.
import http from 'http';

const CLAVE = 'clave-evo-falsa';
const instancias = new Map();
let enviados = [];
let eco = false;
let n = 0;

async function avisar(nombre, event, data) {
  const i = instancias.get(nombre);
  if (!i?.webhook?.url) return { status: 0 };
  const r = await fetch(i.webhook.url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(i.webhook.headers ?? {}) },
    body: JSON.stringify({ event, instance: nombre, data, destination: i.webhook.url, date_time: new Date().toISOString(), server_url: 'http://localhost:3998', apikey: i.token }),
  });
  return { status: r.status, body: await r.text() };
}

const qr = () => `data:image/png;base64,QR${++n}`;

function mensajeUpsert({ jid, id, fromMe = false, nombre = '', texto, tipo, base64, mimetype, alt, fileName, ptt }) {
  let message;
  if (tipo === 'imagen') message = { imageMessage: { mimetype: mimetype ?? 'image/jpeg', caption: texto ?? '' } };
  else if (tipo === 'audio') message = { audioMessage: { mimetype: mimetype ?? 'audio/ogg; codecs=opus', ptt: ptt ?? true } };
  else if (tipo === 'documento') message = { documentMessage: { mimetype: mimetype ?? 'application/pdf', fileName: fileName ?? 'archivo.pdf' } };
  else if (tipo === 'reaccion') message = { reactionMessage: { text: '👍' } };
  else if (tipo === 'ubicacion') message = { locationMessage: { degreesLatitude: -34.8, degreesLongitude: -58.39, name: 'Mi casa' } };
  else if (tipo === 'temporal') message = { ephemeralMessage: { message: { extendedTextMessage: { text: texto } } } };
  else message = { conversation: texto };
  if (base64) message.base64 = base64;
  return {
    key: { remoteJid: jid, fromMe, id: id ?? `WA${++n}`, ...(alt ? { remoteJidAlt: alt } : {}) },
    pushName: nombre,
    message,
    messageType: Object.keys(message)[0],
    messageTimestamp: Math.floor(Date.now() / 1000),
  };
}

http.createServer((req, res) => {
  let cuerpo = '';
  req.on('data', (d) => (cuerpo += d));
  req.on('end', async () => {
    const url = new URL(req.url, 'http://x');
    const json = (status, data) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(data)); };
    const body = cuerpo ? JSON.parse(cuerpo) : {};
    const ruta = url.pathname;
    const nombre = decodeURIComponent(ruta.split('/').pop() ?? '');

    if (ruta.startsWith('/__test/')) {
      const i = instancias.get(body.instance);
      if (ruta === '/__test/instancias') return json(200, Object.fromEntries([...instancias].map(([k, v]) => [k, { state: v.state, webhook: v.webhook }])));
      if (ruta === '/__test/enviados') return json(200, enviados);
      if (ruta === '/__test/limpiar') { enviados = []; return json(200, { ok: true }); }
      if (ruta === '/__test/eco') { eco = !!body.activo; return json(200, { ok: true }); }
      if (!i) return json(404, { error: 'no existe la instancia' });
      if (ruta === '/__test/qr') return json(200, await avisar(body.instance, 'qrcode.updated', { qrcode: { instance: body.instance, base64: qr(), code: '2@x' } }));
      if (ruta === '/__test/conectar') {
        i.state = 'open';
        i.ownerJid = `${body.numero}@s.whatsapp.net`;
        i.profileName = body.nombre ?? 'Pepperino';
        return json(200, await avisar(body.instance, 'connection.update', { instance: body.instance, state: 'open', statusReason: 200 }));
      }
      if (ruta === '/__test/cerrar') {
        i.state = 'close';
        return json(200, await avisar(body.instance, 'connection.update', { instance: body.instance, state: 'close', statusReason: body.motivo ?? 428 }));
      }
      if (ruta === '/__test/entrante') return json(200, await avisar(body.instance, 'messages.upsert', mensajeUpsert(body)));
      if (ruta === '/__test/estado') return json(200, await avisar(body.instance, 'messages.update', { keyId: body.keyId, remoteJid: body.jid ?? '', fromMe: true, status: body.status }));
      return json(404, {});
    }

    if (req.headers.apikey !== CLAVE) return json(401, { status: 401, error: 'Unauthorized', response: { message: 'Unauthorized' } });

    if (ruta === '/instance/create' && req.method === 'POST') {
      if (instancias.has(body.instanceName)) return json(403, { status: 403, error: 'Forbidden', response: { message: [`This name "${body.instanceName}" is already in use.`] } });
      const i = { state: 'connecting', webhook: body.webhook, token: `TOKEN-${++n}`, ownerJid: null, profileName: null };
      instancias.set(body.instanceName, i);
      const primero = qr();
      setTimeout(() => {
        void avisar(body.instanceName, 'connection.update', { instance: body.instanceName, state: 'connecting', statusReason: 200 });
      }, 50);
      return json(201, { instance: { instanceName: body.instanceName, status: 'connecting' }, hash: i.token, qrcode: { pairingCode: null, code: '2@x', base64: primero, count: 1 } });
    }
    const i = instancias.get(nombre);
    if (ruta.startsWith('/webhook/set/')) {
      if (!i) return json(404, { status: 404, error: 'Not Found', response: { message: [`The "${nombre}" instance does not exist`] } });
      i.webhook = body.webhook;
      return json(201, { url: body.webhook.url });
    }
    if (ruta === '/instance/fetchInstances') {
      const x = instancias.get(url.searchParams.get('instanceName'));
      return json(200, x ? [{ name: url.searchParams.get('instanceName'), connectionStatus: x.state, ownerJid: x.ownerJid, profileName: x.profileName }] : []);
    }
    if (!i) return json(404, { status: 404, error: 'Not Found', response: { message: [`The "${nombre}" instance does not exist`] } });
    if (ruta.startsWith('/instance/connect/')) return json(200, i.state === 'open' ? { instance: { state: 'open' } } : { pairingCode: null, code: '2@x', base64: qr(), count: 1 });
    if (ruta.startsWith('/instance/connectionState/')) return json(200, { instance: { instanceName: nombre, state: i.state } });
    if (ruta.startsWith('/instance/logout/')) { i.state = 'close'; return json(200, { status: 'SUCCESS', error: false, response: { message: 'Instance logged out' } }); }
    if (ruta.startsWith('/instance/delete/')) { instancias.delete(nombre); return json(200, { status: 'SUCCESS', error: false, response: { message: 'Instance deleted' } }); }

    if (ruta.startsWith('/message/')) {
      // Como la real: desconectada, revienta con un 500 sin explicación
      if (i.state !== 'open') return json(500, { status: 500, error: 'Internal Server Error', response: { message: "Cannot read properties of undefined (reading 'find')" } });
      if (String(body.number).includes('5491100000000')) return json(400, { status: 400, error: 'Bad Request', response: { message: [{ jid: `${body.number}@s.whatsapp.net`, exists: false, number: body.number }] } });
      const tipo = ruta.split('/')[2];
      const id = `ENV${++n}`;
      enviados.push({ instancia: nombre, tipo, id, ...body, media: body.media ? `${String(body.media).slice(0, 20)}…(${String(body.media).length})` : undefined, audio: body.audio ? `(${String(body.audio).length})` : undefined });
      const jid = String(body.number).includes('@') ? body.number : `${body.number}@s.whatsapp.net`;
      // Como WhatsApp: el mensaje propio vuelve como "upsert" (a veces antes que la respuesta)
      if (eco) void avisar(nombre, 'messages.upsert', mensajeUpsert({ jid, id, fromMe: true, texto: body.text ?? body.caption ?? '' }));
      return json(201, { key: { remoteJid: jid, fromMe: true, id }, status: 'PENDING', messageTimestamp: Math.floor(Date.now() / 1000) });
    }
    return json(404, { status: 404, error: 'Not Found' });
  });
}).listen(3998, () => console.log('Evolution de mentira en el 3998'));
