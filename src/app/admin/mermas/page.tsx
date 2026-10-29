import { redirect } from 'next/navigation';
import { db } from '@/lib/db';
import { requireSession, puede } from '@/lib/session';
import { claveMes, rangoDelMes } from '@/lib/gastos-fechas';
import { claveDia } from '@/lib/tiempo';
import GestorMermas from '@/components/admin/GestorMermas';

export const dynamic = 'force-dynamic';

/**
 * Lo que se fue sin cobrarse: se rompió, se venció, salió mal, se regaló o lo
 * comió el equipo. Se anota en unidades, sin plata, y se mira por mes.
 */
export default async function MermasPage({ searchParams }: { searchParams: Promise<{ mes?: string }> }) {
  const s = await requireSession();
  if (!puede(s, 'stock.ver', 'mermas.anotar')) redirect('/admin?error=sin-permiso');
  const sp = await searchParams;
  const mesActual = claveMes();
  const mes = sp.mes && /^\d{4}-(0[1-9]|1[0-2])$/.test(sp.mes) && sp.mes <= mesActual ? sp.mes : mesActual;
  const { desde, hasta } = rangoDelMes(mes);

  const [productos, mermas, insumos, mermasInsumo] = await Promise.all([
    db.product.findMany({
      where: { branchId: s.branchId, active: true },
      orderBy: [{ category: { position: 'asc' } }, { position: 'asc' }, { name: 'asc' }],
      select: {
        id: true, name: true, trackStock: true,
        category: { select: { name: true } },
        variants: { where: { active: true }, orderBy: { position: 'asc' }, select: { id: true, name: true } },
      },
    }),
    db.stockMovement.findMany({
      where: { product: { branchId: s.branchId }, type: 'MERMA', createdAt: { gte: desde, lt: hasta } },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true, quantity: true, lossType: true, reason: true, orderCode: true, createdAt: true,
        product: { select: { name: true } },
        variant: { select: { name: true } },
        user: { select: { name: true } },
      },
    }),
    db.supply.findMany({
      where: { branchId: s.branchId, active: true },
      orderBy: [{ position: 'asc' }, { name: 'asc' }],
      select: { id: true, name: true, unit: true },
    }),
    db.supplyMovement.findMany({
      where: { supply: { branchId: s.branchId }, type: 'MERMA', createdAt: { gte: desde, lt: hasta } },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true, quantity: true, lossType: true, reason: true, createdAt: true,
        supply: { select: { name: true, unit: true } },
        user: { select: { name: true } },
      },
    }),
  ]);

  return (
    <GestorMermas
      sucursal={s.branchName}
      mes={mes}
      mesActual={mesActual}
      desde={claveDia(desde)}
      hasta={claveDia(new Date(hasta.getTime() - 1))}
      productos={productos}
      mermas={JSON.parse(JSON.stringify(mermas))}
      insumos={insumos}
      mermasInsumo={JSON.parse(JSON.stringify(mermasInsumo))}
      puedeAnotar={puede(s, 'mermas.anotar', 'stock.mover')}
      puedeDescargar={puede(s, 'stock.ver', 'reportes.ver')}
    />
  );
}
