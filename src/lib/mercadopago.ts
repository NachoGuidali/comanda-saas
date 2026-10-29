import { createHmac, timingSafeEqual } from 'crypto';

/**
 * Cliente mínimo de la API de Mercado Pago (Checkout Pro). Sin SDK: son pocas
 * llamadas HTTP y así no sumamos una dependencia.
 *
 * Cada local cobra en SU cuenta: las credenciales son del local (Configuración
 * → Cobro online), cifradas en la base. Tres modos por local:
 *
 *   real      Tiene Access Token. Con credenciales de prueba es el sandbox de
 *             Mercado Pago: pantalla real, tarjetas de prueba, plata de mentira.
 *   simulado  Una pantalla de pago propia con "Aprobar" y "Rechazar". Sirve
 *             para mostrar el circuito sin cuenta de Mercado Pago. Nunca en un
 *             local que atiende de verdad.
 *   apagado   La carta no ofrece pagar online.
 *
 * La plataforma tiene su propia cuenta (PLATAFORMA_MP_TOKEN) para cobrar los
 * abonos: ver credencialesPlataforma().
 */
export type ModoMP = 'real' | 'simulado' | 'apagado';

export type CredencialesMP = { modo: ModoMP; token: string | null; secreto: string | null };

export const SIN_MP: CredencialesMP = { modo: 'apagado', token: null, secreto: null };

export function modoMP(c: CredencialesMP): ModoMP {
  return c.modo;
}

/** La cuenta de la plataforma, para cobrar los abonos de los clientes. */
export function credencialesPlataforma(): CredencialesMP {
  const token = process.env.PLATAFORMA_MP_TOKEN || null;
  return { modo: token ? 'real' : 'apagado', token, secreto: process.env.PLATAFORMA_MP_WEBHOOK_SECRET || null };
}

/** Se puede apuntar a otro servidor solo para las pruebas automáticas. */
const API = () => (process.env.MP_API_URL || 'https://api.mercadopago.com').replace(/\/$/, '');

async function llamar<T>(c: CredencialesMP, metodo: 'GET' | 'POST' | 'PUT', ruta: string, cuerpo?: unknown, idempotencia?: string): Promise<T> {
  if (!c.token) throw new Error('Mercado Pago no está configurado');
  const r = await fetch(`${API()}${ruta}`, {
    method: metodo,
    headers: {
      Authorization: `Bearer ${c.token}`,
      'Content-Type': 'application/json',
      ...(idempotencia ? { 'X-Idempotency-Key': idempotencia } : {}),
    },
    body: cuerpo ? JSON.stringify(cuerpo) : undefined,
    signal: AbortSignal.timeout(15000),
    cache: 'no-store',
  });
  const texto = await r.text();
  if (!r.ok) throw new Error(`Mercado Pago respondió ${r.status}: ${texto.slice(0, 300)}`);
  return JSON.parse(texto) as T;
}

/** Comprueba un Access Token y devuelve de qué cuenta es. */
export async function verificarCuenta(token: string): Promise<{ id: string; nombre: string }> {
  const u = await llamar<{ id: number; nickname?: string; email?: string }>({ modo: 'real', token, secreto: null }, 'GET', '/users/me');
  return { id: String(u.id), nombre: u.nickname || u.email || String(u.id) };
}

export type PagoMP = {
  id: number | string;
  status: string; // approved, pending, in_process, rejected, cancelled, refunded, charged_back
  status_detail?: string;
  external_reference?: string;
  transaction_amount: number;
  currency_id: string;
};

export async function crearPreferencia(c: CredencialesMP, datos: {
  orderId: string;
  titulo: string;
  total: number; // centavos
  urlRetorno: string;
  urlWebhook: string | null;
  vence: Date;
}): Promise<string> {
  const https = datos.urlRetorno.startsWith('https://');
  const pref = await llamar<{ init_point: string; sandbox_init_point?: string }>(c, 'POST', '/checkout/preferences', {
    items: [{
      id: datos.orderId.slice(0, 250),
      title: datos.titulo,
      quantity: 1,
      unit_price: datos.total / 100,
      currency_id: 'ARS',
    }],
    external_reference: datos.orderId,
    back_urls: { success: datos.urlRetorno, failure: datos.urlRetorno, pending: datos.urlRetorno },
    // Mercado Pago solo vuelve solo al sitio si la dirección es https
    ...(https ? { auto_return: 'approved' } : {}),
    ...(datos.urlWebhook ? { notification_url: datos.urlWebhook } : {}),
    expires: true,
    expiration_date_to: datos.vence.toISOString(),
    // Sin pagos en efectivo (Rapipago, Pago Fácil): tardan días en acreditarse
    // y el pedido es para dentro de una hora
    payment_methods: { excluded_payment_types: [{ id: 'ticket' }, { id: 'atm' }] },
  });
  // Las credenciales viejas de prueba (TEST-...) usan el link de sandbox
  const deSandbox = c.token?.startsWith('TEST-');
  return (deSandbox && pref.sandbox_init_point) || pref.init_point;
}

export function obtenerPago(c: CredencialesMP, id: string): Promise<PagoMP> {
  return llamar<PagoMP>(c, 'GET', `/v1/payments/${encodeURIComponent(id)}`);
}

/** Por si el webhook no llegó: busca pagos hechos para este pedido. */
export async function buscarPagos(c: CredencialesMP, orderId: string): Promise<PagoMP[]> {
  const r = await llamar<{ results: PagoMP[] }>(
    c, 'GET',
    `/v1/payments/search?external_reference=${encodeURIComponent(orderId)}&sort=date_created&criteria=desc`
  );
  return r.results ?? [];
}

export function reembolsar(c: CredencialesMP, paymentId: string): Promise<unknown> {
  // La clave de idempotencia evita devolver dos veces si se reintenta
  return llamar(c, 'POST', `/v1/payments/${encodeURIComponent(paymentId)}/refunds`, {}, `refund-${paymentId}`);
}

/**
 * Valida la firma del webhook (encabezado x-signature) cuando la cuenta tiene
 * clave secreta cargada. Igual, nunca confiamos en lo que dice la
 * notificación: el pago se vuelve a consultar a la API antes de tocar nada.
 */
export function firmaWebhookValida(secreto: string | null, headers: Headers, dataId: string): boolean {
  if (!secreto) return true;
  const firma = headers.get('x-signature') ?? '';
  const partes = Object.fromEntries(firma.split(',').map((p) => p.trim().split('=') as [string, string]));
  if (!partes.ts || !partes.v1) return false;
  const manifiesto = `id:${dataId.toLowerCase()};request-id:${headers.get('x-request-id') ?? ''};ts:${partes.ts};`;
  const esperado = createHmac('sha256', secreto).update(manifiesto).digest('hex');
  const a = Buffer.from(esperado);
  const b = Buffer.from(partes.v1);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Firma para el link del pago simulado: nadie puede "pagar" un pedido ajeno. */
export function firmaSimulada(orderId: string): string {
  return createHmac('sha256', process.env.AUTH_SECRET || 'demo').update(`pago-demo:${orderId}`).digest('hex').slice(0, 32);
}

// ─────────── Abonos de la plataforma ───────────

export type Suscripcion = { id: string; init_point: string; status: string; external_reference?: string };

/**
 * Débito automático mensual (preapproval). El cliente autoriza su tarjeta en el
 * link y Mercado Pago le cobra todos los meses; cada cobro llega al webhook.
 * El email tiene que ser el de su cuenta de Mercado Pago.
 */
export function crearSuscripcion(c: CredencialesMP, datos: {
  motivo: string; email: string; montoMensual: number; referencia: string; urlRetorno: string;
}): Promise<Suscripcion> {
  return llamar<Suscripcion>(c, 'POST', '/preapproval', {
    reason: datos.motivo,
    payer_email: datos.email,
    external_reference: datos.referencia,
    back_url: datos.urlRetorno,
    status: 'pending',
    auto_recurring: { frequency: 1, frequency_type: 'months', transaction_amount: datos.montoMensual / 100, currency_id: 'ARS' },
  });
}

export function cancelarSuscripcion(c: CredencialesMP, id: string): Promise<unknown> {
  return llamar(c, 'PUT', `/preapproval/${encodeURIComponent(id)}`, { status: 'cancelled' });
}

/** Un cobro de una suscripción (lo que avisa el webhook "subscription_authorized_payment"). */
export type CobroSuscripcion = {
  id: number | string;
  preapproval_id: string;
  transaction_amount: number;
  currency_id: string;
  status: string;
  payment?: { id: number | string; status: string };
};

export function obtenerCobroSuscripcion(c: CredencialesMP, id: string): Promise<CobroSuscripcion> {
  return llamar<CobroSuscripcion>(c, 'GET', `/authorized_payments/${encodeURIComponent(id)}`);
}
