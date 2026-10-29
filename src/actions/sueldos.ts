'use server';

import { revalidatePath } from 'next/cache';
import type { ExpensePayment } from '@prisma/client';
import { db } from '@/lib/db';
import { requireSession, puede, tieneFuncion } from '@/lib/session';
import { toCents } from '@/lib/money';
import { claveDia } from '@/lib/tiempo';
import { FORMAS_PAGO_GASTO } from '@/lib/gastos';
import { guardarGasto } from '@/lib/gastos-guardar';
import { IDS_PAGO_SUELDO, ETIQUETA_PAGO_SUELDO, nombreDelMes } from '@/lib/sueldos';

type Resultado = { ok: true; aviso?: string } | { ok: false; error: string };

function refrescar() {
  revalidatePath('/admin/gastos');
  revalidatePath('/admin/gastos/sueldos');
  revalidatePath('/admin/caja');
  revalidatePath('/admin/finanzas');
}

/** Alta o edición de alguien del personal. El sueldo mensual es opcional (hay quien cobra por día). */
export async function guardarPersonal(datos: {
  id?: string; nombre: string; puesto: string; sueldo: string; userId?: string | null;
}): Promise<Resultado> {
  const s = await requireSession();
  if (!tieneFuncion(s, 'sueldos')) return { ok: false, error: 'Tu plan no incluye Sueldos' };
  if (!puede(s, 'sueldos.pagar')) return { ok: false, error: 'No tenés permiso para manejar sueldos' };

  const nombre = String(datos.nombre ?? '').trim().slice(0, 80);
  if (!nombre) return { ok: false, error: 'Poné el nombre' };
  const puesto = String(datos.puesto ?? '').trim().slice(0, 40);
  const textoSueldo = String(datos.sueldo ?? '').trim();
  const sueldo = textoSueldo ? toCents(textoSueldo) : null;
  if (sueldo !== null && (sueldo <= 0 || sueldo > 100_000_000_00)) return { ok: false, error: 'Revisá el sueldo' };

  let userId: string | null = null;
  if (datos.userId) {
    const u = await db.user.findFirst({ where: { id: String(datos.userId), branches: { some: { branchId: s.branchId } } }, select: { id: true } });
    if (!u) return { ok: false, error: 'Ese usuario no es de esta sucursal' };
    userId = u.id;
  }

  if (datos.id) {
    const actual = await db.staff.findFirst({ where: { id: datos.id, branchId: s.branchId } });
    if (!actual) return { ok: false, error: 'Esa persona no es de esta sucursal' };
    await db.staff.update({ where: { id: actual.id }, data: { name: nombre, role: puesto, salary: sueldo, userId } });
  } else {
    await db.staff.create({ data: { branchId: s.branchId, name: nombre, role: puesto, salary: sueldo, userId } });
  }
  refrescar();
  return { ok: true };
}

/** Deja de figurar en la lista (se fue del local). Sus pagos quedan. */
export async function archivarPersonal(id: string, activo: boolean): Promise<Resultado> {
  const s = await requireSession();
  if (!tieneFuncion(s, 'sueldos')) return { ok: false, error: 'Tu plan no incluye Sueldos' };
  if (!puede(s, 'sueldos.pagar')) return { ok: false, error: 'No tenés permiso para manejar sueldos' };
  const r = await db.staff.updateMany({ where: { id, branchId: s.branchId }, data: { active: activo } });
  if (r.count === 0) return { ok: false, error: 'Esa persona no es de esta sucursal' };
  refrescar();
  return { ok: true };
}

/**
 * Un pago a alguien del personal: sueldo, adelanto, aguinaldo... Queda como
 * gasto de Sueldos con la fecha en que se pagó (para Finanzas y la caja) y el
 * mes al que corresponde (para saber cuánto le falta cobrar).
 */
export async function pagarSueldo(datos: {
  staffId: string; tipo: string; monto: string; fecha: string; periodo: string; pago: string; nota?: string;
}): Promise<Resultado> {
  const s = await requireSession();
  if (!tieneFuncion(s, 'sueldos')) return { ok: false, error: 'Tu plan no incluye Sueldos' };
  if (!puede(s, 'sueldos.pagar')) return { ok: false, error: 'No tenés permiso para pagar sueldos' };

  const persona = await db.staff.findFirst({ where: { id: String(datos.staffId), branchId: s.branchId } });
  if (!persona) return { ok: false, error: 'Esa persona no es de esta sucursal' };
  const tipo = String(datos.tipo);
  if (!IDS_PAGO_SUELDO.includes(tipo)) return { ok: false, error: 'Elegí qué se paga' };
  const amount = toCents(String(datos.monto ?? ''));
  if (amount <= 0) return { ok: false, error: 'Poné el monto' };
  if (amount > 100_000_000_00) return { ok: false, error: 'Ese monto parece un error. Revisalo.' };

  const fecha = String(datos.fecha ?? '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha) || fecha < '2000-01-01') return { ok: false, error: 'Revisá la fecha' };
  const manana = claveDia(new Date(Date.now() + 24 * 60 * 60_000));
  if (fecha > manana) return { ok: false, error: 'La fecha no puede ser futura' };
  const periodo = String(datos.periodo ?? '');
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(periodo)) return { ok: false, error: 'Elegí de qué mes es' };
  const payment = String(datos.pago || 'EFECTIVO') as ExpensePayment;
  if (!FORMAS_PAGO_GASTO.some((f) => f.id === payment)) return { ok: false, error: 'Elegí cómo se pagó' };
  const nota = String(datos.nota ?? '').trim().slice(0, 80);

  const description = `${ETIQUETA_PAGO_SUELDO[tipo]} de ${nombreDelMes(periodo)}: ${persona.name}${nota ? ` (${nota})` : ''}`.slice(0, 200);
  let aviso: string | undefined;
  await db.$transaction(async (tx) => {
    const g = await guardarGasto(tx, {
      branchId: s.branchId, userId: s.userId, fecha, category: 'SUELDOS', description, supplier: null,
      amount, payment, staffId: persona.id, payKind: tipo, period: periodo,
    });
    aviso = g.aviso;
  });
  refrescar();
  return { ok: true, aviso };
}
