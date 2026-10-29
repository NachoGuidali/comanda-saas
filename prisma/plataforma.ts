/**
 * Crea (o actualiza la clave de) quien administra la plataforma:
 *
 *   npx tsx prisma/plataforma.ts --email vos@supregsolutions.com --password "clave-larga" [--nombre "Nacho"]
 *
 * También carga los planes de ejemplo si todavía no hay ninguno. Con Docker:
 * docker compose run --rm tools npx tsx prisma/plataforma.ts ...
 */
import bcrypt from 'bcryptjs';
import { db } from '../src/lib/db';

function argumentos(): Record<string, string> {
  const a = process.argv.slice(2);
  const r: Record<string, string> = {};
  for (let i = 0; i < a.length; i++) if (a[i].startsWith('--')) r[a[i].slice(2)] = a[i + 1] ?? '';
  return r;
}

async function main() {
  const a = argumentos();
  const email = (a.email || process.env.PLATAFORMA_EMAIL || '').toLowerCase().trim();
  const password = a.password || process.env.PLATAFORMA_PASSWORD || '';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || password.length < 10) {
    console.error('Uso: --email vos@dominio.com --password "al menos 10 caracteres"');
    process.exit(1);
  }
  const passwordHash = await bcrypt.hash(password, 10);
  await db.platformAdmin.upsert({
    where: { email },
    update: { passwordHash, active: true, tokenVersion: { increment: 1 } },
    create: { email, passwordHash, name: a.nombre || 'Administrador' },
  });
  console.log(`Administrador de la plataforma listo: ${email}`);

  if ((await db.plan.count()) === 0) {
    // Precios de ejemplo: se cambian desde el panel (Planes)
    await db.plan.createMany({
      data: [
        { name: 'Básico', price: 0, maxBranches: 1, maxUsers: 5, features: [], position: 0 },
        { name: 'Completo', price: 0, maxBranches: 1, maxUsers: 0, features: ['salon', 'insumos', 'sueldos', 'pago_online'], position: 1 },
        { name: 'Cadena', price: 0, maxBranches: 5, maxUsers: 0, features: ['salon', 'insumos', 'sueldos', 'pago_online'], position: 2 },
      ],
    });
    console.log('Planes de ejemplo cargados (Básico, Completo, Cadena), con precio 0: ponelos en el panel.');
  }
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => db.$disconnect());
