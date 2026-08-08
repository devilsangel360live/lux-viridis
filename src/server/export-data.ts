import { eq } from "drizzle-orm";

import { db } from "@/db";
import { nodes, type Node, type Project } from "@/db/schema";
import { byIdx } from "@/lib/ordering";

/**
 * Assembles the structured content each export format renders.
 *
 * Format-agnostic on purpose: DOCX and PDF differ in how they draw a heading,
 * not in what belongs in the document. Keeping the selection and ordering here
 * means the two renderers can never disagree about what the book contains.
 */

export type Block =
  | { kind: "paragraph"; text: string }
  | { kind: "heading"; level: 1 | 2 | 3; text: string }
  | { kind: "sceneBreak" }
  | { kind: "meta"; label: string; value: string }
  | { kind: "note"; text: string };

export type ExportSection = {
  /** Rendered as a page-breaking heading in both formats. */
  title: string;
  subtitle?: string;
  blocks: Block[];
};

export type ExportDoc = {
  title: string;
  author: string | null;
  /** Shown under the title on the title page. */
  subtitle: string | null;
  sections: ExportSection[];
};

export type ExportKind = "manuscript" | "selection" | "bible" | "outline";

type PMNode = {
  type?: string;
  text?: string;
  attrs?: Record<string, unknown>;
  content?: PMNode[];
};

/** ProseMirror doc -> export blocks, preserving headings and scene breaks. */
function bodyToBlocks(body: unknown): Block[] {
  if (!body || typeof body !== "object") return [];
  const doc = body as PMNode;
  const blocks: Block[] = [];

  const inlineText = (node: PMNode): string => {
    let out = "";
    const walk = (n: PMNode) => {
      if (typeof n.text === "string") out += n.text;
      // A mention renders as its label — the reader should see the name.
      if (n.type === "mention" && typeof n.attrs?.label === "string") {
        out += n.attrs.label as string;
      }
      n.content?.forEach(walk);
    };
    walk(node);
    return out;
  };

  for (const node of doc.content ?? []) {
    if (node.type === "horizontalRule") {
      blocks.push({ kind: "sceneBreak" });
      continue;
    }
    if (node.type === "heading") {
      const level = Math.min(3, Math.max(1, Number(node.attrs?.level ?? 2))) as 1 | 2 | 3;
      const text = inlineText(node).trim();
      if (text) blocks.push({ kind: "heading", level, text });
      continue;
    }
    if (node.type === "blockquote" || node.type === "paragraph") {
      const text = inlineText(node).trim();
      if (text) blocks.push({ kind: "paragraph", text });
      continue;
    }
    if (node.type === "bulletList" || node.type === "orderedList") {
      for (const item of node.content ?? []) {
        const text = inlineText(item).trim();
        if (text) blocks.push({ kind: "paragraph", text: `• ${text}` });
      }
      continue;
    }
    const text = inlineText(node).trim();
    if (text) blocks.push({ kind: "paragraph", text });
  }

  return blocks;
}

async function liveNodes(projectId: string): Promise<Node[]> {
  const rows = await db.select().from(nodes).where(eq(nodes.projectId, projectId));
  return rows.filter((n) => !n.deletedAt);
}

function childrenOf(all: Node[], parentId: string | null, root?: string): Node[] {
  return all
    .filter((n) => n.parentId === parentId && (!root || n.root === root))
    .sort(byIdx);
}

/** Depth-first list of manuscript nodes in reading order. */
function manuscriptOrder(all: Node[]): Node[] {
  const out: Node[] = [];
  const walk = (parentId: string | null) => {
    for (const node of childrenOf(all, parentId, parentId === null ? "manuscript" : undefined)) {
      if (node.root !== "manuscript" || node.type === "card") continue;
      out.push(node);
      walk(node.id);
    }
  };
  walk(null);
  return out;
}

/**
 * The full manuscript: acts as part headings, chapters as chapter headings,
 * and scenes flowing together separated by scene breaks — the shape a reader
 * or an agent expects, rather than a dump of the binder.
 */
export async function buildManuscript(project: Project): Promise<ExportDoc> {
  const all = await liveNodes(project.id);
  const sections: ExportSection[] = [];

  for (const act of childrenOf(all, null, "manuscript")) {
    if (act.type === "card") continue;

    const chapters = childrenOf(all, act.id).filter((c) => c.type !== "card");

    // A node directly under the root that holds prose is its own section.
    if (chapters.length === 0) {
      const blocks = bodyToBlocks(act.body);
      if (blocks.length) sections.push({ title: act.title, blocks });
      continue;
    }

    for (const chapter of chapters) {
      const blocks: Block[] = [...bodyToBlocks(chapter.body)];
      const scenes = childrenOf(all, chapter.id).filter((s) => s.type !== "card");

      scenes.forEach((scene, i) => {
        if (i > 0 || blocks.length > 0) blocks.push({ kind: "sceneBreak" });
        blocks.push(...bodyToBlocks(scene.body));
      });

      if (blocks.length === 0) continue;
      sections.push({ title: chapter.title, subtitle: act.title, blocks });
    }
  }

  return {
    title: project.title,
    author: project.author,
    subtitle: project.subtitle,
    sections,
  };
}

/** One node and its descendants — "export this chapter". */
export async function buildSelection(project: Project, nodeId: string): Promise<ExportDoc> {
  const all = await liveNodes(project.id);
  const root = all.find((n) => n.id === nodeId);
  if (!root) return { title: project.title, author: project.author, subtitle: null, sections: [] };

  const sections: ExportSection[] = [];

  const collect = (node: Node): Block[] => {
    const blocks = [...bodyToBlocks(node.body)];
    const kids = childrenOf(all, node.id).filter((k) => k.type !== "card");
    kids.forEach((kid, i) => {
      if (i > 0 || blocks.length > 0) blocks.push({ kind: "sceneBreak" });
      blocks.push(...collect(kid));
    });
    return blocks;
  };

  const blocks = collect(root);
  if (blocks.length) sections.push({ title: root.title, blocks });

  return {
    title: root.title,
    author: project.author,
    subtitle: project.title,
    sections,
  };
}

const BIBLE_GROUPS: Array<{ type: string; label: string }> = [
  { type: "character", label: "Characters" },
  { type: "location", label: "Locations" },
  { type: "lore", label: "Lore" },
];

/** The world bible, grouped by type, with each entity's details and notes. */
export async function buildBible(project: Project): Promise<ExportDoc> {
  const all = await liveNodes(project.id);
  const sections: ExportSection[] = [];

  for (const group of BIBLE_GROUPS) {
    const entries = all
      .filter((n) => n.type === group.type)
      .sort((a, b) => a.title.localeCompare(b.title));
    if (entries.length === 0) continue;

    const blocks: Block[] = [];
    for (const entry of entries) {
      blocks.push({ kind: "heading", level: 2, text: entry.title });
      if (entry.synopsis) blocks.push({ kind: "note", text: entry.synopsis });

      const meta = (entry.meta ?? {}) as Record<string, unknown>;
      for (const [key, value] of Object.entries(meta)) {
        if (value === null || value === undefined || value === "") continue;
        if (key === "color") continue; // presentation only
        blocks.push({ kind: "meta", label: titleCase(key), value: String(value) });
      }

      blocks.push(...bodyToBlocks(entry.body));
    }

    sections.push({ title: group.label, blocks });
  }

  return {
    title: `${project.title} — Story Bible`,
    author: project.author,
    subtitle: project.subtitle,
    sections,
  };
}

/** Every chapter and scene with its synopsis and status, but no prose. */
export async function buildOutline(project: Project): Promise<ExportDoc> {
  const all = await liveNodes(project.id);
  const ordered = manuscriptOrder(all);
  const blocks: Block[] = [];

  for (const node of ordered) {
    if (node.type === "act") {
      blocks.push({ kind: "heading", level: 1, text: node.title });
    } else if (node.type === "chapter") {
      blocks.push({ kind: "heading", level: 2, text: node.title });
    } else {
      blocks.push({ kind: "heading", level: 3, text: node.title });
    }

    if (node.synopsis) blocks.push({ kind: "note", text: node.synopsis });

    const meta = (node.meta ?? {}) as Record<string, unknown>;
    const bits: string[] = [];
    if (meta.status) bits.push(String(meta.status));
    if (meta.pov) bits.push(`POV: ${meta.pov}`);
    if (node.wordCount > 0) bits.push(`${node.wordCount.toLocaleString("en-US")} words`);
    if (bits.length) blocks.push({ kind: "meta", label: "", value: bits.join(" · ") });
  }

  return {
    title: `${project.title} — Outline`,
    author: project.author,
    subtitle: project.subtitle,
    sections: blocks.length ? [{ title: "Outline", blocks }] : [],
  };
}

function titleCase(key: string): string {
  return key.replace(/([A-Z])/g, " $1").replace(/^./, (c) => c.toUpperCase());
}

export async function buildExport(
  project: Project,
  kind: ExportKind,
  nodeId?: string | null,
): Promise<ExportDoc> {
  switch (kind) {
    case "selection":
      return nodeId ? buildSelection(project, nodeId) : buildManuscript(project);
    case "bible":
      return buildBible(project);
    case "outline":
      return buildOutline(project);
    default:
      return buildManuscript(project);
  }
}
