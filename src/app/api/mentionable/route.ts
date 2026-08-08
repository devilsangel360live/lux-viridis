import { NextResponse } from "next/server";

import { listMentionable } from "@/server/mentions";
import { requireProject } from "@/server/guard";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const projectId = new URL(req.url).searchParams.get("projectId");
  const guard = await requireProject(projectId);
  if (!guard.ok) return NextResponse.json({ error: "unauthorized" }, { status: guard.status });
  const { project } = guard;

  return NextResponse.json({ items: await listMentionable(project.id) });
}
