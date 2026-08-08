import type { ClientNode, TreeNode } from "./api";

/**
 * Word count rollups.
 *
 * One rule decides everything here: **the book is the manuscript**. Character
 * sheets, lore entries and planning cards all carry word counts, but counting
 * them toward a draft's length would tell a writer they had written thousands
 * of words they cannot actually read in order. Those totals are reported
 * separately as "notes" instead of being hidden or merged.
 */

export function isManuscriptProse(node: { root: string; type: string }): boolean {
  return node.root === "manuscript" && node.type !== "card";
}

/** Words in a node plus everything beneath it, counting manuscript prose only. */
export function manuscriptWords(node: TreeNode): number {
  const own = isManuscriptProse(node) ? node.wordCount : 0;
  return own + node.children.reduce((sum, child) => sum + manuscriptWords(child), 0);
}

/** Words in a node plus its subtree, regardless of section. */
export function totalWords(node: TreeNode): number {
  return node.wordCount + node.children.reduce((sum, c) => sum + totalWords(c), 0);
}

export type ProjectStats = {
  /** The book's length. */
  manuscript: number;
  /** World bible and planning material — real writing, but not the draft. */
  notes: number;
  chapters: number;
  scenes: number;
  /** Longest and shortest chapter, for spotting outliers while revising. */
  longestChapter: { title: string; words: number } | null;
  shortestChapter: { title: string; words: number } | null;
};

export function projectStats(nodes: ClientNode[], tree: TreeNode[]): ProjectStats {
  const live = nodes.filter((n) => !n.deletedAt);

  const manuscript = live
    .filter(isManuscriptProse)
    .reduce((sum, n) => sum + n.wordCount, 0);

  const notes = live
    .filter((n) => n.root === "world" || n.root === "planning")
    .reduce((sum, n) => sum + n.wordCount, 0);

  const chapterNodes = collect(tree, (n) => n.type === "chapter");
  const chapterCounts = chapterNodes
    .map((c) => ({ title: c.title, words: manuscriptWords(c) }))
    // A chapter with nothing in it yet would otherwise always win "shortest".
    .filter((c) => c.words > 0)
    .sort((a, b) => b.words - a.words);

  return {
    manuscript,
    notes,
    chapters: chapterNodes.length,
    scenes: collect(tree, (n) => n.type === "scene").length,
    longestChapter: chapterCounts[0] ?? null,
    shortestChapter: chapterCounts.length > 1 ? chapterCounts[chapterCounts.length - 1] : null,
  };
}

function collect(tree: TreeNode[], predicate: (n: TreeNode) => boolean): TreeNode[] {
  const out: TreeNode[] = [];
  const walk = (list: TreeNode[]) => {
    for (const n of list) {
      if (predicate(n)) out.push(n);
      walk(n.children);
    }
  };
  walk(tree);
  return out;
}

/** Rough page estimate at a standard manuscript density. */
export function estimatedPages(words: number): number {
  return Math.max(0, Math.round(words / 250));
}
