import type { Plan, Tenant } from '@prisma/client';

/**
 * Funciones opcionales: se prenden por plan (para todos sus clientes) o por
 * cliente puntual (Tenant.extraFeatures, se suman a las del plan). Lo demás
 * (carta online, pedidos, cocina, caja, stock, mermas, gastos, finanzas,
 * reportes) lo tiene todo el mundo.
 *
 * Un cliente sin plan asignado tiene todo: así una instalación vieja o un
 * cliente de cortesía no pierde nada. Archivo sin base de datos: lo usan
 * también las pantallas.
 */
export const FUNCIONES = [
  { id: 'salon', label: 'Salón y mesas', ayuda: 'Salón para el mozo, mesas y reservas' },
  { id: 'insumos', label: 'Insumos y recetas', ayuda: 'Stock por kilo que se descuenta por receta' },
  { id: 'sueldos', label: 'Sueldos', ayuda: 'Personal, sueldos, adelantos y lo que falta pagar' },
  { id: 'pago_online', label: 'Pago online', ayuda: 'Cobro con Mercado Pago desde la carta, en la cuenta del local' },
] as const;

export type Funcion = (typeof FUNCIONES)[number]['id'];
export const IDS_FUNCION: string[] = FUNCIONES.map((f) => f.id);
export const ETIQUETA_FUNCION: Record<string, string> = Object.fromEntries(FUNCIONES.map((f) => [f.id, f.label]));

/** Qué sección del panel corresponde a cada función, para esconderla del menú. */
export const SECCIONES_DE_FUNCION: Record<string, Funcion> = {
  '/admin/salon': 'salon',
  '/admin/mesas': 'salon',
  '/admin/reservas': 'salon',
  '/admin/insumos': 'insumos',
  '/admin/gastos/sueldos': 'sueldos',
};

export type Limites = {
  /** null = sin límite */
  maxBranches: number | null;
  maxUsers: number | null;
  funciones: Funcion[];
  plan: string | null;
};

/** Lo que puede usar un cliente: lo de su plan, con lo que se le pisó a mano. */
export function limitesDe(t: Pick<Tenant, 'maxBranches' | 'maxUsers' | 'extraFeatures'> & { plan: Pick<Plan, 'name' | 'maxBranches' | 'maxUsers' | 'features'> | null }): Limites {
  if (!t.plan) {
    return {
      maxBranches: t.maxBranches ?? null,
      maxUsers: t.maxUsers ?? null,
      funciones: [...IDS_FUNCION] as Funcion[],
      plan: null,
    };
  }
  const maxUsers = t.maxUsers ?? t.plan.maxUsers;
  return {
    maxBranches: t.maxBranches ?? t.plan.maxBranches,
    maxUsers: maxUsers > 0 ? maxUsers : null,
    funciones: [...new Set([...t.plan.features, ...t.extraFeatures])].filter((f) => IDS_FUNCION.includes(f)) as Funcion[],
    plan: t.plan.name,
  };
}

/** El precio mensual del cliente: el acordado o el de su plan. */
export function precioDe(t: Pick<Tenant, 'price'> & { plan: Pick<Plan, 'price'> | null }): number {
  return t.price ?? t.plan?.price ?? 0;
}
