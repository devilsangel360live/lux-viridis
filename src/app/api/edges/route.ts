import { NextResponse } from "next/server";
import { z } from "zod";

import { createEdge } from "@/server/canvas";
import { requireNode } from "@/server/guard";

export const dynamic = "force-dynamic";

const createSchema = z.object({
  sourceId: z.string(),
  targetId: z.string(),
  label: z.string().nullable().optional(),
});

export async function POST(req: Request) {
  const parsed = createSchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  // Ownership is checked on the source card; createEdge separately requires
  // both endpoints to be cards on the same beat, so the target is covered too.
  const guard = await requireNode(parsed.data.sourceId);
  if (!guard.ok) return NextResponse.json({ error: "unauthorized" }, { status: guard.status });

  const edge = await createEdge(parsed.data);
  if (!edge) {
    // Self-loop, missing endpoint, non-card node, or a cross-canvas pair.
    return NextResponse.json({ error: "invalid edge" }, { status: 409 });
  }

  return NextResponse.json({ edge }, { status: 201 });
}
