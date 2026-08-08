import { NextResponse } from "next/server";
import { z } from "zod";

import { createSnapshot, listSnapshots } from "@/server/snapshots";

import { requireNode } from "@/server/guard";

export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const guard = await requireNode(id);
  if (!guard.ok) return NextResponse.json({ error: "unauthorized" }, { status: guard.status });
  return NextResponse.json({ snapshots: await listSnapshots(id) });
}

const createSchema = z.object({
  label: z.string().nullable().optional(),
});

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const guard = await requireNode(id);
  if (!guard.ok) return NextResponse.json({ error: "unauthorized" }, { status: guard.status });
  const body = await req.json().catch(() => ({}));
  const parsed = createSchema.safeParse(body ?? {});
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const snapshot = await createSnapshot(id, {
    kind: "manual",
    label: parsed.data.label ?? null,
  });
  if (!snapshot) return NextResponse.json({ error: "not found" }, { status: 404 });

  return NextResponse.json({ snapshot }, { status: 201 });
}
