import { and, eq, isNull, or, sql } from "drizzle-orm";

import { db } from "@/db";
import { nodes, type Node } from "@/db/schema";

/**
 * Search over the whole project.
 *
 * Deliberately kept behind this one module: it is the only place where SQLite
 * and Postgres genuinely diverge (LIKE/FTS5 vs tsvector). When the OMV migration
 * happens, this file changes and nothing else does.
 *
 * The current implementation is a case-insensitive substring match over the
 * `plain` projection, the title and the synopsis. That is honest about its
 * limits — no stemming, no ranking by relevance beyond field priority — but it
 * needs no extra tables and stays correct as prose is edited, because `plain` is
 * recomputed server-side on every save.
 */

export type SearchHit = {
  node: Node;
  field: "title" | "synopsis" | "body";
  excerpt: string;
  /** Character offsets of the match within `excerpt`, for highlighting. */
  match: { start: number; length: number };
};

const MAX_RESULTS = 60;
const EXCERPT_RADIUS = 90;

export async function searchNodes(projectId: string, rawQuery: string): Promise<SearchHit[]> {
  const query = rawQuery.trim();
  if (query.length < 2) return [];

  // Escape LIKE wildcards so a literal % or _ in the query can't widen the match.
  const escaped = query.replace(/[\\%_]/g, (c) => `\\${c}`);
  const pattern = `%${escaped}%`;

  const rows = await db
    .select()
    .from(nodes)
    .where(
      and(
        eq(nodes.projectId, projectId),
        // Deleted work must not surface in search; it lives in the trash view.
        isNull(nodes.deletedAt),
        or(
          sql`lower(${nodes.title}) LIKE lower(${pattern}) ESCAPE '\\'`,
          sql`lower(${nodes.synopsis}) LIKE lower(${pattern}) ESCAPE '\\'`,
          sql`lower(${nodes.plain}) LIKE lower(${pattern}) ESCAPE '\\'`,
        ),
      ),
    )
    .limit(MAX_RESULTS);

  const hits: SearchHit[] = [];
  for (const node of rows) {
    const hit =
      locate(node, "title", node.title, query) ??
      locate(node, "synopsis", node.synopsis ?? "", query) ??
      locate(node, "body", node.plain, query);
    if (hit) hits.push(hit);
  }

  // Title matches first, then synopsis, then prose — most specific signal wins.
  const rank = { title: 0, synopsis: 1, body: 2 } as const;
  hits.sort((a, b) => rank[a.field] - rank[b.field] || a.node.title.localeCompare(b.node.title));
  return hits;
}

function locate(
  node: Node,
  field: SearchHit["field"],
  haystack: string,
  needle: string,
): SearchHit | null {
  if (!haystack) return null;
  const at = haystack.toLowerCase().indexOf(needle.toLowerCase());
  if (at < 0) return null;

  // Window the excerpt around the match, snapping to word boundaries so the
  // result doesn't start or end mid-word.
  let start = Math.max(0, at - EXCERPT_RADIUS);
  let end = Math.min(haystack.length, at + needle.length + EXCERPT_RADIUS);
  if (start > 0) {
    const space = haystack.indexOf(" ", start);
    if (space >= 0 && space < at) start = space + 1;
  }
  if (end < haystack.length) {
    const space = haystack.lastIndexOf(" ", end);
    if (space > at + needle.length) end = space;
  }

  const excerpt =
    (start > 0 ? "…" : "") + haystack.slice(start, end).trim() + (end < haystack.length ? "…" : "");

  return {
    node,
    field,
    excerpt,
    match: { start: at - start + (start > 0 ? 1 : 0), length: needle.length },
  };
}
