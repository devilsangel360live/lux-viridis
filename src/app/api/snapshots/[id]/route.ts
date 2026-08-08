import { NextResponse } from "next/server";

import { deleteSnapshot, restoreSnapshot } from "@/server/snapshots";

import { requireSnapshot } from "@/server/guard";

export const dynamic = "force-dynamic";

/** Restore this snapshot onto its node. The current text is captured first. */
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const guard = await requireSnapshot(id);
  if (!guard.ok) return NextResponse.json({ error: "unauthorized" }, { status: guard.status });
  const node = await restoreSnapshot(id);
  if (!node) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ node });
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const guard = await requireSnapshot(id);
  if (!guard.ok) return NextResponse.json({ error: "unauthorized" }, { status: guard.status });
  await deleteSnapshot(id);
  return NextResponse.json({ ok: true });
}
