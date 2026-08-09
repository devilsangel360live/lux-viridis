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
   * Wait for a held lock rather than failing on contact.
   *
   * SQLite's default busy timeout is zero, so a connection that finds the write
   * lock taken throws SQLITE_BUSY immediately instead of waiting the few
   * milliseconds the holder needs. Without this, two writers saving at once —
   * or an autosave landing while the nightly backup checkpoints — means one
   * save simply fails, and the editor drops that debounced write.
   *
   * Note this does NOT cover the journal_mode switch below: changing journal
   * mode needs an exclusive lock that SQLite refuses to wait for, returning
   * SQLITE_BUSY after 0ms if any other connection holds a write transaction.
   * That case is handled by not opening the database at build time at all —
   * see the lazy getter below.
   */
  client.pragma("busy_timeout = 5000");

  // WAL lets the editor autosave while the binder reads, instead of serialising.
  client.pragma("journal_mode = WAL");
  client.pragma("foreign_keys = ON");
  return client;
}

/**
 * The connection is opened on first use, not on import.
 *
 * This matters because `next build` collects page data with several workers in
 * parallel, and every route that imports this module used to open a connection
 * just by being evaluated. On a fresh database they then race to set
 * journal_mode, and that switch needs an exclusive lock which SQLite refuses to
 * wait for — it returns SQLITE_BUSY after 0ms regardless of busy_timeout, so
 * the losers abort the build with "database is locked".
 *
 * Deferring the open fixes it at the source: collecting page data only
 * evaluates modules, it never runs a query, so during a build no connection is
 * ever opened and there is nothing to contend over. It also means a build needs
 * no writable DATABASE_FILE at all.
 */
function getClient(): Database.Database {
  if (!globalForDb.__sqlite) {
    globalForDb.__sqlite = createClient();
  }
  return globalForDb.__sqlite;
}

/**
 * Proxied so `db.select()` resolves the client at call time. A plain
 * `drizzle(getClient())` here would defeat the laziness by opening the database
 * as this module is evaluated — exactly what the getter above avoids.
 *
 * The client is cached on globalThis in every environment, not just
 * development: it is the memo backing the getter, and Next's dev reload needs
 * it to avoid opening a second handle to the same file on every edit.
 */
export const db = new Proxy({} as ReturnType<typeof drizzle<typeof schema>>, {
  get(_target, prop, receiver) {
    const instance = drizzle(getClient(), { schema });
    return Reflect.get(instance, prop, receiver);
  },
});

export { schema };
