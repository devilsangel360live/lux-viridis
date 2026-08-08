import { NextResponse } from "next/server";
import { z } from "zod";

import { deleteNode, updateNode } from "@/server/nodes";

import { requireNode } from "@/server/guard";

export const dynamic = "force-dynamic";

const patchSchema = z.object({
  title: z.string().optional(),
  body: z.unknown().optional(),
  synopsis: z.string().nullable().optional(),
  meta: z.record(z.string(), z.unknown()).optional(),
  collapsed: z.boolean().optional(),
});

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const guard = await requireNode(id);
  if (!guard.ok) return NextResponse.json({ error: "unauthorized" }, { status: guard.status });
  const parsed = patchSchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const node = await updateNode(id, parsed.data);
  if (!node) return NextResponse.json({ error: "not found" }, { status: 404 });

  return NextResponse.json({ node });
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const guard = await requireNode(id);
  if (!guard.ok) return NextResponse.json({ error: "unauthorized" }, { status: guard.status });
  await deleteNode(id);
  return NextResponse.json({ ok: true });
}
