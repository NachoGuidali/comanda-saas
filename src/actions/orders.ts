'use server';

import { revalidatePath } from 'next/cache';
import { unstable_rethrow } from 'next/navigation';
import { Prisma, type OrderStatus, type OrderType, type PaymentMethod, type OrderSource } from '@prisma/client';
import { db } from '@/lib/db';
import { getSession, requireSession, puede, type SessionConSucursal } from '@/lib/session';
import { mensajeWhatsApp, linkWhatsApp } from '@/lib/sucursales';
import { encolarImpresion } from '@/lib/print';
import { precioConPromo, promoVigente, type PromoAplicable } from '@/lib/promos';
import { permitir, ipCliente } from '@/lib/limite';
import { money } from '@/lib/money';
import { devolverStock } from '@/lib/stock';
import { consumoDeLineas, descontarInsumos } from '@/lib/recetas';
import { esGrupoMitad, precioDelGusto, precioBaseMitad } from '@/lib/mitad';
import { getTenant } from '@/lib/tenant';
import { credencialesDelCliente } from '@/lib/mp-cliente';
import { modoMP, firmaSimulada } from '@/lib/mercadopago';
import { linkDePago, reembolsarPedido, resolverPagoSimulado } from '@/lib/pagos';

export type ItemCarrito = {
  productId: string;
  variantId?: string | null;
  quantity: number;
  addonIds: string[];
  notes?: string;
};

export type DatosPedido = {
  branchId: string;
  type: OrderType;
  customerName: string;
  customerPhone: string;
  address?: string;
  addressNotes?: string;
  zoneId?: string;
  tableId?: string;
  paymentMethod: PaymentMethod;
  cashAmount?: number;
  promoCode?: string;
  notes?: string;
  source?: OrderSource;
  /// Lo carga alguien del local desde el panel. Exige sesión con permiso.
  desdePanel?: boolean;
};

type Resultado<T = object> = ({ ok: true } & T) | { ok: false; error: string };

const TIPOS_VALIDOS: OrderType[] = ['DELIVERY', 'TAKEAWAY', 'SALON'];
const PAGOS_VALIDOS: PaymentMethod[] = ['EFECTIVO', 'TRANSFERENCIA', 'TARJETA_ENTREGA', 'MERCADO_PAGO'];
const ABIERTOS: OrderStatus[] = ['PENDIENTE', 'ACEPTADO', 'EN_PREPARACION', 'LISTO', 'EN_CAMINO'];

/**
 * Tope de un pedido: $20.000.000. El total se guarda en un entero de 32 bits
 * (hasta $21.474.836); por encima, la base lo rechaza. Ningún pedido de un
 * local llega ahí, pero si alguien tipea 999 unidades, el error es claro.
 */
const TOPE_PEDIDO = 20_000_000_00;

/** Error que corta una transacción y llega tal cual al usuario. */
class ErrorPedido extends Error {}

/** Código corto y legible por teléfono: A-4821 */
async function generarCodigo(): Promise<string> {
  const letras = 'ABCDEFGHJKMNPQRSTUVWXYZ';
  for (let i = 0; i < 10; i++) {
    const code = `${letras[Math.floor(Math.random() * letras.length)]}-${Math.floor(1000 + Math.random() * 9000)}`;
    const existe = await db.order.findUnique({ where: { code }, select: { id: true } });
    if (!existe) return code;
  }
  return `X-${Date.now().toString().slice(-6)}`;
}

// ─────────── Armado de las líneas ───────────

type LineaResuelta = {
  productId: string;
  variantId: string | null;
  trackStock: boolean;
  name: string;
  variantName: string | null;
  unitPrice: number;
  quantity: number;
  total: number;
  notes: string | null;
  addons: { name: string; price: number }[];
  /** Para descontar los insumos de la receta de cada extra */
  addonIds: string[];
};

/**
 * Convierte el carrito en líneas con precio real.
 *
 * Los precios NO se toman del navegador: se leen de la base junto con las
 * promos del día. Tampoco se confía en que el carrito venga bien armado: una
 * pizza con tamaños sin tamaño elegido, un adicional que no es de ese
 * producto o que ya no existe, o un grupo obligatorio vacío, se rechazan con
 * un mensaje claro en vez de cobrarse mal.
 */
async function resolverLineas(branchId: string, items: ItemCarrito[]): Promise<Resultado<{ lineas: LineaResuelta[]; subtotal: number }>> {
  if (!Array.isArray(items) || items.length === 0) return { ok: false, error: 'El carrito está vacío' };
  if (items.length > 60) return { ok: false, error: 'El pedido tiene demasiadas líneas' };

  const productIds = [...new Set(items.map((i) => String(i.productId)))];
  const productos = await db.product.findMany({
    where: { id: { in: productIds }, active: true, branchId, category: { active: true } },
    include: {
      variants: { where: { active: true } },
      addons: { include: { options: { where: { active: true } } } },
    },
  });
  const porId = new Map(productos.map((p) => [p.id, p]));

  const promosRaw = await db.promotion.findMany({
    where: { branchId, active: true, type: { in: ['PRODUCTO_PORCENTAJE', 'PRODUCTO_PRECIO'] } },
    include: { products: { select: { productId: true } } },
  });
  const promosAuto: PromoAplicable[] = promosRaw.map((pr) => ({
    id: pr.id, title: pr.title, type: pr.type, value: pr.value, days: pr.days,
    startsAt: pr.startsAt, endsAt: pr.endsAt,
    productIds: pr.products.map((x) => x.productId),
  }));

  // Mitad y mitad: si el local no cobra precio fijo, hace falta el precio de
  // cada pizza para saber cuánto vale cada mitad
  const hayMitades = productos.some((p) => p.addons.some(esGrupoMitad));
  const modoMitad = hayMitades
    ? (await db.branch.findUnique({ where: { id: branchId }, select: { precioMitad: true } }))?.precioMitad ?? 'FIJO'
    : 'FIJO';
  const catalogo = modoMitad !== 'FIJO'
    ? await db.product.findMany({
        where: { branchId, active: true, category: { active: true } },
        select: { id: true, name: true, price: true, variants: { where: { active: true }, select: { name: true, price: true } } },
      })
    : [];

  const lineas: LineaResuelta[] = [];
  let subtotal = 0;

  for (const item of items) {
    const p = porId.get(String(item.productId));
    if (!p) return { ok: false, error: 'Un producto del carrito ya no está disponible. Revisá el pedido.' };

    const qty = Math.floor(Number(item.quantity));
    if (!Number.isFinite(qty) || qty < 1 || qty > 99) {
      return { ok: false, error: `La cantidad de ${p.name} no es válida` };
    }

    // Tamaño: si el producto tiene, es obligatorio elegir uno. Sin este
    // chequeo, una pizza sin tamaño se cobraba al precio base, que es 0.
    let precio = p.price;
    let variantName: string | null = null;
    let variantId: string | null = null;
    if (p.variants.length > 0) {
      const v = p.variants.find((x) => x.id === item.variantId);
      if (!v) return { ok: false, error: `Elegí el tamaño de ${p.name}` };
      precio = v.price;
      variantName = v.name;
      variantId = v.id;
    } else if (item.variantId) {
      return { ok: false, error: `${p.name} cambió en la carta. Sacalo y volvé a agregarlo.` };
    }

    // Adicionales: cada uno tiene que existir, ser de este producto y respetar
    // el mínimo y el máximo de su grupo.
    const pedidos = [...new Set((item.addonIds ?? []).map(String))];
    const addons: { name: string; price: number }[] = [];
    for (const id of pedidos) {
      const grupo = p.addons.find((g) => g.options.some((o) => o.id === id));
      if (!grupo) {
        return { ok: false, error: `Un adicional de ${p.name} ya no está disponible. Sacalo y volvé a agregarlo.` };
      }
      const o = grupo.options.find((x) => x.id === id)!;
      addons.push({ name: o.name, price: o.price });
    }
    for (const g of p.addons) {
      if (g.options.length === 0) continue;
      const elegidos = g.options.filter((o) => pedidos.includes(o.id)).length;
      if (elegidos < g.minPick) return { ok: false, error: `En ${p.name}, elegí ${g.minPick} de "${g.name}"` };
      if (g.maxPick > 0 && elegidos > g.maxPick) {
        return { ok: false, error: `En ${p.name}, "${g.name}" admite hasta ${g.maxPick}` };
      }
    }

    if (modoMitad !== 'FIJO') {
      const gustos = p.addons
        .filter(esGrupoMitad)
        .flatMap((g) => g.options.filter((o) => pedidos.includes(o.id)))
        .map((o) => precioDelGusto(o.name, variantName, catalogo, p.id))
        .filter((x): x is number => x !== null);
      precio = precioBaseMitad(modoMitad, precio, gustos);
    }

    const conPromo = precioConPromo(p.id, precio, p.variants.length > 0, promosAuto);
    const unitPrice = conPromo.precio + addons.reduce((s, a) => s + a.price, 0);
    const total = unitPrice * qty;
    subtotal += total;

    lineas.push({
      productId: p.id,
      variantId,
      trackStock: p.trackStock,
      name: p.name,
      variantName,
      unitPrice,
      quantity: qty,
      total,
      notes: item.notes ? String(item.notes).trim().slice(0, 200) || null : null,
      addons,
      addonIds: pedidos,
    });
  }

  return { ok: true, lineas, subtotal };
}

/**
 * Descuenta el stock dentro de la transacción, de forma atómica.
 *
 * El descuento es condicional ("restá 2 solo si quedan 2 o más"), así que dos
 * clientes comprando la última botella al mismo tiempo no pueden dejar el
 * stock en negativo: uno de los dos recibe "nos quedan 0". Además se suman las
 * líneas del mismo producto, porque dos líneas de 1 son 2 botellas.
 *
 * Después descuenta los insumos según las recetas (ver lib/recetas.ts). Esos
 * nunca frenan la venta.
 */
async function descontarStock(tx: Prisma.TransactionClient, lineas: LineaResuelta[], code: string, nombres: Map<string, string>) {
  const demanda = new Map<string, { productId: string; variantId: string | null; cantidad: number }>();
  for (const l of lineas) {
    if (!l.trackStock) continue;
    const clave = `${l.productId}|${l.variantId ?? ''}`;
    const actual = demanda.get(clave) ?? { productId: l.productId, variantId: l.variantId, cantidad: 0 };
    actual.cantidad += l.quantity;
    demanda.set(clave, actual);
  }

  for (const d of demanda.values()) {
    const nombre = nombres.get(`${d.productId}|${d.variantId ?? ''}`) ?? 'ese producto';
    if (d.variantId) {
      const r = await tx.variant.updateMany({
        where: { id: d.variantId, stock: { gte: d.cantidad } },
        data: { stock: { decrement: d.cantidad } },
      });
      if (r.count === 0) {
        const v = await tx.variant.findUnique({ where: { id: d.variantId }, select: { stock: true } });
        throw new ErrorPedido(`Nos quedan ${Math.max(0, v?.stock ?? 0)} de ${nombre}`);
      }
      const v = await tx.variant.findUniqueOrThrow({ where: { id: d.variantId }, select: { stock: true } });
      await tx.stockMovement.create({
        data: {
          productId: d.productId, variantId: d.variantId, type: 'VENTA', quantity: -d.cantidad,
          before: v.stock + d.cantidad, after: v.stock, orderCode: code,
        },
      });
    } else {
      const r = await tx.product.updateMany({
        where: { id: d.productId, stock: { gte: d.cantidad } },
        data: { stock: { decrement: d.cantidad } },
      });
      if (r.count === 0) {
        const p = await tx.product.findUnique({ where: { id: d.productId }, select: { stock: true } });
        throw new ErrorPedido(`Nos quedan ${Math.max(0, p?.stock ?? 0)} de ${nombre}`);
      }
      const p = await tx.product.findUniqueOrThrow({ where: { id: d.productId }, select: { stock: true } });
      await tx.stockMovement.create({
        data: {
          productId: d.productId, type: 'VENTA', quantity: -d.cantidad,
          before: p.stock + d.cantidad, after: p.stock, orderCode: code,
        },
      });
    }
  }

  const consumo = await consumoDeLineas(
    tx,
    lineas.map((l) => ({ productId: l.productId, variantId: l.variantId, addonIds: l.addonIds, quantity: l.quantity }))
  );
  await descontarInsumos(tx, consumo, { tipo: 'CONSUMO', orderCode: code });
}

function nombresDeLineas(lineas: LineaResuelta[]) {
  return new Map(lineas.map((l) => [`${l.productId}|${l.variantId ?? ''}`, `${l.name}${l.variantName ? ` ${l.variantName}` : ''}`]));
}

// ─────────── Códigos de descuento ───────────

type Descuento = { discount: number; codigo: string; titulo: string };

async function aplicarCodigo(branchId: string, codigo: string, subtotal: number, deliveryFee: number): Promise<Resultado<Descuento>> {
  const code = codigo.toUpperCase().trim();
  const promo = await db.promotion.findFirst({
    where: { branchId, code, active: true, type: { in: ['PORCENTAJE', 'MONTO_FIJO', 'ENVIO_GRATIS'] } },
    include: { products: { select: { productId: true } } },
  });
  // Mismo criterio que las promos automáticas: fechas y días de la semana
  if (!promo || !promoVigente({ ...promo, productIds: [] })) {
    return { ok: false, error: `El código ${code} no existe o no está vigente hoy` };
  }
  if (subtotal < promo.minOrder) {
    return { ok: false, error: `El código ${code} es para pedidos desde ${money(promo.minOrder)}` };
  }

  let discount = 0;
  if (promo.type === 'PORCENTAJE') discount = Math.round((subtotal * promo.value) / 100);
  else if (promo.type === 'MONTO_FIJO') discount = Math.min(promo.value, subtotal);
  else if (promo.type === 'ENVIO_GRATIS') {
    if (deliveryFee === 0) return { ok: false, error: `El código ${code} es de envío gratis y este pedido no tiene envío` };
    discount = deliveryFee;
  }
  return { ok: true, discount, codigo: code, titulo: promo.title };
}

/**
 * Para que la carta muestre el descuento ANTES de confirmar. Antes el código
 * se aplicaba en silencio (o no) y el cliente se enteraba en el WhatsApp.
 */
export async function validarCodigo(branchId: string, codigo: string, subtotal: number, deliveryFee: number) {
  const ip = await ipCliente();
  if (!permitir(`codigo:${ip}`, 20, 10 * 60_000)) {
    return { ok: false as const, error: 'Demasiados intentos. Probá en unos minutos.' };
  }
  if (!codigo.trim()) return { ok: false as const, error: 'Escribí un código' };
  const tenant = await getTenant();
  const propia = tenant && (await db.branch.findFirst({ where: { id: String(branchId), tenantId: tenant.id }, select: { id: true } }));
  if (!propia) return { ok: false as const, error: 'Ese código no es válido' };
  return aplicarCodigo(String(branchId), codigo, Math.max(0, Math.floor(subtotal)), Math.max(0, Math.floor(deliveryFee)));
}

// ─────────── Crear pedido ───────────

/**
 * Crea el pedido en una sucursal concreta.
 *
 * Desde la web entra como PENDIENTE y espera que caja lo acepte. Desde el
 * panel lo carga alguien del local, así que ya nace aceptado y sale la comanda:
 * no tiene sentido que el cajero acepte su propio pedido.
 */
export async function crearPedido(items: ItemCarrito[], datos: DatosPedido): Promise<Resultado<{ code: string; total: number; whatsappUrl: string; pagoUrl: string | null }>> {
  try {
    return await crearPedidoInterno(items, datos);
  } catch (e) {
    // Los redirect de Next (sesión vencida → login) también son excepciones:
    // se dejan pasar para que la pantalla lleve al login en vez de un error
    unstable_rethrow(e);
    if (e instanceof ErrorPedido) return { ok: false, error: e.message };
    console.error('crearPedido', e);
    return { ok: false, error: 'No pudimos registrar el pedido. Probá de nuevo en un momento.' };
  }
}

async function crearPedidoInterno(items: ItemCarrito[], datos: DatosPedido): Promise<Resultado<{ code: string; total: number; whatsappUrl: string; pagoUrl: string | null }>> {
  // Quién lo carga
  let staff: SessionConSucursal | null = null;
  if (datos.desdePanel) {
    staff = await requireSession();
    if (!puede(staff, 'pedidos.crear')) return { ok: false, error: 'No tenés permiso para cargar pedidos' };
    if (staff.branchId !== datos.branchId) return { ok: false, error: 'Cambiaste de sucursal. Recargá la pantalla.' };
  }

  if (!TIPOS_VALIDOS.includes(datos.type)) return { ok: false, error: 'Elegí cómo recibís el pedido' };
  if (!PAGOS_VALIDOS.includes(datos.paymentMethod)) return { ok: false, error: 'Elegí la forma de pago' };
  // El salón es solo para pedidos del local: desde la web no se come acá
  if (datos.type === 'SALON' && !staff) return { ok: false, error: 'Elegí envío o retiro' };

  // Desde la web, "Mercado Pago" es pagar online ahora. En el local es el QR
  // del mostrador o del repartidor, y se cobra como cualquier otro medio.
  const pagoOnline = !staff && datos.paymentMethod === 'MERCADO_PAGO';
  const tenantPedido = await getTenant();
  if (pagoOnline && (!tenantPedido || modoMP(await credencialesDelCliente(tenantPedido.id)) === 'apagado')) {
    return { ok: false, error: 'El pago online no está disponible. Elegí otra forma de pago.' };
  }

  const customerName = String(datos.customerName ?? '').trim();
  const customerPhone = String(datos.customerPhone ?? '').trim();
  if (!staff) {
    if (!customerName || !customerPhone) return { ok: false, error: 'Faltan el nombre y el teléfono' };
    if (customerPhone.replace(/\D/g, '').length < 8) {
      return { ok: false, error: 'Revisá el teléfono: poné el código de área, por ejemplo 11 2345 6789' };
    }
  }
  if (datos.type === 'DELIVERY' && !datos.address?.trim()) {
    return { ok: false, error: 'Falta la dirección de entrega' };
  }

  // La sucursal tiene que ser del cliente del dominio por el que entró el pedido
  const tenant = await getTenant();
  if (!tenant) return { ok: false, error: 'Esa sucursal no está disponible' };
  const branch = await db.branch.findFirst({ where: { id: String(datos.branchId), tenantId: tenant.id, active: true } });
  if (!branch) return { ok: false, error: 'Esa sucursal no está disponible' };
  if (!staff && !branch.aceptaPedidos) {
    return { ok: false, error: 'Ese local no está tomando pedidos en este momento' };
  }

  // Freno a pedidos falsos: como el stock se descuenta al entrar, veinte
  // pedidos de broma dejarían la carta agotada.
  if (!staff) {
    const ip = await ipCliente();
    if (!permitir(`pedido:${branch.id}:${ip}`, 6, 30 * 60_000)) {
      return { ok: false, error: 'Recibimos varios pedidos desde tu conexión. Si necesitás algo más, escribinos por WhatsApp.' };
    }
    const abiertosDelTelefono = await db.order.count({
      where: { branchId: branch.id, customerPhone, status: 'PENDIENTE' },
    });
    if (abiertosDelTelefono >= 2) {
      return { ok: false, error: 'Ya tenés pedidos esperando confirmación. Escribinos por WhatsApp si querés sumar algo.' };
    }
  }

  const resueltas = await resolverLineas(branch.id, items);
  if (!resueltas.ok) return resueltas;
  const { lineas, subtotal } = resueltas;

  // Envío: si el local tiene zonas cargadas, elegir una es obligatorio. Antes
  // se podía mandar el pedido sin zona y el envío salía gratis.
  let deliveryFee = 0;
  let zoneId: string | null = null;
  if (datos.type === 'DELIVERY') {
    const zonas = await db.deliveryZone.findMany({ where: { branchId: branch.id, active: true } });
    if (zonas.length > 0) {
      const zona = zonas.find((z) => z.id === datos.zoneId);
      if (!zona) return { ok: false, error: 'Elegí tu zona de envío' };
      deliveryFee = zona.fee;
      zoneId = zona.id;
    }
  }

  // Mesa: solo desde el panel, y tiene que ser de este local
  let tableId: string | null = null;
  if (staff && datos.type === 'SALON' && datos.tableId) {
    const mesa = await db.table.findFirst({ where: { id: datos.tableId, branchId: branch.id, active: true } });
    if (!mesa) return { ok: false, error: 'Esa mesa no es de este local' };
    if (mesa.status === 'FUERA_DE_SERVICIO') return { ok: false, error: `La mesa ${mesa.name} está fuera de servicio` };
    tableId = mesa.id;
  }

  // Código de descuento: si es inválido se avisa, no se ignora en silencio
  let discount = 0;
  let promoCode: string | null = null;
  if (datos.promoCode?.trim()) {
    const d = await aplicarCodigo(branch.id, datos.promoCode, subtotal, deliveryFee);
    if (!d.ok) return d;
    discount = d.discount;
    promoCode = d.codigo;
  }

  const total = Math.max(0, subtotal + deliveryFee - discount);
  if (total > TOPE_PEDIDO) {
    return { ok: false, error: 'El pedido supera el monto máximo. Dividilo en dos pedidos.' };
  }

  // Vuelto: solo tiene sentido en efectivo y no puede ser menos que el total
  let cashAmount: number | null = null;
  if (datos.paymentMethod === 'EFECTIVO' && datos.cashAmount) {
    const monto = Math.round(Number(datos.cashAmount));
    if (Number.isFinite(monto) && monto > 0) {
      if (monto < total) {
        return { ok: false, error: `Con ${money(monto)} no llega al total de ${money(total)}. Revisá el monto.` };
      }
      cashAmount = monto;
    }
  }

  const source: OrderSource = staff
    ? datos.source === 'WHATSAPP' ? 'WHATSAPP' : 'MOSTRADOR'
    : 'WEB';
  const nace: OrderStatus = staff && puede(staff, 'pedidos.avanzar') ? 'ACEPTADO' : 'PENDIENTE';

  const code = await generarCodigo();
  const nombres = nombresDeLineas(lineas);

  const pedido = await db.$transaction(async (tx) => {
    const orden = await tx.order.create({
      data: {
        code,
        branchId: branch.id,
        type: datos.type,
        status: nace,
        acceptedAt: nace === 'ACEPTADO' ? new Date() : null,
        source,
        customerName: (customerName || (datos.type === 'SALON' ? 'Salón' : 'Mostrador')).slice(0, 80),
        customerPhone: (customerPhone || '-').slice(0, 30),
        address: datos.type === 'DELIVERY' ? datos.address?.trim().slice(0, 200) || null : null,
        addressNotes: datos.type === 'DELIVERY' ? datos.addressNotes?.trim().slice(0, 200) || null : null,
        zoneId,
        tableId,
        subtotal,
        deliveryFee,
        discount,
        total,
        paymentMethod: datos.paymentMethod,
        cashAmount,
        pagoOnline,
        esperandoPago: pagoOnline,
        promoCode,
        notes: datos.notes?.trim().slice(0, 500) || null,
        items: {
          create: lineas.map((l) => ({
            productId: l.productId,
            variantId: l.variantId,
            name: l.name,
            variantName: l.variantName,
            unitPrice: l.unitPrice,
            quantity: l.quantity,
            total: l.total,
            notes: l.notes,
            addons: { create: l.addons },
          })),
        },
      },
      include: { items: { include: { addons: true } } },
    });

    await descontarStock(tx, lineas, code, nombres);

    if (tableId) {
      // Si nadie la había abierto desde Salón, se abre ahora: la cuenta de la
      // mesa son los pedidos desde que se ocupó
      await tx.table.updateMany({ where: { id: tableId, openedAt: null }, data: { openedAt: new Date() } });
      await tx.table.update({ where: { id: tableId }, data: { status: 'OCUPADA' } });
    }

    return orden;
  });

  if (nace === 'ACEPTADO' && branch.imprimirAuto) {
    await encolarImpresion(pedido.id).catch((e) => console.error('Impresión', e));
  }

  // Pago online: se arma el link de Mercado Pago. Si Mercado Pago no
  // responde, el pedido se da de baja en el acto (y el stock vuelve): no
  // puede quedar un pedido que el cliente no tiene cómo pagar.
  let pagoUrl: string | null = null;
  if (pagoOnline) {
    try {
      pagoUrl = await linkDePago(pedido.id);
    } catch (e) {
      console.error('Mercado Pago', e);
      await db.$transaction(async (tx) => {
        const r = await tx.order.updateMany({
          where: { id: pedido.id, status: 'PENDIENTE' },
          data: { status: 'RECHAZADO', esperandoPago: false, closedAt: new Date(), cancelReason: 'Mercado Pago no respondió' },
        });
        if (r.count > 0) await devolverStock(tx, pedido.id, pedido.code, 'Mercado Pago no respondió');
      });
      return { ok: false, error: 'No pudimos conectar con Mercado Pago. Probá de nuevo o elegí otra forma de pago.' };
    }
  }

  const texto = mensajeWhatsApp({
    code: pedido.code,
    type: pedido.type,
    sucursal: branch.name,
    customerName: pedido.customerName,
    customerPhone: pedido.customerPhone,
    address: pedido.address,
    addressNotes: pedido.addressNotes,
    items: pedido.items,
    subtotal: pedido.subtotal,
    deliveryFee: pedido.deliveryFee,
    discount: pedido.discount,
    total: pedido.total,
    paymentMethod: pedido.paymentMethod,
    cashAmount: pedido.cashAmount,
    notes: pedido.notes,
  });

  revalidatePath('/admin/pedidos');
  revalidatePath('/admin/cocina');
  revalidatePath('/admin/mesas');

  return {
    ok: true,
    code: pedido.code,
    total: pedido.total,
    whatsappUrl: linkWhatsApp(branch.whatsapp, texto),
    pagoUrl,
  };
}

/**
 * Para la página del pedido: el cliente que cerró Mercado Pago sin pagar, o
 * al que le rechazaron la tarjeta, vuelve a intentar desde acá.
 */
export async function pagarPedido(code: string): Promise<Resultado<{ url: string }>> {
  const ip = await ipCliente();
  if (!permitir(`pagar:${ip}`, 15, 10 * 60_000)) return { ok: false, error: 'Demasiados intentos. Probá en unos minutos.' };

  const tenant = await getTenant();
  const o = tenant && await db.order.findFirst({
    where: { code: String(code).toUpperCase(), branch: { tenantId: tenant.id } },
    select: { id: true, esperandoPago: true, status: true },
  });
  if (!o || !o.esperandoPago || o.status !== 'PENDIENTE') return { ok: false, error: 'Este pedido ya no está esperando un pago' };
  try {
    return { ok: true, url: await linkDePago(o.id) };
  } catch (e) {
    console.error('Mercado Pago', e);
    return { ok: false, error: 'No pudimos conectar con Mercado Pago. Probá de nuevo en un momento.' };
  }
}

/** Solo en modo simulado: los botones de la pantalla de pago de prueba. */
export async function simularPago(orderId: string, firma: string, aprobar: boolean): Promise<Resultado<{ code: string }>> {
  if (firma !== firmaSimulada(String(orderId))) return { ok: false, error: 'Link de pago inválido' };
  const tenant = await getTenant();
  if (!tenant || modoMP(await credencialesDelCliente(tenant.id)) !== 'simulado') {
    return { ok: false, error: 'El pago simulado no está habilitado' };
  }
  const o = tenant && await db.order.findFirst({ where: { id: String(orderId), branch: { tenantId: tenant.id } }, select: { code: true, esperandoPago: true } });
  if (!o) return { ok: false, error: 'No encontramos el pedido' };
  if (!o.esperandoPago) return { ok: true, code: o.code };
  await resolverPagoSimulado(String(orderId), !!aprobar);
  revalidatePath('/admin/pedidos');
  return { ok: true, code: o.code };
}

/**
 * Suma productos a un pedido que sigue abierto. Es la "cuenta de la mesa": la
 * segunda ronda de bebidas va al mismo pedido, sale una comanda de cocina solo
 * con lo nuevo, y al final se cobra todo junto.
 */
export async function agregarAPedido(orderId: string, items: ItemCarrito[]): Promise<Resultado<{ total: number }>> {
  const s = await requireSession();
  if (!puede(s, 'pedidos.crear')) return { ok: false, error: 'No tenés permiso para cargar pedidos' };

  const o = await db.order.findFirst({ where: { id: orderId, branchId: s.branchId } });
  if (!o) return { ok: false, error: 'Ese pedido no es de esta sucursal' };
  if (!ABIERTOS.includes(o.status)) return { ok: false, error: 'Ese pedido ya está cerrado' };
  if (o.paymentStatus === 'COBRADO') return { ok: false, error: 'Ese pedido ya se cobró. Abrí uno nuevo.' };

  const resueltas = await resolverLineas(s.branchId, items);
  if (!resueltas.ok) return resueltas;
  const { lineas, subtotal: agregado } = resueltas;

  try {
    const nuevosIds = await db.$transaction(async (tx) => {
      // Si alguien lo cerró mientras tanto, no se agrega nada
      const sigue = await tx.order.updateMany({
        where: { id: o.id, status: { in: ABIERTOS }, paymentStatus: 'PENDIENTE' },
        data: {
          subtotal: { increment: agregado },
          total: { increment: agregado },
          // Si ya había un vuelto calculado, deja de valer
          cashAmount: null,
        },
      });
      if (sigue.count === 0) throw new ErrorPedido('Ese pedido cambió mientras tanto. Refrescá la pantalla.');

      // Si el pedido tenía un código de descuento por porcentaje, se aplica
      // también a lo que se suma: el 10% de la mesa es sobre toda la cuenta
      const actual = await tx.order.findUniqueOrThrow({ where: { id: o.id } });
      if (actual.promoCode) {
        const promo = await tx.promotion.findFirst({
          where: { branchId: actual.branchId, code: actual.promoCode, type: 'PORCENTAJE' },
        });
        if (promo) {
          const discount = Math.round((actual.subtotal * promo.value) / 100);
          await tx.order.update({
            where: { id: o.id },
            data: { discount, total: Math.max(0, actual.subtotal + actual.deliveryFee - discount) },
          });
        }
      }
      const final = await tx.order.findUniqueOrThrow({ where: { id: o.id }, select: { total: true } });
      if (final.total > TOPE_PEDIDO) throw new ErrorPedido('El pedido supera el monto máximo. Abrí uno nuevo para lo que sigue.');

      const ids: string[] = [];
      for (const l of lineas) {
        const it = await tx.orderItem.create({
          data: {
            orderId: o.id,
            productId: l.productId,
            variantId: l.variantId,
            name: l.name,
            variantName: l.variantName,
            unitPrice: l.unitPrice,
            quantity: l.quantity,
            total: l.total,
            notes: l.notes,
            addons: { create: l.addons },
          },
        });
        ids.push(it.id);
      }
      await descontarStock(tx, lineas, o.code, nombresDeLineas(lineas));
      return ids;
    });

    // Si el pedido ya estaba en cocina, sale una comanda solo con lo nuevo
    const branch = await db.branch.findUnique({ where: { id: o.branchId }, select: { imprimirAuto: true } });
    if (o.status !== 'PENDIENTE' && branch?.imprimirAuto) {
      await encolarImpresion(o.id, { estaciones: ['cocina'], soloItems: nuevosIds }).catch((e) => console.error('Impresión', e));
    }
    // Si ya estaba listo, vuelve a cocina: hay algo nuevo para preparar
    if (o.status === 'LISTO' || o.status === 'EN_CAMINO') {
      await db.order.update({ where: { id: o.id }, data: { status: 'EN_PREPARACION', readyAt: null } });
    }
  } catch (e) {
    if (e instanceof ErrorPedido) return { ok: false, error: e.message };
    throw e;
  }

  revalidatePath('/admin/pedidos');
  revalidatePath('/admin/cocina');
  revalidatePath('/admin/mesas');
  const final = await db.order.findUnique({ where: { id: o.id }, select: { total: true } });
  return { ok: true, total: final?.total ?? 0 };
}

// ─────────── Estados ───────────

/**
 * Qué transiciones existen. Cualquier otra se rechaza: antes se podía cancelar
 * un pedido ya cancelado (y el stock volvía dos veces), o pasar un entregado a
 * pendiente. También evita el doble clic: la segunda vez el pedido ya no está
 * en el estado de origen y la acción no hace nada.
 */
const TRANSICIONES: Record<OrderStatus, OrderStatus[]> = {
  PENDIENTE: ['ACEPTADO', 'RECHAZADO'],
  ACEPTADO: ['EN_PREPARACION', 'LISTO', 'CANCELADO'],
  EN_PREPARACION: ['LISTO', 'CANCELADO'],
  LISTO: ['EN_CAMINO', 'ENTREGADO', 'CANCELADO'],
  EN_CAMINO: ['ENTREGADO', 'CANCELADO'],
  ENTREGADO: [],
  RECHAZADO: [],
  CANCELADO: [],
};

const SIGUIENTE: Record<OrderStatus, OrderStatus | null> = {
  PENDIENTE: 'ACEPTADO',
  ACEPTADO: 'EN_PREPARACION',
  EN_PREPARACION: 'LISTO',
  LISTO: 'EN_CAMINO',
  EN_CAMINO: 'ENTREGADO',
  ENTREGADO: null,
  RECHAZADO: null,
  CANCELADO: null,
};

/** Formas de pago que se cobran en el momento de entregar. */
const SE_COBRA_AL_ENTREGAR: PaymentMethod[] = ['EFECTIVO', 'TARJETA_ENTREGA', 'MERCADO_PAGO'];

/**
 * Quién puede mover qué. Cocina solo mueve lo de cocina; el repartidor solo
 * sale y entrega lo que le asignaron; aceptar, rechazar y cancelar es de caja.
 */
function autorizado(
  s: SessionConSucursal,
  destino: OrderStatus,
  pedido: { type: OrderType; assignedToId: string | null }
): boolean {
  if (puede(s, 'pedidos.avanzar') && destino !== 'RECHAZADO' && destino !== 'CANCELADO') return true;
  switch (destino) {
    case 'RECHAZADO':
    case 'CANCELADO':
      return puede(s, 'pedidos.cancelar');
    case 'EN_PREPARACION':
    case 'LISTO':
      return puede(s, 'cocina.avanzar');
    case 'EN_CAMINO':
    case 'ENTREGADO':
      return (
        pedido.type === 'DELIVERY' &&
        puede(s, 'pedidos.repartir') &&
        (pedido.assignedToId === null || pedido.assignedToId === s.userId)
      );
    default:
      return false;
  }
}

export async function avanzarPedido(orderId: string) {
  const s = await requireSession();
  const o = await db.order.findFirst({ where: { id: orderId, branchId: s.branchId } });
  if (!o) return { ok: false as const, error: 'No encontramos ese pedido' };

  let destino = SIGUIENTE[o.status];
  // Los pedidos que no salen a la calle saltean "en camino"
  if (destino === 'EN_CAMINO' && o.type !== 'DELIVERY') destino = 'ENTREGADO';
  if (!destino) return { ok: false as const, error: 'El pedido ya está cerrado' };

  return cambiarEstado(orderId, destino);
}

export async function cambiarEstado(orderId: string, status: OrderStatus, motivo?: string) {
  const s = await requireSession();

  const o = await db.order.findFirst({ where: { id: orderId, branchId: s.branchId } });
  if (!o) return { ok: false as const, error: 'Ese pedido no es de esta sucursal' };

  if (!TRANSICIONES[o.status]?.includes(status)) {
    return { ok: false as const, error: 'Ese pedido ya cambió de estado. Actualizamos la pantalla.' };
  }
  // El delivery pasa por "en camino"; los demás no
  if (status === 'EN_CAMINO' && o.type !== 'DELIVERY') {
    return { ok: false as const, error: 'Solo los envíos pasan por "en camino"' };
  }
  if (status === 'ENTREGADO' && o.type === 'DELIVERY' && o.status !== 'EN_CAMINO') {
    return { ok: false as const, error: 'Primero despachalo con un repartidor' };
  }
  if (!autorizado(s, status, o)) {
    return { ok: false as const, error: 'No tenés permiso para hacer eso' };
  }
  if (o.esperandoPago && status !== 'RECHAZADO') {
    return { ok: false as const, error: 'Este pedido todavía no se pagó por Mercado Pago. Entra solo cuando se acredite.' };
  }

  const esCierre = status === 'RECHAZADO' || status === 'CANCELADO';
  if (esCierre && !motivo?.trim()) {
    return { ok: false as const, error: 'Contanos el motivo: sirve para los reportes' };
  }

  const ahora = new Date();
  const sellos: Partial<Record<OrderStatus, Prisma.OrderUpdateManyMutationInput>> = {
    ACEPTADO: { acceptedAt: ahora },
    LISTO: { readyAt: ahora },
    EN_CAMINO: { dispatchedAt: ahora },
    ENTREGADO: { deliveredAt: ahora, closedAt: ahora },
    RECHAZADO: { closedAt: ahora },
    CANCELADO: { closedAt: ahora },
  };

  // En una mesa con gente sentada, servir no es cobrar: se cobra al cerrar la mesa
  const mesaSentada = status === 'ENTREGADO' && o.tableId
    ? !!(await db.table.findUnique({ where: { id: o.tableId }, select: { guests: true } }))?.guests
    : false;

  const data: Prisma.OrderUpdateManyMutationInput = {
    status,
    ...(sellos[status] ?? {}),
    ...(esCierre ? { cancelReason: motivo!.trim().slice(0, 300), esperandoPago: false } : {}),
    // Al entregar se da por cobrado lo que se paga en la mano. La
    // transferencia no: queda pendiente hasta que alguien vea que entró.
    ...(status === 'ENTREGADO' && !mesaSentada && o.paymentStatus === 'PENDIENTE' && SE_COBRA_AL_ENTREGAR.includes(o.paymentMethod)
      ? { paymentStatus: 'COBRADO' as const, paidAt: ahora, paidById: s.userId }
      : {}),
  };

  try {
    await db.$transaction(async (tx) => {
      // Solo se mueve si sigue en el estado que vimos: dos personas tocando el
      // mismo pedido a la vez no pueden cerrarlo dos veces.
      const r = await tx.order.updateMany({ where: { id: o.id, status: o.status }, data });
      if (r.count === 0) throw new ErrorPedido('Ese pedido ya cambió de estado. Actualizamos la pantalla.');

      // El repartidor que sale con un pedido sin asignar se lo queda
      if (status === 'EN_CAMINO' && !o.assignedToId && !puede(s, 'pedidos.avanzar')) {
        await tx.order.update({ where: { id: o.id }, data: { assignedToId: s.userId } });
      }

      if (esCierre) await devolverStock(tx, o.id, o.code, status === 'RECHAZADO' ? 'Pedido rechazado' : 'Pedido cancelado');

      // La mesa se libera sola cuando no le queda ningún pedido abierto, salvo
      // que se haya abierto con gente sentada desde Salón: esa la cierra el mozo
      if (o.tableId && (status === 'ENTREGADO' || esCierre)) {
        const mesa = await tx.table.findUnique({ where: { id: o.tableId }, select: { guests: true } });
        const otros = await tx.order.count({
          where: { tableId: o.tableId, id: { not: o.id }, status: { in: ABIERTOS } },
        });
        if (otros === 0 && !mesa?.guests) {
          await tx.table.update({ where: { id: o.tableId }, data: { status: 'LIBRE', openedAt: null, waiterId: null } });
        }
      }
    });
  } catch (e) {
    if (e instanceof ErrorPedido) return { ok: false as const, error: e.message };
    throw e;
  }

  // Si se cancela un pedido que ya se pagó online, se devuelve la plata
  let aviso: string | undefined;
  if (esCierre && o.pagoOnline && o.paymentStatus === 'COBRADO') {
    const r = await reembolsarPedido(o.id);
    aviso = r.ok ? 'Se devolvió el pago de Mercado Pago al cliente.' : r.error;
  }

  // Al aceptar, sale la comanda a cocina
  if (status === 'ACEPTADO') {
    const branch = await db.branch.findUnique({ where: { id: o.branchId }, select: { imprimirAuto: true } });
    if (branch?.imprimirAuto) {
      await encolarImpresion(o.id).catch((e) => console.error('Impresión', e));
    }
  }

  revalidatePath('/admin/pedidos');
  revalidatePath('/admin/cocina');
  revalidatePath('/admin/mesas');
  return { ok: true as const, aviso };
}

export async function asignarRepartidor(orderId: string, userId: string | null) {
  const s = await requireSession();
  if (!puede(s, 'pedidos.asignar')) return { ok: false as const, error: 'No tenés permiso para asignar repartidores' };

  if (userId) {
    const r = await db.user.findFirst({
      where: { id: userId, active: true, branches: { some: { branchId: s.branchId } } },
      select: { id: true },
    });
    if (!r) return { ok: false as const, error: 'Esa persona no trabaja en esta sucursal' };
  }

  const r = await db.order.updateMany({
    where: { id: orderId, branchId: s.branchId, type: 'DELIVERY', status: { in: ABIERTOS } },
    data: { assignedToId: userId },
  });
  if (r.count === 0) return { ok: false as const, error: 'Ese pedido ya está cerrado' };

  revalidatePath('/admin/pedidos');
  return { ok: true as const };
}

export async function marcarCobrado(orderId: string, paymentMethod?: PaymentMethod) {
  const s = await requireSession();
  if (!puede(s, 'pedidos.cobrar')) return { ok: false as const, error: 'No tenés permiso para cobrar' };
  if (paymentMethod && !PAGOS_VALIDOS.includes(paymentMethod)) {
    return { ok: false as const, error: 'Forma de pago inválida' };
  }

  const o = await db.order.findFirst({ where: { id: orderId, branchId: s.branchId } });
  if (!o) return { ok: false as const, error: 'Ese pedido no es de esta sucursal' };
  // El repartidor cobra solo lo que lleva él
  if (!puede(s, 'pedidos.avanzar') && o.assignedToId !== s.userId) {
    return { ok: false as const, error: 'Ese pedido no lo llevás vos' };
  }

  // Queda quién cobró, y si se cambió la forma de pago, cuál había elegido el
  // cliente: "dijo efectivo y pagó con tarjeta" tiene que poder verse después
  const cambiaMetodo = !!paymentMethod && paymentMethod !== o.paymentMethod;
  const r = await db.order.updateMany({
    where: { id: orderId, branchId: s.branchId, paymentStatus: 'PENDIENTE', status: { notIn: ['RECHAZADO', 'CANCELADO'] } },
    // Si estaba esperando un pago online y el cliente terminó pagando de otra
    // forma, deja de esperar y entra como cualquier pedido
    data: {
      paymentStatus: 'COBRADO',
      paidAt: new Date(),
      paidById: s.userId,
      esperandoPago: false,
      ...(cambiaMetodo ? { paymentMethod, metodoOriginal: o.paymentMethod } : {}),
    },
  });
  if (r.count === 0) return { ok: false as const, error: 'Ese pedido ya estaba cobrado o se cerró' };

  revalidatePath('/admin/pedidos');
  revalidatePath('/admin/caja');
  return { ok: true as const };
}

export async function reimprimir(orderId: string) {
  const s = await requireSession();
  if (!puede(s, 'pedidos.imprimir')) return { ok: false as const, error: 'No tenés permiso para imprimir' };
  const o = await db.order.findFirst({ where: { id: orderId, branchId: s.branchId }, select: { id: true } });
  if (!o) return { ok: false as const, error: 'Ese pedido no es de esta sucursal' };

  await encolarImpresion(o.id, { forzar: true });
  revalidatePath('/admin/pedidos');
  return { ok: true as const };
}
