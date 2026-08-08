import { desc, eq } from "drizzle-orm";
import { nanoid } from "nanoid";

import { db } from "@/db";
import { nodes, snapshots, type Node, type Snapshot, type SnapshotKind } from "@/db/schema";
import { docStats } from "@/lib/doc";

/**
 * Version history.
 *
 * The goal is that revising is never destructive: cutting a scene in half
 * should be recoverable an hour later without the writer having thought to save
 * a copy first. Automatic snapshots handle the case where they didn't think of
 * it; manual ones handle the case where they know something big is coming.
 */

/** Take an auto snapshot when the text has moved this much since the last one. */
const AUTO_WORD_DELTA = 120;
/** …or when this long has passed with any change at all. */
const AUTO_INTERVAL_MS = 30 * 60 * 1000;
/** Keep this many auto snapshots per node; manual ones are never pruned. */
const AUTO_KEEP = 25;

export async function listSnapshots(nodeId: string): Promise<Snapshot[]> {
  return db
    .select()
    .from(snapshots)
    .where(eq(snapshots.nodeId, nodeId))
    .orderBy(desc(snapshots.createdAt));
}

export async function createSnapshot(
  nodeId: string,
  opts: { kind?: SnapshotKind; label?: string | null } = {},
): Promise<Snapshot | null> {
  const [node] = await db.select().from(nodes).where(eq(nodes.id, nodeId));
  if (!node) return null;

  const snapshot = await writeSnapshot(node, opts.kind ?? "manual", opts.label ?? null);
  if (opts.kind === "auto") await pruneAuto(nodeId);
  return snapshot;
}

async function writeSnapshot(
  node: Node,
  kind: SnapshotKind,
  label: string | null,
): Promise<Snapshot> {
  const [created] = await db
    .insert(snapshots)
    .values({
      id: nanoid(),
      nodeId: node.id,
      kind,
      label,
      title: node.title,
      body: node.body,
      plain: node.plain,
      wordCount: node.wordCount,
    })
    .returning();
  return created;
}

/**
 * Decides whether an edit deserves an automatic snapshot, and takes one if so.
 * Called on save, before the new text overwrites the old — the snapshot must
 * capture the *previous* state, which is the thing being lost.
 */
export async function maybeAutoSnapshot(node: Node, nextBody: unknown): Promise<Snapshot | null> {
  const next = docStats(nextBody);

  const [latest] = await db
    .select()
    .from(snapshots)
    .where(eq(snapshots.nodeId, node.id))
    .orderBy(desc(snapshots.createdAt))
    .limit(1);

  // Nothing captured yet: snapshot the first time real text exists, so there is
  // always a floor to fall back to.
  if (!latest) {
    if (node.wordCount === 0) return null;
    const snap = await writeSnapshot(node, "auto", null);
    await pruneAuto(node.id);
    return snap;
  }

  /**
   * The delta that matters is how far the text is moving *right now* — the
   * node's current count versus what it is about to become. Comparing against
   * the last snapshot instead would miss exactly the dangerous case: text grown
   * gradually since the last capture and then deleted wholesale in one edit.
   */
  const delta = Math.abs(next.wordCount - node.wordCount);
  const elapsed = Date.now() - new Date(latest.createdAt).getTime();
  const changed = next.plain !== node.plain;

  // Losing most of a document is always worth capturing, even when the absolute
  // word delta is small — a 40-word scene cut to nothing still matters.
  const majorLoss =
    node.wordCount >= 20 && next.wordCount < node.wordCount * 0.5;

  if (!majorLoss && delta < AUTO_WORD_DELTA && !(changed && elapsed > AUTO_INTERVAL_MS)) {
    return null;
  }

  const snap = await writeSnapshot(node, "auto", null);
  await pruneAuto(node.id);
  return snap;
}

/** Keeps auto snapshots bounded. Manual and pre-restore entries are kept forever. */
async function pruneAuto(nodeId: string): Promise<void> {
  const autos = await db
    .select()
    .from(snapshots)
    .where(eq(snapshots.nodeId, nodeId))
    .orderBy(desc(snapshots.createdAt));

  const excess = autos.filter((s) => s.kind === "auto").slice(AUTO_KEEP);
  for (const s of excess) await db.delete(snapshots).where(eq(snapshots.id, s.id));
}

/**
 * Restores a snapshot onto its node, capturing the current state first so the
 * restore itself can be undone.
 */
export async function restoreSnapshot(snapshotId: string): Promise<Node | null> {
  const [snapshot] = await db.select().from(snapshots).where(eq(snapshots.id, snapshotId));
  if (!snapshot) return null;

  const [node] = await db.select().from(nodes).where(eq(nodes.id, snapshot.nodeId));
  if (!node) return null;

  await writeSnapshot(node, "pre-restore", "Before restore");

  const [updated] = await db
    .update(nodes)
    .set({
      body: snapshot.body,
      plain: snapshot.plain,
      wordCount: snapshot.wordCount,
      title: snapshot.title ?? node.title,
      updatedAt: new Date(),
    })
    .where(eq(nodes.id, node.id))
    .returning();

  return updated ?? null;
}

export async function deleteSnapshot(id: string): Promise<boolean> {
  await db.delete(snapshots).where(eq(snapshots.id, id));
  return true;
}
