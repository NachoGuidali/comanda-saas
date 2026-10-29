'use server';

import { revalidatePath } from 'next/cache';
import { db } from '@/lib/db';
import { exigir } from '@/lib/session';
import { auditar } from '@/lib/auditoria';
import { hashToken, nuevoCodigo, CODIGO_DURA_MS } from '@/lib/impresora';
import { ENORME, GRANDE, NORMAL } from '@/lib/comanda';
import { fechaHora } from '@/lib/tiempo';

/**
 * Las impresoras de cada local, desde Configuración → Impresión. Se agregan
 * con un nombre y qué imprimen; el panel da un código y con ese código el
 * programa de la PC del local se configura solo.
 */

const ESTACIONES = ['todo', 'cocina', 'caja'];
type R = { ok: true } | { ok: false; error: string };

/** Una impresora de un local al que el usuario tiene acceso. */
async function deEsteCliente(id: string) {
  const s = await exigir('config.editar');
  const a = await db.printAgent.findFirst({ where: { id, tenantId: s.tenantId } });
  if (!a || !s.sucursales.some((x) => x.id === a.branchId)) return { s, a: null };
  return { s, a };
}

async function codigoPara(id: string) {
  const codigo = nuevoCodigo();
  await db.printAgent.update({
    where: { id },
    data: { pairCodeHash: hashToken(codigo.replace('-', '')), pairExpires: new Date(Date.now() + CODIGO_DURA_MS) },
  });
  return codigo;
}

export async function agregarImpresora(d: { nombre: string; estaciones: string }): Promise<{ ok: true; id: string; codigo: string } | { ok: false; error: string }> {
  const s = await exigir('config.editar');
  const name = String(d.nombre ?? '').trim().slice(0, 40);
  if (!name) return { ok: false, error: 'Ponele un nombre: Caja, Cocina, Mostrador...' };
  if (!ESTACIONES.includes(d.estaciones)) return { ok: false, error: 'Elegí qué imprime' };
  if ((await db.printAgent.count({ where: { branchId: s.branchId } })) >= 6) return { ok: false, error: 'Este local ya tiene 6 impresoras' };

  const a = await db.printAgent.create({ data: { tenantId: s.tenantId, branchId: s.branchId, name, stations: d.estaciones } });
  const codigo = await codigoPara(a.id);
  await auditar({ tenantId: s.tenantId, actorType: 'usuario', actorId: s.userId, actorName: s.name, action: 'impresora', detail: `Agregó "${name}"` });
  revalidatePath('/admin/config');
  return { ok: true, id: a.id, codigo };
}

/** Código nuevo: para una PC que todavía no se vinculó o para pasar la impresora a otra PC (la anterior deja de imprimir al usarlo). */
export async function codigoImpresora(id: string): Promise<{ ok: true; codigo: string } | { ok: false; error: string }> {
  const { s, a } = await deEsteCliente(id);
  if (!a) return { ok: false, error: 'No existe esa impresora' };
  const codigo = await codigoPara(a.id);
  await auditar({ tenantId: s.tenantId, actorType: 'usuario', actorId: s.userId, actorName: s.name, action: 'impresora', detail: `Código para "${a.name}"` });
  revalidatePath('/admin/config');
  return { ok: true, codigo };
}

export async function guardarImpresora(id: string, d: { nombre: string; estaciones: string; abrirCajon: boolean }): Promise<R> {
  const { a } = await deEsteCliente(id);
  if (!a) return { ok: false, error: 'No existe esa impresora' };
  const name = String(d.nombre ?? '').trim().slice(0, 40);
  if (!name) return { ok: false, error: 'Ponele un nombre' };
  if (!ESTACIONES.includes(d.estaciones)) return { ok: false, error: 'Elegí qué imprime' };
  await db.printAgent.update({ where: { id }, data: { name, stations: d.estaciones, abrirCajon: !!d.abrirCajon } });
  revalidatePath('/admin/config');
  return { ok: true };
}

export async function quitarImpresora(id: string): Promise<R> {
  const { s, a } = await deEsteCliente(id);
  if (!a) return { ok: false, error: 'No existe esa impresora' };
  await db.printAgent.delete({ where: { id } });
  await auditar({ tenantId: s.tenantId, actorType: 'usuario', actorId: s.userId, actorName: s.name, action: 'impresora', detail: `Quitó "${a.name}"` });
  revalidatePath('/admin/config');
  return { ok: true };
}

/** Manda un ticket de prueba solo a esa impresora. */
export async function probarImpresora(id: string): Promise<R> {
  const { a } = await deEsteCliente(id);
  if (!a) return { ok: false, error: 'No existe esa impresora' };
  if (!a.tokenHash) return { ok: false, error: 'Primero instalá el programa en la PC del local con el código' };
  const branch = await db.branch.findUniqueOrThrow({ where: { id: a.branchId }, select: { name: true } });
  const payload = [
    `${ENORME}PRUEBA${NORMAL}`,
    '',
    `${GRANDE}${a.name}${NORMAL}`,
    branch.name,
    fechaHora(new Date()),
    '',
    'Si leés esto, la impresora quedó',
    'bien conectada. Los acentos: áéíóú ñ',
    '',
    'Comanda Supreg',
  ].join('\n');
  await db.printJob.create({ data: { branchId: a.branchId, agentId: a.id, station: 'prueba', payload } });
  return { ok: true };
}
