import type { Tenant } from '@prisma/client';
import { db } from './db';
import { money } from './money';

export type DatosSucursal = {
  id: string;
  name: string;
  slug: string;
  eslogan: string;
  address: string;
  phone: string;
  whatsapp: string;
  instagram: string;
  tiempoDelivery: string;
  tiempoTakeaway: string;
  aceptaPedidos: boolean;
  mensajeCerrado: string;
  aliasBancario: string;
  cbu: string;
  googleResenas: string;
  imprimirAuto: boolean;
  heroImageUrl: string | null;
};

/** Las sucursales de un cliente que se pueden elegir en la web. */
export async function sucursalesPublicas(tenantId: string) {
  return db.branch.findMany({
    where: { tenantId, active: true },
    orderBy: { position: 'asc' },
    select: {
      id: true, name: true, slug: true, address: true, eslogan: true,
      tiempoDelivery: true, heroImageUrl: true, whatsapp: true,
    },
  });
}

/** Una sucursal activa del cliente por su dirección: /adrogue */
export async function sucursalPorSlug(tenantId: string, slug: string) {
  return db.branch.findFirst({ where: { tenantId, slug, active: true } });
}

// ─────────── Marca del cliente ───────────

export type Marca = { nombre: string; eslogan: string; logoUrl: string };

/** La marca que se muestra en la carta y en el panel: la de cada cliente. */
export function marcaDe(t: Pick<Tenant, 'name' | 'slogan' | 'logoUrl'>): Marca {
  return { nombre: t.name, eslogan: t.slogan, logoUrl: t.logoUrl };
}

/** Ajustes de la plataforma (no de un cliente). */
export async function setAjuste(key: string, value: string) {
  await db.setting.upsert({ where: { key }, update: { value }, create: { key, value } });
}

// ─────────── Horarios ───────────

/** Si el local está abierto ahora, según los horarios cargados para esa sucursal. */
export async function estaAbierto(branchId: string, ahora = new Date()): Promise<boolean> {
  const hoy = await db.businessHour.findFirst({
    where: { branchId, dayOfWeek: ahora.getDay() },
  });
  if (!hoy || hoy.closed) return false;

  const minutos = ahora.getHours() * 60 + ahora.getMinutes();
  const [oh, om] = hoy.openTime.split(':').map(Number);
  const [ch, cm] = hoy.closeTime.split(':').map(Number);
  const abre = oh * 60 + om;
  let cierra = ch * 60 + cm;
  // Cierra pasada la medianoche
  if (cierra <= abre) cierra += 24 * 60;
  const m = minutos < abre ? minutos + 24 * 60 : minutos;
  return m >= abre && m <= cierra;
}

// ─────────── WhatsApp ───────────

type LineaPedido = {
  name: string;
  variantName?: string | null;
  quantity: number;
  total: number;
  notes?: string | null;
  addons?: { name: string; price: number }[];
};

type PedidoWhatsApp = {
  code: string;
  type: string;
  sucursal: string;
  customerName: string;
  customerPhone: string;
  address?: string | null;
  addressNotes?: string | null;
  items: LineaPedido[];
  subtotal: number;
  deliveryFee: number;
  discount: number;
  total: number;
  paymentMethod: string;
  cashAmount?: number | null;
  notes?: string | null;
};

const ETIQUETA_TIPO: Record<string, string> = {
  DELIVERY: 'Envío a domicilio',
  TAKEAWAY: 'Retira en el local',
  SALON: 'Para comer acá',
};

const ETIQUETA_PAGO: Record<string, string> = {
  EFECTIVO: 'Efectivo',
  TRANSFERENCIA: 'Transferencia',
  TARJETA_ENTREGA: 'Tarjeta al recibir',
  MERCADO_PAGO: 'Mercado Pago',
};

/** Arma el texto del pedido listo para abrir WhatsApp con todo cargado. */
export function mensajeWhatsApp(p: PedidoWhatsApp): string {
  const L: string[] = [];
  L.push(`*Pedido ${p.code}*`);
  L.push(`${p.sucursal} · ${ETIQUETA_TIPO[p.type] ?? p.type}`);
  L.push('');
  L.push(`*${p.customerName}* · ${p.customerPhone}`);
  if (p.address) L.push(`${p.address}${p.addressNotes ? ` (${p.addressNotes})` : ''}`);
  L.push('');

  for (const it of p.items) {
    L.push(`${it.quantity}x ${it.name}${it.variantName ? ` ${it.variantName}` : ''} — ${money(it.total)}`);
    for (const a of it.addons ?? []) L.push(`   + ${a.name}`);
    if (it.notes) L.push(`   Nota: ${it.notes}`);
  }

  L.push('');
  L.push(`Subtotal: ${money(p.subtotal)}`);
  if (p.deliveryFee > 0) L.push(`Envío: ${money(p.deliveryFee)}`);
  if (p.discount > 0) L.push(`Descuento: -${money(p.discount)}`);
  L.push(`*Total: ${money(p.total)}*`);
  L.push('');
  L.push(`Paga con: ${ETIQUETA_PAGO[p.paymentMethod] ?? p.paymentMethod}`);
  if (p.cashAmount) L.push(`Abona con ${money(p.cashAmount)} · vuelto ${money(p.cashAmount - p.total)}`);
  if (p.notes) L.push(`Aclaraciones: ${p.notes}`);

  return L.join('\n');
}

export function linkWhatsApp(numero: string, texto: string): string {
  return `https://wa.me/${numero.replace(/\D/g, '')}?text=${encodeURIComponent(texto)}`;
}
