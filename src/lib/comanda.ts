import { money } from './money';
import { fechaHora } from './tiempo';
import { nombreMesa } from './etiquetas';

/**
 * Cómo salen las comandas de cocina y los tickets de caja. Cada local lo
 * ajusta en Configuración → Impresión, con una vista previa que usa estas
 * mismas funciones. Sin base de datos: lo usa también la pantalla.
 *
 * El texto lleva marcadores de tamaño que el agente de impresión traduce a
 * ESC/POS (no se guarda el comando tal cual porque "letra normal" es ESC ! 0 y
 * Postgres no acepta el byte 0 en un texto):
 *
 *   \x02  doble alto     (siguen entrando las mismas letras por renglón)
 *   \x04  doble alto y ancho (entra la mitad: se corta el renglón antes)
 *   \x03  vuelve a normal
 */

/** El ancho del rollo. Cambia cuántas letras entran por renglón. */
export type Papel = '80' | '58';

/** Letras por renglón en la fuente normal (A) de cada rollo */
const LETRAS_POR_RENGLON: Record<Papel, number> = { '80': 42, '58': 32 };

export const anchoDe = (cfg: Pick<ConfigComanda, 'papel'>) => LETRAS_POR_RENGLON[cfg.papel];

export const GRANDE = '\x02';
export const ENORME = '\x04';
export const NORMAL = '\x03';

export type Letra = 'normal' | 'grande' | 'enorme';

export type ConfigComanda = {
  /** El mismo para cocina y caja: casi siempre es una sola impresora */
  papel: Papel;
  cocina: {
    /** Lo que va arriba de todo: "COCINA", "PARRILLA", "HORNO" */
    titulo: string;
    /** Tamaño de los productos */
    letra: Letra;
    copias: number;
    /** DELIVERY / RETIRA / MESA bien grande arriba */
    destacarTipo: boolean;
    hora: boolean;
    cliente: boolean;
    /** En los envíos, la dirección (para armar el paquete) */
    direccion: boolean;
    /** "TOTAL: 5 productos" al final */
    contarProductos: boolean;
    /** incluir: como un producto más · aparte: al final, en su sección · no: no salen en cocina */
    bebidas: 'incluir' | 'aparte' | 'no';
    /** "LLEVA BEBIDA" bien grande arriba, para no olvidarla al armar el pedido */
    avisarBebidas: boolean;
    /** Categorías que son bebidas. Vacío = las que se llaman "...bebida..." */
    categoriasBebida: string[];
  };
  caja: {
    /** siempre · delivery: solo los envíos (para el repartidor) · nunca */
    imprimir: 'siempre' | 'delivery' | 'nunca';
    copias: number;
    /** Encabezado. Vacío = el nombre del local */
    titulo: string;
    /** Lo que va al pie */
    pie: string;
    letraTotal: Letra;
    /** El alias para transferir, si el pedido se paga por transferencia */
    alias: boolean;
  };
};

export const CONFIG_DEFECTO: ConfigComanda = {
  papel: '80',
  cocina: {
    titulo: 'COCINA',
    letra: 'grande',
    copias: 1,
    destacarTipo: true,
    hora: true,
    cliente: false,
    direccion: false,
    contarProductos: false,
    bebidas: 'incluir',
    avisarBebidas: false,
    categoriasBebida: [],
  },
  caja: {
    imprimir: 'siempre',
    copias: 1,
    titulo: '',
    pie: 'Gracias por tu pedido',
    letraTotal: 'grande',
    alias: false,
  },
};

const LETRAS: Letra[] = ['normal', 'grande', 'enorme'];
const texto = (v: unknown, max: number, defecto: string) => (typeof v === 'string' ? limpio(v).slice(0, max) : defecto);
const bool = (v: unknown, defecto: boolean) => (typeof v === 'boolean' ? v : defecto);
const entre = (v: unknown, min: number, max: number, defecto: number) =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, Math.round(v))) : defecto;
const opcion = <T extends string>(v: unknown, validas: readonly T[], defecto: T): T => (validas.includes(v as T) ? (v as T) : defecto);

/** Lee la configuración guardada (o lo que mande la pantalla), completando lo que falte. */
export function leerConfig(json: unknown): ConfigComanda {
  let o: Record<string, unknown> = {};
  if (typeof json === 'string') {
    try { o = json ? JSON.parse(json) : {}; } catch { o = {}; }
  } else if (json && typeof json === 'object') {
    o = json as Record<string, unknown>;
  }
  const c = (o.cocina ?? {}) as Record<string, unknown>;
  const k = (o.caja ?? {}) as Record<string, unknown>;
  const d = CONFIG_DEFECTO;
  return {
    papel: opcion(o.papel, ['80', '58'] as const, d.papel),
    cocina: {
      titulo: texto(c.titulo, 30, d.cocina.titulo),
      letra: opcion(c.letra, LETRAS, d.cocina.letra),
      copias: entre(c.copias, 1, 3, d.cocina.copias),
      destacarTipo: bool(c.destacarTipo, d.cocina.destacarTipo),
      hora: bool(c.hora, d.cocina.hora),
      cliente: bool(c.cliente, d.cocina.cliente),
      direccion: bool(c.direccion, d.cocina.direccion),
      contarProductos: bool(c.contarProductos, d.cocina.contarProductos),
      bebidas: opcion(c.bebidas, ['incluir', 'aparte', 'no'] as const, d.cocina.bebidas),
      avisarBebidas: bool(c.avisarBebidas, d.cocina.avisarBebidas),
      categoriasBebida: Array.isArray(c.categoriasBebida) ? c.categoriasBebida.filter((x): x is string => typeof x === 'string').slice(0, 50) : [],
    },
    caja: {
      imprimir: opcion(k.imprimir, ['siempre', 'delivery', 'nunca'] as const, d.caja.imprimir),
      copias: entre(k.copias, 1, 3, d.caja.copias),
      titulo: texto(k.titulo, 42, d.caja.titulo),
      pie: texto(k.pie, 120, d.caja.pie),
      letraTotal: opcion(k.letraTotal, LETRAS, d.caja.letraTotal),
      alias: bool(k.alias, d.caja.alias),
    },
  };
}

// ─────────── Armado del texto ───────────

/** Saca caracteres de control de lo que escribió un cliente o un empleado. */
export function limpio(t: string | null | undefined): string {
  return (t ?? '').replace(/[\x00-\x09\x0B-\x1F\x7F]/g, ' ');
}

function linea(ancho: number, char = '-') {
  return char.repeat(ancho);
}

/** Centrado; si no entra en un renglón, se corta en varios, todos centrados. */
function centrar(t: string, ancho: number): string[] {
  return envolver(t, ancho).map((r) => ' '.repeat(Math.max(0, Math.floor((ancho - r.length) / 2))) + r);
}

/** Corta un texto en renglones de `ancho` letras, sin partir palabras si se puede. */
function envolver(t: string, ancho: number): string[] {
  const out: string[] = [];
  let actual = '';
  for (let p of t.split(/\s+/).filter(Boolean)) {
    if (!actual && p.length <= ancho) { actual = p; continue; }
    if (actual && actual.length + 1 + p.length <= ancho) { actual += ' ' + p; continue; }
    if (actual) out.push(actual);
    while (p.length > ancho) { out.push(p.slice(0, ancho)); p = p.slice(ancho); }
    actual = p;
  }
  if (actual) out.push(actual);
  return out.length ? out : [''];
}

/** Uno o más renglones en el tamaño pedido, cada uno con su marcador. */
function enLetra(t: string, letra: Letra, ancho: number, sangria = ''): string[] {
  const letras = letra === 'enorme' ? Math.floor(ancho / 2) : ancho;
  const s = letra === 'enorme' ? sangria.slice(0, 2) : sangria;
  const renglones = envolver(t, letras - s.length).map((r) => s + r);
  if (letra === 'normal') return renglones;
  return renglones.map((r) => `${letra === 'grande' ? GRANDE : ENORME}${r}${NORMAL}`);
}

/** Nombre a la izquierda, precio a la derecha, sin que se pisen. */
function fila(izq: string, der: string, ancho: number) {
  const espacio = ancho - der.length;
  const renglones = envolver(izq, espacio - 1);
  const ultimo = renglones.pop()!;
  return [...renglones, ultimo + ' '.repeat(Math.max(1, espacio - ultimo.length)) + der].join('\n');
}

const TIPO: Record<string, string> = {
  DELIVERY: 'DELIVERY',
  TAKEAWAY: 'RETIRA EN LOCAL',
  SALON: 'SALON',
};

const PAGO: Record<string, string> = {
  EFECTIVO: 'Efectivo',
  TRANSFERENCIA: 'Transferencia',
  TARJETA_ENTREGA: 'Tarjeta',
  MERCADO_PAGO: 'Mercado Pago',
};

export type PedidoImpresion = {
  code: string;
  type: string;
  createdAt: Date;
  customerName: string;
  customerPhone: string;
  address: string | null;
  addressNotes: string | null;
  notes: string | null;
  subtotal: number;
  deliveryFee: number;
  discount: number;
  total: number;
  paymentMethod: string;
  paymentStatus?: string;
  cashAmount: number | null;
  guests?: number | null;
  table?: { name: string } | null;
  items: {
    name: string;
    variantName: string | null;
    quantity: number;
    total: number;
    notes: string | null;
    /** Para saber si es bebida */
    categoryId?: string | null;
    categoryName?: string | null;
    addons: { name: string; price: number }[];
  }[];
};

function sanear(o: PedidoImpresion): PedidoImpresion {
  return {
    ...o,
    customerName: limpio(o.customerName),
    customerPhone: limpio(o.customerPhone),
    address: o.address && limpio(o.address),
    addressNotes: o.addressNotes && limpio(o.addressNotes),
    notes: o.notes && limpio(o.notes),
    table: o.table ? { name: limpio(o.table.name) } : o.table,
    items: o.items.map((it) => ({
      ...it,
      name: limpio(it.name),
      variantName: it.variantName && limpio(it.variantName),
      notes: it.notes && limpio(it.notes),
      addons: it.addons.map((a) => ({ ...a, name: limpio(a.name) })),
    })),
  };
}

export function esBebida(it: { categoryId?: string | null; categoryName?: string | null }, cfg: ConfigComanda): boolean {
  if (cfg.cocina.categoriasBebida.length) return !!it.categoryId && cfg.cocina.categoriasBebida.includes(it.categoryId);
  return /bebida/i.test(it.categoryName ?? '');
}

/**
 * Comanda de cocina: sin precios, solo lo que hay que preparar. Con
 * `agregado` es un adicional a un pedido en marcha (la segunda ronda de una
 * mesa): lleva un encabezado que lo deja claro. Null si no queda nada que
 * imprimir (por ejemplo, un agregado de solo bebidas que no van a cocina).
 */
export function comandaCocina(pedido: PedidoImpresion, local: string, cfg: ConfigComanda = CONFIG_DEFECTO, agregado = false): string | null {
  const o = sanear(pedido);
  const c = cfg.cocina;
  const bebidas = o.items.filter((it) => esBebida(it, cfg));
  const comida = c.bebidas === 'incluir' ? o.items : o.items.filter((it) => !esBebida(it, cfg));
  const aparte = c.bebidas === 'aparte' ? bebidas : [];
  if (comida.length + aparte.length === 0) return null;

  const A = anchoDe(cfg);
  const L: string[] = [];
  const titulo = (c.titulo || 'COCINA').toUpperCase();
  L.push(...centrar(agregado ? `*** ${titulo} - AGREGADO ***` : `*** ${titulo} ***`, A));
  L.push(...centrar(local, A));
  L.push(linea(A, '='));
  L.push(...enLetra(`PEDIDO ${o.code}`, 'grande', A));
  const tipo = `${TIPO[o.type] ?? o.type}${o.table ? ` - ${nombreMesa(o.table.name)}` : ''}`;
  if (c.destacarTipo) {
    L.push(...enLetra(o.type === 'DELIVERY' ? '>> ENVIO <<' : tipo, 'enorme', A));
    if (o.type === 'DELIVERY') L.push(...enLetra(tipo, 'normal', A));
  } else {
    L.push(...enLetra(tipo, 'grande', A));
  }
  if (o.type === 'SALON' && o.guests) L.push(`${o.guests} ${o.guests === 1 ? 'persona' : 'personas'}`);
  if (c.hora) L.push(fechaHora(agregado ? new Date() : o.createdAt, { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' }));
  if (c.cliente && o.customerName) L.push(...enLetra(`Cliente: ${o.customerName}`, 'normal', A));
  if (c.direccion && o.type === 'DELIVERY' && o.address) {
    L.push(...enLetra(o.address, 'normal', A));
    if (o.addressNotes) L.push(...enLetra(o.addressNotes, 'normal', A));
  }
  if (c.avisarBebidas && bebidas.length > 0) {
    L.push(linea(A));
    L.push(...enLetra('LLEVA BEBIDA', 'enorme', A));
  }
  L.push(linea(A, '='));

  const renglonItem = (it: PedidoImpresion['items'][number]) => {
    L.push('');
    L.push(...enLetra(`${it.quantity} x ${it.name.toUpperCase()}${it.variantName ? ` (${it.variantName})` : ''}`, c.letra, A));
    const chica: Letra = c.letra === 'enorme' ? 'grande' : c.letra;
    for (const a of it.addons) L.push(...enLetra(`+ ${a.name}`, chica, A, '    '));
    if (it.notes) L.push(...enLetra(`>> ${it.notes}`, chica, A, '    '));
  };
  comida.forEach(renglonItem);
  if (aparte.length) {
    L.push('');
    L.push(linea(A));
    L.push(...enLetra('BEBIDAS', c.letra === 'normal' ? 'grande' : c.letra, A));
    aparte.forEach(renglonItem);
  }

  if (o.notes && !agregado) {
    L.push('');
    L.push(linea(A));
    L.push(...enLetra(`NOTA: ${o.notes}`, c.letra === 'enorme' ? 'grande' : c.letra, A));
  }
  if (c.contarProductos) {
    const n = [...comida, ...aparte].reduce((s, it) => s + it.quantity, 0);
    L.push('');
    L.push(...enLetra(`TOTAL: ${n} ${n === 1 ? 'producto' : 'productos'}`, 'grande', A));
  }
  L.push('');
  L.push(linea(A, '='));
  return L.join('\n');
}

/** Ticket de caja o para el repartidor: con precios y datos de entrega. */
export function ticketCliente(
  pedido: PedidoImpresion,
  local: { nombre: string; direccion: string; alias?: string },
  cfg: ConfigComanda = CONFIG_DEFECTO
): string {
  const o = sanear(pedido);
  const k = cfg.caja;
  const A = anchoDe(cfg);
  const L: string[] = [];
  L.push(...centrar((k.titulo || local.nombre).toUpperCase(), A));
  L.push(...centrar(limpio(local.direccion), A));
  L.push(linea(A));
  L.push(...enLetra(`Pedido ${o.code}`, 'grande', A));
  L.push(fechaHora(o.createdAt, { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }));
  L.push(...envolver(`${TIPO[o.type] ?? o.type}${o.table ? ` - ${nombreMesa(o.table.name)}` : ''}`, A));
  L.push(linea(A));
  if (o.customerName) L.push(...envolver(o.customerName, A));
  if (o.customerPhone) L.push(o.customerPhone);
  if (o.address) {
    L.push(...envolver(o.address, A));
    if (o.addressNotes) L.push(...envolver(o.addressNotes, A));
  }
  L.push(linea(A));

  for (const it of o.items) {
    L.push(fila(`${it.quantity}x ${it.name}${it.variantName ? ` ${it.variantName}` : ''}`, money(it.total), A));
    for (const a of it.addons) L.push(...envolver(`+ ${a.name}`, A - 3).map((r) => `   ${r}`));
    if (it.notes) L.push(...envolver(it.notes, A - 3).map((r) => `   ${r}`));
  }

  L.push(linea(A));
  L.push(fila('Subtotal', money(o.subtotal), A));
  if (o.deliveryFee > 0) L.push(fila('Envio', money(o.deliveryFee), A));
  if (o.discount > 0) L.push(fila('Descuento', `-${money(o.discount)}`, A));
  if (k.letraTotal === 'enorme') L.push(...enLetra(`TOTAL ${money(o.total)}`, 'enorme', A));
  else if (k.letraTotal === 'grande') L.push(`${GRANDE}${fila('TOTAL', money(o.total), A)}${NORMAL}`);
  else L.push(fila('TOTAL', money(o.total), A));
  L.push(linea(A));
  L.push(...envolver(`Paga con: ${PAGO[o.paymentMethod] ?? o.paymentMethod}${o.paymentStatus === 'COBRADO' ? ' (COBRADO)' : ''}`, A));
  if (o.cashAmount && o.cashAmount >= o.total) {
    L.push(fila('Abona con', money(o.cashAmount), A));
    L.push(fila('VUELTO', money(o.cashAmount - o.total), A));
  }
  if (k.alias && o.paymentMethod === 'TRANSFERENCIA' && local.alias) L.push(...envolver(`Alias: ${limpio(local.alias)}`, A));
  if (o.notes) {
    L.push(linea(A));
    L.push(...envolver(o.notes, A));
  }
  if (k.pie) {
    L.push('');
    L.push(...centrar(k.pie, A));
  }
  L.push('');
  return L.join('\n');
}

/** Si este pedido lleva ticket de caja, según la configuración. */
export function llevaTicketCaja(tipo: string, cfg: ConfigComanda): boolean {
  return cfg.caja.imprimir === 'siempre' || (cfg.caja.imprimir === 'delivery' && tipo === 'DELIVERY');
}

/** Un pedido inventado para la vista previa de Configuración. */
/** `bebida` es la categoría de bebidas del local, para que se reconozca como tal. */
export function pedidoDeEjemplo(tipo: 'DELIVERY' | 'TAKEAWAY' | 'SALON', bebida: { id: string; name: string } | null): PedidoImpresion {
  return {
    code: 'A-1234',
    type: tipo,
    // Hora fija: la vista previa se arma en el servidor y en el navegador, y tienen que coincidir
    createdAt: new Date(new Date().setUTCHours(23, 15, 0, 0)),
    customerName: 'Laura Gómez',
    customerPhone: '11 5555-1234',
    address: tipo === 'DELIVERY' ? 'Av. Espora 1520, Adrogué' : null,
    addressNotes: tipo === 'DELIVERY' ? 'Timbre 2B' : null,
    notes: 'Sin aceitunas',
    subtotal: 3_390_000,
    deliveryFee: tipo === 'DELIVERY' ? 90_000 : 0,
    discount: 0,
    total: tipo === 'DELIVERY' ? 3_480_000 : 3_390_000,
    paymentMethod: 'EFECTIVO',
    cashAmount: 4_000_000,
    guests: tipo === 'SALON' ? 3 : null,
    table: tipo === 'SALON' ? { name: '11' } : null,
    items: [
      { name: 'Muzzarella', variantName: 'Grande', quantity: 2, total: 2_700_000, notes: null, categoryName: 'Pizzas', addons: [{ name: 'Doble muzzarella', price: 0 }] },
      { name: 'Empanada de carne', variantName: null, quantity: 3, total: 540_000, notes: 'Bien cocidas', categoryName: 'Empanadas', addons: [] },
      { name: 'Gaseosa', variantName: '1.5 L', quantity: 1, total: 150_000, notes: null, categoryId: bebida?.id ?? null, categoryName: bebida?.name ?? 'Bebidas', addons: [] },
    ],
  };
}
