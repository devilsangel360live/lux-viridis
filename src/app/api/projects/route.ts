import { NextResponse } from "next/server";
import { z } from "zod";

import { requireUser } from "@/server/guard";
import { createProject, listProjects } from "@/server/projects";

export const dynamic = "force-dynamic";

export async function GET() {
  const guard = await requireUser();
  if (!guard.ok) return NextResponse.json({ error: "unauthorized" }, { status: guard.status });

  return NextResponse.json({ projects: await listProjects(guard.user.id) });
}

const createSchema = z.object({
  title: z.string().min(1),
  subtitle: z.string().nullable().optional(),
  author: z.string().nullable().optional(),
});

export async function POST(req: Request) {
  const guard = await requireUser();
  if (!guard.ok) return NextResponse.json({ error: "unauthorized" }, { status: guard.status });

  const parsed = createSchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const project = await createProject({ ownerId: guard.user.id, ...parsed.data });
  return NextResponse.json({ project }, { status: 201 });
}
