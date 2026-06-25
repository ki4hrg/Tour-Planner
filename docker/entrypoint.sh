#!/bin/sh
set -e

echo "[entrypoint] Applying database migrations..."
node node_modules/prisma/build/index.js migrate deploy

# Optionally seed on boot when SEED_ON_START=true (idempotent upserts).
if [ "$SEED_ON_START" = "true" ]; then
  echo "[entrypoint] Seeding database..."
  node node_modules/prisma/build/index.js db seed || echo "[entrypoint] Seed skipped/failed (continuing)."
fi

echo "[entrypoint] Starting Next.js server..."
exec node server.js
