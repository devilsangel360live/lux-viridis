/**
 * Applies pending migrations before the server starts.
 *
 * Deliberately does NOT use drizzle: Next inlines drizzle-orm into the server
 * chunks rather than tracing it as a package, so it is not resolvable from the
 * standalone bundle. better-sqlite3 *is* present (it is a native addon and
 * stays external), so the journal is applied with plain SQL instead — which
 * also means the runtime image needs no extra install and no compiler.
 *
 * The journal format matches drizzle-kit's: each .sql file is a list of
 * statements separated by `--> statement-breakpoint`, applied in the order
 * given by meta/_journal.json.
 */
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import path from "node:path";
import fs from "node:fs";

const require = createRequire(import.meta.url);
const Database = require("better-sqlite3");

const file = process.env.DATABASE_FILE ?? "/data/lux.db";
const folder = path.join(process.cwd(), "drizzle");

fs.mkdirSync(path.dirname(file), { recursive: true });

const db = new Database(file);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

// Mirrors drizzle's own bookkeeping table, so migrations already applied by
// `npm run db:migrate` during development are not re-run here.
db.exec(`CREATE TABLE IF NOT EXISTS __drizzle_migrations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  hash TEXT NOT NULL,
  created_at NUMERIC
)`);

const journalPath = path.join(folder, "meta", "_journal.json");
if (!fs.existsSync(journalPath)) {
  console.error(`[lux] no migration journal at ${journalPath}`);
  process.exit(1);
}

const journal = JSON.parse(fs.readFileSync(journalPath, "utf8"));
const applied = new Set(
  db.prepare("SELECT hash FROM __drizzle_migrations").all().map((r) => r.hash),
);

let count = 0;
for (const entry of journal.entries) {
  const sqlPath = path.join(folder, `${entry.tag}.sql`);
  if (!fs.existsSync(sqlPath)) {
    console.error(`[lux] missing migration file ${sqlPath}`);
    process.exit(1);
  }

  const sql = fs.readFileSync(sqlPath, "utf8");

  /**
   * Identity must match drizzle's exactly — sha256 of the whole file — so a
   * database migrated by `npm run db:migrate` in development is recognised as
   * current here. Keying on the filename instead would make the container
   * re-run every migration and crash on "table already exists".
   */
  const hash = createHash("sha256").update(sql).digest("hex");
  if (applied.has(hash)) continue;

  const statements = sql
    .split("--> statement-breakpoint")
    .map((s) => s.trim())
    .filter(Boolean);

  // One transaction per migration: a half-applied schema change is worse than
  // a failed start, because the next boot would see an inconsistent database.
  const run = db.transaction(() => {
    for (const statement of statements) db.exec(statement);
    db.prepare("INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)").run(
      hash,
      entry.when ?? Date.now(),
    );
  });

  run();
  count += 1;
  console.log(`[lux] applied ${entry.tag}`);
}

db.close();
console.log(
  count === 0
    ? `[lux] schema already current (${file})`
    : `[lux] ${count} migration(s) applied to ${file}`,
);
