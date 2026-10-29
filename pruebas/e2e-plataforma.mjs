// Prueba de punta a punta de la plataforma: planes y funciones, Mercado Pago
// de cada local, panel de la plataforma, abonos (vencimiento, avisos,
// suspensión, pagos, Mercado Pago de la plataforma) y bitácora.
//
// Cómo correrla (base limpia, sistema compilado):
//   1. node pruebas/mp-falso.mjs   (Mercado Pago de mentira en el puerto 3999)
//   2. Base: prisma db push + seed + actualizar-permisos, y
//      npx tsx prisma/plataforma.ts --email plataforma@supreg.com --password plataforma123
//   3. Servidor en 3100 con SAAS_DOMINIO=localhost MP_API_URL=http://localhost:3999
//      PLATAFORMA_MP_TOKEN=APP_USR-plataforma-00000000000000000000000000 SAAS_REVISION_AUTOMATICA=false
//   4. node pruebas/e2e-plataforma.mjs (desde la carpeta del proyecto)
import { readFileSync } from 'fs';
import { execSync } from 'child_process';
import { createRequire } from 'module';

const { encodeReply } = createRequire(process.cwd() + '/package.json')('next/dist/compiled/react-server-dom-webpack/client.node');
const H = (sub) => `http://${sub ? sub + '.' : ''}localhost:3100`;
const PEP = H('pepperino');
const ESQ = H('laesquina');
const PLAT = H('');
const MP = 'http://localhost:3999';
const TOKEN_PEP = 'APP_USR-pepperino-00000000000000000000000000';
const TOKEN_ESQ = 'APP_USR-esquina-000000000000000000000000000000';
const TOKEN_PLAT = 'APP_USR-plataforma-00000000000000000000000000';
const manifest = JSON.parse(readFileSync(process.cwd() + '/.next/server/server-reference-manifest.json', 'utf8')).node;
const ids = {};
for (const [id, v] of Object.entries(manifest)) ids[v.exportedName] = id;

let fallas = 0;
let ipN = 1;
const ok = (c, msg, extra) => {
  if (c) console.log('  ✓', msg);
  else { fallas++; console.log('  ✗', msg, extra !== undefined ? JSON.stringify(extra).slice(0, 300) : ''); }
};
const sql = (q) => execSync(`docker exec pz-test-db psql -U pizzeria -tAc ${JSON.stringify(q)}`).toString().trim();
const dia = (d) => new Date(Date.now() + d * 86400000).toISOString().slice(0, 10);

function parseRsc(text) {
  const uno = text.split('\n').find((l) => l.startsWith('1:'));
  if (uno) { try { return JSON.parse(uno.slice(2)); } catch { /* sigue */ } }
  return { raw: text.slice(0, 300) };
}
async function accion(base, nombre, args, cookie = '') {
  const headers = { 'Next-Action': ids[nombre], Accept: 'text/x-component', 'x-forwarded-for': `10.3.${Math.floor(ipN / 250)}.${ipN++ % 250}` };
  if (cookie) headers.Cookie = cookie;
  const body = await encodeReply(args instanceof FormData ? [args] : args);
  if (typeof body === 'string') headers['Content-Type'] = 'text/plain;charset=UTF-8';
  // Cada acción se manda a una página que la usa, como haría el navegador
  const ruta = base === PLAT ? '/plataforma/ingresar' : '/login';
  const r = await fetch(`${base}${ruta}`, { method: 'POST', headers, body, redirect: 'manual' });
  return { res: parseRsc(await r.text()), setCookie: r.headers.getSetCookie?.() ?? [] };
}
const form = (o) => { const f = new FormData(); for (const [k, v] of Object.entries(o)) f.set(k, v); return f; };
async function login(base, email, password, accionNombre = 'login') {
  const { res, setCookie } = await accion(base, accionNombre, form({ email, password }));
  return { res, cookie: setCookie.map((c) => c.split(';')[0]).join('; ') };
}
const pagina = async (url, cookie = '') => {
  const r = await fetch(url, { headers: cookie ? { Cookie: cookie } : {}, redirect: 'manual' });
  return { status: r.status, location: r.headers.get('location') ?? '', html: (await r.text()).replace(/<!-- -->/g, '') };
};
const mp = (ruta, data) => fetch(MP + ruta, { method: 'POST', body: JSON.stringify(data) });
const webhook = (base, ruta, data) => fetch(base + ruta, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });

const pepperino = sql("select id from \"Tenant\" where slug='pepperino'");
const adrogue = sql(`select id from "Branch" where slug='adrogue' and "tenantId"='${pepperino}'`);
const vino = sql(`select id from "Product" where name='Vino de la casa' and "branchId"='${adrogue}'`);
const basico = sql("select id from \"Plan\" where name='Básico'");
const cadena = sql("select id from \"Plan\" where name='Cadena'");

console.log('\n1. El panel de la plataforma');
let cPlat;
{
  const sin = await pagina(PLAT + '/plataforma');
  ok(sin.status === 307 && sin.location.includes('/plataforma/ingresar'), 'Sin sesión, pide ingresar', sin.location);
  ok((await pagina(PEP + '/plataforma/ingresar')).status === 404, 'En el dominio de un local, la plataforma no existe');
  const mal = await login(PLAT, 'plataforma@supreg.com', 'otra-clave-123', 'ingresarPlataforma');
  ok(mal.res.ok === false, 'Con clave equivocada no entra');
  const a = await login(PLAT, 'plataforma@supreg.com', 'plataforma123', 'ingresarPlataforma');
  ok(a.res.ok === true && a.cookie.includes('cs_plataforma'), 'El administrador entra', a.res);
  cPlat = a.cookie;
  const dueno = (await login(PEP, 'super@pepperino.com', 'super1234')).cookie;
  ok((await pagina(PLAT + '/plataforma', dueno)).status === 307, 'El dueño de un local no entra a la plataforma');
  ok((await pagina(PEP + '/plataforma', cPlat)).status === 404, 'Y la sesión de la plataforma no sirve en un local');
  const malas = [];
  for (const p of ['/plataforma', '/plataforma/planes', '/plataforma/pagos', '/plataforma/bitacora', '/plataforma/clientes/nuevo', `/plataforma/clientes/${pepperino}`]) {
    const r = await pagina(PLAT + p, cPlat);
    if (r.status !== 200) malas.push(`${p}:${r.status}`);
  }
  ok(malas.length === 0, 'Abren clientes, planes, pagos, bitácora, alta y ficha', malas);
  ok((await pagina(PLAT + '/plataforma', cPlat)).html.includes('Pepperino Pizza'), 'Pepperino aparece en la lista');
}

console.log('\n2. Alta de un cliente desde el panel, con plan Básico');
let esquina, cEsq;
{
  const r = await accion(PLAT, 'altaCliente', [{
    slug: 'laesquina', nombre: 'La Esquina', email: 'dueno@laesquina.com', password: 'esquina1234', contactName: 'Rosa',
    sucursal: 'La Esquina Centro', direccion: 'Mitre 100', whatsapp: '5491100000000', planId: basico, diasPrueba: 14,
    principal: '#1E3A8A', acento: '#F59E0B', fondo: '#F8FAFC',
  }], cPlat);
  ok(r.res.ok === true, 'Se crea La Esquina', r.res);
  esquina = r.res.id;
  ok(sql(`select "trialUntil" > now() + interval '13 days' from "Tenant" where id='${esquina}'`) === 't', 'Con 14 días de prueba');
  const rep = await accion(PLAT, 'altaCliente', [{ slug: 'laesquina', nombre: 'Otra', email: 'x@x.com', password: 'clave12345' }], cPlat);
  ok(rep.res.ok === false, 'La misma dirección no se repite');
  const sinSesion = await accion(PLAT, 'altaCliente', [{ slug: 'colado', nombre: 'Colado', email: 'x@x.com', password: 'clave12345' }]);
  ok(sinSesion.res?.ok !== true && sql("select count(*) from \"Tenant\" where slug='colado'") === '0', 'Sin sesión de plataforma no se puede dar de alta');
  cEsq = (await login(ESQ, 'dueno@laesquina.com', 'esquina1234')).cookie;
  ok((await pagina(ESQ + '/admin/pedidos', cEsq)).status === 200, 'Su dueño entra a su panel');
}

console.log('\n3. Lo que no incluye el plan Básico');
{
  const menu = (await pagina(ESQ + '/admin/pedidos', cEsq)).html;
  ok(!menu.includes('href="/admin/salon"') && !menu.includes('href="/admin/insumos"') && !menu.includes('>Sueldos<'), 'El menú no muestra Salón, Insumos ni Sueldos');
  ok((await pagina(ESQ + '/admin/salon', cEsq)).status === 307, 'Salón no abre');
  ok((await pagina(ESQ + '/admin/insumos', cEsq)).status === 307, 'Insumos no abre');
  ok((await pagina(ESQ + '/admin/gastos/sueldos', cEsq)).status === 307, 'Sueldos no abre');
  const mesa = await accion(ESQ, 'guardarInsumo', [{ nombre: 'Harina', unidad: 'KG', minimo: '' }], cEsq);
  ok(mesa.res.ok === false, 'Ni sus acciones (insumo)', mesa.res);
  const carta = (await pagina(ESQ + '/la-esquina-centro')).html;
  ok(!carta.includes('Reservar mesa'), 'La carta no ofrece reservas');
  ok((await pagina(ESQ + '/la-esquina-centro/reservas')).status === 404, 'Ni la página de reservas');
  const cobro = (await pagina(ESQ + '/admin/config', cEsq)).html;
  ok(cobro.includes('Cobro online'), 'Configuración tiene Cobro online');
  const mpNo = await accion(ESQ, 'guardarMercadoPago', [{ modo: 'simulado' }], cEsq);
  ok(mpNo.res.ok === false, 'Pero el plan no incluye el pago online', mpNo.res);
  const suc = await accion(ESQ, 'crearSucursal', [form({ name: 'Segunda', address: 'X 1', whatsapp: '5491100000000' })], cEsq);
  ok(suc.res.ok === false && /1 sucursal/.test(suc.res.error), 'Una sola sucursal', suc.res);
  for (let i = 1; i <= 4; i++) {
    const r = await accion(ESQ, 'guardarEmpleado', [form({ name: `Emp ${i}`, email: `emp${i}@x.com`, password: 'clave12345', role: 'CAJERO', branchIds: sql(`select id from "Branch" where "tenantId"='${esquina}'`) })], cEsq);
    if (r.res.ok !== true) ok(false, `Alta del empleado ${i}`, r.res);
  }
  const sexto = await accion(ESQ, 'guardarEmpleado', [form({ name: 'Emp 5', email: 'emp5@x.com', password: 'clave12345', role: 'CAJERO', branchIds: sql(`select id from "Branch" where "tenantId"='${esquina}'`) })], cEsq);
  ok(sexto.res.ok === false && /5 usuarios/.test(sexto.res.error), 'Con 5 usuarios activos, el sexto no entra', sexto.res);
}

console.log('\n4. Funciones extra y límites a mano, desde la ficha');
const datosEsq = (extra) => ({
  name: 'La Esquina', planId: basico, maxBranches: '', maxUsers: '', extraFeatures: [], price: '', paidUntil: '', trialUntil: dia(14), autoSuspend: true,
  contactName: 'Rosa', contactEmail: 'dueno@laesquina.com', contactPhone: '', notes: '', customDomain: '', ...extra,
});
{
  const r = await accion(PLAT, 'guardarCliente', [esquina, datosEsq({ extraFeatures: ['salon', 'pago_online'], maxUsers: '10' })], cPlat);
  ok(r.res.ok === true, 'Se le suma Salón y Pago online, y 10 usuarios', r.res);
  ok((await pagina(ESQ + '/admin/salon', cEsq)).status === 200, 'Ahora el Salón abre');
  ok((await pagina(ESQ + '/la-esquina-centro')).html.includes('Reservar mesa'), 'Y la carta ofrece reservas');
  const sexto = await accion(ESQ, 'guardarEmpleado', [form({ name: 'Emp 5', email: 'emp5@x.com', password: 'clave12345', role: 'CAJERO', branchIds: sql(`select id from "Branch" where "tenantId"='${esquina}'`) })], cEsq);
  ok(sexto.res.ok === true, 'Y entra el sexto usuario');
  ok((await pagina(ESQ + '/admin/insumos', cEsq)).status === 307, 'Insumos sigue cerrado (no se sumó)');
}

console.log('\n5. Mercado Pago de cada local');
let cPep;
{
  cPep = (await login(PEP, 'super@pepperino.com', 'super1234')).cookie;
  const mal = await accion(PEP, 'guardarMercadoPago', [{ modo: 'real', token: 'APP_USR-inventado-0000000000000000000000' }], cPep);
  ok(mal.res.ok === false && /no aceptó/.test(mal.res.error), 'Un Access Token que Mercado Pago rechaza no se guarda', mal.res);
  const bien = await accion(PEP, 'guardarMercadoPago', [{ modo: 'real', token: TOKEN_PEP, secreto: '' }], cPep);
  ok(bien.res.ok === true && /PEPPERINO/.test(bien.res.aviso), 'Pepperino conecta su cuenta (se verifica contra Mercado Pago)', bien.res);
  const guardado = sql(`select "mpAccessToken" from "Tenant" where id='${pepperino}'`);
  ok(guardado.startsWith('v1:') && !guardado.includes('pepperino'), 'El token queda cifrado en la base');
  ok(!(await pagina(PEP + '/admin/config', cPep)).html.includes(TOKEN_PEP), 'Y no se vuelve a mostrar entero');
  ok((await accion(ESQ, 'guardarMercadoPago', [{ modo: 'real', token: TOKEN_ESQ }], cEsq)).res.ok === true, 'La Esquina conecta la suya');

  const p = await accion(PEP, 'crearPedido', [[{ productId: vino, quantity: 1, addonIds: [] }], {
    branchId: adrogue, type: 'TAKEAWAY', customerName: 'Paga online', customerPhone: '1144443333', paymentMethod: 'MERCADO_PAGO',
  }]);
  ok(p.res.ok === true && p.res.pagoUrl?.startsWith('https://mp.test/checkout/'), 'Un cliente paga online en Pepperino: va al checkout', p.res);
  const log = await (await fetch(MP + '/__test/log')).json();
  const pref = log.filter((x) => x.ruta === '/checkout/preferences').pop();
  ok(pref?.token === TOKEN_PEP, 'La preferencia se crea con la cuenta de Pepperino, no con otra');
  ok(pref?.body?.notification_url === undefined || pref.body.notification_url.includes('pepperino'), 'Y avisa al dominio de Pepperino');
  const orden = sql(`select id from "Order" where code='${p.res.code}'`);
  const total = Number(sql(`select total from "Order" where id='${orden}'`)) / 100;

  // Un pago de Pepperino avisado al dominio de La Esquina: con la cuenta de La Esquina no existe
  await mp('/__test/pago', { id: 'PAG1', token: TOKEN_PEP, status: 'approved', external_reference: orden, transaction_amount: total, currency_id: 'ARS' });
  await webhook(ESQ, '/api/mp/webhook', { type: 'payment', data: { id: 'PAG1' } });
  ok(sql(`select "paymentStatus" from "Order" where id='${orden}'`) === 'PENDIENTE', 'Avisado a otro local, no se aplica');
  // Un pago en la cuenta de La Esquina que dice ser de un pedido de Pepperino
  await mp('/__test/pago', { id: 'PAG2', token: TOKEN_ESQ, status: 'approved', external_reference: orden, transaction_amount: total, currency_id: 'ARS' });
  await webhook(ESQ, '/api/mp/webhook', { type: 'payment', data: { id: 'PAG2' } });
  ok(sql(`select "paymentStatus" from "Order" where id='${orden}'`) === 'PENDIENTE', 'Un pago de La Esquina no puede cobrar un pedido de Pepperino');
  await webhook(PEP, '/api/mp/webhook', { type: 'payment', data: { id: 'PAG1' } });
  ok(sql(`select "paymentStatus" || '|' || "mpPaymentId" from "Order" where id='${orden}'`) === 'COBRADO|PAG1', 'El aviso correcto, al dominio de Pepperino, lo cobra');
}

console.log('\n6. El abono: avisos, gracia, suspensión y pagos');
{
  ok((await accion(PLAT, 'guardarCliente', [esquina, datosEsq({ extraFeatures: ['salon', 'pago_online'], maxUsers: '10', price: '25.000', paidUntil: dia(3), trialUntil: '' })], cPlat)).res.ok === true, 'Precio $25.000 y vence en 3 días');
  const banner = (await pagina(ESQ + '/admin/pedidos', cEsq)).html;
  ok(banner.includes('Tu abono vence el') && banner.includes('href="/admin/abono"'), 'El dueño ve el aviso en su panel');
  const caja = (await login(ESQ, 'emp1@x.com', 'clave12345')).cookie;
  ok(!(await pagina(ESQ + '/admin/pedidos', caja)).html.includes('Tu abono vence'), 'La caja no lo ve');
  const rev = await accion(PLAT, 'revisarCobrosAhora', [], cPlat);
  ok(rev.res.ok === true && /1 avisos/.test(rev.res.aviso), 'La revisión anota el aviso', rev.res);
  await accion(PLAT, 'revisarCobrosAhora', [], cPlat);
  ok(sql(`select count(*) from "AuditLog" where "tenantId"='${esquina}' and action='aviso_vencimiento'`) === '1', 'Una sola vez por vencimiento');

  sql(`update "Tenant" set "paidUntil"=now() - interval '2 days' where id='${esquina}'`);
  await accion(PLAT, 'revisarCobrosAhora', [], cPlat);
  ok(sql(`select active from "Tenant" where id='${esquina}'`) === 't', 'Vencido hace 2 días: sigue andando (gracia)');
  ok((await pagina(ESQ + '/admin/pedidos', cEsq)).html.includes('el servicio se pausa'), 'Con el cartel de que se pausa');

  sql(`update "Tenant" set "paidUntil"=now() - interval '10 days' where id='${esquina}'`);
  await accion(PLAT, 'revisarCobrosAhora', [], cPlat);
  ok(sql(`select active::text || '|' || "suspendedKind" from "Tenant" where id='${esquina}'`) === 'false|PAGO', 'Vencido hace 10 días: se suspende por falta de pago');
  ok((await pagina(ESQ + '/la-esquina-centro')).html.includes('falta de pago'), 'La carta muestra el aviso');
  ok((await pagina(PEP + '/adrogue')).html.includes('Muzzarella'), 'Pepperino sigue andando');

  const pago = await accion(PLAT, 'registrarPagoManual', [esquina, { monto: '25.000', meses: '1', metodo: 'TRANSFERENCIA', referencia: 'OP 123' }], cPlat);
  ok(pago.res.ok === true, 'Se registra la transferencia', pago.res);
  ok(sql(`select active from "Tenant" where id='${esquina}'`) === 't', 'Y se reactiva sola');
  ok(sql(`select "paidUntil" > now() + interval '15 days' and "paidUntil" < now() + interval '25 days' from "Tenant" where id='${esquina}'`) === 't', 'El mes se cuenta desde el vencimiento anterior (mantiene el ciclo)');
  const pagoId = sql(`select id from "TenantPayment" where "tenantId"='${esquina}'`);
  ok((await accion(PLAT, 'anularPago', [pagoId, 'Cargado por error'], cPlat)).res.ok === true, 'Se anula un pago cargado por error');
  ok(sql(`select "paidUntil" < now() from "Tenant" where id='${esquina}'`) === 't', 'Y el vencimiento vuelve atrás');
  sql(`update "Tenant" set "autoSuspend"=false where id='${esquina}'`);
  await accion(PLAT, 'revisarCobrosAhora', [], cPlat);
  ok(sql(`select active from "Tenant" where id='${esquina}'`) === 't', 'A un cliente de confianza no se lo suspende solo');
  sql(`update "Tenant" set "autoSuspend"=true, "paidUntil"=now() + interval '1 day' where id='${esquina}'`);
}

console.log('\n7. El abono con Mercado Pago de la plataforma');
{
  const link = await accion(PLAT, 'linkPago', [esquina, 1], cPlat);
  ok(link.res.ok === true && link.res.url.startsWith('https://mp.test/checkout/'), 'Link de pago de un mes', link.res);
  const log = await (await fetch(MP + '/__test/log')).json();
  const pref = log.filter((x) => x.ruta === '/checkout/preferences').pop();
  ok(pref.token === TOKEN_PLAT && pref.body.items[0].unit_price === 25000, 'Con la cuenta de la plataforma, por $25.000');
  const ref = pref.body.external_reference;
  await mp('/__test/pago', { id: 'ABO1', token: TOKEN_PLAT, status: 'approved', external_reference: ref, transaction_amount: 25000, currency_id: 'ARS' });
  const antes = sql(`select "paidUntil" from "Tenant" where id='${esquina}'`);
  await webhook(PLAT, '/api/plataforma/mp/webhook', { type: 'payment', data: { id: 'ABO1' } });
  await webhook(PLAT, '/api/plataforma/mp/webhook', { type: 'payment', data: { id: 'ABO1' } });
  ok(sql(`select count(*) from "TenantPayment" where "mpPaymentId"='ABO1'`) === '1', 'El pago aprobado se registra solo, una vez aunque avise dos');
  ok(sql(`select "paidUntil" > '${antes}'::timestamp from "Tenant" where id='${esquina}'`) === 't', 'Y corre el vencimiento');
  await mp('/__test/pago', { id: 'ABO2', token: TOKEN_PLAT, status: 'approved', external_reference: `abono:${esquina}:6:x`, transaction_amount: 100, currency_id: 'ARS' });
  await webhook(PLAT, '/api/plataforma/mp/webhook', { type: 'payment', data: { id: 'ABO2' } });
  ok(sql(`select count(*) from "TenantPayment" where "mpPaymentId"='ABO2'`) === '0', 'Un pago por menos de lo que corresponde no se registra');
  ok((await webhook(ESQ, '/api/plataforma/mp/webhook', { type: 'payment', data: { id: 'ABO1' } })).status === 404, 'El webhook de la plataforma no existe en el dominio de un local');

  const sus = await accion(PLAT, 'linkSuscripcion', [esquina, 'rosa@mp.com'], cPlat);
  ok(sus.res.ok === true && sus.res.url.startsWith('https://mp.test/sub/'), 'Link de débito automático', sus.res);
  const pre = sql(`select "mpPreapprovalId" from "Tenant" where id='${esquina}'`);
  await mp('/__test/autorizado', { id: 'AUT1', token: TOKEN_PLAT, preapproval_id: pre, transaction_amount: 25000, currency_id: 'ARS', status: 'processed', payment: { id: 'PAYSUB1', status: 'approved' } });
  await webhook(PLAT, '/api/plataforma/mp/webhook', { type: 'subscription_authorized_payment', data: { id: 'AUT1' } });
  ok(sql(`select method || '|' || months from "TenantPayment" where "mpPaymentId"='PAYSUB1'`) === 'MERCADO_PAGO|1', 'Cada cobro del débito automático suma un mes');

  const abono = await pagina(ESQ + '/admin/abono', cEsq);
  ok(abono.status === 200 && abono.html.includes('Pagar con Mercado Pago') && abono.html.includes('Básico'), 'El dueño ve su abono y puede pagar');
  const paga = await accion(ESQ, 'pagarAbono', [3], cEsq);
  ok(paga.res.ok === true && paga.res.url.startsWith('https://mp.test/'), 'El dueño genera su link de 3 meses', paga.res);
  const ajeno = await accion(ESQ, 'pagarAbono', [1], (await login(ESQ, 'emp1@x.com', 'clave12345')).cookie);
  ok(ajeno.res?.ok !== true, 'Un empleado no');
}

console.log('\n8. Planes y bitácora');
{
  const r = await accion(PLAT, 'guardarPlan', [{ id: basico, name: 'Básico', price: '30.000', maxBranches: '1', maxUsers: '10', features: ['insumos'], active: true }], cPlat);
  ok(r.res.ok === true, 'Se edita el plan Básico: suma Insumos', r.res);
  ok((await pagina(ESQ + '/admin/insumos', cEsq)).status === 200, 'Y La Esquina ya tiene Insumos, al momento');
  ok((await pagina(PEP + '/admin/insumos', cPep)).status === 200, 'Pepperino (Cadena) no cambió');
  const b = (await pagina(PLAT + '/plataforma/bitacora', cPlat)).html;
  ok(b.includes('Alta de cliente') && b.includes('Registró un pago') && b.includes('Suspendió') && b.includes('Cambió credenciales'), 'La bitácora registra altas, pagos, suspensiones y credenciales');
  ok(sql(`select count(*) from "AuditLog" where "tenantId"='${pepperino}' and action='login'`) !== '0', 'Y los ingresos de cada local');
  ok(!sql(`select string_agg(detail, ' ') from "AuditLog"`).includes(TOKEN_PEP), 'Ningún token queda escrito en la bitácora');
  const lista = (await pagina(PLAT + '/plataforma', cPlat)).html;
  ok(lista.includes('La Esquina') && lista.includes('Ingreso mensual'), 'La lista muestra clientes e ingresos');
}

console.log(fallas ? `\n${fallas} FALLAS` : '\nTODO OK');
process.exit(fallas ? 1 : 0);
