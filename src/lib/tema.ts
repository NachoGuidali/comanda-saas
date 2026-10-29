/**
 * La paleta de cada cliente. Se cargan tres colores (principal, acento y
 * fondo) y de ahí salen los tonos que usa todo el sistema, como variables CSS
 * que Tailwind lee (`bg-marca`, `text-rojo/40`...). Así cambiar la marca de un
 * cliente no toca el código: la carta, el panel y la cocina se pintan solos.
 *
 * Archivo sin base de datos: lo usan también las pantallas (vista previa).
 */

export type ColoresMarca = { principal: string; acento: string; fondo: string };

export const COLORES_DEFECTO: ColoresMarca = { principal: '#131313', acento: '#D0202B', fondo: '#FAF6F0' };

type RGB = [number, number, number];

export function hexValido(hex: string): boolean {
  return /^#[0-9a-fA-F]{6}$/.test(hex.trim());
}

function aRgb(hex: string): RGB {
  const h = hex.replace('#', '');
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)) as RGB;
}

function aHex([r, g, b]: RGB): string {
  return '#' + [r, g, b].map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('');
}

/** Mezcla `a` con `b`: t=0 es a, t=1 es b. */
function mezclar(a: RGB, b: RGB, t: number): RGB {
  return [0, 1, 2].map((i) => a[i] + (b[i] - a[i]) * t) as RGB;
}

const NEGRO: RGB = [0, 0, 0];
const BLANCO: RGB = [255, 255, 255];

/** Luminancia relativa (WCAG). */
export function luminancia(hex: string): number {
  return aRgb(hex)
    .map((v) => v / 255)
    .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4))
    .reduce((s, c, i) => s + c * [0.2126, 0.7152, 0.0722][i], 0);
}

/** Contraste WCAG entre dos colores: 1 a 21. 4.5 es lo mínimo para texto normal. */
export function contraste(a: string, b: string): number {
  const [x, y] = [luminancia(a), luminancia(b)].sort((m, n) => n - m);
  return (x + 0.05) / (y + 0.05);
}

/** Los tonos fijos: texto, peligro y confirmaciones. No dependen de la marca. */
const FIJOS = {
  carbon: '#171614',
  'carbon-700': '#2A2823',
  'carbon-500': '#4A463E',
  ladrillo: '#8E1219',
  'ladrillo-600': '#6D0D13',
  verde: '#2E6B4F',
  'verde-600': '#22543D',
};

/** Todos los tonos del sistema a partir de los tres colores de la marca. */
export function paleta(c: ColoresMarca): Record<string, string> {
  const principal = aRgb(hexValido(c.principal) ? c.principal : COLORES_DEFECTO.principal);
  const acento = aRgb(hexValido(c.acento) ? c.acento : COLORES_DEFECTO.acento);
  const fondo = aRgb(hexValido(c.fondo) ? c.fondo : COLORES_DEFECTO.fondo);
  const acentoHex = aHex(acento);
  // La letra sobre el acento: clara si alcanza el contraste, si no, oscura
  const sobreAcento = contraste(acentoHex, '#FFFFFF') >= 4.5 || contraste(acentoHex, '#FFFFFF') >= contraste(acentoHex, FIJOS.carbon)
    ? '#FFFFFF' : FIJOS.carbon;
  return {
    marca: aHex(principal),
    'marca-600': aHex(mezclar(principal, NEGRO, 0.25)),
    'marca-500': aHex(mezclar(principal, BLANCO, 0.12)),
    'marca-300': aHex(mezclar(principal, BLANCO, 0.4)),
    rojo: acentoHex,
    'rojo-600': aHex(mezclar(acento, NEGRO, 0.2)),
    'rojo-300': aHex(mezclar(acento, BLANCO, 0.3)),
    'sobre-rojo': sobreAcento,
    crema: aHex(fondo),
    // Un escalón más oscuro que el fondo, con un toque del color principal
    'crema-200': aHex(mezclar(mezclar(fondo, NEGRO, 0.04), principal, 0.04)),
    ...FIJOS,
  };
}

/** Las variables CSS ("--c-marca: 19 19 19;") para el <style> del layout. */
export function variablesCss(c: ColoresMarca): string {
  return Object.entries(paleta(c))
    .map(([k, hex]) => `--c-${k}:${aRgb(hex).join(' ')};`)
    .join('');
}

/** Problemas de legibilidad de una paleta, para avisar antes de guardarla. */
export function revisarColores(c: ColoresMarca): string | null {
  for (const [nombre, v] of [['principal', c.principal], ['de acento', c.acento], ['de fondo', c.fondo]] as const) {
    if (!hexValido(v)) return `El color ${nombre} tiene que ser del estilo #17320B`;
  }
  if (contraste(c.principal, c.fondo) < 4.5) {
    return 'El color principal y el fondo se parecen demasiado: la letra clara sobre el principal no se leería. Elegí un principal más oscuro o un fondo más claro.';
  }
  if (luminancia(c.fondo) < 0.6) return 'El fondo tiene que ser claro: los textos van en negro encima.';
  return null;
}
