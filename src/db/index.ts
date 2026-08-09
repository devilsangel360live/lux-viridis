import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import path from "node:path";
import fs from "node:fs";

import * as schema from "./schema";

/**
 * Next dev reloads this module on every edit; without the global cache each
 * reload opens another handle to the same file and they fight over the lock.
 */
const globalForDb = globalThis as unknown as {
  __sqlite?: Database.Database;
};

/**
 * Resolves the database file.
 *
 * The app was formerly called Verbum Lox, so an existing install has
 * `data/verbum.db`. That name is honoured when present rather than silently
 * starting a fresh, empty database beside it — losing someone's novel to a
 * rename would be unforgivable.
 */
function resolveDbFile(): string {
  if (process.env.DATABASE_FILE) return process.env.DATABASE_FILE;

  const dir = path.join(process.cwd(), "data");
  const current = path.join(dir, "lux.db");
  const legacy = path.join(dir, "verbum.db");

  if (!fs.existsSync(current) && fs.existsSync(legacy)) return legacy;
  return current;
}

function createClient() {
  const file = resolveDbFile();
  fs.mkdirSync(path.dirname(file), { recursive: true });

  const client = new Database(file);

  /**
   * Wait for a held lock instead of failing on contact.
   *
   * SQLite's default busy timeout is zero: a connection that finds the write
   * lock taken throws SQLITE_BUSY immediately rather than waiting the few
   * milliseconds the holder needs. Two consequences, both real here.
   *
   * At runtime, two writers saving at once — or an autosave landing while the
   * nightly backup checkpoints — means one of them simply fails. The editor
   * marks itself errored and that debounced save is lost, which is the only
   * path in this app that can silently drop prose.
   *
   * At build time it is worse, because `next build` collects page data with
   * several workers in parallel and each one evaluates this module. They race
   * to set journal_mode below, which needs an exclusive lock, and the losers
   * abort the whole build with "database is locked".
   *
   * Set before any other statement, since the pragma below can itself block.
   */
  client.pragma("busy_timeout = 5000");

  // WAL lets the editor autosave while the binder reads, instead of serialising.
  client.pragma("journal_mode = WAL");
  client.pragma("foreign_keys = ON");
  return client;
}

const client = globalForDb.__sqlite ?? createClient();
if (process.env.NODE_ENV !== "production") globalForDb.__sqlite = client;

export const db = drizzle(client, { schema });
export { schema };
