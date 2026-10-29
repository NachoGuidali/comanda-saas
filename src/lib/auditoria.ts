import { db } from './db';
import { ipCliente } from './limite';

/**
 * La bitácora: quién hizo qué. Se registran los ingresos, los cambios de
 * usuarios, permisos, credenciales y marca, y todo lo que se hace desde la
 * plataforma. Nunca frena la acción: si no se puede anotar, se avisa en el log.
 */
export async function auditar(datos: {
  tenantId?: string | null;
  actorType: 'usuario' | 'plataforma' | 'sistema';
  actorId?: string | null;
  actorName?: string;
  action: string;
  detail?: string;
}) {
  try {
    let ip = '';
    try { ip = await ipCliente(); } catch { /* fuera de un pedido (tareas programadas) */ }
    await db.auditLog.create({
      data: {
        tenantId: datos.tenantId ?? null,
        actorType: datos.actorType,
        actorId: datos.actorId ?? null,
        actorName: (datos.actorName ?? '').slice(0, 120),
        action: datos.action,
        detail: (datos.detail ?? '').slice(0, 500),
        ip: ip.slice(0, 64),
      },
    });
  } catch (e) {
    console.error('Auditoría', e);
  }
}

export { ETIQUETA_ACCION } from './auditoria-etiquetas';
