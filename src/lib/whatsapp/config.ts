/**
 * Lo que cada local configura de su WhatsApp: los avisos automáticos del
 * pedido, el bot y las respuestas rápidas. Se guarda como JSON en
 * WhatsAppLine.config. Sin base de datos: lo usa también la pantalla.
 */

export type Aviso = { activo: boolean; texto: string };

export type ConfigWhatsApp = {
  avisos: {
    /** El local aceptó el pedido */
    aceptado: Aviso;
    /** Salió el repartidor */
    enCamino: Aviso;
    /** Listo para retirar (solo pedidos para retirar) */
    listo: Aviso;
    /** Rechazado o cancelado */
    rechazado: Aviso;
  };
  bot: {
    activo: boolean;
    /** Primer mensaje del día de un cliente, con el local abierto */
    saludo: string;
    /** Primer mensaje con el local cerrado */
    cerrado: string;
    /** Contestar "¿dónde está mi pedido?" con el estado real */
    estado: boolean;
    /** Cuando alguien del local contesta, el bot se calla en ese chat por estas horas */
    pausaHoras: number;
  };
  respuestas: { titulo: string; texto: string }[];
};

export const CONFIG_WHATSAPP_DEFECTO: ConfigWhatsApp = {
  avisos: {
    aceptado: { activo: true, texto: '¡Hola {nombre}! Recibimos tu pedido {codigo} y ya lo estamos preparando. Lo seguís acá: {link}' },
    enCamino: { activo: true, texto: '{nombre}, tu pedido {codigo} ya salió y va en camino 🛵' },
    listo: { activo: true, texto: '{nombre}, tu pedido {codigo} ya está listo para retirar en {local} ✅' },
    rechazado: { activo: false, texto: '{nombre}, no pudimos tomar tu pedido {codigo}. Escribinos por acá y lo vemos.' },
  },
  bot: {
    activo: false,
    saludo: '¡Hola! Gracias por escribir a {local} 🍕\nMirá la carta con los precios y hacé tu pedido acá: {carta}\nSi querés hablar con alguien del local, escribí "persona".',
    cerrado: '¡Hola! Ahora {local} está cerrado. Podés dejar tu pedido en {carta} y lo preparamos al abrir.',
    estado: true,
    pausaHoras: 6,
  },
  respuestas: [
    { titulo: 'Carta', texto: 'Acá tenés la carta con los precios: {carta}' },
    { titulo: 'Alias', texto: 'Podés transferir al alias {alias}. Mandanos el comprobante por acá 🙌' },
    { titulo: 'Demora', texto: 'Hoy estamos demorando entre {demora} minutos con los envíos.' },
  ],
};

/** Las variables que se pueden usar en los textos, para mostrarlas en la pantalla. */
export const VARIABLES: { id: string; ayuda: string; soloAvisos?: boolean }[] = [
  { id: 'local', ayuda: 'El nombre de la sucursal' },
  { id: 'carta', ayuda: 'El link a la carta' },
  { id: 'alias', ayuda: 'El alias para transferir' },
  { id: 'demora', ayuda: 'La demora de los envíos (Datos del local)' },
  { id: 'nombre', ayuda: 'El nombre del cliente', soloAvisos: true },
  { id: 'codigo', ayuda: 'El número del pedido', soloAvisos: true },
  { id: 'link', ayuda: 'El link para seguir el pedido', soloAvisos: true },
];

const texto = (v: unknown, max: number, defecto: string) => (typeof v === 'string' ? v.trim().slice(0, max) : defecto);
const bool = (v: unknown, defecto: boolean) => (typeof v === 'boolean' ? v : defecto);

function aviso(v: unknown, d: Aviso): Aviso {
  const o = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>;
  // Un texto vacío no sirve para nada: vuelve al de siempre
  return { activo: bool(o.activo, d.activo), texto: texto(o.texto, 600, d.texto) || d.texto };
}

/** Lee la configuración guardada (o lo que manda la pantalla), completando lo que falte. */
export function leerConfigWhatsApp(json: unknown): ConfigWhatsApp {
  let o: Record<string, unknown> = {};
  if (typeof json === 'string') {
    try { o = json ? JSON.parse(json) : {}; } catch { o = {}; }
  } else if (json && typeof json === 'object') {
    o = json as Record<string, unknown>;
  }
  const d = CONFIG_WHATSAPP_DEFECTO;
  const a = (o.avisos ?? {}) as Record<string, unknown>;
  const b = (o.bot ?? {}) as Record<string, unknown>;
  const horas = typeof b.pausaHoras === 'number' && Number.isFinite(b.pausaHoras) ? Math.round(b.pausaHoras) : d.bot.pausaHoras;
  const respuestas = Array.isArray(o.respuestas)
    ? o.respuestas
        .map((r) => (r && typeof r === 'object' ? r : {}) as Record<string, unknown>)
        .map((r) => ({ titulo: texto(r.titulo, 30, ''), texto: texto(r.texto, 1000, '') }))
        .filter((r) => r.titulo && r.texto)
        .slice(0, 20)
    : d.respuestas;
  return {
    avisos: {
      aceptado: aviso(a.aceptado, d.avisos.aceptado),
      enCamino: aviso(a.enCamino, d.avisos.enCamino),
      listo: aviso(a.listo, d.avisos.listo),
      rechazado: aviso(a.rechazado, d.avisos.rechazado),
    },
    bot: {
      activo: bool(b.activo, d.bot.activo),
      saludo: texto(b.saludo, 1000, d.bot.saludo) || d.bot.saludo,
      cerrado: texto(b.cerrado, 1000, d.bot.cerrado) || d.bot.cerrado,
      estado: bool(b.estado, d.bot.estado),
      pausaHoras: Math.min(48, Math.max(1, horas)),
    },
    respuestas,
  };
}

/**
 * Reemplaza {local}, {carta}... Una variable que no existe queda escrita tal
 * cual, así se nota el error de tipeo en la vista previa.
 */
export function rellenar(plantilla: string, valores: Record<string, string>): string {
  return plantilla
    .replace(/\{(\w+)\}/g, (todo, k: string) => (k in valores ? valores[k] : todo))
    .replace(/[ \t]+\n/g, '\n')
    .trim();
}
