import { db } from '@/lib/db';
import { requireSession, exigirFuncion, puede } from '@/lib/session';
import { catalogoMostrador } from '@/lib/catalogo-mostrador';
import { leerConfigWhatsApp, rellenar } from '@/lib/whatsapp/config';
import { valoresDelLocal } from '@/lib/whatsapp/mensajes';
import BandejaWhatsApp from '@/components/admin/BandejaWhatsApp';

export const dynamic = 'force-dynamic';

/**
 * La bandeja de WhatsApp del local: los chats a la izquierda, la conversación
 * a la derecha y, al lado, los pedidos de ese cliente. ?tel=<número> abre (o
 * empieza) el chat con ese cliente, por ejemplo desde la ficha de un pedido.
 */
export default async function WhatsAppPage({ searchParams }: { searchParams: Promise<{ tel?: string; chat?: string }> }) {
  const s = await requireSession('whatsapp.ver');
  exigirFuncion(s, 'whatsapp');
  const { tel, chat } = await searchParams;

  const [line, branch] = await Promise.all([
    db.whatsAppLine.findUnique({ where: { branchId: s.branchId } }),
    db.branch.findUniqueOrThrow({
      where: { id: s.branchId },
      select: { id: true, name: true, slug: true, aliasBancario: true, tiempoDelivery: true, tenant: { select: { slug: true, customDomain: true } } },
    }),
  ]);

  const puedeCargar = puede(s, 'pedidos.crear');
  const [catalogo, zonas, mesas] = puedeCargar
    ? await Promise.all([
        catalogoMostrador(s.branchId),
        db.deliveryZone.findMany({ where: { branchId: s.branchId, active: true }, orderBy: { fee: 'asc' }, select: { id: true, name: true, fee: true } }),
        db.table.findMany({ where: { branchId: s.branchId }, orderBy: { name: 'asc' }, select: { id: true, name: true } }),
      ])
    : [[], [], []];

  // Las respuestas rápidas ya con los datos del local ({carta}, {alias}...)
  const valores = valoresDelLocal(branch.tenant, branch);
  const respuestas = leerConfigWhatsApp(line?.config ?? '').respuestas.map((r) => ({ titulo: r.titulo, texto: rellenar(r.texto, valores) }));

  return (
    <BandejaWhatsApp
      conectado={line?.status === 'conectado'}
      existe={!!line}
      puedeConfigurar={puede(s, 'config.editar')}
      respuestas={respuestas}
      pedidos={puedeCargar ? { branchId: s.branchId, categorias: catalogo, zonas, mesas } : null}
      telefonoInicial={tel ?? null}
      chatInicial={chat ?? null}
    />
  );
}
