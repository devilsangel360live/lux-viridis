import { NextResponse } from "next/server";

import { getBacklinks } from "@/server/mentions";

import { requireNode } from "@/server/guard";

export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const guard = await requireNode(id);
  if (!guard.ok) return NextResponse.json({ error: "unauthorized" }, { status: guard.status });
  return NextResponse.json({ backlinks: await getBacklinks(id) });
}
