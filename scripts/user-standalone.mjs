/**
 * Account management from inside the deployed container.
 *
 *   docker exec -it lux-viridis node scripts/user-standalone.mjs list
 *   docker exec -it lux-viridis node scripts/user-standalone.mjs add
 *   docker exec -it lux-viridis node scripts/user-standalone.mjs passwd <email>
 *   docker exec -it lux-viridis node scripts/user-standalone.mjs remove <email>
 *
 * Plain JS and plain SQL for the same reason as migrate-standalone.mjs: the
 * runtime image is Next's standalone bundle, which has no tsx and no
 * drizzle-orm resolvable from disk. `scripts/user.mts` is the development
 * equivalent and stays the nicer tool to use on a dev machine.
 *
 * This is also the last-resort recovery path. If a password and both security
 * answers are forgotten, whoever can reach the server shell can still reset it
 * — on a family server, access to the box is reasonable proof of identity, and
 * there is no mail service here to send a reset link through.
 *
 * The hashes written here must match src/server/auth.ts exactly: scrypt with a
 * 16-byte hex salt and a 64-byte key, stored as `salt:key`. A mismatch would
 * produce an account that cannot log in.
 */
import { createRequire } from "node:module";
import { randomBytes, randomUUID, scrypt, timingSafeEqual } from "node:crypto";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { promisify } from "node:util";

const require = createRequire(import.meta.url);
const Database = require("better-sqlite3");

const scryptAsync = promisify(scrypt);
const KEY_LENGTH = 64;

const file = process.env.DATABASE_FILE ?? "/data/lux.db";
const db = new Database(file);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

async function hashPassword(password) {
  const salt = randomBytes(16).toString("hex");
  const key = await scryptAsync(password, salt, KEY_LENGTH);
  return `${salt}:${key.toString("hex")}`;
}

async function verifyPassword(password, stored) {
  const [salt, hex] = String(stored).split(":");
  if (!salt || !hex) return false;
  const expected = Buffer.from(hex, "hex");
  const actual = await scryptAsync(password, salt, KEY_LENGTH);
  if (expected.length !== actual.length) return false;
  return timingSafeEqual(expected, actual);
}

/**
 * A readline interface is created per prompt and closed immediately.
 *
 * A long-lived one cannot be combined with the raw-mode reader below: while it
 * exists it owns stdin's terminal mode, so `setRawMode(true)` does not take
 * effect and the password is echoed to the screen in plain text. `rl.pause()`
 * is not enough — only closing it releases stdin.
 */
async function ask(question) {
  const rl = createInterface({ input: stdin, output: stdout });
  try {
    return (await rl.question(question)).trim();
  } finally {
    rl.close();
  }
}

/** Reads a line without echoing it, so passwords stay off the screen. */
async function askSecret(question) {
  // No TTY (e.g. `docker exec` without -it) means raw mode is unavailable and
  // the password would echo. Better to refuse than to leak it into scrollback.
  if (!stdin.isTTY) {
    throw new Error("Needs an interactive terminal — run docker exec with -it.");
  }

  stdout.write(question);

  const wasRaw = stdin.isRaw;
  stdin.setRawMode?.(true);
  stdin.resume();

  return new Promise((resolve) => {
    let value = "";
    const finish = () => {
      stdin.setRawMode?.(wasRaw ?? false);
      stdin.off("data", onData);
      stdout.write("\n");
      resolve(value);
    };

    /**
     * A chunk is not necessarily one keystroke: a terminal (and anything
     * piping input) can deliver "secret\n" in a single read. Comparing the
     * whole chunk against "\n" therefore never matches the Enter key, and the
     * prompt hangs forever — so iterate character by character.
     */
    const onData = (chunk) => {
      for (const char of chunk.toString("utf8")) {
        if (char === "\n" || char === "\r" || char === "\u0004") {
          finish();
          return;
        }
        if (char === "\u0003") {
          stdin.setRawMode?.(wasRaw ?? false);
          stdout.write("\n");
          process.exit(1);
        }
        if (char === "\u007f" || char === "\b") {
          value = value.slice(0, -1);
          continue;
        }
        value += char;
      }
    };
    stdin.on("data", onData);
  });
}

const findByEmail = (email) =>
  db.prepare("SELECT * FROM users WHERE email = ?").get(email.trim().toLowerCase());

async function main() {
  const [command, arg] = process.argv.slice(2);

  switch (command) {
    case "list": {
      const rows = db.prepare("SELECT email, name, created_at FROM users ORDER BY created_at").all();
      if (rows.length === 0) {
        console.log("No accounts yet — the first visit to the site will offer setup.");
        break;
      }
      for (const r of rows) {
        console.log(`${r.email}\t${r.name}\t${new Date(r.created_at).toISOString().slice(0, 10)}`);
      }
      break;
    }

    case "add": {
      const email = (await ask("Email: ")).toLowerCase();
      if (!email.includes("@")) {
        console.error("That does not look like an email address.");
        process.exitCode = 1;
        break;
      }
      if (findByEmail(email)) {
        console.error(`${email} already has an account.`);
        process.exitCode = 1;
        break;
      }

      const name = await ask("Display name: ");
      const password = await askSecret("Password: ");
      if (password.length < 8) {
        console.error("Password must be at least 8 characters.");
        process.exitCode = 1;
        break;
      }
      const confirm = await askSecret("Confirm password: ");
      if (password !== confirm) {
        console.error("Passwords did not match.");
        process.exitCode = 1;
        break;
      }

      db.prepare(
        `INSERT INTO users (id, email, name, password_hash, created_at)
         VALUES (?, ?, ?, ?, ?)`,
      ).run(randomUUID(), email, name || email, await hashPassword(password), Date.now());

      console.log(`\nCreated ${email}.`);
      console.log("No recovery questions are set — add them from the account menu after signing in.");
      break;
    }

    case "passwd": {
      if (!arg) {
        console.error("Usage: node scripts/user-standalone.mjs passwd <email>");
        process.exitCode = 1;
        break;
      }
      const user = findByEmail(arg);
      if (!user) {
        console.error(`No account for ${arg}.`);
        process.exitCode = 1;
        break;
      }

      const password = await askSecret("New password: ");
      if (password.length < 8) {
        console.error("Password must be at least 8 characters.");
        process.exitCode = 1;
        break;
      }
      const confirm = await askSecret("Confirm password: ");
      if (password !== confirm) {
        console.error("Passwords did not match.");
        process.exitCode = 1;
        break;
      }

      db.prepare("UPDATE users SET password_hash = ? WHERE id = ?").run(
        await hashPassword(password),
        user.id,
      );
      // Any existing session belongs to whoever knew the old password.
      db.prepare("DELETE FROM sessions WHERE user_id = ?").run(user.id);

      console.log(`\nPassword changed for ${user.email}. Other sessions signed out.`);
      break;
    }

    case "remove": {
      if (!arg) {
        console.error("Usage: node scripts/user-standalone.mjs remove <email>");
        process.exitCode = 1;
        break;
      }
      const user = findByEmail(arg);
      if (!user) {
        console.error(`No account for ${arg}.`);
        process.exitCode = 1;
        break;
      }

      /**
       * `projects.owner_id` has no ON DELETE CASCADE, so SQLite refuses to
       * delete an account that still owns projects rather than orphaning or
       * destroying them. That is the right default — someone's manuscripts
       * should not disappear as a side effect of tidying up accounts — but it
       * surfaces as a bare "FOREIGN KEY constraint failed" unless handled here.
       *
       * Note `owner_id`, not `user_id`: the sessions table uses the other name.
       */
      const owned = db
        .prepare("SELECT id, title FROM projects WHERE owner_id = ?")
        .all(user.id);

      if (owned.length > 0) {
        console.log(`\n${user.email} owns ${owned.length} project(s):`);
        for (const p of owned) console.log(`  · ${p.title}`);

        const others = db
          .prepare("SELECT id, email FROM users WHERE id != ? ORDER BY created_at")
          .all(user.id);

        if (others.length === 0) {
          console.log("\nThis is the only account, so there is nobody to hand them to.");
          console.log("Delete the projects from inside the app first, then remove the account.");
          process.exitCode = 1;
          break;
        }

        console.log("\nThe writing is kept. Transfer it to another account first:");
        others.forEach((o, i) => console.log(`  ${i + 1}) ${o.email}`));
        const pick = await ask("Transfer to (number, or blank to cancel): ");
        if (!pick) {
          console.log("Cancelled.");
          break;
        }

        const target = others[Number(pick) - 1];
        if (!target) {
          console.log("Not one of the listed numbers. Cancelled.");
          process.exitCode = 1;
          break;
        }

        const answer = await ask(`Move ${owned.length} project(s) to ${target.email} and delete ${user.email}? Type the email to confirm: `);
        if (answer.toLowerCase() !== user.email) {
          console.log("Cancelled.");
          break;
        }

        // One transaction: a half-done transfer would leave projects owned by
        // an account that no longer exists.
        db.transaction(() => {
          db.prepare("UPDATE projects SET owner_id = ? WHERE owner_id = ?").run(target.id, user.id);
          db.prepare("DELETE FROM sessions WHERE user_id = ?").run(user.id);
          db.prepare("DELETE FROM users WHERE id = ?").run(user.id);
        })();

        console.log(`\nMoved ${owned.length} project(s) to ${target.email}, removed ${user.email}.`);
        break;
      }

      const answer = await ask(`Delete ${user.email}? Type the email to confirm: `);
      if (answer.toLowerCase() !== user.email) {
        console.log("Cancelled.");
        break;
      }

      db.transaction(() => {
        db.prepare("DELETE FROM sessions WHERE user_id = ?").run(user.id);
        db.prepare("DELETE FROM users WHERE id = ?").run(user.id);
      })();
      console.log(`Removed ${user.email}.`);
      break;
    }

    case "verify": {
      // Confirms a password is accepted, for checking a reset actually worked.
      if (!arg) {
        console.error("Usage: node scripts/user-standalone.mjs verify <email>");
        process.exitCode = 1;
        break;
      }
      const user = findByEmail(arg);
      if (!user) {
        console.error(`No account for ${arg}.`);
        process.exitCode = 1;
        break;
      }
      const password = await askSecret("Password: ");
      console.log((await verifyPassword(password, user.password_hash)) ? "Correct." : "Incorrect.");
      break;
    }

    default:
      console.log("Usage: node scripts/user-standalone.mjs <list|add|passwd|remove|verify> [email]");
  }
}

try {
  await main();
} catch (error) {
  // A stack trace here would bury the one line that tells the reader what to
  // do — most failures are a missing `-it` or a typo, not a crash worth dumping.
  console.error(`\n${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
} finally {
  db.close();
}
