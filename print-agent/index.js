/**
 * Agente de impresión de Comanda Supreg.
 *
 * Corre en la PC del local, no en el servidor. Cada dos segundos le pregunta al
 * sistema si hay comandas pendientes y las manda a la impresora térmica.
 * Funciona así porque el navegador no puede hablar ESC/POS y porque la
 * impresora está en la red del local, no en el servidor. Si la impresora se
 * apaga o se corta internet, los tickets quedan en cola y salen cuando vuelve.
 *
 * Dos formas de configurarlo:
 *
 *   - Con código (lo normal): se abre el programa, aparece una pantalla en el
 *     navegador, se escribe el código que da el panel y se elige la impresora.
 *     Sin pantalla (Raspberry): node index.js --codigo ABCD-EFGH --ip 192.168.1.50
 *   - Con .env, como antes: SERVIDOR, PRINT_TOKEN, SUCURSAL... (ver .env.example)
 */

const http = require('http');
const os = require('os');
const { join, dirname } = require('path');
const { existsSync } = require('fs');
const impresion = require('./impresion');
const sistema = require('./sistema');
const { PANTALLA } = require('./pantalla');

const VERSION = '2.0.0';
const { log } = sistema;

// El .env va al lado del programa (o en la carpeta desde donde se corre)
const envJunto = join(sistema.EMPAQUETADO ? dirname(process.execPath) : __dirname, '.env');
require('dotenv').config({ path: existsSync(envJunto) ? envJunto : undefined });

const args = process.argv.slice(2);
const arg = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : undefined; };
const EN_FONDO = args.includes('--fondo');
const PUERTO_PANTALLA = Number(process.env.PUERTO_PANTALLA || 9123);
const SERVIDOR_POR_DEFECTO = (process.env.COMANDA_SERVIDOR || 'https://comandasupreg.com').replace(/\/$/, '');
const INTERVALO = Number(process.env.INTERVALO_MS || 2000);
// Si la impresora no responde, se espera cada vez más antes de reintentar,
// hasta este máximo. Apenas vuelve, se retoma el ritmo normal.
const ESPERA_MAXIMA = 30000;

// ─────────── Configuración ───────────

/** Configurado a mano con .env (instalaciones anteriores): no se toca desde la pantalla. */
const MANUAL = process.env.PRINT_TOKEN
  ? {
    manual: true,
    servidor: (process.env.SERVIDOR || 'http://localhost:3000').replace(/\/$/, ''),
    token: process.env.PRINT_TOKEN,
    sucursal: (process.env.SUCURSAL || '').trim(),
    estacionesManual: (process.env.ESTACIONES || '').trim(),
    abrirCajon: process.env.ABRIR_CAJON === 'true',
    nombre: 'Configurado con .env',
    impresora: {
      tipo: process.env.MODO === 'usb' ? 'usb' : process.env.MODO === 'archivo' ? 'archivo' : 'red',
      ip: process.env.IMPRESORA_IP || '192.168.1.100',
      puerto: Number(process.env.IMPRESORA_PUERTO || 9100),
      nombre: process.env.IMPRESORA_NOMBRE || 'POS-80',
    },
  }
  : null;

let config = MANUAL || sistema.leerConfig();

const estado = {
  conectado: null, // null: todavía no preguntó
  errorServidor: '',
  errorImpresora: '',
  desvinculada: false,
  impresas: 0,
  ultima: '',
};

function describir(imp) {
  if (!imp) return '';
  if (imp.tipo === 'red') return `Red ${imp.ip}${imp.puerto && imp.puerto !== 9100 ? `:${imp.puerto}` : ''}`;
  if (imp.tipo === 'usb') return imp.nombre;
  return 'Prueba en pantalla';
}

function imprimirCon(imp, texto, abrirCajon = false) {
  const buffer = impresion.construirTicket(texto, abrirCajon);
  if (imp.tipo === 'red') return impresion.imprimirPorRed(buffer, imp.ip, imp.puerto || 9100);
  if (imp.tipo === 'usb') return impresion.imprimirPorUsb(buffer, imp.nombre, sistema.CARPETA);
  console.log('\n──────────── COMANDA ────────────');
  console.log(texto.replace(/[\x02\x03\x04]/g, ''));
  console.log('─────────────────────────────────\n');
  return Promise.resolve();
}

// ─────────── La cola del servidor ───────────

function encabezados() {
  return {
    'x-print-token': config.token,
    'x-agente-version': VERSION,
    'x-agente-impresora': encodeURIComponent(describir(config.impresora)),
    'x-agente-estado': estado.errorImpresora ? encodeURIComponent(estado.errorImpresora.slice(0, 250)) : 'ok',
  };
}

async function pedirCola() {
  const params = new URLSearchParams();
  if (config.sucursal) params.set('sucursal', config.sucursal);
  if (config.estacionesManual) params.set('station', config.estacionesManual);
  const url = `${config.servidor}/api/print/cola${params.toString() ? `?${params}` : ''}`;
  const r = await fetch(url, { headers: encabezados(), signal: AbortSignal.timeout(10000) });
  if (r.status === 401) {
    const e = new Error('Esta PC ya no está vinculada: la impresora se quitó o se pasó a otra PC desde el panel.');
    e.desvinculada = true;
    throw e;
  }
  if (!r.ok) {
    const cuerpo = await r.json().catch(() => ({}));
    throw new Error(cuerpo.error || `El servidor respondió ${r.status}`);
  }
  const datos = await r.json();
  // Nombre, qué imprime y el cajón se cambian desde el panel
  if (datos.config && !config.manual) {
    const c = datos.config;
    if (c.nombre !== config.nombre || c.estaciones !== config.estaciones || c.abrirCajon !== config.abrirCajon) {
      config = { ...config, nombre: c.nombre, estaciones: c.estaciones, abrirCajon: c.abrirCajon };
      sistema.guardarConfig(config);
      log(`Cambios desde el panel: "${c.nombre}", imprime ${c.estaciones}${c.abrirCajon ? ', abre el cajón' : ''}`);
    }
  }
  return datos.jobs;
}

async function confirmar(id, ok, error) {
  const r = await fetch(`${config.servidor}/api/print/confirmar`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...encabezados() },
    body: JSON.stringify({ id, ok, error }),
    signal: AbortSignal.timeout(10000),
  });
  if (!r.ok) throw new Error(`El servidor respondió ${r.status}`);
}

/**
 * Comandas que ya salieron por la impresora pero el servidor todavía no se
 * enteró (se cortó internet justo después de imprimir). Se recuerdan para no
 * imprimirlas de nuevo en la próxima vuelta.
 */
const impresasSinAvisar = new Set();
let espera = INTERVALO;

async function ciclo() {
  if (!config || !config.token || !config.impresora || estado.desvinculada) return;

  for (const id of [...impresasSinAvisar]) {
    try {
      await confirmar(id, true);
      impresasSinAvisar.delete(id);
    } catch {
      return; // sin conexión: se reintenta en la próxima vuelta
    }
  }

  let jobs;
  try {
    jobs = await pedirCola();
    if (estado.conectado === false) log('Conexión con el servidor restablecida');
    estado.conectado = true;
    estado.errorServidor = '';
  } catch (e) {
    if (e.desvinculada) {
      estado.desvinculada = true;
      log(e.message);
    } else if (estado.conectado !== false) {
      log('Sin conexión con el servidor:', e.message);
    }
    estado.conectado = false;
    estado.errorServidor = e.message;
    return;
  }

  for (const job of jobs) {
    if (impresasSinAvisar.has(job.id)) continue;
    try {
      await imprimirCon(config.impresora, job.payload, job.station === 'caja' && config.abrirCajon);
    } catch (e) {
      if (estado.errorImpresora !== e.message) log(`No se pudo imprimir ${job.station} del pedido ${job.code}: ${e.message}`);
      estado.errorImpresora = e.message;
      // En USB el error puede ser del ticket; en red casi siempre es la
      // impresora apagada, y ahí no tiene sentido gastar intentos.
      if (config.impresora.tipo === 'usb') await confirmar(job.id, false, e.message).catch(() => {});
      espera = Math.min(ESPERA_MAXIMA, espera * 2);
      return; // se respeta el orden: no se imprime la siguiente antes que esta
    }

    if (estado.errorImpresora) log('La impresora volvió a andar');
    estado.errorImpresora = '';
    espera = INTERVALO;
    estado.impresas++;
    estado.ultima = new Date().toISOString();
    log(`Impreso ${job.station} del pedido ${job.code}`);
    try {
      await confirmar(job.id, true);
    } catch {
      impresasSinAvisar.add(job.id);
    }
  }
}

/**
 * Una vuelta termina antes de que empiece la siguiente. Con setInterval, si la
 * impresora tardaba más de dos segundos se pisaban dos vueltas y la misma
 * comanda salía dos veces.
 */
async function bucle() {
  try {
    await ciclo();
  } catch (e) {
    log('Error inesperado:', e.message);
  }
  setTimeout(bucle, estado.desvinculada ? 60000 : espera);
}

/**
 * Sin comandas no hay forma de saber si la impresora de red se apagó. Cada
 * minuto se le golpea la puerta (sin imprimir), así el panel muestra el
 * problema antes del primer pedido.
 */
setInterval(async () => {
  const imp = config && config.impresora;
  if (!imp || imp.tipo !== 'red' || estado.desvinculada) return;
  const ok = await impresion.responde(imp.ip, imp.puerto || 9100, 3000);
  if (!ok && !estado.errorImpresora) {
    estado.errorImpresora = `La impresora (${imp.ip}) no responde: ¿está prendida y conectada al router?`;
    log(estado.errorImpresora);
  } else if (ok && estado.errorImpresora.includes('no responde')) {
    estado.errorImpresora = '';
    log('La impresora volvió a responder');
  }
}, 60000).unref();

// ─────────── Vincular con el código del panel ───────────

async function vincular(codigo, servidor) {
  const base = String(servidor || SERVIDOR_POR_DEFECTO).trim().replace(/\/$/, '');
  let r;
  try {
    r = await fetch(`${base}/api/print/vincular`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ codigo, equipo: os.hostname() }),
      signal: AbortSignal.timeout(15000),
    });
  } catch {
    throw new Error('No hay conexión con el servidor. Revisá que esta PC tenga internet.');
  }
  const datos = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(datos.error || `El servidor respondió ${r.status}`);
  config = {
    servidor: base, token: datos.token, cliente: datos.cliente, sucursalNombre: datos.sucursal,
    nombre: datos.nombre, estaciones: datos.estaciones, abrirCajon: datos.abrirCajon,
    impresora: config && !config.manual ? config.impresora : null,
  };
  Object.assign(estado, { desvinculada: false, conectado: null, errorServidor: '', errorImpresora: '' });
  sistema.guardarConfig(config);
  log(`Vinculada: "${datos.nombre}" de ${datos.cliente} · ${datos.sucursal}`);
}

// ─────────── La pantalla (http://127.0.0.1:9123) ───────────

function responder(res, codigo, cuerpo) {
  res.writeHead(codigo, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(cuerpo));
}

function leerCuerpo(req) {
  return new Promise((resolve) => {
    let datos = '';
    req.on('data', (c) => { datos += c; if (datos.length > 10000) req.destroy(); });
    req.on('end', () => { try { resolve(JSON.parse(datos || '{}')); } catch { resolve({}); } });
  });
}

function impresoraValida(i) {
  if (!i || typeof i !== 'object') return null;
  if (i.tipo === 'red' && /^\d{1,3}(\.\d{1,3}){3}$/.test(String(i.ip || '').trim())) {
    return { tipo: 'red', ip: String(i.ip).trim(), puerto: Number(i.puerto) || 9100 };
  }
  if (i.tipo === 'usb' && String(i.nombre || '').trim()) return { tipo: 'usb', nombre: String(i.nombre).trim().slice(0, 200) };
  if (i.tipo === 'archivo') return { tipo: 'archivo' };
  return null;
}

function datosDeEstado() {
  return {
    version: VERSION,
    manual: !!(config && config.manual),
    vinculada: !!(config && config.token),
    config: config ? {
      cliente: config.cliente || '', sucursal: config.sucursalNombre || config.sucursal || '', nombre: config.nombre || '',
      estaciones: config.estacionesManual || config.estaciones || 'todo', abrirCajon: !!config.abrirCajon,
      impresora: config.impresora || null, descripcion: describir(config.impresora), servidor: config.servidor,
    } : null,
    estado,
    windows: sistema.WINDOWS,
    registro: sistema.ultimas.slice(-15),
    servidorPorDefecto: SERVIDOR_POR_DEFECTO,
  };
}

let reiniciando = false;

async function atender(req, res) {
  // Solo desde esta misma PC, y nada de páginas de internet mandando órdenes (DNS rebinding, CSRF)
  const host = String(req.headers.host || '');
  if (host !== `127.0.0.1:${PUERTO_PANTALLA}` && host !== `localhost:${PUERTO_PANTALLA}`) {
    res.writeHead(403); res.end(); return;
  }
  const url = new URL(req.url, `http://${host}`);
  if (req.method === 'GET' && url.pathname === '/') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(PANTALLA);
    return;
  }
  if (req.method === 'GET' && url.pathname === '/api/estado') return responder(res, 200, datosDeEstado());

  if (req.method !== 'POST' || req.headers['x-comanda'] !== '1') { res.writeHead(404); res.end(); return; }
  const cuerpo = await leerCuerpo(req);

  try {
    if (url.pathname === '/api/vincular') {
      if (config && config.manual) return responder(res, 400, { error: 'Esta PC está configurada con un archivo .env. Borralo para usar el código.' });
      await vincular(String(cuerpo.codigo || ''), cuerpo.servidor);
      return responder(res, 200, { ok: true });
    }
    if (url.pathname === '/api/impresoras') {
      const [instaladas, red] = await Promise.all([impresion.impresorasInstaladas(), impresion.buscarEnLaRed()]);
      return responder(res, 200, { instaladas, red });
    }
    if (url.pathname === '/api/probar') {
      const imp = impresoraValida(cuerpo.impresora);
      if (!imp) return responder(res, 400, { error: 'Elegí una impresora' });
      await imprimirCon(imp, impresion.ticketDePrueba(describir(imp)));
      log(`Prueba impresa en ${describir(imp)}`);
      return responder(res, 200, { ok: true });
    }
    if (url.pathname === '/api/impresora') {
      if (!config || !config.token || config.manual) return responder(res, 400, { error: 'Primero escribí el código' });
      const imp = impresoraValida(cuerpo.impresora);
      if (!imp) return responder(res, 400, { error: 'Elegí una impresora' });
      config = { ...config, impresora: imp };
      sistema.guardarConfig(config);
      estado.errorImpresora = '';
      log(`Impresora elegida: ${describir(imp)}`);
      const instalado = await sistema.instalarInicio().catch((e) => { log('No se pudo instalar el inicio automático:', e.message); return false; });
      // La primera vez corre en una ventana: se pasa a la copia instalada, sin ventana
      const pasar = instalado && !EN_FONDO;
      responder(res, 200, { ok: true, inicioAutomatico: instalado, reinicia: pasar });
      if (pasar) setTimeout(pasarAlFondo, 500);
      return;
    }
    if (url.pathname === '/api/desvincular') {
      if (config && config.manual) return responder(res, 400, { error: 'Esta PC está configurada con un archivo .env' });
      await sistema.quitarInicio();
      sistema.borrarConfig();
      config = null;
      Object.assign(estado, { desvinculada: false, conectado: null, errorServidor: '', errorImpresora: '' });
      log('Se desconectó esta PC');
      return responder(res, 200, { ok: true });
    }
  } catch (e) {
    return responder(res, 400, { error: e.message });
  }
  res.writeHead(404); res.end();
}

const pantalla = http.createServer((req, res) => {
  atender(req, res).catch((e) => { try { responder(res, 500, { error: e.message }); } catch { /* ya respondió */ } });
});

function pasarAlFondo() {
  if (reiniciando) return;
  reiniciando = true;
  log('Sigue andando en segundo plano. Ya podés cerrar esta ventana.');
  pantalla.close(() => {
    if (!sistema.arrancarEnFondo()) { reiniciando = false; return; }
    setTimeout(() => process.exit(0), 300);
  });
  // Por si el navegador deja la conexión abierta
  setTimeout(() => { pantalla.closeAllConnections?.(); }, 200);
}

const urlPantalla = `http://127.0.0.1:${PUERTO_PANTALLA}`;

pantalla.on('error', (e) => {
  if (e.code === 'EADDRINUSE') {
    // Ya está andando (seguramente en segundo plano): se muestra esa
    if (!EN_FONDO || args.includes('--abrir')) {
      console.log(`El programa ya está andando. Abriendo ${urlPantalla}`);
      sistema.abrirNavegador(urlPantalla);
    }
    setTimeout(() => process.exit(0), 500);
    return;
  }
  log('No se pudo abrir la pantalla:', e.message);
});

// ─────────── Arranque ───────────

async function arrancar() {
  // Sin pantalla: node index.js --codigo ABCD-EFGH --ip 192.168.1.50 (o --usb "POS-80", o --archivo)
  const codigo = arg('--codigo');
  if (codigo) {
    await vincular(codigo, arg('--servidor'));
    const imp = impresoraValida(arg('--ip') ? { tipo: 'red', ip: arg('--ip'), puerto: arg('--puerto') }
      : arg('--usb') ? { tipo: 'usb', nombre: arg('--usb') } : args.includes('--archivo') ? { tipo: 'archivo' } : null);
    if (imp) { config = { ...config, impresora: imp }; sistema.guardarConfig(config); }
    log(imp ? `Listo. Impresora: ${describir(imp)}` : 'Vinculada. Falta la impresora: --ip, --usb o --archivo');
  }

  // Ya configurado y abierto con doble clic: que siga sin ventana la copia instalada
  if (!EN_FONDO && !codigo && config && !config.manual && config.impresora && sistema.arrancarEnFondo()) {
    console.log('Comanda Supreg · impresión: sigue andando en segundo plano.');
    setTimeout(() => process.exit(0), 1500);
    return;
  }

  pantalla.listen(PUERTO_PANTALLA, '127.0.0.1', () => {
    log(`Comanda Supreg · impresión v${VERSION}. Pantalla: ${urlPantalla}`);
    if (config && config.token) {
      log(`Servidor: ${config.servidor}${config.sucursal ? ` · Sucursal: ${config.sucursal}` : ''} · Impresora: ${describir(config.impresora) || 'sin elegir'}`);
    }
    if (!EN_FONDO || args.includes('--abrir')) {
      if (!EN_FONDO) console.log('\nSe abre la pantalla en el navegador. No cierres esta ventana hasta terminar.\n');
      sistema.abrirNavegador(urlPantalla);
    }
  });
  bucle();
}

arrancar().catch((e) => {
  log('No se pudo arrancar:', e.message);
  process.exitCode = 1;
});
