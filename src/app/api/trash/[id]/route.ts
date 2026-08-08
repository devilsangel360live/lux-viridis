import { NextResponse } from "next/server";

import { purgeNode, restoreNode } from "@/server/trash";

import { requireNode } from "@/server/guard";

export const dynamic = "force-dynamic";

/** Restore a trashed node to where it came from. */
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const guard = await requireNode(id);
  if (!guard.ok) return NextResponse.json({ error: "unauthorized" }, { status: guard.status });
  const node = await restoreNode(id);
  if (!node) return NextResponse.json({ error: "not found or not trashed" }, { status: 404 });
  return NextResponse.json({ node });
}

/** Permanently delete a trashed node and its subtree. */
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const guard = await requireNode(id);
  if (!guard.ok) return NextResponse.json({ error: "unauthorized" }, { status: guard.status });
  await purgeNode(id);
  return NextResponse.json({ ok: true });
}
