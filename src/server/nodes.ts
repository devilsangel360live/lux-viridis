import { and, asc, eq, isNull } from "drizzle-orm";
import { nanoid } from "nanoid";

import { db } from "@/db";
import { nodes, type Node, type NodeRoot, type NodeType } from "@/db/schema";
import { byIdx, idxAfterLast, idxAt } from "@/lib/ordering";
import { docStats, emptyDoc } from "@/lib/doc";
import { maybeAutoSnapshot } from "./snapshots";
import { syncMentions } from "./mentions";
import { trashNode } from "./trash";

/** Server-side node operations. Kept free of React so routes can call them directly. */

export type TreeNode = Node & { children: TreeNode[] };

/** Live nodes only — trashed items are fetched separately by the trash view. */
export async function listNodes(projectId: string): Promise<Node[]> {
  return db
    .select()
    .from(nodes)
    .where(and(eq(nodes.projectId, projectId), isNull(nodes.deletedAt)))
    .orderBy(asc(nodes.idx));
}

/** Assemble the flat rows into a tree, sorting each sibling list by index. */
export function buildTree(rows: Node[], root?: NodeRoot): TreeNode[] {
  const byId = new Map<string, TreeNode>();
  for (const r of rows) byId.set(r.id, { ...r, children: [] });

  const roots: TreeNode[] = [];
  for (const node of byId.values()) {
    if (node.parentId) {
      const parent = byId.get(node.parentId);
      if (parent) {
        parent.children.push(node);
        continue;
      }
      // Parent filtered out or missing — treat as top level rather than dropping.
    }
    if (!root || node.root === root) roots.push(node);
  }

  const sortRec = (list: TreeNode[]) => {
    list.sort(byIdx);
    list.forEach((n) => sortRec(n.children));
  };
  sortRec(roots);
  return roots;
}

async function siblingsOf(projectId: string, parentId: string | null, root: NodeRoot) {
  const where = parentId
    ? and(eq(nodes.projectId, projectId), eq(nodes.parentId, parentId))
    : and(eq(nodes.projectId, projectId), isNull(nodes.parentId), eq(nodes.root, root));
  return db.select().from(nodes).where(where).orderBy(asc(nodes.idx));
}

export async function createNode(input: {
  projectId: string;
  parentId: string | null;
  root: NodeRoot;
  type: NodeType;
  title?: string;
}): Promise<Node> {
  const siblings = await siblingsOf(input.projectId, input.parentId, input.root);
  const writable = input.type !== "folder";

  const [created] = await db
    .insert(nodes)
    .values({
      id: nanoid(),
      projectId: input.projectId,
      parentId: input.parentId,
      root: input.root,
      type: input.type,
      idx: idxAfterLast(siblings),
      title: input.title ?? defaultTitle(input.type),
      body: writable ? emptyDoc() : null,
      plain: "",
      wordCount: 0,
      meta: {},
    })
    .returning();

  return created;
}

export async function updateNode(
  id: string,
  patch: {
    title?: string;
    body?: unknown;
    synopsis?: string | null;
    meta?: Record<string, unknown>;
    collapsed?: boolean;
  },
): Promise<Node | null> {
  const values: Record<string, unknown> = { updatedAt: new Date() };

  if (patch.title !== undefined) values.title = patch.title;
  if (patch.synopsis !== undefined) values.synopsis = patch.synopsis;
  if (patch.meta !== undefined) values.meta = patch.meta;
  if (patch.collapsed !== undefined) values.collapsed = patch.collapsed;

  // Word count and the search projection are derived, never client-supplied.
  if (patch.body !== undefined) {
    const [before] = await db.select().from(nodes).where(eq(nodes.id, id));
    // Snapshot the outgoing text before it is overwritten — after the update
    // the previous version is gone and there is nothing left to capture.
    if (before) {
      await maybeAutoSnapshot(before, patch.body);
      // Backlinks are derived from the body, so they are reconciled on save.
      await syncMentions(before, patch.body);
    }

    const { plain, wordCount } = docStats(patch.body);
    values.body = patch.body;
    values.plain = plain;
    values.wordCount = wordCount;
  }

  const [updated] = await db
    .update(nodes)
    .set(values)
    .where(eq(nodes.id, id))
    .returning();

  return updated ?? null;
}

/**
 * Reparent and/or reorder a node.
 *
 * `position` is the target slot among the destination's children *excluding the
 * moved node itself* — see `idxAt`. Guards against dropping a node into its own
 * subtree, which would detach that whole branch from the tree.
 */
export async function moveNode(input: {
  id: string;
  parentId: string | null;
  position: number;
}): Promise<Node | null> {
  const [node] = await db.select().from(nodes).where(eq(nodes.id, input.id));
  if (!node) return null;

  let root = node.root;
  if (input.parentId) {
    const [parent] = await db.select().from(nodes).where(eq(nodes.id, input.parentId));
    if (!parent) return null;
    if (await isDescendant(input.parentId, input.id)) return null;
    root = parent.root;
  }

  const rawSiblings = await siblingsOf(node.projectId, input.parentId, root);
  const siblings = rawSiblings.filter((s) => s.id !== input.id).sort(byIdx);

  const [moved] = await db
    .update(nodes)
    .set({
      parentId: input.parentId,
      root,
      idx: idxAt(siblings, input.position),
      updatedAt: new Date(),
    })
    .where(eq(nodes.id, input.id))
    .returning();

  return moved ?? null;
}

/** True if `candidateId` lies anywhere inside `ancestorId`'s subtree. */
async function isDescendant(candidateId: string, ancestorId: string): Promise<boolean> {
  let cursor: string | null = candidateId;
  const guard = new Set<string>();

  while (cursor) {
    if (cursor === ancestorId) return true;
    if (guard.has(cursor)) return true; // cycle already in data; refuse the move
    guard.add(cursor);

    const [row] = await db
      .select({ parentId: nodes.parentId })
      .from(nodes)
      .where(eq(nodes.id, cursor));
    cursor = row?.parentId ?? null;
  }
  return false;
}

/**
 * Deleting is a move to the trash, not an erase — see `server/trash.ts`.
 * Permanent removal is a separate, explicit action.
 */
export async function deleteNode(id: string): Promise<boolean> {
  const trashed = await trashNode(id);
  return trashed !== null;
}

function defaultTitle(type: NodeType): string {
  const titles: Record<NodeType, string> = {
    folder: "New Folder",
    act: "New Act",
    chapter: "New Chapter",
    scene: "New Scene",
    note: "New Note",
    character: "New Character",
    location: "New Location",
    lore: "New Entry",
    beat: "New Beat",
    card: "New card",
  };
  return titles[type];
}
