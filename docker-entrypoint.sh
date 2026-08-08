#!/bin/sh
set -e

# Migrations run on every start, before the server accepts traffic. A deploy
# that added a column must never serve requests against the old schema.
echo "[lux] applying migrations…"
node scripts/migrate-standalone.mjs

exec "$@"
