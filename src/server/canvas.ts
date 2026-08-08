import { and, asc, eq, inArray } from "drizzle-orm";
import { nanoid } from "nanoid";

import { db } from "@/db";
import { links, nodes, type Link, type Node } from "@/db/schema";
import { idxAfterLast } from "@/lib/ordering";

/**
 * The beat canvas: cards are nodes parented to a beat, connections are `edge`
 * rows in `links`.
 *
 * Keeping cards in the node table is what lets a card be searched, counted and
 * eventually @mentioned like anything else. The tree's `idx` still orders them
 * (so the API stays uniform) but the canvas reads position from `meta.x/y`.
 */

export const CARD_WIDTH = 190;

export type CanvasCard = Node & {
  x: number;
  y: number;
};

export type CanvasPayload = {
  cards: CanvasCard[];
  edges: Link[];
};

function readPosition(node: Node, fallbackIndex: number): CanvasCard {
  const meta = (node.meta ?? {}) as Record<string, unknown>;
  const x = Number(meta.x);
  const y = Number(meta.y);
  return {
    ...node,
    // A card created outside the canvas has no coordinates; lay those out in a
    // readable column instead of stacking them all at the origin.
    x: Number.isFinite(x) ? x : 60 + (fallbackIndex % 3) * (CARD_WIDTH + 50),
    y: Number.isFinite(y) ? y : 60 + Math.floor(fallbackIndex / 3) * 130,
  };
}

export async function getCanvas(beatId: string): Promise<CanvasPayload> {
  const cardRows = await db
    .select()
    .from(nodes)
    .where(and(eq(nodes.parentId, beatId), eq(nodes.type, "card")))
    .orderBy(asc(nodes.idx));

  const cards = cardRows.map(readPosition);
  if (cards.length === 0) return { cards, edges: [] };

  const ids = cards.map((c) => c.id);
  const allEdges = await db.select().from(links).where(eq(links.kind, "edge"));

  // Only edges whose endpoints are both on this canvas.
  const edges = allEdges.filter(
    (e) => ids.includes(e.sourceId) && ids.includes(e.targetId),
  );

  return { cards, edges };
}

export async function createCard(input: {
  beatId: string;
  x: number;
  y: number;
  title?: string;
}): Promise<CanvasCard | null> {
  // The card inherits its project from the beat it belongs to.
  const [beat] = await db.select().from(nodes).where(eq(nodes.id, input.beatId));
  if (!beat) return null;

  const siblings = await db
    .select()
    .from(nodes)
    .where(and(eq(nodes.parentId, input.beatId), eq(nodes.type, "card")));

  const [created] = await db
    .insert(nodes)
    .values({
      id: nanoid(),
      projectId: beat.projectId,
      parentId: input.beatId,
      root: "planning",
      type: "card",
      idx: idxAfterLast(siblings),
      title: input.title ?? "New card",
      body: null,
      // Mirrored so cards are findable in project search.
      plain: input.title ?? "New card",
      wordCount: 0,
      meta: { x: Math.round(input.x), y: Math.round(input.y) },
    })
    .returning();

  return readPosition(created, siblings.length);
}

/** Position updates are frequent during a drag, so this stays a narrow write. */
export async function moveCard(id: string, x: number, y: number): Promise<Node | null> {
  const [card] = await db.select().from(nodes).where(eq(nodes.id, id));
  if (!card || card.type !== "card") return null;

  const meta = { ...((card.meta ?? {}) as Record<string, unknown>), x: Math.round(x), y: Math.round(y) };

  const [updated] = await db
    .update(nodes)
    .set({ meta, updatedAt: new Date() })
    .where(eq(nodes.id, id))
    .returning();

  return updated ?? null;
}

/**
 * A card's text is its title. Mirroring it into `plain` is what makes cards
 * turn up in project search alongside scenes and lore.
 */
export async function updateCardText(id: string, title: string): Promise<Node | null> {
  const [updated] = await db
    .update(nodes)
    .set({ title, plain: title, updatedAt: new Date() })
    .where(and(eq(nodes.id, id), eq(nodes.type, "card")))
    .returning();

  return updated ?? null;
}

/** Deleting a card must take its edges with it, or the canvas renders dangling arrows. */
export async function deleteCard(id: string): Promise<boolean> {
  await db.delete(links).where(eq(links.sourceId, id));
  await db.delete(links).where(eq(links.targetId, id));
  await db.delete(nodes).where(eq(nodes.id, id));
  return true;
}

export async function createEdge(input: {
  sourceId: string;
  targetId: string;
  label?: string | null;
}): Promise<Link | null> {
  // A self-loop is always a mistake here, and renders as an unusable dot.
  if (input.sourceId === input.targetId) return null;

  const endpoints = await db
    .select()
    .from(nodes)
    .where(inArray(nodes.id, [input.sourceId, input.targetId]));
  if (endpoints.length !== 2) return null;
  if (endpoints.some((n) => n.type !== "card")) return null;
  // Both cards must belong to the same beat; edges never span canvases.
  if (endpoints[0].parentId !== endpoints[1].parentId) return null;

  const existing = await db
    .select()
    .from(links)
    .where(
      and(
        eq(links.sourceId, input.sourceId),
        eq(links.targetId, input.targetId),
        eq(links.kind, "edge"),
      ),
    );
  if (existing.length > 0) return existing[0];

  const [created] = await db
    .insert(links)
    .values({
      id: nanoid(),
      // Derived from the endpoints, which are already verified to share a beat.
      projectId: endpoints[0].projectId,
      sourceId: input.sourceId,
      targetId: input.targetId,
      kind: "edge",
      label: input.label ?? null,
    })
    .returning();

  return created ?? null;
}

export async function deleteEdge(id: string): Promise<boolean> {
  await db.delete(links).where(and(eq(links.id, id), eq(links.kind, "edge")));
  return true;
}
