import type { Role } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { db } from './db';
import { DEFAULTS } from './permisos';
import { revisarColores, COLORES_DEFECTO } from './tema';
import { slugValido } from './tenant';

export type DatosClienteNuevo = {
  slug: string; nombre: string; email: string; password: string;
  sucursal?: string; direccion?: string; whatsapp?: string;
  principal?: string; acento?: string; fondo?: string;
  planId?: string | null; diasPrueba?: number;
  contactName?: string; contactPhone?: string;
};

function slugify(t: string) {
  return t.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
}

/**
 * Alta de un cliente: su subdominio, su marca, sus permisos por rol, una
 * primera sucursal con horarios y el usuario del dueño. La carta arranca
 * vacía. La usan el panel de la plataforma y prisma/crear-cliente.ts.
 */
export async function crearCliente(d: DatosClienteNuevo): Promise<{ ok: true; id: string; slug: string } | { ok: false; error: string }> {
  const slug = (d.slug ?? '').trim().toLowerCase();
  const nombre = (d.nombre ?? '').trim().slice(0, 60);
  const email = (d.email ?? '').toLowerCase().trim();
  const colores = {
    principal: (d.principal || COLORES_DEFECTO.principal).toUpperCase(),
    acento: (d.acento || COLORES_DEFECTO.acento).toUpperCase(),
    fondo: (d.fondo || COLORES_DEFECTO.fondo).toUpperCase(),
  };
  if (!slugValido(slug)) return { ok: false, error: 'La dirección tiene que tener de 3 a 40 letras minúsculas, números o guiones' };
  if (!nombre) return { ok: false, error: 'Poné el nombre comercial' };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { ok: false, error: 'El mail del dueño no parece válido' };
  if ((d.password ?? '').length < 8) return { ok: false, error: 'La contraseña del dueño necesita al menos 8 caracteres' };
  const problema = revisarColores(colores);
  if (problema) return { ok: false, error: problema };
  if (await db.tenant.findUnique({ where: { slug } })) return { ok: false, error: `Ya hay un cliente con la dirección "${slug}"` };
  if (d.planId && !(await db.plan.findUnique({ where: { id: d.planId } }))) return { ok: false, error: 'Ese plan no existe' };

  const sucursal = (d.sucursal || nombre).trim();
  const diasPrueba = Math.max(0, Math.min(90, Math.floor(d.diasPrueba ?? 0)));
  const t = await db.$transaction(async (tx) => {
    const t = await tx.tenant.create({
      data: {
        slug, name: nombre,
        colorPrimary: colores.principal, colorAccent: colores.acento, colorBackground: colores.fondo,
        planId: d.planId || null,
        trialUntil: diasPrueba ? new Date(Date.now() + diasPrueba * 24 * 60 * 60_000) : null,
        contactName: (d.contactName ?? '').slice(0, 80), contactEmail: email, contactPhone: (d.contactPhone ?? '').slice(0, 40),
      },
    });
    await tx.rolePermisos.createMany({
      data: Object.entries(DEFAULTS).map(([role, permisos]) => ({ tenantId: t.id, role: role as Role, permisos })),
    });
    const b = await tx.branch.create({
      data: {
        tenantId: t.id, name: sucursal, slug: slugify(sucursal) || 'local',
        address: d.direccion ?? '', whatsapp: (d.whatsapp ?? '').replace(/\D/g, ''), active: true,
      },
    });
    await tx.businessHour.createMany({
      data: Array.from({ length: 7 }, (_, dia) => ({ branchId: b.id, dayOfWeek: dia, openTime: '19:00', closeTime: '23:59', closed: false })),
    });
    await tx.user.create({
      data: { tenantId: t.id, name: d.contactName?.trim() || 'Dueño', email, passwordHash: await bcrypt.hash(d.password, 10), role: 'SUPERADMIN' },
    });
    return t;
  });
  return { ok: true, id: t.id, slug: t.slug };
}
