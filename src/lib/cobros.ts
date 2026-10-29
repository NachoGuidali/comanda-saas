import type { Plan, Tenant } from '@prisma/client';
import { db } from './db';
import { auditar } from './auditoria';
import { precioDe } from './plan';

/**
 * El abono de cada cliente: hasta cuándo está pago, los avisos antes de
 * vencer, los días de gracia y la suspensión por falta de pago.
 *
 *   Vence en SAAS_DIAS_AVISO días (5)    → cartel al dueño en su panel
 *   Vencido hace hasta SAAS_DIAS_GRACIA   → sigue andando, con cartel rojo
 *   Vencido hace más                      → se suspende (por falta de pago) y
 *                                           se reactiva solo al registrar el pago
 *   Prueba vencida sin pago               → igual que un vencido
 *
 * Con SAAS_SUSPENDER_VENCIDOS=false no se suspende a nadie automáticamente.
 * Por cliente se puede apagar la suspensión automática (clientes de confianza).
 */

const DIA = 24 * 60 * 60_000;
export const diasAviso = () => Number(process.env.SAAS_DIAS_AVISO ?? 5);
export const diasGracia = () => Number(process.env.SAAS_DIAS_GRACIA ?? 5);
const suspenderVencidos = () => process.env.SAAS_SUSPENDER_VENCIDOS !== 'false';

/** Suma meses a una fecha, sin pasarse de fin de mes (31/1 + 1 mes = 28/2). */
export function sumarMeses(fecha: Date, meses: number): Date {
  const d = new Date(fecha);
  const dia = d.getDate();
  d.setDate(1);
  d.setMonth(d.getMonth() + meses);
  const ultimo = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  d.setDate(Math.min(dia, ultimo));
  return d;
}

export type EstadoCobro =
  | { tipo: 'sin_vencimiento' }
  | { tipo: 'al_dia'; vence: Date; dias: number }
  | { tipo: 'por_vencer'; vence: Date; dias: number }
  | { tipo: 'en_gracia'; vence: Date; dias: number; hasta: Date }
  | { tipo: 'vencido'; vence: Date; dias: number }
  | { tipo: 'prueba'; vence: Date; dias: number };

/** En qué situación está el abono de un cliente. `dias` es cuántos faltan (negativo: hace cuántos venció). */
export function estadoCobro(t: Pick<Tenant, 'paidUntil' | 'trialUntil'>, ahora = new Date()): EstadoCobro {
  const enPrueba = !t.paidUntil && t.trialUntil;
  const vence = t.paidUntil ?? t.trialUntil;
  if (!vence) return { tipo: 'sin_vencimiento' };
  const dias = Math.ceil((vence.getTime() - ahora.getTime()) / DIA);
  if (dias >= 0) {
    if (enPrueba) return { tipo: 'prueba', vence, dias };
    return dias <= diasAviso() ? { tipo: 'por_vencer', vence, dias } : { tipo: 'al_dia', vence, dias };
  }
  const hasta = new Date(vence.getTime() + diasGracia() * DIA);
  if (ahora <= hasta) return { tipo: 'en_gracia', vence, dias, hasta };
  return { tipo: 'vencido', vence, dias };
}

/**
 * Registra un pago y corre el vencimiento. El período arranca en el
 * vencimiento anterior (así se mantiene el ciclo aunque pague unos días
 * tarde); si vuelve después de mucho tiempo, arranca hoy. Si estaba
 * suspendido por falta de pago, se reactiva. Un pago de Mercado Pago que llega
 * dos veces (webhook y vuelta) se registra una sola.
 */
export async function registrarPagoCliente(tenantId: string, datos: {
  amount: number; months: number; method: string; reference?: string; createdBy: string; mpPaymentId?: string;
}): Promise<{ ok: true; hasta: Date } | { ok: false; error: string }> {
  if (!Number.isInteger(datos.months) || datos.months < 1 || datos.months > 24) return { ok: false, error: 'Revisá los meses' };
  if (!Number.isInteger(datos.amount) || datos.amount < 0) return { ok: false, error: 'Revisá el monto' };
  if (datos.mpPaymentId && (await db.tenantPayment.findUnique({ where: { mpPaymentId: datos.mpPaymentId } }))) {
    const t = await db.tenant.findUniqueOrThrow({ where: { id: tenantId } });
    return { ok: true, hasta: t.paidUntil ?? new Date() };
  }

  const ahora = new Date();
  const r = await db.$transaction(async (tx) => {
    const t = await tx.tenant.findUniqueOrThrow({ where: { id: tenantId } });
    const anterior = t.paidUntil;
    // Hasta 30 días de atraso se mantiene el ciclo; más que eso, arranca hoy
    const base = anterior && anterior.getTime() > ahora.getTime() - 30 * DIA ? anterior : ahora;
    const hasta = sumarMeses(base, datos.months);
    await tx.tenantPayment.create({
      data: {
        tenantId, amount: datos.amount, months: datos.months, method: datos.method,
        reference: (datos.reference ?? '').slice(0, 120), fromDate: anterior, toDate: hasta,
        mpPaymentId: datos.mpPaymentId ?? null, createdBy: datos.createdBy.slice(0, 120),
      },
    });
    const reactivar = !t.active && t.suspendedKind === 'PAGO';
    await tx.tenant.update({
      where: { id: tenantId },
      data: {
        paidUntil: hasta,
        ...(reactivar ? { active: true, suspendedReason: null, suspendedKind: null, suspendedAt: null } : {}),
      },
    });
    return { hasta, reactivar };
  });
  await auditar({ tenantId, actorType: 'plataforma', actorName: datos.createdBy, action: 'pago', detail: `${datos.months} mes(es) por ${(datos.amount / 100).toFixed(2)} (${datos.method}) · vence ${r.hasta.toISOString().slice(0, 10)}` });
  if (r.reactivar) await auditar({ tenantId, actorType: 'sistema', action: 'reactivacion', detail: 'Pagó: se reactiva' });
  return { ok: true, hasta: r.hasta };
}

/** Anula un pago cargado por error: el vencimiento retrocede esos meses. */
export async function anularPagoCliente(paymentId: string, motivo: string, quien: string) {
  const p = await db.tenantPayment.findUnique({ where: { id: paymentId } });
  if (!p || p.voidedAt) return { ok: false as const, error: 'Ese pago no existe o ya está anulado' };
  await db.$transaction(async (tx) => {
    const t = await tx.tenant.findUniqueOrThrow({ where: { id: p.tenantId } });
    await tx.tenantPayment.update({ where: { id: p.id }, data: { voidedAt: new Date(), voidReason: motivo.slice(0, 200) } });
    if (t.paidUntil) await tx.tenant.update({ where: { id: t.id }, data: { paidUntil: sumarMeses(t.paidUntil, -p.months) } });
  });
  await auditar({ tenantId: p.tenantId, actorType: 'plataforma', actorName: quien, action: 'pago_anulado', detail: motivo });
  return { ok: true as const };
}

/**
 * La revisión diaria: avisos y suspensiones. Es idempotente (se puede correr
 * varias veces por día sin repetir avisos ni efectos).
 */
export async function revisarCobros(ahora = new Date()) {
  const clientes = await db.tenant.findMany({ where: { active: true, OR: [{ paidUntil: { not: null } }, { trialUntil: { not: null } }] } });
  const resumen = { avisados: 0, suspendidos: 0 };
  for (const t of clientes) {
    const e = estadoCobro(t, ahora);
    if (e.tipo === 'vencido' && t.autoSuspend && suspenderVencidos()) {
      await db.tenant.update({
        where: { id: t.id },
        data: {
          active: false, suspendedKind: 'PAGO', suspendedAt: ahora,
          suspendedReason: 'El servicio está pausado por falta de pago. Se reactiva al registrar el pago.',
        },
      });
      await auditar({ tenantId: t.id, actorType: 'sistema', action: 'suspension', detail: `Vencido el ${e.vence.toISOString().slice(0, 10)}` });
      resumen.suspendidos++;
      continue;
    }
    if ((e.tipo === 'por_vencer' || e.tipo === 'en_gracia' || (e.tipo === 'prueba' && e.dias <= diasAviso()))
      && t.notifiedFor?.getTime() !== e.vence.getTime()) {
      await db.tenant.update({ where: { id: t.id }, data: { notifiedFor: e.vence } });
      await auditar({ tenantId: t.id, actorType: 'sistema', action: 'aviso_vencimiento', detail: `Vence el ${e.vence.toISOString().slice(0, 10)}` });
      resumen.avisados++;
    }
  }
  return resumen;
}

/** Para listados: el estado, el precio y cuánto se cobró en el mes. */
export function resumenCliente(t: Tenant & { plan: Plan | null }, ahora = new Date()) {
  return { estado: estadoCobro(t, ahora), precio: precioDe(t) };
}

export { ETIQUETA_METODO_ABONO } from './cobros-etiquetas';
