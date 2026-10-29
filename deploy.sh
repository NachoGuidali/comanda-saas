#!/usr/bin/env bash
# Despliegue completo en un servidor con Docker. Sirve para la primera vez y
# para cada actualización.
set -euo pipefail

cd "$(dirname "$0")"

if [ ! -f .env ]; then
  echo "Falta el archivo .env. Copialo desde .env.example y completalo."
  exit 1
fi

for var in DB_PASSWORD AUTH_SECRET SAAS_DOMINIO; do
  if ! grep -qE "^${var}=.+" .env; then
    echo "Falta ${var} en el .env."
    exit 1
  fi
done

echo "==> Levantando la base de datos"
docker compose up -d db
until docker compose exec -T db pg_isready -U pizzeria >/dev/null 2>&1; do
  sleep 2
done

# Antes de tocar el esquema, una copia de todo. Si algo sale mal, se vuelve
# con las instrucciones de "Restaurar" del README.
mkdir -p backups
TABLAS=$(docker compose exec -T db psql -U pizzeria -d pizzeria -tAc \
  "select count(*) from information_schema.tables where table_schema='public'" 2>/dev/null || echo 0)
if [ "${TABLAS:-0}" -gt 0 ]; then
  ARCHIVO="backups/antes-de-actualizar-$(date +%Y%m%d-%H%M%S).sql.gz"
  echo "==> Copia de seguridad en ${ARCHIVO}"
  docker compose exec -T db pg_dump -U pizzeria pizzeria | gzip > "${ARCHIVO}"
fi

echo "==> Construyendo la aplicación"
docker compose build app tools

echo "==> Aplicando el esquema"
# Sin --accept-data-loss a propósito: si un cambio fuera a borrar datos,
# Prisma frena y avisa en vez de borrarlos en silencio.
if ! docker compose run --rm tools npx prisma db push --skip-generate; then
  echo ""
  echo "El cambio de esquema se frenó para no perder datos. No se tocó nada."
  echo "La aplicación sigue con la versión anterior. Revisá el mensaje de arriba."
  exit 1
fi

echo "==> Actualizando permisos de los roles"
docker compose run --rm tools npx tsx prisma/actualizar-permisos.ts

if grep -qE "^PLATAFORMA_EMAIL=.+" .env && grep -qE "^PLATAFORMA_PASSWORD=.+" .env; then
  echo "==> Administrador de la plataforma y planes"
  docker compose run --rm tools npx tsx prisma/plataforma.ts
fi

if [ "${1:-}" = "--con-datos" ]; then
  echo "==> Cargando el cliente de ejemplo (Pepperino Pizza) con su carta y usuarios"
  docker compose run --rm tools npx tsx prisma/seed.ts
fi

echo "==> Levantando todo"
docker compose up -d

echo ""
BASE=$(grep '^SAAS_DOMINIO=' .env | cut -d= -f2)
echo "Listo. La plataforma está en https://${BASE}"
echo "Cada cliente: https://<cliente>.${BASE} (carta) y https://<cliente>.${BASE}/admin (panel)"
echo "Panel de la plataforma (alta de clientes, planes, cobros): https://${BASE}/plataforma"
