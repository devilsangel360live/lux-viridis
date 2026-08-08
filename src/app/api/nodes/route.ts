import { NextResponse } from "next/server";
import { z } from "zod";

import { NODE_ROOTS, NODE_TYPES } from "@/db/schema";
import { createNode, listNodes } from "@/server/nodes";
import { requireProject } from "@/server/guard";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const projectId = new URL(req.url).searchParams.get("projectId");
  const guard = await requireProject(projectId);
  if (!guard.ok) return NextResponse.json({ error: "unauthorized" }, { status: guard.status });
  const { project } = guard;

  const rows = await listNodes(project.id);
  return NextResponse.json({ project, nodes: rows });
}

const createSchema = z.object({
  projectId: z.string().optional(),
  parentId: z.string().nullable(),
  root: z.enum(NODE_ROOTS),
  type: z.enum(NODE_TYPES),
  title: z.string().optional(),
});

export async function POST(req: Request) {
  const body = await req.json();
  const guard = await requireProject(body?.projectId);
  if (!guard.ok) return NextResponse.json({ error: "unauthorized" }, { status: guard.status });
  const { project } = guard;

  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  // The resolved project wins over anything in the payload.
  const node = await createNode({
    projectId: project.id,
    parentId: parsed.data.parentId,
    root: parsed.data.root,
    type: parsed.data.type,
    title: parsed.data.title,
  });
  return NextResponse.json({ node }, { status: 201 });
}
