import { NextResponse } from "next/server";
import { z } from "zod";

import {
  findUserByEmail,
  forcePassword,
  hasRecovery,
  verifyRecoveryAnswers,
} from "@/server/auth";

export const dynamic = "force-dynamic";

const lookupSchema = z.object({ email: z.string().min(1) });

/**
 * Returns the recovery questions for an email.
 *
 * This necessarily reveals whether an account exists — unavoidable for a
 * question-based flow, and on a two-person family instance the accounts are
 * known to each other anyway. It is the reason recovery answers alone cannot
 * sign you in: they only permit setting a new password.
 */
export async function POST(req: Request) {
  const parsed = lookupSchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "Enter your email." }, { status: 400 });
  }

  const user = await findUserByEmail(parsed.data.email);
  if (!user || !hasRecovery(user)) {
    return NextResponse.json(
      { error: "No recovery questions are set for that account." },
      { status: 404 },
    );
  }

  return NextResponse.json({
    question1: user.recoveryQuestion1,
    question2: user.recoveryQuestion2,
  });
}

const resetSchema = z.object({
  email: z.string().min(1),
  answer1: z.string().min(1),
  answer2: z.string().min(1),
  newPassword: z.string().min(8),
});

export async function PUT(req: Request) {
  const parsed = resetSchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Answer both questions and choose a password of at least 8 characters." },
      { status: 400 },
    );
  }

  const user = await findUserByEmail(parsed.data.email);
  if (!user || !hasRecovery(user)) {
    return NextResponse.json({ error: "Those answers don't match." }, { status: 401 });
  }

  const ok = await verifyRecoveryAnswers(user, parsed.data.answer1, parsed.data.answer2);
  if (!ok) {
    return NextResponse.json({ error: "Those answers don't match." }, { status: 401 });
  }

  // Deliberately does NOT sign the user in — they must log in with the new
  // password, so a lucky guess at the answers alone does not grant a session.
  await forcePassword(user.id, parsed.data.newPassword);
  return NextResponse.json({ ok: true });
}
