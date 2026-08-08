import { redirect } from "next/navigation";

import { Workspace } from "@/components/workspace";
import { listNodes } from "@/server/nodes";
import { createProject, listProjects, resolveProject } from "@/server/projects";
import { getCurrentUser } from "@/server/auth";
import type { ClientNode } from "@/lib/api";

export const dynamic = "force-dynamic";

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ project?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const { project: requested } = await searchParams;
  let project = await resolveProject(requested, user.id);

  // A signed-in user with no projects (or one following a stale link) should
  // land in a usable workspace rather than an error page.
  if (!project) {
    project = await createProject({
      ownerId: user.id,
      title: "My First Story",
      author: user.name,
    });
  }

  const [nodes, projects] = await Promise.all([
    listNodes(project.id),
    listProjects(user.id),
  ]);

  return (
    <Workspace
      // Keyed by project so switching stories remounts the workspace: node
      // state is seeded from props, and without this the previous project's
      // tree would persist behind the new project's title.
      key={project.id}
      initialProject={project}
      initialNodes={nodes as unknown as ClientNode[]}
      projects={projects}
      user={{ id: user.id, name: user.name, email: user.email }}
    />
  );
}
