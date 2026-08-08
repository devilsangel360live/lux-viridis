import { NextResponse } from "next/server";

import { requireProject } from "@/server/guard";
import { emptyTrash, listTrash } from "@/server/trash";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const projectId = new URL(req.url).searchParams.get("projectId");
  const guard = await requireProject(projectId);
  if (!guard.ok) return NextResponse.json({ error: "unauthorized" }, { status: guard.status });
  const { project } = guard;

  return NextResponse.json({ entries: await listTrash(project.id) });
}

/** Empties the trash. Permanent, and the UI confirms before calling it. */
export async function DELETE(req: Request) {
  const projectId = new URL(req.url).searchParams.get("projectId");
  const guard = await requireProject(projectId);
  if (!guard.ok) return NextResponse.json({ error: "unauthorized" }, { status: guard.status });
  const { project } = guard;

  const purged = await emptyTrash(project.id);
  return NextResponse.json({ purged });
}
