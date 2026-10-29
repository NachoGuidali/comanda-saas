// Corre el agente de impresión de verdad (print-agent/) contra el sistema de
// prueba, con una "impresora" de red falsa en el puerto 9555: vinculación con
// código, ESC/POS, acentos, impresora apagada y vuelta, pantalla local.
// Con el sistema andando en el puerto 3100 y `npm install` hecho en print-agent:
//   node pruebas/agente-real.mjs
import net from 'net';
import { spawn, execSync } from 'child_process';
import { readFileSync, rmSync } from 'fs';
import { createRequire } from 'module';
const CS = process.argv[2] || process.cwd();
const { encodeReply } = createRequire(CS + '/package.json')('next/dist/compiled/react-server-dom-webpack/client.node');
const manifest = JSON.parse(readFileSync(CS + '/.next/server/server-reference-manifest.json', 'utf8')).node;
const ids = {}; for (const [id, v] of Object.entries(manifest)) ids[v.exportedName] = id;
const PEP = 'http://pepperino.localhost:3100';
const sql = (q) => execSync(`docker exec pz-test-db psql -U pizzeria -qtAc ${JSON.stringify(q)}`).toString().trim();
let fallas = 0; const ok = (c, m, x) => { console.log(c ? '  ✓' : '  ✗', m, c ? '' : JSON.stringify(x ?? '').slice(0, 300)); if (!c) fallas++; };
const espera = (ms) => new Promise((r) => setTimeout(r, ms));
async function accion(nombre, args, cookie = '') {
  const headers = { 'Next-Action': ids[nombre], Accept: 'text/x-component', 'x-forwarded-for': '10.7.0.' + Math.floor(Math.random() * 200) };
  if (cookie) headers.Cookie = cookie;
  const body = await encodeReply(args);
  if (typeof body === 'string') headers['Content-Type'] = 'text/plain;charset=UTF-8';
  const r = await fetch(`${PEP}/login`, { method: 'POST', headers, body });
  const t = await r.text(); const l = t.split('\n').find((x) => x.startsWith('1:'));
  return { res: l ? JSON.parse(l.slice(2)) : {}, cookie: (r.headers.getSetCookie?.() ?? []).map((c) => c.split(';')[0]).join('; ') };
}
const fd = new FormData(); fd.set('email', 'super@pepperino.com'); fd.set('password', 'super1234');
const { cookie } = await accion('login', [fd]);
const alta = await accion('agregarImpresora', [{ nombre: 'Mostrador', estaciones: 'todo' }], cookie);
ok(alta.res.ok, 'Alta en el panel', alta.res);

// La "impresora"
let recibido = Buffer.alloc(0);
const impresora = net.createServer((s) => s.on('data', (d) => { recibido = Buffer.concat([recibido, d]); })).listen(9555, '127.0.0.1');

const datos = process.argv[3] || (await import('os')).tmpdir() + '/comanda-agente-prueba';
rmSync(datos, { recursive: true, force: true });
const ag = spawn(process.execPath, ['index.js', '--fondo', '--codigo', alta.res.codigo, '--servidor', 'http://localhost:3100', '--ip', '127.0.0.1', '--puerto', '9555'],
  { cwd: CS + '/print-agent', env: { ...process.env, CARPETA_DATOS: datos, PUERTO_PANTALLA: '9124', INTERVALO_MS: '500' } });
let salida = ''; ag.stdout.on('data', (d) => { salida += d; }); ag.stderr.on('data', (d) => { salida += d; });
await espera(2500);
ok(/Vinculada: "Mostrador" de Pepperino Pizza/.test(salida), 'El agente se vincula con el código', salida);
const cfg = JSON.parse(readFileSync(datos + '/config.json', 'utf8'));
ok(cfg.token && cfg.impresora.ip === '127.0.0.1' && cfg.servidor === 'http://localhost:3100', 'Guarda su configuración', cfg);

const branch = sql(`select "branchId" from "PrintAgent" where id='${alta.res.id}'`);
const jid = sql(`insert into "PrintJob" (id, "branchId", station, payload) values ('jag' || md5(random()::text), '${branch}', 'caja', E'\\002TOTAL\\003 Muzzarella áñ') returning id`);
await espera(2500);
ok(recibido.length > 0 && recibido[0] === 0x1b && recibido[1] === 0x40, 'La impresora recibe el ticket en ESC/POS', recibido.slice(0, 10));
ok(recibido.includes(Buffer.from('Muzzarella \xe1\xf1', 'latin1')), 'Con los acentos en la página de códigos de la térmica');
ok(recibido.includes(Buffer.from([0x1b, 0x21, 0x10])), 'Y la letra grande');
ok(sql(`select status from "PrintJob" where id='${jid}'`) === 'IMPRESO', 'El servidor la marca impresa');
ok(sql(`select printer from "PrintAgent" where id='${alta.res.id}'`) === 'Red 127.0.0.1:9555', 'El panel sabe qué impresora usa');

// La pantalla local
const est = await (await fetch('http://127.0.0.1:9124/api/estado')).json();
ok(est.vinculada && est.config.cliente === 'Pepperino Pizza' && est.estado.impresas === 1, 'La pantalla local muestra el estado', est);
ok((await fetch('http://127.0.0.1:9124/api/desvincular', { method: 'POST' })).status === 404, 'Sin el encabezado propio no acepta órdenes (una web cualquiera no puede)');
const rebind = { status: Number(execSync('curl -s -o /dev/null -w "%{http_code}" -H "Host: malo.com:9124" http://127.0.0.1:9124/api/estado').toString()) };
ok(rebind.status === 403, 'Con otro Host la rechaza (DNS rebinding)', rebind.status);
const pr = await fetch('http://127.0.0.1:9124/api/probar', { method: 'POST', headers: { 'x-comanda': '1', 'Content-Type': 'application/json' }, body: JSON.stringify({ impresora: { tipo: 'red', ip: '127.0.0.1', puerto: 9555 } }) });
await espera(300);
ok(pr.status === 200 && recibido.includes(Buffer.from('PRUEBA')), 'El botón "Imprimir prueba" de la pantalla imprime');

// Se apaga la impresora
impresora.close();
const j2 = sql(`insert into "PrintJob" (id, "branchId", station, payload) values ('jag' || md5(random()::text), '${branch}', 'cocina', 'otra') returning id`);
await espera(3000);
ok(sql(`select status from "PrintJob" where id='${j2}'`) === 'EN_COLA', 'Con la impresora apagada la comanda queda en cola');
await espera(2500);
ok(/no responde/.test(sql(`select coalesce("lastError",'') from "PrintAgent" where id='${alta.res.id}'`)), 'Y el panel ve que la impresora no responde');
recibido = Buffer.alloc(0);
const imp2 = net.createServer((s) => s.on('data', (d) => { recibido = Buffer.concat([recibido, d]); })).listen(9555, '127.0.0.1');
await espera(35000);
ok(sql(`select status from "PrintJob" where id='${j2}'`) === 'IMPRESO' && recibido.includes(Buffer.from('otra')), 'Al volver, sale sola');
ok(sql(`select "lastError" is null from "PrintAgent" where id='${alta.res.id}'`) === 't', 'Y se borra el error del panel');

// Quitada desde el panel
await accion('quitarImpresora', [alta.res.id], cookie);
await espera(1500);
const est2 = await (await fetch('http://127.0.0.1:9124/api/estado')).json();
ok(est2.estado.desvinculada === true, 'Si la quitan del panel, la pantalla local lo avisa', est2.estado);
ag.kill(); imp2.close();
console.log(fallas ? `\n${fallas} FALLAS` : '\nTODO OK');
console.log('--- salida del agente ---\n' + salida.split('\n').slice(-12).join('\n'));
process.exit(fallas ? 1 : 0);
