import { db } from '@/lib/db';
import { requireSession, puede } from '@/lib/session';
import { money } from '@/lib/money';
import { inicioDelDia } from '@/lib/tiempo';
import { catalogoMostrador } from '@/lib/catalogo-mostrador';
import { revisarPagosVencidos } from '@/lib/pagos';
import TableroPedidos, { type PermisosTablero } from '@/components/admin/TableroPedidos';
import NuevoPedidoMostrador, { type CategoriaMostrador } from '@/components/admin/NuevoPedidoMostrador';

export const dynamic = 'force-dynamic';

export default async function PedidosPage() {
  const s = await requireSession('pedidos.ver');

  const permisos: PermisosTablero = {
    avanzar: puede(s, 'pedidos.avanzar'),
    crear: puede(s, 'pedidos.crear'),
    cancelar: puede(s, 'pedidos.cancelar'),
    cobrar: puede(s, 'pedidos.cobrar'),
    imprimir: puede(s, 'pedidos.imprimir'),
    asignar: puede(s, 'pedidos.asignar'),
    repartir: puede(s, 'pedidos.repartir'),
    cocina: puede(s, 'cocina.avanzar'),
    mermas: puede(s, 'mermas.anotar', 'stock.mover'),
    userId: s.userId,
  };
  // El repartidor que no maneja el tablero completo ve solo lo que lleva
  const soloLosSuyos = !permisos.avanzar && permisos.repartir;

  const inicioHoy = inicioDelDia();
  await revisarPagosVencidos(s.branchId);

  const [pedidos, repartidores, hoy, catalogo, zonas, mesas] = await Promise.all([
    db.order.findMany({
      where: {
        branchId: s.branchId,
        ...(soloLosSuyos ? { type: 'DELIVERY' as const } : {}),
        AND: [
          {
            OR: [
              { status: { in: ['PENDIENTE', 'ACEPTADO', 'EN_PREPARACION', 'LISTO', 'EN_CAMINO'] } },
              { status: { in: ['ENTREGADO', 'RECHAZADO', 'CANCELADO'] }, createdAt: { gte: inicioHoy } },
            ],
          },
          ...(soloLosSuyos ? [{ OR: [{ assignedToId: s.userId }, { assignedToId: null, status: 'LISTO' as const }] }] : []),
        ],
      },
      orderBy: { createdAt: 'asc' },
      include: {
        items: { include: { addons: true }, orderBy: { id: 'asc' } },
        table: { select: { name: true } },
        assignedTo: { select: { id: true, name: true } },
        zone: { select: { name: true } },
      },
    }),
    db.user.findMany({
      where: { role: 'REPARTIDOR', active: true, branches: { some: { branchId: s.branchId } } },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    }),
    db.order.aggregate({
      where: { branchId: s.branchId, createdAt: { gte: inicioHoy }, status: 'ENTREGADO' },
      _sum: { total: true },
      _count: true,
    }),
    permisos.crear ? catalogoMostrador(s.branchId) : Promise.resolve([] as CategoriaMostrador[]),
    db.deliveryZone.findMany({ where: { branchId: s.branchId, active: true }, orderBy: [{ position: 'asc' }, { fee: 'asc' }] }),
    db.table.findMany({ where: { branchId: s.branchId, active: true }, orderBy: { name: 'asc' } }),
  ]);

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl">Pedidos · {s.branchName}</h1>
          {!soloLosSuyos && (
            <p className="mt-1 text-sm text-carbon-500">
              {hoy._count} entregados hoy · {money(hoy._sum.total ?? 0)} facturado
            </p>
          )}
        </div>
        {permisos.crear && (
          <NuevoPedidoMostrador branchId={s.branchId} categorias={catalogo} zonas={zonas} mesas={mesas} />
        )}
      </div>

      <TableroPedidos
        inicial={JSON.parse(JSON.stringify(pedidos))}
        repartidores={repartidores}
        permisos={permisos}
        branchId={s.branchId}
        catalogo={catalogo}
        zonas={zonas}
        mesas={mesas}
      />
    </div>
  );
}
