/**
 * Unidades de los insumos. Todo se guarda en milésimas como entero: gramos
 * para kg, mililitros para litros, milésimas para unidades. Archivo sin base
 * de datos: lo usan también las pantallas.
 */
export const UNIDADES = {
  KG: { label: 'kg', nombre: 'Kilos', chica: 'g', nombreChica: 'gramos' },
  L: { label: 'l', nombre: 'Litros', chica: 'ml', nombreChica: 'mililitros' },
  U: { label: 'u', nombre: 'Unidades', chica: 'u', nombreChica: 'unidades' },
} as const;

export type Unidad = keyof typeof UNIDADES;
export const IDS_UNIDAD = Object.keys(UNIDADES) as Unidad[];

/**
 * Lee un número como lo escribe la gente: "5", "2,5", "2.5", "1.000", "0.375".
 * La coma siempre es decimal. El punto es decimal salvo que lo sigan
 * exactamente tres dígitos y antes no haya un cero ("1.000" son mil).
 * Devuelve null si no es un número.
 */
export function leerNumero(texto: string): number | null {
  let t = texto.trim().replace(/\s+/g, '');
  if (!t) return null;
  if (t.includes(',')) {
    t = t.replace(/\./g, '').replace(',', '.');
  } else if (/^\d{1,3}(\.\d{3})+$/.test(t) && !/^0\./.test(t)) {
    t = t.replace(/\./g, '');
  }
  if (!/^\d*\.?\d+$/.test(t)) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

/**
 * Convierte lo escrito a milésimas. Acepta la unidad grande o la chica al
 * final: "5" o "5 kg" (kilos), "500 g", "2,5 l", "250 ml", "3" (unidades).
 * Sin sufijo, se toma la unidad que se indique (grande por defecto).
 */
export function aMilesimas(texto: string, unidad: Unidad, porDefecto: 'grande' | 'chica' = 'grande'): number | null {
  const t = texto.trim().toLowerCase();
  let escala: 'grande' | 'chica' = porDefecto;
  let numero = t;
  const sufijo = t.match(/\s*(kg|kgs|kilos?|g|gr|grs|gramos?|l|lt|lts|litros?|ml|cc|u|un|unidades?)$/);
  if (sufijo) {
    numero = t.slice(0, t.length - sufijo[0].length);
    const s = sufijo[1];
    if (/^(g|gr|grs|gramos?|ml|cc)$/.test(s)) escala = 'chica';
    else escala = 'grande';
    // Un sufijo que no corresponde a la unidad del insumo es un error claro
    const esPeso = /^(kg|kgs|kilos?|g|gr|grs|gramos?)$/.test(s);
    const esVolumen = /^(l|lt|lts|litros?|ml|cc)$/.test(s);
    if ((esPeso && unidad !== 'KG') || (esVolumen && unidad !== 'L')) return null;
  }
  const n = leerNumero(numero);
  if (n === null) return null;
  // Las unidades no tienen "chica": 3 unidades son 3 unidades
  const milesimas = unidad === 'U' ? n * 1000 : escala === 'chica' ? n : n * 1000;
  return Math.round(milesimas);
}

/** "5 kg", "400 g", "1,5 l", "250 ml", "12 u". Debajo de 1 kg o 1 l, en gramos o ml. */
export function mostrarCantidad(milesimas: number, unidad: Unidad): string {
  const u = UNIDADES[unidad] ?? UNIDADES.U;
  const signo = milesimas < 0 ? '−' : '';
  const abs = Math.abs(milesimas);
  const fmt = (n: number, dec: number) => n.toLocaleString('es-AR', { maximumFractionDigits: dec });
  if (unidad === 'U') return `${signo}${fmt(abs / 1000, 2)} u`;
  if (abs < 1000) return `${signo}${fmt(abs, 0)} ${u.chica}`;
  return `${signo}${fmt(abs / 1000, 3)} ${u.label}`;
}

/** Para las recetas: la cantidad en la unidad chica (gramos, ml) o en unidades. */
export function mostrarEnChica(milesimas: number, unidad: Unidad): string {
  if (unidad === 'U') return (milesimas / 1000).toLocaleString('es-AR', { maximumFractionDigits: 3 });
  return milesimas.toLocaleString('es-AR', { maximumFractionDigits: 0 });
}

export const TIPOS_MOVIMIENTO_INSUMO: Record<string, string> = {
  ENTRADA: 'Entró',
  CONSUMO: 'Venta',
  DEVOLUCION: 'Volvió (pedido cancelado)',
  AJUSTE: 'Conteo',
  MERMA: 'Pérdida',
};
