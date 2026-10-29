'use server';

import { exigir } from '@/lib/session';
import { linkPagoAbono, linkSuscripcionAbono } from '@/lib/abono-mp';
import { auditar } from '@/lib/auditoria';

/** El dueño paga su abono con Mercado Pago (a la cuenta de la plataforma). */
export async function pagarAbono(meses: number) {
  const s = await exigir('sucursales.gestionar');
  return linkPagoAbono(s.tenantId, meses);
}

/** El dueño activa el débito automático mensual. */
export async function debitoAutomatico(email: string) {
  const s = await exigir('sucursales.gestionar');
  const r = await linkSuscripcionAbono(s.tenantId, String(email ?? '').trim().toLowerCase());
  if (r.ok) await auditar({ tenantId: s.tenantId, actorType: 'usuario', actorId: s.userId, actorName: s.name, action: 'credenciales', detail: 'Generó el débito automático del abono' });
  return r;
}
