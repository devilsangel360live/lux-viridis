import { existsSync } from "node:fs";

import type { Config } from "drizzle-kit";

export default {
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "sqlite",
  dbCredentials: {
    // Mirrors resolveDbFile() in src/db/index.ts: prefer the current name, but
    // fall back to the pre-rename file so migrations target an existing install.
    url:
      process.env.DATABASE_FILE ??
      (existsSync("./data/lux.db") || !existsSync("./data/verbum.db")
        ? "./data/lux.db"
        : "./data/verbum.db"),
  },
} satisfies Config;
