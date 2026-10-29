/**
 * Todo lo de gastos en un solo import. El cálculo del resultado vive en
 * finanzas.ts, para que Finanzas, Gastos y Reportes usen la misma cuenta.
 */
export * from './gastos-categorias';
export * from './gastos-fechas';
export { resultadoDelPeriodo, type ResultadoPeriodo } from './finanzas';
