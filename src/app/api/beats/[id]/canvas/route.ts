import { NextResponse } from "next/server";
import { z } from "zod";

import { createCard, getCanvas } from "@/server/canvas";

import { requireNode } from "@/server/guard";

export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const guard = await requireNode(id);
  if (!guard.ok) return NextResponse.json({ error: "unauthorized" }, { status: guard.status });
  return NextResponse.json(await getCanvas(id));
}

const createSchema = z.object({
  x: z.number(),
  y: z.number(),
  title: z.string().optional(),
});

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const guard = await requireNode(id);
  if (!guard.ok) return NextResponse.json({ error: "unauthorized" }, { status: guard.status });
  const parsed = createSchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const card = await createCard({ beatId: id, ...parsed.data });
  if (!card) return NextResponse.json({ error: "beat not found" }, { status: 404 });

  return NextResponse.json({ card }, { status: 201 });
}
