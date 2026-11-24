import { zonaDelLocal } from '@/lib/zona';

/**
 * Corre una vez al arrancar el servidor, antes de atender cualquier pedido.
 * Fija la zona horaria del proceso: horarios de apertura, promos por día,
 * "pedidos de hoy", reportes y comandas usan getHours()/getDay() del servidor.
 *
 * Se pisa siempre, no solo si TZ está vacío: en Vercel (AWS Lambda) TZ viene
 * como ":UTC" y no se puede cambiar desde el panel. Sin esto, desde las 21 de
 * Argentina el sistema creería que ya es el día siguiente.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    process.env.TZ = zonaDelLocal();

    // La revisión de abonos (avisos y suspensiones por falta de pago): cada
    // hora, en este mismo proceso. Es idempotente, así que no importa si corre
    // de más. Durante el build no hay base: no se programa.
    if (process.env.NEXT_PHASE !== 'phase-production-build' && process.env.SAAS_REVISION_AUTOMATICA !== 'false') {
      const { revisarCobros } = await import('@/lib/cobros');
      const correr = () => revisarCobros().catch((e) => console.error('Revisión de abonos', e));
      setTimeout(correr, 60_000);
      setInterval(correr, 60 * 60_000).unref();
    }

    // WhatsApp: los avisos que quedaron esperando (el celular sin conexión, un
    // reintento) salen solos; y cada tanto se revisa con Evolution el estado de
    // cada número, por si se perdió algún aviso de conexión.
    if (process.env.NEXT_PHASE !== 'phase-production-build' && process.env.EVOLUTION_URL && process.env.EVOLUTION_API_KEY) {
      const { procesarCola, sincronizarLineas } = await import('@/lib/whatsapp/mensajes');
      const sincronizar = () => sincronizarLineas().catch((e) => console.error('WhatsApp: estado de los números', e));
      setInterval(() => void procesarCola(), 15_000).unref();
      setTimeout(sincronizar, 30_000);
      setInterval(sincronizar, 5 * 60_000).unref();
    }
  }
}
