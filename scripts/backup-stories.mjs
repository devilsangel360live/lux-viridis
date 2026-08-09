/**
 * Writes every project out as readable Markdown, one dated folder per run.
 *
 *   node scripts/backup-stories.mjs                 # -> ./backups
 *   BACKUP_DIR=/data/story-backups node scripts/backup-stories.mjs
 *   docker exec lux-viridis node scripts/backup-stories.mjs
 *
 * This is the *portability* backup, and it is deliberately not the same thing
 * as the nightly `sqlite3 .backup` of lux.db. That one restores this app; this
 * one survives it. If the container will not start, or the schema has moved on,
 * or Lux Viridis is simply gone, a folder of Markdown still opens in Obsidian,
 * Scrivener, Word, or `less` — with the book in reading order.
 *
 * Hence the choices below, which cost fidelity on purpose:
 *   - Files are numbered by their position in the binder, so lexical sort *is*
 *     reading order. This is the property that makes the dump usable somewhere
 *     else, and it is worth more than any metadata.
 *   - Snapshots and trash are skipped. Twenty-five sibling versions of every
 *     scene would bury the manuscript, and the goal here is legibility.
 *   - @mentions become a plain list of names in the frontmatter. The graph is
 *     lost; the human-readable fact is kept.
 *
 * Plain JS and plain SQL, like migrate-standalone.mjs and user-standalone.mjs:
 * the runtime image is Next's standalone bundle, so there is no tsx and no
 * drizzle-orm resolvable from disk. better-sqlite3 is a native addon and stays
 * external, so it is available.
 */
import { createRequire } from "node:module";
import path from "node:path";
import fs from "node:fs";

const require = createRequire(import.meta.url);
const Database = require("better-sqlite3");

/**
 * Mirrors resolveDbFile in src/db/index.ts, so this runs on a dev machine with
 * no environment set as well as in the container. `/data/lux.db` is only right
 * inside the image; falling back to it on a laptop would report "no database"
 * while data/lux.db sat there unread. The legacy `verbum.db` name is honoured
 * for the same reason the app honours it.
 */
function resolveDbFile() {
  if (process.env.DATABASE_FILE) return process.env.DATABASE_FILE;
  if (fs.existsSync("/data/lux.db")) return "/data/lux.db";

  const dir = path.join(process.cwd(), "data");
  const current = path.join(dir, "lux.db");
  const legacy = path.join(dir, "verbum.db");
  if (!fs.existsSync(current) && fs.existsSync(legacy)) return legacy;
  return current;
}

const file = resolveDbFile();
const backupRoot = process.env.BACKUP_DIR ?? path.join(process.cwd(), "backups");
const KEEP_DAYS = Number(process.env.BACKUP_KEEP ?? 5);

/* ------------------------------------------------------------------ *
 * ProseMirror -> Markdown
 *
 * A port of the walker in src/server/export-data.ts, with one deliberate
 * difference: that one flattens to plain text for DOCX/PDF layout, this one
 * keeps emphasis, headings and scene breaks, because Markdown can carry them
 * and a future editor will want them.
 * ------------------------------------------------------------------ */

/** Wraps text in the Markdown delimiters for a ProseMirror mark set. */
function applyMarks(text, marks) {
  if (!text || !marks?.length) return text;
  let out = text;
  for (const mark of marks) {
    if (mark.type === "bold" || mark.type === "strong") out = `**${out}**`;
    else if (mark.type === "italic" || mark.type === "em") out = `*${out}*`;
    else if (mark.type === "strike") out = `~~${out}~~`;
    else if (mark.type === "code") out = `\`${out}\``;
  }
  return out;
}

/**
 * Inline content of a block, as Markdown.
 *
 * Mentions render as their label — the name is what a reader needs, and the
 * node id it points at means nothing outside this database.
 */
function inlineMarkdown(node) {
  let out = "";
  const walk = (n) => {
    if (typeof n.text === "string") {
      out += applyMarks(n.text, n.marks);
    }
    if (n.type === "mention" && typeof n.attrs?.label === "string") {
      out += n.attrs.label;
    }
    if (n.type === "hardBreak") out += "  \n";
    n.content?.forEach(walk);
  };
  walk(node);
  return out;
}

function bodyToMarkdown(body) {
  const doc = parseJson(body);
  if (!doc || typeof doc !== "object") return "";

  const blocks = [];

  for (const node of doc.content ?? []) {
    if (node.type === "horizontalRule") {
      // The manuscript convention for a scene break, and readable as-is.
      blocks.push("***");
      continue;
    }
    if (node.type === "heading") {
      const level = Math.min(6, Math.max(1, Number(node.attrs?.level ?? 2)));
      const text = inlineMarkdown(node).trim();
      if (text) blocks.push(`${"#".repeat(level)} ${text}`);
      continue;
    }
    if (node.type === "blockquote") {
      const text = inlineMarkdown(node).trim();
      if (text) blocks.push(text.split("\n").map((l) => `> ${l}`).join("\n"));
      continue;
    }
    if (node.type === "bulletList" || node.type === "orderedList") {
      const ordered = node.type === "orderedList";
      const items = [];
      (node.content ?? []).forEach((item, i) => {
        const text = inlineMarkdown(item).trim();
        if (text) items.push(`${ordered ? `${i + 1}.` : "-"} ${text}`);
      });
      if (items.length) blocks.push(items.join("\n"));
      continue;
    }
    if (node.type === "codeBlock") {
      const text = inlineMarkdown(node);
      if (text.trim()) blocks.push("```\n" + text + "\n```");
      continue;
    }
    const text = inlineMarkdown(node).trim();
    if (text) blocks.push(text);
  }

  return blocks.join("\n\n");
}

/* ------------------------------------------------------------------ *
 * Frontmatter
 * ------------------------------------------------------------------ */

/**
 * YAML-escapes a scalar. Titles routinely contain colons ("Chapter 1: The
 * Crossing"), which would produce invalid YAML unquoted.
 */
function yamlScalar(value) {
  const str = String(value);
  if (str === "") return '""';
  if (/^[\w .\-/]+$/.test(str) && !/^\d+$/.test(str)) return str;
  return `"${str.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function frontmatter(fields) {
  const lines = ["---"];
  for (const [key, value] of Object.entries(fields)) {
    if (value === null || value === undefined || value === "") continue;
    if (Array.isArray(value)) {
      if (!value.length) continue;
      lines.push(`${key}: [${value.map(yamlScalar).join(", ")}]`);
    } else if (typeof value === "number") {
      // Emitted bare so a reader can sort and sum on it. yamlScalar quotes
      // digit strings, which would make every word count a string instead.
      lines.push(`${key}: ${value}`);
    } else {
      lines.push(`${key}: ${yamlScalar(value)}`);
    }
  }
  lines.push("---");
  return lines.join("\n");
}

/* ------------------------------------------------------------------ *
 * Filesystem naming
 * ------------------------------------------------------------------ */

/**
 * A filename-safe slug.
 *
 * Targets the intersection of what ext4, APFS and NTFS accept, because the
 * whole point is that this folder can be copied anywhere. Length is capped so
 * deep binders stay under the ~255-byte path segment limit.
 */
function slug(value) {
  const out = String(value ?? "")
    .normalize("NFKD")
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 60)
    .replace(/^-|-$/g, "");
  return out || "untitled";
}

/** Zero-padded ordinal so lexical sort matches binder order past nine items. */
function ordinal(i) {
  return String(i + 1).padStart(2, "0");
}

/**
 * Ascending sort by fractional index, ties broken on id.
 *
 * Mirrors byIdx in src/lib/ordering.ts. The tie-break matters: without a total
 * order, two siblings sharing an index would swap places between runs and
 * produce a spurious diff in every backup.
 */
function byIdx(a, b) {
  if (a.idx === b.idx) return String(a.id).localeCompare(String(b.id));
  return a.idx < b.idx ? -1 : 1;
}

function parseJson(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === "object") return value;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function isoDate(ms) {
  if (!ms) return null;
  return new Date(Number(ms)).toISOString();
}

/* ------------------------------------------------------------------ *
 * Writing a project
 * ------------------------------------------------------------------ */

function writeProject(db, project, projectDir) {
  const allNodes = db
    .prepare("SELECT * FROM nodes WHERE project_id = ?")
    .all(project.id)
    .filter((n) => !n.deleted_at);

  // Mentions, resolved to target titles once rather than per node.
  const titleById = new Map(allNodes.map((n) => [n.id, n.title]));
  const mentionsBySource = new Map();
  const links = db
    .prepare("SELECT * FROM links WHERE project_id = ? AND kind = 'mention'")
    .all(project.id);
  for (const link of links) {
    const label = titleById.get(link.target_id);
    if (!label) continue;
    if (!mentionsBySource.has(link.source_id)) mentionsBySource.set(link.source_id, []);
    mentionsBySource.get(link.source_id).push(label);
  }

  const childrenOf = (parentId, root) =>
    allNodes
      .filter((n) => n.parent_id === parentId && (!root || n.root === root))
      .sort(byIdx);

  let fileCount = 0;
  let wordCount = 0;
  const overview = [];

  /**
   * Writes one node, recursing into children.
   *
   * A node becomes a folder when it has children and a file when it has prose;
   * a chapter with both gets a folder plus an `_index.md` for its own text.
   * Cards are skipped here and handled with their parent beat — on disk they
   * are a beat's mind-map, not documents in their own right.
   */
  const walk = (node, dir, depth, index) => {
    const children = childrenOf(node.id).filter((c) => c.type !== "card");
    const cards = childrenOf(node.id).filter((c) => c.type === "card");
    const markdown = bodyToMarkdown(node.body);
    const name = `${ordinal(index)}-${slug(node.title)}`;

    overview.push(
      `${"  ".repeat(depth)}- ${node.title}` +
        (node.word_count ? ` — ${node.word_count.toLocaleString()} words` : ""),
    );
    wordCount += node.word_count ?? 0;

    const meta = parseJson(node.meta) ?? {};
    const head = frontmatter({
      title: node.title,
      type: node.type,
      words: node.word_count || null,
      status: meta.status ?? null,
      pov: meta.pov ?? null,
      synopsis: node.synopsis ?? null,
      mentions: mentionsBySource.get(node.id) ?? [],
      updated: isoDate(node.updated_at),
    });

    // Cards carry the beat's mind-map; without them a planning backup loses
    // the board entirely, since their text lives only in their titles.
    const cardSection = cards.length
      ? "\n\n## Cards\n\n" + cards.sort(byIdx).map((c) => `- ${c.title}`).join("\n")
      : "";

    if (children.length > 0) {
      const childDir = path.join(dir, name);
      fs.mkdirSync(childDir, { recursive: true });

      // A container's own prose (a chapter's epigraph, a folder's notes) would
      // otherwise be dropped on the floor.
      if (markdown || node.synopsis || cardSection) {
        const bodyPart = [markdown, cardSection.trim()].filter(Boolean).join("\n\n");
        fs.writeFileSync(path.join(childDir, "_index.md"), `${head}\n\n${bodyPart}\n`);
        fileCount += 1;
      }

      children.forEach((child, i) => walk(child, childDir, depth + 1, i));
      return;
    }

    // A pure empty container with no children and no text is structure the
    // writer made; an empty file records that it existed.
    const bodyPart = [markdown, cardSection.trim()].filter(Boolean).join("\n\n");
    fs.writeFileSync(path.join(dir, `${name}.md`), `${head}\n\n${bodyPart}\n`);
    fileCount += 1;
  };

  const ROOTS = [
    { root: "manuscript", label: "manuscript" },
    { root: "world", label: "world" },
    { root: "planning", label: "planning" },
  ];

  for (const { root, label } of ROOTS) {
    const top = childrenOf(null, root).filter((n) => n.type !== "card");
    if (!top.length) continue;

    const rootDir = path.join(projectDir, label);
    fs.mkdirSync(rootDir, { recursive: true });

    overview.push(`\n### ${label[0].toUpperCase()}${label.slice(1)}\n`);
    top.forEach((node, i) => walk(node, rootDir, 0, i));
  }

  const head = frontmatter({
    title: project.title,
    subtitle: project.subtitle,
    author: project.author,
    words: wordCount || null,
    documents: fileCount,
    exported: new Date().toISOString(),
  });

  fs.writeFileSync(
    path.join(projectDir, "OVERVIEW.md"),
    `${head}\n\n# ${project.title}\n` +
      (project.subtitle ? `\n*${project.subtitle}*\n` : "") +
      (project.author ? `\n${project.author}\n` : "") +
      `\n${wordCount.toLocaleString()} words across ${fileCount} documents.\n` +
      `\n## Contents\n${overview.join("\n")}\n`,
  );

  return { fileCount, wordCount };
}

/* ------------------------------------------------------------------ *
 * Rotation
 * ------------------------------------------------------------------ */

/**
 * Keeps the newest KEEP_DAYS folders.
 *
 * Sorting is on the directory name, which is why it is ISO-dated: names sort
 * chronologically, so this never has to trust a filesystem mtime that a copy
 * between disks would have rewritten.
 */
function prune(root) {
  if (!fs.existsSync(root)) return [];
  const dated = fs
    .readdirSync(root, { withFileTypes: true })
    .filter((e) => e.isDirectory() && /^\d{4}-\d{2}-\d{2}$/.test(e.name))
    .map((e) => e.name)
    .sort();

  const excess = dated.slice(0, Math.max(0, dated.length - KEEP_DAYS));
  for (const name of excess) {
    fs.rmSync(path.join(root, name), { recursive: true, force: true });
  }
  return excess;
}

/* ------------------------------------------------------------------ *
 * Main
 * ------------------------------------------------------------------ */

if (!fs.existsSync(file)) {
  console.error(`[backup] no database at ${file}`);
  process.exit(1);
}

/**
 * Read-only, so a backup can never modify what it is backing up.
 *
 * Note this needs a *writable directory* despite being a read-only connection:
 * the database is in WAL mode, and opening a WAL database — even to read —
 * makes SQLite create the `-shm` shared-memory file and take a lock. On a
 * directory mounted `:ro` that fails with SQLITE_READONLY_DIRECTORY.
 *
 * SQLite's `immutable=1` URI flag would skip WAL entirely and allow the
 * read-only mount, but better-sqlite3 accepts no URI filenames and no such
 * option — it passes only readonly/fileMustExist/timeout down to sqlite3_open.
 * So the data mount stays writable and this connection stays read-only, which
 * puts the guarantee in the flag above rather than in the filesystem.
 */
const db = new Database(file, { readonly: true, fileMustExist: true });

const today = new Date().toISOString().slice(0, 10);
const dayDir = path.join(backupRoot, today);

// A re-run on the same day replaces that day's folder rather than merging into
// it, so a renamed or deleted chapter cannot leave an orphan file behind.
try {
  fs.rmSync(dayDir, { recursive: true, force: true });
  fs.mkdirSync(dayDir, { recursive: true });
} catch (err) {
  if (err.code !== "EACCES" && err.code !== "EPERM") throw err;
  // The container runs as uid 1001; a backup directory created by root — by
  // hand, or by the root-run .db backup service beside it — is not writable
  // here. A stack trace buries that, and the fix is one chown.
  console.error(
    `[backup] cannot write ${backupRoot} (${err.code}).\n` +
      `[backup] The container runs as uid 1001. Fix on the host with:\n` +
      `[backup]   chown -R 1001:1001 <the directory mounted at ${backupRoot}>`,
  );
  process.exit(1);
}

const projects = db.prepare("SELECT * FROM projects ORDER BY title").all();

if (projects.length === 0) {
  console.log("[backup] no projects to write");
}

let totalFiles = 0;
let totalWords = 0;

for (const project of projects) {
  const projectDir = path.join(dayDir, slug(project.title));
  fs.mkdirSync(projectDir, { recursive: true });

  const { fileCount, wordCount } = writeProject(db, project, projectDir);
  totalFiles += fileCount;
  totalWords += wordCount;

  console.log(
    `[backup] ${project.title}: ${fileCount} documents, ${wordCount.toLocaleString()} words`,
  );
}

db.close();

const pruned = prune(backupRoot);
for (const name of pruned) console.log(`[backup] pruned ${name}`);

console.log(
  `[backup] wrote ${dayDir} — ${projects.length} project(s), ` +
    `${totalFiles} documents, ${totalWords.toLocaleString()} words`,
);
