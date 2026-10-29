import { notFound } from 'next/navigation';
import { db } from '@/lib/db';
import { requirePlataforma } from '@/lib/plataforma';
import { estadoCobro } from '@/lib/cobros';
import { limitesDe, precioDe } from '@/lib/plan';
import { urlDelCliente } from '@/lib/tenant';
import { mpPlataformaDisponible } from '@/lib/abono-mp';
import FichaCliente from '@/components/plataforma/FichaCliente';

export const dynamic = 'force-dynamic';

export default async function Cliente({ params }: { params: Promise<{ id: string }> }) {
  await requirePlataforma();
  const { id } = await params;
  const t = await db.tenant.findUnique({
    where: { id },
    include: {
      plan: true,
      branches: { orderBy: { position: 'asc' }, select: { id: true, name: true, slug: true, active: true } },
      payments: { orderBy: { createdAt: 'desc' }, take: 50 },
      audit: { orderBy: { createdAt: 'desc' }, take: 40 },
      _count: { select: { users: { where: { active: true } } } },
    },
  });
  if (!t) notFound();
  const planes = await db.plan.findMany({ orderBy: { position: 'asc' } });
  const [pedidosMes] = await Promise.all([
    db.order.count({ where: { branch: { tenantId: t.id }, createdAt: { gte: new Date(new Date().getFullYear(), new Date().getMonth(), 1) } } }),
  ]);
  const e = estadoCobro(t);
  const fecha = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : '');

  return (
    <FichaCliente
      c={{
        id: t.id, name: t.name, slug: t.slug, url: urlDelCliente(t), activo: t.active,
        suspendedReason: t.suspendedReason, suspendedKind: t.suspendedKind,
        planId: t.planId ?? '', maxBranches: t.maxBranches === null ? '' : String(t.maxBranches), maxUsers: t.maxUsers === null ? '' : String(t.maxUsers),
        extraFeatures: t.extraFeatures, price: t.price === null ? '' : String(t.price / 100),
        paidUntil: fecha(t.paidUntil), trialUntil: fecha(t.trialUntil), autoSuspend: t.autoSuspend,
        contactName: t.contactName, contactEmail: t.contactEmail, contactPhone: t.contactPhone, notes: t.notes, customDomain: t.customDomain ?? '',
        mpPreapprovalId: t.mpPreapprovalId, mpModo: t.mpMode, mpCuenta: t.mpAccount,
      }}
      estado={{ tipo: t.active ? e.tipo : 'suspendido', vence: 'vence' in e ? e.vence.toISOString() : null, dias: 'dias' in e ? e.dias : null }}
      precio={precioDe(t)}
      limites={limitesDe(t)}
      uso={{ sucursales: t.branches.length, usuarios: t._count.users, pedidosMes }}
      sucursales={t.branches}
      pagos={t.payments.map((p) => ({ ...p, fromDate: p.fromDate?.toISOString() ?? null, toDate: p.toDate.toISOString(), createdAt: p.createdAt.toISOString(), voidedAt: p.voidedAt?.toISOString() ?? null }))}
      bitacora={t.audit.map((a) => ({ id: a.id, action: a.action, actorName: a.actorName, actorType: a.actorType, detail: a.detail, createdAt: a.createdAt.toISOString() }))}
      planes={planes.map((p) => ({ id: p.id, name: p.name, price: p.price, maxBranches: p.maxBranches, maxUsers: p.maxUsers, features: p.features }))}
      mpDisponible={mpPlataformaDisponible()}
    />
  );
}
