# syntax=docker/dockerfile:1

###############################################################################
# Lux Viridis
#
# Multi-stage so the compiler toolchain that better-sqlite3 needs never reaches
# the runtime image. Node 22 because Next 16 wants >= 20.19 and 22 is the
# current LTS.
###############################################################################

FROM node:22-bookworm-slim AS deps
WORKDIR /app

# python3/make/g++ are required to build better-sqlite3 from source. They exist
# only in this stage.
RUN apt-get update && apt-get install -y --no-install-recommends \
      python3 make g++ ca-certificates \
    && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
RUN npm ci


###############################################################################
FROM node:22-bookworm-slim AS builder
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Next collects page data at build time; nothing here touches a real database,
# but the module still resolves a path, so point it somewhere writable.
ENV NEXT_TELEMETRY_DISABLED=1
ENV DATABASE_FILE=/tmp/build.db

RUN npm run build


###############################################################################
FROM node:22-bookworm-slim AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
# The database lives on a mounted volume, never inside the image.
ENV DATABASE_FILE=/data/lux.db

# Run as a non-root user. The numeric id is fixed so the volume's ownership on
# the host stays predictable across rebuilds.
RUN groupadd --system --gid 1001 nodejs \
    && useradd --system --uid 1001 --gid nodejs lux

COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public

# Migrations run at startup. The SQL files and a plain-JS runner are all that is
# needed — better-sqlite3 and drizzle already sit in the traced bundle, so no
# extra install (and no compiler) is required here.
COPY --from=builder /app/drizzle ./drizzle
COPY --from=builder /app/scripts/migrate-standalone.mjs ./scripts/migrate-standalone.mjs
# Account management from the server shell — the only way to add a second
# account or reset a forgotten password on a deployment, since setup refuses
# to run once an account exists.
COPY --from=builder /app/scripts/user-standalone.mjs ./scripts/user-standalone.mjs
# The readable Markdown backup, run on a timer by the `stories` service and
# available by hand: docker exec lux-viridis node scripts/backup-stories.mjs
COPY --from=builder /app/scripts/backup-stories.mjs ./scripts/backup-stories.mjs
COPY --from=builder /app/docker-entrypoint.sh /usr/local/bin/entrypoint.sh

RUN chmod +x /usr/local/bin/entrypoint.sh \
    && mkdir -p /data \
    && chown -R lux:nodejs /data /app

USER lux
EXPOSE 3000
VOLUME ["/data"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/login').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
CMD ["node", "server.js"]
