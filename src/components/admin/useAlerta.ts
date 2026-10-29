'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Alerta sonora para pedidos nuevos.
 *
 * El sonido se genera con WebAudio, sin archivos. Los navegadores no dejan
 * sonar nada hasta que la persona toca la pantalla al menos una vez: por eso
 * se expone `activo` y `activar`, para mostrar un botón "Activar sonido" que
 * quede a la vista hasta que el audio esté habilitado. Antes el tablero tenía
 * un audio mudo y nadie se enteraba de que el sonido no andaba.
 *
 * Además del sonido, el título de la pestaña parpadea: sirve cuando el
 * tablero está abierto detrás de otra ventana.
 */
export function useAlerta() {
  const ctxRef = useRef<AudioContext | null>(null);
  const [activo, setActivo] = useState(false);
  const tituloOriginal = useRef<string>('');
  const parpadeo = useRef<ReturnType<typeof setInterval> | null>(null);

  const activar = useCallback(async () => {
    try {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!ctxRef.current) ctxRef.current = new Ctor();
      await ctxRef.current.resume();
      setActivo(ctxRef.current.state === 'running');
    } catch {
      setActivo(false);
    }
  }, []);

  // Cualquier toque en la pantalla habilita el audio sin tener que buscar el botón
  useEffect(() => {
    const alTocar = () => { void activar(); };
    window.addEventListener('pointerdown', alTocar, { once: true });
    return () => window.removeEventListener('pointerdown', alTocar);
  }, [activar]);

  const dejarDeParpadear = useCallback(() => {
    if (parpadeo.current) clearInterval(parpadeo.current);
    parpadeo.current = null;
    if (tituloOriginal.current) document.title = tituloOriginal.current;
  }, []);

  useEffect(() => {
    const alVolver = () => { if (!document.hidden) dejarDeParpadear(); };
    document.addEventListener('visibilitychange', alVolver);
    window.addEventListener('focus', dejarDeParpadear);
    return () => {
      document.removeEventListener('visibilitychange', alVolver);
      window.removeEventListener('focus', dejarDeParpadear);
      dejarDeParpadear();
    };
  }, [dejarDeParpadear]);

  /** Tres pitidos cortos, bien audibles en una cocina con ruido. */
  const sonar = useCallback((texto = 'Pedido nuevo') => {
    const ctx = ctxRef.current;
    if (ctx && ctx.state === 'running') {
      const t0 = ctx.currentTime;
      for (let i = 0; i < 3; i++) {
        const osc = ctx.createOscillator();
        const gan = ctx.createGain();
        osc.type = 'square';
        osc.frequency.value = i === 2 ? 1320 : 880;
        const t = t0 + i * 0.22;
        gan.gain.setValueAtTime(0.0001, t);
        gan.gain.exponentialRampToValueAtTime(0.35, t + 0.01);
        gan.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
        osc.connect(gan).connect(ctx.destination);
        osc.start(t);
        osc.stop(t + 0.2);
      }
    }

    if (document.hidden && !parpadeo.current) {
      tituloOriginal.current = document.title;
      let alterna = false;
      parpadeo.current = setInterval(() => {
        document.title = alterna ? tituloOriginal.current : `🔔 ${texto}`;
        alterna = !alterna;
      }, 1000);
    }
  }, []);

  return { activo, activar, sonar };
}
