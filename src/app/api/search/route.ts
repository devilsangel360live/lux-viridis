import { NextResponse } from "next/server";

import { requireProject } from "@/server/guard";
import { searchNodes } from "@/server/search";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const guard = await requireProject(url.searchParams.get("projectId"));
  if (!guard.ok) return NextResponse.json({ error: "unauthorized" }, { status: guard.status });
  const { project } = guard;

  const q = url.searchParams.get("q") ?? "";
  const hits = await searchNodes(project.id, q);

  return NextResponse.json({ hits });
}
