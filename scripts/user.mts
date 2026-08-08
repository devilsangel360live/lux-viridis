import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";

import { eq } from "drizzle-orm";

import { db } from "../src/db/index";
import { users } from "../src/db/schema";
import { createUser, findUserByEmail, forcePassword } from "../src/server/auth";

/**
 * Account management from the server shell.
 *
 * This is the last-resort recovery path: if the security questions are also
 * forgotten, whoever has access to the machine can still reset a password.
 * On a family server, physical access to the box is a reasonable proof of
 * identity — and there is no email service to send a reset link through.
 *
 *   npm run user -- list
 *   npm run user -- add
 *   npm run user -- passwd <email>
 *   npm run user -- remove <email>
 */

const rl = createInterface({ input: stdin, output: stdout });

async function ask(question: string): Promise<string> {
  return (await rl.question(question)).trim();
}

/** Reads a line without echoing it, so passwords stay off the screen. */
async function askSecret(question: string): Promise<string> {
  stdout.write(question);
  const wasRaw = stdin.isRaw;
  stdin.setRawMode?.(true);

  return new Promise((resolve) => {
    let value = "";
    const onData = (chunk: Buffer) => {
      const char = chunk.toString("utf8");
      if (char === "\n" || char === "\r" || char === "\u0004") {
        stdin.setRawMode?.(wasRaw ?? false);
        stdin.off("data", onData);
        stdout.write("\n");
        resolve(value);
        return;
      }
      if (char === "\u0003") {
        stdout.write("\n");
        process.exit(1);
      }
      if (char === "\u007f" || char === "\b") {
        value = value.slice(0, -1);
        return;
      }
      value += char;
    };
    stdin.on("data", onData);
  });
}

async function main() {
  const [command, arg] = process.argv.slice(2);

  switch (command) {
    case "list": {
      const rows = await db.select().from(users);
      if (rows.length === 0) {
        console.log("No accounts yet. The first visit to the app offers setup.");
        break;
      }
      for (const u of rows) {
        const recovery = u.recoveryQuestion1 ? "recovery set" : "NO recovery";
        console.log(`  ${u.email.padEnd(30)} ${u.name.padEnd(20)} ${recovery}`);
      }
      break;
    }

    case "add": {
      const email = await ask("Email: ");
      if (await findUserByEmail(email)) {
        console.error(`An account already exists for ${email}.`);
        process.exitCode = 1;
        break;
      }
      const name = await ask("Name: ");
      const password = await askSecret("Password: ");
      if (password.length < 8) {
        console.error("Password must be at least 8 characters.");
        process.exitCode = 1;
        break;
      }
      const user = await createUser({ email, name, password });
      console.log(`Created ${user.email}.`);
      console.log("Set recovery questions from the account menu after signing in.");
      break;
    }

    case "passwd": {
      if (!arg) {
        console.error("Usage: npm run user -- passwd <email>");
        process.exitCode = 1;
        break;
      }
      const user = await findUserByEmail(arg);
      if (!user) {
        console.error(`No account for ${arg}.`);
        process.exitCode = 1;
        break;
      }
      const password = await askSecret("New password: ");
      const confirm = await askSecret("Confirm:      ");
      if (password !== confirm) {
        console.error("Passwords did not match.");
        process.exitCode = 1;
        break;
      }
      if (password.length < 8) {
        console.error("Password must be at least 8 characters.");
        process.exitCode = 1;
        break;
      }
      // Also ends every existing session for that user.
      await forcePassword(user.id, password);
      console.log(`Password updated for ${user.email}. Other sessions signed out.`);
      break;
    }

    case "remove": {
      if (!arg) {
        console.error("Usage: npm run user -- remove <email>");
        process.exitCode = 1;
        break;
      }
      const user = await findUserByEmail(arg);
      if (!user) {
        console.error(`No account for ${arg}.`);
        process.exitCode = 1;
        break;
      }
      const answer = await ask(
        `Delete ${user.email} AND all of their projects? This cannot be undone. [y/N] `,
      );
      if (answer.toLowerCase() !== "y") {
        console.log("Cancelled.");
        break;
      }
      await db.delete(users).where(eq(users.id, user.id));
      console.log(`Deleted ${user.email}.`);
      break;
    }

    default:
      console.log("Usage: npm run user -- <list|add|passwd|remove> [email]");
  }

  rl.close();
}

await main();
