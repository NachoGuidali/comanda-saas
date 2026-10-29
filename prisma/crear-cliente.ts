/**
 * Da de alta un cliente desde la consola (lo mismo que "Nuevo cliente" en el
 * panel de la plataforma):
 *
 *   npx tsx prisma/crear-cliente.ts --slug lapizzeria --nombre "La Pizzería" \
 *     --email dueno@lapizzeria.com --password "una-clave-larga" \
 *     [--sucursal "La Pizzería Centro" --direccion "Calle 123" --whatsapp 5491100000000] \
 *     [--principal "#17320B" --acento "#AF0A0A" --fondo "#FFFFFF"] [--plan "Completo"] [--prueba 14]
 *
 * Con Docker: docker compose run --rm tools npx tsx prisma/crear-cliente.ts ...
 */
import { db } from '../src/lib/db';
import { crearCliente } from '../src/lib/clientes';

function argumentos(): Record<string, string> {
  const a = process.argv.slice(2);
  const r: Record<string, string> = {};
  for (let i = 0; i < a.length; i++) if (a[i].startsWith('--')) r[a[i].slice(2)] = a[i + 1] ?? '';
  return r;
}

async function main() {
  const a = argumentos();
  let planId: string | null = null;
  if (a.plan) {
    const plan = await db.plan.findUnique({ where: { name: a.plan } });
    if (!plan) { console.error(`No existe el plan "${a.plan}"`); process.exit(1); }
    planId = plan.id;
  }
  const r = await crearCliente({
    slug: a.slug, nombre: a.nombre, email: a.email, password: a.password,
    sucursal: a.sucursal, direccion: a.direccion, whatsapp: a.whatsapp,
    principal: a.principal, acento: a.acento, fondo: a.fondo, planId, diasPrueba: Number(a.prueba) || 0,
  });
  if (!r.ok) { console.error(`No se creó el cliente: ${r.error}`); process.exit(1); }
  const base = process.env.SAAS_DOMINIO || 'localhost';
  console.log(`Cliente creado: ${a.nombre}`);
  console.log(`  Carta:  https://${r.slug}.${base}`);
  console.log(`  Panel:  https://${r.slug}.${base}/admin  (${a.email})`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => db.$disconnect());
