// Prueba la conexión contra un Evolution API de verdad (sin celular): que el
// sistema cree la instancia, que el QR llegue por el webhook firmado y que al
// desconectar se borre. Sirve para probar una versión nueva de Evolution
// antes de cambiarla en el docker-compose.
//
// Con el sistema en el 3100 (base con Pepperino) y la variable
// EVOLUTION_URL apuntando al Evolution real, WHATSAPP_WEBHOOK_URL a
// http://localhost:3100/api/whatsapp/webhook (Evolution tiene que poder
// llegar ahí). Desde la carpeta del proyecto:
//   EVOLUTION_URL=http://localhost:8080 EVOLUTION_API_KEY=... node pruebas/e2e-whatsapp-real.mjs
import { readFileSync } from 'fs';
import { execSync } from 'child_process';
import { createRequire } from 'module';

const { encodeReply } = createRequire(process.cwd() + '/package.json')('next/dist/compiled/react-server-dom-webpack/client.node');
const PEP = 'http://pepperino.localhost:3100';
const EVO = process.env.EVOLUTION_URL;
const CLAVE = process.env.EVOLUTION_API_KEY;
const manifest = JSON.parse(readFileSync(process.cwd() + '/.next/server/server-reference-manifest.json', 'utf8')).node;
const ids = {};
for (const [id, v] of Object.entries(manifest)) ids[v.exportedName] = id;

let fallas = 0;
const ok = (c, msg, extra) => {
  if (c) console.log('  ✓', msg);
  else { fallas++; console.log('  ✗', msg, extra !== undefined ? JSON.stringify(extra).slice(0, 300) : ''); }
};
const sql = (q) => execSync(`docker exec pz-test-db psql -U pizzeria -qtAc ${JSON.stringify(q)}`).toString().trim();
const esperar = (ms) => new Promise((r) => setTimeout(r, ms));
/**
 * La respuesta de una acción viene en formato RSC: renglones "id:json" y,
 * para los textos largos (el QR), pedazos "id:T<largo en hex>,<texto>" sin
 * salto de línea. Se arma el resultado (el renglón 1) resolviendo "$<id>".
 */
function leerRsc(t) {
  const filas = {};
  let i = 0;
  while (i < t.length) {
    const dos = t.indexOf(':', i);
    if (dos < 0) break;
    const id = t.slice(i, dos);
    if (t[dos + 1] === 'T') {
      const coma = t.indexOf(',', dos);
      const largo = parseInt(t.slice(dos + 2, coma), 16);
      filas[id] = t.slice(coma + 1, coma + 1 + largo);
      i = coma + 1 + largo;
    } else {
      const fin = t.indexOf('\n', dos);
      filas[id] = t.slice(dos + 1, fin < 0 ? undefined : fin);
      i = fin < 0 ? t.length : fin + 1;
    }
  }
  if (!filas['1']) return {};
  return JSON.parse(filas['1'], (_k, v) => (typeof v === 'string' && /^\$[0-9a-f]+$/.test(v) && v.slice(1) in filas ? filas[v.slice(1)] : v));
}

async function accion(nombre, args, cookie = '') {
  const headers = { 'Next-Action': ids[nombre], Accept: 'text/x-component' };
  if (cookie) headers.Cookie = cookie;
  const body = await encodeReply(args instanceof FormData ? [args] : args);
  if (typeof body === 'string') headers['Content-Type'] = 'text/plain;charset=UTF-8';
  const r = await fetch(`${PEP}/login`, { method: 'POST', headers, body, redirect: 'manual' });
  return { res: leerRsc(await r.text()), setCookie: r.headers.getSetCookie?.() ?? [] };
}
const evo = async (ruta) => (await fetch(`${EVO}${ruta}`, { headers: { apikey: CLAVE } })).json();

if (!EVO || !CLAVE) { console.log('Falta EVOLUTION_URL y EVOLUTION_API_KEY'); process.exit(1); }
const fd = new FormData(); fd.set('email', 'super@pepperino.com'); fd.set('password', 'super1234');
const cookie = (await accion('login', fd)).setCookie.map((c) => c.split(';')[0]).join('; ');
const adrogue = sql("select b.id from \"Branch\" b join \"Tenant\" t on t.id=b.\"tenantId\" where t.slug='pepperino' and b.slug='adrogue'");
const instancia = `cs-${adrogue}`;

console.log(`\nEvolution ${(await (await fetch(EVO)).json()).version}`);
const r = await accion('conectarWhatsApp', [], cookie);
ok(r.res.ok === true && r.res.status === 'esperando_qr' && r.res.qr?.startsWith('data:image/png;base64,'), 'Crea la instancia y trae el primer QR', r.res);
const hook = await evo(`/webhook/find/${instancia}`);
ok(hook?.enabled && hook.webhookBase64 && hook.headers?.['x-comanda-token'] && hook.events?.includes('MESSAGES_UPSERT'), 'Queda con el webhook firmado, con archivos y con los eventos', hook);
const estado = await evo(`/instance/connectionState/${instancia}`);
ok(estado?.instance?.state === 'connecting', 'Evolution la tiene esperando el escaneo', estado);

// El QR se renueva solo (cada ~45 segundos) y llega por el webhook: tiene que cambiar en el sistema
const primero = r.res.qr;
let nuevo = null;
for (let i = 0; i < 70 && !nuevo; i++) {
  await esperar(1000);
  const e = await accion('estadoWhatsApp', [], cookie);
  if (e.res.qr && e.res.qr !== primero) nuevo = e.res.qr;
}
ok(!!nuevo, 'El QR renovado llega por el webhook (la clave del webhook es aceptada)');
ok(sql(`select "lastEventAt" > now() - interval '1 minute' from "WhatsAppLine" where "branchId"='${adrogue}'`) === 't', 'El sistema registra los avisos de Evolution');

const otra = await accion('conectarWhatsApp', [], cookie);
ok(otra.res.ok === true && otra.res.status === 'esperando_qr', 'Reconectar con la instancia ya creada funciona (rota la clave del webhook)', otra.res);
const hook2 = await evo(`/webhook/find/${instancia}`);
ok(hook2.headers['x-comanda-token'] !== hook.headers['x-comanda-token'], 'Evolution quedó con la clave nueva');

const d = await accion('desconectarWhatsApp', [], cookie);
ok(d.res.ok === true, 'Desconectar', d.res);
// Evolution tarda un par de segundos en terminar de borrarla
let despues = 0;
for (let i = 0; i < 10 && despues !== 404; i++) {
  await esperar(1000);
  despues = (await fetch(`${EVO}/instance/connectionState/${instancia}`, { headers: { apikey: CLAVE } })).status;
}
ok(despues === 404, 'La instancia ya no existe en Evolution');
await esperar(2000);
ok(sql(`select status || '/' || coalesce("lastError", '') from "WhatsAppLine" where "branchId"='${adrogue}'`) === 'desconectado/', 'Queda desconectado sin un error engañoso ("se desvinculó desde el celular")');

console.log(fallas ? `\n${fallas} FALLAS` : '\nTODO OK');
process.exit(fallas ? 1 : 0);
