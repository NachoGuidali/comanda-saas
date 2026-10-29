/** Textos del estado del abono, para listas y carteles. Sin base de datos. */
export const ESTADO_ABONO: Record<string, { label: string; clase: string }> = {
  sin_vencimiento: { label: 'Sin vencimiento', clase: 'bg-carbon/5 text-carbon-500' },
  al_dia: { label: 'Al día', clase: 'bg-verde/10 text-verde' },
  por_vencer: { label: 'Por vencer', clase: 'bg-rojo/10 text-rojo' },
  en_gracia: { label: 'Vencido (en gracia)', clase: 'bg-ladrillo/15 text-ladrillo' },
  vencido: { label: 'Vencido', clase: 'bg-ladrillo/15 text-ladrillo' },
  prueba: { label: 'En prueba', clase: 'bg-marca/10 text-marca' },
  suspendido: { label: 'Suspendido', clase: 'bg-carbon text-crema' },
};

export const fechaCorta = (d: Date | string | null | undefined) =>
  d ? new Date(d).toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '—';
