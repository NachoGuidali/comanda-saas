/**
 * La zona horaria del local. En orden: APP_TIMEZONE (la que se configura a
 * mano, también en Vercel); TZ si alguien la definió (Docker), salvo que sea
 * UTC, que es lo que traen los servidores por defecto; y si no, Argentina.
 */
export function zonaDelLocal(): string {
  const app = process.env.APP_TIMEZONE?.trim();
  if (app) return app;
  const tz = process.env.TZ?.replace(/^:/, '').trim();
  if (tz && !/^(UTC|Etc\/UTC|GMT|Etc\/GMT)$/i.test(tz)) return tz;
  return 'America/Argentina/Buenos_Aires';
}
