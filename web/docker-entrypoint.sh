#!/bin/sh
set -e

echo "==> Running Prisma database migrations..."
if ./migrate-cli/node_modules/.bin/prisma migrate deploy --schema ./prisma/schema.prisma; then
  echo "==> Database migrations applied successfully."
else
  echo "==> WARNING: Prisma migration failed or database was not reachable." >&2
  echo "==> Continuing startup so server can accept health checks and log details..." >&2
fi

echo "==> Starting Next.js server on port ${PORT:-8080}..."
exec node server.js
