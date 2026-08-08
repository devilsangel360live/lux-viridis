import { NextResponse } from "next/server";
import { z } from "zod";

import { moveNode } from "@/server/nodes";

import { requireNode } from "@/server/guard";

export const dynamic = "force-dynamic";

const moveSchema = z.object({
  parentId: z.string().nullable(),
  position: z.number().int().min(0),
});

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const guard = await requireNode(id);
  if (!guard.ok) return NextResponse.json({ error: "unauthorized" }, { status: guard.status });
  const parsed = moveSchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const node = await moveNode({ id, ...parsed.data });
  if (!node) {
    // Most often an attempt to drop a node inside its own subtree.
    return NextResponse.json({ error: "invalid move" }, { status: 409 });
  }

  return NextResponse.json({ node });
}
