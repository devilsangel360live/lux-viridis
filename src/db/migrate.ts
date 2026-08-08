import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import path from "node:path";

import { db } from "./index";

migrate(db, { migrationsFolder: path.join(process.cwd(), "drizzle") });
console.log("migrations applied");
