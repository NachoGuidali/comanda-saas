// Mercado Pago de mentira para las pruebas: responde como la API real lo
// justo y necesario. Cada cuenta (token) ve solo sus pagos, como en la real.
// Se levanta en el puerto 3999 y el sistema apunta con MP_API_URL.
import http from 'http';

const CUENTAS = {
  'APP_USR-pepperino-00000000000000000000000000': { id: 111, nickname: 'PEPPERINO' },
  'APP_USR-esquina-000000000000000000000000000000': { id: 222, nickname: 'LAESQUINA' },
  'APP_USR-plataforma-00000000000000000000000000': { id: 999, nickname: 'SUPREG' },
};
const pagos = {};
const autorizados = {};
const log = [];
let n = 0;

http.createServer((req, res) => {
  let cuerpo = '';
  req.on('data', (d) => (cuerpo += d));
  req.on('end', () => {
    const url = new URL(req.url, 'http://x');
    const token = (req.headers.authorization || '').replace('Bearer ', '');
    const json = (status, data) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(data)); };
    const body = cuerpo ? JSON.parse(cuerpo) : {};
    if (url.pathname.startsWith('/__test/')) {
      if (url.pathname === '/__test/pago') { pagos[body.id] = body; return json(200, { ok: true }); }
      if (url.pathname === '/__test/autorizado') { autorizados[body.id] = body; return json(200, { ok: true }); }
      if (url.pathname === '/__test/log') return json(200, log);
      return json(404, {});
    }
    log.push({ metodo: req.method, ruta: url.pathname, token, body });
    if (!CUENTAS[token]) return json(401, { message: 'invalid access token' });
    if (url.pathname === '/users/me') return json(200, CUENTAS[token]);
    if (url.pathname === '/checkout/preferences' && req.method === 'POST') return json(201, { id: `PREF${++n}`, init_point: `https://mp.test/checkout/${n}?ref=${encodeURIComponent(body.external_reference)}` });
    if (url.pathname === '/v1/payments/search') return json(200, { results: Object.values(pagos).filter((p) => p.token === token && p.external_reference === url.searchParams.get('external_reference')) });
    const pago = url.pathname.match(/^\/v1\/payments\/([^/]+)$/);
    if (pago) {
      const p = pagos[decodeURIComponent(pago[1])];
      if (!p || p.token !== token) return json(404, { message: 'not found' });
      const { token: _t, ...publico } = p;
      return json(200, publico);
    }
    if (url.pathname === '/preapproval' && req.method === 'POST') return json(201, { id: `PRE${++n}`, init_point: `https://mp.test/sub/${n}`, status: 'pending', external_reference: body.external_reference });
    if (url.pathname.startsWith('/preapproval/') && req.method === 'PUT') return json(200, { status: 'cancelled' });
    const aut = url.pathname.match(/^\/authorized_payments\/([^/]+)$/);
    if (aut) {
      const a = autorizados[decodeURIComponent(aut[1])];
      if (!a || a.token !== token) return json(404, {});
      const { token: _t, ...publico } = a;
      return json(200, publico);
    }
    if (url.pathname.endsWith('/refunds')) return json(201, { id: `REF${++n}` });
    return json(404, { message: `sin simular: ${url.pathname}` });
  });
}).listen(3999, () => console.log('MP falso en 3999'));
