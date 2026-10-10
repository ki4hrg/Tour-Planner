# syntax=docker/dockerfile:1

# --- deps: install all dependencies (incl. dev, for the build) ---
FROM node:24-alpine AS deps
RUN apk add --no-cache libc6-compat openssl
WORKDIR /app
COPY package.json package-lock.json .npmrc ./
# Schema must be present for the `postinstall: prisma generate` hook.
COPY prisma ./prisma
# Cache mount persists npm's tarball cache across builds so a dependency
# change re-installs only the delta instead of re-downloading everything.
RUN --mount=type=cache,id=npm,target=/root/.npm npm ci

# --- builder: generate Prisma client + build Next.js (standalone) ---
FROM node:24-alpine AS builder
RUN apk add --no-cache libc6-compat openssl
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# Prisma client must be generated before the Next build.
RUN npx prisma generate
# SW + manifest are produced here; ensure NODE_ENV=production so Serwist runs.
ENV NEXT_TELEMETRY_DISABLED=1
# Cache mount persists Next's incremental build cache (.next/cache) across
# builds. This is the dominant recurring cost — the build re-runs on every
# code change since `COPY . .` above invalidates the layer.
RUN --mount=type=cache,id=nextjs,target=/app/.next/cache npm run build

# --- prisma-cli: a lean, self-contained Prisma CLI for boot-time migrations ---
# Installed into its own tree so it carries ALL of the CLI's transitive deps
# (e.g. `effect`) without bloating — and without disturbing the app's
# standalone-traced node_modules.
FROM node:24-alpine AS prisma-cli
RUN apk add --no-cache libc6-compat openssl
WORKDIR /prisma-cli
COPY package.json .npmrc ./
RUN --mount=type=cache,id=npm,target=/root/.npm \
  PV=$(node -p "(require('./package.json').devDependencies.prisma||'').replace(/[^0-9.]/g,'')") \
  && npm init -y >/dev/null 2>&1 \
  && npm install prisma@"$PV" --no-save --no-audit --no-fund
COPY prisma ./prisma

# --- runner: minimal runtime image ---
FROM node:24-alpine AS runner
RUN apk add --no-cache libc6-compat openssl
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3076
# Next's standalone server.js binds to $HOSTNAME, which Docker sets to the
# container ID — that resolves to the container IP only, so 127.0.0.1 (the
# healthcheck) gets ECONNREFUSED. Bind all interfaces instead.
ENV HOSTNAME=0.0.0.0

# Non-root runtime user.
RUN addgroup --system --gid 1001 nodejs \
  && adduser --system --uid 1001 nextjs

# Next.js standalone output (includes a traced node_modules with @prisma/client).
COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

# Complete Prisma CLI + schema/migrations for `migrate deploy` at boot.
COPY --from=prisma-cli /prisma-cli/node_modules /prisma-cli/node_modules
COPY --from=prisma-cli /prisma-cli/prisma /prisma-cli/prisma

COPY docker/entrypoint.sh ./entrypoint.sh
RUN chmod +x ./entrypoint.sh

USER nextjs
EXPOSE 3076
ENTRYPOINT ["./entrypoint.sh"]
