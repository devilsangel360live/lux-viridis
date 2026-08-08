import { sql } from "drizzle-orm";
import {
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

/**
 * Every node type lives in one table. A chapter, a scene, a character sheet and
 * an act beat differ only by `type` and by what they carry in `meta` — which is
 * what makes the binder, corkboard, act board and compile order all reducible to
 * a query over this single tree.
 *
 * Portability note: this schema deliberately sticks to the SQLite/Postgres
 * common subset. JSON columns are stored as text so the Postgres migration is a
 * driver swap plus `jsonb` column types, not a rewrite. Nothing here uses an
 * SQLite-only feature.
 */

export const NODE_TYPES = [
  "folder",
  "act",
  "chapter",
  "scene",
  "note",
  "character",
  "location",
  "lore",
  "beat",
  /**
   * A card on a beat's mind-map canvas. Structurally a normal node parented to
   * its beat, so it inherits search, word counts and the node API; its canvas
   * position lives in `meta.x` / `meta.y` rather than in the tree's `idx`.
   */
  "card",
] as const;

export type NodeType = (typeof NODE_TYPES)[number];

/** Root containers a node can hang under, so the binder can show real sections. */
export const NODE_ROOTS = ["manuscript", "world", "planning", "trash"] as const;
export type NodeRoot = (typeof NODE_ROOTS)[number];

export const users = sqliteTable(
  "users",
  {
    id: text("id").primaryKey(),
    email: text("email").notNull(),
    name: text("name").notNull(),
    /** scrypt hash as `salt:derivedKey`, both hex. */
    passwordHash: text("password_hash").notNull(),

    /**
     * Recovery questions. Answers are hashed exactly like passwords — they are
     * credentials, and a plaintext "mother's maiden name" column would be worse
     * than no recovery at all. Nullable so accounts created before this existed
     * (or through the CLI) still work.
     */
    recoveryQuestion1: text("recovery_question_1"),
    recoveryAnswer1: text("recovery_answer_1"),
    recoveryQuestion2: text("recovery_question_2"),
    recoveryAnswer2: text("recovery_answer_2"),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
  },
  (t) => [uniqueIndex("users_email_unique").on(t.email)],
);

export const sessions = sqliteTable(
  "sessions",
  {
    /** The random token itself; the cookie carries this value. */
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
  },
  (t) => [index("sessions_user_idx").on(t.userId)],
);

export const projects = sqliteTable("projects", {
  id: text("id").primaryKey(),
  /**
   * Nullable so the column could be added to existing rows; every project
   * created through the app has an owner, and queries always filter by it.
   */
  ownerId: text("owner_id").references(() => users.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  subtitle: text("subtitle"),
  author: text("author"),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .default(sql`(unixepoch() * 1000)`),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" })
    .notNull()
    .default(sql`(unixepoch() * 1000)`),
});

export const nodes = sqliteTable(
  "nodes",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),

    /**
     * Self-referencing adjacency. A null parent means the node sits directly
     * under one of the fixed roots named by `root`.
     */
    parentId: text("parent_id"),
    root: text("root").$type<NodeRoot>().notNull().default("manuscript"),

    type: text("type").$type<NodeType>().notNull(),

    /**
     * Fractional index. Ordering is lexicographic among siblings, so moving a
     * node rewrites exactly one row regardless of how long the book is.
     */
    idx: text("idx").notNull(),

    title: text("title").notNull().default("Untitled"),

    /** ProseMirror document JSON. Null for pure containers. */
    body: text("body", { mode: "json" }).$type<unknown>(),

    /** Corkboard card text — the index-card summary, not the prose. */
    synopsis: text("synopsis"),

    /** Plain-text projection of `body`, kept for word counts and search. */
    plain: text("plain").notNull().default(""),
    wordCount: integer("word_count").notNull().default(0),

    /** Per-type fields: POV, status, colour, age, arc, target… */
    meta: text("meta", { mode: "json" })
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),

    collapsed: integer("collapsed", { mode: "boolean" })
      .notNull()
      .default(false),

    /**
     * Trash is a soft delete. `deletedAt` marks the node the user actually
     * deleted; everything beneath it is carried along implicitly by staying in
     * its subtree. `prevParentId` / `prevRoot` remember where it came from so
     * restore puts it back exactly, even if the binder has changed since.
     */
    deletedAt: integer("deleted_at", { mode: "timestamp_ms" }),
    prevParentId: text("prev_parent_id"),
    prevRoot: text("prev_root").$type<NodeRoot>(),

    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
  },
  (t) => [
    // The binder's hot path: children of a parent, in order.
    index("nodes_sibling_idx").on(t.projectId, t.parentId, t.idx),
    index("nodes_root_idx").on(t.projectId, t.root, t.idx),
    index("nodes_type_idx").on(t.projectId, t.type),
    index("nodes_deleted_idx").on(t.projectId, t.deletedAt),
    /**
     * Two siblings must never share a slot, or drag order becomes ambiguous.
     * Scoped by `root` as well as `parent_id`: top-level nodes all have a null
     * parent, but Manuscript/World/Planning are separate sibling lists and each
     * legitimately starts at the same index.
     */
    uniqueIndex("nodes_sibling_unique").on(t.projectId, t.root, t.parentId, t.idx),
  ],
);

/** Edge kinds. `mention` is an @-reference; `edge` is a drawn mind-map arrow. */
export const LINK_KINDS = ["mention", "edge"] as const;
export type LinkKind = (typeof LINK_KINDS)[number];

/**
 * The project's graph layer, as opposed to the tree in `nodes`.
 *
 * Two uses share it. An @mention of a character inside a scene writes a
 * `mention` row, which turns an inert world-bible folder into a real index.
 * A connection drawn between two cards on a beat canvas writes an `edge` row.
 * Both are directed source -> target and may form cycles, which is exactly why
 * they live here rather than in the tree.
 */
export const links = sqliteTable(
  "links",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    sourceId: text("source_id")
      .notNull()
      .references(() => nodes.id, { onDelete: "cascade" }),
    targetId: text("target_id")
      .notNull()
      .references(() => nodes.id, { onDelete: "cascade" }),
    kind: text("kind").$type<LinkKind>().notNull().default("mention"),
    /** Optional edge caption, e.g. "causes", "blocks". */
    label: text("label"),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
  },
  (t) => [
    index("links_source_idx").on(t.sourceId),
    index("links_target_idx").on(t.targetId),
    index("links_kind_idx").on(t.projectId, t.kind),
    // Scoped by kind: a mention and a drawn edge between the same two nodes are
    // different facts and must be able to coexist.
    uniqueIndex("links_unique").on(t.sourceId, t.targetId, t.kind),
  ],
);

export const SNAPSHOT_KINDS = ["auto", "manual", "pre-restore"] as const;
export type SnapshotKind = (typeof SNAPSHOT_KINDS)[number];

/**
 * Point-in-time copies of a node's text.
 *
 * `auto` snapshots are taken when a document has changed substantially since
 * the last one; `manual` ones are explicit; `pre-restore` is written just
 * before a restore overwrites the current text, so restoring is itself
 * undoable and no version of the work is ever truly lost.
 */
export const snapshots = sqliteTable(
  "snapshots",
  {
    id: text("id").primaryKey(),
    nodeId: text("node_id")
      .notNull()
      .references(() => nodes.id, { onDelete: "cascade" }),
    kind: text("kind").$type<SnapshotKind>().notNull().default("auto"),
    label: text("label"),
    /** The node's title at capture time, so a restore can recover it too. */
    title: text("title"),
    body: text("body", { mode: "json" }).$type<unknown>(),
    plain: text("plain").notNull().default(""),
    wordCount: integer("word_count").notNull().default(0),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
  },
  (t) => [index("snapshots_node_idx").on(t.nodeId, t.createdAt)],
);

export type User = typeof users.$inferSelect;
export type Session = typeof sessions.$inferSelect;
export type Project = typeof projects.$inferSelect;
export type Node = typeof nodes.$inferSelect;
export type NewNode = typeof nodes.$inferInsert;
export type Link = typeof links.$inferSelect;
export type Snapshot = typeof snapshots.$inferSelect;
