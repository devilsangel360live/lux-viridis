import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { nanoid } from "nanoid";

import { db } from "@/db";
import { nodes, projects, type Project } from "@/db/schema";
import { idxSequence } from "@/lib/ordering";

/**
 * Project-level operations.
 *
 * Every query in the app is scoped by project id. Resolution is explicit — a
 * caller passes an id, or asks for the most recently touched one — so nothing
 * silently operates on "whichever project happened to be first".
 */

export type ProjectSummary = Project & {
  manuscriptWords: number;
  nodeCount: number;
};

export async function listProjects(ownerId: string): Promise<ProjectSummary[]> {
  const rows = await db
    .select()
    .from(projects)
    .where(eq(projects.ownerId, ownerId))
    .orderBy(desc(projects.updatedAt));

  const summaries: ProjectSummary[] = [];
  for (const project of rows) {
    const [stats] = await db
      .select({
        // Only manuscript prose counts toward a book's length — notes,
        // character sheets and planning cards are not the book.
        words: sql<number>`coalesce(sum(case when ${nodes.root} = 'manuscript' and ${nodes.type} <> 'card' then ${nodes.wordCount} else 0 end), 0)`,
        count: sql<number>`count(*)`,
      })
      .from(nodes)
      // Trashed work doesn't count toward the book's length.
      .where(and(eq(nodes.projectId, project.id), isNull(nodes.deletedAt)));

    summaries.push({
      ...project,
      manuscriptWords: Number(stats?.words ?? 0),
      nodeCount: Number(stats?.count ?? 0),
    });
  }
  return summaries;
}

/**
 * Fetches a project only if the given user owns it. Ownership is enforced in
 * the query rather than checked afterwards, so there is no path that returns
 * another user's project by accident.
 */
export async function getProjectById(id: string, ownerId: string): Promise<Project | null> {
  const [project] = await db
    .select()
    .from(projects)
    .where(and(eq(projects.id, id), eq(projects.ownerId, ownerId)));
  return project ?? null;
}

/** The project to open when none is specified: the owner's most recent. */
export async function getDefaultProject(ownerId: string): Promise<Project | null> {
  const [project] = await db
    .select()
    .from(projects)
    .where(eq(projects.ownerId, ownerId))
    .orderBy(desc(projects.updatedAt))
    .limit(1);
  return project ?? null;
}

/**
 * Resolves the project a request should act on, always scoped to the caller.
 * An explicit id wins, but only if the caller owns it — otherwise null, which
 * routes turn into a 404.
 */
export async function resolveProject(
  id: string | null | undefined,
  ownerId: string,
): Promise<Project | null> {
  if (id) return getProjectById(id, ownerId);
  return getDefaultProject(ownerId);
}

/** A new project starts with the three root folders a writer expects. */
export async function createProject(input: {
  ownerId: string;
  title: string;
  subtitle?: string | null;
  author?: string | null;
}): Promise<Project> {
  const id = nanoid();

  const [project] = await db
    .insert(projects)
    .values({
      id,
      ownerId: input.ownerId,
      title: input.title.trim() || "Untitled Project",
      subtitle: input.subtitle?.trim() || null,
      author: input.author?.trim() || null,
    })
    .returning();

  // Seed a minimal but usable skeleton so a new project is never a blank void.
  const idx = idxSequence(3);
  await db.insert(nodes).values([
    {
      id: nanoid(),
      projectId: id,
      parentId: null,
      root: "manuscript",
      type: "act",
      idx: idx[0],
      title: "Act I",
      plain: "",
      meta: {},
    },
    {
      id: nanoid(),
      projectId: id,
      parentId: null,
      root: "world",
      type: "folder",
      idx: idx[0],
      title: "Characters",
      plain: "",
      meta: {},
    },
    {
      id: nanoid(),
      projectId: id,
      parentId: null,
      root: "planning",
      type: "folder",
      idx: idx[0],
      title: "Structure",
      plain: "",
      meta: {},
    },
  ]);

  return project;
}

export async function updateProject(
  id: string,
  ownerId: string,
  patch: { title?: string; subtitle?: string | null; author?: string | null },
): Promise<Project | null> {
  const [updated] = await db
    .update(projects)
    .set({ ...patch, updatedAt: new Date() })
    .where(and(eq(projects.id, id), eq(projects.ownerId, ownerId)))
    .returning();
  return updated ?? null;
}

/** Marks a project as touched, so "most recently updated" reflects real use. */
export async function touchProject(id: string): Promise<void> {
  await db.update(projects).set({ updatedAt: new Date() }).where(eq(projects.id, id));
}

/** Deleting a project cascades to its nodes and links via foreign keys. */
export async function deleteProject(id: string, ownerId: string): Promise<boolean> {
  const deleted = await db
    .delete(projects)
    .where(and(eq(projects.id, id), eq(projects.ownerId, ownerId)))
    .returning({ id: projects.id });
  return deleted.length > 0;
}
