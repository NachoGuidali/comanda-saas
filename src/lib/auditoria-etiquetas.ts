/** Cómo se lee cada acción de la bitácora. Sin base de datos: la usan las pantallas. */
export const ETIQUETA_ACCION: Record<string, string> = {
  login: 'Ingresó',
  login_fallido: 'Ingreso fallido',
  usuario: 'Cambió un usuario',
  permisos: 'Cambió permisos de un rol',
  credenciales: 'Cambió credenciales',
  marca: 'Cambió la marca',
  impresora: 'Impresoras',
  sucursal: 'Cambió una sucursal',
  cliente_alta: 'Alta de cliente',
  cliente_cambio: 'Cambió el cliente',
  suspension: 'Suspendió',
  reactivacion: 'Reactivó',
  pago: 'Registró un pago',
  pago_anulado: 'Anuló un pago',
  aviso_vencimiento: 'Aviso de vencimiento',
  plan: 'Cambió un plan',
};
