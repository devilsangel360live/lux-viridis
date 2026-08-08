import { NextResponse } from "next/server";
import { z } from "zod";

import { deleteCard, moveCard, updateCardText } from "@/server/canvas";

import { requireNode } from "@/server/guard";

export const dynamic = "force-dynamic";

const patchSchema = z
  .object({
    x: z.number().optional(),
    y: z.number().optional(),
    title: z.string().optional(),
  })
  .refine((v) => v.title !== undefined || (v.x !== undefined && v.y !== undefined), {
    message: "provide title, or both x and y",
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

  let node = null;
  if (parsed.data.x !== undefined && parsed.data.y !== undefined) {
    node = await moveCard(id, parsed.data.x, parsed.data.y);
  }
  if (parsed.data.title !== undefined) {
    node = await updateCardText(id, parsed.data.title);
  }

  if (!node) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ card: node });
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const guard = await requireNode(id);
  if (!guard.ok) return NextResponse.json({ error: "unauthorized" }, { status: guard.status });
  await deleteCard(id);
  return NextResponse.json({ ok: true });
}
