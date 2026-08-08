import { NextResponse } from "next/server";
import { z } from "zod";

import { findUserByEmail, startSession, verifyPassword } from "@/server/auth";

export const dynamic = "force-dynamic";

const schema = z.object({
  email: z.string().min(1),
  password: z.string().min(1),
});

export async function POST(req: Request) {
  const parsed = schema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "Enter your email and password." }, { status: 400 });
  }

  const user = await findUserByEmail(parsed.data.email);

  // Same message and roughly the same work either way, so a wrong email cannot
  // be told apart from a wrong password.
  const ok = user ? await verifyPassword(parsed.data.password, user.passwordHash) : false;
  if (!user || !ok) {
    return NextResponse.json({ error: "That email and password don't match." }, { status: 401 });
  }

  await startSession(user.id);
  return NextResponse.json({ user: { id: user.id, name: user.name, email: user.email } });
}
