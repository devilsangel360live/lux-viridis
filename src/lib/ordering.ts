import { generateKeyBetween } from "fractional-indexing";

/**
 * Ordering helpers over fractional indices.
 *
 * The invariant: a node's position is a string that sorts lexicographically
 * between its neighbours. Inserting or moving therefore touches one row, never
 * the whole sibling list — which is the only reason dragging chapter 40 to the
 * top of a 90-chapter book is cheap.
 */

export type Ordered = { idx: string };

/** Index for appending after the last sibling. */
export function idxAfterLast(siblings: Ordered[]): string {
  const last = maxIdx(siblings);
  return generateKeyBetween(last, null);
}

/** Index for inserting before the first sibling. */
export function idxBeforeFirst(siblings: Ordered[]): string {
  const first = minIdx(siblings);
  return generateKeyBetween(null, first);
}

/**
 * Index that lands a node at `position` within `siblings`, where `siblings` is
 * already sorted and excludes the node being moved. Excluding it matters: left
 * in, a node dragged one slot down would be measured against its own old index
 * and land back where it started.
 */
export function idxAt(siblings: Ordered[], position: number): string {
  const clamped = Math.max(0, Math.min(position, siblings.length));
  const before = clamped === 0 ? null : siblings[clamped - 1].idx;
  const after = clamped >= siblings.length ? null : siblings[clamped].idx;
  return generateKeyBetween(before, after);
}

/** Ascending sort by fractional index; ties break on id so order is total. */
export function byIdx<T extends Ordered & { id?: string }>(a: T, b: T): number {
  if (a.idx === b.idx) return (a.id ?? "").localeCompare(b.id ?? "");
  return a.idx < b.idx ? -1 : 1;
}

function maxIdx(siblings: Ordered[]): string | null {
  let max: string | null = null;
  for (const s of siblings) if (max === null || s.idx > max) max = s.idx;
  return max;
}

function minIdx(siblings: Ordered[]): string | null {
  let min: string | null = null;
  for (const s of siblings) if (min === null || s.idx < min) min = s.idx;
  return min;
}

/** n sequential indices after `after`, for seeding or bulk import. */
export function idxSequence(count: number, after: string | null = null): string[] {
  const out: string[] = [];
  let prev = after;
  for (let i = 0; i < count; i++) {
    prev = generateKeyBetween(prev, null);
    out.push(prev);
  }
  return out;
}
