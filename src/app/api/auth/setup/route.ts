import { NextResponse } from "next/server";
import { z } from "zod";

import { createUser, needsSetup, startSession } from "@/server/auth";
import { createProject } from "@/server/projects";

export const dynamic = "force-dynamic";

const schema = z.object({
  name: z.string().min(1),
  email: z.string().min(3),
  password: z.string().min(8),
  // Optional so the CLI and tests can create accounts without them, but the
  // setup form always sends them.
  recovery: z
    .object({
      question1: z.string().min(1),
      answer1: z.string().min(1),
      question2: z.string().min(1),
      answer2: z.string().min(1),
    })
    .nullable()
    .optional(),
});

/**
 * Creates the first account. Only available while no user exists, so this
 * cannot be used to add accounts once the app is reachable from the internet.
 */
export async function POST(req: Request) {
  if (!(await needsSetup())) {
    return NextResponse.json({ error: "Setup has already been completed." }, { status: 409 });
  }

  const parsed = schema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Name, email and a password of at least 8 characters are required." },
      { status: 400 },
    );
  }

  const user = await createUser(parsed.data);
  await startSession(user.id);

  // A brand-new account with no project would land on an empty screen.
  const project = await createProject({
    ownerId: user.id,
    title: "My First Story",
    author: user.name,
  });

  return NextResponse.json({ user: { id: user.id, name: user.name }, project });
}
