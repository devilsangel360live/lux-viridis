import { and, desc, eq, isNotNull, isNull } from "drizzle-orm";

import { db } from "@/db";
import { links, nodes, type Node } from "@/db/schema";
import { byIdx, idxAfterLast } from "@/lib/ordering";

/**
 * Soft delete.
 *
 * Deleting stamps `deletedAt` on the node the user actually chose and moves it
 * to the `trash` root; its descendants keep their parent pointers and are
 * carried along implicitly. That means a chapter and its scenes come back
 * together, and the trash list shows one entry rather than a dozen fragments.
 */

export type TrashEntry = Node & { childCount: number };

export async function listTrash(projectId: string): Promise<TrashEntry[]> {
  const deleted = await db
    .select()
    .from(nodes)
    .where(and(eq(nodes.projectId, projectId), isNotNull(nodes.deletedAt)))
    .orderBy(desc(nodes.deletedAt));

  // Only top-level deletions are listed; a scene inside a deleted chapter is
  // part of that chapter's entry, not its own.
  const deletedIds = new Set(deleted.map((n) => n.id));
  const roots = deleted.filter((n) => !n.parentId || !deletedIds.has(n.parentId));

  const all = await db.select().from(nodes).where(eq(nodes.projectId, projectId));

  return roots.map((root) => ({
    ...root,
    childCount: countDescendants(root.id, all),
  }));
}

function countDescendants(rootId: string, all: Node[]): number {
  let count = 0;
  let frontier = [rootId];
  while (frontier.length) {
    const next: string[] = [];
    for (const parent of frontier) {
      for (const n of all) {
        if (n.parentId === parent) {
          count++;
          next.push(n.id);
        }
      }
    }
    frontier = next;
  }
  return count;
}

/**
 * Moves a node and its whole subtree to the trash.
 *
 * Every descendant is stamped too, not just the node the user clicked: the
 * binder and search filter row-by-row on `deletedAt`, so leaving children
 * unstamped would keep a deleted chapter's scenes visible and searchable.
 * Only the top node records where it came from — that is all restore needs,
 * since the children keep their parent pointers.
 */
export async function trashNode(id: string): Promise<Node | null> {
  const [node] = await db.select().from(nodes).where(eq(nodes.id, id));
  if (!node || node.deletedAt) return null;

  const now = new Date();
  const all = await db.select().from(nodes).where(eq(nodes.projectId, node.projectId));

  for (const childId of collectDescendantIds(id, all)) {
    await db
      .update(nodes)
      .set({ deletedAt: now, updatedAt: now })
      .where(eq(nodes.id, childId));
  }

  const [updated] = await db
    .update(nodes)
    .set({
      deletedAt: now,
      // Remember the origin so restore is exact rather than a best guess.
      prevParentId: node.parentId,
      prevRoot: node.root,
      parentId: null,
      root: "trash",
      updatedAt: now,
    })
    .where(eq(nodes.id, id))
    .returning();

  return updated ?? null;
}

/**
 * Restores a node to where it came from.
 *
 * If the original parent is gone (or is itself in the trash) the node returns
 * to the top level of its original section instead of vanishing — restoring
 * should never fail in a way that loses the work again.
 */
export async function restoreNode(id: string): Promise<Node | null> {
  const [node] = await db.select().from(nodes).where(eq(nodes.id, id));
  if (!node || !node.deletedAt) return null;

  const targetRoot = node.prevRoot ?? "manuscript";
  let targetParent: string | null = node.prevParentId ?? null;

  if (targetParent) {
    const [parent] = await db.select().from(nodes).where(eq(nodes.id, targetParent));
    if (!parent || parent.deletedAt) targetParent = null;
  }

  const siblings = await db
    .select()
    .from(nodes)
    .where(
      targetParent
        ? and(eq(nodes.projectId, node.projectId), eq(nodes.parentId, targetParent))
        : and(
            eq(nodes.projectId, node.projectId),
            isNull(nodes.parentId),
            eq(nodes.root, targetRoot),
            isNull(nodes.deletedAt),
          ),
    );

  const now = new Date();

  // Un-stamp the subtree, mirroring what trashNode stamped. Descendants also
  // return to the destination root, since a restored chapter's scenes must not
  // stay marked as living in `trash`.
  const all = await db.select().from(nodes).where(eq(nodes.projectId, node.projectId));
  for (const childId of collectDescendantIds(id, all)) {
    await db
      .update(nodes)
      .set({ deletedAt: null, root: targetRoot, updatedAt: now })
      .where(eq(nodes.id, childId));
  }

  const [restored] = await db
    .update(nodes)
    .set({
      deletedAt: null,
      prevParentId: null,
      prevRoot: null,
      parentId: targetParent,
      root: targetRoot,
      // A fresh index avoids colliding with whatever occupies the old slot now.
      idx: idxAfterLast(siblings.filter((s) => !s.deletedAt).sort(byIdx)),
      updatedAt: now,
    })
    .where(eq(nodes.id, id))
    .returning();

  return restored ?? null;
}

/** Permanently removes a trashed node and everything beneath it. */
export async function purgeNode(id: string): Promise<boolean> {
  const all = await db.select().from(nodes);
  const ids = [id, ...collectDescendantIds(id, all)];

  for (const nodeId of ids.reverse()) {
    await db.delete(links).where(eq(links.sourceId, nodeId));
    await db.delete(links).where(eq(links.targetId, nodeId));
    await db.delete(nodes).where(eq(nodes.id, nodeId));
  }
  return true;
}

/** Empties the trash for a project. */
export async function emptyTrash(projectId: string): Promise<number> {
  const entries = await listTrash(projectId);
  for (const entry of entries) await purgeNode(entry.id);
  return entries.length;
}

function collectDescendantIds(rootId: string, all: Node[]): string[] {
  const out: string[] = [];
  let frontier = [rootId];
  while (frontier.length) {
    const next: string[] = [];
    for (const parent of frontier) {
      for (const n of all) {
        if (n.parentId === parent) {
          out.push(n.id);
          next.push(n.id);
        }
      }
    }
    frontier = next;
  }
  return out;
}
