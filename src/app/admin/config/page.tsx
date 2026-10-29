import { db } from '@/lib/db';
import { requireSession, puede, tieneFuncion } from '@/lib/session';
import { descifrar, enmascarar } from '@/lib/cifrado';
import GestorConfig, { type EjemploMitad } from '@/components/admin/GestorConfig';
import { esGrupoMitad, tablaDeGustos } from '@/lib/mitad';
import { urlDelCliente } from '@/lib/tenant';
import { leerConfig } from '@/lib/comanda';

export const dynamic = 'force-dynamic';

const SECCIONES = ['local', 'horarios', 'envios', 'mitad', 'cobro', 'impresion'] as const;

/** ?seccion=impresion abre directo esa pestaña (para mandarle el link a un local por WhatsApp). */
export default async function ConfigPage({ searchParams }: { searchParams: Promise<{ seccion?: string }> }) {
  const s = await requireSession('config.ver');
  const pedida = (await searchParams).seccion;
  const seccion = SECCIONES.find((x) => x === pedida) ?? 'local';

  const [branch, zonas, horarios, productos, categorias, tenant, agentes] = await Promise.all([
    db.branch.findUnique({ where: { id: s.branchId } }),
    db.deliveryZone.findMany({ where: { branchId: s.branchId, active: true }, orderBy: { fee: 'asc' } }),
    db.businessHour.findMany({ where: { branchId: s.branchId }, orderBy: { dayOfWeek: 'asc' } }),
    db.product.findMany({
      where: { branchId: s.branchId, active: true, category: { active: true } },
      select: {
        id: true, name: true, price: true,
        variants: { where: { active: true }, orderBy: { position: 'asc' }, select: { id: true, name: true, price: true } },
        addons: { select: { name: true, esMitad: true, options: { where: { active: true }, select: { id: true, name: true } } } },
      },
    }),
    db.category.findMany({ where: { branchId: s.branchId }, orderBy: { position: 'asc' }, select: { id: true, name: true } }),
    db.tenant.findUniqueOrThrow({ where: { id: s.tenantId } }),
    db.printAgent.findMany({ where: { branchId: s.branchId }, orderBy: { createdAt: 'asc' } }),
  ]);

  // Un ejemplo con precios reales: la mitad y mitad grande, con el gusto más barato y el más caro
  let ejemploMitad: EjemploMitad = null;
  const mitad = productos.find((p) => p.addons.some(esGrupoMitad));
  if (mitad) {
    const tabla = tablaDeGustos(mitad, productos);
    const tamano = mitad.variants.find((v) => /grande/i.test(v.name)) ?? mitad.variants[mitad.variants.length - 1];
    const opciones = mitad.addons.filter(esGrupoMitad).flatMap((g) => g.options);
    const conPrecio = opciones
      .map((o) => ({ name: o.name, price: tabla[o.id]?.[tamano?.id ?? ''] }))
      .filter((o): o is { name: string; price: number } => typeof o.price === 'number')
      .sort((a, b) => a.price - b.price);
    if (conPrecio.length >= 2 && conPrecio[0].price !== conPrecio[conPrecio.length - 1].price) {
      ejemploMitad = {
        producto: mitad.name, tamano: tamano?.name ?? '', fijo: tamano?.price ?? mitad.price,
        barata: conPrecio[0], cara: conPrecio[conPrecio.length - 1],
      };
    }
  }

  if (!branch) return <p className="panel p-8 text-center">No encontramos la sucursal.</p>;

  return (
    <GestorConfig
      branch={JSON.parse(JSON.stringify(branch))}
      zonas={zonas}
      horarios={horarios.map((h) => ({
        dayOfWeek: h.dayOfWeek, openTime: h.openTime, closeTime: h.closeTime, closed: h.closed,
      }))}
      puedeEditar={s.esSuperadmin || s.permisos.includes('config.editar')}
      ejemploMitad={ejemploMitad}
      cobro={{
        incluido: tieneFuncion(s, 'pago_online'),
        modo: tenant.mpMode,
        cuenta: tenant.mpAccount,
        token: enmascarar(descifrar(tenant.mpAccessToken)),
        tieneSecreto: !!tenant.mpWebhookSecret,
        webhook: `${urlDelCliente(tenant, '/api/mp/webhook')}`,
        puedeEditar: puede(s, 'sucursales.gestionar'),
      }}
      impresora={{ servidor: urlDelCliente(tenant, '').replace(/\/$/, ''), sucursal: branch.slug, tieneToken: !!tenant.printTokenHash }}
      impresoras={agentes.map((a) => ({
        id: a.id, name: a.name, stations: a.stations, abrirCajon: a.abrirCajon, vinculada: !!a.tokenHash,
        lastSeenAt: a.lastSeenAt?.toISOString() ?? null, lastError: a.lastError, printer: a.printer, device: a.device, version: a.version,
      }))}
      imprimeCaja={leerConfig(branch.comanda).caja.imprimir !== 'nunca'}
      seccionInicial={seccion}
      categorias={categorias}
    />
  );
}
