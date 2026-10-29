'use server';

import { revalidatePath } from 'next/cache';
import bcrypt from 'bcryptjs';
import { db } from '@/lib/db';
import { crearSesionPlataforma, cerrarSesionPlataforma, exigirPlataforma } from '@/lib/plataforma';
import { getTenant } from '@/lib/tenant';
import { permitir, reiniciar, ipCliente } from '@/lib/limite';
import { auditar } from '@/lib/auditoria';
import { crearCliente } from '@/lib/clientes';
import { registrarPagoCliente, anularPagoCliente, revisarCobros } from '@/lib/cobros';
import { linkPagoAbono, linkSuscripcionAbono } from '@/lib/abono-mp';
import { IDS_FUNCION } from '@/lib/plan';
import { toCents } from '@/lib/money';

type R = { ok: true; aviso?: string } | { ok: false; error: string };
const METODOS = ['TRANSFERENCIA', 'EFECTIVO', 'MERCADO_PAGO', 'OTRO'];

function refrescar(id?: string) {
  revalidatePath('/plataforma');
  if (id) revalidatePath(`/plataforma/clientes/${id}`);
}

/** Fecha "2026-11-05" a medianoche del día (hora del servidor); vacío = null. */
function fecha(texto: string | null | undefined): Date | null | 'mal' {
  const t = String(texto ?? '').trim();
  if (!t) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(t)) return 'mal';
  const d = new Date(`${t}T23:59:59`);
  return isNaN(d.getTime()) ? 'mal' : d;
}

// ─────────── Ingreso ───────────

export async function ingresarPlataforma(fd: FormData) {
  if (await getTenant()) return { ok: false as const, error: 'Esta pantalla es solo del dominio de la plataforma' };
  const email = String(fd.get('email') || '').toLowerCase().trim();
  const password = String(fd.get('password') || '');
  const ip = await ipCliente();
  if (!permitir(`plataforma:${email}`, 5, 15 * 60_000) || !permitir(`plataforma-ip:${ip}`, 20, 15 * 60_000)) {
    return { ok: false as const, error: 'Demasiados intentos. Esperá 15 minutos.' };
  }
  const a = await db.platformAdmin.findUnique({ where: { email } });
  if (!a || !a.active || !(await bcrypt.compare(password, a.passwordHash))) {
    await auditar({ actorType: 'plataforma', actorName: email, action: 'login_fallido' });
    return { ok: false as const, error: 'Email o contraseña incorrectos' };
  }
  reiniciar(`plataforma:${email}`);
  await crearSesionPlataforma(a.id, a.tokenVersion);
  await auditar({ actorType: 'plataforma', actorId: a.id, actorName: a.name, action: 'login' });
  return { ok: true as const };
}

export async function salirPlataforma() {
  await cerrarSesionPlataforma();
  return { ok: true as const };
}

// ─────────── Clientes ───────────

export async function altaCliente(d: {
  slug: string; nombre: string; email: string; password: string; contactName?: string; contactPhone?: string;
  sucursal?: string; direccion?: string; whatsapp?: string; planId?: string; diasPrueba?: number;
  principal?: string; acento?: string; fondo?: string;
}): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const yo = await exigirPlataforma();
  const r = await crearCliente(d);
  if (!r.ok) return r;
  await auditar({ tenantId: r.id, actorType: 'plataforma', actorId: yo.id, actorName: yo.name, action: 'cliente_alta', detail: `${d.nombre} (${r.slug})` });
  refrescar();
  return { ok: true, id: r.id };
}

/** Datos comerciales del cliente: plan, límites, funciones extra, precio, vencimientos, contacto, dominio. */
export async function guardarCliente(id: string, d: {
  name: string; planId: string; maxBranches: string; maxUsers: string; extraFeatures: string[];
  price: string; paidUntil: string; trialUntil: string; autoSuspend: boolean;
  contactName: string; contactEmail: string; contactPhone: string; notes: string; customDomain: string;
}): Promise<R> {
  const yo = await exigirPlataforma();
  const t = await db.tenant.findUnique({ where: { id } });
  if (!t) return { ok: false, error: 'No existe el cliente' };
  const name = String(d.name ?? '').trim().slice(0, 60);
  if (!name) return { ok: false, error: 'Poné el nombre' };
  if (d.planId && !(await db.plan.findUnique({ where: { id: d.planId } }))) return { ok: false, error: 'Ese plan no existe' };
  const entero = (v: string) => (String(v ?? '').trim() === '' ? null : Math.floor(Number(v)));
  const maxBranches = entero(d.maxBranches);
  const maxUsers = entero(d.maxUsers);
  if ((maxBranches !== null && !(maxBranches >= 1 && maxBranches <= 100)) || (maxUsers !== null && !(maxUsers >= 0 && maxUsers <= 1000))) {
    return { ok: false, error: 'Revisá los límites' };
  }
  const price = String(d.price ?? '').trim() === '' ? null : toCents(d.price);
  if (price !== null && (price < 0 || price > 2_000_000_000)) return { ok: false, error: 'Revisá el precio' };
  const paidUntil = fecha(d.paidUntil);
  const trialUntil = fecha(d.trialUntil);
  if (paidUntil === 'mal' || trialUntil === 'mal') return { ok: false, error: 'Revisá las fechas' };
  const customDomain = String(d.customDomain ?? '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '') || null;
  if (customDomain && !/^[a-z0-9.-]+\.[a-z]{2,}$/.test(customDomain)) return { ok: false, error: 'El dominio propio no es válido' };
  if (customDomain && (await db.tenant.findFirst({ where: { customDomain, NOT: { id } } }))) return { ok: false, error: 'Ese dominio ya es de otro cliente' };

  await db.tenant.update({
    where: { id },
    data: {
      name, planId: d.planId || null, maxBranches, maxUsers,
      extraFeatures: (d.extraFeatures ?? []).filter((f) => IDS_FUNCION.includes(f)),
      price, paidUntil, trialUntil, autoSuspend: !!d.autoSuspend, customDomain,
      contactName: String(d.contactName ?? '').slice(0, 80), contactEmail: String(d.contactEmail ?? '').slice(0, 120),
      contactPhone: String(d.contactPhone ?? '').slice(0, 40), notes: String(d.notes ?? '').slice(0, 2000),
    },
  });
  await auditar({ tenantId: id, actorType: 'plataforma', actorId: yo.id, actorName: yo.name, action: 'cliente_cambio', detail: `Plan ${d.planId || 'sin plan'} · vence ${d.paidUntil || '-'}` });
  refrescar(id);
  revalidatePath('/', 'layout');
  return { ok: true };
}

export async function suspenderCliente(id: string, motivo: string): Promise<R> {
  const yo = await exigirPlataforma();
  const texto = String(motivo ?? '').trim().slice(0, 200);
  const r = await db.tenant.updateMany({
    where: { id },
    data: { active: false, suspendedKind: 'MANUAL', suspendedAt: new Date(), suspendedReason: texto || 'Este local no está tomando pedidos online por ahora.' },
  });
  if (r.count === 0) return { ok: false, error: 'No existe el cliente' };
  await auditar({ tenantId: id, actorType: 'plataforma', actorId: yo.id, actorName: yo.name, action: 'suspension', detail: texto || 'Manual' });
  refrescar(id);
  return { ok: true };
}

export async function reactivarCliente(id: string): Promise<R> {
  const yo = await exigirPlataforma();
  const r = await db.tenant.updateMany({ where: { id }, data: { active: true, suspendedKind: null, suspendedAt: null, suspendedReason: null } });
  if (r.count === 0) return { ok: false, error: 'No existe el cliente' };
  await auditar({ tenantId: id, actorType: 'plataforma', actorId: yo.id, actorName: yo.name, action: 'reactivacion' });
  refrescar(id);
  return { ok: true };
}

// ─────────── Cobros ───────────

export async function registrarPagoManual(id: string, d: { monto: string; meses: string; metodo: string; referencia: string }): Promise<R> {
  const yo = await exigirPlataforma();
  if (!METODOS.includes(d.metodo)) return { ok: false, error: 'Elegí el medio de pago' };
  const r = await registrarPagoCliente(id, {
    amount: toCents(d.monto), months: Math.floor(Number(d.meses)), method: d.metodo, reference: d.referencia, createdBy: yo.name,
  });
  if (!r.ok) return r;
  refrescar(id);
  revalidatePath('/plataforma/pagos');
  return { ok: true, aviso: `Pago registrado. Vence el ${r.hasta.toLocaleDateString('es-AR')}.` };
}

export async function anularPago(paymentId: string, motivo: string): Promise<R> {
  const yo = await exigirPlataforma();
  if (!String(motivo ?? '').trim()) return { ok: false, error: 'Contá por qué se anula' };
  const r = await anularPagoCliente(paymentId, motivo, yo.name);
  if (!r.ok) return r;
  refrescar();
  revalidatePath('/plataforma/pagos');
  return { ok: true };
}

export async function revisarCobrosAhora(): Promise<R> {
  await exigirPlataforma();
  const r = await revisarCobros();
  refrescar();
  return { ok: true, aviso: `Revisión hecha: ${r.avisados} avisos, ${r.suspendidos} suspendidos.` };
}

export async function linkPago(id: string, meses: number) {
  await exigirPlataforma();
  return linkPagoAbono(id, meses);
}

export async function linkSuscripcion(id: string, email: string) {
  await exigirPlataforma();
  const r = await linkSuscripcionAbono(id, email);
  refrescar(id);
  return r;
}

// ─────────── Planes ───────────

export async function guardarPlan(d: { id?: string; name: string; price: string; maxBranches: string; maxUsers: string; features: string[]; active: boolean }): Promise<R> {
  const yo = await exigirPlataforma();
  const name = String(d.name ?? '').trim().slice(0, 40);
  if (!name) return { ok: false, error: 'Poné el nombre del plan' };
  const price = toCents(d.price);
  const maxBranches = Math.floor(Number(d.maxBranches));
  const maxUsers = Math.floor(Number(d.maxUsers || 0));
  if (!(price >= 0) || !(maxBranches >= 1 && maxBranches <= 100) || !(maxUsers >= 0 && maxUsers <= 1000)) return { ok: false, error: 'Revisá precio y límites' };
  const repetido = await db.plan.findFirst({ where: { name, ...(d.id ? { NOT: { id: d.id } } : {}) } });
  if (repetido) return { ok: false, error: 'Ya hay un plan con ese nombre' };
  const data = { name, price, maxBranches, maxUsers, features: (d.features ?? []).filter((f) => IDS_FUNCION.includes(f)), active: !!d.active };
  if (d.id) await db.plan.update({ where: { id: d.id }, data });
  else await db.plan.create({ data: { ...data, position: await db.plan.count() } });
  await auditar({ actorType: 'plataforma', actorId: yo.id, actorName: yo.name, action: 'plan', detail: `${name}: ${(price / 100).toFixed(0)} · ${maxBranches} sucursales · ${data.features.join(', ') || 'sin extras'}` });
  revalidatePath('/plataforma/planes');
  revalidatePath('/', 'layout');
  return { ok: true };
}
