/**
 * Actualiza los permisos guardados en la base después de una versión que
 * agregó o sacó permisos. Es idempotente: cada cambio se aplica una sola vez.
 *
 *   docker compose run --rm tools npx tsx prisma/actualizar-permisos.ts
 *
 * Lo corre deploy.sh solo. Se aplica a los roles de todos los clientes. Los
 * roles que nunca se editaron no tienen fila en la base y ya toman los valores
 * nuevos de src/lib/permisos.ts; los clientes nuevos nacen con esos valores.
 */
import { PrismaClient, type Role } from '@prisma/client';
import { CAMBIOS_PERMISOS } from '../src/lib/permisos';

const db = new PrismaClient();
const CLAVE = 'permisos.versiones';
/** Clave de la versión anterior de este script, que guardaba una sola versión */
const CLAVE_VIEJA = 'permisos.version';

async function main() {
  const guardado = await db.setting.findUnique({ where: { key: CLAVE } });
  const viejo = await db.setting.findUnique({ where: { key: CLAVE_VIEJA } });
  const aplicadas = new Set<string>(guardado ? JSON.parse(guardado.value) : []);
  if (viejo) aplicadas.add(viejo.value);

  const pendientes = CAMBIOS_PERMISOS.filter((c) => !aplicadas.has(c.version));
  if (pendientes.length === 0) {
    console.log('Permisos ya actualizados');
    return;
  }

  for (const cambio of pendientes) {
    const filas = await db.rolePermisos.findMany();
    for (const fila of filas) {
      const role = fila.role as Role;
      const agregar = cambio.agregar[role] ?? [];
      const quitar = cambio.quitar?.[role] ?? [];
      if (agregar.length === 0 && quitar.length === 0) continue;
      const nuevos = [...new Set([...fila.permisos, ...agregar])].filter((p) => !quitar.includes(p));
      await db.rolePermisos.update({ where: { tenantId_role: { tenantId: fila.tenantId, role } }, data: { permisos: nuevos } });
      console.log(`${cambio.version} · ${fila.tenantId} · ${role}: +${agregar.filter((a) => !fila.permisos.includes(a)).length} -${quitar.filter((q) => fila.permisos.includes(q)).length}`);
    }
    aplicadas.add(cambio.version);
  }

  await db.setting.upsert({
    where: { key: CLAVE },
    update: { value: JSON.stringify([...aplicadas]) },
    create: { key: CLAVE, value: JSON.stringify([...aplicadas]) },
  });
  console.log('Permisos actualizados');
}

main().finally(() => db.$disconnect());
