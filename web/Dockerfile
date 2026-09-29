# syntax=docker/dockerfile:1
# Stash — multi-stage build for Next.js 15 (standalone output) + Prisma.
#
# Stages:
#   deps    — install node_modules from the lockfile (cached layer)
#   build   — prisma generate + next build (standalone bundle)
#   runtime — minimal image: standalone server + prisma CLI for migrations
#
# The container runs `prisma migrate deploy` on startup, then starts the
# Next.js standalone server. No secrets are baked into the image; all
# configuration comes from runtime environment variables.

# ---------------------------------------------------------------------------
# deps: install dependencies
# ---------------------------------------------------------------------------
FROM node:22-alpine AS deps
WORKDIR /app

# Prisma engines on alpine need openssl / libc compat
RUN apk add --no-cache libc6-compat openssl

COPY package.json package-lock.json ./
RUN npm ci

# ---------------------------------------------------------------------------
# build: generate the Prisma client and build the Next.js app
# ---------------------------------------------------------------------------
FROM node:22-alpine AS build
WORKDIR /app

RUN apk add --no-cache libc6-compat openssl

COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Next.js may evaluate env at build time; provide a dummy DATABASE_URL so the
# build never needs (or embeds) a real connection string. Overridable via
# --build-arg, but the default is intentionally a placeholder — the real
# DATABASE_URL is injected at runtime only.
ARG DATABASE_URL="postgresql://build:build@localhost:5432/build"
ENV DATABASE_URL=${DATABASE_URL}
ENV NEXT_TELEMETRY_DISABLED=1

RUN npx prisma generate
RUN npm run build

# ---------------------------------------------------------------------------
# migrate-cli: a self-contained prisma CLI install (the CLI has transitive
# deps like `effect` beyond node_modules/prisma, so cherry-picking packages
# out of the app's node_modules is not enough)
# ---------------------------------------------------------------------------
FROM node:22-alpine AS migrate-cli
WORKDIR /cli
RUN apk add --no-cache libc6-compat openssl
# The app package.json is read for the version only, then removed: npm's
# resolver crashes ("Cannot read properties of null (reading 'edgesOut')")
# when --omit=dev runs against a package.json full of deps with no lockfile.
COPY package.json ./app-package.json
RUN PRISMA_VERSION="$(node -p "require('./app-package.json').dependencies.prisma")" \
    && rm app-package.json \
    && npm init -y > /dev/null \
    && npm install --no-package-lock --omit=dev "prisma@$PRISMA_VERSION" \
    && ./node_modules/.bin/prisma --version

# ---------------------------------------------------------------------------
# runtime: minimal image running as non-root
# ---------------------------------------------------------------------------
FROM node:22-alpine AS runtime
WORKDIR /app

RUN apk add --no-cache libc6-compat openssl

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV HOSTNAME=0.0.0.0
ENV PORT=8000

# Standalone output: server.js + a pruned node_modules live at the app root
# (no monorepo, so there is no nested web/ directory inside standalone/).
COPY --from=build --chown=node:node /app/.next/standalone ./
COPY --from=build --chown=node:node /app/.next/static ./.next/static
COPY --from=build --chown=node:node /app/public ./public

# Prisma schema + migrations, needed by `prisma migrate deploy` at startup.
COPY --from=build --chown=node:node /app/prisma ./prisma

# Self-contained prisma CLI (with all transitive deps + engines) for running
# migrations at container start. Kept outside ./node_modules so it can't
# shadow anything the standalone server traced.
COPY --from=migrate-cli --chown=node:node /cli/node_modules ./migrate-cli/node_modules

USER node
EXPOSE 8000

# Apply pending migrations, then hand PID 1 to the Next.js server.
ENTRYPOINT ["sh", "-c", "./migrate-cli/node_modules/.bin/prisma migrate deploy --schema ./prisma/schema.prisma && exec node server.js"]
