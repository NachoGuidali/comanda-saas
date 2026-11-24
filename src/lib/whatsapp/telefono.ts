/**
 * Teléfonos para WhatsApp. Sin base de datos: lo usan también las pantallas.
 *
 * WhatsApp identifica a cada persona por su número internacional
 * (5491122334455@s.whatsapp.net). En Argentina los celulares llevan un 9
 * después del 54 y van sin el 0 de la característica ni el 15. Los clientes
 * escriben el teléfono como les sale ("011 15 2345-6789", "11 2345 6789"),
 * así que se normaliza antes de escribirles.
 */

export const SOLO_DIGITOS = (t: string | null | undefined) => (t ?? '').replace(/\D/g, '');

/** "11 15 2345-6789" → "5491123456789". Null si no parece un teléfono. */
export function normalizarTelefono(crudo: string | null | undefined): string | null {
  let d = SOLO_DIGITOS(crudo);
  if (d.startsWith('00')) d = d.slice(2);
  if (d.length < 8) return null;

  // Ya viene con el código de país
  if (d.startsWith('549') && d.length === 13) return d;
  if (d.startsWith('54') && d.length === 12) return `549${d.slice(2)}`;

  // Nacional: sin el 0 de larga distancia
  if (d.startsWith('0')) d = d.slice(1);
  // Con el 15 del celular después de la característica (de 2 a 4 cifras)
  if (d.length === 12) {
    for (const largo of [2, 3, 4]) {
      if (d.slice(largo, largo + 2) === '15') {
        d = d.slice(0, largo) + d.slice(largo + 2);
        break;
      }
    }
  }
  if (d.length === 10) return `549${d}`;
  // Otro país (ya con su código) o un formato raro: se usa tal cual
  return d.length >= 10 ? d : null;
}

/** Para buscar los pedidos de un chat: los últimos 8 dígitos no cambian con el 0, el 15 ni el 54 9. */
export function claveTelefono(t: string | null | undefined): string {
  return SOLO_DIGITOS(t).slice(-8);
}

export function jidDeTelefono(digitos: string): string {
  return `${digitos}@s.whatsapp.net`;
}

/** El teléfono de un identificador de WhatsApp, o vacío si no lo trae (identificador oculto @lid). */
export function telefonoDeJid(jid: string | null | undefined): string {
  const [usuario, servidor] = (jid ?? '').split('@');
  if (servidor !== 's.whatsapp.net') return '';
  return SOLO_DIGITOS(usuario.split(':')[0]);
}

/** Chats que no son de una persona: grupos, estados, canales, listas de difusión. */
export function esChatDePersona(jid: string): boolean {
  return /@(s\.whatsapp\.net|lid)$/.test(jid);
}

/**
 * "5491122334455" → "+54 9 1122334455" (para mostrar). La característica
 * puede ser de 2 a 4 cifras y desde el número no se sabe cuál es, así que el
 * resto va junto.
 */
export function mostrarTelefono(digitos: string): string {
  if (!digitos) return '';
  if (digitos.startsWith('549') && digitos.length === 13) return `+54 9 ${digitos.slice(3)}`;
  return `+${digitos}`;
}
