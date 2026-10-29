/**
 * Todo lo que habla con la impresora: arma el ticket en ESC/POS, lo manda por
 * red o por USB y busca las impresoras disponibles para la pantalla de
 * configuración.
 */

const net = require('net');
const os = require('os');
const { execFile } = require('child_process');
const { writeFileSync, unlinkSync, readFileSync } = require('fs');
const { join } = require('path');

// Comandos ESC/POS
const ESC = '\x1B';
const GS = '\x1D';
const INICIALIZAR = ESC + '@';
const CORTAR = GS + 'V' + '\x42' + '\x00';
const ABRIR_CAJON = ESC + 'p' + '\x00' + '\x19' + '\xFA';
const CODIFICAR_LATIN = ESC + 't' + '\x10'; // página de códigos con acentos (WPC1252)

// El servidor marca el tamaño de letra con bytes de control (ver
// src/lib/comanda.ts): STX doble alto, EOT doble alto y ancho, ETX normal
const LETRA_GRANDE = ESC + '!' + '\x10';
const LETRA_ENORME = ESC + '!' + '\x30';
const LETRA_NORMAL = ESC + '!' + '\x00';

/** Arma el buffer final que entiende la impresora. */
function construirTicket(texto, abrirCajon) {
  let salida = INICIALIZAR + CODIFICAR_LATIN;
  salida += texto.replace(/\x02/g, LETRA_GRANDE).replace(/\x04/g, LETRA_ENORME).replace(/\x03/g, LETRA_NORMAL) + '\n\n\n';
  salida += CORTAR;
  if (abrirCajon) salida += ABRIR_CAJON;
  return Buffer.from(salida, 'latin1');
}

/** Impresora conectada a la red por su IP, en el puerto 9100. */
function imprimirPorRed(buffer, ip, puerto = 9100) {
  return new Promise((resolve, reject) => {
    const socket = new net.Socket();
    let terminado = false;
    const fin = (err) => {
      if (terminado) return;
      terminado = true;
      socket.destroy();
      err ? reject(err) : resolve();
    };

    socket.setTimeout(8000);
    socket.connect(puerto, ip, () => {
      socket.write(buffer, (err) => (err ? fin(err) : socket.end()));
    });
    socket.on('close', (conError) => fin(conError ? new Error('La conexión con la impresora se cortó') : null));
    socket.on('timeout', () => fin(new Error(`La impresora (${ip}) no responde`)));
    socket.on('error', (e) => fin(new Error(e.code === 'ECONNREFUSED' || e.code === 'EHOSTUNREACH' || e.code === 'ETIMEDOUT'
      ? `La impresora (${ip}) no responde: ¿está prendida y conectada al router?`
      : e.message)));
  });
}

/** ¿Responde algo en esa IP y puerto? Sin imprimir nada. */
function responde(ip, puerto = 9100, espera = 600) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    const fin = (ok) => { socket.destroy(); resolve(ok); };
    socket.setTimeout(espera);
    socket.once('connect', () => fin(true));
    socket.once('timeout', () => fin(false));
    socket.once('error', () => fin(false));
    socket.connect(puerto, ip);
  });
}

// ─────────── Windows: impresoras instaladas ───────────

/**
 * Windows no tiene un comando para mandar bytes crudos a una impresora USB
 * ("print" los pasa por el driver y la térmica imprime basura o nada). Esto
 * usa la API del administrador de impresión con el tipo de datos RAW, que es
 * lo que hacen los sistemas de punto de venta.
 */
const SCRIPT_RAW = String.raw`param([string]$Impresora, [string]$Archivo)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public class ImpresoraCruda {
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  public class DOCINFO {
    [MarshalAs(UnmanagedType.LPWStr)] public string pDocName;
    [MarshalAs(UnmanagedType.LPWStr)] public string pOutputFile;
    [MarshalAs(UnmanagedType.LPWStr)] public string pDataType;
  }
  [DllImport("winspool.drv", EntryPoint = "OpenPrinterW", SetLastError = true, CharSet = CharSet.Unicode)]
  public static extern bool OpenPrinter(string nombre, out IntPtr h, IntPtr d);
  [DllImport("winspool.drv", SetLastError = true)] public static extern bool ClosePrinter(IntPtr h);
  [DllImport("winspool.drv", EntryPoint = "StartDocPrinterW", SetLastError = true, CharSet = CharSet.Unicode)]
  public static extern bool StartDocPrinter(IntPtr h, int nivel, [In, MarshalAs(UnmanagedType.LPStruct)] DOCINFO di);
  [DllImport("winspool.drv", SetLastError = true)] public static extern bool EndDocPrinter(IntPtr h);
  [DllImport("winspool.drv", SetLastError = true)] public static extern bool StartPagePrinter(IntPtr h);
  [DllImport("winspool.drv", SetLastError = true)] public static extern bool EndPagePrinter(IntPtr h);
  [DllImport("winspool.drv", SetLastError = true)] public static extern bool WritePrinter(IntPtr h, byte[] b, int n, out int escritos);
  public static string Enviar(string nombre, byte[] datos) {
    IntPtr h;
    if (!OpenPrinter(nombre, out h, IntPtr.Zero)) return "No se encontró la impresora " + nombre;
    try {
      DOCINFO di = new DOCINFO(); di.pDocName = "Comanda"; di.pDataType = "RAW";
      if (!StartDocPrinter(h, 1, di)) return "La impresora no aceptó el trabajo (error " + Marshal.GetLastWin32Error() + ")";
      try {
        StartPagePrinter(h);
        int escritos;
        bool ok = WritePrinter(h, datos, datos.Length, out escritos);
        EndPagePrinter(h);
        if (!ok || escritos != datos.Length) return "No se pudo mandar el ticket (error " + Marshal.GetLastWin32Error() + ")";
      } finally { EndDocPrinter(h); }
    } finally { ClosePrinter(h); }
    return "";
  }
}
"@
$r = [ImpresoraCruda]::Enviar($Impresora, [IO.File]::ReadAllBytes($Archivo))
if ($r) { [Console]::Error.WriteLine($r); exit 1 }
`;

function powershell(args, espera = 30000) {
  return new Promise((resolve, reject) => {
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', ...args],
      { windowsHide: true, timeout: espera, maxBuffer: 4 * 1024 * 1024, encoding: 'utf8' },
      (error, stdout, stderr) => {
        if (error) reject(new Error((stderr || '').trim() || error.message));
        else resolve(stdout);
      });
  });
}

/** Impresora instalada en el sistema operativo (USB o compartida). */
function imprimirPorUsb(buffer, nombre, carpeta) {
  const archivo = join(os.tmpdir(), `comanda-${process.pid}-${Date.now()}.bin`);
  writeFileSync(archivo, buffer);
  const limpiar = () => { try { unlinkSync(archivo); } catch { /* el temporal se limpia solo */ } };

  if (process.platform === 'win32') {
    // Con BOM: si no, PowerShell 5 lee el archivo como ANSI y rompe los acentos
    const script = join(carpeta, 'imprimir-crudo.ps1');
    const contenido = '\ufeff' + SCRIPT_RAW;
    let actual = '';
    try { actual = readFileSync(script, 'utf8'); } catch { /* todavía no existe */ }
    if (actual !== contenido) writeFileSync(script, contenido, 'utf8');
    return powershell(['-File', script, '-Impresora', nombre, '-Archivo', archivo]).finally(limpiar);
  }
  return new Promise((resolve, reject) => {
    execFile('lp', ['-d', nombre, '-o', 'raw', archivo], (error, _o, stderr) => {
      limpiar();
      error ? reject(new Error((stderr || '').trim() || error.message)) : resolve();
    });
  });
}

/** Las que no son ticketeras: no tiene sentido ofrecerlas primero. */
const VIRTUALES = /pdf|xps|onenote|fax|anydesk|teamviewer|microsoft print|send to|enviar a/i;
const TICKETERA = /pos|80|58|term|therm|ticket|receipt|epson tm|tm-|xp-|gadnic|3nstar|hasar|bixolon|star|citizen|sewoo|rongta|xprinter|generic|text only|genérica/i;

/** Impresoras instaladas en esta PC, las ticketeras primero. */
async function impresorasInstaladas() {
  try {
    if (process.platform === 'win32') {
      const salida = await powershell(['-Command',
        '[Console]::OutputEncoding = [System.Text.Encoding]::UTF8; Get-CimInstance Win32_Printer | Select-Object Name,PortName,WorkOffline | ConvertTo-Json -Compress'], 20000);
      const datos = salida.trim() ? JSON.parse(salida) : [];
      return (Array.isArray(datos) ? datos : [datos])
        .filter((p) => p && p.Name)
        .map((p) => ({ nombre: p.Name, puerto: p.PortName || '', apagada: !!p.WorkOffline, virtual: VIRTUALES.test(p.Name) }))
        .sort((a, b) => Number(a.virtual) - Number(b.virtual) || Number(TICKETERA.test(b.nombre)) - Number(TICKETERA.test(a.nombre)));
    }
    const salida = await new Promise((resolve) => execFile('lpstat', ['-e'], (e, o) => resolve(e ? '' : o)));
    return salida.split('\n').map((n) => n.trim()).filter(Boolean).map((nombre) => ({ nombre, puerto: '', apagada: false, virtual: VIRTUALES.test(nombre) }));
  } catch {
    return [];
  }
}

/** Busca ticketeras de red: lo que tenga el puerto 9100 abierto en la red de esta PC. */
async function buscarEnLaRed() {
  const prefijos = new Set();
  for (const lista of Object.values(os.networkInterfaces())) {
    for (const i of lista || []) {
      if (i.family === 'IPv4' && !i.internal && !i.address.startsWith('169.254.')) prefijos.add(i.address.split('.').slice(0, 3).join('.'));
    }
  }
  const ips = [];
  for (const p of prefijos) for (let n = 1; n < 255; n++) ips.push(`${p}.${n}`);
  const encontradas = [];
  let siguiente = 0;
  async function trabajador() {
    while (siguiente < ips.length) {
      const ip = ips[siguiente++];
      if (await responde(ip, 9100, 700)) encontradas.push(ip);
    }
  }
  await Promise.all(Array.from({ length: 64 }, trabajador));
  return encontradas.sort((a, b) => Number(a.split('.')[3]) - Number(b.split('.')[3]));
}

/** El ticket de prueba de la pantalla de configuración. */
function ticketDePrueba(descripcion) {
  return [
    '\x04PRUEBA\x03',
    '',
    'Comanda Supreg',
    descripcion,
    require('./sistema').fecha(),
    '',
    'Si leés esto, la impresora anda.',
    'Los acentos: áéíóú ñ ¿?',
  ].join('\n');
}

module.exports = { construirTicket, imprimirPorRed, imprimirPorUsb, responde, impresorasInstaladas, buscarEnLaRed, ticketDePrueba };
