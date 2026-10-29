import { requireSession } from '@/lib/session';
import {
  rangoPreset, resumen, masVendidos, porDia, porHora,
  porCanalYTipo, tiemposOperativos, mermas, clientesRecurrentes, stockCritico,
} from '@/lib/reportes';
import PanelReportes from '@/components/admin/PanelReportes';
import { resultadoDelPeriodo } from '@/lib/gastos';
import type { OrderType, OrderSource } from '@prisma/client';
import { claveDia } from '@/lib/tiempo';

export const dynamic = 'force-dynamic';

export default async function ReportesPage({
  searchParams,
}: {
  searchParams: Promise<{ rango?: string; desde?: string; hasta?: string; tipo?: string; canal?: string }>;
}) {
  const s = await requireSession('reportes.ver');
  const sp = await searchParams;

  const preset = sp.rango ?? '7dias';
  let { desde, hasta } = rangoPreset(preset);

  if (preset === 'personalizado' && sp.desde && sp.hasta) {
    desde = new Date(`${sp.desde}T00:00:00`);
    hasta = new Date(`${sp.hasta}T23:59:59`);
  }

  const filtro = {
    branchId: s.branchId,
    desde,
    hasta,
    tipo: (sp.tipo as OrderType | 'TODOS') ?? 'TODOS',
    canal: (sp.canal as OrderSource | 'TODOS') ?? 'TODOS',
  };

  // Los gastos no tienen canal ni tipo de pedido: el resultado solo tiene
  // sentido mirando todas las ventas juntas
  const sinFiltros = filtro.tipo === 'TODOS' && filtro.canal === 'TODOS';

  const [res, ranking, serie, horas, cortes, tiempos, perdidas, clientes, criticos, resultado] = await Promise.all([
    resumen(filtro), masVendidos(filtro), porDia(filtro), porHora(filtro),
    porCanalYTipo(filtro), tiemposOperativos(filtro), mermas(filtro),
    clientesRecurrentes(filtro), stockCritico(s.branchId),
    sinFiltros ? resultadoDelPeriodo(s.branchId, desde, new Date(hasta.getTime() + 1)) : Promise.resolve(null),
  ]);

  return (
    <PanelReportes
      sucursal={s.branchName}
      preset={preset}
      desde={claveDia(desde)}
      hasta={claveDia(hasta)}
      tipo={filtro.tipo}
      canal={filtro.canal}
      resumen={res}
      ranking={ranking}
      serie={serie}
      horas={horas}
      cortes={JSON.parse(JSON.stringify(cortes))}
      tiempos={tiempos}
      mermas={perdidas}
      clientes={JSON.parse(JSON.stringify(clientes))}
      criticos={criticos.length}
      resultado={resultado ? { gastos: resultado.gastos, resultado: resultado.resultado, margen: resultado.margen } : null}
    />
  );
}
