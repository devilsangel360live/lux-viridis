/**
 * Helpers for turning a ProseMirror document into the derived values the app
 * stores alongside it: a plain-text projection and a word count.
 *
 * These are kept server-safe (no editor imports) so API routes can recompute
 * them without instantiating TipTap.
 */

type PMNode = {
  type?: string;
  text?: string;
  attrs?: Record<string, unknown>;
  content?: PMNode[];
};

/** Depth-first text extraction. Block-level nodes are separated by newlines. */
export function docToPlainText(doc: unknown): string {
  if (!doc || typeof doc !== "object") return "";
  const parts: string[] = [];

  const walk = (node: PMNode) => {
    if (typeof node.text === "string") parts.push(node.text);

    // A mention is an atom: its visible text lives in attrs, not in children.
    // Without this the mentioned name would vanish from the word count and
    // from search, even though the reader plainly sees it on the page.
    if (node.type === "mention") {
      const label = node.attrs?.label;
      if (typeof label === "string") parts.push(label);
    }

    if (Array.isArray(node.content)) {
      node.content.forEach(walk);
      // Paragraphs and headings shouldn't run words together across blocks.
      if (node.type !== "text") parts.push("\n");
    }
  };

  walk(doc as PMNode);
  return parts.join("").replace(/\n{2,}/g, "\n").trim();
}

/**
 * Word count over plain text. Hyphens and apostrophes stay inside a word, so
 * "well-lit" and "don't" count once each — matching what writers expect from a
 * manuscript target.
 */
export function countWords(plain: string): number {
  const trimmed = plain.trim();
  if (!trimmed) return 0;
  return trimmed.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
}

export function docStats(doc: unknown): { plain: string; wordCount: number } {
  const plain = docToPlainText(doc);
  return { plain, wordCount: countWords(plain) };
}

/** An empty ProseMirror doc, used when creating a new writable node. */
export function emptyDoc() {
  return { type: "doc", content: [{ type: "paragraph" }] };
}
