/**
 * Lo que depende de la PC: dónde se guarda la configuración, el registro, abrir
 * el navegador y, en Windows, instalarse para arrancar solo y sin ventana.
 */

const os = require('os');
const { execFile, spawn } = require('child_process');
const { mkdirSync, readFileSync, writeFileSync, appendFileSync, statSync, renameSync, copyFileSync, existsSync, unlinkSync } = require('fs');
const { join } = require('path');

const WINDOWS = process.platform === 'win32';
/** Corre como .exe (empaquetado), no con "node index.js". */
const EMPAQUETADO = !!process.pkg;

const CARPETA = process.env.CARPETA_DATOS
  || (WINDOWS ? join(process.env.LOCALAPPDATA || join(os.homedir(), 'AppData', 'Local'), 'ComandaSupreg') : join(os.homedir(), '.comanda-supreg'));
mkdirSync(CARPETA, { recursive: true });

const ARCHIVO_CONFIG = join(CARPETA, 'config.json');
const ARCHIVO_REGISTRO = join(CARPETA, 'registro.log');
const EXE_INSTALADO = join(CARPETA, 'ComandaSupreg-Impresora.exe');
const VBS = join(CARPETA, 'iniciar.vbs');
const CLAVE_INICIO = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run';
const NOMBRE_INICIO = 'ComandaSupregImpresora';

function leerConfig() {
  try {
    return JSON.parse(readFileSync(ARCHIVO_CONFIG, 'utf8'));
  } catch {
    return null;
  }
}

function guardarConfig(c) {
  writeFileSync(`${ARCHIVO_CONFIG}.tmp`, JSON.stringify(c, null, 2));
  renameSync(`${ARCHIVO_CONFIG}.tmp`, ARCHIVO_CONFIG);
}

function borrarConfig() {
  try { unlinkSync(ARCHIVO_CONFIG); } catch { /* ya no estaba */ }
}

/** "24/10/2026 11:05:09". A mano: el .exe trae pocos idiomas y toLocaleString sale en inglés. */
function fecha(d = new Date()) {
  const dos = (n) => String(n).padStart(2, '0');
  return `${dos(d.getDate())}/${dos(d.getMonth() + 1)}/${d.getFullYear()} ${dos(d.getHours())}:${dos(d.getMinutes())}:${dos(d.getSeconds())}`;
}

/** Las últimas líneas quedan en memoria para la pantalla; todo va al archivo (hasta 1 MB). */
const ultimas = [];
function log(...partes) {
  const linea = `${fecha()}  ${partes.join(' ')}`;
  console.log(linea);
  ultimas.push(linea);
  if (ultimas.length > 40) ultimas.shift();
  try {
    if (existsSync(ARCHIVO_REGISTRO) && statSync(ARCHIVO_REGISTRO).size > 1024 * 1024) renameSync(ARCHIVO_REGISTRO, `${ARCHIVO_REGISTRO}.1`);
    appendFileSync(ARCHIVO_REGISTRO, linea + '\n');
  } catch { /* sin registro no se frena la impresión */ }
}

function abrirNavegador(url) {
  if (process.env.NO_ABRIR_NAVEGADOR) return; // pruebas automáticas
  if (WINDOWS) execFile('cmd.exe', ['/c', 'start', '', url], { windowsHide: true }, () => {});
  else execFile(process.platform === 'darwin' ? 'open' : 'xdg-open', [url], () => {});
}

/**
 * Windows: se copia a su carpeta (así no depende de que no borren Descargas) y
 * queda en el inicio de sesión del usuario, sin ventana. No pide permisos de
 * administrador.
 */
function instalarInicio() {
  if (!WINDOWS || !EMPAQUETADO) return Promise.resolve(false);
  if (process.execPath.toLowerCase() !== EXE_INSTALADO.toLowerCase()) {
    try {
      copyFileSync(process.execPath, EXE_INSTALADO);
    } catch (e) {
      // Si ya hay uno corriendo desde ahí, el archivo está en uso: se queda el que estaba
      if (!existsSync(EXE_INSTALADO)) throw e;
    }
  }
  // En UTF-16 con BOM: así wscript lee bien una carpeta de usuario con acentos (C:\Users\José)
  writeFileSync(VBS, '\ufeff' + [
    'Set s = CreateObject("WScript.Shell")',
    'extra = ""',
    'If WScript.Arguments.Count > 0 Then extra = " " & WScript.Arguments(0)',
    `s.Run """${EXE_INSTALADO}"" --fondo" & extra, 0, False`,
    '',
  ].join('\r\n'), 'utf16le');
  return new Promise((resolve) => {
    execFile('reg.exe', ['add', CLAVE_INICIO, '/v', NOMBRE_INICIO, '/t', 'REG_SZ', '/d', `wscript.exe "${VBS}"`, '/f'],
      { windowsHide: true }, (e) => resolve(!e));
  });
}

function quitarInicio() {
  if (!WINDOWS) return Promise.resolve();
  return new Promise((resolve) => {
    execFile('reg.exe', ['delete', CLAVE_INICIO, '/v', NOMBRE_INICIO, '/f'], { windowsHide: true }, () => resolve());
  });
}

/** Arranca la copia instalada, sin ventana, y abre la pantalla de estado. */
function arrancarEnFondo() {
  if (!WINDOWS || !EMPAQUETADO || !existsSync(VBS)) return false;
  spawn('wscript.exe', [VBS, '--abrir'], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
  return true;
}

module.exports = {
  WINDOWS, EMPAQUETADO, CARPETA, ARCHIVO_REGISTRO, fecha, leerConfig, guardarConfig, borrarConfig, log, ultimas,
  abrirNavegador, instalarInicio, quitarInicio, arrancarEnFondo,
};
