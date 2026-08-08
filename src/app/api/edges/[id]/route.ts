import { NextResponse } from "next/server";

import { deleteEdge } from "@/server/canvas";

import { requireLink } from "@/server/guard";

export const dynamic = "force-dynamic";

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const guard = await requireLink(id);
  if (!guard.ok) return NextResponse.json({ error: "unauthorized" }, { status: guard.status });
  await deleteEdge(id);
  return NextResponse.json({ ok: true });
}
