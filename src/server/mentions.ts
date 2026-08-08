import { and, eq, inArray } from "drizzle-orm";
import { nanoid } from "nanoid";

import { db } from "@/db";
import { links, nodes, type Node } from "@/db/schema";

/**
 * @mentions and backlinks.
 *
 * A mention inside a document writes a `mention` row in `links`, which is what
 * turns the world bible from inert folders into a real index: open a character
 * and see every scene they appear in, in manuscript order.
 *
 * Mentions are derived state — the document is the source of truth. On every
 * save we diff the mentions found in the body against the stored rows, so
 * deleting an @mention from the prose removes the backlink too.
 */

/** Node types that can be mentioned. Prose documents are referenced, not mentioned. */
export const MENTIONABLE_TYPES = ["character", "location", "lore"] as const;

type PMNode = {
  type?: string;
  attrs?: Record<string, unknown>;
  content?: PMNode[];
};

/** Walks a ProseMirror doc and collects the ids of every mention node. */
export function extractMentionIds(doc: unknown): string[] {
  const found = new Set<string>();
  if (!doc || typeof doc !== "object") return [];

  const walk = (node: PMNode) => {
    if (node.type === "mention") {
      const id = node.attrs?.id;
      if (typeof id === "string" && id) found.add(id);
    }
    node.content?.forEach(walk);
  };

  walk(doc as PMNode);
  return [...found];
}

/**
 * Reconciles the mention rows for one document against what its body contains.
 * Returns true if anything changed.
 */
export async function syncMentions(node: Node, body: unknown): Promise<boolean> {
  const wanted = new Set(extractMentionIds(body));

  const existing = await db
    .select()
    .from(links)
    .where(and(eq(links.sourceId, node.id), eq(links.kind, "mention")));

  const have = new Set(existing.map((l) => l.targetId));

  const toAdd = [...wanted].filter((id) => !have.has(id));
  const toRemove = existing.filter((l) => !wanted.has(l.targetId));

  // Only link to targets that actually exist in this project — a stale id in a
  // pasted document must not create a dangling backlink.
  let valid: string[] = [];
  if (toAdd.length) {
    const targets = await db
      .select({ id: nodes.id, projectId: nodes.projectId })
      .from(nodes)
      .where(inArray(nodes.id, toAdd));
    valid = targets.filter((t) => t.projectId === node.projectId).map((t) => t.id);
  }

  for (const targetId of valid) {
    await db
      .insert(links)
      .values({
        id: nanoid(),
        projectId: node.projectId,
        sourceId: node.id,
        targetId,
        kind: "mention",
      })
      .onConflictDoNothing();
  }

  for (const link of toRemove) {
    await db.delete(links).where(eq(links.id, link.id));
  }

  return valid.length > 0 || toRemove.length > 0;
}

export type Backlink = {
  node: Node;
  /** Position in manuscript reading order; null for non-manuscript sources. */
  order: number | null;
};

/**
 * Everything that mentions this node, in manuscript reading order.
 *
 * Reading order is the depth-first walk of the manuscript tree, which is what
 * makes "first appearance" and "last appearance" meaningful rather than
 * arbitrary insertion order.
 */
export async function getBacklinks(targetId: string): Promise<Backlink[]> {
  const [target] = await db.select().from(nodes).where(eq(nodes.id, targetId));
  if (!target) return [];

  const rows = await db
    .select()
    .from(links)
    .where(and(eq(links.targetId, targetId), eq(links.kind, "mention")));
  if (rows.length === 0) return [];

  const sourceIds = rows.map((r) => r.sourceId);
  const sources = await db.select().from(nodes).where(inArray(nodes.id, sourceIds));

  const live = sources.filter((s) => !s.deletedAt);
  const order = await manuscriptOrder(target.projectId);

  return live
    .map((node) => ({ node, order: order.get(node.id) ?? null }))
    .sort((a, b) => {
      if (a.order === null && b.order === null) return a.node.title.localeCompare(b.node.title);
      if (a.order === null) return 1;
      if (b.order === null) return -1;
      return a.order - b.order;
    });
}

/** Maps every manuscript node id to its index in depth-first reading order. */
async function manuscriptOrder(projectId: string): Promise<Map<string, number>> {
  const all = await db.select().from(nodes).where(eq(nodes.projectId, projectId));
  const live = all.filter((n) => !n.deletedAt && n.root === "manuscript");

  const byParent = new Map<string | null, Node[]>();
  for (const n of live) {
    const key = n.parentId ?? null;
    if (!byParent.has(key)) byParent.set(key, []);
    byParent.get(key)!.push(n);
  }
  for (const list of byParent.values()) {
    list.sort((a, b) => (a.idx === b.idx ? a.id.localeCompare(b.id) : a.idx < b.idx ? -1 : 1));
  }

  const order = new Map<string, number>();
  let counter = 0;
  const walk = (parentId: string | null) => {
    for (const child of byParent.get(parentId) ?? []) {
      order.set(child.id, counter++);
      walk(child.id);
    }
  };
  walk(null);

  return order;
}

/** Candidates for the @-mention picker. */
export async function listMentionable(projectId: string): Promise<
  Array<{ id: string; title: string; type: string; synopsis: string | null }>
> {
  const rows = await db.select().from(nodes).where(eq(nodes.projectId, projectId));

  return rows
    .filter(
      (n) =>
        !n.deletedAt &&
        (MENTIONABLE_TYPES as readonly string[]).includes(n.type),
    )
    .map((n) => ({ id: n.id, title: n.title, type: n.type, synopsis: n.synopsis }))
    .sort((a, b) => a.title.localeCompare(b.title));
}
