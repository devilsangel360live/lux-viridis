import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { and, eq, gt, lt } from "drizzle-orm";
import { nanoid } from "nanoid";
import { cookies } from "next/headers";

import { db } from "@/db";
import { sessions, users, type User } from "@/db/schema";
import { RECOVERY_QUESTIONS } from "@/lib/recovery";

/**
 * Password and session handling.
 *
 * scrypt from node:crypto rather than bcrypt/argon2: it is memory-hard, needs no
 * native build (which would complicate the eventual container), and is what
 * Node ships for exactly this purpose.
 */

const scryptAsync = promisify(scrypt);

const SESSION_COOKIE = "vl_session";
const SESSION_DAYS = 30;
const KEY_LENGTH = 64;

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString("hex");
  const key = (await scryptAsync(password, salt, KEY_LENGTH)) as Buffer;
  return `${salt}:${key.toString("hex")}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [salt, hex] = stored.split(":");
  if (!salt || !hex) return false;

  const expected = Buffer.from(hex, "hex");
  const actual = (await scryptAsync(password, salt, KEY_LENGTH)) as Buffer;

  // Constant-time compare so a wrong password cannot be found by timing.
  if (expected.length !== actual.length) return false;
  return timingSafeEqual(expected, actual);
}


/**
 * Answers are compared after normalising case, accents and inner spacing, so
 * "St. Mary's" and "st marys" match. Recovery that fails on punctuation is
 * recovery that does not work.
 */
export function normaliseAnswer(answer: string): string {
  return answer
    // NFKD splits accented letters into base + combining mark, and the
    // allow-list below then drops the mark — so "Café" and "cafe" agree.
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export type RecoverySetup = {
  question1: string;
  answer1: string;
  question2: string;
  answer2: string;
};

export async function createUser(input: {
  email: string;
  name: string;
  password: string;
  recovery?: RecoverySetup | null;
}): Promise<User> {
  const recovery = input.recovery;

  const [user] = await db
    .insert(users)
    .values({
      id: nanoid(),
      email: input.email.trim().toLowerCase(),
      name: input.name.trim(),
      passwordHash: await hashPassword(input.password),
      recoveryQuestion1: recovery?.question1 ?? null,
      recoveryAnswer1: recovery ? await hashPassword(normaliseAnswer(recovery.answer1)) : null,
      recoveryQuestion2: recovery?.question2 ?? null,
      recoveryAnswer2: recovery ? await hashPassword(normaliseAnswer(recovery.answer2)) : null,
    })
    .returning();
  return user;
}

/** Changes a password, requiring the current one. Invalidates other sessions. */
export async function changePassword(
  userId: string,
  currentPassword: string,
  newPassword: string,
): Promise<boolean> {
  const [user] = await db.select().from(users).where(eq(users.id, userId));
  if (!user) return false;
  if (!(await verifyPassword(currentPassword, user.passwordHash))) return false;

  await db
    .update(users)
    .set({ passwordHash: await hashPassword(newPassword) })
    .where(eq(users.id, userId));

  return true;
}

/** Sets a password without knowing the old one — recovery and CLI use this. */
export async function forcePassword(userId: string, newPassword: string): Promise<void> {
  await db
    .update(users)
    .set({ passwordHash: await hashPassword(newPassword) })
    .where(eq(users.id, userId));

  // Any other session belongs to whoever knew the old password; end them all.
  await db.delete(sessions).where(eq(sessions.userId, userId));
}

export function hasRecovery(user: User): boolean {
  return Boolean(user.recoveryQuestion1 && user.recoveryAnswer1);
}

/** Verifies both recovery answers. Both must match; neither alone is enough. */
export async function verifyRecoveryAnswers(
  user: User,
  answer1: string,
  answer2: string,
): Promise<boolean> {
  if (!user.recoveryAnswer1 || !user.recoveryAnswer2) return false;

  const first = await verifyPassword(normaliseAnswer(answer1), user.recoveryAnswer1);
  const second = await verifyPassword(normaliseAnswer(answer2), user.recoveryAnswer2);
  return first && second;
}

export async function findUserByEmail(email: string): Promise<User | null> {
  const [user] = await db
    .select()
    .from(users)
    .where(eq(users.email, email.trim().toLowerCase()));
  return user ?? null;
}

export async function listUsers(): Promise<User[]> {
  return db.select().from(users);
}

/** Creates a session and sets its cookie. */
export async function startSession(userId: string): Promise<string> {
  // 32 random bytes: the token is the credential, so it must be unguessable.
  const token = randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000);

  await db.insert(sessions).values({ id: token, userId, expiresAt });

  const store = await cookies();
  store.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    /**
     * On in production, off for local http development.
     *
     * Deliberately keyed on NODE_ENV rather than the request protocol: behind
     * the Cloudflare tunnel the app itself speaks http, so protocol sniffing
     * would wrongly conclude the connection is insecure.
     *
     * The consequence is that a production container reached over plain http
     * will set a cookie the browser silently discards, and login will appear to
     * do nothing. `LUX_INSECURE_COOKIES=1` exists for that case — for a LAN-only
     * deployment with no TLS in front.
     */
    secure: process.env.NODE_ENV === "production" && process.env.LUX_INSECURE_COOKIES !== "1",
    expires: expiresAt,
  });

  // Opportunistic cleanup so expired rows don't accumulate forever.
  await db.delete(sessions).where(lt(sessions.expiresAt, new Date()));

  return token;
}

/** The signed-in user, or null. Safe to call from any server component or route. */
export async function getCurrentUser(): Promise<User | null> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (!token) return null;

  const [row] = await db
    .select({ user: users })
    .from(sessions)
    .innerJoin(users, eq(sessions.userId, users.id))
    .where(and(eq(sessions.id, token), gt(sessions.expiresAt, new Date())));

  return row?.user ?? null;
}

export async function endSession(): Promise<void> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (token) await db.delete(sessions).where(eq(sessions.id, token));
  store.delete(SESSION_COOKIE);
}

/** True when no account exists yet — the app then offers first-run setup. */
export async function needsSetup(): Promise<boolean> {
  const rows = await db.select({ id: users.id }).from(users).limit(1);
  return rows.length === 0;
}

export { RECOVERY_QUESTIONS, SESSION_COOKIE };
