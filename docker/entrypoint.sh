#!/bin/sh
set -e

echo "[entrypoint] Applying database migrations..."
node /prisma-cli/node_modules/prisma/build/index.js migrate deploy \
  --schema=/prisma-cli/prisma/schema.prisma

echo "[entrypoint] Starting Next.js server..."
exec node server.js
