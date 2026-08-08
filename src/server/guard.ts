import { and, eq } from "drizzle-orm";

import { db } from "@/db";
import {
  links,
  nodes,
  projects,
  snapshots,
  type Node,
  type Project,
  type User,
} from "@/db/schema";
import { getCurrentUser } from "./auth";
import { resolveProject } from "./projects";

/**
 * Request guards.
 *
 * Every API route resolves the caller through one of these rather than reading
 * ids straight from the request. Ownership is checked in the query itself, so
 * "forgot to scope it" is not a shape a route can accidentally take.
 */

export type Denied = { ok: false; status: 401 | 404 };
export type AllowedUser = { ok: true; user: User };
export type AllowedProject = { ok: true; user: User; project: Project };
export type AllowedNode = { ok: true; user: User; node: Node };

export async function requireUser(): Promise<AllowedUser | Denied> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, status: 401 };
  return { ok: true, user };
}

export async function requireProject(
  projectId: string | null | undefined,
): Promise<AllowedProject | Denied> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, status: 401 };

  const project = await resolveProject(projectId, user.id);
  // A project owned by someone else is reported as missing rather than
  // forbidden, so ids cannot be probed for existence.
  if (!project) return { ok: false, status: 404 };

  return { ok: true, user, project };
}

/** Resolves a node and confirms the caller owns the project it belongs to. */
export async function requireNode(nodeId: string): Promise<AllowedNode | Denied> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, status: 401 };

  const [row] = await db
    .select({ node: nodes })
    .from(nodes)
    .innerJoin(projects, eq(nodes.projectId, projects.id))
    .where(and(eq(nodes.id, nodeId), eq(projects.ownerId, user.id)));

  if (!row) return { ok: false, status: 404 };
  return { ok: true, user, node: row.node };
}

/** Ownership for a snapshot, resolved through its node's project. */
export async function requireSnapshot(
  snapshotId: string,
): Promise<AllowedUser | Denied> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, status: 401 };

  const [row] = await db
    .select({ id: snapshots.id })
    .from(snapshots)
    .innerJoin(nodes, eq(snapshots.nodeId, nodes.id))
    .innerJoin(projects, eq(nodes.projectId, projects.id))
    .where(and(eq(snapshots.id, snapshotId), eq(projects.ownerId, user.id)));

  if (!row) return { ok: false, status: 404 };
  return { ok: true, user };
}

/** Ownership for a link (canvas edge or mention), via its project. */
export async function requireLink(linkId: string): Promise<AllowedUser | Denied> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, status: 401 };

  const [row] = await db
    .select({ id: links.id })
    .from(links)
    .innerJoin(projects, eq(links.projectId, projects.id))
    .where(and(eq(links.id, linkId), eq(projects.ownerId, user.id)));

  if (!row) return { ok: false, status: 404 };
  return { ok: true, user };
}
