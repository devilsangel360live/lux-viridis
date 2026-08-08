import { NextResponse } from "next/server";
import { z } from "zod";

import { changePassword, startSession } from "@/server/auth";
import { requireUser } from "@/server/guard";

export const dynamic = "force-dynamic";

const schema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8),
});

export async function POST(req: Request) {
  const guard = await requireUser();
  if (!guard.ok) return NextResponse.json({ error: "unauthorized" }, { status: guard.status });

  const parsed = schema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Your new password must be at least 8 characters." },
      { status: 400 },
    );
  }

  const ok = await changePassword(
    guard.user.id,
    parsed.data.currentPassword,
    parsed.data.newPassword,
  );
  if (!ok) {
    return NextResponse.json({ error: "That current password isn't right." }, { status: 401 });
  }

  // changePassword leaves this session valid but the cookie should be rotated,
  // so a stolen pre-change token cannot be reused.
  await startSession(guard.user.id);
  return NextResponse.json({ ok: true });
}
