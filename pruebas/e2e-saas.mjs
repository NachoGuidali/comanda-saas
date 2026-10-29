// Cómo correrla (con el sistema compilado y andando en el puerto 3100):
//   1. Postgres de prueba en Docker con el nombre pz-test-db (usuario y base "pizzeria").
//   2. SAAS_DOMINIO=localhost, base limpia: prisma db push + seed + actualizar-permisos.
//   3. Segundo cliente: npx tsx prisma/crear-cliente.ts --slug laesquina --nombre "La Esquina"
//      --email super@pepperino.com --password otraclave123 --principal "#1E3A8A" --acento "#F59E0B"
//      --fondo "#F8FAFC" --sucursal "La Esquina Centro" --direccion "Mitre 100" --whatsapp 5491100000000
//   4. Desde la carpeta del proyecto: node pruebas/e2e-saas.mjs
// Corre sobre una base limpia: el antispam frena un segundo pedido del mismo teléfono.
// Prueba de punta a punta del modo multi-cliente: dos clientes (Pepperino y
// La Esquina) en la misma instalación, cada uno por su subdominio.
import { readFileSync, mkdirSync, writeFileSync } from 'fs';
import { execSync } from 'child_process';
import { createRequire } from 'module';
import { join } from 'path';

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
const sql = (q) => execSync(`docker exec pz-test-db psql -U pizzeria -tAc ${JSON.stringify(q)}`).toString().trim();

function parseRsc(text) {
  const uno = text.split('\n').find((l) => l.startsWith('1:'));
  if (uno) { try { return JSON.parse(uno.slice(2)); } catch { /* sigue */ } }
  return { raw: text.slice(0, 300) };
}
async function accion(base, nombre, args, cookie = '') {
  const headers = { 'Next-Action': ids[nombre], Accept: 'text/x-component', 'x-forwarded-for': `10.2.0.${ipN++}` };
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
const pagina = async (url, cookie = '') => {
  const r = await fetch(url, { headers: cookie ? { Cookie: cookie } : {}, redirect: 'manual' });
  return { status: r.status, location: r.headers.get('location') ?? '', html: (await r.text()).replace(/<!-- -->/g, '') };
};

const pepperino = sql("select id from \"Tenant\" where slug='pepperino'");
const esquina = sql("select id from \"Tenant\" where slug='laesquina'");
const adrogue = sql(`select id from "Branch" where slug='adrogue' and "tenantId"='${pepperino}'`);
const esquinaCentro = sql(`select id from "Branch" where "tenantId"='${esquina}'`);
const muzza = sql(`select id from "Product" where name='Muzzarella' and "branchId"='${adrogue}'`);
const muzzaGrande = sql(`select id from "Variant" where "productId"='${muzza}' and name='Grande'`);

console.log('\n1. Cada dominio muestra lo suyo');
{
  const plat = await pagina(PLAT + '/');
  ok(plat.status === 200 && plat.html.includes('Comanda Supreg') && plat.html.includes('Ingresar a mi local'), 'comandasupreg.com: la portada de la plataforma');
  const pep = await pagina(PEP + '/');
  ok(pep.status === 200 && pep.html.includes('Pepperino Pizza') && pep.html.includes('Pepperino Adrogué'), 'pepperino.: elige entre sus dos locales');
  const esq = await pagina(ESQ + '/');
  ok(esq.status === 307 && esq.location.endsWith('/la-esquina-centro'), 'laesquina.: con un solo local va directo a la carta', esq);
  ok((await pagina(PEP + '/adrogue')).html.includes('Muzzarella'), 'La carta de Pepperino, en su dominio');
  ok((await pagina(ESQ + '/adrogue')).status === 404, 'La sucursal de Pepperino no existe en La Esquina');
  ok((await pagina(PLAT + '/adrogue')).status === 404, 'Ni en el dominio de la plataforma');
  ok((await pagina(H('noexiste') + '/')).html.includes('Comanda Supreg') === false || (await pagina(H('noexiste') + '/adrogue')).status === 404, 'Un subdominio que no existe no muestra nada de nadie');
  const loginPlat = await pagina(PLAT + '/login');
  ok(loginPlat.html.includes('Ingresá a tu local'), 'En la plataforma, el ingreso pregunta a qué local');
  ok((await pagina(PEP + '/login')).html.includes('Pepperino Pizza'), 'El ingreso de Pepperino tiene su marca');
  const adm = await pagina(PEP + '/admin');
  ok(adm.status === 307 && adm.location.includes('/login'), '/admin sin sesión lleva al ingreso', adm.location);
}

console.log('\n2. Cada uno con sus colores');
{
  const pep = (await pagina(PEP + '/adrogue')).html;
  const esq = (await pagina(ESQ + '/la-esquina-centro')).html;
  ok(pep.includes('--c-marca:23 50 11;') && pep.includes('--c-rojo:175 10 10;'), 'Pepperino: verde #17320B y rojo #AF0A0A');
  ok(esq.includes('--c-marca:30 58 138;') && esq.includes('--c-rojo:245 158 11;'), 'La Esquina: azul y ámbar');
  ok(esq.includes('--c-sobre-rojo:23 22 20;'), 'Sobre el ámbar (claro) la letra va oscura, sola');
  ok(pep.includes('--c-sobre-rojo:255 255 255;'), 'Sobre el rojo, blanca');
  ok(pep.includes('<title>Pepperino Pizza · Pedí online</title>'), 'El título de la pestaña es el del local');
}

console.log('\n3. Usuarios de cada cliente');
let cPep, cEsq, cCajaPep;
{
  const a = await login(PEP, 'super@pepperino.com', 'super1234');
  ok(a.res.ok === true && a.cookie, 'El dueño de Pepperino entra en su dominio');
  cPep = a.cookie;
  const b = await login(ESQ, 'super@pepperino.com', 'super1234');
  ok(b.res.ok === false, 'Con la clave de Pepperino no entra a La Esquina', b.res);
  const c = await login(ESQ, 'super@pepperino.com', 'otraclave123');
  ok(c.res.ok === true, 'El mismo mail es otro usuario en La Esquina, con su clave');
  cEsq = c.cookie;
  const d = await login(PLAT, 'super@pepperino.com', 'super1234');
  ok(d.res.ok === false, 'En el dominio de la plataforma no entra nadie de un local');
  cCajaPep = (await login(PEP, 'caja@pepperino.com', 'caja1234')).cookie;
  ok((await login(ESQ, 'caja@pepperino.com', 'caja1234')).res.ok === false, 'La caja de Pepperino no existe en La Esquina');
}

console.log('\n4. Una sesión no cruza de cliente');
{
  const robada = await pagina(ESQ + '/admin/pedidos', cPep);
  ok(robada.status === 307 && robada.location.includes('/login'), 'La cookie de Pepperino no abre el panel de La Esquina', robada.status);
  ok((await pagina(PEP + '/admin/pedidos', cEsq)).status === 307, 'Ni al revés');
  const suc = (await pagina(ESQ + '/admin/sucursales', cEsq)).html;
  ok(suc.includes('La Esquina Centro') && !suc.includes('Adrogué') && !suc.includes('Burzaco'), 'El dueño de La Esquina ve solo su sucursal');
  const sucP = (await pagina(PEP + '/admin/sucursales', cPep)).html;
  ok(sucP.includes('Pepperino Adrogué') && !sucP.includes('La Esquina'), 'Y el de Pepperino, solo las suyas');
  const emp = (await pagina(ESQ + '/admin/empleados', cEsq)).html;
  ok(!emp.includes('caja@pepperino.com') && !emp.includes('Encargado Adrogué'), 'Empleados: solo los de su local');
  ok((await pagina(ESQ + '/admin/pedidos', cEsq)).html.includes('La Esquina'), 'El panel lleva el nombre del local');
}

console.log('\n5. Pedidos y datos por cliente');
let codigo;
{
  const r = await accion(PEP, 'crearPedido', [[{ productId: muzza, variantId: muzzaGrande, quantity: 1, addonIds: [] }], {
    branchId: adrogue, type: 'TAKEAWAY', customerName: 'Prueba Saas', customerPhone: '1155554444', paymentMethod: 'EFECTIVO',
  }]);
  ok(r.res.ok === true, 'Un cliente pide en la carta de Pepperino', r.res);
  codigo = r.res.code;
  ok((await pagina(PEP + '/pedido/' + codigo)).status === 200, 'Sigue su pedido en el dominio de Pepperino');
  ok((await pagina(ESQ + '/pedido/' + codigo)).status === 404, 'El código no existe en La Esquina');
  const cruzado = await accion(ESQ, 'crearPedido', [[{ productId: muzza, variantId: muzzaGrande, quantity: 1, addonIds: [] }], {
    branchId: adrogue, type: 'TAKEAWAY', customerName: 'Truco', customerPhone: '1155554444', paymentMethod: 'EFECTIVO',
  }]);
  ok(cruzado.res.ok === false, 'Desde el dominio de La Esquina no se puede pedir a una sucursal de Pepperino', cruzado.res);
  const res = await accion(ESQ, 'crearReserva', [(() => { const f = new FormData(); f.set('branchId', adrogue); f.set('customerName', 'X'); f.set('customerPhone', '1155554444'); f.set('date', '2030-01-10'); f.set('time', '21:00'); f.set('people', '2'); return f; })()]);
  ok(res.res.ok === false, 'Ni reservar en ella');
  const emp = await accion(ESQ, 'guardarEmpleado', [(() => { const f = new FormData(); f.set('name', 'Colado'); f.set('email', 'colado@x.com'); f.set('password', 'clave12345'); f.set('role', 'CAJERO'); f.set('branchIds', adrogue); return f; })()], cEsq);
  ok(emp.res.ok === false && sql("select count(*) from \"User\" where email='colado@x.com'") === '0', 'Un dueño no puede darle a su empleado una sucursal de otro cliente', emp.res);
  const copia = await accion(ESQ, 'copiarCarta', [adrogue], cEsq);
  ok(copia.res.ok === false, 'Ni copiarse la carta de otro cliente', copia.res);
  const tablero = (await pagina(ESQ + '/admin/pedidos', cEsq)).html;
  ok(!tablero.includes(codigo), 'El pedido de Pepperino no aparece en el tablero de La Esquina');
  ok((await pagina(PEP + '/admin/pedidos', cPep)).html.includes(codigo), 'Sí en el de Pepperino');
}

console.log('\n6. Impresora: un token por cliente');
{
  const t = await accion(PEP, 'generarTokenImpresora', [], cPep);
  ok(t.res.ok === true && t.res.token, 'Pepperino genera el token de su agente');
  const token = t.res.token;
  ok(sql(`select "printTokenHash" is not null and "printTokenHash" <> '${token}' from "Tenant" where id='${pepperino}'`) === 't', 'Se guarda solo el hash');
  const cola = await fetch(`${PEP}/api/print/cola?sucursal=adrogue`, { headers: { 'x-print-token': token } });
  ok(cola.status === 200, 'Con su token, el agente de Pepperino lee su cola', cola.status);
  const ajena = await fetch(`${ESQ}/api/print/cola`, { headers: { 'x-print-token': token } });
  ok(ajena.status === 401, 'El mismo token no sirve en La Esquina');
  const mala = await fetch(`${PEP}/api/print/cola?sucursal=adrogue`, { headers: { 'x-print-token': 'cualquiera' } });
  ok(mala.status === 401, 'Un token inventado tampoco');
}

console.log('\n7. Marca editable');
{
  const mal = await accion(ESQ, 'guardarMarca', [{ nombre: 'La Esquina', eslogan: '', logoUrl: '', principal: '#F8FAFC', acento: '#F59E0B', fondo: '#FFFFFF' }], cEsq);
  ok(mal.res.ok === false, 'Un principal claro sobre fondo claro no se guarda (no se leería)', mal.res);
  const bien = await accion(ESQ, 'guardarMarca', [{ nombre: 'La Esquina Pizzas', eslogan: 'La de siempre', logoUrl: '', principal: '#7C2D12', acento: '#16A34A', fondo: '#FFFBEB' }], cEsq);
  ok(bien.res.ok === true, 'El dueño cambia nombre y colores', bien.res);
  const html = (await pagina(ESQ + '/la-esquina-centro')).html;
  ok(html.includes('--c-marca:124 45 18;') && html.includes('La Esquina Pizzas'), 'La carta ya se ve con la marca nueva');
  ok((await pagina(PEP + '/adrogue')).html.includes('--c-marca:23 50 11;'), 'Pepperino no cambió');
  const caja = await accion(PEP, 'guardarMarca', [{ nombre: 'Hackeado', eslogan: '', logoUrl: '', principal: '#000000', acento: '#AF0A0A', fondo: '#FFFFFF' }], cCajaPep);
  ok(caja.res?.ok !== true && sql(`select name from "Tenant" where id='${pepperino}'`) === 'Pepperino Pizza', 'La caja no cambia la marca');
  ok((await pagina(PEP + '/admin/marca', cPep)).html.includes('Color principal'), 'La pantalla Marca abre para el dueño');
}

console.log('\n8. Fotos de cada cliente');
{
  const dir = join(process.cwd(), 'data', 'uploads', pepperino);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'prueba-saas.webp'), Buffer.from('RIFF0000WEBPVP8 '));
  ok((await fetch(`${PEP}/api/media/prueba-saas.webp`)).status === 200, 'La foto de Pepperino se ve en su dominio');
  ok((await fetch(`${ESQ}/api/media/prueba-saas.webp`)).status === 404, 'No desde La Esquina');
  ok((await fetch(`${PEP}/api/media/..%2F${esquina}%2Fx.webp`)).status === 404, 'Ni saltando de carpeta');
}

console.log('\n9. Cliente suspendido');
{
  sql(`update "Tenant" set active=false, "suspendedReason"='Pausado por falta de pago' where id='${esquina}'`);
  const html = (await pagina(ESQ + '/la-esquina-centro')).html;
  ok(html.includes('Pausado por falta de pago') && !html.includes('Buscar en la carta'), 'Muestra el aviso en vez de la carta');
  const panel = await pagina(ESQ + '/admin/pedidos', cEsq);
  ok(panel.html.includes('Pausado por falta de pago') && !panel.html.includes('Cargar pedido'), 'Su panel muestra el aviso, no los pedidos');
  ok((await login(ESQ, 'super@pepperino.com', 'otraclave123')).res.ok === false, 'Y no se puede ingresar');
  ok((await pagina(PEP + '/adrogue')).html.includes('Muzzarella'), 'Pepperino sigue andando');
  sql(`update "Tenant" set active=true, "suspendedReason"=null where id='${esquina}'`);
  ok((await pagina(ESQ + '/admin/pedidos', cEsq)).status === 200, 'Al reactivarlo, todo vuelve (la sesión sigue valiendo)');
}

console.log('\n10. El panel de Pepperino anda entero');
{
  const pantallas = ['pedidos', 'cocina', 'caja', 'mermas', 'salon', 'mesas', 'reservas', 'finanzas', 'gastos', 'gastos/sueldos', 'reportes',
    'productos', 'categorias', 'promociones', 'stock', 'insumos', 'empleados', 'roles', 'config', 'marca', 'sucursales'];
  const malas = [];
  for (const p of pantallas) {
    const r = await pagina(`${PEP}/admin/${p}`, cPep);
    if (r.status !== 200) malas.push(`${p}:${r.status}`);
  }
  ok(malas.length === 0, `Las ${pantallas.length} pantallas abren`, malas);
  ok((await pagina(`${PEP}/admin/pedidos`, cCajaPep)).status === 200, 'La caja entra a pedidos');
  ok((await pagina(`${PEP}/admin/marca`, cCajaPep)).status === 307, 'Pero no a Marca');
}

console.log('\n11. Los flujos de siempre, dentro de un cliente');
{
  const mesa = sql(`select id from "Table" where "branchId"='${adrogue}' and name='7'`);
  const cMozo = (await login(PEP, 'mozo@pepperino.com', 'mozo1234')).cookie;
  const cAdm = (await login(PEP, 'adrogue@pepperino.com', 'admin1234')).cookie;
  ok((await accion(PEP, 'abrirMesa', [mesa, 3], cMozo)).res.ok === true, 'La moza abre la mesa 7 con 3');
  const p = await accion(PEP, 'crearPedido', [[{ productId: muzza, variantId: muzzaGrande, quantity: 2, addonIds: [] }], {
    branchId: adrogue, type: 'SALON', customerName: '', customerPhone: '', tableId: mesa, paymentMethod: 'EFECTIVO', desdePanel: true,
  }], cMozo);
  ok(p.res.ok === true, 'Anota el pedido en la mesa', p.res);
  const id = sql(`select id from "Order" where code='${p.res.code}'`);
  ok(sql(`select count(*) from "PrintJob" where "orderId"='${id}' and station='cocina'`) === '1', 'Sale la comanda de cocina');
  ok((await accion(PEP, 'cambiarEstado', [id, 'LISTO'], cAdm)).res.ok === true, 'Cocina lo marca listo');
  ok((await accion(PEP, 'cerrarMesa', [mesa, 'TARJETA_ENTREGA'], cCajaPep)).res.ok === true, 'La caja cobra con tarjeta y libera la mesa');
  ok(sql(`select "paymentStatus" || '|' || status from "Order" where id='${id}'`) === 'COBRADO|ENTREGADO', 'Queda cobrado y entregado');
  const antes = Number(sql(`select stock from "Supply" where name='Muzzarella' and "branchId"='${adrogue}'`));
  ok(antes === 12000 - 800 * 1 - 400 * 0 || antes < 12000, 'Las muzzas descontaron muzzarella por receta', antes);
  const f = new FormData(); f.set('date', sql("select to_char(now() at time zone 'America/Argentina/Buenos_Aires','YYYY-MM-DD')")); f.set('category', 'MERCADERIA'); f.set('description', 'Compra de harina'); f.set('amount', '45.000'); f.set('payment', 'TRANSFERENCIA');
  ok((await accion(PEP, 'cargarGasto', [f], cCajaPep)).res.ok === true, 'La caja carga un gasto');
  ok((await pagina(PEP + '/admin/finanzas', cPep)).html.includes('45.000'), 'Y aparece en Finanzas');
  ok(!(await pagina(ESQ + '/admin/finanzas', cEsq)).html.includes('45.000'), 'No en las de La Esquina');
}

console.log(fallas ? `\n${fallas} FALLAS` : '\nTODO OK');
process.exit(fallas ? 1 : 0);
