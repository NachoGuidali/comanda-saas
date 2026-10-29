// Cómo correrla: igual que e2e-saas.mjs (mismo sistema andando en el puerto
// 3100, base limpia con Pepperino y La Esquina). Desde la carpeta del proyecto:
//   node pruebas/e2e-impresoras.mjs
// Prueba las impresoras por local: alta en el panel, vinculación con código,
// qué recibe cada una, el estado que informan y que nadie vea lo de otro.
import { readFileSync } from 'fs';
import { execSync } from 'child_process';
import { createRequire } from 'module';

const { encodeReply } = createRequire(process.cwd() + '/package.json')('next/dist/compiled/react-server-dom-webpack/client.node');
const PUERTO = 3100;
const H = (sub) => `http://${sub ? sub + '.' : ''}localhost:${PUERTO}`;
const PEP = H('pepperino');
const ESQ = H('laesquina');
const PLAT = H('');
const manifest = JSON.parse(readFileSync(process.cwd() + '/.next/server/server-reference-manifest.json', 'utf8')).node;
const ids = {};
for (const [id, v] of Object.entries(manifest)) ids[v.exportedName] = id;

let fallas = 0;
let ipN = 1;
const ok = (c, msg, extra) => {
  if (c) console.log('  ✓', msg);
  else { fallas++; console.log('  ✗', msg, extra !== undefined ? JSON.stringify(extra).slice(0, 300) : ''); }
};
const sql = (q) => execSync(`docker exec pz-test-db psql -U pizzeria -qtAc ${JSON.stringify(q)}`).toString().trim();

function parseRsc(text) {
  const uno = text.split('\n').find((l) => l.startsWith('1:'));
  if (uno) { try { return JSON.parse(uno.slice(2)); } catch { /* sigue */ } }
  return { raw: text.slice(0, 300) };
}
async function accion(base, nombre, args, cookie = '') {
  const headers = { 'Next-Action': ids[nombre], Accept: 'text/x-component', 'x-forwarded-for': `10.3.0.${ipN++}` };
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
const vincular = (base, codigo, ip = `10.4.0.${ipN++}`) => fetch(`${base}/api/print/vincular`, {
  method: 'POST', headers: { 'Content-Type': 'application/json', 'x-forwarded-for': ip }, body: JSON.stringify({ codigo, equipo: 'PC-CAJA' }),
});
const cola = (base, token, extra = {}) => fetch(`${base}/api/print/cola`, { headers: { 'x-print-token': token, ...extra } });

const pepperino = sql("select id from \"Tenant\" where slug='pepperino'");
const esquina = sql("select id from \"Tenant\" where slug='laesquina'");
const adrogue = sql(`select id from "Branch" where slug='adrogue' and "tenantId"='${pepperino}'`);
const burzaco = sql(`select id from "Branch" where slug='burzaco' and "tenantId"='${pepperino}'`);
const esquinaCentro = sql(`select id from "Branch" where "tenantId"='${esquina}'`);
const job = (branch, station) => sql(`insert into "PrintJob" (id, "branchId", station, payload) values ('j' || md5(random()::text), '${branch}', '${station}', 'COMANDA ${station}') returning id`);

const cPep = (await login(PEP, 'super@pepperino.com', 'super1234')).cookie;
const cEsq = (await login(ESQ, 'super@pepperino.com', 'otraclave123')).cookie;
const cCaja = (await login(PEP, 'caja@pepperino.com', 'caja1234')).cookie;

console.log('\n1. Alta en el panel y vinculación con código');
let token = '';
let idCaja = '';
{
  const r = await accion(PEP, 'agregarImpresora', [{ nombre: 'Caja', estaciones: 'todo' }], cPep);
  ok(r.res.ok === true && /^[A-Z2-9]{4}-[A-Z2-9]{4}$/.test(r.res.codigo), 'El dueño agrega "Caja" y recibe un código de 8', r.res);
  idCaja = r.res.id;
  const codigo = r.res.codigo;
  ok(sql(`select "pairCodeHash" <> '${codigo.replace('-', '')}' and "branchId"='${adrogue}' and "tokenHash" is null from "PrintAgent" where id='${idCaja}'`) === 't', 'Queda en Adrogué, con el código guardado solo como hash');
  ok((await accion(PEP, 'agregarImpresora', [{ nombre: 'Colada', estaciones: 'todo' }], cCaja)).res?.ok !== true, 'La caja (sin permiso de configuración) no agrega impresoras');

  ok((await vincular(PLAT, 'AAAA-BBBB')).status === 404, 'Un código inventado no vincula');
  const v = await vincular(PLAT, codigo.toLowerCase().replace('-', ' '));
  const d = await v.json();
  ok(v.status === 200 && d.token && d.cliente === 'Pepperino Pizza' && d.sucursal.includes('Adrogu') && d.estaciones === 'todo', 'Con el código (en minúscula y con espacio) se vincula desde el dominio de la plataforma', d);
  token = d.token;
  ok((await vincular(PLAT, codigo)).status === 404, 'El código es de un solo uso');
  ok(sql(`select "tokenHash" is not null and "pairCodeHash" is null and device='PC-CAJA' from "PrintAgent" where id='${idCaja}'`) === 't', 'Se guarda el hash de la clave y el nombre de la PC');

  const vencido = await accion(PEP, 'agregarImpresora', [{ nombre: 'Vieja', estaciones: 'cocina' }], cPep);
  sql(`update "PrintAgent" set "pairExpires" = now() - interval '1 minute' where id='${vencido.res.id}'`);
  ok((await vincular(PLAT, vencido.res.codigo)).status === 404, 'Un código vencido no sirve');
  await accion(PEP, 'quitarImpresora', [vencido.res.id], cPep);
}

console.log('\n2. Qué recibe cada impresora');
let idCocina = '';
let tokenCocina = '';
{
  const jc = job(adrogue, 'cocina');
  const jk = job(adrogue, 'caja');
  const jb = job(burzaco, 'cocina');
  const je = job(esquinaCentro, 'cocina');
  const r = await cola(PLAT, token, { 'x-agente-impresora': encodeURIComponent('Red 192.168.1.50'), 'x-agente-version': '2.0.0', 'x-agente-estado': 'ok' });
  const d = await r.json();
  const recibidos = d.jobs.map((j) => j.id);
  ok(r.status === 200 && recibidos.includes(jc) && recibidos.includes(jk), '"Todo": recibe la comanda de cocina y el ticket de caja', d);
  ok(!recibidos.includes(jb), 'No recibe lo de Burzaco (otro local del mismo cliente)');
  ok(!recibidos.includes(je), 'Ni lo de La Esquina');
  ok(d.config?.estaciones === 'todo' && d.config?.nombre === 'Caja', 'Le llega su configuración del panel');
  ok(sql(`select "lastSeenAt" is not null and printer='Red 192.168.1.50' and version='2.0.0' from "PrintAgent" where id='${idCaja}'`) === 't', 'Queda anotado cuándo se conectó y qué impresora usa');
  ok((await cola(PEP, token)).status === 200 && (await cola(ESQ, token)).status === 200, 'La clave vinculada entra por cualquier dominio...');
  ok(!(await (await cola(ESQ, token)).json()).jobs.some((j) => j.id === je), '...y aun por el de La Esquina, solo ve lo de Adrogué');

  const conf = await fetch(`${PLAT}/api/print/confirmar`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-print-token': token }, body: JSON.stringify({ id: je, ok: true }) });
  ok(conf.status === 404 && sql(`select status from "PrintJob" where id='${je}'`) === 'EN_COLA', 'No puede marcar impresa una comanda de otro cliente');
  const conf2 = await fetch(`${PLAT}/api/print/confirmar`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-print-token': token }, body: JSON.stringify({ id: jb, ok: true }) });
  ok(conf2.status === 404, 'Ni una de otro local del mismo cliente');

  const g = await accion(PEP, 'guardarImpresora', [idCaja, { nombre: 'Caja', estaciones: 'caja', abrirCajon: true }], cPep);
  ok(g.res.ok === true, 'El dueño la cambia a "Solo caja" con cajón', g.res);
  const d2 = await (await cola(PLAT, token)).json();
  ok(d2.jobs.some((j) => j.id === jk) && !d2.jobs.some((j) => j.id === jc), 'Ahora recibe solo el ticket de caja', d2.jobs.map((j) => j.station));
  ok(d2.config.abrirCajon === true && d2.config.estaciones === 'caja', 'Y se entera del cambio sin tocar la PC');

  const n = await accion(PEP, 'agregarImpresora', [{ nombre: 'Cocina', estaciones: 'cocina' }], cPep);
  idCocina = n.res.id;
  tokenCocina = (await (await vincular(PEP, n.res.codigo)).json()).token;
  const d3 = await (await cola(PLAT, tokenCocina)).json();
  ok(d3.jobs.some((j) => j.id === jc) && !d3.jobs.some((j) => j.id === jk), 'La segunda impresora, "Solo cocina", recibe la comanda y no el ticket');

  const p = await accion(PEP, 'probarImpresora', [idCocina], cPep);
  ok(p.res.ok === true, 'Imprimir prueba desde el panel', p.res);
  const d4 = await (await cola(PLAT, tokenCocina)).json();
  const d5 = await (await cola(PLAT, token)).json();
  ok(d4.jobs.some((j) => j.station === 'prueba' && j.payload.includes('PRUEBA')), 'La prueba le llega a esa impresora...');
  ok(!d5.jobs.some((j) => j.station === 'prueba'), '...y no a la otra');
}

console.log('\n3. El panel muestra cómo anda cada una');
{
  await cola(PLAT, token, { 'x-agente-estado': encodeURIComponent('La impresora (192.168.1.50) no responde') });
  ok(sql(`select "lastError" from "PrintAgent" where id='${idCaja}'`).includes('no responde'), 'El agente avisa que la impresora no responde');
  const html = (await (await fetch(`${PEP}/admin/config`, { headers: { Cookie: cPep } })).text()).replace(/<!-- -->/g, '');
  // La pestaña Impresión se dibuja en el navegador: los datos viajan en la página
  ok(html.includes('PC-CAJA') && html.includes('Red 192.168.1.50') && html.includes('Cocina'), 'Configuración trae las impresoras de Adrogué');
  ok(html.includes('no responde'), 'Con el error que informa la PC');
  await cola(PLAT, token, { 'x-agente-estado': 'ok' });
  ok(sql(`select "lastError" is null from "PrintAgent" where id='${idCaja}'`) === 't', 'Cuando vuelve, se borra el error');
  const otra = (await (await fetch(`${ESQ}/admin/config`, { headers: { Cookie: cEsq } })).text());
  ok(!otra.includes('PC-CAJA'), 'La Esquina no ve las impresoras de Pepperino');
}

console.log('\n4. Nadie toca lo de otro');
{
  ok((await accion(ESQ, 'guardarImpresora', [idCaja, { nombre: 'Robada', estaciones: 'todo', abrirCajon: false }], cEsq)).res.ok === false, 'La Esquina no cambia una impresora de Pepperino');
  ok((await accion(ESQ, 'codigoImpresora', [idCaja], cEsq)).res.ok === false, 'Ni pide un código para vincularla a su PC');
  ok((await accion(ESQ, 'probarImpresora', [idCaja], cEsq)).res.ok === false, 'Ni le manda pruebas');
  ok((await accion(ESQ, 'quitarImpresora', [idCaja], cEsq)).res.ok === false && sql(`select count(*) from "PrintAgent" where id='${idCaja}'`) === '1', 'Ni la quita');
}

console.log('\n5. Pasarla a otra PC y quitarla');
{
  const c = await accion(PEP, 'codigoImpresora', [idCaja], cPep);
  ok(c.res.ok === true && (await cola(PLAT, token)).status === 200, 'Pedir un código nuevo no corta la PC vieja todavía');
  const nuevo = (await (await vincular(PLAT, c.res.codigo)).json()).token;
  ok((await cola(PLAT, token)).status === 401 && (await cola(PLAT, nuevo)).status === 200, 'Al usarlo en la PC nueva, la vieja deja de imprimir');
  ok((await accion(PEP, 'quitarImpresora', [idCocina], cPep)).res.ok === true && (await cola(PLAT, tokenCocina)).status === 401, 'Quitada, su clave ya no entra');
}

console.log('\n6. La forma vieja (.env) sigue andando');
{
  const t = await accion(PEP, 'generarTokenImpresora', [], cPep);
  ok((await cola(PEP, t.res.token)).status === 400, 'La clave general sin ?sucursal= pide la sucursal (Pepperino tiene dos)');
  const r = await fetch(`${PEP}/api/print/cola?sucursal=adrogue`, { headers: { 'x-print-token': t.res.token } });
  ok(r.status === 200 && !(await r.json()).jobs.some((j) => j.station === 'prueba'), 'Con ?sucursal= lee la cola, sin las pruebas de otras impresoras');
  ok((await cola(PLAT, t.res.token)).status === 401, 'Esa clave solo entra por el dominio del cliente');
}

console.log('\n7. Freno a quien prueba códigos');
{
  const codigos = [];
  for (let i = 0; i < 11; i++) codigos.push((await vincular(PLAT, 'ZZZZ-ZZZZ', '10.9.9.9')).status);
  ok(codigos.slice(0, 10).every((s) => s === 404) && codigos[10] === 429, 'Al intento 11 desde la misma IP, espera', codigos);
}

console.log(fallas ? `\n${fallas} FALLAS` : '\nTODO OK');
process.exit(fallas ? 1 : 0);
